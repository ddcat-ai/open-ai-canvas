package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"yingce/backend/internal/model"
)

type fakeArkPortraitControlPlane struct {
	mu          sync.Mutex
	callbackURL string
	actions     []string
	bodies      []map[string]any
	assetStatus string
}

func (f *fakeArkPortraitControlPlane) handler(t *testing.T) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode body: %v", err)
		}
		action := r.URL.Query().Get("Action")
		f.mu.Lock()
		f.actions = append(f.actions, action)
		f.bodies = append(f.bodies, body)
		status := f.assetStatus
		f.mu.Unlock()
		if body["ProjectName"] != "portrait-project" {
			t.Errorf("%s ProjectName = %v", action, body["ProjectName"])
		}
		w.Header().Set("Content-Type", "application/json")
		switch action {
		case "CreateVisualValidateSession":
			f.mu.Lock()
			f.callbackURL, _ = body["CallbackURL"].(string)
			f.mu.Unlock()
			_, _ = w.Write([]byte(`{"Result":{"BytedToken":"byted-token-1","H5Link":"https://h5.example.test/authorization?pl=abc&lng=zh"}}`))
		case "GetVisualValidateResult":
			if body["BytedToken"] != "byted-token-1" {
				t.Errorf("BytedToken = %v", body["BytedToken"])
			}
			_, _ = w.Write([]byte(`{"Result":{"GroupId":"group-20261104-abcde"}}`))
		case "CreateAsset":
			if body["GroupId"] != "group-20261104-abcde" || body["AssetType"] != "Image" || !strings.HasPrefix(body["URL"].(string), "https://") {
				t.Errorf("CreateAsset body = %#v", body)
			}
			_, _ = w.Write([]byte(`{"Result":{"Id":"asset-20261104-portrait"}}`))
		case "GetAsset":
			_, _ = w.Write([]byte(`{"Result":{"Status":"` + status + `"}}`))
		case "DeleteAsset", "DeleteAssetGroup":
			_, _ = w.Write([]byte(`{"Result":{}}`))
		default:
			t.Errorf("unexpected action %s", action)
			w.WriteHeader(http.StatusBadRequest)
		}
	}
}

func (f *fakeArkPortraitControlPlane) state(t *testing.T) string {
	f.mu.Lock()
	defer f.mu.Unlock()
	parsed, err := url.Parse(f.callbackURL)
	if err != nil || !strings.HasPrefix(parsed.Path, "/api/ark-portraits/callback/") || parsed.RawQuery != "" {
		t.Fatalf("callback URL = %q", f.callbackURL)
	}
	return strings.TrimPrefix(parsed.Path, "/api/ark-portraits/callback/")
}

