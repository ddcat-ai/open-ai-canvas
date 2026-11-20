package hostupdate

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type sourceTransport func(*http.Request) (*http.Response, error)

func (f sourceTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

type sourceRunner func(context.Context, string, []string, []string, io.Writer, io.Writer) error

func (f sourceRunner) Run(ctx context.Context, name string, args, env []string, out, stderr io.Writer) error {
	return f(ctx, name, args, env, out, stderr)
}

func sourceResponse(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(body))}
}

func sourceManager(t *testing.T) *Manager {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, ".env"), []byte("CANVAS_IMAGE_TAG=1.0.0\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "docker-compose.deploy.yml"), []byte("services: {}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	m, err := NewManager(Config{InstallDir: dir, StateDir: filepath.Join(dir, "state")})
	if err != nil {
		t.Fatal(err)
	}
	return m
}

func TestSourcesPersistAndInvalidateCheckedRelease(t *testing.T) {
	m := sourceManager(t)
	if *m.Snapshot().Sources != (Sources{"direct", "ghcr"}) {
		t.Fatal("unexpected defaults")
	}
	m.state.LatestRelease = &Release{Version: "v2.0.0"}
	status, err := m.SaveSources(Sources{"gh_proxy", "nju"})
	if err != nil {
		t.Fatal(err)
	}
	if status.LatestRelease != nil || status.UpdateAvailable {
		t.Fatal("old release survived source change")
	}
	if _, err := m.StartUpdate("v2.0.0"); err == nil {
		t.Fatal("update accepted without checking new source")
	}
	reloaded, err := NewManager(m.config)
	if err != nil {
		t.Fatal(err)
	}
	if *reloaded.Snapshot().Sources != *status.Sources {
		t.Fatal("source configuration was not persisted")
	}
	if _, err := m.SaveSources(Sources{"https://untrusted.invalid", "nju"}); err == nil {
		t.Fatal("arbitrary source accepted")
	}
}

func TestSourcesSaveFailureDoesNotChangeMemory(t *testing.T) {
	m := sourceManager(t)
	m.config.StateDir = filepath.Join(m.config.StateDir, "missing")
	if _, err := m.SaveSources(Sources{"gh_proxy", "nju"}); err == nil {
		t.Fatal("failed save reported success")
	}
	if *m.Snapshot().Sources != (Sources{"direct", "ghcr"}) {
		t.Fatal("failed save changed configuration")
	}
}

func TestSourcesServerRequiresAuthentication(t *testing.T) {
	m := sourceManager(t)
	server, err := NewServer(m, strings.Repeat("t", 32))
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/v1/sources", "/v1/sources/test"} {
		method := http.MethodPut
		if strings.HasSuffix(path, "/test") {
			method = http.MethodPost
		}
		response := httptest.NewRecorder()
		request := httptest.NewRequest(method, path, strings.NewReader(`{"githubSource":"gh_proxy","imageSource":"nju"}`))
		server.Handler().ServeHTTP(response, request)
		if response.Code != http.StatusUnauthorized {
			t.Fatal("unauthenticated source operation accepted")
		}
	}
	if m.state.SourceProbe != nil || m.state.Sources != (Sources{"direct", "ghcr"}) {
		t.Fatal("unauthenticated request had side effects")
	}
}

func TestSourcesRestartRecoversInterruptedProbe(t *testing.T) {
	m := sourceManager(t)
	if _, err := m.SaveSources(Sources{"gh_proxy", "nju"}); err != nil {
		t.Fatal(err)
	}
	m.state.SourceProbe = &SourceProbe{Status: "running", Sources: m.state.Sources, Checks: []Check{{Key: "release", Status: "pending"}}}
	if err := m.saveStateLocked(); err != nil {
		t.Fatal(err)
	}
	restarted, err := NewManager(m.config)
	if err != nil {
		t.Fatal(err)
	}
	status := restarted.Snapshot()
	if status.SourceProbe.Status != "failed" || status.SourceProbe.Checks[0].Status != "failed" || status.SourceProbe.FinishedAt == nil {
		t.Fatal("interrupted probe not recovered")
	}
	if *status.Sources != (Sources{"gh_proxy", "nju"}) {
		t.Fatal("restart reset saved sources")
	}
}

