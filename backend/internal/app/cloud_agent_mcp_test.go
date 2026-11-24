package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	agenttool "yingce/backend/internal/agent/tool"
	mcpintegration "yingce/backend/internal/integrations/mcp"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/platform"
	"yingce/backend/internal/repository"
)

type mcpTestServer struct {
	url         string
	credential  string
	requests    atomic.Int64
	calls       atomic.Int64
	failedCalls atomic.Int64
	failCall    atomic.Bool
	blockCall   atomic.Bool
	callStarted chan struct{}
	releaseCall chan struct{}
}

func newAgentMCPTestServer(t *testing.T) *mcpTestServer {
	t.Helper()
	t.Setenv("CANVAS_MCP_ALLOWED_PRIVATE_HOSTS", "127.0.0.1")
	remote := &mcpTestServer{credential: "mcp-test-" + strings.Repeat("a", 24), callStarted: make(chan struct{}, 1), releaseCall: make(chan struct{})}
	server := mcp.NewServer(&mcp.Implementation{Name: "yingce-test", Version: "1"}, nil)
	server.AddTool(&mcp.Tool{
		Name: "record_note", Description: "Record a test note",
		InputSchema: map[string]any{"type": "object", "properties": map[string]any{"text": map[string]any{"type": "string"}}, "required": []string{"text"}, "additionalProperties": false},
		// The external readOnly hint must never bypass host approval.
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true},
	}, func(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		remote.calls.Add(1)
		if remote.blockCall.Load() {
			remote.callStarted <- struct{}{}
			select {
			case <-remote.releaseCall:
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}
		return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: "recorded: " + string(req.Params.Arguments) + " " + remote.credential}}}, nil
	})
	handler := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return server }, nil)
	httpServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		remote.requests.Add(1)
		if r.Header.Get("Authorization") != "Bearer "+remote.credential {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if r.Method == http.MethodPost {
			body, err := io.ReadAll(r.Body)
			if err != nil {
				http.Error(w, "invalid request", http.StatusBadRequest)
				return
			}
			r.Body = io.NopCloser(bytes.NewReader(body))
			var request struct {
				Method string `json:"method"`
			}
			_ = json.Unmarshal(body, &request)
			if request.Method == "tools/call" && remote.failCall.Load() {
				remote.failedCalls.Add(1)
				http.Error(w, "remote result unavailable", http.StatusBadGateway)
				return
			}
		}
		handler.ServeHTTP(w, r)
	}))
	t.Cleanup(httpServer.Close)
	remote.url = httpServer.URL
	return remote
}

func enabledAgentMCPConnection(t *testing.T, s *Service, remote *mcpTestServer, actor *model.User, platform bool, templateID string) MCPConnectionView {
	t.Helper()
	if s.coordinator == nil {
		s.coordinator = newMCPTestCoordinator()
	}
	input := MCPConnectionInput{Name: "测试连接", TemplateID: templateID, Transport: "streamable_http", ServerURL: remote.url, Parameters: map[string]string{"token": remote.credential}}
	view, err := s.SaveMCPConnection(actor, "", platform, input)
	if err != nil {
		t.Fatal(err)
	}
	view, err = s.TestMCPConnection(t.Context(), actor, view.ID, platform)
	if err != nil {
		t.Fatal(err)
	}
	if len(view.Tools) != 1 || view.Enabled || len(view.AllowedTools) != 0 {
		t.Fatalf("discovery must require an explicit grant: %+v", view)
	}
	input.Enabled, input.AllowedTools, input.Parameters = true, []string{"record_note"}, map[string]string{}
	if platform {
		input.AllowedUserIDs = []string{"user"}
		input.ToolPolicies = map[string]map[string]any{"record_note": {"type": "object"}}
	}
	view, err = s.SaveMCPConnection(actor, view.ID, platform, input)
	if err != nil {
		t.Fatal(err)
	}
	return view
}

func newMCPTestCoordinator() *platform.Coordinator {
	return platform.NewCoordinatorWithRedis(nil, "mcp-test")
}

