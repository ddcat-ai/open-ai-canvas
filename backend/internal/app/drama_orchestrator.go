package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"yingce/backend/internal/model"
	"yingce/backend/internal/production"

	"gorm.io/gorm"
)

// 短剧调度循环：每个运行中的项目按“同步任务结果 → 规划新工作 → 按优先级派发”推进。
// 所有状态都在数据库里，进程重启或多副本部署时由租约保证同一项目只被一个循环推进。

const (
	dramaTickInterval      = 3 * time.Second
	dramaLeaseTTL          = 2 * time.Minute
	dramaProjectsPerTick   = 20
	dramaEpisodeWindow     = 6
	dramaPlanBatchRunes    = 30000
	dramaPlanBatchChapters = 12
	dramaBibleSampleRunes  = 40000
	dramaBudgetPauseReason = "已达到预算上限，提高预算后可继续"
	dramaCreditsReason     = "积分不足，充值后点击继续制作"
)

var dramaWake = struct {
	once sync.Once
	ch   chan struct{}
}{}

func dramaWakeChannel() chan struct{} {
	dramaWake.once.Do(func() { dramaWake.ch = make(chan struct{}, 1) })
	return dramaWake.ch
}

func (s *Service) wakeDramaScheduler() {
	select {
	case dramaWakeChannel() <- struct{}{}:
	default:
	}
}

func (s *Service) startDramaScheduler() {
	s.runWorkerLoop(func(ctx context.Context) {
		ticker := time.NewTicker(dramaTickInterval)
		defer ticker.Stop()
		for {
			s.tickDramaProductions(ctx)
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			case <-dramaWakeChannel():
			}
		}
	})
}

func (s *Service) tickDramaProductions(ctx context.Context) {
	if s.IsDraining() {
		return
	}
	productions, err := s.repo.RunningDramaProductions(dramaProjectsPerTick)
	if err != nil {
		slog.Warn("drama scheduler load failed", "error", err)
		return
	}
	for i := range productions {
		if ctx.Err() != nil {
			return
		}
		release, acquired, err := s.coordinator.Acquire(ctx, "drama:"+productions[i].ProjectID, 1, dramaLeaseTTL)
		if err != nil || !acquired {
			continue
		}
		if err := s.tickDrama(&productions[i]); err != nil {
			slog.Warn("drama tick failed", "project", productions[i].ProjectID, "error", err)
		}
		release()
	}
}

// dramaRun 是一次 tick 内的工作集，避免同一 tick 反复读库。
type dramaRun struct {
	s          *Service
	production *model.DramaProduction
	project    *model.Project
	settings   DramaSettings
	meta       dramaBibleMeta
	casts      []model.DramaCast
	castByID   map[string]*model.DramaCast
	active     map[string]bool
	running    int
	newJobs    []model.DramaJob
	// imageSizes 缓存本轮调度中“期望画幅 → 模型尺寸参数”的换算，避免每张参考图重复读取能力合同。
	imageSizes map[string]dramaImageRequest
}

func dramaJobKey(kind, episodeID, shotID, castID string) string {
	return kind + "|" + episodeID + "|" + shotID + "|" + castID
}

func (s *Service) tickDrama(productionRow *model.DramaProduction) error {
	fresh, err := s.repo.DramaProduction(productionRow.ProjectID)
	if err != nil {
		return err
	}
	productionRow = fresh
	project, err := s.repo.ProjectForUser(productionRow.UserID, productionRow.ProjectID)
	if err != nil {
		return err
	}
	run := &dramaRun{s: s, production: productionRow, project: project, settings: parseDramaSettings(productionRow.SettingsJSON), meta: parseDramaBibleMeta(productionRow.BibleJSON)}
	if productionRow.Status != model.DramaStatusRunning {
		// 暂停后已派发的任务仍会完成：照常回写结果（视频入库、抽尾帧），否则段会一直停在“生成中”，下一段也拿不到首帧。
		status := productionRow.Status
		if err := run.syncJobs(); err != nil {
			return err
		}
		return s.repo.SaveDramaProductionProgress(run.production, status, run.production.Status != status)
	}
	if err := run.syncJobs(); err != nil {
		return err
	}
	if run.production.Status != model.DramaStatusRunning {
		return s.repo.SaveDramaProductionProgress(run.production, model.DramaStatusRunning, true)
	}
	if err := run.loadCasts(); err != nil {
		return err
	}
	if err := run.plan(); err != nil {
		return err
	}
	if err := s.repo.CreateDramaJobs(run.newJobs); err != nil {
		return err
	}
	if err := run.dispatch(); err != nil {
		return err
	}
	now := time.Now()
	run.production.LastTickAt = &now
	return s.repo.SaveDramaProductionProgress(run.production, model.DramaStatusRunning, run.production.Status != model.DramaStatusRunning)
}

func (r *dramaRun) loadCasts() error {
	casts, err := r.s.repo.DramaCasts(r.project.ID)
	if err != nil {
		return err
	}
	r.casts = casts
	r.castByID = make(map[string]*model.DramaCast, len(casts))
	for i := range r.casts {
		r.castByID[r.casts[i].ID] = &r.casts[i]
	}
	return nil
}

// syncJobs 读取已派发任务的终态并写回业务对象。
func (r *dramaRun) syncJobs() error {
	jobs, err := r.s.repo.DramaJobsByStatus(r.project.ID, model.DramaJobQueued, model.DramaJobRunning)
	if err != nil {
		return err
	}
	r.active = map[string]bool{}
	for i := range jobs {
		job := &jobs[i]
		if job.Status == model.DramaJobRunning {
			if err := r.syncRunningJob(job); err != nil {
				return err
			}
		}
		if job.Status == model.DramaJobQueued || job.Status == model.DramaJobRunning {
			r.active[dramaJobKey(job.Kind, job.EpisodeID, job.ShotID, job.CastID)] = true
			if job.Status == model.DramaJobRunning {
				r.running++
			}
		}
	}
	return nil
}

func (r *dramaRun) syncRunningJob(job *model.DramaJob) error {
	task, err := r.s.repo.Task(job.TaskID)
	if err != nil {
		return r.failJob(job, "任务记录丢失")
	}
	switch task.Status {
	case model.TaskStatusSucceeded:
		job.CostMicrocredits = r.taskCost(task)
		if !dramaAttemptRecorded(job, task.ID) {
			r.production.SpentMicrocredits += job.CostMicrocredits
		}
		recordDramaAttempt(job, task.ID, string(task.Status), "", job.CostMicrocredits)
		if applyErr := r.applyJob(job, task); applyErr != nil {
			var issue *dramaResultIssue
			if errors.As(applyErr, &issue) {
				return r.failJob(job, issue.message)
			}
			return r.failJob(job, "结果处理失败（保留原任务，重试不重复生成）："+applyErr.Error())
		}
		now := time.Now()
		job.Status, job.FinishedAt, job.Error = model.DramaJobSucceeded, &now, ""
		return r.s.repo.SaveDramaJob(job)
	case model.TaskStatusFailed, model.TaskStatusCancelled:
		job.CostMicrocredits = r.taskCost(task)
		if !dramaAttemptRecorded(job, task.ID) {
			r.production.SpentMicrocredits += job.CostMicrocredits
		}
		recordDramaAttempt(job, task.ID, string(task.Status), firstNonEmpty(task.Error, "生成失败"), job.CostMicrocredits)
		return r.failJob(job, firstNonEmpty(task.Error, "生成失败"))
	}
	return nil
}

// dramaResultIssue 是生成结果本身不合格（例如参考图画幅不符）：任务已成功结算，失败原因原样展示给用户。
type dramaResultIssue struct{ message string }

func (e *dramaResultIssue) Error() string { return e.message }

func (r *dramaRun) taskCost(task *model.Task) int64 {
	if task.BillingOrderID == "" {
		return 0
	}
	order, err := r.s.repo.BillingOrder(task.BillingOrderID)
	if err != nil || order == nil || order.Status == model.BillingStatusRefunded {
		return 0
	}
	return order.AmountMicrocredits
}

