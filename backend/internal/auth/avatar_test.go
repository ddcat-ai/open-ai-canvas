package auth

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"hash/crc32"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"mime/multipart"
	"net/http/httptest"
	"strings"
	"testing"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func avatarTestService(t *testing.T) (*Service, *gorm.DB, *model.User) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+kernel.NewID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.UserAvatar{}, &model.UserIdentity{}); err != nil {
		t.Fatal(err)
	}
	user := &model.User{ID: "avatar-user", Username: "avatar-user", DisplayName: "Before", Role: model.UserRoleUser, Status: model.UserStatusActive, PasswordHash: "preserved-hash"}
	if err := db.Create(user).Error; err != nil {
		t.Fatal(err)
	}
	return New(repository.New(db), nil, nil), db, user
}

func avatarFileHeader(t *testing.T, data []byte) *multipart.FileHeader {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "untrusted-name.txt")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(data); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("PUT", "/", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	if err := req.ParseMultipartForm(MaxProfileAvatarBytes + 1024); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = req.MultipartForm.RemoveAll() })
	return req.MultipartForm.File["file"][0]
}

func avatarPNG(t *testing.T, source image.Image) []byte {
	t.Helper()
	var data bytes.Buffer
	if err := png.Encode(&data, source); err != nil {
		t.Fatal(err)
	}
	return data.Bytes()
}

func avatarStatus(t *testing.T, err error, status int) {
	t.Helper()
	var appErr *kernel.AppError
	if !errors.As(err, &appErr) || appErr.Status != status {
		t.Fatalf("error = %v, want status %d", err, status)
	}
}

func TestProfileAvatarLifecyclePersistsAndOverridesLinkedAvatar(t *testing.T) {
	s, db, actor := avatarTestService(t)
	identity := model.UserIdentity{ID: "identity-avatar", UserID: actor.ID, Provider: "linuxdo", Subject: "123", AvatarURL: "https://example.com/linked.png"}
	if err := db.Create(&identity).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.User{}).Where("id = ?", actor.ID).Update("display_name", "Latest").Error; err != nil {
		t.Fatal(err)
	}
	result, err := s.UpdateProfileAvatar(actor, avatarFileHeader(t, avatarPNG(t, image.NewRGBA(image.Rect(0, 0, 8, 4)))))
	if err != nil {
		t.Fatal(err)
	}
	if result.AvatarMode != "custom" || !strings.HasPrefix(result.AvatarURL, "/api/auth/profile/avatar/avatar-user?v=") || result.IdentityID != "123" || result.DisplayName != "Latest" || result.PasswordHash != "preserved-hash" {
		t.Fatalf("unexpected uploaded profile: %#v", result)
	}
	publicJSON, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(publicJSON, []byte(`"avatarVersion"`)) || bytes.Contains(publicJSON, []byte("preserved-hash")) || !bytes.Contains(publicJSON, []byte(`"avatarMode":"custom"`)) {
		t.Fatalf("unexpected public avatar JSON: %s", publicJSON)
	}
	fresh, err := s.repo.User(actor.ID)
	if err != nil {
		t.Fatal(err)
	}
	refreshed, err := s.PublicAuthUser(fresh)
	if err != nil || refreshed.AvatarURL != result.AvatarURL {
		t.Fatalf("refreshed avatar = %q, error %v", refreshed.AvatarURL, err)
	}
	data, err := s.ProfileAvatarContent(actor, actor.ID)
	if err != nil {
		t.Fatal(err)
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || format != "png" || config.Width != 4 || config.Height != 4 {
		t.Fatalf("normalized config = %#v, %s, %v", config, format, err)
	}
	_, err = s.ProfileAvatarContent(actor, "other-user")
	avatarStatus(t, err, 403)
	result, err = s.UseDefaultProfileAvatar(actor)
	if err != nil {
		t.Fatal(err)
	}
	if result.AvatarMode != "default" || result.AvatarPreset != "person" || result.AvatarURL != "" || result.AvatarVersion != "" || result.IdentityID != "123" {
		t.Fatalf("unexpected default profile: %#v", result)
	}
	var count int64
	if err := db.Model(&model.UserAvatar{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("remaining avatar blobs = %d, error %v", count, err)
	}
	fresh, err = s.repo.User(actor.ID)
	if err != nil {
		t.Fatal(err)
	}
	refreshed, err = s.PublicAuthUser(fresh)
	if err != nil || refreshed.AvatarURL != "" || refreshed.IdentityProvider != "linuxdo" {
		t.Fatalf("default selection did not survive refresh: %#v, %v", refreshed, err)
	}
	_, err = s.ProfileAvatarContent(actor, actor.ID)
	avatarStatus(t, err, 404)
}

func TestProfileAvatarRequiresActiveAuthenticatedOwner(t *testing.T) {
	s, db, actor := avatarTestService(t)
	_, err := s.UseDefaultProfileAvatar(nil)
	avatarStatus(t, err, 401)
	_, err = s.ProfileAvatarContent(&model.User{}, actor.ID)
	avatarStatus(t, err, 401)
	_, err = s.UpdateProfileAvatar(&model.User{ID: actor.ID, Status: model.UserStatusDisabled}, nil)
	avatarStatus(t, err, 403)
	if err := db.Model(actor).Update("status", model.UserStatusDisabled).Error; err != nil {
		t.Fatal(err)
	}
	staleActive := &model.User{ID: actor.ID, Status: model.UserStatusActive}
	_, err = s.UseDefaultProfileAvatar(staleActive)
	avatarStatus(t, err, 403)
	_, err = s.ProfileAvatarContent(staleActive, actor.ID)
	avatarStatus(t, err, 403)
	_, err = s.repo.UpdateUserAvatar(actor.ID, []byte("cannot-write"), "version", "", actor.UpdatedAt)
	if !errors.Is(err, repository.ErrProfileAvatarUserUnavailable) {
		t.Fatalf("repository permitted disabled user write: %v", err)
	}
}

func TestProfileAvatarRejectsInvalidUploadsWithoutChangingSelection(t *testing.T) {
	s, _, actor := avatarTestService(t)
	valid := avatarPNG(t, image.NewRGBA(image.Rect(0, 0, 2, 2)))
	before, err := s.UpdateProfileAvatar(actor, avatarFileHeader(t, valid))
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name string
		data []byte
	}{
		{name: "svg", data: []byte(`<svg xmlns="http://www.w3.org/2000/svg"></svg>`)},
		{name: "corrupt png", data: valid[:len(valid)-8]},
		{name: "empty", data: nil},
		{name: "oversized actual bytes", data: bytes.Repeat([]byte("x"), int(MaxProfileAvatarBytes+1))},
	} {
		t.Run(test.name, func(t *testing.T) {
			header := avatarFileHeader(t, test.data)
			header.Size = 1 // Enforce bytes read even if metadata understates size.
			_, err := s.UpdateProfileAvatar(actor, header)
			avatarStatus(t, err, 400)
		})
	}
	fresh, err := s.repo.User(actor.ID)
	if err != nil {
		t.Fatal(err)
	}
	if fresh.AvatarMode != "custom" || fresh.AvatarVersion != before.AvatarVersion {
		t.Fatalf("rejected upload changed selection: %#v", fresh)
	}
	_, err = s.UpdateProfileAvatar(actor, nil)
	avatarStatus(t, err, 400)
}

