package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/gorm"
)

type Service struct {
	repo            *repository.Repository
	dataDir         string
	cancelMu        sync.Mutex
	registrationMu  sync.Mutex
	emailCodeMu     sync.Mutex
	redeemBatchMu   sync.Mutex
	storageMu       sync.Mutex
	characterTaskMu sync.Mutex
	activeCancels   map[string]context.CancelFunc
	pendingStorage  map[string]int64
	coordinator     *runtimeCoordinator
	runtimeErr      error
	workerID        string
}

const taskWorkerConcurrency = 3
const taskLogPayloadLimit = 4000

type CreateSessionRequest struct {
	ProjectID      string                    `json:"projectId"`
	Prompt         string                    `json:"prompt"`
	CanvasSnapshot map[string]any            `json:"canvasSnapshot"`
	References     []string                  `json:"references"`
	Requirements   string                    `json:"requirements"`
	CanvasAssets   []storyboardAsset         `json:"canvasAssets"`
	ProjectStyle   storyboardProjectStyle    `json:"projectStyle"`
	Characters     []storyboardCharacterCard `json:"characters"`
	Config         providerConfig            `json:"config"`
}

type CreateTaskRequest struct {
	SubmissionID string         `json:"submissionId"`
	SessionID    string         `json:"sessionId"`
	ProjectID    string         `json:"projectId"`
	Type         string         `json:"type"`
	Operation    string         `json:"operation"`
	Prompt       string         `json:"prompt"`
	Provider     string         `json:"provider"`
	Model        string         `json:"model"`
	Input        map[string]any `json:"input"`
}

type SessionDetail struct {
	Session  model.Session   `json:"session"`
	Messages []model.Message `json:"messages"`
	Tasks    []TaskSummary   `json:"tasks"`
	Results  []model.Result  `json:"results"`
}

type TaskSummary struct {
	ID                string              `json:"id"`
	SubmissionID      string              `json:"submissionId,omitempty"`
	SessionID         string              `json:"sessionId,omitempty"`
	ProjectID         string              `json:"projectId,omitempty"`
	Type              string              `json:"type"`
	Status            model.TaskStatus    `json:"status"`
	Stage             string              `json:"stage"`
	Progress          int                 `json:"progress"`
	Prompt            string              `json:"prompt"`
	Operation         string              `json:"operation,omitempty"`
	Provider          string              `json:"provider,omitempty"`
	Model             string              `json:"model,omitempty"`
	ProviderRequestID string              `json:"providerRequestId,omitempty"`
	ErrorCode         string              `json:"errorCode,omitempty"`
	PreviewURL        string              `json:"previewUrl,omitempty"`
	PreviewKind       string              `json:"previewKind,omitempty"`
	Attempts          int                 `json:"attempts"`
	StartedAt         *time.Time          `json:"startedAt"`
	CompletedAt       *time.Time          `json:"completedAt"`
	CreatedAt         time.Time           `json:"createdAt"`
	UpdatedAt         time.Time           `json:"updatedAt"`
	Billing           *TaskBillingSummary `json:"billing,omitempty"`
	ClientContext     *TaskClientContext  `json:"clientContext,omitempty"`
}

type TaskClientContext struct {
	ConversationID string `json:"conversationId"`
	MessageID      string `json:"messageId"`
	BatchIndex     int    `json:"batchIndex,omitempty"`
	BatchCount     int    `json:"batchCount,omitempty"`
}

type TaskBillingSummary struct {
	AmountMicrocredits int64               `json:"amountMicrocredits"`
	Status             model.BillingStatus `json:"status"`
}

type TaskListOptions struct {
	Limit      int
	ProjectID  string
	ActiveOnly bool
}

type agentStoryboardInput struct {
	References     []string                  `json:"references"`
	CanvasSnapshot map[string]any            `json:"canvasSnapshot"`
	Requirements   string                    `json:"requirements"`
	CanvasAssets   []storyboardAsset         `json:"canvasAssets"`
	ProjectStyle   storyboardProjectStyle    `json:"projectStyle"`
	Characters     []storyboardCharacterCard `json:"characters"`
	Config         providerConfig            `json:"config"`
	ShotDuration   int                       `json:"shotDurationSeconds"`
	ShotCount      int                       `json:"shotCount"`
}

type storyboardProjectStyle struct {
	PresetID string `json:"presetId"`
	Title    string `json:"title"`
	Prompt   string `json:"prompt"`
}

type storyboardCharacterCard struct {
	AssetID    string         `json:"assetId"`
	VersionID  string         `json:"versionId"`
	Name       string         `json:"name"`
	Definition map[string]any `json:"definition"`
}

type storyboardAsset struct {
	ID                 string   `json:"id"`
	Title              string   `json:"title"`
	Type               string   `json:"type"`
	Tags               []string `json:"tags"`
	Prompt             string   `json:"prompt"`
	CharacterAssetID   string   `json:"characterAssetId,omitempty"`
	CharacterVersionID string   `json:"characterVersionId,omitempty"`
}

type agentStoryboardPlan struct {
	Title      string                 `json:"title"`
	Logline    string                 `json:"logline"`
	StyleGuide string                 `json:"styleGuide"`
	Characters []string               `json:"characters"`
	Locations  []string               `json:"locations"`
	Shots      []agentStoryboardShot  `json:"shots"`
	Raw        map[string]interface{} `json:"-"`
}

type agentStoryboardShot struct {
	Title         string   `json:"title"`
	Description   string   `json:"description"`
	Duration      int      `json:"durationSeconds"`
	Dialogue      string   `json:"dialogue"`
	ShotSize      string   `json:"shotSize"`
	Emotion       string   `json:"emotion"`
	Lighting      string   `json:"lightingAndAtmosphere"`
	AudioEffects  string   `json:"audioEffects"`
	VisualPrompt  string   `json:"visualPrompt"`
	VideoPrompt   string   `json:"videoPrompt"`
	Camera        string   `json:"camera"`
	Motion        string   `json:"motion"`
	TimeBeats     string   `json:"timeBeats"`
	Negative      string   `json:"negativePrompt"`
	AssetTags     []string `json:"assetTags"`
	CharacterIDs  []string `json:"characterIds"`
	Intent        string   `json:"narrativeIntent"`
	ViewerPOV     string   `json:"viewerPOV"`
	Performance   string   `json:"performanceBlocking"`
	MustHave      []string `json:"mustHave"`
	Optional      []string `json:"optionalDetails"`
	ContinuityOut string   `json:"continuityOut"`
}

func New(repo *repository.Repository, dataDir string) *Service {
	coordinator, err := newRuntimeCoordinator(repo.Dialect())
	return &Service{repo: repo, dataDir: dataDir, activeCancels: make(map[string]context.CancelFunc), coordinator: coordinator, runtimeErr: err, workerID: newID()}
}

func (s *Service) StartWorker() {
	go func() {
		slots := make(chan struct{}, maxChannelConcurrencyLimit)
		dispatch := func() {
			setting, err := s.runtimeConcurrencySetting()
			if err != nil {
				return
			}
			workerConcurrency := setting.WorkerConcurrency
			for len(slots) < workerConcurrency {
				releaseGlobal, acquired, err := s.coordinator.acquire(context.Background(), "workers", workerConcurrency, 45*time.Minute)
				if err != nil || !acquired {
					return
				}
				task, err := s.repo.ClaimNextTask(s.workerID, 45*time.Second)
				if err != nil || task == nil {
					releaseGlobal()
					return
				}
				slots <- struct{}{}
				go func(task *model.Task) {
					defer func() { <-slots; releaseGlobal() }()
					_ = s.processClaimedTask(task)
				}(task)
			}
		}

		dispatch()
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			dispatch()
		}
	}()
}

func (s *Service) CreateSession(userID string, req CreateSessionRequest) (*SessionDetail, error) {
	prompt := strings.TrimSpace(req.Prompt)
	if prompt == "" {
		return nil, errors.New("prompt is required")
	}
	if err := validateStoryboardContext(req.ProjectStyle, req.Characters); err != nil {
		return nil, err
	}
	compactedSnapshot := compactPersistedValue(req.CanvasSnapshot)
	snapshotJSON, _ := json.Marshal(compactedSnapshot)
	session := model.Session{ID: newID(), UserID: userID, ProjectID: req.ProjectID, Status: model.SessionStatusActive, Prompt: prompt, CanvasSnapshotJSON: string(snapshotJSON)}
	policy, err := s.RuntimePolicy()
	if err != nil {
		return nil, err
	}
	s.storageMu.Lock()
	usage, err := s.repo.UserStorageUsage(userID)
	if err != nil {
		s.storageMu.Unlock()
		return nil, err
	}
	incomingBytes := int64(len([]byte(prompt))*2 + len(snapshotJSON))
	if err := validateStructuredStorageQuotaWithPolicy(usage, "session", true, incomingBytes, policy.Resource); err != nil {
		s.storageMu.Unlock()
		return nil, err
	}
	if err := s.repo.Create(&session); err != nil {
		s.storageMu.Unlock()
		return nil, err
	}
	if err := s.repo.Create(&model.Message{ID: newID(), UserID: userID, SessionID: session.ID, Role: "user", Content: prompt}); err != nil {
		cleanupErr := s.repo.DeleteSessionDraft(userID, session.ID)
		s.storageMu.Unlock()
		if cleanupErr != nil {
			return nil, fmt.Errorf("创建会话消息失败：%v；清理会话失败：%w", err, cleanupErr)
		}
		return nil, err
	}
	s.storageMu.Unlock()
	taskReq := CreateTaskRequest{SessionID: session.ID, ProjectID: req.ProjectID, Type: "agent_storyboard", Operation: "storyboard", Prompt: prompt, Provider: "openai-compatible", Model: req.Config.Model, Input: map[string]any{"references": req.References, "canvasSnapshot": compactedSnapshot, "requirements": req.Requirements, "canvasAssets": req.CanvasAssets, "projectStyle": req.ProjectStyle, "characters": req.Characters, "config": req.Config}}
	if _, err := s.CreateTask(userID, taskReq); err != nil {
		s.storageMu.Lock()
		cleanupErr := s.repo.DeleteSessionDraft(userID, session.ID)
		s.storageMu.Unlock()
		if cleanupErr != nil {
			return nil, fmt.Errorf("创建会话任务失败：%v；清理会话失败：%w", err, cleanupErr)
		}
		return nil, err
	}
	s.recordActivity(userID, "agent_message", 1)
	return s.SessionDetail(userID, session.ID)
}

func channelModelNames(channel model.ModelChannel) []string {
	models := []string{}
	_ = json.Unmarshal([]byte(channel.ModelsJSON), &models)
	return uniqueNonEmpty(models)
}

