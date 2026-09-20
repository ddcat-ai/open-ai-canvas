package platform

import (
	"strings"
	"testing"
)

func TestOptionalJSONStringRejectsWrongType(t *testing.T) {
	payload := map[string]any{"id": 12.0, "status": "ok"}

	text, err := OptionalJSONString(payload, "status")
	if err != nil || text != "ok" {
		t.Fatalf("OptionalJSONString(status) = %q, %v", text, err)
	}

	text, err = OptionalJSONString(payload, "missing")
	if err != nil || text != "" {
		t.Fatalf("OptionalJSONString(missing) = %q, %v", text, err)
	}

	_, err = OptionalJSONString(payload, "id")
	if err == nil || !strings.Contains(err.Error(), "expected string") || !strings.Contains(err.Error(), "float64") {
		t.Fatalf("OptionalJSONString(id) error = %v", err)
	}
}

func TestRequireJSONString(t *testing.T) {
	payload := map[string]any{"id": "task-1", "empty": "  "}

	text, err := RequireJSONString(payload, "id")
	if err != nil || text != "task-1" {
		t.Fatalf("RequireJSONString(id) = %q, %v", text, err)
	}

	_, err = RequireJSONString(payload, "empty")
	if err == nil || !strings.Contains(err.Error(), "missing field: empty") {
		t.Fatalf("RequireJSONString(empty) error = %v", err)
	}

	_, err = RequireJSONString(map[string]any{"id": true}, "id")
	if err == nil || !strings.Contains(err.Error(), "expected string") {
		t.Fatalf("RequireJSONString(bool) error = %v", err)
	}
}

func TestFirstJSONStringPrefersValidStringOverWrongType(t *testing.T) {
	payload := map[string]any{"id": 99.0, "task_id": "abc"}

	text, err := FirstJSONString(payload, "id", "task_id")
	if err != nil || text != "abc" {
		t.Fatalf("FirstJSONString() = %q, %v", text, err)
	}

	_, err = FirstJSONString(payload, "id", "request_id")
	if err == nil || !strings.Contains(err.Error(), "field id") {
		t.Fatalf("FirstJSONString() error = %v", err)
	}

	text, err = FirstJSONString(payload, "missing", "also-missing")
	if err != nil || text != "" {
		t.Fatalf("FirstJSONString(missing) = %q, %v", text, err)
	}
}
