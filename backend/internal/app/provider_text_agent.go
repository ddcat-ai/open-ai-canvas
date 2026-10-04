// Agent 模型步的上游请求：OpenAI Responses / Chat Completions / Claude 三种协议的工具调用请求体、
// 工具选择兼容降级与非流式响应解析。
//
// 部分上游不支持 tool_choice=required 等写法，遇到兼容性错误时退回 auto 重试一次。

package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/protocol"
)

func runAgentToolTask(ctx context.Context, input canvasGenerationInput) (map[string]interface{}, error) {
	// 浏览器持久化的是协议中立请求；资源水合和模型路由完成后才展开上游协议，
	// 防止供应商请求体反向污染任务记录，也避免切换模型时复用错误协议。
	if input.AgentRequests != nil && input.AgentRequests.Canonical != nil {
		_, declarative := agentProtocolAdapterForContext(ctx, input.Config.InterfaceType)
		requests, err := expandCanonicalAgentRequest(input.AgentRequests.Canonical, input.Config, declarative)
		if err != nil {
			return nil, err
		}
		input.AgentRequests = requests
	}
	if adapter, ok := agentProtocolAdapterForContext(ctx, input.Config.InterfaceType); ok {
		return runDeclarativeAgentTask(ctx, input, adapter)
	}
	if input.AgentRequests == nil {
		return nil, errors.New("画布 Agent 工具请求缺少协议参数")
	}
	request := input.AgentRequests.ChatCompletion
	path := "/chat/completions"
	protocol := "chat-completion"
	if input.Config.InterfaceType == string(model.ChannelInterfaceOpenAIResponse) {
		request = input.AgentRequests.Responses
		path = "/responses"
		protocol = "responses"
	} else if input.Config.InterfaceType == string(model.ChannelInterfaceClaudeAPI) {
		if input.AgentRequests.Claude != nil {
			request = input.AgentRequests.Claude
		}
		path = "/messages"
		protocol = "claude-api"
	}
	if request == nil {
		return nil, errors.New("画布 Agent 工具请求缺少协议参数")
	}
	body := cloneStringAnyMap(request)
	if protocol == "claude-api" && input.AgentRequests.Claude == nil {
		body = claudeAgentBody(body)
	}
	body["model"] = input.Config.Model
	applyTextThinking(body, input, protocol)
	applyAgentOutputLimit(body, agentStepOutputLimit(input), protocol)
	normalizeAgentToolChoice(body, input, protocol)
	result, err := postAgentRequest(ctx, input, path, body, protocol)
	if protocol == "chat-completion" && isAgentToolChoiceCompatibilityError(err) {
		if !isAutoAgentToolChoice(body["tool_choice"]) {
			autoBody := cloneStringAnyMap(body)
			autoBody["tool_choice"] = "auto"
			result, err = postAgentRequest(ctx, input, path, autoBody, protocol)
		}
		if isAgentToolChoiceCompatibilityError(err) {
			withoutToolChoice := cloneStringAnyMap(body)
			delete(withoutToolChoice, "tool_choice")
			result, err = postAgentRequest(ctx, input, path, withoutToolChoice, protocol)
		}
	}
	if err != nil {
		return nil, err
	}
	return result, nil
}

func postAgentRequest(ctx context.Context, input canvasGenerationInput, path string, body map[string]interface{}, protocol string) (map[string]interface{}, error) {
	if input.StreamText {
		return postStreamingAgent(ctx, input.Config, path, body, protocol, input.OnTextDelta, input.OnReasoningDelta)
	}
	delete(body, "stream")
	var payload map[string]interface{}
	if err := postJSON(ctx, input.Config, path, body, &payload); err != nil {
		return nil, err
	}
	return parseAgentToolPayload(payload, protocol)
}

// agentStepOutputLimit 取本次 Agent 调用的输出上限。
//
// 两个来源语义相同但通道不同：textOptions.maxOutputTokens 是任务信封里下发的策略值
// （画布 Agent 每步按运行时策略给，persist 在任务输入里，重启后仍在）；input.MaxOutputTokens
// 是进程内直传的旧入口（渠道模型能力声明）。都为 0 时不写上限字段，交给上游按剩余上下文放行。
// 都非零时取较小值：策略上限不该超过模型自己声明的物理上限。
func agentStepOutputLimit(input canvasGenerationInput) int {
	limits := []int{input.TextOptions.MaxOutputTokens, input.MaxOutputTokens}
	limit := 0
	for _, candidate := range limits {
		if candidate <= 0 {
			continue
		}
		if limit == 0 || candidate < limit {
			limit = candidate
		}
	}
	return limit
}

