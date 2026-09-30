package hostupdate

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type recordingRunner struct {
	calls [][]string
}

func (r *recordingRunner) Run(_ context.Context, _ string, args, _ []string, stdout, _ io.Writer) error {
	r.calls = append(r.calls, append([]string(nil), args...))
	if stdout != nil {
		_, _ = io.WriteString(stdout, "backup-fixture")
	}
	return nil
}

func TestSetEnvValuePreservesOtherSettings(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, ".env")
	if err := os.WriteFile(path, []byte("# keep\nCANVAS_IMAGE_TAG=1.0.0\nPOSTGRES_DB=canvas\n"), 0o640); err != nil {
		t.Fatal(err)
	}
	if err := setEnvValue(path, "CANVAS_IMAGE_TAG", "1.2.2-preview.1"); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	value := string(data)
	if !strings.Contains(value, "# keep\n") || !strings.Contains(value, "POSTGRES_DB=canvas\n") || !strings.Contains(value, "CANVAS_IMAGE_TAG=1.2.2-preview.1\n") {
		t.Fatalf("unexpected env contents: %q", value)
	}
	stat, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if stat.Mode().Perm() != 0o640 {
		t.Fatalf("mode=%o, want 640", stat.Mode().Perm())
	}
}

func TestVerifyZipBackupRejectsCorruption(t *testing.T) {
	path := filepath.Join(t.TempDir(), "backup.zip")
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	archive := zip.NewWriter(file)
	for name, content := range map[string]string{
		"metadata.json":    "{}",
		"database.dump":    "database",
		"backend-data.tar": "data",
	} {
		entry, createErr := archive.Create(name)
		if createErr != nil {
			t.Fatal(createErr)
		}
		if _, writeErr := io.WriteString(entry, content); writeErr != nil {
			t.Fatal(writeErr)
		}
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(data)
	checksum := "sha256:" + hex.EncodeToString(hash[:])
	if err := verifyZipBackup(path, checksum); err != nil {
		t.Fatalf("valid backup rejected: %v", err)
	}
	if err := os.WriteFile(path, append(data, byte(1)), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := verifyZipBackup(path, checksum); err == nil {
		t.Fatal("corrupted backup was accepted")
	}
}

func TestCurrentVersionRejectsLatest(t *testing.T) {
	installDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(installDir, ".env"), []byte("CANVAS_IMAGE_TAG=latest\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	manager := &Manager{config: Config{InstallDir: installDir, EnvFile: ".env"}}
	if _, err := manager.currentVersion(); err == nil {
		t.Fatal("latest tag was accepted")
	}
}

func TestCreateBackupReadsBackendDataAsRoot(t *testing.T) {
	installDir := t.TempDir()
	backupDir := filepath.Join(installDir, "backups")
	if err := os.MkdirAll(backupDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(installDir, ".env"), []byte("POSTGRES_USER=canvas\nPOSTGRES_DB=canvas\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	runner := &recordingRunner{}
	manager := &Manager{
		config: Config{InstallDir: installDir, ComposeFile: "docker-compose.deploy.yml", EnvFile: ".env", BackupDir: backupDir},
		runner: runner,
	}
	if _, err := manager.createBackup("v1.2.2-preview.2"); err != nil {
		t.Fatal(err)
	}
	for _, call := range runner.calls {
		joined := strings.Join(call, " ")
		if strings.Contains(joined, "exec -T --user root backend tar -C /data -cf - .") {
			return
		}
	}
	t.Fatalf("backend data backup did not use root: %#v", runner.calls)
}

func TestCheckWritableDirectory(t *testing.T) {
	directory := t.TempDir()
	if err := checkWritableDirectory(directory); err != nil {
		t.Fatalf("writable directory rejected: %v", err)
	}
	entries, err := os.ReadDir(directory)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("write probe was not cleaned up: %v", entries)
	}
	if err := checkWritableDirectory(filepath.Join(directory, "missing")); err == nil {
		t.Fatal("missing directory was accepted")
	}
}

func TestComposeProjectNameUsesInstallDirectory(t *testing.T) {
	cases := map[string]string{
		"/opt/yingce":           "yingce",
		"/srv/Open AI Canvas_2": "openaicanvas_2",
		"/":                     "open-ai-canvas",
		"/srv/!!!":              "open-ai-canvas",
	}
	for installDir, want := range cases {
		if got := composeProjectName(installDir); got != want {
			t.Errorf("composeProjectName(%q) = %q, want %q", installDir, got, want)
		}
	}
}

func TestWriteComposeEnvOverrideReplacesImageRefs(t *testing.T) {
	installDir := t.TempDir()
	stateDir := filepath.Join(installDir, "state")
	if err := os.MkdirAll(stateDir, 0o700); err != nil {
		t.Fatal(err)
	}
	envPath := filepath.Join(installDir, ".env")
	if err := os.WriteFile(envPath, []byte("CANVAS_BACKEND_IMAGE=old-backend\nCANVAS_WEB_IMAGE=old-web\nPOSTGRES_DB=canvas\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	manager := &Manager{config: Config{InstallDir: installDir, EnvFile: ".env", StateDir: stateDir}}
	path, err := manager.writeComposeEnvOverride(deploymentImages{backend: "new-backend", web: "new-web", agent: "new-agent"})
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(path)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	value := string(data)
	if !strings.Contains(value, "CANVAS_BACKEND_IMAGE=new-backend\n") || !strings.Contains(value, "CANVAS_WEB_IMAGE=new-web\n") || !strings.Contains(value, "CANVAS_YINGCE_AGENT_IMAGE=new-agent\n") || !strings.Contains(value, "POSTGRES_DB=canvas\n") {
		t.Fatalf("unexpected override env: %q", value)
	}
}

// v1.5.8.x 的 Host Updater 只注入 backend/web 镜像，也不会生成 Agent Token。
// 部署 Compose 中 Agent 相关变量必须有回退值，否则旧更新器的预检会直接失败。
func TestDeployComposeAgentVariablesFallbackForLegacyUpdater(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "docker-compose.deploy.yml"))
	if err != nil {
		t.Fatal(err)
	}
	compose := string(data)
	for _, required := range []string{"${CANVAS_YINGCE_AGENT_IMAGE:?", "${YINGCE_AGENT_TOKEN:?"} {
		if strings.Contains(compose, required) {
			t.Errorf("docker-compose.deploy.yml must not hard-require %s…}", required)
		}
	}
	for _, fallback := range []string{"${CANVAS_YINGCE_AGENT_IMAGE:-", "${YINGCE_AGENT_TOKEN:-${CANVAS_UPDATER_TOKEN:?"} {
		if !strings.Contains(compose, fallback) {
			t.Errorf("docker-compose.deploy.yml is missing fallback %s…}", fallback)
		}
	}
}
