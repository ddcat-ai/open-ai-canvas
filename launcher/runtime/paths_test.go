package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveNewDataPath(t *testing.T) {
	base := t.TempDir()
	resolved, err := filepath.EvalSymlinks(base)
	if err != nil {
		t.Fatal(err)
	}
	got, err := resolveDataPath(filepath.Join(base, "new", "nested"))
	if err != nil {
		t.Fatal(err)
	}
	if got != filepath.Join(resolved, "new", "nested") {
		t.Fatal(got)
	}
	if _, err := os.Stat(filepath.Join(base, "new")); !os.IsNotExist(err) {
		t.Fatal("resolution must not create files")
	}
}
func TestResolveLinkedDataParent(t *testing.T) {
	base := t.TempDir()
	dest := t.TempDir()
	link := filepath.Join(base, "link")
	if err := os.Symlink(dest, link); err != nil {
		t.Skip("symlinks unavailable:", err)
	}
	got, err := resolveDataPath(filepath.Join(link, "new"))
	if err != nil {
		t.Fatal(err)
	}
	resolved, err := filepath.EvalSymlinks(dest)
	if err != nil {
		t.Fatal(err)
	}
	if got != filepath.Join(resolved, "new") {
		t.Fatal(got)
	}
}
