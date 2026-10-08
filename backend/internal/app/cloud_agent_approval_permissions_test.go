package app

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

// agentApprovalPermissionsService 使用独立数据库验证真实查询与审批检查点。
// CI 默认使用 SQLite；Windows 可以提供 PostgreSQL DSN，测试只写临时 schema。
func agentApprovalPermissionsService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	options := &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)}
	var db *gorm.DB
	var err error
	if dsn := os.Getenv("CANVAS_TEST_POSTGRES_DSN"); dsn != "" {
		admin, openErr := gorm.Open(postgres.Open(dsn), options)
		if openErr != nil {
			t.Fatal(openErr)
		}
		adminSQL, sqlErr := admin.DB()
		if sqlErr != nil {
			t.Fatal(sqlErr)
		}
		schema := fmt.Sprintf("agent_approval_permissions_%d", time.Now().UnixNano())
		if err := admin.Exec("CREATE SCHEMA " + schema).Error; err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			if err := admin.Exec("DROP SCHEMA " + schema + " CASCADE").Error; err != nil {
				t.Error(err)
			}
			_ = adminSQL.Close()
		})
		parsed, parseErr := url.Parse(dsn)
		if parseErr != nil {
			t.Fatal(parseErr)
		}
		query := parsed.Query()
		query.Set("search_path", schema)
		parsed.RawQuery = query.Encode()
		db, err = gorm.Open(postgres.Open(parsed.String()), options)
	} else {
		db, err = gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "agent.db")), options)
	}
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(database.Models()...); err != nil {
		t.Fatal(err)
	}
	s := &Service{repo: repository.New(db), dataDir: t.TempDir(), disablePiRuntime: true}
	// 测试预先创建配置密钥，避免 Windows 不支持目录 Sync 干扰审批路径验证。
	if err := os.WriteFile(filepath.Join(s.dataDir, ".settings-key"), make([]byte, 32), 0o600); err != nil {
		t.Fatal(err)
	}
	profile := mustEncodeModelCapabilityConfig(t, DefaultModelCapabilityConfigForModel("chat-completion", "text-test"))
	for _, row := range []any{
		&model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: `{"nodes":[],"connections":[]}`},
		&model.ModelChannel{ID: "channel", Scope: model.ChannelScopeSystem, Name: "测试", Enabled: true},
		&model.ChannelModel{ID: "cm", ChannelID: "channel", ModelKey: "text-test", Capability: "text", Protocol: model.ChannelInterfaceChatCompletion, CapabilityConfigJSON: profile, BillingMode: "fixed_request", UnitPriceMicrocredits: 100, PriceConfigured: true, Enabled: true},
		&model.ChannelModelPriceTier{ID: "tier", ChannelModelID: "cm", SelectorKey: "{}", SelectorJSON: "{}", BillingMode: "fixed_request", UnitPriceMicrocredits: 100, PriceConfigured: true, Enabled: true},
		&model.CreditAccount{UserID: "user", AvailableMicrocredits: 10000},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	return s, db
}

func TestAgentPermissionsUsePersistedCanvasOwner(t *testing.T) {
	s, db := agentApprovalPermissionsService(t)
	if db.Migrator().HasTable("canvas") {
		t.Fatal("test must not provide the obsolete canvas table")
	}
	for _, tc := range []struct {
		user, canvas string
		allowed      bool
	}{
		{"user", "agent-canvas", true}, {"other", "agent-canvas", false}, {"user", "missing", false},
	} {
		permissions := s.buildPermissionsConfig(tc.user, tc.canvas)
		for _, key := range []string{"canReadCanvas", "canWriteCanvas", "canDeleteNodes", "canCreateNodes", "canExportCanvas"} {
			if permissions[key] != tc.allowed {
				t.Errorf("user=%s canvas=%s %s=%v, want %t", tc.user, tc.canvas, key, permissions[key], tc.allowed)
			}
		}
	}
	if err := db.Migrator().DropTable(&model.CanvasProject{}); err != nil {
		t.Fatal(err)
	}
	if permissions := s.buildPermissionsConfig("user", "agent-canvas"); permissions["canReadCanvas"] != false || permissions["canWriteCanvas"] != false {
		t.Fatal("database errors must deny access")
	}
}