// applyAgentOutputLimit 按协议写入输出上限字段名：Claude 与 Chat Completions 用 max_tokens，
// Responses 用 max_output_tokens。
func applyAgentOutputLimit(body map[string]interface{}, limit int, protocol string) {
	if limit <= 0 {
		return
	}
	field := "max_tokens"
	if protocol == "responses" {
		field = "max_output_tokens"
	}
	applyTextOutputLimit(body, limit, field)
}

func runDeclarativeAgentTask(ctx context.Context, input canvasGenerationInput, adapter protocol.AgentAdapter) (map[string]interface{}, error) {
	wire := input.Config.InterfaceType
	if wire == string(model.ChannelInterfaceOpenAIResponse) {
		wire = "responses"
	}
	knownWire := wire == "chat-completion" || wire == "responses" || wire == "claude-api"
	if input.TextOptions.Thinking && !knownWire {
		return nil, errors.New("当前声明式 Agent 渠道尚不支持思考模式，请关闭思考模式或切换内置协议渠道")
	}
	if input.AgentRequests == nil {
		return nil, errors.New("画布 Agent 工具请求缺少协议参数")
	}
	request := map[string]any{
		"chatCompletion": input.AgentRequests.ChatCompletion,
		"responses":      input.AgentRequests.Responses,
		"claude":         input.AgentRequests.Claude,
		"gemini":         input.AgentRequests.Gemini,
	}
	spec, err := adapter.BuildAgent(ctx, protocol.AgentRequestContext{BaseURL: input.Config.BaseURL, Model: input.Config.Model, Request: request})
	if err != nil {
		return nil, err
	}
	if knownWire {
		body := protocolBodyObject(spec.Body)
		if body == nil {
			return nil, errors.New("声明式 Agent 请求体必须是 JSON 对象")
		}
		applyTextThinking(body, input, wire)
		applyAgentOutputLimit(body, agentStepOutputLimit(input), wire)
		normalizeAgentToolChoice(body, input, wire)
		spec.Body = body
		if input.StreamText {
			body["stream"] = true
			if wire == "chat-completion" {
				if err := ensureChatCompletionStreamUsage(body); err != nil {
					return nil, err
				}
			}
			parser := newStreamingAgentParser(wire, input.OnTextDelta)
			parser.emitReasoning = input.OnReasoningDelta
			data, mime, err := executeProtocolBinaryRequestWithConsumer(ctx, input.Config, spec, parser.consume)
			if err != nil {
				return nil, err
			}
			if strings.Contains(strings.ToLower(mime), "event-stream") {
				parser.flush()
				return parser.result()
			}
			var payload map[string]interface{}
			if err := json.Unmarshal(data, &payload); err != nil {
				return nil, fmt.Errorf("Agent 接口返回格式无效：%w", err)
			}
			return parseAgentToolPayload(payload, wire)
		}
	}
	body, err := executeDeclarativeAgentWithGeminiCache(ctx, input, spec)
	if err != nil {
		return nil, err
	}
	parsed, err := adapter.ParseAgent(ctx, body)
	if err != nil {
		return nil, err
	}
	result := map[string]interface{}{"mode": "text", "text": parsed.Text, "toolCalls": []interface{}{}}
	if parsed.Reasoning != "" {
		result["reasoning"] = parsed.Reasoning
	}
	calls := make([]interface{}, 0, len(parsed.ToolCalls))
	for _, call := range parsed.ToolCalls {
		mapped := map[string]interface{}{
			"id":       call.ID,
			"type":     "function",
			"function": map[string]interface{}{"name": call.Name, "arguments": call.Arguments},
		}
		if call.ThoughtSignature != "" {
			mapped["thoughtSignature"] = call.ThoughtSignature
		}
		calls = append(calls, mapped)
	}
	result["toolCalls"] = calls
	if strings.TrimSpace(parsed.Text) == "" && len(calls) == 0 {
		return nil, errors.New("声明式 Agent 接口没有返回内容")
	}
	return result, nil
}

