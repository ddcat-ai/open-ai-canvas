package auth

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestLibTVMCPEventFraming(t *testing.T) {
	for _, end := range []string{"\n", "\r\n", "\r"} {
		body := strings.Join([]string{"event: message", "data: {", `data: "id":1}`, "", `data: {"id":2}`}, end)
		raw, err := parseMCPSSE([]byte(body))
		var reply struct{ ID int }
		if err != nil || json.Unmarshal(raw, &reply) != nil || reply.ID != 1 {
			t.Errorf("%q: got %s, %v", end, raw, err)
		}
	}
	raw, err := parseMCPSSE([]byte("{\"id\":1}\n{\"id\":2}"))
	if err != nil || string(raw) != `{"id":2}` {
		t.Fatalf("line-delimited JSON fallback: got %s, %v", raw, err)
	}
}
