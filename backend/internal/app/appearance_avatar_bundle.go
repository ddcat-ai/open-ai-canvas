package app

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"os"
	"path"
	"path/filepath"
	"strings"
	"unicode"

	"yingce/backend/internal/model"
)

const AgentAvatarBundleMaxBytes int64 = 128 << 20

const (
	agentAvatarBundleResourceKind        = "agent-avatar-bundle"
	agentAvatarBundleMaxExpanded  uint64 = 384 << 20
	agentAvatarBundleMaxFileBytes int64  = 64 << 20
	agentAvatarBundleMaxEntries          = 128
	agentAvatarManifestMaxBytes   int64  = 2 << 20
)

type AgentAvatarBundleManifest struct {
	Version int               `json:"version"`
	Width   int               `json:"width"`
	Height  int               `json:"height"`
	Clips   map[string]string `json:"clips"`
}

type AgentAvatarBundleImport struct {
	ResourceID string                    `json:"resourceId"`
	Manifest   AgentAvatarBundleManifest `json:"manifest"`
}

func validAgentAvatarBundlePath(name string) bool {
	return name != "" && len(name) <= 128 && path.Clean(name) == name && !path.IsAbs(name) &&
		!strings.ContainsAny(name, "\\:%?#") && strings.IndexFunc(name, unicode.IsControl) == -1
}

func ignoredAgentAvatarMetadata(name string) bool {
	return name == ".DS_Store" || strings.HasPrefix(name, "__MACOSX/") || strings.HasPrefix(path.Base(name), "._")
}

func readAgentAvatarZipFile(file *zip.File, maxBytes int64) ([]byte, error) {
	if file.UncompressedSize64 > uint64(maxBytes) {
		return nil, BadAuthRequest("动画包文件超过大小限制")
	}
	reader, err := file.Open()
	if err != nil {
		return nil, BadAuthRequest("动画包文件损坏")
	}
	defer reader.Close()
	data, err := io.ReadAll(io.LimitReader(reader, maxBytes+1))
	if err != nil || int64(len(data)) > maxBytes || uint64(len(data)) != file.UncompressedSize64 {
		return nil, BadAuthRequest("动画包文件损坏或超过大小限制")
	}
	return data, nil
}

func parseAgentAvatarManifest(data []byte) (AgentAvatarBundleManifest, error) {
	var manifest AgentAvatarBundleManifest
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&manifest); err != nil {
		return manifest, BadAuthRequest("avatar.json 格式无效")
	}
	if decoder.Decode(new(any)) != io.EOF || manifest.Version != 1 || manifest.Width < 1 || manifest.Width > 4096 || manifest.Height < 1 || manifest.Height > 4096 || len(manifest.Clips) == 0 || len(manifest.Clips) > 64 {
		return manifest, BadAuthRequest("avatar.json 版本、尺寸或 clips 无效")
	}
	for id, file := range manifest.Clips {
		if !validAvatarClipID(id) || !validAgentAvatarBundlePath(file) || path.Base(file) != file || strings.ToLower(path.Ext(file)) != ".mp4" {
			return manifest, BadAuthRequest("avatar.json 包含无效的动画名称或 MP4 路径")
		}
	}
	return manifest, nil
}

func validAgentAvatarMP4(data []byte) bool {
	if len(data) < 12 {
		return false
	}
	sample := data
	if len(sample) > 512 {
		sample = sample[:512]
	}
	return detectAppearanceMIME(AppearanceAssetVideo, sample, int64(len(data))) == "video/mp4"
}

