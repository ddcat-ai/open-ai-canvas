package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/gorm"
)

const (
	// 心跳会携带本机工作流字段和拓扑；允许大型 ComfyUI 工作流，但保留硬上限。
	comfyBridgeCapabilitiesLimit = 4 << 20
	// 请求主要是工作流和参考素材描述，保持较小上限控制排队内存；结果可能含 base64 视频，单独放宽但仍有硬上限。
	comfyBridgeRequestPayloadLimit = 16 << 20
	comfyBridgeResultPayloadLimit  = 64 << 20
	comfyBridgeMaxPending          = 32
	comfyBridgeRequestTTL          = 2 * time.Hour
	comfyBridgePollMaxWait         = 60 * time.Second
)

const (
	// ComfyBridgeRequestKindGenerate 是现有生成任务的请求类型。空 Kind 会在入队时归一化为该值，
	// 这样可以继续兼容已有调用方。
	ComfyBridgeRequestKindGenerate = "generate"
	// ComfyBridgeRequestKindWorkflowList 和 ComfyBridgeRequestKindWorkflowGet 只用于管理页按需发现。
	ComfyBridgeRequestKindWorkflowList = "workflow.list"
	ComfyBridgeRequestKindWorkflowGet  = "workflow.get"
)

// CreateComfyBridgeRequest 是用户注册本地 Bridge 时提交的公开信息。
// Bridge Token 由服务端生成，不接受客户端自带 Token，避免复用或弱 Token。
type CreateComfyBridgeRequest struct {
	Name         string         `json:"name"`
	Capabilities map[string]any `json:"capabilities,omitempty"`
}
type ComfyBridgeSummary struct {
	ID           string         `json:"id"`
	Name         string         `json:"name"`
	Enabled      bool           `json:"enabled"`
	Online       bool           `json:"online"`
	LastSeenAt   *time.Time     `json:"lastSeenAt,omitempty"`
	LastTaskAt   *time.Time     `json:"lastTaskAt,omitempty"`
	Capabilities map[string]any `json:"capabilities,omitempty"`
	CreatedAt    time.Time      `json:"createdAt"`
	UpdatedAt    time.Time      `json:"updatedAt"`
}

type ComfyBridgeRegistration struct {
	Bridge ComfyBridgeSummary `json:"bridge"`
	// Token 只在注册响应中出现一次，后续接口不会重新返回明文。
	Token string `json:"token"`
}

// ComfyBridgeRequest 是云端后端交给本地 Bridge 的一次请求。
// Payload 的协议由 Bridge 按 Kind 解释；生成请求和管理页发现请求共用同一条长轮询通道。
type ComfyBridgeRequest struct {
	ID        string         `json:"id"`
	Kind      string         `json:"kind"`
	TaskID    string         `json:"taskId,omitempty"`
	BridgeID  string         `json:"bridgeId"`
	Payload   map[string]any `json:"payload"`
	CreatedAt time.Time      `json:"createdAt"`
}

type ComfyBridgeCompletion struct {
	RequestID string         `json:"requestId,omitempty"`
	Status    string         `json:"status"`
	Result    map[string]any `json:"result,omitempty"`
	Error     string         `json:"error,omitempty"`
}

type comfyBridgeEnvelope struct {
	request ComfyBridgeRequest
	done    chan ComfyBridgeCompletion
}

// comfyBridgeQueue 只保存长轮询唤醒和当前进程等待者；请求状态与结果以数据库为准。
type comfyBridgeQueue struct {
	mu      sync.Mutex
	pending map[string]*comfyBridgeEnvelope
	notify  map[string]chan struct{}
}

var comfyBridgeRuntimes sync.Map // map[*Service]*comfyBridgeQueue

func (s *Service) comfyBridgeRuntime() *comfyBridgeQueue {
	if value, ok := comfyBridgeRuntimes.Load(s); ok {
		return value.(*comfyBridgeQueue)
	}
	runtime := &comfyBridgeQueue{
		pending: make(map[string]*comfyBridgeEnvelope),
		notify:  make(map[string]chan struct{}),
	}
	actual, _ := comfyBridgeRuntimes.LoadOrStore(s, runtime)
	return actual.(*comfyBridgeQueue)
}

