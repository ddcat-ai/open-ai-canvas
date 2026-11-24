package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

const browserAgentProtocol = 1
const browserAgentLease = 45 * time.Second

// Preparation can take longer than a heartbeat on a remote database. Only lease
// renewals may be merged; ownership, executor fences and all business state must
// still match the snapshot from before preparation.
func browserAgentOnlyLeaseChanged(before, current *model.CloudAgentExecution) bool {
	left, right := *before, *current
	left.Revision, right.Revision = 0, 0
	left.UpdatedAt, right.UpdatedAt = time.Time{}, time.Time{}
	left.StateJSON, right.StateJSON = "", ""
	if !reflect.DeepEqual(left, right) {
		return false
	}
	a, err := cloudAgentDecode(before)
	if err != nil {
		return false
	}
	b, err := cloudAgentDecode(current)
	if err != nil || a.Request.ExecutionMode != "browser" || a.Browser == nil || b.Browser == nil {
		return false
	}
	if b.Browser.LeaseUntil.Before(a.Browser.LeaseUntil) {
		return false
	}
	a.Browser.LeaseUntil, b.Browser.LeaseUntil = time.Time{}, time.Time{}
	if a.Browser.Pending != nil && b.Browser.Pending != nil {
		if b.Browser.Pending.ExecuteUntil.Before(a.Browser.Pending.ExecuteUntil) {
			return false
		}
		a.Browser.Pending.ExecuteUntil, b.Browser.Pending.ExecuteUntil = time.Time{}, time.Time{}
	}
	return reflect.DeepEqual(a, b)
}

func (s *Service) mutatePreparedCloudAgent(run *model.CloudAgentExecution, state *cloudAgentRuntime, fn func(*model.CloudAgentExecution, *repository.Repository) error) error {
	if state.Request.ExecutionMode != "browser" {
		return s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, fn)
	}
	return s.repo.MutateCloudAgentChecked(run.UserID, run.ID, func(current *model.CloudAgentExecution) error {
		if !browserAgentOnlyLeaseChanged(run, current) {
			return repository.ErrCreationConflict
		}
		return nil
	}, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
		latest, err := cloudAgentDecode(current)
		if err != nil {
			return err
		}
		state.Browser.LeaseUntil = latest.Browser.LeaseUntil
		if state.Browser.Pending != nil && latest.Browser.Pending != nil {
			state.Browser.Pending.ExecuteUntil = latest.Browser.Pending.ExecuteUntil
		}
		return fn(current, repo)
	})
}

func (s *Service) BrowserAgentRuns(userID string) ([]string, error) {
	if err := s.RequireSkillAccess(userID); err != nil {
		return nil, err
	}
	runs, err := s.repo.UserActiveAgentRuns(userID)
	if err != nil {
		return nil, err
	}
	ids := []string{}
	for _, run := range runs {
		var state struct {
			Request CloudAgentRequest `json:"request"`
		}
		if json.Unmarshal([]byte(run.StateJSON), &state) == nil && state.Request.ExecutionMode == "browser" {
			ids = append(ids, run.ID)
		}
	}
	return ids, nil
}

type browserAgentRuntime struct {
	Owner       string            `json:"owner"`
	Epoch       int64             `json:"epoch"`
	LeaseUntil  time.Time         `json:"leaseUntil"`
	Sequence    int64             `json:"sequence"`
	FinalAnswer bool              `json:"finalAnswer"`
	Pending     *browserAgentStep `json:"pending,omitempty"`
}

type browserAgentStep struct {
	ID           string         `json:"id"`
	Kind         string         `json:"kind"`
	Call         cloudAgentCall `json:"call,omitempty"`
	Settled      bool           `json:"settled"`
	Attempts     int            `json:"attempts"`
	Executor     string         `json:"executor"`
	ExecuteUntil time.Time      `json:"executeUntil"`
}

type BrowserAgentControl struct {
	ProtocolVersion int    `json:"protocolVersion"`
	Owner           string `json:"owner"`
	Epoch           int64  `json:"epoch"`
	StepID          string `json:"stepId,omitempty"`
}

