package service

import "testing"

func TestExtractJSONTextSkipsProseAndMarkdownFence(t *testing.T) {
	raw := "先说明一下，{这不是有效 JSON}。\n```json\n{\"characters\":[{\"name\":\"林夏\",\"aliases\":[]}]}\n```\n"
	got, err := extractJSONText(raw)
	if err != nil {
		t.Fatalf("extractJSONText() error = %v", err)
	}
	want := `{"characters":[{"name":"林夏","aliases":[]}]}`
	if got != want {
		t.Fatalf("extractJSONText() = %q, want %q", got, want)
	}
}

func TestExtractJSONTextHandlesBracesInJSONString(t *testing.T) {
	raw := "```json\n{\"characters\":[{\"name\":\"林夏\",\"role\":\"拿着{小夜灯}的租客\"}]}\n```"
	got, err := extractJSONText(raw)
	if err != nil {
		t.Fatalf("extractJSONText() error = %v", err)
	}
	want := `{"characters":[{"name":"林夏","role":"拿着{小夜灯}的租客"}]}`
	if got != want {
		t.Fatalf("extractJSONText() = %q, want %q", got, want)
	}
}