func (s *Service) SessionDetail(userID string, id string) (*SessionDetail, error) {
	session, err := s.repo.SessionForUser(userID, id)
	if err != nil {
		return nil, err
	}
	messages, err := s.repo.SessionMessages(userID, id)
	if err != nil {
		return nil, err
	}
	tasks, err := s.repo.SessionTasks(userID, id)
	if err != nil {
		return nil, err
	}
	taskSummaries := taskSummariesForOutput(tasks)
	results, err := s.repo.SessionResults(userID, id)
	if err != nil {
		return nil, err
	}
	return &SessionDetail{Session: *session, Messages: messages, Tasks: taskSummaries, Results: results}, nil
}

func (s *Service) CreateTask(userID string, req CreateTaskRequest) (*model.Task, error) {
	prompt := strings.TrimSpace(req.Prompt)
	if prompt == "" {
		return nil, errors.New("prompt is required")
	}
	submissionID, err := normalizeTaskSubmissionID(req.SubmissionID)
	if err != nil {
		return nil, err
	}
	if submissionID != "" {
		existing, findErr := s.repo.TaskForSubmission(userID, submissionID)
		if findErr == nil {
			return taskForOutput(*existing), nil
		}
		if !errors.Is(findErr, gorm.ErrRecordNotFound) {
			return nil, findErr
		}
	}
	normalizedInput, err := normalizeTaskInput(req.Input)
	if err != nil {
		return nil, err
	}
	if containsInlineMediaDataURL(normalizedInput) {
		return nil, BadAuthRequest("任务输入不能包含内嵌媒体，请先上传到资源存储")
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		return nil, err
	}
	activeTasks, err := s.repo.ActiveTaskCountForUser(userID)
	if err != nil {
		return nil, err
	}
	if activeTasks >= int64(policy.Task.ActiveTaskLimit) {
		return nil, BadAuthRequest(fmt.Sprintf("同时排队或运行的任务最多 %d 个，请等待已有任务完成", policy.Task.ActiveTaskLimit))
	}
	taskType := req.Type
	if taskType == "" {
		taskType = "video_image_to_video"
	}
	task := model.Task{ID: newID(), UserID: userID, SubmissionID: submissionID, SessionID: req.SessionID, ProjectID: req.ProjectID, Type: taskType, Status: model.TaskStatusQueued, Stage: "等待队列调度", Progress: 5, Prompt: prompt, Operation: req.Operation, Provider: req.Provider, Model: req.Model}
	if err := s.ensureTaskProjectActive(userID, req.ProjectID); err != nil {
		return nil, err
	}
	billingOrder, err := s.taskBillingOrder(userID, &task, normalizedInput)
	if err != nil {
		return nil, err
	}
	if err := s.protectTaskSecrets(normalizedInput); err != nil {
		return nil, err
	}
	inputJSON, _ := json.Marshal(normalizedInput)
	task.InputJSON = string(inputJSON)
	if billingOrder != nil {
		task.BillingOrderID = billingOrder.ID
	}
	err = s.createTaskWithinStorageQuota(&task, billingOrder, policy)
	if err != nil && submissionID != "" {
		if existing, findErr := s.repo.TaskForSubmission(userID, submissionID); findErr == nil {
			return taskForOutput(*existing), nil
		}
	}
	if errors.Is(err, repository.ErrActiveTaskLimit) {
		return nil, BadAuthRequest(fmt.Sprintf("同时排队或运行的任务最多 %d 个，请等待已有任务完成", policy.Task.ActiveTaskLimit))
	}
	if errors.Is(err, repository.ErrInsufficientCredits) {
		return nil, BadAuthRequest("积分不足，请先使用兑换码充值")
	}
	if err != nil {
		return nil, err
	}
	s.recordActivity(userID, "task", 1)
	_ = s.log(userID, task.ID, "info", "任务已进入队列", "")
	return taskForOutput(task), nil
}

func normalizeTaskSubmissionID(value string) (string, error) {
	value = strings.TrimSpace(value)
	if len(value) > 96 {
		return "", BadAuthRequest("submissionId 长度不能超过 96 个字符")
	}
	return value, nil
}

// 所有任务输入先收敛为 JSON 对象，确保计费与密钥保护不会因 Go 结构体类型不同而被绕过。
func normalizeTaskInput(input map[string]any) (map[string]any, error) {
	if input == nil {
		return map[string]any{}, nil
	}
	encoded, err := json.Marshal(input)
	if err != nil {
		return nil, BadAuthRequest("任务输入格式无效")
	}
	var normalized map[string]any
	if err := json.Unmarshal(encoded, &normalized); err != nil {
		return nil, BadAuthRequest("任务输入格式无效")
	}
	if snapshot, ok := normalized["canvasSnapshot"]; ok {
		normalized["canvasSnapshot"] = compactPersistedValue(snapshot)
	}
	return normalized, nil
}

func compactPersistedValue(value interface{}) interface{} {
	switch item := value.(type) {
	case map[string]interface{}:
		result := make(map[string]interface{}, len(item))
		for key, child := range item {
			if text, ok := child.(string); ok && strings.HasPrefix(text, "data:") {
				result[key] = ""
				continue
			}
			result[key] = compactPersistedValue(child)
		}
		return result
	case []interface{}:
		result := make([]interface{}, len(item))
		for index, child := range item {
			result[index] = compactPersistedValue(child)
		}
		return result
	default:
		return value
	}
}

func (s *Service) Tasks(userID string, limit int) ([]TaskSummary, error) {
	return s.TasksWithOptions(userID, TaskListOptions{Limit: limit})
}

func (s *Service) TasksWithOptions(userID string, options TaskListOptions) ([]TaskSummary, error) {
	tasks, err := s.repo.Tasks(userID, options.Limit, options.ProjectID, options.ActiveOnly)
	if err != nil {
		return nil, err
	}
	orders, err := s.repo.BillingOrdersByTaskIDs(userID, taskBillingTaskIDs(tasks))
	if err != nil {
		return nil, err
	}
	return taskSummariesForOutputWithBilling(tasks, orders), nil
}

func (s *Service) Task(userID string, id string) (*model.Task, error) {
	task, err := s.repo.TaskForUser(userID, id)
	if err != nil {
		return nil, err
	}
	s.hydrateTaskProviderRequestID(task)
	return taskForOutput(*task), nil
}

func (s *Service) hydrateTaskProviderRequestID(task *model.Task) {
	if task == nil || task.ProviderRequestID != "" {
		return
	}
	if task.BillingOrderID != "" {
		if order, err := s.repo.BillingOrder(task.BillingOrderID); err == nil {
			task.ProviderRequestID = strings.TrimSpace(order.ProviderRequestID)
		}
	}
	if task.ProviderRequestID == "" {
		if providerRequestID, err := s.repo.LatestProviderRequestIDForTask(task.ID); err == nil {
			task.ProviderRequestID = providerRequestID
		}
	}
}

// 上游请求日志会在任务执行期间更新 provider 状态，终态保存前必须重新合并，避免旧任务对象覆盖可恢复 ID。
func (s *Service) refreshTaskProviderState(task *model.Task) error {
	if task == nil || task.ID == "" {
		return errors.New("任务状态无效")
	}
	latest, err := s.repo.Task(task.ID)
	if err != nil {
		return fmt.Errorf("刷新任务上游状态失败：%w", err)
	}
	if latest.ProviderRequestID != "" {
		task.ProviderRequestID = latest.ProviderRequestID
	}
	task.PollStage = latest.PollStage
	task.NextPollAt = latest.NextPollAt
	return nil
}

func (s *Service) RetryTask(userID string, id string) (*model.Task, error) {
	task, err := s.repo.TaskForUser(userID, id)
	if err != nil {
		return nil, err
	}
	if task.Status != model.TaskStatusFailed && task.Status != model.TaskStatusCancelled {
		return nil, errors.New("only failed or cancelled tasks can be retried")
	}
	if isContentModerationFailure(task.Error) {
		return nil, BadAuthRequest(contentModerationRetryMessage)
	}
	decryptedInput, err := s.decryptTaskInputJSON(task.InputJSON)
	if err != nil {
		return nil, err
	}
	var billingInput map[string]any
	if err := json.Unmarshal([]byte(decryptedInput), &billingInput); err != nil {
		return nil, err
	}
	billingOrder, err := s.taskBillingOrder(userID, task, billingInput)
	if err != nil {
		return nil, err
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		return nil, err
	}
	if err := s.ensureTaskProjectActive(userID, task.ProjectID); err != nil {
		return nil, err
	}
	task, err = s.repo.RetryTaskWithBilling(userID, task.ID, billingOrder, policy.Task.ActiveTaskLimit)
	if errors.Is(err, repository.ErrInsufficientCredits) {
		return nil, BadAuthRequest("积分不足，请先使用兑换码充值")
	}
	if errors.Is(err, repository.ErrActiveTaskLimit) {
		return nil, BadAuthRequest(fmt.Sprintf("同时排队或运行的任务最多 %d 个，请等待已有任务完成", policy.Task.ActiveTaskLimit))
	}
	if errors.Is(err, repository.ErrTaskNotRetryable) {
		return nil, BadAuthRequest("任务已被其他请求重新入队，请勿重复重试")
	}
	if err != nil {
		return nil, err
	}
	if task.SessionID != "" {
		if session, err := s.repo.SessionForUser(task.UserID, task.SessionID); err == nil {
			session.Status = model.SessionStatusActive
			session.CanvasOpsJSON = ""
			_ = s.repo.Save(session)
		}
	}
	_ = s.log(userID, task.ID, "info", "任务已重新入队", "")
	return taskForOutput(*task), nil
}

func (s *Service) CancelTask(userID string, id string) (*model.Task, error) {
	task, err := s.repo.TaskForUser(userID, id)
	if err != nil {
		return nil, err
	}
	if task.Status == model.TaskStatusSucceeded {
		return nil, errors.New("completed task cannot be cancelled")
	}
	now := time.Now()
	if task.Status == model.TaskStatusQueued {
		cancelled, err := s.repo.CancelTaskIfStatus(userID, task.ID, model.TaskStatusQueued, now)
		if err != nil {
			return nil, err
		}
		if cancelled {
			if err := s.RefundBilling(task.BillingOrderID, "任务在调用上游前取消"); err != nil {
				return nil, err
			}
			task, err = s.repo.TaskForUser(userID, id)
			if err != nil {
				return nil, err
			}
		} else {
			task, err = s.repo.TaskForUser(userID, id)
			if err != nil {
				return nil, err
			}
		}
	}
	if task.Status == model.TaskStatusRunning {
		s.cancelActiveTask(task.ID)
		cancelled, err := s.repo.CancelTaskIfStatus(userID, task.ID, model.TaskStatusRunning, now)
		if err != nil {
			return nil, err
		}
		if !cancelled {
			latest, latestErr := s.repo.TaskForUser(userID, id)
			if latestErr != nil {
				return nil, latestErr
			}
			if latest.Status == model.TaskStatusSucceeded {
				return nil, errors.New("completed task cannot be cancelled")
			}
			task = latest
		} else {
			if err := s.MarkBillingUncertain(task.BillingOrderID, "运行中的上游请求被用户取消，费用状态待核对"); err != nil {
				return nil, err
			}
			task, err = s.repo.TaskForUser(userID, id)
			if err != nil {
				return nil, err
			}
		}
	}
	if task.Status != model.TaskStatusCancelled {
		return nil, errors.New("task cannot be cancelled in its current state")
	}
	if task.SessionID != "" {
		_ = s.markSessionFailed(*task, "会话任务已取消。")
	}
	_ = s.log(userID, task.ID, "warn", "任务已取消", "")
	return taskForOutput(*task), nil
}

