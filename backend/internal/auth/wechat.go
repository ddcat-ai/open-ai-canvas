package auth

// 微信服务号「关注即登录」。
//
// 与 Linux.do 的 OAuth 不同，微信这条链路没有回调 code：用户扫码后，微信服务器
// 把 subscribe / SCAN 事件推送到我们在公众平台登记的服务器地址，我们从事件里
// 拿到 openid，再反查是哪一次扫码（scene_str）。因此：
//
//	生成二维码  -> cgi-bin/qrcode/create 拿 ticket -> showqrcode 出图
//	扫码事件    -> POST /wechat/callback（XML）-> 写 OAuthState.ConfirmedUserID
//	前端轮询    -> /auth/wechat/status 看到 confirmed 后建会话
//
// 零迁移约定：不新增数据库列。确认态借用 OAuthState.NextPath，格式为
// "__wx__:<userID>"，由 wechatConfirmedUserID 解析。这样官方升级到新的 schema
// 版本时不会和我们的迁移 checksum 冲突。

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/outbound"

	"gorm.io/gorm"
)

const wechatSettingKey = "wechat_official_login"

// 微信服务端接口基址。抽成变量便于测试替换。
var wechatAPIBase = "https://api.weixin.qq.com"

const (
	wechatProvider = "wechat"
	// 确认态在 NextPath 里的前缀。见文件头「零迁移约定」。
	wechatConfirmedPrefix = "__wx__:"
	// 微信临时二维码 scene_str 上限 64 字符，这里留出余量。
	wechatSceneLen = 32
	// access_token 提前刷新的安全窗口。
	wechatTokenRefreshAhead = 5 * time.Minute
	// 事件回调 body 上限，防止超大 XML 打爆内存。
	wechatEventBodyLimit = 32 << 10
)

// ---------- 配置 ----------

type WeChatSettingRequest struct {
	Enabled        bool   `json:"enabled"`
	AppID          string `json:"appId"`
	AppSecret      string `json:"appSecret"`
	Token          string `json:"token"`
	EncodingAESKey string `json:"encodingAESKey"`
	EncryptMode    string `json:"encryptMode"`
	QRExpireSecs   int    `json:"qrExpireSecs"`
}

