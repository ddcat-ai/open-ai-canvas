package app

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"yingce/backend/internal/ecommerceskills"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

const ecommerceInstalledPrefix = "ecommerce_installed_skill."
const EcommerceSkillMaxBytes int64 = 1 << 30

func ecommerceInstalledTerms(text string) []string {
	result := []string{}
	seen := map[string]bool{}
	add := func(term string) {
		if len([]rune(term)) >= 2 && !seen[term] && len(result) < 200 {
			seen[term] = true
			result = append(result, term)
		}
	}
	text = strings.ToLower(text)
	for _, word := range strings.FieldsFunc(text, func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsNumber(r) }) {
		runes := []rune(word)
		if len(runes) < 30 {
			add(word)
		}
		for i := 0; i+1 < len(runes); i++ {
			if unicode.Is(unicode.Han, runes[i]) && unicode.Is(unicode.Han, runes[i+1]) {
				add(string(runes[i : i+2]))
			}
		}
	}
	return result
}

type ecommerceInstalledSkill struct {
	ecommerceskills.ManagedSkill
	InstalledBy   string    `json:"installedBy"`
	CustomName    string    `json:"customName"`
	AutoUpdate    bool      `json:"autoUpdate"`
	SourceRef     string    `json:"sourceRef"`
	Subdir        string    `json:"subdir"`
	LastCheckedAt time.Time `json:"lastCheckedAt"`
	LastSyncedAt  time.Time `json:"lastSyncedAt"`
	SyncError     string    `json:"syncError"`
	PackageKey    string    `json:"packageKey"`
}

func (s *Service) ecommerceInstalledSkills() ([]ecommerceInstalledSkill, error) {
	rows, err := s.repo.SystemSettingsWithPrefix(ecommerceInstalledPrefix, 10000)
	if err != nil {
		return nil, err
	}
	result := make([]ecommerceInstalledSkill, 0, len(rows))
	for _, row := range rows {
		var item ecommerceInstalledSkill
		if err := json.Unmarshal([]byte(row.ValueJSON), &item); err != nil {
			return nil, err
		}
		if item.CustomName != "" {
			item.Name = item.CustomName
		}
		result = append(result, item)
	}
	return result, nil
}

func (s *Service) saveEcommerceInstalledSkill(item ecommerceInstalledSkill) error {
	raw, err := json.Marshal(item)
	if err != nil {
		return err
	}
	return s.repo.SaveSystemSetting(&model.SystemSetting{Key: ecommerceInstalledPrefix + item.ID, ValueJSON: string(raw), UpdatedBy: item.InstalledBy})
}

func (s *Service) updateEcommerceInstalledSkill(id string, change func(*ecommerceInstalledSkill)) error {
	for attempt := 0; attempt < 5; attempt++ {
		row, err := s.repo.SystemSettingOptional(ecommerceInstalledPrefix + id)
		if err != nil {
			return err
		}
		if row == nil {
			return BadAuthRequest("用户安装的技能不存在")
		}
		var current ecommerceInstalledSkill
		if err := json.Unmarshal([]byte(row.ValueJSON), &current); err != nil {
			return err
		}
		change(&current)
		raw, err := json.Marshal(current)
		if err != nil {
			return err
		}
		saved, err := s.repo.CompareAndSwapEcommerceSkill(row.Key, row.ValueJSON, string(raw))
		if err != nil {
			return err
		}
		if saved {
			return nil
		}
	}
	return BadAuthRequest("技能正在更新，请稍后重试")
}

func (s *Service) commitEcommerceInstallation(item ecommerceInstalledSkill) error {
	items, err := s.ecommerceInstalledSkills()
	if err != nil {
		return err
	}
	for _, existing := range items {
		same := item.SourceURL != "" && item.SourceURL == existing.SourceURL && item.Subdir == existing.Subdir
		same = same || item.SourceURL == "" && existing.SourceURL == "" && item.SourcePath != "" && item.SourcePath == existing.SourcePath
		if !same {
			continue
		}
		oldKey := ""
		err = s.updateEcommerceInstalledSkill(existing.ID, func(current *ecommerceInstalledSkill) {
			oldKey = current.PackageKey
			item.ID, item.CustomName = current.ID, current.CustomName
			*current = item
		})
		if err == nil && oldKey != "" {
			_ = os.Remove(filepath.Join(s.dataDir, "ecommerce-skill-packages", oldKey))
		}
		return err
	}
	return s.saveEcommerceInstalledSkill(item)
}

