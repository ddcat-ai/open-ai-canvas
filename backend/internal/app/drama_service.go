package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"yingce/backend/internal/model"
	"yingce/backend/internal/production"
	"yingce/backend/internal/repository"

	"gorm.io/gorm"
)

const (
	dramaMaxChapters      = 3000
	dramaMaxChapterRunes  = 60000
	dramaMaxNovelRunes    = 6_000_000
	dramaInboxShotLimit   = 60
	dramaEpisodeJobsLimit = 40
)

// CreateDrama 一次性写入项目、小说章节与制作控制面；start=true 时立即进入自动制作。
func (s *Service) CreateDrama(userID string, req CreateDramaRequest) (DramaSummary, error) {
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return DramaSummary{}, BadAuthRequest("作品名称不能为空")
	}
	if utf8.RuneCountInString(name) > 80 {
		return DramaSummary{}, BadAuthRequest("作品名称不能超过 80 字")
	}
	if len(req.Chapters) == 0 || len(req.Chapters) > dramaMaxChapters {
		return DramaSummary{}, BadAuthRequest("章节数量必须在 1 到 3000 之间")
	}
	if req.BudgetMicrocredits < 0 {
		return DramaSummary{}, BadAuthRequest("预算不能为负数")
	}
	if req.Settings.MediaMode == "" {
		// 新作品默认先只跑文本：先看剧情、分镜与资产，确认后再花钱生图。
		req.Settings.MediaMode = DramaMediaManual
	}
	format := production.NormalizeSourceFormat(req.SourceFormat)
	// 分集方式随设置保存；请求顶层的 episodeMode 只在设置里没写时使用。
	if req.Settings.EpisodeMode == "" {
		req.Settings.EpisodeMode = firstNonEmpty(req.EpisodeMode, DramaEpisodeModeAuto)
	}
	// 剧本与分镜本身就是按集写好的，总是每章一集。
	if format != production.SourceNovel {
		req.Settings.EpisodeMode, req.Settings.ChaptersPerEpisode = DramaEpisodeModeChapter, 1
	}
	settings := req.Settings.normalized()
	if problem := production.ValidateAssetPrompts(settings.Assets); problem != "" {
		return DramaSummary{}, BadAuthRequest(problem)
	}
	if _, err := s.dramaWritingSkill(userID, settings.PromptSkill); err != nil {
		return DramaSummary{}, err
	}
	models, err := s.resolveDramaModels(userID, settings)
	if err != nil {
		return DramaSummary{}, err
	}
	settings.Models = models
	if err := s.validateDramaImageSettings(models, settings.Assets); err != nil {
		return DramaSummary{}, err
	}
	if err := s.validateDramaVideoSettings(settings); err != nil {
		return DramaSummary{}, err
	}
	if req.Start {
		if missing := missingDramaCapabilities(models); len(missing) > 0 {
			return DramaSummary{}, BadAuthRequest("还没有可用的" + strings.Join(missing, "、") + "模型，请联系管理员开通后再开始制作")
		}
	}
	// 按章分集时建档即写好各集；交给模型分集时由调度循环分批规划。
	perChapter := settings.EpisodeMode == DramaEpisodeModeChapter
	now := time.Now()
	project := model.Project{ID: newID(), UserID: userID, Name: name, Type: "short-drama", AspectRatio: settings.AspectRatio, SourceType: format, Status: model.ProjectStatusActive, Revision: 1, CreatedAt: now, UpdatedAt: now}
	chapters := make([]model.ProjectUnit, 0, len(req.Chapters))
	totalRunes := 0
	for index, input := range req.Chapters {
		text := strings.TrimSpace(strings.ReplaceAll(input.Text, "\r\n", "\n"))
		runes := utf8.RuneCountInString(text)
		if runes > dramaMaxChapterRunes {
			return DramaSummary{}, BadAuthRequest("单章不能超过 6 万字，请检查章节拆分")
		}
		// 剧本提示词每章最多读取这么多字，超出会被截断而丢台词，所以无论哪种分集方式都直接拒绝。
		if runes > production.ScriptSourceChapterRunes {
			label := "章"
			if perChapter && settings.ChaptersPerEpisode == 1 {
				label = "集"
			}
			return DramaSummary{}, BadAuthRequest(fmt.Sprintf("第 %d %s原文 %d 字，单章不超过 %d 字，请在章节标题处拆开", index+1, label, runes, production.ScriptSourceChapterRunes))
		}
		totalRunes += runes
		title := strings.TrimSpace(input.Title)
		if title == "" {
			title = "第 " + itoa(index+1) + " 章"
		}
		chapters = append(chapters, model.ProjectUnit{ID: newID(), ProjectID: project.ID, Kind: model.ProjectUnitKindChapter, Title: truncateRunes(title, 200), SourceText: text, WordCount: runes, Status: model.ProjectUnitStatusReady, Position: index, CreatedAt: now, UpdatedAt: now})
	}
	if totalRunes == 0 {
		return DramaSummary{}, BadAuthRequest("原文为空")
	}
	if totalRunes > dramaMaxNovelRunes {
		return DramaSummary{}, BadAuthRequest("原文不能超过 600 万字")
	}
	status := model.DramaStatusDraft
	if req.Start {
		status = model.DramaStatusRunning
	}
	productionRow := model.DramaProduction{ProjectID: project.ID, UserID: userID, Status: status, Stage: model.DramaStageBible, SettingsJSON: encodeDramaSettings(settings), BudgetMicrocredits: req.BudgetMicrocredits, Revision: 1, CreatedAt: now, UpdatedAt: now}
	var episodes []model.DramaEpisode
	if perChapter {
		// 按章分组直接建集，分集规划视为已完成；建档后各集按窗口依次写剧本。
		productionRow.PlanCursor, productionRow.PlanDone = len(chapters), true
		episodes, err = groupDramaChapterEpisodes(project.ID, 1, chapters, settings.ChaptersPerEpisode, format, now)
		if err != nil {
			return DramaSummary{}, err
		}
	}
	if err := s.repo.CreateDramaProject(&project, chapters, &productionRow, episodes...); err != nil {
		if errors.Is(err, repository.ErrProjectNameConflict) {
			conflict := NewAppError(http.StatusConflict, "已有同名作品，请换一个名称")
			conflict.Reason = ReasonProjectNameConflict
			return DramaSummary{}, conflict
		}
		return DramaSummary{}, err
	}
	s.wakeDramaScheduler()
	return s.DramaSummary(userID, project.ID)
}

