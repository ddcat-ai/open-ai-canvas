package app

import (
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"

	"yingce/backend/internal/model"
	"yingce/backend/internal/production"

	"gorm.io/gorm"
)

// 用户操作只写自己负责的列：业务意图（文本、锁定、审阅）和把槽位重置为待生成。
// 调度循环的结果写入带状态条件，因此两边并发时以用户最新意图为准。

func (s *Service) UpdateDramaSettings(userID string, projectID string, req UpdateDramaSettingsRequest) (DramaSummary, error) {
	_, productionRow, err := s.dramaForUser(userID, projectID)
	if err != nil {
		return DramaSummary{}, err
	}
	fields := map[string]any{}
	if req.Settings != nil {
		current := parseDramaSettings(productionRow.SettingsJSON)
		next := req.Settings.normalized()
		if !production.ValidAspectRatio(next.AspectRatio) {
			return DramaSummary{}, BadAuthRequest("不支持的画幅：" + next.AspectRatio)
		}
		if problem := production.ValidateAssetPrompts(next.Assets); problem != "" {
			return DramaSummary{}, BadAuthRequest(problem)
		}
		if _, err := s.dramaWritingSkill(userID, next.PromptSkill); err != nil {
			return DramaSummary{}, err
		}
		// 画幅决定已生成画面的构图，制作开始后不允许修改。
		if productionRow.Stage != model.DramaStageBible && next.AspectRatio != current.AspectRatio {
			return DramaSummary{}, BadAuthRequest("制作开始后不能修改画幅")
		}
		// 分集方式只影响尚未分集的章节：分集完成后已有的集里可能写好了剧本，不重新分组。
		if next.EpisodeMode != current.EpisodeMode || next.ChaptersPerEpisode != current.ChaptersPerEpisode {
			if productionRow.PlanDone {
				return DramaSummary{}, BadAuthRequest("已完成分集，不能再修改分集方式；之后可在制作台逐集追加新的一集")
			}
			if next.EpisodeMode == "" {
				next.EpisodeMode, next.ChaptersPerEpisode = current.EpisodeMode, current.ChaptersPerEpisode
			}
		}
		models, err := s.resolveDramaModels(userID, next)
		if err != nil {
			return DramaSummary{}, err
		}
		if err := s.validateDramaImageSettings(models, next.Assets); err != nil {
			return DramaSummary{}, err
		}
		next.Models = models
		if err := s.validateDramaVideoSettings(next); err != nil {
			return DramaSummary{}, err
		}
		fields["settings_json"] = encodeDramaSettings(next)
	}
	if req.BudgetMicrocredits != nil {
		budget := *req.BudgetMicrocredits
		if budget < 0 {
			return DramaSummary{}, BadAuthRequest("预算不能为负数")
		}
		fields["budget_microcredits"] = budget
		if productionRow.PauseReason == dramaBudgetPauseReason {
			spent, err := s.dramaTotalSpent(productionRow)
			if err != nil {
				return DramaSummary{}, err
			}
			if budget == 0 || spent < budget {
				fields["pause_reason"] = ""
			}
		}
	}
	if len(fields) > 0 {
		if err := s.repo.UpdateDramaProduction(productionRow.ProjectID, fields); err != nil {
			return DramaSummary{}, err
		}
	}
	return s.DramaSummary(userID, projectID)
}

func (s *Service) SetDramaRunning(userID string, projectID string, running bool) (DramaSummary, error) {
	_, productionRow, err := s.dramaForUser(userID, projectID)
	if err != nil {
		return DramaSummary{}, err
	}
	if running {
		if err := s.resumeDrama(productionRow); err != nil {
			return DramaSummary{}, err
		}
	} else if productionRow.Status == model.DramaStatusRunning {
		if err := s.repo.UpdateDramaProduction(productionRow.ProjectID, map[string]any{"status": model.DramaStatusPaused}); err != nil {
			return DramaSummary{}, err
		}
	}
	s.wakeDramaScheduler()
	return s.DramaSummary(userID, projectID)
}

