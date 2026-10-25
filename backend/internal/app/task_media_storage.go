package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"io"
	"io/fs"
	"math"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"yingce/backend/internal/model"
)

const mediaStagingBudget int64 = 512 << 20

var errMediaStagingBusy = errors.New("当前账号的作品暂存额度不足，请先恢复保存或联系管理员处理失败作品")
var errMediaStagingGlobalBusy = errors.New("服务器作品暂存空间不足，请联系管理员处理")

var mediaStagingMu sync.Mutex

// Reserve the maximum response size before opening a file. Temporary files are
// sparse reservations, so concurrent downloads cannot oversubscribe this budget.
func (s *Service) newMediaTemp(userID string, limit int64) (*os.File, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, errors.New("作品暂存缺少账号")
	}
	mediaStagingMu.Lock()
	defer mediaStagingMu.Unlock()
	sum := sha256.Sum256([]byte(userID))
	account := hex.EncodeToString(sum[:])
	root := filepath.Join(s.dataDir, "media-staging")
	dir := filepath.Join(root, account)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	var used, total int64
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if os.IsNotExist(walkErr) {
			return nil
		}
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() || !entry.Type().IsRegular() || !strings.HasPrefix(entry.Name(), "result-") {
			return nil
		}
		info, err := entry.Info()
		if os.IsNotExist(err) {
			return nil
		}
		if err != nil {
			return err
		}
		total += info.Size()
		if filepath.Dir(path) == dir {
			used += info.Size()
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	userBudget := int64(mediaEnvLimit("CANVAS_MEDIA_STAGING_USER_MB", 1024, 102400)) << 20
	totalBudget := int64(mediaEnvLimit("CANVAS_MEDIA_STAGING_TOTAL_MB", 4096, 1048576)) << 20
	if limit <= 0 || limit > mediaStagingBudget || used > userBudget-limit {
		return nil, errMediaStagingBusy
	}
	if total > totalBudget-limit {
		return nil, errMediaStagingGlobalBusy
	}
	file, err := os.CreateTemp(dir, "result-*")
	if err != nil {
		return nil, err
	}
	if err := file.Truncate(limit); err != nil {
		file.Close()
		os.Remove(file.Name())
		return nil, err
	}
	return file, nil
}

func (s *Service) stageInlineMedia(userID string, data []byte) (string, error) {
	if len(data) == 0 {
		return "", errors.New("上游返回空作品")
	}
	file, err := s.newMediaTemp(userID, int64(len(data)))
	if err != nil {
		return "", err
	}
	_, err = file.Write(data)
	if err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		os.Remove(file.Name())
		return "", err
	}
	name, err := filepath.Rel(filepath.Join(s.dataDir, "media-staging"), file.Name())
	return filepath.ToSlash(name), err
}

