// 画布展示缩略图生成：把大图缩成小尺寸 JPEG，供列表/画布缩略显示，
// 避免一次加载几十张原图（每张数 MB）把带宽和首屏时间拖垮。
//
// 设计要点：
//   - 只在资源就绪后异步执行，失败不影响主流程（缩略图缺失时前端自动回落原图）。
//   - 缩略图对象键由原 ObjectKey 派生，不额外持久化路径，删除资源时可一并清理。
//   - 输出 JPEG：标准库即可编码，不引入新依赖；512px 下体积与 WebP 差距可忽略。

package app

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
	"io"
	"strings"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/storage"
)

const (
	// 画布/列表展示够用的长边上限。再大也不会提升观感，只会白占带宽。
	thumbnailMaxEdge = 512
	// 原图长边已小于该值时不再生成缩略图（省一次编解码，直接用原图更快）。
	thumbnailSkipBelowEdge = 640
	// 缩略图 JPEG 质量。512px 下 q80 观感足够，体积通常 20–60KB。
	thumbnailQuality = 80
)

// thumbnailObjectKey 由原对象键派生缩略图键。
// 放在同目录下、加 .thumb.jpg 后缀，保证与原对象生命周期一致，
// 且批量删除目录时天然被包含。
func thumbnailObjectKey(objectKey string) string {
	objectKey = strings.TrimSpace(objectKey)
	if objectKey == "" {
		return ""
	}
	if dot := strings.LastIndex(objectKey, "."); dot > strings.LastIndex(objectKey, "/") {
		objectKey = objectKey[:dot]
	}
	return objectKey + ".thumb.jpg"
}

// buildThumbnail 把图片字节解码后等比缩放到长边 <= thumbnailMaxEdge，输出 JPEG。
// 返回 nil 表示无需生成（原图本来就不大）。
func buildThumbnail(data []byte) ([]byte, int, int, error) {
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, 0, 0, fmt.Errorf("缩略图解码失败：%w", err)
	}
	bounds := src.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	if width <= 0 || height <= 0 {
		return nil, 0, 0, errors.New("缩略图源尺寸无效")
	}
	if width <= thumbnailSkipBelowEdge && height <= thumbnailSkipBelowEdge {
		return nil, width, height, nil
	}
	scale := float64(thumbnailMaxEdge) / float64(width)
	if height > width {
		scale = float64(thumbnailMaxEdge) / float64(height)
	}
	targetW := int(float64(width) * scale)
	targetH := int(float64(height) * scale)
	if targetW < 1 {
		targetW = 1
	}
	if targetH < 1 {
		targetH = 1
	}
	dst := image.NewRGBA(image.Rect(0, 0, targetW, targetH))
	bilinearScale(dst, src, bounds)

	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, dst, &jpeg.Options{Quality: thumbnailQuality}); err != nil {
		return nil, 0, 0, fmt.Errorf("缩略图编码失败：%w", err)
	}
	return buf.Bytes(), targetW, targetH, nil
}

// bilinearScale 用双线性采样把 src 缩放到 dst。
// 手写以避免引入 golang.org/x/image/draw 依赖（go.mod 中无该模块）。
func bilinearScale(dst *image.RGBA, src image.Image, srcBounds image.Rectangle) {
	dstBounds := dst.Bounds()
	dw, dh := dstBounds.Dx(), dstBounds.Dy()
	sw, sh := srcBounds.Dx(), srcBounds.Dy()
	if dw <= 0 || dh <= 0 || sw <= 0 || sh <= 0 {
		return
	}
	for y := 0; y < dh; y++ {
		sy := (float64(y)+0.5)*float64(sh)/float64(dh) - 0.5
		y0 := int(sy)
		if y0 < 0 {
			y0 = 0
		}
		y1 := y0 + 1
		if y1 >= sh {
			y1 = sh - 1
		}
		fy := sy - float64(y0)
		if fy < 0 {
			fy = 0
		}
		for x := 0; x < dw; x++ {
			sx := (float64(x)+0.5)*float64(sw)/float64(dw) - 0.5
			x0 := int(sx)
			if x0 < 0 {
				x0 = 0
			}
			x1 := x0 + 1
			if x1 >= sw {
				x1 = sw - 1
			}
			fx := sx - float64(x0)
			if fx < 0 {
				fx = 0
			}
			r00, g00, b00, _ := src.At(srcBounds.Min.X+x0, srcBounds.Min.Y+y0).RGBA()
			r10, g10, b10, _ := src.At(srcBounds.Min.X+x1, srcBounds.Min.Y+y0).RGBA()
			r01, g01, b01, _ := src.At(srcBounds.Min.X+x0, srcBounds.Min.Y+y1).RGBA()
			r11, g11, b11, _ := src.At(srcBounds.Min.X+x1, srcBounds.Min.Y+y1).RGBA()
			offset := dst.PixOffset(dstBounds.Min.X+x, dstBounds.Min.Y+y)
			dst.Pix[offset] = clamp8(bilerp(float64(r00), float64(r10), float64(r01), float64(r11), fx, fy))
			dst.Pix[offset+1] = clamp8(bilerp(float64(g00), float64(g10), float64(g01), float64(g11), fx, fy))
			dst.Pix[offset+2] = clamp8(bilerp(float64(b00), float64(b10), float64(b01), float64(b11), fx, fy))
			dst.Pix[offset+3] = 255
		}
	}
}