// newDramaChapterEpisode 把一章原文直接建成一集；梗概、钩子和悬念留空，由剧本阶段按原文补写。
func newDramaChapterEpisode(projectID string, number int, chapter model.ProjectUnit, format string, now time.Time) model.DramaEpisode {
	return model.DramaEpisode{ID: newID(), ProjectID: projectID, Number: number, Title: truncateRunes(chapter.Title, 60), ChapterIDsJSON: encodeStringList([]string{chapter.ID}), SourceFormat: format, Stage: model.DramaEpisodeQueued, Revision: 1, CreatedAt: now, UpdatedAt: now}
}

// groupDramaChapterEpisodes 按章节顺序每 perEpisode 章合成一集，编号从 startNumber 起；
// 合并后单集原文超过上限时拒绝，提示减少每集章数。章节只需 ID、标题与字数。
func groupDramaChapterEpisodes(projectID string, startNumber int, chapters []model.ProjectUnit, perEpisode int, format string, now time.Time) ([]model.DramaEpisode, error) {
	perEpisode = max(1, min(dramaMaxChaptersPerEpisode, perEpisode))
	episodes := make([]model.DramaEpisode, 0, (len(chapters)+perEpisode-1)/perEpisode)
	for start := 0; start < len(chapters); start += perEpisode {
		group := chapters[start:min(start+perEpisode, len(chapters))]
		if len(group) == 1 {
			episodes = append(episodes, newDramaChapterEpisode(projectID, startNumber+len(episodes), group[0], format, now))
			continue
		}
		ids, runes := make([]string, 0, len(group)), 0
		for _, chapter := range group {
			ids = append(ids, chapter.ID)
			runes += chapter.WordCount
		}
		first, last := group[0].Position+1, group[len(group)-1].Position+1
		if runes > dramaEpisodeSourceRunes {
			return nil, BadAuthRequest(fmt.Sprintf("第 %d–%d 章合计 %d 字，每集原文不超过 %d 字，请减少每集章数", first, last, runes, dramaEpisodeSourceRunes))
		}
		title := truncateRunes(group[0].Title, 40) + fmt.Sprintf(" 等 %d 章", len(group))
		episodes = append(episodes, model.DramaEpisode{ID: newID(), ProjectID: projectID, Number: startNumber + len(episodes), Title: truncateRunes(title, 60), ChapterIDsJSON: encodeStringList(ids), SourceFormat: format, Stage: model.DramaEpisodeQueued, Revision: 1, CreatedAt: now, UpdatedAt: now})
	}
	return episodes, nil
}

func itoa(value int) string {
	encoded, _ := json.Marshal(value)
	return string(encoded)
}

func (s *Service) dramaForUser(userID string, projectID string) (*model.Project, *model.DramaProduction, error) {
	project, err := s.repo.ProjectForUser(userID, strings.TrimSpace(projectID))
	if err != nil {
		return nil, nil, err
	}
	productionRow, err := s.repo.DramaProduction(project.ID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, NewAppError(http.StatusNotFound, "该项目不是自动制作短剧")
		}
		return nil, nil, err
	}
	return project, productionRow, nil
}

// DramaListRequest 是作品列表的分页与筛选条件；status 为空表示全部。
type DramaListRequest struct {
	Page     int
	PageSize int
	Query    string
	Status   string
}

func (s *Service) ListDramas(userID string, req DramaListRequest) (map[string]any, error) {
	switch req.Status {
	case "", model.DramaStatusDraft, model.DramaStatusRunning, model.DramaStatusPaused, model.DramaStatusCompleted:
	default:
		return nil, BadAuthRequest("状态筛选无效")
	}
	projects, total, err := s.repo.DramaProjectsPage(userID, truncateRunes(req.Query, 60), req.Status, req.Page, req.PageSize)
	if err != nil {
		return nil, err
	}
	statusCounts, err := s.repo.DramaStatusCounts(userID)
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(projects))
	for _, project := range projects {
		ids = append(ids, project.ID)
	}
	productions, err := s.repo.DramaProductionsForUser(userID, ids)
	if err != nil {
		return nil, err
	}
	counts, err := s.repo.DramaEpisodeCounts(ids)
	if err != nil {
		return nil, err
	}
	covers, err := s.repo.DramaCoverResources(ids, 4)
	if err != nil {
		return nil, err
	}
	canvasSpends, err := s.repo.DramaCanvasSpends(userID, ids)
	if err != nil {
		return nil, err
	}
	items := make([]DramaListItem, 0, len(projects))
	for _, project := range projects {
		productionRow, ok := productions[project.ID]
		if !ok {
			continue
		}
		count := counts[project.ID]
		settings := parseDramaSettings(productionRow.SettingsJSON)
		item := DramaListItem{
			Project: project, Status: productionRow.Status, Stage: productionRow.Stage, PauseReason: productionRow.PauseReason,
			EpisodeCount: count[0], DoneCount: count[1], CoverResourceIDs: covers[project.ID], AspectRatio: settings.AspectRatio,
			StyleName: settings.StyleName, SpentMicrocredits: productionRow.SpentMicrocredits + canvasSpends[project.ID], UpdatedAt: project.UpdatedAt.Format(time.RFC3339),
		}
		if len(item.CoverResourceIDs) > 0 {
			item.CoverResourceID = item.CoverResourceIDs[0]
		}
		items = append(items, item)
	}
	var all int64
	for _, count := range statusCounts {
		all += count
	}
	statusCounts["all"] = all
	return map[string]any{"items": items, "page": req.Page, "pageSize": req.PageSize, "total": total, "hasMore": int64(req.Page*req.PageSize) < total, "statusCounts": statusCounts}, nil
}