// The archive stays on disk. Only bounded planning text enters memory and prompts.
func readEcommerceSkillPackage(filename, subdir string) ([]byte, string, error) {
	reader, err := zip.OpenReader(filename)
	if err != nil {
		return nil, "", BadAuthRequest("ZIP 技能包无效")
	}
	defer reader.Close()
	if len(reader.File) > 50000 {
		return nil, "", BadAuthRequest("技能包文件数量超过 50000")
	}
	var total uint64
	manifests := []*zip.File{}
	seen := map[string]bool{}
	for _, entry := range reader.File {
		name := strings.ReplaceAll(entry.Name, "\\", "/")
		clean := path.Clean(name)
		if strings.HasPrefix(clean, "/") || clean == ".." || strings.HasPrefix(clean, "../") || strings.Contains(clean, ":") || entry.Mode()&os.ModeSymlink != 0 {
			return nil, "", BadAuthRequest("技能包包含不安全路径或软链接")
		}
		if entry.FileInfo().IsDir() {
			continue
		}
		if seen[clean] {
			return nil, "", BadAuthRequest("技能包包含重复路径")
		}
		seen[clean] = true
		if entry.UncompressedSize64 > uint64(EcommerceSkillMaxBytes)-total {
			return nil, "", BadAuthRequest("文件太大，技能包解压后不能超过 1GB")
		}
		total += entry.UncompressedSize64
		if path.Base(clean) == "SKILL.md" && (subdir == "" || strings.HasSuffix(path.Dir(clean), "/"+subdir) || path.Dir(clean) == subdir) {
			manifests = append(manifests, entry)
		}
	}
	if len(manifests) != 1 {
		return nil, "", BadAuthRequest("请选择仅含一个 SKILL.md 的技能目录；合集请指定子目录")
	}
	root := path.Dir(manifests[0].Name)
	texts := map[string]*zip.File{}
	for _, entry := range reader.File {
		rel := strings.TrimPrefix(entry.Name, root+"/")
		if root == "." {
			rel = entry.Name
		}
		if rel == entry.Name && root != "." {
			continue
		}
		ext := strings.ToLower(path.Ext(rel))
		if ext != ".md" && ext != ".txt" && ext != ".markdown" {
			continue
		}
		if entry.UncompressedSize64 > 32000 {
			if rel == "SKILL.md" {
				return nil, "", BadAuthRequest("SKILL.md 正文超过 32KB，请精简策划方法")
			}
			continue
		}
		texts[rel] = entry
	}
	queue := []string{"SKILL.md"}
	visited := map[string]bool{}
	blocks := []string{}
	size := 0
	files := map[string]bool{}
	manifest := ""
	for name := range texts {
		files[name] = true
	}
	for len(queue) > 0 {
		name := queue[0]
		queue = queue[1:]
		if visited[name] {
			continue
		}
		visited[name] = true
		entry, ok := texts[name]
		if !ok {
			return nil, "", BadAuthRequest("技能引用缺失、非文本或超过 32KB：" + name)
		}
		f, err := entry.Open()
		if err != nil {
			return nil, "", err
		}
		b, err := io.ReadAll(io.LimitReader(f, 32001))
		f.Close()
		if err != nil {
			return nil, "", err
		}
		if !utf8.Valid(b) || len(b) > 32000 {
			return nil, "", BadAuthRequest("技能文本过大或不是 UTF-8：" + name)
		}
		body := string(b)
		if name == "SKILL.md" {
			manifest = body
		}
		size += len(body)
		if size > 32000 || len(visited) > 12 {
			return nil, "", BadAuthRequest("技能及引用正文超过 32KB 或 12 个文本文件")
		}
		blocks = append(blocks, "文件 "+name+"：\n"+body)
		queue = append(queue, ecommerceSkillReferences(name, body, files)...)
	}
	return []byte(strings.Join(blocks, "\n\n")), manifest, nil
}

