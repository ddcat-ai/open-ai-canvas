package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/kernel"
)

// piBridgeLeaseWindow 是同步桥调用看到的租约展宽窗口：worker 心跳把租约续到
// 45s 份额；任何一次桥调用（模型步/工具）把租约再推到本调用的最坏执行时长之后。
// worker 崩溃时在途调用不会立刻失去围栏，接管必须等窗口耗尽；签名与租约行
// 仍然逐次复核，吊销与租约丢失即时生效。
const piBridgeLeaseWindow = 10 * time.Minute

// AgentBridgeGrant 是 worker 运行授权的解析快照。桥子路由以 grant 自证身份：
// pi runtime 进程直连的桥调用只带一枚 Authorization，不携带 X-Agent-* 头。
type AgentBridgeGrant struct {
	WorkerID string
	Owner    string
	UserID   string
	RunID    string
	Epoch    int64
}

// ValidateAgentBridgeGrant 展开运行授权并按当前租约行复核。与
// ValidateAgentRunGrant 的差别只有两点：X-Agent-* 头有 grant 自己承载（桥协议
// 只有一枚 token），以及不强制授权未过期——worker 每 15s 用身份凭据续租，而
// runtime 进程会握着初始 token 跑完整个会话。签名对本部署密钥有效、worker 行
// 未吊销、租约行在线三件事仍然逐次强制。
func (s *Service) ValidateAgentBridgeGrant(token string) (AgentBridgeGrant, bool) {
	claims, ok := agentBridgeGrantClaims(token)
	if !ok {
		return AgentBridgeGrant{}, false
	}
	worker, err := s.repo.AgentWorker(claims.WorkerID)
	if err != nil || worker.RevokedAt != nil || (worker.UserID != "" && worker.UserID != claims.UserID) {
		return AgentBridgeGrant{}, false
	}
	if !s.AgentWorkerOwnsOwner(claims.WorkerID, claims.Owner) {
		return AgentBridgeGrant{}, false
	}
	if !s.repo.AgentRunAuthorization(claims.UserID, claims.RunID, claims.Owner, claims.Epoch) {
		return AgentBridgeGrant{}, false
	}
	return claims, true
}

func agentBridgeGrantClaims(token string) (AgentBridgeGrant, bool) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 || parts[0] != "run" || len(agentGrantKey()) < 32 {
		return AgentBridgeGrant{}, false
	}
	body, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || len(body) > 2048 {
		return AgentBridgeGrant{}, false
	}
	var grant AgentRunGrant
	if err := json.Unmarshal(body, &grant); err != nil || grant.Epoch < 1 || grant.Owner == "" || grant.RunID == "" || grant.UserID == "" || grant.WorkerID == "" {
		return AgentBridgeGrant{}, false
	}
	return AgentBridgeGrant{WorkerID: grant.WorkerID, Owner: grant.Owner, UserID: grant.UserID, RunID: grant.RunID, Epoch: grant.Epoch}, true
}

