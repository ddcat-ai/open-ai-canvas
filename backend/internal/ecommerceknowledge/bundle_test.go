package ecommerceknowledge

import (
	"testing"

	"yingce/backend/internal/model"
)

func TestBundledKnowledgeMatchesManifest(t *testing.T) {
	snapshot, err := Read()
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Sources) != 23 || len(snapshot.Entries) != 14740 {
		t.Fatalf("incomplete knowledge snapshot: %d sources, %d entries", len(snapshot.Sources), len(snapshot.Entries))
	}
	manifest, err := ReadManifest()
	if err != nil || manifest.ReviewCounts["approved"] != 14739 || manifest.ReviewCounts["rejected"] != 1 {
		t.Fatalf("review decisions lost: %+v, %v", manifest.ReviewCounts, err)
	}
	for _, source := range snapshot.Sources {
		if source.Repository != "" && (source.LicenseText == "" || len(source.Commit) != 40) {
			t.Fatalf("missing pinned attribution: %s", source.ID)
		}
	}
}

func TestKnowledgeBundleRejectsMissingProvenanceAndDuplicateEntries(t *testing.T) {
	for _, test := range []struct {
		name   string
		change func(*Snapshot)
	}{
		{"missing source", func(s *Snapshot) { s.Entries[0].SourceID = "missing" }},
		{"duplicate ID", func(s *Snapshot) { s.Entries[1].ID = s.Entries[0].ID }},
		{"duplicate hash", func(s *Snapshot) { s.Entries[1].DedupHash = s.Entries[0].DedupHash }},
		{"altered license", func(s *Snapshot) { s.Entries[0].License = "unknown" }},
		{"invalid content", func(s *Snapshot) { s.Entries[0].ContentJSON = "{broken" }},
		{"changed decision", func(s *Snapshot) { s.Entries[0].ReviewStatus = "pending" }},
	} {
		t.Run(test.name, func(t *testing.T) {
			snapshot, err := Read()
			if err != nil {
				t.Fatal(err)
			}
			manifest, _ := ReadManifest()
			test.change(snapshot)
			if err := snapshot.validate(manifest); err == nil {
				t.Fatal("accepted corrupted knowledge bundle")
			}
		})
	}
}

func TestBundledKnowledgeRetainsRejectedPlatformClaims(t *testing.T) {
	snapshot, err := Read()
	if err != nil {
		t.Fatal(err)
	}
	var rejected []model.EcommerceKnowledgeEntry
	for _, entry := range snapshot.Entries {
		if entry.ReviewStatus == "rejected" {
			rejected = append(rejected, entry)
		}
	}
	if len(rejected) != 1 || rejected[0].SourceID != "src-dlazy" {
		t.Fatalf("rejected policy entry was removed or approved: %+v", rejected)
	}
}
