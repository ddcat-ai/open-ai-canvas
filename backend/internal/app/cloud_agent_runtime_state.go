// 画布 Agent 运行状态的编解码与校验。
//
// cloudAgentRuntime 整体序列化进 CloudAgentExecution.StateJSON；每次写回都经过
// cloudAgentSave → validateCloudAgentRuntime，保证数据库里不会出现结构上自相矛盾的检查点。
// 读取缓存等可再生数据在写入前裁剪（cloudAgentPruneReadCacheForCheckpoint），
// 防止状态随轮次无限膨胀。

package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"unicode/utf8"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/prompts"
)

func cloudAgentDecode(run *model.CloudAgentExecution) (cloudAgentRuntime, error) {
	var state cloudAgentRuntime
	if run == nil || strings.TrimSpace(run.StateJSON) == "" {
		return state, errors.New("Agent runtime state is empty")
	}
	if err := json.Unmarshal([]byte(run.StateJSON), &state); err != nil {
		return state, fmt.Errorf("decode Agent runtime state: %w", err)
	}
	state.RuntimeRunID = run.ID
	state.ExecutionFence = run.ExecutionFence
	if run.CheckpointVersion >= 2 {
		if len(run.Transcript) != run.MessageCount {
			return state, errors.New("Agent execution transcript is incomplete")
		}
		// 事件只载入最近一窗（repository.CloudAgentJournalWindow），所以这里校验的是
		// "窗口与水位自洽"而不是全量条数：
		//   - 窗口必须正好结束在水位上（最后一条 seq == EventCount），否则说明有行没读到；
		//   - 窗口为空时水位只能是 0，否则同样说明行缺失（不能把"一行都没有"当成空日志）；
		//   - EventSeqBase = 水位 - 窗口条数，即窗口之前已入库的条数。
		if len(run.Journal) == 0 && run.EventCount != 0 {
			return state, errors.New("Agent execution journal is incomplete")
		}
		state.EventSeqBase = run.EventCount - len(run.Journal)
		if state.EventSeqBase < 0 {
			return state, errors.New("Agent execution journal watermark is invalid")
		}
		state.Events = make([]CloudAgentEvent, 0, len(run.Journal))
		state.Canonical.Messages, state.TextHistory = nil, nil
		for _, record := range run.Journal {
			expected := state.EventSeqBase + len(state.Events) + 1
			if record.Sequence != expected {
				return state, errors.New("Agent event sequence is incomplete")
			}
			var event CloudAgentEvent
			if err := json.Unmarshal([]byte(record.EventJSON), &event); err != nil {
				return state, fmt.Errorf("decode Agent event: %w", err)
			}
			if event.Seq != record.Sequence || event.RunID != run.ID || event.EventID != fmt.Sprintf("%s:%d", run.ID, record.Sequence) {
				return state, errors.New("Agent event identity is invalid")
			}
			state.Events = append(state.Events, event)
		}
		if len(state.Events) > 0 && state.Events[len(state.Events)-1].Seq != run.EventCount {
			return state, errors.New("Agent execution journal is incomplete")
		}
		for _, record := range run.Transcript {
			switch record.Kind {
			case "canonical":
				var message map[string]any
				if err := json.Unmarshal([]byte(record.MessageJSON), &message); err != nil {
					return state, fmt.Errorf("decode Agent message: %w", err)
				}
				if record.Sequence != len(state.Canonical.Messages)+1 {
					return state, errors.New("Agent message sequence is incomplete")
				}
				state.Canonical.Messages = append(state.Canonical.Messages, message)
			case "history":
				var message providerTextMessage
				if err := json.Unmarshal([]byte(record.MessageJSON), &message); err != nil {
					return state, fmt.Errorf("decode Agent history: %w", err)
				}
				if record.Sequence != len(state.TextHistory)+1 {
					return state, errors.New("Agent history sequence is incomplete")
				}
				state.TextHistory = append(state.TextHistory, message)
			default:
				return state, errors.New("Agent message kind is unsupported")
			}
		}
	}
	if err := validateCloudAgentRuntime(run, &state); err != nil {
		return state, err
	}
	return state, nil
}

