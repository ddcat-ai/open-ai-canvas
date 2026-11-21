package protocol

import (
	"context"
	"testing"
)

func TestOfficialResponsesOutputBlocks(t *testing.T) {
	adapter := officialPackageAdapter(t, "openai-responses.yingce-plugin", "openai-response")
	for _, tc := range []struct {
		name, body, text, reasoning string
	}{
		{"reasoning first", `{"output":[{"type":"reasoning","summary":[{"text":"Think "},{"text":"carefully."}]},{"type":"message","content":[{"type":"output_text","text":"Hello "},{"type":"output_text","text":"world"}]},{"type":"message","content":[{"type":"output_text","text":"!"}]}],"usage":{"output_tokens":3}}`, "Hello world!", "Think carefully."},
		{"message first", `{"output":[{"type":"message","content":[{"type":"output_text","text":"OK"}]},{"type":"reasoning","summary":[{"text":"Done"}]}]}`, "OK", "Done"},
		{"top level preferred", `{"output_text":"OK","output":[{"type":"message","content":[{"text":"duplicate"}]}]}`, "OK", ""},
		{"tool only", `{"output":[{"type":"function_call","call_id":"call-1","name":"search","arguments":"{}"}]}`, "", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			created, err := adapter.ParseCreate(context.Background(), []byte(tc.body))
			if err != nil {
				t.Fatal(err)
			}
			if tc.text != "" && (created.Result == nil || created.Result.Text != tc.text || created.Result.Reasoning != tc.reasoning) {
				t.Fatalf("create result = %#v, want %q / %q", created.Result, tc.text, tc.reasoning)
			}
			agent, err := adapter.(AgentAdapter).ParseAgent(context.Background(), []byte(tc.body))
			if err != nil || agent.Text != tc.text || agent.Reasoning != tc.reasoning {
				t.Fatalf("agent = %#v, %v", agent, err)
			}
			if tc.name == "tool only" && (len(agent.ToolCalls) != 1 || agent.ToolCalls[0].Name != "search" || created.Result != nil) {
				t.Fatalf("tool-only response = %#v / %#v", agent, created.Result)
			}
		})
	}
}
