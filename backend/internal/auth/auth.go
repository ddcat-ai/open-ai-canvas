package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"log"
	"net/mail"
	"regexp"
	"strings"
	"time"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/repository"

	"yingce/backend/internal/model"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

const SessionCookieName = "open_ai_canvas_session"

const sessionMaxAge = 30 * 24 * time.Hour

var usernamePattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{3,32}$`)

var usernameInvalidChars = regexp.MustCompile(`[^a-zA-Z0-9_-]+`)

// AuthError 保留为兼容别名；跨认证域的新代码应直接使用 AppError。
type AuthError = kernel.AppError

type RegisterRequest struct {
	LoginContext  LoginContext `json:"-"`
	Username      string       `json:"username"`
	Email         string       `json:"email"`
	EmailCode     string       `json:"emailCode"`
	Phone         string       `json:"phone"`
	SMSCode       string       `json:"smsCode"`
	Ticket        string       `json:"ticket"`
	DisplayName   string       `json:"displayName"`
	Password      string       `json:"password"`
	AcceptedTerms bool         `json:"acceptedTerms"`
	ReferralCode  string       `json:"referralCode"`
}

type LoginRequest struct {
	LoginContext LoginContext `json:"-"`
	Username     string       `json:"username"`
	Password     string       `json:"password"`
	// AutoRegister 由登录注册一体表单提交：账号不存在且允许注册时返回 account_not_registered，
	// 客户端据此在同一表单补齐注册信息，不再提示“密码不正确”。
	AutoRegister bool `json:"autoRegister"`
}

type PublicAuthSettings struct {
	VerificationPolicy
	SMSBindingAvailable   bool `json:"smsBindingAvailable"`
	EmailBindingAvailable bool `json:"emailBindingAvailable"`
	FirstUser             bool `json:"firstUser"`
	RegistrationEnabled   bool `json:"registrationEnabled"`
	LinuxDOEnabled        bool `json:"linuxdoEnabled"`
	OIDCEnabled           bool `json:"oidcEnabled"`
	EmailEnabled          bool `json:"emailEnabled"`
	EmailCodeRequired     bool `json:"emailCodeRequired"`
	// EmailRequired：注册必须填写邮箱；EmailVerificationRequired：注册必须先通过验证码。
	EmailRequired             bool   `json:"emailRequired"`
	EmailVerificationRequired bool   `json:"emailVerificationRequired"`
	AgreementTitle            string `json:"agreementTitle,omitempty"`
	AgreementContent          string `json:"agreementContent,omitempty"`
	// LoginMode 决定前台登录入口：modal 弹窗，page 跳转独立页面。
	LoginMode string `json:"loginMode"`
}

type AuthSessionResult struct {
	User       AuthUser `json:"user"`
	Session    string   `json:"session"`
	MaxAgeSecs int      `json:"maxAgeSecs"`
}

type AuthUser struct {
	model.User
	AvatarURL        string `json:"avatarUrl,omitempty"`
	IdentityProvider string `json:"identityProvider,omitempty"`
	IdentityID       string `json:"identityId,omitempty"`
	IdentityUsername string `json:"identityUsername,omitempty"`
}

func (s *Service) PublicAuthSettings() (*PublicAuthSettings, error) {
	count, err := s.repo.UserCount()
	if err != nil {
		return nil, err
	}
	if count == 0 {
		// 首个管理员同样要看到服务协议，不能因为跳过注册校验就丢失协议字段。
		agreementTitle, agreementContent := s.RegistrationAgreement()
		// 与协议字段一致：首个账号创建前配置读取失败只影响展示，打开方式保持默认弹窗。
		loginMode := LoginModeModal
		if _, registration, err := s.readRegistrationSetting(); err == nil {
			loginMode = normalizeLoginMode(registration.LoginMode)
		}
		return &PublicAuthSettings{FirstUser: true, RegistrationEnabled: true, LinuxDOEnabled: false, AgreementTitle: agreementTitle, AgreementContent: agreementContent, LoginMode: loginMode}, nil
	}
	_, registration, err := s.readRegistrationSetting()
	if err != nil {
		return nil, err
	}
	emailEnabled, err := s.EmailEnabled()
	if err != nil {
		return nil, err
	}
	p, err := s.verificationPolicy()
	if err != nil {
		return nil, err
	}
	smsLogin, err := s.smsAvailable("login")
	if err != nil {
		return nil, err
	}
	smsRegister, err := s.smsAvailable("register")
	if err != nil {
		return nil, err
	}
	smsBind, err := s.smsAvailable("bind")
	if err != nil {
		return nil, err
	}
	p.SMSLogin = p.SMSLogin && smsLogin
	p.EmailLogin = p.EmailLogin && emailEnabled
	p.SMSRegistration = p.SMSRegistration && smsRegister
	p.EmailRegistration = p.EmailRegistration && emailEnabled
	p.SMSAndEmailRegistration = p.SMSAndEmailRegistration && smsRegister && emailEnabled
	agreementTitle, agreementContent := s.RegistrationAgreement()
	return &PublicAuthSettings{
		VerificationPolicy:        p,
		SMSBindingAvailable:       smsBind,
		EmailBindingAvailable:     emailEnabled,
		FirstUser:                 false,
		RegistrationEnabled:       registration.Enabled,
		LinuxDOEnabled:            s.LinuxDOEnabled(),
		OIDCEnabled:               readOIDCConfig().enabled(),
		EmailEnabled:              emailEnabled,
		EmailCodeRequired:         registration.verificationRequired() && (p.EmailRegistration || p.SMSAndEmailRegistration),
		EmailRequired:             registration.emailRequired(),
		EmailVerificationRequired: registration.verificationRequired(),
		AgreementTitle:            agreementTitle,
		AgreementContent:          agreementContent,
		LoginMode:                 normalizeLoginMode(registration.LoginMode),
	}, nil
}

func (s *Service) Register(req RegisterRequest) (*AuthSessionResult, error) {
	if !req.AcceptedTerms {
		return nil, kernel.BadAuthRequest("请先同意" + s.AgreementTitleForMessage())
	}
	username := NormalizeUsername(req.Username)
	email := NormalizeEmail(req.Email)
	// 一体表单用邮箱作账号时不提交用户名，加锁后再按邮箱前缀生成。
	generateUsername := username == "" && email != ""
	if !generateUsername {
		if err := ValidateUsername(username); err != nil {
			return nil, err
		}
	}
	if err := ValidatePassword(req.Password); err != nil {
		return nil, err
	}
	if email != "" {
		if err := ValidateEmail(email); err != nil {
			return nil, err
		}
	}
	s.registrationMu.Lock()
	defer s.registrationMu.Unlock()
	count, err := s.repo.UserCount()
	if err != nil {
		return nil, err
	}
	var verifiedCode *model.EmailVerificationCode
	var verification *model.AuthVerification
	phone := ""
	if count > 0 {
		_, registration, err := s.readRegistrationSetting()
		if err != nil {
			return nil, err
		}
		if !registration.Enabled {
			return nil, kernel.Forbidden("管理员未开放新用户注册")
		}
		if registration.emailRequired() && email == "" {
			return nil, kernel.BadAuthRequest("请输入邮箱")
		}
		if email != "" {
			if err := s.validateRegistrationEmailDomain(email); err != nil {
				return nil, err
			}
		}
		if req.Ticket != "" {
			verification, err = s.verifyTicket("register", VerificationConfirm{Ticket: req.Ticket, EmailCode: req.EmailCode, SMSCode: req.SMSCode})
			if err != nil {
				return nil, err
			}
			// 短信验证时邮箱可以另填，按未验证保存；邮箱验证时提交的邮箱必须与验证码一致。
			if (verification.Email != "" && verification.Email != email) || (verification.Email == "" && verification.Method != "sms") || (verification.Phone != "" && strings.TrimSpace(req.Phone) != verification.Phone && "+86"+strings.TrimSpace(req.Phone) != verification.Phone) || (verification.Phone == "" && req.Phone != "") {
				return nil, invalidVerification()
			}
			phone = verification.Phone
			if err := s.contactAvailable(email, phone, ""); err != nil {
				return nil, err
			}
		} else if registration.verificationRequired() {
			p, err := s.verificationPolicy()
			if err != nil {
				return nil, err
			}
			if !p.allows("register", "email") || req.Phone != "" {
				return nil, kernel.BadAuthRequest("请先获取本次注册验证码")
			}
			if email == "" {
				return nil, kernel.BadAuthRequest("请输入邮箱")
			}
			verifiedCode, err = s.VerifyRegistrationEmailCode(email, req.EmailCode)
			if err != nil {
				return nil, err
			}
		}
	}
	if generateUsername {
		if username, err = s.usernameFromEmail(email); err != nil {
			return nil, err
		}
	}
	displayName := NormalizeDisplayName(req.DisplayName, username)
	if _, err := s.repo.UserByUsername(username); err == nil {
		return nil, kernel.BadAuthRequest("用户名已存在")
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	if email != "" {
		if err := s.repo.CheckEmailAvailable(email, ""); err != nil {
			return nil, err
		}
	}
	passwordHash, err := HashPassword(req.Password)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	user := model.User{
		ID:           kernel.NewID(),
		Username:     username,
		Email:        email,
		Phone:        phone,
		DisplayName:  displayName,
		Role:         model.UserRoleUser,
		Status:       model.UserStatusActive,
		PasswordHash: passwordHash,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if count == 0 {
		user.Role = model.UserRoleAdmin
	}
	if verification != nil {
		if verification.Email != "" {
			user.EmailVerifiedAt = &now
		}
		if phone != "" {
			user.PhoneVerifiedAt = &now
		}
		if err := s.repo.CreateUserWithVerification(&user, verification.ID); err != nil {
			if errors.Is(err, repository.ErrVerificationInvalid) {
				return nil, invalidVerification()
			}
			return nil, err
		}
	} else if verifiedCode != nil {
		user.EmailVerifiedAt = &now
		if err := s.repo.CreateUserWithEmailVerification(&user, verifiedCode.ID, time.Now()); err != nil {
			return nil, err
		}
	} else if err := s.repo.CreateRegisteredUser(&user); err != nil {
		return nil, err
	}
	if err := s.host.EnsureSignupBonus(user.ID); err != nil {
		return nil, err
	}
	if count > 0 {
		s.host.BindReferral(user.ID, req.ReferralCode)
	}
	event := NewLoginLog("password", "registration", req.LoginContext)
	result, err := s.createAuthSession(&user, event)
	if err != nil {
		return nil, s.recordLoginFailure(event, err)
	}
	return result, nil
}

// LoginRateLimitSubject uses the same account lookup as password authentication.
func (s *Service) LoginRateLimitSubject(account string) (string, error) {
	account = strings.TrimSpace(account)
	user, err := s.repo.UserByAccount(account)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "input:" + strings.ToLower(account), nil
	}
	if err != nil {
		return "", err
	}
	return "user:" + user.ID, nil
}

func (s *Service) Login(req LoginRequest) (result *AuthSessionResult, err error) {
	event := NewLoginLog("password", "login", req.LoginContext)
	event.Account = MaskLoginAccount(req.Username)
	defer func() {
		if err != nil {
			err = s.recordLoginFailure(event, err)
		}
	}()
	account := strings.TrimSpace(req.Username)
	user, err := s.repo.UserByAccount(account)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			if req.AutoRegister {
				if err := s.accountNotRegistered(account); err != nil {
					return nil, err
				}
			}
			return nil, kernel.Unauthorized("用户名、邮箱或密码不正确")
		}
		return nil, err
	}
	loginLogUser(event, user)
	if user.Status != model.UserStatusActive {
		return nil, kernel.Forbidden("该账号已被禁用")
	}
	if !verifyPassword(req.Password, user.PasswordHash) {
		return nil, kernel.Unauthorized("用户名、邮箱或密码不正确")
	}
	now := time.Now()
	user.LastLoginAt = &now
	user.UpdatedAt = now
	if err := s.repo.UpdateUserLoginTime(user.ID, now); err != nil {
		return nil, err
	}
	return s.createAuthSession(user, event)
}

// accountNotRegistered 只在允许创建账号且输入可以作为用户名或邮箱注册时返回 account_not_registered；
// 注册关闭时保持原来的“用户名、邮箱或密码不正确”，不额外暴露账号是否存在。
func (s *Service) accountNotRegistered(account string) error {
	count, err := s.repo.UserCount()
	if err != nil {
		return err
	}
	if count > 0 {
		enabled, err := s.RegistrationEnabled()
		if err != nil {
			return err
		}
		if !enabled {
			return nil
		}
	}
	kind := "username"
	if strings.Contains(account, "@") {
		if ValidateEmail(NormalizeEmail(account)) != nil {
			return nil
		}
		kind = "email"
	} else if ValidateUsername(account) != nil {
		return nil
	}
	return &kernel.AppError{Status: 404, Code: kernel.CodeAccountNotRegistered, Reason: kernel.ReasonAccountNotRegistered, Message: "该账号尚未注册，确认密码后即可创建账号", Details: map[string]any{"accountKind": kind}}
}

// usernameFromEmail 用邮箱前缀生成可用用户名；邮箱一体注册时用户不再单独填写用户名。
func (s *Service) usernameFromEmail(email string) (string, error) {
	local, _, _ := strings.Cut(email, "@")
	base := strings.Trim(usernameInvalidChars.ReplaceAllString(local, "-"), "-_")
	if len(base) > 24 {
		base = base[:24]
	}
	for len(base) < 3 {
		base += "0"
	}
	candidate := base
	for attempt := 0; attempt < 20; attempt++ {
		if attempt > 0 {
			candidate = base + "-" + RandomToken()[:6]
		}
		if _, err := s.repo.UserByUsername(candidate); errors.Is(err, gorm.ErrRecordNotFound) {
			return candidate, nil
		} else if err != nil {
			return "", err
		}
	}
	return "", kernel.NewAppError(409, "无法生成可用的用户名，请改用用户名注册")
}

func (s *Service) Logout(cookieValue string, contexts ...LoginContext) (err error) {
	sessionID, token := parseSessionCookie(cookieValue)
	if sessionID == "" || token == "" {
		return nil
	}
	var context LoginContext
	if len(contexts) > 0 {
		context = contexts[0]
	}
	event := NewLoginLog("unknown", "logout", context)
	event.Event = "logout"
	event.SessionRef = HashToken(sessionID)
	defer func() {
		if err != nil {
			err = s.recordLoginFailure(event, err)
		}
	}()
	return s.repo.RevokeAuthSessionWithLog(sessionID, HashToken(token), event)
}

func (s *Service) CurrentUser(cookieValue string) (*model.User, error) {
	sessionID, token := parseSessionCookie(cookieValue)
	if sessionID == "" || token == "" {
		return nil, kernel.Unauthorized("请先登录")
	}
	session, err := s.repo.AuthSession(sessionID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, kernel.Unauthorized("登录状态已失效")
		}
		return nil, err
	}
	if time.Now().After(session.ExpiresAt) || session.TokenHash != HashToken(token) {
		if cleanupErr := s.repo.DeleteAuthSession(sessionID); cleanupErr != nil {
			log.Printf("expired auth session cleanup failed: session_id=%s error=%v", sessionID, cleanupErr)
		}
		return nil, kernel.Unauthorized("登录状态已失效")
	}
	user, err := s.repo.User(session.UserID)
	if err != nil {
		return nil, err
	}
	if user.Status != model.UserStatusActive {
		return nil, kernel.Forbidden("该账号已被禁用")
	}
	return user, nil
}

// 认证响应只补充当前用户自己的第三方公开身份，不把身份表或密钥字段暴露给其他列表接口。
func (s *Service) PublicAuthUser(user *model.User) (AuthUser, error) {
	result := AuthUser{User: *user}
	if user.AvatarMode == "custom" {
		result.AvatarURL = profileAvatarURL(user)
	}
	identity, err := s.repo.UserIdentityForUser(user.ID, "linuxdo")
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return result, nil
	}
	if err != nil {
		return AuthUser{}, err
	}
	if user.AvatarMode == "" {
		result.AvatarURL = identity.AvatarURL
	}
	result.IdentityProvider = identity.Provider
	result.IdentityID = identity.Subject
	result.IdentityUsername = identity.ProviderUsername
	return result, nil
}

func (s *Service) createAuthSession(user *model.User, event *model.LoginLog) (*AuthSessionResult, error) {
	loginLogUser(event, user)
	publicUser, err := s.PublicAuthUser(user)
	if err != nil {
		return nil, err
	}
	token := RandomToken()
	now := time.Now()
	session := model.AuthSession{
		ID:        kernel.NewID(),
		UserID:    user.ID,
		TokenHash: HashToken(token),
		ExpiresAt: now.Add(sessionMaxAge),
		CreatedAt: now,
		UpdatedAt: now,
	}
	event.SessionRef = HashToken(session.ID)
	event.CreatedAt = now.UTC()
	if err := s.repo.CreateAuthSessionForUser(user, &session, event); err != nil {
		return nil, profileWriteError(err)
	}
	s.host.RecordActivity(user.ID, "login", 1)
	return &AuthSessionResult{User: publicUser, Session: session.ID + "." + token, MaxAgeSecs: int(sessionMaxAge.Seconds())}, nil
}

func HashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(hash), err
}

func verifyPassword(password string, hash string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

func HashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func RandomToken() string {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		return kernel.NewID() + kernel.NewID()
	}
	return hex.EncodeToString(b[:])
}

func parseSessionCookie(value string) (string, string) {
	parts := strings.SplitN(value, ".", 2)
	if len(parts) != 2 {
		return "", ""
	}
	return strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1])
}

func NormalizeUsername(value string) string {
	return strings.TrimSpace(value)
}

func NormalizeEmail(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func NormalizeDisplayName(value string, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		value = fallback
	}
	runes := []rune(value)
	if len(runes) > 40 {
		value = string(runes[:40])
	}
	return value
}

func ValidateUsername(value string) error {
	if !usernamePattern.MatchString(value) {
		return kernel.BadAuthRequest("用户名需为 3-32 位字母、数字、下划线或连字符")
	}
	return nil
}

func ValidatePassword(value string) error {
	if len([]rune(value)) < 8 {
		return kernel.BadAuthRequest("密码至少 8 位")
	}
	return nil
}

func ValidateEmail(value string) error {
	if _, err := mail.ParseAddress(value); err != nil {
		return kernel.BadAuthRequest("邮箱格式不正确")
	}
	return nil
}
