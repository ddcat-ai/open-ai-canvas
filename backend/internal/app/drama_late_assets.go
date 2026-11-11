package app

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/production"
)

type dramaCastExtractPayload struct {
	CastIDs []string `json:"castIds"`
}

// dramaCastHasImageBrief 表示参考图已有可依据的外貌或外形描述；角色身份（role）本身不能用来编造形象。
func dramaCastHasImageBrief(cast model.DramaCast) bool {
	return firstNonEmpty(cast.Appearance, cast.Description, cast.ImagePrompt) != ""
}

// enqueueLateAssetExtract 在后续集即时建档后，为尚无外貌的新角色、道具与场景补提一次设定。
// 已有外貌的条目不会进入名单；造型行必须先有外观才会被创建，因此不必再抽。
func (r *dramaRun) enqueueLateAssetExtract(episode *model.DramaEpisode, created []model.DramaCast) {
	ids := make([]string, 0, len(created))
	names := make([]string, 0, len(created))
	for _, cast := range created {
		if strings.TrimSpace(cast.ParentID) != "" || dramaCastHasImageBrief(cast) {
			continue
		}
		ids = append(ids, cast.ID)
		names = append(names, cast.Name)
	}
	if len(ids) == 0 || episode == nil {
		return
	}
	label := "补全新设定：" + truncateRunes(strings.Join(names, "、"), 80)
	r.enqueue(model.DramaJobCastExtract, episode.ID, "", ids[0], dramaPriorityCastExtract, label, dramaCastExtractPayload{CastIDs: ids})
}

func (r *dramaRun) submitCastExtract(job *model.DramaJob) (*model.Task, bool, error) {
	episode, err := r.s.repo.DramaEpisode(r.project.ID, job.EpisodeID)
	if err != nil {
		return nil, true, nil
	}
	var payload dramaCastExtractPayload
	_ = json.Unmarshal([]byte(job.PayloadJSON), &payload)
	assets := make([]production.LateAsset, 0, len(payload.CastIDs))
	for _, id := range payload.CastIDs {
		cast, err := r.s.repo.DramaCast(r.project.ID, id)
		if err != nil {
			continue
		}
		if dramaCastHasImageBrief(*cast) {
			continue
		}
		assets = append(assets, production.LateAsset{Kind: cast.Kind, Name: cast.Name})
	}
	if len(assets) == 0 {
		return nil, true, nil
	}
	chapters, err := r.loadChapters(decodeStringList(episode.ChapterIDsJSON))
	if err != nil {
		return nil, false, err
	}
	skill, err := r.s.dramaWritingSkill(r.project.UserID, r.settings.BibleSkill, "资产提取")
	if err != nil {
		return nil, false, err
	}
	prompt := production.LateAssetPrompt(r.project.Name, r.settings.Settings, assets, chapters, dramaShotExtractSummary(r, episode.ID), skill)
	input := r.textInput(job, production.LateAssetSystemPrompt(), DramaStepBible)
	task, err := r.createTaskWith(job, r.settings.Models.textFor(DramaStepBible), "text", "text", prompt, input)
	return task, false, err
}

func dramaShotExtractSummary(r *dramaRun, episodeID string) string {
	shots, err := r.s.repo.DramaShots(episodeID)
	if err != nil || len(shots) == 0 {
		return ""
	}
	names := map[string]string{}
	for _, cast := range r.casts {
		names[cast.ID] = cast.Name
	}
	resolve := func(ids []string) string {
		out := make([]string, 0, len(ids))
		for _, id := range ids {
			if name := strings.TrimSpace(names[id]); name != "" {
				out = append(out, name)
			}
		}
		return strings.Join(out, "、")
	}
	var b strings.Builder
	limit := 40
	if len(shots) < limit {
		limit = len(shots)
	}
	for i, shot := range shots[:limit] {
		fmt.Fprintf(&b, "镜%d 场景=%s 人物=%s 道具=%s 说话人=%s 台词=%s 动作=%s 原文=%s\n", i+1, shot.Scene, resolve(decodeStringList(shot.CastIDsJSON)), resolve(decodeStringList(shot.PropIDsJSON)), shot.Speaker, truncateRunes(shot.Dialogue, 80), truncateRunes(shot.Action, 80), truncateRunes(shot.SourceQuote, 80))
	}
	return b.String()
}

func (r *dramaRun) applyCastExtract(job *model.DramaJob, task *model.Task) error {
	text, err := dramaTaskText(task)
	if err != nil {
		return err
	}
	bible, err := production.ParseAssetBible(text)
	if err != nil {
		return fmt.Errorf("新设定解析失败：%w", err)
	}
	var payload dramaCastExtractPayload
	_ = json.Unmarshal([]byte(job.PayloadJSON), &payload)
	characters := map[string]production.BibleCharacter{}
	for _, item := range bible.Characters {
		characters[production.NormalizeName(item.Name)] = item
	}
	props := map[string]production.BibleProp{}
	for _, item := range bible.Props {
		props[production.NormalizeName(item.Name)] = item
	}
	scenes := map[string]production.BibleScene{}
	for _, item := range bible.Scenes {
		scenes[production.NormalizeName(item.Name)] = item
	}

	now := time.Now()
	for _, id := range payload.CastIDs {
		cast, err := r.s.repo.DramaCast(r.project.ID, id)
		if err != nil {
			continue
		}
		switch cast.Kind {
		case "character":
			item, ok := characters[production.NormalizeName(cast.Name)]
			if !ok {
				continue
			}
			if err := r.fillLateCharacter(cast, item, now); err != nil {
				return err
			}
		case "prop":
			item, ok := props[production.NormalizeName(cast.Name)]
			if !ok {
				continue
			}
			if err := r.fillLateAssetFields(cast, item.Description, item.Appearance, ""); err != nil {
				return err
			}
		case "scene":
			item, ok := scenes[production.NormalizeName(cast.Name)]
			if !ok {
				continue
			}
			if err := r.fillLateAssetFields(cast, item.Description, item.Appearance, ""); err != nil {
				return err
			}
		}
	}
	return nil
}

