package app

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
)

func cloudAgentProjectForDefaultModel(t *testing.T, db *gorm.DB, modelRef string) {
	t.Helper()
	project := &model.Project{ID: "agent-default-project", UserID: "user", Name: "Agent 默认模型项目", Type: "short-drama", Status: model.ProjectStatusActive, DefaultImageModel: modelRef, DefaultVideoModel: modelRef}
	if err := db.Create(project).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.CanvasProject{}).Where("id = ? AND user_id = ?", "agent-canvas", "user").Update("project_id", project.ID).Error; err != nil {
		t.Fatal(err)
	}
}

func TestCloudAgentModelSelectionRejectsBeforeCanvasRead(t *testing.T) {
	for _, tc := range []struct{ name, args, field, issue string }{
		{"missing", `{}`, "logicalModelId", "required"},
		{"empty", `{"logicalModelId":"","channelId":"","channelModelKey":""}`, "logicalModelId", "required"},
		{"missing channel", `{"channelModelKey":"image"}`, "channelId", "required"},
		{"missing key", `{"channelId":"channel"}`, "channelModelKey", "required"},
		{"mixed", `{"logicalModelId":"model","channelId":"channel","channelModelKey":"image"}`, "logicalModelId", "mutually_exclusive"},
		{"partial mixed", `{"logicalModelId":"model","channelModelKey":"image"}`, "logicalModelId", "mutually_exclusive"},
		{"whitespace", `{"channelId":" \t","channelModelKey":"image"}`, "channelId", "invalid_value"},
		{"null", `{"logicalModelId":null,"channelId":"channel","channelModelKey":"image"}`, "logicalModelId", "type_mismatch"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			call := cloudAgentCall{ID: "invalid"}
			call.Function.Name, call.Function.Arguments = "generate_media", tc.args
			// No service/repository: rejection must precede any read or side effect.
			var s *Service
			_, _, err := s.prepareCloudAgentMedia(nil, nil, call)
			var fieldErr *cloudAgentFieldArgumentError
			if !errors.As(err, &fieldErr) || fieldErr.Field != tc.field || fieldErr.Issue != tc.issue {
				t.Fatalf("unexpected validation: %#v", err)
			}
			req := agentTestRequest()
			req.PermissionMode = "auto"
			state := &cloudAgentRuntime{Canonical: canonicalAgentRequest{Tools: cloudAgentTools(req)}}
			cloudAgentToolResult("run", state, call, map[string]any{"phase": "admission", "taskSubmitted": false}, err)
			var result map[string]any
			if err := json.Unmarshal([]byte(state.Canonical.Messages[0]["content"].(string)), &result); err != nil {
				t.Fatal(err)
			}
			if result["field"] != tc.field || result["issue"] != tc.issue || result["reason"] != "invalid_tool_arguments" || result["parameters"] == nil || result["taskSubmitted"] != false {
				t.Fatalf("missing strict repair feedback: %#v", result)
			}
		})
	}
}

func TestCloudAgentModelSelectionAcceptsOnlyCompleteSelections(t *testing.T) {
	for _, raw := range []string{
		`{"logicalModelId":"model"}`,
		`{"logicalModelId":"model","channelId":"","channelModelKey":""}`,
		`{"channelId":"channel","channelModelKey":"image"}`,
		`{"logicalModelId":"","channelId":"channel","channelModelKey":"image"}`,
	} {
		var args cloudAgentMediaArgs
		if err := decodeCloudAgentJSONObject(raw, &args); err != nil {
			t.Fatal(err)
		}
		if err := validateCloudAgentModelSelection(raw, args); err != nil {
			t.Fatalf("valid selection rejected: %v", err)
		}
	}
}

func TestCloudAgentProjectDefaultChannelModelFillsOnlyOmittedSelection(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	cloudAgentProjectForDefaultModel(t, db, "channel::seedance-test")
	run := &model.CloudAgentExecution{ID: "run-default-channel", UserID: "user"}
	state := &cloudAgentRuntime{Request: CloudAgentRequest{CanvasID: "agent-canvas"}}
	args := cloudAgentMediaArgs{Mode: "video"}
	used, err := s.applyCloudAgentProjectDefaultModel(run, state, `{"mode":"video"}`, &args)
	if err != nil || !used || args.ChannelID != "channel" || args.ChannelModelKey != "seedance-test" || args.LogicalModelID != "" {
		t.Fatalf("default channel selection = used:%v args:%+v err:%v", used, args, err)
	}

	args = cloudAgentMediaArgs{Mode: "video"}
	used, err = s.applyCloudAgentProjectDefaultModel(run, state, `{"mode":"video","channelId":"","channelModelKey":""}`, &args)
	if err != nil || used {
		t.Fatalf("explicit empty selection was silently defaulted: used:%v args:%+v err:%v", used, args, err)
	}
	if err := validateCloudAgentModelSelection(`{"mode":"video","channelId":"","channelModelKey":""}`, args); err == nil {
		t.Fatal("explicit empty selection unexpectedly passed validation")
	}
}

