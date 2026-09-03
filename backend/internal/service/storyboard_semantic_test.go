package service

import (
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestPersistAgentStoryboardShotsUsesSemanticIDsInCanvasProjection(t *testing.T) {
	service, db := newProjectWorkflowV2TestService(t)
	project, unit := seedWorkflowProject(t, db)
	if err := db.AutoMigrate(&model.PromptTemplate{}, &model.UserPromptCustomization{}, &model.CanvasUnitLink{}); err != nil {
		t.Fatal(err)
	}
	canvas := model.CanvasProject{ID: "canvas-1", UserID: "user-1", Title: "分镜画布"}
	if err := db.Create(&canvas).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.CanvasUnitLink{ID: "link-1", ProjectID: project.ID, CanvasID: canvas.ID, UnitID: unit.ID, Role: "storyboard"}).Error; err != nil {
		t.Fatal(err)
	}

	task := model.Task{ID: "task-1", UserID: "user-1", ProjectID: canvas.ID, Operation: "storyboard"}
	input := agentStoryboardInput{DomainProjectID: project.ID, ProjectStyle: storyboardProjectStyle{Prompt: "电影感写实"}}
	plan := agentStoryboardPlan{Title: "归来", StyleGuide: "冷色写实", Shots: []agentStoryboardShot{{
		Title: "门口", Description: "人物站在门口抬头", Duration: 4, ShotSize: "中景", Camera: "平视", Motion: "缓慢推近", VisualPrompt: "人物位于画面左侧", Performance: "抬头",
	}, {
		Title: "推门", Description: "人物推门进入", Duration: 3, ShotSize: "近景", Camera: "低机位", Motion: "固定机位", VisualPrompt: "手部靠近门把手", Performance: "推门",
	}}}

	persisted, err := service.persistAgentStoryboardShots(task, input, plan)
	if err != nil {
		t.Fatal(err)
	}
	if len(persisted) != 2 || persisted[0].ShotID == "" || persisted[1].ShotID == "" {
		t.Fatalf("persisted shots = %#v", persisted)
	}
	var shots []model.Shot
	if err := db.Where("project_id = ? AND unit_id = ?", project.ID, unit.ID).Order("position asc").Find(&shots).Error; err != nil {
		t.Fatal(err)
	}
	if len(shots) != 2 || shots[0].ID != persisted[0].ShotID || shots[1].ID != persisted[1].ShotID {
		t.Fatalf("shots = %#v, persisted = %#v", shots, persisted)
	}
	var revisions []model.ShotRevision
	if err := db.Where("shot_id IN ?", []string{shots[0].ID, shots[1].ID}).Order("version asc").Find(&revisions).Error; err != nil {
		t.Fatal(err)
	}
	if len(revisions) != 2 || revisions[0].Version != 1 || revisions[0].ImagePrompt == "" || revisions[0].VideoPrompt == "" {
		t.Fatalf("revisions = %#v", revisions)
	}

	_, ops, err := service.buildAgentStoryboardResult(task, plan, nil, input.ProjectStyle, persisted)
	if err != nil {
		t.Fatal(err)
	}
	var shotOps []map[string]any
	for _, op := range ops {
		if op["type"] != "add_node" || op["nodeType"] != "video" {
			continue
		}
		metadata, _ := op["metadata"].(map[string]any)
		if metadata["workflowKind"] == "shot" {
			shotOps = append(shotOps, metadata)
		}
	}
	if len(shotOps) != 2 {
		t.Fatalf("shot ops = %#v", shotOps)
	}
	for index, metadata := range shotOps {
		if metadata["domainProjectId"] != project.ID || metadata["unitId"] != unit.ID || metadata["shotId"] != persisted[index].ShotID {
			t.Fatalf("shot metadata[%d] = %#v", index, metadata)
		}
		if metadata["projectionKey"] != "shot:"+persisted[index].ShotID || metadata["projectionVersion"] != 1 {
			t.Fatalf("projection metadata[%d] = %#v", index, metadata)
		}
	}
}

func TestPersistAgentStoryboardShotsRequiresUnambiguousCanvasUnit(t *testing.T) {
	service, db := newProjectWorkflowV2TestService(t)
	project, _ := seedWorkflowProject(t, db)
	if err := db.AutoMigrate(&model.CanvasUnitLink{}); err != nil {
		t.Fatal(err)
	}
	canvas := model.CanvasProject{ID: "canvas-1", UserID: "user-1", Title: "分镜画布"}
	if err := db.Create(&canvas).Error; err != nil {
		t.Fatal(err)
	}
	input := agentStoryboardInput{DomainProjectID: project.ID}
	_, err := service.persistAgentStoryboardShots(model.Task{UserID: "user-1", ProjectID: canvas.ID}, input, agentStoryboardPlan{Shots: []agentStoryboardShot{{Title: "镜头", Description: "画面", Duration: 1}}})
	if err == nil {
		t.Fatal("expected missing canvas-unit link to fail")
	}
}

