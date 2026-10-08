package yingceagent

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	agentruntime "yingce/backend/internal/agent/runtime"
)

func TestRemoteRunCallsBridgeAndRejectsBadToken(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node is not installed")
	}
	_, source, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("locate test file")
	}
	serverPath := filepath.Clean(filepath.Join(filepath.Dir(source), "../../../../yingce-agent/server.mjs"))
	runtimePath := filepath.Join(t.TempDir(), "agent-runtime.mjs")
	script := `
let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const request = JSON.parse(raw);
const response = await fetch(new URL("/tool", request.bridgeURL), {
  method: "POST",
  headers: { "content-type": "application/json", authorization: "Bearer " + request.bridgeToken },
  body: JSON.stringify({ name: "lookup" }),
});
if (!response.ok) {
  process.stdout.write(JSON.stringify({ event: "runtime_error", message: "bridge " + response.status }) + "\n");
  process.exitCode = 1;
} else {
  process.stdout.write(JSON.stringify({ event: "settled" }) + "\n");
}
`
	if err := os.WriteFile(runtimePath, []byte(script), 0o600); err != nil {
		t.Fatal(err)
	}
	token := strings.Repeat("ab", 16)
	cmd := exec.Command("node", serverPath)
	cmd.Env = append(os.Environ(),
		"YINGCE_AGENT_TOKEN="+token,
		"YINGCE_AGENT_RUNTIME="+runtimePath,
		"PORT=0",
		"MAX_CONCURRENT_SESSIONS=2",
	)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = cmd.Process.Kill()
		_, _ = cmd.Process.Wait()
	})
	reader := bufio.NewReader(stdout)
	line, err := reader.ReadString('\n')
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(line, "YINGCE_AGENT_READY ") {
		t.Fatalf("server did not report its port: %q", line)
	}
	endpoint := "http://127.0.0.1:" + strings.TrimSpace(strings.TrimPrefix(line, "YINGCE_AGENT_READY "))

	health, err := http.Get(endpoint + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	defer health.Body.Close()
	if health.StatusCode != http.StatusOK {
		t.Fatalf("health status %d", health.StatusCode)
	}

	unauthorized, err := http.Post(endpoint+"/v1/runs", "application/json", strings.NewReader(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	defer unauthorized.Body.Close()
	if unauthorized.StatusCode != http.StatusUnauthorized {
		t.Fatalf("missing token status %d", unauthorized.StatusCode)
	}

	called := false
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	err = Run(ctx, endpoint, token, "127.0.0.1", agentruntime.ProcessRequest{
		Model: map[string]any{"id": "m"},
	}, agentruntime.Bridge{
		Model: func(context.Context, map[string]json.RawMessage) (any, error) {
			return map[string]any{"ok": true}, nil
		},
		Tool: func(context.Context, map[string]json.RawMessage) (any, error) {
			called = true
			return map[string]any{"content": "ok"}, nil
		},
		Event: func(context.Context, map[string]json.RawMessage) (any, error) {
			return map[string]any{"ok": true}, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !called {
		t.Fatal("remote runtime did not call the Go tool bridge")
	}
	if err := SetLimit(ctx, endpoint, token, 16); err != nil {
		t.Fatal(err)
	}
	status, err := Inspect(ctx, endpoint)
	if err != nil {
		t.Fatal(err)
	}
	if status.Limit != 16 {
		t.Fatalf("limit = %d, want 16", status.Limit)
	}
}
