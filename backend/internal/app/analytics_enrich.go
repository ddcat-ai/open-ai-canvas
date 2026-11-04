// 调用日志的费用估算与上游响应补全（请求 ID、视频 token、失败摘要）。

package app

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"strings"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

func (s *Service) estimateCallCost(log *model.ApiCallLog) {
	if log.Status == model.ApiCallStatusFailed && !log.UsageAvailable {
		return
	}
	pricing, err := s.repo.ModelPricing(log.ChannelID, log.Model, log.Capability)
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return
		}
		return
	}
	cost := int64(0)
	if log.Billable {
		cost = pricing.PerRequestMicros
	}
	cost += log.InputTokens * pricing.InputPerMillionMicros / 1_000_000
	cost += log.OutputTokens * pricing.OutputPerMillionMicros / 1_000_000
	cost += log.CachedTokens * pricing.CachedPerMillionMicros / 1_000_000
	cost += int64(log.MediaCount) * pricing.PerMediaMicros
	cost += int64(log.VideoSeconds) * pricing.PerVideoSecondMicros
	log.EstimatedCostMicros = cost
	log.CostAvailable = true
	log.Currency = pricing.Currency
}

func (s *Service) EnrichAPICallLog(log *model.ApiCallLog, responseBody []byte) {
	if log == nil {
		return
	}
	if log.ProviderRequestID == "" {
		log.ProviderRequestID = providerRequestIDFromPath(log.Path)
	}
	payloads := providerResponsePayloads(responseBody)
	for _, payload := range payloads {
		s.enrichAPICallLogPayload(log, payload)
	}
	s.enrichAPICallLogFailureSummary(log, responseBody)
}

func (s *Service) enrichAPICallLogFailureSummary(log *model.ApiCallLog, responseBody []byte) {
	if log.Status != model.ApiCallStatusFailed || log.StatusCode < 400 {
		return
	}
	userMessage := providerUserFacingErrorMessage(providerHTTPError{
		StatusCode: log.StatusCode,
		Body:       string(responseBody),
	})
	detail := strings.TrimSpace(log.Error)
	if detail == "" || detail == userMessage || strings.Contains(userMessage, "；上游："+detail) {
		log.Error = userMessage
		return
	}
	if strings.Contains(detail, userMessage) {
		return
	}
	log.Error = truncateRunes(userMessage+"；上游："+detail, 2_000)
}

