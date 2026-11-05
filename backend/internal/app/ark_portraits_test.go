package app

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"gorm.io/gorm"

	"yingce/backend/internal/model"
)

type fakeArkPortraitControlPlane struct {
	mu          sync.Mutex
	callbackURL string
	actions     []string
	bodies      []map[string]any
	assetStatus string
	groupSeq    int
	assetSeq    int
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
		case "CreateAssetGroup":
			if body["GroupType"] != "AIGC" {
				t.Errorf("CreateAssetGroup GroupType = %v", body["GroupType"])
			}
			f.mu.Lock()
			f.groupSeq++
			id := f.groupSeq
			f.mu.Unlock()
			_, _ = w.Write([]byte(`{"Result":{"Id":"group-aigc-` + string(rune('0'+id)) + `"}}`))
		case "CreateAsset":
			if !strings.HasPrefix(body["GroupId"].(string), "group-") || body["AssetType"] != "Image" || !strings.HasPrefix(body["URL"].(string), "https://") {
				t.Errorf("CreateAsset body = %#v", body)
			}
			f.mu.Lock()
			f.assetSeq++
			id := f.assetSeq
			f.mu.Unlock()
			_, _ = w.Write([]byte(`{"Result":{"Id":"asset-2026110` + string(rune('0'+id)) + `-portrait"}}`))
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

func (f *fakeArkPortraitControlPlane) setAssetStatus(status string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.assetStatus = status
}

func testPNG(t *testing.T, width, height int) []byte {
	t.Helper()
	canvas := image.NewRGBA(image.Rect(0, 0, width, height))
	canvas.Set(0, 0, color.RGBA{R: 255, A: 255})
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, canvas); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func arkPortraitTestService(t *testing.T, mutate ...func(*arkPrivateAssetSettingValue)) (*Service, *gorm.DB, *fakeArkPortraitControlPlane) {
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

	setting := defaultArkPrivateAssetSetting()
	setting.RealEnabled, setting.VirtualEnabled = true, true
	setting.Site, setting.Region, setting.ProjectName = arkSiteVolcengine, "cn-beijing", "portrait-project"
	setting.AccessKeyID, setting.AccessKeySecret, setting.CallbackBaseURL = "ak", "sk", "https://canvas.example.test"
	for _, apply := range mutate {
		apply(&setting)
	}
	if err := s.saveArkPrivateAssetSetting(&model.SystemSetting{Key: arkPrivateAssetSettingKey}, setting); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(s.dataDir, "resources"), 0o700); err != nil {
		t.Fatal(err)
	}
	picture := testPNG(t, 400, 500)
	if err := os.WriteFile(filepath.Join(s.dataDir, "resources", "portrait.png"), picture, 0o600); err != nil {
		t.Fatal(err)
	}
	for _, row := range []any{
		&model.User{ID: "other", Username: "other", Role: model.UserRoleUser, Status: model.UserStatusActive},
		&model.User{ID: "admin", Username: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive},
		&model.Resource{ID: "portrait-res", UserID: "user", Kind: "image", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "portrait.png", MimeType: "image/png", Size: int64(len(picture)), Width: 400, Height: 500},
		&model.Resource{ID: "other-res", UserID: "other", Kind: "image", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "portrait.png", MimeType: "image/png", Size: int64(len(picture)), Width: 400, Height: 500},
		&model.Resource{ID: "admin-res", UserID: "admin", Kind: "image", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "portrait.png", MimeType: "image/png", Size: int64(len(picture)), Width: 400, Height: 500},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	return s, db, fake
}

func arkTestBalance(t *testing.T, db *gorm.DB, userID string) model.CreditAccount {
	t.Helper()
	var account model.CreditAccount
	if err := db.First(&account, "user_id = ?", userID).Error; err != nil {
		t.Fatal(err)
	}
	return account
}

func arkTestReference(id string) *canvasGenerationInput {
	return &canvasGenerationInput{Mode: "video", ReferenceImages: []providerMedia{{URL: "asset://" + id}}}
}

func TestArkRealGroupChargesOnVerificationReviewsUploadsAndCertifiesLibrary(t *testing.T) {
	s, db, fake := arkPortraitTestService(t, func(value *arkPrivateAssetSettingValue) {
		value.BillingEnabled, value.RealGroupPriceMicrocredits = true, 5*CreditScale
	})
	ctx := context.Background()
	user := &model.User{ID: "user", Role: model.UserRoleUser}
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	if err := db.Model(&model.CreditAccount{}).Where("user_id = ?", "user").Update("available_microcredits", 8*CreditScale).Error; err != nil {
		t.Fatal(err)
	}

	session, err := s.CreateArkPortraitSession(ctx, user, "演员甲", "en-US")
	if err != nil {
		t.Fatal(err)
	}
	link, _ := url.Parse(session.H5Link)
	if session.Status != arkPortraitSessionPending || session.ReservedMicrocredits != 5*CreditScale || link.Query().Get("lng") != "en" || link.Query().Get("pl") != "abc" {
		t.Fatalf("session = %#v", session)
	}
	if account := arkTestBalance(t, db, "user"); account.AvailableMicrocredits != 3*CreditScale || account.ReservedMicrocredits != 5*CreditScale {
		t.Fatalf("reserved account = %#v", account)
	}
	if _, err := s.CreateArkPortraitSession(ctx, user, "演员乙", "zh"); err == nil || !strings.Contains(err.Error(), "积分不足") {
		t.Fatalf("second session with insufficient credits = %v", err)
	}

	state := fake.state(t)
	if got := s.HandleArkPortraitCallback(ctx, state, url.Values{"resultCode": {"10000"}, "bytedToken": {"forged"}}); got != "/ark-portrait/result?status=invalid" {
		t.Fatalf("forged token redirect = %q", got)
	}
	if got := s.HandleArkPortraitCallback(ctx, state, url.Values{"resultCode": {"10000"}, "bytedToken": {"byted-token-1"}}); got != "/ark-portrait/result?status=verified" {
		t.Fatalf("callback redirect = %q", got)
	}
	if got := s.HandleArkPortraitCallback(ctx, state, url.Values{"resultCode": {"10000"}}); got != "/ark-portrait/result?status=verified" {
		t.Fatalf("replayed callback redirect = %q", got)
	}
	if account := arkTestBalance(t, db, "user"); account.AvailableMicrocredits != 3*CreditScale || account.ReservedMicrocredits != 0 {
		t.Fatalf("settled account = %#v", account)
	}
	var consume model.CreditLedgerEntry
	if err := db.Where("user_id = ? AND type = ?", "user", model.CreditLedgerConsume).First(&consume).Error; err != nil || consume.Scene != model.BillingSceneArkAssetGroup || consume.Note != "真人人像 · 演员甲" || consume.AmountMicrocredits != -5*CreditScale {
		t.Fatalf("consume entry = %#v, %v", consume, err)
	}

	overview, err := s.ArkPortraitOverview(ctx, user)
	if err != nil {
		t.Fatal(err)
	}
	if !overview.Enabled || overview.Usage.Real != 1 || len(overview.Groups) != 1 {
		t.Fatalf("overview = %#v", overview)
	}
	group := overview.Groups[0]
	if group.GroupID != "group-20261104-abcde" || group.Kind != arkGroupKindReal || !group.Owned || !group.Available || group.ExpiresAt == nil || group.ExpiryStatus != "valid" {
		t.Fatalf("group = %#v", group)
	}
	if other, err := s.ArkPortraitOverview(ctx, &model.User{ID: "other"}); err != nil || len(other.Groups) != 0 {
		t.Fatalf("other user sees groups: %#v, %v", other, err)
	}

	if _, err := s.CreateArkPortraitAsset(ctx, &model.User{ID: "other"}, group.ID, ArkAssetUploadInput{ResourceID: "other-res"}); err == nil {
		t.Fatal("other user must not upload into someone else's group")
	}
	if _, err := s.CreateArkPortraitAsset(ctx, user, group.ID, ArkAssetUploadInput{ResourceID: "other-res"}); err == nil {
		t.Fatal("user must not upload another user's resource")
	}
	library := map[string]any{
		"id": "library-1", "kind": "image", "category": "character", "title": "正面照", "coverUrl": "", "tags": []string{}, "createdAt": time.Now().UTC().Format(time.RFC3339Nano), "updatedAt": time.Now().UTC().Format(time.RFC3339Nano),
		"data": map[string]any{"dataUrl": "/api/resources/portrait-res/file", "storageKey": "resource:portrait-res", "width": 400, "height": 500, "bytes": 10, "mimeType": "image/png"},
	}
	payload, _ := json.Marshal(library)
	if err := db.Create(&model.Asset{ID: "library-1", UserID: "user", Kind: "image", Category: model.AssetCategoryCharacter, Status: model.AssetVersionStatusConfirmed, Title: "正面照", PayloadJSON: string(payload)}).Error; err != nil {
		t.Fatal(err)
	}
	asset, err := s.CreateArkPortraitAsset(ctx, user, group.ID, ArkAssetUploadInput{ResourceID: "portrait-res", Name: "正面照", LibraryAssetID: "library-1"})
	if err != nil {
		t.Fatal(err)
	}
	if asset.Status != arkPortraitAssetPendingReview || asset.ArkAssetID != "" {
		t.Fatalf("asset must wait for platform review: %#v", asset)
	}
	if _, err := s.CreateArkPortraitAsset(ctx, user, group.ID, ArkAssetUploadInput{ResourceID: "portrait-res", LibraryAssetID: "library-1"}); err == nil {
		t.Fatal("the same library asset must not be submitted twice")
	}
	if _, err := s.AdminApproveArkAssets(ctx, user, []string{asset.ID}); err == nil {
		t.Fatal("review is admin only")
	}
	queue, err := s.AdminArkReviewQueue(admin, "", 1, 20)
	if err != nil || queue.Total != 1 || queue.Items[0].Uploader == nil || queue.Items[0].Group == nil {
		t.Fatalf("review queue = %#v, %v", queue, err)
	}
	approved, err := s.AdminApproveArkAssets(ctx, admin, []string{asset.ID})
	if err != nil || len(approved.Succeeded) != 1 || len(approved.Failed) != 0 {
		t.Fatalf("approve = %#v, %v", approved, err)
	}

	fake.setAssetStatus("Active")
	s.runArkPortraitMaintenance(ctx)
	var stored model.ArkPortraitAsset
	if err := db.First(&stored, "id = ?", asset.ID).Error; err != nil || stored.Status != arkPortraitAssetActive || stored.ArkAssetID == "" {
		t.Fatalf("stored asset = %#v, %v", stored, err)
	}
	var certified model.Asset
	if err := db.First(&certified, "id = ?", "library-1").Error; err != nil || certified.Category != model.AssetCategoryArk || !strings.Contains(certified.PayloadJSON, `"previousCategory":"character"`) || !strings.Contains(certified.PayloadJSON, stored.ArkAssetID) {
		t.Fatalf("library asset = %#v, %v", certified, err)
	}

	if err := s.validateArkPortraitReferences("user", arkTestReference(stored.ArkAssetID)); err != nil {
		t.Fatalf("owner reference rejected: %v", err)
	}
	if err := s.validateArkPortraitReferences("other", arkTestReference(stored.ArkAssetID)); err == nil {
		t.Fatal("other user must not reference someone else's portrait asset")
	}
	if err := s.validateArkPortraitReferences("other", arkTestReference("asset-public-avatar")); err != nil {
		t.Fatalf("unregistered asset IDs stay usable: %v", err)
	}
	if err := db.Model(&model.ArkPortraitGroup{}).Where("id = ?", group.ID).Update("expires_at", time.Now().Add(-time.Hour)).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.validateArkPortraitReferences("user", arkTestReference(stored.ArkAssetID)); err == nil || !strings.Contains(err.Error(), "过期") {
		t.Fatalf("expired real group reference = %v", err)
	}

	if err := s.DeleteArkPortraitAsset(ctx, &model.User{ID: "other"}, asset.ID); err == nil {
		t.Fatal("other user must not delete the asset")
	}
	if err := s.DeleteArkGroup(ctx, user, group.ID); err != nil {
		t.Fatal(err)
	}
	if err := db.First(&certified, "id = ?", "library-1").Error; err != nil || certified.Category != model.AssetCategoryCharacter || strings.Contains(certified.PayloadJSON, "arkCertification") {
		t.Fatalf("library asset after group deletion = %#v, %v", certified, err)
	}
	if overview, err = s.ArkPortraitOverview(ctx, user); err != nil || len(overview.Groups) != 0 {
		t.Fatalf("group not removed: %#v, %v", overview, err)
	}
}

func TestArkPortraitSessionFailureExpiryAndCancelRefund(t *testing.T) {
	s, db, fake := arkPortraitTestService(t, func(value *arkPrivateAssetSettingValue) {
		value.BillingEnabled, value.RealGroupPriceMicrocredits = true, CreditScale
	})
	ctx := context.Background()
	user := &model.User{ID: "user", Role: model.UserRoleUser}
	if err := db.Model(&model.CreditAccount{}).Where("user_id = ?", "user").Update("available_microcredits", 3*CreditScale).Error; err != nil {
		t.Fatal(err)
	}

	failed, err := s.CreateArkPortraitSession(ctx, user, "演员乙", "zh-CN")
	if err != nil {
		t.Fatal(err)
	}
	if got := s.HandleArkPortraitCallback(ctx, fake.state(t), url.Values{"resultCode": {"20001"}, "algorithmBaseRespCode": {"5"}}); got != "/ark-portrait/result?status=failed" {
		t.Fatalf("failed redirect = %q", got)
	}
	view, err := s.CheckArkPortraitSession(ctx, user, failed.ID)
	if err != nil || view.Status != arkPortraitSessionFailed || !strings.Contains(view.Error, "20001") {
		t.Fatalf("failed session = %#v, %v", view, err)
	}

	cancelled, err := s.CreateArkPortraitSession(ctx, user, "演员丙", "zh-Hant")
	if err != nil {
		t.Fatal(err)
	}
	if link, _ := url.Parse(cancelled.H5Link); link.Query().Get("lng") != "zh-Hant" {
		t.Fatalf("h5 link = %q", cancelled.H5Link)
	}
	if _, err := s.CancelArkPortraitSession(&model.User{ID: "other"}, cancelled.ID); err == nil {
		t.Fatal("other user must not cancel the session")
	}
	if view, err := s.CancelArkPortraitSession(user, cancelled.ID); err != nil || view.Status != arkPortraitSessionCancelled {
		t.Fatalf("cancelled session = %#v, %v", view, err)
	}

	expiring, err := s.CreateArkPortraitSession(ctx, user, "演员丁", "zh")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.ArkPortraitSession{}).Where("id = ?", expiring.ID).Update("expires_at", time.Now().Add(-time.Minute)).Error; err != nil {
		t.Fatal(err)
	}
	s.runArkPortraitMaintenance(ctx)
	if view, err := s.ArkPortraitSessionStatus(user, expiring.ID); err != nil || view.Status != arkPortraitSessionExpired {
		t.Fatalf("expired session = %#v, %v", view, err)
	}
	if account := arkTestBalance(t, db, "user"); account.AvailableMicrocredits != 3*CreditScale || account.ReservedMicrocredits != 0 {
		t.Fatalf("all failed sessions must be refunded: %#v", account)
	}
	var refunds int64
	if err := db.Model(&model.CreditLedgerEntry{}).Where("user_id = ? AND type = ? AND scene = ?", "user", model.CreditLedgerRefund, model.BillingSceneArkAssetGroup).Count(&refunds).Error; err != nil || refunds != 3 {
		t.Fatalf("refund entries = %d, %v", refunds, err)
	}

	pending, err := s.CreateArkPortraitSession(ctx, user, "演员戊", "zh")
	if err != nil {
		t.Fatal(err)
	}
	if view, err := s.CheckArkPortraitSession(ctx, user, pending.ID); err != nil || view.Status != arkPortraitSessionVerified || view.GroupID != "group-20261104-abcde" {
		t.Fatalf("polled session = %#v, %v", view, err)
	}
	if got := s.HandleArkPortraitCallback(ctx, "not-a-valid-state", url.Values{}); got != "/ark-portrait/result?status=invalid" {
		t.Fatalf("invalid state redirect = %q", got)
	}
}

