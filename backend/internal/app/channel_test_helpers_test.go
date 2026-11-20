package app

import (
	"os"
	"path/filepath"
	"testing"
)

// Channel tests exercise encryption with a pre-existing deployment key. The
// settings-key publisher has separate tests and platform-specific durability.
func channelTestDataDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, ".settings-key"), []byte("0123456789abcdef0123456789abcdef"), 0o600); err != nil {
		t.Fatal(err)
	}
	return dir
}
