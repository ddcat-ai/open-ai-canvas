package runtime

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const requestLimit = 32 << 20
const lineLimit = 4 << 20

type Bridge struct {
	Model func(context.Context, map[string]json.RawMessage) (any, error)
	Tool  func(context.Context, map[string]json.RawMessage) (any, error)
	Event func(context.Context, map[string]json.RawMessage) (any, error)
}

type ProcessRequest struct {
	BridgeURL     string           `json:"bridgeURL"`
	BridgeToken   string           `json:"bridgeToken"`
	SessionFile   string           `json:"sessionFile,omitempty"`
	SessionJSONL  string           `json:"sessionJSONL,omitempty"`
	SessionDir    string           `json:"sessionDir,omitempty"`
	SessionID     string           `json:"sessionId,omitempty"`
	UserID        string           `json:"userId,omitempty"`
	CanvasID      string           `json:"canvasId,omitempty"`
	RunID         string           `json:"runId,omitempty"`
	CWD           string           `json:"cwd"`
	AgentDir      string           `json:"agentDir"`
	Prompt        string           `json:"prompt"`
	SystemPrompt  string           `json:"systemPrompt"`
	SkillPaths    []string         `json:"skillPaths,omitempty"`
	EnabledSkills []map[string]any `json:"enabledSkills,omitempty"`
	Profile       map[string]any   `json:"profile,omitempty"`
	Memory        map[string]any   `json:"memory,omitempty"`
	Canvas        map[string]any   `json:"canvas,omitempty"`
	Features      map[string]any   `json:"features,omitempty"`
	Tools         []map[string]any `json:"tools"`
	Compaction    map[string]any   `json:"compaction,omitempty"`
	Permissions   map[string]any   `json:"permissions,omitempty"`
	Model         map[string]any   `json:"model"`
}

func Run(ctx context.Context, request ProcessRequest, bridge Bridge) error {
	if bridge.Model == nil || bridge.Tool == nil || bridge.Event == nil {
		return errors.New("Agent bridge handlers are incomplete")
	}
	runtimeDir, err := RuntimeDir()
	if err != nil {
		return err
	}
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return fmt.Errorf("create Agent bridge credential: %w", err)
	}
	token := hex.EncodeToString(tokenBytes)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return fmt.Errorf("listen for Agent bridge: %w", err)
	}
	defer listener.Close()
	mux := http.NewServeMux()
	mux.HandleFunc("POST /model", func(w http.ResponseWriter, r *http.Request) { BridgeCall(w, r, token, bridge.Model) })
	mux.HandleFunc("POST /tool", func(w http.ResponseWriter, r *http.Request) { BridgeCall(w, r, token, bridge.Tool) })
	mux.HandleFunc("POST /event", func(w http.ResponseWriter, r *http.Request) { BridgeCall(w, r, token, bridge.Event) })
	server := &http.Server{Handler: mux, ReadHeaderTimeout: 3 * time.Second, ReadTimeout: 2 * time.Minute}
	serverDone := make(chan error, 1)
	go func() { serverDone <- server.Serve(listener) }()
	defer func() { _ = server.Shutdown(context.Background()) }()

	request.BridgeURL = "http://" + listener.Addr().String()
	request.BridgeToken = token
	payload, err := json.Marshal(request)
	if err != nil {
		return fmt.Errorf("encode Agent runtime request: %w", err)
	}
	cmd := exec.CommandContext(ctx, "node", filepath.Join(runtimeDir, "agent-runtime.mjs"))
	cmd.Dir = runtimeDir
	cmd.Stdin = strings.NewReader(string(payload))
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("open Agent runtime output: %w", err)
	}
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start Agent runtime: %w", err)
	}
	stdoutErr := make(chan error, 1)
	go func() {
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 64*1024), lineLimit)
		for scanner.Scan() {
			var event struct {
				Event   string `json:"event"`
				Message string `json:"message"`
			}
			if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
				stdoutErr <- fmt.Errorf("decode Agent runtime event: %w", err)
				return
			}
			if event.Event == "runtime_error" || event.Event == "bridge_error" {
				stdoutErr <- errors.New(firstNonEmpty(event.Message, "Agent runtime failed"))
				return
			}
		}
		if err := scanner.Err(); err != nil {
			stdoutErr <- fmt.Errorf("read Agent runtime output: %w", err)
			return
		}
		stdoutErr <- nil
	}()
	waitErr := cmd.Wait()
	lineErr := <-stdoutErr
	if lineErr != nil {
		return lineErr
	}
	if waitErr != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return fmt.Errorf("Agent runtime exited: %w", waitErr)
	}
	return nil
}

func BridgeCall(w http.ResponseWriter, r *http.Request, expectedToken string, handler func(context.Context, map[string]json.RawMessage) (any, error)) {
	if r.RemoteAddr == "" || !strings.HasPrefix(r.RemoteAddr, "127.0.0.1:") {
		http.Error(w, `{"error":"loopback bridge only"}`, http.StatusForbidden)
		return
	}
	if r.Header.Get("Authorization") != "Bearer "+expectedToken {
		http.Error(w, `{"error":"unauthorized bridge"}`, http.StatusUnauthorized)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, requestLimit+1))
	if err != nil || len(body) > requestLimit {
		http.Error(w, `{"error":"bridge payload too large or unreadable"}`, http.StatusRequestEntityTooLarge)
		return
	}
	var payload map[string]json.RawMessage
	if err := json.Unmarshal(body, &payload); err != nil {
		http.Error(w, `{"error":"invalid bridge payload"}`, http.StatusBadRequest)
		return
	}
	result, err := handler(r.Context(), payload)
	w.Header().Set("Content-Type", "application/json")
	if err != nil {
		w.WriteHeader(http.StatusUnprocessableEntity)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	_ = json.NewEncoder(w).Encode(result)
}

func RuntimeDir() (string, error) {
	candidates := []string{os.Getenv("CANVAS_PI_RUNTIME_DIR"), "/app/backend/agent-runtime/pi"}
	if _, source, _, ok := runtime.Caller(0); ok {
		candidates = append(candidates, filepath.Clean(filepath.Join(filepath.Dir(source), "../../../agent-runtime/pi")))
	}
	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		if info, err := os.Stat(filepath.Join(candidate, "agent-runtime.mjs")); err == nil && !info.IsDir() {
			return candidate, nil
		}
	}
	return "", errors.New("Agent runtime files are missing; set CANVAS_PI_RUNTIME_DIR")
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
