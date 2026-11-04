package app

import (
	"encoding/json"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestSupportsTokenBillingForVolcengineArkVideo(t *testing.T) {
	if !supportsTokenBilling("text", model.ChannelInterfaceChatCompletion) {
		t.Fatal("text protocol should support Token billing")
	}
	if !supportsTokenBilling("video", model.ChannelInterfaceVolcengineArkVideo) {
		t.Fatal("Volcengine Ark video should support Token billing")
	}
	if !supportsTokenBilling("video", model.ChannelInterfaceNewAPIVideo) {
		t.Fatal("all video protocols must support formula-based Token billing")
	}
}

func TestEstimateArkVideoTokensUsesPixelFrameEstimate(t *testing.T) {
	estimate := estimateArkVideoTokens(map[string]any{
		"config": map[string]any{
			"model": "doubao-seedance-1-5-pro", "videoSeconds": "5", "vquality": "720", "size": "16:9",
		},
	})
	// 官方公式 1280*720*5*24/1024 = 108000；平台另预留 10%。
	if estimate.Err != nil || estimate.InputTokens != 0 || estimate.OutputTokens != 118800 {
		t.Fatalf("estimateArkVideoTokens() = %#v", estimate)
	}
}

func TestEstimateArkVideoTokensIncludesUnknownReferenceVideo(t *testing.T) {
	estimate := estimateArkVideoTokens(map[string]any{
		"config": map[string]any{
			"model": "doubao-seedance-2-0", "videoSeconds": "5", "vquality": "720p", "size": "16:9",
		},
		"referenceVideos": []any{map[string]any{"id": "video-1"}},
	})
	if estimate.Err != nil || estimate.OutputTokens != 475200 || !estimate.Video.ReferenceDurationEstimated {
		t.Fatalf("estimateArkVideoTokens() = %#v", estimate)
	}
}

func TestEstimateVideoTokensIncludesLongReferenceDuration(t *testing.T) {
	estimate := estimateArkVideoTokens(map[string]any{
		"config": map[string]any{
			"model": "doubao-seedance-2-0", "videoSeconds": "5", "vquality": "720p", "size": "16:9",
		},
		"referenceVideos": []any{map[string]any{"id": "video-1", "durationMs": int64(60_000)}},
	})
	if estimate.Err != nil || estimate.Video.ReferenceSeconds != 60 || estimate.Video.FormulaTokens != 1_404_000 {
		t.Fatalf("reference duration must be counted without silent capping: %#v", estimate)
	}
}

func TestTokenEstimateAmountAllowsVideoOutputOnly(t *testing.T) {
	amount, err := tokenEstimateAmount(&model.ChannelModel{OutputTokenPriceMicrocredits: 16_000_000}, tokenBillingEstimate{OutputTokens: 119790}, 10_000)
	if err != nil {
		t.Fatalf("tokenEstimateAmount() error = %v", err)
	}
	if amount != 1_916_640 {
		t.Fatalf("tokenEstimateAmount() = %d", amount)
	}
}

func TestEnrichAPICallLogReadsArkVideoUsage(t *testing.T) {
	log := &model.ApiCallLog{Capability: "video", Path: "/api/v3/contents/generations/tasks/cgt-test"}
	(&Service{}).EnrichAPICallLog(log, []byte(`{"id":"cgt-test","status":"succeeded","usage":{"completion_tokens":108900,"total_tokens":108900}}`))
	if !log.UsageAvailable || log.InputTokens != 0 || log.OutputTokens != 108900 {
		t.Fatalf("EnrichAPICallLog() = %#v", log)
	}

	fallback := &model.ApiCallLog{Capability: "video", Path: "/api/v3/contents/generations/tasks/cgt-test"}
	(&Service{}).EnrichAPICallLog(fallback, []byte(`{"usage":{"total_tokens":35800}}`))
	if !fallback.UsageAvailable || fallback.OutputTokens != 35800 {
		t.Fatalf("EnrichAPICallLog() total_tokens fallback = %#v", fallback)
	}

	missing := &model.ApiCallLog{Capability: "video", Path: "/api/v3/contents/generations/tasks/cgt-test"}
	(&Service{}).EnrichAPICallLog(missing, []byte(`{"usage":{}}`))
	if missing.UsageAvailable {
		t.Fatalf("EnrichAPICallLog() accepted empty Ark usage: %#v", missing)
	}
}

func TestEnrichAPICallLogPrefersNewAPIChannel2NestedTaskID(t *testing.T) {
	tests := []struct {
		name    string
		payload string
	}{
		{name: "snake case", payload: `{"id":"wrapper-id","data":{"task_id":"task-snake"}}`},
		{name: "camel case", payload: `{"id":"wrapper-id","data":{"taskId":"task-camel"}}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			log := &model.ApiCallLog{Capability: "video", Path: "/v1/video/generations"}
			(&Service{}).EnrichAPICallLog(log, []byte(test.payload))
			if !strings.HasPrefix(log.ProviderRequestID, "task-") {
				t.Fatalf("ProviderRequestID = %q, want nested upstream task ID", log.ProviderRequestID)
			}
		})
	}
}

func TestEnrichAPICallLogKeepsUserFacingAndUpstreamFailureDetails(t *testing.T) {
	log := &model.ApiCallLog{
		Status:     model.ApiCallStatusFailed,
		StatusCode: 400,
		Error:      "上游 HTTP 400",
	}
	(&Service{}).EnrichAPICallLog(log, []byte(`{"error":{"code":"invalid_request","message":"invalid parameter: size"}}`))
	if !strings.Contains(log.Error, "模型服务拒绝了请求，请检查模型和参数") {
		t.Fatalf("EnrichAPICallLog() missing user-facing category: %q", log.Error)
	}
	if !strings.Contains(log.Error, "invalid parameter: size") {
		t.Fatalf("EnrichAPICallLog() missing upstream detail: %q", log.Error)
	}
	if log.ErrorCode != "invalid_request" {
		t.Fatalf("EnrichAPICallLog() error code = %q", log.ErrorCode)
	}
}

func TestEnrichAPICallLogReadsChatCompletionStreamUsage(t *testing.T) {
	log := &model.ApiCallLog{Capability: "text", Path: "/v1/chat/completions"}
	stream := []byte("data: {\"id\":\"chatcmpl-test\",\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\n" +
		"data: {\"id\":\"chatcmpl-test\",\"choices\":[],\"usage\":{\"prompt_tokens\":23,\"completion_tokens\":7,\"prompt_tokens_details\":{\"cached_tokens\":5}}}\n\n" +
		"data: [DONE]\n\n")
	(&Service{}).EnrichAPICallLog(log, stream)
	if !log.UsageAvailable || log.InputTokens != 23 || log.OutputTokens != 7 || log.CachedTokens != 5 {
		t.Fatalf("EnrichAPICallLog() = %#v", log)
	}
}

func TestEnrichAPICallLogReadsResponsesStreamUsage(t *testing.T) {
	log := &model.ApiCallLog{Capability: "text", Path: "/v1/responses"}
	stream := []byte("event: response.output_text.delta\n" +
		"data: {\"type\":\"response.output_text.delta\",\"delta\":\"ok\"}\n\n" +
		"event: response.completed\n" +
		"data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp-test\",\"status\":\"completed\",\"usage\":{\"input_tokens\":31,\"output_tokens\":11,\"input_tokens_details\":{\"cached_tokens\":9}}}}\n\n")
	(&Service{}).EnrichAPICallLog(log, stream)
	if !log.UsageAvailable || log.InputTokens != 31 || log.OutputTokens != 11 || log.CachedTokens != 9 || log.ProviderRequestID != "resp-test" {
		t.Fatalf("EnrichAPICallLog() = %#v", log)
	}
}

func TestEnrichAPICallLogNormalizesCacheWriteUsage(t *testing.T) {
	// 归一口径：InputTokens 含缓存命中与缓存写入。
	for _, test := range []struct {
		name                              string
		body                              string
		input, output, cached, cacheWrite int64
	}{
		{
			// Anthropic 原生 input_tokens 不含缓存命中和缓存写入。
			name:  "anthropic message",
			body:  `{"id":"msg-1","type":"message","usage":{"input_tokens":20,"cache_creation_input_tokens":1000,"cache_read_input_tokens":300,"output_tokens":40}}`,
			input: 1320, output: 40, cached: 300, cacheWrite: 1000,
		},
		{
			name: "anthropic stream",
			body: "event: message_start\n" +
				"data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg-2\",\"usage\":{\"input_tokens\":12,\"cache_creation_input_tokens\":500,\"cache_read_input_tokens\":0,\"output_tokens\":1}}}\n\n" +
				"event: message_delta\n" +
				"data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":30}}\n\n",
			input: 512, output: 30, cached: 0, cacheWrite: 500,
		},
		{
			// 百炼显式缓存：prompt_tokens 已含创建和命中的缓存。
			name:  "dashscope explicit cache",
			body:  `{"usage":{"prompt_tokens":2174,"completion_tokens":20,"prompt_tokens_details":{"cached_tokens":0,"cache_creation_input_tokens":2156,"cache_type":"ephemeral"}}}`,
			input: 2174, output: 20, cached: 0, cacheWrite: 2156,
		},
		{
			name:  "openrouter cache write",
			body:  `{"usage":{"prompt_tokens":900,"completion_tokens":10,"prompt_tokens_details":{"cached_tokens":100,"cache_write_tokens":700}}}`,
			input: 900, output: 10, cached: 100, cacheWrite: 700,
		},
		{
			name:  "openai cached only",
			body:  `{"usage":{"prompt_tokens":64,"completion_tokens":8,"prompt_tokens_details":{"cached_tokens":32}}}`,
			input: 64, output: 8, cached: 32,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			log := &model.ApiCallLog{Capability: "text"}
			(&Service{}).EnrichAPICallLog(log, []byte(test.body))
			if !log.UsageAvailable || log.InputTokens != test.input || log.OutputTokens != test.output || log.CachedTokens != test.cached || log.CacheWriteTokens != test.cacheWrite {
				t.Fatalf("usage = input %d output %d cached %d write %d, want %d %d %d %d", log.InputTokens, log.OutputTokens, log.CachedTokens, log.CacheWriteTokens, test.input, test.output, test.cached, test.cacheWrite)
			}
		})
	}
}

func TestEnrichAPICallLogRejectsEmptyTextUsage(t *testing.T) {
	log := &model.ApiCallLog{Capability: "text", Path: "/v1/chat/completions"}
	(&Service{}).EnrichAPICallLog(log, []byte(`{"usage":{}}`))
	if log.UsageAvailable {
		t.Fatalf("EnrichAPICallLog() accepted empty text usage: %#v", log)
	}
}

func TestEnsureChatCompletionStreamUsageRequest(t *testing.T) {
	data, err := EnsureChatCompletionStreamUsageRequest([]byte(`{"model":"gpt-test","stream":true,"stream_options":{"custom":true}}`))
	if err != nil {
		t.Fatalf("EnsureChatCompletionStreamUsageRequest() error = %v", err)
	}
	var payload map[string]any
	if err := json.Unmarshal(data, &payload); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	options, _ := payload["stream_options"].(map[string]any)
	if options["include_usage"] != true || options["custom"] != true {
		t.Fatalf("stream_options = %#v", options)
	}
}
