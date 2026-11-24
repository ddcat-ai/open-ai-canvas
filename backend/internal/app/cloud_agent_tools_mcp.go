package app

import (
	"context"
	"fmt"

	mcpintegration "yingce/backend/internal/integrations/mcp"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func cloudAgentHandleMCPListTools(_ *repository.Repository, userID string, _ *cloudAgentRuntime, call cloudAgentCall, services ...*Service) (any, error) {
	var args struct {
		ConnectionID string `json:"connectionId"`
		ToolName     string `json:"toolName"`
	}
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	svc := cloudAgentToolService(services)
	if svc == nil {
		return nil, BadAuthRequest("MCP 服务不可用")
	}
	connections, err := svc.mcpDomain().AvailableTools(userID, args.ConnectionID, args.ToolName)
	return map[string]any{"connections": connections, "requiresApproval": true, "untrustedData": true}, err
}

func cloudAgentDecodeMCPCall(call cloudAgentCall) (mcpintegration.ToolCall, error) {
	var args mcpintegration.ToolCall
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return args, cloudAgentJSONArgumentError(err)
	}
	if args.ConnectionID == "" || args.ToolName == "" || args.Revision <= 0 {
		return args, BadAuthRequest("MCP 调用必须包含连接、版本和工具名")
	}
	return args, nil
}

func cloudAgentPreviewMCPCall(repo *repository.Repository, userID, _ string, call cloudAgentCall) (cloudAgentApprovalPreview, error) {
	args, err := cloudAgentDecodeMCPCall(call)
	if err != nil {
		return cloudAgentApprovalPreview{}, err
	}
	connection, err := mcpintegration.AuthorizeCall(repo, userID, args)
	if err != nil {
		return cloudAgentApprovalPreview{}, err
	}
	return cloudAgentApprovalPreview{
		Kind: "mcp", Title: "确认调用外部 MCP 工具",
		Description: fmt.Sprintf("将通过「%s」调用 %s；此操作可能读取或修改外部系统。", connection.Name, args.ToolName),
		Items:       []cloudAgentApprovalPreviewItem{{Operation: "mcp_call", Summary: connection.Name + " / " + args.ToolName, Details: []string{fmt.Sprintf("连接配置版本：%d", args.Revision), "仅本次操作获授权，具体参数见调用详情"}}},
	}, nil
}

func cloudAgentHandleMCPCall(_ *repository.Repository, userID string, state *cloudAgentRuntime, call cloudAgentCall, services ...*Service) (any, error) {
	if !cloudAgentMCPCallApproved(state, call) {
		return nil, Forbidden("MCP 外部工具必须先取得本次调用的明确审批")
	}
	args, err := cloudAgentDecodeMCPCall(call)
	if err != nil {
		return nil, err
	}
	svc := cloudAgentToolService(services)
	if svc == nil {
		return nil, BadAuthRequest("MCP 服务不可用")
	}
	return svc.mcpDomain().Call(context.Background(), userID, state.RuntimeRunID, call.ID, args, func(run *model.CloudAgentExecution) error {
		// The caller's snapshot may predate cancellation or a new approval. Check
		// the locked durable checkpoint immediately before claiming external IO.
		current, err := cloudAgentDecode(run)
		if err != nil {
			return err
		}
		if (run.Status != "running" && run.Status != "queued") ||
			!cloudAgentMCPCallApproved(&current, call) || current.Approval.ID != state.Approval.ID ||
			current.CallIndex < 0 || current.CallIndex >= len(current.Calls) ||
			current.Calls[current.CallIndex].ID != call.ID || !cloudAgentToolCallsEquivalent(current.Calls[current.CallIndex], call) {
			return Forbidden("MCP 调用审批或运行状态已变化，本次操作未执行")
		}
		return nil
	})
}

func cloudAgentMCPCallApproved(state *cloudAgentRuntime, call cloudAgentCall) bool {
	return state != nil && state.Request.PermissionMode != "read_only" && state.Approval != nil &&
		state.Approval.Decision == "approve" && state.Approval.Call.ID == call.ID &&
		cloudAgentToolCallsEquivalent(state.Approval.Call, call) && state.Approval.CallHash == cloudAgentApprovalCallHash(call)
}
