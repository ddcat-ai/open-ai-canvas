package assets

import "testing"

func TestCollectDocumentResourceReferencesIncludesBatchInputSnapshot(t *testing.T) {
	raw := `{"nodes":[{"id":"table","metadata":{"generationBatches":[{"items":[{"inputSnapshot":{"version":1,"context":{"referenceImages":[{"id":"removed-source-node","storageKey":"resource:queued-original-image","dataUrl":""}]}}}]}]}}]}`
	references, err := CollectDocumentResourceReferences(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(references) != 1 || references[0].ResourceID != "queued-original-image" || references[0].NodeID != "table" {
		t.Fatalf("queued input must remain owned by the table after the source node changes: %#v", references)
	}
	retained := DocumentReferencedIDs(raw, map[string]struct{}{"queued-original-image": {}, "replacement-image": {}})
	if _, ok := retained["queued-original-image"]; !ok || len(retained) != 1 {
		t.Fatalf("resource cleanup lost queued original image: %#v", retained)
	}
}