func TestNormalizeProfileAvatarCenterCropResizeAndJPEG(t *testing.T) {
	wide := image.NewRGBA(image.Rect(0, 0, 6, 2))
	for y := 0; y < 2; y++ {
		for x := 0; x < 6; x++ {
			pixel := color.RGBA{R: 255, A: 255}
			if x == 2 || x == 3 {
				pixel = color.RGBA{G: 255, A: 255}
			}
			wide.SetRGBA(x, y, pixel)
		}
	}
	normalized, err := normalizeProfileAvatar(avatarPNG(t, wide))
	if err != nil {
		t.Fatal(err)
	}
	cropped, err := png.Decode(bytes.NewReader(normalized))
	if err != nil {
		t.Fatal(err)
	}
	if cropped.Bounds().Dx() != 2 || cropped.Bounds().Dy() != 2 {
		t.Fatal("crop was not square")
	}
	for y := 0; y < 2; y++ {
		for x := 0; x < 2; x++ {
			r, g, b, _ := cropped.At(x, y).RGBA()
			if r != 0 || g != 65535 || b != 0 {
				t.Fatalf("crop includes non-centered pixel at %d,%d", x, y)
			}
		}
	}
	var jpegData bytes.Buffer
	if err := jpeg.Encode(&jpegData, image.NewRGBA(image.Rect(0, 0, 1024, 768)), nil); err != nil {
		t.Fatal(err)
	}
	normalized, err = normalizeProfileAvatar(jpegData.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(normalized))
	if err != nil || format != "png" || config.Width != 512 || config.Height != 512 {
		t.Fatalf("resized JPEG = %#v, %s, %v", config, format, err)
	}
}

func TestNormalizeProfileAvatarRejectsPixelLimitBeforeDecode(t *testing.T) {
	data := avatarPNG(t, image.NewRGBA(image.Rect(0, 0, 1, 1)))
	// Replace IHDR dimensions and checksum without allocating a large image.
	binary.BigEndian.PutUint32(data[16:20], 5000)
	binary.BigEndian.PutUint32(data[20:24], 5000)
	binary.BigEndian.PutUint32(data[29:33], crc32.ChecksumIEEE(data[12:29]))
	_, err := normalizeProfileAvatar(data)
	avatarStatus(t, err, 400)
	if err.Error() != "头像图片不能超过 1600 万像素" {
		t.Fatalf("pixel cap was not checked before decode: %v", err)
	}
}