// failJob 让失败落到具体镜头或设定上，进入“待处理”而不是卡住整条流水线。
func (r *dramaRun) failJob(job *model.DramaJob, reason string) error {
	now := time.Now()
	job.Status, job.FinishedAt, job.Error = model.DramaJobFailed, &now, truncateRunes(reason, 500)
	if err := r.s.repo.SaveDramaJob(job); err != nil {
		return err
	}
	switch job.Kind {
	case model.DramaJobBible, model.DramaJobPlan:
		r.production.Status = model.DramaStatusPaused
		r.production.PauseReason = "作品改编失败：" + truncateRunes(reason, 200)
	case model.DramaJobCastImage:
		var payload dramaRevisionPayload
		if err := json.Unmarshal([]byte(job.PayloadJSON), &payload); err != nil {
			return err
		}
		_, err := r.s.repo.UpdateDramaCastRevision(job.CastID, payload.Revision, map[string]any{"image_status": model.DramaMediaFailed})
		return err
	case model.DramaJobSegmentPrompt:
		var payload dramaRevisionPayload
		_ = json.Unmarshal([]byte(job.PayloadJSON), &payload)
		_, err := r.s.repo.UpdateDramaSegmentRevision(job.ShotID, payload.Revision, map[string]any{"prompt_status": model.DramaMediaFailed, "prompt_error": truncateRunes(reason, 300)})
		return err
	case model.DramaJobScript, model.DramaJobRender:
		if episode, err := r.s.repo.DramaEpisode(r.project.ID, job.EpisodeID); err == nil {
			var payload dramaRevisionPayload
			_ = json.Unmarshal([]byte(job.PayloadJSON), &payload)
			_, err = r.s.repo.UpdateDramaEpisodeIfRevision(episode.ID, payload.Revision, map[string]any{"error": truncateRunes(reason, 300)})
			return err
		}
	case model.DramaJobSegmentVideo:
		var payload dramaRevisionPayload
		_ = json.Unmarshal([]byte(job.PayloadJSON), &payload)
		_, err := r.s.repo.UpdateDramaSegmentRevision(job.ShotID, payload.Revision, map[string]any{"video_status": model.DramaMediaFailed, "video_error": truncateRunes(reason, 500)})
		return err
	}
	return nil
}

// recordDramaAttempt 追加一次提交记录；最多保留最近 20 次，供队列详情回看历次请求。
func recordDramaAttempt(job *model.DramaJob, taskID, status, reason string, cost int64) {
	var attempts []DramaJobAttempt
	_ = json.Unmarshal([]byte(job.AttemptsJSON), &attempts)
	if taskID != "" {
		for _, attempt := range attempts {
			if attempt.TaskID == taskID {
				return
			}
		}
	}
	attempts = append(attempts, DramaJobAttempt{TaskID: taskID, Status: status, Error: truncateRunes(reason, 500), CostMicrocredits: cost, At: time.Now().Format(time.RFC3339)})
	if len(attempts) > 20 {
		attempts = attempts[len(attempts)-20:]
	}
	encoded, _ := json.Marshal(attempts)
	job.AttemptsJSON = string(encoded)
}

func dramaAttemptRecorded(job *model.DramaJob, taskID string) bool {
	var attempts []DramaJobAttempt
	_ = json.Unmarshal([]byte(job.AttemptsJSON), &attempts)
	for _, a := range attempts {
		if a.TaskID == taskID {
			return true
		}
	}
	return false
}

func (r *dramaRun) enqueue(kind, episodeID, shotID, castID string, priority int, label string, payload any) bool {
	key := dramaJobKey(kind, episodeID, shotID, castID)
	if r.active[key] {
		return false
	}
	r.active[key] = true
	now := time.Now()
	job := model.DramaJob{ID: newID(), ProjectID: r.project.ID, Status: model.DramaJobQueued, Kind: kind, EpisodeID: episodeID, ShotID: shotID, CastID: castID, Priority: priority, Label: truncateRunes(label, 200), CreatedAt: now, UpdatedAt: now}
	if payload != nil {
		encoded, _ := json.Marshal(payload)
		job.PayloadJSON = string(encoded)
	}
	r.newJobs = append(r.newJobs, job)
	return true
}

func episodePriority(base int, number int) int {
	return base*10000 - min(number, 9999)
}

type dramaPlanPayload struct {
	Start int `json:"start"`
	End   int `json:"end"`
}

// plan 根据业务对象的当前状态推导需要的工作；它是幂等的，重复执行只会跳过已排队项。
func (r *dramaRun) plan() error {
	p := r.production
	if p.Stage == model.DramaStageBible {
		r.enqueue(model.DramaJobBible, "", "", "", 100*10000, "建立作品圣经：角色、场景与风格", nil)
		return nil
	}
	chapters, err := r.s.repo.DramaChapterSummaries(r.project.ID)
	if err != nil {
		return err
	}
	if !p.PlanDone {
		if p.PlanCursor >= len(chapters) {
			p.PlanDone = true
		} else if r.settings.EpisodeMode == DramaEpisodeModeChapter {
			// 规划中途改成按章分集：剩余章节直接分组建集，在途的规划结果因游标前移作废。
			if err := r.groupRemainingChapters(chapters); err != nil {
				return err
			}
		} else if !r.active[dramaJobKey(model.DramaJobPlan, "", "", "")] {
			end, runes := p.PlanCursor, 0
			for end < len(chapters) && end-p.PlanCursor < dramaPlanBatchChapters && (runes == 0 || runes+chapters[end].WordCount <= dramaPlanBatchRunes) {
				runes += chapters[end].WordCount
				end++
			}
			r.enqueue(model.DramaJobPlan, "", "", "", 90*10000, fmt.Sprintf("分集规划：第 %d-%d 章", p.PlanCursor+1, end), dramaPlanPayload{Start: p.PlanCursor, End: end})
		}
	}
	for i := range r.casts {
		cast := &r.casts[i]
		// "" 表示从未请求，只有放行后才自动生成；queued 是用户明确请求（重做、重试或按集放行）。
		requested := cast.ImageStatus == model.DramaMediaQueued || (cast.ImageStatus == "" && r.assetsReleased())
		if requested && !cast.Locked {
			r.enqueue(model.DramaJobCastImage, "", "", cast.ID, 80*10000-cast.Position, "参考图："+cast.Name, nil)
		}
	}
	episodes, err := r.s.repo.DramaEpisodes(r.project.ID)
	if err != nil {
		return err
	}
	inFlight := 0
	for i := range episodes {
		episode := &episodes[i]
		// 等待放行生图的集不占制作窗口，剧本可以全部先写出来供审阅。
		if episode.Stage != model.DramaEpisodeQueued && episode.Stage != model.DramaEpisodeDone && episode.Stage != model.DramaEpisodeReview && !r.mediaHeld(episode) {
			inFlight++
		}
	}
	allDone := p.PlanDone && len(episodes) > 0
	for i := range episodes {
		episode := &episodes[i]
		if episode.Stage != model.DramaEpisodeDone || episode.FinalStale {
			allDone = false
		}
		loadedStage := episode.Stage
		if episode.Stage == model.DramaEpisodeQueued {
			if inFlight >= dramaEpisodeWindow {
				continue
			}
			episode.Stage = model.DramaEpisodeScript
			inFlight++
		}
		if err := r.advanceEpisode(episode, loadedStage); err != nil {
			return err
		}
	}
	// 完整视频提示词只花文本费用，剧本一写好就撰写，不受手动生图放行限制。
	segments, err := r.s.repo.PendingDramaSegments(r.project.ID)
	if err != nil {
		return err
	}
	numberByEpisode := map[string]int{}
	for _, episode := range episodes {
		numberByEpisode[episode.ID] = episode.Number
	}
	for _, segment := range segments {
		number := numberByEpisode[segment.EpisodeID]
		r.enqueue(model.DramaJobSegmentPrompt, segment.EpisodeID, segment.ID, "", episodePriority(55, number)-segment.SegmentIndex, fmt.Sprintf("第 %d 集第 %d 段 视频提示词", number, segment.SegmentIndex+1), nil)
		allDone = false
	}
	if allDone {
		p.Status, p.Stage = model.DramaStatusCompleted, model.DramaStageDone
	}
	return nil
}

