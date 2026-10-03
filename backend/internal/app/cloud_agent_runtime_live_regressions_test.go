package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"strings"
	"sync"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
)

// 这组测试逐条复现线上日志里的失败，使用真实 Node 运行时 + 流式 SSE 模拟上游：
//  1. 首步调用 recall_lessons，工具结果被当成 "null" 交回模型 → 上游空回复。
//  2. 工具表里 12 个 canvas_* 重名 → xAI 返回 400。
//  3. 上游偶发 500 → 必须自动重试，而不是整轮失败。
//  4. 推理增量逐 token 流式到达时空格被吃掉。

type liveUpstreamCall struct {
	body map[string]any
}

type liveUpstream struct {
	mu      sync.Mutex
	calls   []liveUpstreamCall
	handler func(call int, body map[string]any, w http.ResponseWriter)
}

func (u *liveUpstream) record(body map[string]any) int {
	u.mu.Lock()
	defer u.mu.Unlock()
	u.calls = append(u.calls, liveUpstreamCall{body: body})
	return len(u.calls)
}

func (u *liveUpstream) snapshot() []liveUpstreamCall {
	u.mu.Lock()
	defer u.mu.Unlock()
	return append([]liveUpstreamCall(nil), u.calls...)
}

func writeSSE(w http.ResponseWriter, chunks ...map[string]any) {
	w.Header().Set("Content-Type", "text/event-stream")
	for _, chunk := range chunks {
		raw, _ := json.Marshal(chunk)
		_, _ = fmt.Fprintf(w, "data: %s\n\n", raw)
	}
	_, _ = fmt.Fprint(w, "data: [DONE]\n\n")
}

func sseDelta(delta map[string]any) map[string]any {
	return map[string]any{"choices": []any{map[string]any{"index": 0, "delta": delta}}}
}

func startLiveAgentService(t *testing.T, upstream *liveUpstream, permissionMode string) (*Service, string) {
	t.Helper()
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node is not installed")
	}
	if _, err := agentRuntimeDirForTest(); err != nil {
		t.Skip(err.Error())
	}
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	t.Setenv("REDIS_URL", "")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode upstream body: %v", err)
		}
		upstream.handler(upstream.record(body), body, w)
	}))
	t.Cleanup(server.Close)

	s, db, _, _ := creationTestService(t)
	s = New(s.repo, s.dataDir)
	t.Cleanup(func() { _ = s.Close() })
	if err := db.Model(&model.ModelChannel{}).Where("id = ?", "channel").Updates(map[string]any{"base_url": server.URL, "api_key": "test-only"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: `{"nodes":[]}`}).Error; err != nil {
		t.Fatal(err)
	}
	stop := make(chan struct{})
	t.Cleanup(func() { close(stop) })
	go func() {
		for {
			select {
			case <-stop:
				return
			default:
			}
			_ = s.ProcessNextTask()
			time.Sleep(20 * time.Millisecond)
		}
	}()
	req := agentTestRequest()
	if permissionMode != "" {
		req.PermissionMode = permissionMode
	}
	run, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	return s, run.ID
}

