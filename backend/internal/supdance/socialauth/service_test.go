package socialauth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

type testRepo struct {
	db *gorm.DB
}

func newTestRepo(t *testing.T) *testRepo {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to open sqlite memory: %v", err)
	}
	if err := db.AutoMigrate(
		&model.SystemSetting{},
		&model.User{},
		&model.UserIdentity{},
		&model.OAuthState{},
		&model.AuthSession{},
		&model.CreditAccount{},
	); err != nil {
		t.Fatalf("failed to auto migrate: %v", err)
	}
	return &testRepo{db: db}
}

func (r *testRepo) SystemSetting(key string) (*model.SystemSetting, error) {
	var s model.SystemSetting
	err := r.db.First(&s, "key = ?", key).Error
	return &s, err
}

func (r *testRepo) SaveSystemSetting(setting *model.SystemSetting) error {
	var existing model.SystemSetting
	if err := r.db.First(&existing, "key = ?", setting.Key).Error; err == nil {
		existing.ValueJSON = setting.ValueJSON
		existing.UpdatedAt = time.Now()
		return r.db.Save(&existing).Error
	}
	return r.db.Create(setting).Error
}

func (r *testRepo) UserIdentity(provider string, subject string) (*model.UserIdentity, error) {
	var id model.UserIdentity
	err := r.db.First(&id, "provider = ? AND subject = ?", provider, subject).Error
	return &id, err
}

func (r *testRepo) UserIdentityForUser(userID string, provider string) (*model.UserIdentity, error) {
	var id model.UserIdentity
	err := r.db.First(&id, "user_id = ? AND provider = ?", userID, provider).Error
	return &id, err
}

func (r *testRepo) CreateOAuthState(state *model.OAuthState) error {
	return r.db.Create(state).Error
}

func (r *testRepo) ConsumeOAuthState(provider string, stateHash string) (*model.OAuthState, error) {
	var state model.OAuthState
	err := r.db.First(&state, "provider = ? AND state_hash = ? AND used_at IS NULL", provider, stateHash).Error
	if err != nil {
		return nil, err
	}
	now := time.Now()
	state.UsedAt = &now
	r.db.Save(&state)
	return &state, nil
}

func (r *testRepo) CreateOAuthUser(user *model.User, identity *model.UserIdentity) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(user).Error; err != nil {
			return err
		}
		if err := tx.Create(identity).Error; err != nil {
			return err
		}
		return tx.Create(&model.CreditAccount{UserID: user.ID}).Error
	})
}

func (r *testRepo) User(id string) (*model.User, error) {
	var u model.User
	err := r.db.First(&u, "id = ?", id).Error
	return &u, err
}

func (r *testRepo) UserByUsername(username string) (*model.User, error) {
	var u model.User
	err := r.db.First(&u, "username = ?", username).Error
	return &u, err
}

func (r *testRepo) UserByEmail(email string) (*model.User, error) {
	var u model.User
	err := r.db.First(&u, "email = ?", email).Error
	return &u, err
}

func (r *testRepo) UpdateUserLoginTime(userID string, t time.Time) error {
	return r.db.Model(&model.User{}).Where("id = ?", userID).Update("last_login_at", t).Error
}

func (r *testRepo) CreateAuthSession(session *model.AuthSession) error {
	return r.db.Create(session).Error
}

func (r *testRepo) Save(entity any) error {
	return r.db.Save(entity).Error
}

type testHost struct{}

func (h *testHost) EncryptSecret(p string) (string, error) { return "enc:" + p, nil }
func (h *testHost) DecryptSecret(c string) (string, error) { return strings.TrimPrefix(c, "enc:"), nil }
func (h *testHost) BrandName() string                     { return "SupDance" }
func (h *testHost) RequireAdmin(u *model.User) error       { return nil }
func (h *testHost) EnsureSignupBonus(u string) error       { return nil }

func TestGeoIPPartitioning(t *testing.T) {
	// 1. Test Mainland China IP (Figure 3 screenshot example: 124.90.230.101)
	req1 := httptest.NewRequest(http.MethodGet, "/api/auth/social/providers", nil)
	req1.Header.Set("X-Real-IP", "124.90.230.101")
	loc1 := ResolveIPRegion(req1, RegionCN)
	if loc1.Region != RegionCN {
		t.Fatalf("expected 124.90.230.101 to be cn, got %s", loc1.Region)
	}

	// 2. Test Hong Kong IP -> RegionIntl
	req2 := httptest.NewRequest(http.MethodGet, "/api/auth/social/providers", nil)
	req2.Header.Set("X-Real-IP", "218.102.10.20")
	loc2 := ResolveIPRegion(req2, RegionCN)
	if loc2.Region != RegionIntl {
		t.Fatalf("expected HK IP 218.102.10.20 to be intl, got %s", loc2.Region)
	}

	// 3. Test CF-IPCountry header
	req3 := httptest.NewRequest(http.MethodGet, "/api/auth/social/providers", nil)
	req3.Header.Set("CF-IPCountry", "US")
	loc3 := ResolveIPRegion(req3, RegionCN)
	if loc3.Region != RegionIntl {
		t.Fatalf("expected US to be intl, got %s", loc3.Region)
	}

	// 4. Test CF-IPCountry TW -> RegionIntl
	req4 := httptest.NewRequest(http.MethodGet, "/api/auth/social/providers", nil)
	req4.Header.Set("CF-IPCountry", "TW")
	loc4 := ResolveIPRegion(req4, RegionCN)
	if loc4.Region != RegionIntl {
		t.Fatalf("expected TW to be intl, got %s", loc4.Region)
	}

	// 5. Test Simulation Override
	req5 := httptest.NewRequest(http.MethodGet, "/api/auth/social/providers", nil)
	req5.Header.Set("X-SupDance-Simulate-Region", "intl")
	loc5 := ResolveIPRegion(req5, RegionCN)
	if loc5.Region != RegionIntl || !loc5.IsSimulated {
		t.Fatalf("expected simulated intl region, got %s", loc5.Region)
	}
}