// cloudAgentDecodeForExecution is the only decoder for paths that may resume
// model/tool execution. Historical reads intentionally use cloudAgentDecode:
// a completed turn keeps its frozen policy and capability snapshot and remains
// valid conversation context after the current runtime contract advances.
func cloudAgentDecodeForExecution(run *model.CloudAgentExecution) (cloudAgentRuntime, error) {
	state, err := cloudAgentDecode(run)
	if err != nil {
		return state, WrapAppError(409, "Agent 运行记录无法安全恢复；请新建一轮消息", err)
	}
	if err := validateCloudAgentPolicySnapshot(state.Policy); err != nil {
		return state, WrapAppError(409, "Agent 运行使用旧版执行合同，无法继续原运行；请新建一轮消息", err)
	}
	if (state.Request.Surface == "creation") != (state.Policy.SystemPolicyID == "creation-agent-system") {
		return state, NewAppError(409, "Agent 运行的入口与执行合同不一致，请继续发送新消息")
	}
	return state, nil
}

func validateCloudAgentRuntime(run *model.CloudAgentExecution, state *cloudAgentRuntime) error {
	if run == nil || state == nil {
		return errors.New("Agent runtime state is missing")
	}
	if run.ID == "" {
		// Package-level tool tests use an in-memory runtime without a durable
		// execution identity. Durable rows are always validated below.
		return nil
	}
	if (state.Request.Surface != "creation" && state.Request.CanvasID == "") || state.Request.Prompt == "" || state.Request.PermissionMode == "" {
		return errors.New("Agent runtime request is incomplete")
	}
	if err := validateCloudAgentRequest(&state.Request); err != nil {
		return fmt.Errorf("invalid Agent runtime request: %w", err)
	}
	if err := validateCloudAgentPolicySnapshotStructure(state.Policy); err != nil {
		return err
	}
	if err := validateCloudAgentProfileSnapshot(state.Profile, state.Policy); err != nil {
		return err
	}
	for scope, read := range state.ProfileReads {
		found := false
		for _, layer := range state.Profile.Layers {
			found = found || layer.Scope == scope
		}
		if !read || !found {
			return errors.New("Agent runtime profile read history is invalid")
		}
	}
	if state.Step < 0 || state.Generations < 0 || state.VideoSeconds < 0 {
		return errors.New("Agent runtime budget or step is invalid")
	}
	if state.ConfirmationRounds < 0 || state.ConfirmationRounds > cloudAgentMaxConfirmationRounds {
		return errors.New("Agent runtime confirmation round is invalid")
	}
	if len(state.ConfirmationFingerprints) > cloudAgentMaxConfirmationRounds {
		return errors.New("Agent runtime confirmation fingerprint history is invalid")
	}
	seenConfirmationPoints := make(map[string]struct{}, len(state.ConfirmationFingerprints))
	for _, fingerprint := range state.ConfirmationFingerprints {
		if !cloudAgentSHA256(fingerprint) {
			return errors.New("Agent runtime confirmation fingerprint is invalid")
		}
		if _, exists := seenConfirmationPoints[fingerprint]; exists {
			return errors.New("Agent runtime confirmation fingerprint history contains duplicates")
		}
		seenConfirmationPoints[fingerprint] = struct{}{}
	}
	if state.PendingConfirmationFingerprint != "" {
		if !cloudAgentSHA256(state.PendingConfirmationFingerprint) {
			return errors.New("Agent runtime pending confirmation fingerprint is invalid")
		}
		if _, exists := seenConfirmationPoints[state.PendingConfirmationFingerprint]; !exists {
			return errors.New("Agent runtime pending confirmation fingerprint is not recorded")
		}
	}
	if state.ImageInspectCalls < 0 {
		return errors.New("Agent runtime image inspection budget is invalid")
	}
	if state.ReadToolCalls < 0 {
		return errors.New("Agent runtime read tool budget is invalid")
	}
	for nodeID, count := range state.ImageInspectCounts {
		if strings.TrimSpace(nodeID) == "" || count < 0 {
			return errors.New("Agent runtime image inspection counts are invalid")
		}
	}
	for key, count := range state.ImageInspectionReads {
		if strings.TrimSpace(key) == "" || count < 0 {
			return errors.New("Agent runtime image inspection read history is invalid")
		}
	}
	for key, count := range state.ToolReadReplays {
		if strings.TrimSpace(key) == "" || count < 0 {
			return errors.New("Agent runtime read replay history is invalid")
		}
	}
	if (state.Request.Budget.MaxGenerationTasks > 0 && state.Generations > state.Request.Budget.MaxGenerationTasks) || (state.Request.Budget.MaxVideoSeconds > 0 && state.VideoSeconds > state.Request.Budget.MaxVideoSeconds) {
		return errors.New("Agent runtime generation budget is invalid")
	}
	if state.CallIndex < 0 || state.CallIndex > len(state.Calls) || len(state.Calls) > cloudAgentMaxToolCalls {
		return errors.New("Agent runtime call cursor is invalid")
	}
	for toolName, repair := range state.ToolRepairs {
		if toolName == "" || utf8.RuneCountInString(toolName) > 80 || repair.Attempt < 1 || repair.Attempt > cloudAgentToolAttemptLimit || repair.GroupID == "" {
			return errors.New("Agent runtime tool repair state is invalid")
		}
		if err := validateCloudAgentID(repair.GroupID, "工具纠错组 ID", 240); err != nil {
			return err
		}
	}
	if state.ActiveTaskID != "" && state.MediaTaskID != "" {
		return errors.New("Agent runtime has multiple active tasks")
	}
	if state.HistoryIncludesCurrent && len(state.Canonical.Messages) < len(state.TextHistory) {
		return errors.New("Agent compacted history exceeds canonical transcript")
	}
	if len(state.TaskIDs) == 0 {
		return errors.New("Agent runtime task history is invalid")
	}
	seenTasks := make(map[string]struct{}, len(state.TaskIDs))
	for _, taskID := range state.TaskIDs {
		if err := validateCloudAgentID(taskID, "任务 ID", 80); err != nil {
			return err
		}
		if _, exists := seenTasks[taskID]; exists {
			return errors.New("Agent runtime task history contains duplicates")
		}
		seenTasks[taskID] = struct{}{}
	}
	if state.ActiveTaskID != "" && !cloudAgentContainsString(state.TaskIDs, state.ActiveTaskID) {
		return errors.New("Agent runtime active task is not in task history")
	}
	if state.MediaTaskID != "" {
		if !cloudAgentContainsString(state.TaskIDs, state.MediaTaskID) || state.CallIndex >= len(state.Calls) || (state.Calls[state.CallIndex].Function.Name != "generate_media" && state.Calls[state.CallIndex].Function.Name != "image_layer_split" && (!cloudAgentCommerceBatchCall(state.Calls[state.CallIndex].Function.Name) || state.CommerceBatch == nil && (state.Approval == nil || state.Approval.Batch == nil))) {
			return errors.New("Agent runtime media task is not attached to current call")
		}
	}
	if state.AutoPreparedMedia != nil {
		if state.AutoPreparedCallHash == "" || state.CallIndex < 0 || state.CallIndex >= len(state.Calls) {
			return errors.New("Agent runtime auto media preparation is invalid")
		}
		current := state.Calls[state.CallIndex]
		if current.Function.Name != "generate_media" && current.Function.Name != "image_layer_split" {
			return errors.New("Agent runtime auto media preparation is not attached to a media call")
		}
		if state.AutoPreparedCallHash != cloudAgentApprovalCallHash(current) {
			return errors.New("Agent runtime auto media preparation does not match current call")
		}
	}
	if state.Decisions == nil || state.Events == nil {
		return errors.New("Agent runtime maps are missing")
	}
	if state.EventSeqBase < 0 {
		return errors.New("Agent runtime event watermark is invalid")
	}
	// 内存里只有"最近一窗 + 本次转移新产生的部分"，超过健全上限说明窗口没有按
	// CloudAgentJournalWindow 载入（或序号基准算错），此时不能继续推进。
	if len(state.Events) > cloudAgentEventWindowSanityLimit {
		return errors.New("Agent runtime event window is too large")
	}
	for index, event := range state.Events {
		if event.RunID != run.ID || event.Seq != state.EventSeqBase+index+1 || event.EventID == "" || event.Type == "" || event.Payload == nil || event.CreatedAt.IsZero() {
			return errors.New("Agent runtime event history is invalid")
		}
		if err := validateCloudAgentID(event.EventID, "事件 ID", 240); err != nil {
			return err
		}
		raw, err := json.Marshal(event.Payload)
		if err != nil || len(raw) > 128<<10 {
			return errors.New("Agent runtime event payload is too large")
		}
	}
	for _, call := range state.Calls {
		if err := validateCloudAgentID(call.ID, "工具调用 ID", 160); err != nil || call.Function.Name == "" || utf8.RuneCountInString(call.Function.Name) > 80 || !utf8.ValidString(call.Function.Name) {
			return errors.New("Agent runtime tool call is invalid")
		}
		if len(call.Function.Arguments) > 32000 {
			return errors.New("Agent runtime tool arguments are too large")
		}
		if err := decodeCloudAgentJSONObject(call.Function.Arguments, &map[string]any{}); err != nil {
			return errors.New("Agent runtime tool arguments are invalid")
		}
	}
	if state.Approval != nil {
		if err := validateCloudAgentID(state.Approval.ID, "审批 ID", 200); err != nil || state.CallIndex >= len(state.Calls) {
			return errors.New("Agent runtime approval is invalid")
		}
		current := state.Calls[state.CallIndex]
		if state.Approval.Call.ID != current.ID || state.Approval.Call.Function.Name != current.Function.Name || state.Approval.Call.Function.Arguments != current.Function.Arguments {
			return errors.New("Agent runtime approval does not match current call")
		}
		if state.Approval.Decision != "" && state.Approval.Decision != "approve" && state.Approval.Decision != "reject" {
			return errors.New("Agent runtime approval decision is invalid")
		}
	}
	if state.CallIndex == len(state.Calls) && state.Approval != nil {
		return errors.New("Agent runtime has approval without a pending call")
	}
	return nil
}

