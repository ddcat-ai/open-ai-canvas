package kernel

// Cloud Agent 计算面专用原因（RFC #943 的 /internal-agent Worker 协议）。
// 前端与 Node worker 按 reason 判断，不解析 message 文案。
const (
	ReasonAgentLeaseLost ErrorReason = "agent_lease_lost"
)

// AgentLeaseLost 表示运行租约已失效或 fencing epoch 不匹配：Worker 应立即
// 终止当前运行并回到领取循环，不能带着旧 epoch 继续提交任何操作。
func AgentLeaseLost(message string) *AppError {
	return &AppError{Status: CodeForbidden, Code: CodeForbidden, Reason: ReasonAgentLeaseLost, Message: message}
}
