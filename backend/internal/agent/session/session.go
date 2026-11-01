// Package session 定义云端 Agent 会话运行时的控制面契约。
//
// 实现负责：会话进程/会话执行的托管方式（现状：本机 spawn 内嵌运行时或远程
// yingce-agent 容器；后续可选：经 /internal-agent 领取运行的独立 Worker，见
// RFC #943）、并发上限、健康观测与关停排空。模型/工具/事件业务处理
// （/model /tool /event 背后的治理逻辑）不属于本契约——它们与传输方式无关，
// 由各实现自行接线（内嵌/远程实现：loopback/容器网络 bridge；Worker 实现：
// /internal-agent 端点）。
package session

import "context"

// Runtime 是云端 Agent 会话运行时的唯一控制面。
//
// 并发约束：
//   - Start/Resume 可被 HTTP handler、恢复循环并发调用；实现必须保证同一 runID
//     至多一个活会话，重复调用为幂等 no-op。
//   - Resume 在旧会话退出中时不得取消它，须登记重启，由旧会话退出时接管。
//   - Stop 幂等；对未在跑的 runID 是 no-op。
//   - Close 之后 Start/Resume 一律静默丢弃，Close 只应调用一次。
//
// 取消语义：生命周期方法不接收 context——会话生命周期由实现自管（与 HTTP
// 请求解耦，会话可以活得比请求久）。错误语义：生命周期方法无返回值；会话级
// 失败通过运行状态与日志上报，控制调用方行为保持现状（fire-and-forget）。
type Runtime interface {
	// Start 请求开始（或幂等重复开始）一个用户运行。非阻塞：实现立即返回，
	// 会话在后台执行。
	Start(userID, runID string)
	// Resume 请求恢复一个暂停（审批/插话/催办）后的运行；若旧会话仍在收尾
	// 则登记重启。
	Resume(userID, runID string)
	// Stop 取消指定运行的活会话（用户取消入口）。
	Stop(runID string)
	// Recover 周期对账：按持久化状态重启应当存活但进程内缺失的会话。
	// 同步执行（启动即一次 + 周期 ticker）。
	Recover()
	// Close 取消并等待全部会话结束。Service.Close 的关闭序依赖其同步完成：
	// 先会话排空，再关闭媒体等待器与 Redis。
	Close()
	// SetSessionLimit 应用「同时会话数」上限。error 仅表示远端应用失败；
	// 本进程部分永不失败且先行执行。
	SetSessionLimit(ctx context.Context, limit int) error
	// Inspect 返回运行时的健康/容量观测。不可达不是 error，而是 Healthy=false
	// 的降级 Status（与既有管理台响应形状一致）。
	Inspect(ctx context.Context) Status
}

// Status 是 Inspect 的观测快照。全部为类型化字段（架构守卫禁止导出 API
// 暴露非类型化 map）。
type Status struct {
	Mode     string // "embedded"（后续增加 "worker"）
	Endpoint string // embedded 固定为 "本进程"；remote 为 YINGCE_AGENT_URL 原文
	Healthy  bool
	Active   int
	Limit    int
	Queued   int
	// Message 是实现自带的面向管理台的现状说明文案；实现应逐字复刻既有文案。
	Message string
}