func validateCloudAgentPolicySnapshot(snapshot cloudAgentPolicySnapshot) error {
	if err := validateCloudAgentPolicySnapshotStructure(snapshot); err != nil {
		return err
	}
	if snapshot.CompilerVersion != cloudAgentCompilerVersion {
		return errors.New("Agent runtime policy compiler is unsupported")
	}
	if snapshot.ReasoningMode != "off" && snapshot.ReasoningMode != "auto" && snapshot.ReasoningMode != "deep" {
		return errors.New("Agent runtime reasoning mode is invalid")
	}
	system, media, err := prompts.LoadAgentPolicies()
	capabilityVersion, capabilityHash := cloudAgentCapabilitySetVersion, cloudAgentCapabilitySetHash()
	if snapshot.SystemPolicyID == "creation-agent-system" {
		system, media, err = prompts.LoadCreationAgentPolicies()
		capabilityVersion, capabilityHash = cloudAgentCreationCapabilitySetVersion, cloudAgentCreationCapabilitySetHash()
	}
	if snapshot.CapabilitySetVersion != capabilityVersion {
		return errors.New("Agent runtime capability contract is unsupported")
	}
	if err != nil {
		return fmt.Errorf("load Agent runtime policies: %w", err)
	}
	if snapshot.SystemPolicyID != system.ID || snapshot.SystemPolicyVersion != system.Version || snapshot.MediaPolicyID != media.ID || snapshot.MediaPolicyVersion != media.Version {
		return errors.New("Agent runtime policy version is unsupported")
	}
	// An existing run keeps its admitted prompt and tool schema. Never resume it
	// against changed policies or capabilities under an unchanged version label.
	if snapshot.SystemPolicyHash != system.Hash || snapshot.MediaPolicyHash != media.Hash || snapshot.CapabilitySetHash != capabilityHash {
		return errors.New("Agent runtime policy or capability contract has changed")
	}
	return nil
}

