package app

import (
	"strings"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/workbench"
)

func TestEcommerceTryOnFunctionGateAllowsAdminsWhenClosed(t *testing.T) {
	s, db, _, _ := ecommerceCreationTestService(t)
	if err := db.Create(&model.User{ID: "tryon-admin", Username: "tryon-admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}).Error; err != nil {
		t.Fatal(err)
	}
	features := defaultFeatureAvailability()
	features.EcommerceEnabled, features.ImageWorkbenchEnabled = true, true
	saveAdmissionFeatures(t, s, features)
	// 未登记的功能默认开放。
	if err := s.RequireEcommerceTryOn("user", "pose"); err != nil {
		t.Fatalf("unlisted pose rejected user: %v", err)
	}

	features.EcommerceTryOnFunctions = map[string]bool{"pose": false, "outfit": true}
	saveAdmissionFeatures(t, s, features)
	if err := s.RequireEcommerceTryOn("user", "pose"); err == nil || !strings.Contains(err.Error(), "姿势参考") {
		t.Fatalf("closed pose user err = %v", err)
	}
	if err := s.RequireEcommerceTryOn("tryon-admin", "pose"); err != nil {
		t.Fatalf("closed pose rejected admin: %v", err)
	}
	for _, fn := range []string{"outfit", "print", "fine-outfit", "background", "scene", "enhance"} {
		if err := s.RequireEcommerceTryOn("user", fn); err != nil {
			t.Fatalf("open %s rejected user: %v", fn, err)
		}
	}
	if err := s.RequireEcommerceTryOn("user", "unknown"); err == nil {
		t.Fatal("unknown tryon function must be rejected")
	}
	input := map[string]any{"metadata": map[string]any{"source": "ecommerce-tryon", "tryonFunction": "pose"}}
	if _, err := s.CreateTask("user", CreateTaskRequest{Type: "canvas_text", Prompt: "plan", Input: input}); err == nil || !strings.Contains(err.Error(), "姿势参考") {
		t.Fatalf("closed pose planning task err = %v", err)
	}
	if _, err := s.CreateWorkbenchTask("user", WorkbenchTaskInput{Kind: "image", Batch: &workbench.TaskBatch{ID: "tryon_pose_test123", Count: 1}}, "", ""); err == nil || !strings.Contains(err.Error(), "姿势参考") {
		t.Fatalf("closed pose image task err = %v", err)
	}
	batchInput := map[string]any{"metadata": map[string]any{"source": "workbench", "workbench": map[string]any{"batch": map[string]any{"id": "tryon_pose_test123"}}}}
	if err := s.requireTaskGenerationFeatures("user", "", "canvas_image", "", "image", batchInput); err == nil || !strings.Contains(err.Error(), "姿势参考") {
		t.Fatalf("closed pose persisted task admission err = %v", err)
	}
	features.EcommerceEnabled = false
	saveAdmissionFeatures(t, s, features)
	if err := s.RequireEcommerceTryOn("user", "outfit"); err == nil || !strings.Contains(err.Error(), "电商创作") {
		t.Fatalf("disabled ecommerce allowed tryon: %v", err)
	}
}

func TestTryOnFunctionFromBatchID(t *testing.T) {
	for id, want := range map[string]string{
		"tryon_outfit_abc123":      "outfit",
		"tryon_multi-model_X9y":    "multi-model",
		"tryon_smart-head_q1w2e3r": "smart-head",
		"batch_1":                  "",
		"":                         "",
	} {
		if got := tryOnFunctionFromBatchID(id); got != want {
			t.Fatalf("tryOnFunctionFromBatchID(%q) = %q, want %q", id, got, want)
		}
	}
}

func TestEcommerceTryOnFeatureSettingPreservesOmittedFunctionMap(t *testing.T) {
	s, _ := newFeatureAvailabilityTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	features := defaultFeatureAvailability()
	features.EcommerceTryOnFunctions = map[string]bool{"pose": false}
	if _, err := s.UpdateFeatureAvailability(admin, features); err != nil {
		t.Fatal(err)
	}
	features.EcommerceTryOnFunctions = nil
	features.EcommerceEnabled = true
	updated, err := s.UpdateFeatureAvailability(admin, features)
	if err != nil {
		t.Fatal(err)
	}
	if updated.TryOnFunctionEnabled("pose") || !updated.TryOnFunctionEnabled("outfit") {
		t.Fatalf("unrelated feature update changed tryon settings: %#v", updated)
	}
	if _, err := s.UpdateFeatureAvailability(&model.User{ID: "user", Role: model.UserRoleUser}, features); err == nil {
		t.Fatal("ordinary user changed availability")
	}
}
