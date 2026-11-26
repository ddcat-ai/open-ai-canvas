package app

import (
	"net/http"
	"slices"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestMCPFeaturesDelegateApprovalToConnectionPolicy(t *testing.T) {
	s, _, _, _ := creationTestService(t)
	for _, mode := range []string{"auto", "request_approval"} {
		state := &cloudAgentRuntime{Request: unboundAgentTestRequest("mcp-features")}
		state.Request.PermissionMode = mode
		features := s.buildFeaturesConfig(state)
		if slices.Contains(features["approvalRequired"].([]string), "mcp_call_tool") {
			t.Fatal("SDK 的静态审批列表不能覆盖服务端连接授权模式")
		}
	}
}

func TestMCPTrustModeDispatchAndDurableAdmission(t *testing.T) {
	for _, scenario := range []struct{ mode, permission, change string }{
		{"full_access", "auto", ""},
		{"full_access", "request_approval", ""},
		{"request_approval", "auto", ""},
		{"request_approval", "request_approval", ""},
		{"full_access", "read_only", ""},
		{"full_access", "auto", "cancelled"},
		{"full_access", "auto", "call_replaced"},
		{"full_access", "auto", "revoked"},
		{"full_access", "auto", "durable_read_only"},
	} {
		t.Run(scenario.mode+"/"+scenario.permission+"/"+scenario.change, func(t *testing.T) {
			remote := newAgentMCPTestServer(t)
			s, _, _, _ := creationTestService(t)
			actor := &model.User{ID: "user", Role: model.UserRoleUser}
			view := enabledAgentMCPConnection(t, s, remote, actor, false, "")
			view, err := s.SaveMCPConnection(actor, view.ID, false, MCPConnectionInput{Name: view.Name, Transport: view.Transport, ServerURL: view.ServerURL, Enabled: true, AllowedTools: view.AllowedTools, ApprovalMode: scenario.mode})
			if err != nil {
				t.Fatal(err)
			}
			call := agentMCPToolCall(t, view, "trusted-call", "按当前连接授权执行")
			s.legacyCloudAgentRootTask = false
			req := unboundAgentTestRequest("mcp-trust")
			createdRun, err := s.CreateCloudAgentRun("user", req, "")
			if err != nil {
				t.Fatal(err)
			}
			run, current := agentInterjectionState(t, s, createdRun.ID)
			current.Calls, current.CallIndex, current.Approval, current.ActiveTaskID = []cloudAgentCall{call}, 0, nil, ""
			current.Request.PermissionMode = scenario.permission
			if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(row *model.CloudAgentExecution, _ *repository.Repository) error {
				return cloudAgentSave(row, &current)
			}); err != nil {
				t.Fatal(err)
			}
			run, current = agentInterjectionState(t, s, run.ID)
			current.RuntimeRunID = run.ID
			if scenario.change == "" {
				if err := s.advanceCloudAgentTool(run, &current); err != nil {
					t.Fatal(err)
				}
				after, _ := agentInterjectionState(t, s, run.ID)
				if scenario.mode == "request_approval" {
					if after.Status != "waiting_approval" || remote.calls.Load() != 0 {
						t.Fatal("逐次确认未等待审批")
					}
				} else if scenario.permission == "read_only" {
					if remote.calls.Load() != 0 {
						t.Fatal("只读运行调用了外部工具")
					}
				} else if remote.calls.Load() != 1 {
					t.Fatal("完全授权未直接执行一次外部调用")
				}
				return
			}
			if scenario.change == "revoked" {
				_, err = s.SaveMCPConnection(actor, view.ID, false, MCPConnectionInput{Name: view.Name, Transport: view.Transport, ServerURL: view.ServerURL, Enabled: true, AllowedTools: view.AllowedTools, ApprovalMode: "request_approval"})
			} else {
				err = s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(row *model.CloudAgentExecution, _ *repository.Repository) error {
					changed := current
					switch scenario.change {
					case "cancelled":
						row.Status = "cancelled"
					case "call_replaced":
						changed.Calls = []cloudAgentCall{agentMCPToolCall(t, view, call.ID, "另一组参数")}
					case "durable_read_only":
						changed.Request.PermissionMode = "read_only"
					}
					return cloudAgentSave(row, &changed)
				})
			}
			if err != nil {
				t.Fatal(err)
			}
			_, err = cloudAgentHandleMCPCall(s.repo, "user", &current, call, s)
			status := http.StatusForbidden
			if scenario.change == "revoked" {
				status = http.StatusConflict
			}
			assertMCPErrorStatus(t, err, status)
			if remote.calls.Load() != 0 {
				t.Fatal("失效的信任或检查点仍然执行了外部调用")
			}
		})
	}
}

func TestMCPConnectionApprovalModeDefaultsAndValidation(t *testing.T) {
	remote := newAgentMCPTestServer(t)
	s, _, _, _ := creationTestService(t)
	actor := &model.User{ID: "user", Role: model.UserRoleUser}
	input := MCPConnectionInput{Name: "默认逐次确认", Transport: "streamable_http", ServerURL: remote.url}
	view, err := s.SaveMCPConnection(actor, "", false, input)
	if err != nil || view.ApprovalMode != "request_approval" {
		t.Fatalf("默认审批模式错误：%+v %v", view, err)
	}
	input.ApprovalMode = "unknown"
	_, err = s.SaveMCPConnection(actor, view.ID, false, input)
	assertMCPErrorStatus(t, err, http.StatusBadRequest)
}