func (r *dramaRun) manualMedia() bool { return r.settings.MediaMode == DramaMediaManual }

func (r *dramaRun) assetsReleased() bool { return !r.manualMedia() || r.production.AssetsReleased }

// mediaHeld 表示用户尚未放行本集的参考图和段视频。
func (r *dramaRun) mediaHeld(episode *model.DramaEpisode) bool {
	return dramaMediaHeld(r.settings, episode)
}

func dramaMediaHeld(settings DramaSettings, e *model.DramaEpisode) bool {
	return settings.MediaMode == DramaMediaManual && !e.MediaReleased && (e.Stage == model.DramaEpisodePrompts || e.Stage == model.DramaEpisodeReview || e.Stage == model.DramaEpisodeVideo)
}

func (r *dramaRun) sampleBlocked(episode *model.DramaEpisode) bool {
	return r.settings.ReviewMode == DramaReviewSample && !r.production.SampleApproved && episode.Number != 1
}

func (r *dramaRun) needsReview(e *model.DramaEpisode) bool {
	return r.settings.ReviewMode == DramaReviewEvery && !e.Approved
}

// advanceEpisode 推进单集：剧本 → 段提示词 → 审阅 → 段视频 → 成片。
func (r *dramaRun) advanceEpisode(e *model.DramaEpisode, loadedStage string) error {
	label := fmt.Sprintf("第 %d 集", e.Number)
	segments, err := r.s.repo.DramaSegments(e.ID)
	if err != nil {
		return err
	}
	// 从画布采用的视频可能只写入了视频（Agent 在事务内采用不做存储 IO），尾帧在这里补抽；每集每轮最多一段。
	for _, segment := range segments {
		if segment.VideoStatus != model.DramaMediaReady || segment.VideoResourceID == "" || segment.TailFrameResourceID != "" {
			continue
		}
		if err := r.s.backfillDramaSegmentTail(r.project.UserID, segment); err != nil {
			return err
		}
		if segments, err = r.s.repo.DramaSegments(e.ID); err != nil {
			return err
		}
		break
	}
	switch e.Stage {
	case model.DramaEpisodeScript:
		if e.Error != "" || r.active[dramaJobKey(model.DramaJobScript, e.ID, "", "")] {
			break
		}
		handled, err := r.applyDirectStoryboard(e)
		if err != nil {
			return err
		}
		if handled {
			// 分镜已直接写入（阶段与版本由 ApplyDramaScript 更新）或已记录错误，本轮不再回写阶段。
			return nil
		}
		r.enqueue(model.DramaJobScript, e.ID, "", "", episodePriority(60, e.Number), label+" 剧本与分镜", nil)
	case model.DramaEpisodePrompts:
		ready := len(segments) > 0
		for _, seg := range segments {
			if !dramaPromptReady(seg) {
				ready = false
			}
		}
		if ready {
			e.Stage = model.DramaEpisodeReview
		} else if _, err := r.enqueueSegmentVideos(e, segments, true); err != nil {
			// 用户逐段点了“生成视频”的段不必等全集提示词写完。
			return err
		}
	case model.DramaEpisodeReview:
		if !r.mediaHeld(e) && !r.sampleBlocked(e) && !r.needsReview(e) {
			e.Stage = model.DramaEpisodeVideo
		} else if _, err := r.enqueueSegmentVideos(e, segments, true); err != nil {
			return err
		}
	case model.DramaEpisodeVideo:
		ready, err := r.enqueueSegmentVideos(e, segments, false)
		if err != nil {
			return err
		}
		if ready {
			e.Stage = model.DramaEpisodeRender
		}
	case model.DramaEpisodeRender:
		if e.Error == "" {
			r.enqueue(model.DramaJobRender, e.ID, "", "", episodePriority(70, e.Number), label+" 合成成片", nil)
		}
	case model.DramaEpisodeDone:
		if e.FinalStale {
			e.Stage = model.DramaEpisodeVideo
		}
	}
	if e.Stage != loadedStage {
		_, err = r.s.repo.UpdateDramaEpisodeIfRevision(e.ID, e.Revision, map[string]any{"stage": e.Stage})
	}
	return err
}

// enqueueSegmentVideos 提交可生成的段视频。尾帧续接时按段序只提交下一段（第 2 段起要等上一段尾帧）；
// 并行出片时本集所有满足条件的段一起提交，由派发并发与渠道排队决定实际出片节奏。
// requestedOnly 时只提交用户明确请求（queued）的段，用于全集尚未进入视频阶段时。返回全部段视频是否就绪。
// 等待条件与 dramaVideoWaitReason 同源，详情页显示的等待原因就是这里卡住的条件。
func (r *dramaRun) enqueueSegmentVideos(e *model.DramaEpisode, segments []model.DramaSegment, requestedOnly bool) (bool, error) {
	if len(segments) == 0 {
		return false, nil
	}
	if r.settings.parallelVideo() {
		return r.enqueueParallelSegmentVideos(e, segments, requestedOnly)
	}
	var shots []model.DramaShot
	for i, seg := range segments {
		if dramaSegmentVideoDone(seg) {
			continue
		}
		// Edits mark media stale; only an explicit request may regenerate it.
		wanted := seg.VideoStatus == model.DramaMediaQueued || (!requestedOnly && seg.VideoStatus == "")
		if !wanted {
			return false, nil
		}
		if shots == nil {
			loaded, err := r.s.repo.DramaShots(e.ID)
			if err != nil {
				return false, err
			}
			shots = loaded
		}
		if dramaVideoWaitReason(r.settings, r.production, e, segments, i, shots, r.castLookup) == "" {
			r.enqueue(model.DramaJobSegmentVideo, e.ID, seg.ID, "", episodePriority(40, e.Number), fmt.Sprintf("第 %d 集 第 %d 段视频", e.Number, seg.SegmentIndex+1), nil)
		}
		return false, nil
	}
	return true, nil
}

// enqueueParallelSegmentVideos 是并行出片的提交：段与段互不依赖，过期、失败或未请求的段只影响自己。
// r.enqueue 按作业键去重，已在队列或生成中的段不会重复提交。
func (r *dramaRun) enqueueParallelSegmentVideos(e *model.DramaEpisode, segments []model.DramaSegment, requestedOnly bool) (bool, error) {
	var shots []model.DramaShot
	ready := true
	for i, seg := range segments {
		if dramaSegmentVideoDone(seg) {
			continue
		}
		ready = false
		wanted := seg.VideoStatus == model.DramaMediaQueued || (!requestedOnly && seg.VideoStatus == "")
		if !wanted {
			continue
		}
		if shots == nil {
			loaded, err := r.s.repo.DramaShots(e.ID)
			if err != nil {
				return false, err
			}
			shots = loaded
		}
		if dramaVideoWaitReason(r.settings, r.production, e, segments, i, shots, r.castLookup) == "" {
			r.enqueue(model.DramaJobSegmentVideo, e.ID, seg.ID, "", episodePriority(40, e.Number), fmt.Sprintf("第 %d 集 第 %d 段视频", e.Number, seg.SegmentIndex+1), nil)
		}
	}
	return ready, nil
}

func (r *dramaRun) castLookup(id string) (model.DramaCast, bool) {
	cast := r.castByID[id]
	if cast == nil {
		return model.DramaCast{}, false
	}
	return *cast, true
}

