package app

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
)

// A completed response becomes context for the next turn, even when the
// provider omits usage. Counting only its input leaves the meter a turn behind.
func TestPiContextReadingIncludesCompletedAssistantResponse(t *testing.T) {
	for _, reported := range []bool{false, true} {
		t.Run(map[bool]string{false: "estimated", true: "provider_calibrated"}[reported], func(t *testing.T) {
			s, db, args := agentMediaFixture(t)
			run, _ := agentMediaRun(t, s, args, "auto")
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			done := make(chan error, 1)
			go func() {
				_, _, err := s.runCloudAgentModelStep(ctx, "user", run.ID, []map[string]any{{"role": "user", "content": "生成五张商品图"}}, "off")
				done <- err
			}()
			var pending cloudAgentRuntime
			for ctx.Err() == nil {
				current, err := s.repo.CloudAgent("user", run.ID)
				if err != nil {
					t.Fatal(err)
				}
				pending, err = cloudAgentDecode(current)
				if err != nil {
					t.Fatal(err)
				}
				if pending.ActiveTaskID != "" {
					break
				}
				time.Sleep(10 * time.Millisecond)
			}
			if pending.ActiveTaskID == "" {
				t.Fatal("model step was not queued")
			}
			if reported {
				// Keep the mock tokenizer in range; the assertion concerns the
				// newly generated text, not accuracy of a tokenizer estimate.
				if err := db.Create(&model.ApiCallLog{ID: "usage-" + pending.ActiveTaskID, UserID: "user", TaskID: pending.ActiveTaskID, Capability: "text", Status: model.ApiCallStatusSucceeded, InputTokens: int64(pending.LastStepEstimate), OutputTokens: 100, UsageAvailable: true}).Error; err != nil {
					t.Fatal(err)
				}
			}
			answer := strings.Repeat("这张图片突出已有的商品细节，不新增未经证实的产品卖点。", 20)
			result, _ := json.Marshal(map[string]any{"text": answer})
			if err := db.Model(&model.Task{}).Where("id = ?", pending.ActiveTaskID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": string(result), "input_json": `{"mode":"text"}`}).Error; err != nil {
				t.Fatal(err)
			}
			if err := <-done; err != nil {
				t.Fatal(err)
			}
			current, _ := s.repo.CloudAgent("user", run.ID)
			finished, _ := cloudAgentDecode(current)
			var reading map[string]any
			for _, event := range finished.Events {
				if event.Type == "context_pressure" && event.Payload["phase"] == "after_response" {
					reading = event.Payload
				}
			}
			if reading == nil {
				t.Fatal("completed response did not refresh context reading")
			}
			if reading["readingScope"] != "next_request" {
				t.Fatalf("meter still measures the previous input: %+v", reading)
			}
			if got := int(numberValue(reading["projectedNextInputTokens"], 0)); got <= pending.LastStepEstimate+300 {
				t.Fatalf("completed reply missing from context: got=%d before=%d", got, pending.LastStepEstimate)
			}
			if got := int(numberValue(reading["estimatedInputTokens"], 0)); got <= pending.LastStepEstimate+300 {
				t.Fatalf("local estimate omitted completed reply: got=%d before=%d", got, pending.LastStepEstimate)
			}
			if reported && reading["tokenSource"] != "provider" {
				t.Fatalf("lost provider calibration: %+v", reading)
			}
			if !reported && reading["tokenSource"] != "estimate" {
				t.Fatalf("invented provider measurement: %+v", reading)
			}
			// The readout must not mutate Pi's authoritative input branch.
			encoded, _ := json.Marshal(finished.Canonical.Messages)
			if strings.Contains(string(encoded), answer) {
				t.Fatal("readout appended a duplicate assistant message into the native branch")
			}
		})
	}
}
