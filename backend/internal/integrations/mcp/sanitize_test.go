package mcpintegration

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestSanitizeDiscoveredToolsPreservesProtocolAndPrimitives(t *testing.T) {
	tool := Tool{
		Name: "lookup", Description: "token true and boolean",
		InputSchema: map[string]any{
			"type": "object", "additionalProperties": true,
			"properties": map[string]any{
				"enabled": map[string]any{"type": "boolean", "default": true},
				"count":   map[string]any{"type": "integer", "minimum": 123},
			},
		},
	}
	original, _ := json.Marshal(tool)
	got, err := sanitizeDiscoveredTools([]Tool{tool}, []string{"true", "boolean", "object", "properties", "123"})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Name != "lookup" || got[0].Description != "token [REDACTED] and [REDACTED]" {
		t.Fatalf("unexpected tool: %+v", got)
	}
	wantSchema, _ := json.Marshal(tool.InputSchema)
	gotSchema, _ := json.Marshal(got[0].InputSchema)
	if string(gotSchema) != string(wantSchema) {
		t.Fatalf("schema changed: got %s, want %s", gotSchema, wantSchema)
	}
	if err := validateArguments(got[0], map[string]any{"enabled": true, "count": float64(123)}); err != nil {
		t.Fatalf("sanitized schema no longer validates: %v", err)
	}
	after, _ := json.Marshal(tool)
	if string(after) != string(original) {
		t.Fatal("input tool was mutated")
	}
}

func TestSanitizeDiscoveredToolsRedactsOnlyDocumentation(t *testing.T) {
	secret := "private-credential"
	tool := Tool{Name: "lookup", Description: "using " + secret, InputSchema: map[string]any{
		"type": "object", "description": secret,
		"$defs": map[string]any{"entry": map[string]any{"type": "string", "title": secret, "$comment": secret}},
		"properties": map[string]any{"query": map[string]any{
			"anyOf": []any{map[string]any{"type": "string", "description": secret}, map[string]any{"type": "null"}},
		}},
	}}
	got, err := sanitizeDiscoveredTools([]Tool{tool}, []string{secret})
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(got)
	if strings.Contains(string(raw), secret) || !strings.Contains(string(raw), "[REDACTED]") {
		t.Fatalf("documentation was not redacted: %s", raw)
	}
	if err := validateArguments(got[0], map[string]any{"query": "question"}); err != nil {
		t.Fatalf("schema validation changed: %v", err)
	}
}

func TestSanitizeDiscoveredToolsRejectsCredentialInStructure(t *testing.T) {
	for _, tc := range []struct {
		name   string
		mutate func(*Tool)
	}{
		{"name", func(tool *Tool) { tool.Name = "lookup_private-credential" }},
		{"property", func(tool *Tool) {
			tool.InputSchema["properties"] = map[string]any{"private-credential": map[string]any{"type": "string"}}
		}},
		{"enum", func(tool *Tool) { tool.InputSchema["enum"] = []any{"private-credential"} }},
		{"const", func(tool *Tool) { tool.InputSchema["const"] = map[string]any{"token": "private-credential"} }},
		{"default", func(tool *Tool) { tool.InputSchema["default"] = "private-credential" }},
		{"reference", func(tool *Tool) { tool.InputSchema["$ref"] = "#/$defs/private-credential" }},
		{"required", func(tool *Tool) { tool.InputSchema["required"] = []any{"private-credential"} }},
		{"pattern", func(tool *Tool) { tool.InputSchema["pattern"] = "^private-credential$" }},
		{"extension key", func(tool *Tool) { tool.InputSchema["x-private-credential"] = true }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tool := Tool{Name: "lookup", InputSchema: map[string]any{"type": "object"}}
			tc.mutate(&tool)
			original, _ := json.Marshal(tool)
			got, err := sanitizeDiscoveredTools([]Tool{tool}, []string{"private-credential"})
			if err == nil || got != nil || strings.Contains(err.Error(), "private-credential") {
				t.Fatalf("expected safe rejection, got=%+v err=%v", got, err)
			}
			after, _ := json.Marshal(tool)
			if string(after) != string(original) {
				t.Fatal("rejected tool was mutated")
			}
		})
	}
}