func (s *Service) CreateComfyBridge(userID string, req CreateComfyBridgeRequest) (*ComfyBridgeRegistration, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, Unauthorized("请先登录")
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = "本地 ComfyUI Bridge"
	}
	if len([]rune(name)) > 80 {
		return nil, BadAuthRequest("Bridge 名称不能超过 80 个字符")
	}
	capabilitiesJSON := ""
	if req.Capabilities != nil {
		encoded, err := json.Marshal(req.Capabilities)
		if err != nil {
			return nil, BadAuthRequest("Bridge 能力信息格式无效")
		}
		if len(encoded) > comfyBridgeCapabilitiesLimit {
			return nil, BadAuthRequest("Bridge 能力信息不能超过 4MB")
		}
		capabilitiesJSON = string(encoded)
	}
	token := randomToken()
	now := time.Now()
	bridge := &model.ComfyBridge{
		ID:               newID(),
		UserID:           userID,
		Name:             name,
		TokenHash:        hashToken(token),
		Enabled:          true,
		CapabilitiesJSON: capabilitiesJSON,
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	if err := s.repo.Create(bridge); err != nil {
		return nil, err
	}
	return &ComfyBridgeRegistration{Bridge: comfyBridgeSummary(*bridge), Token: token}, nil
}

func (s *Service) ComfyBridges(userID string) ([]ComfyBridgeSummary, error) {
	bridges, err := s.repo.ComfyBridgesForUser(userID)
	if err != nil {
		return nil, err
	}
	items := make([]ComfyBridgeSummary, 0, len(bridges))
	for _, bridge := range bridges {
		items = append(items, comfyBridgeSummary(bridge))
	}
	return items, nil
}

func (s *Service) RevokeComfyBridge(userID string, bridgeID string) error {
	bridgeID = strings.TrimSpace(bridgeID)
	if bridgeID == "" {
		return BadAuthRequest("Bridge ID 不能为空")
	}
	if err := s.repo.DisableComfyBridge(userID, bridgeID, time.Now()); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return BadAuthRequest("Bridge 不存在或已撤销")
		}
		return err
	}
	_ = s.repo.FailComfyBridgeRequests(bridgeID, "Bridge 已撤销", time.Now())
	s.comfyBridgeRuntime().failBridge(bridgeID, errors.New("Bridge 已撤销"))
	return nil
}

// AuthenticateComfyBridge 校验 Bridge 专用 Token，并刷新心跳。
func (s *Service) AuthenticateComfyBridge(token string) (*model.ComfyBridge, error) {
	token = strings.TrimSpace(token)
	if len(token) < 32 || len(token) > 256 {
		return nil, Unauthorized("Bridge 令牌无效或已撤销")
	}
	bridge, err := s.repo.ComfyBridgeByTokenHash(hashToken(token))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, Unauthorized("Bridge 令牌无效或已撤销")
	}
	if err != nil {
		return nil, err
	}
	if err := s.repo.TouchComfyBridge(bridge.ID, time.Now()); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, Unauthorized("Bridge 令牌无效或已撤销")
		}
		return nil, err
	}
	return bridge, nil
}

func (s *Service) TouchComfyBridgeHeartbeat(bridgeID string, capabilities map[string]any) error {
	capabilitiesJSON := ""
	if capabilities != nil {
		encoded, err := json.Marshal(capabilities)
		if err != nil || len(encoded) > comfyBridgeCapabilitiesLimit {
			return BadAuthRequest("Bridge 能力信息格式无效或超过 4MB")
		}
		capabilitiesJSON = string(encoded)
	}
	if err := s.repo.UpdateComfyBridgeHeartbeat(strings.TrimSpace(bridgeID), capabilitiesJSON, time.Now()); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return Unauthorized("Bridge 令牌无效或已撤销")
		}
		return err
	}
	return nil
}

// EnqueueComfyBridgeRequest 将工作流请求持久化，并返回请求 ID。
func (s *Service) EnqueueComfyBridgeRequest(ctx context.Context, userID string, bridgeID string, taskID string, payload map[string]any) (*ComfyBridgeRequest, error) {
	return s.enqueueComfyBridgeRequest(ctx, userID, bridgeID, taskID, "", payload)
}

