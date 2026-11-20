package app

import (
	"errors"
	"net/http"
	"slices"
	"strings"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/production"
	"yingce/backend/internal/repository"

	"gorm.io/gorm"
)

func dramaCastImportConflict(message string) *AppError {
	err := NewAppError(http.StatusConflict, message)
	err.Reason = "drama_cast_import_conflict"
	return err
}

// ImportDramaCast 复制设定而复用媒体，只在目标作品建立独立记录和版本；无调度、收费或来源写入。
func (s *Service) ImportDramaCast(userID, projectID string, req ImportDramaCastRequest) (ImportDramaCastResult, error) {
	result := ImportDramaCastResult{Cast: []model.DramaCast{}}
	projectID, req.SourceProjectID = strings.TrimSpace(projectID), strings.TrimSpace(req.SourceProjectID)
	if req.SourceProjectID == "" || len(req.SourceProjectID) > 36 || req.SourceProjectID == projectID {
		return result, BadAuthRequest("请选择另一部自己的作品作为来源")
	}
	if len(req.CastIDs) == 0 || len(req.CastIDs) > 500 {
		return result, BadAuthRequest("请选择 1 到 500 个基础设定")
	}
	ids := make([]string, 0, len(req.CastIDs))
	selected := map[string]bool{}
	for _, id := range req.CastIDs {
		id = strings.TrimSpace(id)
		if id == "" || len(id) > 36 {
			return result, BadAuthRequest("来源设定 ID 无效")
		}
		if !selected[id] {
			ids = append(ids, id)
			selected[id] = true
		}
	}
	for _, id := range []string{projectID, req.SourceProjectID} {
		if _, _, err := s.dramaForUser(userID, id); err != nil {
			return result, err
		}
	}
	// 与源和目标调度共用租约，避免导入途中提交基于旧素材的任务；排序防止交叉导入互相等待。
	projects := []string{projectID, req.SourceProjectID}
	slices.Sort(projects)
	for _, id := range projects {
		release, err := s.lockDramaSchedule(id)
		if err != nil {
			return result, err
		}
		defer release()
	}
	err := s.repo.Transaction(func(repo *repository.Repository) error {
		if err := repo.LockDramaCastImportTarget(userID, projectID); err != nil {
			return err
		}
		for _, id := range projects {
			if _, err := repo.ProjectForUser(userID, id); err != nil {
				return err
			}
			row, err := repo.DramaProduction(id)
			if err != nil {
				return err
			}
			if row.UserID != userID {
				return gorm.ErrRecordNotFound
			}
		}
		source, err := repo.DramaCastsForUpdate(req.SourceProjectID)
		if err != nil {
			return err
		}
		target, err := repo.DramaCastsForUpdate(projectID)
		if err != nil {
			return err
		}
		byID := map[string]model.DramaCast{}
		for _, cast := range source {
			byID[cast.ID] = cast
		}
		ordered := []model.DramaCast{}
		for _, id := range ids {
			cast, ok := byID[id]
			if !ok {
				return gorm.ErrRecordNotFound
			}
			if cast.ParentID != "" || !validDramaCastKind(cast.Kind) {
				return BadAuthRequest("只能选择来源作品中的基础角色、场景或道具")
			}
			ordered = append(ordered, cast)
		}
		for _, cast := range source {
			if cast.ParentID != "" && selected[cast.ParentID] {
				if cast.Kind != "character" || byID[cast.ParentID].Kind != "character" {
					return BadAuthRequest("来源造型的角色关联无效")
				}
				ordered = append(ordered, cast)
			}
		}
		for _, cast := range ordered {
			if err := validateDramaImportMedia(repo, userID, cast); err != nil {
				return err
			}
		}
		jobs, err := repo.DramaJobsByStatus(projectID, model.DramaJobQueued, model.DramaJobRunning)
		if err != nil {
			return err
		}
		busy := map[string]bool{}
		for _, job := range jobs {
			if job.Kind == model.DramaJobCastImage {
				busy[job.CastID] = true
			}
		}
		mapped, claimed := map[string]string{}, map[string]string{}
		lookCounts := map[string]int{}
		position := 0
		for _, cast := range target {
			if cast.ParentID == "" {
				position = max(position, cast.Position+1)
			} else {
				lookCounts[cast.ParentID]++
			}
		}
		for _, src := range ordered {
			parentID := mapped[src.ParentID]
			if src.ParentID != "" && parentID == "" {
				return BadAuthRequest("来源造型缺少所属角色")
			}
			current, err := matchDramaImportCast(src, parentID, target, req.MatchByName)
			if err != nil {
				return err
			}
			if current != nil {
				if prior := claimed[current.ID]; prior != "" && prior != src.ID {
					return dramaCastImportConflict("多个来源设定匹配同一目标，请关闭同名匹配后重试")
				}
				claimed[current.ID] = src.ID
				if busy[current.ID] || current.ImageStatus == model.DramaMediaQueued || current.ImageStatus == model.DramaMediaRunning {
					return dramaCastImportConflict("目标设定正在生成，请完成后再导入")
				}
				mapped[src.ID] = current.ID
				// 已关联记录默认保持本季编辑；首次同名关联也保护已有图片及其配套设定。
				if !req.ReplaceExisting && (current.SourceCastID == src.ID || current.ImageResourceID != "") {
					if current.SourceCastID == "" {
						if err := repo.UpdateDramaCastFields(current.ID, map[string]any{"source_project_id": req.SourceProjectID, "source_cast_id": src.ID}); err != nil {
							return err
						}
					}
					row, err := repo.DramaCast(projectID, current.ID)
					if err != nil {
						return err
					}
					result.Skipped++
					result.Cast = append(result.Cast, *row)
					continue
				}
			}
			now := time.Now()
			copy := src
			copy.ID, copy.ProjectID, copy.ParentID = newID(), projectID, parentID
			copy.SourceProjectID, copy.SourceCastID = req.SourceProjectID, src.ID
			copy.LookFromChapter, copy.LookToChapter = 0, 0
			copy.CreatedAt, copy.UpdatedAt, copy.Revision = now, now, 1
			copy.Position = position
			position++
			copy.ImageVersion, copy.Locked, copy.ImageStatus = 0, false, model.DramaMediaDraft
			if copy.ImageResourceID != "" {
				copy.ImageVersion, copy.Locked, copy.ImageStatus = 1, true, model.DramaMediaReady
			}
			if copy.ParentID != "" {
				copy.Name = ""
				for _, base := range result.Cast {
					if base.ID == copy.ParentID {
						copy.Name = base.Name
						break
					}
				}
				copy.VoiceProfileID, copy.VoiceSampleResourceID, copy.VoiceInstructions, copy.AliasesJSON = "", "", "", "[]"
			}
			if current == nil {
				if parentID != "" {
					if lookCounts[parentID] >= production.MaxCharacterLooks {
						return dramaCastImportConflict("导入后角色造型数量超出上限，请先整理目标角色的造型")
					}
					lookCounts[parentID]++
				}
				if err := repo.CreateDramaCasts([]model.DramaCast{copy}); err != nil {
					return err
				}
			} else {
				copy.ID = current.ID
				if err := repo.PreserveDramaCastImage(*current); err != nil {
					return err
				}
				fields := dramaImportedCastFields(copy, *current)
				if err := repo.UpdateDramaCastFields(current.ID, fields); err != nil {
					return err
				}
			}
			if src.ImageResourceID != "" && (current == nil || current.ImageResourceID != src.ImageResourceID) {
				take := &model.DramaTake{ID: newID(), ProjectID: projectID, OwnerID: copy.ID, Kind: "cast", ResourceID: src.ImageResourceID, Prompt: "从其他作品导入参考图", CreatedAt: now}
				if err := repo.CreateDramaTake(take); err != nil {
					return err
				}
			}
			row, err := repo.DramaCast(projectID, copy.ID)
			if err != nil {
				return err
			}
			mapped[src.ID] = copy.ID
			claimed[copy.ID] = src.ID
			result.Imported++
			result.Cast = append(result.Cast, *row)
		}
		return nil
	})
	if err != nil {
		return ImportDramaCastResult{Cast: []model.DramaCast{}}, dramaLookupError(err)
	}
	return result, nil
}