// resumeDrama 校验模型与预算后把制作切回运行；“继续制作”和所有显式生成请求共用这一入口。
func (s *Service) resumeDrama(productionRow *model.DramaProduction) error {
	settings := parseDramaSettings(productionRow.SettingsJSON)
	models, err := s.resolveDramaModels(productionRow.UserID, settings)
	if err != nil {
		return err
	}
	if missing := missingDramaCapabilities(models); len(missing) > 0 {
		return BadAuthRequest("还没有可用的" + strings.Join(missing, "、") + "模型")
	}
	if exhausted, err := s.dramaBudgetExhausted(productionRow); err != nil {
		return err
	} else if exhausted {
		return BadAuthRequest("已达到预算上限（含画布精修花费），请先提高预算")
	}
	settings.Models = models
	fields := map[string]any{"status": model.DramaStatusRunning, "pause_reason": "", "settings_json": encodeDramaSettings(settings)}
	if productionRow.Status == model.DramaStatusCompleted {
		fields["stage"] = model.DramaStageProduce
	}
	if err := s.repo.UpdateDramaProduction(productionRow.ProjectID, fields); err != nil {
		return err
	}
	productionRow.Status, productionRow.PauseReason = model.DramaStatusRunning, ""
	return nil
}

// reopenDrama 在用户修改已完成内容后让调度循环重新接手；只改内容不代表要开始花钱，暂停中的制作保持暂停。
func (s *Service) reopenDrama(productionRow *model.DramaProduction) error {
	if productionRow.Status == model.DramaStatusCompleted {
		if err := s.repo.UpdateDramaProduction(productionRow.ProjectID, map[string]any{"status": model.DramaStatusRunning, "stage": model.DramaStageProduce}); err != nil {
			return err
		}
	}
	s.wakeDramaScheduler()
	return nil
}

// requestDramaWork 用于用户显式要求产出的操作（重新改编、生成、重试、放行、确认）：
// 暂停或已完成的制作直接恢复运行，否则请求只会写进状态而没有调度循环接手。
func (s *Service) requestDramaWork(productionRow *model.DramaProduction) error {
	if productionRow.Status == model.DramaStatusPaused || productionRow.Status == model.DramaStatusCompleted {
		if err := s.resumeDrama(productionRow); err != nil {
			return err
		}
	}
	s.wakeDramaScheduler()
	return nil
}

var dramaStageOrder = map[string]int{model.DramaEpisodeQueued: 0, model.DramaEpisodeScript: 1, model.DramaEpisodePrompts: 2, model.DramaEpisodeReview: 3, model.DramaEpisodeVideo: 4, model.DramaEpisodeRender: 5, model.DramaEpisodeDone: 6}

// episodeRewind 累积一次用户操作对多集的影响，最后统一写回并递增各集版本。
type episodeRewind struct {
	s        *Service
	project  string
	episodes map[string]*model.DramaEpisode
	targets  map[string]string
}

func (s *Service) newEpisodeRewind(projectID string) *episodeRewind {
	return &episodeRewind{s: s, project: projectID, episodes: map[string]*model.DramaEpisode{}, targets: map[string]string{}}
}

func (e *episodeRewind) to(episodeID string, stage string) error {
	if _, ok := e.episodes[episodeID]; !ok {
		episode, err := e.s.repo.DramaEpisode(e.project, episodeID)
		if err != nil {
			return err
		}
		e.episodes[episodeID] = episode
	}
	if current, ok := e.targets[episodeID]; !ok || dramaStageOrder[stage] < dramaStageOrder[current] {
		e.targets[episodeID] = stage
	}
	return nil
}

