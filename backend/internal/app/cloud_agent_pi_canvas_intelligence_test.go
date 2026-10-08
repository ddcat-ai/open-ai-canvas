package app

import (
	"testing"

	"yingce/backend/internal/model"
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
