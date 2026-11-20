package app

import (
	"encoding/json"
	"errors"
	"fmt"
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

const (
	defaultArkRealGroupLimit        = 5
	defaultArkVirtualGroupLimit     = 10
	defaultArkRealAuthorizationDays = 365
	maxArkGroupLimit                = 200
	maxArkAuthorizationDays         = 3650
	// 单组费用上限 100 万积分，防止误把微积分当积分录入后产生异常扣费。
	maxArkGroupPriceMicrocredits = 1_000_000 * CreditScale
)

type ArkPrivateAssetSettingRequest struct {
	Enabled bool `json:"enabled"`
	// RealEnabled / VirtualEnabled 分别开放用户自助创建真人、虚拟素材组；与可信素材自动同步（Enabled）相互独立。
	RealEnabled                   bool   `json:"realEnabled"`
	VirtualEnabled                bool   `json:"virtualEnabled"`
	RealGroupLimit                int    `json:"realGroupLimit"`
	VirtualGroupLimit             int    `json:"virtualGroupLimit"`
	BillingEnabled                bool   `json:"billingEnabled"`
	RealGroupPriceMicrocredits    int64  `json:"realGroupPriceMicrocredits"`
	VirtualGroupPriceMicrocredits int64  `json:"virtualGroupPriceMicrocredits"`
	RealReviewRequired            bool   `json:"realReviewRequired"`
	VirtualReviewRequired         bool   `json:"virtualReviewRequired"`
	RealAuthorizationDays         int    `json:"realAuthorizationDays"`
	Site                          string `json:"site"`
	CallbackBaseURL               string `json:"callbackBaseUrl"`
	Region                        string `json:"region"`
	ProjectName                   string `json:"projectName"`
	AccessKeyID                   string `json:"accessKeyId"`
	AccessKeySecret               string `json:"accessKeySecret"`
}

type PublicArkPrivateAssetSetting struct {
	Enabled                       bool      `json:"enabled"`
	RealEnabled                   bool      `json:"realEnabled"`
	VirtualEnabled                bool      `json:"virtualEnabled"`
	RealGroupLimit                int       `json:"realGroupLimit"`
	VirtualGroupLimit             int       `json:"virtualGroupLimit"`
	BillingEnabled                bool      `json:"billingEnabled"`
	RealGroupPriceMicrocredits    int64     `json:"realGroupPriceMicrocredits"`
	VirtualGroupPriceMicrocredits int64     `json:"virtualGroupPriceMicrocredits"`
	RealReviewRequired            bool      `json:"realReviewRequired"`
	VirtualReviewRequired         bool      `json:"virtualReviewRequired"`
	RealAuthorizationDays         int       `json:"realAuthorizationDays"`
	Site                          string    `json:"site"`
	CallbackBaseURL               string    `json:"callbackBaseUrl"`
	Region                        string    `json:"region"`
	ProjectName                   string    `json:"projectName"`
	AccessKeyID                   string    `json:"accessKeyId"`
	HasAccessKeySecret            bool      `json:"hasAccessKeySecret"`
	UpdatedBy                     string    `json:"updatedBy"`
	CreatedAt                     time.Time `json:"createdAt"`
	UpdatedAt                     time.Time `json:"updatedAt"`
}

type arkPrivateAssetSettingValue struct {
	Enabled                       bool   `json:"enabled"`
	RealEnabled                   bool   `json:"realEnabled"`
	VirtualEnabled                bool   `json:"virtualEnabled"`
	RealGroupLimit                int    `json:"realGroupLimit"`
	VirtualGroupLimit             int    `json:"virtualGroupLimit"`
	BillingEnabled                bool   `json:"billingEnabled"`
	RealGroupPriceMicrocredits    int64  `json:"realGroupPriceMicrocredits"`
	VirtualGroupPriceMicrocredits int64  `json:"virtualGroupPriceMicrocredits"`
	RealReviewRequired            bool   `json:"realReviewRequired"`
	VirtualReviewRequired         bool   `json:"virtualReviewRequired"`
	RealAuthorizationDays         int    `json:"realAuthorizationDays"`
	Site                          string `json:"site"`
	CallbackBaseURL               string `json:"callbackBaseUrl"`
	Region                        string `json:"region"`
	ProjectName                   string `json:"projectName"`
	AccessKeyID                   string `json:"accessKeyId"`
	AccessKeySecret               string `json:"accessKeySecret"`
	DefaultGroupID                string `json:"defaultGroupId"`
}

// credentialsReady 表示站点、项目与 IAM 凭据完整，可以调用方舟控制面。
func (value arkPrivateAssetSettingValue) credentialsReady() bool {
	return value.Region != "" && value.ProjectName != "" && value.AccessKeyID != "" && value.AccessKeySecret != ""
}

func (value arkPrivateAssetSettingValue) groupLimit(kind string) int {
	if kind == arkGroupKindVirtual {
		return value.VirtualGroupLimit
	}
	return value.RealGroupLimit
}

func (value arkPrivateAssetSettingValue) groupPrice(kind string) int64 {
	if !value.BillingEnabled {
		return 0
	}
	if kind == arkGroupKindVirtual {
		return value.VirtualGroupPriceMicrocredits
	}
	if kind == arkGroupKindReal {
		return value.RealGroupPriceMicrocredits
	}
	return 0
}

func (value arkPrivateAssetSettingValue) reviewRequired(kind string) bool {
	switch kind {
	case arkGroupKindVirtual:
		return value.VirtualReviewRequired
	case arkGroupKindReal:
		return value.RealReviewRequired
	default:
		return false
	}
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
	} else {
		next.DefaultGroupID = current.DefaultGroupID
	}
	setting := &model.SystemSetting{Key: arkPrivateAssetSettingKey, UpdatedBy: actor.ID}
	if currentSetting != nil {
		setting.CreatedAt = currentSetting.CreatedAt
	}
	if err := s.saveArkPrivateAssetSetting(setting, next); err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "ark_private_assets.update", "system_setting", arkPrivateAssetSettingKey, "更新方舟素材库配置", map[string]any{
		"enabled": next.Enabled, "realEnabled": next.RealEnabled, "virtualEnabled": next.VirtualEnabled,
		"billingEnabled": next.BillingEnabled, "realGroupPriceMicrocredits": next.RealGroupPriceMicrocredits, "virtualGroupPriceMicrocredits": next.VirtualGroupPriceMicrocredits,
		"realGroupLimit": next.RealGroupLimit, "virtualGroupLimit": next.VirtualGroupLimit,
		"realReviewRequired": next.RealReviewRequired, "virtualReviewRequired": next.VirtualReviewRequired, "realAuthorizationDays": next.RealAuthorizationDays,
		"site": next.Site, "region": next.Region, "projectName": next.ProjectName,
	}); err != nil {
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
		Enabled:                       req.Enabled,
		RealEnabled:                   req.RealEnabled,
		VirtualEnabled:                req.VirtualEnabled,
		RealGroupLimit:                req.RealGroupLimit,
		VirtualGroupLimit:             req.VirtualGroupLimit,
		BillingEnabled:                req.BillingEnabled,
		RealGroupPriceMicrocredits:    req.RealGroupPriceMicrocredits,
		VirtualGroupPriceMicrocredits: req.VirtualGroupPriceMicrocredits,
		RealReviewRequired:            req.RealReviewRequired,
		VirtualReviewRequired:         req.VirtualReviewRequired,
		RealAuthorizationDays:         req.RealAuthorizationDays,
		Site:                          req.Site,
		CallbackBaseURL:               req.CallbackBaseURL,
		Region:                        req.Region,
		ProjectName:                   req.ProjectName,
		AccessKeyID:                   req.AccessKeyID,
		AccessKeySecret:               req.AccessKeySecret,
	})
	if next.AccessKeySecret == "" && next.AccessKeyID == current.AccessKeyID {
		next.AccessKeySecret = current.AccessKeySecret
	}
	// 上限与有效期为 0 表示沿用当前值；负数或超出范围直接拒绝。
	if req.RealGroupLimit < 0 || req.RealGroupLimit > maxArkGroupLimit || req.VirtualGroupLimit < 0 || req.VirtualGroupLimit > maxArkGroupLimit {
		return next, BadAuthRequest(fmt.Sprintf("每人素材组上限需在 1-%d 之间", maxArkGroupLimit))
	}
	if req.RealAuthorizationDays < 0 || req.RealAuthorizationDays > maxArkAuthorizationDays {
		return next, BadAuthRequest(fmt.Sprintf("真人授权有效期需在 1-%d 天之间", maxArkAuthorizationDays))
	}
	if req.RealGroupLimit == 0 {
		next.RealGroupLimit = current.RealGroupLimit
	}
	if req.VirtualGroupLimit == 0 {
		next.VirtualGroupLimit = current.VirtualGroupLimit
	}
	if req.RealAuthorizationDays == 0 {
		next.RealAuthorizationDays = current.RealAuthorizationDays
	}
	next = normalizeArkPrivateAssetSetting(next)
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
	for _, price := range []int64{req.RealGroupPriceMicrocredits, req.VirtualGroupPriceMicrocredits} {
		if price < 0 || price > maxArkGroupPriceMicrocredits {
			return next, BadAuthRequest("素材组费用需在 0 到 1000000 积分之间")
		}
	}
	if !next.Enabled && !next.RealEnabled && !next.VirtualEnabled {
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
	if value.RealGroupLimit <= 0 {
		value.RealGroupLimit = defaultArkRealGroupLimit
	}
	if value.VirtualGroupLimit <= 0 {
		value.VirtualGroupLimit = defaultArkVirtualGroupLimit
	}
	if value.RealAuthorizationDays <= 0 {
		value.RealAuthorizationDays = defaultArkRealAuthorizationDays
	}
	return value
}

