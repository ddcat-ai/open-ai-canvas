package app

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

const arkPrivateAssetSettingKey = "ark_private_assets"

const (
	arkSiteVolcengine = "volcengine"
	arkSiteBytePlus   = "byteplus"
)

type ArkPrivateAssetSettingRequest struct {
	Enabled bool `json:"enabled"`
	// PortraitEnabled 开放用户级真人认证素材库；与可信素材自动同步（Enabled）相互独立。
	PortraitEnabled bool   `json:"portraitEnabled"`
	Site            string `json:"site"`
	CallbackBaseURL string `json:"callbackBaseUrl"`
	Region          string `json:"region"`
	ProjectName     string `json:"projectName"`
	AccessKeyID     string `json:"accessKeyId"`
	AccessKeySecret string `json:"accessKeySecret"`
}

type PublicArkPrivateAssetSetting struct {
	Enabled            bool      `json:"enabled"`
	PortraitEnabled    bool      `json:"portraitEnabled"`
	Site               string    `json:"site"`
	CallbackBaseURL    string    `json:"callbackBaseUrl"`
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
	PortraitEnabled bool   `json:"portraitEnabled"`
	Site            string `json:"site"`
	CallbackBaseURL string `json:"callbackBaseUrl"`
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
	if next.Site != current.Site || next.Region != current.Region || next.ProjectName != current.ProjectName || next.AccessKeyID != current.AccessKeyID {
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
		PortraitEnabled: req.PortraitEnabled,
		Site:            req.Site,
		CallbackBaseURL: req.CallbackBaseURL,
		Region:          req.Region,
		ProjectName:     req.ProjectName,
		AccessKeyID:     req.AccessKeyID,
		AccessKeySecret: req.AccessKeySecret,
	})
	if next.AccessKeySecret == "" && next.AccessKeyID == current.AccessKeyID {
		next.AccessKeySecret = current.AccessKeySecret
	}
	if next.Site != arkSiteVolcengine && next.Site != arkSiteBytePlus {
		return next, BadAuthRequest("方舟站点只支持 volcengine（火山引擎）或 byteplus（BytePlus 海外站）")
	}
	if next.CallbackBaseURL != "" {
		if err := validatePaymentPublicBaseURL(next.CallbackBaseURL); err != nil {
			return next, BadAuthRequest("真人认证回调地址必须是有效的 HTTP(S) 根地址")
		}
	}
	if next.Region != "" {
		if _, err := arkPrivateAssetControlPlaneURL(next.Site, next.Region); err != nil {
			return next, BadAuthRequest(err.Error())
		}
	}
	if !next.Enabled && !next.PortraitEnabled {
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
	value.Site = strings.ToLower(strings.TrimSpace(value.Site))
	if value.Site == "" {
		value.Site = arkSiteVolcengine
	}
	value.CallbackBaseURL = strings.TrimRight(strings.TrimSpace(value.CallbackBaseURL), "/")
	value.Region = strings.ToLower(strings.TrimSpace(value.Region))
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
		PortraitEnabled:    value.PortraitEnabled,
		Site:               value.Site,
		CallbackBaseURL:    value.CallbackBaseURL,
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
