package app

import (
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"yingce/backend/internal/model"
	"yingce/backend/internal/production"
	"yingce/backend/internal/repository"

	"gorm.io/gorm"
)

// 逐集追加、原文与镜头编辑、上传锁定参考图。修改只把受影响的下游标记过期，不会自动花钱重做媒体。

// AddDramaEpisode 在作品末尾追加一集：这段原文直接成为新的一集，调度循环为它写剧本，前面的集不受影响。
func (s *Service) AddDramaEpisode(userID, projectID string, req AddDramaEpisodeRequest) (DramaEpisodeDetail, error) {
	project, productionRow, err := s.dramaForUser(userID, projectID)
	if err != nil {
		return DramaEpisodeDetail{}, err
	}
	text := strings.TrimSpace(strings.ReplaceAll(req.Text, "\r\n", "\n"))
	runes := utf8.RuneCountInString(text)
	if runes == 0 {
		return DramaEpisodeDetail{}, BadAuthRequest("本集原文不能为空")
	}
	if runes > production.ScriptSourceChapterRunes {
		return DramaEpisodeDetail{}, BadAuthRequest(fmt.Sprintf("本集原文 %d 字，单集不超过 %d 字，请拆成多集分别添加", runes, production.ScriptSourceChapterRunes))
	}
	title := strings.TrimSpace(req.Title)
	if utf8.RuneCountInString(title) > 60 {
		return DramaEpisodeDetail{}, BadAuthRequest("集标题不能超过 60 字")
	}
	if title == "" {
		// 默认标题只用于展示；真实集号在事务内分配。
		last, err := s.repo.MaxDramaEpisodeNumber(project.ID)
		if err != nil {
			return DramaEpisodeDetail{}, err
		}
		title = fmt.Sprintf("第 %d 集", last+1)
	}
	now := time.Now()
	chapter := model.ProjectUnit{ID: newID(), ProjectID: project.ID, Kind: model.ProjectUnitKindChapter, Title: title, SourceText: text, WordCount: runes, Status: model.ProjectUnitStatusReady, CreatedAt: now, UpdatedAt: now}
	episode := newDramaChapterEpisode(project.ID, 0, chapter, production.NormalizeSourceFormat(req.SourceFormat), now)
	if err := s.repo.AppendDramaEpisodeSource(project.ID, &chapter, &episode); err != nil {
		if errors.Is(err, repository.ErrDramaPlanPending) {
			return DramaEpisodeDetail{}, BadAuthRequest("前面的章节还在分集规划，完成后再追加新的一集")
		}
		return DramaEpisodeDetail{}, err
	}
	// 已完成的作品重新交给调度循环写新集剧本；暂停中的保持暂停，由用户点继续。
	if err := s.reopenDrama(productionRow); err != nil {
		return DramaEpisodeDetail{}, err
	}
	return s.DramaEpisodeDetail(userID, projectID, episode.ID)
}

// UpdateDramaChapter 修改原文；已写好的剧本保持不变，用户确认后点重新改编才会按新原文重写。
func (s *Service) UpdateDramaChapter(userID, projectID, chapterID string, req UpdateDramaChapterRequest) (model.ProjectUnit, error) {
	project, _, err := s.dramaForUser(userID, projectID)
	if err != nil {
		return model.ProjectUnit{}, err
	}
	unit, err := s.repo.ProjectUnit(project.ID, chapterID)
	if err != nil {
		return model.ProjectUnit{}, err
	}
	if unit.Kind != model.ProjectUnitKindChapter {
		return model.ProjectUnit{}, BadAuthRequest("只能修改原文章节")
	}
	fields := map[string]any{}
	if req.Title != nil {
		title := strings.TrimSpace(*req.Title)
		if title == "" || utf8.RuneCountInString(title) > 200 {
			return model.ProjectUnit{}, BadAuthRequest("章节标题需为 1 到 200 字")
		}
		fields["title"], unit.Title = title, title
	}
	if req.Text != nil {
		text := strings.TrimSpace(strings.ReplaceAll(*req.Text, "\r\n", "\n"))
		runes := utf8.RuneCountInString(text)
		if runes == 0 {
			return model.ProjectUnit{}, BadAuthRequest("原文不能为空")
		}
		// 剧本提示词每章最多读取 ScriptSourceChapterRunes 字，超出部分的台词会丢失，所以修改后不能变得更长。
		if limit := max(production.ScriptSourceChapterRunes, unit.WordCount); runes > limit {
			return model.ProjectUnit{}, BadAuthRequest(fmt.Sprintf("原文 %d 字，超过单集上限 %d 字，请拆成多集", runes, limit))
		}
		fields["source_text"], fields["word_count"] = text, runes
		unit.SourceText, unit.WordCount = text, runes
	}
	if len(fields) == 0 {
		return *unit, nil
	}
	if err := s.repo.UpdateDramaChapterSource(project.ID, unit.ID, fields); err != nil {
		return model.ProjectUnit{}, err
	}
	return *unit, nil
}

