package app

// 声明式协议插件宿主与接口类型校验。

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"yingce/backend/internal/protocol"
)

// runDeclarativeProtocolTask 是 JSON manifest 插件的宿主运行时。
// manifest 只能描述请求/响应映射；凭证、出站安全策略、轮询和结果下载必须由宿主统一掌握，
// 这样插件不能绕过服务端的鉴权、超时和 SSRF 防护边界。
func runDeclarativeProtocolTask(ctx context.Context, input canvasGenerationInput) (map[string]interface{}, error) {
	adapter, ok := declarativeProtocolAdapterForContext(ctx, input.Config.InterfaceType)
	if !ok {
		return nil, fmt.Errorf("接口类型 %s 未安装声明式适配器", input.Config.InterfaceType)
	}
	return runProtocolAdapterTask(ctx, input, adapter)
}

func runProtocolAdapterTask(ctx context.Context, input canvasGenerationInput, adapter protocol.Adapter) (map[string]interface{}, error) {
	return runProtocolAdapterTaskWithPolicy(ctx, input, adapter, declarativeProtocolPollPolicy(input.Mode))
}

func declarativeProtocolPollPolicy(mode string) videoPollPolicy {
	if mode == "video" {
		return defaultVideoPollPolicy()
	}
	return videoPollPolicy{
		Interval:            2500 * time.Millisecond,
		MaxNotFoundMisses:   1,
		MaxDownloadTries:    3,
		TransientRetryLimit: asyncPollTransientRetries(),
		Sleep:               sleepContext,
	}
}

// asyncPollTransientRetriesEnv 是可选设置：非视频声明式异步任务（图片、音频）轮询遇到暂时性错误时，
// 允许连续重试的次数，退避从轮询间隔起倍增、封顶 4 倍。默认 0，保持现有 fail-fast 行为。
const asyncPollTransientRetriesEnv = "CANVAS_ASYNC_POLL_TRANSIENT_RETRIES"

func asyncPollTransientRetries() int {
	value, err := strconv.Atoi(strings.TrimSpace(os.Getenv(asyncPollTransientRetriesEnv)))
	if err != nil || value <= 0 {
		return 0
	}
	return min(value, 10)
}

