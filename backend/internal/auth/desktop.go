package auth

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

const DesktopClientID = "peekreel-lite"

const desktopAuthorizationCodeTTL = 2 * time.Minute

var (
	desktopCodeChallengePattern = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)
	desktopCodeVerifierPattern  = regexp.MustCompile(`^[A-Za-z0-9._~-]{43,128}$`)
)

type DesktopAuthorizationRequest struct {
	ClientID      string `json:"clientId"`
	RedirectURI   string `json:"redirectUri"`
	CodeChallenge string `json:"codeChallenge"`
}

type DesktopAuthorizationResult struct {
	Code      string `json:"code"`
	ExpiresIn int    `json:"expiresIn"`
}

type DesktopTokenRequest struct {
	ClientID    string `json:"clientId"`
	RedirectURI string `json:"redirectUri"`
	Code        string `json:"code"`
	Verifier    string `json:"codeVerifier"`
}

func (s *Service) AuthorizeDesktop(user *model.User, req DesktopAuthorizationRequest) (*DesktopAuthorizationResult, error) {
	if user == nil || user.ID == "" || user.Status != model.UserStatusActive {
		return nil, kernel.Unauthorized("请先登录")
	}
	if req.ClientID != DesktopClientID || !validDesktopRedirectURI(req.RedirectURI) || !desktopCodeChallengePattern.MatchString(req.CodeChallenge) {
		return nil, kernel.BadAuthRequest("桌面授权请求无效，请从 PeekReel Lite 重新发起")
	}
	if decoded, err := base64.RawURLEncoding.DecodeString(req.CodeChallenge); err != nil || len(decoded) != sha256.Size {
		return nil, kernel.BadAuthRequest("桌面授权请求无效，请从 PeekReel Lite 重新发起")
	}

	now := time.Now().UTC()
	code := RandomToken()
	record := &model.DesktopAuthorizationCode{
		ID:            kernel.NewID(),
		CodeHash:      HashToken(code),
		UserID:        user.ID,
		ClientID:      req.ClientID,
		RedirectURI:   req.RedirectURI,
		CodeChallenge: req.CodeChallenge,
		ExpiresAt:     now.Add(desktopAuthorizationCodeTTL),
		CreatedAt:     now,
	}
	if err := s.repo.CreateDesktopAuthorizationCodeForUser(user, record); err != nil {
		if errors.Is(err, repository.ErrProfileAuthorization) {
			return nil, kernel.Unauthorized("登录状态已失效，请重新登录")
		}
		return nil, err
	}
	return &DesktopAuthorizationResult{Code: code, ExpiresIn: int(desktopAuthorizationCodeTTL.Seconds())}, nil
}

func (s *Service) ExchangeDesktopAuthorizationCode(req DesktopTokenRequest, contexts ...LoginContext) (*AuthSessionResult, error) {
	if req.ClientID != DesktopClientID || !validDesktopRedirectURI(req.RedirectURI) || strings.TrimSpace(req.Code) == "" || !desktopCodeVerifierPattern.MatchString(req.Verifier) {
		return nil, invalidDesktopGrant()
	}
	record, err := s.repo.DesktopAuthorizationCode(HashToken(req.Code), time.Now().UTC())
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, invalidDesktopGrant()
		}
		return nil, err
	}
	if record.ClientID != req.ClientID || record.RedirectURI != req.RedirectURI {
		return nil, invalidDesktopGrant()
	}
	challenge := sha256.Sum256([]byte(req.Verifier))
	actualChallenge := base64.RawURLEncoding.EncodeToString(challenge[:])
	if subtle.ConstantTimeCompare([]byte(record.CodeChallenge), []byte(actualChallenge)) != 1 {
		return nil, invalidDesktopGrant()
	}
	if err := s.repo.ConsumeDesktopAuthorizationCode(record.ID, time.Now().UTC()); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, invalidDesktopGrant()
		}
		return nil, err
	}
	user, err := s.repo.User(record.UserID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, invalidDesktopGrant()
		}
		return nil, err
	}
	if user.Status != model.UserStatusActive {
		return nil, kernel.Forbidden("该账号已被禁用")
	}
	var loginContext LoginContext
	if len(contexts) > 0 {
		loginContext = contexts[0]
	}
	return s.createAuthSession(user, NewLoginLog("desktop", "authorization_code", loginContext))
}

func validDesktopRedirectURI(raw string) bool {
	u, err := url.ParseRequestURI(raw)
	if err != nil || u == nil || u.Scheme != "http" || u.User != nil || u.Hostname() != "127.0.0.1" || u.Path != "/oauth/callback" || u.RawQuery != "" || u.Fragment != "" || u.RawPath != "" {
		return false
	}
	port, err := strconv.Atoi(u.Port())
	return err == nil && port >= 1 && port <= 65535 && u.Host == "127.0.0.1:"+u.Port()
}

func invalidDesktopGrant() error {
	return kernel.Unauthorized("桌面授权码无效或已过期，请从 PeekReel Lite 重新开始")
}
