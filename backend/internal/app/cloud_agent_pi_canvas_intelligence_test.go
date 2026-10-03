package app

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"unicode/utf8"

	"infinite-canvas/backend/internal/model"
)

func TestCanvasIntelligenceUsesPersistedCanvasProject(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	if err := db.Create(&model.CanvasProject{
		ID:     "intelligence-canvas",
		UserID: "user",
		Title:  "智能测试画布",
		PayloadJSON: `{"description":"从持久化文档读取","nodes":[
			{"id":"n1","type":"text","title":"故事主题","content":"故事主题内容","position":{"x":10,"y":20}},
			{"id":"n2","type":"task","title":"下一步","parentId":"n1","metadata":{"status":"todo"}}
		],"connections":[{"fromNodeId":"n1","toNodeId":"n2","type":"flow","label":"推进"}]}`,
	}).Error; err != nil {
		t.Fatal(err)
	}

	context, err := s.NewCanvasIntelligence().BuildEnhancedCanvasContext(t.Context(), "user", "intelligence-canvas", []string{"n1"})
	if err != nil {
		t.Fatalf("build persisted canvas intelligence: %v", err)
	}
	if context.Name != "智能测试画布" || context.Description != "从持久化文档读取" {
		t.Fatalf("unexpected canvas identity: %#v", context)
	}
	if context.Snapshot.TotalNodes != 2 || len(context.Snapshot.FocusNodes) != 1 || len(context.Snapshot.ContextNodes) != 1 {
		t.Fatalf("unexpected node snapshot: %#v", context.Snapshot)
	}
	if len(context.Snapshot.Relationships) == 0 || context.Snapshot.Relationships[0].From != "n1" || context.Snapshot.Relationships[0].To != "n2" {
		t.Fatalf("persisted connection was not projected: %#v", context.Snapshot.Relationships)
	}
}

func TestCanvasIntelligenceBoundsLargeCanvasContext(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	nodes := make([]map[string]any, 0, 140)
	connections := make([]map[string]any, 0, 139)
	for i := 0; i < 140; i++ {
		id := fmt.Sprintf("n-%03d", i)
		nodes = append(nodes, map[string]any{"id": id, "type": "text", "content": strings.Repeat("long body ", 50), "metadata": map[string]any{"large": strings.Repeat("m", 2000)}})
		if i > 0 {
			connections = append(connections, map[string]any{"fromNodeId": fmt.Sprintf("n-%03d", i-1), "toNodeId": id})
		}
	}
	payload, _ := json.Marshal(map[string]any{"nodes": nodes, "connections": connections})
	if err := db.Create(&model.CanvasProject{ID: "large-intelligence", UserID: "user", PayloadJSON: string(payload)}).Error; err != nil {
		t.Fatal(err)
	}
	got, err := s.NewCanvasIntelligence().BuildEnhancedCanvasContext(context.Background(), "user", "large-intelligence", []string{"n-139"})
	if err != nil {
		t.Fatal(err)
	}
	if got.Snapshot.TotalNodes != 140 || len(got.Snapshot.FocusNodes) == 0 || len(got.Snapshot.FocusNodes)+len(got.Snapshot.ContextNodes) > 48 {
		t.Fatalf("unbounded or missing focus nodes: %#v", got.Snapshot)
	}
	if len(got.Snapshot.Relationships) > 128 {
		t.Fatalf("unbounded relationships: %d", len(got.Snapshot.Relationships))
	}
	encoded, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	if len(encoded) > 128<<10 {
		t.Fatalf("canvas context exceeds budget: %d bytes", len(encoded))
	}
}