func bilerp(v00, v10, v01, v11, fx, fy float64) float64 {
	top := v00*(1-fx) + v10*fx
	bottom := v01*(1-fx) + v11*fx
	return top*(1-fy) + bottom*fy
}

// clamp8 把 16 位色深（0–65535）的插值结果转成 8 位（0–255）。
func clamp8(value float64) uint8 {
	value = value / 257.0
	if value < 0 {
		return 0
	}
	if value > 255 {
		return 255
	}
	return uint8(value + 0.5)
}

// generateResourceThumbnail 为单个资源生成并上传缩略图，成功后回写资源字段。
// 由上传就绪路径异步调用；任何失败都只标记 failed，不阻塞主流程。
func (s *Service) generateResourceThumbnail(resource *model.Resource) {
	if resource == nil || resource.Kind != "image" {
		return
	}
	if !strings.HasPrefix(strings.ToLower(resource.MimeType), "image/") {
		return
	}
	if resource.ThumbnailStatus == model.ThumbnailStatusReady {
		return
	}
	setting, err := s.ossSettingForResource(resource.UserID, resource)
	if err != nil {
		s.markThumbnailFailed(resource)
		return
	}
	objectKey := thumbnailObjectKey(resource.ObjectKey)
	if objectKey == "" {
		s.markThumbnailFailed(resource)
		return
	}

	original, err := readResourceContent(setting, resource.ObjectKey)
	if err != nil {
		s.markThumbnailFailed(resource)
		return
	}
	thumb, width, height, err := buildThumbnail(original)
	if err != nil {
		s.markThumbnailFailed(resource)
		return
	}
	if thumb == nil {
		// 原图本身够小，不生成副本；置 none 让 variant 回落原图。
		// 单列更新：与冷备任务并行运行，整行回写会覆盖对方刚写好的状态。
		resource.ThumbnailStatus = model.ThumbnailStatusNone
		resource.ThumbnailWidth = width
		resource.ThumbnailHeight = height
		_, _ = s.repo.UpdateResourceThumbnail(resource.UserID, resource.ID, map[string]any{
			"thumbnail_status": resource.ThumbnailStatus,
			"thumbnail_width":  resource.ThumbnailWidth,
			"thumbnail_height": resource.ThumbnailHeight,
			"updated_at":       time.Now(),
		})
		return
	}
	if _, err := storage.PutS3Object(setting, objectKey, "image/jpeg", int64(len(thumb)), bytes.NewReader(thumb)); err != nil {
		s.markThumbnailFailed(resource)
		return
	}
	resource.ThumbnailStatus = model.ThumbnailStatusReady
	resource.ThumbnailMimeType = "image/jpeg"
	resource.ThumbnailSize = int64(len(thumb))
	resource.ThumbnailWidth = width
	resource.ThumbnailHeight = height
	// 单列更新而非整行 SaveResource：缩略图与冷备是并行异步任务，各自持有
	// 启动时的快照；整行回写会把冷备刚写好的 cold_backup_status=ready 覆盖
	// 回空值（生产已实际发生）。只更新缩略图相关列，互不踩踏。
	_, _ = s.repo.UpdateResourceThumbnail(resource.UserID, resource.ID, map[string]any{
		"thumbnail_status":    resource.ThumbnailStatus,
		"thumbnail_mime_type": resource.ThumbnailMimeType,
		"thumbnail_size":      resource.ThumbnailSize,
		"thumbnail_width":     resource.ThumbnailWidth,
		"thumbnail_height":    resource.ThumbnailHeight,
		"updated_at":          time.Now(),
	})
}

// readResourceContent 读出资源完整字节，供缩略图处理使用。
func readResourceContent(setting ossSettingValue, objectKey string) ([]byte, error) {
	stream, err := storage.GetS3ObjectRange(setting, objectKey, "")
	if err != nil {
		return nil, err
	}
	defer stream.Body.Close()
	// 缩略图源图正常在几十 MB 以内，加个上限避免异常大对象把内存打爆。
	const maxSourceBytes = 128 << 20
	return io.ReadAll(io.LimitReader(stream.Body, maxSourceBytes))
}

func (s *Service) markThumbnailFailed(resource *model.Resource) {
	if resource == nil {
		return
	}
	resource.ThumbnailStatus = model.ThumbnailStatusFailed
	// 单列更新：理由同上，避免覆盖并行冷备任务的状态字段。
	_, _ = s.repo.UpdateResourceThumbnail(resource.UserID, resource.ID, map[string]any{
		"thumbnail_status": model.ThumbnailStatusFailed,
		"updated_at":       time.Now(),
	})
}