// UpdateDramaEpisode 修改集标题或素材类型；素材类型在下次重新改编时生效。
func (s *Service) UpdateDramaEpisode(userID, projectID, episodeID string, req UpdateDramaEpisodeRequest) (model.DramaEpisode, error) {
	project, _, err := s.dramaForUser(userID, projectID)
	if err != nil {
		return model.DramaEpisode{}, err
	}
	episode, err := s.repo.DramaEpisode(project.ID, episodeID)
	if err != nil {
		return model.DramaEpisode{}, err
	}
	fields := map[string]any{}
	if req.Title != nil {
		title := strings.TrimSpace(*req.Title)
		if title == "" || utf8.RuneCountInString(title) > 60 {
			return model.DramaEpisode{}, BadAuthRequest("集标题需为 1 到 60 字")
		}
		fields["title"], episode.Title = title, title
	}
	if req.SourceFormat != nil {
		format := strings.TrimSpace(*req.SourceFormat)
		if format != production.SourceNovel && format != production.SourceScript && format != production.SourceStoryboard {
			return model.DramaEpisode{}, BadAuthRequest("素材类型无效")
		}
		fields["source_format"], episode.SourceFormat = format, format
	}
	if len(fields) == 0 {
		return *episode, nil
	}
	if err := s.repo.UpdateDramaEpisodeMeta(episode.ID, fields); err != nil {
		return model.DramaEpisode{}, err
	}
	return *episode, nil
}

// InsertDramaShot 在指定镜头前或后插入一个空镜头，沿用其场景与出场角色，归入同一剧情段。
func (s *Service) InsertDramaShot(userID, projectID, shotID string, req InsertDramaShotRequest) (model.DramaShot, error) {
	project, productionRow, err := s.dramaForUser(userID, projectID)
	if err != nil {
		return model.DramaShot{}, err
	}
	anchor, err := s.repo.DramaShot(project.ID, shotID)
	if err != nil {
		return model.DramaShot{}, err
	}
	position := anchor.Position
	switch req.Position {
	case "after":
		position++
	case "before":
	default:
		return model.DramaShot{}, BadAuthRequest("请选择插入到镜头之前还是之后")
	}
	shots, err := s.repo.DramaShots(anchor.EpisodeID)
	if err != nil {
		return model.DramaShot{}, err
	}
	if len(shots) >= production.MaxScriptShots {
		return model.DramaShot{}, BadAuthRequest(fmt.Sprintf("单集最多 %d 个镜头", production.MaxScriptShots))
	}
	settings := parseDramaSettings(productionRow.SettingsJSON)
	now := time.Now()
	shot := model.DramaShot{
		ID: newID(), ProjectID: project.ID, EpisodeID: anchor.EpisodeID, Position: position, SegmentIndex: anchor.SegmentIndex, SegmentTitle: anchor.SegmentTitle,
		Scene: anchor.Scene, SceneCastID: anchor.SceneCastID, CastIDsJSON: firstNonEmpty(anchor.CastIDsJSON, "[]"), PropIDsJSON: "[]",
		ShotSize: anchor.ShotSize, Camera: "固定", Transition: production.TransitionCut, DurationMs: settings.Storyboard.ShotMs(0, ""), CreatedAt: now, UpdatedAt: now,
	}
	if err := s.checkDramaSegmentDuration(project.ID, productionRow, shot, shot.DurationMs); err != nil {
		return model.DramaShot{}, err
	}
	if err := s.repo.InsertDramaShot(shot); err != nil {
		return model.DramaShot{}, err
	}
	return shot, s.reopenDrama(productionRow)
}

// DeleteDramaShot 删除一个镜头。剧情段的唯一镜头不能删，否则会改变分段与段间衔接。
func (s *Service) DeleteDramaShot(userID, projectID, shotID string) error {
	project, productionRow, err := s.dramaForUser(userID, projectID)
	if err != nil {
		return err
	}
	shot, err := s.repo.DramaShot(project.ID, shotID)
	if err != nil {
		return err
	}
	shots, err := s.repo.DramaShots(shot.EpisodeID)
	if err != nil {
		return err
	}
	inSegment := 0
	for _, item := range shots {
		if item.SegmentIndex == shot.SegmentIndex {
			inSegment++
		}
	}
	if inSegment <= 1 {
		return BadAuthRequest("这是本剧情段唯一的镜头，删除会改变分段；可以改写它的内容，或重新改编本集")
	}
	if err := s.repo.DeleteDramaShot(*shot); err != nil {
		return err
	}
	return s.reopenDrama(productionRow)
}