func TestEnhancedPiRequestRejectsOversizedSerializedBody(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	if err := db.Create(&model.CanvasProject{ID: "request-budget", UserID: "user", PayloadJSON: `{"nodes":[]}`}).Error; err != nil {
		t.Fatal(err)
	}
	_, err := s.buildEnhancedPiRequest(t.Context(), EnhancedPiRequestParams{
		UserID: "user", CanvasID: "request-budget", RunID: "run-budget",
		Prompt: strings.Repeat("x", 8<<20), RuntimeState: &cloudAgentRuntime{},
		Canonical: &canonicalAgentRequest{},
	})
	if err == nil || !strings.Contains(err.Error(), "8 MiB budget") {
		t.Fatalf("expected serialized request budget failure, got %v", err)
	}
}

func TestPiPermissionsUsePersistedCanvasOwnership(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	if err := db.Create(&model.CanvasProject{ID: "permission-canvas", UserID: "owner", PayloadJSON: `{"nodes":[]}`}).Error; err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		user, canvas string
		allowed      bool
	}{
		{"owner", "permission-canvas", true},
		{"other", "permission-canvas", false},
		{"owner", "missing-canvas", false},
	} {
		t.Run(tc.user+"/"+tc.canvas, func(t *testing.T) {
			permissions := s.buildPermissionsConfig(tc.user, tc.canvas)
			for _, key := range []string{"canReadCanvas", "canWriteCanvas", "canCreateNodes", "canDeleteNodes", "canMoveNodes", "canDuplicateNodes", "canManageRelations", "canExportCanvas"} {
				if permissions[key] != tc.allowed {
					t.Errorf("%s = %v, want %v", key, permissions[key], tc.allowed)
				}
			}
		})
	}
}

func TestPiRuntimeRejectsOversizedFinalRequest(t *testing.T) {
	// A resume prompt is installed after building the request. Check the actual
	// dispatch entry before either transport can launch or contact a runtime.
	err := runCloudAgentPi(t.Context(), cloudAgentPiProcessRequest{Prompt: strings.Repeat("x", 8<<20)}, cloudAgentPiBridge{})
	if err == nil || !strings.Contains(err.Error(), "8 MiB budget") {
		t.Fatalf("final request bypassed budget: %v", err)
	}
}

func TestCanvasIntelligenceBoundsPreserveUnicodeAndStatus(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	body := strings.Repeat("品牌中文", 1000)
	nodes := []map[string]any{
		{"id": "focus", "type": "text", "content": body, "metadata": map[string]any{"status": "success", "zIndex": 7, "tags": []any{"品牌"}}},
		{"id": "other", "type": "text", "content": "正文"},
	}
	edges := make([]map[string]any, 400)
	for i := range edges {
		edges[i] = map[string]any{"fromNodeId": "focus", "toNodeId": "other", "label": body}
	}
	payload, _ := json.Marshal(map[string]any{"nodes": nodes, "connections": edges})
	if err := db.Create(&model.CanvasProject{ID: "unicode-budget", UserID: "user", PayloadJSON: string(payload)}).Error; err != nil {
		t.Fatal(err)
	}
	got, err := s.NewCanvasIntelligence().BuildEnhancedCanvasContext(t.Context(), "user", "unicode-budget", []string{"focus"})
	if err != nil {
		t.Fatal(err)
	}
	focus := got.Snapshot.FocusNodes[0]
	if !utf8.ValidString(focus.ContentPreview) || !utf8.ValidString(focus.FullContent) || focus.HasFullContent || focus.FullContent != "" {
		t.Fatalf("truncated content incorrectly presented as full or invalid UTF-8: preview valid=%v full bytes=%d flag=%v", utf8.ValidString(focus.ContentPreview), len(focus.FullContent), focus.HasFullContent)
	}
	if focus.ContentHash != hashContentSHA256(body) || focus.ContentLength != len(body) || focus.Status != "success" || focus.ZIndex != 7 || len(focus.Tags) != 1 {
		t.Fatalf("lost source identity or bounded metadata: %#v", focus)
	}
	encoded, err := json.Marshal(got)
	if err != nil || len(encoded) > 512<<10 {
		t.Fatalf("unbounded explicit edges: bytes=%d err=%v", len(encoded), err)
	}
}
