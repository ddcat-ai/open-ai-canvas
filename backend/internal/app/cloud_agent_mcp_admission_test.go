package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	mcpintegration "yingce/backend/internal/integrations/mcp"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestMCPAdmissionRejectsForgedOrStaleApprovalWithoutExternalIO(t *testing.T) {
	for _, scenario := range []string{"missing_run", "memory_only", "cancelled", "approval_replaced", "approval_hash_changed", "call_consumed"} {
		t.Run(scenario, func(t *testing.T) {
			remote := newAgentMCPTestServer(t)
			s, db, _, _ := creationTestService(t)
			view := enabledAgentMCPConnection(t, s, remote, &model.User{ID: "user", Role: model.UserRoleUser}, false, "")
			call := agentMCPToolCall(t, view, "admission-call", "只执行已经批准的操作")
			var state *cloudAgentRuntime
			if scenario == "missing_run" || scenario == "memory_only" {
				state = &cloudAgentRuntime{RuntimeRunID: "missing-run", Request: CloudAgentRequest{PermissionMode: "auto"}}
				if scenario == "memory_only" {
					s.legacyCloudAgentRootTask = false
					req := unboundAgentTestRequest("mcp-memory-only")
					req.PermissionMode = "auto"
					run, err := s.CreateCloudAgentRun("user", req, "")
					if err != nil {
						t.Fatal(err)
					}
					_, durable := agentInterjectionState(t, s, run.ID)
					state = &durable
				}
				state.Calls = []cloudAgentCall{call}
				state.Approval = &cloudAgentApproval{ID: "memory-only-approval", Call: call, CallHash: cloudAgentApprovalCallHash(call), Decision: "approve"}
			} else {
				state = approvedAgentMCPState(t, s, call)
			}
			before := remote.requests.Load()
			switch scenario {
			case "cancelled":
				if err := s.CancelCloudAgent(t.Context(), "user", state.RuntimeRunID); err != nil {
					t.Fatal(err)
				}
			case "approval_replaced":
				replacement := agentMCPToolCall(t, view, call.ID, "后来批准了另一组参数")
				persistApprovedAgentMCPCall(t, s, state.RuntimeRunID, replacement)
			case "approval_hash_changed", "call_consumed":
				run, currentState := agentInterjectionState(t, s, state.RuntimeRunID)
				if scenario == "approval_hash_changed" {
					currentState.Approval.CallHash = strings.Repeat("0", 64)
				} else {
					currentState.Approval = nil
					currentState.CallIndex = len(currentState.Calls)
				}
				if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
					return cloudAgentSave(current, &currentState)
				}); err != nil {
					t.Fatal(err)
				}
			}
			if !cloudAgentMCPCallApproved(state, call) {
				t.Fatal("fixture must pass the in-memory gate to exercise durable admission")
			}
			_, err := cloudAgentHandleMCPCall(s.repo, "user", state, call, s)
			assertMCPErrorStatus(t, err, http.StatusForbidden)
			if remote.requests.Load() != before || remote.calls.Load() != 0 {
				t.Fatal("rejected durable approval reached the external MCP server")
			}
			var receipts int64
			if err := db.Model(&model.MCPToolExecution{}).Where("run_id = ?", state.RuntimeRunID).Count(&receipts).Error; err != nil || receipts != 0 {
				t.Fatalf("rejected admission claimed an execution receipt: count=%d err=%v", receipts, err)
			}
		})
	}
}

func TestMCPDomainCallRequiresDurableApprovalCallback(t *testing.T) {
	remote := newAgentMCPTestServer(t)
	s, _, _, _ := creationTestService(t)
	view := enabledAgentMCPConnection(t, s, remote, &model.User{ID: "user", Role: model.UserRoleUser}, false, "")
	call := agentMCPToolCall(t, view, "missing-callback", "不能省略准入校验")
	state := approvedAgentMCPState(t, s, call)
	args, err := cloudAgentDecodeMCPCall(call)
	if err != nil {
		t.Fatal(err)
	}
	before := remote.requests.Load()
	_, err = s.mcpDomain().Call(t.Context(), "user", state.RuntimeRunID, call.ID, args, nil)
	assertMCPErrorStatus(t, err, http.StatusForbidden)
	if remote.requests.Load() != before || remote.calls.Load() != 0 {
		t.Fatal("missing admission callback reached the external MCP server")
	}
}