type BrowserAgentAction struct {
	Kind   string `json:"kind"`
	StepID string `json:"stepId,omitempty"`
}

type BrowserAgentState struct {
	ProtocolVersion   int                `json:"runtimeProtocolVersion"`
	CheckpointVersion int                `json:"checkpointVersion"`
	Epoch             int64              `json:"epoch"`
	LeaseUntil        time.Time          `json:"leaseUntil"`
	Connection        string             `json:"runtimeConnection"`
	Status            string             `json:"status"`
	Revision          int64              `json:"revision"`
	NextAction        BrowserAgentAction `json:"nextAction"`
}

func browserAgentNext(s *Service, run *model.CloudAgentExecution, state *cloudAgentRuntime) BrowserAgentAction {
	action := BrowserAgentAction{Kind: "done"}
	if cloudAgentRunTerminal(run.Status) {
		return action
	}
	if state.Browser != nil && state.Browser.Pending != nil {
		return BrowserAgentAction{Kind: "wait_task"}
	}
	if run.Status == "waiting_approval" || state.Approval != nil {
		return BrowserAgentAction{Kind: "wait_approval"}
	}
	if run.Status == "waiting_user" {
		return BrowserAgentAction{Kind: "wait_user"}
	}
	if state.MediaTaskID != "" || cloudAgentMediaBatchActive(state) {
		return BrowserAgentAction{Kind: "wait_task"}
	}
	action.Kind = "model"
	if state.Browser != nil && state.Browser.FinalAnswer && state.PiResumePrompt == "" {
		action.Kind = "settle"
	}
	if state.CallIndex >= 0 && state.CallIndex < len(state.Calls) {
		action.Kind = "tool"
	} else if state.ActiveTaskID == "" && action.Kind != "settle" {
		budget := s.cloudAgentContextBudgetForRequest(state.Request)
		tokens, _ := cloudAgentRequestEstimatedTokens(&state.Canonical)
		_, configured := cloudAgentCompactionReadingFor(budget, tokens)
		bytes, _ := cloudAgentCompactionSourceFacts(state)
		needed := tokens >= budget.CompactAtTokens
		if !configured {
			needed = cloudAgentContextShouldCompact(len(state.Canonical.Messages), bytes)
		}
		if state.ContextCompaction != nil || (needed && state.ContextCompactionCount < cloudAgentMaxCompactionsPerRun) {
			action.Kind = "compact"
		}
	}
	seq := int64(0)
	if state.Browser != nil {
		seq = state.Browser.Sequence
	}
	action.StepID = run.ID + ":browser:" + strconv.FormatInt(seq, 10)
	return action
}

// All browser control changes use the existing execution CAS and storage quota.
func (s *Service) mutateBrowserAgent(userID, runID string, fn func(*model.CloudAgentExecution, *cloudAgentRuntime) error) error {
	for attempt := 0; attempt < 12; attempt++ {
		run, err := s.repo.CloudAgent(userID, runID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return kernel.NotFound("Agent 运行不存在")
			}
			return err
		}
		err = s.repo.MutateCloudAgent(userID, runID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
			state, err := cloudAgentDecode(current)
			if err != nil {
				return err
			}
			if state.Request.ExecutionMode != "browser" {
				return kernel.NewAppError(409, "该运行不使用浏览器执行")
			}
			if state.Browser == nil {
				state.Browser = &browserAgentRuntime{}
			}
			if err = fn(current, &state); err != nil {
				return err
			}
			return cloudAgentSave(current, &state)
		})
		if !errors.Is(err, repository.ErrCreationConflict) {
			return err
		}
	}
	return repository.ErrCreationConflict
}

func validateBrowserControl(input BrowserAgentControl) error {
	if input.ProtocolVersion != browserAgentProtocol {
		return &AppError{Status: 409, Code: 409, Reason: "browser_protocol_mismatch", Message: "浏览器 Agent 版本已更新，请刷新页面"}
	}
	if err := validateCloudAgentID(input.Owner, "浏览器执行端", 80); err != nil {
		return err
	}
	return nil
}

