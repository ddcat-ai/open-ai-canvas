package auth

import (
	"encoding/json"
	"errors"
	"os"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

const registrationSettingKey = "registration"

// RegistrationSettingRequest 的协议字段用指针区分「未提交」和「明确清空」：
// 注册开关单独切换时不带协议字段，必须保留已保存的协议正文。
type RegistrationSettingRequest struct {
	Enabled          bool    `json:"enabled"`
	AgreementTitle   *string `json:"agreementTitle"`
	AgreementContent *string `json:"agreementContent"`
}

type PublicRegistrationSetting struct {
	Enabled          bool      `json:"enabled"`
	AgreementTitle   string    `json:"agreementTitle"`
	AgreementContent string    `json:"agreementContent"`
	UpdatedBy        string    `json:"updatedBy"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

type registrationSettingValue struct {
	Enabled          bool   `json:"enabled"`
	AgreementTitle   string `json:"agreementTitle"`
	AgreementContent string `json:"agreementContent"`
}

func (s *Service) AdminRegistrationSetting(actor *model.User) (*PublicRegistrationSetting, error) {
	if err := s.host.RequireAdmin(actor); err != nil {
		return nil, err
	}
	setting, value, err := s.readRegistrationSetting()
	if err != nil {
		return nil, err
	}
	return publicRegistrationSetting(setting, value), nil
}

func (s *Service) UpdateRegistrationSetting(actor *model.User, req RegistrationSettingRequest) (*PublicRegistrationSetting, error) {
	if err := s.host.RequireAdmin(actor); err != nil {
		return nil, err
	}
	current, currentValue, err := s.readRegistrationSetting()
	if err != nil {
		return nil, err
	}
	nextValue := registrationSettingValue{
		Enabled:          req.Enabled,
		AgreementTitle:   currentValue.AgreementTitle,
		AgreementContent: currentValue.AgreementContent,
	}
	if req.AgreementTitle != nil {
		nextValue.AgreementTitle = strings.TrimSpace(*req.AgreementTitle)
	}
	if req.AgreementContent != nil {
		nextValue.AgreementContent = strings.TrimSpace(*req.AgreementContent)
	}
	encoded, err := json.Marshal(nextValue)
	if err != nil {
		return nil, err
	}
	setting := model.SystemSetting{Key: registrationSettingKey, ValueJSON: string(encoded), UpdatedBy: actor.ID}
	if current != nil {
		setting.CreatedAt = current.CreatedAt
	}
	if err := s.repo.SaveSystemSetting(&setting); err != nil {
		return nil, err
	}
	return publicRegistrationSetting(&setting, nextValue), nil
}

func (s *Service) RegistrationEnabled() (bool, error) {
	_, value, err := s.readRegistrationSetting()
	return value.Enabled, err
}

// AgreementTitleForMessage 只用于错误提示。协议读取失败时不再返回品牌名兜底标题，
// 否则用户会被要求同意一个后台并不存在的协议名称。
func (s *Service) AgreementTitleForMessage() string {
	title, _ := s.RegistrationAgreement()
	if strings.TrimSpace(title) == "" {
		return "服务协议"
	}
	return title
}

// RegistrationAgreement 返回展示用的协议标题（已去掉书名号）和条款正文。
// 标题未配置时跟随当前品牌名，保证品牌改名后注册页文案同步。
// 读取失败时返回空标题，由调用方决定是降级展示还是给出失败提示。
func (s *Service) RegistrationAgreement() (string, string) {
	_, value, err := s.readRegistrationSetting()
	if err != nil {
		return "", ""
	}
	title := strings.Trim(strings.TrimSpace(value.AgreementTitle), "《》")
	if title == "" {
		title = s.defaultAgreementTitle()
	}
	return title, value.AgreementContent
}

func (s *Service) defaultAgreementTitle() string {
	brand := strings.TrimSpace(s.host.BrandName())
	if brand == "" {
		brand = DefaultBrandName
	}
	return brand + "服务协议"
}

func (s *Service) readRegistrationSetting() (*model.SystemSetting, registrationSettingValue, error) {
	setting, err := s.repo.SystemSetting(registrationSettingKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, registrationSettingValue{Enabled: registrationEnabledFromEnvironment()}, nil
	}
	if err != nil {
		return nil, registrationSettingValue{}, err
	}
	value := registrationSettingValue{}
	if strings.TrimSpace(setting.ValueJSON) == "" || json.Unmarshal([]byte(setting.ValueJSON), &value) != nil {
		return nil, registrationSettingValue{}, errors.New("用户注册配置格式无效")
	}
	return setting, value, nil
}

func publicRegistrationSetting(setting *model.SystemSetting, value registrationSettingValue) *PublicRegistrationSetting {
	result := &PublicRegistrationSetting{
		Enabled:          value.Enabled,
		AgreementTitle:   value.AgreementTitle,
		AgreementContent: value.AgreementContent,
	}
	if setting != nil {
		result.UpdatedBy = setting.UpdatedBy
		result.CreatedAt = setting.CreatedAt
		result.UpdatedAt = setting.UpdatedAt
	}
	return result
}

func registrationEnabledFromEnvironment() bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv("CANVAS_REGISTRATION_ENABLED")))
	return value == "1" || value == "true" || value == "yes"
}