func (s *Service) enrichAPICallLogPayload(log *model.ApiCallLog, payload map[string]any) {
	nestedTaskID := ""
	if data, ok := payload["data"].(map[string]any); ok {
		if log.Capability == "video" && strings.Contains(log.Path, "/v1/video/generations") {
			if extracted, err := firstJSONString(data, "task_id", "taskId"); err == nil {
				nestedTaskID = extracted
			}
		}
		for key, value := range data {
			if _, exists := payload[key]; !exists {
				payload[key] = value
			}
		}
	}
	// Responses API 的终态 SSE 把实际响应（包括 usage）放在 response 字段中。
	if response, ok := payload["response"].(map[string]any); ok {
		for key, value := range response {
			if _, exists := payload[key]; !exists {
				payload[key] = value
			}
		}
	}
	if log.Status == model.ApiCallStatusFailed {
		errorCode, errorMessage := providerFailureDetails(payload)
		log.ErrorCode = errorCode
		if errorMessage != "" {
			log.Error = errorMessage
		}
	}
	arkVideo := log.Capability == "video" && strings.Contains(log.Path, "/contents/generations/tasks")
	usage, _ := payload["usage"].(map[string]any)
	// Anthropic 流式把输入与缓存用量放在 message_start.message.usage，message_delta 只补输出。
	if message, ok := payload["message"].(map[string]any); ok && usage == nil {
		usage, _ = message["usage"].(map[string]any)
	}
	if log.Capability == "video" {
		log.InputTokens, log.CachedTokens, log.CacheWriteTokens = 0, 0, 0
		log.OutputTokens, log.UsageAvailable = videoCompletionTokens(payload, arkVideo)
	} else if usage != nil {
		applyTextTokenUsage(log, usage)
	}
	if usageMetadata, ok := payload["usageMetadata"].(map[string]any); ok && log.Capability != "video" {
		inputTokens, inputAvailable := firstInt64Value(usageMetadata, "promptTokenCount")
		outputTokens, outputAvailable := firstInt64Value(usageMetadata, "candidatesTokenCount")
		if inputAvailable {
			log.InputTokens = inputTokens
		}
		if outputAvailable {
			log.OutputTokens = outputTokens
		}
		if inputAvailable || outputAvailable {
			log.UsageAvailable = true
		}
		log.CachedTokens = firstInt64(usageMetadata, "cachedContentTokenCount")
	}
	if extracted, err := firstJSONString(payload, "task_id", "id", "request_id", "name"); err == nil {
		log.ProviderRequestID = firstNonEmpty(nestedTaskID, extracted, log.ProviderRequestID)
	} else {
		log.ProviderRequestID = firstNonEmpty(nestedTaskID, log.ProviderRequestID)
	}
	log.ProviderStatus = strings.ToLower(firstNonEmpty(stringField(payload, "status"), log.ProviderStatus))
	if providerStatus := protocol.NormalizeStatus(log.ProviderStatus); providerStatus == protocol.StatusFailed || providerStatus == protocol.StatusCancelled {
		log.Status = model.ApiCallStatusFailed
		errorCode, errorMessage := providerFailureDetails(payload)
		log.ErrorCode = firstNonEmpty(errorCode, log.ErrorCode)
		log.Error = firstNonEmpty(errorMessage, log.Error)
	}
	if log.Capability == "image" {
		if data, ok := payload["data"].([]any); ok {
			log.MediaCount = len(data)
		} else if images, ok := payload["images"].([]any); ok {
			log.MediaCount = len(images)
		}
	}
}

// applyTextTokenUsage 把各协议的文本 usage 归一为：InputTokens 含缓存命中和缓存写入，
// CachedTokens 是缓存命中，CacheWriteTokens 是缓存写入。结算按 InputTokens - CachedTokens - CacheWriteTokens 计普通输入。
//
// OpenAI 兼容协议的 prompt_tokens / input_tokens 已包含缓存；百炼和 OpenRouter 的缓存写入分别在
// prompt_tokens_details.cache_creation_input_tokens 与 cache_write_tokens。Anthropic 原生 usage 的
// input_tokens 不含 cache_read_input_tokens 和 cache_creation_input_tokens，这里补齐成总输入。
func applyTextTokenUsage(log *model.ApiCallLog, usage map[string]any) {
	inputTokens, inputAvailable := firstInt64Value(usage, "input_tokens", "prompt_tokens")
	outputTokens, outputAvailable := firstInt64Value(usage, "output_tokens", "completion_tokens")
	if outputAvailable {
		log.OutputTokens = outputTokens
	}
	if inputAvailable || outputAvailable {
		log.UsageAvailable = true
	}
	inputDetails, hasInputDetails := usage["input_tokens_details"].(map[string]any)
	promptDetails, hasPromptDetails := usage["prompt_tokens_details"].(map[string]any)
	if hasInputDetails {
		log.CachedTokens = firstInt64(inputDetails, "cached_tokens", "cache_read_input_tokens")
	}
	if hasPromptDetails && log.CachedTokens == 0 {
		log.CachedTokens = firstInt64(promptDetails, "cached_tokens", "cache_read_input_tokens")
	}
	if log.CachedTokens == 0 {
		log.CachedTokens = firstInt64(usage, "cached_tokens", "cache_read_input_tokens", "prompt_cache_hit_tokens")
	}
	for _, details := range []map[string]any{inputDetails, promptDetails} {
		if written, ok := firstInt64Value(details, "cache_creation_input_tokens", "cache_write_tokens"); ok {
			log.CacheWriteTokens = written
		}
	}
	_, hasPromptTokens := usage["prompt_tokens"]
	written, hasWrite := firstInt64Value(usage, "cache_creation_input_tokens")
	read, hasRead := firstInt64Value(usage, "cache_read_input_tokens")
	// 只有带 Anthropic 缓存字段、且没有 OpenAI prompt_tokens / input_tokens_details 的 usage 才按“不含缓存”补齐，
	// LiteLLM 等网关把 cache_creation_input_tokens 放在 prompt_tokens 旁时是否已计入并不一致，保持原口径。
	if inputAvailable && !hasPromptTokens && !hasInputDetails && (hasWrite || hasRead) {
		log.CachedTokens, log.CacheWriteTokens = read, written
		inputTokens += read + written
	}
	if inputAvailable {
		log.InputTokens = inputTokens
	}
}

