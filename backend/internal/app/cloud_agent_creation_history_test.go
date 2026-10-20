package app

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestCreationHistoricalUploadsAreSelectedSilently(t *testing.T) {
	for _, ordinary := range []bool{false, true} {
		name := "agent"
		if ordinary {
			name = "ordinary"
		}
		t.Run(name, func(t *testing.T) {
			s, db, _ := agentMediaFixture(t)
			req := creationAgentRequest()
			parentID := ""
			if ordinary {
				req = creationRequestWithDirectContext(t, `[{"role":"user","mode":"image","content":"这是之前上传的产品图","resourceIds":["ref-one"]}]`)
			} else {
				parent, err := s.CreateCloudAgentRun("user", creationReferenceRequest(t, "historical-parent", "", "ref-one"), "")
				if err != nil {
					t.Fatal(err)
				}
				parentID = parent.ID
				completeCreationReferenceRun(t, db, parentID)
			}
			req.AttachmentMode = "replace"
			root, err := s.CreateCloudAgentRun("user", req, parentID)
			if err != nil {
				t.Fatal(err)
			}
			run, state := agentInterjectionState(t, s, root.ID)
			read := cloudAgentCall{ID: "history-catalogue"}
			read.Function.Name, read.Function.Arguments = "creation_media_read", `{}`
			result, err := cloudAgentCreationMediaRead(s.repo, "user", &state, read)
			if err != nil || !strings.Contains(mustMarshal(result), `"resourceId":"ref-one"`) {
				t.Fatalf("historical upload metadata missing: %+v %v", result, err)
			}
			effective, err := cloudAgentCreationRequestWithOutputs(s.repo, "user", &state)
			if err != nil || len(effective.Attachments) != 0 {
				t.Fatalf("catalogue eagerly selected history: %+v %v", effective.Attachments, err)
			}
			read.ID, read.Function.Arguments = "history-select", mustMarshal(map[string]any{"runId": parentID, "resourceId": "ref-one"})
			result, err = s.executeCloudAgentRuntimeTool(t.Context(), "user", root.ID, read)
			if err != nil || result.(map[string]any)["isError"] == true {
				t.Fatalf("explicit historical read rejected: %+v %v", result, err)
			}
			run, state = agentInterjectionState(t, s, root.ID)
			effective, err = cloudAgentCreationRequestWithOutputs(s.repo, "user", &state)
			if err != nil || len(effective.Attachments) != 1 || effective.Attachments[0].ResourceID != "ref-one" {
				t.Fatalf("selected source did not survive checkpoint: %+v %v", effective.Attachments, err)
			}
			if len(state.Request.Attachments) != 0 {
				t.Fatal("historical selection was promoted into current attachments")
			}
			state.Request.MediaSettings = &CloudAgentCreationMedia{Image: &CloudAgentCreationMediaChoice{ParameterMode: "auto", Selection: CloudAgentMediaModelSelection{ChannelID: "channel", ChannelModelKey: "image-test"}}}
			edit, _, err := s.prepareCloudAgentCreationMedia(run, &state, cloudAgentMediaArgs{Mode: "image", Prompt: "保留原产品，只改变背景", AttachmentResourceIDs: []string{"ref-one"}, References: []cloudAgentCreationReference{{ResourceID: "ref-one", Role: "product", Usage: "保留产品外形"}}}, "history-edit")
			if err != nil || len(creationMaps(edit.Input["referenceImages"])) != 1 {
				t.Fatalf("explicit history reference not used: %+v %v", edit, err)
			}
			plain, _, err := s.prepareCloudAgentCreationMedia(run, &state, cloudAgentMediaArgs{Mode: "image", Prompt: "生成一座雪山"}, "history-new")
			if err != nil || len(creationMaps(plain.Input["referenceImages"])) != 0 {
				t.Fatalf("selected history leaked into unrelated generation: %+v %v", plain, err)
			}
			read.Function.Arguments = mustMarshal(map[string]any{"runId": parentID, "resourceId": "ref-two"})
			if _, err := cloudAgentCreationMediaRead(s.repo, "user", &state, read); err == nil {
				t.Fatal("arbitrary owned resource authorized without conversation provenance")
			}
			if !ordinary {
				state.Request.SessionID = "other-session"
				if _, err := cloudAgentCreationRequestWithOutputs(s.repo, "user", &state); err == nil {
					t.Fatal("selected upload crossed session boundary")
				}
				state.Request.SessionID = root.SessionID
			}
			completeCreationReferenceRun(t, db, root.ID)
			next, err := s.CreateCloudAgentRun("user", creationReferenceRequest(t, "history-unrelated-next", ""), root.ID)
			if err != nil {
				t.Fatal(err)
			}
			_, nextState := agentInterjectionState(t, s, next.ID)
			nextInputs, err := cloudAgentCreationRequestWithOutputs(s.repo, "user", &nextState)
			if err != nil || len(nextInputs.Attachments) != 0 {
				t.Fatalf("next turn inherited a previous selection: %+v %v", nextInputs.Attachments, err)
			}
			if err := db.Model(&model.Resource{}).Where("id = ?", "ref-one").Update("user_id", "other").Error; err != nil {
				t.Fatal(err)
			}
			if _, err := cloudAgentCreationRequestWithOutputs(s.repo, "user", &state); err == nil {
				t.Fatal("selected historical resource bypassed ownership revalidation")
			}
		})
	}
}

