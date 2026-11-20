package app

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestEcommerceReviewedExcerptRejectsChangedSource(t *testing.T) {
	source := commerceSourceSpec{ID: "review-fixture", Repository: "test/fixture", Commit: strings.Repeat("a", 40), License: "MIT"}
	data := []byte("reference guidance\n")
	digest := sha256.Sum256(data)
	key := source.ID + "/guide.md"
	commerceReviewedExcerpts[key] = commerceReviewedExcerpt{hex.EncodeToString(digest[:]), "Reviewed guidance", "Preserve product identity"}
	t.Cleanup(func() { delete(commerceReviewedExcerpts, key) })
	entry := model.EcommerceKnowledgeEntry{KnowledgeType: "photography", Category: "general", ReviewStatus: "pending"}
	if commerceApplyReviewedExcerpt(&entry, source, "guide.md", []byte("modified reference")) || entry.ReviewStatus != "pending" {
		t.Fatal("modified source gained approved status")
	}
	if !commerceApplyReviewedExcerpt(&entry, source, "guide.md", data) || entry.ReviewStatus != "approved" || entry.SourceCommit != source.Commit || entry.VerifiedAt == nil || !strings.Contains(entry.ContentJSON, "upstreamSha256") {
		t.Fatalf("reviewed excerpt lost its evidence: %#v", entry)
	}
	if commerceApplyReviewedExcerpt(&entry, source, "unknown.md", data) {
		t.Fatal("unreviewed document gained approval")
	}
}