func (s *Service) DramaSummary(userID string, projectID string) (DramaSummary, error) {
	project, productionRow, err := s.dramaForUser(userID, projectID)
	if err != nil {
		return DramaSummary{}, err
	}
	chapters, err := s.repo.DramaChapterSummaries(project.ID)
	if err != nil {
		return DramaSummary{}, err
	}
	episodes, err := s.repo.DramaEpisodes(project.ID)
	if err != nil {
		return DramaSummary{}, err
	}
	stats, err := s.repo.DramaSegmentStats(project.ID)
	if err != nil {
		return DramaSummary{}, err
	}
	jobCounts, err := s.repo.DramaJobCounts(project.ID)
	if err != nil {
		return DramaSummary{}, err
	}
	casts, err := s.repo.DramaCasts(project.ID)
	if err != nil {
		return DramaSummary{}, err
	}
	words := 0
	for _, chapter := range chapters {
		words += chapter.WordCount
	}
	canvasSpent, err := s.dramaCanvasSpent(productionRow)
	if err != nil {
		return DramaSummary{}, err
	}
	meta := parseDramaBibleMeta(productionRow.BibleJSON)
	summary := DramaSummary{
		Project: *project,
		Production: DramaProductionView{
			Status: productionRow.Status, Stage: productionRow.Stage, PauseReason: productionRow.PauseReason,
			Settings: parseDramaSettings(productionRow.SettingsJSON), BudgetMicrocredits: productionRow.BudgetMicrocredits,
			SpentMicrocredits: productionRow.SpentMicrocredits + canvasSpent, CanvasSpentMicrocredits: canvasSpent, PlanDone: productionRow.PlanDone, PlanCursor: productionRow.PlanCursor,
			SampleApproved: productionRow.SampleApproved, AssetsReleased: productionRow.AssetsReleased, Logline: meta.Logline, Tone: meta.Tone,
			ChapterCount: len(chapters), WordCount: words,
		},
		Episodes:  make([]DramaEpisodeRow, 0, len(episodes)),
		JobCounts: jobCounts,
		Inbox:     []DramaInboxItem{},
		CastCount: len(casts),
	}
	settings := summary.Production.Settings
	awaiting := 0
	for _, episode := range episodes {
		stat := stats[episode.ID]
		held := dramaMediaHeld(settings, &episode)
		if held {
			awaiting++
		}
		summary.Episodes = append(summary.Episodes, DramaEpisodeRow{
			ID: episode.ID, Number: episode.Number, Title: episode.Title, Synopsis: truncateRunes(episode.Synopsis, 120), Stage: episode.Stage, SourceFormat: production.NormalizeSourceFormat(episode.SourceFormat), Error: episode.Error,
			ShotCount: episode.ShotCount, DurationMs: episode.DurationMs, Approved: episode.Approved, MediaReleased: episode.MediaReleased, AwaitingMedia: held,
			FinalResourceID: episode.FinalResourceID, FinalStale: episode.FinalStale,
			Stats: DramaEpisodeStats{Segments: stat.Total, PromptReady: stat.PromptReady, VideoReady: stat.VideoReady, Failed: stat.Failed},
		})
		if episode.Stage == model.DramaEpisodeReview {
			summary.Inbox = append(summary.Inbox, DramaInboxItem{ID: "review:" + episode.ID, Kind: "review", Severity: "info", Title: "第 " + itoa(episode.Number) + " 集视频提示词待审阅", Detail: "确认剧情段提示词后继续生成视频", EpisodeID: episode.ID})
		}
		if episode.Error != "" {
			summary.Inbox = append(summary.Inbox, DramaInboxItem{ID: "episode:" + episode.ID, Kind: "episode_error", Severity: "error", Title: "第 " + itoa(episode.Number) + " 集：" + episode.Title, Detail: episode.Error, EpisodeID: episode.ID})
		}
	}
	if awaiting > 0 {
		summary.Inbox = append([]DramaInboxItem{{ID: "media-ready", Kind: "media_ready", Severity: "info", Title: itoa(awaiting) + " 集剧本与分镜已就绪", Detail: "确认剧情、分镜与角色设定后再生成画面；可逐集生成，也可一次全部开始"}}, summary.Inbox...)
	}
	if productionRow.PauseReason != "" {
		summary.Inbox = append([]DramaInboxItem{{ID: "production", Kind: "paused", Severity: "warning", Title: "制作已暂停", Detail: productionRow.PauseReason}}, summary.Inbox...)
	}
	var castErrors map[string]string
	for _, cast := range casts {
		if cast.ImageStatus != model.DramaMediaFailed {
			continue
		}
		if castErrors == nil {
			if castErrors, err = s.repo.FailedDramaCastErrors(project.ID); err != nil {
				return DramaSummary{}, err
			}
		}
		// Title 只放名称，前端按原因把同类失败折叠成一组，不再逐条重复“参考图生成失败”。
		summary.Inbox = append(summary.Inbox, DramaInboxItem{ID: "cast:" + cast.ID, Kind: "cast_failed", Severity: "error", Title: cast.Name, Detail: firstNonEmpty(truncateRunes(castErrors[cast.ID], 240), "参考图生成失败"), CastID: cast.ID, CastKind: cast.Kind})
	}
	failedSegments, err := s.repo.FailedDramaSegments(project.ID, dramaInboxShotLimit)
	if err != nil {
		return DramaSummary{}, err
	}
	numberByEpisode := map[string]int{}
	for _, episode := range episodes {
		numberByEpisode[episode.ID] = episode.Number
	}
	for _, segment := range failedSegments {
		media := "video"
		reason := segment.VideoError
		if segment.PromptStatus == model.DramaMediaFailed {
			media = "prompt"
			reason = segment.PromptError
		}
		summary.Inbox = append(summary.Inbox, DramaInboxItem{ID: "segment:" + segment.ID, Kind: "segment_failed", Severity: "error", Title: fmt.Sprintf("第 %d 集 · 第 %d 段", numberByEpisode[segment.EpisodeID], segment.SegmentIndex+1), Detail: reason, EpisodeID: segment.EpisodeID, EpisodeNumber: numberByEpisode[segment.EpisodeID], SegmentIndex: segment.SegmentIndex, Media: media})
	}
	if settings.ReviewMode == DramaReviewSample && !productionRow.SampleApproved {
		for _, episode := range episodes {
			if episode.Number == 1 && episode.Stage == model.DramaEpisodeDone && !episode.FinalStale {
				summary.Inbox = append(summary.Inbox, DramaInboxItem{ID: "sample:" + episode.ID, Kind: "review", Severity: "info", Title: "第 1 集样片待确认", Detail: "确认样片后继续其余集视频", EpisodeID: episode.ID})
			}
		}
	}

	return summary, nil
}

