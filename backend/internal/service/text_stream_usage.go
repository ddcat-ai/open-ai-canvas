package service

import (
	"encoding/json"
	"errors"
)

// EnsureChatCompletionStreamUsageRequest 为 Token 计费的流式 Chat Completions
// 请求开启最终 usage 块；非流式请求保持原样，避免改变普通接口合同。
func EnsureChatCompletionStreamUsageRequest(data []byte) ([]byte, error) {
	var payload map[string]any
	if err := json.Unmarshal(data, &payload); err != nil {
		return nil, err
	}
	stream, _ := payload["stream"].(bool)
	if !stream {
		return data, nil
	}
	if err := ensureChatCompletionStreamUsage(payload); err != nil {
		return nil, err
	}
	return json.Marshal(payload)
}

func ensureChatCompletionStreamUsage(payload map[string]any) error {
	options := map[string]any{}
	if value, exists := payload["stream_options"]; exists {
		var ok bool
		options, ok = value.(map[string]any)
		if !ok {
			return errors.New("stream_options 必须是 JSON 对象")
		}
	}
	options["include_usage"] = true
	payload["stream_options"] = options
	return nil
}
