// Package session 定义云端 Agent 会话运行时的控制面契约。
//
// 实现负责：会话进程/会话执行的托管方式（现状：本机 spawn 内嵌运行时或远程
// yingce-agent 容器；后续可选：经 /internal-agent 领取运行的独立 Worker，见
// RFC #943）、并发上限、健康观测与关停排空。模型/工具/事件业务处理
// （/model /tool /event 背后的治理逻辑）不属于本契约——它们与传输方式无关，
// 由各实现自行接线（内嵌/远程实现：loopback/容器网络 bridge；Worker 实现：
// /internal-agent 端点）。媒体任务等待器（media waiter）等纯业务编排与传输
// 方式无关，始终留在调用方，也不属于本契约。
package session

import "context"

// Mode 标识运行时的托管方式。实现必须在构造 Status 时返回这三个取值之一；
// 消费方按 Mode 语义分支时只认常量，不裸写字面量。
type Mode string

const (
	// ModeEmbedded 表示会话由本后端进程内 spawn（本地开发）。
	ModeEmbedded Mode = "embedded"
	// ModeRemote 表示会话运行在远程 yingce-agent 容器（生产默认）。
	ModeRemote Mode = "remote"
	// ModeWorker 预留给 RFC #943 P2 的 Worker 拉取运行时。
	ModeWorker Mode = "worker"
)

// Runtime 是云端 Agent 会话运行时托管方式的控制面。
//
// 通用保证（所有实现必须满足）：
//   - Start/Resume 可被 HTTP handler、恢复循环并发调用；同一 runID 至多一个
//     活会话，重复调用为幂等 no-op。
//   - Stop 幂等；对未在跑的 runID 是 no-op。
//   - Close 只应调用一次；返回后 Start/Resume 一律静默丢弃，且调用方关闭序
//     中排在运行时之后的依赖（媒体等待器、Redis）不会再被会话写入。
//   - Inspect 不可达不是 error，而是 Healthy=false 的降级快照。
//   - 生命周期方法不接收 context：会话生命周期由实现自管，与发起它的 HTTP
//     请求解耦。错误不入返回值；会话级失败经运行状态与日志上报。
//
// push 实现专属语义（本机 spawn / yingce-agent 容器；Worker 实现的对应语义
// 在 RFC #943 P2 定义，例如 Close 可能只是「不再领取 + 等待在途步骤落盘」，
// Recover 可能是重排队而非进程内扫描）：
//   - Resume 在旧会话退出中时不取消它，登记重启由旧会话退出时接管。
//   - Close 同步 cancel 并 join 全部会话。
//   - Recover 同步扫库，重启进程内缺失但应当存活的会话。
//   - SetSessionLimit 的本进程部分（进程闸门）先行执行且永不失败，error 仅
//     表示远端应用失败。
type Runtime interface {
	// Start 请求开始（或幂等重复开始）一个用户运行。非阻塞：实现立即返回，
	// 会话在后台执行。
	Start(userID, runID string)
	// Resume 请求恢复一个暂停（审批/插话/催办）后的运行；push 语义见上。
	Resume(userID, runID string)
	// Stop 取消指定运行的活会话（用户取消入口）。
	Stop(runID string)
	// Recover 周期对账（push：同步扫库；Worker 实现语义在 P2 定义）。同步执行，
	// 启动即一次并随周期 ticker 调用。
	Recover()
	// Close 取消并排空全部会话（push 语义见上）。
	Close()
	// SetSessionLimit 应用「同时会话数」上限。
	SetSessionLimit(ctx context.Context, limit int) error
	// Inspect 返回运行时的健康/容量观测。
	Inspect(ctx context.Context) Status
}

// Status 是 Inspect 的观测快照。全部为类型化字段（架构守卫禁止导出 API
// 暴露非类型化 map）；ID 与限额比对语义由实现申报，消费方不按 Mode 字面量
// 推导，避免新增托管方式时被误标成既有服务。
type Status struct {
	// ID 是管理台展示用的稳定标识（push 实现：embedded → "embedded"，
	// remote → "yingce-agent"），由实现自报而非消费方按 Mode 推导。
	ID string
	// Mode 是托管方式，取值为本包 Mode 常量。
	Mode Mode
	// Endpoint 内嵌实现固定为 "本进程"；remote 为 YINGCE_AGENT_URL 原文。
	Endpoint string
	// Healthy 是服务健康观测；不可达时为 false。
	Healthy bool
	// LimitMismatch 声明本实现运行着可调节的外部会话上限、愿意参与
	// 「运行上限 vs 已保存配置」比对（push remote 在可达时申报；内嵌与本进程
	// 实现不申报）。消费方在申报为真且 Limit != 配置值时提示不一致。
	LimitMismatch bool
	Active        int
	Limit         int
	Queued        int
	// Message 是实现自带的面向管理台的现状说明文案；实现应逐字复刻既有文案。
	Message string
}