func TestMasking(t *testing.T) {
	if MaskSecret("mock_qq_secret_0QEo") != "••••••••0QEo" {
		t.Fatalf("unexpected secret mask: %s", MaskSecret("mock_qq_secret_0QEo"))
	}
	if MaskClientID("102035200") != "****5200" {
		t.Fatalf("unexpected client id mask: %s", MaskClientID("102035200"))
	}
}

func TestMockOAuthFlowEndToEnd(t *testing.T) {
	repo := newTestRepo(t)
	host := &testHost{}
	svc := NewService(repo, host)

	providers := []string{ProviderQQ, ProviderDouyin, ProviderBilibili}

	for _, p := range providers {
		// 1. BeginAuth with mock
		req := httptest.NewRequest(http.MethodGet, "/api/auth/social/"+p+"/start", nil)
		req.Header.Set("X-Real-IP", "124.90.230.101") // CN IP
		redirectURL, err := svc.BeginAuth(req, p, "/create", true, true)
		if err != nil {
			t.Fatalf("[%s] BeginAuth failed: %v", p, err)
		}
		if !strings.Contains(redirectURL, "mock=true") {
			t.Fatalf("[%s] expected mock redirect url, got %s", p, redirectURL)
		}

		// Extract state and code from redirect URL
		u, err := http.NewRequest(http.MethodGet, redirectURL, nil)
		if err != nil {
			t.Fatalf("parse url err: %v", err)
		}
		state := u.URL.Query().Get("state")
		code := u.URL.Query().Get("code")

		// 2. CompleteAuth
		res, err := svc.CompleteAuth(req, p, state, code, "")
		if err != nil {
			t.Fatalf("[%s] CompleteAuth failed: %v", p, err)
		}
		if res.User == nil || res.Session == nil {
			t.Fatalf("[%s] expected user and session", p)
		}
		if !res.IsNew {
			t.Fatalf("[%s] expected first login to be new user", p)
		}

		// 3. Second login with same mock identity should reuse existing user
		state2 := RandomToken()
		repo.CreateOAuthState(&model.OAuthState{
			ID:        RandomToken()[:32],
			Provider:  p,
			StateHash: HashToken(state2),
			NextPath:  "/create",
			CreatedAt: time.Now(),
		})
		res2, err := svc.CompleteAuth(req, p, state2, code, "")
		if err != nil {
			t.Fatalf("[%s] repeat login failed: %v", p, err)
		}
		if res2.IsNew {
			t.Fatalf("[%s] second login should reuse existing user", p)
		}
		if res2.User.ID != res.User.ID {
			t.Fatalf("[%s] expected same user ID %s, got %s", p, res.User.ID, res2.User.ID)
		}
	}
}

func TestAuthoritativeRegionEnforcement(t *testing.T) {
	repo := newTestRepo(t)
	host := &testHost{}
	svc := NewService(repo, host)

	// Enable Google provider
	settings, _ := svc.ReadSettings()
	cfg := settings.Providers[ProviderGoogle]
	cfg.Enabled = true
	cfg.ClientID = "test_google_client_id"
	cfg.ClientSecret = "test_google_secret"
	settings.Providers[ProviderGoogle] = cfg
	svc.SaveSettings(&model.User{ID: "admin"}, settings)

	// Visitor from Mainland China tries to initiate Google auth
	req := httptest.NewRequest(http.MethodGet, "/api/auth/social/google/start", nil)
	req.Header.Set("X-Real-IP", "124.90.230.101") // Mainland China
	_, err := svc.BeginAuth(req, ProviderGoogle, "/create", true, false)
	if err == nil || !strings.Contains(err.Error(), "海外及港澳台") {
		t.Fatalf("expected rejection for Google auth from mainland IP, got err: %v", err)
	}

	// Visitor from US tries to initiate QQ auth
	reqUS := httptest.NewRequest(http.MethodGet, "/api/auth/social/qq/start", nil)
	reqUS.Header.Set("CF-IPCountry", "US")
	_, errUS := svc.BeginAuth(reqUS, ProviderQQ, "/create", true, false)
	if errUS == nil || !strings.Contains(errUS.Error(), "中国大陆") {
		t.Fatalf("expected rejection for QQ auth from US IP, got err: %v", errUS)
	}
}