func TestArkVirtualGroupRefundsWhenCreationFailsAndRespectsLimit(t *testing.T) {
	s, db, fake := arkPortraitTestService(t, func(value *arkPrivateAssetSettingValue) {
		value.BillingEnabled, value.VirtualGroupPriceMicrocredits, value.VirtualGroupLimit, value.VirtualReviewRequired = true, 2*CreditScale, 1, false
	})
	ctx := context.Background()
	user := &model.User{ID: "user", Role: model.UserRoleUser}
	if _, err := s.CreateArkVirtualGroup(ctx, user, ArkGroupInput{Name: "二次元少女"}); err == nil || !strings.Contains(err.Error(), "积分不足") {
		t.Fatalf("virtual group without credits = %v", err)
	}
	if err := db.Model(&model.CreditAccount{}).Where("user_id = ?", "user").Update("available_microcredits", 5*CreditScale).Error; err != nil {
		t.Fatal(err)
	}
	group, err := s.CreateArkVirtualGroup(ctx, user, ArkGroupInput{Name: "二次元少女", Description: "主角立绘"})
	if err != nil {
		t.Fatal(err)
	}
	if group.Kind != arkGroupKindVirtual || group.Source != arkGroupSourceCreated || group.ExpiresAt != nil || group.ExpiryStatus != "none" {
		t.Fatalf("virtual group = %#v", group)
	}
	if account := arkTestBalance(t, db, "user"); account.AvailableMicrocredits != 3*CreditScale || account.ReservedMicrocredits != 0 {
		t.Fatalf("virtual group charge = %#v", account)
	}
	if _, err := s.CreateArkVirtualGroup(ctx, user, ArkGroupInput{Name: "第二组"}); err == nil || !strings.Contains(err.Error(), "最多创建 1 个") {
		t.Fatalf("virtual group limit = %v", err)
	}
	asset, err := s.CreateArkPortraitAsset(ctx, user, group.ID, ArkAssetUploadInput{ResourceID: "portrait-res", Name: "立绘"})
	if err != nil || asset.Status != arkPortraitAssetProcessing {
		t.Fatalf("review-free upload = %#v, %v", asset, err)
	}
	fake.setAssetStatus("Active")
	refreshed, err := s.RefreshArkPortraitAsset(ctx, user, asset.ID)
	if err != nil || refreshed.Status != arkPortraitAssetActive || !refreshed.InLibrary || refreshed.LibraryAssetID != arkOwnLibraryAssetID(asset.ID) {
		t.Fatalf("refreshed asset = %#v, %v", refreshed, err)
	}
	var created model.Asset
	if err := db.First(&created, "id = ? AND user_id = ?", arkOwnLibraryAssetID(asset.ID), "user").Error; err != nil || created.Category != model.AssetCategoryArk || !strings.Contains(created.PayloadJSON, `"kind":"virtual"`) {
		t.Fatalf("auto library asset = %#v, %v", created, err)
	}
}

