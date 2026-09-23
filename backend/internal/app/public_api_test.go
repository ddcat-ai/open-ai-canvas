package app

import (
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"github.com/google/uuid"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestPublicAPIKeyLifecycle(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.PublicAPIKey{}, &model.PublicGenerationRequest{}); err != nil {
		t.Fatal(err)
	}
	user := model.User{ID: "user-public-key", Username: "public-key-user", Status: model.UserStatusActive}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	svc := New(repository.New(db), t.TempDir())
	created, err := svc.CreatePublicAPIKey(user.ID, PublicAPIKeyCreateRequest{Name: "integration", ModelAllowlist: []string{"canvas-image"}})
	if err != nil {
		t.Fatal(err)
	}
	if created.Secret == "" || created.Prefix == "" || created.Secret == created.Prefix {
		t.Fatalf("created key did not return a one-time secret and masked prefix: %#v", created)
	}
	key, err := svc.AuthenticatePublicAPIKey("Bearer " + created.Secret)
	if err != nil || key.ID != created.ID {
		t.Fatalf("AuthenticatePublicAPIKey() = %#v, %v", key, err)
	}
	if err := svc.RevokePublicAPIKey(user.ID, created.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.AuthenticatePublicAPIKey("Bearer " + created.Secret); err == nil {
		t.Fatal("revoked API key authenticated")
	}
}

func TestNormalizePublicGenerationInput(t *testing.T) {
	input, taskType, operation, err := normalizePublicGenerationInput(PublicGenerationInput{
		Model: "canvas-image", Type: "image", Prompt: "a rainy street", AspectRatio: "16:9", Quality: "2k",
	})
	if err != nil {
		t.Fatal(err)
	}
	if taskType != "canvas_image" || operation != "text_to_image" || input["mode"] != "image" {
		t.Fatalf("normalized image input = %#v, %q, %q", input, taskType, operation)
	}
	options := input["capabilityOptions"].(map[string]any)
	if options["size"] != "16:9" || options["quality"] != "2k" {
		t.Fatalf("image options = %#v", options)
	}
	if _, _, _, err := normalizePublicGenerationInput(PublicGenerationInput{Model: "canvas-video", Type: "video", Operation: "image_to_video", Prompt: "x"}); err == nil {
		t.Fatal("unsupported video operation accepted")
	}
}

func TestPublicAPIKeyAllowsCanonicalModelIdentifiers(t *testing.T) {
	key := &model.PublicAPIKey{ModelAllowlistJSON: `["logical-model-1"]`}
	if !publicAPIKeyAllowsModel(key, "logical-model-1", "public-image") {
		t.Fatal("canonical logical model ID should satisfy the allowlist")
	}
	if publicAPIKeyAllowsModel(key, "other-model", "public-image") {
		t.Fatal("an unrelated model should not satisfy the allowlist")
	}
}

func TestPublicGenerationResultResourceIDAcceptsStorageKey(t *testing.T) {
	if got := publicGenerationResourceID(map[string]any{"storageKey": "resource:resource-123"}); got != "resource-123" {
		t.Fatalf("storageKey resource ID = %q", got)
	}
	if got := publicGenerationResourceID(map[string]any{"storageKey": "asset:asset-123"}); got != "" {
		t.Fatalf("non-resource storage key = %q", got)
	}
}

func TestPublicGenerationResultRejectsMalformedJSON(t *testing.T) {
	// Malformed JSON is rejected before the resource repository is needed.
	svc := &Service{}
	if _, err := svc.publicGenerationResult("user", "{"); err == nil || !strings.Contains(err.Error(), "生成结果暂时不可用") {
		t.Fatalf("malformed result error = %v", err)
	}
}

func TestPublicGenerationMediaKindTreatsZeroDurationImageAsImage(t *testing.T) {
	if publicGenerationMediaIsVideo(map[string]any{"mimeType": "image/jpeg", "durationMs": float64(0)}) {
		t.Fatal("an image with zero duration must not be classified as video")
	}
	if !publicGenerationMediaIsVideo(map[string]any{"mimeType": "video/mp4", "durationMs": float64(0)}) {
		t.Fatal("video MIME type must be classified as video")
	}
	if !publicGenerationMediaIsVideo(map[string]any{"mimeType": "application/octet-stream", "durationMs": float64(1200)}) {
		t.Fatal("positive duration must be classified as video")
	}
}
