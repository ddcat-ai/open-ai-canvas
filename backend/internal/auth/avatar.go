package auth

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"image"
	"image/color"
	_ "image/jpeg"
	"image/png"
	"io"
	"mime/multipart"
	"net/url"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/gorm"
)

const MaxProfileAvatarBytes int64 = 5 << 20
const maxProfileAvatarPixels = 16_000_000
const maxProfileAvatarSide = 512

func profileAvatarURL(user *model.User) string {
	return "/api/auth/profile/avatar/" + url.PathEscape(user.ID) + "?v=" + url.QueryEscape(user.AvatarVersion)
}

func (s *Service) avatarActor(actor *model.User) (*model.User, error) {
	if actor == nil || actor.ID == "" {
		return nil, kernel.Unauthorized("请先登录")
	}
	if actor.Status != model.UserStatusActive {
		return nil, kernel.Forbidden("该账号已被禁用")
	}
	user, err := s.repo.User(actor.ID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, kernel.Unauthorized("登录状态已失效")
	}
	if err != nil {
		return nil, err
	}
	if user.Status != model.UserStatusActive {
		return nil, kernel.Forbidden("该账号已被禁用")
	}
	return user, nil
}

func (s *Service) UpdateProfileAvatar(actor *model.User, header *multipart.FileHeader) (*AuthUser, error) {
	user, err := s.avatarActor(actor)
	if err != nil {
		return nil, err
	}
	if header == nil {
		return nil, kernel.BadAuthRequest("请选择头像图片")
	}
	if header.Size > MaxProfileAvatarBytes {
		return nil, kernel.BadAuthRequest("头像图片不能超过 5 MiB")
	}
	file, err := header.Open()
	if err != nil {
		return nil, kernel.WrapAppError(400, "无法读取头像图片", err)
	}
	data, readErr := io.ReadAll(io.LimitReader(file, MaxProfileAvatarBytes+1))
	closeErr := file.Close()
	if readErr != nil {
		return nil, kernel.WrapAppError(400, "无法读取头像图片", readErr)
	}
	if closeErr != nil {
		return nil, kernel.WrapAppError(500, "关闭头像文件失败", closeErr)
	}
	if int64(len(data)) > MaxProfileAvatarBytes {
		return nil, kernel.BadAuthRequest("头像图片不能超过 5 MiB")
	}
	normalized, err := normalizeProfileAvatar(data)
	if err != nil {
		return nil, err
	}
	hash := sha256.Sum256(normalized)
	return s.saveProfileAvatar(user, normalized, hex.EncodeToString(hash[:16]), "")
}

func (s *Service) UseDefaultProfileAvatar(actor *model.User) (*AuthUser, error) {
	return s.SelectDefaultProfileAvatar(actor, "person")
}

func (s *Service) SelectDefaultProfileAvatar(actor *model.User, preset string) (*AuthUser, error) {
	user, err := s.avatarActor(actor)
	if err != nil {
		return nil, err
	}
	switch preset {
	case "person", "director", "camera", "cat", "rabbit", "robot", "rocket", "sparkles":
		return s.saveProfileAvatar(user, nil, "", preset)
	default:
		return nil, kernel.BadAuthRequest("请选择有效的系统头像")
	}
}

func (s *Service) saveProfileAvatar(user *model.User, data []byte, version string, preset string) (*AuthUser, error) {
	// Read linked identity metadata before writing, so an identity query failure
	// cannot report an unsuccessful write after the avatar already committed.
	result, err := s.PublicAuthUser(user)
	if err != nil {
		return nil, err
	}
	updated, err := s.repo.UpdateUserAvatar(user.ID, data, version, preset, time.Now())
	if errors.Is(err, repository.ErrProfileAvatarUserUnavailable) {
		return nil, kernel.Forbidden("该账号已被禁用或不存在")
	}
	if err != nil {
		return nil, err
	}
	result.User = *updated
	result.AvatarURL = ""
	if updated.AvatarMode == "custom" {
		result.AvatarURL = profileAvatarURL(updated)
	}
	return &result, nil
}

func (s *Service) ProfileAvatarContent(actor *model.User, targetUserID string) ([]byte, error) {
	user, err := s.avatarActor(actor)
	if err != nil {
		return nil, err
	}
	if targetUserID != user.ID {
		return nil, kernel.Forbidden("无权读取其他用户头像")
	}
	if user.AvatarMode != "custom" {
		return nil, kernel.NotFound("未设置自定义头像")
	}
	avatar, err := s.repo.UserAvatar(user.ID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, kernel.NotFound("头像图片不存在")
	}
	if err != nil {
		return nil, err
	}
	return avatar.Data, nil
}

func normalizeProfileAvatar(data []byte) ([]byte, error) {
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || (format != "png" && format != "jpeg") {
		return nil, kernel.BadAuthRequest("头像仅支持有效的 PNG 或 JPEG 图片")
	}
	if config.Width <= 0 || config.Height <= 0 || config.Width > maxProfileAvatarPixels/config.Height {
		return nil, kernel.BadAuthRequest("头像图片不能超过 1600 万像素")
	}
	source, decodedFormat, err := image.Decode(bytes.NewReader(data))
	if err != nil || decodedFormat != format || source.Bounds().Dx() != config.Width || source.Bounds().Dy() != config.Height {
		return nil, kernel.BadAuthRequest("头像图片已损坏")
	}
	span := min(config.Width, config.Height)
	side := min(span, maxProfileAvatarSide)
	left := source.Bounds().Min.X + (config.Width-span)/2
	top := source.Bounds().Min.Y + (config.Height-span)/2
	output := image.NewRGBA(image.Rect(0, 0, side, side))
	// Interpolate premultiplied colors at pixel centers, matching a centered
	// object-cover preview while preserving transparent PNG edges.
	for y := 0; y < side; y++ {
		fy := max(0, (float64(y)+0.5)*float64(span)/float64(side)-0.5)
		y0 := int(fy)
		y1 := min(y0+1, span-1)
		wy := fy - float64(y0)
		for x := 0; x < side; x++ {
			fx := max(0, (float64(x)+0.5)*float64(span)/float64(side)-0.5)
			x0 := int(fx)
			x1 := min(x0+1, span-1)
			wx := fx - float64(x0)
			r0, g0, b0, a0 := source.At(left+x0, top+y0).RGBA()
			r1, g1, b1, a1 := source.At(left+x1, top+y0).RGBA()
			r2, g2, b2, a2 := source.At(left+x0, top+y1).RGBA()
			r3, g3, b3, a3 := source.At(left+x1, top+y1).RGBA()
			channel := func(c0, c1, c2, c3 uint32) uint8 {
				value := (float64(c0)*(1-wx)+float64(c1)*wx)*(1-wy) + (float64(c2)*(1-wx)+float64(c3)*wx)*wy
				return uint8(value/257 + 0.5)
			}
			output.SetRGBA(x, y, color.RGBA{R: channel(r0, r1, r2, r3), G: channel(g0, g1, g2, g3), B: channel(b0, b1, b2, b3), A: channel(a0, a1, a2, a3)})
		}
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, output); err != nil {
		return nil, kernel.WrapAppError(500, "头像图片处理失败", err)
	}
	return encoded.Bytes(), nil
}
