package app

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/platform"
)

type chatGPTPlanTestTransport func(*http.Request) (*http.Response, error)

func (f chatGPTPlanTestTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func newChatGPTPlanTestService(t *testing.T) (*Service, []*model.User) {
	t.Helper()
	s, db := newChannelModelTestService(t)
	if err := db.AutoMigrate(&model.AdminAuditEvent{}); err != nil {
		t.Fatal(err)
	}
	var err error
	s.coordinator, err = platform.NewCoordinator("sqlite")
	if err != nil {
		t.Fatal(err)
	}
	users := []*model.User{
		{ID: "alice", Username: "alice", Role: model.UserRoleUser, Status: model.UserStatusActive},
		{ID: "bob", Username: "bob", Role: model.UserRoleUser, Status: model.UserStatusActive},
		{ID: "admin", Username: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive},
	}
	for _, user := range users {
		if err := db.Create(user).Error; err != nil {
			t.Fatal(err)
		}
	}
	return s, users
}

func setChatGPTPlanTestEnabled(t *testing.T, s *Service, admin *model.User, enabled bool) {
	t.Helper()
	features, err := s.FeatureAvailability()
	if err != nil {
		t.Fatal(err)
	}
	features.ChatGPTPlanEnabled = enabled
	if _, err := s.UpdateFeatureAvailability(admin, features.FeatureAvailability); err != nil {
		t.Fatal(err)
	}
}

func TestChatGPTPlanEncryptedUserStorageAndStaleWrite(t *testing.T) {
	s, users := newChatGPTPlanTestService(t)
	for _, user := range users[:2] {
		credentials := &chatGPTPlanCredentials{OwnerID: user.ID, AccessToken: "access-" + user.ID, RefreshToken: "refresh-" + user.ID, ExpiresAt: time.Now().Add(time.Hour)}
		if err := s.saveChatGPTPlanCredentials(credentials); err != nil {
			t.Fatal(err)
		}
		row, err := s.repo.SystemSetting(chatGPTPlanSettingKey(user.ID))
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(row.ValueJSON, credentials.AccessToken) || strings.Contains(row.ValueJSON, credentials.RefreshToken) {
			t.Fatal("plaintext token persisted")
		}
		status, err := s.ChatGPTPlanConnectionStatus(user)
		if err != nil || !status.Connected || status.Enabled {
			t.Fatalf("status = %+v, err=%v", status, err)
		}
		encoded, _ := json.Marshal(status)
		if strings.Contains(string(encoded), credentials.AccessToken) || strings.Contains(string(encoded), credentials.RefreshToken) {
			t.Fatal("status exposed token")
		}
	}
	if _, err := s.readChatGPTPlanCredentials(""); err == nil {
		t.Fatal("empty owner accepted")
	}
	if status, err := s.ChatGPTPlanConnectionStatus(users[2]); err != nil || status.Connected {
		t.Fatalf("administrator borrowed authorization: %+v %v", status, err)
	}
	first, _ := s.readChatGPTPlanCredentials(users[0].ID)
	stale := *first
	first.AccessToken = "new-access"
	if err := s.saveChatGPTPlanCredentials(first); err != nil {
		t.Fatal(err)
	}
	if err := s.saveChatGPTPlanCredentials(&stale); err == nil {
		t.Fatal("stale token overwrite accepted")
	}
	// Copying another user's encrypted row must still fail its decrypted owner check.
	row, _ := s.repo.SystemSetting(chatGPTPlanSettingKey(users[0].ID))
	row.Key = chatGPTPlanSettingKey(users[1].ID)
	if err := s.repo.SaveSystemSetting(row); err != nil {
		t.Fatal(err)
	}
	if _, err := s.readChatGPTPlanCredentials(users[1].ID); err == nil {
		t.Fatal("cross-user encrypted record accepted")
	}
}

func TestChatGPTPlanFeatureGateAndAdminControl(t *testing.T) {
	s, users := newChatGPTPlanTestService(t)
	features, err := s.FeatureAvailability()
	if err != nil || features.ChatGPTPlanEnabled {
		t.Fatal("personal plan must default off")
	}
	features.ChatGPTPlanEnabled = true
	if _, err := s.UpdateFeatureAvailability(users[0], features.FeatureAvailability); err == nil {
		t.Fatal("ordinary user enabled global feature")
	}
	if _, err := s.StartChatGPTPlanConnection(users[0]); err == nil {
		t.Fatal("disabled authorization started")
	}
	if _, err := s.ListChatGPTPlanModels(context.Background(), users[0]); err == nil {
		t.Fatal("disabled model discovery allowed")
	}
	if _, err := s.AddChatGPTPlanModel(context.Background(), users[0], "test-model"); err == nil {
		t.Fatal("disabled model import allowed")
	}
	if _, err := s.chatGPTPlanAccessToken(users[0].ID); err == nil {
		t.Fatal("disabled inference allowed")
	}
	setChatGPTPlanTestEnabled(t, s, users[2], true)
	if err := s.requireChatGPTPlanUser(users[0], true); err != nil {
		t.Fatal(err)
	}
	if err := s.repo.SaveSystemSetting(&model.SystemSetting{Key: featureAvailabilitySettingKey, ValueJSON: `{"customChannelsEnabled":true}`}); err != nil {
		t.Fatal(err)
	}
	if enabled, err := s.FeatureEnabled(FeatureChatGPTPlan); err != nil || enabled {
		t.Fatal("legacy settings enabled new feature")
	}
}

// Exercise the actual loopback callback and OIDC signature/nonce verification
// with a local transport; no real credentials or external service are used.
func TestChatGPTPlanTwoUserOAuthModelsAndExecution(t *testing.T) {
	s, users := newChatGPTPlanTestService(t)
	setChatGPTPlanTestEnabled(t, s, users[2], true)
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	attempts := map[string]url.Values{}
	s.chatGPTPlanHTTPClient = &http.Client{Transport: chatGPTPlanTestTransport(func(r *http.Request) (*http.Response, error) {
		var payload any
		switch r.URL.Path {
		case "/.well-known/openid-configuration":
			payload = map[string]any{"issuer": chatGPTPlanIssuer, "jwks_uri": chatGPTPlanIssuer + "/jwks", "id_token_signing_alg_values_supported": []string{"RS256"}}
		case "/jwks":
			payload = map[string]any{"keys": []any{map[string]any{"kty": "RSA", "kid": "test", "alg": "RS256", "use": "sig", "n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()), "e": "AQAB"}}}
		case "/api/accounts/oauth/token":
			if err := r.ParseForm(); err != nil {
				t.Fatal(err)
			}
			id := r.Form.Get("code")
			params := attempts[id]
			if params == nil {
				t.Fatalf("unknown authorization code %q", id)
			}
			challenge := sha256.Sum256([]byte(r.Form.Get("code_verifier")))
			if params.Get("code_challenge") != base64.RawURLEncoding.EncodeToString(challenge[:]) || r.Form.Get("redirect_uri") != params.Get("redirect_uri") || r.Form.Get("client_id") != "client-"+id {
				t.Fatal("PKCE/client/callback mismatch")
			}
			claims, _ := json.Marshal(map[string]any{"iss": chatGPTPlanIssuer, "aud": "client-" + id, "sub": "subject-" + id, "email": id + "@example.test", "nonce": params.Get("nonce"), "exp": time.Now().Add(time.Hour).Unix(), "iat": time.Now().Unix()})
			unsigned := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"RS256","kid":"test"}`)) + "." + base64.RawURLEncoding.EncodeToString(claims)
			digest := sha256.Sum256([]byte(unsigned))
			sig, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, digest[:])
			if err != nil {
				t.Fatal(err)
			}
			payload = map[string]any{"access_token": "access-" + id, "refresh_token": "refresh-" + id, "id_token": unsigned + "." + base64.RawURLEncoding.EncodeToString(sig), "scope": "openid offline_access resource.invoke chatgpt.tokens.use.direct", "expires_in": 3600}
		case "/v1/models":
			id := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer access-")
			if id != "alice" && id != "bob" {
				t.Fatal("wrong model-directory credential")
			}
			payload = map[string]any{"models": []any{map[string]string{"slug": "model-" + id, "display_name": "Personal model", "visibility": "list"}}}
		default:
			t.Fatalf("unexpected upstream path %q", r.URL.Path)
		}
		body, _ := json.Marshal(payload)
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(string(body))), Request: r}, nil
	})}
	var channels []string
	for _, user := range users[:2] {
		authorize, err := s.StartChatGPTPlanConnection(user)
		if err != nil {
			t.Fatal(err)
		}
		u, _ := url.Parse(authorize)
		params := u.Query()
		attempts[user.ID] = params
		callback, _ := url.Parse(params.Get("redirect_uri"))
		query := url.Values{"state": {params.Get("state")}, "code": {user.ID}, "client_id": {"client-" + user.ID}}
		callback.RawQuery = query.Encode()
		response, err := http.Get(callback.String())
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(response.Body)
		_ = response.Body.Close()
		if response.StatusCode != 200 || !strings.Contains(string(body), "授权成功") {
			t.Fatalf("callback failed: %d %s", response.StatusCode, body)
		}
		status, err := s.ChatGPTPlanConnectionStatus(user)
		if err != nil || !status.Connected || status.Email != user.ID+"@example.test" {
			t.Fatalf("own status: %+v %v", status, err)
		}
		channels = append(channels, status.ChannelID)
		if _, err := s.AddChatGPTPlanModel(context.Background(), user, "model-"+user.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := s.AddChatGPTPlanModel(context.Background(), user, "model-other"); err == nil {
			t.Fatal("model outside own upstream catalog accepted")
		}
	}
	if channels[0] == channels[1] {
		t.Fatal("users shared a channel")
	}
	for _, user := range users {
		access, err := s.userGroupAccessForUser(user)
		if err != nil {
			t.Fatal(err)
		}
		for i, channelID := range channels {
			own := user.ID == users[i].ID
			if access.allowsChannel(channelID) != own {
				t.Fatalf("channel isolation for %s", user.ID)
			}
			input := map[string]any{"config": map[string]any{"channelId": channelID, "channelModelKey": "model-" + users[i].ID, "model": "model-" + users[i].ID}}
			if _, err := s.resolveSystemChannelModelSelection(access, input, "text", ""); (err == nil) != own {
				t.Fatalf("task admission for %s: %v", user.ID, err)
			}
			config := providerConfig{ChannelID: channelID, Model: "model-" + users[i].ID, ChannelModelKey: "model-" + users[i].ID}
			resolved, err := s.resolveProviderConfig(config, &model.Task{UserID: user.ID})
			if (err == nil) != own {
				t.Fatalf("execution for %s: %v", user.ID, err)
			}
			if own && resolved.APIKey != "access-"+user.ID {
				t.Fatal("execution borrowed another credential")
			}
		}
	}
	rows, total, err := s.repo.AdminSystemChannels("", "", 20, 0)
	if err != nil || total != 0 || len(rows) != 0 {
		t.Fatal("private channels leaked to global admin catalog")
	}
	if _, err := s.repo.AdminSystemChannel(channels[0]); err == nil {
		t.Fatal("admin editing exposed private channel")
	}
	setChatGPTPlanTestEnabled(t, s, users[2], false)
	if _, err := s.resolveProviderConfig(providerConfig{ChannelID: channels[0], Model: "model-alice"}, &model.Task{UserID: "alice"}); err == nil {
		t.Fatal("queued task used disabled feature")
	}
	access, err := s.userGroupAccessForUser(users[0])
	if err != nil || access.allowsChannel(channels[0]) {
		t.Fatal("disabled channel remains visible")
	}
}

func TestChatGPTPlanDisconnectInvalidatesPendingCallbackAndRefresh(t *testing.T) {
	s, users := newChatGPTPlanTestService(t)
	setChatGPTPlanTestEnabled(t, s, users[2], true)
	creds := &chatGPTPlanCredentials{OwnerID: "alice", AttemptID: "old-state", AccessToken: "old-access", RefreshToken: "old-refresh", ClientID: "client-alice", ExpiresAt: time.Now()}
	if err := s.saveChatGPTPlanCredentials(creds); err != nil {
		t.Fatal(err)
	}
	calls := 0
	s.chatGPTPlanHTTPClient = &http.Client{Transport: chatGPTPlanTestTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.String() != chatGPTPlanToken {
			return nil, fmt.Errorf("remote revocation unavailable")
		}
		if err := r.ParseForm(); err != nil {
			t.Fatal(err)
		}
		if r.Form.Get("refresh_token") != "old-refresh" {
			t.Fatal("refresh used another registration")
		}
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`{"access_token":"renewed-access","expires_in":3600}`)), Request: r}, nil
	})}
	if token, err := s.chatGPTPlanAccessToken("alice"); err != nil || token != "renewed-access" {
		t.Fatalf("refresh = %q %v", token, err)
	}
	refreshed, _ := s.readChatGPTPlanCredentials("alice")
	if refreshed.RefreshToken != "old-refresh" {
		t.Fatal("refresh token lost when provider omitted rotation")
	}
	stale := *refreshed
	setChatGPTPlanTestEnabled(t, s, users[2], false)
	if confirmed, err := s.DisconnectChatGPTPlan(users[0]); err != nil || confirmed {
		t.Fatalf("disconnect when disabled = %v %v", confirmed, err)
	}
	if err := s.saveChatGPTPlanCredentials(&stale); err == nil {
		t.Fatal("late refresh restored disconnected credentials")
	}
	setChatGPTPlanTestEnabled(t, s, users[2], true)
	before := calls
	if err := s.completeChatGPTPlanConnection(context.Background(), users[0], "old-state", "client-alice", "host", "nonce", "verifier", "http://127.0.0.1/auth/callback", url.Values{"state": {"old-state"}, "code": {"old-code"}}); err == nil {
		t.Fatal("stale callback restored authorization")
	}
	if calls != before {
		t.Fatal("stale callback reached token exchange")
	}
	if status, err := s.ChatGPTPlanConnectionStatus(users[0]); err != nil || status.Connected {
		t.Fatal("disconnect did not persist")
	}
}
