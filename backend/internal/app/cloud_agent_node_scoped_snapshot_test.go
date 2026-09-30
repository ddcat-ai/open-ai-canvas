package app

import (
	"encoding/json"
	"strings"
	"testing"
)

// 线上复现：Agent 读完分镜准备改第三镜，用户在画布上删掉一个无关节点，
// Agent 的修改被整画布哈希判为"画布已变化"，整轮失败。
// 分镜/批量表的版本只看目标节点本身：无关节点的增删改不影响；目标节点被改才拒绝。
func TestCloudAgentStoryboardEditSurvivesUnrelatedCanvasChanges(t *testing.T) {
	s, canvas := cloudAgentStoryboardFixture(t)
	rows := createCloudAgentStoryboardForTest(t, s, canvas)
	policy, err := s.RuntimePolicy()
	if err != nil {
		t.Fatal(err)
	}

	// 用户在画布上加一个无关节点。
	stored, err := s.repo.CanvasProjectForUser("user", canvas.ID)
	if err != nil {
		t.Fatal(err)
	}
	doc, _ := creationDocument(stored.PayloadJSON)
	doc["nodes"] = append(creationMaps(doc["nodes"]), map[string]any{"id": "scratch", "type": "text", "metadata": map[string]any{"content": "随手记"}})
	raw, _ := json.Marshal(doc)
	before := stored.PayloadJSON
	stored.PayloadJSON = string(raw)
	if err := saveCreationCanvasWithHistory(s.repo, stored, before); err != nil {
		t.Fatal(err)
	}

	// Agent 用生产读工具读取分镜，拿到的版本号。
	state := &cloudAgentRuntime{Request: CloudAgentRequest{CanvasID: canvas.ID}}
	read := cloudAgentCall{ID: "read"}
	read.Function.Name = "canvas_read_storyboard"
	read.Function.Arguments = `{"nodeId":"storyboard-1"}`
	view, err := cloudAgentReadTool(s.repo, "user", state, read)
	if err != nil {
		t.Fatal(err)
	}
	readHash, _ := view.(map[string]any)["snapshotHash"].(string)
	if readHash == "" {
		t.Fatal("storyboard read returned no snapshotHash")
	}

	// 用户删掉那个无关节点（与截图里的操作一致）。
	stored, _ = s.repo.CanvasProjectForUser("user", canvas.ID)
	doc, _ = creationDocument(stored.PayloadJSON)
	kept := []map[string]any{}
	for _, node := range creationMaps(doc["nodes"]) {
		if stringValue(node["id"]) != "scratch" {
			kept = append(kept, node)
		}
	}
	doc["nodes"] = kept
	raw, _ = json.Marshal(doc)
	before = stored.PayloadJSON
	stored.PayloadJSON = string(raw)
	if err := saveCreationCanvasWithHistory(s.repo, stored, before); err != nil {
		t.Fatal(err)
	}

	edit := cloudAgentStoryboardCall(t, "canvas_edit_storyboard", "edit-after-unrelated-delete", map[string]any{
		"snapshotHash": readHash, "nodeId": "storyboard-1", "action": "update", "rowId": stringValue(rows[0]["id"]),
		"patch": map[string]any{"dialogue": "差两文！"},
	})
	result, err := applyCloudAgentStoryboardMutation(s.repo, "user", canvas.ID, edit, policy)
	if err != nil {
		t.Fatalf("unrelated node deletion must not block the storyboard edit: %v", err)
	}
	after, _ := s.repo.CanvasProjectForUser("user", canvas.ID)
	if !strings.Contains(after.PayloadJSON, "差两文！") {
		t.Fatal("edit was not written")
	}

	// 返回的新版本号可以直接用于下一次修改（同一轮连续改多镜）。
	nextHash, _ := result.(map[string]any)["snapshotHash"].(string)
	next := cloudAgentStoryboardCall(t, "canvas_edit_storyboard", "next-edit", map[string]any{
		"snapshotHash": nextHash, "nodeId": "storyboard-1", "action": "update", "rowId": stringValue(rows[1]["id"]),
		"patch": map[string]any{"dialogue": "拍铜板报价"},
	})
	if _, err := applyCloudAgentStoryboardMutation(s.repo, "user", canvas.ID, next, policy); err != nil {
		t.Fatalf("follow-up edit with returned version failed: %v", err)
	}

	// 目标分镜本身被别处改过：旧版本号必须被拒绝，不能覆盖用户的修改。
	if _, err := applyCloudAgentStoryboardMutation(s.repo, "user", canvas.ID, edit, policy); err == nil || !strings.Contains(err.Error(), "被修改过") {
		t.Fatalf("stale version of the same storyboard must be rejected: %v", err)
	}
}
