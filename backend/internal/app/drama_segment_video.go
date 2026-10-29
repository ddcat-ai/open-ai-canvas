package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"gorm.io/gorm"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/production"
)

type dramaRevisionPayload struct {
	Revision int64 `json:"revision"`
	Seconds  int   `json:"seconds,omitempty"`
}

func encodeDramaRevision(revision int64) string {
	b, _ := json.Marshal(dramaRevisionPayload{Revision: revision})
	return string(b)
}

func dramaPromptReady(segment model.DramaSegment) bool {
	return strings.TrimSpace(segment.VideoPromptOverride) != "" || (segment.PromptStatus == model.DramaMediaReady && strings.TrimSpace(segment.VideoPrompt) != "")
}

func dramaSegmentVideoDone(segment model.DramaSegment) bool {
	return segment.VideoStatus == model.DramaMediaReady && segment.VideoResourceID != "" && segment.TailFrameResourceID != ""
}

// dramaVideoWaitReason 说明第 index 段视频为何还不能提交；空串表示调度会提交它。调度与详情页共用。
func dramaVideoWaitReason(settings DramaSettings, p *model.DramaProduction, e *model.DramaEpisode, segments []model.DramaSegment, index int, shots []model.DramaShot, lookup func(string) (model.DramaCast, bool)) string {
	switch {
	case p.Status == model.DramaStatusPaused:
		if reason := strings.TrimSpace(p.PauseReason); reason != "" {
			return "制作已暂停：" + reason
		}
		return "制作已暂停"
	case p.Status != model.DramaStatusRunning:
		return "制作未在运行，点“继续制作”后开始"
	case e.Stage == model.DramaEpisodeQueued || e.Stage == model.DramaEpisodeScript:
		return "等待本集剧本完成"
	case dramaMediaHeld(settings, e):
		return "本集尚未放行生图"
	case settings.ReviewMode == DramaReviewSample && !p.SampleApproved && e.Number != 1:
		return "等待确认第 1 集样片"
	}
	if index > 0 && !settings.parallelVideo() && !dramaSegmentVideoDone(segments[index-1]) {
		return "等待上一段视频生成（需要它的最后一帧）"
	}
	if !dramaPromptReady(segments[index]) {
		return "等待本段视频提示词撰写完成"
	}
	// 未生成的参考图在自动生图或已放行时会被调度排队，同样要等。
	requested := settings.MediaMode != DramaMediaManual || p.AssetsReleased
	if names := dramaReferencesInProgress(segments[index].SegmentIndex, shots, lookup, requested); len(names) > 0 {
		return "等待参考图生成：" + strings.Join(names, "、")
	}
	return ""
}

// dramaReferencesInProgress 返回本段引用、仍在生成的参考图名称。等它们能提升角色一致性；
// 失败、锁定或从未请求的参考图不再等待，提交时改用文字设定（见 prepareDramaSegment）。
func dramaReferencesInProgress(segmentIndex int, shots []model.DramaShot, lookup func(string) (model.DramaCast, bool), unrequestedQueued bool) []string {
	names := []string{}
	seen := map[string]bool{}
	for _, shot := range shots {
		if shot.SegmentIndex != segmentIndex {
			continue
		}
		for _, id := range dramaShotCastIDs(shot) {
			cast, ok := lookup(id)
			if !ok || seen[id] || cast.Locked {
				continue
			}
			seen[id] = true
			if cast.ImageStatus == model.DramaMediaQueued || cast.ImageStatus == model.DramaMediaRunning || (cast.ImageStatus == "" && unrequestedQueued) {
				names = append(names, cast.Name)
			}
		}
	}
	return names
}

func segmentVideoChoice(segment model.DramaSegment, fallback DramaModelChoice) DramaModelChoice {
	var choice DramaModelChoice
	if json.Unmarshal([]byte(segment.VideoModelJSON), &choice) == nil && !choice.Empty() {
		return choice
	}
	return fallback
}

