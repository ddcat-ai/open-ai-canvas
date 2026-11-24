//go:build windows

package app

import (
	"os"
	"os/exec"
	"strings"
	"syscall"
	"testing"
)

const hideCommandWindowChildEnv = "CANVAS_HIDE_COMMAND_WINDOW_CHILD"

// Child side of TestHideCommandWindowStartsChildWithoutConsole: report whether this process got a console.
func TestHideCommandWindowChildProcess(t *testing.T) {
	if os.Getenv(hideCommandWindowChildEnv) != "1" {
		t.Skip("helper process only")
	}
	window, _, _ := syscall.NewLazyDLL("kernel32.dll").NewProc("GetConsoleWindow").Call()
	if window == 0 {
		os.Stdout.WriteString("console=none\n")
	} else {
		os.Stdout.WriteString("console=attached\n")
	}
	os.Exit(0)
}

// The native server has no console; without CREATE_NO_WINDOW every ffmpeg/ffprobe child gets a new console window.
func TestHideCommandWindowStartsChildWithoutConsole(t *testing.T) {
	cmd := exec.Command(os.Args[0], "-test.run=^TestHideCommandWindowChildProcess$")
	cmd.Env = append(os.Environ(), hideCommandWindowChildEnv+"=1")
	if got := hideCommandWindow(cmd); got != cmd {
		t.Fatal("hideCommandWindow must return the same command for inline use")
	}
	output, err := cmd.Output()
	if err != nil {
		t.Fatalf("child process failed: %v", err)
	}
	if !strings.Contains(string(output), "console=none") {
		t.Fatalf("child must start without a console, got %q", output)
	}
}

// Callers may already set creation flags; hiding the window must add to them instead of replacing them.
func TestHideCommandWindowKeepsExistingCreationFlags(t *testing.T) {
	cmd := exec.Command("ffmpeg")
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP}
	hideCommandWindow(cmd)
	if !cmd.SysProcAttr.HideWindow {
		t.Fatal("HideWindow must be set")
	}
	if want := uint32(syscall.CREATE_NEW_PROCESS_GROUP | createNoWindow); cmd.SysProcAttr.CreationFlags != want {
		t.Fatalf("creation flags = %#x, want %#x", cmd.SysProcAttr.CreationFlags, want)
	}
}
