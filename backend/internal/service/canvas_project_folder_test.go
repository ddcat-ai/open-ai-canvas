package service

import (
	"encoding/json"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestCanvasProjectFolderAssignment(t *testing.T) {
	for _, test := range []struct {
		name       string
		target     string
		wantError  bool
		failUnlink bool
	}{
		{name: "move to another project", target: "target"},
		{name: "move out of project", target: ""},
		{name: "ordinary save preserves chapter links", target: "source"},
		{name: "reject another users project", target: "foreign", wantError: true},
		{name: "reject missing project", target: "missing", wantError: true},
		{name: "reject archived target", target: "archived", wantError: true},
		{name: "unlink failure rolls back canvas and revisions", target: "target", wantError: true, failUnlink: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			svc, db, _, user := newAppearanceTestService(t)
			for _, project := range []model.Project{
				{ID: "source", UserID: user.ID, Name: "原项目", Status: model.ProjectStatusActive, Revision: 1},
				{ID: "target", UserID: user.ID, Name: "目标项目", Status: model.ProjectStatusActive, Revision: 1},
				{ID: "foreign", UserID: "another-user", Name: "其他人的项目", Status: model.ProjectStatusActive, Revision: 1},
				{ID: "archived", UserID: user.ID, Name: "已归档项目", Status: model.ProjectStatusArchived, Revision: 1},
			} {
				if err := db.Create(&project).Error; err != nil {
					t.Fatal(err)
				}
			}
			original := model.CanvasProject{ID: "canvas", UserID: user.ID, ProjectID: "source", Title: "第一集", PayloadJSON: `{"id":"canvas","projectId":"source","title":"第一集","nodes":[]}`}
			if err := db.Create(&original).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Create(&model.CanvasUnitLink{ID: "link", ProjectID: "source", CanvasID: original.ID, UnitID: "chapter"}).Error; err != nil {
				t.Fatal(err)
			}
			if test.failUnlink {
				if err := db.Exec("CREATE TRIGGER fail_folder_unlink BEFORE DELETE ON canvas_unit_links BEGIN SELECT RAISE(ABORT, 'unlink failed'); END").Error; err != nil {
					t.Fatal(err)
				}
			}
			raw, err := json.Marshal(map[string]any{"id": original.ID, "projectId": test.target, "title": "第一集", "nodes": []any{map[string]any{"id": "text", "type": "text", "title": "故事大纲"}}})
			if err != nil {
				t.Fatal(err)
			}
			_, err = svc.UpsertUserCanvasProject(user.ID, raw)
			if (err != nil) != test.wantError {
				t.Fatalf("save error = %v, wantError = %v", err, test.wantError)
			}
			var saved model.CanvasProject
			if err := db.First(&saved, "id = ?", original.ID).Error; err != nil {
				t.Fatal(err)
			}
			wantProject := test.target
			if test.wantError {
				wantProject = original.ProjectID
			}
			if saved.ProjectID != wantProject {
				t.Fatalf("project = %q, want %q", saved.ProjectID, wantProject)
			}
			var payload map[string]any
			if err := json.Unmarshal([]byte(saved.PayloadJSON), &payload); err != nil {
				t.Fatal(err)
			}
			if payload["projectId"] != wantProject {
				t.Fatalf("snapshot project = %v, want %q", payload["projectId"], wantProject)
			}
			if test.wantError && saved.PayloadJSON != original.PayloadJSON {
				t.Fatal("failed move changed the canvas payload")
			}
			if !test.wantError && len(payload["nodes"].([]any)) != 1 {
				t.Fatal("move lost canvas content")
			}
			var linkCount int64
			if err := db.Model(&model.CanvasUnitLink{}).Where("canvas_id = ?", original.ID).Count(&linkCount).Error; err != nil {
				t.Fatal(err)
			}
			changed := !test.wantError && test.target != original.ProjectID
			if (linkCount == 0) != changed {
				t.Fatalf("chapter links = %d, assignment changed = %v", linkCount, changed)
			}
			for _, id := range []string{"source", "target", "foreign", "archived"} {
				var project model.Project
				if err := db.First(&project, "id = ?", id).Error; err != nil {
					t.Fatal(err)
				}
				wantRevision := int64(1)
				if changed && (id == original.ProjectID || id == test.target) {
					wantRevision++
				}
				if project.Revision != wantRevision {
					t.Fatalf("%s revision = %d, want %d", id, project.Revision, wantRevision)
				}
			}
		})
	}
}
