package service

import "testing"

func TestNormalizeEagleItemCollectionsKeepsEmptyArrays(t *testing.T) {
	item := &EagleItem{}
	normalizeEagleItemCollections(item)

	if item.FolderIDs == nil || len(item.FolderIDs) != 0 {
		t.Fatalf("folder IDs = %#v, want a non-nil empty slice", item.FolderIDs)
	}
	if item.Tags == nil || len(item.Tags) != 0 {
		t.Fatalf("tags = %#v, want a non-nil empty slice", item.Tags)
	}
}