func arkPortraitTestService(t *testing.T) (*Service, *fakeArkPortraitControlPlane) {
	t.Helper()
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	t.Setenv("CANVAS_PUBLIC_BASE_URL", "https://canvas.example.test")
	s, db, _, _ := creationTestService(t)
	fake := &fakeArkPortraitControlPlane{assetStatus: "Processing"}
	server := httptest.NewServer(fake.handler(t))
	t.Cleanup(server.Close)
	previous := arkPrivateAssetAPIBaseURLOverride
	arkPrivateAssetAPIBaseURLOverride = server.URL
	t.Cleanup(func() { arkPrivateAssetAPIBaseURLOverride = previous })

	if err := s.saveArkPrivateAssetSetting(&model.SystemSetting{Key: arkPrivateAssetSettingKey}, arkPrivateAssetSettingValue{
		PortraitEnabled: true, Site: arkSiteVolcengine, Region: "cn-beijing", ProjectName: "portrait-project",
		AccessKeyID: "ak", AccessKeySecret: "sk", CallbackBaseURL: "https://canvas.example.test",
	}); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(s.dataDir, "resources"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(s.dataDir, "resources", "portrait.png"), []byte("png"), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, row := range []any{
		&model.Resource{ID: "portrait-res", UserID: "user", Kind: "image", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "portrait.png", MimeType: "image/png", Size: 3},
		&model.Resource{ID: "other-res", UserID: "other", Kind: "image", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "portrait.png", MimeType: "image/png", Size: 3},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	return s, fake
}

func TestArkPortraitLivenessFlowBindsGroupToUser(t *testing.T) {
	s, fake := arkPortraitTestService(t)
	ctx := context.Background()
	user := &model.User{ID: "user"}

	session, err := s.CreateArkPortraitSession(ctx, user, "演员甲", "en-US")
	if err != nil {
		t.Fatal(err)
	}
	link, _ := url.Parse(session.H5Link)
	if session.Status != arkPortraitSessionPending || link.Query().Get("lng") != "en" || link.Query().Get("pl") != "abc" {
		t.Fatalf("session = %#v", session)
	}
	state := fake.state(t)

	if got := s.HandleArkPortraitCallback(ctx, state, url.Values{"resultCode": {"10000"}, "bytedToken": {"forged"}}); got != "/assets?arkPortrait=invalid" {
		t.Fatalf("forged token redirect = %q", got)
	}
	if got := s.HandleArkPortraitCallback(ctx, state, url.Values{"resultCode": {"10000"}, "bytedToken": {"byted-token-1"}}); got != "/assets?arkPortrait=verified" {
		t.Fatalf("callback redirect = %q", got)
	}
	if got := s.HandleArkPortraitCallback(ctx, state, url.Values{"resultCode": {"10000"}}); got != "/assets?arkPortrait=verified" {
		t.Fatalf("replayed callback redirect = %q", got)
	}

	overview, err := s.ArkPortraitOverview(ctx, user)
	if err != nil {
		t.Fatal(err)
	}
	if !overview.Enabled || len(overview.Groups) != 1 || overview.Groups[0].GroupID != "group-20261104-abcde" || overview.Groups[0].Name != "演员甲" || !overview.Groups[0].Available {
		t.Fatalf("overview = %#v", overview)
	}
	other, err := s.ArkPortraitOverview(ctx, &model.User{ID: "other"})
	if err != nil || len(other.Groups) != 0 {
		t.Fatalf("other user sees groups: %#v, %v", other, err)
	}
	groupID := overview.Groups[0].ID

	if _, err := s.CreateArkPortraitAsset(ctx, &model.User{ID: "other"}, groupID, "other-res", ""); err == nil {
		t.Fatal("other user must not upload into someone else's group")
	}
	if _, err := s.CreateArkPortraitAsset(ctx, user, groupID, "other-res", ""); err == nil {
		t.Fatal("user must not upload another user's resource")
	}
	asset, err := s.CreateArkPortraitAsset(ctx, user, groupID, "portrait-res", "正面照")
	if err != nil {
		t.Fatal(err)
	}
	if asset.Status != arkPortraitAssetProcessing || asset.ArkAssetID != "asset-20261104-portrait" {
		t.Fatalf("asset = %#v", asset)
	}
	fake.mu.Lock()
	fake.assetStatus = "Active"
	fake.mu.Unlock()
	overview, err = s.ArkPortraitOverview(ctx, user)
	if err != nil || len(overview.Groups[0].Assets) != 1 || overview.Groups[0].Assets[0].Status != arkPortraitAssetActive {
		t.Fatalf("refreshed overview = %#v, %v", overview, err)
	}

	reference := func(id string) *canvasGenerationInput {
		return &canvasGenerationInput{Mode: "video", ReferenceImages: []providerMedia{{URL: "asset://" + id}}}
	}
	if err := s.validateArkPortraitReferences("user", reference("asset-20261104-portrait")); err != nil {
		t.Fatalf("owner reference rejected: %v", err)
	}
	if err := s.validateArkPortraitReferences("other", reference("asset-20261104-portrait")); err == nil {
		t.Fatal("other user must not reference someone else's portrait asset")
	}
	if err := s.validateArkPortraitReferences("other", reference("asset-public-avatar")); err != nil {
		t.Fatalf("unregistered asset IDs stay usable: %v", err)
	}

	if _, err := s.BindArkPortraitGroup(ctx, user, "控制台组", "group-20261104-fghij"); err == nil {
		t.Fatal("manual group binding is admin only")
	}
	if err := s.DeleteArkPortraitAsset(ctx, &model.User{ID: "other"}, asset.ID); err == nil {
		t.Fatal("other user must not delete the asset")
	}
	if err := s.DeleteArkPortraitGroup(ctx, user, groupID); err != nil {
		t.Fatal(err)
	}
	overview, err = s.ArkPortraitOverview(ctx, user)
	if err != nil || len(overview.Groups) != 0 {
		t.Fatalf("group not removed: %#v, %v", overview, err)
	}
	fake.mu.Lock()
	defer fake.mu.Unlock()
	if strings.Join(fake.actions, ",") != "CreateVisualValidateSession,GetVisualValidateResult,CreateAsset,GetAsset,DeleteAssetGroup" {
		t.Fatalf("actions = %v", fake.actions)
	}
}

func TestArkPortraitCallbackRecordsFailureAndPollingFallback(t *testing.T) {
	s, fake := arkPortraitTestService(t)
	ctx := context.Background()
	user := &model.User{ID: "user"}

	failed, err := s.CreateArkPortraitSession(ctx, user, "演员乙", "zh-CN")
	if err != nil {
		t.Fatal(err)
	}
	if got := s.HandleArkPortraitCallback(ctx, fake.state(t), url.Values{"resultCode": {"20001"}, "algorithmBaseRespCode": {"5"}}); got != "/assets?arkPortrait=failed" {
		t.Fatalf("failed redirect = %q", got)
	}
	view, err := s.CheckArkPortraitSession(ctx, user, failed.ID)
	if err != nil || view.Status != arkPortraitSessionFailed || !strings.Contains(view.Error, "20001") {
		t.Fatalf("failed session = %#v, %v", view, err)
	}

	pending, err := s.CreateArkPortraitSession(ctx, user, "演员丙", "zh-Hant")
	if err != nil {
		t.Fatal(err)
	}
	if link, _ := url.Parse(pending.H5Link); link.Query().Get("lng") != "zh-Hant" {
		t.Fatalf("h5 link = %q", pending.H5Link)
	}
	if _, err := s.CheckArkPortraitSession(ctx, &model.User{ID: "other"}, pending.ID); err == nil {
		t.Fatal("other user must not poll the session")
	}
	view, err = s.CheckArkPortraitSession(ctx, user, pending.ID)
	if err != nil || view.Status != arkPortraitSessionVerified || view.GroupID != "group-20261104-abcde" {
		t.Fatalf("polled session = %#v, %v", view, err)
	}
	if got := s.HandleArkPortraitCallback(ctx, "not-a-valid-state", url.Values{}); got != "/assets?arkPortrait=invalid" {
		t.Fatalf("invalid state redirect = %q", got)
	}
}

func TestArkPortraitDisabledOverview(t *testing.T) {
	s, _, _, _ := creationTestService(t)
	overview, err := s.ArkPortraitOverview(context.Background(), &model.User{ID: "user"})
	if err != nil || overview.Enabled || overview.Groups == nil {
		t.Fatalf("overview = %#v, %v", overview, err)
	}
	if _, err := s.CreateArkPortraitSession(context.Background(), &model.User{ID: "user"}, "演员", "zh"); err == nil {
		t.Fatal("disabled portrait library must reject new sessions")
	}
}

func TestArkPortraitH5LanguageMapping(t *testing.T) {
	for input, want := range map[string]string{"": "zh", "zh-CN": "zh", "zh-TW": "zh-Hant", "zh-Hant": "zh-Hant", "en": "en", "ja-JP": "en", "fr": "en"} {
		if got := arkPortraitH5Language(input); got != want {
			t.Fatalf("arkPortraitH5Language(%q) = %q, want %q", input, got, want)
		}
	}
	if _, err := arkPortraitH5Link("http://insecure.example/h5", "zh"); err == nil {
		t.Fatal("non-https h5 link must be rejected")
	}
}