func defaultArkPrivateAssetSetting() arkPrivateAssetSettingValue {
	return arkPrivateAssetSettingValue{
		RealGroupLimit:        defaultArkRealGroupLimit,
		VirtualGroupLimit:     defaultArkVirtualGroupLimit,
		RealReviewRequired:    true,
		VirtualReviewRequired: true,
		RealAuthorizationDays: defaultArkRealAuthorizationDays,
	}
}

func publicArkPrivateAssetSetting(setting *model.SystemSetting, value arkPrivateAssetSettingValue) PublicArkPrivateAssetSetting {
	result := PublicArkPrivateAssetSetting{
		Enabled:                       value.Enabled,
		RealEnabled:                   value.RealEnabled,
		VirtualEnabled:                value.VirtualEnabled,
		RealGroupLimit:                value.RealGroupLimit,
		VirtualGroupLimit:             value.VirtualGroupLimit,
		BillingEnabled:                value.BillingEnabled,
		RealGroupPriceMicrocredits:    value.RealGroupPriceMicrocredits,
		VirtualGroupPriceMicrocredits: value.VirtualGroupPriceMicrocredits,
		RealReviewRequired:            value.RealReviewRequired,
		VirtualReviewRequired:         value.VirtualReviewRequired,
		RealAuthorizationDays:         value.RealAuthorizationDays,
		Site:                          value.Site,
		CallbackBaseURL:               value.CallbackBaseURL,
		Region:                        value.Region,
		ProjectName:                   value.ProjectName,
		AccessKeyID:                   value.AccessKeyID,
		HasAccessKeySecret:            value.AccessKeySecret != "",
	}
	if setting != nil {
		result.UpdatedBy = setting.UpdatedBy
		result.CreatedAt = setting.CreatedAt
		result.UpdatedAt = setting.UpdatedAt
	}
	return result
}