// dispatch 按优先级把排队工作提交为生成任务，受项目并发、账号并发与预算约束。
func (r *dramaRun) dispatch() error {
	queued, err := r.s.repo.DramaJobsByStatus(r.project.ID, model.DramaJobQueued)
	if err != nil {
		return err
	}
	sort.SliceStable(queued, func(i, j int) bool { return queued[i].Priority > queued[j].Priority })
	capacity := r.settings.Concurrency - r.running
	// 画布精修花费计入预算；每轮只查一次，流水线花费在本轮内按结算逐项累加。
	var canvasSpent int64
	if r.production.BudgetMicrocredits > 0 && len(queued) > 0 {
		spent, err := r.s.dramaCanvasSpent(r.production)
		if err != nil {
			return err
		}
		canvasSpent = spent
	}
	for i := range queued {
		if capacity <= 0 {
			return nil
		}
		if r.production.BudgetMicrocredits > 0 && r.production.SpentMicrocredits+canvasSpent >= r.production.BudgetMicrocredits {
			r.production.Status, r.production.PauseReason = model.DramaStatusPaused, dramaBudgetPauseReason
			return nil
		}
		job := &queued[i]
		task, skip, err := r.submit(job)
		if err != nil {
			message := err.Error()
			switch {
			case strings.Contains(message, "同时排队或运行的任务最多"):
				return nil
			case strings.Contains(message, "积分不足"):
				r.production.Status, r.production.PauseReason = model.DramaStatusPaused, dramaCreditsReason
				return nil
			case strings.Contains(message, "维护"):
				return nil
			}
			recordDramaAttempt(job, "", "rejected", message, 0)
			if failErr := r.failJob(job, message); failErr != nil {
				return failErr
			}
			continue
		}
		if skip {
			now := time.Now()
			job.Status, job.FinishedAt = model.DramaJobCanceled, &now
			if err := r.s.repo.SaveDramaJob(job); err != nil {
				return err
			}
			continue
		}
		now := time.Now()
		job.Status, job.TaskID, job.StartedAt = model.DramaJobRunning, task.ID, &now
		if err := r.s.repo.SaveDramaJob(job); err != nil {
			return err
		}
		if err := r.markRunning(job); err != nil {
			return err
		}
		capacity--
	}
	return nil
}

func (r *dramaRun) markRunning(job *model.DramaJob) error {
	var err error
	switch job.Kind {
	case model.DramaJobSegmentPrompt:
		var payload dramaRevisionPayload
		_ = json.Unmarshal([]byte(job.PayloadJSON), &payload)
		_, err = r.s.repo.UpdateDramaSegmentRevision(job.ShotID, payload.Revision, map[string]any{"prompt_status": model.DramaMediaRunning})
	case model.DramaJobCastImage:
		_, err = r.s.repo.UpdateDramaCastIf(job.CastID, []string{"", model.DramaMediaQueued}, map[string]any{"image_status": model.DramaMediaRunning})
	case model.DramaJobSegmentVideo:
		var payload dramaRevisionPayload
		_ = json.Unmarshal([]byte(job.PayloadJSON), &payload)
		_, err = r.s.repo.UpdateDramaSegmentRevision(job.ShotID, payload.Revision, map[string]any{"video_status": model.DramaMediaRunning})
	}
	return err
}

// ===== 结果回写 =====

func (r *dramaRun) applyJob(job *model.DramaJob, task *model.Task) error {
	switch job.Kind {
	case model.DramaJobBible:
		return r.applyBible(task)
	case model.DramaJobPlan:
		return r.applyPlan(job, task)
	case model.DramaJobScript:
		return r.applyScript(job, task)
	case model.DramaJobCastImage:
		return r.applyCastImage(job, task)
	case model.DramaJobSegmentVideo:
		return r.applySegmentVideo(job, task)
	case model.DramaJobRender:
		return r.applyRender(job, task)
	case model.DramaJobSegmentPrompt:
		return r.applySegmentPrompt(job, task)
	}
	return nil
}

func dramaTaskText(task *model.Task) (string, error) {
	var result struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal([]byte(task.ResultJSON), &result); err != nil || strings.TrimSpace(result.Text) == "" {
		return "", errors.New("模型没有返回文本结果")
	}
	return result.Text, nil
}

func (r *dramaRun) applyBible(task *model.Task) error {
	text, err := dramaTaskText(task)
	if err != nil {
		return err
	}
	bible, err := production.ParseBible(text)
	if err != nil {
		return fmt.Errorf("作品圣经解析失败：%w", err)
	}
	existing, err := r.s.repo.DramaCasts(r.project.ID)
	if err != nil {
		return err
	}
	if len(existing) == 0 {
		now := time.Now()
		casts := make([]model.DramaCast, 0, len(bible.Characters)+len(bible.Props)+len(bible.Scenes))
		for index, character := range bible.Characters {
			instructions := strings.TrimSpace(strings.Join(nonEmpty(character.Gender, character.Age, character.Voice), "，"))
			casts = append(casts, model.DramaCast{ID: newID(), ProjectID: r.project.ID, Kind: "character", Name: truncateRunes(character.Name, 60), AliasesJSON: encodeStringList(character.Aliases), Role: truncateRunes(character.Role, 60), Description: truncateRunes(character.Description, 1000), Appearance: truncateRunes(strings.Join(nonEmpty(character.Gender, character.Age, character.Appearance), "，"), 1000), VoiceInstructions: truncateRunes(instructions, 500), Importance: len(bible.Characters) - index, Position: index, CreatedAt: now, UpdatedAt: now})
		}
		for index, prop := range bible.Props {
			casts = append(casts, model.DramaCast{ID: newID(), ProjectID: r.project.ID, Kind: "prop", Name: truncateRunes(prop.Name, 60), AliasesJSON: "[]", Description: truncateRunes(prop.Description, 1000), Appearance: truncateRunes(prop.Appearance, 1000), Position: index, CreatedAt: now, UpdatedAt: now})
		}
		for index, scene := range bible.Scenes {
			casts = append(casts, model.DramaCast{ID: newID(), ProjectID: r.project.ID, Kind: "scene", Name: truncateRunes(scene.Name, 60), AliasesJSON: "[]", Description: truncateRunes(scene.Description, 1000), Appearance: truncateRunes(scene.Appearance, 1000), Position: index, CreatedAt: now, UpdatedAt: now})
		}
		if err := r.s.repo.CreateDramaCasts(casts); err != nil {
			return err
		}
	}
	meta, _ := json.Marshal(dramaBibleMeta{Logline: bible.Logline, Tone: bible.Tone, VisualRules: bible.VisualRules})
	r.production.BibleJSON = string(meta)
	r.meta = parseDramaBibleMeta(string(meta))
	r.production.Stage = model.DramaStageProduce
	return nil
}

func nonEmpty(values ...string) []string {
	result := []string{}
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			result = append(result, strings.TrimSpace(value))
		}
	}
	return result
}