func waitLiveAgentTerminal(t *testing.T, s *Service, runID string) *model.CloudAgentExecution {
	t.Helper()
	deadline := time.Now().Add(90 * time.Second)
	for time.Now().Before(deadline) {
		execution, err := s.repo.CloudAgent("user", runID)
		if err != nil {
			t.Fatal(err)
		}
		if cloudAgentRunTerminal(execution.Status) {
			return execution
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatal("run did not reach a terminal state")
	return nil
}

func upstreamToolNames(body map[string]any) []string {
	names := []string{}
	tools, _ := body["tools"].([]any)
	for _, value := range tools {
		tool, _ := value.(map[string]any)
		fn, _ := tool["function"].(map[string]any)
		names = append(names, stringField(fn, "name"))
	}
	return names
}

func upstreamToolMessages(body map[string]any) []map[string]any {
	result := []map[string]any{}
	messages, _ := body["messages"].([]any)
	for _, value := range messages {
		message, _ := value.(map[string]any)
		if stringField(message, "role") == "tool" {
			result = append(result, message)
		}
	}
	return result
}

func TestCloudAgentLiveRecallLessonsStreamingRoundTrip(t *testing.T) {
	upstream := &liveUpstream{}
	upstream.handler = func(call int, body map[string]any, w http.ResponseWriter) {
		if call == 1 {
			writeSSE(w,
				sseDelta(map[string]any{"role": "assistant"}),
				sseDelta(map[string]any{"reasoning_content": "The"}),
				sseDelta(map[string]any{"reasoning_content": " user"}),
				sseDelta(map[string]any{"reasoning_content": " said hello"}),
				sseDelta(map[string]any{"tool_calls": []any{map[string]any{"index": 0, "id": "call-recall", "type": "function", "function": map[string]any{"name": "recall_lessons", "arguments": ""}}}}),
				sseDelta(map[string]any{"tool_calls": []any{map[string]any{"index": 0, "function": map[string]any{"arguments": `{"topic":"用户称呼偏好"}`}}}}),
			)
			return
		}
		writeSSE(w, sseDelta(map[string]any{"content": "你好，"}), sseDelta(map[string]any{"content": "有什么可以帮你？"}))
	}
	s, runID := startLiveAgentService(t, upstream, "")
	execution := waitLiveAgentTerminal(t, s, runID)
	calls := upstream.snapshot()
	if execution.Status != "completed" {
		t.Fatalf("status=%s failure=%q calls=%d", execution.Status, execution.FailureMessage, len(calls))
	}
	if len(calls) != 2 {
		t.Fatalf("expected 2 upstream calls, got %d", len(calls))
	}
	for i, call := range calls {
		seen := map[string]bool{}
		for _, name := range upstreamToolNames(call.body) {
			if seen[name] {
				t.Fatalf("call %d sent duplicate tool %q", i+1, name)
			}
			seen[name] = true
		}
	}
	results := upstreamToolMessages(calls[1].body)
	if len(results) != 1 {
		t.Fatalf("second call should carry one tool result: %#v", results)
	}
	content := strings.TrimSpace(stringField(results[0], "content"))
	if content == "" || content == "null" {
		t.Fatalf("tool result sent to model is empty: %q", content)
	}
	full, err := s.CloudAgentRun("user", runID)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(full.Events)
	if !strings.Contains(string(raw), "The user said hello") {
		t.Fatalf("reasoning lost its spaces: %s", raw)
	}
	if !strings.Contains(string(raw), "你好，有什么可以帮你？") {
		t.Fatalf("final reply missing: %s", raw)
	}
}

func TestCloudAgentLiveRetriesConfirmedRateLimitRejection(t *testing.T) {
	upstream := &liveUpstream{}
	upstream.handler = func(call int, body map[string]any, w http.ResponseWriter) {
		if call <= 2 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(`{"error":{"message":"Upstream gateway error","type":"api_error"}}`))
			return
		}
		writeSSE(w, sseDelta(map[string]any{"content": "重试后成功"}))
	}
	s, runID := startLiveAgentService(t, upstream, "")
	execution := waitLiveAgentTerminal(t, s, runID)
	if execution.Status != "completed" {
		t.Fatalf("confirmed 429 rejection was not retried: status=%s failure=%q", execution.Status, execution.FailureMessage)
	}
	if calls := len(upstream.snapshot()); calls != 3 {
		t.Fatalf("expected 2 failures + 1 success, got %d upstream calls", calls)
	}
}

func TestCloudAgentLiveDoesNotRetryUnknownGatewayFailure(t *testing.T) {
	upstream := &liveUpstream{}
	upstream.handler = func(_ int, _ map[string]any, w http.ResponseWriter) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":{"message":"Upstream gateway error","type":"api_error"}}`))
	}
	s, runID := startLiveAgentService(t, upstream, "")
	execution := waitLiveAgentTerminal(t, s, runID)
	if execution.Status != "failed" || len(upstream.snapshot()) != 1 {
		t.Fatalf("unknown submission retried: status=%s calls=%d", execution.Status, len(upstream.snapshot()))
	}
}

func TestCloudAgentLiveDoesNotRetryRejectedRequest(t *testing.T) {
	upstream := &liveUpstream{}
	upstream.handler = func(call int, body map[string]any, w http.ResponseWriter) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":{"message":"bad request","type":"invalid_request_error"}}`))
	}
	s, runID := startLiveAgentService(t, upstream, "")
	execution := waitLiveAgentTerminal(t, s, runID)
	if execution.Status != "failed" {
		t.Fatalf("expected failure, got %s", execution.Status)
	}
	if calls := len(upstream.snapshot()); calls != 1 {
		t.Fatalf("400 must not be retried, got %d upstream calls", calls)
	}
	if strings.Contains(strings.ToLower(execution.FailureMessage), "pi ") {
		t.Fatalf("failure message exposes runtime name: %q", execution.FailureMessage)
	}
}
