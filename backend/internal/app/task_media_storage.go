package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"io"
	"log/slog"
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
const mediaStagingTTL = 24 * time.Hour

// 单次结果下载的时限：上游慢但一直在传输时允许跑完，长时间收不到任何字节才判定卡住。
// 原来的固定 3 分钟总时限会让慢速结果服务器上的大图永远下载不完——每次重试都从零开始，
// 又在差不多同一位置超时。总时限仍有上限，避免一个下载长期占住有限的保存并发槽位。
var (
	mediaDownloadMaxDuration  = 15 * time.Minute
	mediaDownloadStallTimeout = 90 * time.Second
)

// errMediaDownloadStalled 包装 DeadlineExceeded，保证停滞与总超时一样按可重试的保存失败处理。
var errMediaDownloadStalled = fmt.Errorf("结果下载长时间没有进度：%w", context.DeadlineExceeded)

// mediaDownloadProgress 每收到一段数据就重置停滞计时。
type mediaDownloadProgress struct {
	reader io.Reader
	stall  *time.Timer
}

func (p mediaDownloadProgress) Read(buffer []byte) (int, error) {
	n, err := p.reader.Read(buffer)
	if n > 0 {
		p.stall.Reset(mediaDownloadStallTimeout)
	}
	return n, err
}

// mediaDownloadError 把停滞看门狗触发的取消还原成可识别的停滞错误；其他取消（任务租约失效、
// 服务停止）保持原样，不能被误判成上游问题。
func mediaDownloadError(ctx context.Context, err error) error {
	if cause := context.Cause(ctx); errors.Is(cause, errMediaDownloadStalled) {
		return cause
	}
	return err
}

// mediaDownloadLogError 是写进请求明细的脱敏原因：不含地址与签名，只区分卡住、超时与其他失败。
func mediaDownloadLogError(err error) error {
	switch {
	case errors.Is(err, errMediaDownloadStalled):
		return errors.New("结果下载长时间没有进度")
	case errors.Is(err, context.DeadlineExceeded):
		return errors.New("结果下载超时")
	default:
		return errors.New("结果下载失败")
	}
}

// mediaStagingRetainedTTL 是未完成作品检查点仍引用的暂存文件的最长保留时间。
const mediaStagingRetainedTTL = 7 * 24 * time.Hour

var mediaStagingMu sync.Mutex