func matchDramaImportCast(src model.DramaCast, parentID string, targets []model.DramaCast, matchByName bool) (*model.DramaCast, error) {
	for _, target := range targets {
		if target.SourceCastID == src.ID {
			if target.SourceProjectID != src.ProjectID || target.Kind != src.Kind || target.ParentID != parentID {
				return nil, dramaCastImportConflict("已导入设定的来源或角色关联不一致")
			}
			return &target, nil
		}
	}
	if !matchByName {
		return nil, nil
	}
	var matched *model.DramaCast
	name := src.Name
	if src.ParentID != "" {
		name = src.LookName
	}
	for _, target := range targets {
		targetName := target.Name
		if parentID != "" {
			targetName = target.LookName
		}
		if target.Kind != src.Kind || target.ParentID != parentID || production.NormalizeName(targetName) != production.NormalizeName(name) {
			continue
		}
		if matched != nil {
			return nil, dramaCastImportConflict("同类型同名设定不唯一，请关闭同名匹配或先修改重名设定")
		}
		if target.SourceCastID != "" {
			return nil, dramaCastImportConflict("同名设定已关联另一来源，请关闭同名匹配后重试")
		}
		row := target
		matched = &row
	}
	return matched, nil
}

func validateDramaImportMedia(repo *repository.Repository, userID string, cast model.DramaCast) error {
	if cast.ImageResourceID != "" {
		resource, err := repo.ResourceForUser(userID, cast.ImageResourceID)
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if err != nil || cast.ImageStatus != model.DramaMediaReady || resource.Kind != "image" || resource.Status != model.ResourceStatusReady || !strings.HasPrefix(resource.MimeType, "image/") {
			return BadAuthRequest("来源参考图不存在、未就绪或无权使用")
		}
	}
	if cast.VoiceProfileID != "" {
		profile, err := repo.VoiceProfileForUser(userID, cast.VoiceProfileID)
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if err != nil || profile.Status != "active" || profile.SampleResourceID != cast.VoiceSampleResourceID || profile.SampleResourceID == "" {
			return BadAuthRequest("来源声音不存在、不可用或样本不一致")
		}
	}
	if cast.VoiceSampleResourceID != "" {
		resource, err := repo.ResourceForUser(userID, cast.VoiceSampleResourceID)
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if err != nil || resource.Kind != "audio" || resource.Status != model.ResourceStatusReady || !isSupportedVoiceSampleMimeType(resource.MimeType) {
			return BadAuthRequest("来源声音样本不存在、未就绪或无权使用")
		}
	}
	return nil
}

