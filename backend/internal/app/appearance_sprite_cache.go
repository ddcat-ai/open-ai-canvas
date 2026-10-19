package app

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"sort"

	"golang.org/x/image/draw"
	"yingce/backend/internal/model"
)

const spriteDiskCacheBudget int64 = 256 << 20

// Derivatives are disposable; the original resource remains the source of truth.
func (s *Service) cachedSpriteBytes(r *model.Resource, variant string, build func() ([]byte, error)) ([]byte, error) {
	key := fmt.Sprintf("%x", sha256.Sum256([]byte(fmt.Sprintf("v1:%s:%d:%s", r.ID, r.Size, variant))))
	dir := filepath.Join(s.dataDir, "cache", "sprite-v1")
	file := filepath.Join(dir, key)
	if b, err := os.ReadFile(file); err == nil {
		return b, nil
	}
	s.spriteCacheMu.Lock()
	defer s.spriteCacheMu.Unlock()
	if b, err := os.ReadFile(file); err == nil {
		return b, nil
	}
	b, err := build()
	if err != nil {
		return nil, err
	}
	if err = os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	var files []os.FileInfo
	var total int64
	for _, entry := range entries {
		if info, e := entry.Info(); e == nil && info.Mode().IsRegular() {
			files = append(files, info)
			total += info.Size()
		}
	}
	sort.Slice(files, func(i, j int) bool { return files[i].ModTime().Before(files[j].ModTime()) })
	for _, info := range files {
		if total+int64(len(b)) <= spriteDiskCacheBudget {
			break
		}
		if err = os.Remove(filepath.Join(dir, info.Name())); err != nil {
			return nil, err
		}
		total -= info.Size()
	}
	tmp, err := os.CreateTemp(dir, ".sprite-")
	if err != nil {
		return nil, err
	}
	defer os.Remove(tmp.Name())
	if _, err = tmp.Write(b); err != nil {
		tmp.Close()
		return nil, err
	}
	if err = tmp.Close(); err != nil {
		return nil, err
	}
	if err = os.Rename(tmp.Name(), file); err != nil {
		return nil, err
	}
	return b, nil
}

// Only published layouts are accepted publicly; admin previews may use an edited neutral frame.
func (s *Service) SpriteThumbnail(actor *model.User, id string, width, height, frame int) ([]byte, string, error) {
	r, err := s.spriteReadResource(actor, id)
	if err != nil {
		return nil, "", err
	}
	_, appearance, err := s.readAppearance()
	if err != nil {
		return nil, "", err
	}
	matches := func(p *SpritePet) bool {
		return p != nil && p.FrameWidth == width && p.FrameHeight == height && p.NeutralFrame == frame
	}
	allowed := appearance.Canvas.AvatarType == "sprite" && appearance.Canvas.SpriteResourceID == id && matches(appearance.Canvas.Sprite)
	for _, pet := range publishedPets(appearance.PetCatalog) {
		if pet.AvatarType == "sprite" && pet.SpriteResourceID == id && matches(pet.Sprite) {
			allowed = true
		}
	}
	if !allowed {
		if err = s.RequireAdmin(actor); err != nil {
			return nil, "", err
		}
	}
	if width < 8 || height < 8 || width > 4096 || height > 4096 || frame < 0 || frame >= 4096 {
		return nil, "", BadAuthRequest("缩略图帧参数无效")
	}
	b, err := s.cachedSpriteBytes(r, fmt.Sprintf("thumb-88-%d-%d-%d", width, height, frame), func() ([]byte, error) {
		atlas, _, e := s.extractSpriteAsset(r)
		if e != nil {
			return nil, e
		}
		cfg, _, e := image.DecodeConfig(bytes.NewReader(atlas))
		if e != nil || cfg.Width > 4096 || cfg.Height > 4096 || cfg.Width%width != 0 || cfg.Height%height != 0 || frame >= (cfg.Width/width)*(cfg.Height/height) {
			return nil, BadAuthRequest("缩略图帧超出图集")
		}
		sheet, _, e := image.Decode(bytes.NewReader(atlas))
		if e != nil {
			return nil, e
		}
		cols := cfg.Width / width
		crop := image.Rect(frame%cols*width, frame/cols*height, frame%cols*width+width, frame/cols*height+height)
		w, h := 88, 88
		if width > height {
			h = max(1, 88*height/width)
		} else {
			w = max(1, 88*width/height)
		}
		thumb := image.NewNRGBA(image.Rect(0, 0, w, h))
		draw.CatmullRom.Scale(thumb, thumb.Bounds(), sheet, crop, draw.Src, nil)
		var result bytes.Buffer
		e = png.Encode(&result, thumb)
		return result.Bytes(), e
	})
	return b, "image/png", err
}
