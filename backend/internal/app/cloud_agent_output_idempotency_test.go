package app

import (
	"encoding/json"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func assertCloudAgentOutputKey(t *testing.T, run *CloudAgentRun, expected string) {
	t.Helper()
	encoded, err := json.Marshal(run)
	if err != nil {
		t.Fatal(err)
	}
	var output map[string]any
	if err := json.Unmarshal(encoded, &output); err != nil {
		t.Fatal(err)
	}
	if output["idempotencyKey"] != expected {
		t.Fatalf("run %s idempotency key = %v, want %q", run.ID, output["idempotencyKey"], expected)
	}
}

func TestCloudAgentRunOutputUsesOwnRequestIdempotencyKey(t *testing.T) {
	parent := agentRunOutput(&model.Task{ID: "parent-run"}, cloudAgentState{Request: CloudAgentRequest{IdempotencyKey: "parent-original-key"}})
	child := agentRunOutput(&model.Task{ID: "child-run"}, cloudAgentState{ParentID: "parent-run", Request: CloudAgentRequest{IdempotencyKey: "child-original-key"}})
	assertCloudAgentOutputKey(t, parent, "parent-original-key")
	assertCloudAgentOutputKey(t, child, "child-original-key")
}

func TestCloudAgentIdempotencyKeySurvivesRunAndSessionRecovery(t *testing.T) {
	s, _, _, _ := creationTestService(t)
	req := creationAgentRequest()
	run, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	assertCloudAgentOutputKey(t, run, req.IdempotencyKey)
	restored, err := s.CloudAgentRun("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	assertCloudAgentOutputKey(t, restored, req.IdempotencyKey)
	runs, err := s.CloudAgentSessionRuns("user", run.SessionID, 100)
	if err != nil || len(runs) != 1 {
		t.Fatalf("session recovery runs=%d, err=%v", len(runs), err)
	}
	assertCloudAgentOutputKey(t, &runs[0], req.IdempotencyKey)
}
