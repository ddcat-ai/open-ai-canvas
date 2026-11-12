package canvas

import (
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"yingce/backend/internal/assets"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func TestShareOfficialResourceRequiresCanvasReferenceAndOfficialAccess(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "share.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err = db.AutoMigrate(&model.CanvasShare{}, &model.CanvasProject{}, &model.Resource{}, &model.OfficialAsset{}); err != nil {
		t.Fatal(err)
	}
	token := strings.Repeat("t", 40)
	now := time.Now()
	for _, value := range []any{
		&model.CanvasShare{ID: "share", UserID: "viewer", ProjectID: "canvas", TokenHash: canvasShareTokenHash(token), Enabled: true},
		&model.CanvasProject{ID: "canvas", UserID: "viewer", PayloadJSON: `{"nodes":[{"id":"a","type":"image","metadata":{"storageKey":"resource:shared"}},{"id":"b","type":"image","metadata":{"storageKey":"resource:private"}}]}`},
		&model.Resource{ID: "shared", UserID: "admin", Status: model.ResourceStatusReady},
		&model.Resource{ID: "private", UserID: "other", Status: model.ResourceStatusReady},
		&model.Resource{ID: "unreferenced", UserID: "admin", Status: model.ResourceStatusReady},
		&model.OfficialAsset{ID: "official", ResourceID: "shared", Status: model.OfficialAssetStatusPublished, PublishedAt: &now},
		&model.OfficialAsset{ID: "other-official", ResourceID: "unreferenced", Status: model.OfficialAssetStatusPublished},
	} {
		if err := db.Create(value).Error; err != nil {
			t.Fatal(err)
		}
	}
	svc := New(repository.New(db), nil)
	if _, _, _, err := svc.sharedCanvasResource(token, "shared"); err != nil {
		t.Fatalf("official resource rejected: %v", err)
	}
	for _, id := range []string{"private", "unreferenced"} {
		if _, _, _, err := svc.sharedCanvasResource(token, id); !errors.Is(err, gorm.ErrRecordNotFound) {
			t.Fatalf("unauthorized resource %s: %v", id, err)
		}
	}
	if err := db.Model(&model.OfficialAsset{}).Where("id = ?", "official").Update("status", model.OfficialAssetStatusUnpublished).Error; err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := svc.sharedCanvasResource(token, "shared"); err != nil {
		t.Fatalf("retained official resource rejected: %v", err)
	}
}

func TestCanvasShareTokenHashDoesNotExposeToken(t *testing.T) {
	token := "example-share-token"
	first := canvasShareTokenHash(token)
	if first == token || first != canvasShareTokenHash(token) || len(first) != 64 {
		t.Fatalf("unexpected token hash: %q", first)
	}
}

func TestPublicCharacterShareRewritesOnlyExplicitMediaAndSafeDefinition(t *testing.T) {
	payload := `{"nodes":[{"id":"role","type":"text","metadata":{"workflowKind":"character","officialAssetId":"official","characterName":"林初","characterCoverUrl":"/api/resources/cover/file","characterVoiceSampleResourceId":"voice","characterVoiceName":"声音","characterDefinition":{"appearance":"青年","apiKey":"secret","unknown":"private"}}}]}`
	public, allowed, err := publicCanvasProject(&model.CanvasProject{ID: "canvas", PayloadJSON: payload}, "share-token")
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(public)
	value := string(encoded)
	for _, expected := range []string{`"sharedCharacter":true`, "青年", "/api/public/canvas-shares/share-token/resources/cover/file", "/api/public/canvas-shares/share-token/resources/voice/file"} {
		if !strings.Contains(value, expected) {
			t.Fatalf("missing %s: %s", expected, value)
		}
	}
	for _, forbidden := range []string{"secret", "private", "officialAssetId", "characterVoiceSampleResourceId"} {
		if strings.Contains(value, forbidden) {
			t.Fatalf("leaked %s: %s", forbidden, value)
		}
	}
	if !allowed["cover"] || !allowed["voice"] || allowed["unrelated"] {
		t.Fatalf("unexpected allowed resources: %v", allowed)
	}
}

func TestPublicCanvasProjectScrubsSecretsAndRewritesResources(t *testing.T) {
	payload := map[string]any{
		"id": "project-1", "title": "公开画布", "chatSessions": []any{map[string]any{"secret": "chat"}},
		"nodes": []any{map[string]any{
			"id": "node-1", "type": "image", "title": "镜头", "position": map[string]any{"x": 1, "y": 2}, "width": 320, "height": 240,
			"metadata": map[string]any{
				"content": "data:image/png;base64,secret", "storageKey": "resource:resource_123", "prompt": "保留提示词",
				"apiKey": "secret", "taskId": "task-1", "skillSnapshot": map[string]any{"apiKey": "nested-secret", "name": "技能"},
			},
		}},
		"connections": []any{},
	}
	raw, _ := json.Marshal(payload)
	project := &model.CanvasProject{ID: "project-1", Title: "公开画布", PayloadJSON: string(raw)}
	public, resources, err := publicCanvasProject(project, "share-token")
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(public)
	text := string(encoded)
	for _, forbidden := range []string{"data:image", "secret", "task-1", `"secret":"chat"`} {
		if strings.Contains(text, forbidden) {
			t.Fatalf("public payload leaked %q: %s", forbidden, text)
		}
	}
	if !strings.Contains(text, "保留提示词") || !strings.Contains(text, "/api/public/canvas-shares/share-token/resources/resource_123/file") {
		t.Fatalf("public payload lost expected data: %s", text)
	}
	if !resources["resource_123"] {
		t.Fatal("referenced resource was not authorized")
	}
}

func TestCanvasResourceIDRejectsInvalidValues(t *testing.T) {
	for _, value := range []string{"resource:", "resource:../secret", "/api/resources/a%2Fb/file", "resource:" + strings.Repeat("a", 81)} {
		if got := assets.ResourceID(value); got != "" {
			t.Fatalf("expected invalid resource id for %q, got %q", value, got)
		}
	}
	if got := assets.ResourceID("/api/resources/abc_123/file"); got != "abc_123" {
		t.Fatalf("unexpected resource id: %q", got)
	}
}

func TestPublicCanvasProjectDropsUnmanagedMediaURL(t *testing.T) {
	payload := `{"id":"p","nodes":[{"id":"n","type":"image","title":"image","position":{"x":0,"y":0},"width":10,"height":10,"metadata":{"content":"https://tracker.example/image.png","prompt":"public prompt"}}],"connections":[]}`
	public, _, err := publicCanvasProject(&model.CanvasProject{ID: "p", PayloadJSON: payload}, "share-token")
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(public)
	if strings.Contains(string(encoded), "tracker.example") || !strings.Contains(string(encoded), "public prompt") {
		t.Fatalf("unexpected public payload: %s", encoded)
	}
}
