package app

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	_ "image/png"
	"io"
	"log/slog"
	"math"
	"mime/multipart"
	"path"
	"regexp"
	"strings"

	_ "golang.org/x/image/webp"
	"yingce/backend/internal/model"
)

const SpriteMaxBytes int64 = 16 << 20

var spriteActionID = regexp.MustCompile(`^[a-z][a-z0-9-]{0,39}$`)

type SpriteAction struct {
	ID     string  `json:"id"`
	Label  string  `json:"label"`
	Row    int     `json:"row"`
	Start  int     `json:"start"`
	Frames int     `json:"frames"`
	FPS    float64 `json:"fps"`
	Loop   bool    `json:"loop"`
}

type SpriteBindings struct {
	Idle      string `json:"idle"`
	Working   string `json:"working"`
	Waiting   string `json:"waiting"`
	Failed    string `json:"failed"`
	Completed string `json:"completed"`
	MoveLeft  string `json:"moveLeft"`
	MoveRight string `json:"moveRight"`
	Hover     string `json:"hover"`
	Greeting  string `json:"greeting"`
	Sleep     string `json:"sleep"`
	Wake      string `json:"wake"`
}

// SpritePet is data only; imported packages cannot execute code or choose remote URLs.
type SpritePet struct {
	DisplayName       string         `json:"displayName"`
	SpritesheetPath   string         `json:"spritesheetPath"`
	AtlasWidth        int            `json:"atlasWidth"`
	AtlasHeight       int            `json:"atlasHeight"`
	FrameWidth        int            `json:"frameWidth"`
	FrameHeight       int            `json:"frameHeight"`
	NeutralFrame      int            `json:"neutralFrame"`
	LookStartFrame    int            `json:"lookStartFrame"`
	LookDirections    int            `json:"lookDirections"`
	Speed             float64        `json:"speed"`
	SleepAfterSeconds int            `json:"sleepAfterSeconds"`
	Author            string         `json:"author"`
	Source            string         `json:"source"`
	License           string         `json:"license"`
	Actions           []SpriteAction `json:"actions"`
	Bindings          SpriteBindings `json:"bindings"`
}

type SpriteImport struct {
	ResourceID string     `json:"resourceId"`
	Config     *SpritePet `json:"config"`
}

func codexSpritePet(version int) *SpritePet {
	rows := 9
	if version == 2 {
		rows = 11
	}
	p := &SpritePet{FrameWidth: 192, FrameHeight: 208, AtlasWidth: 1536, AtlasHeight: rows * 208, Speed: 1, LookStartFrame: -1}
	ids := []string{"idle", "running-right", "running-left", "waving", "jumping", "failed", "waiting", "running", "review"}
	labels := []string{"待机", "向右移动", "向左移动", "挥手", "跳跃", "失败", "等待", "工作", "查看结果"}
	frames := []int{6, 8, 8, 4, 5, 8, 6, 6, 6}
	for row, id := range ids {
		p.Actions = append(p.Actions, SpriteAction{ID: id, Label: labels[row], Row: row, Frames: frames[row], FPS: 6, Loop: row == 0 || row == 1 || row == 2 || row == 6 || row == 7})
	}
	p.Bindings = SpriteBindings{Idle: "idle", Working: "running", Waiting: "waiting", Failed: "failed", Completed: "review", MoveLeft: "running-left", MoveRight: "running-right", Hover: "jumping", Greeting: "waving"}
	if version == 2 {
		p.NeutralFrame = 6
		p.LookStartFrame = 72
		p.LookDirections = 16
	}
	return p
}