func (s *Service) DramaEpisodeDetail(userID string, projectID string, episodeID string) (DramaEpisodeDetail, error) {
	project, productionRow, err := s.dramaForUser(userID, projectID)
	if err != nil {
		return DramaEpisodeDetail{}, err
	}
	episode, err := s.repo.DramaEpisode(project.ID, episodeID)
	if err != nil {
		return DramaEpisodeDetail{}, err
	}
	shots, err := s.repo.DramaShots(episode.ID)
	if err != nil {
		return DramaEpisodeDetail{}, err
	}
	chapterIDs := decodeStringList(episode.ChapterIDsJSON)
	chapters, err := s.repo.DramaChaptersByIDs(project.ID, chapterIDs)
	if err != nil {
		return DramaEpisodeDetail{}, err
	}
	refs := make([]DramaChapterRef, 0, len(chapters))
	for _, chapter := range chapters {
		refs = append(refs, DramaChapterRef{ID: chapter.ID, Title: chapter.Title, Position: chapter.Position, WordCount: chapter.WordCount})
	}
	jobs, err := s.repo.DramaJobsByStatus(project.ID, model.DramaJobQueued, model.DramaJobRunning)
	if err != nil {
		return DramaEpisodeDetail{}, err
	}
	views := []DramaJobView{}
	for _, job := range jobs {
		if job.EpisodeID == episode.ID && len(views) < dramaEpisodeJobsLimit {
			views = append(views, dramaJobView(job))
		}
	}
	detail := DramaEpisodeDetail{Episode: *episode, Shots: shots, Chapters: refs, Jobs: views}
	if job, jobErr := s.repo.LatestDramaJob(project.ID, model.DramaJobScript, episode.ID); jobErr == nil {
		view := dramaJobView(*job)
		detail.ScriptJob = &view
	}
	if err := s.fillDramaSegmentViews(project.ID, productionRow, &detail); err != nil {
		return DramaEpisodeDetail{}, err
	}
	if detail.DialogueCheck, err = s.dramaDialogueCheck(project.ID, episode, chapters, shots); err != nil {
		return DramaEpisodeDetail{}, err
	}
	return detail, nil
}

func dramaJobView(job model.DramaJob) DramaJobView {
	view := DramaJobView{ID: job.ID, Kind: job.Kind, Status: job.Status, Label: job.Label, Error: job.Error, EpisodeID: job.EpisodeID, ShotID: job.ShotID, TaskID: job.TaskID, CostMicrocredits: job.CostMicrocredits, Attempt: job.Attempt, CreatedAt: job.CreatedAt.Format(time.RFC3339), UpdatedAt: job.UpdatedAt.Format(time.RFC3339)}
	if job.StartedAt != nil {
		view.StartedAt = job.StartedAt.Format(time.RFC3339)
	}
	if job.FinishedAt != nil {
		view.FinishedAt = job.FinishedAt.Format(time.RFC3339)
	}
	return view
}

// dramaJobTaskParams 是队列详情可展示的请求参数白名单；渠道地址、密钥等配置不回显。
var dramaJobTaskParams = []string{"size", "imageResolution", "quality", "count", "videoSeconds", "vquality", "videoGenerateAudio"}