func runProtocolAdapterTaskWithPolicy(ctx context.Context, input canvasGenerationInput, adapter protocol.Adapter, policy videoPollPolicy) (map[string]interface{}, error) {
	// create、poll、download 是同一个外部任务的三个阶段：任一阶段失败都向上返回真实错误，
	// 不把“已提交但结果未知”伪装成成功，也不把下载失败降级成空结果。
	request := protocolRequestFromInput(input)
	taskID := resumedProviderRequestID(ctx)
	detached := protocolDetachedPolling(adapter, input.Mode)
	var created protocol.CreateResult
	if taskID == "" {
		// 幂等键只存在于宿主请求元数据中，声明式插件可以把它映射到 Header，
		// 但不能把宿主控制字段泄漏到供应商 JSON body。恢复已有 taskID 时不会进入 create 分支。
		key, _ := ctx.Value(providerSubmissionKeyContext{}).(string)
		if key == "" {
			key = uuid.NewString()
		}
		request.Extra["idempotencyKey"] = key
		if err := uploadProtocolMedia(ctx, input, adapter, &request); err != nil {
			return nil, err
		}
		spec, err := adapter.BuildCreate(ctx, protocol.RequestContext{BaseURL: input.Config.BaseURL, Request: request})
		if err != nil {
			return nil, err
		}
		if err := validateMediaTransportRequest(spec, input); err != nil {
			return nil, err
		}
		// 文本任务的创建与结果在同一次请求完成。宿主已知线格式（Chat Completions /
		// Responses / Messages）交给 executeProtocolCreateRequest：它负责流式 SSE 解析与
		// 增量推送，非流式走普通请求；否则下游 ParseCreate 会把 SSE 原始字节当 JSON 解析。
		if input.Mode == "text" {
			return finishDeclarativeTextCreate(ctx, input, adapter, request, spec, policy)
		}
		body, streamedResult, err := executeIdempotentProtocolCreate(ctx, input, spec, adapter.Metadata().IdempotentCreate)
		if err != nil {
			return nil, err
		}
		if streamedResult != nil {
			created = protocol.CreateResult{Status: protocol.StatusSucceeded, Result: streamedResult}
		} else {
			if parser, ok := adapter.(protocol.RequestAwareCreateParser); ok {
				created, err = parser.ParseCreateWithRequest(ctx, request, body)
			} else {
				created, err = adapter.ParseCreate(ctx, body)
			}
		}
		if err != nil {
			return nil, err
		}
		taskID = created.TaskID
		if taskID == "" {
			extracted, extractErr := extractProviderTaskID(body)
			if extractErr != nil {
				return nil, extractErr
			}
			taskID = extracted
		}
		if created.Status == protocol.StatusFailed || created.Status == protocol.StatusCancelled {
			return nil, protocolTaskFailure(ctx, created.Status, created.Message, taskID)
		}
		stage := created.Stage
		if created.Status == protocol.StatusSucceeded {
			// 已完成但还没有媒体：能按任务 ID 回查时转入轮询，在宽限期内等媒体地址。
			canPoll := taskID != "" && strings.TrimSpace(adapter.Metadata().Poll) != ""
			if protocolResultReady(input.Mode, created.Result, adapter) || !canPoll {
				result, err := finishProtocolAdapterResult(ctx, input, adapter, request, taskID, created.Result, policy)
				if !canPoll || !errors.Is(err, errProtocolResultNotReady) {
					return result, err
				}
			}
			stage = firstNonEmpty(stage, protocolLateResultStage)
		}
		if taskID == "" {
			return nil, errors.New("声明式协议创建请求没有返回任务 ID")
		}
		if detached {
			if err := recordProtocolProviderTask(ctx, taskID); err != nil {
				// 上游已收单但本地没记住任务 ID：不能退回调度，否则恢复时无法找到原任务。
				return nil, fmt.Errorf("上游已接收任务，但保存任务 ID 失败：%w", err)
			}
			return nil, detachedProtocolPending(taskID, stage, created.QueueAhead)
		}
	} else if detached {
		// 恢复分离式任务：立即回查一次，未完成就再次退回调度，不在 worker 内等待。
		policy.InitialDelay = 0
	}

	var lateResult protocolLateResultWait
	return runVideoPollLoop(ctx, taskID, policy, func(ctx context.Context) (videoPollOutcome, error) {
		spec, err := adapter.BuildPoll(ctx, protocol.PollContext{BaseURL: input.Config.BaseURL, Model: request.Model, Request: request, TaskID: taskID})
		if err != nil {
			return videoPollOutcome{}, err
		}
		body, err := executeProtocolRequest(withProviderRequestKind(ctx, "poll"), input.Config, spec)
		if err != nil {
			return videoPollOutcome{}, err
		}
		state, err := adapter.ParsePoll(ctx, protocol.PollContext{BaseURL: input.Config.BaseURL, Model: request.Model, Request: request, TaskID: taskID}, body)
		if err != nil {
			return videoPollOutcome{}, err
		}
		if state.TaskID != "" {
			taskID = state.TaskID
		}
		switch state.Status {
		case protocol.StatusSucceeded:
			// 分离式任务也留在本 worker 内等：退回调度后每次回查都会重新计时，宽限期永远用不完。
			if !protocolResultReady(input.Mode, state.Result, adapter) && lateResult.keepWaiting(time.Now()) {
				return videoPollOutcome{}, nil
			}
			result, err := finishProtocolAdapterResult(ctx, input, adapter, request, taskID, state.Result, policy)
			if errors.Is(err, errProtocolResultNotReady) && lateResult.keepWaiting(time.Now()) {
				return videoPollOutcome{}, nil
			}
			return videoPollOutcome{Done: err == nil, Result: result}, err
		case protocol.StatusFailed, protocol.StatusCancelled:
			return videoPollOutcome{}, protocolTaskFailure(ctx, state.Status, state.Message, taskID)
		}
		if detached {
			return videoPollOutcome{}, detachedProtocolPending(taskID, state.Stage, state.QueueAhead)
		}
		return videoPollOutcome{}, nil
	})
}

func extractProviderTaskID(body []byte) (string, error) {
	var payload map[string]interface{}
	if json.Unmarshal(body, &payload) != nil {
		return "", nil
	}
	id, err := firstJSONString(payload, "id", "task_id", "taskId", "request_id", "name")
	if id != "" {
		return id, nil
	}
	if data, ok := payload["data"].(map[string]interface{}); ok {
		nested, nestedErr := firstJSONString(data, "id", "task_id", "taskId", "request_id")
		if nested != "" {
			return nested, nil
		}
		if nestedErr != nil {
			return "", nestedErr
		}
	}
	return "", err
}

// queryProtocolAdapterVideoTask 只读取一次已有的声明式 Provider 任务。
// 人工恢复走此路径，因此检查本地失败任务时绝不会创建第二个计费任务。
func queryProtocolAdapterVideoTask(ctx context.Context, input canvasGenerationInput, adapter protocol.Adapter, taskID string) (map[string]interface{}, string, error) {
	request := protocolRequestFromInput(input)
	pollContext := protocol.PollContext{BaseURL: input.Config.BaseURL, Model: request.Model, Request: request, TaskID: taskID}
	spec, err := adapter.BuildPoll(ctx, pollContext)
	if err != nil {
		return nil, "", err
	}
	body, err := executeProtocolRequest(withProviderRequestKind(ctx, "poll"), input.Config, spec)
	if err != nil {
		return nil, "", err
	}
	state, err := adapter.ParsePoll(ctx, pollContext, body)
	if err != nil {
		return nil, "", err
	}
	providerStatus := string(state.Status)
	switch state.Status {
	case protocol.StatusSucceeded:
		result, err := finishProtocolAdapterResult(ctx, input, adapter, request, taskID, state.Result, defaultVideoPollPolicy())
		return result, providerStatus, err
	case protocol.StatusFailed, protocol.StatusCancelled:
		return nil, providerStatus, protocolTaskFailure(ctx, state.Status, state.Message, taskID)
	case protocol.StatusPending, protocol.StatusProcessing:
		return nil, providerStatus, nil
	default:
		return nil, providerStatus, fmt.Errorf("声明式协议任务 %s 返回未知状态：%s", taskID, providerStatus)
	}
}

