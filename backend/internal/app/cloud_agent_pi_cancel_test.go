package app

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestCreationTerminalParentToolRecoveryNeverExecutes(t *testing.T) {
	for _, status := range []string{"cancelled", "failed"} {
		t.Run(status, func(t *testing.T) {
			s, db, _, _ := creationTestService(t)
			root, err := s.CreateCloudAgentRun("user", creationAgentRequest(), "")
			if err != nil {
				t.Fatal(err)
			}
			parent, state := agentInterjectionState(t, s, root.ID)
			call := cloudAgentCall{ID: "pending-image"}
			call.Function.Name, call.Function.Arguments = "generate_media", `{}`
			state.PiModelTaskID, state.PiModelCalls = "declared-step", []cloudAgentCall{call}
			approvalPauseSaveState(t, s, db, parent, &state)
			digest, err := cloudAgentCallDigest(call)
			if err != nil {
				t.Fatal(err)
			}
			receipt := model.CloudAgentReceipt{RunID: root.ID, Kind: "tool", OperationKey: call.ID, UserID: "user", Name: call.Function.Name, InputSHA256: digest, Status: "pending"}
			if err := s.repo.SaveCloudAgentReceipt(&receipt); err != nil {
				t.Fatal(err)
			}
			if status == "cancelled" {
				if err := s.CancelCloudAgent(context.Background(), "user", root.ID); err != nil {
					t.Fatal(err)
				}
			} else {
				if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", root.ID).Updates(map[string]any{"status": "failed", "cleanup_pending": false}).Error; err != nil {
					t.Fatal(err)
				}
			}
			req := creationAgentRequest()
			req.Prompt, req.IdempotencyKey, req.SessionID = "改成蓝色背景", "new-request", root.SessionID
			next, err := s.CreateCloudAgentRun("user", req, root.ID)
			if err != nil {
				t.Fatal(err)
			}
			var before int64
			if err := db.Model(&model.Task{}).Count(&before).Error; err != nil {
				t.Fatal(err)
			}
			payload := map[string]json.RawMessage{"callId": json.RawMessage(`"pending-image"`), "name": json.RawMessage(`"generate_media"`), "arguments": json.RawMessage(`{}`), "recoverOnly": json.RawMessage(`true`), "parentRunId": json.RawMessage(`"` + root.ID + `"`)}
			result, err := s.cloudAgentPiTool(context.Background(), "user", next.ID, payload)
			if err != nil {
				t.Fatal(err)
			}
			encoded, _ := json.Marshal(result)
			phase := "user_cancelled"
			if status == "failed" {
				phase = "parent_failed"
			}
			if !strings.Contains(string(encoded), phase) || strings.Contains(string(encoded), "charged") {
				t.Fatalf("untruthful cancellation receipt: %s", encoded)
			}
			stored, err := s.repo.CloudAgentReceipt("user", root.ID, "tool", call.ID)
			if err != nil || stored.Status != "pending" {
				t.Fatal("read-only recovery changed the original receipt")
			}
			delete(payload, "recoverOnly")
			if _, err := s.cloudAgentPiTool(context.Background(), "user", next.ID, payload); err == nil {
				t.Fatal("old call executed as a new write")
			}
			payload["recoverOnly"], payload["arguments"] = json.RawMessage(`true`), json.RawMessage(`{"count":10}`)
			if _, err := s.cloudAgentPiTool(context.Background(), "user", next.ID, payload); err == nil {
				t.Fatal("changed call arguments accepted")
			}
			var after int64
			if err := db.Model(&model.Task{}).Count(&after).Error; err != nil || before != after {
				t.Fatal("recovery created another task")
			}
		})
	}
}