// commit 把集阶段回退到受影响的最早阶段；已有成片保留但标记过期。
func (e *episodeRewind) commit() error {
	for id, episode := range e.episodes {
		target := e.targets[id]
		fields := map[string]any{"error": ""}
		if dramaStageOrder[episode.Stage] > dramaStageOrder[target] {
			fields["stage"] = target
		}
		if episode.FinalResourceID != "" {
			fields["final_stale"] = true
		}
		if err := e.s.repo.UpdateDramaEpisodeUser(id, fields); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) ApproveDramaEpisode(userID, projectID, episodeID string) (DramaEpisodeDetail, error) {
	project, p, err := s.dramaForUser(userID, projectID)
	if err != nil {
		return DramaEpisodeDetail{}, err
	}
	episode, err := s.repo.DramaEpisode(project.ID, episodeID)
	if err != nil {
		return DramaEpisodeDetail{}, err
	}
	settings := parseDramaSettings(p.SettingsJSON)
	if settings.ReviewMode == DramaReviewSample && episode.Number == 1 {
		if episode.Stage != model.DramaEpisodeDone || episode.FinalResourceID == "" || episode.FinalStale {
			return DramaEpisodeDetail{}, BadAuthRequest("样片完成后才能确认样片")
		}
		if err := s.repo.UpdateDramaProduction(project.ID, map[string]any{"sample_approved": true}); err != nil {
			return DramaEpisodeDetail{}, err
		}
	} else {
		segments, err := s.repo.DramaSegments(episode.ID)
		if err != nil {
			return DramaEpisodeDetail{}, err
		}
		if len(segments) == 0 {
			return DramaEpisodeDetail{}, BadAuthRequest("尚无视频提示词")
		}
		for _, seg := range segments {
			if !dramaPromptReady(seg) {
				return DramaEpisodeDetail{}, BadAuthRequest("所有剧情段视频提示词就绪后才能确认")
			}
		}
		if err := s.repo.UpdateDramaEpisodeUser(episode.ID, map[string]any{"approved": true, "stage": model.DramaEpisodeVideo}); err != nil {
			return DramaEpisodeDetail{}, err
		}
	}
	if err := s.requestDramaWork(p); err != nil {
		return DramaEpisodeDetail{}, err
	}
	return s.DramaEpisodeDetail(userID, projectID, episodeID)
}

// RescriptDramaEpisode 重新改编一集；旧镜头的产物版本保留在版本库中。
func (s *Service) RescriptDramaEpisode(userID string, projectID string, episodeID string) (DramaEpisodeDetail, error) {
	project, productionRow, err := s.dramaForUser(userID, projectID)
	if err != nil {
		return DramaEpisodeDetail{}, err
	}
	episode, err := s.repo.DramaEpisode(project.ID, episodeID)
	if err != nil {
		return DramaEpisodeDetail{}, err
	}
	if err := s.repo.CancelQueuedDramaJobs(project.ID, func(db *gorm.DB) *gorm.DB { return db.Where("episode_id = ?", episode.ID) }); err != nil {
		return DramaEpisodeDetail{}, err
	}
	fields := map[string]any{"stage": model.DramaEpisodeScript, "shot_count": 0, "approved": false, "error": ""}
	if episode.FinalResourceID != "" {
		fields["final_stale"] = true
	}
	if _, err := s.repo.ApplyDramaScript(episode.ID, nil, fields, nil); err != nil {
		return DramaEpisodeDetail{}, err
	}
	if err := s.requestDramaWork(productionRow); err != nil {
		return DramaEpisodeDetail{}, err
	}
	return s.DramaEpisodeDetail(userID, projectID, episodeID)
}

// UpdateDramaShot 修改镜头内容，并只把受影响的下游槽位标为过期。
func (s *Service) UpdateDramaShot(userID, projectID, shotID string, req UpdateDramaShotRequest) (model.DramaShot, error) {
	project, p, err := s.dramaForUser(userID, projectID)
	if err != nil {
		return model.DramaShot{}, err
	}
	shot, err := s.repo.DramaShot(project.ID, shotID)
	if err != nil {
		return model.DramaShot{}, err
	}
	fields := map[string]any{}
	for _, f := range []struct {
		column string
		target *string
		value  *string
		limit  int
	}{
		{"speaker", &shot.Speaker, req.Speaker, 60}, {"dialogue", &shot.Dialogue, req.Dialogue, dramaMaxDialogueRunes}, {"action", &shot.Action, req.Action, 1000},
		{"shot_size", &shot.ShotSize, req.ShotSize, 30}, {"image_prompt", &shot.ImagePrompt, req.ImagePrompt, 2000}, {"camera", &shot.Camera, req.Camera, 60}, {"video_prompt", &shot.VideoPrompt, req.VideoPrompt, 2000},
	} {
		if f.value == nil {
			continue
		}
		value := strings.TrimSpace(*f.value)
		if utf8.RuneCountInString(value) > f.limit {
			return model.DramaShot{}, BadAuthRequest("镜头内容过长")
		}
		if value != *f.target {
			*f.target = value
			fields[f.column] = value
		}
	}
	if req.Transition != nil {
		value := production.NormalizeTransition(*req.Transition)
		if value != shot.Transition {
			shot.Transition = value
			fields["transition"] = value
		}
	}
	if req.DurationSeconds != nil {
		value := *req.DurationSeconds
		if value < 1 || value > production.MaxStoryboardShotSeconds {
			return model.DramaShot{}, BadAuthRequest("镜头时长超出范围")
		}
		duration := int64(value * 1000)
		if duration != shot.DurationMs {
			// 一个剧情段一次生成，段总时长不能超过该段视频模型的单次上限。
			if err := s.checkDramaSegmentDuration(project.ID, p, *shot, duration); err != nil {
				return model.DramaShot{}, err
			}
			shot.DurationMs = duration
			fields["duration_ms"] = duration
		}
	}
	if len(fields) == 0 {
		return *shot, nil
	}
	if err := s.repo.UpdateDramaShotScript(*shot, fields); err != nil {
		return model.DramaShot{}, err
	}
	return *shot, s.reopenDrama(p)
}

func (s *Service) UpdateDramaCast(userID string, projectID string, castID string, req UpdateDramaCastRequest) (model.DramaCast, error) {
	project, _, err := s.dramaForUser(userID, projectID)
	if err != nil {
		return model.DramaCast{}, err
	}
	cast, err := s.repo.DramaCast(project.ID, castID)
	if err != nil {
		return model.DramaCast{}, err
	}
	fields := map[string]any{}
	if req.Name != nil {
		name := strings.TrimSpace(*req.Name)
		if name == "" || utf8.RuneCountInString(name) > 60 {
			return model.DramaCast{}, BadAuthRequest("名称需为 1 到 60 字")
		}
		fields["name"] = name
	}
	if req.Aliases != nil {
		aliases := []string{}
		for _, alias := range *req.Aliases {
			if alias = strings.TrimSpace(alias); alias != "" && len(aliases) < 20 {
				aliases = append(aliases, truncateRunes(alias, 40))
			}
		}
		encoded, _ := json.Marshal(aliases)
		fields["aliases_json"] = string(encoded)
	}
	for _, field := range []struct {
		column string
		value  *string
		limit  int
	}{{"appearance", req.Appearance, 1000}, {"description", req.Description, 1000}, {"voice_instructions", req.VoiceInstructions, 500}} {
		if field.value != nil {
			fields[field.column] = truncateRunes(strings.TrimSpace(*field.value), field.limit)
		}
	}
	if req.Locked != nil {
		fields["locked"] = *req.Locked
	}
	if len(fields) > 0 {
		if err := s.repo.UpdateDramaCastFields(cast.ID, fields); err != nil {
			return model.DramaCast{}, err
		}
	}
	updated, err := s.repo.DramaCast(project.ID, castID)
	if err != nil {
		return model.DramaCast{}, err
	}
	return *updated, nil
}

// RegenerateDramaCast 重做参考图；restyleSegments=true 时让引用该设定的剧情段视频过期，需重新生成。
// 段提示词只引用“参考图N”编号，不随图片内容变化，保持不变。
func (s *Service) RegenerateDramaCast(userID string, projectID string, castID string, restyleSegments bool) (map[string]any, error) {
	project, productionRow, err := s.dramaForUser(userID, projectID)
	if err != nil {
		return nil, err
	}
	cast, err := s.repo.DramaCast(project.ID, castID)
	if err != nil {
		return nil, err
	}
	if cast.Locked {
		return nil, BadAuthRequest("设定已锁定，请先解锁")
	}
	// queued 表示用户明确请求：手动生图模式下即使资产尚未整体放行也会生成。
	if err := s.repo.UpdateDramaCastFields(cast.ID, map[string]any{"image_status": model.DramaMediaQueued}); err != nil {
		return nil, err
	}
	affected := 0
	if restyleSegments {
		if affected, err = s.restyleDramaCastSegments(project.ID, cast.ID); err != nil {
			return nil, err
		}
	}
	if err := s.requestDramaWork(productionRow); err != nil {
		return nil, err
	}
	return map[string]any{"affectedSegments": affected}, nil
}

// restyleDramaCastSegments 让引用该设定、已生成或生成中的剧情段视频过期，并把所在集退回视频阶段。返回过期的段数。
func (s *Service) restyleDramaCastSegments(projectID, castID string) (int, error) {
	shots, err := s.repo.DramaShotsReferencingCast(projectID, castID)
	if err != nil {
		return 0, err
	}
	rewind := s.newEpisodeRewind(projectID)
	marked := map[string]bool{}
	affected := 0
	for _, shot := range shots {
		key := shot.EpisodeID + "|" + itoa(shot.SegmentIndex)
		if marked[key] {
			continue
		}
		marked[key] = true
		changed, err := s.repo.MarkDramaSegmentVideoStale(shot.EpisodeID, shot.SegmentIndex)
		if err != nil {
			return 0, err
		}
		if !changed {
			continue
		}
		if err := rewind.to(shot.EpisodeID, model.DramaEpisodeVideo); err != nil {
			return 0, err
		}
		affected++
	}
	return affected, rewind.commit()
}

// DramaAssetSchemeCatalog 是参考图方案目录：内置方案的默认提示词与可用变量。
type DramaAssetSchemeCatalog struct {
	Schemes            []production.AssetScheme `json:"schemes"`
	ScenePrompt        string                   `json:"scenePrompt"`
	CharacterVariables []string                 `json:"characterVariables"`
	SceneVariables     []string                 `json:"sceneVariables"`
}

func (s *Service) DramaAssetSchemes() DramaAssetSchemeCatalog {
	return DramaAssetSchemeCatalog{Schemes: production.AssetSchemes(), ScenePrompt: production.DefaultScenePrompt(), CharacterVariables: production.CharacterAssetVariables, SceneVariables: production.SceneAssetVariables}
}

type RegenerateDramaCastsRequest struct {
	Kind            string `json:"kind"`
	RestyleSegments bool   `json:"restyleSegments"`
}

// RegenerateDramaCasts 按当前参考图方案重做某一类（角色/道具/场景）全部未锁定的参考图（换方案后使用）。
func (s *Service) RegenerateDramaCasts(userID string, projectID string, req RegenerateDramaCastsRequest) (map[string]any, error) {
	if req.Kind != "character" && req.Kind != "prop" && req.Kind != "scene" {
		return nil, BadAuthRequest("请选择要重做的是角色、道具还是场景")
	}
	project, _, err := s.dramaForUser(userID, projectID)
	if err != nil {
		return nil, err
	}
	casts, err := s.repo.DramaCasts(project.ID)
	if err != nil {
		return nil, err
	}
	casted, skipped, shots := 0, 0, 0
	for _, cast := range casts {
		if cast.Kind != req.Kind {
			continue
		}
		if cast.Locked || cast.ImageStatus == model.DramaMediaQueued || cast.ImageStatus == model.DramaMediaRunning {
			skipped++
			continue
		}
		result, err := s.RegenerateDramaCast(userID, projectID, cast.ID, req.RestyleSegments)
		if err != nil {
			return nil, err
		}
		if affected, ok := result["affectedSegments"].(int); ok {
			shots += affected
		}
		casted++
	}
	return map[string]any{"queued": casted, "skipped": skipped, "affectedSegments": shots}, nil
}

// DramaCastImpact 预览修改某个设定会影响多少集和镜头。
func (s *Service) DramaCastImpact(userID string, projectID string, castID string) (map[string]any, error) {
	project, _, err := s.dramaForUser(userID, projectID)
	if err != nil {
		return nil, err
	}
	shots, err := s.repo.DramaShotsReferencingCast(project.ID, castID)
	if err != nil {
		return nil, err
	}
	episodes, segments := map[string]bool{}, map[string]bool{}
	for _, shot := range shots {
		episodes[shot.EpisodeID] = true
		segments[shot.EpisodeID+"|"+itoa(shot.SegmentIndex)] = true
	}
	return map[string]any{"segments": len(segments), "episodes": len(episodes)}, nil
}

// RetryFailedDrama 把失败槽位重置为待生成，由调度循环重新派发。
func (s *Service) RetryFailedDrama(userID, projectID string) (map[string]any, error) {
	project, p, err := s.dramaForUser(userID, projectID)
	if err != nil {
		return nil, err
	}
	segments, err := s.repo.FailedDramaSegments(project.ID, 5000)
	if err != nil {
		return nil, err
	}
	for _, seg := range segments {
		fields := map[string]any{}
		if seg.PromptStatus == model.DramaMediaFailed {
			fields["prompt_status"] = ""
			fields["prompt_error"] = ""
		}
		if seg.VideoStatus == model.DramaMediaFailed {
			fields["video_error"] = ""
			if seg.VideoResourceID == "" {
				fields["video_status"] = model.DramaMediaQueued
			} else {
				fields["video_status"] = model.DramaMediaRunning
			}
		}
		if err := s.repo.UpdateDramaSegmentFields(seg.ID, fields); err != nil {
			return nil, err
		}
	}
	if err := s.repo.RetryDramaResultJobs(project.ID); err != nil {
		return nil, err
	}
	casts, err := s.repo.DramaCasts(project.ID)
	if err != nil {
		return nil, err
	}
	count := 0
	for _, cast := range casts {
		applied, err := s.repo.UpdateDramaCastIf(cast.ID, []string{model.DramaMediaFailed}, map[string]any{"image_status": model.DramaMediaQueued})
		if err != nil {
			return nil, err
		}
		if applied {
			count++
		}
	}
	episodes, err := s.repo.DramaEpisodes(project.ID)
	if err != nil {
		return nil, err
	}
	for _, episode := range episodes {
		if episode.Error != "" {
			if err := s.repo.UpdateDramaEpisodeUser(episode.ID, map[string]any{"error": ""}); err != nil {
				return nil, err
			}
		}
	}
	return map[string]any{"segments": len(segments), "casts": count}, s.requestDramaWork(p)
}

type GenerateDramaSegmentsRequest struct {
	Segments   []int             `json:"segments"`
	VideoModel *DramaModelChoice `json:"videoModel"`
}

// GenerateDramaSegments 显式请求剧情段视频重生成，所有段先校验再统一写入。
func (s *Service) GenerateDramaSegments(userID, projectID, episodeID string, req GenerateDramaSegmentsRequest) (map[string]any, error) {
	project, p, err := s.dramaForUser(userID, projectID)
	if err != nil {
		return nil, err
	}
	if len(req.Segments) == 0 || len(req.Segments) > 200 {
		return nil, BadAuthRequest("请选择剧情段")
	}
	episode, err := s.repo.DramaEpisode(project.ID, episodeID)
	if err != nil {
		return nil, err
	}
	if parseDramaSettings(p.SettingsJSON).ReviewMode == DramaReviewSample && episode.Number != 1 && !p.SampleApproved {
		return nil, BadAuthRequest("请先确认第 1 集样片")
	}
	var modelJSON *string
	if req.VideoModel != nil {
		encoded := ""
		if !req.VideoModel.Empty() {
			if err := s.requireDramaModelOption(userID, "video", *req.VideoModel); err != nil {
				return nil, err
			}
			b, _ := json.Marshal(req.VideoModel)
			encoded = string(b)
		}
		modelJSON = &encoded
	}
	rows, err := s.repo.DramaSegments(episode.ID)
	if err != nil {
		return nil, err
	}
	known := map[int]model.DramaSegment{}
	for _, row := range rows {
		known[row.SegmentIndex] = row
	}
	indexes := []int{}
	seen := map[int]bool{}
	for _, index := range req.Segments {
		seg, ok := known[index]
		if !ok {
			return nil, BadAuthRequest("剧情段不存在")
		}
		if !dramaPromptReady(seg) {
			return nil, BadAuthRequest("请先重新撰写过期或缺失的视频提示词")
		}
		if mediaBusyStatus(seg.VideoStatus) {
			return nil, BadAuthRequest("剧情段视频正在生成或排队")
		}
		settings := parseDramaSettings(p.SettingsJSON)
		choice := segmentVideoChoice(seg, settings.Models.Video)
		if req.VideoModel != nil && !req.VideoModel.Empty() {
			choice = *req.VideoModel
		}
		profile, err := s.dramaVideoProfile(choice)
		if err != nil {
			return nil, err
		}
		if issue := profile.screen(settings.AspectRatio).Issue; issue != "" {
			return nil, BadAuthRequest(issue)
		}
		// 第 1 段总用参考图或文生视频；尾帧续接的后续段才需要图生视频。
		if issue := profile.continuityIssue(settings); issue != "" && index > 0 {
			return nil, BadAuthRequest(issue)
		}
		if !seen[index] {
			seen[index] = true
			indexes = append(indexes, index)
		}
	}
	if err := s.repo.RequestDramaSegmentVideos(project.ID, episode.ID, indexes, modelJSON); err != nil {
		return nil, err
	}
	if err := s.releaseDramaEpisodes(project.ID, []string{episode.ID}); err != nil {
		return nil, err
	}
	return map[string]any{"queued": len(indexes)}, s.requestDramaWork(p)
}

func mediaBusyStatus(status string) bool {
	return status == model.DramaMediaQueued || status == model.DramaMediaRunning
}

// requireDramaModelOption 只接受当前目录中可由服务端执行的模型，防止提交任意渠道标识。
func (s *Service) requireDramaModelOption(userID string, capability string, choice DramaModelChoice) error {
	options, unavailable, err := s.dramaModelOptions(userID, capability)
	if err != nil {
		return err
	}
	for _, item := range unavailable {
		if dramaSameChoice(item.Choice, choice) {
			return BadAuthRequest("所选模型不能用于短剧：" + item.Reason)
		}
	}
	for _, option := range options {
		if option.Choice.LogicalModelID != "" && option.Choice.LogicalModelID == choice.LogicalModelID {
			return nil
		}
		if option.Choice.ChannelID != "" && option.Choice.ChannelID == choice.ChannelID && option.Choice.ModelKey == choice.ModelKey {
			return nil
		}
	}
	return BadAuthRequest("所选视频模型不可用，请重新选择")
}

func dramaSameChoice(a, b DramaModelChoice) bool {
	if a.LogicalModelID != "" || b.LogicalModelID != "" {
		return a.LogicalModelID == b.LogicalModelID
	}
	return a.ChannelID == b.ChannelID && a.ModelKey == b.ModelKey
}

// releaseDramaEpisodes 放行指定集的视频生成，并把这些集引用、尚未请求的参考图标记为待生成。
func (s *Service) releaseDramaEpisodes(projectID string, episodeIDs []string) error {
	if len(episodeIDs) == 0 {
		return nil
	}
	casts := map[string]bool{}
	for _, id := range episodeIDs {
		episode, err := s.repo.DramaEpisode(projectID, id)
		if err != nil {
			return err
		}
		if !episode.MediaReleased {
			if err := s.repo.UpdateDramaEpisodeUser(episode.ID, map[string]any{"media_released": true}); err != nil {
				return err
			}
		}
		shots, err := s.repo.DramaShots(episode.ID)
		if err != nil {
			return err
		}
		for _, shot := range shots {
			for _, castID := range dramaShotCastIDs(shot) {
				if castID != "" {
					casts[castID] = true
				}
			}
		}
	}
	for castID := range casts {
		// 只把从未请求过的参考图排队；已生成、失败或锁定的保持原状。
		if _, err := s.repo.UpdateDramaCastIf(castID, []string{""}, map[string]any{"image_status": model.DramaMediaQueued}); err != nil {
			return err
		}
	}
	return nil
}

// ReleaseDramaMedia 是手动生图模式的“开始生图”：先确认剧情、分镜和资产，再按需放行。
func (s *Service) ReleaseDramaMedia(userID string, projectID string, req ReleaseDramaMediaRequest) (DramaSummary, error) {
	project, productionRow, err := s.dramaForUser(userID, projectID)
	if err != nil {
		return DramaSummary{}, err
	}
	switch req.Target {
	case "assets":
		if err := s.repo.UpdateDramaProduction(project.ID, map[string]any{"assets_released": true}); err != nil {
			return DramaSummary{}, err
		}
	case "episodes":
		if len(req.EpisodeIDs) == 0 || len(req.EpisodeIDs) > 500 {
			return DramaSummary{}, BadAuthRequest("请选择要生成画面的集")
		}
		if err := s.releaseDramaEpisodes(project.ID, req.EpisodeIDs); err != nil {
			return DramaSummary{}, err
		}
	case "all":
		episodes, err := s.repo.DramaEpisodes(project.ID)
		if err != nil {
			return DramaSummary{}, err
		}
		ids := make([]string, 0, len(episodes))
		for _, episode := range episodes {
			ids = append(ids, episode.ID)
		}
		if err := s.repo.UpdateDramaProduction(project.ID, map[string]any{"assets_released": true}); err != nil {
			return DramaSummary{}, err
		}
		if err := s.releaseDramaEpisodes(project.ID, ids); err != nil {
			return DramaSummary{}, err
		}
	default:
		return DramaSummary{}, BadAuthRequest("请选择要放行的范围")
	}
	if err := s.requestDramaWork(productionRow); err != nil {
		return DramaSummary{}, err
	}
	return s.DramaSummary(userID, projectID)
}

func (s *Service) checkDramaSegmentDuration(projectID string, p *model.DramaProduction, shot model.DramaShot, nextMs int64) error {
	shots, err := s.repo.DramaShots(shot.EpisodeID)
	if err != nil {
		return err
	}
	total := nextMs
	for _, item := range shots {
		if item.SegmentIndex == shot.SegmentIndex && item.ID != shot.ID {
			total += item.DurationMs
		}
	}
	segments, err := s.repo.DramaSegments(shot.EpisodeID)
	if err != nil {
		return err
	}
	choice := parseDramaSettings(p.SettingsJSON).Models.Video
	for _, segment := range segments {
		if segment.SegmentIndex == shot.SegmentIndex {
			choice = segmentVideoChoice(segment, choice)
		}
	}
	profile, err := s.dramaVideoProfile(choice)
	if err != nil {
		return err
	}
	if limit := int64(profile.maxSeconds()) * 1000; total > limit {
		return BadAuthRequest(fmt.Sprintf("本段合计 %.1f 秒，超过视频模型单次最长 %d 秒；请缩短镜头或重新改编本集", float64(total)/1000, profile.maxSeconds()))
	}
	return nil
}
