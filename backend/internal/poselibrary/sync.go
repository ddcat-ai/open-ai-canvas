package poselibrary

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/outbound"
)

type SyncRequest struct {
	Limit       int  `json:"limit"`
	RetryFailed bool `json:"retryFailed"`
}

type SyncFailure struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Message string `json:"message"`
}

type SyncResult struct {
	Processed int           `json:"processed"`
	Succeeded int           `json:"succeeded"`
	Failed    int           `json:"failed"`
	Failures  []SyncFailure `json:"failures,omitempty"`
	Stats     Stats         `json:"stats"`
}

// SyncImages 下载一批待同步条目的图片到本站数据目录。
// 管理页循环调用直到 pending 为 0（RetryFailed 只在第一批传入）；每批有时间预算，单个请求不会长时间占住连接。
// 并发调用最多重复下载同一条目，文件按临时文件改名写入，不会产生半张图。
func (s *Service) SyncImages(ctx context.Context, actor *model.User, req SyncRequest) (*SyncResult, error) {
	if err := s.admin.RequireAdmin(actor); err != nil {
		return nil, err
	}
	limit := req.Limit
	if limit <= 0 {
		limit = defaultSyncSize
	}
	limit = min(limit, maxSyncSize)
	if req.RetryFailed {
		// 重试先把失败条目整体放回待同步，后续批次只取待同步：再次失败的条目不会在同一轮里被反复领取。
		if _, err := s.repo.RequeueFailedPoseLibraryItems(); err != nil {
			return nil, err
		}
	}
	items, err := s.repo.PoseLibraryItemsForSync(limit)
	if err != nil {
		return nil, err
	}
	result := &SyncResult{}
	deadline := time.Now().Add(syncBudget)
	queue := make(chan model.PoseLibraryItem)
	var mu sync.Mutex
	var wg sync.WaitGroup
	for worker := 0; worker < min(syncWorkers, len(items)); worker++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for item := range queue {
				syncErr := s.syncItem(ctx, item)
				mu.Lock()
				result.Processed++
				if syncErr == nil {
					result.Succeeded++
				} else {
					result.Failed++
					if len(result.Failures) < 5 {
						result.Failures = append(result.Failures, SyncFailure{ID: item.ID, Name: item.Name, Message: syncErr.Error()})
					}
				}
				mu.Unlock()
			}
		}()
	}
	for _, item := range items {
		if ctx.Err() != nil || time.Now().After(deadline) {
			break
		}
		queue <- item
	}
	close(queue)
	wg.Wait()
	stats, err := s.stats()
	if err != nil {
		return nil, err
	}
	result.Stats = stats
	return result, nil
}

func (s *Service) syncItem(ctx context.Context, item model.PoseLibraryItem) error {
	original, thumb, err := s.fetchItemImages(ctx, item)
	if err != nil {
		if ctx.Err() != nil {
			// 请求被取消时保持待同步，不把网络中断记成条目失败。
			return ctx.Err()
		}
		if _, saveErr := s.repo.UpdatePoseLibraryItem(item.ID, map[string]any{"status": model.PoseLibraryStatusFailed, "error": clip(err.Error(), 300), "updated_at": time.Now()}); saveErr != nil {
			return errors.Join(err, saveErr)
		}
		return err
	}
	return s.storeItemImages(item.ID, original, thumb)
}

// storeItemImages 写入原图和缩略图并把条目标记为就绪；条目在写入期间被删除时清掉刚写的文件。
func (s *Service) storeItemImages(itemID string, original storedImage, thumb storedImage) error {
	imageFile, err := s.writeItemFile(itemID, "image", original)
	if err != nil {
		return err
	}
	thumbFile, err := s.writeItemFile(itemID, "thumb", thumb)
	if err != nil {
		return err
	}
	digest := sha256.Sum256(original.data)
	now := time.Now()
	affected, err := s.repo.UpdatePoseLibraryItem(itemID, map[string]any{
		"status": model.PoseLibraryStatusReady, "error": "",
		"image_file": imageFile, "image_mime": original.mime, "image_sha256": hex.EncodeToString(digest[:]), "image_bytes": int64(len(original.data)),
		"thumb_file": thumbFile, "thumb_mime": thumb.mime, "width": original.width, "height": original.height,
		"synced_at": now, "updated_at": now,
	})
	if err != nil {
		return err
	}
	if affected == 0 {
		if removeErr := s.removeItemFiles(itemID); removeErr != nil {
			log.Printf("pose library: remove files of deleted item %s failed: %v", itemID, removeErr)
		}
	}
	return nil
}

func (s *Service) fetchItemImages(ctx context.Context, item model.PoseLibraryItem) (storedImage, storedImage, error) {
	data, err := s.download(ctx, item.RemoteImage, MaxImageBytes)
	if err != nil {
		return storedImage{}, storedImage{}, fmt.Errorf("原图：%w", err)
	}
	if contentType := http.DetectContentType(data); !strings.HasPrefix(contentType, "image/") {
		// 静态站常把不存在的路径回退成首页 HTML，这里给出能定位问题的提示。
		return storedImage{}, storedImage{}, fmt.Errorf("原图：来源返回的不是图片（%s），请检查来源地址和图片路径", strings.Split(contentType, ";")[0])
	}
	original, err := inspectImage(data)
	if err != nil {
		return storedImage{}, storedImage{}, fmt.Errorf("原图：%w", err)
	}
	if item.RemoteThumb != "" {
		if data, err := s.download(ctx, item.RemoteThumb, maxThumbBytes); err == nil {
			if thumb, err := inspectImage(data); err == nil {
				return original, thumb, nil
			}
		} else if ctx.Err() != nil {
			return storedImage{}, storedImage{}, ctx.Err()
		}
		// 缩略图缺失或损坏不影响使用，下面用原图生成。
	}
	thumb, err := makeThumbnail(original)
	if err != nil {
		return storedImage{}, storedImage{}, fmt.Errorf("生成缩略图：%w", err)
	}
	return original, thumb, nil
}

func (s *Service) download(ctx context.Context, rawURL string, maxBytes int64) ([]byte, error) {
	parsed, err := validateOutboundURL(rawURL)
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return nil, err
	}
	outbound.ApplyDefaultOutboundHeaders(request)
	response, err := s.client.Do(request)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return nil, errors.New("下载超时")
		}
		return nil, errors.New("下载失败，请确认服务器能访问图片来源地址")
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("来源返回 %s", response.Status)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxBytes+1))
	if err != nil {
		return nil, errors.New("读取图片失败")
	}
	if int64(len(data)) > maxBytes {
		return nil, kernel.BadAuthRequest(fmt.Sprintf("图片超过 %d MB", maxBytes>>20))
	}
	return data, nil
}
