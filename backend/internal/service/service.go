package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

type Service struct {
	repo                       *repository.Repository
	dataDir                    string
	runtimeCapabilities        RuntimeCapabilities
	cancelMu                   sync.Mutex
	registrationMu             sync.Mutex
	emailCodeMu                sync.Mutex
	redeemBatchMu              sync.Mutex
	storageMu                  sync.Mutex
	characterTaskMu            sync.Mutex
	activeCancels              map[string]context.CancelFunc
	pendingStorage             map[string]int64
	coordinator                *runtimeCoordinator
	taskBillingCoordinator     *taskBillingCoordinator
	taskTerminalCoordinator    *taskTerminalCoordinator
	taskRouteExecutor          *taskRouteExecutor
	taskWorkerCoordinator      *taskWorkerCoordinator
	taskLifecycleCoordinator   *taskLifecycleCoordinator
	sessionCreationCoordinator *sessionCreationCoordinator
	sessionUploadCoordinator   *sessionUploadCoordinator
	runtimeErr                 error
	pluginRuntime              *pluginRuntime
	pluginRuntimeErr           error
	workerID                   string
	routeCatalogMu             sync.RWMutex
	routeCatalogRefreshMu      sync.Mutex
	routeCatalog               *routeCatalogSnapshot
	routeCatalogTTL            time.Duration
	routeCatalogMaxStale       time.Duration
	routeCatalogVersion        int64
	routeHealthMu              sync.Mutex
	routeHealthBlocked         map[string]time.Time
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
	LogicalModelID string                    `json:"logicalModelId"`
	TraceID        string                    `json:"-"`
	RequestID      string                    `json:"-"`
}

type CreateTaskRequest struct {
	SessionID      string         `json:"sessionId"`
	ProjectID      string         `json:"projectId"`
	Type           string         `json:"type"`
	Operation      string         `json:"operation"`
	Prompt         string         `json:"prompt"`
	Provider       string         `json:"provider"`
	Model          string         `json:"model"`
	LogicalModelID string         `json:"logicalModelId"`
	Input          map[string]any `json:"input"`
	TraceID        string         `json:"-"`
	RequestID      string         `json:"-"`
}

type SessionDetail struct {
	Session  model.Session   `json:"session"`
	Messages []model.Message `json:"messages"`
	Tasks    []TaskSummary   `json:"tasks"`
	Results  []model.Result  `json:"results"`
}

type TaskListOptions struct {
	Limit      int
	ProjectID  string
	ActiveOnly bool
}

func New(repo *repository.Repository, dataDir string) *Service {
	return NewWithRuntimeCapabilities(repo, dataDir, RuntimeCapabilities{})
}

func NewWithRuntimeCapabilities(repo *repository.Repository, dataDir string, capabilities RuntimeCapabilities) *Service {
	coordinator, err := newRuntimeCoordinator(repo.Dialect())
	pluginRuntime, pluginRuntimeErr := newPluginRuntime(dataDir)
	service := &Service{repo: repo, dataDir: dataDir, runtimeCapabilities: capabilities, activeCancels: make(map[string]context.CancelFunc), coordinator: coordinator, runtimeErr: err, pluginRuntime: pluginRuntime, pluginRuntimeErr: pluginRuntimeErr, workerID: newID(), routeCatalogTTL: 30 * time.Second, routeCatalogMaxStale: 5 * time.Minute, routeHealthBlocked: make(map[string]time.Time)}
	service.taskBillingCoordinator = newTaskBillingCoordinator(service.repo)
	service.taskTerminalCoordinator = newTaskTerminalCoordinator(service)
	service.taskRouteExecutor = newTaskRouteExecutor(service)
	service.taskWorkerCoordinator = newTaskWorkerCoordinator(service)
	service.taskLifecycleCoordinator = newTaskLifecycleCoordinator(service)
	service.sessionCreationCoordinator = newSessionCreationCoordinator(service)
	service.sessionUploadCoordinator = newSessionUploadCoordinator(service)
	return service
}

func (s *Service) taskBilling() *taskBillingCoordinator {
	if s.taskBillingCoordinator != nil {
		return s.taskBillingCoordinator
	}
	// 部分单元测试直接构造 Service 字面量；延迟创建保持这些测试和内部工具兼容。
	return newTaskBillingCoordinator(s.repo)
}

func (s *Service) StartWorker() {
	s.taskWorker().start()
	s.startResourceDeletionWorker()
}

func (s *Service) CreateSession(userID string, req CreateSessionRequest) (*SessionDetail, error) {
	return s.sessionCreation().create(userID, req)
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
	task.ProviderCancelStatus = latest.ProviderCancelStatus
	task.ProviderCancelError = latest.ProviderCancelError
	task.ProviderCancelAttempts = latest.ProviderCancelAttempts
	task.ProviderCancelRequestedAt = latest.ProviderCancelRequestedAt
	task.ProviderCancelledAt = latest.ProviderCancelledAt
	task.ProviderCancelNextCheckAt = latest.ProviderCancelNextCheckAt
	return nil
}

func (s *Service) RetryTask(userID string, id string) (*model.Task, error) {
	return s.taskLifecycle().retryTask(userID, id)
}

func (s *Service) CancelTask(ctx context.Context, userID string, id string) (*model.Task, error) {
	return s.taskLifecycle().cancelTask(ctx, userID, id)
}

func (s *Service) TaskLogs(userID string, id string) ([]model.TaskLog, error) {
	return s.repo.TaskLogs(userID, id)
}

func (s *Service) ProcessNextTask() error {
	return s.taskWorker().processNextTask()
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
	traceID := ""
	requestID := ""
	if taskID != "" {
		if task, err := s.repo.Task(taskID); err == nil {
			traceID = task.TraceID
			requestID = task.RequestID
		}
	}
	return s.repo.Create(&model.TaskLog{ID: newID(), UserID: userID, TaskID: taskID, TraceID: traceID, RequestID: requestID, Level: level, Message: message, Payload: truncateTaskLogPayload(payload)})
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
