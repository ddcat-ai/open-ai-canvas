package model

// 时间线后台任务类型。与通用生成任务共用同一队列与 Claim 循环
// （ClaimNextTask 不按类型过滤），worker 在 processClaimedTask 顶部
// 按 Type 分叉到独立执行器，不走计费与模型渠道路由。
const (
	TaskTypeTimelineTranscription = "timeline_transcription"
	TaskTypeTimelineRender        = "timeline_render"
)