func (r *dramaRun) applyPlan(job *model.DramaJob, task *model.Task) error {
	var payload dramaPlanPayload
	if err := json.Unmarshal([]byte(job.PayloadJSON), &payload); err != nil {
		return err
	}
	if payload.Start != r.production.PlanCursor {
		// 游标已被其他回写推进，本次结果作废。
		return nil
	}
	text, err := dramaTaskText(task)
	if err != nil {
		return err
	}
	chapters, err := r.s.repo.DramaChapterSummaries(r.project.ID)
	if err != nil {
		return err
	}
	if payload.End > len(chapters) {
		payload.End = len(chapters)
	}
	batch := make([]production.Chapter, 0, payload.End-payload.Start)
	for index := payload.Start; index < payload.End; index++ {
		batch = append(batch, production.Chapter{ID: chapters[index].ID, Index: index + 1, Title: chapters[index].Title})
	}
	planned, err := production.ParsePlan(text, batch)
	if err != nil {
		return fmt.Errorf("分集规划解析失败：%w", err)
	}
	next, err := r.s.repo.MaxDramaEpisodeNumber(r.project.ID)
	if err != nil {
		return err
	}
	now := time.Now()
	episodes := make([]model.DramaEpisode, 0, len(planned))
	for _, item := range planned {
		next++
		ids := make([]string, 0, len(item.Chapters))
		for _, index := range item.Chapters {
			ids = append(ids, chapters[index-1].ID)
		}
		episodes = append(episodes, model.DramaEpisode{ID: newID(), ProjectID: r.project.ID, Number: next, Title: truncateRunes(item.Title, 60), Synopsis: truncateRunes(item.Synopsis, 1000), Hook: truncateRunes(item.Hook, 300), Cliffhanger: truncateRunes(item.Cliffhanger, 300), ChapterIDsJSON: encodeStringList(ids), SourceFormat: model.DramaSourceNovel, Stage: model.DramaEpisodeQueued, Revision: 1, CreatedAt: now, UpdatedAt: now})
	}
	expected := r.production.PlanCursor
	r.production.PlanCursor = payload.End
	r.production.PlanDone = payload.End >= len(chapters)
	return r.s.repo.AppendDramaEpisodes(r.production, episodes, expected)
}

// groupRemainingChapters 把尚未分集的章节按“每 N 章一集”直接建集，写入与模型规划同一游标 CAS。
func (r *dramaRun) groupRemainingChapters(chapters []model.ProjectUnit) error {
	next, err := r.s.repo.MaxDramaEpisodeNumber(r.project.ID)
	if err != nil {
		return err
	}
	episodes, err := groupDramaChapterEpisodes(r.project.ID, next+1, chapters[r.production.PlanCursor:], r.settings.ChaptersPerEpisode, model.DramaSourceNovel, time.Now())
	if err != nil {
		r.production.Status, r.production.PauseReason = model.DramaStatusPaused, "分集失败："+err.Error()
		return nil
	}
	expected := r.production.PlanCursor
	r.production.PlanCursor, r.production.PlanDone = len(chapters), true
	return r.s.repo.AppendDramaEpisodes(r.production, episodes, expected)
}

func (r *dramaRun) applyScript(job *model.DramaJob, task *model.Task) error {
	text, err := dramaTaskText(task)
	if err != nil {
		return err
	}
	scripted, err := production.ParseScript(text)
	if err != nil {
		return fmt.Errorf("分镜脚本解析失败：%w", err)
	}
	episode, err := r.s.repo.DramaEpisode(r.project.ID, job.EpisodeID)
	if err != nil {
		return err
	}
	var payload dramaRevisionPayload
	_ = json.Unmarshal([]byte(job.PayloadJSON), &payload)
	if episode.Stage != model.DramaEpisodeScript || episode.Revision != payload.Revision {
		return nil
	}
	return r.applyScriptShots(episode, scripted, production.ParseScriptCast(text), production.ParseScriptEpisode(text))
}

// applyDirectStoryboard 用户上传的分镜能直接解析时跳过文本模型，镜头与台词原样入库。返回是否已处理。
func (r *dramaRun) applyDirectStoryboard(e *model.DramaEpisode) (bool, error) {
	if production.NormalizeSourceFormat(e.SourceFormat) != production.SourceStoryboard {
		return false, nil
	}
	chapters, err := r.loadChapters(decodeStringList(e.ChapterIDsJSON))
	if err != nil || len(chapters) == 0 {
		return false, err
	}
	texts := make([]string, 0, len(chapters))
	for _, chapter := range chapters {
		texts = append(texts, chapter.Text)
	}
	scripted, ok := production.ParseStoryboardSource(strings.Join(texts, "\n"))
	if !ok {
		return false, nil
	}
	if err := r.applyScriptShots(e, scripted, nil, production.ScriptEpisode{}); err != nil {
		return true, r.s.repo.UpdateDramaEpisodeUser(e.ID, map[string]any{"error": "分镜导入失败：" + err.Error()})
	}
	return true, nil
}

// applyScriptShots 把镜头表写入本集：解析角色、道具与场景引用，按分镜规则计时并切分剧情段。
// hints 是剧本给出的新设定外观，用于即时建档；info 补齐逐集追加时缺少的梗概。
func (r *dramaRun) applyScriptShots(episode *model.DramaEpisode, scripted []production.ScriptShot, hints []production.ScriptCast, info production.ScriptEpisode) error {
	casts, err := r.s.repo.DramaCasts(r.project.ID)
	if err != nil {
		return err
	}
	hintByKey := map[string]production.ScriptCast{}
	for _, hint := range hints {
		hintByKey[hint.Kind+"|"+production.NormalizeName(hint.Name)] = hint
	}
	characters, props, scenes := dramaKindIndex(casts, "character"), dramaKindIndex(casts, "prop"), dramaKindIndex(casts, "scene")
	now := time.Now()
	var created []model.DramaCast
	position := len(casts)
	resolve := func(index *production.CastIndex, kind string, name string) string {
		name = strings.TrimSpace(name)
		if name == "" || production.IsNarrator(name) {
			return ""
		}
		if id, ok := index.Lookup(name); ok {
			return id
		}
		// 剧本里首次出现的人物或地点即时建档，后续集通过别名归并复用；剧本给了外观就一并写入，参考图才有依据。
		cast := model.DramaCast{ID: newID(), ProjectID: r.project.ID, Kind: kind, Name: truncateRunes(name, 60), AliasesJSON: "[]", Position: position, CreatedAt: now, UpdatedAt: now}
		if hint, ok := hintByKey[kind+"|"+production.NormalizeName(name)]; ok {
			cast.Appearance = truncateRunes(hint.Appearance, 1000)
			if kind == "character" {
				cast.VoiceInstructions = truncateRunes(hint.Voice, 500)
			}
		}
		position++
		created = append(created, cast)
		index.Add(cast.ID, cast.Name)
		return cast.ID
	}
	shots := make([]model.DramaShot, 0, len(scripted))
	for index, item := range scripted {
		castIDs := []string{}
		for _, name := range item.Characters {
			if id := resolve(characters, "character", name); id != "" && !containsString(castIDs, id) && len(castIDs) < 4 {
				castIDs = append(castIDs, id)
			}
		}
		speakerID := resolve(characters, "character", item.Speaker)
		if speakerID != "" && !containsString(castIDs, speakerID) && len(castIDs) < 4 {
			castIDs = append(castIDs, speakerID)
		}
		propIDs := []string{}
		for _, name := range item.Props {
			if id := resolve(props, "prop", name); id != "" && !containsString(propIDs, id) && len(propIDs) < 3 {
				propIDs = append(propIDs, id)
			}
		}
		shot := model.DramaShot{ID: newID(), ProjectID: r.project.ID, EpisodeID: episode.ID, Position: index, Scene: truncateRunes(item.Scene, 120), SceneCastID: resolve(scenes, "scene", item.Scene), CastIDsJSON: encodeStringList(castIDs), PropIDsJSON: encodeStringList(propIDs), Speaker: truncateRunes(item.Speaker, 60), Dialogue: truncateRunes(item.Dialogue, dramaMaxDialogueRunes), Action: truncateRunes(item.Action, 1000), ShotSize: truncateRunes(item.ShotSize, 30), Camera: truncateRunes(item.Camera, 60), DurationMs: r.settings.Storyboard.ShotMs(item.DurationSeconds, item.Dialogue), ImagePrompt: truncateRunes(item.ImagePrompt, 2000), VideoPrompt: truncateRunes(item.VideoPrompt, 2000), SourceQuote: truncateRunes(item.SourceQuote, 300), Transition: production.NormalizeTransition(item.Transition), CreatedAt: now, UpdatedAt: now}
		shots = append(shots, shot)
	}
	profile, err := r.s.dramaVideoProfile(r.settings.Models.Video)
	if err != nil {
		return err
	}
	// 说完长台词的镜头可能超过视频模型单次上限：夹到上限而不是整集失败，台词保持原样，用户可在剧本里拆镜。
	limit := int64(profile.maxSeconds()) * 1000
	var total int64
	for i := range shots {
		if limit > 0 && shots[i].DurationMs > limit {
			shots[i].DurationMs = limit
		}
		total += shots[i].DurationMs
	}
	assignDramaSegments(shots, r.settings.Storyboard.SegmentLimits(profile.maxSeconds()))
	if err := r.s.repo.CreateDramaCasts(created); err != nil {
		return err
	}
	fields := map[string]any{"shot_count": len(shots), "duration_ms": total, "stage": model.DramaEpisodePrompts, "error": "", "approved": false}
	if strings.TrimSpace(episode.Synopsis) == "" && info.Synopsis != "" {
		fields["synopsis"], fields["hook"], fields["cliffhanger"] = truncateRunes(info.Synopsis, 1000), truncateRunes(info.Hook, 300), truncateRunes(info.Cliffhanger, 300)
	}
	revision := episode.Revision
	_, err = r.s.repo.ApplyDramaScript(episode.ID, &revision, fields, shots)
	return err
}

