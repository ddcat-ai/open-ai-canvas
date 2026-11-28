package app

import (
	"strings"
	"testing"
)

func TestProviderSSEFraming(t *testing.T) {
	for _, end := range []string{"\n", "\r\n", "\r"} {
		parser := newStreamingAgentParser("chat-completion", nil)
		input := strings.Join([]string{"\uFEFF: heartbeat", "data: {", `data: "choices":[{"delta":{"content":"分镜"}}]}`, "", "data: [DONE]", "", ""}, end)
		for _, b := range []byte(input) {
			parser.consume("text/event-stream", []byte{b})
		}
		result, err := parser.result()
		if err != nil || result["text"] != "分镜" {
			t.Errorf("%q complete stream: %v, %v", end, result, err)
		}
		parser = newStreamingAgentParser("chat-completion", nil)
		parser.consume("text/event-stream", []byte(`data: {"choices":[{"delta":{"content":"ok"}}]}`+end+end+"data: [DONE]"+end))
		parser.flush()
		if _, err := parser.result(); err == nil {
			t.Errorf("%q incomplete terminal accepted", end)
		}
		payloads := providerResponsePayloads([]byte("data: {" + end + `data: "usage":{"input_tokens":7}}` + end + end + `data: {"id":"partial"}`))
		if len(payloads) != 1 || payloads[0]["usage"] == nil {
			t.Errorf("%q logged frames = %+v", end, payloads)
		}
	}
}
