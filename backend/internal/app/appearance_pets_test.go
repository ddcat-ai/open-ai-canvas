package app

import (
	"strconv"
	"testing"
	"yingce/backend/internal/model"
)

func TestPetCatalogPreservesUpstreamBundleAndPublication(t *testing.T) {
	s, _, _, admin := newAppearanceTestService(t)
	value := defaultAppearanceSetting()
	seedPetCatalog(&value)
	if value.Canvas.AvatarType != "bundle" || value.PetCatalog[0].ID == "builtin-orb" || value.PetCatalog[0].AvatarClipStates["running"] != "working_loop" {
		t.Fatal("upstream default bundle was replaced")
	}
	data := agentAvatarBundleTestZIP(t, `{"version":1,"width":480,"height":432,"clips":{"idle":"idle.mp4"}}`, map[string][]byte{"idle.mp4": agentAvatarTestMP4()})
	imported, err := s.UploadAgentAvatarBundle(admin, multipartFileHeader(t, "avatar.zip", "application/zip", data))
	if err != nil {
		t.Fatal(err)
	}
	value.PetCatalog = append(value.PetCatalog, PetAppearance{ID: "custom-bundle", Name: "动画包", AvatarType: "bundle", AvatarHeight: 220, AvatarBundleResourceID: imported.ResourceID, AvatarClipStates: map[string]string{"idle": "idle"}})
	if _, err = s.UpdateAppearance(admin, value); err != nil {
		t.Fatal(err)
	}
	if _, _, err = s.AgentAvatarBundleAsset(nil, imported.ResourceID, "idle.mp4"); err == nil {
		t.Fatal("draft bundle leaked")
	}
	value.PetCatalog[len(value.PetCatalog)-1].Published = true
	if _, err = s.UpdateAppearance(admin, value); err != nil {
		t.Fatal(err)
	}
	if _, _, err = s.AgentAvatarBundleAsset(nil, imported.ResourceID, "idle.mp4"); err != nil {
		t.Fatal(err)
	}
	if len(s.appearanceResourceReferences([]string{imported.ResourceID})[imported.ResourceID]) == 0 {
		t.Fatal("catalog bundle lost deletion protection")
	}
	value.PetCatalog[len(value.PetCatalog)-1].Published = false
	if _, err = s.UpdateAppearance(admin, value); err != nil {
		t.Fatal(err)
	}
	if _, _, err = s.AgentAvatarBundleAsset(nil, imported.ResourceID, "idle.mp4"); err == nil {
		t.Fatal("unpublished bundle remains public")
	}
}

func TestPetCatalogCapacity(t *testing.T) {
	s, _, _, admin := newAppearanceTestService(t)
	value := defaultAppearanceSetting()
	seedPetCatalog(&value)
	for i := len(value.PetCatalog); i < 64; i++ {
		value.PetCatalog = append(value.PetCatalog, PetAppearance{ID: "pet-" + strconv.Itoa(i), Name: "角色" + strconv.Itoa(i), Published: true, AvatarType: "orb", AvatarHeight: 220})
	}
	saved, err := s.UpdateAppearance(admin, value)
	if err != nil {
		t.Fatal(err)
	}
	if len(saved.Public.PetCatalog) != 64 {
		t.Fatal("published catalog truncated")
	}
	value.PetCatalog = append(value.PetCatalog, PetAppearance{ID: "overflow", Name: "超额", Published: true, AvatarType: "orb", AvatarHeight: 220})
	if _, err = s.UpdateAppearance(admin, value); err == nil {
		t.Fatal("oversized catalog accepted")
	}
}