// prepareDramaSegment is shared by the request preview and provider submission.
// Reference numbering remains stable even when a model cannot accept every image.
func (s *Service) prepareDramaSegment(settings DramaSettings, draft dramaSegmentDraft, segment model.DramaSegment, previous *model.DramaSegment, casts map[string]model.DramaCast) (DramaSegmentRequest, []any, error) {
	if settings.parallelVideo() {
		// 并行出片：每段只按参考图独立生成，不带上一段尾帧，也就不依赖上一段完成。
		previous = nil
	}
	profile, err := s.dramaVideoProfile(segmentVideoChoice(segment, settings.Models.Video))
	if err != nil {
		return DramaSegmentRequest{}, nil, err
	}
	screen := profile.screen(settings.AspectRatio)
	request := DramaSegmentRequest{Seconds: production.SnapVideoSeconds(draft.view.DurationMs, profile.Durations), MaxVideoSeconds: profile.maxSeconds(), AspectRatio: settings.AspectRatio, Size: screen.Size, Resolution: screen.Resolution, GenerateAudio: profile.GenerateAudio, References: []DramaSegmentReference{}}
	if draft.view.DurationMs > int64(request.MaxVideoSeconds)*1000 {
		return request, nil, errors.New("剧情段超过所选视频模型的时长上限，请调整分镜时长或重新改编")
	}
	refs := []any{}
	header := []string{}
	if previous != nil {
		request.Operation = "image_to_video"
		request.FirstFramePending = previous.VideoStatus != model.DramaMediaReady || previous.TailFrameResourceID == ""
		if !request.FirstFramePending {
			request.FirstFrameResourceID = previous.TailFrameResourceID
			ref, err := s.dramaResourceReference(previous.TailFrameResourceID, "first-frame", "first_frame")
			if err != nil {
				return request, nil, err
			}
			refs = append(refs, ref)
		}
		header = append(header, "首帧图为上一段视频的最后一帧，不占参考图编号。")
	} else if profile.supports("reference_to_video") {
		request.Operation = "reference_to_video"
	} else {
		request.Operation = "text_to_video"
	}
	if !profile.supports(request.Operation) {
		if request.Operation == "image_to_video" {
			return request, nil, errors.New(profile.continuityIssue(settings))
		}
		return request, nil, fmt.Errorf("所选模型不支持本段所需的 %s", request.Operation)
	}
	capacity := profile.MaxImages
	if previous != nil {
		capacity--
	}
	if request.Operation == "text_to_video" {
		capacity = 0
	}
	// 自动取参考图时按“每段最多参考图”收紧，人物排在最前，优先保证角色一致；手动指定的段只受模型上限约束。
	settingLimited := draft.view.ReferenceMode != "custom" && settings.ReferenceLimit > 0 && settings.ReferenceLimit < capacity
	if settingLimited {
		capacity = settings.ReferenceLimit
	}
	request.ReferenceCapacity, request.ModelMaxImages = max(capacity, 0), profile.MaxImages
	if request.Operation == "text_to_video" && len(draft.view.Request.References) > 0 {
		request.Warning = "所选视频模型不支持参考图生视频，本段按文生视频生成，人物、道具与场景只按文字设定"
	}
	// 没随请求发送的参考图按原因分开列出：未就绪的点名，超出上限的说明是哪种上限。
	var missing, overflow []string
	for _, reference := range draft.view.Request.References {
		cast, exists := casts[reference.CastID]
		if !exists {
			return request, nil, errors.New("剧情段引用的设定不存在")
		}
		reference.ResourceID = cast.ImageResourceID
		reference.Sent = capacity > 0 && cast.ImageStatus == model.DramaMediaReady && cast.ImageResourceID != ""
		if reference.Sent {
			ref, err := s.dramaResourceReference(cast.ImageResourceID, reference.Label, "")
			if err != nil {
				return request, nil, err
			}
			refs = append(refs, ref)
			capacity--
			line := reference.Label + "：" + reference.Name
			if cast.Locked {
				// 用户锁定（含上传）的形象是硬约束，文字设定与图片冲突时以图片为准。
				line += "（已锁定形象：" + map[string]string{"character": "五官、发型、服装", "prop": "外形、材质、颜色", "scene": "空间布局、陈设、光线"}[cast.Kind] + "必须与此图一致，文字描述与图片不符时以图片为准）"
			}
			header = append(header, line)
		} else {
			header = append(header, reference.Label+"（"+reference.Name+"）未附图，请依据文字设定："+firstNonEmpty(cast.Appearance, cast.Description))
			ready := cast.ImageStatus == model.DramaMediaReady && cast.ImageResourceID != ""
			switch {
			case !ready:
				missing = append(missing, reference.Label+" "+reference.Name+"（"+dramaCastImageState(cast)+"）")
			case settingLimited:
				request.ReferenceLimited = true
			default:
				overflow = append(overflow, reference.Label+" "+reference.Name)
			}
		}
		request.References = append(request.References, reference)
	}
	if request.Warning == "" {
		notes := []string{}
		if len(missing) > 0 {
			notes = append(notes, "参考图未就绪，本段按文字设定生成："+strings.Join(missing, "、")+"；重新生成参考图后再生成本段，形象更一致")
		}
		if request.ReferenceLimited {
			notes = append(notes, fmt.Sprintf("本段引用 %d 个设定，按每段最多 %d 张参考图发送，其余按文字设定；可在生成依据里手动调整", len(draft.view.Request.References), settings.ReferenceLimit))
		}
		if len(overflow) > 0 {
			notes = append(notes, fmt.Sprintf("超出视频模型参考图上限（%d 张，含首帧），按文字设定生成：%s", profile.MaxImages, strings.Join(overflow, "、")))
		}
		request.Warning = strings.Join(notes, "；")
	}
	request.Header = strings.Join(header, "\n")
	// 正文里的“参考图N”必须对应本段的参考图；换参考图后手写的提示词可能还留着旧编号。
	if unknown := production.UnknownReferenceTokens(firstNonEmpty(segment.VideoPromptOverride, segment.VideoPrompt), len(request.References)); len(unknown) > 0 {
		request.UnknownReferences = unknown
		request.Warning = fmt.Sprintf("提示词里的 %s 不是本段的参考图（本段共 %d 张），生成前请改成正确的编号", strings.Join(unknown, "、"), len(request.References))
	}
	// 给不出作品画幅时不提交：上游会按自己的默认画幅（多为横屏）出片，花了钱也用不上。
	if screen.Issue != "" {
		return request, refs, errors.New(screen.Issue)
	}
	return request, refs, nil
}