func (s *Service) enqueueComfyBridgeRequest(ctx context.Context, userID string, bridgeID string, taskID string, requestID string, payload map[string]any) (*ComfyBridgeRequest, error) {
	if err := contextError(ctx); err != nil {
		return nil, err
	}
	bridgeID = strings.TrimSpace(bridgeID)
	taskID = strings.TrimSpace(taskID)
	if bridgeID == "" || taskID == "" {
		return nil, BadAuthRequest("Bridge ID 和任务 ID 不能为空")
	}
	if payload == nil {
		return nil, BadAuthRequest("Bridge 请求内容不能为空")
	}
	bridge, err := s.repo.ComfyBridgeForUser(userID, bridgeID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, BadAuthRequest("Bridge 不存在或已撤销")
		}
		return nil, err
	}
	if !bridge.Enabled {
		return nil, BadAuthRequest("Bridge 不存在或已撤销")
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return nil, BadAuthRequest("Bridge 请求内容格式无效")
	}
	if len(encoded) > comfyBridgeRequestPayloadLimit {
		return nil, BadAuthRequest("Bridge 请求内容超过 16MB")
	}
	// Marshal/Unmarshal 生成独立副本，避免调用方在入队后继续修改 map 导致任务内容漂移。
	var copied map[string]any
	if err := json.Unmarshal(encoded, &copied); err != nil {
		return nil, BadAuthRequest("Bridge 请求内容必须是 JSON 对象")
	}
	requestID = strings.TrimSpace(requestID)
	if requestID == "" {
		if count, err := s.repo.PendingComfyBridgeRequestCount(bridgeID, time.Now()); err != nil {
			return nil, err
		} else if count >= comfyBridgeMaxPending {
			return nil, BadAuthRequest("该 Bridge 待处理请求过多，请稍后重试")
		}
		requestID = newID()
	}
	now := time.Now()
	record, created, err := s.repo.CreateOrGetComfyBridgeRequest(&model.ComfyBridgeRequest{
		ID: requestID, TaskID: taskID, UserID: userID, BridgeID: bridgeID, Kind: ComfyBridgeRequestKindGenerate,
		Status: "queued", PayloadJSON: string(encoded), ExpiresAt: now.Add(comfyBridgeRequestTTL), CreatedAt: now, UpdatedAt: now,
	})
	if err != nil {
		return nil, err
	}
	if record.UserID != userID || record.BridgeID != bridgeID || record.TaskID != taskID {
		return nil, Forbidden("Bridge 请求 ID 已被其他任务使用")
	}
	request, err := comfyBridgeRequestFromModel(*record)
	if err != nil {
		return nil, err
	}
	runtime := s.comfyBridgeRuntime()
	runtime.ensure(request)
	if created {
		runtime.signal(bridgeID)
	}
	if err := s.repo.MarkComfyBridgeTask(bridgeID, now); err != nil {
		if created {
			_ = s.repo.CancelComfyBridgeRequest(request.ID, time.Now())
			runtime.remove(request.ID)
		}
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, BadAuthRequest("Bridge 不存在或已撤销")
		}
		return nil, err
	}
	return request, nil
}

// PollComfyBridgeRequest 由本地 Bridge 调用。wait 为 0 时只检查当前队列。
func (s *Service) PollComfyBridgeRequest(ctx context.Context, bridge *model.ComfyBridge, wait time.Duration) (*ComfyBridgeRequest, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if bridge == nil || strings.TrimSpace(bridge.ID) == "" || !bridge.Enabled {
		return nil, Unauthorized("Bridge 令牌无效或已撤销")
	}
	if wait < 0 {
		wait = 0
	}
	if wait > comfyBridgePollMaxWait {
		wait = comfyBridgePollMaxWait
	}
	runtime := s.comfyBridgeRuntime()
	deadline := time.Now().Add(wait)
	for {
		record, err := s.repo.ClaimNextComfyBridgeRequest(bridge.ID, time.Now())
		if err != nil {
			return nil, err
		}
		if record != nil {
			request, err := comfyBridgeRequestFromModel(*record)
			if err != nil {
				_ = s.repo.CancelComfyBridgeRequest(record.ID, time.Now())
				return nil, err
			}
			runtime.ensure(request)
			if err := s.repo.MarkComfyBridgeTask(bridge.ID, time.Now()); err != nil {
				_ = s.repo.CancelComfyBridgeRequest(request.ID, time.Now())
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return nil, Unauthorized("Bridge 令牌无效或已撤销")
				}
				return nil, err
			}
			return request, nil
		}
		if wait == 0 {
			return nil, nil
		}
		remaining := time.Until(deadline)
		if remaining <= 0 {
			return nil, nil
		}
		channel := runtime.channel(bridge.ID)
		timer := time.NewTimer(remaining)
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				<-timer.C
			}
			return nil, ctx.Err()
		case <-timer.C:
			return nil, nil
		case <-channel:
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
		}
	}
}