type PublicWeChatSetting struct {
	Enabled          bool      `json:"enabled"`
	AppID            string    `json:"appId"`
	HasAppSecret     bool      `json:"hasAppSecret"`
	Token            string    `json:"token"`
	EncodingAESKey   string    `json:"encodingAesKey"`
	EncryptMode      string    `json:"encryptMode"`
	QRExpireSecs     int       `json:"qrExpireSecs"`
	CallbackURL      string    `json:"callbackUrl"`
	UpdatedBy        string    `json:"updatedBy"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

type wechatSettingValue struct {
	Enabled        bool   `json:"enabled"`
	AppID          string `json:"appId"`
	AppSecret      string `json:"appSecret"`
	Token          string `json:"token"`
	EncodingAESKey string `json:"encodingAesKey"`
	EncryptMode    string `json:"encryptMode"`
	QRExpireSecs   int    `json:"qrExpireSecs"`
}

func normalizeWeChatSetting(value wechatSettingValue) wechatSettingValue {
	value.AppID = strings.TrimSpace(value.AppID)
	value.AppSecret = strings.TrimSpace(value.AppSecret)
	value.Token = strings.TrimSpace(value.Token)
	value.EncodingAESKey = strings.TrimSpace(value.EncodingAESKey)
	value.EncryptMode = strings.ToLower(strings.TrimSpace(value.EncryptMode))
	switch value.EncryptMode {
	case "compatible", "safe":
	default:
		value.EncryptMode = "plain"
	}
	if value.QRExpireSecs < 60 || value.QRExpireSecs > 2592000 {
		value.QRExpireSecs = 300
	}
	return value
}

func validateWeChatSetting(value wechatSettingValue) error {
	if !value.Enabled {
		return nil
	}
	if value.AppID == "" || value.AppSecret == "" || value.Token == "" {
		return kernel.BadAuthRequest("启用微信登录前请完整填写 AppID、AppSecret 和 Token")
	}
	if len(value.Token) > 32 {
		return kernel.BadAuthRequest("微信服务器配置的 Token 不能超过 32 位")
	}
	if value.EncryptMode != "plain" && len(value.EncodingAESKey) != 43 {
		return kernel.BadAuthRequest("兼容/安全模式需要 43 位 EncodingAESKey")
	}
	return nil
}

func (s *Service) readWeChatSetting() (*model.SystemSetting, wechatSettingValue, error) {
	setting, err := s.repo.SystemSetting(wechatSettingKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, normalizeWeChatSetting(wechatSettingValue{}), nil
	}
	if err != nil {
		return nil, wechatSettingValue{}, err
	}
	value := wechatSettingValue{}
	if strings.TrimSpace(setting.ValueJSON) != "" {
		if err := json.Unmarshal([]byte(setting.ValueJSON), &value); err != nil {
			return nil, wechatSettingValue{}, errors.New("微信登录配置格式无效")
		}
	}
	value.AppSecret, err = s.host.DecryptSecret(value.AppSecret)
	if err != nil {
		return nil, wechatSettingValue{}, err
	}
	return setting, normalizeWeChatSetting(value), nil
}

func publicWeChatSetting(setting *model.SystemSetting, value wechatSettingValue, callbackURL string) *PublicWeChatSetting {
	result := &PublicWeChatSetting{
		Enabled: value.Enabled, AppID: value.AppID, HasAppSecret: value.AppSecret != "",
		Token: value.Token, EncodingAESKey: value.EncodingAESKey, EncryptMode: value.EncryptMode,
		QRExpireSecs: value.QRExpireSecs, CallbackURL: callbackURL,
	}
	if setting != nil {
		result.UpdatedBy = setting.UpdatedBy
		result.CreatedAt = setting.CreatedAt
		result.UpdatedAt = setting.UpdatedAt
	}
	return result
}

func (s *Service) AdminWeChatSetting(actor *model.User) (*PublicWeChatSetting, error) {
	if err := s.host.RequireAdmin(actor); err != nil {
		return nil, err
	}
	setting, value, err := s.readWeChatSetting()
	if err != nil {
		return nil, err
	}
	return publicWeChatSetting(setting, value, s.WeChatCallbackURL()), nil
}

func (s *Service) UpdateWeChatSetting(actor *model.User, req WeChatSettingRequest) (*PublicWeChatSetting, error) {
	if err := s.host.RequireAdmin(actor); err != nil {
		return nil, err
	}
	currentSetting, current, err := s.readWeChatSetting()
	if err != nil {
		return nil, err
	}
	next := normalizeWeChatSetting(wechatSettingValue{
		Enabled: req.Enabled, AppID: req.AppID, AppSecret: req.AppSecret, Token: req.Token,
		EncodingAESKey: req.EncodingAESKey, EncryptMode: req.EncryptMode, QRExpireSecs: req.QRExpireSecs,
	})
	// 前端不回传密钥明文，留空表示保留原值。
	if next.AppSecret == "" {
		next.AppSecret = current.AppSecret
	}
	if err := validateWeChatSetting(next); err != nil {
		return nil, err
	}
	stored := next
	stored.AppSecret, err = s.host.EncryptSecret(next.AppSecret)
	if err != nil {
		return nil, err
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
	// 配置变更后旧 token 可能属于另一个 AppID，必须丢弃缓存。
	s.invalidateWeChatToken()
	return publicWeChatSetting(&setting, next, s.WeChatCallbackURL()), nil
}

func (s *Service) WeChatEnabled() bool {
	_, setting, err := s.readWeChatSetting()
	return err == nil && setting.Enabled && setting.AppID != "" && setting.AppSecret != ""
}

// WeChatCallbackURL 返回需要在公众平台登记的服务器地址。
func (s *Service) WeChatCallbackURL() string {
	base := strings.TrimRight(strings.TrimSpace(s.host.PublicBaseURL()), "/")
	if base == "" {
		return "/wechat/callback"
	}
	return base + "/wechat/callback"
}

// ---------- access_token 缓存 ----------
//
// 微信同一 AppID 的 access_token 是全局单例：重新获取会让旧 token 失效。
// 并发下若不加锁，会出现「刚拿到就被另一个请求刷掉」的间歇性 40001。

type wechatTokenState struct {
	mu        sync.Mutex
	token     string
	expiresAt time.Time
	appID     string
}

func (s *Service) invalidateWeChatToken() {
	s.wechatToken.mu.Lock()
	s.wechatToken.token = ""
	s.wechatToken.expiresAt = time.Time{}
	s.wechatToken.appID = ""
	s.wechatToken.mu.Unlock()
}

func (s *Service) wechatAccessToken(ctx context.Context, setting wechatSettingValue) (string, error) {
	cache := &s.wechatToken
	cache.mu.Lock()
	defer cache.mu.Unlock()
	now := time.Now()
	if cache.token != "" && cache.appID == setting.AppID && now.Add(wechatTokenRefreshAhead).Before(cache.expiresAt) {
		return cache.token, nil
	}
	endpoint := fmt.Sprintf("%s/cgi-bin/token?grant_type=client_credential&appid=%s&secret=%s",
		wechatAPIBase, url.QueryEscape(setting.AppID), url.QueryEscape(setting.AppSecret))
	body, err := wechatGet(ctx, endpoint)
	if err != nil {
		return "", err
	}
	var payload struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
		ErrCode     int    `json:"errcode"`
		ErrMsg      string `json:"errmsg"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return "", errors.New("微信 access_token 响应格式无效")
	}
	if payload.AccessToken == "" {
		return "", fmt.Errorf("获取微信 access_token 失败：%d %s", payload.ErrCode, payload.ErrMsg)
	}
	if payload.ExpiresIn <= 0 {
		payload.ExpiresIn = 7200
	}
	cache.token = payload.AccessToken
	cache.expiresAt = now.Add(time.Duration(payload.ExpiresIn) * time.Second)
	cache.appID = setting.AppID
	return cache.token, nil
}

