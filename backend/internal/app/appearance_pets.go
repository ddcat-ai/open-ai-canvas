package app

import (
	"encoding/json"
	"errors"
	"gorm.io/gorm"
	"maps"
	"reflect"
	"strings"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// PetAppearance is a published presentation asset, never Agent identity or permissions.
type PetAppearance struct {
	ID                     string            `json:"id"`
	Name                   string            `json:"name"`
	Published              bool              `json:"published"`
	AvatarType             string            `json:"avatarType"`
	AvatarHeight           int               `json:"avatarHeight"`
	SpriteResourceID       string            `json:"spriteResourceId"`
	Sprite                 *SpritePet        `json:"sprite,omitempty"`
	Live2DResourceID       string            `json:"live2dResourceId"`
	Live2DEntry            string            `json:"live2dEntry"`
	AvatarBundleResourceID string            `json:"avatarBundleResourceId"`
	AvatarClipStates       map[string]string `json:"avatarClipStates,omitempty"`
}

func petFromCanvas(c CanvasAppearance) PetAppearance {
	name := "动态球"
	id := "builtin-orb"
	if c.AvatarType == "sprite" && c.Sprite != nil {
		name = c.Sprite.DisplayName
		id = "sprite-" + c.SpriteResourceID
	}
	if c.AvatarType == "live2d" {
		name = "Live2D 形象"
		id = "live2d-" + c.Live2DResourceID
	}
	if c.AvatarType == "bundle" {
		name = "状态动画"
		id = "builtin-avatar"
		if c.AvatarBundleResourceID != "" {
			id = "bundle-" + c.AvatarBundleResourceID
		}
	}
	return PetAppearance{ID: id, Name: name, Published: true, AvatarType: c.AvatarType, AvatarHeight: c.AvatarHeight, SpriteResourceID: c.SpriteResourceID, Sprite: c.Sprite, Live2DResourceID: c.Live2DResourceID, Live2DEntry: c.Live2DEntry, AvatarBundleResourceID: c.AvatarBundleResourceID, AvatarClipStates: c.AvatarClipStates}
}

func applyPet(c CanvasAppearance, p PetAppearance) CanvasAppearance {
	c.DefaultPetID = p.ID
	c.AvatarType = p.AvatarType
	c.AvatarHeight = p.AvatarHeight
	if p.AvatarType == "sprite" {
		c.SpriteResourceID = p.SpriteResourceID
		c.Sprite = p.Sprite
	}
	if p.AvatarType == "live2d" {
		c.Live2DResourceID = p.Live2DResourceID
		c.Live2DEntry = p.Live2DEntry
	}
	if p.AvatarType == "bundle" {
		c.AvatarBundleResourceID = p.AvatarBundleResourceID
		c.AvatarClipStates = p.AvatarClipStates
	}
	return c
}

func seedPetCatalog(a *AppearanceSetting) {
	if a.PetCatalog != nil {
		return
	}
	p := petFromCanvas(a.Canvas)
	a.PetCatalog = []PetAppearance{p}
	a.Canvas.DefaultPetID = p.ID
	if p.AvatarType != "orb" {
		a.PetCatalog = append(a.PetCatalog, PetAppearance{ID: "builtin-orb", Name: "动态球", Published: true, AvatarType: "orb", AvatarHeight: 220})
	}
}

func publishedPets(pets []PetAppearance) []PetAppearance {
	out := make([]PetAppearance, 0, len(pets))
	for _, p := range pets {
		if p.Published {
			if p.AvatarType != "bundle" {
				p.AvatarBundleResourceID = ""
				p.AvatarClipStates = nil
			}
			if p.AvatarType != "sprite" {
				p.SpriteResourceID = ""
				p.Sprite = nil
			}
			if p.AvatarType != "live2d" {
				p.Live2DResourceID = ""
				p.Live2DEntry = ""
			}
			out = append(out, p)
		}
	}
	return out
}

func catalogReferences(pets []PetAppearance, kind, id string) bool {
	for _, p := range pets {
		if (kind == "sprite" && p.SpriteResourceID == id) || (kind == "live2d" && p.Live2DResourceID == id) || (kind == "agent-avatar-bundle" && p.AvatarBundleResourceID == id) {
			return true
		}
	}
	return false
}

func (s *Service) validatePetCatalog(actor *model.User, a *AppearanceSetting, before AppearanceSetting) error {
	// An older editor may update only the default presentation; preserve that operation.
	if a.PetCatalog == nil {
		seedPetCatalog(a)
	}
	a.PetCatalog = append([]PetAppearance{}, a.PetCatalog...)
	if reflect.DeepEqual(a.PetCatalog, before.PetCatalog) && a.Canvas.DefaultPetID == before.Canvas.DefaultPetID && !reflect.DeepEqual(petFromCanvas(a.Canvas), petFromCanvas(before.Canvas)) {
		for i := range a.PetCatalog {
			if a.PetCatalog[i].ID == a.Canvas.DefaultPetID {
				p := petFromCanvas(a.Canvas)
				p.ID = a.Canvas.DefaultPetID
				a.PetCatalog[i] = p
			}
		}
	}
	if len(a.PetCatalog) < 1 || len(a.PetCatalog) > 64 {
		return BadAuthRequest("形象库须包含 1–64 个形象")
	}
	ids := map[string]bool{}
	found := false
	for i := range a.PetCatalog {
		p := &a.PetCatalog[i]
		p.AvatarClipStates = maps.Clone(p.AvatarClipStates)
		p.ID = strings.TrimSpace(p.ID)
		p.Name = strings.TrimSpace(p.Name)
		if !validPetID(p.ID) || ids[p.ID] {
			return BadAuthRequest("形象标识无效或重复")
		}
		ids[p.ID] = true
		if err := validateAppearanceCopy(p.Name, "形象名称", 40, true); err != nil {
			return err
		}
		c, err := normalizeCanvasAppearance(applyPet(defaultCanvasAppearance(), *p))
		if err != nil {
			return err
		}
		if p.SpriteResourceID != "" {
			known := ""
			if before.Canvas.SpriteResourceID == p.SpriteResourceID || catalogReferences(before.PetCatalog, "sprite", p.SpriteResourceID) {
				known = p.SpriteResourceID
			}
			if err = s.validateSpriteResource(actor, p.SpriteResourceID, known, p.Sprite); err != nil {
				return err
			}
		}
		if p.Live2DResourceID != "" {
			known := ""
			if before.Canvas.Live2DResourceID == p.Live2DResourceID || catalogReferences(before.PetCatalog, "live2d", p.Live2DResourceID) {
				known = p.Live2DResourceID
			}
			p.Live2DEntry, err = s.validateLive2DResource(actor, p.Live2DResourceID, known)
			if err != nil {
				return err
			}
		}
		p.AvatarHeight = c.AvatarHeight
		if p.AvatarBundleResourceID != "" {
			known := ""
			if before.Canvas.AvatarBundleResourceID == p.AvatarBundleResourceID || catalogReferences(before.PetCatalog, "agent-avatar-bundle", p.AvatarBundleResourceID) {
				known = p.AvatarBundleResourceID
			}
			manifest, err := s.validateAgentAvatarBundleResource(actor, p.AvatarBundleResourceID, known)
			if err != nil {
				return err
			}
			for _, clip := range p.AvatarClipStates {
				if _, ok := manifest.Clips[clip]; !ok {
					return BadAuthRequest("状态映射引用的动画不存在：" + clip)
				}
			}
		}
		if p.ID == a.Canvas.DefaultPetID {
			if !p.Published {
				return BadAuthRequest("默认形象必须已发布")
			}
			a.Canvas = applyPet(a.Canvas, *p)
			found = true
		}
	}
	if !found {
		return BadAuthRequest("请选择已发布的默认形象")
	}
	return nil
}

func validPetID(id string) bool {
	if len(id) < 1 || len(id) > 64 {
		return false
	}
	for _, c := range id {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
			return false
		}
	}
	return true
}

