package app

import (
	"testing"
	"time"
)

func TestCloudAgentStreamPublishesSmallDeltasPromptly(t *testing.T) {
	for _, kind := range []string{"assistant_delta", "reasoning_delta"} {
		t.Run(kind, func(t *testing.T) {
			chunks := make(chan string, 4)
			publisher := newCloudAgentStreamPublisher(nil, "user", "task", kind)
			publisher.sink = func(delta string) error { chunks <- delta; return nil }
			t.Cleanup(publisher.Close)
			publisher.Publish("文字")
			publisher.Publish("连续输出")
			select {
			case delta := <-chunks:
				if delta != "文字连续输出" {
					t.Fatalf("lost or reordered text: %q", delta)
				}
			case <-time.After(250 * time.Millisecond):
				t.Fatal("small Agent deltas remained buffered for more than 250ms")
			}
			publisher.Publish("，完整收尾。")
			publisher.Close()
			if delta := <-chunks; delta != "，完整收尾。" {
				t.Fatalf("final flush changed the remaining text: %q", delta)
			}
			select {
			case delta := <-chunks:
				t.Fatalf("duplicated text after closing: %q", delta)
			default:
			}
		})
	}
}
