package app

import (
	"encoding/json"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func skillFeedbackCall(id, path string) cloudAgentCall {
	call := cloudAgentCall{ID: "call"}
	call.Function.Name = "skill_read_file"
	args, _ := json.Marshal(map[string]string{"skillId": id, "path": path})
	call.Function.Arguments = string(args)
	return call
}

// skillFeedbackFixture 建立用户自建的技能（可附带参考文件），返回服务、按名称索引的技能 ID 和本轮冻结版本。
func skillFeedbackFixture(t *testing.T, packs map[string]map[string]string) (*Service, map[string]string, cloudAgentRuntime) {
	t.Helper()
	s, db, _, _ := creationTestService(t)
	if sqlDB, err := db.DB(); err == nil {
		t.Cleanup(func() { _ = sqlDB.Close() })
	}
	ids := map[string]string{}
	for name, files := range packs {
		created, err := s.CreateSkill("user", SkillMutationRequest{SkillName: name, Description: name + "工作法", Instruction: "# " + name, Tag: "drama", IsPrivate: true})
		if err != nil {
			t.Fatal(err)
		}
		if len(files) > 0 {
			ops := make([]SkillPackageFileOperation, 0, len(files))
			for path, content := range files {
				content := content
				ops = append(ops, SkillPackageFileOperation{Op: "write", Path: path, Content: &content})
			}
			if _, err := s.EditSkillPackageFiles("user", created.SkillID, SkillPackageEditRequest{BaseVersionID: created.VersionID, Operations: ops}); err != nil {
				t.Fatal(err)
			}
		}
		ids[name] = created.SkillID
	}
	pool, err := s.cloudAgentBuildSkillPool("user", "", nil, defaultCloudAgentContextBudget())
	if err != nil {
		t.Fatal(err)
	}
	return s, ids, cloudAgentRuntime{SkillVersions: pool.Versions}
}

func TestCloudAgentSkillEmptyDirectoryAndRepeatedRead(t *testing.T) {
	s, ids, state := skillFeedbackFixture(t, map[string]map[string]string{"剧本撰写": nil})
	call := skillFeedbackCall(ids["剧本撰写"], "")
	result, err := cloudAgentReadToolCached(nil, "user", &state, call, s)
	if err != nil {
		t.Fatal(err)
	}
	data := result.(map[string]any)
	if data["entryPath"] != cloudAgentSkillEntryPath || strings.Join(data["files"].([]string), ",") != cloudAgentSkillEntryPath || !strings.Contains(data["guidance"].(string), "先读取 SKILL.md") {
		t.Fatalf("missing empty-directory guidance: %+v", data)
	}
	cloudAgentToolResult("", &state, call, result, nil)
	if event := state.Events[0]; event.Type != "tool_completed" || event.Payload["skillName"] != "剧本撰写" || event.Payload["path"] != "" {
		t.Fatalf("missing tool context: %+v", event)
	}
	second, err := cloudAgentReadToolCached(nil, "user", &state, call, s)
	if err != nil {
		t.Fatalf("repeated skill read must use the cached result: %v", err)
	}
	secondMap, ok := second.(map[string]any)
	if !ok || secondMap["cacheReplay"] != true || secondMap["replayCount"] != 1 {
		t.Fatalf("repeated skill read did not return a replay receipt: %#v", second)
	}
	if state.ReadToolCalls != 1 {
		t.Fatalf("cache replay consumed a real-read budget: %d", state.ReadToolCalls)
	}

	// A model can repeat the same call more than once while recovering a long
	// context. Replays stay harmless and never terminate the run.
	if _, err := cloudAgentReadToolCached(nil, "user", &state, call, s); err != nil {
		t.Fatalf("second repeated skill read must remain harmless: %v", err)
	}
}

func TestCloudAgentSkillEntryDocumentIsReadableFromSnapshot(t *testing.T) {
	s, ids, state := skillFeedbackFixture(t, map[string]map[string]string{"剧本撰写": {"references/format.md": "格式参考"}})
	listing, err := cloudAgentReadTool(nil, "user", &state, skillFeedbackCall(ids["剧本撰写"], ""), s)
	if err != nil {
		t.Fatal(err)
	}
	if paths := listing.(map[string]any)["files"].([]string); strings.Join(paths, ",") != "SKILL.md,references/format.md" {
		t.Fatalf("entry path was missing or duplicated: %v", paths)
	}
	result, err := cloudAgentReadTool(nil, "user", &state, skillFeedbackCall(ids["剧本撰写"], cloudAgentSkillEntryPath), s)
	if err != nil {
		t.Fatal(err)
	}
	data := result.(map[string]any)
	if data["path"] != cloudAgentSkillEntryPath || !strings.HasPrefix(data["content"].(string), "# 剧本撰写") || data["skillName"] != "剧本撰写" {
		t.Fatalf("skill entry did not come from the frozen version: %+v", data)
	}
}

func TestCloudAgentSkillMissingAndDistinctPaths(t *testing.T) {
	s, ids, state := skillFeedbackFixture(t, map[string]map[string]string{
		"剧本": {"references/b.md": "B", "references/a.md": "A"},
		"其他": {"references/a.md": "other"},
	})
	script, other := ids["剧本"], ids["其他"]
	result, err := cloudAgentReadTool(nil, "user", &state, skillFeedbackCall(script, ""), s)
	if err != nil || strings.Join(result.(map[string]any)["files"].([]string), ",") != "SKILL.md,references/a.md,references/b.md" {
		t.Fatalf("directory not sorted: %+v, %v", result, err)
	}
	for _, test := range []struct{ id, path, content string }{{script, "references/a.md", "A"}, {script, "references/b.md", "B"}, {other, "references/a.md", "other"}} {
		result, err := cloudAgentReadTool(nil, "user", &state, skillFeedbackCall(test.id, test.path), s)
		if err != nil || result.(map[string]any)["content"] != test.content {
			t.Fatalf("distinct read rejected: %+v, %v", result, err)
		}
	}
	call := skillFeedbackCall(script, "references/missing.md")
	result, err = cloudAgentReadTool(nil, "user", &state, call, s)
	if err == nil || !strings.Contains(err.Error(), "references/a.md") {
		t.Fatalf("missing available paths: %v", err)
	}
	cloudAgentToolResult("run", &state, call, result, err)
	if state.Events[0].Type != "tool_failed" || state.Events[0].Payload["path"] != "references/missing.md" {
		t.Fatalf("missing failure context: %+v", state.Events[0])
	}
	if _, err := cloudAgentReadTool(nil, "user", &state, skillFeedbackCall("disabled", ""), s); err == nil {
		t.Fatal("skill outside the run pool accepted")
	}
}

func TestCloudAgentModelFailureRedactsProviderDetails(t *testing.T) {
	for _, test := range []struct{ raw, reason string }{
		{"connection reset by peer", "model_connection_reset"},
		{"context deadline exceeded", "model_request_timeout"},
		{"connection refused", "model_connection_refused"},
		{"unknown provider error", "model_task_failed"},
	} {
		text, reason := cloudAgentModelFailure(&model.Task{ID: "task-id", Error: `Post "https://private.example?key=secret": ` + test.raw})
		if reason != test.reason || !strings.Contains(text, "task-id") || strings.Contains(text, "private") || strings.Contains(text, "secret") {
			t.Fatalf("unsafe or incorrect error: %q, %q", text, reason)
		}
	}
}

func TestCloudAgentFailedModelEmitsSafeReason(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	if err := db.Create(&model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: `{"nodes":[]}`}).Error; err != nil {
		t.Fatal(err)
	}
	run, err := s.CreateCloudAgentRun("user", agentTestRequest(), "")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", run.ID).Updates(map[string]any{"status": model.TaskStatusFailed, "error": "private-url connection reset by peer"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	stored, err := s.repo.CloudAgent("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := cloudAgentDecode(stored)
	if err != nil {
		t.Fatal(err)
	}
	event := state.Events[len(state.Events)-1]
	if stored.Status != "failed" || event.Type != "run_failed" || event.Payload["reason"] != "model_connection_reset" || event.Payload["taskId"] != run.ID || strings.Contains(event.Payload["text"].(string), "private-url") {
		t.Fatalf("incorrect model failure event: %+v", event)
	}
}