// dramaMaxDialogueRunes 是单镜台词的存储上限；远高于分镜规则的单镜字数，只防异常输入，不用于裁剪正常台词。
const dramaMaxDialogueRunes = 500

func dramaKindIndex(casts []model.DramaCast, kind string) *production.CastIndex {
	index := production.NewCastIndex()
	for _, cast := range casts {
		if cast.Kind == kind {
			index.Add(cast.ID, append([]string{cast.Name}, decodeStringList(cast.AliasesJSON)...)...)
		}
	}
	return index
}

// dramaTaskResource 从任务结果中取第一个媒体资源 ID；兼容 storageKey 与裸 resourceId 两种写法。
func dramaTaskResource(task *model.Task) string {
	if id, _ := taskOutputResource(task.ResultJSON, task.Type); id != "" {
		return id
	}
	var value any
	if json.Unmarshal([]byte(task.ResultJSON), &value) != nil {
		return ""
	}
	var find func(any) string
	find = func(node any) string {
		switch item := node.(type) {
		case map[string]any:
			if id, ok := item["resourceId"].(string); ok && strings.TrimSpace(id) != "" {
				return strings.TrimSpace(id)
			}
			for _, child := range item {
				if id := find(child); id != "" {
					return id
				}
			}
		case []any:
			for _, child := range item {
				if id := find(child); id != "" {
					return id
				}
			}
		}
		return ""
	}
	return find(value)
}

func (r *dramaRun) applyCastImage(job *model.DramaJob, task *model.Task) error {
	resourceID := dramaTaskResource(task)
	if resourceID == "" {
		return errors.New("参考图任务没有返回图片")
	}
	// 版本始终入库；只有槽位仍在等待本任务时才切换当前参考图，用户期间发起的重做不会被旧结果覆盖。
	if err := r.s.repo.CreateDramaTake(&model.DramaTake{ID: newID(), ProjectID: r.project.ID, OwnerID: job.CastID, Kind: "cast", ResourceID: resourceID, TaskID: task.ID, Prompt: truncateRunes(task.Prompt, 2000), CreatedAt: time.Now()}); err != nil {
		return err
	}
	// 有的模型会无视尺寸参数出方图：画幅明显不符时不设为当前参考图（否则会带进每个剧情段），
	// 结果保留在版本记录里，设定标记失败并写明实际尺寸。
	if cast, err := r.s.repo.DramaCast(r.project.ID, job.CastID); err == nil {
		ratio := r.castImageRatio(cast.Kind)
		if resource, err := r.s.repo.ResourceForUser(r.project.UserID, resourceID); err == nil && resource != nil && dramaImageRatioMismatch(resource.Width, resource.Height, ratio) {
			return &dramaResultIssue{message: fmt.Sprintf("图片模型返回了 %d×%d（%s）的参考图，与要求的 %s 不符；结果已保留在版本记录中，请换用支持 %s 的图片模型后重新生成", resource.Width, resource.Height, dramaRatioLabel(fmt.Sprintf("%dx%d", resource.Width, resource.Height)), ratio, ratio)}
		}
	}
	_, err := r.s.repo.UpdateDramaCastIf(job.CastID, []string{model.DramaMediaRunning, model.DramaMediaQueued}, map[string]any{"image_resource_id": resourceID, "image_status": model.DramaMediaReady, "image_version": gorm.Expr("image_version + 1")})
	return err
}

func (r *dramaRun) applyRender(job *model.DramaJob, task *model.Task) error {
	var result timelineRenderResult
	if err := json.Unmarshal([]byte(task.ResultJSON), &result); err != nil || result.ResourceID == "" {
		return errors.New("成片渲染没有返回视频")
	}
	episode, err := r.s.repo.DramaEpisode(r.project.ID, job.EpisodeID)
	if err != nil {
		return err
	}
	if err := r.s.repo.CreateDramaTake(&model.DramaTake{ID: newID(), ProjectID: r.project.ID, OwnerID: episode.ID, Kind: "final", ResourceID: result.ResourceID, TaskID: task.ID, DurationMs: result.DurationMs, CreatedAt: time.Now()}); err != nil {
		return err
	}
	var payload dramaRevisionPayload
	_ = json.Unmarshal([]byte(job.PayloadJSON), &payload)
	if episode.Stage != model.DramaEpisodeRender || episode.Revision != payload.Revision {
		return nil
	}
	_, err = r.s.repo.UpdateDramaEpisodeIfRevision(episode.ID, episode.Revision, map[string]any{"final_resource_id": result.ResourceID, "subtitle_srt": result.SubtitleSRT, "final_stale": false, "duration_ms": result.DurationMs, "stage": model.DramaEpisodeDone, "error": ""})
	return err
}

// ===== 任务构建 =====

// submit 在派发时构建任务请求；skip=true 表示目标已不再需要该工作。
func (r *dramaRun) submit(job *model.DramaJob) (*model.Task, bool, error) {
	switch job.Kind {
	case model.DramaJobBible:
		return r.submitBible()
	case model.DramaJobPlan:
		return r.submitPlan(job)
	case model.DramaJobScript:
		episode, err := r.s.repo.DramaEpisode(r.project.ID, job.EpisodeID)
		if err != nil {
			return nil, false, err
		}
		job.PayloadJSON = encodeDramaRevision(episode.Revision)
		return r.submitScript(job)
	case model.DramaJobCastImage:
		cast, err := r.s.repo.DramaCast(r.project.ID, job.CastID)
		if err != nil {
			return nil, false, err
		}
		job.PayloadJSON = encodeDramaRevision(cast.Revision)
		return r.submitCastImage(job)
	case model.DramaJobSegmentVideo:
		return r.submitSegmentVideo(job)
	case model.DramaJobRender:
		return r.submitRender(job)
	case model.DramaJobSegmentPrompt:
		return r.submitSegmentPrompt(job)
	}
	return nil, true, nil
}