// DramaJobDetail 返回一项调度工作的历次提交：时间、模型、参数、状态、花费、错误与产出。
func (s *Service) DramaJobDetail(userID string, projectID string, jobID string) (DramaJobDetail, error) {
	project, productionRow, err := s.dramaForUser(userID, projectID)
	if err != nil {
		return DramaJobDetail{}, err
	}
	job, err := s.repo.DramaJob(project.ID, jobID)
	if err != nil {
		return DramaJobDetail{}, err
	}
	var attempts []DramaJobAttempt
	_ = json.Unmarshal([]byte(job.AttemptsJSON), &attempts)
	if job.TaskID != "" && (len(attempts) == 0 || attempts[len(attempts)-1].TaskID != job.TaskID) {
		attempts = append(attempts, DramaJobAttempt{TaskID: job.TaskID, Status: "running", CostMicrocredits: job.CostMicrocredits, At: dramaTime(job.StartedAt, job.UpdatedAt)})
	}
	labels := dramaModelLabels(parseDramaSettings(productionRow.SettingsJSON).Models)
	detail := DramaJobDetail{Job: dramaJobView(*job), Target: s.dramaJobTarget(project.ID, job), Attempts: make([]DramaJobAttemptView, 0, len(attempts))}
	// 最新一次排在最前，用户打开详情首先看到的是当前状态。
	for index := len(attempts) - 1; index >= 0; index-- {
		view := DramaJobAttemptView{DramaJobAttempt: attempts[index]}
		if view.TaskID != "" {
			if task, taskErr := s.repo.TaskForUser(userID, view.TaskID); taskErr == nil {
				view.Task = dramaJobTaskView(task, labels)
				view.Status = string(task.Status)
				if view.Error == "" {
					view.Error = task.Error
				}
			}
		}
		detail.Attempts = append(detail.Attempts, view)
	}
	return detail, nil
}

func dramaTime(primary *time.Time, fallback time.Time) string {
	if primary != nil {
		return primary.Format(time.RFC3339)
	}
	return fallback.Format(time.RFC3339)
}

func (s *Service) dramaJobTarget(projectID string, job *model.DramaJob) string {
	if job.CastID != "" {
		if cast, err := s.repo.DramaCast(projectID, job.CastID); err == nil {
			if cast.Kind == "scene" {
				return "场景 · " + cast.Name
			}
			return "角色 · " + cast.Name
		}
	}
	parts := []string{}
	if job.EpisodeID != "" {
		if episode, err := s.repo.DramaEpisode(projectID, job.EpisodeID); err == nil {
			parts = append(parts, "第 "+itoa(episode.Number)+" 集")
		}
	}
	if job.Kind == model.DramaJobSegmentPrompt || job.Kind == model.DramaJobSegmentVideo {
		if segment, err := s.repo.DramaSegment(projectID, job.ShotID); err == nil {
			parts = append(parts, fmt.Sprintf("第 %d 段", segment.SegmentIndex+1))
		}
	} else if job.ShotID != "" {
		if shot, err := s.repo.DramaShot(projectID, job.ShotID); err == nil {
			parts = append(parts, "镜头 "+itoa(shot.Position+1))
		}
	}
	return strings.Join(parts, " · ")
}

func dramaModelLabels(models DramaModels) map[string]string {
	labels := map[string]string{}
	for _, capability := range dramaCapabilities {
		choice := models.choice(capability)
		if choice.LogicalModelID != "" {
			labels["l:"+choice.LogicalModelID] = choice.Label
		}
		if choice.ModelKey != "" {
			labels["m:"+choice.ModelKey] = choice.Label
		}
	}
	return labels
}

func dramaJobTaskView(task *model.Task, labels map[string]string) *DramaJobTaskView {
	view := &DramaJobTaskView{
		ID: task.ID, Status: string(task.Status), Stage: task.Stage, Operation: task.Operation, Model: task.Model,
		ModelLabel: firstNonEmpty(labels["l:"+task.LogicalModelID], labels["m:"+task.Model], task.Model),
		Prompt:     truncateRunes(task.Prompt, 6000), Params: map[string]string{}, Error: task.Error, MediaStage: task.MediaStage,
		CreatedAt: task.CreatedAt.Format(time.RFC3339),
	}
	if task.StartedAt != nil {
		view.StartedAt = task.StartedAt.Format(time.RFC3339)
	}
	if task.CompletedAt != nil {
		view.CompletedAt = task.CompletedAt.Format(time.RFC3339)
	}
	var input struct {
		Config map[string]any `json:"config"`
	}
	if json.Unmarshal([]byte(task.InputJSON), &input) == nil {
		for _, key := range dramaJobTaskParams {
			if value := strings.TrimSpace(stringValue(input.Config[key])); value != "" {
				view.Params[key] = truncateRunes(value, 300)
			}
		}
	}
	var result map[string]any
	if json.Unmarshal([]byte(task.ResultJSON), &result) == nil {
		view.ResultMode, _ = result["mode"].(string)
		if text, ok := result["text"].(string); ok {
			view.ResultText = truncateRunes(text, 4000)
		}
		collect := func(value any) {
			if item, ok := value.(map[string]any); ok {
				if id, ok := item["resourceId"].(string); ok && id != "" {
					view.ResourceIDs = append(view.ResourceIDs, id)
				}
			}
		}
		for _, key := range []string{"images"} {
			if list, ok := result[key].([]any); ok {
				for _, item := range list {
					collect(item)
				}
			}
		}
		if len(view.ResourceIDs) == 0 {
			collect(result["video"])
		}
		if view.ResultMode == "" && task.Type == model.TaskTypeTimelineRender {
			view.ResultMode = "video"
			if id, ok := result["resourceId"].(string); ok && id != "" {
				view.ResourceIDs = append(view.ResourceIDs, id)
			}
		}
	}
	return view
}

