package antigravity

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"sync"
)

// 画布工具通过一个只在本次模型步存在的本机 MCP 端点交给 agy（MCP Streamable HTTP，仅 JSON 响应）。
// 画布的工具循环由 Pi 运行时负责，所以 agy 发起的 tools/call 不在这里执行：
// 工具桥只记录调用、挂起应答，模型步随即结束并把调用交还给 Pi。
const (
	mcpServerName      = "yingce"
	mcpProtocolVersion = "2025-06-18"
	mcpMaxRequestBytes = 16 << 20
)

// Tool 是交给模型的画布工具定义（JSON Schema 参数）。
type Tool struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
}

// ToolCall 是模型发起的一次工具调用；Arguments 为 JSON 文本。
type ToolCall struct {
	ID        string
	Name      string
	Arguments string
}

type toolBridge struct {
	tools    []Tool
	path     string
	server   *http.Server
	listener net.Listener
	mu       sync.Mutex
	calls    []ToolCall
	called   chan struct{}
	once     sync.Once
	closed   chan struct{}
}

func newToolBridge(tools []Tool) (*toolBridge, error) {
	token, err := randomHex(16)
	if err != nil {
		return nil, err
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	bridge := &toolBridge{tools: tools, path: "/mcp/" + token, listener: listener, called: make(chan struct{}), closed: make(chan struct{})}
	mux := http.NewServeMux()
	mux.HandleFunc(bridge.path, bridge.serve)
	bridge.server = &http.Server{Handler: mux}
	go func() { _ = bridge.server.Serve(listener) }()
	return bridge, nil
}

func (b *toolBridge) url() string {
	return "http://" + b.listener.Addr().String() + b.path
}

// mcpServer 是 ACP session/new 里的 HTTP MCP 服务描述。
func (b *toolBridge) mcpServer() map[string]any {
	return map[string]any{"type": "http", "name": mcpServerName, "url": b.url(), "headers": []any{}}
}

func (b *toolBridge) recordedCalls() []ToolCall {
	b.mu.Lock()
	defer b.mu.Unlock()
	return append([]ToolCall(nil), b.calls...)
}

func (b *toolBridge) close() {
	b.once.Do(func() { close(b.closed) })
	_ = b.server.Close()
}

type mcpRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

func (b *toolBridge) serve(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
	case http.MethodDelete:
		w.WriteHeader(http.StatusOK)
		return
	default:
		w.Header().Set("Allow", "POST, DELETE")
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, mcpMaxRequestBytes))
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	var request mcpRequest
	if err := json.Unmarshal(body, &request); err != nil {
		writeMCP(w, nil, nil, &rpcError{Code: -32700, Message: "parse error"})
		return
	}
	if len(request.ID) == 0 {
		// 通知（如 notifications/initialized）只需确认收到。
		w.WriteHeader(http.StatusAccepted)
		return
	}
	switch request.Method {
	case "initialize":
		var params struct {
			ProtocolVersion string `json:"protocolVersion"`
		}
		_ = json.Unmarshal(request.Params, &params)
		version := params.ProtocolVersion
		if version == "" {
			version = mcpProtocolVersion
		}
		writeMCP(w, request.ID, map[string]any{
			"protocolVersion": version,
			"capabilities":    map[string]any{"tools": map[string]any{"listChanged": false}},
			"serverInfo":      map[string]any{"name": mcpServerName, "title": acpClientTitle, "version": "1"},
		}, nil)
	case "ping":
		writeMCP(w, request.ID, map[string]any{}, nil)
	case "tools/list":
		writeMCP(w, request.ID, map[string]any{"tools": b.tools}, nil)
	case "tools/call":
		b.recordCall(w, r, request)
	default:
		writeMCP(w, request.ID, nil, &rpcError{Code: acpMethodNotFound, Message: "method not found"})
	}
}

// recordCall 记录调用后一直挂起到本次模型步结束；agy 收到取消后放弃这次调用。
func (b *toolBridge) recordCall(w http.ResponseWriter, r *http.Request, request mcpRequest) {
	var params struct {
		Name      string          `json:"name"`
		Arguments json.RawMessage `json:"arguments"`
	}
	if err := json.Unmarshal(request.Params, &params); err != nil || params.Name == "" {
		writeMCP(w, request.ID, nil, &rpcError{Code: -32602, Message: "invalid tool call"})
		return
	}
	arguments := "{}"
	if len(params.Arguments) > 0 && string(params.Arguments) != "null" {
		arguments = string(params.Arguments)
	}
	id, err := randomHex(12)
	if err != nil {
		writeMCP(w, request.ID, nil, &rpcError{Code: -32603, Message: err.Error()})
		return
	}
	b.mu.Lock()
	b.calls = append(b.calls, ToolCall{ID: "call_" + id, Name: params.Name, Arguments: arguments})
	if len(b.calls) == 1 {
		close(b.called)
	}
	b.mu.Unlock()
	select {
	case <-b.closed:
	case <-r.Context().Done():
	}
	writeMCP(w, request.ID, map[string]any{
		"content": []any{map[string]any{"type": "text", "text": "The canvas runs this tool after the current turn ends."}},
		"isError": true,
	}, nil)
}

func writeMCP(w http.ResponseWriter, id json.RawMessage, result any, failure *rpcError) {
	response := map[string]any{"jsonrpc": "2.0", "id": id}
	if failure != nil {
		response["error"] = failure
	} else {
		response["result"] = result
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(response)
}

func randomHex(size int) (string, error) {
	buffer := make([]byte, size)
	if _, err := rand.Read(buffer); err != nil {
		return "", errors.New("无法生成随机标识")
	}
	return hex.EncodeToString(buffer), nil
}
