package app

import (
	"encoding/json"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

// 短剧状态要带来源与读取时间：drama_get_context 读库，canvas_get_state 只是画布快照，绑定短剧的节点提示去 drama_get_context 核对。
func TestCloudAgentDramaReadsReportSourceAndFreshness(t *testing.T) {
	svc, fake := newDramaTestService(t)
	project := createTestDrama(t, svc, DramaReviewAuto).Project.ID
	runDramaTicks(t, svc, project, 12)
	summary, err := svc.DramaSummary("usr-drama", project)
	if err != nil || len(summary.Episodes) == 0 {
		t.Fatalf("drama fixture has no episodes: %+v %v", summary.Episodes, err)
	}
	payload := map[string]any{"id": "canvas-drama", "nodes": []any{
		map[string]any{"id": "segment-node", "type": "video", "title": "第 1 段", "metadata": map[string]any{"status": "running", "dramaRef": map[string]any{"kind": "segment", "id": "seg", "episodeId": summary.Episodes[0].ID, "segmentIndex": 0}}},
		map[string]any{"id": "plain-node", "type": "text", "title": "笔记"},
	}, "connections": []any{}}
	raw, _ := json.Marshal(payload)
	if err := fake.db.Create(&model.CanvasProject{ID: "canvas-drama", UserID: "usr-drama", ProjectID: project, Title: "精修", PayloadJSON: string(raw), Revision: 7}).Error; err != nil {
		t.Fatal(err)
	}
	state := &cloudAgentRuntime{Request: CloudAgentRequest{CanvasID: "canvas-drama"}}
	call := cloudAgentCall{ID: "drama-read"}
	call.Function.Name = "drama_get_context"
	call.Function.Arguments = `{"episodeNumber":1}`
	before := time.Now().Add(-time.Second)
	value, err := cloudAgentHandleDramaGetContext(svc.repo, "usr-drama", state, call, svc)
	if err != nil {
		t.Fatal(err)
	}
	result := value.(map[string]any)
	readAt, err := time.Parse(time.RFC3339, stringValue(result["readAt"]))
	if err != nil || readAt.Before(before) || result["source"] != "drama_db" || result["note"] != cloudAgentDramaContextNote {
		t.Fatalf("drama context freshness = readAt %v source %v note %v (%v)", result["readAt"], result["source"], result["note"], err)
	}
	if _, ok := result["drama"].(map[string]any)["heldCredits"]; !ok {
		t.Fatalf("drama context must expose held credits: %+v", result["drama"])
	}
	episodes := result["episodes"].([]map[string]any)
	if episodes[0]["revision"] != summary.Episodes[0].Revision || stringValue(episodes[0]["updatedAt"]) == "" {
		t.Fatalf("episode rows must carry revision and updatedAt: %+v", episodes[0])
	}
	episode := result["episode"].(map[string]any)
	if stringValue(episode["updatedAt"]) == "" {
		t.Fatalf("episode detail must carry updatedAt: %+v", episode)
	}
	segments := episode["segments"].([]map[string]any)
	if len(segments) == 0 {
		t.Fatal("episode detail has no segments")
	}
	rows, err := svc.repo.DramaSegments(summary.Episodes[0].ID)
	if err != nil || len(rows) == 0 {
		t.Fatalf("segment rows: %v", err)
	}
	if segments[0]["revision"] != rows[0].Revision || segments[0]["updatedAt"] != rows[0].UpdatedAt.Format(time.RFC3339) {
		t.Fatalf("segment must carry the row revision and updatedAt: %+v vs %+v", segments[0], rows[0])
	}

	view, err := cloudAgentCanvasState(svc.repo, "usr-drama", "canvas-drama", payload, 0, nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	canvasResult := view.(map[string]any)
	if canvasResult["source"] != "canvas_snapshot" || canvasResult["canvasRevision"] != int64(7) {
		t.Fatalf("canvas state source = %v revision = %#v", canvasResult["source"], canvasResult["canvasRevision"])
	}
	if _, err := time.Parse(time.RFC3339, stringValue(canvasResult["readAt"])); err != nil {
		t.Fatalf("canvas state readAt = %v", canvasResult["readAt"])
	}
	for _, raw := range canvasResult["nodes"].([]any) {
		node := raw.(map[string]any)
		_, hinted := node["dramaStatusSource"]
		if node["id"] == "segment-node" && node["dramaStatusSource"] != "drama_get_context" {
			t.Fatalf("drama-bound node must point to drama_get_context: %+v", node)
		}
		if node["id"] == "plain-node" && hinted {
			t.Fatalf("plain node must not carry a drama hint: %+v", node)
		}
	}
}
