package auth

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

type wechatTestHost struct{ nopHost }

func (wechatTestHost) RequireAdmin(user *model.User) error {
	if user == nil || user.Role != model.UserRoleAdmin {
		return kernel.Forbidden("需要管理员权限")
	}
	return nil
}
func (wechatTestHost) EncryptSecret(value string) (string, error) { return "encrypted:" + value, nil }
func (wechatTestHost) DecryptSecret(value string) (string, error) {
	return strings.TrimPrefix(value, "encrypted:"), nil
}

type wechatTestTransport func(*http.Request) (*http.Response, error)

func (f wechatTestTransport) RoundTrip(req *http.Request) (*http.Response, error) { return f(req) }

func newWechatTestService(t *testing.T) (*Service, *gorm.DB, *model.User) {
	t.Helper()
	s, db := newRegistrationTestService(t)
	s.host = wechatTestHost{}
	u := &model.User{ID: "wechat-admin", Username: "wechat-admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	if err := db.Create(u).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpdateWechatSetting(u, WechatSettingRequest{Enabled: true, AppID: "wx1234567890123456", AppSecret: "private-app-secret", RedirectURL: "https://canvas.example.com/api/auth/wechat/callback"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpdateRegistrationSetting(u, RegistrationSettingRequest{Enabled: true, EmailVerificationRequired: boolPtr(false)}); err != nil {
		t.Fatal(err)
	}
	return s, db, u
}

func stubWechat(t *testing.T, s *Service, openid string) *int {
	t.Helper()
	calls := new(int)
	s.wechatHTTPClient = &http.Client{Transport: wechatTestTransport(func(req *http.Request) (*http.Response, error) {
		*calls++
		if req.Method != "GET" || req.URL.Scheme != "https" || req.URL.Host != "api.weixin.qq.com" {
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.Redacted())
		}
		var body string
		switch req.URL.Path {
		case "/sns/oauth2/access_token":
			if req.URL.Query().Get("secret") != "private-app-secret" || req.URL.Query().Get("grant_type") != "authorization_code" {
				t.Fatal("missing token credentials")
			}
			body = `{"access_token":"private-access-token","openid":"` + openid + `"}`
		case "/sns/userinfo":
			if req.URL.Query().Get("access_token") != "private-access-token" || req.URL.Query().Get("openid") != openid {
				t.Fatal("missing profile credentials")
			}
			body = `{"openid":"` + openid + `","nickname":"微信创作者","headimgurl":"https://avatar.example.com/image.jpg"}`
		default:
			t.Fatal("unexpected endpoint")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
	})}
	return calls
}

func beginWechatTestLogin(t *testing.T, s *Service) string {
	t.Helper()
	target, state, err := s.BeginWechatAuthorization(nil, "", "/projects?tab=mine", "login", true)
	if err != nil {
		t.Fatal(err)
	}
	u, err := url.Parse(target)
	if err != nil || u.Host != "open.weixin.qq.com" || u.Query().Get("appid") != "wx1234567890123456" || u.Query().Get("scope") != "snsapi_login" || u.Query().Get("state") != state {
		t.Fatalf("invalid authorization URL %q: %v", target, err)
	}
	return state
}

func TestWechatSettingsProtectSecretsAndValidateCallback(t *testing.T) {
	s, db, admin := newWechatTestService(t)
	var row model.SystemSetting
	db.First(&row, "key = ?", wechatSettingKey)
	if !strings.Contains(row.ValueJSON, "encrypted:private-app-secret") {
		t.Fatal("secret not encrypted")
	}
	public, err := s.AdminWechatSetting(admin)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(public)
	if strings.Contains(string(encoded), "private-app-secret") || !public.HasAppSecret {
		t.Fatal("public settings expose or lose secret")
	}
	if _, err := s.AdminWechatSetting(&model.User{Role: model.UserRoleUser}); err == nil {
		t.Fatal("non-admin read allowed")
	}
	if _, err := s.UpdateWechatSetting(&model.User{Role: model.UserRoleUser}, WechatSettingRequest{}); err == nil {
		t.Fatal("non-admin write allowed")
	}
	for _, callback := range []string{"http://canvas.example.com/api/auth/wechat/callback", "https://canvas.example.com/other", "https://canvas.example.com/api/auth/wechat/callback?next=evil", "https://user:pass@canvas.example.com/api/auth/wechat/callback"} {
		if _, err := s.UpdateWechatSetting(admin, WechatSettingRequest{Enabled: true, AppID: public.AppID, RedirectURL: callback}); err == nil {
			t.Fatalf("bad callback accepted %s", callback)
		}
	}
	if _, err := s.UpdateWechatSetting(admin, WechatSettingRequest{Enabled: true, AppID: public.AppID, RedirectURL: public.RedirectURL}); err != nil {
		t.Fatal(err)
	}
	_, retained, err := s.readWechatSetting()
	if err != nil || retained.AppSecret != "private-app-secret" {
		t.Fatal("blank secret did not retain saved value")
	}
}

