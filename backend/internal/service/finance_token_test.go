package service

import (
	"encoding/json"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestSupportsTokenBillingForVolcengineArkVideo(t *testing.T) {
	if !supportsTokenBilling("text", model.ChannelInterfaceChatCompletion) {
		t.Fatal("text protocol should support Token billing")
	}
	if !supportsTokenBilling("video", model.ChannelInterfaceVolcengineArkVideo) {
		t.Fatal("Volcengine Ark video should support Token billing")
	}
	if supportsTokenBilling("video", model.ChannelInterfaceNewAPIVideo) {
		t.Fatal("video protocols without a final usage contract must not support Token billing")
	}
}

func TestEstimateArkVideoTokensUsesPixelFrameEstimate(t *testing.T) {
	estimate := estimateArkVideoTokens(map[string]any{
		"config": map[string]any{
			"model": "doubao-seedance-1-5-pro", "videoSeconds": "5", "vquality": "720", "size": "16:9",
		},
	})
	// 1280*720*(5*24+1)/1024 = 108900，预授权再保留 10% 余量。
	if estimate.InputTokens != 0 || estimate.OutputTokens != 119790 {
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
	if estimate.OutputTokens != 477180 {
		t.Fatalf("estimateArkVideoTokens() = %#v", estimate)
	}
}

func TestEstimateArkVideoTokensCapsReferenceDuration(t *testing.T) {
	estimate := estimateArkVideoTokens(map[string]any{
		"config": map[string]any{
			"model": "doubao-seedance-2-0", "videoSeconds": "5", "vquality": "720p", "size": "16:9",
		},
		"referenceVideos": []any{map[string]any{"id": "video-1", "durationMs": int64(60_000)}},
	})
	if estimate.OutputTokens != 477180 {
		t.Fatalf("estimateArkVideoTokens() = %#v", estimate)
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
