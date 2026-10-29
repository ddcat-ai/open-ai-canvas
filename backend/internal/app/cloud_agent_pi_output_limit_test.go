package app

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
)

// piOutputLimitFixture 复用现有测试库入口；PostgreSQL 只写独立临时 schema。
// 模型结果由测试直接填入任务，不启动 Pi、HTTP 上游或真实生成。
func piOutputLimitFixture(t *testing.T) (*Service, *gorm.DB, string) {
	t.Helper()
	var s *Service
	var db *gorm.DB
	if os.Getenv("CANVAS_TEST_POSTGRES_DSN") == "" {
		s, db, _, _ = creationTestService(t)
	} else {
		s, db = newProjectNameConflictPostgresService(t)
		s.dataDir = t.TempDir()
		sqlDB, err := db.DB()
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = sqlDB.Close() })
		if err := db.AutoMigrate(database.Models()...); err != nil {
			t.Fatal(err)
		}
		profile := mustEncodeModelCapabilityConfig(t, DefaultModelCapabilityConfigForModel("chat-completion", "text-test"))
		for _, row := range []any{
			// 任务准入按用户分组过滤渠道，账号必须真实存在（与 SQLite 夹具一致）。
			&model.User{ID: "user", Username: "user", Role: model.UserRoleUser, Status: model.UserStatusActive},
			&model.ModelChannel{ID: "channel", Scope: model.ChannelScopeSystem, Enabled: true},
			&model.ChannelModel{ID: "cm", ChannelID: "channel", ModelKey: "text-test", Capability: "text", Protocol: model.ChannelInterfaceChatCompletion, CapabilityConfigJSON: profile, BillingMode: "fixed_request", UnitPriceMicrocredits: 100, PriceConfigured: true, Enabled: true},
			&model.ChannelModelPriceTier{ID: "tier", ChannelModelID: "cm", SelectorKey: "{}", SelectorJSON: "{}", BillingMode: "fixed_request", UnitPriceMicrocredits: 100, PriceConfigured: true, Enabled: true},
			&model.CreditAccount{UserID: "user", AvailableMicrocredits: 10000},
		} {
			if err := db.Create(row).Error; err != nil {
				t.Fatal(err)
			}
		}
	}
	s.disablePiRuntime, s.legacyCloudAgentRootTask = true, false
	if err := os.WriteFile(filepath.Join(s.dataDir, ".settings-key"), make([]byte, 32), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: `{"nodes":[],"connections":[]}`}).Error; err != nil {
		t.Fatal(err)
	}
	root, err := s.CreateCloudAgentRun("user", agentTestRequest(), "")
	if err != nil {
		t.Fatal(err)
	}
	return s, db, root.ID
}

// TestPiOutputLimitCorrection 验证真实模型桥的边界、纠正上下文与有限重试。
// 超限批次不得进入 Calls 或执行；最终失败也必须清理活动任务且给出可读原因。
func TestPiOutputLimitCorrection(t *testing.T) {
	for _, tc := range []struct {
		name     string
		counts   []int
		fail     bool
		longText bool
	}{
		{"eight", []int{8}, false, false},
		{"nine-then-eight", []int{9, 8}, false, false},
		{"thirty-one-then-one", []int{31, 1}, false, false},
		{"bounded-failure", []int{31, 31, 31, 31}, true, false},
		{"oversized-text", []int{0, 1}, false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, db, runID := piOutputLimitFixture(t)
			ctx, cancel := context.WithTimeout(context.Background(), 35*time.Second)
			defer cancel()
			type outcome struct {
				result any
				err    error
			}
			done := make(chan outcome, 1)
			go func() {
				r, err := s.cloudAgentPiModel(ctx, "user", runID, map[string]json.RawMessage{"messages": json.RawMessage(`[{"role":"user","content":"继续"}]`), "thinkingLevel": json.RawMessage(`"off"`)})
				done <- outcome{r, err}
			}()
			previous := ""
			for attempt, count := range tc.counts {
				var task model.Task
				for task.ID == "" {
					_, state := agentInterjectionState(t, s, runID)
					if state.ActiveTaskID != "" && state.ActiveTaskID != previous {
						if len(state.Calls) != 0 {
							t.Fatal("rejected calls entered the checkpoint")
						}
						if err := db.First(&task, "id = ?", state.ActiveTaskID).Error; err != nil {
							t.Fatal(err)
						}
						break
					}
					select {
					case got := <-done:
						t.Fatalf("model bridge ended before expected task: %v", got.err)
					case <-ctx.Done():
						t.Fatal("model task not scheduled")
					case <-time.After(20 * time.Millisecond):
					}
				}
				if attempt > 0 && (!strings.Contains(task.InputJSON, "invalid_output") || !strings.Contains(task.InputJSON, "maxToolCalls")) {
					t.Fatal("retry missing output-limit correction")
				}
				calls := make([]cloudAgentCall, count)
				for i := range calls {
					calls[i].ID = fmt.Sprintf("call-%d-%d", attempt, i)
					calls[i].Function.Name = "canvas_get_state"
					calls[i].Function.Arguments = "{}"
				}
				text := ""
				if tc.longText && attempt == 0 {
					text = strings.Repeat("x", cloudAgentMaxOutputBytes+1)
				}
				raw, err := json.Marshal(map[string]any{"text": text, "toolCalls": calls})
				if err != nil {
					t.Fatal(err)
				}
				if err := db.Model(&model.Task{}).Where("id = ?", task.ID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": string(raw)}).Error; err != nil {
					t.Fatal(err)
				}
				previous = task.ID
			}
			select {
			case got := <-done:
				if tc.fail {
					if got.err == nil || !strings.Contains(got.err.Error(), "31 个工具调用") || strings.Contains(got.err.Error(), "checkpoint") {
						t.Fatalf("wrong terminal error: %v", got.err)
					}
				} else if got.err != nil {
					t.Fatal(got.err)
				}
			case <-ctx.Done():
				t.Fatal("model bridge did not finish")
			}
			_, state := agentInterjectionState(t, s, runID)
			want := tc.counts[len(tc.counts)-1]
			if tc.fail {
				want = 0
			}
			if state.ActiveTaskID != "" || len(state.Calls) != want || state.CallIndex != 0 {
				t.Fatal("output admission left invalid state")
			}
			for _, message := range state.Canonical.Messages {
				if strings.Contains(stringField(message, "content"), "invalid_output") {
					t.Fatal("retry correction leaked into canonical history")
				}
			}
			for _, event := range state.Events {
				if event.Type == "tool_completed" || event.Type == "canvas_updated" || event.Type == "approval_requested" {
					t.Fatal("model response admission executed a tool")
				}
			}
			var tasks int64
			if err := db.Model(&model.Task{}).Where("agent_run_id = ? AND operation = ?", runID, cloudAgentStepOperation).Count(&tasks).Error; err != nil || tasks != int64(len(tc.counts)) {
				t.Fatalf("unexpected retry count: %d (%v)", tasks, err)
			}
		})
	}
}