func TestSanitizeToolResultPreservesProtocolAndPrimitives(t *testing.T) {
	input := map[string]any{
		"isError": true,
		"content": []any{map[string]any{
			"type": "text", "text": "text true 123 secret",
			"annotations": map[string]any{"audience": []any{"user", "assistant"}, "priority": 1},
		}},
		"structuredContent": map[string]any{"enabled": true, "count": 123, "nil": nil},
	}
	original, _ := json.Marshal(input)
	got, err := sanitizeToolResult(input, []string{"text", "true", "123", "user", "assistant", "secret"})
	if err != nil {
		t.Fatal(err)
	}
	entry := got["content"].([]any)[0].(map[string]any)
	if entry["type"] != "text" || entry["text"] != "[REDACTED] [REDACTED] [REDACTED] [REDACTED]" || got["isError"] != true {
		t.Fatalf("protocol or text changed incorrectly: %+v", got)
	}
	structured := got["structuredContent"].(map[string]any)
	if structured["enabled"] != true || structured["count"] != float64(123) || structured["nil"] != nil {
		t.Fatalf("primitive types changed: %+v", structured)
	}
	if got["redacted"] == true {
		t.Fatal("fixed protocol fields were mistaken for credential echoes")
	}
	after, _ := json.Marshal(input)
	if string(after) != string(original) {
		t.Fatal("input result was mutated")
	}
}

func TestSanitizeToolResultHandlesEscapingAndOverlappingSecrets(t *testing.T) {
	input := map[string]any{"content": []any{map[string]any{"type": "text", "text": "abcdef abc quoted\"token path\\token [REDACTED]"}}}
	got, err := sanitizeToolResult(input, []string{"abc", "abcdef", "quoted\"token", "path\\token", "", "abc", "REDACTED"})
	if err != nil {
		t.Fatal(err)
	}
	text := got["content"].([]any)[0].(map[string]any)["text"]
	if text != "[REDACTED] [REDACTED] [REDACTED] [REDACTED] [[REDACTED]]" {
		t.Fatalf("unexpected escaped/overlapping redaction: %v", text)
	}
	raw, err := json.Marshal(got)
	if err != nil || !json.Valid(raw) {
		t.Fatalf("invalid JSON: %s err=%v", raw, err)
	}
}

func TestSanitizeToolResultStructuralConflictReturnsSafeReceipt(t *testing.T) {
	for _, isError := range []bool{false, true} {
		for _, tc := range []struct {
			name string
			body map[string]any
		}{
			{"data key", map[string]any{"structuredContent": map[string]any{"secret-token": "done"}}},
			{"unknown root key", map[string]any{"secret-token": "done"}},
			{"unknown content key", map[string]any{"content": []any{map[string]any{"type": "text", "text": "done", "secret-token": "done"}}}},
			{"resource URI", map[string]any{"content": []any{map[string]any{"type": "resource_link", "uri": "https://example.com/secret-token", "name": "result"}}}},
			{"embedded resource", map[string]any{"content": []any{map[string]any{"type": "resource", "resource": map[string]any{"uri": "https://example.com/file", "blob": "secret-token"}}}}},
		} {
			t.Run(tc.name, func(t *testing.T) {
				tc.body["isError"] = isError
				got, err := sanitizeToolResult(tc.body, []string{"secret-token"})
				if err != nil || got["isError"] != isError || got["redacted"] != true || got["message"] == "" {
					t.Fatalf("expected safe completed receipt, got=%+v err=%v", got, err)
				}
				raw, _ := json.Marshal(got)
				if strings.Contains(string(raw), "secret-token") || got["content"] != nil || got["structuredContent"] != nil {
					t.Fatalf("sensitive result survived fallback: %s", raw)
				}
			})
		}
	}
}

func TestSanitizeToolResultWithoutSecretsPreservesJSON(t *testing.T) {
	input := map[string]any{"content": []any{map[string]any{"type": "text", "text": "done"}}, "isError": false}
	got, err := sanitizeToolResult(input, nil)
	if err != nil || !reflect.DeepEqual(got, input) {
		t.Fatalf("unexpected result: %+v err=%v", got, err)
	}
}