// validateCloudAgentPolicySnapshotStructure validates the frozen historical
// record without treating the current binary as its authorization source.
// Version/hash equality with the current runtime is checked separately, only
// when an old run is about to execute again.
func validateCloudAgentPolicySnapshotStructure(snapshot cloudAgentPolicySnapshot) error {
	for _, field := range []struct {
		name  string
		value string
	}{
		{"policy compiler", snapshot.CompilerVersion},
		{"system policy ID", snapshot.SystemPolicyID},
		{"media policy ID", snapshot.MediaPolicyID},
		{"capability set version", snapshot.CapabilitySetVersion},
	} {
		if strings.TrimSpace(field.value) == "" || !utf8.ValidString(field.value) || utf8.RuneCountInString(field.value) > 120 {
			return fmt.Errorf("Agent runtime %s is invalid", field.name)
		}
	}
	if snapshot.SystemPolicyVersion <= 0 || snapshot.MediaPolicyVersion <= 0 {
		return errors.New("Agent runtime policy version is invalid")
	}
	if snapshot.ReasoningMode != "off" && snapshot.ReasoningMode != "auto" && snapshot.ReasoningMode != "deep" {
		return errors.New("Agent runtime reasoning mode is invalid")
	}
	for _, field := range []struct {
		name  string
		value string
	}{
		{"system policy hash", snapshot.SystemPolicyHash},
		{"media policy hash", snapshot.MediaPolicyHash},
		{"capability set hash", snapshot.CapabilitySetHash},
		{"profile revision", snapshot.ProfileRevision},
		{"profile hash", snapshot.ProfileHash},
	} {
		if !cloudAgentSHA256(field.value) {
			return fmt.Errorf("Agent runtime %s is invalid", field.name)
		}
	}
	return nil
}