func (s *Service) installEcommerceReader(reader io.Reader, filename, subdir string) (ecommerceInstalledSkill, error) {
	var item ecommerceInstalledSkill
	dir := filepath.Join(s.dataDir, "ecommerce-skill-packages")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return item, err
	}
	f, err := os.CreateTemp(dir, "package-*")
	if err != nil {
		return item, err
	}
	temp := f.Name()
	defer os.Remove(temp)
	hash := sha256.New()
	n, err := io.Copy(io.MultiWriter(f, hash), io.LimitReader(reader, EcommerceSkillMaxBytes+1))
	closeErr := f.Close()
	if err != nil {
		return item, err
	}
	if closeErr != nil {
		return item, closeErr
	}
	if n == 0 || n > EcommerceSkillMaxBytes {
		return item, BadAuthRequest("文件太大或为空，电商 Skills 最大支持 1GB")
	}
	var body []byte
	var manifest string
	if strings.EqualFold(filepath.Ext(filename), ".zip") {
		body, manifest, err = readEcommerceSkillPackage(temp, subdir)
	} else {
		if n > 32000 {
			return item, BadAuthRequest("Markdown 正文不能超过 32KB，大型附件请使用 ZIP")
		}
		body, err = os.ReadFile(temp)
		manifest = string(body)
	}
	if err != nil {
		return item, err
	}
	if !utf8.Valid(body) || strings.TrimSpace(manifest) == "" {
		return item, BadAuthRequest("技能正文必须是 UTF-8 文本")
	}
	name := strings.TrimSuffix(filepath.Base(filename), filepath.Ext(filename))
	description := "用户安装的电商策划方法"
	// Accept the common scalar frontmatter without treating it as executable config.
	for _, line := range strings.Split(manifest, "\n") {
		if strings.HasPrefix(line, "name:") {
			name = strings.Trim(strings.TrimSpace(strings.TrimPrefix(line, "name:")), "\"'")
		}
		if strings.HasPrefix(line, "description:") {
			description = strings.Trim(strings.TrimSpace(strings.TrimPrefix(line, "description:")), "\"'")
		}
	}
	if len([]rune(name)) > 80 || name == "" {
		return item, BadAuthRequest("技能名称必须为 1-80 个字符")
	}
	if len([]rune(description)) > 500 {
		description = string([]rune(description)[:500])
	}
	id := "installed-" + kernel.NewID()
	key := id + filepath.Ext(filename)
	if err := os.Rename(temp, filepath.Join(dir, key)); err != nil {
		return item, err
	}
	now := time.Now().UTC()
	item = ecommerceInstalledSkill{ManagedSkill: ecommerceskills.ManagedSkill{ID: id, Name: name, Description: description, Group: "用户安装", Origin: "user-installed", Version: now.Format("20060102.150405"), Instructions: string(body), ContentHash: hex.EncodeToString(hash.Sum(nil)), Priority: 12, PureProduct: true, Terms: ecommerceInstalledTerms(name + " " + description), Types: []string{}, Categories: []string{}, Platforms: []string{}}, PackageKey: key, LastCheckedAt: now, LastSyncedAt: now}
	return item, nil
}

func (s *Service) InstallEcommerceSkillUpload(actor *model.User, header *multipart.FileHeader) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	if header.Size > EcommerceSkillMaxBytes {
		return BadAuthRequest("文件太大，电商 Skills 不能超过 1GB")
	}
	ext := strings.ToLower(filepath.Ext(header.Filename))
	if ext != ".zip" && ext != ".md" && ext != ".markdown" {
		return BadAuthRequest("请选择 ZIP 或 Markdown 技能文件")
	}
	f, err := header.Open()
	if err != nil {
		return err
	}
	defer f.Close()
	item, err := s.installEcommerceReader(f, header.Filename, "")
	if err != nil {
		return err
	}
	item.InstalledBy = actor.ID
	item.SourcePath = header.Filename
	if err := s.commitEcommerceInstallation(item); err != nil {
		os.Remove(filepath.Join(s.dataDir, "ecommerce-skill-packages", item.PackageKey))
		return err
	}
	return nil
}

