package hostupdate

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type protectionRunner struct {
	manager                                                           *Manager
	foreignImage, missingDigest, override, mount, edited, unavailable bool
	calls                                                             []string
}

func (r *protectionRunner) Run(_ context.Context, _ string, args, _ []string, out, _ io.Writer) error {
	command := strings.Join(args, " ")
	r.calls = append(r.calls, command)
	if r.unavailable {
		return fmt.Errorf("docker unavailable")
	}
	service := args[len(args)-1]
	ref := "ghcr.io/ddcat-ai/open-ai-canvas-" + service + "@sha256:" + strings.Repeat("a", 64)
	switch {
	case args[0] == "compose":
		fmt.Fprint(out, service)
	case args[0] == "container":
		path := r.manager.composePath()
		if r.override {
			path += ",/custom.yml"
		}
		if r.foreignImage {
			ref = "custom:latest"
		}
		mounts := []map[string]string{}
		if r.mount {
			mounts = append(mounts, map[string]string{"Destination": "/app"})
		}
		return json.NewEncoder(out).Encode(map[string]any{"Image": service, "Config": map[string]any{"Image": ref, "Labels": map[string]string{"com.docker.compose.project.config_files": path}}, "Mounts": mounts})
	case args[0] == "image":
		digests := []string{ref}
		if r.missingDigest {
			digests = nil
		}
		return json.NewEncoder(out).Encode(map[string]any{"RepoDigests": digests})
	case args[0] == "diff":
		if r.edited {
			fmt.Fprintln(out, "C /usr/local/bin/yingce-backend")
		} else {
			fmt.Fprintln(out, "A /tmp/runtime.log")
		}
	default:
		return fmt.Errorf("unexpected command: %s", command)
	}
	return nil
}

func protectedManager(t *testing.T) (*Manager, *protectionRunner) {
	t.Helper()
	dir := t.TempDir()
	m := &Manager{config: Config{InstallDir: dir, StateDir: dir, EnvFile: ".env", ComposeFile: "docker-compose.deploy.yml", Repository: "ddcat-ai/open-ai-canvas"}}
	if err := os.WriteFile(m.composePath(), []byte("services: {}\n"), 0600); err != nil {
		t.Fatal(err)
	}
	hash, err := composeDigest(m.composePath())
	if err != nil {
		t.Fatal(err)
	}
	env := "CANVAS_IMAGE_TAG=1.0.0\nCANVAS_UPDATE_POLICY=managed\nCANVAS_RELEASE_REPOSITORY=ddcat-ai/open-ai-canvas\nCANVAS_RELEASE_COMPOSE_SHA256=" + hash + "\n"
	for key, service := range map[string]string{"BACKEND": "backend", "WEB": "web", "YINGCE_AGENT": "yingce-agent"} {
		env += "CANVAS_" + key + "_IMAGE=ghcr.io/ddcat-ai/open-ai-canvas-" + service + "@sha256:" + strings.Repeat("a", 64) + "\n"
	}
	if err := os.WriteFile(m.envPath(), []byte(env), 0600); err != nil {
		t.Fatal(err)
	}
	r := &protectionRunner{manager: m}
	m.runner = r
	return m, r
}

