package service

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

const drawingEngineSettingKey = "drawing_engine"

const (
	DrawingEngineTldraw     = "tldraw"
	DrawingEngineExcalidraw = "excalidraw"
)

type DrawingEngineSetting struct {
	DefaultEngine string `json:"defaultEngine"`
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
	current, before, err := s.readDrawingEngineSetting()
	if err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	setting := model.SystemSetting{Key: drawingEngineSettingKey, ValueJSON: string(encoded), UpdatedBy: actor.ID}
	if current != nil {
		setting.CreatedAt = current.CreatedAt
	}
	if err := s.repo.SaveSystemSetting(&setting); err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "drawing_engine.update", "system_setting", drawingEngineSettingKey, "更新默认绘图工具", map[string]any{"before": before, "after": value}); err != nil {
		return nil, err
	}
	return publicDrawingEngineSetting(&setting, value), nil
}

func (s *Service) readDrawingEngineSetting() (*model.SystemSetting, DrawingEngineSetting, error) {
	setting, err := s.repo.SystemSetting(drawingEngineSettingKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, defaultDrawingEngineSetting(), nil
	}
	if err != nil {
		return nil, DrawingEngineSetting{}, err
	}
	value := DrawingEngineSetting{}
	if strings.TrimSpace(setting.ValueJSON) == "" || json.Unmarshal([]byte(setting.ValueJSON), &value) != nil {
		return nil, DrawingEngineSetting{}, errors.New("绘图工具配置格式无效")
	}
	if err := validateDrawingEngineSetting(value); err != nil {
		return nil, DrawingEngineSetting{}, err
	}
	return setting, value, nil
}

func validateDrawingEngineSetting(value DrawingEngineSetting) error {
	if value.DefaultEngine != DrawingEngineTldraw && value.DefaultEngine != DrawingEngineExcalidraw {
		return BadAuthRequest("默认绘图工具必须是 tldraw 或 Excalidraw")
	}
	return nil
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