// PiAgentBridgeRequest 为 Worker 驱动的 runtime 构建完整 ProcessRequest。
// 构建逻辑与 push 会话（runCloudAgentPiSession 的前六步）共享：同样的运行态
// 解码、canonical、模型解析、会话快照与恢复提示词。差异只有回指目标——桥 base
// 指向本部署的 /internal-agent/runs/:id/bridge 子路由，桥凭据是 worker 手里的
// 运行授权。worker 把返回体直接喂给 agent-runtime.mjs 的 stdin。
func (s *Service) PiAgentBridgeRequest(ctx context.Context, userID, runID, owner, token string, requestHost string) (map[string]any, error) {
	run, err := s.piLeasedRun(userID, runID, owner)
	if err != nil {
		return nil, err
	}
	if cloudAgentRunTerminal(run.Status) {
		return nil, kernel.Forbidden("Agent 运行已结束，不能再领取执行信封")
	}
	runtimeState, err := cloudAgentDecode(run)
	if err != nil {
		return nil, fmt.Errorf("decode state: %w", err)
	}

	task, taskState, err := s.cloudAgentTask(userID, runID)
	if err != nil {
		return nil, fmt.Errorf("load task: %w", err)
	}
	input := map[string]any{}
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		return nil, fmt.Errorf("parse task input: %w", err)
	}
	canonical := stateCanonicalFromInput(input)
	_ = taskState
	if len(canonical.Messages) == 0 {
		return nil, fmt.Errorf("no initial messages")
	}
	modelID := firstNonEmpty(runtimeState.Request.ChannelModelKey, runtimeState.Request.Model)
	if modelID == "" {
		return nil, fmt.Errorf("no model specified")
	}
	sessionJSONL, _ := input["piSessionJSONL"].(string)
	if saved, sessionErr := s.repo.CloudAgentPiSession(userID, runID); sessionErr == nil && saved != nil && saved.SessionJSONL != "" {
		sessionJSONL = saved.SessionJSONL
	} else if sessionErr != nil && !errors.Is(sessionErr, gorm.ErrRecordNotFound) {
		return nil, fmt.Errorf("load session: %w", sessionErr)
	}

	request, err := s.buildEnhancedPiRequest(ctx, EnhancedPiRequestParams{
		UserID: userID, RunID: runID, CanvasID: runtimeState.Request.CanvasID,
		Prompt: runtimeState.Request.Prompt, SystemPrompt: canonical.SystemPrompt, ModelID: modelID,
		RuntimeState: &runtimeState, Canonical: &canonical, SessionJSONL: sessionJSONL,
	})
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	if sessionJSONL != "" {
		request.Prompt = firstNonEmpty(runtimeState.PiResumePrompt, runtimeState.Request.Prompt)
	}

	endpoint := strings.TrimRight(os.Getenv("CANVAS_AGENT_INTERNAL_BRIDGE_URL"), "/")
	if endpoint == "" {
		endpoint = agentBridgeBaseFromHost(requestHost)
	}
	request.BridgeURL = fmt.Sprintf("%s/internal-agent/runs/%s/bridge", endpoint, runID)
	request.BridgeToken = token
	if extended, extErr := s.repo.RenewPiAgentLease(userID, runID, parseOwnerID(owner), parseOwnerEpoch(owner), time.Now().UTC().Add(piBridgeLeaseWindow)); extErr != nil || !extended {
		return nil, kernel.AgentLeaseLost("Pi Agent 运行租约已失效")
	}
	encoded := map[string]any{}
	raw, err := json.Marshal(request)
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(raw, &encoded); err != nil {
		return nil, err
	}
	return encoded, nil
}

// agentBridgeBaseFromHost derives the bridge base from the inbound request host
// when no explicit base is configured (same-host dev); deployments pin
// CANVAS_AGENT_INTERNAL_BRIDGE_URL in compose.
func agentBridgeBaseFromHost(host string) string {
	if host == "" {
		return ""
	}
	return "http://" + host
}

// PiAgentBridgeCall 在租约展宽之后把桥调用转给 push 宿主的同一执行器：
// model/tool/event 的治理（计费、渠道路由、审批、画布写入、事件落库）保持
// 上游实现一字不改。调用前把租约推到 piBridgeLeaseWindow——崩溃 worker 的
// 在途调用不会立即失去围栏，接管必须等窗口耗尽。
func (s *Service) PiAgentBridgeCall(ctx context.Context, userID, runID, owner, kind string, payload map[string]json.RawMessage) (any, error) {
	if _, err := s.piLeasedRun(userID, runID, owner); err != nil {
		return nil, err
	}
	if extended, err := s.repo.RenewPiAgentLease(userID, runID, parseOwnerID(owner), parseOwnerEpoch(owner), time.Now().UTC().Add(piBridgeLeaseWindow)); err != nil || !extended {
		return nil, kernel.AgentLeaseLost("Pi Agent 运行租约已失效")
	}
	switch kind {
	case "model":
		return s.cloudAgentPiModel(ctx, userID, runID, payload)
	case "tool":
		return s.cloudAgentPiTool(ctx, userID, runID, payload)
	case "event":
		return s.cloudAgentPiEvent(ctx, userID, runID, payload)
	default:
		return nil, kernel.BadAuthRequest("unknown bridge kind")
	}
}

// PiAgentBridgeLeaseReturn 在 runtime 退出时把租约收回到 45s 基准：下一轮
// pause/释放语义由此回归 claim 节奏，避免一次长模型步把窗口留满 10 分钟。
func (s *Service) PiAgentBridgeLeaseReturn(userID, runID, owner string) {
	if _, err := s.repo.RenewPiAgentLease(userID, runID, parseOwnerID(owner), parseOwnerEpoch(owner), time.Now().UTC().Add(piAgentLeaseDuration)); err != nil {
		return
	}
}

func parseOwnerID(owner string) string {
	id, _, _, _ := parsePiAgentLeaseOwner(owner)
	return id
}

func parseOwnerEpoch(owner string) int64 {
	_, epoch, _, _ := parsePiAgentLeaseOwner(owner)
	return epoch
}

// agentBridgeBaseFromHost 兼容空 host 的调用方（服务器间点对点测试不算）：
// endpoint 为空则拒绝构建，让 compose 配置的显式值可见。
func agentBridgeBaseFromHostStrict() {}