func agentMCPToolCall(t *testing.T, view MCPConnectionView, callID, text string) cloudAgentCall {
	t.Helper()
	args, err := json.Marshal(mcpintegration.ToolCall{ConnectionID: view.ID, Revision: view.Revision, ToolName: "record_note", Arguments: map[string]any{"text": text}})
	if err != nil {
		t.Fatal(err)
	}
	call := cloudAgentCall{ID: callID}
	call.Function.Name, call.Function.Arguments = "mcp_call_tool", string(args)
	return call
}

func approvedAgentMCPState(t *testing.T, s *Service, call cloudAgentCall) *cloudAgentRuntime {
	t.Helper()
	s.legacyCloudAgentRootTask = false
	req := unboundAgentTestRequest("mcp-" + call.ID)
	req.PermissionMode = "auto"
	run, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	return persistApprovedAgentMCPCall(t, s, run.ID, call)
}

func persistApprovedAgentMCPCall(t *testing.T, s *Service, runID string, call cloudAgentCall) *cloudAgentRuntime {
	t.Helper()
	run, state := agentInterjectionState(t, s, runID)
	state.Calls, state.CallIndex, state.Approval, state.ActiveTaskID = []cloudAgentCall{call}, 0, nil, ""
	state.Step++
	if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		current.Status = "running"
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	run, state = agentInterjectionState(t, s, runID)
	if err := s.advanceCloudAgentTool(run, &state); err != nil {
		t.Fatal(err)
	}
	run, state = agentInterjectionState(t, s, runID)
	if run.Status != "waiting_approval" || state.Approval == nil || state.Approval.Decision != "" {
		t.Fatalf("MCP fixture did not request approval: status=%s approval=%+v", run.Status, state.Approval)
	}
	// Keep the approved call pending, as when another worker owns its follow-up.
	// The public decision path still validates and persists the exact approval.
	key := cloudAgentApprovalFollowUpKey(runID, state.Approval.ID)
	if !s.claimCloudAgentApprovalFollowUp(key) {
		t.Fatal("MCP approval follow-up was already claimed")
	}
	defer s.releaseCloudAgentApprovalFollowUp(key)
	if err := s.DecideCloudAgentApproval("user", runID, state.Approval.ID, "approve", ""); err != nil {
		t.Fatal(err)
	}
	run, state = agentInterjectionState(t, s, runID)
	if state.Approval == nil || !cloudAgentApprovedCallPending(run, &state, state.Approval.ID) || !cloudAgentMCPCallApproved(&state, call) {
		t.Fatal("MCP fixture did not durably approve the pending call")
	}
	return &state
}

func assertMCPErrorStatus(t *testing.T, err error, status int) {
	t.Helper()
	var appErr *kernel.AppError
	if !errors.As(err, &appErr) || appErr.Status != status {
		t.Fatalf("expected status %d, got %v", status, err)
	}
}

func TestMCPToolPolicyRequiresApprovalWithoutCanvas(t *testing.T) {
	for _, mode := range []string{"auto", "request_approval"} {
		req := CloudAgentRequest{PermissionMode: mode}
		if !cloudAgentToolAllowed(req, agenttool.MCPCallTool) || !agenttool.Of(agenttool.MCPCallTool).ApprovalRequired(mode) {
			t.Fatalf("platform conversation MCP call must be available and require approval in %s", mode)
		}
	}
	readOnly := CloudAgentRequest{PermissionMode: "read_only", MemoryMode: "auto"}
	if cloudAgentToolAllowed(readOnly, agenttool.MCPCallTool) || !cloudAgentToolAllowed(readOnly, agenttool.MCPListTools) || !cloudAgentToolAllowed(readOnly, agenttool.MemorySearch) {
		t.Fatal("read-only Agent should discover MCP and recall memory without exposing external execution")
	}
	readOnly.MemoryMode = "off"
	if cloudAgentToolAllowed(readOnly, agenttool.MemorySearch) {
		t.Fatal("disabled memory must hide history retrieval")
	}
}

