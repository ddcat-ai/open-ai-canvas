package app

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
)

func creationReferenceRequest(t *testing.T, key, mode string, ids ...string) CloudAgentRequest {
	t.Helper()
	req := creationAgentRequest()
	req.IdempotencyKey = key
	req.Prompt = "帮我生成亚马逊美国站5张套图"
	for _, id := range ids {
		req.Attachments = append(req.Attachments, CloudAgentAttachment{ResourceID: id, StorageKey: "resource:" + id, Kind: "image", Role: "product", Name: id + ".png"})
	}
	if mode != "" {
		raw, err := json.Marshal(req)
		if err != nil {
			t.Fatal(err)
		}
		var wire map[string]any
		if err := json.Unmarshal(raw, &wire); err != nil {
			t.Fatal(err)
		}
		wire["attachmentMode"] = mode
		raw, _ = json.Marshal(wire)
		if err := json.Unmarshal(raw, &req); err != nil {
			t.Fatal(err)
		}
	}
	return req
}

func completeCreationReferenceRun(t *testing.T, db *gorm.DB, id string) {
	t.Helper()
	if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", id).Update("status", "completed").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", id).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": `{"text":"已收到素材，请继续描述需求"}`}).Error; err != nil {
		t.Fatal(err)
	}
}

func creationReferenceIDs(attachments []CloudAgentAttachment) []string {
	ids := []string{}
	for _, attachment := range attachments {
		ids = append(ids, attachment.ResourceID)
	}
	return ids
}

func TestCreationReferenceContinuationUsesOnlyCurrentEffectiveAttachments(t *testing.T) {
	for _, tc := range []struct {
		name string
		mode string
		ids  []string
		want []string
	}{
		{"continue", "", nil, []string{"ref-one"}},
		{"explicit-inherit", "inherit", nil, []string{"ref-one"}},
		{"new-upload-keeps-previous", "", []string{"ref-two"}, []string{"ref-one", "ref-two"}},
		{"explicit-replace", "replace", []string{"ref-two"}, []string{"ref-two"}},
		{"explicit-append", "append", []string{"ref-two"}, []string{"ref-one", "ref-two"}},
		{"append-deduplicates", "append", []string{"ref-one", "ref-two"}, []string{"ref-one", "ref-two"}},
		{"clear", "replace", nil, []string{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, db, _ := cloudAgentVisionFixture(t)
			parent, err := s.CreateCloudAgentRun("user", creationReferenceRequest(t, "reference-parent-key", "", "ref-one"), "")
			if err != nil {
				t.Fatal(err)
			}
			completeCreationReferenceRun(t, db, parent.ID)
			req := creationReferenceRequest(t, "reference-child-key", tc.mode, tc.ids...)
			child, err := s.CreateCloudAgentRun("user", req, parent.ID)
			if err != nil {
				t.Fatal(err)
			}
			_, state, err := s.cloudAgentTask("user", child.ID)
			if err != nil {
				t.Fatal(err)
			}
			if got := creationReferenceIDs(state.Request.Attachments); !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("effective references = %v, want %v", got, tc.want)
			}
			replay, err := s.CreateCloudAgentRun("user", req, parent.ID)
			if err != nil || replay.ID != child.ID {
				t.Fatalf("reference resolution broke idempotency: %+v %v", replay, err)
			}
			completeCreationReferenceRun(t, db, child.ID)
			third, err := s.CreateCloudAgentRun("user", creationReferenceRequest(t, "reference-third-key", ""), child.ID)
			if err != nil {
				t.Fatal(err)
			}
			_, state, err = s.cloudAgentTask("user", third.ID)
			if err != nil {
				t.Fatal(err)
			}
			if got := creationReferenceIDs(state.Request.Attachments); !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("next turn resurrected or lost references: got %v, want %v", got, tc.want)
			}
		})
	}
}

func TestCreationReferenceRecoveryReturnsEffectiveAttachments(t *testing.T) {
	s, _, _ := cloudAgentVisionFixture(t)
	run, err := s.CreateCloudAgentRun("user", creationReferenceRequest(t, "reference-recovery-key", "", "ref-one"), "")
	if err != nil {
		t.Fatal(err)
	}
	runs, err := s.CloudAgentSessionRuns("user", run.SessionID, 10)
	if err != nil {
		t.Fatal(err)
	}
	for _, view := range append(runs, *run) {
		raw, _ := json.Marshal(view)
		var wire struct {
			Attachments []CloudAgentAttachment `json:"attachments"`
		}
		if err := json.Unmarshal(raw, &wire); err != nil {
			t.Fatal(err)
		}
		if got := creationReferenceIDs(wire.Attachments); !reflect.DeepEqual(got, []string{"ref-one"}) {
			t.Fatalf("recovery omitted effective resource identities: %s", raw)
		}
	}
}