func (s *Service) downloadTaskMedia(ctx context.Context, userID string, config providerConfig, url, mode string) (name, mimeType string, err error) {
	policy, err := s.RuntimePolicy()
	if err != nil {
		return "", "", err
	}
	limit := min(megabytes(policy.Resource.GeneratedFileMB), mediaStagingBudget)
	downloadCtx, cancel := context.WithTimeout(withProviderRequestKind(ctx, "download"), 3*time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(downloadCtx, http.MethodGet, url, nil)
	if err != nil {
		return "", "", err
	}
	started := time.Now()
	statusCode := 0
	defer func() {
		// Signed paths and net/url errors can contain bearer credentials. Keep
		// the real error for retry classification, never in request logs.
		logged := req.Clone(req.Context())
		redactedURL := *req.URL
		redactedURL.Path, redactedURL.RawPath, redactedURL.RawQuery, redactedURL.Fragment = "/task-media", "", "", ""
		redactedURL.User = nil
		logged.URL = &redactedURL
		var safeErr error
		if err != nil {
			safeErr = errors.New("结果下载失败")
		}
		recordProviderRequest(logged, started, statusCode, nil, safeErr)
	}()
	if _, err = ValidateOutboundURL(url); err != nil {
		return "", "", err
	}
	if sameProviderOrigin(config.BaseURL, url) {
		applyProviderAuth(req, config)
		ApplyOutboundHeaders(req, config.Headers)
	}
	ApplyDefaultOutboundHeaders(req)
	// 结果文件可能托管在渠道同域（sameProviderOrigin 时还带渠道鉴权），
	// 渠道配置了出站代理时下载必须走同一代理，否则配代理渠道的结果无法取回。
	proxyURL := ""
	if metadata, ok := ctx.Value(providerAnalyticsKey{}).(providerAnalyticsContext); ok {
		proxyURL = metadata.ProxyURL
	}
	if strings.TrimSpace(proxyURL) == "" && strings.TrimSpace(config.ChannelID) != "" {
		if ch, err := s.repo.SystemChannel(config.ChannelID); err == nil {
			proxyURL = ch.ProxyURL
		}
	}
	response, err := OutboundHTTPClientWithProxy(3*time.Minute, proxyURL).Do(req)
	if err != nil {
		return "", "", err
	}
	defer response.Body.Close()
	statusCode = response.StatusCode
	if statusCode < 200 || statusCode >= 300 {
		return "", "", providerHTTPError{StatusCode: statusCode, Status: response.Status, RetryAfter: parseRetryAfter(response.Header.Get("Retry-After"), time.Now())}
	}
	if response.ContentLength > limit {
		return "", "", errors.New("生成文件超过大小限制")
	}
	if response.ContentLength > 0 {
		limit = response.ContentLength
	}
	file, err := s.newMediaTemp(userID, limit)
	if err != nil {
		return "", "", err
	}
	defer func() {
		_ = file.Close()
		if err != nil {
			_ = os.Remove(file.Name())
		}
	}()
	size, err := io.Copy(file, io.LimitReader(response.Body, limit+1))
	if err != nil {
		return "", "", err
	}
	if size == 0 || size > limit {
		return "", "", errors.New("生成文件为空或超过大小限制")
	}
	if response.ContentLength >= 0 && size != response.ContentLength {
		return "", "", io.ErrUnexpectedEOF
	}
	if err = file.Truncate(size); err != nil {
		return "", "", err
	}
	if _, err = file.Seek(0, io.SeekStart); err != nil {
		return "", "", err
	}
	head := make([]byte, min(size, 512))
	if _, err = io.ReadFull(file, head); err != nil {
		return "", "", err
	}
	mimeType = normalizedMediaMimeType(response.Header.Get("Content-Type"), head)
	if mode == "audio" && mimeType == "application/ogg" {
		mimeType = "audio/ogg"
	}
	if !strings.HasPrefix(mimeType, mode+"/") {
		return "", "", errors.New("上游返回的内容不是有效的" + mode + "媒体")
	}
	if err = file.Sync(); err != nil {
		return "", "", err
	}
	if err = file.Close(); err != nil {
		return "", "", err
	}
	name, err = filepath.Rel(filepath.Join(s.dataDir, "media-staging"), file.Name())
	return filepath.ToSlash(name), mimeType, err
}

func mediaUploadKey(taskID string, index int) *string {
	sum := sha256.Sum256([]byte(fmt.Sprintf("task-media:%s:%d", taskID, index)))
	key := hex.EncodeToString(sum[:])
	return &key
}

func (s *Service) storeTaskMediaFile(task *model.Task, index int, path, mimeType, kind string, existing *model.Resource) (*model.Resource, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, errors.New("暂存作品不是普通文件")
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	info, err = file.Stat()
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, errors.New("暂存作品不是普通文件")
	}
	width, height := 0, 0
	durationMs := int64(0)
	if kind == "image" {
		config, _, err := image.DecodeConfig(file)
		if err != nil {
			// The standard library does not decode WebP/AVIF. Verify their
			// container signatures instead of trusting a response MIME header.
			head := make([]byte, 64)
			n, _ := file.ReadAt(head, 0)
			head = head[:n]
			webp := mimeType == "image/webp" && n >= 12 && string(head[:4]) == "RIFF" && string(head[8:12]) == "WEBP"
			avif := mimeType == "image/avif" && n >= 16 && string(head[4:8]) == "ftyp" && (strings.Contains(string(head[8:]), "avif") || strings.Contains(string(head[8:]), "avis"))
			if !webp && !avif {
				return nil, fmt.Errorf("图片内容校验失败：%w", err)
			}
		}
		width, height = config.Width, config.Height
		if _, err := file.Seek(0, io.SeekStart); err != nil {
			return nil, err
		}
	} else if kind == "audio" || kind == "video" {
		// Audio and video-processing duration is the source of truth for per-second
		// settlement. The media can still be saved when ffprobe is unavailable;
		// settlement then falls back to provider usage or moves the order to review.
		durationMs = probeMediaDurationMs(path)
	}
	day, err := s.reserveGeneratedResourceQuota(task.UserID, info.Size())
	if err != nil {
		return nil, err
	}
	committed := false
	defer func() {
		if !committed {
			s.releaseUserUploadQuota(task.UserID, day, info.Size())
		}
	}()
	var resource *model.Resource
	if existing == nil {
		resource, _, err = s.storeResourceWithWriter(task.UserID, kind, "generated."+extensionFromMimeType(mimeType), mimeType, info.Size(), width, height, durationMs, file, mediaUploadKey(task.ID, index), false, s.storeTaskMediaObject)
	} else {
		// Reuse the same object key after a failed upload; no orphan per retry.
		resource = existing
		if resource.UserID != task.UserID || resource.Size != info.Size() || resource.MimeType != mimeType {
			return nil, errors.New("恢复文件与原始资源不一致")
		}
		resource.DurationMs = durationMs
		resource.ETag, err = s.storeTaskMediaObject(resource, "generated."+extensionFromMimeType(mimeType), file)
		if err == nil {
			resource.Status, resource.Error, resource.UpdatedAt = model.ResourceStatusReady, "", time.Now()
			err = s.saveResourceWithinStorageLimit(resource, "")
		}
	}
	if err != nil {
		return nil, err
	}
	s.commitUserUploadQuota(task.UserID, info.Size())
	committed = true
	if existing != nil {
		s.recordActivity(task.UserID, "resource", 1)
		s.maybeStartPlaybackTranscode(resource)
	}
	return resource, nil
}