func (s *Service) DramaJobs(userID string, projectID string, limit int) ([]DramaJobView, error) {
	project, _, err := s.dramaForUser(userID, projectID)
	if err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 200 {
		limit = 60
	}
	jobs, err := s.repo.RecentDramaJobs(project.ID, limit)
	if err != nil {
		return nil, err
	}
	views := make([]DramaJobView, 0, len(jobs))
	for _, job := range jobs {
		views = append(views, dramaJobView(job))
	}
	if err := s.attachDramaProviderStages(project.UserID, views); err != nil {
		return nil, err
	}
	return views, nil
}

// attachDramaProviderStages 为生成中的作业补上上游进度文案；一次查询覆盖整批作业。
func (s *Service) attachDramaProviderStages(userID string, views []DramaJobView) error {
	ids := []string{}
	for _, view := range views {
		if view.Status == model.DramaJobRunning && view.TaskID != "" {
			ids = append(ids, view.TaskID)
		}
	}
	stages, err := s.repo.RunningTaskStages(userID, ids)
	if err != nil {
		return err
	}
	for i := range views {
		if stage := stages[views[i].TaskID]; views[i].Status == model.DramaJobRunning && stage != "" {
			views[i].ProviderStage = stage
		}
	}
	return nil
}

func (s *Service) DramaCasts(userID string, projectID string) ([]model.DramaCast, error) {
	project, _, err := s.dramaForUser(userID, projectID)
	if err != nil {
		return nil, err
	}
	return s.repo.DramaCasts(project.ID)
}

func (s *Service) DramaChapter(userID string, projectID string, chapterID string) (model.ProjectUnit, error) {
	project, _, err := s.dramaForUser(userID, projectID)
	if err != nil {
		return model.ProjectUnit{}, err
	}
	unit, err := s.repo.ProjectUnit(project.ID, chapterID)
	if err != nil {
		return model.ProjectUnit{}, err
	}
	return *unit, nil
}

func (s *Service) DeleteDrama(userID string, projectID string) error {
	if _, _, err := s.dramaForUser(userID, projectID); err != nil {
		return err
	}
	if err := s.DeleteProject(userID, projectID); err != nil {
		return err
	}
	return s.repo.DeleteDramaProductionData(projectID)
}

func decodeStringList(raw string) []string {
	var values []string
	_ = json.Unmarshal([]byte(raw), &values)
	return values
}

func encodeStringList(values []string) string {
	if values == nil {
		values = []string{}
	}
	encoded, _ := json.Marshal(values)
	return string(encoded)
}

// fillDramaSegmentViews 按当前设置预演每个镜头会发给模型的首帧与视频提示词、视频秒数和转场。
func (s *Service) fillDramaSegmentViews(projectID string, p *model.DramaProduction, detail *DramaEpisodeDetail) error {
	settings := parseDramaSettings(p.SettingsJSON)
	casts, err := s.repo.DramaCasts(projectID)
	if err != nil {
		return err
	}
	castByID := map[string]model.DramaCast{}
	for _, cast := range casts {
		castByID[cast.ID] = cast
	}
	rows, err := s.repo.DramaSegments(detail.Episode.ID)
	if err != nil {
		return err
	}
	detail.Segments = buildDramaSegmentViews(settings, parseDramaBibleMeta(p.BibleJSON), detail.Shots, castByID, rows)
	jobs, err := s.repo.RecentDramaSegmentJobs(projectID, detail.Episode.ID)
	if err != nil {
		return err
	}
	for i := range detail.Segments {
		view := &detail.Segments[i]
		for _, job := range jobs {
			if job.ShotID != view.ID {
				continue
			}
			j := dramaJobView(job)
			if job.Kind == model.DramaJobSegmentPrompt && view.PromptJob == nil {
				view.PromptJob = &j
			}
			if job.Kind == model.DramaJobSegmentVideo && view.VideoJob == nil {
				view.VideoJob = &j
				view.VideoReprocessable = view.VideoStatus == model.DramaMediaFailed && view.VideoResourceID != "" && dramaVideoJobReplayable(job)
			}
		}
	}
	videoJobs := []DramaJobView{}
	for _, view := range detail.Segments {
		if view.VideoJob != nil {
			videoJobs = append(videoJobs, *view.VideoJob)
		}
	}
	if err := s.attachDramaProviderStages(p.UserID, videoJobs); err != nil {
		return err
	}
	for i := range detail.Segments {
		for _, job := range videoJobs {
			if view := &detail.Segments[i]; view.VideoJob != nil && view.VideoJob.ID == job.ID {
				view.VideoJob.ProviderStage = job.ProviderStage
			}
		}
	}
	drafts := buildDramaSegmentDrafts(settings, parseDramaBibleMeta(p.BibleJSON), detail.Shots, castByID, rows)
	for i, draft := range drafts {
		if i >= len(rows) || rows[i].SegmentIndex != draft.view.Index {
			return errors.New("剧情段记录与镜头分组不一致")
		}
		var previous *model.DramaSegment
		if i > 0 {
			previous = &rows[i-1]
		}
		request, _, prepareErr := s.prepareDramaSegment(settings, draft, rows[i], previous, castByID)
		if prepareErr != nil {
			request.Warning = prepareErr.Error()
		}
		detail.Segments[i].Request = request
	}
	lookup := func(id string) (model.DramaCast, bool) {
		cast, ok := castByID[id]
		return cast, ok
	}
	for i := range detail.Segments {
		view := &detail.Segments[i]
		if view.VideoStatus != model.DramaMediaQueued || i >= len(rows) {
			continue
		}
		if job := view.VideoJob; job != nil && (job.Status == model.DramaJobQueued || job.Status == model.DramaJobRunning) {
			continue
		}
		view.VideoWait = firstNonEmpty(dramaVideoWaitReason(settings, p, &detail.Episode, rows, i, detail.Shots, lookup), "排队中，等待调度提交")
	}
	return nil
}

