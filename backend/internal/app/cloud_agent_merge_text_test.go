package app

import (
	"encoding/json"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestCloudAgentMergeTextPersistsLongOrderedScript(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	parts := []string{
		"第01集\n" + strings.Repeat("场景一：对白甲。\n", 500),
		"第07集\n" + strings.Repeat("场景二：对白乙。\n", 500),
		"第13集\n" + strings.Repeat("场景三：对白丙。\n", 500),
	}
	nodes := make([]map[string]any, 0, 3)
	for i, part := range parts {
		nodes = append(nodes, map[string]any{"id": []string{"ep01", "ep07", "ep13"}[i], "type": "text", "title": "剧本", "metadata": map[string]any{"content": "分集总标题\n" + part}})
	}
	raw, _ := json.Marshal(map[string]any{"nodes": nodes, "connections": []any{}})
	if err := db.Create(&model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: string(raw)}).Error; err != nil {
		t.Fatal(err)
	}
	doc, _ := creationDocument(string(raw))
	hash := cloudAgentCanvasHash(doc)
	args, _ := json.Marshal(map[string]any{"snapshotHash": hash, "nodeId": "full-script", "title": "EP01–18 完整剧本", "heading": "完整剧本", "sources": []any{
		map[string]any{"nodeId": "ep01", "removePrefix": "分集总标题\n"},
		map[string]any{"nodeId": "ep07", "removePrefix": "分集总标题\n"},
		map[string]any{"nodeId": "ep13", "removePrefix": "分集总标题\n"},
	}})
	if len(args) >= cloudAgentMaxOutputBytes {
		t.Fatalf("merge arguments unexpectedly large: %d", len(args))
	}
	call := cloudAgentCall{ID: "merge"}
	call.Function.Name, call.Function.Arguments = "canvas_merge_text", string(args)
	policy, err := s.RuntimePolicy()
	if err != nil {
		t.Fatal(err)
	}
	result, err := applyCloudAgentMergeText(s.repo, "user", "agent-canvas", call, policy)
	if err != nil {
		t.Fatal(err)
	}
	receipt := result.(map[string]any)
	if receipt["committed"] != true || receipt["verified"] != true {
		t.Fatalf("missing verified receipt: %+v", receipt)
	}
	stored, err := s.repo.CanvasProjectForUser("user", "agent-canvas")
	if err != nil {
		t.Fatal(err)
	}
	storedDoc, _ := creationDocument(stored.PayloadJSON)
	storedNodes, _ := creationObjects(storedDoc["nodes"])
	content := storedNodes["full-script"]["metadata"].(map[string]any)["content"].(string)
	want := "完整剧本\n\n" + strings.Join(parts, "\n\n")
	if content != want || strings.Count(content, "分集总标题") != 0 || receipt["result"].(cloudAgentTextIntegrity).SHA256 != cloudAgentTextSHA256(want) {
		t.Fatal("merged text differs from ordered sources")
	}
	if len(content) < cloudAgentMaxOutputBytes {
		t.Fatalf("test did not cover oversized inline write: %d bytes", len(content))
	}
}

func TestCloudAgentMergeTextRejectsUnreliableSourcesAndStaleSnapshot(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	raw := `{"nodes":[{"id":"a","type":"text","metadata":{"content":"总标题\n第一集��"}},{"id":"b","type":"text","metadata":{"content":"总标题\n第二集"}}],"connections":[]}`
	if err := db.Create(&model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: raw}).Error; err != nil {
		t.Fatal(err)
	}
	doc, _ := creationDocument(raw)
	hash := cloudAgentCanvasHash(doc)
	makeCall := func(snapshot string, sources []map[string]string) cloudAgentCall {
		args, _ := json.Marshal(map[string]any{"snapshotHash": snapshot, "nodeId": "merged", "title": "合并", "sources": sources})
		call := cloudAgentCall{ID: "merge"}
		call.Function.Name, call.Function.Arguments = "canvas_merge_text", string(args)
		return call
	}
	for _, tc := range []struct {
		name, snapshot string
		sources        []map[string]string
	}{
		{"replacement", hash, []map[string]string{{"nodeId": "a"}, {"nodeId": "b"}}},
		{"stale", "old-hash", []map[string]string{{"nodeId": "b"}, {"nodeId": "a"}}},
		{"duplicate", hash, []map[string]string{{"nodeId": "b"}, {"nodeId": "b"}}},
		{"prefix mismatch", hash, []map[string]string{{"nodeId": "b", "removePrefix": "别的标题"}, {"nodeId": "a"}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := prepareCloudAgentMergeText(s.repo, "user", "agent-canvas", makeCall(tc.snapshot, tc.sources)); err == nil {
				t.Fatal("unsafe merge was accepted")
			}
		})
	}
	stored, _ := s.repo.CanvasProjectForUser("user", "agent-canvas")
	if stored.PayloadJSON != raw {
		t.Fatal("rejected merge changed source canvas")
	}
}

func TestCloudAgentReadTextReportsPersistedReplacementCharacter(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	content := "第六集\n对白��结束\n"
	raw, _ := json.Marshal(map[string]any{"nodes": []any{map[string]any{"id": "ep06", "type": "text", "metadata": map[string]any{"content": content}}}})
	if err := db.Create(&model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: string(raw)}).Error; err != nil {
		t.Fatal(err)
	}
	state := &cloudAgentRuntime{Request: CloudAgentRequest{CanvasID: "agent-canvas"}}
	call := cloudAgentCall{ID: "read"}
	call.Function.Name, call.Function.Arguments = "canvas_read_text", `{"nodeId":"ep06","maxChars":3}`
	result, err := cloudAgentHandleCanvasReadText(s.repo, "user", state, call, s)
	if err != nil {
		t.Fatal(err)
	}
	view := result.(map[string]any)
	if view["replacementChars"] != 2 || view["contentSha256"] != cloudAgentTextSHA256(content) || view["totalBytes"] != len(content) {
		t.Fatalf("read did not report stored content integrity: %+v", view)
	}
	call.Function.Arguments = `{"nodeId":"ep06","offset":3}`
	result, err = cloudAgentHandleCanvasReadText(s.repo, "user", state, call, s)
	if err != nil || result.(map[string]any)["content"] != string([]rune(content)[3:]) {
		t.Fatalf("read lost trailing newline: result=%+v err=%v", result, err)
	}
}