func cloudAgentSHA256(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, r := range value {
		if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f')) {
			return false
		}
	}
	return true
}

func cloudAgentContainsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

const cloudAgentStateJSONLimit = 512 << 10

func cloudAgentCheckpointJSON(state *cloudAgentRuntime) ([]byte, error) {
	checkpoint := *state
	checkpoint.Canonical.Messages = nil
	checkpoint.TextHistory = nil
	checkpoint.Events = nil
	return json.Marshal(checkpoint)
}

// cloudAgentPruneReadCacheForCheckpoint is a last-resort durability guard.
// ToolReadResults is a replay cache: losing one entry means a later read may
// execute again, but allowing that cache to make the whole runtime impossible
// to checkpoint loses the run and prevents context compaction from starting.
// Remove the largest entries first so a single oversized canvas/skill result
// cannot strand the run above the 512 KiB state limit.
func cloudAgentPruneReadCacheForCheckpoint(state *cloudAgentRuntime, limit int) (removed int) {
	if state == nil || len(state.ToolReadResults) == 0 || limit <= 0 {
		return 0
	}
	raw, err := cloudAgentCheckpointJSON(state)
	if err != nil || len(raw) <= limit {
		return 0
	}
	type candidate struct {
		key       string
		bytes     int
		inContext bool
		error     bool
	}
	candidates := make([]candidate, 0, len(state.ToolReadResults))
	for key, cached := range state.ToolReadResults {
		entryBytes, _ := json.Marshal(cached)
		candidates = append(candidates, candidate{
			key:       key,
			bytes:     len(entryBytes),
			inContext: cloudAgentReadResultInContext(state, cached.Result),
			error:     cached.Error != "",
		})
	}
	// Prefer dropping errors and entries already absent from the current
	// transcript. Keep results currently visible to the model for as long as
	// possible because compaction may need them for a replay after eviction.
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].inContext != candidates[j].inContext {
			return !candidates[i].inContext
		}
		if candidates[i].error != candidates[j].error {
			return candidates[i].error
		}
		if candidates[i].bytes != candidates[j].bytes {
			return candidates[i].bytes > candidates[j].bytes
		}
		return candidates[i].key < candidates[j].key
	})
	for _, item := range candidates {
		if raw, err = cloudAgentCheckpointJSON(state); err != nil || len(raw) <= limit {
			break
		}
		delete(state.ToolReadResults, item.key)
		delete(state.ToolReadReplays, item.key)
		removed++
	}
	if len(state.ToolReadResults) == 0 {
		state.ToolReadResults = nil
	}
	if len(state.ToolReadReplays) == 0 {
		state.ToolReadReplays = nil
	}
	return removed
}

