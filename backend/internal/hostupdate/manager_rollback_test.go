package hostupdate

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

type rollbackDockerCall struct {
	Args []string
	Tag  string
}

// Every Docker invocation stays in this test executable, including pg_restore's stdin.
func TestRollbackDockerHelper(t *testing.T) {
	if os.Getenv("HOSTUPDATE_DOCKER_HELPER") != "1" {
		return
	}
	separator := slices.Index(os.Args, "--")
	if separator < 0 {
		os.Exit(2)
	}
	args := os.Args[separator+1:]
	file, err := os.OpenFile(os.Getenv("HOSTUPDATE_DOCKER_CALLS"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		os.Exit(2)
	}
	err = json.NewEncoder(file).Encode(rollbackDockerCall{Args: args, Tag: os.Getenv("CANVAS_IMAGE_TAG")})
	_ = file.Close()
	if err != nil {
		os.Exit(2)
	}
	for _, step := range []string{"stop", "config", "dropdb", "createdb", "pg_restore", "up"} {
		if !slices.Contains(args, step) {
			continue
		}
		if step == "pg_restore" {
			input, readErr := io.ReadAll(os.Stdin)
			if readErr != nil || os.WriteFile(os.Getenv("HOSTUPDATE_RESTORED_DATABASE"), input, 0o600) != nil {
				os.Exit(2)
			}
		}
		if step == os.Getenv("HOSTUPDATE_DOCKER_FAILURE") {
			if os.Getenv("HOSTUPDATE_SILENT_FAILURE") != "1" {
				_, _ = io.WriteString(os.Stderr, step+" fixture failure")
			}
			os.Exit(1)
		}
	}
	os.Exit(0)
}

type rollbackHealthTransport struct{ requests int }

func (transport *rollbackHealthTransport) RoundTrip(*http.Request) (*http.Response, error) {
	transport.requests++
	return &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(strings.NewReader(`{"code":0,"data":{"build":{"version":"1.0.0"}}}`)),
		Header:     make(http.Header),
	}, nil
}