func wechatGet(ctx context.Context, endpoint string) ([]byte, error) {
	if _, err := outbound.ValidateOutboundURL(endpoint); err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	resp, err := outbound.OutboundHTTPClient(15 * time.Second).Do(req)
	if err != nil {
		return nil, fmt.Errorf("微信接口请求失败：%w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("微信接口返回 HTTP %d", resp.StatusCode)
	}
	return body, nil
}

func wechatPostJSON(ctx context.Context, endpoint string, payload any) ([]byte, error) {
	if _, err := outbound.ValidateOutboundURL(endpoint); err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(encoded))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	resp, err := outbound.OutboundHTTPClient(15 * time.Second).Do(req)
	if err != nil {
		return nil, fmt.Errorf("微信接口请求失败：%w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("微信接口返回 HTTP %d", resp.StatusCode)
	}
	return body, nil
}

// ---------- 生成二维码 ----------

type WeChatQRCode struct {
	LoginToken string `json:"loginToken"`
	QRCodeURL  string `json:"qrCodeUrl"`
	ExpiresIn  int    `json:"expiresIn"`
	Next       string `json:"next"`
}

func (s *Service) BeginWeChatLogin(ctx context.Context, nextPath string, acceptedTerms bool) (*WeChatQRCode, error) {
	count, err := s.repo.UserCount()
	if err != nil {
		return nil, err
	}
	if count == 0 {
		return nil, kernel.Forbidden("请先创建本地管理员账号，再开放微信登录")
	}
	_, setting, err := s.readWeChatSetting()
	if err != nil {
		return nil, err
	}
	if !setting.Enabled {
		return nil, kernel.Forbidden("微信登录尚未启用")
	}
	token, err := s.wechatAccessToken(ctx, setting)
	if err != nil {
		return nil, err
	}
	scene := RandomToken()
	if len(scene) > wechatSceneLen {
		scene = scene[:wechatSceneLen]
	}
	expiresIn := setting.QRExpireSecs
	request := map[string]any{
		"expire_seconds": expiresIn,
		"action_name":    "QR_STR_SCENE",
		"action_info":    map[string]any{"scene": map[string]any{"scene_str": scene}},
	}
	endpoint := fmt.Sprintf("%s/cgi-bin/qrcode/create?access_token=%s", wechatAPIBase, url.QueryEscape(token))
	body, err := wechatPostJSON(ctx, endpoint, request)
	if err != nil {
		return nil, err
	}
	var payload struct {
		Ticket  string `json:"ticket"`
		ErrCode int    `json:"errcode"`
		ErrMsg  string `json:"errmsg"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, errors.New("微信二维码响应格式无效")
	}
	if payload.Ticket == "" {
		if payload.ErrCode == 40001 || payload.ErrCode == 42001 {
			// token 被外部刷新，丢弃缓存让下次重新获取。
			s.invalidateWeChatToken()
		}
		return nil, fmt.Errorf("生成微信二维码失败：%d %s", payload.ErrCode, payload.ErrMsg)
	}
	record := &model.OAuthState{
		ID: kernel.NewID(), Provider: wechatProvider, StateHash: HashToken(scene),
		NextPath: safeOAuthNext(nextPath), AcceptedTerms: acceptedTerms,
		ExpiresAt: time.Now().Add(time.Duration(expiresIn) * time.Second),
	}
	if err := s.repo.CreateOAuthState(record); err != nil {
		return nil, err
	}
	return &WeChatQRCode{
		LoginToken: scene,
		QRCodeURL:  "https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=" + url.QueryEscape(payload.Ticket),
		ExpiresIn:  expiresIn,
		Next:       record.NextPath,
	}, nil
}

// ---------- 轮询状态 ----------

type WeChatLoginStatus struct {
	Status string          `json:"status"` // pending | confirmed | expired
	User   *AuthUser       `json:"user,omitempty"`
	Next   string          `json:"next,omitempty"`
	Session *AuthSessionResult `json:"-"`
}

func (s *Service) WeChatLoginStatus(ctx context.Context, loginToken string, contexts ...LoginContext) (*WeChatLoginStatus, error) {
	loginToken = strings.TrimSpace(loginToken)
	if loginToken == "" {
		return nil, kernel.BadAuthRequest("缺少登录凭证")
	}
	state, err := s.repo.OAuthStateByHash(wechatProvider, HashToken(loginToken))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return &WeChatLoginStatus{Status: "expired"}, nil
	}
	if err != nil {
		return nil, err
	}
	if state.UsedAt != nil {
		return &WeChatLoginStatus{Status: "expired"}, nil
	}
	userID := wechatConfirmedUserID(state.NextPath)
	if userID == "" {
		if time.Now().After(state.ExpiresAt) {
			return &WeChatLoginStatus{Status: "expired"}, nil
		}
		return &WeChatLoginStatus{Status: "pending"}, nil
	}
	// 扫码已确认：消费 state 并建立会话。放在轮询侧而不是事件回调里，
	// 是因为微信要求事件回调 5 秒内返回，建会话涉及多次写库。
	consumed, err := s.repo.ConsumeOAuthState(wechatProvider, HashToken(loginToken))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return &WeChatLoginStatus{Status: "expired"}, nil
	}
	if err != nil {
		return nil, err
	}
	user, err := s.repo.User(wechatConfirmedUserID(consumed.NextPath))
	if err != nil {
		return nil, err
	}
	if user.Status != model.UserStatusActive {
		return nil, kernel.Forbidden("该账号已被禁用")
	}
	if err := s.host.EnsureSignupBonus(user.ID); err != nil {
		return nil, err
	}
	now := time.Now()
	if err := s.repo.UpdateUserLoginTime(user.ID, now); err != nil {
		return nil, err
	}
	var context LoginContext
	if len(contexts) > 0 {
		context = contexts[0]
	}
	event := NewLoginLog(wechatProvider, "login", context)
	loginLogUser(event, user)
	session, err := s.createAuthSession(user, event)
	if err != nil {
		return nil, err
	}
	return &WeChatLoginStatus{
		Status:  "confirmed",
		User:    &session.User,
		Next:    safeOAuthNext(wechatOriginalNext(consumed.NextPath)),
		Session: session,
	}, nil
}

// ---------- 事件回调 ----------

// VerifyWeChatSignature 处理公众平台「服务器配置」的 URL 校验。
// 微信用 sha1(sort(token, timestamp, nonce) 拼接) 与 signature 比对。
func (s *Service) VerifyWeChatSignature(signature, timestamp, nonce, echostr string) (string, error) {
	_, setting, err := s.readWeChatSetting()
	if err != nil {
		return "", err
	}
	if !setting.Enabled || setting.Token == "" {
		return "", kernel.Forbidden("微信登录尚未启用")
	}
	if !wechatSignatureValid(setting.Token, signature, timestamp, nonce) {
		return "", kernel.Forbidden("微信签名校验失败")
	}
	return echostr, nil
}

func wechatSignatureValid(token, signature, timestamp, nonce string) bool {
	parts := []string{token, timestamp, nonce}
	sort.Strings(parts)
	sum := sha1.Sum([]byte(strings.Join(parts, "")))
	expected := hex.EncodeToString(sum[:])
	return hmac.Equal([]byte(expected), []byte(strings.ToLower(strings.TrimSpace(signature))))
}

type wechatEventMessage struct {
	XMLName    xml.Name `xml:"xml"`
	ToUserName string   `xml:"ToUserName"`
	FromUserName string `xml:"FromUserName"`
	MsgType    string   `xml:"MsgType"`
	Event      string   `xml:"Event"`
	EventKey   string   `xml:"EventKey"`
	Ticket     string   `xml:"Ticket"`
}

// HandleWeChatEvent 解析事件推送。当前只关心扫码：
//   - Event="subscribe" 且 EventKey="qrscene_<scene>"：未关注用户扫码后关注
//   - Event="SCAN"      且 EventKey="<scene>"        ：已关注用户直接扫码
//
// 只写「已确认」标记，不建会话——见 WeChatLoginStatus 的注释。
func (s *Service) HandleWeChatEvent(ctx context.Context, raw []byte) error {
	if len(raw) > wechatEventBodyLimit {
		return kernel.BadAuthRequest("微信事件体过大")
	}
	_, setting, err := s.readWeChatSetting()
	if err != nil {
		return err
	}
	if !setting.Enabled {
		return kernel.Forbidden("微信登录尚未启用")
	}
	var message wechatEventMessage
	if err := xml.Unmarshal(raw, &message); err != nil {
		return kernel.BadAuthRequest("微信事件格式无效")
	}
	if message.MsgType != "event" {
		return nil
	}
	scene := strings.TrimSpace(message.EventKey)
	switch message.Event {
	case "subscribe":
		scene = strings.TrimPrefix(scene, "qrscene_")
	case "SCAN":
	default:
		return nil
	}
	openID := strings.TrimSpace(message.FromUserName)
	if scene == "" || openID == "" || strings.HasPrefix(scene, "qrscene_") {
		// 普通关注（非扫码）或场景值异常，不影响登录流程。
		return nil
	}
	return s.confirmWeChatScene(ctx, scene, openID)
}

func (s *Service) confirmWeChatScene(ctx context.Context, scene string, openID string) error {
	state, err := s.repo.OAuthStateByHash(wechatProvider, HashToken(scene))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		// 二维码已过期或已被消费，静默忽略。
		return nil
	}
	if err != nil {
		return err
	}
	if state.UsedAt != nil || time.Now().After(state.ExpiresAt) {
		return nil
	}
	if wechatConfirmedUserID(state.NextPath) != "" {
		return nil
	}
	user, err := s.wechatUserForOpenID(ctx, openID)
	if err != nil {
		return err
	}
	state.NextPath = wechatConfirmedPrefix + user.ID + "|" + wechatOriginalNext(state.NextPath)
	return s.repo.SaveOAuthState(state)
}

// wechatUserForOpenID 找到或创建 openid 对应的本地账号。
func (s *Service) wechatUserForOpenID(ctx context.Context, openID string) (*model.User, error) {
	identity, err := s.repo.UserIdentity(wechatProvider, openID)
	if err == nil {
		return s.repo.User(identity.UserID)
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	registrationEnabled, err := s.RegistrationEnabled()
	if err != nil {
		return nil, err
	}
	if !registrationEnabled {
		return nil, kernel.Forbidden("管理员未开放新用户注册")
	}
	policy, err := s.verificationPolicy()
	if err != nil {
		return nil, err
	}
	if policy.SMSAndEmailRegistration {
		return nil, kernel.Forbidden("平台要求短信和邮箱验证，请先通过注册页面创建账号；微信登录不能绕过双重验证")
	}
	profile := s.fetchWeChatUserInfo(ctx, openID)
	base := oauthUsernameSanitizer.ReplaceAllString(profile.Nickname, "_")
	base = strings.Trim(base, "_-")
	if len(base) < 3 {
		base = "wx_" + shortSubject(openID)
	}
	if len(base) > 24 {
		base = base[:24]
	}
	username := base
	if existing, err := s.repo.UserByUsername(username); err == nil && existing != nil {
		username = kernel.TruncateRunes(base, 23) + "_" + shortSubject(openID)
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	user := &model.User{
		ID: kernel.NewID(), Username: username, DisplayName: NormalizeDisplayName(profile.Nickname, username),
		Role: model.UserRoleUser, Status: model.UserStatusActive,
	}
	identity = &model.UserIdentity{
		ID: kernel.NewID(), UserID: user.ID, Provider: wechatProvider, Subject: openID,
		ProviderUsername: openID, AvatarURL: profile.AvatarURL,
	}
	if err := s.repo.CreateOAuthUser(user, identity); err != nil {
		return nil, err
	}
	return user, nil
}

type wechatUserProfile struct {
	Nickname  string
	AvatarURL string
}

// fetchWeChatUserInfo 尽力获取昵称头像。失败不阻断登录——微信 2021 年后
// 对未认证主体返回的昵称可能是空或占位符，不能依赖。
func (s *Service) fetchWeChatUserInfo(ctx context.Context, openID string) wechatUserProfile {
	_, setting, err := s.readWeChatSetting()
	if err != nil {
		return wechatUserProfile{}
	}
	token, err := s.wechatAccessToken(ctx, setting)
	if err != nil {
		return wechatUserProfile{}
	}
	endpoint := fmt.Sprintf("%s/cgi-bin/user/info?access_token=%s&openid=%s&lang=zh_CN",
		wechatAPIBase, url.QueryEscape(token), url.QueryEscape(openID))
	body, err := wechatGet(ctx, endpoint)
	if err != nil {
		return wechatUserProfile{}
	}
	var payload struct {
		Nickname  string `json:"nickname"`
		HeadImage string `json:"headimgurl"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return wechatUserProfile{}
	}
	return wechatUserProfile{Nickname: strings.TrimSpace(payload.Nickname), AvatarURL: strings.TrimSpace(payload.HeadImage)}
}

// ---------- 确认态编解码 ----------

func wechatConfirmedUserID(nextPath string) string {
	if !strings.HasPrefix(nextPath, wechatConfirmedPrefix) {
		return ""
	}
	rest := strings.TrimPrefix(nextPath, wechatConfirmedPrefix)
	if index := strings.IndexByte(rest, '|'); index >= 0 {
		return rest[:index]
	}
	return rest
}

func wechatOriginalNext(nextPath string) string {
	if !strings.HasPrefix(nextPath, wechatConfirmedPrefix) {
		return nextPath
	}
	rest := strings.TrimPrefix(nextPath, wechatConfirmedPrefix)
	if index := strings.IndexByte(rest, '|'); index >= 0 {
		return rest[index+1:]
	}
	return "/create"
}