// CompleteComfyBridgeRequest 将 Bridge 结果投递给等待该请求的后端 worker。
func (s *Service) CompleteComfyBridgeRequest(bridgeID string, completion ComfyBridgeCompletion) error {
	bridgeID = strings.TrimSpace(bridgeID)
	completion.RequestID = strings.TrimSpace(completion.RequestID)
	if bridgeID == "" || completion.RequestID == "" {
		return BadAuthRequest("Bridge ID 和请求 ID 不能为空")
	}
	completion.Status = strings.ToLower(strings.TrimSpace(completion.Status))
	if completion.Status == "" {
		completion.Status = "succeeded"
	}
	switch completion.Status {
	case "succeeded", "failed", "cancelled":
	default:
		return BadAuthRequest("Bridge 结果状态无效")
	}
	if len([]rune(completion.Error)) > 4000 {
		completion.Error = truncateRunes(completion.Error, 4000)
	}
	if completion.Result != nil {
		encoded, err := json.Marshal(completion.Result)
		if err != nil || len(encoded) > comfyBridgeResultPayloadLimit {
			return BadAuthRequest("Bridge 结果内容无效或超过 64MB")
		}
	}
	resultJSON := ""
	if completion.Result != nil {
		encoded, _ := json.Marshal(completion.Result)
		resultJSON = string(encoded)
	}
	if _, err := s.repo.CompleteComfyBridgeRequest(bridgeID, completion.RequestID, completion.Status, resultJSON, completion.Error, time.Now()); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return BadAuthRequest("Bridge 请求不存在或已过期")
		}
		if errors.Is(err, repository.ErrComfyBridgeRequestOwnership) {
			return Forbidden("Bridge 不能提交其他设备的请求")
		}
		if errors.Is(err, repository.ErrComfyBridgeRequestState) {
			return BadAuthRequest("Bridge 请求尚未领取")
		}
		return err
	}
	runtime := s.comfyBridgeRuntime()
	runtime.mu.Lock()
	envelope := runtime.pending[completion.RequestID]
	if envelope != nil {
		select {
		case envelope.done <- completion:
		default:
		}
	}
	runtime.mu.Unlock()
	return nil
}

// WaitComfyBridgeRequest 由生成 worker 调用，直到 Bridge 回传结果或任务被取消。
func (s *Service) WaitComfyBridgeRequest(ctx context.Context, requestID string) (ComfyBridgeCompletion, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	requestID = strings.TrimSpace(requestID)
	if requestID == "" {
		return ComfyBridgeCompletion{}, BadAuthRequest("Bridge 请求 ID 不能为空")
	}
	runtime := s.comfyBridgeRuntime()
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	for {
		record, err := s.repo.ComfyBridgeRequest(requestID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ComfyBridgeCompletion{}, BadAuthRequest("Bridge 请求不存在或已过期")
		}
		if err != nil {
			return ComfyBridgeCompletion{}, err
		}
		completion, terminal, err := comfyBridgeCompletionFromModel(*record)
		if err != nil {
			return ComfyBridgeCompletion{}, err
		}
		if terminal {
			runtime.remove(requestID)
			return completion, nil
		}
		request, err := comfyBridgeRequestFromModel(*record)
		if err != nil {
			return ComfyBridgeCompletion{}, err
		}
		envelope := runtime.ensure(request)
		select {
		case <-envelope.done:
			// 数据库已经在结果接口事务中落盘；下一轮统一从持久化记录读取。
		case <-ticker.C:
		case <-ctx.Done():
			_ = s.repo.CancelComfyBridgeRequest(requestID, time.Now())
			runtime.remove(requestID)
			return ComfyBridgeCompletion{}, ctx.Err()
		}
	}
}

// CancelComfyBridgeRequest 供任务取消路径清理尚未完成的 Bridge 请求。
func (s *Service) CancelComfyBridgeRequest(requestID string) {
	requestID = strings.TrimSpace(requestID)
	if requestID == "" {
		return
	}
	_ = s.repo.CancelComfyBridgeRequest(requestID, time.Now())
	runtime := s.comfyBridgeRuntime()
	runtime.remove(requestID)
}

