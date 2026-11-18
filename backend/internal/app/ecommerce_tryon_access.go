package app

import (
	"strings"

	"yingce/backend/internal/model"
)

// RequireEcommerceTryOn 批量换装单个功能的开放判断：后台开启时所有用户可用；关闭时只放行管理员。
func (s *Service) RequireEcommerceTryOn(userID, function string) error {
	if err := s.RequireFeature(FeatureEcommerce); err != nil {
		return err
	}
	function = strings.TrimSpace(function)
	label, known := ecommerceTryOnFunctionLabels[function]
	if !known {
		return BadAuthRequest("换装功能无效")
	}
	enabled, err := s.TryOnFunctionEnabled(function)
	if err != nil {
		return err
	}
	if enabled {
		return nil
	}
	user, err := s.repo.User(userID)
	if err != nil {
		return err
	}
	if user != nil && user.Role == model.UserRoleAdmin {
		return nil
	}
	return Forbidden("「" + label + "」暂未开放")
}

// tryOnFunctionFromBatchID 从批量换装出图的批次编号（前端 newTryOnBatchId：tryon_<功能>_<随机>）取出功能；不是换装批次返回空。
func tryOnFunctionFromBatchID(id string) string {
	id = strings.TrimSpace(id)
	if id == "" || len(id) > 64 || !tryOnBatchPattern.MatchString(id) {
		return ""
	}
	rest := strings.TrimPrefix(id, "tryon_")
	return rest[:strings.LastIndex(rest, "_")]
}
