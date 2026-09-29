package app

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestPiStandardToolsFailWhenExecutorIsUnavailable(t *testing.T) {
	service := &Service{}
	tools := []string{
		"read_file", "write_file", "edit_file", "delete_file",
		"list_directory", "search_files", "glob_files",
		"bash", "shell_command", "web_search", "fetch_url",
	}

	for _, tool := range tools {
		t.Run(tool, func(t *testing.T) {
			payload := map[string]json.RawMessage{"arguments": json.RawMessage(`{"command":"pwd"}`)}
			_, err := service.routeStandardTool(context.Background(), "user", "run", tool, payload)
			if err == nil {
				t.Fatal("expected unavailable tool to return an error")
			}
			if strings.Contains(strings.ToLower(err.Error()), "success") {
				t.Fatalf("unavailable tool reported success: %v", err)
			}
		})
	}
}

func TestPiStandardToolRejectsMalformedArguments(t *testing.T) {
	service := &Service{}
	payload := map[string]json.RawMessage{"path": json.RawMessage(`{"unterminated"`)}
	_, err := service.routeStandardTool(context.Background(), "user", "run", "read_file", payload)
	if err == nil || !strings.Contains(err.Error(), `parameter "path"`) {
		t.Fatalf("expected parameter decode error, got %v", err)
	}
}
