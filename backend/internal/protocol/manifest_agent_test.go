package protocol

import (
	"context"
	"encoding/json"
	"testing"
)

func TestManifestAgentMapsRequestAndResponse(t *testing.T) {
	manifest := []byte(`{
		"apiVersion":"yingce.plugin/v1",
		"id":"agent-test","version":"1.0.0","name":"Agent Test","author":"Test","documentation":"# Agent Test",
		"contributes":{"providers":[{"id":"agent-test","label":"Agent Test","capabilities":["text"],"scopes":["agent"],"create":{"method":"POST","path":"/create"},"agent":{"method":"POST","path":"/messages","fields":{"model":"request.model","messages":"request.extra.agent.chatCompletion.messages","tools":"request.extra.agent.chatCompletion.tools","tool_choice":"request.extra.agent.chatCompletion.tool_choice"}},"agentResponse":{"textPaths":["choices.0.message.content"],"toolCallsPath":"choices.0.message.tool_calls","toolCallIdPaths":["id"],"toolCallNamePaths":["function.name"],"toolCallArgumentsPaths":["function.arguments"]},"response":{}}]}
	}`)
	adapter, err := LoadManifest(manifest)
	if err != nil {
		t.Fatal(err)
	}
	agent, ok := adapter.(AgentAdapter)
	if !ok {
		t.Fatal("manifest adapter does not expose AgentAdapter")
	}
	request := map[string]any{
		"chatCompletion": map[string]any{
			"messages":    []any{map[string]any{"role": "user", "content": "hello"}},
			"tools":       []any{map[string]any{"type": "function"}},
			"tool_choice": "required",
		},
		"responses": map[string]any{},
	}
	spec, err := agent.BuildAgent(context.Background(), AgentRequestContext{Model: "model-a", Request: request})
	if err != nil {
		t.Fatal(err)
	}
	body, ok := spec.Body.(map[string]any)
	if !ok || body["model"] != "model-a" {
		t.Fatalf("request body = %#v", spec.Body)
	}
	if _, ok := body["messages"].([]any); !ok {
		t.Fatalf("messages were not mapped: %#v", body)
	}
	result, err := agent.ParseAgent(context.Background(), []byte(`{"choices":[{"message":{"content":"answer","tool_calls":[{"id":"call-1","function":{"name":"search","arguments":"{\"q\":\"x\"}"}}]}}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if result.Text != "answer" || len(result.ToolCalls) != 1 || result.ToolCalls[0].Name != "search" {
		t.Fatalf("agent result = %#v", result)
	}
	if !json.Valid([]byte(result.ToolCalls[0].Arguments)) {
		t.Fatalf("tool arguments are not JSON: %q", result.ToolCalls[0].Arguments)
	}

	result, err = agent.ParseAgent(context.Background(), []byte(`{"choices":[{"message":{"tool_calls":[{"id":"call-2","function":{"name":"search","arguments":{"q":"object"}}}]}}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if got := result.ToolCalls[0].Arguments; got != `{"q":"object"}` {
		t.Fatalf("object tool arguments = %q", got)
	}
}

func TestManifestMapsSynchronousTextResponse(t *testing.T) {
	manifest := []byte(`{
		"apiVersion":"yingce.plugin/v1",
		"id":"text-test","version":"1.0.0","name":"Text Test","author":"Test","documentation":"# Text Test",
		"contributes":{"providers":[{"id":"text-test","label":"Text Test","capabilities":["text"],"scopes":["canvas"],"create":{"method":"POST","path":"/chat","fields":{"prompt":"request.prompt"}},"response":{"textPaths":["choices.0.message.content"],"reasoningPaths":["choices.0.message.reasoning_content"]}}]}
	}`)
	adapter, err := LoadManifest(manifest)
	if err != nil {
		t.Fatal(err)
	}
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{Prompt: "hello"}})
	if err != nil || spec.Body == nil {
		t.Fatalf("build create = %#v, %v", spec, err)
	}
	result, err := adapter.ParseCreate(context.Background(), []byte(`{"choices":[{"message":{"content":"answer","reasoning_content":"thinking"}}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != StatusSucceeded || result.Result == nil || result.Result.Text != "answer" || result.Result.Reasoning != "thinking" {
		t.Fatalf("text result = %#v", result)
	}
}

func TestManifestUsesOnlyUnifiedTopLevelContract(t *testing.T) {
	legacy := []byte(`{"apiVersion":"v1","metadata":{"id":"legacy","version":"1","name":"Legacy"},"create":{"method":"POST","path":"/tasks"},"response":{}}`)
	if _, err := LoadManifest(legacy); err == nil {
		t.Fatal("legacy protocol manifest was accepted")
	}
	canvasOnly := []byte(`{"apiVersion":"yingce.plugin/v1","id":"canvas-extension","name":"Canvas Extension","version":"1.0.0","contributes":{"canvasNodes":[{"id":"canvas-extension/node","label":"Node","defaultTitle":"Node","defaultSize":{"width":320,"height":200},"schema":{},"renderer":"declarative"}]}}`)
	if _, err := LoadManifest(canvasOnly); err != nil {
		t.Fatalf("providerless unified plugin was rejected: %v", err)
	}
	multi := []byte(`{"apiVersion":"yingce.plugin/v1","id":"multi-provider","name":"Multi Provider","version":"1.0.0","contributes":{"providers":[{"id":"multi-text","label":"Text","capabilities":["text"],"scopes":["canvas"],"create":{"method":"POST","path":"/text"},"response":{}},{"id":"multi-image","label":"Image","capabilities":["image"],"scopes":["canvas"],"create":{"method":"POST","path":"/image"},"response":{}}]}}`)
	adapters, err := LoadInstalledProviders(multi, nil)
	if err != nil || len(adapters) != 2 || adapters[0].Metadata().ID != "multi-text" || adapters[1].Metadata().ID != "multi-image" {
		t.Fatalf("multi-provider load = %#v, %v", adapters, err)
	}
}
