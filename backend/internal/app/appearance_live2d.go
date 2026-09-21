package app

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"image/png"
	"io"
	"mime/multipart"
	"path"
	"strings"
	"unicode"

	"infinite-canvas/backend/internal/model"
)

const Live2DMaxBytes int64 = 128 << 20
const live2DMaxExpanded uint64 = 384 << 20
const live2DMaxFileBytes int64 = 128 << 20

type Live2DImport struct {
	ResourceID string `json:"resourceId"`
	Entry      string `json:"entry"`
}
type live2DNamedFile struct {
	Name string `json:"Name"`
	File string `json:"File"`
}
type live2DMotion struct {
	File        string  `json:"File"`
	Sound       string  `json:"Sound"`
	FadeInTime  float64 `json:"FadeInTime"`
	FadeOutTime float64 `json:"FadeOutTime"`
}
type live2DReferences struct {
	Moc         string                    `json:"Moc"`
	Textures    []string                  `json:"Textures"`
	Physics     string                    `json:"Physics"`
	Pose        string                    `json:"Pose"`
	DisplayInfo string                    `json:"DisplayInfo"`
	UserData    string                    `json:"UserData"`
	Expressions []live2DNamedFile         `json:"Expressions"`
	Motions     map[string][]live2DMotion `json:"Motions"`
}

func live2DFileName(name string) bool {
	return name != "" && len(name) <= 240 && path.Clean(name) == name && !strings.HasPrefix(name, "/") && name != ".." && !strings.HasPrefix(name, "../") && !strings.ContainsAny(name, "\\:%?#") && strings.IndexFunc(name, unicode.IsControl) == -1
}

func readLive2DFile(file *zip.File, max int64) ([]byte, error) {
	if file.UncompressedSize64 > uint64(max) {
		return nil, BadAuthRequest("Live2D 文件超过大小限制")
	}
	r, err := file.Open()
	if err != nil {
		return nil, err
	}
	defer r.Close()
	data, err := io.ReadAll(io.LimitReader(r, max+1))
	if err != nil {
		return nil, BadAuthRequest("Live2D 文件损坏")
	}
	if int64(len(data)) > max {
		return nil, BadAuthRequest("Live2D 文件超过大小限制")
	}
	return data, nil
}

// Never extract uploaded paths to disk. Only validated data files are served from the archive.
func validateLive2DArchive(reader io.ReaderAt, size int64) (string, error) {
	if size <= 0 || size > Live2DMaxBytes {
		return "", BadAuthRequest("Live2D ZIP 须为非空文件且不超过 128 MiB")
	}
	z, err := zip.NewReader(reader, size)
	if err != nil {
		return "", BadAuthRequest("无法读取 Live2D ZIP")
	}
	if len(z.File) > 256 {
		return "", BadAuthRequest("Live2D ZIP 最多 256 个条目")
	}
	files := map[string]*zip.File{}
	folded := map[string]bool{}
	entry := ""
	var total uint64
	var texturePixels int64
	for _, f := range z.File {
		name := strings.TrimSuffix(f.Name, "/")
		if !live2DFileName(name) {
			return "", BadAuthRequest("模型包包含非法路径")
		}
		if folded[strings.ToLower(name)] {
			return "", BadAuthRequest("模型包包含重复路径")
		}
		folded[strings.ToLower(name)] = true
		if f.FileInfo().IsDir() {
			continue
		}
		if !f.Mode().IsRegular() {
			return "", BadAuthRequest("模型包仅允许普通文件")
		}
		if f.UncompressedSize64 > uint64(live2DMaxFileBytes) || total > live2DMaxExpanded-f.UncompressedSize64 {
			return "", BadAuthRequest("模型包解压内容超过限制")
		}
		total += f.UncompressedSize64
		ext := strings.ToLower(path.Ext(name))
		if ext != ".json" && ext != ".moc3" && ext != ".png" {
			return "", BadAuthRequest("仅支持 JSON、moc3 和 PNG；请移除脚本、音频及其他文件")
		}
		data, err := readLive2DFile(f, live2DMaxFileBytes)
		if err != nil {
			return "", err
		}
		if ext == ".json" && (len(data) > 2<<20 || !json.Valid(data)) {
			return "", BadAuthRequest("模型 JSON 无效或超过 2 MiB")
		}
		if ext == ".moc3" && (len(data) < 4 || string(data[:4]) != "MOC3") {
			return "", BadAuthRequest("模型 moc3 文件无效")
		}
		if ext == ".png" {
			cfg, err := png.DecodeConfig(bytes.NewReader(data))
			if err != nil || cfg.Width > 4096 || cfg.Height > 4096 {
				return "", BadAuthRequest("纹理须为有效 PNG，且不超过 4096×4096")
			}
			texturePixels += int64(cfg.Width) * int64(cfg.Height)
			if texturePixels > 32*1024*1024 {
				return "", BadAuthRequest("模型纹理总像素超过 32 Mi，需压缩纹理")
			}
		}
		files[name] = f
		if strings.HasSuffix(name, ".model3.json") {
			if entry != "" {
				return "", BadAuthRequest("一个 ZIP 只能包含一个 model3.json")
			}
			entry = name
		}
	}
	if entry == "" {
		return "", BadAuthRequest("模型包缺少 model3.json 入口")
	}
	data, err := readLive2DFile(files[entry], 2<<20)
	if err != nil {
		return "", err
	}
	var manifest struct {
		Version        int             `json:"Version"`
		FileReferences json.RawMessage `json:"FileReferences"`
	}
	if json.Unmarshal(data, &manifest) != nil || manifest.Version != 3 {
		return "", BadAuthRequest("仅支持 model3.json Version 3")
	}
	var refs live2DReferences
	decoder := json.NewDecoder(bytes.NewReader(manifest.FileReferences))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&refs); err != nil {
		return "", BadAuthRequest("模型资源引用格式不受支持")
	}
	if refs.Moc == "" || len(refs.Textures) == 0 || len(refs.Textures) > 8 {
		return "", BadAuthRequest("模型须包含 moc3 和 1–8 张纹理")
	}
	check := func(name, suffix string, required bool) error {
		if name == "" && !required {
			return nil
		}
		if !live2DFileName(name) || !strings.HasSuffix(strings.ToLower(name), suffix) || files[path.Join(path.Dir(entry), name)] == nil {
			return BadAuthRequest("模型资源缺失、路径非法或类型不符：" + name)
		}
		return nil
	}
	if err := check(refs.Moc, ".moc3", true); err != nil {
		return "", err
	}
	for _, name := range refs.Textures {
		if err := check(name, ".png", true); err != nil {
			return "", err
		}
	}
	for _, name := range []string{refs.Physics, refs.Pose, refs.DisplayInfo, refs.UserData} {
		if err := check(name, ".json", false); err != nil {
			return "", err
		}
	}
	for _, expression := range refs.Expressions {
		if err := check(expression.File, ".exp3.json", true); err != nil {
			return "", err
		}
	}
	for _, motions := range refs.Motions {
		for _, motion := range motions {
			if motion.Sound != "" {
				return "", BadAuthRequest("首期不支持模型音频，请移除 Sound 引用")
			}
			if err := check(motion.File, ".motion3.json", true); err != nil {
				return "", err
			}
		}
	}
	return entry, nil
}

