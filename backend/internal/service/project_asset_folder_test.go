package service

import (
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestValidateProjectAssetFolderParentRejectsCycle(t *testing.T) {
	folders := []model.ProjectAssetFolder{
		{ID: "root", ParentID: ""},
		{ID: "child", ParentID: "root"},
		{ID: "leaf", ParentID: "child"},
	}
	if err := validateProjectAssetFolderParent(folders, "root", "leaf"); err == nil {
		t.Fatal("expected moving a folder into its descendant to fail")
	}
}

func TestValidateProjectAssetFolderParentLimitsCombinedDepth(t *testing.T) {
	folders := []model.ProjectAssetFolder{
		{ID: "a", ParentID: ""},
		{ID: "b", ParentID: "a"},
		{ID: "c", ParentID: "b"},
		{ID: "d", ParentID: "c"},
		{ID: "e", ParentID: "d"},
		{ID: "f", ParentID: "e"},
		{ID: "g", ParentID: "f"},
		{ID: "h", ParentID: "g"},
	}
	if err := validateProjectAssetFolderParent(folders, "", "h"); err == nil {
		t.Fatal("expected a ninth level folder to fail")
	}
	if err := validateProjectAssetFolderParent(folders, "", "g"); err != nil {
		t.Fatalf("expected an eighth level folder to be allowed: %v", err)
	}
}

func TestProjectAssetFolderNameIsUniqueWithinSiblingOnly(t *testing.T) {
	folders := []model.ProjectAssetFolder{
		{ID: "first", ParentID: "one", Name: "Reference"},
		{ID: "second", ParentID: "two", Name: "Reference"},
	}
	if !projectAssetFolderNameExists(folders, "one", "reference", "") {
		t.Fatal("expected case-insensitive duplicate in the same parent")
	}
	if projectAssetFolderNameExists(folders, "three", "Reference", "") {
		t.Fatal("did not expect a duplicate across different parents")
	}
}

func TestValidateProjectAssetFolderTheme(t *testing.T) {
	if theme, err := validateProjectAssetFolderTheme(""); err != nil || theme != "aurora" {
		t.Fatalf("expected empty theme to use aurora, got %q: %v", theme, err)
	}
	if theme, err := validateProjectAssetFolderTheme(" pearl "); err != nil || theme != "pearl" {
		t.Fatalf("expected pearl theme, got %q: %v", theme, err)
	}
	if _, err := validateProjectAssetFolderTheme("content-image"); err == nil {
		t.Fatal("expected arbitrary content image theme to fail")
	}
}
