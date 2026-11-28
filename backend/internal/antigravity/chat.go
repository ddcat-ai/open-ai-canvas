package antigravity

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
)

// 每次模型调用都是一个新的 agy 会话：对话历史按文本转写进提示词，与无状态的 Chat Completions 一致。
// 画布工具经本机 MCP 工具桥交给 agy；agy 一发起调用就取消本轮，把调用交还画布执行。
const cancelGrace = 10 * time.Second

const (
	toolPolicy = "You are serving the Yingce canvas. The only tools you may use are the MCP tools of the \"yingce\" server. " +
		"Do not read or write files, run commands, browse the web, or ask for permission. When an action is needed, call the matching yingce tool; " +
		"the canvas executes it and returns the result in the next turn."
	textPolicy       = "Answer directly using only the input provided. Do not use tools, read or write files, run commands, or ask questions."
	transcriptHeader = "The conversation so far is below. Earlier tool calls have already been executed and their results are included. Continue as the assistant from the last message."
)

// Part 是消息中的一个内容块：文本、内嵌图片（base64）或远程素材地址，三者取其一。
type Part struct {
	Text      string
	ImageMIME string
	ImageData string
	URL       string
}

// Turn 是一条对话消息。Role 为 user、assistant 或 tool。
type Turn struct {
	Role       string
	Parts      []Part
	ToolCalls  []ToolCall
	ToolCallID string
}

type CompletionRequest struct {
	Model        string
	SystemPrompt string
	Turns        []Turn
	Tools        []Tool
	OnText       func(string)
	OnReasoning  func(string)
}

type CompletionResult struct {
	Text       string
	Reasoning  string
	ToolCalls  []ToolCall
	StopReason string
	Usage      *Usage
}

type promptOutcome struct {
	result promptResult
	err    error
}

// Complete 用渠道的 agy 资料目录完成一次模型调用。
func (m *Manager) Complete(ctx context.Context, profile Profile, request CompletionRequest) (CompletionResult, error) {
	var result CompletionResult
	if strings.TrimSpace(request.Model) == "" {
		return result, errors.New("Antigravity 调用缺少模型")
	}
	if len(request.Turns) == 0 {
		return result, errors.New("Antigravity 调用缺少对话内容")
	}
	mcpServers := []map[string]any{}
	var bridge *toolBridge
	if len(request.Tools) > 0 {
		var err error
		bridge, err = newToolBridge(request.Tools)
		if err != nil {
			return result, err
		}
		defer bridge.close()
		mcpServers = append(mcpServers, bridge.mcpServer())
	}
	collector := &completionCollector{onText: request.OnText, onReasoning: request.OnReasoning}
	handlers := acpHandlers{
		notification: func(method string, params json.RawMessage) {
			if method == acpSessionUpdate {
				collector.update(params)
			}
		},
		request: func(method string, params json.RawMessage) (any, *rpcError) {
			if method != acpRequestPermission {
				return nil, &rpcError{Code: acpMethodNotFound, Message: "method not supported by client"}
			}
			var permission permissionRequest
			_ = json.Unmarshal(params, &permission)
			if bridge != nil && isBridgeTool(permission) {
				return permissionOutcome(permission, acpPermissionAllow), nil
			}
			return permissionOutcome(permission, acpPermissionReject), nil
		},
	}
	policy := textPolicy
	if bridge != nil {
		policy = toolPolicy
	}
	system := strings.TrimSpace(policy + "\n\n" + strings.TrimSpace(request.SystemPrompt))
	current, err := m.openSession(ctx, profile, sessionOptions{mcpServers: mcpServers, systemPrompt: system, handlers: handlers})
	if err != nil {
		return result, err
	}
	defer current.close()
	if err := current.selectModel(ctx, request.Model); err != nil {
		return result, err
	}
	inlineSystem := ""
	if !current.appendsSystemPrompt() {
		inlineSystem = system
	}
	blocks := renderPrompt(request.Turns, inlineSystem, current.init.AgentCapabilities.PromptCapabilities.Image)
	done := make(chan promptOutcome, 1)
	go func() {
		var prompt promptResult
		err := current.process.call(ctx, "session/prompt", map[string]any{"sessionId": current.created.SessionID, "prompt": blocks}, &prompt)
		done <- promptOutcome{result: prompt, err: err}
	}()
	var called <-chan struct{}
	if bridge != nil {
		called = bridge.called
	}
	var outcome promptOutcome
	select {
	case outcome = <-done:
	case <-called:
		_ = current.process.notify("session/cancel", map[string]any{"sessionId": current.created.SessionID})
		select {
		case outcome = <-done:
		case <-time.After(cancelGrace):
		}
	}
	if ctx.Err() != nil {
		return result, ctx.Err()
	}
	result.Text, result.Reasoning = collector.values()
	if bridge != nil {
		result.ToolCalls = bridge.recordedCalls()
	}
	if len(result.ToolCalls) > 0 {
		// 是画布主动取消的本轮，取消响应里的错误不影响已拿到的工具调用。
		result.StopReason = "tool_use"
		result.Usage = outcome.result.Usage
		return result, nil
	}
	if outcome.err != nil {
		return result, outcome.err
	}
	result.StopReason = outcome.result.StopReason
	result.Usage = outcome.result.Usage
	switch result.StopReason {
	case "refusal":
		return result, errors.New("Antigravity 拒绝了本次请求")
	case "cancelled":
		return result, errors.New("Antigravity 取消了本次请求")
	}
	if strings.TrimSpace(result.Text) == "" {
		return result, fmt.Errorf("Antigravity 没有返回内容（%s）", firstNonEmpty(result.StopReason, "无结束原因"))
	}
	return result, nil
}

