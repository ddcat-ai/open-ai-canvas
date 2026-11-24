package runtime

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"sync"
	"time"
)

const runDirectoryMarker = ".yingce-run.json"

var runDirectoryName = regexp.MustCompile(`^run-[A-Za-z0-9]+$`)
var activeRunDirectories sync.Map

type runDirectoryOwner struct {
	Version   int   `json:"version"`
	ParentPID int   `json:"parentPID"`
	ChildPID  int   `json:"childPID"`
	CreatedAt int64 `json:"createdAt"`
}

type runDirectory struct {
	path  string
	owner runDirectoryOwner
	stop  chan struct{}
}

func createRunDirectory() (*runDirectory, error) {
	root := os.Getenv("YINGCE_AGENT_TEMP_DIR")
	if root == "" {
		root = filepath.Join(os.TempDir(), "yingce-agent-runs")
	}
	if !filepath.IsAbs(root) {
		return nil, errors.New("YINGCE_AGENT_TEMP_DIR must be absolute")
	}
	if err := os.MkdirAll(root, 0o700); err != nil {
		return nil, err
	}
	info, err := os.Lstat(root)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm()&0o077 != 0 || !directoryOwnedByCurrentUser(info) {
		return nil, errors.New("agent temporary root must be a private directory owned by the service")
	}
	root, err = filepath.EvalSymlinks(root)
	if err != nil {
		return nil, err
	}
	if err := sweepRunDirectories(root, time.Now()); err != nil {
		slog.Warn("Agent orphan cleanup failed", "error", err)
	}
	path, err := os.MkdirTemp(root, "run-")
	if err != nil {
		return nil, err
	}
	activeRunDirectories.Store(path, struct{}{})
	directory := &runDirectory{path: path, owner: runDirectoryOwner{Version: 1, ParentPID: os.Getpid(), CreatedAt: time.Now().UnixMilli()}, stop: make(chan struct{})}
	if err := directory.writeOwner(); err != nil {
		activeRunDirectories.Delete(path)
		_ = os.RemoveAll(path)
		return nil, err
	}
	go func() {
		ticker := time.NewTicker(10 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case now := <-ticker.C:
				if err := sweepRunDirectories(root, now); err != nil {
					slog.Warn("Agent orphan cleanup failed", "error", err)
				}
			case <-directory.stop:
				return
			}
		}
	}()
	return directory, nil
}

func (d *runDirectory) writeOwner() error {
	value, err := json.Marshal(d.owner)
	if err != nil {
		return err
	}
	temporary := filepath.Join(d.path, runDirectoryMarker+".tmp")
	file, err := os.OpenFile(temporary, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	_, writeErr := file.Write(value)
	closeErr := file.Close()
	if err := errors.Join(writeErr, closeErr); err != nil {
		return err
	}
	return os.Rename(temporary, filepath.Join(d.path, runDirectoryMarker))
}

func (d *runDirectory) childStarted(pid int) error {
	d.owner.ChildPID = pid
	return d.writeOwner()
}

func (d *runDirectory) cleanup() {
	close(d.stop)
	activeRunDirectories.Delete(d.path)
	if err := os.RemoveAll(d.path); err != nil {
		slog.Error("Agent run directory cleanup failed", "error", err)
	}
}

func sweepRunDirectories(root string, now time.Time) error {
	// macOS 的 /var 等祖先可能是别名；活跃登记与扫描必须使用同一规范路径。
	canonicalRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return err
	}
	root = canonicalRoot
	entries, err := os.ReadDir(root)
	if err != nil {
		return err
	}
	ttl := 24 * time.Hour
	if seconds, err := strconv.Atoi(os.Getenv("YINGCE_AGENT_ORPHAN_TTL_SECONDS")); err == nil && seconds >= 1 && seconds <= 604800 {
		ttl = time.Duration(seconds) * time.Second
	}
	for _, entry := range entries {
		if !runDirectoryName.MatchString(entry.Name()) || !entry.IsDir() || entry.Type()&os.ModeSymlink != 0 {
			continue
		}
		path := filepath.Join(root, entry.Name())
		if _, active := activeRunDirectories.Load(path); active {
			continue
		}
		if err := removeOrphanRunDirectory(path, now, ttl); err != nil && !errors.Is(err, os.ErrNotExist) {
			slog.Warn("Agent orphan directory retained after cleanup failure", "error", err)
		}
	}
	return nil
}

func removeOrphanRunDirectory(path string, now time.Time, ttl time.Duration) error {
	info, err := os.Lstat(path)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || !directoryOwnedByCurrentUser(info) {
		return err
	}
	markerPath := filepath.Join(path, runDirectoryMarker)
	markerInfo, err := os.Lstat(markerPath)
	if err != nil || !markerInfo.Mode().IsRegular() || markerInfo.Mode().Perm()&0o077 != 0 || markerInfo.Size() > 1024 {
		return err
	}
	raw, err := os.ReadFile(markerPath)
	if err != nil {
		return err
	}
	var owner runDirectoryOwner
	if json.Unmarshal(raw, &owner) != nil || owner.Version != 1 || owner.CreatedAt <= 0 || now.Sub(time.UnixMilli(owner.CreatedAt)) < ttl {
		return nil
	}
	if owner.ParentPID != os.Getpid() && runtimeProcessAlive(owner.ParentPID) || owner.ChildPID != 0 && runtimeProcessAlive(owner.ChildPID) {
		return nil
	}
	if _, active := activeRunDirectories.Load(path); active {
		return nil
	}
	if err := os.RemoveAll(path); err != nil {
		return fmt.Errorf("remove orphan runtime directory: %w", err)
	}
	return nil
}