// dramaCastImageState 是没能随请求发送的参考图当前状态，写进段视频的限制说明。
func dramaCastImageState(cast model.DramaCast) string {
	switch cast.ImageStatus {
	case model.DramaMediaFailed:
		return "生成失败"
	case model.DramaMediaQueued, model.DramaMediaRunning:
		return "生成中"
	}
	return "未生成"
}

func (s *Service) dramaResourceReference(id, name, role string) (map[string]any, error) {
	// The caller has already verified the project owner; check resource ownership at submission too.
	resource, err := s.repo.Resource(id)
	if err != nil {
		return nil, err
	}
	if resource.Status != model.ResourceStatusReady || !strings.HasPrefix(resource.MimeType, "image/") {
		return nil, errors.New("参考图片不可用")
	}
	ref := map[string]any{"id": name, "name": name, "type": resource.MimeType, "mimeType": resource.MimeType, "storageKey": "resource:" + id, "bytes": resource.Size, "width": resource.Width, "height": resource.Height}
	if role != "" {
		ref["role"] = role
	}
	return ref, nil
}

func (r *dramaRun) submitSegmentVideo(job *model.DramaJob) (*model.Task, bool, error) {
	segment, err := r.s.repo.DramaSegment(r.project.ID, job.ShotID)
	if err != nil {
		return nil, false, err
	}
	job.PayloadJSON = encodeDramaRevision(segment.Revision)
	if segment.VideoStatus != "" && segment.VideoStatus != model.DramaMediaQueued {
		return nil, true, nil
	}
	episode, err := r.s.repo.DramaEpisode(r.project.ID, segment.EpisodeID)
	if err != nil {
		return nil, false, err
	}
	explicit := segment.VideoStatus == model.DramaMediaQueued && (episode.Stage == model.DramaEpisodePrompts || episode.Stage == model.DramaEpisodeReview)
	if (episode.Stage != model.DramaEpisodeVideo && !explicit) || r.mediaHeld(episode) || r.sampleBlocked(episode) {
		return nil, true, nil
	}
	if !dramaPromptReady(*segment) {
		return nil, false, errors.New("请先完成并确认本段视频提示词")
	}
	shots, err := r.s.repo.DramaShots(episode.ID)
	if err != nil {
		return nil, false, err
	}
	rows, err := r.s.repo.DramaSegments(episode.ID)
	if err != nil {
		return nil, false, err
	}
	casts := map[string]model.DramaCast{}
	for _, cast := range r.casts {
		casts[cast.ID] = cast
	}
	var previous *model.DramaSegment
	for i := range rows {
		if rows[i].ID == segment.ID && i > 0 && !r.settings.parallelVideo() {
			previous = &rows[i-1]
		}
	}
	for _, draft := range buildDramaSegmentDrafts(r.settings, r.meta, shots, casts, rows) {
		if draft.view.Index != segment.SegmentIndex {
			continue
		}
		request, refs, err := r.s.prepareDramaSegment(r.settings, draft, *segment, previous, casts)
		if err != nil {
			return nil, false, err
		}
		if segment.PromptSeconds > 0 && segment.PromptSeconds != request.Seconds {
			return nil, false, errors.New("所选模型时长档位与提示词不同，请先用该模型重新撰写提示词")
		}
		if len(request.UnknownReferences) > 0 {
			return nil, false, errors.New(request.Warning)
		}
		if request.FirstFramePending {
			return nil, true, nil
		}
		for _, ref := range refs {
			m := ref.(map[string]any)
			id := strings.TrimPrefix(m["storageKey"].(string), "resource:")
			if _, err := r.s.repo.ResourceForUser(r.project.UserID, id); err != nil {
				return nil, false, err
			}
		}
		metadata := r.metadata(job)
		if previous != nil {
			metadata["videoStartFrameNodeId"] = "first-frame"
		}
		// 画面参数与声音开关取自预演：比例或分辨率标签按模型能力合同换算，不出声的模型显式关闭声音。
		config := map[string]any{"videoSeconds": itoa(request.Seconds), "videoGenerateAudio": strconv.FormatBool(request.GenerateAudio)}
		dramaVideoScreen{Size: request.Size, Resolution: request.Resolution}.apply(config)
		prompt := strings.TrimSpace(request.Header + "\n\n" + firstNonEmpty(segment.VideoPromptOverride, segment.VideoPrompt))
		payload, _ := json.Marshal(dramaRevisionPayload{Revision: segment.Revision, Seconds: request.Seconds})
		job.PayloadJSON = string(payload)
		task, err := r.createTaskWith(segmentVideoChoice(*segment, r.settings.Models.Video), "video", request.Operation, prompt, map[string]any{"config": config, "referenceImages": refs, "metadata": metadata})
		return task, false, err
	}
	return nil, false, errors.New("剧情段没有对应分镜")
}