func validateSpriteConfig(p *SpritePet) error {
	if p == nil {
		return BadAuthRequest("请先导入精灵宠物")
	}
	if p.FrameWidth < 8 || p.FrameHeight < 8 || p.AtlasWidth < p.FrameWidth || p.AtlasHeight < p.FrameHeight || p.AtlasWidth > 4096 || p.AtlasHeight > 4096 || p.AtlasWidth%p.FrameWidth != 0 || p.AtlasHeight%p.FrameHeight != 0 {
		return BadAuthRequest("图集须不超过 4096×4096，且宽高能被单帧尺寸整除（单帧至少 8px）")
	}
	cols, rows := p.AtlasWidth/p.FrameWidth, p.AtlasHeight/p.FrameHeight
	if cols > 64 || rows > 64 || len(p.Actions) < 1 || len(p.Actions) > 48 {
		return BadAuthRequest("图集最多 64 行/列，动作数量须为 1–48")
	}
	if !live2DFileName(p.SpritesheetPath) || !oneOf(strings.ToLower(path.Ext(p.SpritesheetPath)), ".png", ".webp") {
		return BadAuthRequest("精灵图片路径无效")
	}
	for _, f := range []struct {
		s   string
		max int
	}{{p.DisplayName, 80}, {p.Author, 120}, {p.Source, 500}, {p.License, 500}} {
		if err := validateAppearanceCopy(f.s, "宠物信息", f.max, false); err != nil {
			return err
		}
	}
	if math.IsNaN(p.Speed) || math.IsInf(p.Speed, 0) || p.Speed < 0.25 || p.Speed > 3 {
		return BadAuthRequest("播放倍率须在 0.25–3 之间")
	}
	if p.NeutralFrame < 0 || p.NeutralFrame >= cols*rows {
		return BadAuthRequest("中立帧超出图集范围")
	}
	if p.LookDirections != 0 && p.LookDirections != 8 && p.LookDirections != 16 {
		return BadAuthRequest("注视方向须为 0、8 或 16")
	}
	if p.LookDirections != 0 && (p.LookStartFrame < 0 || p.LookStartFrame > cols*rows-p.LookDirections) {
		return BadAuthRequest("注视帧超出图集范围")
	}
	if p.SleepAfterSeconds != 0 && (p.SleepAfterSeconds < 60 || p.SleepAfterSeconds > 3600) {
		return BadAuthRequest("自动睡眠须关闭或设为 60–3600 秒")
	}
	ids := map[string]bool{}
	for _, a := range p.Actions {
		if !spriteActionID.MatchString(a.ID) || ids[a.ID] {
			return BadAuthRequest("动作标识须唯一，使用小写字母、数字和短横线")
		}
		ids[a.ID] = true
		if err := validateAppearanceCopy(a.Label, "动作名称", 40, true); err != nil {
			return err
		}
		if a.Row < 0 || a.Row >= rows || a.Start < 0 || a.Start >= cols || a.Frames < 1 || a.Frames > cols || a.Start+a.Frames > cols || math.IsNaN(a.FPS) || math.IsInf(a.FPS, 0) || a.FPS < 1 || a.FPS > 30 {
			return BadAuthRequest("动作行/列/帧数超出图集，或帧率不在 1–30 之间")
		}
	}
	for _, id := range []string{p.Bindings.Idle, p.Bindings.Working, p.Bindings.Waiting, p.Bindings.Failed, p.Bindings.Completed, p.Bindings.MoveLeft, p.Bindings.MoveRight, p.Bindings.Hover, p.Bindings.Greeting, p.Bindings.Sleep, p.Bindings.Wake} {
		if id != "" && !ids[id] {
			return BadAuthRequest("状态映射引用了不存在的动作：" + id)
		}
	}
	if !ids[p.Bindings.Idle] {
		return BadAuthRequest("必须绑定待机动作")
	}
	if p.SleepAfterSeconds > 0 && p.Bindings.Sleep == "" {
		return BadAuthRequest("开启自动睡眠前请绑定睡眠动作")
	}
	return nil
}

func readSpriteFile(f *zip.File, max int64) ([]byte, error) {
	if f == nil || f.UncompressedSize64 > uint64(max) {
		return nil, BadAuthRequest("宠物文件缺失或超过大小限制")
	}
	r, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer r.Close()
	b, err := io.ReadAll(io.LimitReader(r, max+1))
	if err != nil || int64(len(b)) > max {
		return nil, BadAuthRequest("宠物文件损坏或超过大小限制")
	}
	return b, nil
}