func TestWechatRegistrationIsAtomicAndExistingIdentitySurvivesClosedRegistration(t *testing.T) {
	s, db, admin := newWechatTestService(t)
	calls := stubWechat(t, s, "openid-one")
	state := beginWechatTestLogin(t, s)
	pending, err := s.CompleteWechatLogin(context.Background(), state, "one-code", "", LoginContext{})
	if err != nil || pending.RegistrationToken == "" || pending.Session != nil {
		t.Fatalf("pending=%#v err=%v", pending, err)
	}
	var count int64
	db.Model(&model.User{}).Count(&count)
	if count != 1 {
		t.Fatal("callback created an unverified account")
	}
	if _, err := s.CompleteWechatLogin(context.Background(), state, "one-code", "", LoginContext{}); err == nil || *calls != 2 {
		t.Fatal("authorization state replay accepted")
	}
	if _, err := s.CompleteWechatRegistration(pending.RegistrationToken, RegisterRequest{}); err == nil {
		t.Fatal("missing agreement accepted")
	}
	result, err := s.CompleteWechatRegistration(pending.RegistrationToken, RegisterRequest{AcceptedTerms: true})
	if err != nil {
		t.Fatal(err)
	}
	if result.User.Role != model.UserRoleUser || result.User.PasswordHash != "" || result.User.IdentityProvider != "wechat" || result.User.AvatarURL == "" {
		t.Fatalf("unexpected user %#v", result.User)
	}
	identity, err := s.repo.UserIdentity("wechat", "wx1234567890123456:openid-one")
	if err != nil || identity.UserID != result.User.ID {
		t.Fatalf("identity=%#v err=%v", identity, err)
	}
	if _, err := s.CompleteWechatRegistration(pending.RegistrationToken, RegisterRequest{AcceptedTerms: true}); err == nil {
		t.Fatal("signup ticket replay accepted")
	}
	if _, err := s.UpdateRegistrationSetting(admin, RegistrationSettingRequest{Enabled: false}); err != nil {
		t.Fatal(err)
	}
	login, err := s.CompleteWechatLogin(context.Background(), beginWechatTestLogin(t, s), "another-code", "", LoginContext{})
	if err != nil || login.Session == nil || login.Session.User.ID != result.User.ID || login.Next != "/projects?tab=mine" {
		t.Fatalf("existing login=%#v err=%v", login, err)
	}
}