func (s *Service) TaskLogs(userID string, id string) ([]model.TaskLog, error) {
	return s.repo.TaskLogs(userID, id)
}

func (s *Service) TasksForSubmissions(userID string, submissionIDs []string) ([]TaskSummary, error) {
	ids := make([]string, 0, len(submissionIDs))
	seen := map[string]struct{}{}
	for _, raw := range submissionIDs {
		id, err := normalizeTaskSubmissionID(raw)
		if err != nil {
			return nil, err
		}
		if id == "" {
			continue
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	if len(ids) > 100 {
		return nil, BadAuthRequest("一次最多恢复 100 个任务")
	}
	tasks, err := s.repo.TasksForSubmissions(userID, ids)
	if err != nil {
		return nil, err
	}
	orders, err := s.repo.BillingOrdersByTaskIDs(userID, taskBillingTaskIDs(tasks))
	if err != nil {
		return nil, err
	}
	return taskSummariesForOutputWithBilling(tasks, orders), nil
}

type TaskTextChunkOutput struct {
	Sequence int64  `json:"sequence"`
	Delta    string `json:"delta"`
}

type TaskTextStream struct {
	Task         TaskSummary           `json:"task"`
	Attempt      int                   `json:"attempt"`
	Chunks       []TaskTextChunkOutput `json:"chunks"`
	NextSequence int64                 `json:"nextSequence"`
}

func (s *Service) TaskTextStream(userID string, id string, afterSequence int64) (*TaskTextStream, error) {
	task, err := s.repo.TaskForUser(userID, id)
	if err != nil {
		return nil, err
	}
	attempt := task.Attempts
	chunks, err := s.repo.TaskTextChunks(userID, task.ID, attempt, afterSequence)
	if err != nil {
		return nil, err
	}
	result := TaskTextStream{Task: taskSummaryForOutput(*task), Attempt: attempt, Chunks: make([]TaskTextChunkOutput, 0, len(chunks)), NextSequence: afterSequence}
	for _, chunk := range chunks {
		result.Chunks = append(result.Chunks, TaskTextChunkOutput{Sequence: chunk.Sequence, Delta: chunk.Delta})
		result.NextSequence = chunk.Sequence
	}
	return &result, nil
}

const (
	taskTextChunkFlushBytes    = 768
	taskTextChunkFlushInterval = 250 * time.Millisecond
)

type taskTextWriter struct {
	service      *Service
	userID       string
	taskID       string
	attempt      int
	mu           sync.Mutex
	nextSequence int64
	pending      strings.Builder
	lastFlush    time.Time
	progressed   bool
	failure      error
}

func (s *Service) newTaskTextWriter(task model.Task) (*taskTextWriter, error) {
	nextSequence, err := s.repo.LastTaskTextChunkSequence(task.ID, task.Attempts)
	if err != nil {
		return nil, err
	}
	return &taskTextWriter{service: s, userID: task.UserID, taskID: task.ID, attempt: task.Attempts, nextSequence: nextSequence, lastFlush: time.Now()}, nil
}

func (w *taskTextWriter) Write(delta string) error {
	if delta == "" {
		return nil
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.failure != nil {
		return w.failure
	}
	w.pending.WriteString(delta)
	if w.pending.Len() < taskTextChunkFlushBytes && time.Since(w.lastFlush) < taskTextChunkFlushInterval {
		return nil
	}
	return w.flushLocked()
}

func (w *taskTextWriter) Flush() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.flushLocked()
}

func (w *taskTextWriter) flushLocked() error {
	if w.failure != nil {
		return w.failure
	}
	if w.pending.Len() == 0 {
		return nil
	}
	delta := w.pending.String()
	w.pending.Reset()
	nextSequence := w.nextSequence + 1
	chunk := model.TaskTextChunk{ID: newID(), UserID: w.userID, TaskID: w.taskID, Attempt: w.attempt, Sequence: nextSequence, Delta: delta}
	if err := w.service.repo.CreateTaskTextChunk(&chunk); err != nil {
		w.pending.WriteString(delta)
		w.failure = err
		return err
	}
	w.nextSequence = nextSequence
	w.lastFlush = time.Now()
	if !w.progressed {
		w.progressed = true
		_ = w.service.repo.UpdateTaskProgress(w.taskID, "正在生成文本", 60)
	}
	return nil
}

func (w *taskTextWriter) Failure() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.failure
}

func taskSummariesForOutput(tasks []model.Task) []TaskSummary {
	return taskSummariesForOutputWithBilling(tasks, nil)
}

func taskSummariesForOutputWithBilling(tasks []model.Task, orders map[string]model.BillingOrder) []TaskSummary {
	result := make([]TaskSummary, 0, len(tasks))
	for _, task := range tasks {
		summary := taskSummaryForOutput(task)
		if order, ok := orders[task.ID]; ok {
			summary.Billing = &TaskBillingSummary{AmountMicrocredits: order.AmountMicrocredits, Status: order.Status}
			if summary.ProviderRequestID == "" {
				summary.ProviderRequestID = order.ProviderRequestID
			}
		}
		result = append(result, summary)
	}
	return result
}

func taskBillingTaskIDs(tasks []model.Task) []string {
	ids := make([]string, 0, len(tasks))
	seen := map[string]struct{}{}
	for _, task := range tasks {
		if task.BillingOrderID == "" {
			continue
		}
		if _, ok := seen[task.ID]; ok {
			continue
		}
		seen[task.ID] = struct{}{}
		ids = append(ids, task.ID)
	}
	return ids
}

func taskSummaryForOutput(task model.Task) TaskSummary {
	errorCode := ""
	if isContentModerationFailure(task.Error) {
		errorCode = contentModerationErrorCode
	}
	previewURL, previewKind := taskMediaPreview(task.ResultJSON, task.Type)
	return TaskSummary{
		ID:                task.ID,
		SubmissionID:      task.SubmissionID,
		SessionID:         task.SessionID,
		ProjectID:         task.ProjectID,
		Type:              task.Type,
		Status:            task.Status,
		Stage:             task.Stage,
		Progress:          task.Progress,
		Prompt:            truncateRunes(task.Prompt, 500),
		Operation:         task.Operation,
		Provider:          task.Provider,
		Model:             task.Model,
		ProviderRequestID: task.ProviderRequestID,
		ErrorCode:         errorCode,
		PreviewURL:        previewURL,
		PreviewKind:       previewKind,
		Attempts:          task.Attempts,
		StartedAt:         task.StartedAt,
		CompletedAt:       task.CompletedAt,
		CreatedAt:         task.CreatedAt,
		UpdatedAt:         task.UpdatedAt,
		ClientContext:     taskClientContext(task.InputJSON),
	}
}

// 列表只暴露创作页恢复所需的关联 ID，不下发完整任务输入或其他 metadata。
func taskClientContext(raw string) *TaskClientContext {
	var input struct {
		Metadata struct {
			Source         string `json:"source"`
			ConversationID string `json:"conversationId"`
			MessageID      string `json:"messageId"`
			BatchIndex     int    `json:"batchIndex"`
			BatchCount     int    `json:"batchCount"`
		} `json:"metadata"`
	}
	if json.Unmarshal([]byte(raw), &input) != nil || input.Metadata.Source != "create-page" || input.Metadata.ConversationID == "" || input.Metadata.MessageID == "" {
		return nil
	}
	return &TaskClientContext{
		ConversationID: input.Metadata.ConversationID,
		MessageID:      input.Metadata.MessageID,
		BatchIndex:     input.Metadata.BatchIndex,
		BatchCount:     input.Metadata.BatchCount,
	}
}

// 列表只暴露首个可访问媒体地址，避免把完整生成结果和内嵌数据带回前端。
func taskMediaPreview(raw string, taskType string) (string, string) {
	if strings.TrimSpace(raw) == "" {
		return "", ""
	}
	var payload any
	if json.Unmarshal([]byte(raw), &payload) != nil {
		return "", ""
	}
	defaultKind := "image"
	if strings.Contains(strings.ToLower(taskType), "video") {
		defaultKind = "video"
	}
	return findTaskMediaPreview(payload, defaultKind)
}

func findTaskMediaPreview(value any, hint string) (string, string) {
	switch item := value.(type) {
	case string:
		text := strings.TrimSpace(item)
		if !strings.HasPrefix(text, "/api/resources/") && !strings.HasPrefix(text, "http://") && !strings.HasPrefix(text, "https://") {
			return "", ""
		}
		kind := hint
		lower := strings.ToLower(text)
		if strings.Contains(lower, ".mp4") || strings.Contains(lower, ".webm") || strings.Contains(lower, ".mov") {
			kind = "video"
		} else if kind != "video" {
			kind = "image"
		}
		return text, kind
	case []any:
		for _, child := range item {
			if previewURL, previewKind := findTaskMediaPreview(child, hint); previewURL != "" {
				return previewURL, previewKind
			}
		}
	case map[string]any:
		for _, key := range []string{"images", "image", "video", "dataUrl", "url", "resultUrl", "outputUrl"} {
			child, exists := item[key]
			if !exists {
				continue
			}
			childHint := hint
			if key == "video" {
				childHint = "video"
			} else if key == "images" || key == "image" {
				childHint = "image"
			}
			if previewURL, previewKind := findTaskMediaPreview(child, childHint); previewURL != "" {
				return previewURL, previewKind
			}
		}
	}
	return "", ""
}

func truncateRunes(value string, limit int) string {
	text := []rune(value)
	if len(text) <= limit {
		return value
	}
	return string(text[:limit]) + "..."
}

func taskForOutput(task model.Task) *model.Task {
	task.InputJSON = publicTaskInputJSON(task.InputJSON)
	return &task
}

func publicTaskInputJSON(raw string) string {
	if strings.TrimSpace(raw) == "" {
		return ""
	}
	var input map[string]any
	if err := json.Unmarshal([]byte(raw), &input); err != nil {
		return ""
	}
	public := map[string]any{}
	// 任务完成后仍需依靠这些非敏感 ID 恢复项目产物归属；密钥等配置继续被过滤。
	for _, key := range []string{"mode", "metadata", "workflowStepId", "domainProjectId", "assetVersionId", "resourceId", "mediaType", "role"} {
		if value, ok := input[key]; ok {
			public[key] = value
		}
	}
	if len(public) == 0 {
		return ""
	}
	data, _ := json.Marshal(public)
	return string(data)
}

func (s *Service) StoreUpload(userID string, sessionID string, header *multipart.FileHeader) (*model.SessionFile, error) {
	policy, err := s.RuntimePolicy()
	if err != nil {
		return nil, err
	}
	maxBytes := megabytes(policy.Resource.SessionUploadMB)
	if header == nil || header.Size > maxBytes {
		return nil, BadAuthRequest(fmt.Sprintf("会话文件不能超过 %dMB", policy.Resource.SessionUploadMB))
	}
	day, err := s.reserveSessionUploadQuota(userID, header.Size)
	if err != nil {
		return nil, err
	}
	reserved := true
	defer func() {
		if reserved {
			s.releaseUserUploadQuota(userID, day, header.Size)
		}
	}()
	file, err := header.Open()
	if err != nil {
		return nil, err
	}
	defer file.Close()
	uploadDir := filepath.Join(s.dataDir, "uploads")
	if err := os.MkdirAll(uploadDir, 0o750); err != nil {
		return nil, err
	}
	if strings.TrimSpace(sessionID) != "" {
		if _, err := s.repo.SessionForUser(userID, sessionID); err != nil {
			return nil, err
		}
	}
	storedName := newID() + "-" + filepath.Base(header.Filename)
	path := filepath.Join(uploadDir, storedName)
	dst, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_EXCL, 0o640)
	if err != nil {
		return nil, err
	}
	size, err := io.Copy(dst, io.LimitReader(file, maxBytes+1))
	closeErr := dst.Close()
	if err != nil {
		_ = os.Remove(path)
		return nil, err
	}
	if closeErr != nil {
		_ = os.Remove(path)
		return nil, closeErr
	}
	if size > maxBytes {
		_ = os.Remove(path)
		return nil, BadAuthRequest(fmt.Sprintf("会话文件不能超过 %dMB", policy.Resource.SessionUploadMB))
	}
	item := model.SessionFile{ID: newID(), UserID: userID, SessionID: sessionID, FileName: header.Filename, MimeType: header.Header.Get("Content-Type"), Path: path, Size: size}
	if err := s.repo.Create(&item); err != nil {
		_ = os.Remove(path)
		return nil, err
	}
	s.commitUserUploadQuota(userID, header.Size)
	reserved = false
	return &item, nil
}

