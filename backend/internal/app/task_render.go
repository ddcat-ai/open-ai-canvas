package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"yingce/backend/internal/model"
)

const renderFfmpegEnv = "CANVAS_FFMPEG_PATH"

// processTimelineRender 执行时间线渲染：按快照把引用的媒体落盘 →
// ffprobe 探测音轨 → ffmpeg concat 合成 → 产物写入资源存储。
// 渲染是本地重编码，不经模型路由与计费；失败一律落明确终态。
func (w *taskWorkerCoordinator) processTimelineRender(task *model.Task, ctx context.Context) error {
	s := w.service
	ffmpegBin, err := renderFfmpegBinary()
	if err != nil {
		return w.failTimelineTask(task, "合成环境不可用", err.Error())
	}
	var input timelineRenderInput
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		return w.failTimelineTask(task, "合成输入无效", "任务缺少有效的时间线快照")
	}
	plan := buildRenderPlan(input.Timeline)
	if !plan.HasMedia {
		return w.failTimelineTask(task, "合成输入无效", "时间线没有可渲染的媒体片段")
	}

	if err := w.progress(task, "准备媒体…", 10); err != nil {
		return err
	}
	workDir, cleanup, err := materializeRenderSources(ctx, s, task.UserID, &plan)
	if cleanup != nil {
		defer cleanup()
	}
	if err != nil {
		return w.failTimelineTask(task, "准备合成素材失败", "准备合成素材失败："+renderFailureReason(err))
	}
	plan.PropagateID = task.ID
	for _, seg := range plan.Segments {
		if seg.Source == nil || seg.Kind == "image" {
			continue
		}
		hasAudio, probeErr := probeHasAudioStream(ctx, seg.Source.Path)
		if probeErr != nil {
			return w.failTimelineTask(task, "检测素材音轨失败", "检测素材音轨失败："+renderFailureReason(probeErr))
		}
		seg.Source.HasAudio = hasAudio
	}

	args := buildRenderFFmpegArgs(plan, filepath.Join(workDir, "render-output.mp4"))
	if len(args) == 0 {
		return w.failTimelineTask(task, "渲染失败", "无法生成渲染命令")
	}
	if err := w.progress(task, "正在渲染…", 30); err != nil {
		return err
	}
	cmd := exec.CommandContext(ctx, ffmpegBin, args...)
	cmd.Dir = workDir
	output, runErr := cmd.CombinedOutput()
	if runErr != nil {
		detail := strings.TrimSpace(string(output))
		if len(detail) > 400 {
			detail = detail[len(detail)-400:]
		}
		return w.failTimelineTask(task, "渲染失败", fmt.Sprintf("ffmpeg 渲染失败：%s", detail))
	}

	if err := w.progress(task, "写入资源…", 85); err != nil {
		return err
	}
	renderedPath := filepath.Join(workDir, "render-output.mp4")
	file, err := os.Open(renderedPath)
	if err != nil {
		return w.failTimelineTask(task, "读取成片失败", "视频已合成，但读取成片失败："+renderFailureReason(err))
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil {
		return w.failTimelineTask(task, "检查成片失败", "视频已合成，但检查成片文件失败："+renderFailureReason(err))
	}
	if stat.Size() == 0 {
		return w.failTimelineTask(task, "合成产物为空", "合成输出文件为空，请重试合成")
	}
	durationMs := planDurationMs(plan)
	fileName := fmt.Sprintf("timeline-render-%s.mp4", time.Now().Format("20060102-150405"))
	outWidth, outHeight := plan.size()
	resource, _, err := s.storeResource(task.UserID, "media", fileName, "video/mp4", stat.Size(), outWidth, outHeight, durationMs, file, nil, false)
	if err != nil || resource == nil {
		return w.failTimelineTask(task, "保存成片失败", renderSaveFailureMessage(err))
	}

	result := timelineRenderOutput{
		timelineRenderResult: timelineRenderResult{
			ResourceID:  resource.ID,
			FileName:    fileName,
			Size:        stat.Size(),
			DurationMs:  durationMs,
			SubtitleSRT: plan.SubtitleSRT,
		},
		Width:   outWidth,
		Height:  outHeight,
		Fit:     plan.Fit,
		AIGC:    renderAIGCJSON(plan),
		Sources: renderSourceRecords(plan),
	}
	payload, err := json.Marshal(result)
	if err != nil {
		return w.failTimelineTask(task, "登记成片结果失败", "成片已保存，但登记结果失败，请联系管理员检查任务记录")
	}
	task.Status = model.TaskStatusSucceeded
	task.Stage = "渲染完成"
	task.Progress = 100
	task.ResultJSON = string(payload)
	completedAt := time.Now()
	task.CompletedAt = &completedAt
	if err := s.repo.SaveTaskCompletion(task, model.TaskStatusRunning, nil); err != nil {
		return fmt.Errorf("写入渲染完成态失败: %w", err)
	}
	s.logInfo(task.UserID, task.ID, fmt.Sprintf("时间线渲染完成，时长 %.1fs", float64(durationMs)/1000), "")
	return nil
}

