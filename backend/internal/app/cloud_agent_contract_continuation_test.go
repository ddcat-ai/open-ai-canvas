package app

import (
	"encoding/json"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

// 自研（2026-09-15）：部署改了策略或能力集后，旧轮次的 policy 快照与当前二进制不一致，
// validateCloudAgentPolicySnapshot 会拒绝续跑。旧行为把用户卡死在「请新建一轮消息」，
// 每个对话都得手动重建；新行为继承历史自动接新轮，用户无感。
func TestCloudAgentContinuesAfterContractChange(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	canvas := model.CanvasProject{ID: "agent-canvas", UserID: "user", Title: "test", PayloadJSON: `{"nodes":[]}`}
	if err := db.Create(&canvas).Error; err != nil {
		t.Fatal(err)
	}
	root, err := s.CreateCloudAgentRun("user", agentTestRequest(), "")
	if err != nil {
		t.Fatal(err)
	}
	// 让第一轮结束。
	if err := db.Model(&model.Task{}).Where("id = ?", root.ID).
		Updates(map[string]any{"status": model.TaskStatusFailed, "error": "mock failure"}).Error; err != nil {
		t.Fatal(err)
	}
	// 在该轮快照里制造一次「合同变更」：把能力集哈希改掉。
	execution, err := s.repo.CloudAgent("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	current := cloudAgentCapabilitySetHash()
	if !strings.Contains(execution.StateJSON, current) {
		t.Fatalf("fixture does not contain the capability set hash %s", current)
	}
	stale := strings.Replace(execution.StateJSON, current, strings.Repeat("0", len(current)), 1)
	if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", root.ID).
		Update("state_json", stale).Error; err != nil {
		t.Fatal(err)
	}

	req := agentTestRequest()
	req.Prompt = "继续刚才的任务"
	req.IdempotencyKey = "contract-change-continuation"
	child, err := s.CreateCloudAgentRun("user", req, root.ID)
	if err != nil {
		t.Fatalf("contract change must not block the conversation: %v", err)
	}
	if child == nil || child.ID == "" || child.ID == root.ID {
		t.Fatalf("expected a new turn, got %#v", child)
	}

	// 历史必须继承，否则用户等于从零开始。
	task, err := s.repo.TaskForUser("user", child.ID)
	if err != nil {
		t.Fatal(err)
	}
	var input struct {
		TextHistory []providerTextMessage `json:"textHistory"`
	}
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		t.Fatal(err)
	}
	if len(input.TextHistory) == 0 {
		t.Fatal("continuation must inherit conversation history")
	}

	// 无法续跑的旧轮应被归档为终态，避免调度器反复重试。
	archived, err := s.repo.CloudAgent("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	if archived.Status == "running" || archived.Status == "queued" {
		t.Fatalf("superseded run must be archived, still %q", archived.Status)
	}
}