func (s *Service) ProcessNextTask() error {
	task, err := s.repo.ClaimNextTask(s.workerID, 45*time.Second)
	if err != nil || task == nil {
		return err
	}
	return s.processClaimedTask(task)
}

func (s *Service) processClaimedTask(task *model.Task) error {
	_ = s.log(task.UserID, task.ID, "info", "后端任务开始处理", "")
	policy, err := s.RuntimePolicy()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), taskExecutionTimeoutWithPolicy(task.Type, policy.Task))
	defer cancel()
	leaseDone := make(chan struct{})
	leaseLost := make(chan error, 1)
	go func() {
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				if err := s.repo.RenewTaskLease(task.ID, s.workerID, 45*time.Second); err != nil {
					leaseLost <- err
					cancel()
					return
				}
			case <-leaseDone:
				return
			}
		}
	}()
	defer close(leaseDone)
	s.registerActiveTask(task.ID, cancel)
	defer s.unregisterActiveTask(task.ID)

	task.Stage = "调用生成模型"
	task.Progress = 35
	_ = s.repo.UpdateTaskProgress(task.ID, task.Stage, task.Progress)
	if err := s.MarkBillingRunning(task.BillingOrderID); err != nil {
		task.Status = model.TaskStatusFailed
		task.Stage = "计费准备失败"
		task.Error = taskFailureMessage(err)
		task.CompletedAt = ptr(time.Now())
		_ = s.repo.Save(task)
		_ = s.RefundBilling(task.BillingOrderID, "计费准备失败，上游请求未发出")
		return err
	}
	result, canvasOps, err := s.processTask(ctx, *task)
	if stateErr := s.refreshTaskProviderState(task); stateErr != nil {
		return stateErr
	}
	providerSucceeded := err == nil
	if err == nil {
		result, err = s.persistGeneratedMediaResult(task.UserID, result)
	}
	if err == nil {
		_, err = s.finalizeCharacterTurnaroundTask(*task, result)
	}
	if err != nil {
		channelSlotFailedBeforeRequest := false
		if code, _ := ChannelSlotFailureDetails(err); code != "" {
			channelSlotFailedBeforeRequest = true
		}
		select {
		case leaseErr := <-leaseLost:
			_ = s.log(task.UserID, task.ID, "warn", "任务租约失效，等待其他 worker 恢复", leaseErr.Error())
			return leaseErr
		default:
		}
		if errors.Is(err, context.Canceled) {
			task.Status = model.TaskStatusCancelled
			task.Stage = "任务已取消"
			task.Error = "任务已取消"
			task.CompletedAt = ptr(time.Now())
			_ = s.repo.Save(task)
			if channelSlotFailedBeforeRequest {
				_ = s.RefundBilling(task.BillingOrderID, "等待渠道槽位期间取消，上游请求未发出")
			} else {
				_ = s.MarkBillingUncertain(task.BillingOrderID, "任务取消时上游费用状态不明确")
			}
			_ = s.markSessionFailed(*task, "会话任务已取消。")
			_ = s.log(task.UserID, task.ID, "warn", "任务已取消", "")
			return nil
		}
		if errors.Is(err, context.DeadlineExceeded) {
			err = errors.New(taskTimeoutMessage(task.Type))
		}
		task.Status = model.TaskStatusFailed
		task.Stage = "任务失败"
		task.Error = taskFailureMessage(err)
		task.CompletedAt = ptr(time.Now())
		_ = s.repo.Save(task)
		if providerSucceeded || (!channelSlotFailedBeforeRequest && s.BillingFailureRequiresReview(task.BillingOrderID, task.ID, err)) {
			_ = s.MarkBillingUncertain(task.BillingOrderID, task.Error)
		} else {
			_ = s.RefundBilling(task.BillingOrderID, task.Error)
		}
		_ = s.markSessionFailed(*task, task.Error)
		_ = s.log(task.UserID, task.ID, "error", "任务处理失败", task.Error)
		return err
	}
	latest, err := s.repo.Task(task.ID)
	if err != nil {
		return err
	}
	if latest.Status == model.TaskStatusCancelled {
		_ = s.MarkBillingUncertain(task.BillingOrderID, "上游已返回结果，但任务被取消")
		_ = s.markSessionFailed(*latest, "会话任务已取消。")
		_ = s.log(task.UserID, task.ID, "warn", "任务已取消，丢弃生成结果", "")
		return nil
	}
	resultJSON, _ := json.Marshal(result)
	opsJSON, _ := json.Marshal(canvasOps)
	task.Stage = "持久化生成结果"
	task.Progress = 90
	_ = s.repo.UpdateTaskProgress(task.ID, task.Stage, task.Progress)
	if err := s.saveTaskCompletionWithinStorageQuota(task, resultJSON, opsJSON, len(canvasOps) > 0); err != nil {
		task.Status = model.TaskStatusFailed
		task.Stage = "任务结果保存失败"
		task.Error = taskFailureMessage(err)
		task.CompletedAt = ptr(time.Now())
		_ = s.repo.Save(task)
		_ = s.MarkBillingUncertain(task.BillingOrderID, "上游已成功但任务结果未保存："+task.Error)
		_ = s.markSessionFailed(*task, task.Error)
		_ = s.log(task.UserID, task.ID, "error", "任务结果保存失败", task.Error)
		return err
	}
	if completedTask, fetchErr := s.repo.Task(task.ID); fetchErr == nil {
		if registerErr := s.RegisterTaskOutputFromTask(*completedTask); registerErr != nil {
			// 任务成功与产物登记分开记账；登记失败保持步骤异常，允许项目页幂等补登记。
			_ = s.log(task.UserID, task.ID, "error", "任务成功但项目产物登记失败", registerErr.Error())
		}
	}
	if err := s.SettleBilling(task.BillingOrderID, ""); err != nil {
		_ = s.MarkBillingUncertain(task.BillingOrderID, "生成成功但积分结算失败："+err.Error())
		_ = s.log(task.UserID, task.ID, "error", "积分结算失败，已进入待核对", err.Error())
	}
	_ = s.log(task.UserID, task.ID, "info", "任务完成，结果已持久化", "")
	return nil
}

func taskFailureMessage(err error) string {
	if err == nil {
		return "任务处理失败"
	}
	return truncateRunes(err.Error(), 2_000)
}

func taskExecutionTimeoutWithPolicy(taskType string, policy RuntimeTaskPolicy) time.Duration {
	switch {
	case taskType == "agent_storyboard" || taskType == "agent_storyboard_rows":
		return time.Duration(policy.StoryboardTimeoutMinutes) * time.Minute
	case strings.HasPrefix(taskType, "canvas_video") || strings.HasPrefix(taskType, "video_"):
		return time.Duration(policy.VideoTimeoutMinutes) * time.Minute
	case strings.HasPrefix(taskType, "canvas_image"):
		return time.Duration(policy.ImageTimeoutMinutes) * time.Minute
	case strings.HasPrefix(taskType, "canvas_audio"):
		return time.Duration(policy.AudioTimeoutMinutes) * time.Minute
	case strings.HasPrefix(taskType, "canvas_text"):
		return time.Duration(policy.TextTimeoutMinutes) * time.Minute
	default:
		return time.Duration(policy.DefaultTimeoutMinutes) * time.Minute
	}
}

func taskTimeoutMessage(taskType string) string {
	if strings.HasPrefix(taskType, "canvas_video") || strings.HasPrefix(taskType, "video_") {
		return "视频生成等待超时，请稍后到任务中心查看或重试。"
	}
	if strings.HasPrefix(taskType, "canvas_image") {
		return "图片生成等待超时，请稍后重试。"
	}
	return "任务执行超时，请稍后重试。"
}

func (s *Service) processTask(ctx context.Context, task model.Task) (map[string]interface{}, []map[string]interface{}, error) {
	decryptedInput, err := s.decryptTaskInputJSON(task.InputJSON)
	if err != nil {
		return nil, nil, err
	}
	task.InputJSON = decryptedInput
	ctx = withProviderAnalytics(ctx, s, task)
	if task.Type == "agent_storyboard_rows" {
		return s.processStoryboardRowsTask(ctx, task)
	}
	if task.Type == "canvas_text" {
		result, err := s.processCanvasTextGenerationTask(ctx, task)
		return result, nil, err
	}
	if strings.HasPrefix(task.Type, "canvas_") || canRunProviderTask(task) {
		result, err := s.processCanvasGenerationTask(ctx, task.UserID, task.Type, task.Prompt, task.InputJSON)
		return result, nil, err
	}
	if task.Type == "agent_storyboard" {
		return s.processAgentStoryboardTask(ctx, task)
	}
	if strings.HasPrefix(task.Type, "video_") {
		result, ops := buildVideoWorkflowResult(task)
		return result, ops, nil
	}
	result, ops := buildAgentResult(task)
	return result, ops, nil
}

