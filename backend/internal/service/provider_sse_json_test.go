package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"testing"
)

func TestHeyrouteSSEJSONTerminalEvents(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		failed     bool
	}{
		{"heartbeat and completed", ": keepalive\r\nevent: started\r\ndata: {}\r\n\r\nevent: heartbeat\r\ndata: {}\r\n\r\nevent:completed\r\ndata: {\"data\":\r\ndata: [{\"b64_json\":\"AA==\"}]}\r\n\r\n", false},
		{"error", "event: error\ndata: {\"error\":{\"message\":\"failed\"}}\n\n", false},
		{"missing terminal", "event: heartbeat\ndata: {}\n\n", true},
		{"done without completed", "event: done\ndata: {}\n\n", true},
		{"bad json", "event: completed\ndata: {broken}\n\n", true},
		{"truncated json", "event: completed\ndata: {", true},
		{"empty error", "event: error\ndata: {}\n\n", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			data, err := readProviderSSEJSON(strings.NewReader(tc.body), 1<<20)
			if (err != nil) != tc.failed {
				t.Fatalf("result=%s error=%v", data, err)
			}
			if err == nil && !json.Valid(data) {
				t.Fatal("terminal data must be JSON")
			}
		})
	}
}

type heyrouteBrokenReader struct{}

func (heyrouteBrokenReader) Read([]byte) (int, error) { return 0, context.Canceled }

func TestHeyrouteSSEJSONLimitsAndEarlyReturn(t *testing.T) {
	if _, err := readProviderSSEJSON(strings.NewReader("event: completed\ndata: "+strings.Repeat("x", 100)), 32); err == nil {
		t.Fatal("oversize stream accepted")
	}
	if _, err := readProviderSSEJSON(heyrouteBrokenReader{}, 1000); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel error lost: %v", err)
	}
	// A second read would fail; receiving completed must not wait for done/EOF.
	reader := io.MultiReader(bytes.NewBufferString("event: completed\ndata: {\"data\":[{\"url\":\"https://example.com/image.png\"}]}\n\n"), heyrouteBrokenReader{})
	if _, err := readProviderSSEJSON(reader, 10000); err != nil {
		t.Fatal(err)
	}
	large := strings.Repeat("a", 128<<10)
	if _, err := readProviderSSEJSON(strings.NewReader("event: completed\ndata: {\"data\":[{\"b64_json\":\""+large+"\"}]}\n\n"), 1<<20); err != nil {
		t.Fatal("base64 longer than scanner limit:", err)
	}
}
