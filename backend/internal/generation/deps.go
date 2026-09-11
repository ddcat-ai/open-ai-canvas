package generation

import (
	"context"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/protocol"
)

// MediaResolver 水合参考媒体（资源 URL / data URL），由组合根注入，避免 generation → service 回环。
type MediaResolver interface {
	HydrateGenerationMedia(userID string, input *Input, preferURL bool) error
}

// UpstreamPolicy 控制私网/本机上游放行。
type UpstreamPolicy interface {
	WithOutboundPolicy(ctx context.Context, allowLocal bool) context.Context
}

// TaskProgress 写入任务进度/日志。
type TaskProgress interface {
	SyncProviderTaskProgress(taskID string, responseBody []byte)
	Log(userID, taskID, level, message, payload string) error
}

// BillingHooks 生成路径上的计费终态钩子。
type BillingHooks interface {
	MarkBillingUncertain(taskID, reason string) error
	Settle(taskID string) error
	Refund(taskID, reason string) error
	RestoreRefunded(taskID, reason string) error
}

// ChannelLimiter 渠道并发槽与熔断结果。
type ChannelLimiter interface {
	AcquireChannelSlot(ctx context.Context, channelID string) (release func(), err error)
	RecordChannelResult(channelID string, success bool)
}

// MediaPersister 持久化生成结果与资源 URL。
type MediaPersister interface {
	PersistGeneratedMediaResult(ctx context.Context, userID, taskID string, result map[string]interface{}) (map[string]interface{}, error)
	DirectResourceURL(resource *model.Resource, expiresAt time.Time) (string, error)
}

// Deps 是 Engine 的外部端口集合；禁止持有组合根或回环到 service。
type Deps struct {
	Media    MediaResolver
	Upstream UpstreamPolicy
	Progress TaskProgress
	Billing  BillingHooks
	Channel  ChannelLimiter
	Persist  MediaPersister
	// Registry 可选；为空时 Engine 使用官方插件包回退表。
	Registry *protocol.Registry
}