func validateSpriteArchive(reader io.ReaderAt, size int64) (*SpritePet, error) {
	if size <= 0 || size > SpriteMaxBytes {
		return nil, BadAuthRequest("请选择不超过 16 MiB 的精灵宠物 ZIP")
	}
	z, err := zip.NewReader(reader, size)
	if err != nil {
		return nil, BadAuthRequest("无法读取精灵宠物 ZIP")
	}
	if len(z.File) > 16 {
		return nil, BadAuthRequest("精灵宠物 ZIP 最多 16 个条目")
	}
	files := map[string]*zip.File{}
	folded := map[string]bool{}
	entry := ""
	var total uint64
	for _, f := range z.File {
		name := strings.TrimSuffix(f.Name, "/")
		if !live2DFileName(name) || folded[strings.ToLower(name)] {
			return nil, BadAuthRequest("宠物包包含非法或重复路径")
		}
		folded[strings.ToLower(name)] = true
		if f.FileInfo().IsDir() {
			continue
		}
		if !f.Mode().IsRegular() || f.UncompressedSize64 > uint64(SpriteMaxBytes) || total > uint64(24<<20)-f.UncompressedSize64 {
			return nil, BadAuthRequest("宠物包文件类型或解压大小超出限制")
		}
		total += f.UncompressedSize64
		ext := strings.ToLower(path.Ext(name))
		if !oneOf(ext, ".json", ".png", ".webp", ".txt", ".md") {
			return nil, BadAuthRequest("宠物包只允许 JSON、PNG、WebP 及文字授权文件")
		}
		files[name] = f
		if path.Base(name) == "pet.json" {
			if entry != "" {
				return nil, BadAuthRequest("宠物包只能包含一个 pet.json")
			}
			entry = name
		}
	}
	if entry == "" {
		return nil, BadAuthRequest("宠物包缺少 pet.json")
	}
	b, err := readSpriteFile(files[entry], 128<<10)
	if err != nil {
		return nil, err
	}
	var m struct {
		DisplayName     string     `json:"displayName"`
		SpritesheetPath string     `json:"spritesheetPath"`
		Version         *int       `json:"spriteVersionNumber"`
		Custom          *SpritePet `json:"yinghui"`
	}
	if json.Unmarshal(b, &m) != nil || !live2DFileName(m.SpritesheetPath) {
		return nil, BadAuthRequest("pet.json 或 spritesheetPath 无效")
	}
	sheetPath := path.Join(path.Dir(entry), m.SpritesheetPath)
	b, err = readSpriteFile(files[sheetPath], SpriteMaxBytes)
	if err != nil {
		return nil, err
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(b))
	if err != nil || !oneOf(format, "png", "webp") || !oneOf(strings.ToLower(path.Ext(sheetPath)), ".png", ".webp") {
		return nil, BadAuthRequest("精灵图集须为有效 PNG 或静态 WebP")
	}
	if (format == "png") != strings.HasSuffix(strings.ToLower(sheetPath), ".png") {
		return nil, BadAuthRequest("精灵图集扩展名与内容不符")
	}
	p := m.Custom
	if p == nil {
		version := 0
		if m.Version != nil {
			version = *m.Version
		} else if cfg.Width == 1536 {
			// Older Codex packages omit the version; infer only exact standard layouts.
			switch cfg.Height {
			case 1872:
				version = 1
			case 2288:
				version = 2
			}
		}
		if version != 1 && version != 2 {
			return nil, BadAuthRequest("无法识别宠物图集，请提供 Codex v1/v2 版本号或 yinghui 自定义动作配置")
		}
		p = codexSpritePet(version)
	}
	p.SpritesheetPath = sheetPath
	if p.DisplayName == "" {
		p.DisplayName = m.DisplayName
	}
	if p.Speed == 0 {
		p.Speed = 1
	}
	if cfg.Width != p.AtlasWidth || cfg.Height != p.AtlasHeight {
		return nil, BadAuthRequest(fmt.Sprintf("图集实际尺寸 %d×%d 与配置不一致", cfg.Width, cfg.Height))
	}
	if err = validateSpriteConfig(p); err != nil {
		return nil, err
	}
	// Decode only after bounding dimensions. Also rejects broken payloads and animated WebP.
	if _, _, err = image.Decode(bytes.NewReader(b)); err != nil {
		return nil, BadAuthRequest("精灵图集内容无法完整解码")
	}
	for name, f := range files {
		if name == entry || name == p.SpritesheetPath {
			continue
		}
		if !oneOf(strings.ToLower(path.Ext(name)), ".md", ".txt") {
			return nil, BadAuthRequest("宠物包含未引用图片或额外 JSON")
		}
		if _, err = readSpriteFile(f, 128<<10); err != nil {
			return nil, err
		}
	}
	return p, nil
}

func (s *Service) UploadSpritePet(actor *model.User, header *multipart.FileHeader) (*SpriteImport, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if header == nil {
		return nil, BadAuthRequest("请选择精灵宠物 ZIP")
	}
	f, err := header.Open()
	if err != nil {
		return nil, err
	}
	defer f.Close()
	p, err := validateSpriteArchive(f, header.Size)
	if err != nil {
		return nil, err
	}
	header.Header.Set("Content-Type", "application/zip")
	r, err := s.uploadLocalResource(actor.ID, header, "sprite", 0, 0, 0)
	if err != nil {
		return nil, err
	}
	if _, _, err = s.SpriteAsset(actor, r.ID); err == nil {
		_, _, err = s.SpriteThumbnail(actor, r.ID, p.FrameWidth, p.FrameHeight, p.NeutralFrame)
	}
	if err != nil {
		slog.Warn("sprite thumbnail warmup failed", "resourceId", r.ID, "error", err)
	}
	return &SpriteImport{ResourceID: r.ID, Config: p}, nil
}