func canRunProviderTask(task model.Task) bool {
	if !strings.HasPrefix(task.Type, "video_") || strings.TrimSpace(task.InputJSON) == "" {
		return false
	}
	var input map[string]any
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		return false
	}
	mode, _ := input["mode"].(string)
	config, ok := input["config"].(map[string]any)
	if mode != "video" || !ok || strings.TrimSpace(fmt.Sprint(config["model"])) == "" {
		return false
	}
	return strings.TrimSpace(fmt.Sprint(config["channelId"])) != "" || (strings.TrimSpace(fmt.Sprint(config["baseUrl"])) != "" && strings.TrimSpace(fmt.Sprint(config["apiKey"])) != "")
}

func (s *Service) processAgentStoryboardTask(ctx context.Context, task model.Task) (map[string]interface{}, []map[string]interface{}, error) {
	input := agentStoryboardInput{}
	if strings.TrimSpace(task.InputJSON) != "" {
		if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
			return nil, nil, fmt.Errorf("Agent 会话输入解析失败：%w", err)
		}
	}
	if !providerConfigReady(input.Config) {
		return nil, nil, errors.New("请先配置可用的文本模型")
	}
	if err := validateStoryboardContext(input.ProjectStyle, input.Characters); err != nil {
		return nil, nil, err
	}
	assets := input.CanvasAssets
	if len(assets) == 0 {
		assets = extractStoryboardAssets(input.CanvasSnapshot)
	}
	config, err := s.resolveProviderConfig(input.Config)
	if err != nil {
		return nil, nil, err
	}
	plannerPrompt, err := s.buildAgentStoryboardPlannerPrompt(task.UserID, task.Prompt, input.Requirements, assets, input.ProjectStyle, input.Characters, 0, 0)
	if err != nil {
		return nil, nil, err
	}
	result, err := runTextTask(ctx, canvasGenerationInput{Mode: "text", Prompt: plannerPrompt, Config: config})
	if err != nil {
		return nil, nil, err
	}
	text, _ := result["text"].(string)
	plan, err := parseAgentStoryboardPlan(text)
	if err == nil {
		err = validateStoryboardPlan(plan, 0, 0, input.Characters)
	}
	if err != nil {
		_ = s.repo.UpdateTaskProgress(task.ID, "修复分镜结构", 55)
		repairPrompt, promptErr := s.buildStoryboardRepairPrompt(task.UserID, err, input, text)
		if promptErr != nil {
			return nil, nil, promptErr
		}
		repaired, repairErr := runTextTask(withProviderRequestKind(ctx, "repair"), canvasGenerationInput{Mode: "text", Prompt: repairPrompt, Config: config})
		if repairErr != nil {
			return nil, nil, fmt.Errorf("分镜结构修复失败：%w", repairErr)
		}
		repairedText, _ := repaired["text"].(string)
		plan, err = parseAgentStoryboardPlan(repairedText)
		if err == nil {
			err = validateStoryboardPlan(plan, 0, 0, input.Characters)
		}
		if err != nil {
			return nil, nil, fmt.Errorf("分镜模型结构修复后仍不合法：%w", err)
		}
	}
	return s.buildAgentStoryboardResult(task, plan, assets, input.ProjectStyle)
}

func (s *Service) processStoryboardRowsTask(ctx context.Context, task model.Task) (map[string]interface{}, []map[string]interface{}, error) {
	input := agentStoryboardInput{}
	if strings.TrimSpace(task.InputJSON) != "" {
		if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
			return nil, nil, fmt.Errorf("脚本任务输入解析失败：%w", err)
		}
	}
	if !providerConfigReady(input.Config) {
		return nil, nil, errors.New("请先配置可用的文本模型")
	}
	if err := validateStoryboardContext(input.ProjectStyle, input.Characters); err != nil {
		return nil, nil, err
	}
	assets := input.CanvasAssets
	if len(assets) == 0 {
		assets = extractStoryboardAssets(input.CanvasSnapshot)
	}
	config, err := s.resolveProviderConfig(input.Config)
	if err != nil {
		return nil, nil, err
	}
	plannerPrompt, err := s.buildAgentStoryboardPlannerPrompt(task.UserID, task.Prompt, input.Requirements, assets, input.ProjectStyle, input.Characters, input.ShotDuration, input.ShotCount)
	if err != nil {
		return nil, nil, err
	}
	result, err := runTextTask(ctx, canvasGenerationInput{Mode: "text", Prompt: plannerPrompt, Config: config})
	if err != nil {
		return nil, nil, err
	}
	text, _ := result["text"].(string)
	plan, err := parseAgentStoryboardPlan(text)
	if err == nil {
		err = validateStoryboardPlan(plan, input.ShotDuration, input.ShotCount, input.Characters)
	}
	if err != nil {
		_ = s.repo.UpdateTaskProgress(task.ID, "修复分镜结构", 55)
		repairPrompt, promptErr := s.buildStoryboardRepairPrompt(task.UserID, err, input, text)
		if promptErr != nil {
			return nil, nil, promptErr
		}
		repaired, repairErr := runTextTask(withProviderRequestKind(ctx, "repair"), canvasGenerationInput{Mode: "text", Prompt: repairPrompt, Config: config})
		if repairErr != nil {
			return nil, nil, fmt.Errorf("分镜结构修复失败：%w", repairErr)
		}
		repairedText, _ := repaired["text"].(string)
		plan, err = parseAgentStoryboardPlan(repairedText)
		if err == nil {
			err = validateStoryboardPlan(plan, input.ShotDuration, input.ShotCount, input.Characters)
		}
		if err != nil {
			return nil, nil, fmt.Errorf("分镜模型结构修复后仍不合法：%w", err)
		}
	}
	rows := make([]map[string]any, 0, len(plan.Shots))
	for index, shot := range plan.Shots {
		imagePromptVariables := storyboardImagePromptValues(input.ProjectStyle.Prompt, plan.StyleGuide, shot)
		videoPromptVariables := storyboardVideoPromptValues(input.ProjectStyle.Prompt, plan.StyleGuide, shot)
		imagePrompt, promptErr := s.compileStoryboardImagePrompt(task.UserID, input.ProjectStyle.Prompt, plan.StyleGuide, shot)
		if promptErr != nil {
			return nil, nil, promptErr
		}
		videoPrompt, promptErr := s.compileStoryboardVideoPrompt(task.UserID, input.ProjectStyle.Prompt, plan.StyleGuide, shot)
		if promptErr != nil {
			return nil, nil, promptErr
		}
		matchedAssets := matchStoryboardAssets(assets, shot.AssetTags)
		referenceNodeIDs := make([]string, 0, len(matchedAssets))
		for _, asset := range matchedAssets {
			referenceNodeIDs = append(referenceNodeIDs, asset.ID)
		}
		rows = append(rows, map[string]any{
			"shotNumber": index + 1, "durationSeconds": shot.Duration, "plotDescription": shot.Description,
			"dialogue": shot.Dialogue, "characters": storyboardRowCharacters(shot, input.Characters), "shotSize": shot.ShotSize, "emotion": shot.Emotion,
			"lightingAndAtmosphere": shot.Lighting, "audioEffects": shot.AudioEffects,
			"imageGenerationPrompt": imagePrompt, "videoMotionPrompt": videoPrompt,
			"imagePromptTemplateVariables": imagePromptVariables, "videoPromptTemplateVariables": videoPromptVariables,
			"camera": shot.Camera, "motion": shot.Motion, "timeBeats": shot.TimeBeats, "negativePrompt": shot.Negative,
			"narrativeIntent": shot.Intent, "viewerPOV": shot.ViewerPOV, "performanceBlocking": shot.Performance,
			"mustHave": shot.MustHave, "optionalDetails": shot.Optional, "continuityOut": shot.ContinuityOut,
			"referenceNodeIds": referenceNodeIDs, "assetTags": shot.AssetTags,
		})
	}
	return map[string]interface{}{"title": plan.Title, "rows": rows}, nil, nil
}

func providerConfigReady(config providerConfig) bool {
	return strings.TrimSpace(config.Model) != "" && (strings.TrimSpace(config.ChannelID) != "" || (strings.TrimSpace(config.BaseURL) != "" && strings.TrimSpace(config.APIKey) != ""))
}

func parseAgentStoryboardPlan(raw string) (agentStoryboardPlan, error) {
	jsonText, err := extractJSONText(raw)
	if err != nil {
		return agentStoryboardPlan{}, err
	}
	if err := validateStoryboardJSONFields(jsonText); err != nil {
		return agentStoryboardPlan{}, err
	}
	var plan agentStoryboardPlan
	if err := json.Unmarshal([]byte(jsonText), &plan); err != nil {
		return agentStoryboardPlan{}, fmt.Errorf("分镜 JSON 解析失败：%w", err)
	}
	plan.Title = defaultString(strings.TrimSpace(plan.Title), "影视分镜")
	plan.Logline = defaultString(strings.TrimSpace(plan.Logline), "根据剧情生成的分镜方案")
	plan.StyleGuide = defaultString(strings.TrimSpace(plan.StyleGuide), "严格沿用当前项目画风，保持角色、空间、道具、色彩和视觉媒介一致。")
	if len(plan.Shots) == 0 {
		return agentStoryboardPlan{}, errors.New("分镜模型没有返回 shots")
	}
	if len(plan.Shots) > 12 {
		return agentStoryboardPlan{}, fmt.Errorf("分镜数量最多 12 个，实际返回 %d 个", len(plan.Shots))
	}
	for i := range plan.Shots {
		if strings.TrimSpace(plan.Shots[i].Title) == "" {
			plan.Shots[i].Title = fmt.Sprintf("镜头 %d", i+1)
		}
		plan.Shots[i].CharacterIDs = nonNilStrings(plan.Shots[i].CharacterIDs)
		plan.Shots[i].AssetTags = nonNilStrings(plan.Shots[i].AssetTags)
		plan.Shots[i].Optional = nonNilStrings(plan.Shots[i].Optional)
		plan.Shots[i].Intent = defaultString(strings.TrimSpace(plan.Shots[i].Intent), strings.TrimSpace(plan.Shots[i].Description))
		plan.Shots[i].ViewerPOV = defaultString(strings.TrimSpace(plan.Shots[i].ViewerPOV), "客观观察当前主要角色与事件")
		plan.Shots[i].Performance = defaultString(strings.TrimSpace(plan.Shots[i].Performance), strings.TrimSpace(plan.Shots[i].Description))
		plan.Shots[i].ContinuityOut = defaultString(strings.TrimSpace(plan.Shots[i].ContinuityOut), "保持本镜头结尾的人物位置、动作状态、道具和光线方向进入下一镜")
		if len(plan.Shots[i].MustHave) == 0 {
			plan.Shots[i].MustHave = []string{"主要角色身份与当前版本稳定", "主要动作完成并有清晰落点", "结尾状态可供下一镜继承"}
		}
		if strings.TrimSpace(plan.Shots[i].VideoPrompt) == "" {
			plan.Shots[i].VideoPrompt = defaultString(plan.Shots[i].VisualPrompt, plan.Shots[i].Description)
		}
		if strings.TrimSpace(plan.Shots[i].VisualPrompt) == "" {
			return agentStoryboardPlan{}, fmt.Errorf("镜头 %d 缺少 visualPrompt", i+1)
		}
		if strings.TrimSpace(plan.Shots[i].Camera) == "" || strings.TrimSpace(plan.Shots[i].Motion) == "" || strings.TrimSpace(plan.Shots[i].TimeBeats) == "" {
			return agentStoryboardPlan{}, fmt.Errorf("镜头 %d 缺少 camera、motion 或 timeBeats", i+1)
		}
		if plan.Shots[i].Duration <= 0 || plan.Shots[i].Duration > 60 {
			return agentStoryboardPlan{}, fmt.Errorf("镜头 %d 的 durationSeconds 必须在 1 到 60 之间", i+1)
		}
	}
	return plan, nil
}

