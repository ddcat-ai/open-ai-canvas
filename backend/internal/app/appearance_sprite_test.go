package app

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
	"testing"

	"yingce/backend/internal/model"
)

func spriteFixture(t *testing.T, codex bool) map[string][]byte {
	t.Helper()
	p := &SpritePet{DisplayName: "自定义角色", FrameWidth: 16, FrameHeight: 16, AtlasWidth: 64, AtlasHeight: 64, Speed: 1, LookStartFrame: -1, Actions: []SpriteAction{{ID: "idle", Label: "待机", Frames: 4, FPS: 4, Loop: true}, {ID: "sleep", Label: "睡觉", Row: 1, Frames: 2, FPS: 2, Loop: true}}, Bindings: SpriteBindings{Idle: "idle", Sleep: "sleep"}}
	manifest := map[string]any{"displayName": "测试宠物", "spritesheetPath": "atlas.png", "yinghui": p}
	if codex {
		p = codexSpritePet(2)
		manifest = map[string]any{"displayName": "Codex 测试宠物", "spritesheetPath": "atlas.png", "spriteVersionNumber": 2}
	}
	im := image.NewNRGBA(image.Rect(0, 0, p.AtlasWidth, p.AtlasHeight))
	im.Set(1, 1, color.NRGBA{R: 255, A: 255})
	var out bytes.Buffer
	if err := png.Encode(&out, im); err != nil {
		t.Fatal(err)
	}
	b, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	return map[string][]byte{"pet.json": b, "atlas.png": out.Bytes()}
}

func TestSpriteArchiveCustomAndCodex(t *testing.T) {
	for _, codex := range []bool{false, true} {
		data := live2DTestZIP(t, spriteFixture(t, codex))
		p, err := validateSpriteArchive(bytes.NewReader(data), int64(len(data)))
		if err != nil {
			t.Fatal(err)
		}
		if codex && (len(p.Actions) != 9 || p.LookDirections != 16 || p.NeutralFrame != 6) {
			t.Fatalf("bad Codex defaults: %+v", p)
		}
		if !codex && (p.FrameWidth != 16 || p.Bindings.Sleep != "sleep") {
			t.Fatalf("custom data lost: %+v", p)
		}
	}
}