func comfyBridgeRequestFromModel(record model.ComfyBridgeRequest) (*ComfyBridgeRequest, error) {
	payload := map[string]any{}
	if err := json.Unmarshal([]byte(record.PayloadJSON), &payload); err != nil {
		return nil, errors.New("Bridge 持久化请求内容无效")
	}
	return &ComfyBridgeRequest{ID: record.ID, Kind: record.Kind, TaskID: record.TaskID, BridgeID: record.BridgeID, Payload: payload, CreatedAt: record.CreatedAt}, nil
}

func comfyBridgeCompletionFromModel(record model.ComfyBridgeRequest) (ComfyBridgeCompletion, bool, error) {
	if record.Status != "succeeded" && record.Status != "failed" && record.Status != "cancelled" {
		return ComfyBridgeCompletion{}, false, nil
	}
	completion := ComfyBridgeCompletion{RequestID: record.ID, Status: record.Status, Error: record.Error}
	if strings.TrimSpace(record.ResultJSON) != "" {
		if err := json.Unmarshal([]byte(record.ResultJSON), &completion.Result); err != nil {
			return ComfyBridgeCompletion{}, false, errors.New("Bridge 持久化结果内容无效")
		}
	}
	return completion, true, nil
}

func (q *comfyBridgeQueue) ensure(request *ComfyBridgeRequest) *comfyBridgeEnvelope {
	q.mu.Lock()
	defer q.mu.Unlock()
	if envelope := q.pending[request.ID]; envelope != nil {
		return envelope
	}
	envelope := &comfyBridgeEnvelope{request: *request, done: make(chan ComfyBridgeCompletion, 1)}
	q.pending[request.ID] = envelope
	return envelope
}

func (q *comfyBridgeQueue) channel(bridgeID string) <-chan struct{} {
	q.mu.Lock()
	defer q.mu.Unlock()
	channel := q.notify[bridgeID]
	if channel == nil {
		channel = make(chan struct{}, 1)
		q.notify[bridgeID] = channel
	}
	return channel
}

func (q *comfyBridgeQueue) signal(bridgeID string) {
	q.mu.Lock()
	q.signalLocked(bridgeID)
	q.mu.Unlock()
}

func (q *comfyBridgeQueue) remove(requestID string) {
	q.mu.Lock()
	defer q.mu.Unlock()
	delete(q.pending, requestID)
}

func (q *comfyBridgeQueue) failBridge(bridgeID string, err error) {
	q.mu.Lock()
	defer q.mu.Unlock()
	message := "Bridge 请求失败"
	if err != nil {
		message = err.Error()
	}
	for id, envelope := range q.pending {
		if envelope == nil {
			delete(q.pending, id)
			continue
		}
		if envelope.request.BridgeID != bridgeID {
			continue
		}
		select {
		case envelope.done <- ComfyBridgeCompletion{RequestID: id, Status: "failed", Error: message}:
		default:
		}
		delete(q.pending, id)
	}
	q.signalLocked(bridgeID)
}

func (q *comfyBridgeQueue) signalLocked(bridgeID string) {
	channel := q.notify[bridgeID]
	if channel == nil {
		channel = make(chan struct{}, 1)
		q.notify[bridgeID] = channel
	}
	select {
	case channel <- struct{}{}:
	default:
	}
}

func comfyBridgeSummary(bridge model.ComfyBridge) ComfyBridgeSummary {
	result := ComfyBridgeSummary{ID: bridge.ID, Name: bridge.Name, Enabled: bridge.Enabled, LastSeenAt: bridge.LastSeenAt, LastTaskAt: bridge.LastTaskAt, CreatedAt: bridge.CreatedAt, UpdatedAt: bridge.UpdatedAt}
	result.Online = bridge.Enabled && bridge.LastSeenAt != nil && time.Since(*bridge.LastSeenAt) <= 90*time.Second
	if strings.TrimSpace(bridge.CapabilitiesJSON) != "" {
		var capabilities map[string]any
		if json.Unmarshal([]byte(bridge.CapabilitiesJSON), &capabilities) == nil && capabilities != nil {
			result.Capabilities = capabilities
		}
	}
	return result
}

func contextError(ctx context.Context) error {
	if ctx == nil {
		return nil
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
		return nil
	}
}
