package service

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

const arkPrivateAssetSettingKey = "ark_private_assets"

type ArkPrivateAssetSettingRequest struct {
	Enabled         bool   `json:"enabled"`
	Region          string `json:"region"`
	ProjectName     string `json:"projectName"`
	AccessKeyID     string `json:"accessKeyId"`
	AccessKeySecret string `json:"accessKeySecret"`
}

type PublicArkPrivateAssetSetting struct {
	Enabled            bool      `json:"enabled"`
	Region             string    `json:"region"`
	ProjectName        string    `json:"projectName"`
	AccessKeyID        string    `json:"accessKeyId"`
	HasAccessKeySecret bool      `json:"hasAccessKeySecret"`
	UpdatedBy          string    `json:"updatedBy"`
	CreatedAt          time.Time `json:"createdAt"`
	UpdatedAt          time.Time `json:"updatedAt"`
}

type arkPrivateAssetSettingValue struct {
	Enabled         bool   `json:"enabled"`
	Region          string `json:"region"`
	ProjectName     string `json:"projectName"`
	AccessKeyID     string `json:"accessKeyId"`
	AccessKeySecret string `json:"accessKeySecret"`
	DefaultGroupID  string `json:"defaultGroupId"`
}

func (s *Service) AdminArkPrivateAssetSetting(actor *model.User) (*PublicArkPrivateAssetSetting, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	setting, value, err := s.readArkPrivateAssetSetting()
	if err != nil {
		return nil, err
	}
	public := publicArkPrivateAssetSetting(setting, value)
	return &public, nil
}

func (s *Service) UpdateArkPrivateAssetSetting(actor *model.User, req ArkPrivateAssetSettingRequest) (*PublicArkPrivateAssetSetting, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	currentSetting, current, err := s.readArkPrivateAssetSetting()
	if err != nil {
		return nil, err
	}
	next, err := arkPrivateAssetSettingFromRequest(req, current)
	if err != nil {
		return nil, err
	}
	if next.Region != current.Region || next.ProjectName != current.ProjectName || next.AccessKeyID != current.AccessKeyID {
		// Asset groups belong to one Ark Project and credential scope. Recreate
		// lazily after either boundary changes.
		next.DefaultGroupID = ""
	}
	setting := &model.SystemSetting{Key: arkPrivateAssetSettingKey, UpdatedBy: actor.ID}
	if currentSetting != nil {
		setting.CreatedAt = currentSetting.CreatedAt
	}
	if err := s.saveArkPrivateAssetSetting(setting, next); err != nil {
		return nil, err
	}
	public := publicArkPrivateAssetSetting(setting, next)
	return &public, nil
}

func (s *Service) readArkPrivateAssetSetting() (*model.SystemSetting, arkPrivateAssetSettingValue, error) {
	setting, err := s.repo.SystemSetting(arkPrivateAssetSettingKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, defaultArkPrivateAssetSetting(), nil
	}
	if err != nil {
		return nil, arkPrivateAssetSettingValue{}, err
	}
	value := defaultArkPrivateAssetSetting()
	if strings.TrimSpace(setting.ValueJSON) != "" {
		if err := json.Unmarshal([]byte(setting.ValueJSON), &value); err != nil {
			return nil, arkPrivateAssetSettingValue{}, errors.New("方舟素材库配置格式无效")
		}
	}
	needsMigration := value.AccessKeySecret != "" && !strings.HasPrefix(value.AccessKeySecret, encryptedSettingPrefix)
	secret, err := s.decryptSettingSecret(value.AccessKeySecret)
	if err != nil {
		return nil, arkPrivateAssetSettingValue{}, err
	}
	value.AccessKeySecret = secret
	value = normalizeArkPrivateAssetSetting(value)
	if needsMigration {
		if err := s.saveArkPrivateAssetSetting(setting, value); err != nil {
			return nil, arkPrivateAssetSettingValue{}, err
		}
	}
	return setting, value, nil
}

func (s *Service) saveArkPrivateAssetSetting(setting *model.SystemSetting, value arkPrivateAssetSettingValue) error {
	stored := normalizeArkPrivateAssetSetting(value)
	var err error
	stored.AccessKeySecret, err = s.encryptSettingSecret(stored.AccessKeySecret)
	if err != nil {
		return err
	}
	encoded, err := json.Marshal(stored)
	if err != nil {
		return err
	}
	setting.ValueJSON = string(encoded)
	return s.repo.SaveSystemSetting(setting)
}

func arkPrivateAssetSettingFromRequest(req ArkPrivateAssetSettingRequest, current arkPrivateAssetSettingValue) (arkPrivateAssetSettingValue, error) {
	next := normalizeArkPrivateAssetSetting(arkPrivateAssetSettingValue{
		Enabled:         req.Enabled,
		Region:          req.Region,
		ProjectName:     req.ProjectName,
		AccessKeyID:     req.AccessKeyID,
		AccessKeySecret: req.AccessKeySecret,
	})
	if next.AccessKeySecret == "" && next.AccessKeyID == current.AccessKeyID {
		next.AccessKeySecret = current.AccessKeySecret
	}
	if !next.Enabled {
		return next, nil
	}
	if next.Region == "" {
		return next, BadAuthRequest("请填写方舟 Region")
	}
	if next.ProjectName == "" {
		return next, BadAuthRequest("请填写方舟 ProjectName")
	}
	if next.AccessKeyID == "" {
		return next, BadAuthRequest("请填写方舟素材库 AccessKey")
	}
	if next.AccessKeySecret == "" {
		return next, BadAuthRequest("请填写方舟素材库 SecretKey")
	}
	return next, nil
}

func normalizeArkPrivateAssetSetting(value arkPrivateAssetSettingValue) arkPrivateAssetSettingValue {
	value.Region = strings.TrimSpace(value.Region)
	value.ProjectName = strings.TrimSpace(value.ProjectName)
	value.AccessKeyID = strings.TrimSpace(value.AccessKeyID)
	value.AccessKeySecret = strings.TrimSpace(value.AccessKeySecret)
	value.DefaultGroupID = strings.TrimSpace(value.DefaultGroupID)
	return value
}

func defaultArkPrivateAssetSetting() arkPrivateAssetSettingValue {
	return arkPrivateAssetSettingValue{}
}

func publicArkPrivateAssetSetting(setting *model.SystemSetting, value arkPrivateAssetSettingValue) PublicArkPrivateAssetSetting {
	result := PublicArkPrivateAssetSetting{
		Enabled:            value.Enabled,
		Region:             value.Region,
		ProjectName:        value.ProjectName,
		AccessKeyID:        value.AccessKeyID,
		HasAccessKeySecret: value.AccessKeySecret != "",
	}
	if setting != nil {
		result.UpdatedBy = setting.UpdatedBy
		result.CreatedAt = setting.CreatedAt
		result.UpdatedAt = setting.UpdatedAt
	}
	return result
}
