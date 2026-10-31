//go:build !windows

package main

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"os/exec"
	"testing"
)

func TestInheritedDataLockHelper(t *testing.T) {
	if os.Getenv("YINGCE_LOCK_HELPER") != "1" {
		return
	}
	fmt.Println("ready")
	_, _ = io.Copy(io.Discard, os.Stdin)
	os.Exit(0)
}

func TestBackendInheritedLockSurvivesParentClose(t *testing.T) {
	dir := t.TempDir()
	lock, err := lockDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Close()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	child := exec.Command(exe, "-test.run=^TestInheritedDataLockHelper$")
	child.Env = append(os.Environ(), "YINGCE_LOCK_HELPER=1")
	passDataLock(child, lock)
	stdin, err := child.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := child.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := child.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { child.Process.Kill(); child.Wait() }()
	line, err := bufio.NewReader(stdout).ReadString('\n')
	if err != nil || line != "ready\n" {
		t.Fatalf("child startup %q %v", line, err)
	}
	lock.Close()
	competing, err := lockDataDir(dir)
	if err == nil {
		competing.Close()
		t.Fatal("new runtime acquired orphan backend's data lock")
	}
	stdin.Close()
	if err := child.Wait(); err != nil {
		t.Fatal(err)
	}
	next, err := lockDataDir(dir)
	if err != nil {
		t.Fatal("backend exit must release lock:", err)
	}
	next.Close()
}