func validateGenerationInterface(mode string, interfaceType string) error {
	// Standalone callers (including legacy tests and migration tools) may not
	// have a Service/plugin runtime. Use the shipped declarative catalog first;
	// fall back to host builtins only when the package catalog is unavailable.
	registry := loadOfficialFallbackRegistry()
	if registry == nil {
		registry = protocol.Builtins()
	} else if _, ok := registry.Resolve(strings.TrimSpace(interfaceType)); !ok {
		// A deployment may ship only a subset of the optional plugin catalog.
		// Preserve the host-backed builtins for standalone validation instead of
		// reporting a false "not installed" error for those interfaces.
		if _, builtinOK := protocol.Builtins().Resolve(strings.TrimSpace(interfaceType)); builtinOK {
			registry = protocol.Builtins()
		}
	}
	return validateGenerationInterfaceWithRegistry(registry, mode, interfaceType)
}

func (s *Service) validateGenerationInterface(mode string, interfaceType string) error {
	return validateGenerationInterfaceWithRegistry(s.protocolRegistry(), mode, interfaceType)
}

func validateGenerationInterfaceWithRegistry(registry *protocol.Registry, mode string, interfaceType string) error {
	interfaceType = strings.TrimSpace(interfaceType)
	if interfaceType == "" {
		return nil
	}
	adapter, ok := registry.Resolve(interfaceType)
	if !ok {
		return fmt.Errorf("接口类型 %s 未安装", interfaceType)
	}
	metadata := adapter.Metadata()
	if !metadata.Enabled || metadata.UnavailableReason != "" {
		return fmt.Errorf("接口类型 %s 当前不可用：%s", interfaceType, metadata.UnavailableReason)
	}
	if mode != "" && !protocolCapabilityMatches(metadata, protocol.Capability(mode)) {
		return fmt.Errorf("接口类型 %s 不支持%s生成", interfaceType, mode)
	}
	return nil
}

func protocolCapabilityMatches(metadata protocol.Metadata, capability protocol.Capability) bool {
	for _, item := range metadata.Categories {
		if item == capability {
			return true
		}
	}
	return false
}

// finishDeclarativeTextCreate 执行声明式文本协议的创建请求并归一结果。
// 文本任务的创建与最终结果在同一次请求完成：流式走 SSE 解析（executeProtocolCreateRequest
// 内部处理），非流式走普通请求后按插件 response 映射解析。SSE 原始字节不能交给
// ParseCreate 当 JSON 解析（上游如 DeepSeek /anthropic 的 thinking 流只在宿主解析器里
// 才能还原出正文）。
func finishDeclarativeTextCreate(ctx context.Context, input canvasGenerationInput, adapter protocol.Adapter, request protocol.GenerationRequest, spec protocol.RequestSpec, policy videoPollPolicy) (map[string]interface{}, error) {
	data, streamedResult, err := executeProtocolCreateRequest(ctx, input, spec)
	if err != nil {
		return nil, err
	}
	// 流式由宿主解析器直接给出文本结果；创建即完成，立即归一。
	if streamedResult != nil {
		return finishProtocolResult(ctx, input.Config, input.Mode, "", streamedResult, policy)
	}
	var created protocol.CreateResult
	if parser, ok := adapter.(protocol.RequestAwareCreateParser); ok {
		created, err = parser.ParseCreateWithRequest(ctx, request, data)
	} else {
		created, err = adapter.ParseCreate(ctx, data)
	}
	if err != nil {
		return nil, err
	}
	taskID := created.TaskID
	if taskID == "" {
		extracted, extractErr := extractProviderTaskID(data)
		if extractErr != nil {
			return nil, extractErr
		}
		taskID = extracted
	}
	if created.Status == protocol.StatusFailed || created.Status == protocol.StatusCancelled {
		return nil, protocolTaskFailure(ctx, created.Status, created.Message, taskID)
	}
	// 文本任务创建即完成：Succeeded、或状态未识别但已解析出正文，直接归一结果。
	if created.Status == protocol.StatusSucceeded || (created.Result != nil && strings.TrimSpace(created.Result.Text) != "") {
		return finishProtocolResult(ctx, input.Config, input.Mode, taskID, created.Result, policy)
	}
	if taskID == "" {
		return nil, errors.New("声明式协议创建请求没有返回任务 ID")
	}
	// 创建已接受但正文未就绪：转入轮询等待结果。
	return nil, detachedProtocolPending(taskID, created.Stage, created.QueueAhead)
}