// isBridgeTool 判断授权请求是否针对画布工具桥；agy 对 MCP 工具的标题形如 "Run mcp_yingce_<tool>"。
func isBridgeTool(request permissionRequest) bool {
	var raw struct {
		ServerName string `json:"ServerName"`
	}
	_ = json.Unmarshal(request.ToolCall.RawInput, &raw)
	if raw.ServerName == mcpServerName {
		return true
	}
	title := strings.TrimSpace(request.ToolCall.Title)
	return strings.HasPrefix(title, "Run mcp_"+mcpServerName+"_") || strings.HasPrefix(title, "mcp_"+mcpServerName+"_")
}

type completionCollector struct {
	mu          sync.Mutex
	text        strings.Builder
	reasoning   strings.Builder
	onText      func(string)
	onReasoning func(string)
}

func (c *completionCollector) update(params json.RawMessage) {
	var notification sessionUpdateNotification
	if err := json.Unmarshal(params, &notification); err != nil {
		return
	}
	kind := notification.Update.SessionUpdate
	if kind != "agent_message_chunk" && kind != "agent_thought_chunk" {
		return
	}
	var content textContent
	if err := json.Unmarshal(notification.Update.Content, &content); err != nil || content.Type != "text" || content.Text == "" {
		return
	}
	c.mu.Lock()
	if kind == "agent_message_chunk" {
		c.text.WriteString(content.Text)
	} else {
		c.reasoning.WriteString(content.Text)
	}
	c.mu.Unlock()
	if kind == "agent_message_chunk" && c.onText != nil {
		c.onText(content.Text)
	}
	if kind == "agent_thought_chunk" && c.onReasoning != nil {
		c.onReasoning(content.Text)
	}
}

func (c *completionCollector) values() (string, string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return strings.TrimSpace(c.text.String()), strings.TrimSpace(c.reasoning.String())
}

// promptBuilder 合并相邻文本，遇到图片或素材链接时另起内容块。
type promptBuilder struct {
	blocks []map[string]any
	text   strings.Builder
	images bool
}

func (b *promptBuilder) writeText(value string) {
	b.text.WriteString(value)
}

func (b *promptBuilder) flush() {
	if b.text.Len() > 0 {
		b.blocks = append(b.blocks, map[string]any{"type": "text", "text": b.text.String()})
		b.text.Reset()
	}
}

func (b *promptBuilder) writePart(part Part) {
	switch {
	case part.ImageData != "" && b.images:
		b.flush()
		b.blocks = append(b.blocks, map[string]any{"type": "image", "mimeType": part.ImageMIME, "data": part.ImageData})
	case part.ImageData != "":
		b.writeText("[image omitted: this Antigravity version does not accept images]")
	case part.URL != "":
		b.flush()
		b.blocks = append(b.blocks, map[string]any{"type": "resource_link", "uri": part.URL, "name": part.URL})
	default:
		b.writeText(part.Text)
	}
}

func (b *promptBuilder) result() []map[string]any {
	b.flush()
	return b.blocks
}

// renderPrompt 把对话转写为一次 ACP prompt。只有一条用户消息时直接发送其内容。
func renderPrompt(turns []Turn, inlineSystem string, images bool) []map[string]any {
	builder := &promptBuilder{images: images}
	if inlineSystem != "" {
		builder.writeText("<system_instructions>\n" + inlineSystem + "\n</system_instructions>\n\n")
	}
	if len(turns) == 1 && turns[0].Role == "user" {
		for _, part := range turns[0].Parts {
			builder.writePart(part)
		}
		return builder.result()
	}
	builder.writeText(transcriptHeader + "\n\n<conversation>\n")
	for _, turn := range turns {
		switch turn.Role {
		case "tool":
			builder.writeText(fmt.Sprintf("<tool_result id=%q>\n", turn.ToolCallID))
			for _, part := range turn.Parts {
				builder.writePart(part)
			}
			builder.writeText("\n</tool_result>\n")
		default:
			builder.writeText("<" + turn.Role + ">\n")
			for _, part := range turn.Parts {
				builder.writePart(part)
			}
			for _, call := range turn.ToolCalls {
				builder.writeText(fmt.Sprintf("\n<tool_call id=%q name=%q>%s</tool_call>", call.ID, call.Name, call.Arguments))
			}
			builder.writeText("\n</" + turn.Role + ">\n")
		}
	}
	builder.writeText("</conversation>")
	return builder.result()
}