func dramaImportedCastFields(copy, current model.DramaCast) map[string]any {
	fields := map[string]any{
		"source_project_id": copy.SourceProjectID, "source_cast_id": copy.SourceCastID,
		"name": copy.Name, "aliases_json": copy.AliasesJSON, "role": copy.Role, "description": copy.Description,
		"appearance": copy.Appearance, "image_prompt": copy.ImagePrompt,
		"image_style_id": copy.ImageStyleID, "image_style_name": copy.ImageStyleName, "image_style_prompt": copy.ImageStylePrompt,
		"voice_instructions": copy.VoiceInstructions, "voice_profile_id": copy.VoiceProfileID, "voice_sample_resource_id": copy.VoiceSampleResourceID,
		"look_name": copy.LookName, "look_from_chapter": 0, "look_to_chapter": 0, "importance": copy.Importance,
	}
	if copy.ImageResourceID != "" {
		fields["image_resource_id"], fields["image_status"], fields["locked"] = copy.ImageResourceID, model.DramaMediaReady, true
		if copy.ImageResourceID != current.ImageResourceID {
			fields["image_version"] = current.ImageVersion + 1
		}
	} else if current.ImageResourceID == "" {
		fields["image_status"], fields["locked"] = model.DramaMediaDraft, false
	}
	return fields
}
