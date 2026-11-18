package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

func TestChatGPTPlanDeclarativeTextForcesPlanRequest(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode request: %v", err)
			return
		}
		if body["store"] != false || body["stream"] != true {
			t.Errorf("plan request flags = store:%v stream:%v", body["store"], body["stream"])
		}
		if _, exists := body["max_output_tokens"]; exists {
			t.Error("unsupported output limit reached upstream")
		}
		if _, ok := body["input"].([]interface{}); !ok {
			t.Errorf("input type = %T, want array", body["input"])
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte("event: response.output_text.delta\ndata: {\"delta\":\"ok\"}\n\nevent: response.completed\ndata: {\"response\":null}\n\n"))
	}))
	defer server.Close()
	input := canvasGenerationInput{Mode: "text", Config: providerConfig{BaseURL: server.URL, APIKey: "test-token", APIFormat: chatGPTPlanFormat, InterfaceType: string(model.ChannelInterfaceOpenAIResponse)}, StreamText: false}
	spec := protocol.RequestSpec{Method: http.MethodPost, Path: "/v1/responses", ContentType: "application/json", Body: map[string]any{"model": "gpt-6-sol", "input": "hello", "max_output_tokens": 100}}
	_, result, err := executeProtocolCreateRequest(context.Background(), input, spec)
	if err != nil {
		t.Fatal(err)
	}
	if result == nil || result.Text != "ok" {
		t.Fatalf("streamed result = %#v", result)
	}
}

func TestPrepareChatGPTPlanRequestUsesPlanContract(t *testing.T) {
	body := map[string]interface{}{
		"model": "gpt-6.1-sol", "input": []interface{}{
			map[string]interface{}{"role": "system", "content": "Write concisely"},
			map[string]interface{}{"role": "user", "content": "Hello"},
			map[string]interface{}{"type": "function_call", "call_id": "call-1", "name": "lookup", "arguments": "{}"},
			map[string]interface{}{"type": "function_call_output", "call_id": "call-1", "output": "OK"},
		},
		"tools":             []interface{}{map[string]interface{}{"type": "function", "name": "lookup", "parameters": map[string]interface{}{"type": "object"}}},
		"tool_choice":       map[string]interface{}{"type": "function", "name": "lookup"},
		"temperature":       0.5,
		"max_output_tokens": 200,
	}
	if err := prepareChatGPTPlanRequest(body); err != nil {
		t.Fatal(err)
	}
	if body["store"] != false || body["stream"] != true || body["instructions"] != "Write concisely" {
		t.Fatalf("missing plan requirements: %#v", body)
	}
	if _, exists := body["temperature"]; exists {
		t.Fatal("unsupported temperature was forwarded")
	}
	if _, exists := body["max_output_tokens"]; exists {
		t.Fatal("unsupported output limit was forwarded")
	}
	items := body["input"].([]interface{})
	if len(items) != 3 || items[1].(map[string]interface{})["namespace"] != "yingce" {
		t.Fatalf("history was not converted for namespace calls: %#v", items)
	}
	tools := body["tools"].([]interface{})
	want := map[string]interface{}{"type": "namespace", "name": "yingce", "description": "Yingce canvas tools", "tools": []interface{}{map[string]interface{}{"type": "function", "name": "lookup", "parameters": map[string]interface{}{"type": "object"}}}}
	if len(tools) != 1 || !reflect.DeepEqual(tools[0], want) {
		t.Fatalf("tools were not grouped: %#v", tools)
	}
}

func TestChatGPTPlanChannelIsOwnerOnly(t *testing.T) {
	owner := "owner"
	group := &resolvedUserGroup{UserGroup: model.UserGroup{AllChannels: true}}
	access := &userGroupAccess{userID: owner, group: group, bypassVisibility: true, chatGPTPlanOwners: map[string]string{"plan": owner}}
	if !access.allowsChannel("plan") {
		t.Fatal("owner should be allowed")
	}
	access.userID = "other-admin"
	if access.allowsChannel("plan") {
		t.Fatal("other administrator bypassed owner restriction")
	}
	access.userID = ""
	if access.allowsChannel("plan") {
		t.Fatal("system access bypassed owner restriction")
	}
}
