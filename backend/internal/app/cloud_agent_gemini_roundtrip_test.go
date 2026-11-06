package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
)

func TestGeminiAgentReasoningRoundtrip(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	for _, parallel := range []bool{false, true} {
		name := "sequential"
		if parallel {
			name = "parallel"
		}
		t.Run(name, func(t *testing.T) {
			signatures := []string{" opaque+/=\nfirst ", " opaque+/=\nsecond "}
			callPart := func(index int, signed bool) map[string]any {
				part := map[string]any{"functionCall": map[string]any{
					"id": []string{"call-1", "call-2"}[index], "name": []string{"read_scene", "read_cast"}[index],
					"args": map[string]any{"index": index},
				}}
				if signed {
					part["thoughtSignature"] = signatures[index]
				}
				return part
			}
			var requests []map[string]any
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
				}
				requests = append(requests, body)
				parts := []any{map[string]any{"text": "done"}}
				if len(requests) == 1 {
					parts = []any{callPart(0, true)}
					if parallel {
						parts = append(parts, callPart(1, false))
					}
				} else if !parallel && len(requests) == 2 {
					parts = []any{callPart(1, true)}
				}
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(map[string]any{"candidates": []any{map[string]any{"content": map[string]any{"parts": parts}}}})
			}))
			defer server.Close()
			ctx := withProtocolRegistry(context.Background(), loadOfficialFallbackRegistry())
			runtimeMessages := []map[string]any{{"role": "user", "content": "inspect"}}
			for step := 0; step < 3; step++ {
				canonical, err := canonicalFromRuntimeMessages(runtimeMessages, nil, "")
				if err != nil {
					t.Fatal(err)
				}
				result, err := runAgentToolTask(ctx, canvasGenerationInput{
					Config:        providerConfig{BaseURL: server.URL, Model: "gemini-test", InterfaceType: officialGeminiAgentInterface},
					AgentRequests: &agentToolRequests{Canonical: &canonical},
				})
				if err != nil {
					t.Fatal(err)
				}
				encoded, err := json.Marshal(result)
				if err != nil {
					t.Fatal(err)
				}
				var decoded struct {
					ToolCalls []cloudAgentCall `json:"toolCalls"`
				}
				if err := json.Unmarshal(encoded, &decoded); err != nil {
					t.Fatal(err)
				}
				if len(decoded.ToolCalls) == 0 {
					break
				}
				parts := []any{}
				for _, call := range runtimeToolCalls(decoded.ToolCalls) {
					call["type"] = "toolCall"
					parts = append(parts, call)
				}
				runtimeMessages = append(runtimeMessages, map[string]any{"role": "assistant", "content": parts})
				for _, call := range decoded.ToolCalls {
					runtimeMessages = append(runtimeMessages, map[string]any{"role": "toolResult", "toolCallId": call.ID, "content": "{}"})
				}
			}
			wantCalls := 3
			if parallel {
				wantCalls = 2
			}
			if len(requests) != wantCalls {
				t.Fatalf("requests = %d, want %d", len(requests), wantCalls)
			}
			contents := interfaceSlice(requests[len(requests)-1]["contents"])
			wantContents := 5
			if parallel {
				wantContents = 3
			}
			if len(contents) != wantContents {
				t.Fatalf("contents = %#v", contents)
			}
			for index := 0; index < 2; index++ {
				modelIndex, partIndex := index*2+1, 0
				if parallel {
					modelIndex, partIndex = 1, index
				}
				modelMessage := contents[modelIndex].(map[string]any)
				got := interfaceSlice(modelMessage["parts"])[partIndex]
				want := callPart(index, !parallel || index == 0)
				if modelMessage["role"] != "model" || !reflect.DeepEqual(normalizeJSONForCompare(t, got), normalizeJSONForCompare(t, want)) {
					t.Fatalf("call %d = %#v, want %#v", index, got, want)
				}
				userMessage := contents[modelIndex+1].(map[string]any)
				response := interfaceSlice(userMessage["parts"])[partIndex].(map[string]any)["functionResponse"].(map[string]any)
				call := want["functionCall"].(map[string]any)
				if userMessage["role"] != "user" || response["id"] != call["id"] || response["name"] != call["name"] {
					t.Fatalf("response %d = %#v", index, userMessage)
				}
			}
		})
	}
}