func TestCreationHistoricalMetadataDoesNotBlockNewWork(t *testing.T) {
	for _, status := range []string{"uploading", "missing", "foreign"} {
		t.Run(status, func(t *testing.T) {
			s, db, _ := agentMediaFixture(t)
			switch status {
			case "missing":
				if err := db.Delete(&model.Resource{}, "id = ?", "ref-one").Error; err != nil {
					t.Fatal(err)
				}
			case "foreign":
				if err := db.Model(&model.Resource{}).Where("id = ?", "ref-one").Update("user_id", "other").Error; err != nil {
					t.Fatal(err)
				}
			default:
				if err := db.Model(&model.Resource{}).Where("id = ?", "ref-one").Updates(map[string]any{"status": status, "mime_type": ""}).Error; err != nil {
					t.Fatal(err)
				}
			}
			req := creationRequestWithDirectContext(t, `[{"role":"user","mode":"image","resourceIds":["ref-one"]}]`)
			root, err := s.CreateCloudAgentRun("user", req, "")
			if status == "foreign" {
				if err == nil {
					t.Fatal("foreign historical resource accepted")
				}
				return
			}
			if err != nil {
				t.Fatalf("unavailable historical metadata blocked a fresh turn: %v", err)
			}
			_, state := agentInterjectionState(t, s, root.ID)
			read := cloudAgentCall{}
			read.Function.Name, read.Function.Arguments = "creation_media_read", `{"resourceId":"ref-one"}`
			if _, err := cloudAgentCreationMediaRead(s.repo, "user", &state, read); err == nil {
				t.Fatal("unavailable historical resource was selected")
			}
			effective, err := cloudAgentCreationRequestWithOutputs(s.repo, "user", &state)
			if err != nil || len(effective.Attachments) != 0 {
				t.Fatalf("failed read blocked or polluted fresh generation: %+v %v", effective, err)
			}
		})
	}
}

func TestCreationHistoricalCataloguePaginationAndScope(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	parentID := ""
	for i := 0; i < 7; i++ {
		run, err := s.CreateCloudAgentRun("user", creationReferenceRequest(t, fmt.Sprintf("history-page-%d", i), "", "ref-one"), parentID)
		if err != nil {
			t.Fatal(err)
		}
		completeCreationReferenceRun(t, db, run.ID)
		parentID = run.ID
	}
	root, err := s.CreateCloudAgentRun("user", creationReferenceRequest(t, "history-page-final", ""), parentID)
	if err != nil {
		t.Fatal(err)
	}
	_, state := agentInterjectionState(t, s, root.ID)
	read := cloudAgentCall{}
	read.Function.Name, read.Function.Arguments = "creation_media_read", `{}`
	result, err := cloudAgentCreationMediaRead(s.repo, "user", &state, read)
	if err != nil {
		t.Fatal(err)
	}
	first := result.(map[string]any)
	cursor := stringField(first, "nextBeforeRunId")
	if cursor == "" || len(creationMaps(first["references"])) != 4 {
		t.Fatalf("first history page missing cursor or entries: %+v", first)
	}
	read.Function.Arguments = mustMarshal(map[string]any{"beforeRunId": cursor})
	result, err = cloudAgentCreationMediaRead(s.repo, "user", &state, read)
	if err != nil || len(creationMaps(result.(map[string]any)["references"])) != 3 || result.(map[string]any)["nextBeforeRunId"] != "" {
		t.Fatalf("history continuation skipped uploads: %+v %v", result, err)
	}
	read.Function.Arguments = mustMarshal(map[string]any{"runId": parentID})
	result, err = cloudAgentCreationMediaRead(s.repo, "user", &state, read)
	if err != nil || len(creationMaps(result.(map[string]any)["references"])) != 1 {
		t.Fatalf("exact source catalogue failed: %+v %v", result, err)
	}
	if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", parentID).Update("user_id", "other").Error; err != nil {
		t.Fatal(err)
	}
	for _, args := range []map[string]any{{"runId": parentID}, {"runId": parentID, "resourceId": "ref-one"}, {"beforeRunId": parentID}} {
		read.Function.Arguments = mustMarshal(args)
		if _, err := cloudAgentCreationMediaRead(s.repo, "user", &state, read); err == nil {
			t.Fatalf("foreign run exposed its metadata or authorized a resource: %+v", args)
		}
	}
}