func TestSourcesGitHubRoutingAndCredentialIsolation(t *testing.T) {
	for _, sources := range []Sources{{"direct", "ghcr"}, {"gh_proxy", "nju"}} {
		for _, original := range []string{"https://api.github.com/repos/ddcat-ai/open-ai-canvas/releases?per_page=30", "https://raw.githubusercontent.com/ddcat-ai/open-ai-canvas/v2.0.0/docker-compose.deploy.yml", "https://github.com/ddcat-ai/open-ai-canvas/releases/download/v2.0.0/SHA256SUMS"} {
			t.Run(sources.GitHubSource+original, func(t *testing.T) {
				m := sourceManager(t)
				m.config.GitHubToken = "private-test-token"
				m.httpClient.Transport = sourceTransport(func(r *http.Request) (*http.Response, error) {
					wantURL := original
					if sources.GitHubSource == "gh_proxy" {
						wantURL = "https://gh-proxy.com/" + original
					}
					if r.URL.String() != wantURL {
						t.Errorf("URL=%s, want %s", r.URL, wantURL)
					}
					wantAuth := ""
					if sources.GitHubSource == "direct" && strings.HasPrefix(original, "https://api.github.com/") {
						wantAuth = "Bearer private-test-token"
					}
					if got := r.Header.Get("Authorization"); got != wantAuth {
						t.Errorf("unexpected authorization: %q", got)
					}
					return sourceResponse(200, "ok"), nil
				})
				response, err := m.githubGet(context.Background(), original, sources, "")
				if err != nil {
					t.Fatal(err)
				}
				response.Body.Close()
			})
		}
	}
}

func TestSourcesProxyDoesNotFallbackOrFollowExternalRedirect(t *testing.T) {
	for _, status := range []int{403, 429, 302} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			m := sourceManager(t)
			calls := 0
			m.httpClient.Transport = sourceTransport(func(r *http.Request) (*http.Response, error) {
				calls++
				if r.URL.Host != "gh-proxy.com" {
					t.Fatalf("unexpected direct request: %s", r.URL)
				}
				response := sourceResponse(status, "")
				response.Header.Set("Location", "https://github.com/ddcat-ai/open-ai-canvas/releases/download/v2.0.0/SHA256SUMS")
				return response, nil
			})
			if _, err := m.githubGet(context.Background(), "https://github.com/ddcat-ai/open-ai-canvas/releases/download/v2.0.0/SHA256SUMS", Sources{"gh_proxy", "nju"}, ""); err == nil {
				t.Fatal("failure reported success")
			}
			if calls != 1 {
				t.Fatalf("made %d requests, want 1", calls)
			}
		})
	}
}

func TestSourcesDirectRedirectDoesNotLeakAPIToken(t *testing.T) {
	m := sourceManager(t)
	m.config.GitHubToken = "private-test-token"
	calls := 0
	m.httpClient.Transport = sourceTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		if calls == 1 {
			response := sourceResponse(http.StatusFound, "")
			response.Header.Set("Location", "https://raw.githubusercontent.com/ddcat-ai/open-ai-canvas/main/VERSION")
			return response, nil
		}
		if r.Header.Get("Authorization") != "" {
			t.Error("API token leaked across hosts")
		}
		return sourceResponse(200, "v2.0.0"), nil
	})
	response, err := m.githubGet(context.Background(), "https://api.github.com/repos/ddcat-ai/open-ai-canvas/releases", Sources{"direct", "ghcr"}, "")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if calls != 2 {
		t.Fatal("redirect was not followed")
	}
}

