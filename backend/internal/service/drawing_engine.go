package service

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

const (
	drawingEngineSettingKey    = "drawing_engine"
	tldrawLicenseKeySettingKey = "tldraw_license_key"
)

const (
	DrawingEngineTldraw     = "tldraw"
	DrawingEngineExcalidraw = "excalidraw"
)

type DrawingEngineSetting struct {
	DefaultEngine    string `json:"defaultEngine"`
	TldrawLicenseKey string `json:"tldrawLicenseKey"`
}

type PublicDrawingEngineSetting struct {
	DrawingEngineSetting
	Configured bool      `json:"configured"`
	UpdatedBy  string    `json:"updatedBy,omitempty"`
	CreatedAt  time.Time `json:"createdAt,omitempty"`
	UpdatedAt  time.Time `json:"updatedAt,omitempty"`
}

func defaultDrawingEngineSetting() DrawingEngineSetting {
	// 新部署默认使用真正开源的编辑器；历史节点没有引擎字段时仍由前端识别为 tldraw。
	return DrawingEngineSetting{DefaultEngine: DrawingEngineExcalidraw}
}

func (s *Service) DrawingEngineSetting() (*PublicDrawingEngineSetting, error) {
	setting, value, err := s.readDrawingEngineSetting()
	if err != nil {
		return nil, err
	}
	return publicDrawingEngineSetting(setting, value), nil
}

func (s *Service) AdminDrawingEngineSetting(actor *model.User) (*PublicDrawingEngineSetting, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	return s.DrawingEngineSetting()
}

func (s *Service) UpdateDrawingEngineSetting(actor *model.User, value DrawingEngineSetting) (*PublicDrawingEngineSetting, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if err := validateDrawingEngineSetting(value); err != nil {
		return nil, err
	}
	value.TldrawLicenseKey = strings.TrimSpace(value.TldrawLicenseKey)
	current, before, err := s.readDrawingEngineSetting()
	if err != nil {
		return nil, err
	}
	currentLicenseSetting, _, err := s.readTldrawLicenseKey()
	if err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(struct {
		DefaultEngine string `json:"defaultEngine"`
	}{DefaultEngine: value.DefaultEngine})
	if err != nil {
		return nil, err
	}
	encodedLicenseKey, err := json.Marshal(value.TldrawLicenseKey)
	if err != nil {
		return nil, err
	}
	setting := model.SystemSetting{Key: drawingEngineSettingKey, ValueJSON: string(encoded), UpdatedBy: actor.ID}
	if current != nil {
		setting.CreatedAt = current.CreatedAt
	}
	licenseSetting := model.SystemSetting{Key: tldrawLicenseKeySettingKey, ValueJSON: string(encodedLicenseKey), UpdatedBy: actor.ID}
	if currentLicenseSetting != nil {
		licenseSetting.CreatedAt = currentLicenseSetting.CreatedAt
	}
	if err := s.repo.SaveSystemSettings(&setting, &licenseSetting); err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "drawing_engine.update", "system_setting", drawingEngineSettingKey, "更新绘图工具配置", map[string]any{"before": drawingEngineAuditValue(before), "after": drawingEngineAuditValue(value)}); err != nil {
		return nil, err
	}
	return publicDrawingEngineSetting(&setting, value), nil
}

func (s *Service) readDrawingEngineSetting() (*model.SystemSetting, DrawingEngineSetting, error) {
	setting, err := s.repo.SystemSetting(drawingEngineSettingKey)
	value := defaultDrawingEngineSetting()
	if errors.Is(err, gorm.ErrRecordNotFound) {
		setting = nil
	} else if err != nil {
		return nil, DrawingEngineSetting{}, err
	} else {
		if strings.TrimSpace(setting.ValueJSON) == "" || json.Unmarshal([]byte(setting.ValueJSON), &value) != nil {
			return nil, DrawingEngineSetting{}, errors.New("绘图工具配置格式无效")
		}
		if err := validateDrawingEngineSetting(value); err != nil {
			return nil, DrawingEngineSetting{}, err
		}
	}
	_, licenseKey, err := s.readTldrawLicenseKey()
	if err != nil {
		return nil, DrawingEngineSetting{}, err
	}
	value.TldrawLicenseKey = licenseKey
	return setting, value, nil
}

func (s *Service) readTldrawLicenseKey() (*model.SystemSetting, string, error) {
	setting, err := s.repo.SystemSetting(tldrawLicenseKeySettingKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, "", nil
	}
	if err != nil {
		return nil, "", err
	}
	var value string
	if strings.TrimSpace(setting.ValueJSON) == "" || json.Unmarshal([]byte(setting.ValueJSON), &value) != nil {
		return nil, "", errors.New("tldraw License Key 配置格式无效")
	}
	return setting, strings.TrimSpace(value), nil
}

func validateDrawingEngineSetting(value DrawingEngineSetting) error {
	if value.DefaultEngine != DrawingEngineTldraw && value.DefaultEngine != DrawingEngineExcalidraw {
		return BadAuthRequest("默认绘图工具必须是 tldraw 或 Excalidraw")
	}
	return nil
}

func drawingEngineAuditValue(value DrawingEngineSetting) map[string]any {
	return map[string]any{"defaultEngine": value.DefaultEngine, "hasTldrawLicenseKey": strings.TrimSpace(value.TldrawLicenseKey) != ""}
}

func publicDrawingEngineSetting(setting *model.SystemSetting, value DrawingEngineSetting) *PublicDrawingEngineSetting {
	result := &PublicDrawingEngineSetting{DrawingEngineSetting: value, Configured: setting != nil}
	if setting != nil {
		result.UpdatedBy = setting.UpdatedBy
		result.CreatedAt = setting.CreatedAt
		result.UpdatedAt = setting.UpdatedAt
	}
	return result
}
