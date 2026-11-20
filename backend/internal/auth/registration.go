package auth

import (
	"encoding/json"
	"errors"
	"os"
	"strings"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

const registrationSettingKey = "registration"

// 登录注册的打开方式：modal 在当前页面弹出登录框，page 跳转到独立的 /login 页面。
const (
	LoginModeModal = "modal"
	LoginModePage  = "page"
)

// RegistrationSettingRequest 的协议字段和打开方式用指针区分「未提交」和「明确修改」：
// 注册开关单独切换时不带这些字段，必须保留已保存的协议正文与打开方式。
type RegistrationSettingRequest struct {
	Enabled          bool    `json:"enabled"`
	AgreementTitle   *string `json:"agreementTitle"`
	AgreementContent *string `json:"agreementContent"`
	LoginMode        *string `json:"loginMode"`
	// EmailRequired / EmailVerificationRequired 同样是可选指针：不提交表示保留已保存值。
	EmailRequired             *bool `json:"emailRequired"`
	EmailVerificationRequired *bool `json:"emailVerificationRequired"`
}

type PublicRegistrationSetting struct {
	Enabled          bool   `json:"enabled"`
	AgreementTitle   string `json:"agreementTitle"`
	AgreementContent string `json:"agreementContent"`
	LoginMode        string `json:"loginMode"`
	// EmailRequired：注册时必须填写邮箱。EmailVerificationRequired：注册必须先通过验证码（按登录注册策略，默认邮箱）。
	EmailRequired             bool      `json:"emailRequired"`
	EmailVerificationRequired bool      `json:"emailVerificationRequired"`
	UpdatedBy                 string    `json:"updatedBy"`
	CreatedAt                 time.Time `json:"createdAt"`
	UpdatedAt                 time.Time `json:"updatedAt"`
}

type registrationSettingValue struct {
	Enabled          bool   `json:"enabled"`
	AgreementTitle   string `json:"agreementTitle"`
	AgreementContent string `json:"agreementContent"`
	// 旧记录没有该字段，读取时按 modal 处理。
	LoginMode string `json:"loginMode,omitempty"`
	// 旧记录没有这两个字段：邮箱按选填、验证按必须处理，保持升级前的注册校验强度。
	EmailRequired             *bool `json:"emailRequired,omitempty"`
	EmailVerificationRequired *bool `json:"emailVerificationRequired,omitempty"`
}

func (v registrationSettingValue) emailRequired() bool {
	return v.EmailRequired != nil && *v.EmailRequired
}

func (v registrationSettingValue) verificationRequired() bool {
	return v.EmailVerificationRequired == nil || *v.EmailVerificationRequired
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
		Enabled:                   req.Enabled,
		AgreementTitle:            currentValue.AgreementTitle,
		AgreementContent:          currentValue.AgreementContent,
		LoginMode:                 normalizeLoginMode(currentValue.LoginMode),
		EmailRequired:             boolPtr(currentValue.emailRequired()),
		EmailVerificationRequired: boolPtr(currentValue.verificationRequired()),
	}
	if req.EmailRequired != nil {
		nextValue.EmailRequired = boolPtr(*req.EmailRequired)
	}
	if req.EmailVerificationRequired != nil {
		nextValue.EmailVerificationRequired = boolPtr(*req.EmailVerificationRequired)
	}
	// 只在本次打开验证要求时检查发送能力：否则新用户会因为没有可用验证方式而无法注册。
	if nextValue.verificationRequired() && !currentValue.verificationRequired() {
		methods, err := s.availableRegistrationMethods()
		if err != nil {
			return nil, err
		}
		if len(methods) == 0 {
			return nil, kernel.BadAuthRequest("当前没有可用的注册验证方式，请先配置并开启邮件服务")
		}
	}
	if req.AgreementTitle != nil {
		nextValue.AgreementTitle = strings.TrimSpace(*req.AgreementTitle)
	}
	if req.AgreementContent != nil {
		nextValue.AgreementContent = strings.TrimSpace(*req.AgreementContent)
	}
	if req.LoginMode != nil {
		mode := strings.ToLower(strings.TrimSpace(*req.LoginMode))
		if mode != LoginModeModal && mode != LoginModePage {
			return nil, kernel.BadAuthRequest("登录注册打开方式只能是 modal（弹窗）或 page（独立页面）")
		}
		nextValue.LoginMode = mode
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

// normalizeLoginMode 只用于读取已保存的值：缺失或无法识别时回到默认弹窗模式。
// 写入路径在 UpdateRegistrationSetting 中单独校验，非法值直接拒绝。
func normalizeLoginMode(value string) string {
	if strings.ToLower(strings.TrimSpace(value)) == LoginModePage {
		return LoginModePage
	}
	return LoginModeModal
}

func publicRegistrationSetting(setting *model.SystemSetting, value registrationSettingValue) *PublicRegistrationSetting {
	result := &PublicRegistrationSetting{
		Enabled:                   value.Enabled,
		AgreementTitle:            value.AgreementTitle,
		AgreementContent:          value.AgreementContent,
		LoginMode:                 normalizeLoginMode(value.LoginMode),
		EmailRequired:             value.emailRequired(),
		EmailVerificationRequired: value.verificationRequired(),
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

func boolPtr(value bool) *bool { return &value }
