package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func main() {
	port := flag.Int("port", 0, "fixed browser loopback port (required)")
	data := flag.String("data-dir", "", "absolute persistent data directory (required)")
	flag.Parse()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	token := os.Getenv("YINGCE_RUNTIME_SHUTDOWN_TOKEN")
	_ = os.Unsetenv("YINGCE_RUNTIME_SHUTDOWN_TOKEN")
	if err := run(ctx, *port, *data, token); err != nil {
		log.Print(err)
		os.Exit(1)
	}
}

func run(ctx context.Context, port int, data, shutdownToken string) error {
	if shutdownToken != "" && len(shutdownToken) < 32 {
		return errors.New("runtime shutdown token must contain at least 32 bytes")
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	if port < 1 || port > 65535 || data == "" || !filepath.IsAbs(data) {
		return errors.New("--port must be 1..65535 and --data-dir must be absolute")
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	exe, err = filepath.EvalSymlinks(exe)
	if err != nil {
		return err
	}
	root := filepath.Clean(filepath.Join(filepath.Dir(exe), ".."))
	data, err = resolveDataPath(filepath.Clean(data))
	if err != nil {
		return fmt.Errorf("resolve data directory: %w", err)
	}
	rel, relErr := filepath.Rel(filepath.Dir(root), data)
	// Different Windows volumes cannot be inside this release.
	if relErr == nil && (rel == "." || filepath.IsLocal(rel)) {
		return errors.New("persistent data must be outside the immutable release directory")
	}
	// executable is release/runtime/bin/yingce-runtime; root is release/runtime.
	backend := filepath.Join(root, "bin", binary("yingce-backend"))
	node := filepath.Join(root, "node", binary("node"))
	for _, p := range []string{backend, node, filepath.Join(root, "agent", "agent-runtime.mjs"), filepath.Join(root, "agent", "package.json"), filepath.Join(root, "web", "index.html")} {
		info, err := os.Stat(p)
		if err != nil || !info.Mode().IsRegular() {
			return fmt.Errorf("required runtime file missing: %s", filepath.Base(p))
		}
	}
	if info, err := os.Stat(filepath.Join(root, "agent", "node_modules")); err != nil || !info.IsDir() {
		return errors.New("packaged Agent node_modules missing")
	}
	if err := os.MkdirAll(data, 0700); err != nil {
		return err
	}
	dataLock, err := lockDataDir(data)
	if err != nil {
		return err
	}
	defer dataLock.Close()
	// Reserve the public port before spawning anything. Never silently change it.
	listener, err := net.Listen("tcp4", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
	if err != nil {
		return fmt.Errorf("fixed browser port unavailable: %w", err)
	}
	defer listener.Close()
	// Backend has no inherited-listener contract: choose a loopback ephemeral port,
	// then release it immediately before exec. Any bind race makes startup fail.
	internal, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return err
	}
	addr := internal.Addr().String()
	internal.Close()
	upstream, _ := url.Parse("http://" + addr)
	handler, err := newGateway(filepath.Join(root, "web"), port, upstream)
	if err != nil {
		return err
	}
	defer handler.Close()
	cmd := exec.Command(backend)
	cmd.Dir = filepath.Dir(root) // release directory, not a developer checkout
	cmd.Env = backendEnv(data, addr, port, root)
	if shutdownToken != "" {
		cmd.Env = append(cmd.Env, "YINGCE_BACKEND_SHUTDOWN_TOKEN="+shutdownToken)
	}
	passDataLock(cmd, dataLock)
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	cleanup, err := startManaged(cmd)
	if err != nil {
		return fmt.Errorf("start packaged backend: %w", err)
	}
	defer cleanup()
	exited := make(chan error, 1)
	go func() { exited <- cmd.Wait() }()
	server := &http.Server{Handler: privateManagement(handler, port, shutdownToken, cancel), ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 90 * time.Second}
	served := make(chan error, 1)
	go func() { served <- server.Serve(listener) }()
	var result error
	select {
	case <-ctx.Done():
	case err := <-exited:
		if err == nil {
			result = errors.New("backend exited unexpectedly")
		} else {
			result = fmt.Errorf("backend exited: %w", err)
		}
		_ = server.Close()
		return result
	case err := <-served:
		if !errors.Is(err, http.ErrServerClosed) {
			result = err
		}
	}
	// Stop accepting browser traffic, but do not block on unbounded SSE connections.
	_ = server.Close()
	// Source installations add a private backend cancellation hook. It is never
	// exposed by the public gateway, and works without Windows console signals.
	if err := requestBackendShutdown(upstream, shutdownToken); err != nil {
		// Legacy Unix backends can still stop with SIGTERM. Windows has no safe
		// equivalent; let the deadline expire before terminating the owned job.
		signalManaged(cmd)
	}
	select {
	case err := <-exited:
		if err != nil && result == nil {
			result = fmt.Errorf("backend failed during shutdown: %w", err)
		}
	case <-time.After(45 * time.Second):
		cleanup()
		<-exited
		if result == nil {
			result = errors.New("backend exceeded shutdown deadline; process tree terminated")
		}
	}
	return result
}

func binary(name string) string {
	if runtime.GOOS == "windows" {
		return name + ".exe"
	}
	return name
}

func backendEnv(data, addr string, port int, root string) []string {
	// Deliberately avoid inherited database, proxy, upstream, Agent and Node options.
	// Only OS essentials survive. No ambient remote DB or service configuration.
	allowed := map[string]bool{"SYSTEMROOT": true, "WINDIR": true, "TEMP": true, "TMP": true, "TMPDIR": true, "HOME": true, "USERPROFILE": true, "LANG": true, "LC_ALL": true, "TZ": true}
	env := []string{}
	for _, entry := range os.Environ() {
		k, _, _ := strings.Cut(entry, "=")
		if allowed[strings.ToUpper(k)] {
			env = append(env, entry)
		}
	}
	origin := "http://127.0.0.1:" + strconv.Itoa(port)
	return append(env,
		"PATH="+filepath.Join(root, "node")+string(os.PathListSeparator)+filepath.Join(root, "media", "bin"),
		"GIN_MODE=release", "NODE_ENV=production", "PI_OFFLINE=1",
		"CANVAS_BACKEND_ADDR="+addr, "CANVAS_BACKEND_DATA_DIR="+data,
		"CANVAS_DATABASE_DRIVER=sqlite", "CANVAS_CORS_ORIGINS="+origin,
		"CANVAS_PI_RUNTIME_DIR="+filepath.Join(root, "agent"),
		"CANVAS_OFFICIAL_PLUGIN_DIR="+filepath.Join(filepath.Dir(root), "plugin-packages"),
		"CANVAS_SHUTDOWN_TIMEOUT=30s",
	)
}