// Reserve the maximum response size before opening a file. Temporary files are
// sparse reservations, so concurrent downloads cannot oversubscribe this budget.
func (s *Service) newMediaTemp(limit int64) (*os.File, error) {
	mediaStagingMu.Lock()
	defer mediaStagingMu.Unlock()
	dir := filepath.Join(s.dataDir, "media-staging")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	var used int64
	var referenced func(string) bool
	for _, entry := range entries {
		if !strings.HasPrefix(entry.Name(), "result-") || !entry.Type().IsRegular() {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return nil, err
		}
		age := time.Since(info.ModTime())
		if age > mediaStagingTTL {
			// 保存未完成的任务可能只剩这一份作品（上游地址已过期），在保留期内不清理。
			if referenced == nil && age <= mediaStagingRetainedTTL {
				referenced = s.referencedMediaStagingNames()
			}
			if age > mediaStagingRetainedTTL || !referenced(entry.Name()) {
				if err := os.Remove(filepath.Join(dir, entry.Name())); err != nil {
					return nil, err
				}
				continue
			}
		}
		used += info.Size()
	}
	if limit <= 0 || limit > mediaStagingBudget || used > mediaStagingBudget-limit {
		return nil, errors.New("作品暂存空间不足，请稍后重试保存")
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

func (s *Service) stageInlineMedia(data []byte) (string, error) {
	if len(data) == 0 {
		return "", errors.New("上游返回空作品")
	}
	file, err := s.newMediaTemp(int64(len(data)))
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
	return filepath.Base(file.Name()), nil
}

func (s *Service) downloadTaskMedia(ctx context.Context, config providerConfig, url, mode string) (name, mimeType string, err error) {
	policy, err := s.RuntimePolicy()
	if err != nil {
		return "", "", err
	}
	limit := min(megabytes(policy.Resource.GeneratedFileMB), mediaStagingBudget)
	deadlineCtx, cancelDeadline := context.WithTimeout(withProviderRequestKind(ctx, "download"), mediaDownloadMaxDuration)
	defer cancelDeadline()
	downloadCtx, cancelStalled := context.WithCancelCause(deadlineCtx)
	defer cancelStalled(nil)
	stall := time.AfterFunc(mediaDownloadStallTimeout, func() { cancelStalled(errMediaDownloadStalled) })
	defer stall.Stop()
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
			safeErr = mediaDownloadLogError(err)
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
	// 客户端总时限与上下文一致；真正决定何时放弃的是停滞看门狗。
	response, err := OutboundHTTPClientWithProxy(mediaDownloadMaxDuration, proxyURL).Do(req)
	if err != nil {
		return "", "", mediaDownloadError(downloadCtx, err)
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
	file, err := s.newMediaTemp(limit)
	if err != nil {
		return "", "", err
	}
	defer func() {
		_ = file.Close()
		if err != nil {
			_ = os.Remove(file.Name())
		}
	}()
	size, err := io.Copy(file, io.LimitReader(mediaDownloadProgress{reader: response.Body, stall: stall}, limit+1))
	if err != nil {
		return "", "", mediaDownloadError(downloadCtx, err)
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
	return filepath.Base(file.Name()), mimeType, nil
}

func mediaUploadKey(taskID string, index int) *string {
	sum := sha256.Sum256([]byte(fmt.Sprintf("task-media:%s:%d", taskID, index)))
	key := hex.EncodeToString(sum[:])
	return &key
}

// storeTaskMediaFile 保存一份暂存作品。fallbackCause 非 nil 表示对象存储写入失败、
// 作品已兜底保存到本地并登记了补传任务。
func (s *Service) storeTaskMediaFile(task *model.Task, index int, path, mimeType, kind string, existing *model.Resource) (resource *model.Resource, fallbackCause error, err error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, nil, errors.New("暂存作品不是普通文件")
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, nil, err
	}
	defer file.Close()
	info, err = file.Stat()
	if err != nil {
		return nil, nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, nil, errors.New("暂存作品不是普通文件")
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
				return nil, nil, fmt.Errorf("图片内容校验失败：%w", err)
			}
		}
		width, height = config.Width, config.Height
		if _, err := file.Seek(0, io.SeekStart); err != nil {
			return nil, nil, err
		}
	} else if kind == "audio" || kind == "video" {
		// Audio and video-processing duration is the source of truth for per-second
		// settlement. The media can still be saved when ffprobe is unavailable;
		// settlement then falls back to provider usage or moves the order to review.
		durationMs = probeMediaDurationMs(path)
	}
	day, err := s.reserveGeneratedResourceQuota(task.UserID, info.Size())
	if err != nil {
		return nil, nil, err
	}
	committed := false
	defer func() {
		if !committed {
			s.releaseUserUploadQuota(task.UserID, day, info.Size())
		}
	}()
	writeObject := s.taskMediaObjectWriter(task, path, &fallbackCause)
	if existing == nil {
		resource, _, err = s.storeResourceWithWriter(task.UserID, kind, "generated."+extensionFromMimeType(mimeType), mimeType, info.Size(), width, height, durationMs, file, mediaUploadKey(task.ID, index), false, writeObject)
	} else {
		// Reuse the same object key after a failed upload; no orphan per retry.
		resource = existing
		if resource.UserID != task.UserID || resource.Size != info.Size() || resource.MimeType != mimeType {
			return nil, nil, errors.New("恢复文件与原始资源不一致")
		}
		resource.DurationMs = durationMs
		resource.ETag, err = writeObject(resource, "generated."+extensionFromMimeType(mimeType), file)
		if err == nil {
			resource.Status, resource.Error, resource.UpdatedAt = model.ResourceStatusReady, "", time.Now()
			err = s.saveResourceWithinStorageLimit(resource, "")
		} else {
			// 保留最近一次的存储错误，管理员排查时不必只看首次失败原因。
			resource.Status, resource.Error, resource.UpdatedAt = model.ResourceStatusFailed, err.Error(), time.Now()
			if saveErr := s.repo.SaveResource(resource); saveErr != nil {
				err = errors.Join(err, fmt.Errorf("记录资源失败状态失败：%w", saveErr))
			}
		}
	}
	if err != nil {
		return nil, nil, err
	}
	s.commitUserUploadQuota(task.UserID, info.Size())
	committed = true
	if existing != nil {
		s.recordActivity(task.UserID, "resource", 1)
		s.maybeStartPlaybackTranscode(resource)
	}
	return resource, fallbackCause, nil
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

// storeTaskMediaObjectContext 直传对象存储。是否改存本地由 taskMediaObjectWriter
// 决定：只有平台存储失败才会兜底，并且总会登记补传任务，不会静默改变存储位置。
func (s *Service) storeTaskMediaObjectContext(ctx context.Context, resource *model.Resource, body io.Reader) (string, error) {
	setting, err := s.ossSettingForResource(resource.UserID, resource)
	if err != nil {
		return "", err
	}
	return putOSSObjectContext(ctx, s.storageSettingWithRuntimePolicy(setting), resource.ObjectKey, resource.MimeType, resource.Size, body)
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

// referencedMediaStagingNames 判断暂存文件是否仍被未完成的作品检查点引用。查询失败时
// 把所有文件都视为仍被引用：宁可多占暂存空间，也不删掉可能是唯一副本的作品。
func (s *Service) referencedMediaStagingNames() func(string) bool {
	tasks, err := s.repo.TasksWithPendingMediaCheckpoint(time.Now().Add(-mediaStagingRetainedTTL))
	if err != nil {
		slog.Warn("media staging reference query failed", "error", err)
		return func(string) bool { return true }
	}
	names := map[string]bool{}
	for index := range tasks {
		checkpoint, err := s.decodeMediaCheckpoint(&tasks[index])
		if err != nil {
			continue
		}
		for _, item := range checkpoint.Items {
			if item.TempName != "" {
				names[item.TempName] = true
			}
		}
	}
	return func(name string) bool { return names[name] }
}