func TestProfileAvatarTransactionRollsBackBlobFailures(t *testing.T) {
	s, db, actor := avatarTestService(t)
	if _, err := s.SelectDefaultProfileAvatar(actor, "cat"); err != nil {
		t.Fatal(err)
	}
	firstData := avatarPNG(t, image.NewRGBA(image.Rect(0, 0, 2, 2)))
	before, err := s.UpdateProfileAvatar(actor, avatarFileHeader(t, firstData))
	if err != nil {
		t.Fatal(err)
	}
	beforeBlob, err := s.ProfileAvatarContent(actor, actor.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name string
		sql  string
		call func() error
	}{
		{name: "update", sql: "CREATE TRIGGER fail_avatar_update BEFORE INSERT ON user_avatars BEGIN SELECT RAISE(ABORT, 'avatar write failed'); END", call: func() error {
			_, err := s.UpdateProfileAvatar(actor, avatarFileHeader(t, avatarPNG(t, image.NewRGBA(image.Rect(0, 0, 4, 4)))))
			return err
		}},
		{name: "delete", sql: "CREATE TRIGGER fail_avatar_delete BEFORE DELETE ON user_avatars BEGIN SELECT RAISE(ABORT, 'avatar delete failed'); END", call: func() error {
			_, err := s.UseDefaultProfileAvatar(actor)
			return err
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			if err := db.Exec(test.sql).Error; err != nil {
				t.Fatal(err)
			}
			if err := test.call(); err == nil {
				t.Fatal("storage failure was swallowed")
			}
			fresh, err := s.repo.User(actor.ID)
			if err != nil || fresh.AvatarMode != "custom" || fresh.AvatarVersion != before.AvatarVersion || fresh.AvatarPreset != "cat" {
				t.Fatalf("avatar selection was not rolled back: %#v, %v", fresh, err)
			}
			data, err := s.ProfileAvatarContent(actor, actor.ID)
			if err != nil || !bytes.Equal(data, beforeBlob) {
				t.Fatalf("avatar blob was not retained after rollback: %v", err)
			}
		})
	}
}

func TestProfileAvatarPresetsValidatePersistAndKeepLinkedIdentity(t *testing.T) {
	s, db, actor := avatarTestService(t)
	if err := db.Create(&model.UserIdentity{ID: "preset-identity", UserID: actor.ID, Provider: "linuxdo", Subject: "123", AvatarURL: "https://example.com/linked.png"}).Error; err != nil {
		t.Fatal(err)
	}
	for _, preset := range []string{"person", "director", "camera", "cat", "rabbit", "robot", "rocket", "sparkles"} {
		t.Run(preset, func(t *testing.T) {
			result, err := s.SelectDefaultProfileAvatar(actor, preset)
			if err != nil {
				t.Fatal(err)
			}
			if result.AvatarMode != "default" || result.AvatarPreset != preset || result.AvatarURL != "" || result.AvatarVersion != "" || result.IdentityID != "123" {
				t.Fatalf("unexpected preset response: %#v", result)
			}
			data, err := json.Marshal(result)
			if err != nil || !bytes.Contains(data, []byte(`"avatarPreset":"`+preset+`"`)) || bytes.Contains(data, []byte(`"avatarVersion"`)) {
				t.Fatalf("unexpected serialized preset: %s, %v", data, err)
			}
			fresh, err := s.repo.User(actor.ID)
			if err != nil {
				t.Fatal(err)
			}
			refreshed, err := s.PublicAuthUser(fresh)
			if err != nil || refreshed.AvatarPreset != preset || refreshed.AvatarURL != "" {
				t.Fatalf("preset did not survive refresh: %#v, %v", refreshed, err)
			}
		})
	}
	before, err := s.UpdateProfileAvatar(actor, avatarFileHeader(t, avatarPNG(t, image.NewRGBA(image.Rect(0, 0, 2, 2)))))
	if err != nil {
		t.Fatal(err)
	}
	if before.AvatarPreset != "sparkles" || before.AvatarMode != "custom" {
		t.Fatalf("custom upload lost preset preference: %#v", before)
	}
	beforeBlob, err := s.ProfileAvatarContent(actor, actor.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, invalid := range []string{"", "Cat", " cat", "cat ", "default", "../person", "person,cat", "https://example.com/icon.svg"} {
		_, err := s.SelectDefaultProfileAvatar(actor, invalid)
		avatarStatus(t, err, 400)
	}
	fresh, err := s.repo.User(actor.ID)
	if err != nil || fresh.AvatarPreset != before.AvatarPreset || fresh.AvatarVersion != before.AvatarVersion || fresh.AvatarMode != "custom" {
		t.Fatalf("invalid selection mutated user: %#v, %v", fresh, err)
	}
	afterBlob, err := s.ProfileAvatarContent(actor, actor.ID)
	if err != nil || !bytes.Equal(beforeBlob, afterBlob) {
		t.Fatalf("invalid preset changed custom blob: %v", err)
	}
	selected, err := s.SelectDefaultProfileAvatar(actor, "rabbit")
	if err != nil || selected.AvatarPreset != "rabbit" || selected.AvatarVersion != "" || selected.AvatarMode != "default" {
		t.Fatalf("custom-to-preset failed: %#v, %v", selected, err)
	}
	var count int64
	if err := db.Model(&model.UserAvatar{}).Where("user_id = ?", actor.ID).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("custom blob not removed by preset: %d, %v", count, err)
	}
}
