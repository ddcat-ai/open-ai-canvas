package service

import (
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