func (s *Service) fetchEcommerceGitHub(ctx context.Context, userID, url, ref, subdir string) (ecommerceInstalledSkill, error) {
	var empty ecommerceInstalledSkill
	discovery, err := s.DiscoverGitHubSkills(ctx, userID, SkillGitHubDiscoverRequest{URL: url, Ref: ref, Subdir: subdir})
	if err != nil {
		return empty, err
	}
	if len(discovery.Skills) != 1 {
		return empty, BadAuthRequest("仓库包含多个 Skills，请指定技能子目录")
	}
	subdir = discovery.Skills[0].Subdir
	repo := strings.TrimPrefix(discovery.SourceURL, "https://github.com/")
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://codeload.github.com/"+repo+"/zip/"+discovery.SourceCommit, nil)
	if err != nil {
		return empty, err
	}
	client := &http.Client{Timeout: 15 * time.Minute, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		return fmt.Errorf("不允许技能下载重定向")
	}}
	response, err := client.Do(request)
	if err != nil {
		return empty, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return empty, BadAuthRequest("GitHub 技能下载失败，请稍后重试")
	}
	if response.ContentLength > EcommerceSkillMaxBytes {
		return empty, BadAuthRequest("文件太大，GitHub 技能仓库 ZIP 不能超过 1GB")
	}
	item, err := s.installEcommerceReader(response.Body, "github.zip", subdir)
	if err != nil {
		return empty, err
	}
	item.SourceURL, item.SourceRef, item.SourceCommit, item.Subdir = discovery.SourceURL, discovery.SourceRef, discovery.SourceCommit, subdir
	item.InstalledBy, item.AutoUpdate = userID, true
	return item, nil
}

func (s *Service) InstallEcommerceSkillGitHub(ctx context.Context, actor *model.User, url, subdir string) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	item, err := s.fetchEcommerceGitHub(ctx, actor.ID, url, "", subdir)
	if err != nil {
		return err
	}
	if err := s.commitEcommerceInstallation(item); err != nil {
		os.Remove(filepath.Join(s.dataDir, "ecommerce-skill-packages", item.PackageKey))
		return err
	}
	return nil
}

func (s *Service) RenameEcommerceSkill(actor *model.User, id, name string) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	name = strings.TrimSpace(name)
	if name == "" || len([]rune(name)) > 80 {
		return BadAuthRequest("技能名称必须为 1-80 个字符")
	}
	return s.updateEcommerceInstalledSkill(id, func(item *ecommerceInstalledSkill) { item.CustomName = name })
}

func (s *Service) startEcommerceSkillSyncWorker(ctx context.Context) {
	s.runWorkerLoop(func(ctx context.Context) {
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for {
			items, err := s.ecommerceInstalledSkills()
			if err == nil {
				for _, item := range items {
					if ctx.Err() != nil {
						return
					}
					if !item.AutoUpdate || time.Since(item.LastCheckedAt) < 6*time.Hour {
						continue
					}
					discovery, err := s.DiscoverGitHubSkills(ctx, item.InstalledBy, SkillGitHubDiscoverRequest{URL: item.SourceURL, Ref: item.SourceRef, Subdir: item.Subdir})
					var updated ecommerceInstalledSkill
					changed := err == nil && discovery.SourceCommit != item.SourceCommit
					if changed {
						updated, err = s.fetchEcommerceGitHub(ctx, item.InstalledBy, item.SourceURL, item.SourceRef, item.Subdir)
					}
					oldKey := ""
					saveErr := s.updateEcommerceInstalledSkill(item.ID, func(current *ecommerceInstalledSkill) {
						current.LastCheckedAt = time.Now().UTC()
						if err != nil {
							current.SyncError = err.Error()
							return
						}
						current.SyncError = ""
						if changed {
							oldKey = current.PackageKey
							updated.ID, updated.CustomName = current.ID, current.CustomName
							*current = updated
						}
					})
					if updated.PackageKey != "" {
						if saveErr != nil {
							os.Remove(filepath.Join(s.dataDir, "ecommerce-skill-packages", updated.PackageKey))
						} else if oldKey != "" {
							os.Remove(filepath.Join(s.dataDir, "ecommerce-skill-packages", oldKey))
						}
					}
				}
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	})
}
