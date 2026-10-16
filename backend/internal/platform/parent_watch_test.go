package platform

import (
	"context"
	"os"
	"os/exec"
	"testing"
	"time"
)

// TestParentWatchHelper 在被打上环境变量时永久驻留，供看门狗测试当作被观察的父进程。
func TestParentWatchHelper(t *testing.T) {
	if os.Getenv("CANVAS_PARENT_WATCH_HELPER") != "1" {
		return
	}
	select {}
}

func spawnWatchedParent(t *testing.T) *exec.Cmd {
	t.Helper()
	command := exec.Command(os.Args[0], "-test.run=TestParentWatchHelper")
	command.Env = append(os.Environ(), "CANVAS_PARENT_WATCH_HELPER=1")
	if err := command.Start(); err != nil {
		t.Fatalf("启动被观察进程：%v", err)
	}
	t.Cleanup(func() {
		_ = command.Process.Kill()
		_, _ = command.Process.Wait()
	})
	return command
}

func TestProcessAliveReportsCurrentProcess(t *testing.T) {
	if !processAlive(os.Getpid()) {
		t.Fatal("当前进程应判定为存活")
	}
}

func TestProcessAliveRejectsInvalidPID(t *testing.T) {
	for _, pid := range []int{0, -1} {
		if processAlive(pid) {
			t.Fatalf("pid %d 应判定为不存在", pid)
		}
	}
}

func TestProcessAliveReportsSpawnedChild(t *testing.T) {
	parent := spawnWatchedParent(t)
	if !processAlive(parent.Process.Pid) {
		t.Fatalf("pid %d 应判定为存活", parent.Process.Pid)
	}
}

func TestWatchParentFiresOnlyAfterParentExit(t *testing.T) {
	parent := spawnWatchedParent(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	fired := make(chan struct{}, 1)
	stopped := make(chan struct{})
	go func() {
		WatchParent(ctx, parent.Process.Pid, 10*time.Millisecond, func() { fired <- struct{}{} })
		close(stopped)
	}()

	select {
	case <-fired:
		t.Fatal("父进程仍存活时看门狗不应触发")
	case <-time.After(80 * time.Millisecond):
	}

	if err := parent.Process.Kill(); err != nil {
		t.Fatalf("结束被观察进程：%v", err)
	}
	_, _ = parent.Process.Wait()

	select {
	case <-fired:
	case <-time.After(10 * time.Second):
		t.Fatal("父进程退出后看门狗未触发")
	}
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("触发后看门狗应返回")
	}
}

func TestWatchParentStopsWithContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	fired := make(chan struct{}, 1)
	stopped := make(chan struct{})
	go func() {
		WatchParent(ctx, os.Getpid(), 10*time.Millisecond, func() { fired <- struct{}{} })
		close(stopped)
	}()
	cancel()

	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("ctx 结束后看门狗应返回")
	}
	select {
	case <-fired:
		t.Fatal("ctx 结束后不应再报告父进程退出")
	default:
	}
}

func TestWatchParentIgnoresInvalidArguments(t *testing.T) {
	ctx := context.Background()
	called := false
	onExit := func() { called = true }
	WatchParent(ctx, 0, 10*time.Millisecond, onExit)
	WatchParent(ctx, os.Getpid(), 0, onExit)
	WatchParent(ctx, os.Getpid(), 10*time.Millisecond, nil)
	if called {
		t.Fatal("非法参数不应触发回调")
	}
}
