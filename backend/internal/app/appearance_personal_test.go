package app

import (
	"bytes"
	"reflect"
	"testing"

	"yingce/backend/internal/model"
)

func TestPersonalAvatarUploadOwnershipAndSiteIsolation(t *testing.T) {
	svc, db, _, admin := newAppearanceTestService(t)
	owner := &model.User{ID: "avatar-owner", Username: "avatar-owner", Role: model.UserRoleUser, Status: model.UserStatusActive}
	other := &model.User{ID: "avatar-other", Username: "avatar-other", Role: model.UserRoleUser, Status: model.UserStatusActive}
	for _, user := range []*model.User{owner, other} {
		if err := db.Create(user).Error; err != nil {
			t.Fatal(err)
		}
	}
	before, err := svc.Appearance()
	if err != nil {
		t.Fatal(err)
	}
	data := agentAvatarBundleTestZIP(t, `{"version":1,"width":480,"height":432,"clips":{"idle":"idle.mp4"}}`, map[string][]byte{"idle.mp4": agentAvatarTestMP4()})
	header := multipartFileHeader(t, "avatar.zip", "application/zip", data)
	if _, err := svc.UploadAgentAvatarBundle(owner, header); err == nil {
		t.Fatal("ordinary user reached administrator upload")
	}
	bundle, err := svc.UploadPersonalAgentAvatarBundle(owner, header)
	if err != nil {
		t.Fatal(err)
	}
	resource, err := svc.repo.Resource(bundle.ResourceID)
	if err != nil || resource.UserID != owner.ID || resource.Size != int64(len(data)) {
		t.Fatalf("wrong resource owner or size: %+v %v", resource, err)
	}
	video, mime, err := svc.PersonalAgentAvatarBundleAsset(owner, bundle.ResourceID, "idle.mp4")
	if err != nil || mime != "video/mp4" || !bytes.Equal(video, agentAvatarTestMP4()) {
		t.Fatalf("owner playback: %s %v", mime, err)
	}
	for _, actor := range []*model.User{nil, other, admin} {
		if _, _, err := svc.PersonalAgentAvatarBundleAsset(actor, bundle.ResourceID, "avatar.json"); err == nil {
			t.Fatalf("non-owner accessed private bundle: %+v", actor)
		}
	}
	if _, _, err := svc.AgentAvatarBundleAsset(nil, bundle.ResourceID, "avatar.json"); err == nil {
		t.Fatal("personal bundle was published")
	}
	if _, _, err := svc.PersonalAgentAvatarBundleAsset(owner, bundle.ResourceID, "../avatar.json"); err == nil {
		t.Fatal("traversal accepted")
	}
	modelData := live2DTestZIP(t, live2DTestFiles(t))
	imported, err := svc.UploadPersonalLive2D(owner, multipartFileHeader(t, "live2d.zip", "application/zip", modelData))
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := svc.PersonalLive2DAsset(owner, imported.ResourceID, imported.Entry); err != nil {
		t.Fatal(err)
	}
	if _, _, err := svc.PersonalLive2DAsset(other, imported.ResourceID, imported.Entry); err == nil {
		t.Fatal("another user read a private Live2D model")
	}
	if _, _, err := svc.Live2DAsset(nil, imported.ResourceID, imported.Entry); err == nil {
		t.Fatal("private Live2D model became public")
	}
	after, err := svc.Appearance()
	if err != nil || !reflect.DeepEqual(before, after) {
		t.Fatalf("personal upload changed site appearance: %v", err)
	}
}

func TestPersonalAvatarRejectsInactiveUsersInvalidArchivesAndQuotaOverflow(t *testing.T) {
	svc, db, _, _ := newAppearanceTestService(t)
	owner := &model.User{ID: "avatar-quota", Username: "avatar-quota", Role: model.UserRoleUser, Status: model.UserStatusActive}
	if err := db.Create(owner).Error; err != nil {
		t.Fatal(err)
	}
	data := agentAvatarBundleTestZIP(t, `{"version":1,"width":480,"height":432,"clips":{"idle":"idle.mp4"}}`, map[string][]byte{"idle.mp4": agentAvatarTestMP4()})
	header := multipartFileHeader(t, "avatar.zip", "application/zip", data)
	for _, actor := range []*model.User{nil, {ID: owner.ID, Status: "disabled"}, {Status: model.UserStatusActive}} {
		if _, err := svc.UploadPersonalAgentAvatarBundle(actor, header); err == nil {
			t.Fatal("invalid account uploaded a bundle")
		}
		if _, err := svc.UploadPersonalLive2D(actor, header); err == nil {
			t.Fatal("invalid account uploaded a model")
		}
	}
	if _, err := svc.UploadPersonalAgentAvatarBundle(owner, multipartFileHeader(t, "bad.zip", "application/zip", []byte("invalid"))); err == nil {
		t.Fatal("invalid ZIP accepted")
	}
	if err := db.Create(&model.Resource{ID: "quota-filled", UserID: owner.ID, Status: model.ResourceStatusReady, Size: gigabytes(defaultRuntimePolicy().Resource.StoredFileGB)}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UploadPersonalAgentAvatarBundle(owner, header); err == nil {
		t.Fatal("upload bypassed account storage quota")
	}
	var count int64
	db.Model(&model.Resource{}).Where("user_id = ?", owner.ID).Count(&count)
	if count != 1 {
		t.Fatalf("failed uploads left resources: %d", count)
	}
}