// fillLateCharacter 只填写空着的外貌、简介、声线与身份，不覆盖已有内容，也不改已生成的参考图。
func (r *dramaRun) fillLateCharacter(cast *model.DramaCast, item production.BibleCharacter, now time.Time) error {
	if err := r.fillLateAssetFields(cast, item.Description, lateCharacterAppearance(item), lateCharacterVoice(item)); err != nil {
		return err
	}
	if strings.TrimSpace(cast.Role) == "" && strings.TrimSpace(item.Role) != "" {
		if err := r.s.repo.UpdateDramaCastFields(cast.ID, map[string]any{"role": truncateRunes(item.Role, 60)}); err != nil {
			return err
		}
		cast.Role = truncateRunes(item.Role, 60)
	}
	if aliases := encodeStringList(item.Aliases); len(item.Aliases) > 0 && (strings.TrimSpace(cast.AliasesJSON) == "" || cast.AliasesJSON == "[]") {
		if err := r.s.repo.UpdateDramaCastFields(cast.ID, map[string]any{"aliases_json": aliases}); err != nil {
			return err
		}
	}
	return r.createLateLooks(cast, item.Looks, now)
}

func lateCharacterAppearance(item production.BibleCharacter) string {
	if strings.TrimSpace(item.Appearance) == "" {
		return ""
	}
	return strings.Join(nonEmpty(item.Gender, item.Age, item.Appearance), "，")
}

func lateCharacterVoice(item production.BibleCharacter) string {
	if strings.TrimSpace(item.Voice) == "" {
		return ""
	}
	return strings.Join(nonEmpty(item.Gender, item.Age, item.Voice), "，")
}

func (r *dramaRun) fillLateAssetFields(cast *model.DramaCast, description, appearance, voice string) error {
	fields := map[string]any{}
	if strings.TrimSpace(cast.Description) == "" && strings.TrimSpace(description) != "" {
		fields["description"] = truncateRunes(description, 1000)
	}
	if strings.TrimSpace(cast.Appearance) == "" && strings.TrimSpace(appearance) != "" && production.NormalizeName(appearance) != production.NormalizeName(cast.Name) {
		fields["appearance"] = truncateRunes(appearance, 1000)
	}
	if cast.Kind == "character" && strings.TrimSpace(cast.VoiceInstructions) == "" && strings.TrimSpace(voice) != "" {
		fields["voice_instructions"] = truncateRunes(voice, 500)
	}
	if len(fields) == 0 {
		return nil
	}
	return r.s.repo.UpdateDramaCastFields(cast.ID, fields)
}

func (r *dramaRun) createLateLooks(character *model.DramaCast, looks production.BibleLooks, now time.Time) error {
	if character == nil || len(looks) == 0 {
		return nil
	}
	casts, err := r.s.repo.DramaCasts(r.project.ID)
	if err != nil {
		return err
	}
	existing := dramaLooksForCharacter(casts, character.ID)
	position := len(casts)
	created := make([]model.DramaCast, 0, len(looks))
	for _, look := range looks {
		name := strings.TrimSpace(look.Name)
		appearance := strings.TrimSpace(look.Appearance)
		if name == "" || appearance == "" || production.IsBaseLookName(name) {
			continue
		}
		appearanceKey := production.NormalizeName(appearance)
		if production.NormalizeName(character.Appearance) == appearanceKey {
			continue
		}
		duplicate := false
		for _, item := range append(existing, created...) {
			if production.NormalizeName(item.LookName) == production.NormalizeName(name) || production.NormalizeName(item.Appearance) == appearanceKey {
				duplicate = true
				break
			}
		}
		if duplicate {
			continue
		}
		row := model.DramaCast{
			ID: newID(), ProjectID: r.project.ID, Kind: "character", ParentID: character.ID,
			Name: character.Name, LookName: truncateRunes(name, 60), Appearance: truncateRunes(appearance, 1000),
			LookFromChapter: int(look.FromChapter), LookToChapter: int(look.ToChapter),
			Position: position, CreatedAt: now, UpdatedAt: now,
		}
		position++
		created = append(created, row)
	}
	if len(created) == 0 {
		return nil
	}
	return r.s.repo.CreateDramaCasts(created)
}

func (r *dramaRun) episodeCastExtractPending(episodeID string) bool {
	if r.active == nil || strings.TrimSpace(episodeID) == "" {
		return false
	}
	prefix := model.DramaJobCastExtract + "|" + episodeID + "|"
	for key := range r.active {
		if strings.HasPrefix(key, prefix) {
			return true
		}
	}
	return false
}

func dramaJobListExtractPending(jobs []DramaJobView, episodeID string) bool {
	for _, job := range jobs {
		if job.Kind == model.DramaJobCastExtract && job.EpisodeID == episodeID && (job.Status == model.DramaJobQueued || job.Status == model.DramaJobRunning) {
			return true
		}
	}
	return false
}
