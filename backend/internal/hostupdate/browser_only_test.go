package hostupdate

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestBrowserOnlyComposeOmitsNodeDuringUpdateAndRecovery(t *testing.T) {
	m := sourceManager(t)
	if err := setEnvValue(m.envPath(), "CANVAS_AGENT_BROWSER_ONLY", "true"); err != nil {
		t.Fatal(err)
	}
	overlay := filepath.Join(m.config.InstallDir, "docker-compose.browser-only.yml")
	if err := os.WriteFile(overlay, []byte("services: {}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	m.runner = sourceRunner(func(_ context.Context, _ string, args, env []string, _, _ io.Writer) error {
		joined := strings.Join(args, " ")
		if !strings.Contains(joined, "-f "+overlay) || strings.Contains(joined, "yingce-agent") {
			t.Fatalf("Node service selected or overlay missing: %v", args)
		}
		if !strings.Contains(strings.Join(env, "\n"), "\nCOMPOSE_PROFILES=") {
			t.Fatalf("inherited profiles were not cleared: %v", env)
		}
		return nil
	})
	for _, args := range [][]string{{"pull", "backend", "web", "yingce-agent"}, {"stop", "web", "backend", "yingce-agent"}, {"start", "backend", "yingce-agent", "web"}, {"up", "-d", "--remove-orphans"}, {"run", "--rm", "migrate"}} {
		if err := m.compose(m.composePath(), "v2.0.0", time.Second, nil, args...); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Remove(overlay); err != nil {
		t.Fatal(err)
	}
	if err := m.compose(m.composePath(), "v2.0.0", time.Second, nil, "up", "-d"); err == nil {
		t.Fatal("missing browser-only overlay silently enabled the server Agent")
	}
}

func TestBrowserOnlyImageVerificationNeedsNoAgentImage(t *testing.T) {
	m := sourceManager(t)
	if err := setEnvValue(m.envPath(), "CANVAS_AGENT_BROWSER_ONLY", "true"); err != nil {
		t.Fatal(err)
	}
	calls := 0
	m.runner = sourceRunner(func(_ context.Context, _ string, args, _ []string, out, _ io.Writer) error {
		calls++
		if strings.Contains(args[2], "yingce-agent") {
			t.Fatal("browser-only update requires a Node Agent image")
		}
		repository := strings.Split(args[2], ":")[0]
		return json.NewEncoder(out).Encode([]string{repository + "@sha256:" + strings.Repeat("a", 64)})
	})
	images, err := m.verifyImages(immutableImageRefs(m.config.Repository, "v2.0.0"))
	if err != nil || calls != 2 || !strings.Contains(images.backend, "@sha256:") || !strings.Contains(images.web, "@sha256:") {
		t.Fatalf("unexpected image verification: %+v calls=%d err=%v", images, calls, err)
	}
}