func validateStoryboardJSONFields(jsonText string) error {
	var root map[string]json.RawMessage
	if err := json.Unmarshal([]byte(jsonText), &root); err != nil {
		return fmt.Errorf("分镜 JSON 解析失败：%w", err)
	}
	for _, field := range []string{"title", "logline", "styleGuide", "characters", "locations", "shots"} {
		if _, ok := root[field]; !ok {
			return fmt.Errorf("分镜 JSON 缺少受保护字段 %s", field)
		}
	}
	var shots []map[string]json.RawMessage
	if err := json.Unmarshal(root["shots"], &shots); err != nil {
		return errors.New("分镜 JSON 的 shots 必须是数组")
	}
	required := []string{"title", "description", "durationSeconds", "dialogue", "characterIds", "narrativeIntent", "viewerPOV", "performanceBlocking", "shotSize", "emotion", "lightingAndAtmosphere", "audioEffects", "visualPrompt", "videoPrompt", "camera", "motion", "timeBeats", "mustHave", "optionalDetails", "continuityOut", "negativePrompt", "assetTags"}
	for index, shot := range shots {
		for _, field := range required {
			if _, ok := shot[field]; !ok {
				return fmt.Errorf("镜头 %d 缺少受保护字段 %s", index+1, field)
			}
		}
	}
	return nil
}

func nonNilStrings(values []string) []string {
	if values == nil {
		return []string{}
	}
	return values
}

func validateStoryboardContext(projectStyle storyboardProjectStyle, characters []storyboardCharacterCard) error {
	if strings.TrimSpace(projectStyle.PresetID) == "" || strings.TrimSpace(projectStyle.Title) == "" || strings.TrimSpace(projectStyle.Prompt) == "" {
		return errors.New("请先设置项目画风，再生成分镜")
	}
	for _, character := range characters {
		if strings.TrimSpace(character.AssetID) == "" || strings.TrimSpace(character.VersionID) == "" || strings.TrimSpace(character.Name) == "" {
			return errors.New("角色卡缺少当前资产版本，请刷新角色资产后再生成分镜")
		}
	}
	return nil
}

func validateStoryboardShotDuration(plan agentStoryboardPlan, target int) error {
	if target == 0 {
		return nil
	}
	if target != 5 && target != 10 && target != 15 && target != 30 {
		return fmt.Errorf("不支持的单镜头时长：%d 秒", target)
	}
	for index, shot := range plan.Shots {
		if shot.Duration != target {
			return fmt.Errorf("镜头 %d 的时长必须是 %d 秒", index+1, target)
		}
	}
	return nil
}

func validateStoryboardPlan(plan agentStoryboardPlan, shotDuration int, shotCount int, characters []storyboardCharacterCard) error {
	if utf8.RuneCountInString(strings.TrimSpace(plan.StyleGuide)) > 120 {
		return errors.New("styleGuide 最多 120 个中文字符")
	}
	if err := validateStoryboardShotDuration(plan, shotDuration); err != nil {
		return err
	}
	if err := validateStoryboardShotCount(plan, shotCount); err != nil {
		return err
	}
	if err := validateStoryboardCharacterIDs(plan, characters); err != nil {
		return err
	}
	return validateStoryboardComplexity(plan)
}

func validateStoryboardShotCount(plan agentStoryboardPlan, target int) error {
	if target == 0 {
		return nil
	}
	if target < 1 || target > 10 {
		return fmt.Errorf("分镜数量必须在 1 到 10 之间")
	}
	if len(plan.Shots) != target {
		return fmt.Errorf("分镜数量必须是 %d，实际生成 %d", target, len(plan.Shots))
	}
	return nil
}

func validateStoryboardComplexity(plan agentStoryboardPlan) error {
	issues := make([]string, 0)
	for index, shot := range plan.Shots {
		shotNumber := index + 1
		if len(shot.CharacterIDs) > 2 {
			issues = append(issues, fmt.Sprintf("镜头 %d 有 %d 名主要角色，最多 2 名", shotNumber, len(shot.CharacterIDs)))
		}
		if len(shot.MustHave) > 3 {
			issues = append(issues, fmt.Sprintf("镜头 %d 有 %d 个必须完成项，最多 3 个", shotNumber, len(shot.MustHave)))
		}
		if beats := storyboardBeatCount(shot.TimeBeats); beats > 3 {
			issues = append(issues, fmt.Sprintf("镜头 %d 有 %d 个时间节拍，最多 3 个", shotNumber, beats))
		}
		if movements := storyboardCameraMovementCount(shot.Motion); movements > 1 {
			issues = append(issues, fmt.Sprintf("镜头 %d 包含 %d 种主运镜，最多 1 种", shotNumber, movements))
		}
		dialogueLimit := max(24, shot.Duration*5)
		if dialogueLength := utf8.RuneCountInString(strings.TrimSpace(shot.Dialogue)); dialogueLength > dialogueLimit {
			issues = append(issues, fmt.Sprintf("镜头 %d 台词 %d 字，%d 秒镜头最多约 %d 字", shotNumber, dialogueLength, shot.Duration, dialogueLimit))
		}
	}
	if len(issues) == 0 {
		return nil
	}
	return fmt.Errorf("镜头复杂度超限：%s", strings.Join(issues, "；"))
}

func validateStoryboardCharacterIDs(plan agentStoryboardPlan, characters []storyboardCharacterCard) error {
	allowed := make(map[string]bool, len(characters))
	for _, character := range characters {
		allowed[character.AssetID] = true
	}
	for index, shot := range plan.Shots {
		for _, assetID := range shot.CharacterIDs {
			if !allowed[assetID] {
				return fmt.Errorf("镜头 %d 引用了不存在或非当前版本的角色 assetId：%s", index+1, assetID)
			}
		}
	}
	return nil
}

func storyboardRowCharacters(shot agentStoryboardShot, characters []storyboardCharacterCard) []map[string]any {
	byID := make(map[string]storyboardCharacterCard, len(characters))
	for _, character := range characters {
		byID[character.AssetID] = character
	}
	result := make([]map[string]any, 0, len(shot.CharacterIDs))
	for _, assetID := range shot.CharacterIDs {
		character, ok := byID[assetID]
		if !ok {
			continue
		}
		result = append(result, map[string]any{
			"characterName":      character.Name,
			"characterAssetId":   character.AssetID,
			"characterVersionId": character.VersionID,
		})
	}
	return result
}

func storyboardBeatCount(value string) int {
	parts := strings.FieldsFunc(value, func(r rune) bool { return r == '；' || r == ';' || r == '\n' })
	count := 0
	for _, part := range parts {
		if strings.TrimSpace(part) != "" {
			count++
		}
	}
	timecodeCount := len(storyboardTimecodePattern.FindAllString(value, -1))
	return max(count, timecodeCount)
}

var storyboardTimecodePattern = regexp.MustCompile(`\d+(?:\.\d+)?\s*[-~—至到]\s*\d+(?:\.\d+)?\s*秒`)

func storyboardCameraMovementCount(value string) int {
	movements := []string{"推进", "推近", "拉远", "摇摄", "横移", "侧移", "跟拍", "跟随", "升降", "上升", "下降", "环绕", "俯冲", "变焦", "甩镜", "穿越"}
	count := 0
	for _, movement := range movements {
		if strings.Contains(value, movement) {
			count++
		}
	}
	return count
}

func extractJSONText(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	trimmed = strings.TrimPrefix(trimmed, "```json")
	trimmed = strings.TrimPrefix(trimmed, "```")
	trimmed = strings.TrimSuffix(trimmed, "```")
	start := strings.Index(trimmed, "{")
	end := strings.LastIndex(trimmed, "}")
	if start < 0 || end < start {
		return "", errors.New("模型返回的不是 JSON")
	}
	return trimmed[start : end+1], nil
}

