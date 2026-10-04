package app

import (
	"encoding/json"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func updateTestValue() UpdateAnnouncement {
	return UpdateAnnouncement{Enabled: true, CurrentVersion: "v2.0", Releases: []UpdateRelease{{ID: "release-1", Version: "v2.0", Title: "更新公告", Blocks: []UpdateBlock{{ID: "text-1", Type: "text", Text: "新增功能", Layout: "full"}}}}}
}

func TestUpdateAnnouncementSwitchSaveAndPublicProjection(t *testing.T) {
	svc, _, _, admin := newAppearanceTestService(t)
	setting := defaultAppearanceSetting()
	setting.BrandName = "影绘"
	setting.Updates = updateTestValue()
	saved, err := svc.UpdateAppearance(admin, setting)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Public.Updates.CurrentVersion != "v2.0" || len(saved.Public.Updates.Releases) != 1 {
		t.Fatalf("public update: %#v", saved.Public.Updates)
	}
	setting = saved.AppearanceSetting
	setting.Updates.Enabled = false
	if _, err := svc.UpdateAppearance(admin, setting); err != nil {
		t.Fatal(err)
	}
	public, err := svc.Appearance()
	if err != nil {
		t.Fatal(err)
	}
	if public.Updates.Enabled || public.Updates.CurrentVersion != "" || len(public.Updates.Releases) != 0 || public.BrandName != "影绘" {
		t.Fatalf("disabled projection: %#v", public)
	}
	adminValue, err := svc.AdminAppearance(admin)
	if err != nil {
		t.Fatal(err)
	}
	if len(adminValue.Updates.Releases) != 1 || adminValue.Updates.CurrentVersion != "v2.0" {
		t.Fatal("switch erased custom content")
	}
	adminValue.Updates.Enabled = true
	if _, err := svc.UpdateAppearance(admin, adminValue.AppearanceSetting); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateAppearance(&model.User{ID: "user", Role: model.UserRoleUser, Status: model.UserStatusActive}, setting); err == nil {
		t.Fatal("non-admin changed appearance")
	}
}

func TestUpdateAnnouncementValidation(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*UpdateAnnouncement)
	}{
		{"empty", func(v *UpdateAnnouncement) { v.Releases = nil }},
		{"version mismatch", func(v *UpdateAnnouncement) { v.CurrentVersion = "other" }},
		{"duplicate id", func(v *UpdateAnnouncement) { v.Releases[0].Blocks[0].ID = "release-1" }},
		{"duplicate version", func(v *UpdateAnnouncement) {
			v.Releases = append(v.Releases, UpdateRelease{ID: "release-2", Version: "v2.0"})
		}},
		{"blank text", func(v *UpdateAnnouncement) { v.Releases[0].Blocks[0].Text = " " }},
		{"unknown type", func(v *UpdateAnnouncement) { v.Releases[0].Blocks[0].Type = "html" }},
		{"unknown layout", func(v *UpdateAnnouncement) { v.Releases[0].Blocks[0].Layout = "script" }},
		{"missing media", func(v *UpdateAnnouncement) { v.Releases[0].Blocks[0].Type = "video" }},
		{"invalid date", func(v *UpdateAnnouncement) { v.Releases[0].Date = "2026-02-30" }},
		{"control characters", func(v *UpdateAnnouncement) { v.CurrentVersion = "v\x00bad" }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			v := updateTestValue()
			tc.mutate(&v)
			if _, err := normalizeUpdateAnnouncement(v); err == nil {
				t.Fatal("invalid input accepted")
			}
		})
	}
	value := updateTestValue()
	value.Releases[0].Blocks[0].MediaURL = "javascript:alert(1)"
	clean, err := normalizeUpdateAnnouncement(value)
	if err != nil || clean.Releases[0].Blocks[0].MediaURL != "" {
		t.Fatal("client media URL retained")
	}
}

