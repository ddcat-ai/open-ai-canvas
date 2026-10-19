package app

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"
	"yingce/backend/internal/model"
)

func TestSpriteThumbnailCropCacheAndAccess(t *testing.T) {
	s, _, _, admin := newAppearanceTestService(t)
	files := spriteFixture(t, false)
	im := image.NewNRGBA(image.Rect(0, 0, 64, 64))
	for y := 0; y < 16; y++ {
		for x := 0; x < 16; x++ {
			im.Set(x, y, color.NRGBA{R: 255, A: 255})
			im.Set(x+16, y, color.NRGBA{B: 255, A: 255})
		}
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, im); err != nil {
		t.Fatal(err)
	}
	files["atlas.png"] = encoded.Bytes()
	data := live2DTestZIP(t, files)
	pet, err := s.UploadSpritePet(admin, multipartFileHeader(t, "pet.zip", "application/zip", data))
	if err != nil {
		t.Fatal(err)
	}
	thumb, mime, err := s.SpriteThumbnail(admin, pet.ResourceID, 16, 16, 0)
	if err != nil || mime != "image/png" {
		t.Fatalf("preview: %s %v", mime, err)
	}
	decoded, _, err := image.Decode(bytes.NewReader(thumb))
	if err != nil || decoded.Bounds().Dx() != 88 || decoded.Bounds().Dy() != 88 {
		t.Fatalf("size: %v %v", decoded, err)
	}
	r, _, b, _ := decoded.At(44, 44).RGBA()
	if r != 65535 || b != 0 {
		t.Fatal("wrong neutral frame")
	}
	second, _, err := s.SpriteThumbnail(admin, pet.ResourceID, 16, 16, 1)
	if err != nil || bytes.Equal(thumb, second) {
		t.Fatal("edited frame did not invalidate thumbnail")
	}
	for _, actor := range []*model.User{nil, {ID: "other", Role: model.UserRoleAdmin, Status: model.UserStatusActive}} {
		if _, _, err = s.SpriteThumbnail(actor, pet.ResourceID, 16, 16, 0); err == nil {
			t.Fatal("cached draft leaked")
		}
	}
	v := defaultAppearanceSetting()
	v.Canvas.AvatarType = "sprite"
	v.Canvas.SpriteResourceID = pet.ResourceID
	v.Canvas.Sprite = pet.Config
	if _, err = s.UpdateAppearance(admin, v); err != nil {
		t.Fatal(err)
	}
	public, _, err := s.SpriteThumbnail(nil, pet.ResourceID, 16, 16, 0)
	if err != nil || !bytes.Equal(public, thumb) {
		t.Fatalf("published cached thumbnail: %v", err)
	}
	if _, _, err = s.SpriteThumbnail(nil, pet.ResourceID, 16, 16, 1); err == nil {
		t.Fatal("arbitrary public frame accepted")
	}
	for _, params := range [][3]int{{0, 16, 0}, {16, 16, 999}, {13, 16, 0}, {4097, 16, 0}} {
		if _, _, err = s.SpriteThumbnail(admin, pet.ResourceID, params[0], params[1], params[2]); err == nil {
			t.Fatal("invalid crop accepted")
		}
	}
	atlas, _, err := s.SpriteAsset(nil, pet.ResourceID)
	if err != nil || !bytes.Equal(atlas, files["atlas.png"]) {
		t.Fatal("atlas modified")
	}
	v.Canvas.AvatarType = "orb"
	if _, err = s.UpdateAppearance(admin, v); err != nil {
		t.Fatal(err)
	}
	if _, _, err = s.SpriteThumbnail(nil, pet.ResourceID, 16, 16, 0); err == nil {
		t.Fatal("unpublished cached thumbnail leaked")
	}
}