func renderSaveFailureMessage(err error) string {
	step := "保存成片失败"
	var writeErr *resourceObjectWriteError
	if errors.As(err, &writeErr) {
		if writeErr.provider == "local" {
			step = "写入服务器本地存储失败"
		} else {
			step = "上传对象存储（OSS/S3）失败"
		}
	}
	reason := strings.TrimRight(renderFailureReasonWithFallback(err, "存储返回未分类的错误，请管理员检查存储配置及资源记录"), "。.")
	return "视频已合成，但" + step + "：" + reason + "。已有镜头无需重新生成；请处理保存问题后重试合成。"
}

func renderFailureReason(err error) string {
	return renderFailureReasonWithFallback(err, truncateRunes(redactUpstreamAddress(safeProviderLogError(err)), 300))
}

func renderFailureReasonWithFallback(err error, fallback string) string {
	var networkErr net.Error
	var pathErr *os.PathError
	var appErr *AppError
	switch {
	case err == nil:
		return "存储未返回有效的成片记录"
	case errors.As(err, &appErr) && strings.TrimSpace(appErr.Message) != "":
		// 业务错误的文案本来就给用户看（如账号文件容量不足），比“未分类的存储错误”更能说明怎么处理。
		return strings.TrimSpace(appErr.Message)
	case errors.Is(err, io.EOF), errors.Is(err, io.ErrUnexpectedEOF):
		return "传输连接意外中断（EOF），请检查服务器到存储服务的网络连接"
	case errors.Is(err, context.DeadlineExceeded), errors.As(err, &networkErr) && networkErr.Timeout():
		return "请求超时，请检查网络连接及存储服务是否可用"
	case errors.Is(err, syscall.ENOSPC):
		return "服务器磁盘空间不足，请清理空间"
	case errors.Is(err, os.ErrPermission):
		return "文件访问权限不足，请检查存储目录权限"
	case errors.As(err, &pathErr):
		return renderFailureReasonWithFallback(pathErr.Err, fallback)
	case strings.Contains(strings.ToLower(err.Error()), "database is locked"):
		// SQLite 驱动的原文通常带错误码后缀，如 “database is locked (5) (SQLITE_BUSY)”。
		return "数据库正忙，请稍后重试"
	default:
		return fallback
	}
}

// timelineRenderOutput 是渲染任务写入 ResultJSON 的完整结构：在 timelineRenderResult 的字段之外
// 记录输出画幅、请求的适配模式、写入成片的 AIGC 标识，以及逐片段的来源与实际适配方式。
// 读取方（如短剧成片）仍按 timelineRenderResult 解码，新增字段对其透明。
type timelineRenderOutput struct {
	timelineRenderResult
	Width   int                  `json:"width"`
	Height  int                  `json:"height"`
	Fit     string               `json:"fit"`
	AIGC    string               `json:"aigc,omitempty"`
	Sources []renderSourceRecord `json:"sources,omitempty"`
}

// renderAIGCTagMaxBytes 限制从来源文件读取的 AIGC 标签长度；超长视为无效，不写入结果。
const renderAIGCTagMaxBytes = 4096

func planDurationMs(plan renderPlan) int64 {
	var total int64
	for _, seg := range plan.Segments {
		total += seg.DurationMs
	}
	return total
}

func renderFfmpegBinary() (string, error) {
	if configured := strings.TrimSpace(os.Getenv(renderFfmpegEnv)); configured != "" {
		return configured, nil
	}
	path, err := exec.LookPath("ffmpeg")
	if err != nil {
		return "", fmt.Errorf("后端未安装 ffmpeg（安装后重试，或通过 %s 指定路径）", renderFfmpegEnv)
	}
	return path, nil
}

