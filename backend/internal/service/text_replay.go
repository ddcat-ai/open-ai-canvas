package service

import (
	"encoding/json"
	"errors"
	"log"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/gorm"
)

const (
	textReplayMaxEventBytes          = 64 << 10
	textReplayMaxTaskBytes           = 2 << 20
	textReplayMaxUserBytes           = 64 << 20
	textReplayMaxTaskEvents    int64 = 4096
	textReplaySuccessRetention       = 24 * time.Hour
	textReplayDraftRetention         = 7 * 24 * time.Hour
)

type TextReplayResult struct {
	Deltas    []model.TaskTextDelta `json:"deltas"`
	TextDraft string                `json:"textDraft,omitempty"`
	FinalText string                `json:"finalText,omitempty"`
	Complete  bool                  `json:"complete"`
	Status    model.TaskStatus      `json:"status"`
	Stage     string                `json:"stage,omitempty"`
	Progress  int                   `json:"progress"`
	Error     string                `json:"error,omitempty"`
}

// isTextReplayTaskRequest 识别前端自管的文本持久化请求（input 带 replay=true）。
// 这类任务由前端直连模型流式生成，仅作正文的后端存档与回放，不经过 worker 队列生成。
func isTextReplayTaskRequest(input map[string]any) bool {
	value, ok := input["replay"]
	if !ok {
		return false
	}
	switch v := value.(type) {
	case bool:
		return v
	case string:
		return strings.EqualFold(strings.TrimSpace(v), "true")
	default:
		return false
	}
}

// CompleteTextReplayTask 在文本生成结束后把最终正文写入任务，收尾为 succeeded，
// 关闭 delta 写入窗口并触发 text-deltas 归并，使 queryTaskTextReplay 能读到 finalText。
func (s *Service) CompleteTextReplayTask(userID string, taskID string, text string) (*model.Task, error) {
	if strings.TrimSpace(text) == "" {
		return nil, BadAuthRequest("文本内容不能为空")
	}
	if len([]byte(text)) > textReplayMaxTaskBytes {
		return nil, BadAuthRequest("文本内容过大")
	}
	if _, err := s.repo.TaskForUser(userID, taskID); err != nil {
		return nil, err
	}
	resultJSON, _ := json.Marshal(map[string]any{"mode": "text", "text": text})
	completed, err := s.repo.CompleteTextReplayTask(userID, taskID, string(resultJSON), time.Now())
	if err != nil {
		return nil, err
	}
	if !completed {
		return nil, BadAuthRequest("该文本任务已结束或不属于你，无法完成")
	}
	if compactErr := s.finalizeTaskTextReplay(taskID, model.TaskStatusSucceeded); compactErr != nil {
		_ = s.log(userID, taskID, "error", "文本回放窗口更新失败", compactErr.Error())
	}
	return s.repo.TaskForUser(userID, taskID)
}

func (s *Service) AppendTaskTextDelta(userID string, taskID string, content string) (*model.TaskTextDelta, error) {
	task, err := s.repo.TaskForUser(userID, taskID)
	if err != nil {
		return nil, err
	}
	if capabilityFromTaskType(task.Type) != "text" {
		return nil, BadAuthRequest("只有文本生成任务支持增量回放")
	}
	if strings.TrimSpace(content) == "" {
		return nil, BadAuthRequest("文本增量不能为空")
	}
	if len([]byte(content)) > textReplayMaxEventBytes {
		return nil, BadAuthRequest("单条文本增量不能超过 64KB")
	}
	item, err := s.repo.AppendTaskTextDelta(userID, taskID, content, time.Now().Add(textReplayDraftRetention), repository.TextReplayLimits{
		MaxTaskBytes: textReplayMaxTaskBytes, MaxUserBytes: textReplayMaxUserBytes, MaxTaskEvents: textReplayMaxTaskEvents,
	})
	if errors.Is(err, repository.ErrTextReplayQuotaExceeded) {
		return nil, BadAuthRequest("文本回放增量已达到配额，请等待任务归并后继续")
	}
	if errors.Is(err, repository.ErrTextReplayClosed) {
		return nil, BadAuthRequest("已结束任务不能继续写入文本增量")
	}
	return item, err
}

func (s *Service) TaskTextReplay(userID string, taskID string, after int64) (*TextReplayResult, error) {
	task, err := s.repo.TaskForUser(userID, taskID)
	if err != nil {
		return nil, err
	}
	deltas, err := s.repo.TaskTextDeltas(userID, taskID, after, 1000)
	if err != nil {
		return nil, err
	}
	result := &TextReplayResult{
		Deltas: deltas, TextDraft: task.TextDraft,
		Complete: task.Status == model.TaskStatusSucceeded || task.Status == model.TaskStatusFailed || task.Status == model.TaskStatusCancelled,
		Status:   task.Status, Stage: task.Stage, Progress: task.Progress, Error: task.Error,
	}
	if task.Status == model.TaskStatusSucceeded {
		result.FinalText = taskResultText(task.ResultJSON)
	}
	return result, nil
}

func (s *Service) finalizeTaskTextReplay(taskID string, status model.TaskStatus) error {
	keepDraft := status == model.TaskStatusFailed || status == model.TaskStatusCancelled
	retention := textReplaySuccessRetention
	if keepDraft {
		retention = textReplayDraftRetention
	}
	err := s.repo.CompactTaskTextDeltas(taskID, time.Now().Add(retention), keepDraft)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	return err
}

func (s *Service) CleanupTaskTextReplay() (int64, error) {
	return s.repo.CleanupTaskTextDeltas(time.Now())
}

func (s *Service) AdminTextReplayStats(actor *model.User) (repository.TextReplayStats, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return repository.TextReplayStats{}, err
	}
	return s.repo.TextReplayStats()
}

func taskResultText(raw string) string {
	var result struct {
		Text string `json:"text"`
	}
	if json.Unmarshal([]byte(raw), &result) != nil {
		return ""
	}
	return result.Text
}

func (s *Service) startTextReplayCleanup() {
	cleanup := func() {
		if _, err := s.CleanupTaskTextReplay(); err != nil {
			log.Printf("text replay cleanup failed: %v", err)
		}
	}
	cleanup()
	go func() {
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			cleanup()
		}
	}()
}
