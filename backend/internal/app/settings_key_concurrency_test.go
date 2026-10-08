package app

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"syscall"
	"testing"
	"time"
)

func TestSettingsEncryptionKeyPublication(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".settings-key")
	key := bytes.Repeat([]byte{5}, 32)
	link := func(temp, target string) error {
		data, err := os.ReadFile(temp)
		if err != nil || !bytes.Equal(data, key) {
			t.Fatalf("incomplete temporary key: %v", err)
		}
		info, err := os.Stat(temp)
		if err != nil || info.Mode().Perm() != 0600 {
			t.Fatalf("temporary permissions: %v", err)
		}
		if _, err := os.Stat(target); !os.IsNotExist(err) {
			t.Fatalf("key visible before publication: %v", err)
		}
		return os.Link(temp, target)
	}
	if err := publishSettingsKey(path, key, link); err != nil {
		t.Fatal(err)
	}
	if err := publishSettingsKey(path, bytes.Repeat([]byte{6}, 32), os.Link); !os.IsExist(err) {
		t.Fatalf("publication replaced existing key: %v", err)
	}
	data, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(data, key) {
		t.Fatalf("existing key changed: %v", err)
	}
	other := filepath.Join(t.TempDir(), ".settings-key")
	if err := publishSettingsKey(other, key, func(string, string) error { return syscall.EIO }); !errors.Is(err, syscall.EIO) {
		t.Fatalf("unexpected link error hidden: %v", err)
	}
	if _, err := os.Stat(other); !os.IsNotExist(err) {
		t.Fatalf("unexpected fallback: %v", err)
	}
}

func TestSettingsEncryptionKeyLinkFallback(t *testing.T) {
	for _, failure := range []error{syscall.ENOTSUP, syscall.EPERM} {
		t.Run(failure.Error(), func(t *testing.T) {
			path := filepath.Join(t.TempDir(), ".settings-key")
			key := bytes.Repeat([]byte{3}, 32)
			link := func(string, string) error { return failure }
			if err := publishSettingsKey(path, key, link); err != nil {
				t.Fatal(err)
			}
			if err := publishSettingsKey(path, bytes.Repeat([]byte{4}, 32), link); !os.IsExist(err) {
				t.Fatalf("existing key: %v", err)
			}
			got, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(got, key) {
				t.Fatalf("key changed: %v", err)
			}
			info, err := os.Stat(path)
			if err != nil || info.Mode().Perm() != 0600 {
				t.Fatalf("permissions: %v", err)
			}
		})
	}
}

func TestSettingsEncryptionKeyConcurrentFirstUse(t *testing.T) {
	dir := t.TempDir()
	const workers = 64
	keys := make([][]byte, workers)
	errs := make([]error, workers)
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := range keys {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			keys[i], errs[i] = (&Service{dataDir: dir}).settingsEncryptionKey()
		}(i)
	}
	close(start)
	wg.Wait()
	for i := range keys {
		if errs[i] != nil || len(keys[i]) != 32 || !bytes.Equal(keys[i], keys[0]) {
			t.Fatalf("worker %d returned inconsistent key: %v", i, errs[i])
		}
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != ".settings-key" {
		t.Fatalf("temporary keys leaked: %v", entries)
	}
	info, err := entries[0].Info()
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0600 {
		t.Fatalf("key permissions = %o", info.Mode().Perm())
	}
}

func TestSettingsEncryptionKeyWaitsForLegacyWriter(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, ".settings-key")
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	expected := bytes.Repeat([]byte{7}, 32)
	done := make(chan error, 1)
	go func() { time.Sleep(10 * time.Millisecond); _, err := f.Write(expected); done <- err }()
	key, err := (&Service{dataDir: dir}).settingsEncryptionKey()
	if writeErr := <-done; writeErr != nil {
		t.Fatal(writeErr)
	}
	if err != nil || !bytes.Equal(key, expected) {
		t.Fatalf("legacy writer not respected: %v", err)
	}
}

func TestSettingsEncryptionKeyNeverReplacesExisting(t *testing.T) {
	for _, size := range []int{0, 17, 32, 33} {
		t.Run(strconv.Itoa(size), func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(dir, ".settings-key")
			expected := bytes.Repeat([]byte{9}, size)
			if err := os.WriteFile(path, expected, 0600); err != nil {
				t.Fatal(err)
			}
			key, err := (&Service{dataDir: dir}).settingsEncryptionKey()
			if (err == nil) != (size == 32) {
				t.Fatalf("length %d: %v", size, err)
			}
			actual, readErr := os.ReadFile(path)
			if readErr != nil || !bytes.Equal(actual, expected) {
				t.Fatal("existing key changed", readErr)
			}
			if size == 32 && !bytes.Equal(key, expected) {
				t.Fatal("existing key not returned")
			}
		})
	}
}
