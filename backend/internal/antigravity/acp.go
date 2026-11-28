package antigravity

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"sync/atomic"
)

// agy acp 在标准输入输出上逐行收发 JSON-RPC 2.0（ACP 协议版本 1）。
const (
	acpProtocolVersion   = 1
	acpMaxLineBytes      = 64 << 20
	acpStderrTailBytes   = 8 << 10
	acpAuthRequiredCode  = -32000
	acpMethodNotFound    = -32601
	acpClientName        = "yingce"
	acpClientTitle       = "影策"
	acpPermissionReject  = "reject_once"
	acpPermissionAllow   = "allow_once"
	acpPermissionCancel  = "cancelled"
	acpPermissionPicked  = "selected"
	acpSessionUpdate     = "session/update"
	acpRequestPermission = "session/request_permission"
	acpSignInLinkPrefix  = "Open the following link to authenticate the ACP server:"
	acpNoBrowserPrefix   = "No browser is available here"
)

// ErrSignInRequired 表示 agy 没有可用的登录凭据（ACP -32000 Authentication required）。
var ErrSignInRequired = errors.New("Antigravity 未登录或登录已失效，请管理员在渠道里重新登录")

type rpcError struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data,omitempty"`
}

func (e *rpcError) Error() string {
	return fmt.Sprintf("Antigravity 返回错误（%d）：%s", e.Code, e.Message)
}

type rpcEnvelope struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

type rpcReply struct {
	result json.RawMessage
	err    *rpcError
}

// acpHandlers 处理 agy 主动发来的通知与请求。请求处理器返回 nil 错误时回写 result。
type acpHandlers struct {
	notification func(method string, params json.RawMessage)
	request      func(method string, params json.RawMessage) (any, *rpcError)
}

type acpProcess struct {
	cmd      *exec.Cmd
	stdin    io.WriteCloser
	writeMu  sync.Mutex
	nextID   atomic.Int64
	mu       sync.Mutex
	pending  map[int64]chan rpcReply
	handlers acpHandlers
	stderr   *tailBuffer
	done     chan struct{}
	waitErr  error
}

type launchSpec struct {
	executable string
	args       []string
	env        []string
	dir        string
}

func startACP(spec launchSpec, handlers acpHandlers) (*acpProcess, error) {
	cmd := exec.Command(spec.executable, spec.args...)
	cmd.Env = spec.env
	cmd.Dir = spec.dir
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	stderr := &tailBuffer{limit: acpStderrTailBytes}
	cmd.Stderr = stderr
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("无法启动 Antigravity CLI：%w", err)
	}
	process := &acpProcess{cmd: cmd, stdin: stdin, pending: map[int64]chan rpcReply{}, handlers: handlers, stderr: stderr, done: make(chan struct{})}
	go process.readLoop(stdout)
	return process, nil
}

func (p *acpProcess) readLoop(stdout io.Reader) {
	reader := bufio.NewReaderSize(stdout, 1<<20)
	for {
		line, err := readLimitedLine(reader, acpMaxLineBytes)
		if len(bytes.TrimSpace(line)) > 0 {
			p.dispatch(line)
		}
		if err != nil {
			break
		}
	}
	p.waitErr = p.cmd.Wait()
	p.failPending(&rpcError{Code: -32603, Message: p.exitMessage()})
	close(p.done)
}

func (p *acpProcess) failPending(failure *rpcError) {
	p.mu.Lock()
	defer p.mu.Unlock()
	for id, reply := range p.pending {
		reply <- rpcReply{err: failure}
		delete(p.pending, id)
	}
}

func (p *acpProcess) exitMessage() string {
	tail := strings.TrimSpace(p.stderr.String())
	if tail == "" {
		return "Antigravity CLI 已退出"
	}
	lines := strings.Split(tail, "\n")
	return "Antigravity CLI 已退出：" + strings.TrimSpace(lines[len(lines)-1])
}

