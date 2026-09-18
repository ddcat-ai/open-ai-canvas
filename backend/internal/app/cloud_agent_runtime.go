package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"strings"
	"time"
	"unicode/utf8"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/prompts"
	"infinite-canvas/backend/internal/repository"
)

// A deterministic checkpoint failure must not be retried forever like a transient DB error.
var errCloudAgentCheckpoint = errors.New("invalid Agent checkpoint")

type CloudAgentEvent struct {
	EventID   string         `json:"eventId"`
	RunID     string         `json:"runId"`
	Seq       int            `json:"seq"`
	Type      string         `json:"type"`
	Payload   map[string]any `json:"payload"`
	CreatedAt time.Time      `json:"createdAt"`
}
type cloudAgentCall struct {
	ID       string `json:"id"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}
type cloudAgentApproval struct {
	ModelName string                    `json:"modelName,omitempty"`
	ID        string                    `json:"approvalId"`
	Call      cloudAgentCall            `json:"call"`
	CallHash  string                    `json:"callHash,omitempty"`
	Preview   cloudAgentApprovalPreview `json:"preview"`
	Decision  string                    `json:"decision,omitempty"`
	Reason    string                    `json:"reason,omitempty"`
}
type cloudAgentRuntime struct {
	Request              CloudAgentRequest         `json:"request"`
	Policy               cloudAgentPolicySnapshot  `json:"policy"`
	ParentID             string                    `json:"parentId,omitempty"`
	Fingerprint          string                    `json:"fingerprint,omitempty"`
	CreativeAnchor       cloudAgentCreativeAnchor  `json:"creativeAnchor,omitempty"`
	TextHistory          []providerTextMessage     `json:"textHistory,omitempty"`
	Skills               []cloudAgentSkill         `json:"skills"`
	SkillReads           map[string]bool           `json:"skillReads,omitempty"`
	Profile              cloudAgentProfileSnapshot `json:"profile"`
	ProfileReads         map[string]bool           `json:"profileReads,omitempty"`
	Canonical            canonicalAgentRequest     `json:"canonical"`
	ActiveTaskID         string                    `json:"activeTaskId"`
	ActiveTextDraft      string                    `json:"activeTextDraft,omitempty"`
	MediaTaskID          string                    `json:"mediaTaskId,omitempty"`
	TaskIDs              []string                  `json:"taskIds"`
	Step                 int                       `json:"step"`
	Generations          int                       `json:"generations"`
	VideoSeconds         int                       `json:"videoSeconds"`
	Calls                []cloudAgentCall          `json:"calls"`
	CallIndex            int                       `json:"callIndex"`
	Approval             *cloudAgentApproval       `json:"approval,omitempty"`
	Decisions            map[string]string         `json:"decisions"`
	DecisionSettings     map[string]string         `json:"decisionSettings,omitempty"`
	ActionNudged         bool                      `json:"actionNudged,omitempty"`
	EmptyOutputNudged    int                       `json:"emptyOutputNudged,omitempty"`
	StepSnapshotHash     string                    `json:"stepSnapshotHash,omitempty"`
	StoryboardTaskID     string                    `json:"storyboardTaskId,omitempty"`
	Plan                 []cloudAgentPlanItem      `json:"plan,omitempty"`
	PendingInterjections []cloudAgentInterjection  `json:"pendingInterjections,omitempty"`
	InterjectionIDs      []string                  `json:"interjectionIds,omitempty"`
	Events               []CloudAgentEvent         `json:"events"`
}

func (s *Service) ensureCloudAgentExecution(task *model.Task, initial cloudAgentState) error {
	var input struct {
		TextHistory []providerTextMessage `json:"textHistory"`
		Requests    struct {
			Canonical canonicalAgentRequest `json:"canonical"`
		} `json:"agentRequests"`
	}
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		return err
	}
	canonical := input.Requests.Canonical
	canonical.SystemPrompt = stripCloudAgentPlanBlock(canonical.SystemPrompt)
	canonical.Messages = stripCloudAgentRuntimeContext(canonical.Messages)
	state := cloudAgentRuntime{Request: initial.Request, Policy: initial.Policy, ParentID: initial.ParentID, Fingerprint: initial.Fingerprint, CreativeAnchor: initial.CreativeAnchor, TextHistory: input.TextHistory, Skills: initial.Skills, Profile: initial.Profile, Canonical: canonical, ActiveTaskID: task.ID, TaskIDs: []string{task.ID}, Step: 1, Decisions: map[string]string{}, Plan: initial.Plan, Events: []CloudAgentEvent{}}
	if len(initial.Skills) > 0 {
		state.event(task.ID, "tool_completed", map[string]any{"toolName": "skills_load", "text": fmt.Sprintf("已启用 %d 个技能，正文将按需读取", len(initial.Skills))})
	}
	run := &model.CloudAgentExecution{ID: task.ID, UserID: task.UserID, Status: "running", Revision: 1, CreatedAt: task.CreatedAt, UpdatedAt: time.Now()}
	if err := cloudAgentSave(run, &state); err != nil {
		return err
	}
	return s.repo.EnsureCloudAgent(run)
}
func (state *cloudAgentRuntime) event(id, kind string, payload map[string]any) {
	seq := len(state.Events) + 1
	state.Events = append(state.Events, CloudAgentEvent{EventID: fmt.Sprintf("%s:%d", id, seq), RunID: id, Seq: seq, Type: kind, Payload: payload, CreatedAt: time.Now()})
}
func cloudAgentDecode(run *model.CloudAgentExecution) (cloudAgentRuntime, error) {
	var state cloudAgentRuntime
	if run == nil || strings.TrimSpace(run.StateJSON) == "" {
		return state, errors.New("Agent runtime state is empty")
	}
	if err := json.Unmarshal([]byte(run.StateJSON), &state); err != nil {
		return state, fmt.Errorf("decode Agent runtime state: %w", err)
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
	if state.Request.CanvasID == "" || state.Request.Prompt == "" || state.Request.PermissionMode == "" {
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
	if (state.Request.Budget.MaxGenerationTasks > 0 && state.Generations > state.Request.Budget.MaxGenerationTasks) || (state.Request.Budget.MaxVideoSeconds > 0 && state.VideoSeconds > state.Request.Budget.MaxVideoSeconds) {
		return errors.New("Agent runtime generation budget is invalid")
	}
	if state.CallIndex < 0 || state.CallIndex > len(state.Calls) || len(state.Calls) > 8 {
		return errors.New("Agent runtime call cursor is invalid")
	}
	if state.ActiveTaskID != "" && state.MediaTaskID != "" {
		return errors.New("Agent runtime has multiple active tasks")
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
		if !cloudAgentContainsString(state.TaskIDs, state.MediaTaskID) || state.CallIndex >= len(state.Calls) || state.Calls[state.CallIndex].Function.Name != "generate_media" {
			return errors.New("Agent runtime media task is not attached to current call")
		}
	}
	if state.Decisions == nil || state.Events == nil {
		return errors.New("Agent runtime maps are missing")
	}
	if len(state.Events) > 4096 {
		return errors.New("Agent runtime event history is too large")
	}
	for index, event := range state.Events {
		if event.RunID != run.ID || event.Seq != index+1 || event.EventID == "" || event.Type == "" || event.Payload == nil || event.CreatedAt.IsZero() {
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
	if snapshot.CapabilitySetVersion != cloudAgentCapabilitySetVersion {
		return errors.New("Agent runtime capability contract is unsupported")
	}
	if snapshot.ReasoningMode != "off" && snapshot.ReasoningMode != "auto" && snapshot.ReasoningMode != "deep" {
		return errors.New("Agent runtime reasoning mode is invalid")
	}
	system, media, err := prompts.LoadAgentPolicies()
	if err != nil {
		return fmt.Errorf("load Agent runtime policies: %w", err)
	}
	if snapshot.SystemPolicyID != system.ID || snapshot.SystemPolicyVersion != system.Version || snapshot.MediaPolicyID != media.ID || snapshot.MediaPolicyVersion != media.Version {
		return errors.New("Agent runtime policy version is unsupported")
	}
	// An existing run keeps its admitted prompt and tool schema. Never resume it
	// against changed policies or capabilities under an unchanged version label.
	if snapshot.SystemPolicyHash != system.Hash || snapshot.MediaPolicyHash != media.Hash || snapshot.CapabilitySetHash != cloudAgentCapabilitySetHash() {
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
func cloudAgentSave(run *model.CloudAgentExecution, state *cloudAgentRuntime) error {
	if run == nil || state == nil {
		return errors.New("Agent runtime state is missing")
	}
	if compactCloudAgentContext(&state.Canonical) {
		state.SkillReads = nil
		state.ProfileReads = nil
	}
	if run.ID != "" {
		if err := validateCloudAgentRuntime(run, state); err != nil {
			return fmt.Errorf("%w: %v", errCloudAgentCheckpoint, err)
		}
	}
	raw, err := json.Marshal(state)
	if err != nil {
		return fmt.Errorf("%w: %v", errCloudAgentCheckpoint, err)
	}
	if len(raw) > 512<<10 {
		return fmt.Errorf("%w: Agent 状态超过 512KB 上限", errCloudAgentCheckpoint)
	}
	run.CanvasID, run.ActiveTaskID, run.MediaTaskID = state.Request.CanvasID, state.ActiveTaskID, state.MediaTaskID
	run.StateJSON = string(raw)
	return nil
}
func (s *Service) cloudAgentExecutionOutput(task *model.Task, initial cloudAgentState) (*CloudAgentRun, error) {
	run, err := s.repo.CloudAgent(task.UserID, task.ID)
	if err != nil {
		return nil, err
	}
	state, stateErr := cloudAgentDecode(run)
	if stateErr != nil {
		// A terminal failed run must remain readable even if its durable runtime
		// blob was damaged. Do not invent permissions or approval state; expose
		// only the identity available from the original task input.
		state = cloudAgentRuntime{Request: initial.Request, ParentID: initial.ParentID, CreativeAnchor: initial.CreativeAnchor, Skills: initial.Skills, Profile: initial.Profile, TaskIDs: []string{task.ID}, Events: []CloudAgentEvent{}}
	}
	out := agentRunOutput(task, initial)
	out.Status = run.Status
	out.Revision, out.CleanupPending, out.FailureMessage = run.Revision, run.CleanupPending, run.FailureMessage
	out.UpdatedAt = run.UpdatedAt
	out.Events = state.Events
	out.Approval = state.Approval
	if cloudAgentRunTerminal(run.Status) {
		out.Approval = nil
	}
	out.Step = state.Step
	if stateErr == nil && state.ActiveTaskID != "" && (run.Status == "running" || run.Status == "queued") {
		active, err := s.repo.TaskForUser(task.UserID, state.ActiveTaskID)
		if err != nil {
			return nil, err
		}
		if active.TextDraft != "" {
			out.ActiveMessage = map[string]string{"messageId": active.ID, "text": active.TextDraft}
		}
	}
	out.Skills = make([]cloudAgentSkill, 0, len(state.Skills))
	for _, skill := range state.Skills {
		skill.Instruction = ""
		skill.Files = nil
		out.Skills = append(out.Skills, skill)
	}
	orders, err := s.repo.BillingOrdersByTaskIDs(task.UserID, state.TaskIDs)
	if err != nil {
		return nil, err
	}
	for _, order := range orders {
		out.SpentCredits += float64(order.AmountMicrocredits) / float64(CreditScale)
	}
	return out, nil
}

// Runs one bounded transition at a time; no model HTTP call or approval wait holds a DB lock.
func (s *Service) advanceCloudAgentByID(userID, id string) error {
	// Do not decode the task input/runtime before checking for an existing
	// execution. A damaged runtime must be terminally recoverable, not
	// accidentally replaced by a fresh execution row.
	task, err := s.repo.TaskForUser(userID, id)
	if err != nil {
		return err
	}
	if task.Operation != cloudAgentOperation {
		return kernel.NotFound("Agent 运行不存在")
	}
	run, lookupErr := s.repo.CloudAgent(userID, id)
	if errors.Is(lookupErr, gorm.ErrRecordNotFound) {
		_, initial, taskErr := s.cloudAgentTask(userID, id)
		if taskErr != nil {
			return taskErr
		}
		if err := s.ensureCloudAgentExecution(task, initial); err != nil {
			return err
		}
		run, lookupErr = s.repo.CloudAgent(userID, id)
	}
	if lookupErr != nil {
		return lookupErr
	}
	return s.advanceCloudAgent(run)
}
func (s *Service) advanceCloudAgents() {
	s.agentSchedulerMu.Lock()
	defer s.agentSchedulerMu.Unlock()
	roots, err := s.repo.CloudAgentRoots()
	if err != nil {
		log.Printf("agent recovery: %v", err)
		return
	}
	for _, task := range roots {
		_, state, e := s.cloudAgentTask(task.UserID, task.ID)
		if e == nil {
			e = s.ensureCloudAgentExecution(&task, state)
		}
		if e != nil {
			log.Printf("agent recovery %s: %v", task.ID, e)
		}
	}
	runs, err := s.repo.ActiveCloudAgentsAfter(s.agentSchedulerCursor, 50)
	if err == nil && len(runs) == 0 && s.agentSchedulerCursor != "" {
		s.agentSchedulerCursor = ""
		runs, err = s.repo.ActiveCloudAgentsAfter("", 50)
	}
	if err != nil {
		log.Printf("agent scheduler: %v", err)
		return
	}
	for i := range runs {
		s.agentSchedulerCursor = runs[i].ID
		if s.terminateStuckCloudAgent(&runs[i]) {
			continue
		}
		err = s.advanceCloudAgent(&runs[i])
		if err == nil {
			s.clearCloudAgentSchedulerConflict(runs[i].ID)
			continue
		}
		if errors.Is(err, repository.ErrCreationConflict) {
			s.noteCloudAgentSchedulerConflict(runs[i].ID)
			continue
		}
		log.Printf("agent transition %s: %v", runs[i].ID, err)
	}
}

func (s *Service) advanceCloudAgent(run *model.CloudAgentExecution) (err error) {
	defer func() {
		if errors.Is(err, errCloudAgentCheckpoint) {
			err = s.terminateCloudAgent(run, "Agent 上下文或执行记录超过安全限制，本轮已停止；已有任务结果保留在任务中心")
		}
	}()
	if run.CleanupPending {
		return s.finishCloudAgentCleanup(context.Background(), run)
	}
	if run.Status != "running" && run.Status != "queued" {
		return nil
	}
	state, err := cloudAgentDecodeForExecution(run)
	if err != nil {
		var appErr *AppError
		if errors.As(err, &appErr) && appErr != nil {
			return s.terminateCloudAgent(run, appErr.Message)
		}
		return s.terminateCloudAgent(run, "Agent 运行状态损坏，本轮已停止")
	}
	if state.ActiveTaskID != "" {
		task, err := s.repo.TaskForUser(run.UserID, state.ActiveTaskID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return s.terminateCloudAgent(run, "Agent 模型任务已不存在，本轮已停止")
		}
		if err != nil {
			return err // Transient database failures must not terminate a live task.
		}
		if task.Status == model.TaskStatusQueued || task.Status == model.TaskStatusRunning {
			// 将已持久化的模型增量转成 Agent 事件；不拆分完整答案伪装成流式。
			if task.TextDraft != state.ActiveTextDraft {
				delta := ""
				eventType := "assistant_snapshot"
				payload := map[string]any{"messageId": task.ID, "text": task.TextDraft, "replace": true}
				if strings.HasPrefix(task.TextDraft, state.ActiveTextDraft) {
					delta = strings.TrimPrefix(task.TextDraft, state.ActiveTextDraft)
					if delta == "" {
						return nil
					}
					eventType = "assistant_delta"
					payload = map[string]any{"messageId": task.ID, "text": delta}
				}
				if err := s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
					state.event(run.ID, eventType, payload)
					state.ActiveTextDraft = task.TextDraft
					return cloudAgentSave(current, &state)
				}); err != nil {
					return err
				}
			}
			return nil
		}
		var result struct {
			Text      string           `json:"text"`
			Reasoning string           `json:"reasoning"`
			ToolCalls []cloudAgentCall `json:"toolCalls"`
			Legacy    []cloudAgentCall `json:"tool_calls"`
		}
		if task.Status == model.TaskStatusSucceeded {
			if err := json.Unmarshal([]byte(task.ResultJSON), &result); err != nil {
				return s.terminateCloudAgent(run, "模型任务结果损坏，本轮已停止")
			}
			calls := result.ToolCalls
			if len(calls) == 0 {
				calls = result.Legacy
			}
			if violation := cloudAgentOutputViolation(result.Text, len(calls)); violation != "" {
				return s.correctCloudAgentOutput(run, &state, violation)
			}
			if err := validateCloudAgentCalls(calls); err != nil {
				return s.correctCloudAgentOutput(run, &state, "工具调用无效或重复（callId 不能重复、参数必须是 JSON 对象）")
			}
			result.ToolCalls = calls
		}
		if task.Status != model.TaskStatusSucceeded && cloudAgentTruncatedToolArguments(task) {
			return s.correctCloudAgentTruncatedCalls(run, &state)
		}
		if cloudAgentEmptyModelOutput(task) && state.EmptyOutputNudged < cloudAgentMaxEmptyOutputNudges {
			return s.correctCloudAgentEmptyOutput(run, &state)
		}
		return s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
			if task.Status != model.TaskStatusSucceeded {
				current.Status = "failed"
				text, reason := cloudAgentModelFailure(task)
				current.FailureMessage = truncateRunes(text, 1000)
				cloudAgentDropInterjections(run.ID, "本轮已结束："+truncateRunes(text, 120), &state)
				state.event(run.ID, "run_failed", map[string]any{"text": text, "reason": reason, "taskId": task.ID})
				return cloudAgentSave(current, &state)
			}
			calls := result.ToolCalls
			if result.Reasoning != "" {
				state.event(run.ID, "reasoning_message", map[string]any{"messageId": task.ID + ":reasoning", "text": truncateRunes(result.Reasoning, 8000)})
			}
			if result.Text != "" {
				state.event(run.ID, "assistant_message", map[string]any{"messageId": task.ID, "text": result.Text})
				if len(calls) == 0 {
					state.Canonical.Messages = append(state.Canonical.Messages, map[string]any{"role": "assistant", "content": result.Text})
				}
			}
			state.ActiveTaskID = ""
			if len(calls) > 0 || strings.TrimSpace(result.Text) != "" {
				state.EmptyOutputNudged = 0
			}
			if len(calls) > 0 {
				state.ActionNudged = false
				state.Canonical.ToolChoice = "auto"
			}
			state.Calls = calls
			state.CallIndex = 0
			state.StepSnapshotHash = cloudAgentCaptureStepSnapshotHash(calls)
			if len(calls) > 0 {
				state.Canonical.Messages = append(state.Canonical.Messages, map[string]any{"role": "assistant", "content": result.Text, "tool_calls": calls})
			}
			if len(calls) == 0 {
				if len(state.PendingInterjections) > 0 {
					if !cloudAgentStepBudgetExhausted(&state) {
						return cloudAgentSave(current, &state)
					}
					cloudAgentDropInterjections(run.ID, "本轮已达到模型调用上限", &state)
				}
				if !cloudAgentStepBudgetExhausted(&state) {
					if pending := cloudAgentPendingPlanItems(state.Plan); len(pending) > 0 {
						state.Canonical.ToolChoice = "required"
						state.Canonical.Messages = append(state.Canonical.Messages, map[string]any{"role": "user", "content": cloudAgentPlanNudgeContent(&state, pending[0])})
						return cloudAgentSave(current, &state)
					}
				}
				current.Status = "completed"
			}
			return cloudAgentSave(current, &state)
		})
	}
	if state.CallIndex < len(state.Calls) {
		return s.advanceCloudAgentTool(run, &state)
	}
	if compactCloudAgentContext(&state.Canonical) {
		// Evicted read bodies must be obtainable again after compaction.
		state.SkillReads = nil
		state.ProfileReads = nil
	}
	if stepLimit := cloudAgentStepLimit(state.Request); stepLimit > 0 && state.Step >= stepLimit {
		return s.failCloudAgent(run, &state, fmt.Sprintf("达到 %d 次模型调用上限，本轮已停止", stepLimit))
	}
	cloudAgentDrainInterjections(run.ID, &state)
	canonical := cloudAgentCanonicalWithPlan(&state)
	s.attachCloudAgentLessons(&canonical, run.UserID, cloudAgentLessonTaskText(&state))
	input := map[string]any{"mode": "text", "prompt": state.Request.Prompt, "agentRequests": map[string]any{"canonical": canonical}, "config": map[string]any{"channelId": state.Request.ChannelID, "channelModelKey": state.Request.ChannelModelKey, "model": firstNonEmpty(state.Request.ChannelModelKey, state.Request.Model)}, "textOptions": map[string]any{"stream": true, "thinking": cloudAgentReasoningEnabled(state.Policy.ReasoningMode)}}
	raw, _ := json.Marshal(canonical)
	if len(raw) > 192<<10 {
		return s.failCloudAgent(run, &state, "模型上下文超过 192KB 上限")
	}
	req := CreateTaskRequest{ProjectID: state.Request.CanvasID, Type: "canvas_text", Operation: "cloud_agent_step", Prompt: state.Request.Prompt, Model: state.Request.Model, LogicalModelID: state.Request.LogicalModelID, Input: input}
	return s.enqueueCloudAgentTask(run, &state, req, nil)
}

func compactCloudAgentContext(request *canonicalAgentRequest) bool {
	if request == nil {
		return false
	}
	raw, err := json.Marshal(request)
	if err != nil || (len(raw) < 96<<10 && len(request.Messages) <= 24) {
		return false
	}
	// Retain the latest complete tool turn. Never remove call/result envelopes,
	// user instructions, call arguments or write receipts to fabricate a summary.
	cut := len(request.Messages) - 1
	for cut > 0 && stringField(request.Messages[cut], "role") == "tool" {
		cut--
	}
	changed := false
	for _, message := range request.Messages[:max(0, cut)] {
		if stringField(message, "role") != "tool" {
			continue
		}
		var result map[string]any
		if json.Unmarshal([]byte(stringField(message, "content")), &result) != nil || result["contextCompacted"] == true {
			continue
		}
		// Only omit re-readable bodies. Preserve IDs, errors, generation status,
		// approvals and all other structured facts verbatim.
		omitted := false
		for _, key := range []string{"content", "nodes"} {
			if _, exists := result[key]; exists {
				delete(result, key)
				omitted = true
			}
		}
		if !omitted {
			continue
		}
		result["contextCompacted"] = true
		result["guidance"] = "历史读取正文已移出模型上下文；需要时重新读取。保留的历史状态不是当前状态，也不是执行授权，不得据此重复提交生成。"
		body, err := json.Marshal(result)
		if err != nil || len(body) >= len(stringField(message, "content")) {
			continue
		}
		message["content"] = string(body)
		changed = true
	}
	return changed
}

func validateCloudAgentCalls(calls []cloudAgentCall) error {
	seen := make(map[string]bool, len(calls))
	for _, call := range calls {
		if err := validateCloudAgentID(call.ID, "工具调用 ID", 160); err != nil || seen[call.ID] || call.Function.Name == "" || len(call.Function.Name) > 80 || !utf8.ValidString(call.Function.Name) {
			return errors.New("invalid Agent tool call")
		}
		if err := decodeCloudAgentJSONObject(call.Function.Arguments, &map[string]any{}); err != nil || len(call.Function.Arguments) > 32000 {
			return errors.New("invalid Agent tool arguments")
		}
		seen[call.ID] = true
	}
	return nil
}

func (s *Service) terminateCloudAgent(run *model.CloudAgentExecution, message string) error {
	if run == nil {
		return errors.New(message)
	}
	if err := s.repo.MarkCloudAgentFailed(run.UserID, run.ID, run.Revision, message); err != nil && !errors.Is(err, repository.ErrCreationConflict) {
		return err
	}
	return nil
}

func (s *Service) failCloudAgent(run *model.CloudAgentExecution, state *cloudAgentRuntime, message string) error {
	return s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		current.Status = "failed"
		current.FailureMessage = truncateRunes(message, 1000)
		cloudAgentDropInterjections(run.ID, "本轮已结束："+truncateRunes(message, 120), state)
		state.event(run.ID, "run_failed", map[string]any{"text": message})
		return cloudAgentSave(current, state)
	})
}

// failCloudAgentAdmission records deterministic tool admission failures in the
// same checkpoint transaction. Transient repository errors must still escape
// the caller so the scheduler can retry them.
func failCloudAgentAdmission(current *model.CloudAgentExecution, state *cloudAgentRuntime, runID string, err error) error {
	message := cloudAgentSafeToolError(err)
	current.Status = "failed"
	current.FailureMessage = message
	state.Approval = nil
	state.event(runID, "run_failed", map[string]any{
		"text":   message,
		"reason": "tool_admission_failed",
	})
	return cloudAgentSave(current, state)
}

// Only expose known failure categories; raw provider errors can contain URLs and credentials.
func cloudAgentModelFailure(task *model.Task) (string, string) {
	detail, reason := "模型任务未成功", "model_task_failed"
	raw := strings.ToLower(task.Error)
	switch {
	case strings.Contains(raw, "connection reset by peer"):
		detail, reason = "模型连接被对端或中间网络设备重置", "model_connection_reset"
	case strings.Contains(raw, "timeout"), strings.Contains(raw, "deadline exceeded"):
		detail, reason = "模型请求超时", "model_request_timeout"
	case strings.Contains(raw, "connection refused"):
		detail, reason = "无法连接模型服务（连接被拒绝）", "model_connection_refused"
	}
	return detail + "；本轮已停止。请在任务中心检查模型任务 " + task.ID, reason
}

func cloudAgentSafeToolError(err error) string {
	if err == nil {
		return ""
	}
	var appErr *AppError
	if errors.As(err, &appErr) && appErr != nil {
		message := strings.TrimSpace(appErr.Message)
		if cloudAgentSafeUserMessage(message) {
			return message
		}
	}
	return "工具执行失败，请检查输入或稍后重试"
}

func cloudAgentSafeUserMessage(message string) bool {
	if message == "" || !utf8.ValidString(message) || strings.ContainsAny(message, "\x00\r\n") || utf8.RuneCountInString(message) > 240 {
		return false
	}
	lower := strings.ToLower(message)
	for _, marker := range []string{
		"http://", "https://", "ftp://", "file://", "authorization", "cookie", "secret", "token", "api_key", "apikey", "x-api-key",
		"/var/", "/tmp/", "\\", "stack trace", "traceback", " at ", "sql:", "sqlite", "postgres",
	} {
		if strings.Contains(lower, marker) {
			return false
		}
	}
	return true
}

// cloudAgentSafeMediaTaskError preserves a short, user-facing task diagnostic
// while refusing provider details that commonly contain URLs, credentials, or
// internal request metadata. Task.Error is not a safe presentation field.
func cloudAgentSafeMediaTaskError(task *model.Task) string {
	if task == nil {
		return "媒体任务未成功"
	}
	detail := strings.TrimSpace(task.Error)
	if detail == "" || !utf8.ValidString(detail) || strings.ContainsAny(detail, "\r\n\x00") {
		return "媒体任务未成功"
	}
	lower := strings.ToLower(detail)
	for _, marker := range []string{
		"http://", "https://", "ftp://", "authorization", "cookie", "secret", "token", "api_key", "apikey", "x-api-key",
	} {
		if strings.Contains(lower, marker) {
			return "媒体任务未成功"
		}
	}
	runes := []rune(detail)
	if len(runes) > 240 {
		detail = string(runes[:240]) + "…"
	}
	return detail
}

func cloudAgentToolResult(runID string, state *cloudAgentRuntime, call cloudAgentCall, result any, err error) {
	payload := map[string]any{"toolName": call.Function.Name, "callId": call.ID, "arguments": call.Function.Arguments}
	if call.Function.Name == "skill_read_file" {
		var args struct {
			SkillID string `json:"skillId"`
			Path    string `json:"path"`
		}
		if json.Unmarshal([]byte(call.Function.Arguments), &args) == nil {
			payload["skillId"], payload["path"] = args.SkillID, args.Path
			for _, skill := range state.Skills {
				if skill.ID == args.SkillID {
					payload["skillName"] = skill.Name
					break
				}
			}
		}
	}
	kind := "tool_completed"
	if err != nil {
		detail, ok := result.(map[string]any)
		if !ok {
			detail = map[string]any{}
		}
		message := cloudAgentSafeToolError(err)
		detail["error"] = message
		result = detail
		kind = "tool_failed"
		payload["text"] = message
	} else {
		payload["text"] = "工具执行成功"
	}
	raw, _ := json.Marshal(result)
	payload["result"] = result
	if call.Function.Name == "skill_read_file" && err == nil {
		// SSE/UI needs the read receipt, not another durable copy of skill text.
		if fields, ok := result.(map[string]any); ok {
			receipt := make(map[string]any, len(fields))
			for key, value := range fields {
				if key != "content" {
					receipt[key] = value
				}
			}
			payload["result"] = receipt
		}
	}
	state.event(runID, kind, payload)
	state.Canonical.Messages = append(state.Canonical.Messages, map[string]any{"role": "tool", "tool_call_id": call.ID, "content": string(raw)})
	state.CallIndex++
	state.Approval = nil
}
func (s *Service) advanceCloudAgentTool(run *model.CloudAgentExecution, state *cloudAgentRuntime) error {
	if state.CallIndex < 0 || state.CallIndex >= len(state.Calls) {
		return s.failCloudAgent(run, state, "Agent 工具调用状态无效，本轮已停止")
	}
	call := state.Calls[state.CallIndex]
	call = s.cloudAgentRefreshStepSnapshotHash(run, state, call)
	state.Calls[state.CallIndex] = call
	if state.Approval != nil && state.Approval.Decision == "" {
		return nil
	}
	if state.Approval != nil && state.Approval.Decision != "" && state.Approval.CallHash != "" && state.Approval.CallHash != cloudAgentApprovalCallHash(call) {
		return s.terminateCloudAgent(run, "审批内容与待执行操作不一致，本轮已停止")
	}
	allowed := cloudAgentToolAllowed(state.Request, call.Function.Name)
	if allowed && cloudAgentWrite(call.Function.Name) && (state.Request.PermissionMode == "request_approval" || call.Function.Name == "generate_media") && state.Approval == nil {
		var plan *cloudAgentMediaPlan
		var modelName string
		policy, err := s.RuntimePolicy()
		if err != nil {
			return s.terminateCloudAgent(run, "Agent 运行策略不可用，本轮已停止")
		}
		if call.Function.Name == "generate_media" {
			req, prepared, err := s.prepareCloudAgentMedia(run, state, call)
			if err != nil {
				return s.cloudAgentMediaError(run, state, "admission", false, false, err)
			}
			// Dry admission validates the selected model and prompt limits without a task or charge.
			req.creationPrepare = &creationTaskPreparation{}
			if _, err := s.CreateTask(run.UserID, req); err != nil {
				return s.cloudAgentMediaError(run, state, "admission", false, false, err)
			}
			plan = prepared
			modelName, err = s.cloudAgentMediaModelName(plan.Args)
			if err != nil {
				return s.cloudAgentMediaError(run, state, "admission", false, false, err)
			}
		}
		s.storageMu.Lock()
		defer s.storageMu.Unlock()
		return s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
			var preview cloudAgentApprovalPreview
			if plan != nil {
				if err := createCloudAgentMediaNode(repo, run.UserID, state.Request.CanvasID, plan, nil, policy, cloudAgentCanvasEventRecorder(run.ID, state)); err != nil {
					return err
				}
				canvas, err := repo.CanvasProjectForUser(run.UserID, state.Request.CanvasID)
				if err != nil {
					return err
				}
				doc, err := creationDocument(canvas.PayloadJSON)
				if err != nil {
					return err
				}
				plan.Args.SnapshotHash = cloudAgentMediaContentHash(doc)
				raw, err := json.Marshal(plan.Args)
				if err != nil {
					return err
				}
				call.Function.Arguments = string(raw)
				state.Calls[state.CallIndex] = call
				preview = cloudAgentMediaApprovalPreview(plan, modelName)
			} else {
				var mutationErr error
				switch call.Function.Name {
				case "canvas_create_storyboard":
					storyboardPlan, err := prepareCloudAgentStoryboardCreate(repo, run.UserID, state.Request.CanvasID, call)
					mutationErr = err
					if err == nil {
						preview = storyboardPlan.Preview
					}
				case "canvas_edit_storyboard":
					storyboardPlan, err := prepareCloudAgentStoryboardEdit(repo, run.UserID, state.Request.CanvasID, call)
					mutationErr = err
					if err == nil {
						preview = storyboardPlan.Preview
					}
				case "canvas_edit_batch_table":
					batchPlan, err := prepareCloudAgentBatchTableEdit(repo, run.UserID, state.Request.CanvasID, call)
					mutationErr = err
					if err == nil {
						preview = batchPlan.Preview
					}
				default:
					canvasPlan, err := prepareCloudAgentCanvasMutation(repo, run.UserID, state.Request.CanvasID, call)
					mutationErr = err
					if err == nil {
						preview = canvasPlan.Preview
					}
				}
				if mutationErr != nil {
					var argumentErr *cloudAgentArgumentError
					if errors.As(mutationErr, &argumentErr) {
						cloudAgentToolResult(run.ID, state, call, nil, mutationErr)
						return cloudAgentSave(current, state)
					}
					var appErr *AppError
					if errors.As(mutationErr, &appErr) && appErr != nil {
						return failCloudAgentAdmission(current, state, run.ID, mutationErr)
					}
					return mutationErr
				}
			}
			state.Approval = &cloudAgentApproval{ID: fmt.Sprintf("%s-%d-%d", run.ID, state.Step, state.CallIndex), Call: call, CallHash: cloudAgentApprovalCallHash(call), Preview: preview, ModelName: modelName}
			current.Status = "waiting_approval"
			state.event(run.ID, "approval_requested", map[string]any{"approvalId": state.Approval.ID, "toolName": call.Function.Name, "modelName": modelName, "arguments": json.RawMessage(call.Function.Arguments), "preview": preview, "text": preview.Description})
			return cloudAgentSave(current, state)
		})
	}
	if allowed && call.Function.Name == "plan_update" && cloudAgentPlanRequiresFirstApproval(state, call) {
		if preview, ok := cloudAgentPlanApprovalPreview(call); ok {
			return s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
				approvalID := fmt.Sprintf("%s-%d-%d", run.ID, state.Step, state.CallIndex)
				state.Approval = &cloudAgentApproval{ID: approvalID, Call: call, CallHash: cloudAgentApprovalCallHash(call), Preview: preview}
				current.Status = "waiting_approval"
				state.event(run.ID, "approval_requested", map[string]any{"approvalId": approvalID, "toolName": call.Function.Name, "arguments": json.RawMessage(call.Function.Arguments), "preview": preview, "text": preview.Description})
				return cloudAgentSave(current, state)
			})
		}
	}
	if allowed && call.Function.Name == "generate_media" && state.Approval != nil && state.Approval.Decision == "approve" {
		return s.advanceCloudAgentMedia(run, state, call)
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		return s.terminateCloudAgent(run, "Agent 运行策略不可用，本轮已停止")
	}
	var modelList any
	var modelListErr error
	if allowed && call.Function.Name == "model_list" {
		intent, e := s.cloudAgentModelIntent(run.UserID, state.Request.CanvasID, call.Function.Arguments)
		modelListErr = e
		if e == nil {
			modelList, modelListErr = s.cloudAgentModelList(intent)
		}
	}
	// Skill reads use the domain repository and filesystem, not the checkpoint
	// transaction's connection. Read first to avoid nesting DB reads on SQLite.
	var skillResult any
	var skillErr error
	if allowed && call.Function.Name == "skill_read_file" {
		skillResult, skillErr = cloudAgentReadTool(s.repo, run.UserID, state, call, s)
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	return s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
		var result any
		var toolErr error
		switch {
		case !allowed:
			toolErr = BadAuthRequest("工具未获本轮权限授权")
		case call.Function.Name == "canvas_apply_ops":
			result, toolErr = applyCloudAgentCanvas(repo, run.UserID, state.Request.CanvasID, call, policy, cloudAgentCanvasEventRecorder(run.ID, state))
		case call.Function.Name == "canvas_create_storyboard", call.Function.Name == "canvas_edit_storyboard":
			result, toolErr = applyCloudAgentStoryboardMutation(repo, run.UserID, state.Request.CanvasID, call, policy, cloudAgentCanvasEventRecorder(run.ID, state))
		case call.Function.Name == "canvas_edit_batch_table":
			result, toolErr = applyCloudAgentBatchTableMutation(repo, run.UserID, state.Request.CanvasID, call, policy, cloudAgentCanvasEventRecorder(run.ID, state))
		case call.Function.Name == "model_list":
			result, toolErr = modelList, modelListErr
		case call.Function.Name == "skill_read_file":
			result, toolErr = skillResult, skillErr
		default:
			result, toolErr = cloudAgentReadTool(repo, run.UserID, state, call)
		}
		if call.Function.Name == "plan_update" && toolErr == nil {
			state.event(run.ID, "plan_updated", map[string]any{"items": state.Plan, "pendingTitles": cloudAgentPendingPlanItems(state.Plan)})
		}
		if call.Function.Name == "ask_user" && toolErr == nil {
			payload, _ := result.(map[string]any)
			state.event(run.ID, "user_question", payload)
			cloudAgentToolResult(run.ID, state, call, result, nil)
			skipRemainingCloudAgentCalls(run.ID, state)
			current.Status = "completed"
			return cloudAgentSave(current, state)
		}
		cloudAgentToolResult(run.ID, state, call, result, toolErr)
		return cloudAgentSave(current, state)
	})
}

func (s *Service) enqueueCloudAgentTask(run *model.CloudAgentExecution, state *cloudAgentRuntime, req CreateTaskRequest, media *cloudAgentMediaPlan) error {
	orders, err := s.repo.BillingOrdersByTaskIDs(run.UserID, state.TaskIDs)
	if err != nil {
		return err
	}
	remaining := int64(math.Floor(state.Request.Budget.MaxCredits * float64(CreditScale)))
	for _, order := range orders {
		remaining -= order.AmountMicrocredits
	}
	if remaining < 0 {
		return s.failCloudAgent(run, state, "Agent 累计预算已耗尽")
	}
	prepare := &creationTaskPreparation{}
	req.admission = &taskAdmission{ID: cloudAgentID(run.UserID, fmt.Sprintf("%s:task:%d", run.ID, len(state.TaskIDs))), MaxCharge: remaining}
	req.creationPrepare = prepare
	task, err := s.CreateTask(run.UserID, req)
	if err != nil {
		if media != nil {
			return s.cloudAgentMediaError(run, state, "admission", false, false, err)
		}
		return s.failCloudAgent(run, state, cloudAgentSafeToolError(err))
	}
	var input map[string]any
	if err = json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		if media != nil {
			return s.cloudAgentMediaError(run, state, "admission", false, false, err)
		}
		return err
	}
	if media != nil {
		requested, _ := req.Input["config"].(map[string]any)
		resolved, _ := input["config"].(map[string]any)
		if err := validateCloudAgentResolvedMediaOptions(requested, resolved); err != nil {
			return s.cloudAgentMediaError(run, state, "admission", false, false, err)
		}
	}
	if err = s.protectTaskSecrets(input); err != nil {
		if media != nil {
			return s.cloudAgentMediaError(run, state, "admission", false, false, err)
		}
		return err
	}
	raw, err := json.Marshal(input)
	if err != nil {
		if media != nil {
			return s.cloudAgentMediaError(run, state, "admission", false, false, err)
		}
		return err
	}
	task.InputJSON = string(raw)
	if prepare.Order != nil {
		task.BillingOrderID = prepare.Order.ID
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		if media != nil {
			return s.cloudAgentMediaError(run, state, "admission", false, false, err)
		}
		return err
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	err = s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
		if media != nil {
			if err := createCloudAgentMediaNode(repo, run.UserID, state.Request.CanvasID, media, task, policy, cloudAgentCanvasEventRecorder(run.ID, state)); err != nil {
				return err
			}
		}
		if err := createTaskWithStorageQuotaRepository(repo, task, prepare.Order, policy); err != nil {
			return err
		}
		state.TaskIDs = append(state.TaskIDs, task.ID)
		if media != nil {
			state.MediaTaskID = task.ID
			state.Generations++
			state.VideoSeconds += media.Args.Duration
			state.event(run.ID, "generation_task_created", map[string]any{"toolName": "generate_media", "taskId": task.ID, "nodeId": media.Args.NodeID, "title": media.Args.Title, "mode": media.Args.Mode, "canvasId": state.Request.CanvasID, "referenceNodeIds": media.Args.ReferenceNodeIDs, "text": "媒体节点与引用连线已创建，生成任务已提交"})
		} else {
			state.ActiveTaskID = task.ID
			state.Step++
		}
		return cloudAgentSave(current, state)
	})
	if err != nil && media != nil {
		// Rollback may have happened after checkpoint edits. Reload before recording
		// a tool failure; never turn a stale worker revision into a second result.
		latest, readErr := s.repo.CloudAgent(run.UserID, run.ID)
		if readErr != nil || latest.Revision != run.Revision {
			return err
		}
		fresh, decodeErr := cloudAgentDecode(latest)
		if decodeErr != nil {
			return decodeErr
		}
		return s.cloudAgentMediaError(latest, &fresh, "admission", false, false, err)
	}
	return err
}

func (s *Service) cloudAgentMediaError(run *model.CloudAgentExecution, state *cloudAgentRuntime, phase string, submitted, terminal bool, err error) error {
	return s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		if state.CallIndex < 0 || state.CallIndex >= len(state.Calls) {
			current.Status = "failed"
			state.event(run.ID, "run_failed", map[string]any{"text": "Agent 媒体调用状态无效，本轮已停止"})
			return cloudAgentSave(current, state)
		}
		cloudAgentToolResult(run.ID, state, state.Calls[state.CallIndex], map[string]any{"phase": phase, "taskSubmitted": submitted}, err)
		if submitted {
			state.MediaTaskID = ""
		}
		if terminal {
			current.Status = "failed"
			state.event(run.ID, "run_failed", map[string]any{"text": "媒体任务已提交，但结果处理失败；任务不会自动重试"})
		}
		return cloudAgentSave(current, state)
	})
}

func (s *Service) advanceCloudAgentMedia(run *model.CloudAgentExecution, state *cloudAgentRuntime, call cloudAgentCall) error {
	if state.MediaTaskID != "" {
		task, err := s.repo.TaskForUser(run.UserID, state.MediaTaskID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return s.cloudAgentMediaError(run, state, "completion", true, true, BadAuthRequest("媒体任务不存在或已失去归属，结果未回写画布"))
		}
		if err != nil {
			return err
		}
		if task.Status == model.TaskStatusQueued || task.Status == model.TaskStatusRunning {
			return nil
		}
		policy, err := s.RuntimePolicy()
		if err != nil {
			return err
		}
		s.storageMu.Lock()
		defer s.storageMu.Unlock()
		return s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
			before, readErr := repo.CanvasProjectForUser(run.UserID, state.Request.CanvasID)
			nodeID, writeErr := completeCloudAgentMediaNode(repo, run.UserID, state.Request.CanvasID, task, policy)
			if writeErr != nil {
				var appErr *AppError
				if !errors.Is(writeErr, gorm.ErrRecordNotFound) && !(errors.As(writeErr, &appErr) && (appErr.Status == 400 || appErr.Status == 409)) {
					return writeErr // Retry persistence, never resubmit the billed generation.
				}
			}
			// A deleted canvas/node must still checkpoint the tool failure. Only
			// a matched node can have changed and require an atomic canvas delta.
			if nodeID != "" {
				if readErr != nil {
					return readErr
				}
				if err := emitCloudAgentCanvasChange(repo, run.ID, state, cloudAgentMutationInput{UserID: run.UserID, CanvasID: state.Request.CanvasID, BeforeJSON: before.PayloadJSON, Operation: "generate_media_complete"}); err != nil {
					return err
				}
			}
			result := map[string]any{"phase": "completion", "taskSubmitted": true, "taskId": task.ID, "nodeId": nodeID, "status": task.Status}
			var toolErr error
			if task.Status != model.TaskStatusSucceeded {
				toolErr = BadAuthRequest("媒体任务" + string(task.Status) + "：" + cloudAgentSafeMediaTaskError(task) + "；请在任务中心查看任务 " + task.ID + "，不会自动重试收费生成")
				result["summary"] = "媒体任务未成功；结果保留在任务中心"
			}
			if writeErr != nil {
				toolErr = BadAuthRequest("生成结果未能安全回写画布；任务结果保留在任务中心，不会自动重试收费生成")
				result["summary"] = "未回写画布；任务结果保留在任务中心"
			}
			if task.Status == model.TaskStatusSucceeded && writeErr == nil {
				result["summary"] = "生成结果已回写画布节点"
			}
			// A billed generation failure is a tool result, not a dead run: the
			// model must still be able to tell the user what happened. Only a
			// canvas write that cannot land is terminal for the whole turn.
			if writeErr != nil {
				if current.Status != "cancelled" {
					current.Status = "failed"
				}
				state.event(run.ID, "run_failed", map[string]any{"text": "媒体任务已提交，但结果无法回写画布；任务不会自动重试", "taskId": task.ID})
			}
			cloudAgentToolResult(run.ID, state, call, result, toolErr)
			state.MediaTaskID = ""
			return cloudAgentSave(current, state)
		})
	}
	req, plan, err := s.prepareCloudAgentMedia(run, state, call)
	if err != nil {
		return s.cloudAgentMediaError(run, state, "admission", false, false, err)
	}
	return s.enqueueCloudAgentTask(run, state, req, plan)
}

func (s *Service) DecideCloudAgentApproval(userID, id, approvalID, decision, reason string, mediaSettings ...*CloudAgentMediaSettings) error {
	var settings *CloudAgentMediaSettings
	if len(mediaSettings) > 1 {
		return BadAuthRequest("只能提交一组生成参数")
	}
	if len(mediaSettings) == 1 {
		settings = mediaSettings[0]
	}
	if settings != nil && decision != "approve" {
		return BadAuthRequest("仅批准生成时可修改生成参数")
	}
	if decision != "approve" && decision != "reject" {
		return BadAuthRequest("无效审批决定")
	}
	if len(reason) > 2000 {
		return BadAuthRequest("审批理由过长")
	}
	if _, _, err := s.cloudAgentTask(userID, id); err != nil {
		return err
	}
	run, err := s.repo.CloudAgent(userID, id)
	if err != nil {
		return err
	}
	state, err := cloudAgentDecodeForExecution(run)
	if err != nil {
		return err
	}
	if previous, ok := state.Decisions[approvalID]; ok {
		if previous == decision && (settings == nil || state.DecisionSettings[approvalID] == creationHash(settings)) {
			return nil
		}
		return creationConflict("该审批已有不同决定")
	}
	if run.Status != "waiting_approval" || state.Approval == nil || state.Approval.ID != approvalID {
		return creationConflict("审批不存在或已过期")
	}
	if settings != nil {
		if err := s.updateCloudAgentMediaApproval(run, &state, *settings); err != nil {
			return err
		}
	}
	return s.repo.MutateCloudAgent(userID, id, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		state.Approval.Decision = decision
		state.Approval.Reason = reason
		state.Decisions[approvalID] = decision
		if settings != nil {
			if state.DecisionSettings == nil {
				state.DecisionSettings = map[string]string{}
			}
			state.DecisionSettings[approvalID] = creationHash(settings)
		}
		if decision == "reject" {
			// Rejection is a user control-plane decision, not a failed tool
			// invocation. Make it terminal before the scheduler can advance the
			// pending call; no tool result, canvas mutation, generation task or
			// follow-up model request may be produced from this decision.
			current.Status = "rejected"
			current.FailureMessage = ""
			state.Approval = nil
			state.event(id, "approval_decided", map[string]any{
				"approvalId": approvalID,
				"decision":   decision,
				"reason":     reason,
				"text":       "已拒绝本次操作，未写入画布。你可以告诉 Agent 修改方向后重新申请。",
			})
			return cloudAgentSave(current, &state)
		}
		current.Status = "running"
		state.event(id, "approval_decided", map[string]any{"approvalId": approvalID, "decision": decision, "arguments": json.RawMessage(state.Approval.Call.Function.Arguments), "preview": state.Approval.Preview, "modelName": state.Approval.ModelName})
		return cloudAgentSave(current, &state)
	})
}
func (s *Service) CancelCloudAgent(ctx context.Context, userID, id string) error {
	// Cancellation is a control-plane operation. It must remain available even
	// when the user-facing runtime blob is damaged, so authenticate/authorize
	// from the task row first instead of calling CloudAgentRun up front.
	task, err := s.repo.TaskForUser(userID, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return kernel.NotFound("Agent 运行不存在")
		}
		return err
	}
	if task.Operation != cloudAgentOperation {
		return kernel.NotFound("Agent 运行不存在")
	}
	run, err := s.repo.CloudAgent(userID, id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		// Legacy root tasks may not have an execution row yet. The normal read
		// path validates the signed/deterministic task identity before creating it.
		if _, err = s.CloudAgentRun(userID, id); err != nil {
			return err
		}
		run, err = s.repo.CloudAgent(userID, id)
	}
	if err != nil {
		return err
	}
	if run.Status == "completed" || (run.Status == "failed" && !run.CleanupPending) {
		return nil
	}
	if run.Status != "failed" {
		// Persist intent independently of the transcript. Retrying also repairs
		// legacy cancelled rows that crashed before cancelling their children.
		state, decodeErr := cloudAgentDecode(run)
		err = s.repo.MutateCloudAgent(userID, id, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
			current.Status = "cancelled"
			current.CleanupPending = true
			if decodeErr == nil {
				current.CanvasID, current.ActiveTaskID, current.MediaTaskID = state.Request.CanvasID, state.ActiveTaskID, state.MediaTaskID
			}
			return nil
		})
		if err != nil {
			return err
		}
	}
	latest, err := s.repo.CloudAgent(userID, id)
	if err != nil {
		return err
	}
	return s.finishCloudAgentCleanup(ctx, latest)
}
