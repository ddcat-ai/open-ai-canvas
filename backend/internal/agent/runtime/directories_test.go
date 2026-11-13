package runtime

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestRunParentRemovesDirectoryAfterExitCancellationAndKill(t *testing.T) {
	for _, mode := range []string{"normal", "cancel", "kill"} {
		t.Run(mode, func(t *testing.T) {
			script := `
import { writeFileSync } from "node:fs";
import { join } from "node:path";
for await (const chunk of process.stdin) {}
writeFileSync(join(process.env.YINGCE_AGENT_RUN_DIR, "ready"), "private session");
`
			if mode == "normal" {
				script += `process.stdout.write('{"event":"settled"}\n');`
			} else {
				script += `setInterval(() => {}, 1000);`
			}
			fakeRuntime(t, script)
			root := os.Getenv("YINGCE_AGENT_TEMP_DIR")
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			finished := make(chan struct{})
			result := make(chan error, 1)
			go func() {
				defer close(finished)
				result <- Run(ctx, ProcessRequest{Model: map[string]any{"id": "m"}}, noopBridge())
			}()
			t.Cleanup(func() { cancel(); <-finished })
			if mode != "normal" {
				var directory string
				deadline := time.Now().Add(5 * time.Second)
				for time.Now().Before(deadline) {
					entries, _ := os.ReadDir(root)
					for _, entry := range entries {
						candidate := filepath.Join(root, entry.Name())
						if _, err := os.Stat(filepath.Join(candidate, "ready")); err == nil {
							directory = candidate
						}
					}
					if directory != "" {
						break
					}
					time.Sleep(10 * time.Millisecond)
				}
				if directory == "" {
					t.Fatal("runtime never became ready")
				}
				if mode == "cancel" {
					cancel()
				} else {
					raw, err := os.ReadFile(filepath.Join(directory, runDirectoryMarker))
					if err != nil {
						t.Fatal(err)
					}
					var owner runDirectoryOwner
					if err := json.Unmarshal(raw, &owner); err != nil {
						t.Fatal(err)
					}
					process, err := os.FindProcess(owner.ChildPID)
					if err != nil {
						t.Fatal(err)
					}
					if err := process.Kill(); err != nil {
						t.Fatal(err)
					}
				}
			}
			if err := <-result; (err == nil) != (mode == "normal") {
				t.Fatalf("mode %s runtime result: %v", mode, err)
			}
			entries, err := os.ReadDir(root)
			if err != nil || len(entries) != 0 {
				t.Fatalf("parent left runtime files after %s: %v %v", mode, entries, err)
			}
		})
	}
}

func TestOrphanCleanupPreservesActiveOwnersAndSymlinks(t *testing.T) {
	root := filepath.Join(t.TempDir(), "runs")
	t.Setenv("YINGCE_AGENT_TEMP_DIR", root)
	directory, err := createRunDirectory()
	if err != nil {
		t.Fatal(err)
	}
	defer directory.cleanup()
	old := time.Now().Add(-48 * time.Hour).UnixMilli()
	writeOwner := func(path string, owner runDirectoryOwner) {
		t.Helper()
		raw, err := json.Marshal(owner)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(path, runDirectoryMarker), raw, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	makeDirectory := func(name string, childPID int) string {
		t.Helper()
		path := filepath.Join(root, name)
		if err := os.Mkdir(path, 0o700); err != nil {
			t.Fatal(err)
		}
		writeOwner(path, runDirectoryOwner{Version: 1, ParentPID: os.Getpid(), ChildPID: childPID, CreatedAt: old})
		return path
	}
	orphan := makeDirectory("run-orphan", 0)
	liveChild := makeDirectory("run-live", os.Getpid())
	writeOwner(directory.path, runDirectoryOwner{Version: 1, ParentPID: os.Getpid(), CreatedAt: old})
	unknown := filepath.Join(root, "run-unknown")
	if err := os.Mkdir(unknown, 0o700); err != nil {
		t.Fatal(err)
	}
	outside := t.TempDir()
	writeOwner(outside, runDirectoryOwner{Version: 1, ParentPID: os.Getpid(), CreatedAt: old})
	if err := os.Symlink(outside, filepath.Join(root, "run-symlink")); err != nil {
		t.Fatal(err)
	}
	if err := sweepRunDirectories(root, time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(orphan); !os.IsNotExist(err) {
		t.Fatalf("orphan was retained: %v", err)
	}
	for _, path := range []string{directory.path, liveChild, unknown, outside} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("protected directory was removed: %s %v", path, err)
		}
	}
}