func (p *acpProcess) dispatch(line []byte) {
	var envelope rpcEnvelope
	if err := json.Unmarshal(line, &envelope); err != nil {
		// 未登录时 authenticate 会在标准输出打印登录链接并等待回调；画布只在登录面板里登录，这里直接按未登录结束。
		if strings.HasPrefix(strings.TrimSpace(string(line)), acpSignInLinkPrefix) {
			p.failPending(&rpcError{Code: acpAuthRequiredCode, Message: "Authentication required"})
		}
		return
	}
	switch {
	case envelope.Method != "" && len(envelope.ID) > 0:
		go p.answer(envelope)
	case envelope.Method != "":
		if p.handlers.notification != nil {
			p.handlers.notification(envelope.Method, envelope.Params)
		}
	case len(envelope.ID) > 0:
		var id int64
		if err := json.Unmarshal(envelope.ID, &id); err != nil {
			return
		}
		p.mu.Lock()
		reply, ok := p.pending[id]
		delete(p.pending, id)
		p.mu.Unlock()
		if ok {
			reply <- rpcReply{result: envelope.Result, err: envelope.Error}
		}
	}
}

func (p *acpProcess) answer(request rpcEnvelope) {
	var result any
	var failure *rpcError
	if p.handlers.request == nil {
		failure = &rpcError{Code: acpMethodNotFound, Message: "method not supported by client"}
	} else {
		result, failure = p.handlers.request(request.Method, request.Params)
	}
	response := map[string]any{"jsonrpc": "2.0", "id": request.ID}
	if failure != nil {
		response["error"] = failure
	} else {
		response["result"] = result
	}
	_ = p.write(response)
}

func (p *acpProcess) write(message any) error {
	data, err := json.Marshal(message)
	if err != nil {
		return err
	}
	p.writeMu.Lock()
	defer p.writeMu.Unlock()
	_, err = p.stdin.Write(append(data, '\n'))
	return err
}

// call 发送请求并等待响应；上下文结束时立即返回，由调用方关闭进程。
func (p *acpProcess) call(ctx context.Context, method string, params any, out any) error {
	id := p.nextID.Add(1)
	reply := make(chan rpcReply, 1)
	p.mu.Lock()
	p.pending[id] = reply
	p.mu.Unlock()
	if err := p.write(map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params}); err != nil {
		p.mu.Lock()
		delete(p.pending, id)
		p.mu.Unlock()
		return fmt.Errorf("无法向 Antigravity CLI 发送 %s：%w", method, err)
	}
	select {
	case <-ctx.Done():
		p.mu.Lock()
		delete(p.pending, id)
		p.mu.Unlock()
		return ctx.Err()
	case result := <-reply:
		if result.err != nil {
			if result.err.Code == acpAuthRequiredCode || strings.HasPrefix(result.err.Message, acpNoBrowserPrefix) {
				return ErrSignInRequired
			}
			return result.err
		}
		if out == nil || len(result.result) == 0 {
			return nil
		}
		if err := json.Unmarshal(result.result, out); err != nil {
			return fmt.Errorf("Antigravity %s 响应格式无效：%w", method, err)
		}
		return nil
	}
}

func (p *acpProcess) notify(method string, params any) error {
	return p.write(map[string]any{"jsonrpc": "2.0", "method": method, "params": params})
}

func (p *acpProcess) close() {
	_ = p.stdin.Close()
	if p.cmd.Process != nil {
		_ = p.cmd.Process.Signal(os.Kill)
	}
	<-p.done
}

func readLimitedLine(reader *bufio.Reader, limit int) ([]byte, error) {
	var line []byte
	for {
		chunk, isPrefix, err := reader.ReadLine()
		line = append(line, chunk...)
		if len(line) > limit {
			return nil, errors.New("Antigravity CLI 输出的协议行过长")
		}
		if err != nil || !isPrefix {
			return line, err
		}
	}
}

type tailBuffer struct {
	mu    sync.Mutex
	limit int
	data  []byte
}

func (b *tailBuffer) Write(chunk []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.data = append(b.data, chunk...)
	if len(b.data) > b.limit {
		b.data = b.data[len(b.data)-b.limit:]
	}
	return len(chunk), nil
}

func (b *tailBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return string(b.data)
}

