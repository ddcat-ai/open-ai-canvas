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
	"strconv"
	"strings"
	"sync"
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
	SessionJSONL  string           `json:"sessionJSONL,omitempty"`
	SessionID     string           `json:"sessionId,omitempty"`
	UserID        string           `json:"userId,omitempty"`
	CanvasID      string           `json:"canvasId,omitempty"`
	RunID         string           `json:"runId,omitempty"`
	Prompt        string           `json:"prompt"`
	SystemPrompt  string           `json:"systemPrompt"`
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

// BridgeServer is the per-run callback endpoint. The Node runtime calls it for
// model, tool, and event steps. Authorization is the bearer token; binding can
// be loopback for the embedded process or the container network for yingce-agent.
type BridgeServer struct {
	URL   string
	Token string
	Close func()
}

func Run(ctx context.Context, request ProcessRequest, bridge Bridge) error {
	release, err := acquireAgentProcess(ctx)
	if err != nil {
		return err
	}
	defer release()
	if bridge.Model == nil || bridge.Tool == nil || bridge.Event == nil {
		return errors.New("Agent bridge handlers are incomplete")
	}
	provision, err := Ensure(ctx)
	if err != nil {
		return err
	}
	server, err := StartBridge("127.0.0.1:0", "127.0.0.1", bridge)
	if err != nil {
		return err
	}
	defer server.Close()
	request.BridgeURL = server.URL
	request.BridgeToken = server.Token
	payload, err := json.Marshal(request)
	if err != nil {
		return fmt.Errorf("encode Agent runtime request: %w", err)
	}
	cmd := exec.CommandContext(ctx, provision.NodePath, "--max-old-space-size="+nodeMemoryMB(), filepath.Join(provision.Dir, "agent-runtime.mjs"))
	cmd.Dir = provision.Dir
	cmd.Stdin = strings.NewReader(string(payload))
	// 环境变量白名单：只传 Node 运行所需的最少变量。HOME 与会话、工作目录
	// 由运行时自己建的临时隔离目录提供，不使用服务端数据目录。
	cmd.Env = []string{
		"PATH=" + os.Getenv("PATH"),
		"NODE_ENV=production",
		"PI_OFFLINE=1",
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("open Agent runtime output: %w", err)
	}
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start Agent runtime: %w", err)
	}
	// StdoutPipe 的读取必须在 Wait 之前结束。Wait 会关闭管道，提前调用会把
	// 正常退出误报为 "file already closed"。
	lineErr := ReadOutput(stdout)
	waitErr := cmd.Wait()
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

func StartBridge(listenAddr, advertiseHost string, bridge Bridge) (*BridgeServer, error) {
	if bridge.Model == nil || bridge.Tool == nil || bridge.Event == nil {
		return nil, errors.New("Agent bridge handlers are incomplete")
	}
	advertiseHost = strings.TrimSpace(advertiseHost)
	if advertiseHost == "" || strings.ContainsAny(advertiseHost, `:/\\ `) {
		return nil, errors.New("Agent bridge host must be a hostname or IP without a scheme or port")
	}
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return nil, fmt.Errorf("create Agent bridge credential: %w", err)
	}
	token := hex.EncodeToString(tokenBytes)
	listener, err := net.Listen("tcp", listenAddr)
	if err != nil {
		return nil, fmt.Errorf("listen for Agent bridge: %w", err)
	}
	tcpAddr, ok := listener.Addr().(*net.TCPAddr)
	if !ok || tcpAddr.Port == 0 {
		_ = listener.Close()
		return nil, errors.New("Agent bridge did not receive a TCP port")
	}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /model", func(w http.ResponseWriter, r *http.Request) { BridgeCall(w, r, token, bridge.Model) })
	mux.HandleFunc("POST /tool", func(w http.ResponseWriter, r *http.Request) { BridgeCall(w, r, token, bridge.Tool) })
	mux.HandleFunc("POST /event", func(w http.ResponseWriter, r *http.Request) { BridgeCall(w, r, token, bridge.Event) })
	server := &http.Server{Handler: mux, ReadHeaderTimeout: 3 * time.Second, ReadTimeout: 2 * time.Minute}
	go func() { _ = server.Serve(listener) }()
	return &BridgeServer{
		URL:   fmt.Sprintf("http://%s:%d", advertiseHost, tcpAddr.Port),
		Token: token,
		Close: func() { _ = server.Shutdown(context.Background()) },
	}, nil
}

func ReadOutput(stdout io.Reader) error {
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 64*1024), lineLimit)
	var lastError error
	for scanner.Scan() {
		var event struct {
			Event   string `json:"event"`
			Message string `json:"message"`
		}
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
			lastError = fmt.Errorf("decode Agent runtime event: %w", err)
			continue
		}
		if event.Event == "runtime_error" || event.Event == "bridge_error" {
			lastError = errors.New(firstNonEmpty(event.Message, "Agent runtime failed"))
		}
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("read Agent runtime output: %w", err)
	}
	return lastError
}

func BridgeCall(w http.ResponseWriter, r *http.Request, expectedToken string, handler func(context.Context, map[string]json.RawMessage) (any, error)) {
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

// RuntimeDir 只解析 pi 运行时目录。进程启动前的完整供给（含 node）走 Ensure。
func RuntimeDir() (string, error) {
	return defaultProvisioner().resolveRuntimeDir(context.Background())
}

const (
	defaultAgentProcessLimit = 30
	maxAgentProcessLimit     = 64
)

type agentProcessGate struct {
	mu     sync.Mutex
	limit  int
	active int
	wake   chan struct{}
}

var processGate = newAgentProcessGate()

func newAgentProcessGate() *agentProcessGate {
	limit := defaultAgentProcessLimit
	if raw := strings.TrimSpace(os.Getenv("CANVAS_AGENT_MAX_PROCESSES")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			limit = clampAgentProcessLimit(parsed)
		}
	}
	return &agentProcessGate{limit: limit, wake: make(chan struct{})}
}

func clampAgentProcessLimit(value int) int {
	if value < 1 {
		return defaultAgentProcessLimit
	}
	if value > maxAgentProcessLimit {
		return maxAgentProcessLimit
	}
	return value
}

// SetProcessLimit changes how many embedded Agent processes may run at once.
// Lowering the limit does not stop a process that has already started.
func SetProcessLimit(value int) (active int, limit int) {
	processGate.mu.Lock()
	defer processGate.mu.Unlock()
	processGate.limit = clampAgentProcessLimit(value)
	close(processGate.wake)
	processGate.wake = make(chan struct{})
	return processGate.active, processGate.limit
}

func ProcessUsage() (active int, limit int) {
	processGate.mu.Lock()
	defer processGate.mu.Unlock()
	return processGate.active, processGate.limit
}

func acquireAgentProcess(ctx context.Context) (func(), error) {
	for {
		processGate.mu.Lock()
		if processGate.active < processGate.limit {
			processGate.active++
			processGate.mu.Unlock()
			return releaseAgentProcess, nil
		}
		wake := processGate.wake
		processGate.mu.Unlock()
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-wake:
		}
	}
}

func releaseAgentProcess() {
	processGate.mu.Lock()
	if processGate.active > 0 {
		processGate.active--
	}
	close(processGate.wake)
	processGate.wake = make(chan struct{})
	processGate.mu.Unlock()
}

func nodeMemoryMB() string {
	raw := strings.TrimSpace(os.Getenv("YINGCE_AGENT_NODE_MEMORY_MB"))
	if parsed, err := strconv.Atoi(raw); err == nil && parsed >= 128 && parsed <= 8192 {
		return strconv.Itoa(parsed)
	}
	return "512"
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