func TestAgentModelWaitsUntilApprovedToolReceiptIsSaved(t *testing.T) {
	s, db := agentApprovalPermissionsService(t)
	for _, decision := range []string{"", "approve"} {
		t.Run("decision="+decision, func(t *testing.T) {
			root, err := s.CreateCloudAgentRun("user", agentTestRequest(), "")
			if err != nil {
				t.Fatal(err)
			}
			run, state := agentInterjectionState(t, s, root.ID)
			approvalPauseStage(t, s, db, run, &state)
			run, state = agentInterjectionState(t, s, root.ID)
			if decision != "" {
				run.Status = "running"
				state.Approval.Decision = decision
				approvalPauseSaveState(t, s, db, run, &state)
			}
			before, _ := agentInterjectionState(t, s, root.ID)
			ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
			defer cancel()
			messages := []map[string]any{{"role": "user", "content": "continue"}}
			_, err = s.cloudAgentPiModel(ctx, "user", root.ID, approvalPauseModelPayload(t, messages))
			if !errors.Is(err, errCloudAgentAwaitingApproval) {
				t.Fatalf("model step entered during approval: %v", err)
			}
			after, finalState := agentInterjectionState(t, s, root.ID)
			if after.Revision != before.Revision || finalState.Approval == nil || finalState.ActiveTaskID != "" {
				t.Fatal("pending approval changed or a model task was scheduled")
			}
			var steps int64
			if err := db.Model(&model.Task{}).Where("agent_run_id = ? AND operation = ?", root.ID, cloudAgentStepOperation).Count(&steps).Error; err != nil {
				t.Fatal(err)
			}
			if steps != 0 {
				t.Fatalf("created %d billable steps during approval", steps)
			}
		})
	}
}

func TestAgentModelResultCannotReplacePendingApproval(t *testing.T) {
	s, db := agentApprovalPermissionsService(t)
	root, err := s.CreateCloudAgentRun("user", agentTestRequest(), "")
	if err != nil {
		t.Fatal(err)
	}
	run, state := agentInterjectionState(t, s, root.ID)
	approvalPauseStage(t, s, db, run, &state)
	run, state = agentInterjectionState(t, s, root.ID)
	run.Status = "running"
	state.Approval.Decision = "approve"
	state.ActiveTaskID = "pending-model"
	state.TaskIDs = append(state.TaskIDs, state.ActiveTaskID)
	approvalPauseSaveState(t, s, db, run, &state)
	newCall := cloudAgentCall{ID: "replacement"}
	newCall.Function.Name, newCall.Function.Arguments = "canvas_get_state", "{}"
	for _, invalid := range []bool{false, true} {
		if invalid {
			err = s.finishCloudAgentPiModelStepWithInvalidCalls("user", root.ID, "pending-model", "", "", []cloudAgentCall{newCall}, map[int]string{0: "invalid arguments"})
		} else {
			err = s.finishCloudAgentPiModelStep("user", root.ID, "pending-model", "", "", []cloudAgentCall{newCall})
		}
		if !errors.Is(err, errCloudAgentAwaitingApproval) {
			t.Fatalf("result replaced approval: %v", err)
		}
		_, unchanged := agentInterjectionState(t, s, root.ID)
		if unchanged.Calls[0].ID != "call-1" || unchanged.ActiveTaskID != "pending-model" || unchanged.Approval == nil {
			t.Fatal("checkpoint changed despite pending approval")
		}
	}
	// 执行回执保存并清除审批后，正常模型结果仍可推进；不能把修复变成永久暂停。
	run, state = agentInterjectionState(t, s, root.ID)
	state.Canonical.Messages = append(state.Canonical.Messages, map[string]any{
		"role": "assistant", "content": "", "tool_calls": state.Calls,
	})
	cloudAgentToolResult(root.ID, &state, state.Calls[0], map[string]any{"completed": true}, nil)
	approvalPauseSaveState(t, s, db, run, &state)
	if err := s.finishCloudAgentPiModelStep("user", root.ID, "pending-model", "", "", []cloudAgentCall{newCall}); err != nil {
		t.Fatal(err)
	}
	_, resumed := agentInterjectionState(t, s, root.ID)
	if resumed.Approval != nil || resumed.ActiveTaskID != "" || resumed.Calls[0].ID != "replacement" {
		t.Fatal("model result did not resume after the approved tool receipt")
	}
}
