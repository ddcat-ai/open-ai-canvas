package canvas

import (
	"encoding/json"
	"testing"
	"yingce/backend/internal/model"
)

func TestOwnedOfficialResourceRequiresPublishedOrRetainedReference(t *testing.T) {
	svc := newCanvasOperationTestService(t)
	for _, v := range []any{&model.Resource{ID: "resource", UserID: "user", Status: model.ResourceStatusReady}, &model.OfficialAsset{ID: "official", ResourceID: "resource", Status: model.OfficialAssetStatusPublished}} {
		if err := svc.repo.Create(v); err != nil {
			t.Fatal(err)
		}
	}
	payload := json.RawMessage(`{"id":"canvas","nodes":[{"id":"n","type":"image","metadata":{"storageKey":"resource:resource"}}]}`)
	if err := svc.ValidateCanvasMediaAssets("user", payload); err != nil {
		t.Fatalf("published official reference rejected: %v", err)
	}
	if err := svc.repo.Delete(&model.OfficialAsset{}, "id = ?", "official"); err != nil {
		t.Fatal(err)
	}
	if err := svc.ValidateCanvasMediaAssets("user", payload); err == nil {
		t.Fatal("unpublished personal resource without asset was accepted")
	}
}
