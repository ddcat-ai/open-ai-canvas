//go:build !windows

package main

import (
	"os/exec"
	"syscall"
)

func startManaged(cmd *exec.Cmd) (func(), error) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	// Negative PID targets only the group created for this owned backend.
	cleanup := func() { _ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) }
	return cleanup, nil
}
func signalManaged(cmd *exec.Cmd) {
	_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
}
