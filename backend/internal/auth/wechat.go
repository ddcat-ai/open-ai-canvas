package auth

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math/big"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

const wechatSettingKey = "wechat_login"

type WechatSettingValue struct {
	Enabled    bool   `json:"enabled"`
	AppID      string `json:"appId"`
	Secret     string `json:"secret"`
	Page       string `json:"page"`
	EnvVersion string `json:"envVersion"`
	Manual     bool   `json:"manual"`
}

type PublicWechatSetting struct {
	Enabled    bool      `json:"enabled"`
	AppID      string    `json:"appId"`
	HasSecret  bool      `json:"hasSecret"`
	Page       string    `json:"page"`
	EnvVersion string    `json:"envVersion"`
	Manual     bool      `json:"manual"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

type WechatSettingRequest struct {
	Enabled    bool   `json:"enabled"`
	AppID      string `json:"appId"`
	Secret     string `json:"secret,omitempty"`
	Page       string `json:"page"`
	EnvVersion string `json:"envVersion"`
	Manual     bool   `json:"manual"`
}

var (
	wechatTokenMu       sync.Mutex
	wechatAccessToken   string
	wechatTokenExpireAt time.Time
	wechatConfirmMu     sync.Mutex
)

func wechatLoginEnvConfig() (enabled bool, appID string, secret string, page string, envVersion string, manual bool) {
	enabled = os.Getenv("CANVAS_WECHAT_LOGIN_ENABLED") == "true" || os.Getenv("CANVAS_WECHAT_LOGIN_ENABLED") == "1"
	appID = strings.TrimSpace(os.Getenv("CANVAS_WECHAT_APPID"))
	secret = strings.TrimSpace(os.Getenv("CANVAS_WECHAT_SECRET"))
	page = strings.TrimSpace(os.Getenv("CANVAS_WECHAT_QR_PAGE"))
	if page == "default" || page == "none" || page == "root" {
		page = ""
	} else if page == "" {
		page = "pages/login/login"
	}
	envVersion = strings.TrimSpace(os.Getenv("CANVAS_WECHAT_QR_ENV_VERSION"))
	if envVersion == "" {
		envVersion = "trial"
	}
	manual = os.Getenv("CANVAS_WECHAT_QR_MANUAL") == "true" || os.Getenv("CANVAS_WECHAT_QR_MANUAL") == "1"
	return
}

func (s *Service) readWechatSetting() (*model.SystemSetting, WechatSettingValue, error) {
	setting, err := s.repo.SystemSetting(wechatSettingKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		enabled, appID, secret, page, envVersion, manual := wechatLoginEnvConfig()
		return nil, WechatSettingValue{
			Enabled:    enabled,
			AppID:      appID,
			Secret:     secret,
			Page:       page,
			EnvVersion: envVersion,
			Manual:     manual,
		}, nil
	}
	if err != nil {
		return nil, WechatSettingValue{}, err
	}
	var value WechatSettingValue
	if err := json.Unmarshal([]byte(setting.ValueJSON), &value); err != nil {
		return nil, WechatSettingValue{}, err
	}
	if value.Secret != "" {
		decrypted, err := s.host.DecryptSecret(value.Secret)
		if err == nil {
			value.Secret = decrypted
		}
	}
	return setting, value, nil
}

func (s *Service) wechatLoginConfig() (enabled bool, appID string, secret string, page string, envVersion string, manual bool) {
	_, value, err := s.readWechatSetting()
	if err != nil {
		return wechatLoginEnvConfig()
	}
	return value.Enabled, value.AppID, value.Secret, value.Page, value.EnvVersion, value.Manual
}

func (s *Service) WechatLoginEnabled() bool {
	enabled, appID, _, _, _, _ := s.wechatLoginConfig()
	return enabled && appID != ""
}

func (s *Service) WechatManualMode() bool {
	_, _, _, _, _, manual := s.wechatLoginConfig()
	return manual
}

func (s *Service) AdminWechatSetting(actor *model.User) (*PublicWechatSetting, error) {
	if err := s.host.RequireAdmin(actor); err != nil {
		return nil, err
	}
	setting, value, err := s.readWechatSetting()
	if err != nil {
		return nil, err
	}
	updatedAt := time.Now()
	if setting != nil {
		updatedAt = setting.UpdatedAt
	}
	return &PublicWechatSetting{
		Enabled:    value.Enabled,
		AppID:      value.AppID,
		HasSecret:  value.Secret != "",
		Page:       value.Page,
		EnvVersion: value.EnvVersion,
		Manual:     value.Manual,
		UpdatedAt:  updatedAt,
	}, nil
}

func (s *Service) UpdateWechatSetting(actor *model.User, req WechatSettingRequest) (*PublicWechatSetting, error) {
	if err := s.host.RequireAdmin(actor); err != nil {
		return nil, err
	}
	currentSetting, current, err := s.readWechatSetting()
	if err != nil {
		return nil, err
	}

	appID := strings.TrimSpace(req.AppID)
	if appID == "" {
		appID = current.AppID
	}
	if req.Enabled && appID == "" {
		return nil, kernel.BadAuthRequest("启用微信扫码登录前必须配置小程序 AppID")
	}

	secret := strings.TrimSpace(req.Secret)
	if secret == "" {
		secret = current.Secret
	}
	page := strings.TrimSpace(req.Page)
	if page == "" {
		page = "pages/login/login"
	}
	envVersion := strings.TrimSpace(req.EnvVersion)
	if envVersion == "" {
		envVersion = "trial"
	}

	value := WechatSettingValue{
		Enabled:    req.Enabled,
		AppID:      appID,
		Secret:     secret,
		Page:       page,
		EnvVersion: envVersion,
		Manual:     req.Manual,
	}

	stored := value
	if stored.Secret != "" {
		encrypted, err := s.host.EncryptSecret(stored.Secret)
		if err != nil {
			return nil, err
		}
		stored.Secret = encrypted
	}

	encoded, err := json.Marshal(stored)
	if err != nil {
		return nil, err
	}
	setting := model.SystemSetting{Key: wechatSettingKey, ValueJSON: string(encoded), UpdatedBy: actor.ID}
	if currentSetting != nil {
		setting.CreatedAt = currentSetting.CreatedAt
	}
	if err := s.repo.SaveSystemSetting(&setting); err != nil {
		return nil, err
	}

	// 更新设置时清空 token 缓存以便重新获取
	wechatTokenMu.Lock()
	wechatAccessToken = ""
	wechatTokenExpireAt = time.Time{}
	wechatTokenMu.Unlock()

	return &PublicWechatSetting{
		Enabled:    value.Enabled,
		AppID:      value.AppID,
		HasSecret:  value.Secret != "",
		Page:       value.Page,
		EnvVersion: value.EnvVersion,
		Manual:     value.Manual,
		UpdatedAt:  time.Now(),
	}, nil
}

func getWechatAccessToken(appID, secret string) (string, error) {
	wechatTokenMu.Lock()
	defer wechatTokenMu.Unlock()

	if wechatAccessToken != "" && time.Now().Before(wechatTokenExpireAt) {
		return wechatAccessToken, nil
	}

	tokenURL := fmt.Sprintf("https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=%s&secret=%s",
		url.QueryEscape(appID), url.QueryEscape(secret))

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(tokenURL)
	if err != nil {
		return "", fmt.Errorf("请求微信 access_token 失败: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var res struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
		ErrCode     int    `json:"errcode"`
		ErrMsg      string `json:"errmsg"`
	}
	if err := json.Unmarshal(body, &res); err != nil {
		return "", fmt.Errorf("解析微信 access_token 失败: %w", err)
	}
	if res.ErrCode != 0 || res.AccessToken == "" {
		return "", fmt.Errorf("微信返回错误 [%d]: %s", res.ErrCode, res.ErrMsg)
	}

	wechatAccessToken = res.AccessToken
	wechatTokenExpireAt = time.Now().Add(time.Duration(res.ExpiresIn-300) * time.Second)
	return wechatAccessToken, nil
}

func fetchWechatQRCode(accessToken, scene, page, envVersion string) (string, error) {
	reqURL := fmt.Sprintf("https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=%s", url.QueryEscape(accessToken))
	payload := map[string]any{
		"scene":       scene,
		"check_path":  false,
		"env_version": envVersion,
		"width":       280,
	}
	if strings.TrimSpace(page) != "" {
		payload["page"] = strings.TrimSpace(page)
	}
	jsonBytes, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}

	client := &http.Client{Timeout: 12 * time.Second}
	resp, err := client.Post(reqURL, "application/json", bytes.NewReader(jsonBytes))
	if err != nil {
		return "", fmt.Errorf("请求微信小程序码失败: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	if bytes.HasPrefix(body, []byte("{")) && bytes.Contains(body, []byte("errcode")) {
		var errRes struct {
			ErrCode int    `json:"errcode"`
			ErrMsg  string `json:"errmsg"`
		}
		_ = json.Unmarshal(body, &errRes)
		return "", fmt.Errorf("生成小程序码失败 [%d]: %s", errRes.ErrCode, errRes.ErrMsg)
	}

	contentType := resp.Header.Get("Content-Type")
	if strings.Contains(contentType, "png") {
		contentType = "image/png"
	} else {
		contentType = "image/jpeg"
	}
	base64Str := base64.StdEncoding.EncodeToString(body)
	return fmt.Sprintf("data:%s;base64,%s", contentType, base64Str), nil
}

type wechatSessionResult struct {
	OpenID     string `json:"openid"`
	SessionKey string `json:"session_key"`
	UnionID    string `json:"unionid"`
	ErrCode    int    `json:"errcode"`
	ErrMsg     string `json:"errmsg"`
}

func exchangeCode2Session(appID, secret, jsCode string) (*wechatSessionResult, error) {
	apiURL := fmt.Sprintf("https://api.weixin.qq.com/sns/jscode2session?appid=%s&secret=%s&js_code=%s&grant_type=authorization_code",
		url.QueryEscape(appID), url.QueryEscape(secret), url.QueryEscape(jsCode))

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(apiURL)
	if err != nil {
		return nil, fmt.Errorf("请求微信 jscode2session 失败: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var res wechatSessionResult
	if err := json.Unmarshal(body, &res); err != nil {
		return nil, fmt.Errorf("解析微信 jscode2session 失败: %w", err)
	}
	if res.ErrCode != 0 {
		return nil, fmt.Errorf("微信登录授权失败 [%d]: %s", res.ErrCode, res.ErrMsg)
	}
	if res.OpenID == "" {
		return nil, errors.New("微信未返回有效的 openid")
	}
	return &res, nil
}

func newManualCode() string {
	const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
	var b strings.Builder
	for i := 0; i < 6; i++ {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		b.WriteByte(alphabet[n.Int64()])
	}
	return b.String()
}

type WechatQRTicketResponse struct {
	Ticket    string `json:"ticket"`
	Code      string `json:"code,omitempty"`
	QRImage   string `json:"qrImage,omitempty"`
	Manual    bool   `json:"manual"`
	Action    string `json:"action"`
	ExpiresAt string `json:"expiresAt"`
}

func (s *Service) CreateWechatQRTicket(action string, userID string) (*WechatQRTicketResponse, error) {
	enabled, appID, secret, page, envVersion, manual := s.wechatLoginConfig()
	if !enabled || appID == "" {
		return nil, kernel.BadAuthRequest("微信扫码登录尚未启用")
	}
	if action != model.WechatTicketActionBind {
		action = model.WechatTicketActionLogin
	}
	ticketID := kernel.NewID()
	shortCode := newManualCode()
	expiresAt := time.Now().Add(10 * time.Minute)

	qrImage := ""
	if !manual && secret != "" {
		token, tokenErr := getWechatAccessToken(appID, secret)
		if tokenErr != nil {
			log.Printf("[Wechat] 获取 access_token 失败: %v", tokenErr)
		} else {
			img, imgErr := fetchWechatQRCode(token, ticketID, page, envVersion)
			if imgErr != nil {
				log.Printf("[Wechat] 获取小程序码图片失败 (page=%s, env=%s): %v", page, envVersion, imgErr)
			} else {
				qrImage = img
			}
		}
	}

	ticket := &model.WechatQRTicket{
		ID:          ticketID,
		Action:      action,
		UserID:      userID,
		Status:      model.WechatTicketStatusPending,
		Code:        shortCode,
		QRImageData: qrImage,
		ExpiresAt:   expiresAt,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	if err := s.repo.CreateWechatQRTicket(ticket); err != nil {
		return nil, fmt.Errorf("创建微信登录票据失败: %w", err)
	}

	isManual := manual || qrImage == ""
	return &WechatQRTicketResponse{
		Ticket:    ticketID,
		Code:      shortCode,
		QRImage:   qrImage,
		Manual:    isManual,
		Action:    action,
		ExpiresAt: expiresAt.Format(time.RFC3339),
	}, nil
}

type WechatTicketStatusResult struct {
	Status     string    `json:"status"`
	Action     string    `json:"action"`
	Session    string    `json:"session,omitempty"`
	User       *AuthUser `json:"user,omitempty"`
	MaxAgeSecs int       `json:"maxAgeSecs,omitempty"`
	Error      string    `json:"error,omitempty"`
}

func (s *Service) GetWechatQRTicketStatus(ticketID string) (*WechatTicketStatusResult, error) {
	ticket, err := s.repo.WechatQRTicket(ticketID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return &WechatTicketStatusResult{Status: model.WechatTicketStatusExpired}, nil
		}
		return nil, err
	}

	if time.Now().After(ticket.ExpiresAt) && ticket.Status == model.WechatTicketStatusPending {
		ticket.Status = model.WechatTicketStatusExpired
		_ = s.repo.UpdateWechatQRTicket(ticket)
	}

	res := &WechatTicketStatusResult{
		Status: ticket.Status,
		Action: ticket.Action,
		Error:  ticket.ErrorMessage,
	}

	if ticket.Status == model.WechatTicketStatusConfirmed && ticket.Action == model.WechatTicketActionLogin && ticket.UserID != "" {
		user, err := s.repo.User(ticket.UserID)
		if err == nil && user != nil {
			authUser, _ := s.PublicAuthUser(user)
			res.User = &authUser
			res.Session = ticket.SessionToken
			res.MaxAgeSecs = 30 * 86400
		}
	}

	return res, nil
}

type WechatConfirmResult struct {
	Success bool   `json:"success"`
	Action  string `json:"action"`
	Message string `json:"message"`
}

func (s *Service) ConfirmWechatTicket(ticketID, manualCode, jsCode string) (*WechatConfirmResult, error) {
	wechatConfirmMu.Lock()
	defer wechatConfirmMu.Unlock()

	var ticket *model.WechatQRTicket
	var err error

	ticketID = strings.TrimSpace(ticketID)
	manualCode = strings.ToUpper(strings.TrimSpace(manualCode))
	jsCode = strings.TrimSpace(jsCode)

	if ticketID != "" {
		ticket, err = s.repo.WechatQRTicket(ticketID)
	} else if manualCode != "" {
		ticket, err = s.repo.WechatQRTicketByCode(manualCode)
	} else {
		return nil, kernel.BadAuthRequest("缺少 ticket 或登录码")
	}

	if err != nil || ticket == nil {
		return nil, kernel.BadAuthRequest("登录票据不存在或已过期，请刷新二维码")
	}

	if time.Now().After(ticket.ExpiresAt) {
		ticket.Status = model.WechatTicketStatusExpired
		_ = s.repo.UpdateWechatQRTicket(ticket)
		return nil, kernel.BadAuthRequest("二维码已过期，请刷新后重试")
	}

	if ticket.Status == model.WechatTicketStatusConfirmed {
		return &WechatConfirmResult{Success: true, Action: ticket.Action, Message: "已授权成功"}, nil
	}
	if ticket.Status != model.WechatTicketStatusPending {
		return nil, kernel.BadAuthRequest("二维码状态已变更，请刷新")
	}

	enabled, appID, secret, _, _, manual := s.wechatLoginConfig()
	if !enabled || appID == "" {
		return nil, kernel.BadAuthRequest("微信扫码登录尚未启用")
	}

	var openID, unionID string
	if secret != "" && jsCode != "" && !strings.HasPrefix(jsCode, "mock_") {
		wxSession, wxErr := exchangeCode2Session(appID, secret, jsCode)
		if wxErr != nil {
			// 防抖与幂等兜底：若前置并发请求已成功确认该票据，直接返回成功，避免微信 code 二次兑换报 40029
			if curTicket, curErr := s.repo.WechatQRTicket(ticket.ID); curErr == nil && curTicket.Status == model.WechatTicketStatusConfirmed {
				return &WechatConfirmResult{Success: true, Action: curTicket.Action, Message: "已授权成功"}, nil
			}
			ticket.Status = model.WechatTicketStatusFailed
			ticket.ErrorMessage = wxErr.Error()
			_ = s.repo.UpdateWechatQRTicket(ticket)
			return nil, kernel.BadAuthRequest(wxErr.Error())
		}
		openID = wxSession.OpenID
		unionID = wxSession.UnionID
	} else if manual || secret == "" || strings.HasPrefix(jsCode, "mock_") {
		// 联调/测试模式
		if jsCode == "" {
			jsCode = ticket.Code
		}
		openID = "mock_wx_openid_" + strings.TrimPrefix(jsCode, "mock_")
	} else {
		return nil, kernel.BadAuthRequest("缺少微信授权 code")
	}

	now := time.Now()
	ticket.OpenID = openID
	ticket.UnionID = unionID

	if ticket.Action == model.WechatTicketActionBind {
		if ticket.UserID == "" {
			return nil, kernel.BadAuthRequest("绑定请求缺少用户身份")
		}
		existing, err := s.repo.UserIdentity("wechat", openID)
		if err == nil && existing != nil && existing.UserID != ticket.UserID {
			ticket.Status = model.WechatTicketStatusFailed
			ticket.ErrorMessage = "该微信已绑定其他账号，无法重复绑定"
			_ = s.repo.UpdateWechatQRTicket(ticket)
			return nil, kernel.BadAuthRequest("该微信已绑定其他账号，无法重复绑定")
		}

		if existing == nil {
			identity := &model.UserIdentity{
				ID:        kernel.NewID(),
				UserID:    ticket.UserID,
				Provider:  "wechat",
				Subject:   openID,
				CreatedAt: now,
				UpdatedAt: now,
			}
			if err := s.repo.Save(identity); err != nil {
				return nil, err
			}
		}

		ticket.Status = model.WechatTicketStatusConfirmed
		ticket.ConfirmedAt = &now
		_ = s.repo.UpdateWechatQRTicket(ticket)
		return &WechatConfirmResult{Success: true, Action: "bind", Message: "绑定成功"}, nil
	}

	// 场景 1：未登录下的登录/直接注册
	identity, err := s.repo.UserIdentity("wechat", openID)
	var user *model.User
	if err == nil && identity != nil {
		user, err = s.repo.User(identity.UserID)
		if err != nil {
			return nil, err
		}
	} else {
		// 未找到绑定，直接注册建号
		shortID := openID
		if len(shortID) > 8 {
			shortID = shortID[len(shortID)-8:]
		}
		username := fmt.Sprintf("wx_%s", strings.ToLower(shortID))
		displayName := fmt.Sprintf("微信用户_%s", shortID)

		role := model.UserRoleUser
		if count, err := s.repo.UserCount(); err == nil && count == 0 {
			role = model.UserRoleAdmin
		}

		newUser := &model.User{
			ID:          kernel.NewID(),
			Username:    username,
			DisplayName: displayName,
			Role:        role,
			Status:      model.UserStatusActive,
			CreatedAt:   now,
			UpdatedAt:   now,
		}
		newIdentity := &model.UserIdentity{
			ID:        kernel.NewID(),
			UserID:    newUser.ID,
			Provider:  "wechat",
			Subject:   openID,
			CreatedAt: now,
			UpdatedAt: now,
		}

		if err := s.repo.CreateOAuthUser(newUser, newIdentity); err != nil {
			return nil, fmt.Errorf("创建微信用户失败: %w", err)
		}
		user = newUser
		_ = s.host.EnsureSignupBonus(user.ID)
	}

	if user.Status != model.UserStatusActive {
		ticket.Status = model.WechatTicketStatusFailed
		ticket.ErrorMessage = "账号已被禁用"
		_ = s.repo.UpdateWechatQRTicket(ticket)
		return nil, kernel.Forbidden("账号已被禁用")
	}

	event := NewLoginLog("wechat", "wechat_qr", LoginContext{IP: "", UserAgent: "Wechat MiniProgram"})
	loginLogUser(event, user)
	session, err := s.createAuthSession(user, event)
	if err != nil {
		return nil, err
	}

	ticket.Status = model.WechatTicketStatusConfirmed
	ticket.SessionToken = session.Session
	ticket.UserID = user.ID
	ticket.ConfirmedAt = &now
	_ = s.repo.UpdateWechatQRTicket(ticket)

	return &WechatConfirmResult{Success: true, Action: "login", Message: "登录成功"}, nil
}

func (s *Service) UnbindWechat(user *model.User) error {
	if user == nil {
		return kernel.Unauthorized("请先登录")
	}
	u, err := s.repo.User(user.ID)
	if err != nil {
		return err
	}
	hasPassword := u.PasswordHash != "" && !strings.HasPrefix(u.PasswordHash, "!")
	hasEmail := strings.TrimSpace(u.Email) != ""
	if !hasPassword && !hasEmail {
		return kernel.BadAuthRequest("为保障账号安全，请先在个人中心设置密码或绑定邮箱后再解绑微信")
	}

	return s.repo.UnbindUserIdentity(user.ID, "wechat")
}
