package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/repository"
	"log"
	"net/mail"
	"regexp"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

const SessionCookieName = "open_ai_canvas_session"

const sessionMaxAge = 30 * 24 * time.Hour

var usernamePattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{3,32}$`)

// AuthError 保留为兼容别名；跨认证域的新代码应直接使用 AppError。
type AuthError = kernel.AppError

type RegisterRequest struct {
	Username      string `json:"username"`
	Email         string `json:"email"`
	EmailCode     string `json:"emailCode"`
	Phone         string `json:"phone"`
	SMSCode       string `json:"smsCode"`
	Ticket        string `json:"ticket"`
	DisplayName   string `json:"displayName"`
	Password      string `json:"password"`
	AcceptedTerms bool   `json:"acceptedTerms"`
}

type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type PublicAuthSettings struct {
	VerificationPolicy
	SMSBindingAvailable   bool   `json:"smsBindingAvailable"`
	EmailBindingAvailable bool   `json:"emailBindingAvailable"`
	FirstUser             bool   `json:"firstUser"`
	RegistrationEnabled   bool   `json:"registrationEnabled"`
	LinuxDOEnabled        bool   `json:"linuxdoEnabled"`
	EmailEnabled          bool   `json:"emailEnabled"`
	EmailCodeRequired     bool   `json:"emailCodeRequired"`
	AgreementTitle        string `json:"agreementTitle,omitempty"`
	AgreementContent      string `json:"agreementContent,omitempty"`
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
		return &PublicAuthSettings{FirstUser: true, RegistrationEnabled: true, LinuxDOEnabled: false, AgreementTitle: agreementTitle, AgreementContent: agreementContent}, nil
	}
	registrationEnabled, err := s.RegistrationEnabled()
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
		VerificationPolicy:    p,
		SMSBindingAvailable:   smsBind,
		EmailBindingAvailable: emailEnabled,
		FirstUser:             false,
		RegistrationEnabled:   registrationEnabled,
		LinuxDOEnabled:        s.LinuxDOEnabled(),
		EmailEnabled:          emailEnabled,
		EmailCodeRequired:     p.EmailRegistration || p.SMSAndEmailRegistration,
		AgreementTitle:        agreementTitle,
		AgreementContent:      agreementContent,
	}, nil
}

func (s *Service) Register(req RegisterRequest) (*AuthSessionResult, error) {
	if !req.AcceptedTerms {
		return nil, kernel.BadAuthRequest("请先同意" + s.AgreementTitleForMessage())
	}
	username := NormalizeUsername(req.Username)
	email := NormalizeEmail(req.Email)
	displayName := NormalizeDisplayName(req.DisplayName, username)
	if err := ValidateUsername(username); err != nil {
		return nil, err
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
		registrationEnabled, err := s.RegistrationEnabled()
		if err != nil {
			return nil, err
		}
		if !registrationEnabled {
			return nil, kernel.Forbidden("管理员未开放新用户注册")
		}
		if req.Ticket != "" {
			verification, err = s.verifyTicket("register", VerificationConfirm{Ticket: req.Ticket, EmailCode: req.EmailCode, SMSCode: req.SMSCode})
			if err != nil {
				return nil, err
			}
			if verification.Email != email || (verification.Phone != "" && strings.TrimSpace(req.Phone) != verification.Phone && "+86"+strings.TrimSpace(req.Phone) != verification.Phone) || (verification.Phone == "" && req.Phone != "") {
				return nil, invalidVerification()
			}
			phone = verification.Phone
			if err := s.contactAvailable(email, phone, ""); err != nil {
				return nil, err
			}
		} else {
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
			if err := s.validateRegistrationEmailDomain(email); err != nil {
				return nil, err
			}
			verifiedCode, err = s.VerifyRegistrationEmailCode(email, req.EmailCode)
			if err != nil {
				return nil, err
			}
		}
	}
	if _, err := s.repo.UserByUsername(username); err == nil {
		return nil, kernel.BadAuthRequest("用户名已存在")
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	if email != "" {
		if _, err := s.repo.UserByEmail(email); err == nil {
			return nil, kernel.BadAuthRequest("邮箱已被注册")
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
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
		if email != "" {
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
	} else if err := s.repo.Create(&user); err != nil {
		return nil, err
	}
	if err := s.host.EnsureSignupBonus(user.ID); err != nil {
		return nil, err
	}
	return s.createAuthSession(&user)
}

func (s *Service) Login(req LoginRequest) (*AuthSessionResult, error) {
	account := strings.TrimSpace(req.Username)
	user, err := s.repo.UserByAccount(account)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, kernel.Unauthorized("用户名、邮箱或密码不正确")
		}
		return nil, err
	}
	if user.Status != model.UserStatusActive {
		return nil, kernel.Forbidden("该账号已被禁用")
	}
	if !verifyPassword(req.Password, user.PasswordHash) {
		return nil, kernel.Unauthorized("用户名、邮箱或密码不正确")
	}
	now := time.Now()
	user.LastLoginAt = &now
	user.UpdatedAt = now
	if err := s.repo.Save(user); err != nil {
		return nil, err
	}
	if err := s.host.EnsureSignupBonus(user.ID); err != nil {
		return nil, err
	}
	s.host.RecordActivity(user.ID, "login", 1)
	return s.createAuthSession(user)
}

func (s *Service) Logout(cookieValue string) error {
	sessionID, _ := parseSessionCookie(cookieValue)
	if sessionID == "" {
		return nil
	}
	return s.repo.DeleteAuthSession(sessionID)
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
	identity, err := s.repo.UserIdentityForUser(user.ID, "linuxdo")
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return result, nil
	}
	if err != nil {
		return AuthUser{}, err
	}
	result.AvatarURL = identity.AvatarURL
	result.IdentityProvider = identity.Provider
	result.IdentityID = identity.Subject
	result.IdentityUsername = identity.ProviderUsername
	return result, nil
}

func (s *Service) createAuthSession(user *model.User) (*AuthSessionResult, error) {
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
	if err := s.repo.Create(&session); err != nil {
		return nil, err
	}
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