func browserControlOwned(state *cloudAgentRuntime, input BrowserAgentControl) bool {
	return state.Browser != nil && state.Browser.Owner == input.Owner && state.Browser.Epoch == input.Epoch && state.Browser.LeaseUntil.After(time.Now())
}

func (s *Service) ClaimBrowserAgent(userID, runID string, input BrowserAgentControl) (*BrowserAgentState, error) {
	if err := validateBrowserControl(input); err != nil {
		return nil, err
	}
	if err := s.RequireSkillAccess(userID); err != nil {
		return nil, err
	}
	err := s.mutateBrowserAgent(userID, runID, func(run *model.CloudAgentExecution, state *cloudAgentRuntime) error {
		if cloudAgentRunTerminal(run.Status) {
			return nil
		}
		b := state.Browser
		if b.Owner != input.Owner && b.LeaseUntil.After(time.Now()) {
			return kernel.NewAppError(409, "此运行正在另一个浏览器中执行")
		}
		if b.Owner != input.Owner || !b.LeaseUntil.After(time.Now()) {
			b.Epoch++
		}
		b.Owner = input.Owner
		b.LeaseUntil = time.Now().Add(browserAgentLease)
		return nil
	})
	if err != nil {
		return nil, err
	}
	s.startCloudAgentPi(userID, runID)
	return s.BrowserAgentState(userID, runID)
}