func TestCreationReferenceContinuationRevalidatesInheritedResource(t *testing.T) {
	s, db, _ := cloudAgentVisionFixture(t)
	parent, err := s.CreateCloudAgentRun("user", creationReferenceRequest(t, "reference-revoked-parent", "", "ref-one"), "")
	if err != nil {
		t.Fatal(err)
	}
	completeCreationReferenceRun(t, db, parent.ID)
	if err := db.Model(&model.Resource{}).Where("id = ?", "ref-one").Update("status", "uploading").Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateCloudAgentRun("user", creationReferenceRequest(t, "reference-revoked-child", ""), parent.ID); err == nil {
		t.Fatal("continuation accepted a no-longer-ready inherited resource")
	}
}

func TestCreationReferenceModeRejectsAmbiguousInput(t *testing.T) {
	for _, tc := range []struct {
		mode string
		ids  []string
	}{
		{"unknown", nil},
		{"inherit", []string{"ref-one"}},
	} {
		t.Run(tc.mode, func(t *testing.T) {
			s, _, _ := cloudAgentVisionFixture(t)
			if _, err := s.CreateCloudAgentRun("user", creationReferenceRequest(t, "reference-mode-key", tc.mode, tc.ids...), ""); err == nil {
				t.Fatal("accepted invalid or ambiguous attachment mode")
			}
		})
	}
}

func TestCreationNextTurnKeepsReferenceContextWithoutInheritingExecutablePlan(t *testing.T) {
	for _, tc := range []struct {
		name string
		mode string
		ids  []string
		keep bool
	}{
		{"inherit", "", nil, true},
		{"append", "append", []string{"ref-two"}, true},
		{"default-append", "", []string{"ref-two"}, true},
		{"replace", "replace", []string{"ref-two"}, false},
		{"clear", "replace", nil, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, db, _ := cloudAgentVisionFixture(t)
			parent, err := s.CreateCloudAgentRun("user", creationReferenceRequest(t, "reference-plan-parent", "", "ref-one"), "")
			if err != nil {
				t.Fatal(err)
			}
			execution, err := s.repo.CloudAgent("user", parent.ID)
			if err != nil {
				t.Fatal(err)
			}
			previous, err := cloudAgentDecode(execution)
			if err != nil {
				t.Fatal(err)
			}
			plan := commerceFixturePlan()
			plan.ProductFacts[0].SourceIDs = []string{"ref-one"}
			plan.Items[0].AttachmentResourceIDs = []string{"ref-one"}
			previous.CommercePlan = &plan
			previous.Plan = []cloudAgentPlanItem{{ID: "old-product", Title: "旧产品主图", Status: "pending"}}
			previous.ConfirmationRounds = 1
			previous.ConfirmationFingerprints = []string{strings.Repeat("a", 64)}
			previous.PendingConfirmationFingerprint = previous.ConfirmationFingerprints[0]
			if err := cloudAgentSave(execution, &previous); err != nil {
				t.Fatal(err)
			}
			if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", parent.ID).Update("state_json", execution.StateJSON).Error; err != nil {
				t.Fatal(err)
			}
			completeCreationReferenceRun(t, db, parent.ID)
			child, err := s.CreateCloudAgentRun("user", creationReferenceRequest(t, "reference-plan-child", tc.mode, tc.ids...), parent.ID)
			if err != nil {
				t.Fatal(err)
			}
			nextExecution, err := s.repo.CloudAgent("user", child.ID)
			if err != nil {
				t.Fatal(err)
			}
			next, err := cloudAgentDecode(nextExecution)
			if err != nil {
				t.Fatal(err)
			}
			if next.CommercePlan != nil || len(next.Plan) != 0 {
				t.Fatal("a fresh creation turn exposed the previous product/site plan before planning")
			}
			if tc.keep && next.ConfirmationRounds != 1 {
				t.Fatal("continuing an unanswered question lost its confirmation budget")
			}
			if !tc.keep && (next.ConfirmationRounds != 0 || len(next.ConfirmationFingerprints) != 0) {
				t.Fatal("replaced or excluded product kept old confirmation authority")
			}
		})
	}
}
