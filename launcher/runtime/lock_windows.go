//go:build windows

package main

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"unsafe"
)

var lockFileEx = kernel.NewProc("LockFileEx")

func lockDataDir(data string) (*os.File, error) {
	file, err := os.OpenFile(filepath.Join(data, ".yingce-runtime.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, errors.New("cannot open runtime data lock")
	}
	overlapped := syscall.Overlapped{}
	ok, _, _ := lockFileEx.Call(file.Fd(), 3, 0, 1, 0, uintptr(unsafe.Pointer(&overlapped)))
	if ok == 0 {
		file.Close()
		return nil, errors.New("data directory already has a live runtime lock")
	}
	return file, nil
}
func passDataLock(cmd *exec.Cmd, file *os.File) {
	// Windows descendants are supervised by the kill-on-close backend Job.
	// Unlike Unix flock, this process-scoped lock is not inherited.
}