func TestMCPConnectionOwnerPlatformAuthorityAndSecretStorage(t *testing.T) {
	remote := newAgentMCPTestServer(t)
	s, _, _, _ := creationTestService(t)
	user := &model.User{ID: "user", Role: model.UserRoleUser}
	other := &model.User{ID: "other", Role: model.UserRoleUser}
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	view := enabledAgentMCPConnection(t, s, remote, user, false, "")
	for _, level := range []struct {
		connectionID string
		toolName     string
		toolCount    int
		wantSchema   bool
	}{
		{"", "", 0, false},
		{view.ID, "", 1, false},
		{view.ID, "record_note", 1, true},
	} {
		available, err := s.mcpDomain().AvailableTools("user", level.connectionID, level.toolName)
		if err != nil || len(available) != 1 || available[0].ToolCount != 1 || len(available[0].Tools) != level.toolCount {
			t.Fatalf("invalid progressive tool discovery: %+v err=%v", available, err)
		}
		if level.toolCount > 0 && (available[0].Tools[0].InputSchema != nil) != level.wantSchema {
			t.Fatal("remote tool schemas must appear only after requesting a specific tool")
		}
	}
	row, err := s.repo.MCPConnection(view.ID)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(row.ParametersCiphertext, remote.credential) || view.Parameters["token"] != "" || len(view.ConfiguredSecrets) != 1 {
		t.Fatal("connection secrets must be encrypted at rest and redacted from settings")
	}
	input := MCPConnectionInput{Name: "other", Transport: "streamable_http", ServerURL: remote.url}
	_, err = s.SaveMCPConnection(other, view.ID, false, input)
	assertMCPErrorStatus(t, err, http.StatusNotFound)
	_, err = s.TestMCPConnection(t.Context(), other, view.ID, false)
	assertMCPErrorStatus(t, err, http.StatusNotFound)
	assertMCPErrorStatus(t, s.DeleteMCPConnection(other, view.ID, false), http.StatusNotFound)
	_, err = s.SaveMCPConnection(user, "", true, input)
	assertMCPErrorStatus(t, err, http.StatusForbidden)
	platform := enabledAgentMCPConnection(t, s, remote, admin, true, "")
	views, err := s.MCPConnections(other, false)
	if err != nil || len(views) != 0 {
		t.Fatalf("ungranted users must not see platform or other users' connections: %+v err=%v", views, err)
	}
	_, err = mcpintegration.AuthorizeCall(s.repo, "other", mcpintegration.ToolCall{ConnectionID: platform.ID, Revision: platform.Revision, ToolName: "record_note", Arguments: map[string]any{"text": "hello"}})
	assertMCPErrorStatus(t, err, http.StatusNotFound)
	assertMCPErrorStatus(t, s.DeleteMCPConnection(user, platform.ID, false), http.StatusNotFound)
}