func TestSpriteArchiveCodexVersionInference(t *testing.T) {
	for _, tt := range []struct {
		name          string
		width, height int
		version       any
		wantVersion   int
	}{
		{"legacy v1 without version", 1536, 1872, nil, 1},
		{"v2 without version", 1536, 2288, nil, 2},
		{"explicit v1", 1536, 1872, 1, 1},
		{"explicit v2", 1536, 2288, 2, 2},
		{"explicit v1 mismatches v2", 1536, 2288, 1, 0},
		{"explicit v2 mismatches v1", 1536, 1872, 2, 0},
		{"unsupported version", 1536, 1872, 3, 0},
		{"explicit zero", 1536, 1872, 0, 0},
		{"wrong width", 768, 1872, nil, 0},
		{"unknown height", 1536, 2080, nil, 0},
	} {
		t.Run(tt.name, func(t *testing.T) {
			manifest := map[string]any{"displayName": "旧版宠物", "spritesheetPath": "atlas.png"}
			if tt.version != nil {
				manifest["spriteVersionNumber"] = tt.version
			}
			body, err := json.Marshal(manifest)
			if err != nil {
				t.Fatal(err)
			}
			var atlas bytes.Buffer
			if err := png.Encode(&atlas, image.NewNRGBA(image.Rect(0, 0, tt.width, tt.height))); err != nil {
				t.Fatal(err)
			}
			data := live2DTestZIP(t, map[string][]byte{"pet.json": body, "atlas.png": atlas.Bytes()})
			p, err := validateSpriteArchive(bytes.NewReader(data), int64(len(data)))
			if tt.wantVersion == 0 {
				if err == nil {
					t.Fatal("unsupported layout or explicit version accepted")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			want := codexSpritePet(tt.wantVersion)
			if p.AtlasHeight != want.AtlasHeight || p.LookDirections != want.LookDirections || p.NeutralFrame != want.NeutralFrame || p.Bindings != want.Bindings || len(p.Actions) != 9 || p.SleepAfterSeconds != 0 || p.DisplayName != "旧版宠物" {
				t.Fatalf("inferred defaults differ from standard: %+v", p)
			}
		})
	}
}

func TestSpriteArchiveRejectsUnsafeAndMalformedPackages(t *testing.T) {
	for _, tt := range []struct {
		name   string
		mutate func(map[string][]byte)
	}{
		{"traversal", func(f map[string][]byte) { f["../escape.txt"] = []byte("x") }},
		{"script", func(f map[string][]byte) { f["run.js"] = []byte("x") }},
		{"case collision", func(f map[string][]byte) { f["ATLAS.png"] = f["atlas.png"] }},
		{"missing image", func(f map[string][]byte) { delete(f, "atlas.png") }},
		{"bad image", func(f map[string][]byte) { f["atlas.png"] = []byte("bad") }},
		{"bad manifest", func(f map[string][]byte) { f["pet.json"] = []byte(`{"spritesheetPath":"https://example.com/p.png"}`) }},
		{"extra image", func(f map[string][]byte) { f["extra.png"] = f["atlas.png"] }},
		{"extra manifest", func(f map[string][]byte) { f["nested/pet.json"] = f["pet.json"] }},
		{"wrong size", func(f map[string][]byte) {
			var m map[string]any
			_ = json.Unmarshal(f["pet.json"], &m)
			m["yinghui"].(map[string]any)["atlasWidth"] = 128
			f["pet.json"], _ = json.Marshal(m)
		}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			f := spriteFixture(t, false)
			tt.mutate(f)
			data := live2DTestZIP(t, f)
			if _, err := validateSpriteArchive(bytes.NewReader(data), int64(len(data))); err == nil {
				t.Fatal("unsafe package accepted")
			}
		})
	}
	if _, err := validateSpriteArchive(bytes.NewReader(nil), SpriteMaxBytes+1); err == nil {
		t.Fatal("oversized archive accepted")
	}
	var data bytes.Buffer
	z := zip.NewWriter(&data)
	h := &zip.FileHeader{Name: "pet.json"}
	h.SetMode(os.ModeSymlink | 0777)
	f, _ := z.CreateHeader(h)
	_, _ = f.Write([]byte("outside"))
	_ = z.Close()
	if _, err := validateSpriteArchive(bytes.NewReader(data.Bytes()), int64(data.Len())); err == nil {
		t.Fatal("symlink accepted")
	}
}

func TestSpriteConfigBoundsAndBindings(t *testing.T) {
	for _, tt := range []struct {
		name   string
		change func(*SpritePet)
	}{
		{"overflow", func(p *SpritePet) { p.Actions[0].Start = math.MaxInt; p.Actions[0].Frames = 2 }},
		{"row", func(p *SpritePet) { p.Actions[0].Row = 11 }},
		{"empty frames", func(p *SpritePet) { p.Actions[0].Frames = 0 }},
		{"duplicate", func(p *SpritePet) { p.Actions[1].ID = "idle" }},
		{"speed", func(p *SpritePet) { p.Speed = math.NaN() }},
		{"fps", func(p *SpritePet) { p.Actions[0].FPS = math.Inf(1) }},
		{"missing action", func(p *SpritePet) { p.Bindings.Working = "absent" }},
		{"missing idle", func(p *SpritePet) { p.Bindings.Idle = "" }},
		{"sleep without frames", func(p *SpritePet) { p.SleepAfterSeconds = 300 }},
		{"look out of bounds", func(p *SpritePet) { p.LookStartFrame = 100 }},
		{"look overflow", func(p *SpritePet) { p.LookStartFrame = math.MaxInt }},
	} {
		t.Run(tt.name, func(t *testing.T) {
			p := codexSpritePet(2)
			p.SpritesheetPath = "atlas.png"
			tt.change(p)
			if validateSpriteConfig(p) == nil {
				t.Fatal("bad config accepted")
			}
		})
	}
}

func TestSpriteAppearanceImportSavePublishAndDeletion(t *testing.T) {
	svc, _, _, admin := newAppearanceTestService(t)
	if _, err := svc.UploadSpritePet(nil, nil); err == nil {
		t.Fatal("anonymous upload accepted")
	}
	data := live2DTestZIP(t, spriteFixture(t, false))
	ordinary, err := svc.UploadResource(admin.ID, multipartFileHeader(t, "ordinary.zip", "application/zip", data), "sprite", 0, 0, 0)
	if err != nil || ordinary.Kind == "sprite" {
		t.Fatalf("ordinary upload claimed reserved kind: %+v %v", ordinary, err)
	}
	pet, err := svc.UploadSpritePet(admin, multipartFileHeader(t, "pet.zip", "application/zip", data))
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = svc.SpriteAsset(nil, pet.ResourceID); err == nil {
		t.Fatal("draft publicly accessible")
	}
	other := &model.User{ID: "other-admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	if _, _, err = svc.SpriteAsset(other, pet.ResourceID); err == nil {
		t.Fatal("other admin previewed draft")
	}
	if b, mime, err := svc.SpriteAsset(admin, pet.ResourceID); err != nil || mime != "image/png" || len(b) == 0 {
		t.Fatalf("draft preview failed: %s %v", mime, err)
	}
	v := defaultAppearanceSetting()
	v.Canvas.AvatarType = "sprite"
	v.Canvas.SpriteResourceID = pet.ResourceID
	v.Canvas.Sprite = pet.Config
	v.Canvas.Sprite.SleepAfterSeconds = 300
	v.Canvas.Sprite.Actions[0].FPS = 3
	if _, err = svc.UpdateAppearance(other, v); err == nil {
		t.Fatal("other admin enabled draft")
	}
	saved, err := svc.UpdateAppearance(admin, v)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Public.Canvas.Sprite.SleepAfterSeconds != 300 || saved.Public.Canvas.Sprite.Actions[0].FPS != 3 {
		t.Fatal("custom settings not persisted")
	}
	if _, _, err = svc.SpriteAsset(nil, pet.ResourceID); err != nil {
		t.Fatal(err)
	}
	page, err := svc.AdminResourcePage(admin, AdminResourceQuery{Kind: "sprite", Page: 1, Limit: 20})
	if err != nil {
		t.Fatal(err)
	}
	_ = page
	blocked, err := svc.DeleteAdminResources(admin, AdminResourceDeleteRequest{ResourceIDs: []string{pet.ResourceID}})
	if err != nil || len(blocked.Blocked) != 1 {
		t.Fatalf("missing deletion protection: %+v %v", blocked, err)
	}
	v.Canvas.Sprite.AtlasWidth = 128
	if _, err = svc.UpdateAppearance(admin, v); err == nil {
		t.Fatal("spoofed image dimensions accepted")
	}
	v.Canvas.Sprite.AtlasWidth = 64
	v.Canvas.AvatarType = "orb"
	if _, err = svc.UpdateAppearance(admin, v); err != nil {
		t.Fatal(err)
	}
	if _, _, err = svc.SpriteAsset(nil, pet.ResourceID); err == nil {
		t.Fatal("disabled sprite remains public")
	}
	v.Canvas.SpriteResourceID = ""
	if _, err = svc.UpdateAppearance(admin, v); err != nil {
		t.Fatal(err)
	}
	deleted, err := svc.DeleteAdminResources(admin, AdminResourceDeleteRequest{ResourceIDs: []string{pet.ResourceID}})
	if err != nil || len(deleted.Deleted) != 1 {
		t.Fatalf("detached sprite not deleted: %+v %v", deleted, err)
	}
}
