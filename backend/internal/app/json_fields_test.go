package app

import (
	"strings"
	"testing"
)

func TestExtractProviderTaskID(t *testing.T) {
	id, err := extractProviderTaskID([]byte(`{"id":12,"task_id":"abc"}`))
	if err != nil || id != "abc" {
		t.Fatalf("extractProviderTaskID() = %q, %v", id, err)
	}

	_, err = extractProviderTaskID([]byte(`{"id":12}`))
	if err == nil || !strings.Contains(err.Error(), "expected string") || !strings.Contains(err.Error(), "float64") {
		t.Fatalf("extractProviderTaskID(numeric id) error = %v", err)
	}

	id, err = extractProviderTaskID([]byte(`{"data":{"task_id":"nested"}}`))
	if err != nil || id != "nested" {
		t.Fatalf("extractProviderTaskID(nested) = %q, %v", id, err)
	}

	id, err = extractProviderTaskID([]byte(`{"name":"task-from-name"}`))
	if err != nil || id != "task-from-name" {
		t.Fatalf("extractProviderTaskID(name) = %q, %v", id, err)
	}
}
