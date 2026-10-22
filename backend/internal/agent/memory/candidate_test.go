package memory

import (
	"encoding/json"
	"reflect"
	"testing"

	"yingce/backend/internal/model"
)

func TestCandidateRoundTripPreservesStepsAndEvidenceWithoutAuthority(t *testing.T) {
	candidate := FromLesson(model.AgentLesson{
		ID: "candidate", Topic: "workflow", Category: "canvas", Situation: "write after read",
		StepsJSON:    `[{"tool":"canvas_apply_ops","action":"apply checked operations"}]`,
		AuthorUserID: "untrusted-owner", Status: model.AgentLessonStatusApproved, Hits: 99,
	}, []Evidence{{Sequence: 7, CallID: "call", Tool: "canvas_apply_ops"}})
	body, err := json.Marshal(candidate)
	if err != nil {
		t.Fatal(err)
	}
	var restored Candidate
	if err := json.Unmarshal(body, &restored); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(restored, candidate) {
		t.Fatalf("candidate fields lost: %s", body)
	}
	lesson := restored.PendingLesson("authenticated-owner", "successful-run")
	if lesson.AuthorUserID != "authenticated-owner" || lesson.Status != model.AgentLessonStatusPending || lesson.Hits != 0 || lesson.LastVerifiedAt != nil || lesson.OriginRunID != "successful-run" {
		t.Fatalf("candidate gained approval/verification authority: %+v", lesson)
	}
	if lesson.StepsJSON != candidate.StepsJSON || lesson.EvidenceJSON == "" {
		t.Fatalf("checkpoint lost steps/evidence: %+v", lesson)
	}
}