func TestWechatRegistrationRequiresVerificationAndRollsBackIdentityConflicts(t *testing.T) {
	s, db, admin := newWechatTestService(t)
	stubWechat(t, s, "openid-verified")
	if err := db.AutoMigrate(&model.AuthVerification{}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpdateRegistrationSetting(admin, RegistrationSettingRequest{Enabled: true, EmailVerificationRequired: boolPtr(true)}); err != nil {
		t.Fatal(err)
	}
	pending, err := s.CompleteWechatLogin(context.Background(), beginWechatTestLogin(t, s), "code", "", LoginContext{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CompleteWechatRegistration(pending.RegistrationToken, RegisterRequest{AcceptedTerms: true, Email: "creator@example.com"}); err == nil {
		t.Fatal("verification bypass accepted")
	}
	var delivered string
	s.SetMailSender(func(_ EmailSettingValue, _, _, body string) error { delivered = codeFromEmailBody(body); return nil })
	if err := s.SendRegistrationEmailCode("creator@example.com"); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.UserIdentity{ID: "conflict", UserID: admin.ID, Provider: "wechat", Subject: "wx1234567890123456:openid-verified"}).Error; err != nil {
		t.Fatal(err)
	}
	_, err = s.CompleteWechatRegistration(pending.RegistrationToken, RegisterRequest{AcceptedTerms: true, Email: "creator@example.com", EmailCode: delivered})
	if err == nil {
		t.Fatal("identity conflict accepted")
	}
	var count int64
	db.Model(&model.User{}).Count(&count)
	if count != 1 {
		t.Fatal("orphan account left after identity conflict")
	}
	if _, _, err := s.pendingWechatRegistration(pending.RegistrationToken); err != nil {
		t.Fatal("failed registration consumed pending state")
	}
	var code model.EmailVerificationCode
	db.First(&code, "email = ? AND purpose = ?", "creator@example.com", registrationEmailPurpose)
	if code.UsedAt != nil {
		t.Fatal("failed registration consumed verification")
	}
	if err := db.Delete(&model.UserIdentity{}, "id = ?", "conflict").Error; err != nil {
		t.Fatal(err)
	}
	result, err := s.CompleteWechatRegistration(pending.RegistrationToken, RegisterRequest{AcceptedTerms: true, Email: "creator@example.com", EmailCode: delivered})
	if err != nil {
		t.Fatal(err)
	}
	if result.User.EmailVerifiedAt == nil {
		t.Fatal("verified email not retained")
	}
}

func TestWechatBindingAndReauthenticationRequireOriginalSessionAndIdentity(t *testing.T) {
	s, db, u, cookie := newProfileTestService(t)
	if _, err := s.UpdateWechatSetting(u, WechatSettingRequest{Enabled: true, AppID: "wx1234567890123456", AppSecret: "private-app-secret", RedirectURL: "https://canvas.example.com/api/auth/wechat/callback"}); err != nil {
		t.Fatal(err)
	}
	stubWechat(t, s, "bound-openid")
	_, state, err := s.BeginWechatAuthorization(u, cookie, "", "bind", false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CompleteWechatLogin(context.Background(), state, "code", "session-two.token", LoginContext{}); err == nil {
		t.Fatal("binding accepted another session")
	}
	_, state, err = s.BeginWechatAuthorization(u, cookie, "", "bind", false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CompleteWechatLogin(context.Background(), state, "code", cookie, LoginContext{}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.BeginWechatAuthorization(u, cookie, "", "bind", false); err == nil {
		t.Fatal("existing binding could be replaced")
	}
	if err := db.Model(u).Update("password_hash", "").Error; err != nil {
		t.Fatal(err)
	}
	u.PasswordHash = ""
	_, state, err = s.BeginWechatAuthorization(u, cookie, "", "reauth", false)
	if err != nil {
		t.Fatal(err)
	}
	stubWechat(t, s, "wrong-openid")
	if _, err := s.CompleteWechatLogin(context.Background(), state, "code", cookie, LoginContext{}); err == nil {
		t.Fatal("wrong identity reauthenticated")
	}
	stubWechat(t, s, "bound-openid")
	_, state, err = s.BeginWechatAuthorization(u, cookie, "", "reauth", false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CompleteWechatLogin(context.Background(), state, "code", cookie, LoginContext{}); err != nil {
		t.Fatal(err)
	}
	if err := s.ChangeProfilePassword(u, cookie, ProfilePasswordRequest{NewPassword: "new-password"}); err != nil {
		t.Fatal(err)
	}
}

func TestWechatRejectsExpiredStateConfigChangesAndSanitizesUpstreamErrors(t *testing.T) {
	s, db, _ := newWechatTestService(t)
	calls := stubWechat(t, s, "one")
	state := beginWechatTestLogin(t, s)
	db.Model(&model.OAuthState{}).Where("state_hash = ?", HashToken(state)).Update("expires_at", time.Now().Add(-time.Minute))
	if _, err := s.CompleteWechatLogin(context.Background(), state, "code", "", LoginContext{}); err == nil || *calls != 0 {
		t.Fatal("expired authorization called upstream")
	}
	state = beginWechatTestLogin(t, s)
	s.wechatHTTPClient = &http.Client{Transport: wechatTestTransport(func(*http.Request) (*http.Response, error) {
		return nil, errors.New("secret=private-app-secret&access_token=private-access-token")
	})}
	if _, err := s.CompleteWechatLogin(context.Background(), state, "code", "", LoginContext{}); err == nil || strings.Contains(err.Error(), "private-") {
		t.Fatalf("unsafe error %v", err)
	}
	var logs []model.LoginLog
	db.Find(&logs)
	for _, entry := range logs {
		if strings.Contains(entry.Message, "private-") {
			t.Fatal("secret leaked to audit log")
		}
	}
}

func TestWechatRejectsChangedAppAndDoesNotCreateUsersThroughSharedLogin(t *testing.T) {
	s, db, admin := newWechatTestService(t)
	calls := stubWechat(t, s, "one")
	state := beginWechatTestLogin(t, s)
	if _, err := s.UpdateWechatSetting(admin, WechatSettingRequest{Enabled: true, AppID: "wx9876543210987654", AppSecret: "new-secret", RedirectURL: "https://canvas.example.com/api/auth/wechat/callback"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CompleteWechatLogin(context.Background(), state, "code", "", LoginContext{}); err == nil || *calls != 0 {
		t.Fatal("changed application accepted old authorization")
	}
	if _, err := s.finishOAuthLogin(&model.OAuthState{AcceptedTerms: true}, NewLoginLog("wechat", "login", LoginContext{}), oauthProfile{provider: "wechat", subject: "unbound"}, false); err == nil {
		t.Fatal("unbound identity bypassed registration completion")
	}
	var count int64
	db.Model(&model.User{}).Count(&count)
	if count != 1 {
		t.Fatal("shared login created an unverified user")
	}
}

func TestWechatBindingCannotTakeIdentityFromAnotherAccount(t *testing.T) {
	s, db, u, cookie := newProfileTestService(t)
	if _, err := s.UpdateWechatSetting(u, WechatSettingRequest{Enabled: true, AppID: "wx1234567890123456", AppSecret: "private-app-secret", RedirectURL: "https://canvas.example.com/api/auth/wechat/callback"}); err != nil {
		t.Fatal(err)
	}
	identity := &model.UserIdentity{ID: "other-identity", UserID: "another-user", Provider: "wechat", Subject: "wx1234567890123456:taken-openid"}
	if err := db.Create(identity).Error; err != nil {
		t.Fatal(err)
	}
	stubWechat(t, s, "taken-openid")
	_, state, err := s.BeginWechatAuthorization(u, cookie, "", "bind", false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CompleteWechatLogin(context.Background(), state, "code", cookie, LoginContext{}); err == nil {
		t.Fatal("another account identity was taken")
	}
	stored, err := s.repo.UserIdentity("wechat", identity.Subject)
	if err != nil || stored.UserID != identity.UserID {
		t.Fatal("identity owner changed")
	}
}

func TestWechatRejectsHTTP200BusinessErrorsAndProfileIdentityMismatch(t *testing.T) {
	for _, mismatch := range []bool{false, true} {
		t.Run(map[bool]string{false: "business-error", true: "identity-mismatch"}[mismatch], func(t *testing.T) {
			s, db, _ := newWechatTestService(t)
			s.wechatHTTPClient = &http.Client{Transport: wechatTestTransport(func(req *http.Request) (*http.Response, error) {
				body := `{"errcode":40029,"errmsg":"private-app-secret"}`
				if mismatch {
					if req.URL.Path == "/sns/oauth2/access_token" {
						body = `{"access_token":"token","openid":"one"}`
					} else {
						body = `{"openid":"two","nickname":"Other"}`
					}
				}
				return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body))}, nil
			})}
			if _, err := s.CompleteWechatLogin(context.Background(), beginWechatTestLogin(t, s), "code", "", LoginContext{}); err == nil || strings.Contains(err.Error(), "private-app-secret") {
				t.Fatalf("unexpected upstream error %v", err)
			}
			var count int64
			db.Model(&model.UserIdentity{}).Count(&count)
			if count != 0 {
				t.Fatal("invalid upstream identity persisted")
			}
		})
	}
}