func (s *Service) buildAgentStoryboardResult(task model.Task, plan agentStoryboardPlan, assets []storyboardAsset, projectStyle storyboardProjectStyle) (map[string]interface{}, []map[string]interface{}, error) {
	prefix := "agent-" + task.ID
	scriptID := prefix + "-script"
	sceneID := prefix + "-scenes"
	styleID := prefix + "-style"
	referenceID := prefix + "-assets"
	finalID := prefix + "-final"
	sceneX := 380
	styleX := sceneX + 380
	ops := []map[string]any{
		nodeOpWithMetadata(scriptID, "text", "剧本 · "+shortTitle(plan.Title, 24), 0, 0, map[string]any{"workflowKind": "script", "workflowTitle": "剧本", "status": "success", "content": strings.Join([]string{plan.Title, "", plan.Logline, "", task.Prompt}, "\n")}),
		nodeOpWithMetadata(sceneID, "text", "场景设定", sceneX, 0, map[string]any{"workflowKind": "scene", "workflowTitle": "场景", "status": "success", "content": listContent("场景", plan.Locations)}),
		nodeOpWithMetadata(styleID, "text", "项目画风 · "+shortTitle(projectStyle.Title, 24), styleX, 0, map[string]any{"workflowKind": "styleboard", "workflowTitle": "项目画风", "workflowDescription": plan.StyleGuide, "stylePresetId": projectStyle.PresetID, "status": "success", "content": projectStyle.Prompt, "prompt": projectStyle.Prompt}),
		nodeOpWithMetadata(referenceID, "text", "参考素材组", 0, 270, map[string]any{"workflowKind": "reference_set", "workflowTitle": "参考素材组", "status": "success", "content": storyboardAssetsContent(assets)}),
		nodeOpWithMetadata(finalID, "video", "成片 · 待生成", styleX, 270, map[string]any{"workflowKind": "final", "workflowTitle": "成片", "status": "idle"}),
		connectOp(scriptID, sceneID),
	}
	resultShots := make([]map[string]any, 0, len(plan.Shots))
	for index, shot := range plan.Shots {
		videoPrompt, err := s.compileStoryboardVideoPrompt(task.UserID, projectStyle.Prompt, plan.StyleGuide, shot)
		if err != nil {
			return nil, nil, err
		}
		shotID := fmt.Sprintf("%s-shot-%d", prefix, index+1)
		matchedAssets := matchStoryboardAssetsForShot(assets, shot)
		assetIDs := make([]string, 0, len(matchedAssets))
		for _, asset := range matchedAssets {
			assetIDs = append(assetIDs, asset.ID)
		}
		ops = append(ops,
			nodeOpWithMetadata(shotID, "video", fmt.Sprintf("镜头 %d · %s", index+1, shortTitle(shot.Title, 18)), index*360, 560, map[string]any{
				"workflowKind":          "shot",
				"workflowTitle":         shot.Title,
				"workflowDescription":   shotDescription(shot),
				"shotIndex":             index + 1,
				"generationMode":        "video",
				"prompt":                videoPrompt,
				"composerContent":       shotComposerContent(videoPrompt, matchedAssets),
				"videoEditOperation":    "text_to_video",
				"assetTags":             shot.AssetTags,
				"referenceAssetNodeIds": assetIDs,
				"status":                "idle",
			}),
			connectOp(scriptID, shotID),
			connectOp(shotID, finalID),
		)
		for _, asset := range matchedAssets {
			ops = append(ops, connectOp(asset.ID, shotID))
		}
		resultShots = append(resultShots, map[string]any{"title": shot.Title, "description": shot.Description, "assetTags": shot.AssetTags, "referenceAssetNodeIds": assetIDs})
	}
	ops = append(ops, map[string]any{"type": "select_nodes", "ids": shotIDs(prefix, len(plan.Shots))})
	result := map[string]any{
		"taskId":     task.ID,
		"operation":  task.Operation,
		"provider":   defaultString(task.Provider, "internal-agent"),
		"model":      defaultString(task.Model, "workflow-router"),
		"title":      plan.Title,
		"logline":    plan.Logline,
		"styleGuide": plan.StyleGuide,
		"characters": plan.Characters,
		"locations":  plan.Locations,
		"shots":      resultShots,
	}
	return result, ops, nil
}

func extractStoryboardAssets(snapshot map[string]any) []storyboardAsset {
	rawNodes, _ := snapshot["nodes"].([]interface{})
	assets := make([]storyboardAsset, 0, len(rawNodes))
	for _, raw := range rawNodes {
		node, _ := raw.(map[string]interface{})
		if node == nil {
			continue
		}
		metadata, _ := node["metadata"].(map[string]interface{})
		if metadata == nil {
			metadata = map[string]interface{}{}
		}
		nodeType := stringValue(node["type"])
		isCharacterCard := stringValue(metadata["workflowKind"]) == "character" && stringValue(metadata["characterAssetId"]) != "" && stringValue(metadata["characterVersionId"]) != ""
		if nodeType != "image" && !isCharacterCard {
			continue
		}
		id := stringValue(node["id"])
		if id == "" {
			continue
		}
		tags := stringSlice(metadata["assetTags"])
		prompt := stringValue(metadata["prompt"])
		content := stringValue(metadata["content"])
		if len(tags) == 0 && prompt == "" && content == "" && !isCharacterCard {
			continue
		}
		assets = append(assets, storyboardAsset{
			ID:                 id,
			Title:              defaultString(stringValue(node["title"]), "未命名图片"),
			Type:               defaultString(nodeType, "reference"),
			Tags:               tags,
			Prompt:             prompt,
			CharacterAssetID:   stringValue(metadata["characterAssetId"]),
			CharacterVersionID: stringValue(metadata["characterVersionId"]),
		})
		if len(assets) >= 30 {
			break
		}
	}
	return assets
}

func matchStoryboardAssets(assets []storyboardAsset, shotTags []string) []storyboardAsset {
	wanted := map[string]bool{}
	for _, tag := range shotTags {
		for _, token := range storyboardTagTokens(tag) {
			wanted[token] = true
		}
	}
	if len(wanted) == 0 {
		return nil
	}
	matched := make([]storyboardAsset, 0)
	for _, asset := range assets {
		tokens := map[string]bool{}
		for _, token := range storyboardTagTokens(asset.Title) {
			tokens[token] = true
		}
		for _, tag := range asset.Tags {
			for _, token := range storyboardTagTokens(tag) {
				tokens[token] = true
			}
		}
		if storyboardTokensMatch(wanted, tokens) {
			matched = append(matched, asset)
		}
		if len(matched) >= 6 {
			break
		}
	}
	return matched
}

func matchStoryboardAssetsForShot(assets []storyboardAsset, shot agentStoryboardShot) []storyboardAsset {
	matched := make([]storyboardAsset, 0, 6)
	seen := make(map[string]bool, 6)
	wantedCharacters := make(map[string]bool, len(shot.CharacterIDs))
	for _, assetID := range shot.CharacterIDs {
		wantedCharacters[assetID] = true
	}
	for _, asset := range assets {
		if len(matched) >= 6 {
			break
		}
		if !seen[asset.ID] && wantedCharacters[asset.CharacterAssetID] {
			matched = append(matched, asset)
			seen[asset.ID] = true
		}
	}
	for _, asset := range matchStoryboardAssets(assets, shot.AssetTags) {
		if len(matched) >= 6 {
			break
		}
		if !seen[asset.ID] {
			matched = append(matched, asset)
			seen[asset.ID] = true
		}
	}
	return matched
}

func storyboardTokensMatch(wanted map[string]bool, tokens map[string]bool) bool {
	for want := range wanted {
		if tokens[want] {
			return true
		}
		for token := range tokens {
			if meaningfulStoryboardTagToken(want) && meaningfulStoryboardTagToken(token) && (strings.Contains(token, want) || strings.Contains(want, token)) {
				return true
			}
		}
	}
	return false
}

func storyboardTagTokens(value string) []string {
	normalized := strings.ToLower(strings.ReplaceAll(strings.Join(strings.Fields(strings.ReplaceAll(value, "：", ":")), ""), "，", ","))
	if normalized == "" {
		return nil
	}
	tokens := []string{normalized}
	if index := strings.Index(normalized, ":"); index >= 0 {
		tokens = append(tokens, normalized[index+1:])
	}
	unique := make([]string, 0, len(tokens))
	seen := map[string]bool{}
	for _, token := range tokens {
		if meaningfulStoryboardTagToken(token) && !seen[token] {
			seen[token] = true
			unique = append(unique, token)
		}
	}
	return unique
}

func meaningfulStoryboardTagToken(value string) bool {
	if len([]rune(value)) < 2 {
		return false
	}
	switch value {
	case "角色", "环境", "场景", "道具", "武器", "风格":
		return false
	}
	return true
}

func listContent(title string, items []string) string {
	if len(items) == 0 {
		return title + "\n\n- 暂无明确内容。"
	}
	lines := []string{title, ""}
	for _, item := range items {
		if strings.TrimSpace(item) != "" {
			lines = append(lines, "- "+item)
		}
	}
	return strings.Join(lines, "\n")
}

func storyboardAssetsContent(assets []storyboardAsset) string {
	if len(assets) == 0 {
		return "当前画布暂无可用图片资产。建议先给角色、环境、道具图片添加资产标签。"
	}
	lines := make([]string, 0, len(assets))
	for _, asset := range assets {
		line := asset.Title + "\nID: " + asset.ID
		if len(asset.Tags) > 0 {
			line += "\n标签: " + strings.Join(asset.Tags, "、")
		}
		if asset.Prompt != "" {
			line += "\n原提示词: " + asset.Prompt
		}
		lines = append(lines, line)
	}
	return strings.Join(lines, "\n\n")
}

func shotDescription(shot agentStoryboardShot) string {
	parts := []string{shot.Description}
	if strings.TrimSpace(shot.VisualPrompt) != "" {
		parts = append(parts, "画面提示词："+shot.VisualPrompt)
	}
	if strings.TrimSpace(shot.Camera) != "" {
		parts = append(parts, "镜头："+shot.Camera)
	}
	if strings.TrimSpace(shot.Motion) != "" {
		parts = append(parts, "运动："+shot.Motion)
	}
	if strings.TrimSpace(shot.TimeBeats) != "" {
		parts = append(parts, "时间节拍："+shot.TimeBeats)
	}
	filtered := make([]string, 0, len(parts))
	for _, part := range parts {
		if strings.TrimSpace(part) != "" {
			filtered = append(filtered, part)
		}
	}
	return strings.Join(filtered, "\n\n")
}

func storyboardImagePromptValues(projectStyle string, styleGuide string, shot agentStoryboardShot) map[string]string {
	negative := defaultString(strings.TrimSpace(shot.Negative), "禁止换脸、服装变化、手部畸形、乱码、风格突变和塑料材质")
	return map[string]string{
		"项目视觉":   storyboardProjectVisualSummary(projectStyle, styleGuide),
		"首帧构图":   compactPromptText(shot.VisualPrompt+"；光影："+shot.Lighting, 360),
		"表演起始状态": compactPromptText(shot.Performance, 180),
		"负面要求":   compactPromptText(negative, 140),
	}
}

func buildStoryboardImagePrompt(projectStyle string, styleGuide string, shot agentStoryboardShot) string {
	definition, _ := promptDefinition(promptOperationStoryboardFirstFrame)
	prompt, _ := renderPromptTemplate(definition, definition.DefaultContent, storyboardImagePromptValues(projectStyle, styleGuide, shot))
	return prompt
}

func (s *Service) compileStoryboardImagePrompt(userID string, projectStyle string, styleGuide string, shot agentStoryboardShot) (string, error) {
	compiled, err := s.compilePrompt(userID, promptOperationStoryboardFirstFrame, storyboardImagePromptValues(projectStyle, styleGuide, shot))
	return compiled.Content, err
}

