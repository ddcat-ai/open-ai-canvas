package main

import "testing"

func TestExclusiveDataLock(t *testing.T) {
	dir := t.TempDir()
	first, err := lockDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	second, err := lockDataDir(dir)
	if err == nil {
		second.Close()
		first.Close()
		t.Fatal("second runtime acquired active data lock")
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}
	third, err := lockDataDir(dir)
	if err != nil {
		t.Fatal("closed lock should be available:", err)
	}
	third.Close()
}
