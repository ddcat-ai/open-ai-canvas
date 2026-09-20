package app

import (
	"fmt"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestArkVideoUsageRequiresValidFinalCompletionTokens(t *testing.T) {
	for _, path := range []string{"/api/v3/contents/generations/tasks/video-1", "/api/plan/v3/contents/generations/tasks/video-1"} {
		for _, test := range []struct {
			name    string
			payload string
			want    int64
		}{
			{name: "completion", payload: `{"status":"succeeded","usage":{"completion_tokens":108900}}`, want: 108900},
			{name: "completion precedes output and total", payload: `{"usage":{"completion_tokens":108900,"output_tokens":900000,"total_tokens":200000}}`, want: 108900},
			{name: "total when completion missing", payload: `{"usage":{"total_tokens":35800}}`, want: 35800},
			{name: "total precedes output alias", payload: `{"usage":{"output_tokens":900000,"total_tokens":35800}}`, want: 35800},
			{name: "nested response", payload: `{"data":{"status":"succeeded","usage":{"completion_tokens":35800}}}`, want: 35800},
			{name: "integer beyond float precision", payload: `{"usage":{"completion_tokens":9007199254740993}}`, want: 9007199254740993},
			{name: "largest int64", payload: `{"usage":{"completion_tokens":9223372036854775807}}`, want: 9223372036854775807},
			{name: "processing", payload: `{"status":"running","usage":{"completion_tokens":108900}}`},
			{name: "queued", payload: `{"status":"queued","usage":{"completion_tokens":108900}}`},
			{name: "failed", payload: `{"status":"failed","usage":{"completion_tokens":108900}}`},
			{name: "invalid status", payload: `{"status":true,"usage":{"completion_tokens":108900}}`},
			{name: "missing usage", payload: `{"status":"succeeded"}`},
			{name: "empty usage", payload: `{"status":"succeeded","usage":{}}`},
			{name: "output alias only", payload: `{"usage":{"output_tokens":108900}}`},
			{name: "unrelated usage metadata", payload: `{"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":108900,"cachedContentTokenCount":1}}`},
		} {
			t.Run(path+"/"+test.name, func(t *testing.T) {
				log := &model.ApiCallLog{Capability: "video", Path: path, InputTokens: 1, CachedTokens: 1, OutputTokens: 1, UsageAvailable: true}
				(&Service{}).EnrichAPICallLog(log, []byte(test.payload))
				if log.InputTokens != 0 || log.CachedTokens != 0 || log.OutputTokens != test.want || log.UsageAvailable != (test.want > 0) {
					t.Fatalf("usage = input:%d cached:%d output:%d available:%v, want output:%d", log.InputTokens, log.CachedTokens, log.OutputTokens, log.UsageAvailable, test.want)
				}
			})
		}
	}
}

func TestArkVideoUsageDoesNotMaskMalformedCompletionWithTotal(t *testing.T) {
	for _, invalid := range []string{"0", "-1", "1.5", "1.0", `"108900"`, "9223372036854775808", "1e100", "null", "true", "{}"} {
		for _, field := range []string{"completion_tokens", "total_tokens"} {
			t.Run(field+"/"+invalid, func(t *testing.T) {
				usage := fmt.Sprintf(`{"%s":%s}`, field, invalid)
				if field == "completion_tokens" {
					usage = fmt.Sprintf(`{"completion_tokens":%s,"total_tokens":108900}`, invalid)
				}
				log := &model.ApiCallLog{Capability: "video", Path: "/api/v3/contents/generations/tasks/video-1"}
				(&Service{}).EnrichAPICallLog(log, []byte(`{"status":"succeeded","usage":`+usage+`}`))
				if log.UsageAvailable || log.OutputTokens != 0 {
					t.Fatalf("accepted invalid usage %s: output:%d available:%v", usage, log.OutputTokens, log.UsageAvailable)
				}
			})
		}
	}
}

func TestArkVideoUsageNeverAddsInputOrCachedTokens(t *testing.T) {
	log := &model.ApiCallLog{Capability: "video", Path: "/api/v3/contents/generations/tasks/video-1"}
	(&Service{}).EnrichAPICallLog(log, []byte(`{"status":"succeeded","usage":{"completion_tokens":108900,"input_tokens":999,"cached_tokens":50,"prompt_tokens_details":{"cached_tokens":100}},"usageMetadata":{"promptTokenCount":888,"candidatesTokenCount":777,"cachedContentTokenCount":200}}`))
	if !log.UsageAvailable || log.InputTokens != 0 || log.CachedTokens != 0 || log.OutputTokens != 108900 {
		t.Fatalf("video usage was contaminated by text usage: %#v", log)
	}
}

func TestGenericVideoUsageRequiresPositiveFinalIntegerTokens(t *testing.T) {
	for _, test := range []struct {
		payload string
		want    int64
	}{
		{`{"data":{"status":"completed","usage":{"completion_tokens":108000}}}`, 108000},
		{`{"status":"SUCCESS","usage":{"output_tokens":100000,"input_tokens":20}}`, 100000},
		{`{"status":"succeeded","usage":{"total_tokens":90000}}`, 90000},
		{`{"status":"running","usage":{"completion_tokens":108000}}`, 0},
		{`{"status":"failed","usage":{"output_tokens":108000}}`, 0},
		{`{"usage":{"completion_tokens":1.5,"total_tokens":108000}}`, 0},
		{`{"usage":{"output_tokens":-1,"total_tokens":108000}}`, 0},
		{`{"usage":{"input_tokens":108000}}`, 0},
	} {
		log := &model.ApiCallLog{Capability: "video", Path: "/v1/video/generations/task-1"}
		(&Service{}).EnrichAPICallLog(log, []byte(test.payload))
		if log.OutputTokens != test.want || log.UsageAvailable != (test.want > 0) || log.InputTokens != 0 || log.CachedTokens != 0 {
			t.Fatalf("payload=%s log=%#v", test.payload, log)
		}
	}
}