func TestUpdateAnnouncementMediaOwnershipPublicationAndDeletionProtection(t *testing.T) {
	svc, db, dir, admin := newAppearanceTestService(t)
	resources := []model.Resource{
		{ID: "update-image", UserID: admin.ID, Kind: "image", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "test/image.png", MimeType: "image/png", Size: 12},
		{ID: "other-image", UserID: "other-admin", Kind: "image", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "test/other.png", MimeType: "image/png", Size: 12},
		{ID: "update-video", UserID: admin.ID, Kind: "video", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "test/video.mp4", MimeType: "video/mp4", Size: 12},
	}
	if err := db.Create(&resources).Error; err != nil {
		t.Fatal(err)
	}
	writeAppearanceResourceFixtures(t, dir, resources)
	setting := defaultAppearanceSetting()
	setting.Updates = updateTestValue()
	setting.Updates.Releases[0].Blocks = append(setting.Updates.Releases[0].Blocks, UpdateBlock{ID: "image-1", Type: "image", ResourceID: "other-image", Layout: "half"})
	if _, err := svc.UpdateAppearance(admin, setting); err == nil {
		t.Fatal("other admin's unpublished resource accepted")
	}
	setting.Updates.Releases[0].Blocks[1].ResourceID = "update-image"
	setting.Updates.Releases[0].Blocks = append(setting.Updates.Releases[0].Blocks, UpdateBlock{ID: "video-1", Type: "video", ResourceID: "update-video", Layout: "half"})
	if _, err := svc.PrepareUpdateAnnouncementDelivery(nil, "update-image", ResourceAccessOptions{}, ""); err == nil {
		t.Fatal("unpublished media was public")
	}
	if _, err := svc.PrepareUpdateAnnouncementDelivery(admin, "other-image", ResourceAccessOptions{}, ""); err == nil {
		t.Fatal("other admin draft was previewable")
	}
	saved, err := svc.UpdateAppearance(admin, setting)
	if err != nil {
		t.Fatal(err)
	}
	block := saved.Public.Updates.Releases[0].Blocks[1]
	if !strings.Contains(block.MediaURL, "/api/public/appearance/updates/update-image?v=") {
		t.Fatalf("media URL: %s", block.MediaURL)
	}
	if saved.Updates.Releases[0].Blocks[1].MediaURL != "" {
		t.Fatal("public projection modified private setting")
	}
	refs := svc.appearanceResourceReferences([]string{"update-image", "update-video"})
	if len(refs["update-image"]) == 0 || len(refs["update-video"]) == 0 {
		t.Fatal("announcement resources not protected")
	}
	for _, id := range []string{"update-image", "update-video"} {
		delivery, err := svc.PrepareUpdateAnnouncementDelivery(nil, id, ResourceAccessOptions{}, "")
		if err != nil {
			t.Fatal(err)
		}
		if delivery.Stream != nil {
			delivery.Stream.Body.Close()
		}
	}
	ranged, err := svc.PrepareUpdateAnnouncementDelivery(nil, "update-video", ResourceAccessOptions{}, "bytes=0-3")
	if err != nil {
		t.Fatal(err)
	}
	if ranged.Stream == nil || ranged.Stream.AcceptRanges != "bytes" {
		t.Fatalf("video Range stream: %#v", ranged)
	}
	ranged.Stream.Body.Close()
	setting = saved.AppearanceSetting
	setting.Updates.Enabled = false
	if _, err := svc.UpdateAppearance(admin, setting); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.PrepareUpdateAnnouncementDelivery(nil, "update-image", ResourceAccessOptions{}, ""); err == nil {
		t.Fatal("disabled media remains public")
	}
	if len(svc.appearanceResourceReferences([]string{"update-image"})["update-image"]) == 0 {
		t.Fatal("disabled draft lost deletion protection")
	}
	private, _ := json.Marshal(setting.Updates)
	public := publicUpdateAnnouncement(setting.Updates, "rev")
	projected, _ := json.Marshal(public)
	if strings.Contains(string(projected), "新增功能") || !strings.Contains(string(private), "新增功能") {
		t.Fatal("disabled draft exposure")
	}
}

func TestUpdateAnnouncementUploadTypesAndSizes(t *testing.T) {
	for _, slot := range []string{AppearanceAssetUpdateImage, AppearanceAssetUpdateVideo} {
		max, err := AppearanceAssetMaxBytes(slot)
		if err != nil {
			t.Fatal(err)
		}
		if slot == AppearanceAssetUpdateImage && max != 10<<20 || slot == AppearanceAssetUpdateVideo && max != 256<<20 {
			t.Fatalf("limit %s %d", slot, max)
		}
		fake := multipartFileHeader(t, "fake.png", "image/png", []byte("not media"))
		if _, err := validateAppearanceUpload(slot, fake); err == nil {
			t.Fatal("fake media accepted")
		}
	}
}