// submitSegmentPrompt 让文本模型按镜头表把一个剧情段写成完整视频提示词。
func (r *dramaRun) submitSegmentPrompt(job *model.DramaJob) (*model.Task, bool, error) {
	segment, err := r.s.repo.DramaSegment(r.project.ID, job.ShotID)
	if err != nil {
		return nil, false, err
	}
	job.PayloadJSON = encodeDramaRevision(segment.Revision)
	if segment.PromptStatus != "" {
		return nil, true, nil
	}
	shots, err := r.s.repo.DramaShots(segment.EpisodeID)
	if err != nil {
		return nil, false, err
	}
	castByID := make(map[string]model.DramaCast, len(r.casts))
	for _, cast := range r.casts {
		castByID[cast.ID] = cast
	}
	rows, err := r.s.repo.DramaSegments(segment.EpisodeID)
	if err != nil {
		return nil, false, err
	}
	drafts := buildDramaSegmentDrafts(r.settings, r.meta, shots, castByID, rows)
	for position, draft := range drafts {
		if draft.view.Index != segment.SegmentIndex {
			continue
		}
		previous := ""
		if position > 0 {
			last := drafts[position-1].shots[len(drafts[position-1].shots)-1]
			previous = strings.TrimSpace(strings.Join([]string{last.Action, last.VideoPrompt, last.Dialogue}, "；"))
		}
		profile, err := r.s.dramaVideoProfile(segmentVideoChoice(*segment, r.settings.Models.Video))
		if err != nil {
			return nil, false, err
		}
		if draft.view.DurationMs > int64(profile.maxSeconds())*1000 {
			return nil, false, errors.New("剧情段时长超过所选模型上限")
		}
		seconds := production.SnapVideoSeconds(draft.view.DurationMs, profile.Durations)
		// 并行出片不带上一段尾帧，提示词不能写“首帧承接上一段”。
		draft.input.FirstFrame = position > 0 && !r.settings.parallelVideo()
		if len(draft.input.Shots) > 0 {
			draft.input.Shots[len(draft.input.Shots)-1].DurationMs += int64(seconds)*1000 - draft.view.DurationMs
		}
		payload, _ := json.Marshal(dramaRevisionPayload{Revision: segment.Revision, Seconds: seconds})
		job.PayloadJSON = string(payload)
		skill, err := r.s.dramaWritingSkill(r.project.UserID, r.settings.PromptSkill)
		if err != nil {
			return nil, false, err
		}
		prompt := production.SegmentWriterPrompt(draft.input, production.SegmentVideoPrompt(draft.input), previous, skill)
		task, err := r.createTask("text", "text", prompt, r.textInput(job, production.SegmentWriterSystemPrompt()))
		return task, false, err
	}
	return nil, true, nil
}

func (r *dramaRun) applySegmentPrompt(job *model.DramaJob, task *model.Task) error {
	text, err := dramaTaskText(task)
	if err != nil {
		return err
	}
	prompt := production.CleanWrittenPrompt(text)
	if utf8.RuneCountInString(prompt) < 50 {
		return errors.New("模型返回的视频提示词过短")
	}
	var payload dramaRevisionPayload
	if err := json.Unmarshal([]byte(job.PayloadJSON), &payload); err != nil {
		return err
	}
	_, err = r.s.repo.UpdateDramaSegmentRevision(job.ShotID, payload.Revision, map[string]any{"video_prompt": truncateRunes(prompt, 12000), "prompt_status": model.DramaMediaReady, "prompt_error": "", "prompt_seconds": payload.Seconds})
	return err
}

func (r *dramaRun) metadata(job *model.DramaJob) map[string]any {
	return map[string]any{"source": "drama_production", "dramaJobId": job.ID, "domainProjectId": r.project.ID, "episodeId": job.EpisodeID, "shotId": job.ShotID}
}

func (r *dramaRun) createTask(capability string, operation string, prompt string, input map[string]any) (*model.Task, error) {
	return r.createTaskWith(r.settings.Models.choice(capability), capability, operation, prompt, input)
}

func (r *dramaRun) createTaskWith(choice DramaModelChoice, capability string, operation string, prompt string, input map[string]any) (*model.Task, error) {
	if choice.Empty() {
		return nil, fmt.Errorf("没有可用的%s模型", map[string]string{"text": "文本", "image": "图片", "video": "视频"}[capability])
	}
	config, _ := input["config"].(map[string]any)
	if config == nil {
		config = map[string]any{}
	}
	if choice.ChannelID != "" {
		config["channelId"], config["model"], config["channelModelKey"] = choice.ChannelID, choice.ModelKey, choice.ModelKey
	}
	input["config"], input["mode"], input["prompt"] = config, capability, prompt
	req := CreateTaskRequest{ProjectID: r.project.ID, Type: "canvas_" + capability, Operation: operation, Prompt: prompt, LogicalModelID: choice.LogicalModelID, Model: choice.ModelKey, Input: input}
	task, err := r.s.submitDramaTask(r.project.UserID, req)

	return task, err
}

// imageRequest 把参考图期望画幅与作品指定的分辨率换算到所选模型真正支持的尺寸；一轮调度内按画幅缓存。
func (r *dramaRun) imageRequest(ratio string) dramaImageRequest {
	if r.imageSizes == nil {
		r.imageSizes = map[string]dramaImageRequest{}
	}
	request, cached := r.imageSizes[ratio]
	if !cached {
		request = r.s.dramaImageRequestFor(r.settings.Models.Image, ratio, r.settings.Assets.Resolution)
		r.imageSizes[ratio] = request
	}
	return request
}

// castImageRatio 是设定参考图的期望画幅：场景与道具统一横版 16:9，角色按参考图方案。
func (r *dramaRun) castImageRatio(kind string) string {
	if kind == "character" {
		return r.settings.Assets.CharacterRatio
	}
	return production.AssetImageRatio
}

func (r *dramaRun) textInput(job *model.DramaJob, systemPrompt string) map[string]any {
	return map[string]any{"config": map[string]any{"systemPrompt": systemPrompt}, "textOptions": map[string]any{"stream": false}, "metadata": r.metadata(job)}
}

func (r *dramaRun) loadChapters(ids []string) ([]production.Chapter, error) {
	var units []model.ProjectUnit
	var err error
	if ids == nil {
		units, err = r.s.repo.DramaChapters(r.project.ID)
	} else {
		units, err = r.s.repo.DramaChaptersByIDs(r.project.ID, ids)
	}
	if err != nil {
		return nil, err
	}
	chapters := make([]production.Chapter, 0, len(units))
	for _, unit := range units {
		chapters = append(chapters, production.Chapter{ID: unit.ID, Index: unit.Position + 1, Title: unit.Title, Text: unit.SourceText})
	}
	return chapters, nil
}

func (r *dramaRun) submitBible() (*model.Task, bool, error) {
	chapters, err := r.loadChapters(nil)
	if err != nil {
		return nil, false, err
	}
	prompt := production.BiblePrompt(r.project.Name, r.settings.Settings, chapters, dramaBibleSampleRunes)
	input := map[string]any{"config": map[string]any{"systemPrompt": production.BibleSystemPrompt()}, "textOptions": map[string]any{"stream": false}, "metadata": map[string]any{"source": "drama_production", "domainProjectId": r.project.ID}}
	task, err := r.createTask("text", "text", prompt, input)
	return task, false, err
}

func (r *dramaRun) bibleSummary() string {
	var b strings.Builder
	if r.meta.Logline != "" {
		b.WriteString("卖点：" + r.meta.Logline + "\n")
	}
	if r.meta.Tone != "" {
		b.WriteString("基调：" + r.meta.Tone + "\n")
	}
	b.WriteString(r.castSummary("character", 24))
	return b.String()
}

func (r *dramaRun) castSummary(kind string, limit int) string {
	var b strings.Builder
	count := 0
	for _, cast := range r.casts {
		if cast.Kind != kind || count >= limit {
			continue
		}
		count++
		aliases := decodeStringList(cast.AliasesJSON)
		line := "- " + cast.Name
		if len(aliases) > 0 {
			line += "（又称 " + strings.Join(aliases, "、") + "）"
		}
		if detail := firstNonEmpty(cast.Role, cast.Description); detail != "" {
			line += "：" + truncateRunes(detail, 60)
		}
		b.WriteString(line + "\n")
	}
	return b.String()
}