func TestSourcesRejectInvalidChecksumAndOversizedAsset(t *testing.T) {
	if _, err := releaseChecksum([]byte(strings.Repeat("z", 64)+"  binary"), "binary"); err == nil {
		t.Fatal("non-hex checksum accepted")
	}
	m := sourceManager(t)
	m.httpClient.Transport = sourceTransport(func(*http.Request) (*http.Response, error) { return sourceResponse(200, "oversized"), nil })
	if _, err := m.downloadReleaseAsset("https://github.com/ddcat-ai/open-ai-canvas/releases/download/v2.0.0/file", 3, Sources{"gh_proxy", "nju"}); err == nil {
		t.Fatal("oversized download accepted")
	}
}

func TestSourcesBusyDuringVersionCheck(t *testing.T) {
	m := sourceManager(t)
	entered, release := make(chan struct{}), make(chan struct{})
	m.httpClient.Transport = sourceTransport(func(*http.Request) (*http.Response, error) {
		close(entered)
		<-release
		return sourceResponse(200, `[{"tag_name":"v2.0.0"}]`), nil
	})
	done := make(chan error, 1)
	go func() { _, err := m.Check(context.Background()); done <- err }()
	<-entered
	_, err := m.SaveSources(Sources{"gh_proxy", "nju"})
	_, probeErr := m.TestSources()
	close(release)
	checkErr := <-done
	if !errors.Is(err, ErrBusy) || !errors.Is(probeErr, ErrBusy) || checkErr != nil {
		t.Fatalf("save=%v, probe=%v, check=%v", err, probeErr, checkErr)
	}
}

func TestSourcesMirrorDigestsAndComposeEnvironment(t *testing.T) {
	m := sourceManager(t)
	sources := Sources{"direct", "nju"}
	images := sources.images(m.config.Repository, "v2.0.0")
	for _, image := range []string{images.backend, images.web, images.agent} {
		if !strings.HasPrefix(image, "ghcr.nju.edu.cn/ddcat-ai/") || !strings.HasSuffix(image, ":2.0.0") {
			t.Fatal(image)
		}
	}
	m.runner = sourceRunner(func(_ context.Context, _ string, args, env []string, out, _ io.Writer) error {
		if args[0] == "image" {
			repository := strings.Split(args[2], ":")[0]
			return json.NewEncoder(out).Encode([]string{repository + "@sha256:" + strings.Repeat("a", 64)})
		}
		for _, key := range []string{"CANVAS_BACKEND_IMAGE", "CANVAS_WEB_IMAGE", "CANVAS_YINGCE_AGENT_IMAGE"} {
			found := false
			for _, value := range env {
				if strings.HasPrefix(value, key+"=ghcr.nju.edu.cn/") {
					found = true
				}
			}
			if !found {
				t.Errorf("missing explicit %s: %v", key, env)
			}
		}
		return nil
	})
	digests, err := m.verifyImages(images)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(digests.agent, "ghcr.nju.edu.cn/") || !strings.Contains(digests.agent, "@sha256:") {
		t.Fatal(digests)
	}
	if err := m.composeWithImages(m.composePath(), "v2.0.0", digests, time.Second, nil, "config", "--quiet"); err != nil {
		t.Fatal(err)
	}
	if err := setDeploymentImages(m.envPath(), "v2.0.0", digests); err != nil {
		t.Fatal(err)
	}
	values, err := readEnvFile(m.envPath())
	if err != nil || values["CANVAS_YINGCE_AGENT_IMAGE"] != digests.agent {
		t.Fatal("mirror digest was not persisted", err)
	}
	m.runner = sourceRunner(func(_ context.Context, _ string, _ []string, _ []string, out, _ io.Writer) error {
		return json.NewEncoder(out).Encode([]string{"ghcr.io/ddcat-ai/open-ai-canvas-backend@sha256:" + strings.Repeat("a", 64)})
	})
	if _, err := m.verifyImages(images); err == nil {
		t.Fatal("digest from wrong registry accepted")
	}
}