func cloudAgentSave(run *model.CloudAgentExecution, state *cloudAgentRuntime) error {
	if run == nil || state == nil {
		return errors.New("Agent runtime state is missing")
	}
	// 轮内唯一裁剪 = 图片：超出保留轮次的看图结果换成文字回执（正文一律保留）。
	// 上游每一步都会重新读取历史里的图片并按视觉 token 计费，保留整段历史既贵又没有新信息。
	if changed, pruned := cloudAgentPruneInspectedImages(&state.Canonical, nil); changed && run.ID != "" {
		state.event(run.ID, "context_images_pruned", map[string]any{
			"prunedImages": pruned, "retentionRounds": cloudAgentImageRetentionRounds,
			"text": "已把超出保留轮次的看图结果移出模型上下文（保留文字回执与 nodeId）",
		})
	}
	if run.ID != "" {
		if err := validateCloudAgentRuntime(run, state); err != nil {
			return cloudAgentCheckpointFailure("runtime validation", err)
		}
		for index, event := range state.Events {
			sequence := state.EventSeqBase + index + 1
			if event.Seq != sequence || event.RunID != run.ID || event.EventID != fmt.Sprintf("%s:%d", run.ID, sequence) {
				return cloudAgentCheckpointFailure("event identity", errors.New("Agent event sequence or identity is invalid"))
			}
		}
	}
	// The canonical transcript and event journal are persisted separately. The
	// bounded StateJSON therefore contains only runtime metadata and replay
	// caches, and the latter must never be allowed to block a checkpoint.
	raw, err := cloudAgentCheckpointJSON(state)
	if err != nil {
		return cloudAgentCheckpointFailure("state encode", err)
	}
	if len(raw) > cloudAgentStateJSONLimit {
		cloudAgentPruneReadCacheForCheckpoint(state, cloudAgentStateJSONLimit)
		raw, err = cloudAgentCheckpointJSON(state)
		if err != nil {
			return cloudAgentCheckpointFailure("state encode after cache pruning", err)
		}
	}
	if len(raw) > cloudAgentStateJSONLimit {
		return cloudAgentCheckpointFailure("state size", fmt.Errorf("Agent 状态超过 512KB 上限（%d bytes）", len(raw)))
	}
	run.CanvasID, run.ActiveTaskID, run.MediaTaskID = state.Request.CanvasID, state.ActiveTaskID, state.MediaTaskID
	run.SessionID = state.Request.SessionID
	run.Surface = state.Request.Surface
	if contextSelection, marshalErr := json.Marshal(state.Request.ContextSelection); marshalErr == nil {
		run.ContextSelectionJSON = string(contextSelection)
	}
	run.ParentID = state.ParentID
	if run.Title == "" {
		run.Title = truncateRunes(state.Request.Prompt, 80)
	}
	// 事件按"窗口 + 水位"落库：run.Journal 只是内存窗口的映射（窗口之外的历史仍在
	// 事件表里），写入侧（repository.MutateCloudAgent）只追加 seq > 旧水位的行，
	// 因此窗口左移不会丢历史。
	run.Journal = make([]model.CloudAgentEventRecord, 0, len(state.Events))
	for _, event := range state.Events {
		body, err := json.Marshal(event)
		if err != nil {
			return cloudAgentCheckpointFailure("event encode", err)
		}
		run.Journal = append(run.Journal, model.CloudAgentEventRecord{RunID: run.ID, UserID: run.UserID, Sequence: event.Seq, EventJSON: string(body), CreatedAt: event.CreatedAt})
	}
	run.Transcript = make([]model.CloudAgentMessageRecord, 0, len(state.Canonical.Messages)+len(state.TextHistory))
	for index, message := range state.Canonical.Messages {
		body, err := json.Marshal(message)
		if err != nil {
			return cloudAgentCheckpointFailure("canonical message encode", err)
		}
		run.Transcript = append(run.Transcript, model.CloudAgentMessageRecord{RunID: run.ID, UserID: run.UserID, Kind: "canonical", Sequence: index + 1, MessageJSON: string(body)})
	}
	for index, message := range state.TextHistory {
		body, err := json.Marshal(message)
		if err != nil {
			return cloudAgentCheckpointFailure("history encode", err)
		}
		run.Transcript = append(run.Transcript, model.CloudAgentMessageRecord{RunID: run.ID, UserID: run.UserID, Kind: "history", Sequence: index + 1, MessageJSON: string(body)})
	}
	// 水位 = 窗口之前已入库的条数 + 本次载入/新增的窗口条数，必须与事件表里的
	// 最大 seq 一致，否则下一次载入的窗口与水位会对不上。
	run.CheckpointVersion, run.EventCount, run.MessageCount = 2, state.EventSeqBase+len(state.Events), len(run.Transcript)
	run.StateJSON = string(raw)
	return nil
}
