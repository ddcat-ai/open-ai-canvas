package app

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

// 记忆快照在建 run 时冻结，每次 Pi 模型请求前作为有来源的数据消息插入：
// 不改变 system/缓存键，也不写进持久化的对话历史。
func TestCloudAgentPiModelAttachesFrozenMemorySnapshot(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	s.disablePiRuntime = true
	doc, err := s.AgentMemoryDocument("user")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpdateAgentMemoryDocument("user", AgentMemoryDocUpdateRequest{Revision: doc.Revision, Entries: []AgentMemoryEntryInput{{Section: model.AgentMemorySectionUser, Text: "称呼用户为长官"}}}); err != nil {
		t.Fatal(err)
	}
	req := agentTestRequest()
	req.Prompt = "以后都用竖屏 9:16"
	root, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	run, err := s.repo.CloudAgent("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	before, err := cloudAgentDecode(run)
	if err != nil {
		t.Fatal(err)
	}
	if before.Request.MemoryMode != model.AgentMemoryDocumentModeAuto || !strings.Contains(before.Memory.Text, "称呼用户为长官") || !strings.Contains(before.Memory.Text, "memory_update 记下") {
		t.Fatalf("run did not freeze the memory snapshot with the preference nudge: %+v", before.Memory)
	}
	if strings.Contains(before.Canonical.SystemPrompt, "称呼用户为长官") {
		t.Fatal("memory leaked into the stable system prefix")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() {
		_, _, err := s.runCloudAgentModelStep(ctx, "user", root.ID, []map[string]any{{"role": "user", "content": req.Prompt}}, "off")
		done <- err
	}()
	taskID := waitCloudAgentModelTask(t, ctx, s, root.ID, before.ActiveTaskID, done)
	task, err := s.repo.TaskForUser("user", taskID)
	if err != nil {
		t.Fatal(err)
	}
	var input map[string]any
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		t.Fatal(err)
	}
	canonical := input["agentRequests"].(map[string]any)["canonical"].(map[string]any)
	if canonical["systemPrompt"] != before.Canonical.SystemPrompt || canonical["promptCacheKey"] != before.Canonical.PromptCacheKey {
		t.Fatal("memory changed the stable system/cache prefix")
	}
	messages, _ := canonical["messages"].([]any)
	memoryAt, userAt := -1, -1
	for index, value := range messages {
		message, _ := value.(map[string]any)
		if stringField(message, cloudAgentContextSourceKey) == cloudAgentMemoryContextSource {
			memoryAt = index
		}
		if stringField(message, "role") == "user" && stringField(message, "content") == req.Prompt {
			userAt = index
		}
	}
	if memoryAt < 0 || userAt < 0 || memoryAt > userAt {
		t.Fatalf("memory snapshot must sit before the user request: memory=%d user=%d", memoryAt, userAt)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", taskID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": `{"text":"好的","toolCalls":[]}`}).Error; err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	run, err = s.repo.CloudAgent("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	after, err := cloudAgentDecode(run)
	if err != nil {
		t.Fatal(err)
	}
	for _, message := range after.Canonical.Messages {
		if source := stringField(message, cloudAgentContextSourceKey); source == cloudAgentMemoryContextSource || source == cloudAgentSkillHintsSource {
			t.Fatal("ephemeral run context polluted the durable conversation")
		}
	}
}

func waitCloudAgentModelTask(t *testing.T, ctx context.Context, s *Service, runID, previous string, done <-chan error) string {
	t.Helper()
	for {
		stored, err := s.repo.CloudAgent("user", runID)
		if err != nil {
			t.Fatal(err)
		}
		state, err := cloudAgentDecode(stored)
		if err != nil {
			t.Fatal(err)
		}
		if state.ActiveTaskID != "" && state.ActiveTaskID != previous {
			return state.ActiveTaskID
		}
		select {
		case err := <-done:
			t.Fatalf("bridge exited before scheduling: %v", err)
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-time.After(20 * time.Millisecond):
		}
	}
}