// renderSourceFile 是落盘后的一份来源媒体及其探测结果，同资源的多个片段共用。
type renderSourceFile struct {
	path          string
	width, height int
	aigc          string
}

// materializeRenderSources 把计划中每个媒体片段对应的资源下载到临时目录，
// 同资源复用同一份本地文件；返回工作目录与清理函数。
// 每份文件探测一次显示尺寸（决定裁切还是留边）与容器 AIGC 标签；探测不可用时沿用资源记录的尺寸。
func materializeRenderSources(ctx context.Context, s *Service, userID string, plan *renderPlan) (string, func(), error) {
	tmpDir, err := os.MkdirTemp("", "yingce-render-*")
	if err != nil {
		return "", nil, fmt.Errorf("创建临时目录失败: %w", err)
	}
	cleanup := func() { _ = os.RemoveAll(tmpDir) }
	cache := map[string]renderSourceFile{}
	segments := make([]*renderSegment, 0, len(plan.Segments)+len(plan.AudioOverlays))
	for i := range plan.Segments {
		segments = append(segments, &plan.Segments[i])
	}
	for i := range plan.AudioOverlays {
		segments = append(segments, &plan.AudioOverlays[i])
	}
	for _, seg := range segments {
		resourceID, ok := mediaResourceID(seg.Clip)
		if !ok {
			// 无可用媒体引用时渲染为黑场段，保证时间轴连续。
			continue
		}
		entry, cached := cache[resourceID]
		if !cached {
			resource, reader, err := s.OpenResource(userID, resourceID)
			if err != nil || reader == nil {
				cleanup()
				return "", nil, fmt.Errorf("无法读取时间线引用的媒体，可能已被删除")
			}
			// 扩展名决定 ffmpeg 的解复用器；图片以 .mp4 命名会让 -loop 输入失败。
			ext := extForMime(resource.MimeType)
			if strings.HasPrefix(resource.MimeType, "image/") {
				ext = "." + strings.TrimPrefix(strings.SplitN(resource.MimeType, ";", 2)[0], "image/")
			}
			path := filepath.Join(tmpDir, fmt.Sprintf("src-%d%s", len(cache), ext))
			file, err := os.Create(path)
			if err != nil {
				reader.Close()
				cleanup()
				return "", nil, fmt.Errorf("写入临时媒体失败: %w", err)
			}
			if _, err := io.Copy(file, reader); err != nil {
				file.Close()
				reader.Close()
				cleanup()
				return "", nil, fmt.Errorf("读取时间线媒体失败: %w", err)
			}
			file.Close()
			reader.Close()
			entry = renderSourceFile{path: path, width: max(resource.Width, 0), height: max(resource.Height, 0)}
			if info, probeErr := probeMediaFile(ctx, path); probeErr == nil {
				if info.Width > 0 && info.Height > 0 {
					entry.width, entry.height = info.Width, info.Height
				}
				if tag := mediaProbeTag(info.Tags, "AIGC"); len(tag) <= renderAIGCTagMaxBytes {
					entry.aigc = tag
				}
			}
			cache[resourceID] = entry
		}
		seg.Source = &renderSource{ResourceID: resourceID, Clip: seg.Clip, Path: entry.path, Ext: filepath.Ext(entry.path), Width: entry.width, Height: entry.height, AIGC: entry.aigc}
	}
	return tmpDir, cleanup, nil
}

// probeHasAudioStream 用 ffprobe 判断媒体是否含音轨，供滤镜图选择静音回退。
func probeHasAudioStream(ctx context.Context, path string) (bool, error) {
	bin, err := exec.LookPath("ffprobe")
	if err != nil {
		return false, fmt.Errorf("媒体探测依赖未安装（需要 ffprobe）")
	}
	cmd := exec.CommandContext(ctx, bin,
		"-v", "error", "-select_streams", "a:0", "-show_entries", "stream=index",
		"-of", "csv=p=0", path)
	output, runErr := cmd.Output()
	if runErr != nil {
		// 探测失败按无音轨处理，渲染仍可产出静音视频。
		return false, nil
	}
	return strings.TrimSpace(string(output)) != "", nil
}