func TestMCPApprovalGateAndDurableReplayUseRealTransport(t *testing.T) {
	remote := newAgentMCPTestServer(t)
	s, db, _, _ := creationTestService(t)
	view := enabledAgentMCPConnection(t, s, remote, &model.User{ID: "user", Role: model.UserRoleUser}, false, "")
	call := agentMCPToolCall(t, view, "mcp-call-once", "归拢反馈")
	approved := approvedAgentMCPState(t, s, call)
	before := remote.requests.Load()
	if preview, err := cloudAgentPreviewMCPCall(s.repo, "user", "", call); err != nil || preview.Kind != "mcp" {
		t.Fatalf("MCP preview failed: %+v %v", preview, err)
	}
	for _, scenario := range []string{"no_approval", "read_only", "wrong_hash", "different_arguments"} {
		t.Run(scenario, func(t *testing.T) {
			state := *approved
			approval := *approved.Approval
			state.Approval = &approval
			switch scenario {
			case "no_approval":
				state.Approval = nil
			case "read_only":
				state.Request.PermissionMode = "read_only"
			case "wrong_hash":
				state.Approval.CallHash = "different"
			case "different_arguments":
				state.Approval.Call = agentMCPToolCall(t, view, call.ID, "不同参数")
			}
			_, err := cloudAgentHandleMCPCall(s.repo, "user", &state, call, s)
			assertMCPErrorStatus(t, err, http.StatusForbidden)
		})
	}
	if remote.requests.Load() != before || remote.calls.Load() != 0 {
		t.Fatal("preview or rejected approval caused external IO")
	}
	state := approved
	first, err := cloudAgentHandleMCPCall(s.repo, "user", state, call, s)
	if err != nil || remote.calls.Load() != 1 {
		t.Fatalf("approved call did not reach MCP: result=%+v calls=%d err=%v", first, remote.calls.Load(), err)
	}
	firstJSON, _ := json.Marshal(first)
	if strings.Contains(string(firstJSON), remote.credential) || !strings.Contains(string(firstJSON), "REDACTED") {
		t.Fatal("MCP result exposed the configured credential")
	}
	after := remote.requests.Load()
	replayed, err := cloudAgentHandleMCPCall(s.repo, "user", state, call, s)
	if err != nil || remote.calls.Load() != 1 || remote.requests.Load() != after {
		t.Fatalf("receipt replay performed another external call: %+v err=%v", replayed, err)
	}
	changed := agentMCPToolCall(t, view, call.ID, "替换参数")
	changedState := *state
	changedState.Approval = &cloudAgentApproval{ID: state.Approval.ID, Call: changed, CallHash: cloudAgentApprovalCallHash(changed), Decision: "approve"}
	_, err = cloudAgentHandleMCPCall(s.repo, "user", &changedState, changed, s)
	assertMCPErrorStatus(t, err, http.StatusConflict)
	var receipt model.MCPToolExecution
	if err := db.Where("user_id = ? AND run_id = ?", "user", state.RuntimeRunID).First(&receipt).Error; err != nil || receipt.Status != "completed" || strings.Contains(receipt.ResultJSON, remote.credential) {
		t.Fatalf("receipt missing or exposed secret: status=%q err=%v", receipt.Status, err)
	}
	actor := &model.User{ID: "user", Role: model.UserRoleUser}
	for _, action := range []string{"disable", "delete"} {
		t.Run("replay_after_"+action, func(t *testing.T) {
			if action == "disable" {
				_, err = s.SaveMCPConnection(actor, view.ID, false, MCPConnectionInput{Name: view.Name, Transport: view.Transport, ServerURL: view.ServerURL, AllowedTools: view.AllowedTools, Enabled: false})
			} else {
				err = s.DeleteMCPConnection(actor, view.ID, false)
			}
			if err != nil {
				t.Fatal(err)
			}
			result, err := cloudAgentHandleMCPCall(s.repo, "user", state, call, s)
			raw, _ := json.Marshal(result)
			if err != nil || !bytes.Equal(firstJSON, raw) || remote.calls.Load() != 1 || remote.requests.Load() != after {
				t.Fatalf("completed receipt was not replayed after %s: result=%s err=%v", action, raw, err)
			}
		})
	}
}

func TestMCPExecutionRevalidatesOwnerRevisionGrantAndSchema(t *testing.T) {
	remote := newAgentMCPTestServer(t)
	s, _, _, _ := creationTestService(t)
	actor := &model.User{ID: "user", Role: model.UserRoleUser}
	view := enabledAgentMCPConnection(t, s, remote, actor, false, "")
	valid := mcpintegration.ToolCall{ConnectionID: view.ID, Revision: view.Revision, ToolName: "record_note", Arguments: map[string]any{"text": "hello"}}
	before := remote.requests.Load()
	_, err := mcpintegration.AuthorizeCall(s.repo, "other", valid)
	assertMCPErrorStatus(t, err, http.StatusNotFound)
	for _, scenario := range []struct {
		name   string
		status int
		change func(*mcpintegration.ToolCall)
	}{
		{"stale_revision", http.StatusConflict, func(call *mcpintegration.ToolCall) { call.Revision-- }},
		{"ungranted_tool", http.StatusForbidden, func(call *mcpintegration.ToolCall) { call.ToolName = "delete_everything" }},
		{"missing_required", http.StatusBadRequest, func(call *mcpintegration.ToolCall) { call.Arguments = map[string]any{} }},
		{"wrong_type", http.StatusBadRequest, func(call *mcpintegration.ToolCall) { call.Arguments = map[string]any{"text": 42} }},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			call := valid
			scenario.change(&call)
			_, err := mcpintegration.AuthorizeCall(s.repo, "user", call)
			assertMCPErrorStatus(t, err, scenario.status)
		})
	}
	view, err = s.SaveMCPConnection(actor, view.ID, false, MCPConnectionInput{Name: view.Name, Transport: view.Transport, ServerURL: view.ServerURL, AllowedTools: view.AllowedTools, Enabled: false})
	if err != nil {
		t.Fatal(err)
	}
	valid.Revision = view.Revision
	_, err = mcpintegration.AuthorizeCall(s.repo, "user", valid)
	assertMCPErrorStatus(t, err, http.StatusForbidden)
	if remote.requests.Load() != before || remote.calls.Load() != 0 {
		t.Fatal("authorization or schema rejection caused external IO")
	}
}

