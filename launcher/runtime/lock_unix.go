//go:build !windows

package main

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
)

func lockDataDir(data string) (*os.File, error) {
	file, err := os.OpenFile(filepath.Join(data, ".yingce-runtime.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, errors.New("cannot open runtime data lock")
	}
	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		file.Close()
		return nil, errors.New("data directory already has a live runtime/backend lock")
	}
	return file, nil
}
func passDataLock(cmd *exec.Cmd, file *os.File) {
	// dup2 in os/exec shares the locked open-file description with backend fd3.
	// Parent death releases only its copy, not the backend's inherited lock.
	cmd.ExtraFiles = append(cmd.ExtraFiles, file)
}
