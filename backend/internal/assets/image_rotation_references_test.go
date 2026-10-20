package assets

import "testing"

func TestImageRotationKeepsOriginalAndVariantsReferenced(t *testing.T) {
	raw := `{"nodes":[{"id":"photo","metadata":{"storageKey":"resource:rotated","imageRotation":{"quarterTurns":1,"original":{"content":"/api/resources/original/file","storageKey":"resource:original"},"variants":{"1":{"storageKey":"resource:rotated"},"2":{"storageKey":"resource:upside-down"}}}}}]}`
	refs, err := CollectDocumentResourceReferences(raw)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]bool{"original": false, "rotated": false, "upside-down": false}
	for _, ref := range refs {
		if ref.NodeID != "photo" {
			t.Fatalf("nested rotation reference lost node ownership: %#v", ref)
		}
		want[ref.ResourceID] = true
	}
	for resource, found := range want {
		if !found {
			t.Fatalf("rotation resource %q omitted from deletion/save guard", resource)
		}
	}
}