func storyboardVideoPromptValues(projectStyle string, styleGuide string, shot agentStoryboardShot) map[string]string {
	camera := defaultString(strings.TrimSpace(shot.Camera), strings.TrimSpace(shot.ShotSize)+"，平视机位，中等焦段，主体与环境保持空间层次")
	motion := defaultString(strings.TrimSpace(shot.Motion), "固定机位，主体在画面内完成动作")
	timeBeats := defaultString(strings.TrimSpace(shot.TimeBeats), fmt.Sprintf("0-%d秒：%s", shot.Duration, strings.TrimSpace(shot.Description)))
	negative := defaultString(strings.TrimSpace(shot.Negative), "禁止换脸、服装变化、手部畸形、乱码、闪烁、风格突变和动作僵硬")
	values := map[string]string{
		"项目视觉":  storyboardProjectVisualSummary(projectStyle, styleGuide),
		"镜头意图":  compactPromptText(shot.Intent+"；观众视点："+shot.ViewerPOV+"；情绪："+shot.Emotion, 150),
		"首帧构图":  compactPromptText(shot.VisualPrompt+"；光影："+shot.Lighting, 280),
		"表演与调度": compactPromptText(shot.Performance, 180),
		"摄影机":   compactPromptText(strings.TrimSpace(shot.ShotSize)+"；"+camera+"；主运镜："+motion, 220),
		"时间节拍":  compactPromptText(timeBeats, 240),
		"运动与结尾": compactPromptText(shot.VideoPrompt+"；连续性结尾："+shot.ContinuityOut, 240),
		"声音":    compactPromptText(strings.TrimSpace(shot.Dialogue)+"；音效："+strings.TrimSpace(shot.AudioEffects), 160),
		"负面要求":  compactPromptText(negative, 160),
	}
	if len(shot.MustHave) > 0 {
		priority := "必须完成：" + strings.Join(shot.MustHave, "；")
		if len(shot.Optional) > 0 {
			priority += "。可以简化：" + strings.Join(shot.Optional, "；")
		}
		values["执行优先级"] = compactPromptText(priority, 140)
	}
	return values
}

func buildStoryboardVideoPrompt(projectStyle string, styleGuide string, shot agentStoryboardShot) string {
	definition, _ := promptDefinition(promptOperationStoryboardVideo)
	prompt, _ := renderPromptTemplate(definition, definition.DefaultContent, storyboardVideoPromptValues(projectStyle, styleGuide, shot))
	return prompt
}

func (s *Service) compileStoryboardVideoPrompt(userID string, projectStyle string, styleGuide string, shot agentStoryboardShot) (string, error) {
	compiled, err := s.compilePrompt(userID, promptOperationStoryboardVideo, storyboardVideoPromptValues(projectStyle, styleGuide, shot))
	return compiled.Content, err
}

func storyboardProjectVisualSummary(projectStyle string, styleGuide string) string {
	identity := ""
	for _, line := range strings.Split(projectStyle, "\n") {
		if strings.TrimSpace(line) != "" {
			identity = strings.TrimSpace(line)
			break
		}
	}
	parts := make([]string, 0, 2)
	if identity != "" {
		parts = append(parts, identity)
	}
	if strings.TrimSpace(styleGuide) != "" {
		parts = append(parts, strings.TrimSpace(styleGuide))
	}
	return compactPromptText(strings.Join(parts, "；"), 180)
}

func compactPromptText(value string, limit int) string {
	text := strings.TrimSpace(value)
	if utf8.RuneCountInString(text) <= limit {
		return text
	}
	runes := []rune(text)
	return strings.TrimSpace(string(runes[:limit])) + "。"
}

func shotComposerContent(prompt string, assets []storyboardAsset) string {
	if len(assets) == 0 {
		return prompt
	}
	lines := []string{"参考素材："}
	for _, asset := range assets {
		label := asset.Title
		if len(asset.Tags) > 0 {
			label += "（" + strings.Join(asset.Tags, "、") + "）"
		}
		lines = append(lines, "- "+label+"：@[node:"+asset.ID+"]")
	}
	lines = append(lines, "", "分镜视频提示词：", prompt)
	return strings.Join(lines, "\n")
}

func shotIDs(prefix string, count int) []string {
	ids := make([]string, 0, count)
	for index := 0; index < count; index++ {
		ids = append(ids, fmt.Sprintf("%s-shot-%d", prefix, index+1))
	}
	return ids
}

func stringSlice(value any) []string {
	items, ok := value.([]interface{})
	if !ok {
		text := stringValue(value)
		if text == "" {
			return nil
		}
		return []string{text}
	}
	result := make([]string, 0, len(items))
	for _, item := range items {
		if text := strings.TrimSpace(fmt.Sprint(item)); text != "" {
			result = append(result, text)
		}
	}
	return result
}

func stringValue(value any) string {
	text := strings.TrimSpace(fmt.Sprint(value))
	if text == "<nil>" {
		return ""
	}
	return text
}

func (s *Service) log(userID string, taskID string, level string, message string, payload string) error {
	return s.repo.Create(&model.TaskLog{ID: newID(), UserID: userID, TaskID: taskID, Level: level, Message: message, Payload: truncateTaskLogPayload(payload)})
}

func truncateTaskLogPayload(payload string) string {
	if len(payload) <= taskLogPayloadLimit {
		return payload
	}
	end := taskLogPayloadLimit
	for end > 0 && !utf8.ValidString(payload[:end]) {
		end--
	}
	return payload[:end] + fmt.Sprintf("\n...（日志内容已截断，原始长度 %d 字符）", len(payload))
}

func (s *Service) registerActiveTask(id string, cancel context.CancelFunc) {
	s.cancelMu.Lock()
	defer s.cancelMu.Unlock()
	s.activeCancels[id] = cancel
}

func (s *Service) unregisterActiveTask(id string) {
	s.cancelMu.Lock()
	defer s.cancelMu.Unlock()
	delete(s.activeCancels, id)
}

func (s *Service) cancelActiveTask(id string) {
	s.cancelMu.Lock()
	cancel := s.activeCancels[id]
	s.cancelMu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (s *Service) markSessionFailed(task model.Task, message string) error {
	if task.SessionID == "" {
		return nil
	}
	session, err := s.repo.SessionForUser(task.UserID, task.SessionID)
	if err != nil {
		return err
	}
	session.Status = model.SessionStatusFailed
	if err := s.repo.Save(session); err != nil {
		return err
	}
	return s.repo.Create(&model.Message{ID: newID(), UserID: task.UserID, SessionID: task.SessionID, Role: "assistant", Content: defaultString(message, "会话任务失败。")})
}

func buildAgentResult(task model.Task) (map[string]any, []map[string]any) {
	title := strings.TrimSpace(task.Prompt)
	if len([]rune(title)) > 28 {
		title = string([]rune(title)[:28]) + "..."
	}
	result := map[string]any{
		"taskId":    task.ID,
		"operation": task.Operation,
		"provider":  defaultString(task.Provider, "internal-agent"),
		"model":     defaultString(task.Model, "workflow-router"),
		"plan": []map[string]any{
			{"kind": "script", "title": "创意脚本", "content": task.Prompt},
			{"kind": "scene", "title": "主场景", "content": "根据用户输入拆解为可生成的视频场景。"},
			{"kind": "shot", "title": "镜头 1", "content": "建立画面、主体、风格和运镜。"},
			{"kind": "final", "title": "成片", "content": "等待视频生成 Provider 回填成片结果。"},
		},
	}
	ops := []map[string]any{
		nodeOp("script-"+task.ID, "text", "剧本 · "+title, 0, 0, "script", task.Prompt),
		nodeOp("scene-"+task.ID, "text", "场景 · 主场景", 380, 0, "scene", "主场景设定、角色关系、视觉风格。"),
		nodeOpWithMetadata("shot-"+task.ID, "video", "分镜 · 镜头 1", 760, 0, map[string]any{"workflowKind": "shot", "status": "idle", "generationMode": "video", "prompt": task.Prompt, "composerContent": task.Prompt, "videoEditOperation": "text_to_video"}),
		nodeOp("final-"+task.ID, "video", "成片 · 待生成", 1140, 0, "final", ""),
		connectOp("script-"+task.ID, "scene-"+task.ID),
		connectOp("scene-"+task.ID, "shot-"+task.ID),
		connectOp("shot-"+task.ID, "final-"+task.ID),
	}
	return result, ops
}

func buildVideoWorkflowResult(task model.Task) (map[string]any, []map[string]any) {
	title := strings.TrimSpace(task.Prompt)
	if len([]rune(title)) > 28 {
		title = string([]rune(title)[:28]) + "..."
	}
	operation := defaultString(task.Operation, strings.TrimPrefix(task.Type, "video_"))
	result := map[string]any{
		"taskId":    task.ID,
		"operation": operation,
		"provider":  defaultString(task.Provider, "internal-agent"),
		"model":     defaultString(task.Model, "workflow-router"),
		"plan": []map[string]any{
			{"kind": "reference_set", "title": "参考素材组", "content": "收集原视频、参考图、参考音频和版本样片。"},
			{"kind": "shot", "title": "编辑镜头", "content": task.Prompt},
			{"kind": "final", "title": "结果版本", "content": "等待 provider 生成或人工确认后回填版本结果。"},
		},
	}
	ops := []map[string]any{
		nodeOp("video-brief-"+task.ID, "text", "编辑需求 · "+title, 0, 0, "script", task.Prompt),
		nodeOpWithMetadata("video-ref-"+task.ID, "text", "参考素材组", 380, 0, map[string]any{"workflowKind": "reference_set", "status": "idle", "content": "原片、参考图、参考音频、风格板或历史版本。", "videoEditOperation": operation}),
		nodeOpWithMetadata("video-shot-"+task.ID, "video", "视频任务 · "+operation, 760, 0, map[string]any{"workflowKind": "shot", "status": "idle", "generationMode": "video", "prompt": task.Prompt, "composerContent": task.Prompt, "videoEditOperation": operation}),
		nodeOpWithMetadata("video-result-"+task.ID, "video", "结果版本 · 待回填", 1140, 0, map[string]any{"workflowKind": "final", "status": "idle", "videoEditOperation": operation, "versionLabel": "v1"}),
		connectOp("video-brief-"+task.ID, "video-ref-"+task.ID),
		connectOp("video-ref-"+task.ID, "video-shot-"+task.ID),
		connectOp("video-shot-"+task.ID, "video-result-"+task.ID),
	}
	return result, ops
}

func nodeOp(id string, nodeType string, title string, x int, y int, workflowKind string, content string) map[string]any {
	return nodeOpWithMetadata(id, nodeType, title, x, y, map[string]any{"content": content, "workflowKind": workflowKind, "status": "idle"})
}

func nodeOpWithMetadata(id string, nodeType string, title string, x int, y int, metadata map[string]any) map[string]any {
	return map[string]any{
		"type":     "add_node",
		"id":       id,
		"nodeType": nodeType,
		"title":    title,
		"position": map[string]int{"x": x, "y": y},
		"metadata": metadata,
	}
}

func connectOp(from string, to string) map[string]any {
	return map[string]any{"type": "connect_nodes", "fromNodeId": from, "toNodeId": to}
}

func ptr[T any](value T) *T {
	return &value
}

func shortTitle(value string, max int) string {
	title := strings.TrimSpace(value)
	if title == "" {
		title = "影视分镜"
	}
	if len([]rune(title)) > max {
		return string([]rune(title)[:max]) + "..."
	}
	return title
}

func defaultString(value string, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func newID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b[:])
}