func rollbackFixture(t *testing.T) (*Manager, Backup, *rollbackHealthTransport) {
	t.Helper()
	root := t.TempDir()
	installDir := filepath.Join(root, "canvas installation")
	stateDir := filepath.Join(root, "updater state")
	binDir := filepath.Join(root, "fixture bin")
	for _, directory := range []string{installDir, stateDir, binDir} {
		if err := os.MkdirAll(directory, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	shim := "#!/bin/sh\nexec \"$HOSTUPDATE_TEST_BINARY\" -test.run '^TestRollbackDockerHelper$' -- \"$@\"\n"
	if err := os.WriteFile(filepath.Join(binDir, "docker"), []byte(shim), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", binDir)
	t.Setenv("HOSTUPDATE_TEST_BINARY", binary)
	t.Setenv("HOSTUPDATE_DOCKER_HELPER", "1")
	t.Setenv("HOSTUPDATE_DOCKER_FAILURE", "")
	t.Setenv("HOSTUPDATE_SILENT_FAILURE", "")
	t.Setenv("HOSTUPDATE_DOCKER_CALLS", filepath.Join(root, "docker-calls.jsonl"))
	t.Setenv("HOSTUPDATE_RESTORED_DATABASE", filepath.Join(root, "restored-database"))
	transport := &rollbackHealthTransport{}
	manager := &Manager{
		config: Config{
			InstallDir: installDir, StateDir: stateDir,
			ComposeFile: "compose.yml", EnvFile: ".env",
			StepTimeout: time.Minute, StableWindow: time.Nanosecond,
			HealthURL: "http://rollback.invalid/api/health/ready",
		},
		runner:     execRunner{dir: installDir},
		httpClient: &http.Client{Transport: transport},
	}
	for path, data := range map[string]string{
		manager.composePath():         "services: {} # current\n",
		manager.previousComposePath(): "services: {} # old\n",
		manager.envPath():             "CANVAS_IMAGE_TAG=2.0.0\nPOSTGRES_DB=canvas\n",
		manager.previousEnvPath():     "CANVAS_IMAGE_TAG=1.0.0\nPOSTGRES_DB=canvas\n",
	} {
		if err := os.WriteFile(path, []byte(data), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	backup := Backup{ID: "rollback-fixture", Path: filepath.Join(root, "backup.zip"), Version: "v1.0.0"}
	file, err := os.Create(backup.Path)
	if err != nil {
		t.Fatal(err)
	}
	archive := zip.NewWriter(file)
	var backendData bytes.Buffer
	tarWriter := tar.NewWriter(&backendData)
	if err := tarWriter.WriteHeader(&tar.Header{Name: ".settings-key", Mode: 0o600, Size: 3}); err != nil {
		t.Fatal(err)
	}
	if _, err := io.WriteString(tarWriter, "key"); err != nil {
		t.Fatal(err)
	}
	if err := tarWriter.Close(); err != nil {
		t.Fatal(err)
	}
	for name, data := range map[string][]byte{"metadata.json": []byte(`{"format":1,"version":"v1.0.0"}`), "database.dump": []byte("previous database"), "backend-data.tar": backendData.Bytes()} {
		if err := writeZipBytes(archive, name, data); err != nil {
			t.Fatal(err)
		}
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(backup.Path)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(data)
	backup.Checksum = "sha256:" + hex.EncodeToString(digest[:])
	manager.state = persistedState{
		LastBackup: &backup, RollbackVersion: backup.Version,
		Operation: Operation{ID: "rollback-fixture", Phase: PhaseRollingBack, Error: "original update failure", Logs: []LogEntry{{Message: "original evidence"}}},
	}
	return manager, backup, transport
}

func rollbackCalls(t *testing.T) []rollbackDockerCall {
	t.Helper()
	file, err := os.Open(os.Getenv("HOSTUPDATE_DOCKER_CALLS"))
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	decoder := json.NewDecoder(file)
	var calls []rollbackDockerCall
	for {
		var call rollbackDockerCall
		if err := decoder.Decode(&call); err == io.EOF {
			break
		} else if err != nil {
			t.Fatal(err)
		}
		calls = append(calls, call)
	}
	return calls
}

func TestRollbackStopsAfterPrerequisiteFailure(t *testing.T) {
	for _, failure := range []string{"stop", "missing-compose", "missing-env", "unreadable-compose", "unreadable-env", "config", "checksum", "system-database", "dropdb", "createdb", "pg_restore", "pg_restore-silent"} {
		t.Run(failure, func(t *testing.T) {
			manager, backup, transport := rollbackFixture(t)
			switch failure {
			case "missing-compose":
				if err := os.Remove(manager.previousComposePath()); err != nil {
					t.Fatal(err)
				}
			case "missing-env":
				if err := os.Remove(manager.previousEnvPath()); err != nil {
					t.Fatal(err)
				}
			case "unreadable-compose", "unreadable-env":
				path := manager.previousComposePath()
				if failure == "unreadable-env" {
					path = manager.previousEnvPath()
				}
				if err := os.Remove(path); err != nil {
					t.Fatal(err)
				}
				if err := os.Mkdir(path, 0o700); err != nil {
					t.Fatal(err)
				}
			case "checksum":
				backup.Checksum = "invalid-checksum"
			case "system-database":
				if err := setEnvValue(manager.previousEnvPath(), "POSTGRES_DB", "postgres"); err != nil {
					t.Fatal(err)
				}
			case "pg_restore-silent":
				t.Setenv("HOSTUPDATE_DOCKER_FAILURE", "pg_restore")
				t.Setenv("HOSTUPDATE_SILENT_FAILURE", "1")
			default:
				t.Setenv("HOSTUPDATE_DOCKER_FAILURE", failure)
			}
			manager.runRollback(backup.Version, backup, true)
			calls := rollbackCalls(t)
			for _, call := range calls {
				if slices.Contains(call.Args, "up") {
					t.Errorf("started services after %s failure: %v", failure, call.Args)
				}
			}
			if failure == "stop" && len(calls) != 1 {
				t.Errorf("continued recovery after stop failed: %v", calls)
			}
			if transport.requests != 0 {
				t.Errorf("checked health after failed prerequisite: requests=%d", transport.requests)
			}
			operation := manager.state.Operation
			if operation.Phase != PhaseManualIntervention || operation.RollbackError == "" || operation.Error != "original update failure" || !operation.AutomaticRollback || operation.FinishedAt == nil {
				t.Errorf("rollback failure evidence lost: %+v", operation)
			}
			if operation.Logs[0].Message != "original evidence" || manager.state.LastBackup.ID != backup.ID || manager.state.RollbackVersion != backup.Version {
				t.Fatal("existing operation evidence or backup metadata was changed")
			}
			if failure == "pg_restore-silent" && !strings.Contains(operation.RollbackError, "exit status 1") {
				t.Errorf("pg_restore exit cause was lost: %q", operation.RollbackError)
			}
			if err := manager.loadState(); err != nil || manager.state.Operation.RollbackError != operation.RollbackError {
				t.Fatalf("failure result was not persisted: %v", err)
			}
		})
	}
}

func TestRollbackManagementAPIKeepsAcceptedRequestAndStatus(t *testing.T) {
	manager, backup, _ := rollbackFixture(t)
	manager.state.Operation.Phase = PhaseIdle
	t.Setenv("HOSTUPDATE_DOCKER_FAILURE", "stop")
	token := strings.Repeat("t", 32)
	server, err := NewServer(manager, token)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/v1/rollback", strings.NewReader(`{"reason":"fixture rollback"}`))
	unauthorized := httptest.NewRecorder()
	server.Handler().ServeHTTP(unauthorized, request)
	if unauthorized.Code != http.StatusUnauthorized || manager.Snapshot().Operation.Phase != PhaseIdle {
		t.Fatal("unauthenticated rollback changed state")
	}
	request = httptest.NewRequest(http.MethodPost, "/v1/rollback", strings.NewReader(`{"reason":"fixture rollback"}`))
	request.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	var accepted Status
	if err := json.Unmarshal(response.Body.Bytes(), &accepted); err != nil || response.Code != http.StatusAccepted || accepted.Operation.Phase != PhaseRollingBack || accepted.Operation.TargetVersion != backup.Version {
		t.Fatalf("rollback acceptance contract changed: status=%d payload=%s err=%v", response.Code, response.Body, err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for manager.Snapshot().Operation.Phase.Active() && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	operation := manager.Snapshot().Operation
	if operation.Phase != PhaseManualIntervention || operation.AutomaticRollback || operation.FromVersion != "v2.0.0" || operation.RollbackError == "" || !strings.Contains(operation.Logs[0].Message, "fixture rollback") {
		t.Fatalf("manual rollback status contract changed: %+v", operation)
	}
}

func TestRollbackKeepsSuccessfulRecoveryContract(t *testing.T) {
	for _, automatic := range []bool{false, true} {
		t.Run(map[bool]string{false: "manual", true: "automatic"}[automatic], func(t *testing.T) {
			manager, backup, transport := rollbackFixture(t)
			manager.runRollback(backup.Version, backup, automatic)
			if manager.state.Operation.Phase != PhaseRolledBack || manager.state.Operation.RollbackError != "" || manager.state.Operation.AutomaticRollback != automatic || manager.state.Operation.Error != "original update failure" {
				t.Fatalf("unexpected recovery result: %+v", manager.state.Operation)
			}
			calls := rollbackCalls(t)
			if !slices.Contains(calls[0].Args, "yingce-agent") {
				t.Error("rollback did not stop the Agent runtime")
			}
			for _, call := range calls {
				for key, want := range map[string]string{"--project-name": composeProjectName(manager.config.InstallDir), "--env-file": manager.envPath(), "-f": manager.composePath()} {
					index := slices.Index(call.Args, key)
					if index < 0 || index+1 >= len(call.Args) || call.Args[index+1] != want {
						t.Errorf("%s identity mismatch: %v, want %s", key, call.Args, want)
					}
				}
				if call.Tag != "1.0.0" {
					t.Errorf("recovery used image tag %q", call.Tag)
				}
				if slices.Contains(call.Args, "up") && !slices.Contains(call.Args, "never") {
					t.Error("rollback attempted to pull images")
				}
			}
			data, err := os.ReadFile(os.Getenv("HOSTUPDATE_RESTORED_DATABASE"))
			if err != nil || string(data) != "previous database" {
				t.Fatalf("database restore input was lost: %q, %v", data, err)
			}
			if transport.requests < 2 {
				t.Errorf("stable health verification was skipped: requests=%d", transport.requests)
			}
			if err := manager.loadState(); err != nil || manager.state.Operation.Phase != PhaseRolledBack {
				t.Fatalf("recovery result was not persisted: %v", err)
			}
		})
	}
}