func probeMediaDurationMs(path string) int64 {
	if strings.TrimSpace(path) == "" {
		return 0
	}
	if _, err := exec.LookPath("ffprobe"); err != nil {
		return 0
	}
	output, err := exec.Command("ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path).Output()
	if err != nil {
		return 0
	}
	seconds, err := strconv.ParseFloat(strings.TrimSpace(string(output)), 64)
	if err != nil || seconds <= 0 || math.IsNaN(seconds) || math.IsInf(seconds, 0) {
		return 0
	}
	return int64(math.Ceil(seconds * 1000))
}

// Unlike ordinary uploads, generated output preserves an OSS failure for
// explicit recovery instead of silently changing the storage destination.
func (s *Service) storeTaskMediaObject(resource *model.Resource, _ string, body io.Reader) (string, error) {
	if resource.Provider == "local" {
		return "", writeLocalResourceObject(filepath.Join(s.dataDir, "resources", filepath.FromSlash(resource.ObjectKey)), body)
	}
	setting, err := s.ossSettingForResource(resource.UserID, resource)
	if err != nil {
		return "", err
	}
	return putOSSObject(s.storageSettingWithRuntimePolicy(setting), resource.ObjectKey, resource.MimeType, resource.Size, body)
}

// Cleanup is best effort only after durable completion. Expired leftovers are
// also collected on staging allocation, never by deleting resource objects.
func (s *Service) cleanupMediaCheckpointFiles(task *model.Task) {
	checkpoint, err := s.decodeMediaCheckpoint(task)
	if err != nil {
		return
	}
	for _, item := range checkpoint.Items {
		if path := s.mediaTempPath(item.TempName); path != "" {
			if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
				_ = s.log(task.UserID, task.ID, "warn", "清理作品暂存文件失败", "")
			}
		}
	}
}