// executeDeclarativeAgentWithGeminiCache keeps explicit Prompt Cache entirely
// optional: cache creation, cleanup, and a single stale-cache rebuild can never
// turn a valid uncached Agent request into a failed run.
func executeDeclarativeAgentWithGeminiCache(ctx context.Context, input canvasGenerationInput, spec protocol.RequestSpec) ([]byte, error) {
	baseSpec, err := cloneProtocolRequestSpec(spec)
	if err != nil {
		return nil, err
	}
	executeSpec := baseSpec
	cacheUsed := false
	if input.Config.InterfaceType == officialGeminiAgentInterface {
		prepared, used, prepareErr := prepareOfficialGeminiAgentCache(ctx, input, baseSpec)
		if prepareErr != nil {
			log.Printf("gemini agent prompt cache unavailable: model=%s reason=%s", safeProviderModel(input.Config.Model), safeProviderLogError(prepareErr))
		} else {
			executeSpec, cacheUsed = prepared, used
		}
	}
	body, err := executeProtocolRequest(ctx, input.Config, executeSpec)
	if err == nil || input.Config.InterfaceType != officialGeminiAgentInterface || !cacheUsed || !geminiRequestUsesCachedContent(executeSpec) || !isGeminiCachedContentNotFound(err, stringValue(protocolBodyObject(executeSpec.Body)["cachedContent"])) {
		return body, err
	}

	resourceName := ""
	if body := protocolBodyObject(executeSpec.Body); body != nil {
		resourceName, _ = body["cachedContent"].(string)
	}
	if invalidateErr := invalidateOfficialGeminiAgentCache(ctx, input, baseSpec, resourceName); invalidateErr != nil {
		// The local identity is still removed whenever possible. Do not replace a
		// provider 404 with a cache bookkeeping error or skip the one rebuild.
		log.Printf("gemini agent prompt cache invalidation failed: model=%s reason=%s", safeProviderModel(input.Config.Model), safeProviderLogError(invalidateErr))
	}
	rebuilt, _, prepareErr := prepareOfficialGeminiAgentCacheMode(ctx, input, baseSpec, true)
	if prepareErr != nil {
		log.Printf("gemini agent prompt cache rebuild unavailable: model=%s reason=%s", safeProviderModel(input.Config.Model), safeProviderLogError(prepareErr))
		rebuilt = baseSpec
	}
	// The rebuilt request is intentionally executed only once. If it receives
	// another CachedContent 404, the first stale-cache recovery already happened;
	// preserve the provider error instead of recursively rebuilding forever.
	return executeProtocolRequest(ctx, input.Config, rebuilt)
}

func claudeAgentBody(request map[string]interface{}) map[string]interface{} {
	body := map[string]interface{}{"max_tokens": 4096}
	if messages, ok := request["messages"].([]interface{}); ok {
		claudeMessages := make([]interface{}, 0, len(messages))
		var system []string
		for _, value := range messages {
			message, _ := value.(map[string]interface{})
			role := strings.ToLower(strings.TrimSpace(stringField(message, "role")))
			if role == "system" {
				if content := strings.TrimSpace(fmt.Sprint(message["content"])); content != "" {
					system = append(system, content)
				}
				continue
			}
			if role == "tool" {
				claudeMessages = append(claudeMessages, map[string]interface{}{"role": "user", "content": []interface{}{map[string]interface{}{
					"type": "tool_result", "tool_use_id": stringField(message, "tool_call_id"), "content": fmt.Sprint(message["content"]),
				}}})
				continue
			}
			role = mapClaudeMessageRole(role)
			content := message["content"]
			if content == nil {
				content = ""
			}
			if toolCalls, ok := message["tool_calls"].([]interface{}); ok && len(toolCalls) > 0 {
				blocks := make([]interface{}, 0, len(toolCalls))
				for _, value := range toolCalls {
					toolCall, _ := value.(map[string]interface{})
					function, _ := toolCall["function"].(map[string]interface{})
					blocks = append(blocks, map[string]interface{}{
						"type": "tool_use", "id": stringField(toolCall, "id"), "name": stringField(function, "name"), "input": claudeToolInput(function["arguments"]),
					})
				}
				content = blocks
			}
			claudeMessages = append(claudeMessages, map[string]interface{}{"role": role, "content": content})
		}
		body["messages"] = claudeMessages
		if len(system) > 0 {
			body["system"] = []interface{}{map[string]interface{}{
				"type": "text", "text": strings.Join(system, "\n\n"),
				"cache_control": map[string]interface{}{"type": "ephemeral"},
			}}
		}
	}
	if tools, ok := request["tools"].([]interface{}); ok && len(tools) > 0 {
		claudeTools := make([]interface{}, 0, len(tools))
		for _, value := range tools {
			tool, _ := value.(map[string]interface{})
			function, _ := tool["function"].(map[string]interface{})
			if len(function) == 0 {
				continue
			}
			claudeTools = append(claudeTools, map[string]interface{}{
				"name": stringField(function, "name"), "description": stringField(function, "description"), "input_schema": function["parameters"],
			})
		}
		if len(claudeTools) > 0 {
			if last, ok := claudeTools[len(claudeTools)-1].(map[string]interface{}); ok {
				last["cache_control"] = map[string]interface{}{"type": "ephemeral"}
			}
			body["tools"] = claudeTools
		}
	}
	if choice, ok := request["tool_choice"]; ok {
		body["tool_choice"] = claudeToolChoice(choice)
	}
	return body
}

func mapClaudeMessageRole(role string) string {
	if role == "assistant" {
		return "assistant"
	}
	return "user"
}

func claudeToolInput(value interface{}) interface{} {
	if raw, ok := value.(string); ok {
		var parsed interface{}
		if json.Unmarshal([]byte(raw), &parsed) == nil && parsed != nil {
			return parsed
		}
	}
	if value != nil {
		return value
	}
	return map[string]interface{}{}
}