func TestArkPlatformGroupGrantsControlVisibilityAndReferences(t *testing.T) {
	s, _, fake := arkPortraitTestService(t)
	ctx := context.Background()
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	user := &model.User{ID: "user", Role: model.UserRoleUser}
	other := &model.User{ID: "other", Role: model.UserRoleUser}
	if _, err := s.AdminCreateArkGroup(ctx, user, AdminArkGroupCreateRequest{Kind: arkGroupKindIP, Name: "影策猫"}); err == nil {
		t.Fatal("platform groups are admin only")
	}
	if _, err := s.AdminCreateArkGroup(ctx, admin, AdminArkGroupCreateRequest{Kind: arkGroupKindReal, Name: "签约演员"}); err == nil {
		t.Fatal("real platform groups need H5 verification or an existing group id")
	}
	group, err := s.AdminCreateArkGroup(ctx, admin, AdminArkGroupCreateRequest{Kind: arkGroupKindIP, Name: "影策猫", GrantUserIDs: []string{"user"}})
	if err != nil {
		t.Fatal(err)
	}
	if group.Scope != arkGroupScopePlatform || len(group.GrantUsers) != 1 || group.GrantUsers[0].ID != "user" {
		t.Fatalf("platform group = %#v", group)
	}
	asset, err := s.AdminCreateArkPortraitAsset(ctx, admin, group.ID, ArkAssetUploadInput{ResourceID: "admin-res", Name: "主形象"})
	if err != nil || asset.Status != arkPortraitAssetProcessing {
		t.Fatalf("admin upload = %#v, %v", asset, err)
	}
	fake.setAssetStatus("Active")
	s.runArkPortraitMaintenance(ctx)

	overview, err := s.ArkPortraitOverview(ctx, user)
	if err != nil || len(overview.Groups) != 1 || overview.Groups[0].Owned || len(overview.Groups[0].Assets) != 1 || overview.Groups[0].Assets[0].InLibrary {
		t.Fatalf("granted overview = %#v, %v", overview, err)
	}
	if hidden, err := s.ArkPortraitOverview(ctx, other); err != nil || len(hidden.Groups) != 0 {
		t.Fatalf("ungranted user sees platform group: %#v, %v", hidden, err)
	}
	arkAssetID := overview.Groups[0].Assets[0].ArkAssetID
	if err := s.validateArkPortraitReferences("user", arkTestReference(arkAssetID)); err != nil {
		t.Fatalf("granted user reference rejected: %v", err)
	}
	if err := s.validateArkPortraitReferences("other", arkTestReference(arkAssetID)); err == nil {
		t.Fatal("ungranted user must not reference the platform asset")
	}
	if _, err := s.AddArkPortraitAssetToLibrary(other, asset.ID); err == nil {
		t.Fatal("ungranted user must not add the platform asset")
	}
	libraryID, err := s.AddArkPortraitAssetToLibrary(user, asset.ID)
	if err != nil || libraryID != arkSharedLibraryAssetID(asset.ID, "user") {
		t.Fatalf("add to library = %q, %v", libraryID, err)
	}
	copied, err := s.repo.AssetForUser("user", libraryID)
	if err != nil || copied.Category != model.AssetCategoryArk || strings.Contains(copied.PayloadJSON, "admin-res") {
		t.Fatalf("library copy must reference the user's own resource: %#v, %v", copied, err)
	}
	if again, err := s.AddArkPortraitAssetToLibrary(user, asset.ID); err != nil || again != libraryID {
		t.Fatalf("adding twice = %q, %v", again, err)
	}

	grantAll := true
	if _, err := s.AdminUpdateArkGroup(admin, group.ID, AdminArkGroupUpdateRequest{GrantAll: &grantAll, GrantUserIDs: &[]string{}}); err != nil {
		t.Fatal(err)
	}
	if err := s.validateArkPortraitReferences("other", arkTestReference(arkAssetID)); err != nil {
		t.Fatalf("grant-all reference rejected: %v", err)
	}
	if err := s.AdminDeleteArkGroup(ctx, admin, group.ID); err != nil {
		t.Fatal(err)
	}
	if copied, err = s.repo.AssetForUser("user", libraryID); err != nil || copied.Category == model.AssetCategoryArk {
		t.Fatalf("deleting the platform group must uncertify library copies: %#v, %v", copied, err)
	}
}

func TestArkPortraitDisabledOverview(t *testing.T) {
	s, _, _, _ := creationTestService(t)
	overview, err := s.ArkPortraitOverview(context.Background(), &model.User{ID: "user"})
	if err != nil || overview.Enabled || overview.Groups == nil {
		t.Fatalf("overview = %#v, %v", overview, err)
	}
	if _, err := s.CreateArkPortraitSession(context.Background(), &model.User{ID: "user"}, "演员", "zh"); err == nil {
		t.Fatal("unconfigured portrait library must reject new sessions")
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