func (s *Service) UploadLive2D(actor *model.User, header *multipart.FileHeader) (*Live2DImport, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if header == nil {
		return nil, BadAuthRequest("请选择 Live2D ZIP")
	}
	f, err := header.Open()
	if err != nil {
		return nil, err
	}
	defer f.Close()
	entry, err := validateLive2DArchive(f, header.Size)
	if err != nil {
		return nil, err
	}
	header.Header.Set("Content-Type", "application/zip")
	resource, err := s.uploadLocalResource(actor.ID, header, "live2d", 0, 0, 0)
	if err != nil {
		return nil, err
	}
	return &Live2DImport{ResourceID: resource.ID, Entry: entry}, nil
}

func (s *Service) validateLive2DResource(actor *model.User, id, currentID string) (string, error) {
	resource, err := s.repo.Resource(id)
	if err != nil || resource.Kind != "live2d" || resource.Provider != "local" || resource.Status != model.ResourceStatusReady {
		return "", BadAuthRequest("Live2D 资源不存在或未就绪")
	}
	if id != currentID && resource.UserID != actor.ID {
		return "", Forbidden("只能启用自己上传的模型")
	}
	_, body, err := s.OpenResource(resource.UserID, id)
	if err != nil {
		return "", err
	}
	defer body.Close()
	reader, ok := body.(io.ReaderAt)
	if !ok {
		return "", BadAuthRequest("模型须存储在本地资源目录")
	}
	return validateLive2DArchive(reader, resource.Size)
}

func (s *Service) Live2DAsset(actor *model.User, id, name string) ([]byte, string, error) {
	if !live2DFileName(name) {
		return nil, "", BadAuthRequest("模型资源路径无效")
	}
	_, appearance, err := s.readAppearance()
	if err != nil {
		return nil, "", err
	}
	resource, err := s.repo.Resource(id)
	if err != nil || resource.Kind != "live2d" || resource.Provider != "local" || resource.Status != model.ResourceStatusReady {
		return nil, "", BadAuthRequest("模型资源不可用")
	}
	if appearance.Canvas.AvatarType != "live2d" || appearance.Canvas.Live2DResourceID != id {
		if err := s.RequireAdmin(actor); err != nil {
			return nil, "", err
		}
		if resource.UserID != actor.ID && appearance.Canvas.Live2DResourceID != id {
			return nil, "", Forbidden("不能预览其他管理员的未启用模型")
		}
	}
	_, body, err := s.OpenResource(resource.UserID, id)
	if err != nil {
		return nil, "", err
	}
	defer body.Close()
	reader, ok := body.(io.ReaderAt)
	if !ok {
		return nil, "", BadAuthRequest("模型资源不可读取")
	}
	z, err := zip.NewReader(reader, resource.Size)
	if err != nil {
		return nil, "", err
	}
	for _, f := range z.File {
		if f.Name == name {
			mime := "application/octet-stream"
			switch strings.ToLower(path.Ext(name)) {
			case ".json":
				mime = "application/json"
			case ".png":
				mime = "image/png"
			case ".moc3":
			default:
				return nil, "", BadAuthRequest("不支持的模型资源类型")
			}
			data, err := readLive2DFile(f, live2DMaxFileBytes)
			return data, mime, err
		}
	}
	return nil, "", BadAuthRequest("模型文件不存在")
}