func TestMCPUncertainExternalResultIsNotRetried(t *testing.T) {
	remote := newAgentMCPTestServer(t)
	s, db, _, _ := creationTestService(t)
	view := enabledAgentMCPConnection(t, s, remote, &model.User{ID: "user", Role: model.UserRoleUser}, false, "")
	remote.failCall.Store(true)
	call := agentMCPToolCall(t, view, "uncertain-call", "只允许尝试一次")
	state := approvedAgentMCPState(t, s, call)
	_, err := cloudAgentHandleMCPCall(s.repo, "user", state, call, s)
	assertMCPErrorStatus(t, err, http.StatusBadGateway)
	var uncertain *mcpintegration.UncertainExecutionError
	if !errors.As(err, &uncertain) {
		t.Fatalf("external failure lost its non-retryable execution marker: %v", err)
	}
	after := remote.requests.Load()
	_, err = cloudAgentHandleMCPCall(s.repo, "user", state, call, s)
	assertMCPErrorStatus(t, err, http.StatusConflict)
	renamedCall := call
	renamedCall.ID = "uncertain-call-new-id"
	renamedState := persistApprovedAgentMCPCall(t, s, state.RuntimeRunID, renamedCall)
	_, err = cloudAgentHandleMCPCall(s.repo, "user", renamedState, renamedCall, s)
	assertMCPErrorStatus(t, err, http.StatusConflict)
	if remote.failedCalls.Load() != 1 || remote.requests.Load() != after {
		t.Fatal("uncertain receipt, changed call ID or HTTP transport retried the external call")
	}
	var receipt model.MCPToolExecution
	if err := db.Where("run_id = ?", state.RuntimeRunID).First(&receipt).Error; err != nil || receipt.Status != "uncertain" {
		t.Fatalf("uncertain result was not retained durably: status=%s err=%v", receipt.Status, err)
	}
}

func TestMCPMarketChangesRevokeExistingToolAuthorization(t *testing.T) {
	remote := newAgentMCPTestServer(t)
	s, _, _, _ := creationTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	input := MCPTemplateInput{
		Name: "测试市场连接器", Transport: "streamable_http", ServerURL: remote.url, Published: true,
		Headers:    map[string]string{"Authorization": "Bearer {{token}}"},
		Parameters: []mcpintegration.Parameter{{Name: "token", Label: "访问令牌", Type: "secret", Required: true}},
	}
	weak := input
	weak.Parameters = []mcpintegration.Parameter{{Name: "token", Type: "string", Required: true}}
	_, err := s.SaveMCPTemplate(admin, "", weak)
	assertMCPErrorStatus(t, err, http.StatusBadRequest)
	duplicate := input
	duplicate.Headers = map[string]string{"Authorization": "Bearer {{token}}", "authorization": "Bearer {{token}}"}
	_, err = s.SaveMCPTemplate(admin, "", duplicate)
	assertMCPErrorStatus(t, err, http.StatusBadRequest)
	template, err := s.SaveMCPTemplate(admin, "", input)
	if err != nil {
		t.Fatal(err)
	}
	view := enabledAgentMCPConnection(t, s, remote, &model.User{ID: "user", Role: model.UserRoleUser}, false, template.ID)
	call := agentMCPToolCall(t, view, "after-unpublish", "不应执行")
	state := approvedAgentMCPState(t, s, call)
	input.Published = false
	if _, err := s.SaveMCPTemplate(admin, template.ID, input); err != nil {
		t.Fatal(err)
	}
	available, err := s.mcpDomain().AvailableTools("user", "", "")
	if err != nil || len(available) != 0 {
		t.Fatalf("unpublished tools remain available: %+v err=%v", available, err)
	}
	before := remote.requests.Load()
	_, err = cloudAgentHandleMCPCall(s.repo, "user", state, call, s)
	assertMCPErrorStatus(t, err, http.StatusForbidden)
	if remote.requests.Load() != before {
		t.Fatal("revoked marketplace authorization reached the external server")
	}
}
