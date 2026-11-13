package runtime

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// fakeRuntime 用一个假的 agent-runtime.mjs 替换真实运行时，只验证 Go 侧的进程与输出处理。
func fakeRuntime(t *testing.T, script string) {
	t.Helper()
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node is not installed")
	}
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "agent-runtime.mjs"), []byte(script), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CANVAS_PI_RUNTIME_DIR", dir)
	t.Setenv("YINGCE_AGENT_TEMP_DIR", filepath.Join(t.TempDir(), "runs"))
}

func TestSetProcessLimitDoesNotStopActiveWork(t *testing.T) {
	t.Cleanup(func() { SetProcessLimit(defaultAgentProcessLimit) })
	release, err := acquireAgentProcess(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	active, limit := SetProcessLimit(1)
	if active != 1 || limit != 1 {
		t.Fatalf("active=%d limit=%d, want active 1 and limit 1", active, limit)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	if _, err := acquireAgentProcess(ctx); err == nil {
		t.Fatal("lowered limit still admitted another process")
	}
	release()
	SetProcessLimit(defaultAgentProcessLimit)
}

func TestProcessQueueIsBoundedAndCancellationReleasesWaiter(t *testing.T) {
	t.Setenv("YINGCE_AGENT_MAX_QUEUE", "1")
	SetProcessLimit(1)
	t.Cleanup(func() { SetProcessLimit(defaultAgentProcessLimit) })
	release, err := acquireAgentProcess(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	waited := make(chan error, 1)
	go func() {
		permit, err := acquireAgentProcess(ctx)
		if permit != nil {
			permit()
		}
		waited <- err
	}()
	deadline := time.Now().Add(time.Second)
	for {
		processGate.mu.Lock()
		waiting := processGate.waiting
		processGate.mu.Unlock()
		if waiting == 1 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("first waiter did not enter the queue")
		}
		time.Sleep(time.Millisecond)
	}
	if permit, err := acquireAgentProcess(context.Background()); err == nil || !strings.Contains(err.Error(), "queue is full") {
		if permit != nil {
			permit()
		}
		t.Fatalf("full queue accepted another request: %v", err)
	}
	cancel()
	if err := <-waited; err != context.Canceled {
		t.Fatalf("queued cancellation returned %v", err)
	}
	processGate.mu.Lock()
	waiting := processGate.waiting
	processGate.mu.Unlock()
	if waiting != 0 {
		t.Fatalf("cancelled request leaked a queue slot: %d", waiting)
	}
}

func TestProcessDeploymentCapBoundsConfiguredConcurrency(t *testing.T) {
	t.Setenv("YINGCE_AGENT_SESSION_CAP", "2")
	t.Setenv("CANVAS_AGENT_MAX_PROCESSES", "30")
	gate := newAgentProcessGate()
	if gate.limit != 2 || gate.hardCap != 2 {
		t.Fatalf("deployment cap was ignored: limit=%d cap=%d", gate.limit, gate.hardCap)
	}
}

func noopBridge() Bridge {
	handler := func(context.Context, map[string]json.RawMessage) (any, error) { return map[string]any{"ok": true}, nil }
	return Bridge{Model: handler, Tool: handler, Event: handler}
}

// 回归：Wait 早于读完 stdout 时，大量输出后正常退出会被判成
// "read |0: file already closed"。
func TestRunDrainsStdoutBeforeWait(t *testing.T) {
	fakeRuntime(t, `
const line = JSON.stringify({ event: "progress", pad: "x".repeat(2048) }) + "\n";
for (let i = 0; i < 2000; i++) process.stdout.write(line);
process.stdout.write(JSON.stringify({ event: "settled" }) + "\n");
`)
	for i := 0; i < 5; i++ {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		err := Run(ctx, ProcessRequest{Model: map[string]any{"id": "m"}}, noopBridge())
		cancel()
		if err != nil {
			t.Fatalf("attempt %d: normal exit reported as failure: %v", i, err)
		}
	}
}

// runtime_error 之后仍要读到 EOF，并把该错误作为运行结果返回。
func TestRunReportsRuntimeErrorAfterDrainingOutput(t *testing.T) {
	fakeRuntime(t, `
process.stdout.write(JSON.stringify({ event: "runtime_error", message: "boom" }) + "\n");
const line = JSON.stringify({ event: "progress", pad: "x".repeat(2048) }) + "\n";
for (let i = 0; i < 500; i++) process.stdout.write(line);
process.exitCode = 1;
`)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	err := Run(ctx, ProcessRequest{Model: map[string]any{"id": "m"}}, noopBridge())
	if err == nil || err.Error() != "boom" {
		t.Fatalf("want runtime_error message, got %v", err)
	}
}

// 子进程只能拿到白名单环境变量，拿不到数据库连接等密钥。
func TestRunDoesNotLeakBackendEnvironment(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://secret")
	fakeRuntime(t, `
if (process.env.DATABASE_URL) {
  process.stdout.write(JSON.stringify({ event: "runtime_error", message: "leaked" }) + "\n");
  process.exitCode = 1;
}
`)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := Run(ctx, ProcessRequest{Model: map[string]any{"id": "m"}}, noopBridge()); err != nil {
		if strings.Contains(err.Error(), "leaked") {
			t.Fatal("backend environment leaked into the Agent runtime")
		}
		t.Fatal(err)
	}
}