// dramaSegmentDraft 是一个剧情段的镜头分组与撰写素材；预览与撰写任务共用。
type dramaSegmentDraft struct {
	view  DramaSegmentView
	input production.SegmentPromptInput
	shots []model.DramaShot
}

// buildDramaSegmentDrafts 按镜头的 SegmentIndex 分段。参考图编号依次为角色、道具、场景，各自按首次出场顺序排列；
// 用户为某段手动指定过参考图时（rows 里 reference_cast_ids_json 非空），按用户给的顺序与集合编号。
func buildDramaSegmentDrafts(settings DramaSettings, meta dramaBibleMeta, shots []model.DramaShot, castByID map[string]model.DramaCast, rows []model.DramaSegment) []dramaSegmentDraft {
	overrides := map[int][]string{}
	for _, row := range rows {
		if strings.TrimSpace(row.ReferenceCastIDsJSON) != "" {
			overrides[row.SegmentIndex] = decodeStringList(row.ReferenceCastIDsJSON)
		}
	}
	groups := [][]model.DramaShot{}
	for _, shot := range shots {
		if len(groups) > 0 && groups[len(groups)-1][0].SegmentIndex == shot.SegmentIndex {
			groups[len(groups)-1] = append(groups[len(groups)-1], shot)
			continue
		}
		groups = append(groups, []model.DramaShot{shot})
	}
	drafts := make([]dramaSegmentDraft, 0, len(groups))
	for position, group := range groups {
		view := DramaSegmentView{Index: group[0].SegmentIndex, Title: firstNonEmpty(group[0].SegmentTitle, group[0].Scene, "剧情段"), ShotIDs: []string{}, Request: DramaSegmentRequest{References: []DramaSegmentReference{}}}
		characterIDs, propIDs, sceneIDs := []string{}, []string{}, []string{}
		input := production.SegmentPromptInput{Index: position, Count: len(groups), Title: view.Title, AspectRatio: settings.AspectRatio, Style: settings.StylePrompt, VisualRules: meta.VisualRules, Language: settings.Language, PauseMs: settings.Storyboard.DialoguePauseMs(), Independent: settings.parallelVideo()}
		for _, shot := range group {
			view.ShotIDs = append(view.ShotIDs, shot.ID)
			view.DurationMs += shot.DurationMs
			for _, id := range decodeStringList(shot.CastIDsJSON) {
				if _, ok := castByID[id]; ok && !containsString(characterIDs, id) {
					characterIDs = append(characterIDs, id)
				}
			}
			for _, id := range decodeStringList(shot.PropIDsJSON) {
				if _, ok := castByID[id]; ok && !containsString(propIDs, id) {
					propIDs = append(propIDs, id)
				}
			}
			if _, ok := castByID[shot.SceneCastID]; ok && !containsString(sceneIDs, shot.SceneCastID) {
				sceneIDs = append(sceneIDs, shot.SceneCastID)
			}
			input.Shots = append(input.Shots, production.SegmentShot{Scene: shot.Scene, ShotSize: shot.ShotSize, Camera: shot.Camera, ImagePrompt: shot.ImagePrompt, Action: shot.Action, VideoPrompt: shot.VideoPrompt, Speaker: shot.Speaker, Dialogue: shot.Dialogue, DurationMs: shot.DurationMs, Transition: settings.Storyboard.EffectiveTransition(shot.Transition, shot.Position == 0)})
		}
		referenceIDs := append(append(characterIDs, propIDs...), sceneIDs...)
		view.ReferenceMode = "auto"
		if custom, ok := overrides[view.Index]; ok {
			view.ReferenceMode = "custom"
			referenceIDs = []string{}
			for _, id := range custom {
				if _, exists := castByID[id]; exists && !containsString(referenceIDs, id) {
					referenceIDs = append(referenceIDs, id)
				}
			}
		}
		for _, id := range referenceIDs {
			cast := castByID[id]
			label := fmt.Sprintf("参考图%d", len(view.Request.References)+1)
			view.Request.References = append(view.Request.References, DramaSegmentReference{CastID: cast.ID, Label: label, Kind: cast.Kind, Name: cast.Name})
			input.References = append(input.References, production.SegmentReference{Label: label, Kind: cast.Kind, Name: cast.Name, Detail: firstNonEmpty(cast.Appearance, cast.Description), Voice: cast.VoiceInstructions})
		}
		drafts = append(drafts, dramaSegmentDraft{view: view, input: input, shots: group})
	}
	return drafts
}

