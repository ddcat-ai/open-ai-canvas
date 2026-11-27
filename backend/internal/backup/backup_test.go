package backup

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestBackupEncryption(t *testing.T) {
	const password = "independent-test-recovery-password"
	for _, size := range []int{0, 1, chunkSize, chunkSize*2 + 17} {
		plain := bytes.Repeat([]byte("x"), size)
		var encrypted, restored bytes.Buffer
		if err := Encrypt(&encrypted, bytes.NewReader(plain), password); err != nil {
			t.Fatal(err)
		}
		if err := Decrypt(&restored, bytes.NewReader(encrypted.Bytes()), password); err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(plain, restored.Bytes()) {
			t.Fatal("roundtrip mismatch")
		}
	}
	var encrypted bytes.Buffer
	if err := Encrypt(&encrypted, bytes.NewReader(bytes.Repeat([]byte("secret"), chunkSize)), password); err != nil {
		t.Fatal(err)
	}
	original := encrypted.Bytes()
	corrupted := append([]byte(nil), original...)
	corrupted[50] ^= 1
	for name, data := range map[string][]byte{
		"corruption": corrupted,
		"truncation": original[:len(original)-20],
		"partial":    original[:len(original)-1],
		"trailing":   append(append([]byte(nil), original...), 1),
	} {
		t.Run(name, func(t *testing.T) {
			if err := Decrypt(io.Discard, bytes.NewReader(data), password); err == nil {
				t.Fatal("accepted invalid archive")
			}
		})
	}
	if err := Decrypt(io.Discard, bytes.NewReader(original), "wrong-password-long-enough"); err == nil {
		t.Fatal("accepted wrong password")
	}
}

func TestBackupArchive(t *testing.T) {
	dir := t.TempDir()
	for name, content := range map[string]string{"database.sqlite": "db", ".settings-key": "key", "plugin_registry.json": "{}", "plugin-packages/example/plugin.json": "plugin", "resources/private.png": "media"} {
		path := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	var archive bytes.Buffer
	if err := os.Chmod(filepath.Join(dir, "plugin-packages/example/plugin.json"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := Archive(context.Background(), &archive, filepath.Join(dir, "database.sqlite"), dir, Manifest{Version: 1, DatabaseFile: "database.sqlite"}); err != nil {
		t.Fatal(err)
	}
	gz, err := gzip.NewReader(&archive)
	if err != nil {
		t.Fatal(err)
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	files := map[string][]byte{}
	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		if header.Name == "data/plugin-packages/example/plugin.json" && header.Mode != 0700 {
			t.Fatal("plugin executable permission lost")
		}
		if header.Name == "data/.settings-key" && header.Mode != 0600 {
			t.Fatal("configuration key permission changed")
		}
		files[header.Name], err = io.ReadAll(tr)
		if err != nil {
			t.Fatal(err)
		}
	}
	for name, expected := range map[string]string{"database.sqlite": "db", "data/.settings-key": "key", "data/plugin_registry.json": "{}", "data/plugin-packages/example/plugin.json": "plugin"} {
		if string(files[name]) != expected {
			t.Fatalf("missing %s", name)
		}
	}
	if len(files) != 5 {
		t.Fatalf("unexpected archive contents: %v", files)
	}
	var manifest Manifest
	if err := json.Unmarshal(files["manifest.json"], &manifest); err != nil || len(manifest.Files) != 4 {
		t.Fatalf("manifest: %+v %v", manifest, err)
	}
	if err := os.Symlink(filepath.Join(dir, "database.sqlite"), filepath.Join(dir, "plugin-packages", "linked")); err != nil {
		t.Fatal(err)
	}
	if err := Archive(context.Background(), io.Discard, filepath.Join(dir, "database.sqlite"), dir, Manifest{DatabaseFile: "database.sqlite"}); err == nil {
		t.Fatal("accepted symlink")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := Archive(ctx, io.Discard, filepath.Join(dir, "database.sqlite"), dir, Manifest{DatabaseFile: "database.sqlite"}); err == nil {
		t.Fatal("ignored cancellation")
	}
	if err := os.Remove(filepath.Join(dir, ".settings-key")); err != nil {
		t.Fatal(err)
	}
	if err := Archive(context.Background(), io.Discard, filepath.Join(dir, "database.sqlite"), dir, Manifest{DatabaseFile: "database.sqlite"}); err == nil {
		t.Fatal("accepted missing configuration key")
	}
}