func (r *dramaRun) applySegmentVideo(job *model.DramaJob, task *model.Task) error {
	resourceID := dramaTaskResource(task)
	if resourceID == "" {
		return errors.New("视频任务未返回资源")
	}
	var payload dramaRevisionPayload
	if err := json.Unmarshal([]byte(job.PayloadJSON), &payload); err != nil {
		return err
	}
	if err := r.s.repo.CreateDramaTake(&model.DramaTake{ID: newID(), ProjectID: r.project.ID, OwnerID: job.ShotID, Kind: "video", ResourceID: resourceID, TaskID: task.ID, Prompt: task.Prompt, DurationMs: int64(payload.Seconds) * 1000, CreatedAt: time.Now()}); err != nil {
		return err
	}
	segment, err := r.s.repo.DramaSegment(r.project.ID, job.ShotID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if segment.Revision != payload.Revision {
		return nil
	}
	// Persist the paid output before local post-processing. Retrying only reopens this task's result.
	if _, err := r.s.repo.UpdateDramaSegmentRevision(segment.ID, payload.Revision, map[string]any{"video_resource_id": resourceID, "video_seconds": payload.Seconds}); err != nil {
		return err
	}
	tail, err := r.s.extractDramaTailFrame(r.project.UserID, resourceID)
	if err != nil {
		return err
	}
	_, err = r.s.repo.UpdateDramaSegmentRevision(segment.ID, payload.Revision, map[string]any{"video_status": model.DramaMediaReady, "tail_frame_resource_id": tail, "video_error": ""})
	return err
}

// dramaVideoJobReplayable 表示段视频作业的生成任务已成功，只是结果回写（如抽尾帧）失败；
// 重新处理会重放同一任务结果，不再提交模型。
func dramaVideoJobReplayable(job model.DramaJob) bool {
	if job.Kind != model.DramaJobSegmentVideo || job.Status != model.DramaJobFailed || job.TaskID == "" {
		return false
	}
	var attempts []DramaJobAttempt
	_ = json.Unmarshal([]byte(job.AttemptsJSON), &attempts)
	for _, attempt := range attempts {
		if attempt.TaskID == job.TaskID && attempt.Status == string(model.TaskStatusSucceeded) {
			return true
		}
	}
	return false
}

// ReprocessDramaSegmentVideo 重新处理一段已生成、但后处理失败的视频：只重放原任务结果，不重新生成、不重复扣费。
func (s *Service) ReprocessDramaSegmentVideo(userID, projectID, episodeID string, index int) (map[string]any, error) {
	project, p, err := s.dramaForUser(userID, projectID)
	if err != nil {
		return nil, err
	}
	episode, err := s.repo.DramaEpisode(project.ID, episodeID)
	if err != nil {
		return nil, err
	}
	rows, err := s.repo.DramaSegments(episode.ID)
	if err != nil {
		return nil, err
	}
	var segment *model.DramaSegment
	for i := range rows {
		if rows[i].SegmentIndex == index {
			segment = &rows[i]
			break
		}
	}
	if segment == nil {
		return nil, BadAuthRequest("剧情段不存在")
	}
	if segment.VideoStatus != model.DramaMediaFailed || segment.VideoResourceID == "" {
		return nil, BadAuthRequest("本段没有需要重新处理的视频")
	}
	jobs, err := s.repo.RecentDramaSegmentJobs(project.ID, episode.ID)
	if err != nil {
		return nil, err
	}
	for _, job := range jobs {
		if job.Kind != model.DramaJobSegmentVideo || job.ShotID != segment.ID {
			continue
		}
		// 只看最近一次视频作业：更早的结果已被后续生成取代，不能拿来重放。
		if !dramaVideoJobReplayable(job) {
			break
		}
		reopened, err := s.repo.ReopenDramaSegmentVideoJob(job.ID, segment.ID)
		if err != nil {
			return nil, err
		}
		if !reopened {
			break
		}
		return map[string]any{"reprocessing": true}, s.requestDramaWork(p)
	}
	return nil, BadAuthRequest("找不到可重新处理的视频结果，请重新生成本段视频")
}

// dramaTailDownloadTimeout 是抽尾帧前读取段视频的上限；超时转为可重新处理的失败，而不是一直“生成中”。
const dramaTailDownloadTimeout = 3 * time.Minute

func (s *Service) extractDramaTailFrame(userID, resourceID string) (string, error) {
	if s.dramaTailFrameHook != nil {
		return s.dramaTailFrameHook(userID, resourceID)
	}
	var tail string
	err := s.withDramaVideoFile(userID, resourceID, func(resource *model.Resource, input string) error {
		var saveErr error
		tail, saveErr = s.saveDramaTailFrame(userID, resource, input)
		return saveErr
	})
	return tail, err
}

// dramaVideoFacts 是对一段视频的本地探测结果：尾帧资源、实际时长与是否含音轨（探测不到时为 nil）。
type dramaVideoFacts struct {
	TailResourceID string
	DurationMs     int64
	HasAudio       *bool
}

// inspectDramaVideo 下载一次视频，抽取尾帧并探测时长与音轨；用于把画布上的视频采用为剧情段。
func (s *Service) inspectDramaVideo(userID string, resource *model.Resource) (dramaVideoFacts, error) {
	facts := dramaVideoFacts{DurationMs: resource.DurationMs}
	if s.dramaTailFrameHook != nil {
		tail, err := s.dramaTailFrameHook(userID, resource.ID)
		facts.TailResourceID = tail
		return facts, err
	}
	err := s.withDramaVideoFile(userID, resource.ID, func(opened *model.Resource, input string) error {
		tail, err := s.saveDramaTailFrame(userID, opened, input)
		if err != nil {
			return err
		}
		facts.TailResourceID = tail
		if probed := probeMediaDurationMs(input); probed > 0 {
			facts.DurationMs = probed
		}
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		if hasAudio, probeErr := probeHasAudioStream(ctx, input); probeErr == nil {
			facts.HasAudio = &hasAudio
		}
		return nil
	})
	return facts, err
}

// withDramaVideoFile 把视频资源下载到临时文件后交给 fn；读取对象存储有超时保护。
func (s *Service) withDramaVideoFile(userID, resourceID string, fn func(resource *model.Resource, input string) error) error {
	resource, body, err := s.OpenResource(userID, resourceID)
	if err != nil {
		return err
	}
	defer body.Close()
	// 读取对象存储可能卡住：超时后关闭读取流让 io.Copy 返回，避免一段视频阻塞整个调度循环。
	var stalled atomic.Bool
	watchdog := time.AfterFunc(dramaTailDownloadTimeout, func() {
		stalled.Store(true)
		_ = body.Close()
	})
	defer watchdog.Stop()
	if !strings.HasPrefix(resource.MimeType, "video/") {
		return errors.New("尾帧来源不是视频")
	}
	dir, err := os.MkdirTemp("", "yingce-drama-tail-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	input := filepath.Join(dir, "input.mp4")
	file, err := os.Create(input)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(file, body)
	watchdog.Stop()
	closeErr := file.Close()
	if copyErr != nil {
		if stalled.Load() {
			return fmt.Errorf("读取段视频超时（%d 秒），可稍后点“重新处理”", int(dramaTailDownloadTimeout.Seconds()))
		}
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	return fn(resource, input)
}

// saveDramaTailFrame 用 ffmpeg 取本地视频的最后一帧并保存为图片资源。
func (s *Service) saveDramaTailFrame(userID string, resource *model.Resource, input string) (string, error) {
	ffmpegBin, err := renderFfmpegBinary()
	if err != nil {
		return "", fmt.Errorf("抽取尾帧失败：%w", err)
	}
	dir, err := os.MkdirTemp("", "yingce-drama-tail-out-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(dir)
	output := filepath.Join(dir, "tail.png")
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	// Decode every remaining frame and update the same output, so the saved image is the actual final frame.
	cmd := exec.CommandContext(ctx, ffmpegBin, "-hide_banner", "-loglevel", "error", "-sseof", "-1", "-i", input, "-an", "-update", "1", "-y", output)
	if out, err := cmd.CombinedOutput(); err != nil {
		detail := strings.TrimSpace(string(out))
		if detail == "" {
			detail = err.Error()
		}
		return "", fmt.Errorf("抽取尾帧失败：%s", clipText(detail, 400))
	}
	image, err := os.Open(output)
	if err != nil {
		return "", err
	}
	defer image.Close()
	info, err := image.Stat()
	if err != nil {
		return "", err
	}
	saved, err := s.UploadResourceFile(userID, "tail.png", info.Size(), "image", resource.Width, resource.Height, 0, image, "drama-tail:"+resource.ID)
	if err != nil {
		return "", err
	}
	return saved.ID, nil
}