func TestDeploymentProtection(t *testing.T) {
	for _, tc := range []struct {
		name   string
		change func(*Manager, *protectionRunner)
		want   string
	}{
		{"managed", func(*Manager, *protectionRunner) {}, ""},
		{"manual", func(m *Manager, _ *protectionRunner) { _ = setEnvValue(m.envPath(), "CANVAS_UPDATE_POLICY", "manual") }, "手动维护"},
		{"legacy unknown", func(m *Manager, _ *protectionRunner) { _ = setEnvValue(m.envPath(), "CANVAS_UPDATE_POLICY", "") }, "来源未确认"},
		{"cross publisher", func(m *Manager, _ *protectionRunner) { m.config.Repository = "my-fork/open-ai-canvas" }, "跨发行方"},
		{"compose changed", func(m *Manager, _ *protectionRunner) { _ = os.WriteFile(m.composePath(), []byte("custom"), 0600) }, "Compose 已修改"},
		{"local image", func(m *Manager, _ *protectionRunner) {
			_ = setEnvValue(m.envPath(), "CANVAS_BACKEND_IMAGE", "my-custom:1")
		}, "自定义镜像"},
		{"runtime mismatch", func(_ *Manager, r *protectionRunner) { r.foreignImage = true }, "运行镜像"},
		{"retagged build", func(_ *Manager, r *protectionRunner) { r.missingDigest = true }, "本地构建"},
		{"compose override", func(_ *Manager, r *protectionRunner) { r.override = true }, "Compose"},
		{"source mounted", func(_ *Manager, r *protectionRunner) { r.mount = true }, "挂载"},
		{"container edited", func(_ *Manager, r *protectionRunner) { r.edited = true }, "程序文件已修改"},
		{"docker unavailable", func(_ *Manager, r *protectionRunner) { r.unavailable = true }, "无法核验"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m, r := protectedManager(t)
			tc.change(m, r)
			err := m.deploymentProtection(true)
			if tc.want == "" {
				if err != nil {
					t.Fatal(err)
				}
			} else if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("got %v, want %s", err, tc.want)
			}
			for _, call := range r.calls {
				if strings.Contains(call, " stop ") || strings.Contains(call, " pull ") || strings.Contains(call, "migrate") {
					t.Fatalf("destructive preflight command: %s", call)
				}
			}
		})
	}
}

func TestProtectedDeploymentRejectsDirectStartAndPreflight(t *testing.T) {
	m, r := protectedManager(t)
	if err := setEnvValue(m.envPath(), "CANVAS_UPDATE_POLICY", "manual"); err != nil {
		t.Fatal(err)
	}
	m.state.LatestRelease = &Release{Version: "v2.0.0"}
	status, err := m.StartUpdate("v2.0.0")
	if err == nil || status.Operation.Phase.Active() {
		t.Fatal("direct update bypassed protection")
	}
	found := false
	for _, check := range status.Checks {
		if check.Key == "deployment_protection" && check.Blocking && check.Status == "failed" {
			found = true
		}
	}
	if !found {
		t.Fatal("UI lacks blocking protection reason")
	}
	if err := m.preflight(filepath.Join(t.TempDir(), "next.yml"), "v2.0.0"); err == nil {
		t.Fatal("preflight bypassed protection")
	}
	if len(r.calls) != 0 {
		t.Fatalf("protected deployment reached docker: %v", r.calls)
	}
	m.state.RollbackVersion = "v0.9.0"
	m.state.LastBackup = &Backup{Version: "v0.9.0"}
	if _, err := m.StartRollback("rollback custom build"); err == nil {
		t.Fatal("manual rollback bypassed protection")
	}
}

func TestProtectedCodeMountIncludesParents(t *testing.T) {
	for _, path := range []string{"/", "/usr", "/usr/local", "/usr/local/bin", "/app/src", "/opt"} {
		if !protectedCodeMount(path) {
			t.Errorf("code mount allowed: %s", path)
		}
	}
	for _, path := range []string{"/data", "/tmp", "/run/open-ai-canvas-updater", "/usr/share/nginx/html"} {
		if protectedCodeMount(path) {
			t.Errorf("data mount rejected: %s", path)
		}
	}
}

func TestRuntimeProtectionReasonSurvivesStatusReload(t *testing.T) {
	m, r := protectedManager(t)
	r.foreignImage = true
	m.state.LatestRelease = &Release{Version: "v2.0.0"}
	s, err := NewServer(m, strings.Repeat("x", 32))
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/v1/update", strings.NewReader(`{"targetVersion":"v2.0.0"}`))
	request.Header.Set("Authorization", "Bearer "+strings.Repeat("x", 32))
	response := httptest.NewRecorder()
	s.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusConflict {
		t.Fatalf("status=%d, body=%s", response.Code, response.Body.String())
	}
	m.state.ProtectionError = ""
	if err := m.loadState(); err != nil {
		t.Fatal(err)
	}
	status := m.Snapshot()
	for _, check := range status.Checks {
		if check.Key == "deployment_protection" && check.Status == "failed" && strings.Contains(check.Detail, "运行镜像") {
			return
		}
	}
	t.Fatal("runtime protection failure disappeared from status")
}