type PetPreference struct {
	ModelID  string `json:"modelId"`
	Scale    int    `json:"scale"`
	Locked   bool   `json:"locked"`
	Hidden   bool   `json:"hidden"`
	Revision int64  `json:"revision"`
}

// Account preferences occupy a dedicated key namespace in the existing JSON settings store.
// The authenticated actor alone determines the key; clients cannot supply a user ID.
func (s *Service) PetPreference(actor *model.User) (*PetPreference, error) {
	if actor == nil || actor.ID == "" || actor.Status != model.UserStatusActive {
		return nil, Forbidden("请先登录")
	}
	p := &PetPreference{ModelID: "system", Scale: 100}
	row, err := s.repo.SystemSetting("user-pet:" + actor.ID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return p, nil
	}
	if err != nil {
		return nil, err
	}
	if err = json.Unmarshal([]byte(row.ValueJSON), p); err != nil {
		return nil, err
	}
	return p, nil
}

func (s *Service) UpdatePetPreference(actor *model.User, p PetPreference) (*PetPreference, error) {
	if actor == nil || actor.ID == "" || actor.Status != model.UserStatusActive {
		return nil, Forbidden("请先登录")
	}
	if p.Scale < 50 || p.Scale > 150 || p.Scale%5 != 0 || p.Revision < 0 {
		return nil, BadAuthRequest("大小须为 50%–150%，步长 5%")
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	_, a, err := s.readAppearance()
	if err != nil {
		return nil, err
	}
	valid := p.ModelID == "system"
	for _, m := range publishedPets(a.PetCatalog) {
		if p.ModelID == m.ID {
			valid = true
		}
	}
	if !valid {
		return nil, BadAuthRequest("该形象已下架，请选择其他形象")
	}
	key := "user-pet:" + actor.ID
	current, err := s.repo.SystemSetting(key)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	old := ""
	revision := int64(0)
	if current != nil {
		var prior PetPreference
		if err = json.Unmarshal([]byte(current.ValueJSON), &prior); err != nil {
			return nil, err
		}
		revision = prior.Revision
		old = current.ValueJSON
	}
	if p.Revision != revision {
		return nil, creationConflict("个人设置已在其他页面变化，请重新读取")
	}
	p.Revision++
	body, err := json.Marshal(p)
	if err != nil {
		return nil, err
	}
	err = s.repo.SavePetPreferenceSetting(key, actor.ID, old, string(body))
	if errors.Is(err, repository.ErrPetPreferenceConflict) {
		return nil, creationConflict("个人设置已变化，请重新读取")
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}