func videoCompletionTokens(payload map[string]any, arkProtocol bool) (int64, bool) {
	if status, exists := payload["status"]; exists {
		text, ok := status.(string)
		status := strings.ToLower(strings.TrimSpace(text))
		if !ok || (status != "succeeded" && (arkProtocol || (status != "completed" && status != "success"))) {
			return 0, false
		}
	}
	usage, _ := payload["usage"].(map[string]any)
	value, exists := usage["completion_tokens"]
	if !exists && !arkProtocol {
		value, exists = usage["output_tokens"]
	}
	if !exists {
		value = usage["total_tokens"]
	}
	// completion_tokens 一旦返回就是唯一结算依据，非法值不能用 total_tokens 掩盖。
	// JSON Number 保留整数精度，避免浮点取整把小数或超出 int64 的值变成可计费用量。
	number, ok := value.(json.Number)
	if !ok {
		return 0, false
	}
	tokens, err := number.Int64()
	if err != nil || tokens <= 0 {
		return 0, false
	}
	return tokens, true
}

func providerResponsePayloads(responseBody []byte) []map[string]any {
	if len(responseBody) == 0 {
		return nil
	}
	if payload, ok := decodeProviderResponsePayload(responseBody); ok {
		return []map[string]any{payload}
	}

	// 流式文本的用量只出现在最后一个 SSE data 事件中，不能把整段响应当作 JSON。
	result := make([]map[string]any, 0)
	scanner := bufio.NewScanner(bytes.NewReader(responseBody))
	scanner.Buffer(make([]byte, 64<<10), max(len(responseBody)+1, 64<<10))
	dataLines := make([]string, 0, 1)
	flush := func() {
		raw := strings.TrimSpace(strings.Join(dataLines, "\n"))
		dataLines = dataLines[:0]
		if raw == "" || raw == "[DONE]" {
			return
		}
		if event, ok := decodeProviderResponsePayload([]byte(raw)); ok {
			result = append(result, event)
		}
	}
	for scanner.Scan() {
		line := strings.TrimSuffix(scanner.Text(), "\r")
		if line == "" {
			flush()
			continue
		}
		if strings.HasPrefix(line, "data:") {
			dataLines = append(dataLines, strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " "))
		}
	}
	flush()
	return result
}

func decodeProviderResponsePayload(data []byte) (map[string]any, bool) {
	if !json.Valid(data) {
		return nil, false
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var payload map[string]any
	err := decoder.Decode(&payload)
	return payload, err == nil && payload != nil
}

func providerRequestIDFromPath(path string) string {
	parts := strings.Split(strings.Trim(strings.TrimSpace(path), "/"), "/")
	for index := len(parts) - 1; index >= 0; index-- {
		part := strings.TrimSpace(parts[index])
		if part == "" || part == "content" || part == "download" {
			continue
		}
		if index > 0 && (parts[index-1] == "videos" || parts[index-1] == "tasks") {
			return part
		}
		break
	}
	return ""
}

func firstInt64(values map[string]any, keys ...string) int64 {
	value, _ := firstInt64Value(values, keys...)
	return value
}

func firstInt64Value(values map[string]any, keys ...string) (int64, bool) {
	for _, key := range keys {
		switch value := values[key].(type) {
		case float64:
			return int64(value), true
		case int64:
			return value, true
		case json.Number:
			parsed, err := value.Int64()
			return parsed, err == nil
		}
	}
	return 0, false
}