func (r *dramaRun) submitPlan(job *model.DramaJob) (*model.Task, bool, error) {
	var payload dramaPlanPayload
	if err := json.Unmarshal([]byte(job.PayloadJSON), &payload); err != nil {
		return nil, false, err
	}
	if payload.Start != r.production.PlanCursor {
		return nil, true, nil
	}
	chapters, err := r.loadChapters(nil)
	if err != nil {
		return nil, false, err
	}
	if payload.End > len(chapters) {
		payload.End = len(chapters)
	}
	next, err := r.s.repo.MaxDramaEpisodeNumber(r.project.ID)
	if err != nil {
		return nil, false, err
	}
	previous := ""
	if last, err := r.s.repo.LastDramaEpisode(r.project.ID); err == nil && last != nil {
		previous = last.Cliffhanger
	}
	prompt := production.PlanPrompt(r.project.Name, r.settings.Settings, r.bibleSummary(), chapters[payload.Start:payload.End], next+1, previous)
	task, err := r.createTask("text", "text", prompt, r.textInput(job, production.PlanSystemPrompt()))
	return task, false, err
}

func (r *dramaRun) submitScript(job *model.DramaJob) (*model.Task, bool, error) {
	episode, err := r.s.repo.DramaEpisode(r.project.ID, job.EpisodeID)
	if err != nil {
		return nil, true, nil
	}
	if episode.Stage != model.DramaEpisodeScript {
		return nil, true, nil
	}
	chapters, err := r.loadChapters(decodeStringList(episode.ChapterIDsJSON))
	if err != nil {
		return nil, false, err
	}
	profile, err := r.s.dramaVideoProfile(r.settings.Models.Video)
	if err != nil {
		return nil, false, err
	}
	prompt := production.ScriptPrompt(production.ScriptContext{
		Segment: r.settings.Storyboard.SegmentLimits(profile.maxSeconds()),
		Title:   r.project.Name, Settings: r.settings.Settings, VisualRules: r.meta.VisualRules,
		EpisodeNumber: episode.Number, EpisodeTitle: episode.Title, Synopsis: episode.Synopsis, Hook: episode.Hook, Cliffhanger: episode.Cliffhanger,
		CastSummary: r.castSummary("character", 30), PropSummary: r.castSummary("prop", 20), SceneSummary: r.castSummary("scene", 20), SourceChapters: chapters,
		SourceFormat: episode.SourceFormat,
	})
	task, err := r.createTask("text", "text", prompt, r.textInput(job, production.ScriptSystemPrompt()))
	return task, false, err
}

func (r *dramaRun) submitCastImage(job *model.DramaJob) (*model.Task, bool, error) {
	cast, err := r.s.repo.DramaCast(r.project.ID, job.CastID)
	// 槽位处于 running 可能是本工作的上一轮尝试，只有已就绪或锁定时才不再需要。
	if err != nil || cast.Locked || cast.ImageStatus == model.DramaMediaReady {
		return nil, true, nil
	}
	appearance := firstNonEmpty(cast.Appearance, cast.Description, cast.Role)
	assets := r.settings.Assets
	prompt := production.CastImagePrompt(assets, cast.Kind, cast.Name, appearance, r.settings.StylePrompt, r.meta.VisualRules)
	// 资产参考图统一横版 16:9，与作品画幅无关：场景要容纳完整空间，道具要留足展示余量。
	// 角色按参考图方案的画幅（内置方案均为 16:9，自定义方案可改）。画幅通过尺寸参数约束，
	// 不只靠提示词；模型给不出接近的尺寸时直接失败并说明原因，不退回模型默认的方图。
	ratio := r.castImageRatio(cast.Kind)
	request := r.imageRequest(ratio)
	if request.Issue != "" {
		return nil, false, errors.New(request.Issue)
	}
	metadata := r.metadata(job)
	metadata["assetMode"], metadata["assetRatio"] = assets.Mode, ratio
	if assets.SourceSkillID != "" {
		metadata["assetSourceSkillId"], metadata["assetSourcePath"] = assets.SourceSkillID, assets.SourcePath
	}
	config := map[string]any{"count": "1"}
	request.apply(config)
	input := map[string]any{"config": config, "metadata": metadata}
	task, err := r.createTask("image", "text_to_image", prompt, input)
	return task, false, err
}

// assignDramaSegments 按分镜规则（智能 / 固定 / 范围）把一集镜头切成剧情段。
func assignDramaSegments(shots []model.DramaShot, limits production.SegmentLimits) {
	scenes := make([]string, len(shots))
	durations := make([]int64, len(shots))
	for i := range shots {
		scenes[i] = shots[i].Scene
		durations[i] = shots[i].DurationMs
	}
	for index, seg := range production.SegmentShotsForVideo(scenes, durations, limits) {
		for i := seg.Start; i < seg.End; i++ {
			shots[i].SegmentIndex = index
			shots[i].SegmentTitle = truncateRunes(seg.Title, 120)
		}
	}
}

func dramaRenderSize(aspect string) (int, int) {
	switch aspect {
	case "16:9":
		return 1920, 1080
	case "1:1":
		return 1080, 1080
	case "3:4":
		return 1080, 1440
	case "4:3":
		return 1440, 1080
	}
	return 1080, 1920
}

// buildDramaTimeline 把一集镜头装配为时间线：视频轨静音，配音轨按镜头起点对齐，字幕单独输出。
func buildDramaTimeline(segments []model.DramaSegment, aspect string) (renderProject, error) {
	width, height := dramaRenderSize(aspect)
	visible := true
	timeline := renderProject{Version: 2, Width: width, Height: height, Tracks: []renderTrack{{ID: "video", Kind: "video", Visible: &visible}}}
	if len(segments) == 0 {
		return timeline, errors.New("没有可合成的剧情段")
	}
	for _, seg := range segments {
		if seg.VideoStatus != model.DramaMediaReady || seg.VideoResourceID == "" || seg.VideoSeconds <= 0 {
			return timeline, errors.New("所有剧情段视频就绪后才能合成")
		}
		duration := int64(seg.VideoSeconds) * 1000
		clip := renderClip{ID: "v-" + seg.ID, Kind: "video", TrackID: "video", StartMs: timeline.DurationMs, DurationMs: duration, SourceDurationMs: duration, Volume: 1}
		clip.DirectMedia = &struct {
			ID         string `json:"id"`
			Kind       string `json:"kind"`
			StorageKey string `json:"storageKey"`
		}{seg.VideoResourceID, "video", "resource:" + seg.VideoResourceID}
		timeline.Clips = append(timeline.Clips, clip)
		timeline.DurationMs += duration
	}
	return timeline, nil
}

func (r *dramaRun) submitRender(job *model.DramaJob) (*model.Task, bool, error) {
	episode, err := r.s.repo.DramaEpisode(r.project.ID, job.EpisodeID)
	if err != nil || (episode.Stage != model.DramaEpisodeRender) {
		return nil, true, nil
	}
	segments, err := r.s.repo.DramaSegments(episode.ID)
	if err != nil {
		return nil, false, err
	}
	timeline, err := buildDramaTimeline(segments, r.settings.AspectRatio)
	if err != nil {
		return nil, false, err
	}
	job.PayloadJSON = encodeDramaRevision(episode.Revision)
	return r.s.createDramaRenderTask(r.project, timeline)
}

func (s *Service) submitDramaTask(userID string, req CreateTaskRequest) (*model.Task, error) {
	if s.dramaTaskHook != nil {
		return s.dramaTaskHook(userID, req, nil)
	}
	task, err := s.CreateTask(userID, req)
	if err == nil {
		s.wakeTaskDispatcher()
	}
	return task, err
}

func (s *Service) createDramaRenderTask(project *model.Project, timeline renderProject) (*model.Task, bool, error) {
	if s.dramaTaskHook != nil {
		task, err := s.dramaTaskHook(project.UserID, CreateTaskRequest{Type: model.TaskTypeTimelineRender}, &timeline)
		return task, false, err
	}
	task, err := s.CreateTimelineRenderTask(project.UserID, TimelineRenderCreateRequest{ProjectID: project.ID, Timeline: timeline})
	if err != nil {
		return nil, false, err
	}
	s.wakeTaskDispatcher()
	return task, false, nil
}