func TestCreationHistoricalContextPreservesOwnedResources(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	ids := make([]string, 33)
	for i := range ids {
		ids[i] = "resource-" + strings.Repeat("a", i+1)
		if err := db.Create(&model.Resource{ID: ids[i], UserID: "user", Kind: "image", Status: model.ResourceStatusReady, MimeType: "image/png"}).Error; err != nil {
			t.Fatal(err)
		}
	}
	raw, _ := json.Marshal([]map[string]any{{"role": "user", "mode": "image", "resourceIds": ids}})
	req := creationRequestWithDirectContext(t, string(raw))
	if err := validateCloudAgentCreationContext(&req); err != nil {
		t.Fatal(err)
	}
	context, err := s.cloudAgentCreationContext("user", req)
	if err != nil || strings.Count(context, `"resourceId":`) != len(ids) {
		t.Fatalf("lost owned historical resources: %v %s", err, context)
	}
	if err := db.Model(&model.Resource{}).Where("id = ?", ids[0]).Update("user_id", "other").Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.cloudAgentCreationContext("user", req); err == nil {
		t.Fatal("increasing the catalogue must not bypass resource ownership")
	}
}

func TestCreationHistoricalReadsShareOutputLimit(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	req := creationAgentRequest()
	ids := []string{}
	for i := 0; i < 16; i++ {
		id := fmt.Sprintf("historical-%d", i)
		ids = append(ids, id)
		if err := db.Create(&model.Resource{ID: id, UserID: "user", Kind: "image", Status: model.ResourceStatusReady, MimeType: "image/png"}).Error; err != nil {
			t.Fatal(err)
		}
	}
	req.CreationContext = []CloudAgentCreationContextEntry{{Role: "user", Mode: "image", ResourceIDs: ids}}
	root, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Task{ID: "history-limit-output", UserID: "user", AgentRunID: root.ID, Type: "canvas_image", Status: model.TaskStatusSucceeded, ResultJSON: `{"images":[{"storageKey":"resource:ref-one"}]}`}).Error; err != nil {
		t.Fatal(err)
	}
	_, state := agentInterjectionState(t, s, root.ID)
	read := cloudAgentCall{}
	read.Function.Name, read.Function.Arguments = "creation_media_read", `{"taskId":"history-limit-output","outputIndex":1}`
	if _, err := cloudAgentCreationMediaRead(s.repo, "user", &state, read); err != nil {
		t.Fatal(err)
	}
	for i, id := range ids {
		read.Function.Arguments = mustMarshal(map[string]any{"resourceId": id})
		_, err := cloudAgentCreationMediaRead(s.repo, "user", &state, read)
		if i < 15 && err != nil {
			t.Fatal(err)
		}
		if i == 15 && err == nil {
			t.Fatal("historical uploads bypassed the shared 16-resource read limit")
		}
	}
	read.Function.Arguments = mustMarshal(map[string]any{"resourceId": ids[0]})
	if _, err := cloudAgentCreationMediaRead(s.repo, "user", &state, read); err != nil {
		t.Fatalf("re-reading an existing selection consumed another slot: %v", err)
	}
	if len(state.Request.Attachments) != 0 {
		t.Fatal("read history became message attachments")
	}
}