func validateAgentAvatarBundleArchive(reader io.ReaderAt, size int64) (AgentAvatarBundleManifest, error) {
	if size <= 0 || size > AgentAvatarBundleMaxBytes {
		return AgentAvatarBundleManifest{}, BadAuthRequest("Agent 动画包须为非空 ZIP 且不超过 128 MiB")
	}
	archive, err := zip.NewReader(reader, size)
	if err != nil {
		return AgentAvatarBundleManifest{}, BadAuthRequest("无法读取 Agent 动画 ZIP")
	}
	if len(archive.File) > agentAvatarBundleMaxEntries {
		return AgentAvatarBundleManifest{}, BadAuthRequest("Agent 动画 ZIP 最多 128 个条目")
	}
	files := make(map[string]*zip.File)
	folded := make(map[string]struct{})
	var total uint64
	for _, file := range archive.File {
		name := strings.TrimSuffix(file.Name, "/")
		if !validAgentAvatarBundlePath(name) {
			return AgentAvatarBundleManifest{}, BadAuthRequest("动画包包含非法路径")
		}
		if ignoredAgentAvatarMetadata(name) || file.FileInfo().IsDir() {
			continue
		}
		if !file.Mode().IsRegular() || strings.Contains(name, "/") {
			return AgentAvatarBundleManifest{}, BadAuthRequest("动画包仅允许根目录中的普通文件")
		}
		key := strings.ToLower(name)
		if _, exists := folded[key]; exists {
			return AgentAvatarBundleManifest{}, BadAuthRequest("动画包包含重复文件名")
		}
		folded[key] = struct{}{}
		if name != "avatar.json" && strings.ToLower(path.Ext(name)) != ".mp4" {
			return AgentAvatarBundleManifest{}, BadAuthRequest("动画包只允许 avatar.json 和 MP4 文件")
		}
		if file.UncompressedSize64 > uint64(agentAvatarBundleMaxFileBytes) || total > agentAvatarBundleMaxExpanded-file.UncompressedSize64 {
			return AgentAvatarBundleManifest{}, BadAuthRequest("动画包解压内容超过 384 MiB 限制")
		}
		total += file.UncompressedSize64
		files[name] = file
	}
	manifestFile := files["avatar.json"]
	if manifestFile == nil {
		return AgentAvatarBundleManifest{}, BadAuthRequest("动画包缺少根目录 avatar.json")
	}
	manifestBytes, err := readAgentAvatarZipFile(manifestFile, agentAvatarManifestMaxBytes)
	if err != nil {
		return AgentAvatarBundleManifest{}, err
	}
	manifest, err := parseAgentAvatarManifest(manifestBytes)
	if err != nil {
		return AgentAvatarBundleManifest{}, err
	}
	usedFiles := make(map[string]struct{}, len(manifest.Clips))
	for _, fileName := range manifest.Clips {
		file := files[fileName]
		if file == nil {
			return AgentAvatarBundleManifest{}, BadAuthRequest("avatar.json 引用的 MP4 不存在：" + fileName)
		}
		if _, used := usedFiles[fileName]; used {
			return AgentAvatarBundleManifest{}, BadAuthRequest("多个动画不能重复引用同一个 MP4：" + fileName)
		}
		usedFiles[fileName] = struct{}{}
		data, err := readAgentAvatarZipFile(file, agentAvatarBundleMaxFileBytes)
		if err != nil {
			return AgentAvatarBundleManifest{}, err
		}
		if !validAgentAvatarMP4(data) {
			return AgentAvatarBundleManifest{}, BadAuthRequest("动画文件不是有效 MP4：" + fileName)
		}
	}
	if len(usedFiles) != len(files)-1 {
		return AgentAvatarBundleManifest{}, BadAuthRequest("动画包包含未在 avatar.json 中引用的 MP4")
	}
	return manifest, nil
}

func (s *Service) UploadAgentAvatarBundle(actor *model.User, header *multipart.FileHeader) (*AgentAvatarBundleImport, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if header == nil || header.Size <= 0 || header.Size > AgentAvatarBundleMaxBytes {
		return nil, BadAuthRequest("请选择不超过 128 MiB 的 Agent 动画 ZIP")
	}
	file, err := header.Open()
	if err != nil {
		return nil, err
	}
	defer file.Close()
	reader, ok := file.(io.ReaderAt)
	if !ok {
		return nil, BadAuthRequest("Agent 动画 ZIP 无法随机读取")
	}
	manifest, err := validateAgentAvatarBundleArchive(reader, header.Size)
	if err != nil {
		return nil, err
	}
	if header.Header == nil {
		header.Header = make(map[string][]string)
	}
	header.Header.Set("Content-Type", "application/zip")
	resource, err := s.uploadLocalResource(actor.ID, header, agentAvatarBundleResourceKind, 0, 0, 0)
	if err != nil {
		return nil, err
	}
	return &AgentAvatarBundleImport{ResourceID: resource.ID, Manifest: manifest}, nil
}

