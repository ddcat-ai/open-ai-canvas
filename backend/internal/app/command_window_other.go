//go:build !windows

package app

import "os/exec"

func hideCommandWindow(cmd *exec.Cmd) *exec.Cmd { return cmd }