func (s *Service) HeartbeatBrowserAgent(userID, runID string, input BrowserAgentControl) (*BrowserAgentState, error) {
	if err := validateBrowserControl(input); err != nil {
		return nil, err
	}
	err := s.mutateBrowserAgent(userID, runID, func(_ *model.CloudAgentExecution, state *cloudAgentRuntime) error {
		if !browserControlOwned(state, input) {
			return kernel.NewAppError(409, "浏览器执行权已失效")
		}
		state.Browser.LeaseUntil = time.Now().Add(browserAgentLease)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.BrowserAgentState(userID, runID)
}

func (s *Service) BrowserAgentState(userID, runID string) (*BrowserAgentState, error) {
	if err := s.RequireSkillAccess(userID); err != nil {
		return nil, err
	}
	run, err := s.repo.CloudAgent(userID, runID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, kernel.NotFound("Agent 运行不存在")
		}
		return nil, err
	}
	state, err := cloudAgentDecode(run)
	if err != nil {
		return nil, err
	}
	if state.Request.ExecutionMode != "browser" {
		return nil, kernel.NewAppError(409, "该运行不使用浏览器执行")
	}
	view := &BrowserAgentState{ProtocolVersion: browserAgentProtocol, CheckpointVersion: 1, Status: run.Status, Revision: run.Revision, Connection: "disconnected", NextAction: browserAgentNext(s, run, &state)}
	if b := state.Browser; b != nil {
		view.Epoch = b.Epoch
		view.LeaseUntil = b.LeaseUntil
		if b.LeaseUntil.After(time.Now()) {
			view.Connection = "connected"
		}
	}
	return view, nil
}

func (s *Service) SubmitBrowserAgentStep(userID, runID string, input BrowserAgentControl) (*BrowserAgentState, error) {
	if err := validateBrowserControl(input); err != nil {
		return nil, err
	}
	if err := s.RequireSkillAccess(userID); err != nil {
		return nil, err
	}
	err := s.mutateBrowserAgent(userID, runID, func(run *model.CloudAgentExecution, state *cloudAgentRuntime) error {
		if !browserControlOwned(state, input) {
			return kernel.NewAppError(409, "浏览器执行权已失效")
		}
		prefix := runID + ":browser:"
		seq, err := strconv.ParseInt(strings.TrimPrefix(input.StepID, prefix), 10, 64)
		if err != nil || !strings.HasPrefix(input.StepID, prefix) || input.StepID != prefix+strconv.FormatInt(seq, 10) || seq < 0 {
			return BadAuthRequest("步骤标识无效")
		}
		b := state.Browser
		if seq < b.Sequence {
			return nil
		} // Completed steps never become new work after a lost ACK.
		if b.Pending != nil && b.Pending.ID == input.StepID {
			return nil
		}
		action := browserAgentNext(s, run, state)
		if action.StepID != input.StepID || (action.Kind != "model" && action.Kind != "tool" && action.Kind != "compact" && action.Kind != "settle") {
			return kernel.NewAppError(409, "运行阶段已改变，请重新读取")
		}
		b.Pending = &browserAgentStep{ID: input.StepID, Kind: action.Kind}
		if action.Kind == "model" {
			b.FinalAnswer = false
		}
		if action.Kind == "tool" {
			b.Pending.Call = state.Calls[state.CallIndex]
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	s.resumeCloudAgentPi(userID, runID)
	return s.BrowserAgentState(userID, runID)
}

type browserExecutorKey struct{}
type browserExecutor struct{ StepID, Token string }

func browserExecutorValid(ctx context.Context, state *cloudAgentRuntime) error {
	if state.Request.ExecutionMode != "browser" {
		return nil
	}
	executor, ok := ctx.Value(browserExecutorKey{}).(browserExecutor)
	if !ok || ctx.Err() != nil || state.Browser == nil || state.Browser.Pending == nil {
		return context.Canceled
	}
	p := state.Browser.Pending
	if p.ID != executor.StepID || p.Executor != executor.Token || !p.ExecuteUntil.After(time.Now()) {
		return context.Canceled
	}
	return nil
}

// Recovery executes only a durably accepted step, never the next Agent turn.
func (s *Service) runBrowserAgentAcceptedStep(ctx context.Context, userID, runID string) error {
	initial, err := s.repo.CloudAgent(userID, runID)
	if err != nil {
		return err
	}
	initialState, err := cloudAgentDecode(initial)
	if err != nil {
		return err
	}
	if initialState.Browser == nil || initialState.Browser.Pending == nil {
		if initialState.Browser != nil && initialState.Browser.FinalAnswer && initialState.PiResumePrompt == "" {
			return s.completeCloudAgentPiRun(userID, runID)
		}
		return nil
	}
	token := cloudAgentID(userID, fmt.Sprintf("executor:%s:%d", runID, time.Now().UnixNano()))
	var step browserAgentStep
	err = s.mutateBrowserAgent(userID, runID, func(_ *model.CloudAgentExecution, state *cloudAgentRuntime) error {
		step = browserAgentStep{}
		p := state.Browser.Pending
		if p == nil || p.ExecuteUntil.After(time.Now()) {
			return nil
		}
		if p.Kind == "tool" {
			_, completed := cloudAgentToolMessage(state, p.Call.ID)
			approval := state.Approval
			awaitingApproval := approval != nil && approval.Call.ID == p.Call.ID && approval.Call.Function.Name == p.Call.Function.Name
			mediaSubmitted := state.MediaTaskID != "" && state.CallIndex >= 0 && state.CallIndex < len(state.Calls) && state.Calls[state.CallIndex].ID == p.Call.ID
			batchSubmitted := cloudAgentMediaBatchActive(state) && state.MediaBatch.CallID == p.Call.ID
			// 审批准备会改写参数；已持久化的交接由审批/媒体执行器接管，不能重放旧调用。
			p.Settled = p.Settled || completed || awaitingApproval || mediaSubmitted || batchSubmitted
		}
		p.Executor = token
		p.ExecuteUntil = time.Now().Add(browserAgentLease)
		step = *p
		return nil
	})
	if err != nil || step.ID == "" {
		return err
	}
	ctx, cancel := context.WithCancel(context.WithValue(ctx, browserExecutorKey{}, browserExecutor{step.ID, token}))
	defer cancel()
	done := make(chan struct{})
	renewed := make(chan struct{})
	defer func() { close(done); <-renewed }()
	go func() {
		defer close(renewed)
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ctx.Done():
				return
			case <-ticker.C:
				err := s.mutateBrowserAgent(userID, runID, func(_ *model.CloudAgentExecution, state *cloudAgentRuntime) error {
					if err := browserExecutorValid(ctx, state); err != nil {
						return err
					}
					state.Browser.Pending.ExecuteUntil = time.Now().Add(browserAgentLease)
					return nil
				})
				if err != nil {
					cancel()
					return
				}
			}
		}
	}()
	if !step.Settled {
		switch step.Kind {
		case "model":
			run, loadErr := s.repo.CloudAgent(userID, runID)
			if loadErr != nil {
				return loadErr
			}
			state, decodeErr := cloudAgentDecode(run)
			if decodeErr != nil {
				return decodeErr
			}
			messages, _ := json.Marshal([]map[string]any{{"role": "user", "content": state.Request.Prompt}})
			thinkingLevel, _ := json.Marshal(cloudAgentThinkingLevel(state.Policy.ReasoningMode, state.ForceThinkingOff))
			payload := map[string]json.RawMessage{"messages": messages, "thinkingLevel": thinkingLevel}
			_, err = s.cloudAgentPiModel(ctx, userID, runID, payload)
		case "tool":
			_, err = s.executeCloudAgentRuntimeTool(ctx, userID, runID, step.Call)
		case "compact":
			err = s.runBrowserAgentCompaction(ctx, userID, runID)
		case "settle":
			// Reconcile the final answer below without another model call.
		default:
			err = errors.New("invalid browser step")
		}
	}
	if err != nil {
		return err
	}
	err = s.mutateBrowserAgent(userID, runID, func(_ *model.CloudAgentExecution, state *cloudAgentRuntime) error {
		if err := browserExecutorValid(ctx, state); err != nil {
			return err
		}
		state.Browser.Pending = nil
		state.Browser.Sequence++
		return nil
	})
	if err != nil {
		return err
	}
	run, err := s.repo.CloudAgent(userID, runID)
	if err != nil {
		return err
	}
	state, err := cloudAgentDecode(run)
	if err != nil {
		return err
	}
	if !cloudAgentRunTerminal(run.Status) && state.ActiveTaskID == "" && state.CallIndex >= len(state.Calls) && state.PiAssistantResponses > 0 && state.Browser.FinalAnswer && (step.Kind == "model" || step.Kind == "settle") {
		return s.completeCloudAgentPiRun(userID, runID)
	}
	return nil
}

func (s *Service) runBrowserAgentCompaction(ctx context.Context, userID, runID string) error {
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		run, err := s.repo.CloudAgent(userID, runID)
		if err != nil {
			return err
		}
		state, err := cloudAgentDecode(run)
		if err != nil {
			return err
		}
		if err = browserExecutorValid(ctx, &state); err != nil {
			return err
		}
		if state.ContextCompaction == nil {
			if state.Browser.Pending.Settled {
				return nil
			}
			tokens, err := cloudAgentRequestEstimatedTokens(&state.Canonical)
			if err != nil {
				return err
			}
			requested, requestErr := s.cloudAgentRequestCompaction(run, &state, s.cloudAgentContextBudgetForRequest(state.Request), tokens)
			if errors.Is(requestErr, repository.ErrCreationConflict) {
				continue
			}
			if requestErr != nil {
				return requestErr
			}
			if !requested {
				return errors.New("browser context compaction could not start")
			}
			continue
		}
		if state.ActiveTaskID == "" {
			err = s.enqueueCloudAgentContextCompaction(run, &state)
			if errors.Is(err, repository.ErrCreationConflict) {
				continue
			}
			if err != nil {
				return err
			}
			s.wakeTaskDispatcher()
			continue
		}
		task, err := s.waitCloudAgentTask(ctx, state.ActiveTaskID)
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if task == nil {
			task, err = s.repo.Task(state.ActiveTaskID)
			if err != nil {
				return err
			}
		}
		err = s.advanceCloudAgentContextCompaction(run, &state, task)
		if errors.Is(err, repository.ErrCreationConflict) {
			continue
		}
		return err
	}
}
