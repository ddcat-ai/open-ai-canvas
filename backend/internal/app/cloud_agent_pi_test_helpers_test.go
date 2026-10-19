package app

import (
	"encoding/json"
	"testing"
)

func piEventForTest(t *testing.T, event map[string]any) map[string]json.RawMessage {
	t.Helper()
	data, err := json.Marshal(event)
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]json.RawMessage
	if err := json.Unmarshal(data, &payload); err != nil {
		t.Fatal(err)
	}
	return payload
}
