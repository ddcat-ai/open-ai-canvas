package app

import (
	"math"
	"strings"

	"yingce/backend/internal/model"
)

func (s *Service) CreationPreferences(user *model.User, expectedUserID string) (map[string]any, error) {
	if user == nil || user.ID == "" || user.ID != expectedUserID {
		return nil, NewAppError(403, "偏好账号已变化，请重新登录后同步")
	}
	return s.repo.CreationPreferences(user.ID)
}

func (s *Service) PatchCreationPreferences(user *model.User, expectedUserID string, patch map[string]any) (map[string]any, error) {
	if user == nil || user.ID == "" || user.ID != expectedUserID {
		return nil, NewAppError(403, "偏好账号已变化，请重新登录后同步")
	}
	if err := validateCreationPreferenceFields(patch, ""); err != nil {
		return nil, err
	}
	return s.repo.PatchCreationPreferences(user.ID, patch)
}

func validateCreationPreferenceFields(value map[string]any, prefix string) error {
	for key, item := range value {
		path := prefix + key
		allowedString, allowedNumber, options := false, false, ""
		switch path {
		case "image", "video", "models", "agent", "agent.budget", "agent.image", "agent.video":
			nested, ok := item.(map[string]any)
			if !ok {
				return BadAuthRequest("偏好分组必须是对象")
			}
			if err := validateCreationPreferenceFields(nested, path+"."); err != nil {
				return err
			}
			continue
		case "mode":
			options = "text,image,video,agent"
		case "outputPreference":
			options = "concise,detailed"
		case "agent.permissionMode":
			options = "read_only,request_approval,auto"
		case "agent.imageParameterMode", "agent.videoParameterMode":
			options = "auto,manual"
		case "agent.imageSelectionMode", "agent.videoSelectionMode":
			options = "preferred,fixed"
		case "image.transparentBackground":
			options = "true,false"
		case "image.model", "image.ratio", "image.quality", "image.imageResolution", "image.count", "video.ratio", "video.seconds", "video.videoQuality", "models.textModel", "models.imageModel", "models.videoModel", "agent.image.size", "agent.image.quality", "agent.video.size", "agent.video.quality":
			allowedString = true
		case "agent.budget.maxCredits", "agent.budget.maxGenerationTasks", "agent.budget.maxVideoSeconds", "agent.image.count", "agent.video.durationSeconds":
			allowedNumber = true
		default:
			return BadAuthRequest("不支持的偏好字段：" + path)
		}
		if allowedNumber {
			n, ok := item.(float64)
			if !ok || math.IsNaN(n) || math.IsInf(n, 0) || n < 0 || n > 10000000 {
				return BadAuthRequest("偏好数值无效：" + path)
			}
			if path != "agent.budget.maxCredits" && n != math.Trunc(n) {
				return BadAuthRequest("该偏好必须是整数：" + path)
			}
			continue
		}
		text, ok := item.(string)
		if !ok || len(text) > 256 || (!allowedString && !containsCapabilityString(strings.Split(options, ","), text)) {
			return BadAuthRequest("偏好选项无效：" + path)
		}
	}
	return nil
}