func TestMCPTemplateSecretReclassificationClearsInstalledCredentials(t *testing.T) {
	remote := newAgentMCPTestServer(t)
	s, _, _, _ := creationTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	owner := &model.User{ID: "user", Role: model.UserRoleUser}
	input := MCPTemplateInput{
		Name: "需要访问令牌的连接器", Transport: "streamable_http", ServerURL: remote.url, Published: true,
		Headers:    map[string]string{"Authorization": "Bearer {{token}}"},
		Parameters: []mcpintegration.Parameter{{Name: "token", Type: "secret", Required: true}},
	}
	template, err := s.SaveMCPTemplate(admin, "", input)
	if err != nil {
		t.Fatal(err)
	}
	personal := enabledAgentMCPConnection(t, s, remote, owner, false, template.ID)
	platform := enabledAgentMCPConnection(t, s, remote, admin, true, template.ID)
	input.Headers = map[string]string{}
	input.Parameters[0].Type = "string"
	if _, err := s.SaveMCPTemplate(admin, template.ID, input); err != nil {
		t.Fatal(err)
	}
	for _, scope := range []struct {
		actor    *model.User
		platform bool
		previous MCPConnectionView
	}{{owner, false, personal}, {admin, true, platform}} {
		views, err := s.MCPConnections(scope.actor, scope.platform)
		if err != nil || len(views) != 1 {
			t.Fatalf("cannot read reconfigured connection: views=%+v err=%v", views, err)
		}
		view := views[0]
		raw, err := json.Marshal(view)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(raw), remote.credential) || view.Parameters["token"] != "" || len(view.ConfiguredSecrets) != 0 {
			t.Fatal("a template secret reclassified as string exposed the installed credential")
		}
		if view.Enabled || len(view.Tools) != 0 || len(view.AllowedTools) != 0 || view.LastTestAt != nil || view.Revision <= scope.previous.Revision {
			t.Fatalf("template editing retained old tool authorization: %+v", view)
		}
		row, err := s.repo.MCPConnection(view.ID)
		if err != nil || row.ParametersCiphertext != "" {
			t.Fatalf("template editing did not erase stored parameters: err=%v", err)
		}
	}
}

func TestMCPUncertainTimeoutNeverAdvertisesAutomaticRetry(t *testing.T) {
	call := cloudAgentCall{ID: "timed-out-external-action"}
	call.Function.Name = "mcp_call_tool"
	req := CloudAgentRequest{PermissionMode: "auto"}
	for _, cause := range []error{context.DeadlineExceeded, context.Canceled} {
		t.Run(cause.Error(), func(t *testing.T) {
			err := fmt.Errorf("tool invocation failed: %w", &mcpintegration.UncertainExecutionError{Cause: kernel.WrapAppError(http.StatusBadGateway, "外部执行结果待核对", cause)})
			if !errors.Is(err, cause) {
				t.Fatal("fixture lost the timeout or cancellation cause")
			}
			class, retryable, action := cloudAgentToolErrorClass(req, call, err, true)
			if class != cloudAgentToolErrorExternalUncertain || retryable || action != "verify_external_state" {
				t.Fatalf("uncertain external effect was retryable: class=%s retryable=%v action=%s", class, retryable, action)
			}
		})
	}
}