// SetDramaCastImage 用用户上传的图片作为参考图并锁定：之后不会被自动或批量重做覆盖，
// 生成剧情段视频时这张图随请求发送，并在提示词里标明形象以它为准。
func (s *Service) SetDramaCastImage(userID, projectID, castID string, req SetDramaCastImageRequest) (map[string]any, error) {
	project, productionRow, err := s.dramaForUser(userID, projectID)
	if err != nil {
		return nil, err
	}
	cast, err := s.repo.DramaCast(project.ID, castID)
	if err != nil {
		return nil, err
	}
	resourceID := strings.TrimSpace(req.ResourceID)
	if resourceID == "" {
		return nil, BadAuthRequest("请先上传图片")
	}
	resource, err := s.repo.ResourceForUser(userID, resourceID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, BadAuthRequest("图片不存在或无权使用")
		}
		return nil, err
	}
	if resource.Status != model.ResourceStatusReady || !strings.HasPrefix(resource.MimeType, "image/") {
		return nil, BadAuthRequest("请上传已完成的图片文件")
	}
	source := strings.TrimSpace(req.Source)
	if source != "" && source != "upload" && source != "canvas" {
		return nil, BadAuthRequest("参考图来源无效")
	}
	if cast.ImageResourceID == resource.ID && cast.ImageStatus == model.DramaMediaReady && cast.Locked {
		// 重复采用同一张图（双击、Agent 重放）不再新增版本，也不再让剧情段过期。
		return map[string]any{"cast": cast, "affectedSegments": 0, "unchanged": true}, nil
	}
	// 排队中的生图不再需要；生成中的结果回写时槽位已是 ready，只会进版本记录，不会覆盖上传的图。
	if err := s.repo.CancelQueuedDramaJobs(project.ID, func(db *gorm.DB) *gorm.DB {
		return db.Where("cast_id = ? AND kind = ?", cast.ID, model.DramaJobCastImage)
	}); err != nil {
		return nil, err
	}
	take := &model.DramaTake{ID: newID(), ProjectID: project.ID, OwnerID: cast.ID, Kind: "cast", ResourceID: resource.ID, Prompt: dramaTakeUploadPrompt, CreatedAt: time.Now()}
	if source == "canvas" {
		take.Prompt = dramaTakeCanvasPrompt
		if task := s.dramaCanvasSourceTask(userID, req.TaskID, resource.ID); task != nil {
			take.TaskID, take.Prompt = task.ID, truncateRunes(firstNonEmpty(strings.TrimSpace(task.Prompt), dramaTakeCanvasPrompt), 2000)
		}
	}
	if err := s.repo.CreateDramaTake(take); err != nil {
		return nil, err
	}
	if err := s.repo.UpdateDramaCastFields(cast.ID, map[string]any{"image_resource_id": resource.ID, "image_status": model.DramaMediaReady, "image_version": gorm.Expr("image_version + 1"), "locked": true}); err != nil {
		return nil, err
	}
	affected := 0
	if req.RestyleSegments {
		if affected, err = s.restyleDramaCastSegments(project.ID, cast.ID); err != nil {
			return nil, err
		}
	}
	if err := s.reopenDrama(productionRow); err != nil {
		return nil, err
	}
	updated, err := s.repo.DramaCast(project.ID, cast.ID)
	if err != nil {
		return nil, err
	}
	return map[string]any{"cast": updated, "affectedSegments": affected}, nil
}

// dramaDialogueCheck 逐句核对原文台词是否出现在镜头台词里。章节被多集共用时无法确定哪些台词属于本集，不做核对。
func (s *Service) dramaDialogueCheck(projectID string, episode *model.DramaEpisode, chapters []model.ProjectUnit, shots []model.DramaShot) (*DramaDialogueCheck, error) {
	if len(shots) == 0 || len(chapters) == 0 {
		return nil, nil
	}
	episodes, err := s.repo.DramaEpisodes(projectID)
	if err != nil {
		return nil, err
	}
	mine := map[string]bool{}
	for _, id := range decodeStringList(episode.ChapterIDsJSON) {
		mine[id] = true
	}
	for _, other := range episodes {
		if other.ID == episode.ID {
			continue
		}
		for _, id := range decodeStringList(other.ChapterIDsJSON) {
			if mine[id] {
				return nil, nil
			}
		}
	}
	lines := []string{}
	for _, chapter := range chapters {
		lines = append(lines, production.SourceDialogueLines(truncateRunes(chapter.SourceText, production.ScriptSourceChapterRunes), episode.SourceFormat)...)
	}
	dialogues := make([]string, 0, len(shots))
	for _, shot := range shots {
		dialogues = append(dialogues, shot.Dialogue)
	}
	missing := production.MissingDialogue(lines, dialogues)
	check := &DramaDialogueCheck{SourceLines: len(lines), MissingCount: len(missing), Missing: missing}
	if len(check.Missing) > 30 {
		check.Missing = check.Missing[:30]
	}
	return check, nil
}
