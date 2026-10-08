package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"yingce/backend/internal/hostupdate"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if err := run(ctx); err != nil {
		log.Fatal(err)
	}
}

func run(ctx context.Context) error {
	socketPath := env("CANVAS_UPDATER_SOCKET", "/run/open-ai-canvas-updater/updater.sock")
	token := strings.TrimSpace(os.Getenv("CANVAS_UPDATER_TOKEN"))
	manager, err := hostupdate.NewManager(hostupdate.Config{
		Repository:   env("CANVAS_UPDATER_REPOSITORY", "ddcat-ai/open-ai-canvas"),
		InstallDir:   env("CANVAS_UPDATER_INSTALL_DIR", "/opt/open-ai-canvas"),
		ComposeFile:  env("CANVAS_UPDATER_COMPOSE_FILE", "docker-compose.deploy.yml"),
		EnvFile:      env("CANVAS_UPDATER_ENV_FILE", ".env"),
		StateDir:     env("CANVAS_UPDATER_STATE_DIR", "/var/lib/open-ai-canvas-updater"),
		BackupDir:    env("CANVAS_UPDATER_BACKUP_DIR", "/opt/open-ai-canvas/backups"),
		HealthURL:    strings.TrimSpace(os.Getenv("CANVAS_UPDATER_HEALTH_URL")),
		GitHubToken:  strings.TrimSpace(os.Getenv("CANVAS_UPDATER_GITHUB_TOKEN")),
		StableWindow: envDuration("CANVAS_UPDATER_STABLE_WINDOW", 30*time.Second),
		StepTimeout:  envDuration("CANVAS_UPDATER_STEP_TIMEOUT", 20*time.Minute),
		BinaryPath:   env("CANVAS_UPDATER_BINARY_PATH", "/usr/local/bin/open-ai-canvas-host-updater"),
		ServiceName:  env("CANVAS_UPDATER_SERVICE_NAME", "open-ai-canvas-updater.service"),
		SelfUpdate:   envBool("CANVAS_UPDATER_SELF_UPDATE", true),
	})
	if err != nil {
		return err
	}
	server, err := hostupdate.NewServer(manager, token)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(socketPath), 0o755); err != nil {
		return err
	}
	if err := removeStaleSocket(socketPath); err != nil {
		return err
	}
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		return err
	}
	defer listener.Close()
	defer os.Remove(socketPath)
	if err := os.Chmod(socketPath, 0o666); err != nil {
		return err
	}
	httpServer := &http.Server{Handler: server.Handler(), ReadHeaderTimeout: 5 * time.Second}
	serveErr := make(chan error, 1)
	go func() { serveErr <- httpServer.Serve(listener) }()
	log.Printf("host updater listening on unix://%s", socketPath)
	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return httpServer.Shutdown(shutdownCtx)
	case err := <-serveErr:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}

func removeStaleSocket(path string) error {
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSocket == 0 {
		return fmt.Errorf("拒绝删除非 Socket 路径 %s", path)
	}
	return os.Remove(path)
}

func env(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func envDuration(key string, fallback time.Duration) time.Duration {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(value)
	if err != nil || parsed <= 0 {
		log.Fatalf("%s 必须是正数时长", key)
	}
	return parsed
}

func envBool(key string, fallback bool) bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	if value == "" {
		return fallback
	}
	if value == "true" || value == "1" || value == "yes" {
		return true
	}
	if value == "false" || value == "0" || value == "no" {
		return false
	}
	log.Fatalf("%s 必须是 true 或 false", key)
	return fallback
}