func TestMCPAdmittedCallReleasesDatabaseLocksBeforeExternalIO(t *testing.T) {
	remote := newAgentMCPTestServer(t)
	s, db, _, _ := creationTestService(t)
	actor := &model.User{ID: "user", Role: model.UserRoleUser}
	view := enabledAgentMCPConnection(t, s, remote, actor, false, "")
	call := agentMCPToolCall(t, view, "blocking-remote-call", "调用中仍允许撤权和取消")
	state := approvedAgentMCPState(t, s, call)
	remote.blockCall.Store(true)
	release := sync.OnceFunc(func() { close(remote.releaseCall) })
	t.Cleanup(release)
	callDone := make(chan struct{})
	var firstResult any
	var callErr error
	go func() {
		firstResult, callErr = cloudAgentHandleMCPCall(s.repo, "user", state, call, s)
		close(callDone)
	}()
	t.Cleanup(func() {
		release()
		select {
		case <-callDone:
		case <-time.After(5 * time.Second):
			t.Error("MCP call did not finish after releasing the test server")
		}
	})
	select {
	case <-remote.callStarted:
	case <-callDone:
		t.Fatalf("MCP call returned before reaching the tool: %v", callErr)
	case <-time.After(5 * time.Second):
		t.Fatal("MCP call did not reach the blocking tool")
	}
	var receipt model.MCPToolExecution
	if err := db.Where("run_id = ?", state.RuntimeRunID).First(&receipt).Error; err != nil || receipt.Status != "running" {
		t.Fatalf("execution receipt was not committed before external IO: status=%s err=%v", receipt.Status, err)
	}
	secondDone := make(chan struct{})
	var secondResult any
	var secondErr error
	go func() {
		secondResult, secondErr = cloudAgentHandleMCPCall(s.repo, "user", state, call, s)
		close(secondDone)
	}()
	t.Cleanup(func() {
		release()
		select {
		case <-secondDone:
		case <-time.After(5 * time.Second):
			t.Error("duplicate MCP caller did not receive the released tool result")
		}
	})
	select {
	case <-secondDone:
		t.Fatalf("duplicate caller returned before the actual external outcome: %v", secondErr)
	case <-time.After(300 * time.Millisecond):
	}
	if remote.calls.Load() != 1 {
		t.Fatal("duplicate caller executed the remote tool again while the original call was running")
	}
	controlDone := make(chan struct{})
	var controlErr error
	go func() {
		_, controlErr = s.SaveMCPConnection(actor, view.ID, false, MCPConnectionInput{Name: view.Name, Transport: view.Transport, ServerURL: view.ServerURL, AllowedTools: view.AllowedTools, Enabled: false})
		if controlErr == nil {
			controlErr = s.CancelCloudAgent(t.Context(), "user", state.RuntimeRunID)
		}
		close(controlDone)
	}()
	t.Cleanup(func() {
		release()
		select {
		case <-controlDone:
		case <-time.After(5 * time.Second):
			t.Error("control-plane mutation did not finish after releasing the test server")
		}
	})
	select {
	case <-controlDone:
		if controlErr != nil {
			t.Fatalf("revocation or cancellation failed during external IO: %v", controlErr)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("external MCP IO held database locks and blocked revocation or cancellation")
	}
	connection, err := s.repo.MCPConnection(view.ID)
	if err != nil || connection.Enabled {
		t.Fatalf("connection revocation was not committed during external IO: err=%v", err)
	}
	run, _ := agentInterjectionState(t, s, state.RuntimeRunID)
	if run.Status != "cancelled" {
		t.Fatalf("cancellation was not committed during external IO: status=%s", run.Status)
	}
	select {
	case <-callDone:
		t.Fatalf("remote tool stopped blocking before test released it: %v", callErr)
	default:
	}
	release()
	select {
	case <-callDone:
		if callErr != nil {
			t.Fatalf("already admitted external call lost its receipt after cancellation: %v", callErr)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("MCP call did not finish after the remote tool was released")
	}
	select {
	case <-secondDone:
		if secondErr != nil {
			t.Fatalf("duplicate caller failed instead of receiving the actual result: %v", secondErr)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("duplicate caller did not receive the completed receipt")
	}
	firstJSON, err := json.Marshal(firstResult)
	if err != nil {
		t.Fatal(err)
	}
	secondJSON, err := json.Marshal(secondResult)
	if err != nil || string(firstJSON) != string(secondJSON) {
		t.Fatalf("duplicate caller received a different outcome: first=%s second=%s err=%v", firstJSON, secondJSON, err)
	}
	if err := db.Where("run_id = ?", state.RuntimeRunID).First(&receipt).Error; err != nil || receipt.Status != "completed" || remote.calls.Load() != 1 {
		t.Fatalf("admitted call did not complete exactly once: status=%s calls=%d err=%v", receipt.Status, remote.calls.Load(), err)
	}
}

func TestMCPOrphanedRunningReceiptFailsWithoutWaitingOrRetrying(t *testing.T) {
	remote := newAgentMCPTestServer(t)
	s, db, _, _ := creationTestService(t)
	view := enabledAgentMCPConnection(t, s, remote, &model.User{ID: "user", Role: model.UserRoleUser}, false, "")
	call := agentMCPToolCall(t, view, "orphaned-call", "未确认的历史操作不可重试")
	state := approvedAgentMCPState(t, s, call)
	if _, err := cloudAgentHandleMCPCall(s.repo, "user", state, call, s); err != nil {
		t.Fatal(err)
	}
	// Reproduce a process that crashed after admission without saving an outcome.
	if err := db.Model(&model.MCPToolExecution{}).Where("run_id = ?", state.RuntimeRunID).Updates(map[string]any{
		"status": "running", "result_json": "", "created_at": time.Now().Add(-3 * time.Minute),
	}).Error; err != nil {
		t.Fatal(err)
	}
	before := remote.requests.Load()
	completed := make(chan error, 1)
	go func() {
		_, err := cloudAgentHandleMCPCall(s.repo, "user", state, call, s)
		completed <- err
	}()
	select {
	case err := <-completed:
		assertMCPErrorStatus(t, err, http.StatusConflict)
		class, retryable, action := cloudAgentToolErrorClass(state.Request, call, err, true)
		if class != cloudAgentToolErrorExternalUncertain || retryable || action != "verify_external_state" {
			t.Fatalf("orphaned receipt did not require external reconciliation: class=%s retryable=%v action=%s", class, retryable, action)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("orphaned receipt waited for a new execution window instead of failing immediately")
	}
	if remote.requests.Load() != before || remote.calls.Load() != 1 {
		t.Fatal("orphaned receipt retried the external operation")
	}
}
