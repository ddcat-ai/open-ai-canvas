package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"infinite-canvas/backend/internal/auth"
	"infinite-canvas/backend/internal/canvas"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/payment"
	"infinite-canvas/backend/internal/platform"
	"infinite-canvas/backend/internal/prompts"
	"infinite-canvas/backend/internal/repository"
	"infinite-canvas/backend/internal/skills"
	"infinite-canvas/backend/internal/tools"
)

type Service struct {
	repo                     *repository.Repository
	dataDir                  string
	cancelMu                 sync.Mutex
	registrationMu           sync.Mutex
	emailCodeMu              sync.Mutex
	redeemBatchMu            sync.Mutex
	storageMu                sync.Mutex
	storageTestMu            sync.Mutex
	workerRuntimeMu          sync.Mutex
	agentSchedulerMu         sync.Mutex
	agentSchedulerCursor     string
	agentConflictStreak      map[string]int
	activeStorageTests       map[string]bool
	characterTaskMu          sync.Mutex
	activeCancels            map[string]context.CancelFunc
	pendingStorage           map[string]int64
	coordinator              *platform.Coordinator
	platform                 *platform.Service
	taskBillingCoordinator   *taskBillingCoordinator
	taskTerminalCoordinator  *taskTerminalCoordinator
	taskRouteExecutor        *taskRouteExecutor
	taskWorkerCoordinator    *taskWorkerCoordinator
	taskLifecycleCoordinator *taskLifecycleCoordinator
	runtimeErr               error
	pluginRuntime            *pluginRuntime
	pluginRuntimeErr         error
	paymentRegistry          *payment.Registry
	workerID                 string
	routeCatalogMu           sync.RWMutex
	routeCatalogRefreshMu    sync.Mutex
	routeCatalog             *routeCatalogSnapshot
	routeCatalogTTL          time.Duration
	routeCatalogMaxStale     time.Duration
	routeCatalogVersion      int64
	routeHealthMu            sync.Mutex
	routeHealthBlocked       map[string]time.Time
	workers                  *platform.Worker
	updateManager            UpdateManager
	readCachesOnce           sync.Once
	concurrencyReadCache     *platform.BoundedReadCache[string, platform.RuntimeTaskPolicy]
	textReplayReadCache      *platform.BoundedReadCache[textReplayCacheKey, *TextReplayResult]
	routeVersionReadCache    *platform.BoundedReadCache[string, int64]
	routeCatalogRetryAt      time.Time
	routeCatalogRefreshError error
	skills                   *skills.Service
	tools                    *tools.Service
	prompts                  *prompts.Service
	auth                     *auth.Service
	canvas                   *canvas.Service
}

const taskWorkerConcurrency = 3
const taskLogPayloadLimit = 4000

type CreateTaskRequest struct {
	creationPrepare *creationTaskPreparation
	admission       *taskAdmission
	ProjectID       string         `json:"projectId"`
	Type            string         `json:"type"`
	Operation       string         `json:"operation"`
	Prompt          string         `json:"prompt"`
	Provider        string         `json:"provider"`
	Model           string         `json:"model"`
	LogicalModelID  string         `json:"logicalModelId"`
	Input           map[string]any `json:"input"`
	TraceID         string         `json:"-"`
	RequestID       string         `json:"-"`
}

type TaskListOptions struct {
	Limit      int
	ProjectID  string
	ActiveOnly bool
}

func New(repo *repository.Repository, dataDir string) *Service {
	return newService(repo, dataDir)
}

func newService(repo *repository.Repository, dataDir string) *Service {
	coordinator, err := platform.NewCoordinator(repo.Dialect())
	pluginRuntime, pluginRuntimeErr := newPluginRuntime(dataDir)
	paymentRegistry, _ := payment.NewRegistry()
	if pluginRuntime != nil {
		if dynamic := pluginRuntime.paymentRegistrySnapshot(); dynamic != nil {
			paymentRegistry = dynamic
		}
	}
	service := &Service{repo: repo, dataDir: dataDir, activeStorageTests: make(map[string]bool), activeCancels: make(map[string]context.CancelFunc), agentConflictStreak: make(map[string]int), coordinator: coordinator, runtimeErr: err, pluginRuntime: pluginRuntime, pluginRuntimeErr: pluginRuntimeErr, paymentRegistry: paymentRegistry, workerID: newID(), routeCatalogTTL: 30 * time.Second, routeCatalogMaxStale: 5 * time.Minute, routeHealthBlocked: make(map[string]time.Time)}
	service.taskBillingCoordinator = newTaskBillingCoordinator(service.repo)
	service.taskTerminalCoordinator = newTaskTerminalCoordinator(service)
	service.taskRouteExecutor = newTaskRouteExecutor(service)
	service.taskWorkerCoordinator = newTaskWorkerCoordinator(service)
	service.taskLifecycleCoordinator = newTaskLifecycleCoordinator(service)
	service.skills = skills.New(service.repo, service.dataDir, service.runWorkerLoop)
	service.tools = tools.New(service.repo)
	service.prompts = prompts.New(service.repo, promptAdminGate{svc: service})
	service.auth = auth.New(service.repo, authHost{svc: service}, nil)
	service.canvas = canvas.New(service.repo, canvasHost{svc: service})
	service.platform = platform.New(service.repo, coordinator, platformHost{svc: service})
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
	runtime := s.backgroundWorkers()
	ctx, started := runtime.Start()
	if !started {
		return
	}
	s.taskWorker().start(ctx)
	s.startResourceDeletionWorker(ctx)
	s.startSkillSyncWorker(ctx)
	s.startPaymentWorker(ctx)
}

func (s *Service) BeginDrain() { s.backgroundWorkers().BeginDrain() }

func (s *Service) StopWorker(ctx context.Context) error { return s.backgroundWorkers().Stop(ctx) }

func (s *Service) IsDraining() bool { return s.backgroundWorkers().IsDraining() }

func (s *Service) ActiveWorkerTasks() int64 { return s.backgroundWorkers().ActiveTaskCount() }

func (s *Service) backgroundWorkers() *platform.Worker {
	s.workerRuntimeMu.Lock()
	defer s.workerRuntimeMu.Unlock()
	if s.workers == nil {
		s.workers = &platform.Worker{}
	}
	return s.workers
}

func (s *Service) runWorkerLoop(fn func(context.Context)) bool {
	return s.backgroundWorkers().GoLoop(fn)
}

func (s *Service) runWorkerTask(fn func()) bool {
	return s.backgroundWorkers().GoTask(fn)
}

func channelModelNames(channel model.ModelChannel) []string {
	models := []string{}
	_ = json.Unmarshal([]byte(channel.ModelsJSON), &models)
	return uniqueNonEmpty(models)
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
	return kernel.Ptr(value)
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
	return kernel.DefaultString(value, fallback)
}

func newID() string {
	return kernel.NewID()
}
