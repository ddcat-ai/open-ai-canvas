package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"yingce/backend/internal/model"
)

func TestRunAgentToolTaskResponsesToolHistory(t *testing.T) {
	allowLoopbackProviderTest(t)
	for _, history := range []struct {
		name    string
		message map[string]interface{}
	}{
		{
			name: "function_call",
			message: map[string]interface{}{
				"type": "function_call", "id": "fc-5", "call_id": "call-5", "name": "canvas_get_state", "arguments": "{}",
			},
		},
		{
			name: "assistant_tool_calls",
			message: map[string]interface{}{
				"role": "assistant", "content": "Reading the canvas.",
				"tool_calls": []interface{}{map[string]interface{}{
					"id": "call-5", "item_id": "fc-5", "function": map[string]interface{}{"name": "canvas_get_state", "arguments": "{}"},
				}},
			},
		},
	} {
		for _, declarative := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/declarative=%t", history.name, declarative), func(t *testing.T) {
				requests := 0
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					requests++
					if r.Method != http.MethodPost || r.URL.Path != "/v1/responses" {
						t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
					}
					var body struct {
						Input []map[string]interface{} `json:"input"`
					}
					if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
						t.Error(err)
						w.WriteHeader(http.StatusBadRequest)
						return
					}
					calls, outputs := 0, 0
					for _, item := range body.Input {
						switch item["type"] {
						case "function_call":
							calls++
							if !reflect.DeepEqual(item, map[string]interface{}{
								"type": "function_call", "id": "fc-5", "call_id": "call-5", "name": "canvas_get_state", "arguments": "{}",
							}) {
								t.Errorf("invalid function_call wire fields: %#v", item)
								w.Header().Set("Content-Type", "application/json")
								w.WriteHeader(http.StatusBadRequest)
								_, _ = w.Write([]byte(`{"error":{"code":"unknown_parameter","message":"Unknown parameter: 'input.item_reference'."}}`))
								return
							}
						case "function_call_output":
							outputs++
							if item["call_id"] != "call-5" || item["output"] != `{"nodes":[]}` {
								t.Errorf("tool output lost its call pairing or content: %#v", item)
							}
						}
					}
					if calls != 1 || outputs != 1 {
						t.Errorf("function calls/outputs = %d/%d", calls, outputs)
					}
					w.Header().Set("Content-Type", "text/event-stream")
					_, _ = w.Write([]byte("event: response.output_text.delta\ndata: {\"delta\":\"done\"}\n\nevent: response.completed\ndata: {\"response\":{\"status\":\"completed\",\"output\":[]}}\n\n"))
				}))
				defer server.Close()
				ctx := withProtocolRegistry(context.Background(), emptyProtocolRegistry)
				if declarative {
					ctx = withProtocolRegistry(context.Background(), loadOfficialFallbackRegistry())
					if _, ok := agentProtocolAdapterForContext(ctx, string(model.ChannelInterfaceOpenAIResponse)); !ok {
						t.Fatal("official Responses Agent adapter is unavailable")
					}
				}
				result, err := runAgentToolTask(ctx, canvasGenerationInput{
					Config:     providerConfig{BaseURL: server.URL + "/v1", APIKey: "test-key", Model: "test-model", InterfaceType: string(model.ChannelInterfaceOpenAIResponse)},
					StreamText: true,
					AgentRequests: &agentToolRequests{Canonical: &canonicalAgentRequest{
						Messages: []map[string]interface{}{
							{"role": "user", "content": "Read the canvas."},
							history.message,
							{"role": "tool", "tool_call_id": "call-5", "content": `{"nodes":[]}`},
						},
						ToolChoice: "auto",
					}},
				})
				if err != nil {
					t.Fatalf("runAgentToolTask() error = %v", err)
				}
				if result["text"] != "done" || requests != 1 {
					t.Fatalf("result/requests = %#v/%d", result, requests)
				}
			})
		}
	}
}