func TestSourcesProbeIsAsyncAndChecksSelectedResources(t *testing.T) {
	m := sourceManager(t)
	if _, err := m.SaveSources(Sources{"gh_proxy", "nju"}); err != nil {
		t.Fatal(err)
	}
	entered, release := make(chan struct{}), make(chan struct{})
	m.httpClient.Transport = sourceTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Host != "gh-proxy.com" {
			t.Errorf("unexpected host %s", r.URL.Host)
		}
		switch {
		case strings.Contains(r.URL.Path, "api.github.com"):
			close(entered)
			<-release
			return sourceResponse(200, `[{"tag_name":"v2.0.0"}]`), nil
		case strings.HasSuffix(r.URL.Path, "SHA256SUMS"):
			return sourceResponse(200, strings.Repeat("a", 64)+"  open-ai-canvas-host-updater-linux-"+runtime.GOARCH), nil
		default:
			return sourceResponse(200, "services: {}"), nil
		}
	})
	var manifests atomic.Int32
	m.runner = sourceRunner(func(_ context.Context, _ string, args, _ []string, out, _ io.Writer) error {
		if args[0] == "manifest" {
			manifests.Add(1)
			if !strings.HasPrefix(args[2], "ghcr.nju.edu.cn/") {
				t.Errorf("wrong image source %s", args[2])
			}
			_, err := fmt.Fprintf(out, `{"schemaVersion":2,"manifests":[{"platform":{"os":"linux","architecture":%q}}]}`, runtime.GOARCH)
			return err
		}
		return nil
	})
	server, err := NewServer(m, strings.Repeat("t", 32))
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/v1/sources/test", nil)
	request.Header.Set("Authorization", "Bearer "+strings.Repeat("t", 32))
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusAccepted {
		t.Fatal(response.Body.String())
	}
	<-entered
	_, busy := m.SaveSources(Sources{"direct", "ghcr"})
	close(release)
	status := waitSourceProbe(t, m)
	if !errors.Is(busy, ErrBusy) {
		t.Fatal("configuration changed during probe")
	}
	if status.SourceProbe.Status != "succeeded" || manifests.Load() != 3 {
		t.Fatalf("probe=%+v, manifests=%d", status.SourceProbe, manifests.Load())
	}
	if status.LatestRelease != nil {
		t.Fatal("probe bypassed explicit version check")
	}
	status.SourceProbe.Checks[0].Status = "tampered"
	if m.Snapshot().SourceProbe.Checks[0].Status != "passed" {
		t.Fatal("snapshot aliases mutable checks")
	}
}

func waitSourceProbe(t *testing.T, m *Manager) Status {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		status := m.Snapshot()
		if status.SourceProbe.Status != "running" {
			return status
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("source probe did not finish")
	return Status{}
}

func TestSourcesFailedPullLeavesRunningServicesUntouched(t *testing.T) {
	m := sourceManager(t)
	m.state.Sources = Sources{"gh_proxy", "nju"}
	m.state.LatestRelease = &Release{Version: "v2.0.0"}
	m.httpClient.Transport = sourceTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Scheme == "http" {
			return sourceResponse(200, `{"code":0,"data":{"build":{"version":"v1.0.0"}}}`), nil
		}
		return sourceResponse(200, "services: {}"), nil
	})
	stopped := false
	m.runner = sourceRunner(func(_ context.Context, _ string, args, _ []string, _ io.Writer, _ io.Writer) error {
		joined := strings.Join(args, " ")
		if strings.Contains(joined, "stop") {
			stopped = true
		}
		if strings.Contains(joined, "pull backend web yingce-agent") {
			return errors.New("mirror unavailable")
		}
		return nil
	})
	m.runUpdate("v1.0.0", "v2.0.0", m.state.Sources)
	if stopped || m.Snapshot().Operation.Phase != PhaseFailed {
		t.Fatal("failed preparation affected running services")
	}
	current, err := m.currentVersion()
	if err != nil || current != "v1.0.0" {
		t.Fatal("failed preparation changed deployed version", err)
	}
}