func (s *Service) spriteResource(actor *model.User, id, currentID string) (*model.Resource, error) {
	r, err := s.repo.Resource(id)
	if err != nil || r.Kind != "sprite" || r.Provider != "local" || r.Status != model.ResourceStatusReady {
		return nil, BadAuthRequest("精灵宠物资源不存在或未就绪")
	}
	if id != currentID && (actor == nil || r.UserID != actor.ID) {
		return nil, Forbidden("只能使用自己上传的宠物或当前配置引用的宠物")
	}
	return r, nil
}

func (s *Service) validateSpriteResource(actor *model.User, id, currentID string, config *SpritePet) error {
	r, err := s.spriteResource(actor, id, currentID)
	if err != nil {
		return err
	}
	_, body, err := s.OpenResource(r.UserID, id)
	if err != nil {
		return err
	}
	defer body.Close()
	reader, ok := body.(io.ReaderAt)
	if !ok {
		return BadAuthRequest("精灵宠物须存储在本地资源目录")
	}
	p, err := validateSpriteArchive(reader, r.Size)
	if err != nil {
		return err
	}
	if config == nil {
		return BadAuthRequest("缺少精灵宠物动作配置")
	}
	if config.SpritesheetPath != p.SpritesheetPath || config.AtlasWidth != p.AtlasWidth || config.AtlasHeight != p.AtlasHeight {
		return BadAuthRequest("图集路径和实际尺寸不能改写，请重新导入图片")
	}
	return validateSpriteConfig(config)
}

func (s *Service) spriteReadResource(actor *model.User, id string) (*model.Resource, error) {
	_, a, err := s.readAppearance()
	if err != nil {
		return nil, err
	}
	public := a.Canvas.AvatarType == "sprite" && a.Canvas.SpriteResourceID == id || catalogReferences(publishedPets(a.PetCatalog), "sprite", id)
	if !public {
		if err = s.RequireAdmin(actor); err != nil {
			return nil, err
		}
	}
	known := a.Canvas.SpriteResourceID
	if public || catalogReferences(a.PetCatalog, "sprite", id) {
		known = id
	}
	return s.spriteResource(actor, id, known)
}

func (s *Service) SpriteAsset(actor *model.User, id string) ([]byte, string, error) {
	// Authorization is rechecked before every cache read, including conditional HTTP requests.
	r, err := s.spriteReadResource(actor, id)
	if err != nil {
		return nil, "", err
	}
	b, err := s.cachedSpriteBytes(r, "atlas", func() ([]byte, error) {
		data, _, e := s.extractSpriteAsset(r)
		return data, e
	})
	mime := "image/png"
	if len(b) >= 12 && string(b[:4]) == "RIFF" {
		mime = "image/webp"
	}
	return b, mime, err
}

func (s *Service) extractSpriteAsset(r *model.Resource) ([]byte, string, error) {
	id := r.ID
	_, body, err := s.OpenResource(r.UserID, id)
	if err != nil {
		return nil, "", err
	}
	defer body.Close()
	reader, ok := body.(io.ReaderAt)
	if !ok {
		return nil, "", BadAuthRequest("宠物资源不可读取")
	}
	// Uploaded archives are immutable and validated at import; only the declared image is served.
	z, err := zip.NewReader(reader, r.Size)
	if err != nil {
		return nil, "", err
	}
	for _, f := range z.File {
		if path.Base(f.Name) == "pet.json" {
			b, e := readSpriteFile(f, 128<<10)
			if e != nil {
				return nil, "", e
			}
			var m struct {
				Path string `json:"spritesheetPath"`
			}
			if json.Unmarshal(b, &m) != nil || !live2DFileName(m.Path) {
				return nil, "", BadAuthRequest("宠物清单损坏")
			}
			name := path.Join(path.Dir(f.Name), m.Path)
			for _, imageFile := range z.File {
				if imageFile.Name == name {
					b, e = readSpriteFile(imageFile, SpriteMaxBytes)
					mime := "image/webp"
					if strings.HasSuffix(strings.ToLower(name), ".png") {
						mime = "image/png"
					}
					return b, mime, e
				}
			}
		}
	}
	return nil, "", BadAuthRequest("宠物图集不存在")
}
