package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// TestAgentApprovalLargeCanvasEvent 验证完整审批路径，不只检查事件生成 helper。
// 所有数据保存在临时数据库中，禁止启动 Pi 或调用收费模型。
func TestAgentApprovalLargeCanvasEvent(t *testing.T) {
	for _, large := range []bool{false, true} {
		name := "small"
		if large {
			name = "large"
		}
		t.Run(name, func(t *testing.T) {
			db := agentPermissionsDB(t)
			if err := db.AutoMigrate(database.Models()...); err != nil {
				t.Fatal(err)
			}
			s := &Service{repo: repository.New(db), dataDir: t.TempDir(), disablePiRuntime: true}
			if err := os.WriteFile(filepath.Join(s.dataDir, ".settings-key"), make([]byte, 32), 0o600); err != nil {
				t.Fatal(err)
			}
			content := "保留正文"
			if large {
				content = strings.Repeat("分镜正文", 18000)
			}
			doc := map[string]any{"nodes": []any{map[string]any{"id": "story", "type": "text", "title": "原标题", "content": content}}, "connections": []any{}}
			raw, err := json.Marshal(doc)
			if err != nil {
				t.Fatal(err)
			}
			profile := mustEncodeModelCapabilityConfig(t, DefaultModelCapabilityConfigForModel("chat-completion", "text-test"))
			for _, row := range []any{
				&model.User{ID: "user", Username: "user", Role: model.UserRoleUser, Status: model.UserStatusActive},
				&model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: string(raw)},
				&model.ModelChannel{ID: "channel", Scope: model.ChannelScopeSystem, Name: "测试", Enabled: true},
				&model.ChannelModel{ID: "cm", ChannelID: "channel", ModelKey: "text-test", Capability: "text", Protocol: model.ChannelInterfaceChatCompletion, CapabilityConfigJSON: profile, BillingMode: "fixed_request", UnitPriceMicrocredits: 100, PriceConfigured: true, Enabled: true},
				&model.ChannelModelPriceTier{ID: "tier", ChannelModelID: "cm", SelectorKey: "{}", SelectorJSON: "{}", BillingMode: "fixed_request", UnitPriceMicrocredits: 100, PriceConfigured: true, Enabled: true},
				&model.CreditAccount{UserID: "user", AvailableMicrocredits: 10000},
			} {
				if err := db.Create(row).Error; err != nil {
					t.Fatal(err)
				}
			}
			req := agentTestRequest()
			req.PermissionMode = "request_approval"
			root, err := s.CreateCloudAgentRun("user", req, "")
			if err != nil {
				t.Fatal(err)
			}
			run, state := agentInterjectionState(t, s, root.ID)
			call := cloudAgentCall{ID: "rename-story"}
			call.Function.Name = "canvas_apply_ops"
			args, err := json.Marshal(map[string]any{"snapshotHash": cloudAgentCanvasHash(doc), "ops": []any{map[string]any{"type": "update_node", "id": "story", "patch": map[string]any{"title": "新标题"}}}})
			if err != nil {
				t.Fatal(err)
			}
			call.Function.Arguments = string(args)
			state.Calls = []cloudAgentCall{call}
			state.CallIndex = 0
			run.Status = "running"
			approvalPauseSaveState(t, s, db, run, &state)
			run, state = agentInterjectionState(t, s, root.ID)
			if err := s.advanceCloudAgentTool(run, &state); err != nil {
				t.Fatal(err)
			}
			_, state = agentInterjectionState(t, s, root.ID)
			if state.Approval == nil {
				t.Fatal("missing approval")
			}
			approvalID := state.Approval.ID
			if err := s.DecideCloudAgentApproval("user", root.ID, approvalID, "approve", ""); err != nil {
				t.Fatal(err)
			}
			_, state = agentInterjectionState(t, s, root.ID)
			if state.Approval != nil || state.CallIndex != 1 {
				t.Fatal("approval did not complete")
			}
			payload := agentCanvasPatchForOperation(t, state, "canvas_apply_ops")
			if large {
				if payload["requiresRefresh"] != true || payload["canvasPatch"] != nil {
					t.Fatal("large event must request a snapshot refresh")
				}
				if len(creationMaps(payload["actions"])) != 1 || payload["preview"] == nil {
					t.Fatal("refresh notification lost its bounded operation summary")
				}
			} else if payload["canvasPatch"] == nil || payload["requiresRefresh"] == true {
				t.Fatal("small event must retain its delta")
			}
			for _, event := range state.Events {
				body, err := json.Marshal(event.Payload)
				if err != nil || len(body) > cloudAgentEventPayloadLimit {
					t.Fatal("event exceeded checkpoint limit")
				}
			}
			canvas, err := s.repo.CanvasProjectForUser("user", "agent-canvas")
			if err != nil {
				t.Fatal(err)
			}
			after, err := creationDocument(canvas.PayloadJSON)
			if err != nil {
				t.Fatal(err)
			}
			node := creationMaps(after["nodes"])[0]
			if node["title"] != "新标题" || node["content"] != content {
				t.Fatal("saved canvas lost its title or full content")
			}
			if canvas.Revision != 2 {
				t.Fatalf("unexpected canvas revision: %d", canvas.Revision)
			}
			// 审批重送必须复用已经完成的结果，不再写一次画布。
			if err := s.DecideCloudAgentApproval("user", root.ID, approvalID, "approve", ""); err != nil {
				t.Fatal(err)
			}
			canvas, err = s.repo.CanvasProjectForUser("user", "agent-canvas")
			if err != nil || canvas.Revision != 2 {
				t.Fatal("duplicate approval changed the canvas")
			}
			var mutations int64
			if err := db.Model(&model.CloudAgentCanvasMutation{}).Where("run_id = ?", root.ID).Count(&mutations).Error; err != nil || mutations != 1 {
				t.Fatalf("unexpected mutation count: %d, error: %v", mutations, err)
			}
		})
	}
}

func TestAgentOversizedCanvasPreviewRequestsRefresh(t *testing.T) {
	db := agentPermissionsDB(t)
	repo := repository.New(db)
	canvas := &model.CanvasProject{ID: "canvas", UserID: "user", PayloadJSON: `{"nodes":[],"connections":[]}`}
	if err := db.Create(canvas).Error; err != nil {
		t.Fatal(err)
	}
	state := cloudAgentRuntime{}
	input := cloudAgentMutationInput{UserID: "user", CanvasID: canvas.ID, BeforeJSON: canvas.PayloadJSON, Operation: "canvas_apply_ops", Preview: &cloudAgentApprovalPreview{Description: strings.Repeat("摘要", cloudAgentEventPayloadLimit)}}
	if err := emitCloudAgentCanvasChange(repo, "run", &state, input); err != nil {
		t.Fatal(err)
	}
	payload := agentCanvasPatchForOperation(t, state, input.Operation)
	if payload["requiresRefresh"] != true || payload["canvasPatch"] != nil || payload["preview"] != nil {
		t.Fatal("oversized summary must use a bounded refresh notification")
	}
	raw, err := json.Marshal(payload)
	if err != nil || len(raw) > cloudAgentEventPayloadLimit {
		t.Fatal("refresh notification exceeded the event limit")
	}
}