func claudeToolChoice(value interface{}) interface{} {
	switch choice := value.(type) {
	case string:
		switch strings.ToLower(strings.TrimSpace(choice)) {
		case "required":
			return map[string]interface{}{"type": "any"}
		case "none":
			return map[string]interface{}{"type": "auto"}
		default:
			return map[string]interface{}{"type": "auto"}
		}
	case map[string]interface{}:
		if function, ok := choice["function"].(map[string]interface{}); ok && stringField(function, "name") != "" {
			return map[string]interface{}{"type": "tool", "name": stringField(function, "name")}
		}
		if name := stringField(choice, "name"); name != "" {
			return map[string]interface{}{"type": "tool", "name": name}
		}
	}
	return map[string]interface{}{"type": "auto"}
}

func isAgentToolChoiceCompatibilityError(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	var payloadErr providerPayloadError
	if errors.As(err, &payloadErr) {
		message += " " + strings.ToLower(payloadErr.raw)
	}
	var httpErr providerHTTPError
	if errors.As(err, &httpErr) {
		message += " " + strings.ToLower(httpErr.Body)
	}
	return strings.Contains(message, "tool_choice") || strings.Contains(message, "tool choice") || strings.Contains(message, "tool-choice") || strings.Contains(message, "thinking mode")
}

func isAutoAgentToolChoice(value interface{}) bool {
	choice, ok := value.(string)
	return ok && strings.EqualFold(strings.TrimSpace(choice), "auto")
}

func parseAgentToolPayload(payload map[string]interface{}, protocol string) (map[string]interface{}, error) {
	if err := validateTextPayload(payload); err != nil {
		return nil, err
	}
	result := map[string]interface{}{"mode": "text", "text": "", "toolCalls": []interface{}{}}
	if protocol == "responses" {
		result["text"] = firstNonEmptyString(stringField(payload, "output_text"), extractResponseText(payload))
		if reasoning := extractResponseReasoning(payload); reasoning != "" {
			result["reasoning"] = reasoning
		}
		calls := make([]interface{}, 0)
		for _, value := range interfaceSlice(payload["output"]) {
			item, _ := value.(map[string]interface{})
			if stringField(item, "type") != "function_call" {
				continue
			}
			callID := firstNonEmptyString(stringField(item, "call_id"), stringField(item, "id"))
			call := map[string]interface{}{"id": callID, "type": "function", "function": map[string]interface{}{"name": stringField(item, "name"), "arguments": stringField(item, "arguments")}}
			if itemID := stringField(item, "id"); itemID != "" && stringField(item, "call_id") != "" {
				call["item_id"] = itemID
			}
			calls = append(calls, call)
		}
		result["toolCalls"] = calls
		return result, nil
	}
	if protocol == "claude-api" {
		content := interfaceSlice(payload["content"])
		calls := make([]interface{}, 0)
		for _, value := range content {
			item, _ := value.(map[string]interface{})
			switch stringField(item, "type") {
			case "text":
				result["text"] = result["text"].(string) + stringField(item, "text")
			case "thinking":
				result["reasoning"] = resultString(result, "reasoning") + firstNonEmptyString(stringField(item, "thinking"), stringField(item, "text"))
			case "tool_use":
				arguments, err := json.Marshal(item["input"])
				if err != nil {
					return nil, err
				}
				calls = append(calls, map[string]interface{}{"id": stringField(item, "id"), "type": "function", "function": map[string]interface{}{"name": stringField(item, "name"), "arguments": string(arguments)}})
			}
		}
		result["toolCalls"] = calls
		if result["text"] == "" && len(calls) == 0 {
			return nil, errors.New("Claude Agent 接口没有返回内容")
		}
		return result, nil
	}
	choices := interfaceSlice(payload["choices"])
	if len(choices) == 0 {
		return nil, errors.New("画布 Agent 接口没有返回 choices")
	}
	choice, _ := choices[0].(map[string]interface{})
	message, _ := choice["message"].(map[string]interface{})
	result["text"] = stringField(message, "content")
	if reasoning := firstNonEmptyString(stringField(message, "reasoning_content"), stringField(message, "reasoning")); reasoning != "" {
		result["reasoning"] = reasoning
	}
	calls := make([]interface{}, 0)
	for _, value := range interfaceSlice(message["tool_calls"]) {
		item, _ := value.(map[string]interface{})
		function, _ := item["function"].(map[string]interface{})
		calls = append(calls, map[string]interface{}{"id": stringField(item, "id"), "type": "function", "function": map[string]interface{}{"name": stringField(function, "name"), "arguments": stringField(function, "arguments")}})
	}
	result["toolCalls"] = calls
	return result, nil
}