func TestPetCatalogPublishUnpublishAndReferenceProtection(t *testing.T) {
	s, _, _, admin := newAppearanceTestService(t)
	data := live2DTestZIP(t, spriteFixture(t, false))
	imported, err := s.UploadSpritePet(admin, multipartFileHeader(t, "pet.zip", "application/zip", data))
	if err != nil {
		t.Fatal(err)
	}
	value := defaultAppearanceSetting()
	value.Canvas.AvatarType = "orb"
	seedPetCatalog(&value)
	value.PetCatalog = append(value.PetCatalog, PetAppearance{ID: "draft-pet", Name: "草稿角色", AvatarType: "sprite", AvatarHeight: 220, SpriteResourceID: imported.ResourceID, Sprite: imported.Config})
	saved, err := s.UpdateAppearance(admin, value)
	if err != nil {
		t.Fatal(err)
	}
	if len(saved.Public.PetCatalog) != 1 {
		t.Fatal("draft leaked into public catalog")
	}
	if _, _, err = s.SpriteAsset(nil, imported.ResourceID); err == nil {
		t.Fatal("draft asset public")
	}
	if len(s.appearanceResourceReferences([]string{imported.ResourceID})[imported.ResourceID]) == 0 {
		t.Fatal("draft resource unprotected")
	}
	value = saved.AppearanceSetting
	value.PetCatalog[1].Published = true
	saved, err = s.UpdateAppearance(admin, value)
	if err != nil {
		t.Fatal(err)
	}
	if len(saved.Public.PetCatalog) != 2 {
		t.Fatal("published item missing")
	}
	if _, _, err = s.SpriteAsset(nil, imported.ResourceID); err != nil {
		t.Fatal(err)
	}
	value = saved.AppearanceSetting
	value.Canvas.DefaultPetID = "draft-pet"
	saved, err = s.UpdateAppearance(admin, value)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Canvas.SpriteResourceID != imported.ResourceID {
		t.Fatal("default not applied")
	}
	value = saved.AppearanceSetting
	value.PetCatalog[1].Published = false
	if _, err = s.UpdateAppearance(admin, value); err == nil {
		t.Fatal("unpublished default accepted")
	}
	value.Canvas.DefaultPetID = "builtin-orb"
	saved, err = s.UpdateAppearance(admin, value)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = s.SpriteAsset(nil, imported.ResourceID); err == nil {
		t.Fatal("unpublished asset remained public")
	}
	if saved.Canvas.AvatarType != "orb" {
		t.Fatal("default did not revert")
	}
	value = saved.AppearanceSetting
	value.PetCatalog[1].AvatarType = "orb"
	value.PetCatalog[1].Published = true
	saved, err = s.UpdateAppearance(admin, value)
	if err != nil {
		t.Fatal(err)
	}
	if saved.PetCatalog[1].SpriteResourceID != imported.ResourceID {
		t.Fatal("inactive imported resource lost")
	}
	if saved.Public.PetCatalog[1].SpriteResourceID != "" {
		t.Fatal("inactive resource advertised")
	}
	if _, _, err = s.SpriteAsset(nil, imported.ResourceID); err == nil {
		t.Fatal("inactive orb resource public")
	}
}

func TestPetPreferenceScopeValidationAndRevision(t *testing.T) {
	s, _, _, admin := newAppearanceTestService(t)
	other := &model.User{ID: "other-user", Status: model.UserStatusActive, Role: model.UserRoleUser}
	if _, err := s.PetPreference(nil); err == nil {
		t.Fatal("anonymous read accepted")
	}
	p, err := s.PetPreference(admin)
	if err != nil {
		t.Fatal(err)
	}
	if p.Scale != 100 || p.ModelID != "system" || p.Revision != 0 {
		t.Fatal(p)
	}
	p.Scale = 55
	p.Locked = true
	saved, err := s.UpdatePetPreference(admin, *p)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Revision != 1 {
		t.Fatal("no revision")
	}
	if _, err = s.UpdatePetPreference(admin, *p); err == nil {
		t.Fatal("stale write accepted")
	}
	second, err := s.PetPreference(other)
	if err != nil || second.Scale != 100 || second.Locked {
		t.Fatal("cross-account leak", err)
	}
	for _, scale := range []int{0, 49, 56, 151, 1000} {
		bad := *saved
		bad.Scale = scale
		if _, err = s.UpdatePetPreference(admin, bad); err == nil {
			t.Fatal("invalid scale", scale)
		}
	}
	bad := *saved
	bad.ModelID = "not-published"
	if _, err = s.UpdatePetPreference(admin, bad); err == nil {
		t.Fatal("arbitrary model accepted")
	}
	if _, err = s.UpdatePetPreference(nil, *saved); err == nil {
		t.Fatal("anonymous write accepted")
	}
}

func TestPetCatalogValidatesIdentityAndOwnership(t *testing.T) {
	s, _, _, admin := newAppearanceTestService(t)
	v := defaultAppearanceSetting()
	seedPetCatalog(&v)
	v.PetCatalog = append(v.PetCatalog, v.PetCatalog[0])
	if _, err := s.UpdateAppearance(admin, v); err == nil {
		t.Fatal("duplicate ID accepted")
	}
	v.PetCatalog = v.PetCatalog[:1]
	v.PetCatalog[0].ID = "../bad"
	if _, err := s.UpdateAppearance(admin, v); err == nil {
		t.Fatal("unsafe ID accepted")
	}
}
