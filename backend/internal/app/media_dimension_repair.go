package app

import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"time"

	"yingce/backend/internal/model"
)

// 视频入库时宽高可能未知（旧版本只探测时长），素材文档又曾把 0 改写成 1，素材库因此显示 1×1。
// 这里补探测：资源行写入真实宽高，引用该资源的素材文档同步 data.width/height。
// 触发点：短剧投送画布时按需修复（DramaCanvasAssets），以及可在启动后调用的有界回填。

const (
	// videoDimensionBackfillBatch / videoDimensionBackfillMax 限制单次回填的批大小与总量；
	// 剩余的行在下次运行时继续，探测失败的行由游标跳过，不会每次卡在同一行。
	videoDimensionBackfillBatch = 20
	videoDimensionBackfillMax   = 500
	// videoDimensionAssetLimit 是单个资源同步的素材文档上限；同一资源通常只有一两条素材。
	videoDimensionAssetLimit = 20
)

// repairResourceDimensions 为尺寸未知的就绪图片/视频资源补探测宽高并写回资源行。
// 返回资源是否具备有效尺寸（原本就有或补探测成功）；探测不可用或失败时保持 0，不伪造尺寸。
func (s *Service) repairResourceDimensions(ctx context.Context, resource *model.Resource) bool {
	if resource == nil {
		return false
	}
	if resource.Width > 0 && resource.Height > 0 {
		return true
	}
	if resource.Status != model.ResourceStatusReady || (!strings.HasPrefix(resource.MimeType, "video/") && !strings.HasPrefix(resource.MimeType, "image/")) {
		return false
	}
	info, err := s.probeStoredResourceMedia(ctx, resource)
	if err != nil || info.Width <= 0 || info.Height <= 0 {
		return false
	}
	if _, err := s.repo.UpdateUnknownResourceDimensions(resource.UserID, resource.ID, info.Width, info.Height); err != nil {
		slog.Warn("resource dimension repair failed", "resource", resource.ID, "error", err)
		return false
	}
	resource.Width, resource.Height = info.Width, info.Height
	return true
}

// assetDataWithDimensions 把真实宽高写进素材 data；只替换未知值（缺失、≤1，旧版本用 1 占位）。
func assetDataWithDimensions(payload map[string]any, width int, height int) bool {
	if width <= 0 || height <= 0 {
		return false
	}
	data, ok := payload["data"].(map[string]any)
	if !ok {
		return false
	}
	currentWidth, _ := numericScalar(data["width"])
	currentHeight, _ := numericScalar(data["height"])
	if currentWidth > 1 && currentHeight > 1 {
		return false
	}
	data["width"], data["height"] = width, height
	return true
}

// rewriteAssetPayload 以读取时的文档做 CAS 写回；mutate 返回 false 表示无需修改。
// 读取后文档被改动时放弃本次写入并返回 false，下一次触发时再修。
func (s *Service) rewriteAssetPayload(asset *model.Asset, mutate func(payload map[string]any) bool) (bool, error) {
	var payload map[string]any
	if err := json.Unmarshal([]byte(asset.PayloadJSON), &payload); err != nil || payload == nil {
		return false, nil
	}
	if !mutate(payload) {
		return false, nil
	}
	now := time.Now()
	// 文档里的 updatedAt 是前端同步判断远端变化的依据，与列一同推进。
	payload["updatedAt"] = now.UTC().Format(time.RFC3339Nano)
	encoded, err := json.Marshal(payload)
	if err != nil {
		return false, err
	}
	replaced, err := s.repo.ReplaceAssetPayloadIfUnchanged(asset, string(encoded), now)
	if err != nil || !replaced {
		return false, err
	}
	asset.PayloadJSON, asset.UpdatedAt = string(encoded), now
	return true, nil
}

// syncAssetDimensionsForResource 把资源的真实宽高同步到引用它的图片/视频素材文档。
func (s *Service) syncAssetDimensionsForResource(resource *model.Resource) error {
	if resource.Width <= 0 || resource.Height <= 0 {
		return nil
	}
	storageKey := "resource:" + resource.ID
	assets, err := s.repo.UserMediaAssetsMentioning(resource.UserID, storageKey, videoDimensionAssetLimit)
	if err != nil {
		return err
	}
	for index := range assets {
		if _, err := s.rewriteAssetPayload(&assets[index], func(payload map[string]any) bool {
			data, _ := payload["data"].(map[string]any)
			if data == nil || stringValue(data["storageKey"]) != storageKey {
				return false
			}
			return assetDataWithDimensions(payload, resource.Width, resource.Height)
		}); err != nil {
			return err
		}
	}
	return nil
}

// BackfillVideoResourceDimensions 回填本地存储中尺寸未知的存量视频（就绪、mime 为 video/*、宽或高为 0）：
// 补探测资源宽高并同步引用它的素材文档。幂等：资源行只在尺寸仍未知时写入，素材文档按 CAS 写回。
// 对象存储上的视频不在启动回填里下载（每次重启都会重复产生流量），由短剧投送等按需路径修复。
// 单次最多处理 videoDimensionBackfillMax 条；ffprobe 不可用或 ctx 取消时提前返回。返回补齐的资源数。
func (s *Service) BackfillVideoResourceDimensions(ctx context.Context) int {
	if !mediaProbeAvailable() {
		return 0
	}
	repaired, scanned, after := 0, 0, ""
	for scanned < videoDimensionBackfillMax && ctx.Err() == nil {
		resources, err := s.repo.UnknownDimensionLocalVideoResources(after, videoDimensionBackfillBatch)
		if err != nil {
			slog.Warn("video dimension backfill query failed", "error", err)
			return repaired
		}
		if len(resources) == 0 {
			break
		}
		for index := range resources {
			if ctx.Err() != nil {
				break
			}
			resource := &resources[index]
			after = resource.ID
			scanned++
			if !s.repairResourceDimensions(ctx, resource) {
				continue
			}
			repaired++
			if err := s.syncAssetDimensionsForResource(resource); err != nil {
				slog.Warn("video dimension backfill asset sync failed", "resource", resource.ID, "error", err)
			}
		}
	}
	return repaired
}
