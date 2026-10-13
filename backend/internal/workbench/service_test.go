package workbench

import (
	"encoding/json"
	"strings"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type allowAdmin struct{ audited int }

func (a *allowAdmin) RequireAdmin(user *model.User) error {
	if user == nil || user.Role != model.UserRoleAdmin {
		return gorm.ErrInvalidData
	}
	return nil
}
func (a *allowAdmin) AppendAudit(_ *model.User, _, _, _, _ string, _ any) error {
	a.audited++
	return nil
}

type resourceAccessStub struct{}

func (resourceAccessStub) WorkbenchResourceAccess(id string) (string, error) {
	return "/api/public/resources/" + id, nil
}

func newWorkbenchTest(t *testing.T) (*Service, *gorm.DB, *allowAdmin) {
	t.Helper()
	dsn := "file:workbench-tests-" + strings.ReplaceAll(t.Name(), "/", "_") + "?mode=memory&cache=shared"
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.WorkbenchTool{}, &model.WorkbenchPreset{}, &model.Resource{}); err != nil {
		t.Fatal(err)
	}
	admin := &allowAdmin{}
	return New(repository.New(db), admin, resourceAccessStub{}), db, admin
}

func TestWorkbenchAdminCRUDAuditsAndPublishesSafeDirectory(t *testing.T) {
	s, db, audit := newWorkbenchTest(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	resource := model.Resource{ID: "icon", UserID: "admin", Kind: "image", Status: model.ResourceStatusReady}
	if err := db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}
	tool, err := s.CreateTool(admin, ToolInput{Kind: KindImage, CategoryID: "recommended", Name: "Portrait", IconResourceID: "icon", Capability: json.RawMessage(`{"referenceKinds":["image"]}`), Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	if tool.IconResourceID != "icon" || tool.IconURL != "" {
		t.Fatalf("admin projection mismatch: %#v", tool)
	}
	preset, err := s.CreatePreset(admin, PresetInput{ToolID: tool.ID, Name: "Studio portrait", PromptTemplate: "Portrait of {{subject}}", Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	public, err := s.PublicTools(KindImage)
	if err != nil {
		t.Fatal(err)
	}
	if len(public) != 1 || public[0].IconResourceID != "icon" || public[0].IconURL != "/api/public/resources/icon" || len(public[0].Presets) != 1 || public[0].Presets[0].ID != preset.ID {
		t.Fatalf("public catalog mismatch: %#v", public)
	}
	if audit.audited != 2 {
		t.Fatalf("audits=%d want 2", audit.audited)
	}
}

func TestWorkbenchRejectsNonAdminResourcesAndInvalidPresetParent(t *testing.T) {
	s, db, _ := newWorkbenchTest(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	resource := model.Resource{ID: "private-icon", UserID: "other", Kind: "image", Status: model.ResourceStatusReady}
	if err := db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateTool(admin, ToolInput{Kind: KindVideo, Name: "Video", IconResourceID: "private-icon"}); err == nil {
		t.Fatal("expected foreign resource rejection")
	}
	if _, err := s.CreatePreset(admin, PresetInput{ToolID: "missing", Name: "Preset", PromptTemplate: "prompt"}); err == nil {
		t.Fatal("expected missing tool rejection")
	}
	if _, err := s.CreateTool(&model.User{ID: "user", Role: model.UserRoleUser}, ToolInput{Kind: KindImage, Name: "No"}); err == nil {
		t.Fatal("expected non-admin rejection")
	}
}

func TestWorkbenchTaskRejectsForeignResourcesAndPreservesRoleAndPresetSnapshot(t *testing.T) {
	s, db, _ := newWorkbenchTest(t)
	tool := model.WorkbenchTool{ID: "tool", Kind: KindVideo, Name: "Image to video", Enabled: true, Version: 4, CapabilityJSON: `{"referenceKinds":["image"],"inputContract":{"slots":[{"key":"subject","name":"Subject","mediaTypes":["image"],"maxCount":1,"minCount":1,"required":true}]}}`}
	preset := model.WorkbenchPreset{ID: "preset", ToolID: "tool", Name: "Motion", PromptTemplate: "move gently", Enabled: true, Version: 2}
	image := model.Resource{ID: "image", UserID: "user", Kind: "image", Status: model.ResourceStatusReady}
	foreign := model.Resource{ID: "foreign", UserID: "other", Kind: "image", Status: model.ResourceStatusReady}
	for _, item := range []any{&tool, &preset, &image, &foreign} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	request := TaskInput{Kind: KindVideo, ToolID: "tool", PresetID: "preset", Prompt: "A woman walks", Model: "video-model", LogicalModelID: "logical", Parameters: map[string]any{"seconds": 6, "ratio": "16:9", "generateAudio": true}, References: []TaskReference{{ResourceID: "image", Kind: "image", Role: "first_frame", SlotKey: "subject"}}}
	resolved, err := s.ResolveTask("user", request)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.TaskType != "canvas_video" {
		t.Fatalf("task type = %q", resolved.TaskType)
	}
	metadata := resolved.Input["metadata"].(map[string]any)
	if metadata["workbenchToolVersion"] != 4 || metadata["workbenchPresetVersion"] != 2 || metadata["workbenchPresetPrompt"] != "move gently" {
		t.Fatalf("missing historical snapshot: %#v", metadata)
	}
	workbenchSnapshot := metadata["workbench"].(map[string]any)
	parameters := workbenchSnapshot["parameters"].(map[string]any)
	if parameters["seconds"] != 6 || parameters["ratio"] != "16:9" || parameters["generateAudio"] != true {
		t.Fatalf("parameters not snapshotted: %#v", parameters)
	}
	refs := resolved.Input["referenceImages"].([]map[string]any)
	if refs[0]["role"] != "first_frame" || refs[0]["resourceId"] != "image" || refs[0]["storageKey"] != "resource:image" || refs[0]["slotKey"] != "subject" {
		t.Fatalf("authorized reference not preserved for provider input: %#v", refs)
	}
	snapshotRefs := workbenchSnapshot["references"].([]map[string]any)
	if len(snapshotRefs) != 1 || snapshotRefs[0]["resourceId"] != "image" || snapshotRefs[0]["role"] != "first_frame" || snapshotRefs[0]["slotKey"] != "subject" {
		t.Fatalf("workbench reference snapshot = %#v", snapshotRefs)
	}
	request.References[0].ResourceID = "foreign"
	if _, err := s.ResolveTask("user", request); err == nil {
		t.Fatal("expected foreign resource rejection")
	}
	request.References[0] = TaskReference{ResourceID: "image", Kind: "image", Role: "unexpected"}
	if _, err := s.ResolveTask("user", request); err == nil {
		t.Fatal("expected unsupported role rejection")
	}
}

func TestWorkbenchTaskRejectsUnknownParametersAndClientConfig(t *testing.T) {
	s, db, _ := newWorkbenchTest(t)
	tool := model.WorkbenchTool{ID: "tool", Kind: KindImage, Name: "Image", Enabled: true, CapabilityJSON: "{}"}
	if err := db.Create(&tool).Error; err != nil {
		t.Fatal(err)
	}
	request := TaskInput{Kind: KindImage, ToolID: "tool", Prompt: "prompt", Model: "image-model", LogicalModelID: "logical", Parameters: map[string]any{"channelId": "attacker"}}
	if _, err := s.ResolveTask("user", request); err == nil {
		t.Fatal("expected arbitrary field rejection")
	}
}

func TestWorkbenchTaskCanBeCreatedWithoutTool(t *testing.T) {
	s, _, _ := newWorkbenchTest(t)
	request := TaskInput{Kind: KindImage, Prompt: "A glass greenhouse at sunrise", Model: "image-model", LogicalModelID: "logical", Parameters: map[string]any{"size": "1024x1024", "count": 1}}
	resolved, err := s.ResolveTask("user", request)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.Tool != nil || resolved.Preset != nil {
		t.Fatalf("tool-less task unexpectedly resolved a tool or preset: %#v", resolved)
	}
	metadata := resolved.Input["metadata"].(map[string]any)
	if metadata["source"] != "workbench" || metadata["workbenchKind"] != KindImage {
		t.Fatalf("missing workbench task identity: %#v", metadata)
	}
	if _, ok := metadata["workbenchToolId"]; ok {
		t.Fatalf("tool-less task contains a tool id: %#v", metadata)
	}
	snapshot := metadata["workbench"].(map[string]any)
	if snapshot["kind"] != KindImage || snapshot["parameters"].(map[string]any)["count"] != 1 {
		t.Fatalf("workbench parameters not snapshotted: %#v", snapshot)
	}
	if resolved.TaskType != "canvas_image" || resolved.Operation != "image" {
		t.Fatalf("unexpected task routing: %#v", resolved)
	}
}

func TestWorkbenchTaskRejectsPresetWithoutTool(t *testing.T) {
	s, _, _ := newWorkbenchTest(t)
	request := TaskInput{Kind: KindVideo, PresetID: "preset", Prompt: "A quiet city street", Model: "video-model", LogicalModelID: "logical"}
	if _, err := s.ResolveTask("user", request); err == nil {
		t.Fatal("expected preset without tool rejection")
	}
}

func TestWorkbenchTaskAcceptsSystemChannelWithoutLogicalModel(t *testing.T) {
	s, _, _ := newWorkbenchTest(t)
	request := TaskInput{Kind: KindImage, Prompt: "A glass greenhouse at sunrise", Model: "image-model", ChannelID: "channel-1", Parameters: map[string]any{"size": "1024x1024", "count": 1}}
	resolved, err := s.ResolveTask("user", request)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.LogicalModelID != "" || resolved.ChannelID != "channel-1" {
		t.Fatalf("channel selection = logical %q channel %q", resolved.LogicalModelID, resolved.ChannelID)
	}
	config, _ := resolved.Input["config"].(map[string]any)
	if config["channelId"] != "channel-1" || config["model"] != "image-model" {
		t.Fatalf("provider config = %#v", config)
	}
	if _, err := s.ResolveTask("user", TaskInput{Kind: KindImage, Prompt: "missing model identity", Model: "image-model"}); err == nil {
		t.Fatal("expected rejection when neither logical model nor channel is selected")
	}
}
