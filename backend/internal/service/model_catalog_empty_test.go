package service

import (
	"encoding/json"
	"testing"
)

func TestModelCatalogEmptySystemListSurvivesJSON(t *testing.T) {
	svc, _, _, _ := newAppearanceTestService(t)
	catalog, err := svc.ModelCatalog(nil)
	if err != nil {
		t.Fatal(err)
	}
	if catalog.Source != ModelCatalogSourceSystem {
		t.Fatalf("source = %s", catalog.Source)
	}
	encoded, err := json.Marshal(catalog)
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]json.RawMessage
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	if string(decoded["channels"]) != "[]" {
		t.Fatalf("empty channel list missing: %s", encoded)
	}
	encoded, err = json.Marshal(ModelCatalogResponse{Source: ModelCatalogSourceFrontend, Models: []PublicLogicalModel{}})
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	if string(decoded["models"]) != "[]" {
		t.Fatalf("empty model list missing: %s", encoded)
	}
}
