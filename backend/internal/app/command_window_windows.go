//go:build windows

package app

import (
	"os/exec"
	"syscall"
)

// createNoWindow corresponds to CREATE_NO_WINDOW in the Windows API.
const createNoWindow = 0x08000000

// hideCommandWindow keeps console tools (ffmpeg, ffprobe) started by the windowless server
// from each opening a new console or Windows Terminal tab.
func hideCommandWindow(cmd *exec.Cmd) *exec.Cmd {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.HideWindow = true
	cmd.SysProcAttr.CreationFlags |= createNoWindow
	return cmd
}