// ACP 结构只声明画布用到的字段。

type initializeResult struct {
	ProtocolVersion   int `json:"protocolVersion"`
	AgentCapabilities struct {
		PromptCapabilities struct {
			Image bool `json:"image"`
		} `json:"promptCapabilities"`
		MCPCapabilities struct {
			HTTP bool `json:"http"`
		} `json:"mcpCapabilities"`
		Auth struct {
			Logout *struct{} `json:"logout"`
		} `json:"auth"`
		Meta struct {
			Antigravity struct {
				SystemPrompt struct {
					Append bool `json:"append"`
				} `json:"systemPrompt"`
			} `json:"antigravity"`
		} `json:"_meta"`
	} `json:"agentCapabilities"`
	AgentInfo struct {
		Name    string `json:"name"`
		Version string `json:"version"`
	} `json:"agentInfo"`
	AuthMethods []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"authMethods"`
}

type configOptionValue struct {
	Value       string `json:"value"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

type configOptionEntry struct {
	configOptionValue
	Group   string              `json:"group"`
	Options []configOptionValue `json:"options"`
}

type configOption struct {
	ID           string              `json:"id"`
	Name         string              `json:"name"`
	Category     string              `json:"category"`
	Type         string              `json:"type"`
	CurrentValue string              `json:"currentValue"`
	Options      []configOptionEntry `json:"options"`
}

// values 展开分组后的可选值。
func (o configOption) values() []configOptionValue {
	result := make([]configOptionValue, 0, len(o.Options))
	for _, entry := range o.Options {
		if entry.Value != "" {
			result = append(result, entry.configOptionValue)
			continue
		}
		result = append(result, entry.Options...)
	}
	return result
}

type newSessionResult struct {
	SessionID     string         `json:"sessionId"`
	ConfigOptions []configOption `json:"configOptions"`
}

func (r newSessionResult) option(id string) (configOption, bool) {
	for _, option := range r.ConfigOptions {
		if option.ID == id {
			return option, true
		}
	}
	return configOption{}, false
}

type promptResult struct {
	StopReason string `json:"stopReason"`
	Usage      *Usage `json:"usage"`
}

// Usage 是 ACP session/prompt 响应里的用量（agy 提供时才有）。
type Usage struct {
	InputTokens       int64 `json:"inputTokens"`
	OutputTokens      int64 `json:"outputTokens"`
	TotalTokens       int64 `json:"totalTokens"`
	ThoughtTokens     int64 `json:"thoughtTokens"`
	CachedReadTokens  int64 `json:"cachedReadTokens"`
	CachedWriteTokens int64 `json:"cachedWriteTokens"`
}

type sessionUpdateNotification struct {
	SessionID string `json:"sessionId"`
	Update    struct {
		SessionUpdate string          `json:"sessionUpdate"`
		Content       json.RawMessage `json:"content"`
		ToolCallID    string          `json:"toolCallId"`
		Title         string          `json:"title"`
		Kind          string          `json:"kind"`
		Status        string          `json:"status"`
		RawInput      json.RawMessage `json:"rawInput"`
	} `json:"update"`
}

type textContent struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type permissionRequest struct {
	SessionID string `json:"sessionId"`
	ToolCall  struct {
		ToolCallID string          `json:"toolCallId"`
		Title      string          `json:"title"`
		Kind       string          `json:"kind"`
		RawInput   json.RawMessage `json:"rawInput"`
	} `json:"toolCall"`
	Options []struct {
		OptionID string `json:"optionId"`
		Name     string `json:"name"`
		Kind     string `json:"kind"`
	} `json:"options"`
}

// permissionOutcome 选出给定种类的选项；没有该种类时按取消回复。
func permissionOutcome(request permissionRequest, kind string) map[string]any {
	for _, option := range request.Options {
		if option.Kind == kind {
			return map[string]any{"outcome": map[string]any{"outcome": acpPermissionPicked, "optionId": option.OptionID}}
		}
	}
	return map[string]any{"outcome": map[string]any{"outcome": acpPermissionCancel}}
}
