package app

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestCloudAgentPiModelUsesDynamicMemoryAndCountsOnlyScheduledInput(t *testing.T) {
	for _, test := range []struct {
		name, prompt string
		want         int64
	}{
		{"relevant", "请处理素材角色绑定", 1},
		{"unrelated", "请分析天气变化", 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			s, db, _ := agentMediaFixture(t)
			s.disablePiRuntime = true
			lesson := &model.AgentLesson{ID: newID(), Topic: "素材角色绑定", Category: "asset", Situation: "素材角色绑定时", Lesson: "先确认就绪资源", Status: model.AgentLessonStatusApproved, AuthorUserID: "user"}
			if err := s.repo.Create(lesson); err != nil {
				t.Fatal(err)
			}
			req := agentTestRequest()
			req.Prompt = test.prompt
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
			ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
			defer cancel()
			done := make(chan error, 1)
			go func() {
				_, _, err := s.runCloudAgentModelStep(ctx, "user", root.ID, []map[string]any{{"role": "user", "content": test.prompt}}, "off")
				done <- err
			}()
			var taskID string
			for taskID == "" {
				stored, err := s.repo.CloudAgent("user", root.ID)
				if err != nil {
					t.Fatal(err)
				}
				state, err := cloudAgentDecode(stored)
				if err != nil {
					t.Fatal(err)
				}
				if state.ActiveTaskID != before.ActiveTaskID {
					taskID = state.ActiveTaskID
				}
				if taskID != "" {
					break
				}
				select {
				case err := <-done:
					t.Fatalf("bridge exited before scheduling: %v", err)
				case <-ctx.Done():
					t.Fatal(ctx.Err())
				case <-time.After(20 * time.Millisecond):
				}
			}
			task, err := s.repo.TaskForUser("user", taskID)
			if err != nil {
				t.Fatal(err)
			}
			var input map[string]any
			if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
				t.Fatal(err)
			}
			ids := cloudAgentInjectedMemoryIDs(input)
			if int64(len(ids)) != test.want {
				t.Fatalf("dynamic memory missing from model task: ids=%v operation=%s", ids, task.Operation)
			}
			canonical := input["agentRequests"].(map[string]any)["canonical"].(map[string]any)
			if canonical["systemPrompt"] != before.Canonical.SystemPrompt || canonical["promptCacheKey"] != before.Canonical.PromptCacheKey {
				t.Fatal("memory changed the stable system/cache prefix")
			}
			persisted, err := s.repo.AgentLessonForUser("user", lesson.ID)
			if err != nil || persisted.Injected != test.want {
				t.Fatalf("scheduled injection count=%+v err=%v", persisted, err)
			}
			if err := db.Model(&model.Task{}).Where("id = ?", taskID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": `{"text":"已分析","toolCalls":[]}`}).Error; err != nil {
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
				if stringField(message, cloudAgentContextSourceKey) == "agent_memory" {
					t.Fatal("ephemeral retrieval polluted durable conversation")
				}
			}
		})
	}
}