func TestCloudAgentProjectDefaultLogicalModelFillsWhenAvailable(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	cloudAgentProjectForDefaultModel(t, db, "logical-image")
	s.routeCatalogTTL = time.Hour
	imageSpec := CapabilitySpec{Version: 1, Capability: "image"}
	s.routeCatalog = &routeCatalogSnapshot{
		LoadedAt: time.Now(), Ordered: []string{"logical-image"}, Models: map[string]cachedLogicalModel{
			"logical-image": {
				Model:       model.LogicalModel{ID: "logical-image", Name: "默认逻辑图片", Capability: "image", Enabled: true, PricePolicy: "unified"},
				ProductSpec: imageSpec,
				Routes: []cachedLogicalRoute{{
					Route:          model.LogicalModelRoute{ID: "logical-image-route", Enabled: true, Weight: 1},
					CapabilitySpec: imageSpec,
					ChannelModel:   model.ChannelModel{ID: "video-cm", ChannelID: "channel", ModelKey: "seedance-test", Capability: "image"},
				}},
			},
		},
	}
	run := &model.CloudAgentExecution{ID: "run-default-logical", UserID: "user"}
	state := &cloudAgentRuntime{Request: CloudAgentRequest{CanvasID: "agent-canvas"}}
	args := cloudAgentMediaArgs{Mode: "image"}
	used, err := s.applyCloudAgentProjectDefaultModel(run, state, `{"mode":"image"}`, &args)
	if err != nil || !used || args.LogicalModelID != "logical-image" || args.ChannelID != "" || args.ChannelModelKey != "" {
		t.Fatalf("default logical selection = used:%v args:%+v err:%v", used, args, err)
	}
}

func TestCloudAgentMediaMalformedJSONKeepsStrictFeedback(t *testing.T) {
	for _, raw := range []string{`{"unknown":"private-sentinel"}`, `{"channelId":3}`, `{} {}`, `null`} {
		call := cloudAgentCall{}
		call.Function.Arguments = raw
		var s *Service
		_, _, err := s.prepareCloudAgentMedia(nil, nil, call)
		var argumentErr *cloudAgentArgumentError
		if !errors.As(err, &argumentErr) || strings.Contains(err.Error(), "private-sentinel") {
			t.Fatalf("malformed arguments lost safe schema error: %v", err)
		}
	}
}

func TestCloudAgentMediaToolsDeclareExclusiveModelSelection(t *testing.T) {
	count := 0
	req := agentTestRequest()
	req.PermissionMode = "auto"
	for _, tool := range cloudAgentTools(req) {
		function := tool["function"].(map[string]any)
		if function["name"] != "generate_media" && function["name"] != "image_layer_split" {
			continue
		}
		count++
		parameters := function["parameters"].(map[string]any)
		if !strings.Contains(function["description"].(string), cloudAgentModelSelectionDescription) || parameters["additionalProperties"] != false {
			t.Fatalf("incomplete model selection schema: %#v", parameters)
		}
		props := parameters["properties"].(map[string]any)
		for _, field := range []string{"logicalModelId", "channelId", "channelModelKey"} {
			property := props[field].(map[string]any)
			if property["type"] != "string" {
				t.Fatalf("model field contract drift: %s %#v", field, property)
			}
		}
	}
	if count != 2 {
		t.Fatalf("missing media tools: %d", count)
	}
}

func TestCloudAgentMissingModelCreatesNoDraftApprovalOrTask(t *testing.T) {
	s, db, args := agentMediaFixture(t)
	args.ChannelID, args.ChannelModelKey = "", ""
	run, _ := agentMediaRun(t, s, args, "auto")
	canvas, _ := s.repo.CanvasProjectForUser("user", "agent-canvas")
	var before int64
	if err := db.Model(&model.Task{}).Count(&before).Error; err != nil {
		t.Fatal(err)
	}
	var billingBefore int64
	if err := db.Model(&model.BillingOrder{}).Count(&billingBefore).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	run, _ = s.repo.CloudAgent("user", run.ID)
	state, err := cloudAgentDecode(run)
	if err != nil {
		t.Fatal(err)
	}
	afterCanvas, _ := s.repo.CanvasProjectForUser("user", "agent-canvas")
	var after int64
	if err := db.Model(&model.Task{}).Count(&after).Error; err != nil {
		t.Fatal(err)
	}
	var billingAfter int64
	if err := db.Model(&model.BillingOrder{}).Count(&billingAfter).Error; err != nil {
		t.Fatal(err)
	}
	if before != after || billingBefore != billingAfter || canvas.PayloadJSON != afterCanvas.PayloadJSON || state.Approval != nil || state.MediaTaskID != "" {
		t.Fatal("invalid selection created a task, draft, approval or billing order")
	}
	found := false
	for _, event := range state.Events {
		if event.Type == "tool_failed" {
			result, _ := event.Payload["result"].(map[string]any)
			found = result["reason"] == "invalid_tool_arguments" && result["taskSubmitted"] == false
		}
	}
	if !found {
		t.Fatal("admission failure was silently hidden")
	}
}