// buildDramaSegmentViews 合并分段与已保存的提示词：改写优先，其次是模型撰写的版本。
func buildDramaSegmentViews(settings DramaSettings, meta dramaBibleMeta, shots []model.DramaShot, castByID map[string]model.DramaCast, rows []model.DramaSegment) []DramaSegmentView {
	rowByIndex := map[int]model.DramaSegment{}
	for _, row := range rows {
		rowByIndex[row.SegmentIndex] = row
	}
	drafts := buildDramaSegmentDrafts(settings, meta, shots, castByID, rows)
	views := make([]DramaSegmentView, 0, len(drafts))
	for _, draft := range drafts {
		view := draft.view
		view.PromptStatus = "none"
		if row, ok := rowByIndex[view.Index]; ok {
			view.ID, view.Revision = row.ID, row.Revision
			view.Generated, view.PromptError = strings.TrimSpace(row.VideoPrompt), row.PromptError
			view.VideoStatus, view.VideoResourceID, view.TailFrameResourceID, view.VideoError = row.VideoStatus, row.VideoResourceID, row.TailFrameResourceID, row.VideoError
			view.VideoSeconds = row.VideoSeconds
			view.VideoModel = segmentVideoChoice(row, settings.Models.Video)
			view.PromptStatus = firstNonEmpty(row.PromptStatus, "queued")
			if override := strings.TrimSpace(row.VideoPromptOverride); override != "" {
				view.VideoPrompt, view.Custom = override, true
			} else {
				view.VideoPrompt = view.Generated
			}
		}
		views = append(views, view)
	}
	return views
}

// RequestDramaSegmentPrompts 让文本模型（重新）撰写指定剧情段的完整视频提示词；不影响已有的手动改写。
func (s *Service) RequestDramaSegmentPrompts(userID string, projectID string, episodeID string, req GenerateDramaSegmentsRequest) (map[string]any, error) {
	project, productionRow, err := s.dramaForUser(userID, projectID)
	if err != nil {
		return nil, err
	}
	if len(req.Segments) == 0 || len(req.Segments) > 200 {
		return nil, BadAuthRequest("请选择要撰写的剧情段")
	}
	episode, err := s.repo.DramaEpisode(project.ID, episodeID)
	if err != nil {
		return nil, err
	}
	shots, err := s.repo.DramaShots(episode.ID)
	if err != nil {
		return nil, err
	}
	known := map[int]bool{}
	for _, shot := range shots {
		known[shot.SegmentIndex] = true
	}
	indexes := []int{}
	for _, index := range req.Segments {
		if !known[index] {
			return nil, BadAuthRequest("剧情段不存在")
		}
		indexes = append(indexes, index)
	}
	queued, err := s.repo.RequestDramaSegmentPrompts(project.ID, episode.ID, indexes)
	if err != nil {
		return nil, err
	}
	return map[string]any{"queued": queued}, s.requestDramaWork(productionRow)
}

// UpdateDramaSegment 保存或清除一个剧情段的整段视频提示词改写。
func (s *Service) UpdateDramaSegment(userID string, projectID string, episodeID string, index int, req UpdateDramaSegmentRequest) error {
	project, _, err := s.dramaForUser(userID, projectID)
	if err != nil {
		return err
	}
	episode, err := s.repo.DramaEpisode(project.ID, episodeID)
	if err != nil {
		return err
	}
	if req.VideoPromptOverride == nil && req.ReferenceCastIDs == nil && !req.AutoReferences {
		return BadAuthRequest("没有要保存的修改")
	}
	shots, err := s.repo.DramaShots(episode.ID)
	if err != nil {
		return err
	}
	found := false
	for _, shot := range shots {
		if shot.SegmentIndex == index {
			found = true
			break
		}
	}
	if !found {
		return BadAuthRequest("剧情段不存在")
	}
	if req.AutoReferences || req.ReferenceCastIDs != nil {
		// 参考图编号写在提示词里，换参考图后模型撰写的提示词标记过期；手写的提示词保留，由用户自行核对编号。
		encoded := ""
		if !req.AutoReferences {
			ids, err := s.dramaSegmentReferenceIDs(project.ID, *req.ReferenceCastIDs)
			if err != nil {
				return err
			}
			encoded = encodeStringList(ids)
		}
		if err := s.repo.SaveDramaSegmentReferences(episode.ID, index, encoded); err != nil {
			return err
		}
	}
	if req.VideoPromptOverride != nil {
		prompt := production.NormalizeReferenceTokens(strings.TrimSpace(*req.VideoPromptOverride))
		if utf8.RuneCountInString(prompt) > 12000 {
			return BadAuthRequest("段提示词过长（最多 12000 字）")
		}
		if err := s.repo.SaveDramaSegmentOverride(model.DramaSegment{ProjectID: project.ID, EpisodeID: episode.ID, SegmentIndex: index, VideoPromptOverride: prompt}); err != nil {
			return err
		}
	}
	s.wakeDramaScheduler()
	return nil
}

// dramaSegmentReferenceIDs 校验用户指定的参考图：必须是本作品的设定，去重并保持顺序。
func (s *Service) dramaSegmentReferenceIDs(projectID string, ids []string) ([]string, error) {
	if len(ids) > dramaMaxReferenceLimit {
		return nil, BadAuthRequest(fmt.Sprintf("每段最多指定 %d 个参考设定", dramaMaxReferenceLimit))
	}
	casts, err := s.repo.DramaCasts(projectID)
	if err != nil {
		return nil, err
	}
	known := map[string]bool{}
	for _, cast := range casts {
		known[cast.ID] = true
	}
	result := []string{}
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if !known[id] {
			return nil, BadAuthRequest("参考设定不存在")
		}
		if !containsString(result, id) {
			result = append(result, id)
		}
	}
	return result, nil
}

// dramaShotCastIDs 返回镜头引用的全部设定：出场角色、关键道具与场景。
func dramaShotCastIDs(shot model.DramaShot) []string {
	ids := append(decodeStringList(shot.CastIDsJSON), decodeStringList(shot.PropIDsJSON)...)
	if shot.SceneCastID != "" {
		ids = append(ids, shot.SceneCastID)
	}
	return ids
}
