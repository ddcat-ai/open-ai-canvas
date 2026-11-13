package app

import (
	"fmt"
	"strings"

	"yingce/backend/internal/model"
	"yingce/backend/internal/production"
)

// remapDramaSegmentPromptReferences 按设定/资源身份保持手写正文的引用对象，不按名称或旧序号猜测。
// 移除正文仍使用的引用必须先修改正文，避免旧编号静默指向另一张图。
func remapDramaSegmentPromptReferences(prompt string, before, after []DramaSegmentReference) (string, error) {
	if unknown := production.UnknownReferenceTokens(prompt, len(before)); len(unknown) > 0 {
		return "", BadAuthRequest("手写提示词含无效引用 " + strings.Join(unknown, "、") + "，请先修改正文再调整参考资产")
	}
	identity := func(reference DramaSegmentReference) string {
		if reference.CastID != "" {
			return "cast:" + reference.CastID
		}
		return "resource:" + reference.ResourceID
	}
	labels := map[string]string{}
	for _, reference := range after {
		labels[identity(reference)] = reference.Label
	}
	replacements := map[string]string{}
	for _, reference := range before {
		if label, exists := labels[identity(reference)]; exists {
			replacements[reference.Label] = label
		} else {
			// 用一次替换判断真实令牌，参考图1 不应误匹配参考图10。
			if production.RewriteReferenceTokens(prompt, map[string]string{reference.Label: ""}) != production.RewriteReferenceTokens(prompt, nil) {
				return "", BadAuthRequest(fmt.Sprintf("手写提示词仍引用 %s（%s），请先修改正文中的该引用，再移除此资产", reference.Label, reference.Name))
			}
		}
	}
	return production.RewriteReferenceTokens(prompt, replacements), nil
}

// 外部参考只接受当前用户已经入库的图片，不能直接把浏览器 URL 带入生成任务。
func (s *Service) dramaReferenceImages(userID string, images []model.DramaReferenceImage) ([]model.DramaReferenceImage, error) {
	if len(images) > dramaMaxReferenceLimit {
		return nil, BadAuthRequest(fmt.Sprintf("每段最多添加 %d 张图片", dramaMaxReferenceLimit))
	}
	result := []model.DramaReferenceImage{}
	seen := map[string]bool{}
	for _, image := range images {
		id := strings.TrimSpace(image.ResourceID)
		if id == "" {
			return nil, BadAuthRequest("请选择已上传的图片")
		}
		resource, err := s.repo.ResourceForUser(userID, id)
		if err != nil {
			return nil, err
		}
		if resource.Kind != "image" || resource.Status != model.ResourceStatusReady {
			return nil, BadAuthRequest("参考图片未就绪")
		}
		if seen[id] {
			continue
		}
		seen[id] = true
		result = append(result, model.DramaReferenceImage{ResourceID: id, Name: truncateRunes(firstNonEmpty(strings.TrimSpace(image.Name), "自定义参考图"), 120)})
	}
	return result, nil
}

func (s *Service) dramaSegmentAudioIDs(projectID, episodeID string, index int, ids []string) ([]string, error) {
	ids, err := s.dramaSegmentReferenceIDs(projectID, ids)
	if err != nil {
		return nil, err
	}
	for _, id := range ids {
		cast, err := s.repo.DramaCast(projectID, id)
		if err != nil {
			return nil, err
		}
		if cast.Kind != "character" || cast.ParentID != "" || cast.VoiceSampleResourceID == "" {
			return nil, BadAuthRequest("请选择已绑定音频的角色本体")
		}
	}
	if len(ids) == 0 {
		return ids, nil
	}
	productionRow, err := s.repo.DramaProduction(projectID)
	if err != nil {
		return nil, err
	}
	rows, err := s.repo.DramaSegments(episodeID)
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		if row.SegmentIndex != index {
			continue
		}
		settings := parseDramaSettings(productionRow.SettingsJSON)
		profile, err := s.dramaVideoProfile(segmentVideoChoice(row, settings.Models.Video))
		if err != nil {
			return nil, err
		}
		if len(ids) > profile.MaxAudios {
			return nil, BadAuthRequest(fmt.Sprintf("当前视频模型最多支持 %d 个参考音色", profile.MaxAudios))
		}
		return ids, nil
	}
	return nil, BadAuthRequest("剧情段不存在")
}
