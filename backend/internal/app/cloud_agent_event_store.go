package app

import (
	"encoding/json"
	"fmt"
	"log"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

const (
	// cloudAgentRunEventDeltaLimit 是增量读取（sinceSeq）单次返回的条数上限，
	// 也是 HTTP 上 eventLimit 允许的最大值（越界的请求由 handler 拒绝）。
	// 内部调用方不受它约束：续轮收束按 cloudAgentContinuationEventLimit 显式取更大的页。
	cloudAgentRunEventDeltaLimit = 500
	// cloudAgentRunEventPageLimit 是运行详情默认返回的事件条数：等于内存里的尾部窗口，
	// 因此默认读取不额外查事件表；要更早的记录由客户端通过 eventLimit 显式索取。
	cloudAgentRunEventPageLimit = repository.CloudAgentJournalWindow
	// cloudAgentEventWindowSanityLimit 是内存事件窗口的健全上限（窗口本身加一次转移
	// 新产生的事件），超过它说明窗口没有按 CloudAgentJournalWindow 载入。
	cloudAgentEventWindowSanityLimit = 512
)

// cloudAgentRunEventsForView 组装运行详情要返回的事件。
//
// 事件全量在 cloud_agent_event_records（一行一条 EventJSON，主键 run_id + sequence），
// 内存里只有最近一窗（repository.CloudAgentJournalWindow），所以两条读路径都要显式
// 说明"这一页在整条日志里的位置"：
//
//   - sinceSeq > 0：只返回该序号之后的增量（SSE 断线重连 / 滚动拉取），走
//     `sequence > ? ORDER BY sequence LIMIT ?` 的 keyset 读，不载入更早的行。
//   - sinceSeq == 0：返回最近 cloudAgentRunEventPageLimit 条；窗口不够时（eventLimit
//     大于窗口）再从事件表往前补一页，仍然只按 seq 读。
//
// 事件表里没有该运行的行时（升级前的旧检查点把事件放在 state_json 里），退回内存窗口，
// 保证老运行仍可读。
func (s *Service) cloudAgentRunEventsForView(userID string, run *model.CloudAgentExecution, state *cloudAgentRuntime, sinceSeq, limit int) []CloudAgentEvent {
	if sinceSeq > 0 {
		pageLimit := cloudAgentRunEventDeltaLimit
		if limit > 0 && limit < pageLimit {
			pageLimit = limit
		}
		rows, err := s.repo.CloudAgentEventRecords(userID, run.ID, sinceSeq, pageLimit)
		if err != nil {
			log.Printf("agent event delta %s: %v", run.ID, err)
			rows = nil
		}
		events := make([]CloudAgentEvent, 0, pageLimit)
		for _, row := range rows {
			events = append(events, cloudAgentEventFromRecord(row))
		}
		// 数据库页已达到上限时不能再拼接内存窗口，否则可能超过请求的页大小，
		// 或在表中间隔着未返回的历史记录直接跳到窗口尾部，制造序号缺口。
		if len(events) == pageLimit {
			return events
		}
		last := sinceSeq
		if len(rows) > 0 {
			last = rows[len(rows)-1].Sequence
		}
		// 表未填满这一页时，内存里可能还有本次转移尚未落库的事件，补在末尾。
		for _, event := range state.Events {
			if event.Seq > last {
				events = append(events, event)
				if len(events) == pageLimit {
					break
				}
			}
		}
		if len(events) > 0 {
			return events
		}
		// 表与窗口都没有更新的内容：按游标过滤内存窗口（旧检查点的运行走这里）。
		pending := make([]CloudAgentEvent, 0, len(state.Events))
		for _, event := range state.Events {
			if event.Seq > sinceSeq {
				pending = append(pending, event)
				if len(pending) == pageLimit {
					break
				}
			}
		}
		return pending
	}
	tail := state.Events
	if limit <= 0 {
		limit = cloudAgentRunEventPageLimit
	}
	if len(tail) >= limit {
		return append([]CloudAgentEvent(nil), tail[len(tail)-limit:]...)
	}
	// 窗口已经是全量（水位 0）：没有更早的记录可补，直接返回。
	if state.EventSeqBase == 0 {
		return append([]CloudAgentEvent(nil), tail...)
	}
	rows, err := s.repo.CloudAgentEventRecordsBefore(userID, run.ID, state.EventSeqBase+1, limit-len(tail))
	if err != nil {
		log.Printf("agent event page %s: %v", run.ID, err)
		return append([]CloudAgentEvent(nil), tail...)
	}
	events := make([]CloudAgentEvent, 0, len(rows)+len(tail))
	for _, row := range rows {
		events = append(events, cloudAgentEventFromRecord(row))
	}
	return append(events, tail...)
}

// cloudAgentEventFromRecord 把事件行解析成对外契约结构。
func cloudAgentEventFromRecord(row model.CloudAgentEventRecord) CloudAgentEvent {
	var event CloudAgentEvent
	if err := json.Unmarshal([]byte(row.EventJSON), &event); err != nil || event.EventID == "" {
		// 行存在但解不出来：仍按行给出身份与占位类型，避免整页读取失败。
		// 这条事件不代表运行的真实动作，客户端应以服务端画布与任务状态为准。
		return CloudAgentEvent{
			EventID: fmt.Sprintf("%s:%d", row.RunID, row.Sequence), RunID: row.RunID, Seq: row.Sequence,
			Type: "unreadable_event", Payload: map[string]any{"text": "该事件记录无法解析，请以服务端画布与任务状态为准"}, CreatedAt: row.CreatedAt,
		}
	}
	if event.RunID == "" {
		event.RunID = row.RunID
	}
	if event.Seq == 0 {
		event.Seq = row.Sequence
	}
	if event.CreatedAt.IsZero() {
		event.CreatedAt = row.CreatedAt
	}
	return event
}

// cloudAgentRunEventCount 给出"这个运行一共产生过多少事件"：以事件表条数为准，再补上
// 本次转移还没落库的部分（内存里 seq 高于水位的窗口）与检查点水位，取三者最大值。
func (s *Service) cloudAgentRunEventCount(userID string, run *model.CloudAgentExecution, state *cloudAgentRuntime) int {
	stored, err := s.repo.CloudAgentEventRecordCount(userID, run.ID)
	if err != nil {
		log.Printf("agent event count %s: %v", run.ID, err)
		stored = 0
	}
	total := int(stored)
	if pending := state.EventSeqBase + len(state.Events); pending > total {
		total = pending
	}
	if run != nil && run.EventCount > total {
		total = run.EventCount
	}
	return total
}