func (s *Service) agentAvatarBundleAvailable(id string) bool {
	resource, err := s.repo.Resource(id)
	if err != nil || resource.Kind != agentAvatarBundleResourceKind || resource.Provider != "local" || resource.Status != model.ResourceStatusReady {
		return false
	}
	info, err := os.Stat(filepath.Join(s.dataDir, "resources", filepath.FromSlash(resource.ObjectKey)))
	return err == nil && !info.IsDir()
}

func (s *Service) validateAgentAvatarBundleResource(actor *model.User, id, currentID string) (AgentAvatarBundleManifest, error) {
	resource, err := s.repo.Resource(id)
	if err != nil || resource.Kind != agentAvatarBundleResourceKind || resource.Provider != "local" || resource.Status != model.ResourceStatusReady {
		return AgentAvatarBundleManifest{}, BadAuthRequest("Agent 动画包不存在或未就绪")
	}
	if id != currentID && resource.UserID != actor.ID {
		return AgentAvatarBundleManifest{}, Forbidden("只能启用自己上传的 Agent 动画包")
	}
	_, body, err := s.OpenResource(resource.UserID, id)
	if err != nil {
		return AgentAvatarBundleManifest{}, err
	}
	defer body.Close()
	reader, ok := body.(io.ReaderAt)
	if !ok {
		return AgentAvatarBundleManifest{}, BadAuthRequest("Agent 动画包无法读取")
	}
	return validateAgentAvatarBundleArchive(reader, resource.Size)
}

func (s *Service) AgentAvatarBundleAsset(actor *model.User, id, name string) ([]byte, string, error) {
	if !validAgentAvatarBundlePath(name) || name != "avatar.json" && (path.Base(name) != name || strings.ToLower(path.Ext(name)) != ".mp4") {
		return nil, "", BadAuthRequest("Agent 动画文件路径无效")
	}
	_, appearance, err := s.readAppearance()
	if err != nil {
		return nil, "", err
	}
	active := appearance.Canvas.AvatarType == "bundle" && appearance.Canvas.AvatarBundleResourceID == id
	resource, err := s.repo.Resource(id)
	if err != nil || resource.Kind != agentAvatarBundleResourceKind || resource.Provider != "local" || resource.Status != model.ResourceStatusReady {
		return nil, "", NotFound("Agent 动画包不存在")
	}
	if !active {
		if actor == nil {
			return nil, "", NotFound("Agent 动画包未启用")
		}
		if err := s.RequireAdmin(actor); err != nil {
			return nil, "", err
		}
		if resource.UserID != actor.ID {
			return nil, "", Forbidden("不能预览其他管理员未启用的 Agent 动画包")
		}
	}
	_, body, err := s.OpenResource(resource.UserID, id)
	if err != nil {
		return nil, "", err
	}
	defer body.Close()
	reader, ok := body.(io.ReaderAt)
	if !ok {
		return nil, "", BadAuthRequest("Agent 动画包无法读取")
	}
	archive, err := zip.NewReader(reader, resource.Size)
	if err != nil {
		return nil, "", BadAuthRequest("Agent 动画 ZIP 损坏")
	}
	files := make(map[string]*zip.File, len(archive.File))
	for _, file := range archive.File {
		if !file.FileInfo().IsDir() && validAgentAvatarBundlePath(file.Name) && !ignoredAgentAvatarMetadata(file.Name) {
			files[file.Name] = file
		}
	}
	manifestFile := files["avatar.json"]
	if manifestFile == nil {
		return nil, "", BadAuthRequest("Agent 动画包缺少 avatar.json")
	}
	manifestData, err := readAgentAvatarZipFile(manifestFile, agentAvatarManifestMaxBytes)
	if err != nil {
		return nil, "", err
	}
	manifest, err := parseAgentAvatarManifest(manifestData)
	if err != nil {
		return nil, "", err
	}
	if name == "avatar.json" {
		return manifestData, "application/json", nil
	}
	referenced := false
	for _, file := range manifest.Clips {
		if file == name {
			referenced = true
			break
		}
	}
	file := files[name]
	if !referenced || file == nil {
		return nil, "", NotFound("Agent 动画文件不存在")
	}
	data, err := readAgentAvatarZipFile(file, agentAvatarBundleMaxFileBytes)
	if err != nil {
		return nil, "", err
	}
	if !validAgentAvatarMP4(data) {
		return nil, "", BadAuthRequest("Agent 动画文件不是有效 MP4")
	}
	return data, "video/mp4", nil
}
