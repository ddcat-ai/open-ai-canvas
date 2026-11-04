package app

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

type commerceOfflineTransport struct{ requests int }

func (t *commerceOfflineTransport) RoundTrip(*http.Request) (*http.Response, error) {
	t.requests++
	return nil, fmt.Errorf("source offline")
}

func TestEcommerceCompletedPinnedSyncUsesDatabaseEvidenceOffline(t *testing.T) {
	svc, _, _, _ := creationTestService(t)
	spec := commerceSourceSpec{ID: "incremental-fixture", Name: "Test source", Repository: "test/fixture", Commit: strings.Repeat("a", 40), License: "MIT", Documents: []commerceDocumentSpec{{"guide.md", "photography", "general", ""}}}
	previousSpecs, previousClient := commerceSourceSpecs, commerceHTTPClient
	transport := &commerceOfflineTransport{}
	commerceSourceSpecs = []commerceSourceSpec{spec}
	commerceHTTPClient = &http.Client{Transport: transport}
	t.Cleanup(func() { commerceSourceSpecs, commerceHTTPClient = previousSpecs, previousClient })
	now := time.Now().UTC()
	source := model.EcommerceKnowledgeSource{ID: "src-" + spec.ID, Name: spec.Name, URL: "https://github.com/test/fixture", Commit: spec.Commit, License: "MIT", LicenseText: "MIT License", Version: commerceSourceImportVersion(spec), Status: "ready", LastSyncedAt: &now}
	if err := svc.repo.UpsertEcommerceKnowledgeSource(&source); err != nil {
		t.Fatal(err)
	}
	entry := commerceEntry(spec, "guide.md", "Source guidance", "photography", "general", "", "Reviewed product photography guidance")
	if err := svc.repo.UpsertEcommerceKnowledgeEntry(&entry); err != nil {
		t.Fatal(err)
	}
	actor := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	result, err := svc.SyncEcommerceKnowledge(context.Background(), actor)
	if err != nil || transport.requests != 0 || result["duplicates"].(int) != 1 || result["imported"].(int) != 0 || len(result["failed"].([]string)) != 0 {
		t.Fatalf("completed source depended on network: result=%v requests=%d err=%v", result, transport.requests, err)
	}
	// An incomplete source must try the network and must not be promoted by an old license.
	source.Status = "partial"
	if err := svc.repo.UpsertEcommerceKnowledgeSource(&source); err != nil {
		t.Fatal(err)
	}
	result, err = svc.SyncEcommerceKnowledge(context.Background(), actor)
	if err != nil || transport.requests == 0 || len(result["failed"].([]string)) != 1 {
		t.Fatalf("incomplete import silently reused: %v %v", result, err)
	}
	sources, err := svc.repo.EcommerceKnowledgeSources()
	if err != nil || len(sources) != 1 || sources[0].Status != "partial" {
		t.Fatalf("failed import lost partial status: %#v %v", sources, err)
	}
}
