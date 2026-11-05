package poselibrary

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/outbound"
)

// ImportRequest 是一次姿势包导入。Systems 必须显式列出要导入的体系，避免误导入整包。
type ImportRequest struct {
	Data    []byte
	BaseURL string
	Systems []string
}

type ImportSystem struct {
	Name     string `json:"name"`
	Count    int    `json:"count"`
	Imported bool   `json:"imported"`
}

type ImportResult struct {
	Source  model.PoseLibrarySource `json:"source"`
	Format  string                  `json:"format"`
	Total   int                     `json:"total"`
	Created int                     `json:"created"`
	Updated int                     `json:"updated"`
	Skipped int                     `json:"skipped"`
	Invalid []string                `json:"invalid,omitempty"`
	Systems []ImportSystem          `json:"systems"`
}

type importEntry struct {
	key      string
	group    string
	code     string
	system   string
	category string
	name     string
	angle    string
	thumb    string
	image    string
	keywords []string
}

type importPack struct {
	format  string
	source  model.PoseLibrarySource
	entries []importEntry
	invalid []string
}

// upstreamPose 对应 anhao/ai-pose-gallery-zh data/pose-zh.json 的单条记录。
type upstreamPose struct {
	ID       string `json:"id"`
	System   string `json:"体系"`
	Code     string `json:"姿势编号"`
	Category string `json:"分类"`
	Name     string `json:"姿势名称"`
	Angle    string `json:"角度"`
	Thumb    string `json:"缩略图"`
	Image    string `json:"原图"`
}

// genericPack 是影策通用姿势包：{"format":"yingce-pose-library","version":1,"source":{...},"items":[...]}。
type genericPack struct {
	Format  string `json:"format"`
	Version int    `json:"version"`
	Source  struct {
		Key         string `json:"key"`
		Name        string `json:"name"`
		Attribution string `json:"attribution"`
		Homepage    string `json:"homepage"`
		BaseURL     string `json:"baseUrl"`
	} `json:"source"`
	Items []struct {
		Key      string   `json:"key"`
		Group    string   `json:"group"`
		Code     string   `json:"code"`
		System   string   `json:"system"`
		Category string   `json:"category"`
		Name     string   `json:"name"`
		Angle    string   `json:"angle"`
		Thumb    string   `json:"thumb"`
		Image    string   `json:"image"`
		Keywords []string `json:"keywords"`
	} `json:"items"`
}

func parseImportPack(data []byte) (*importPack, error) {
	data = bytes.TrimSpace(bytes.TrimPrefix(data, []byte("\xef\xbb\xbf")))
	if len(data) == 0 {
		return nil, kernel.BadAuthRequest("导入文件为空")
	}
	switch data[0] {
	case '[':
		var rows []upstreamPose
		if err := json.Unmarshal(data, &rows); err != nil {
			return nil, kernel.BadAuthRequest("无法解析姿势 JSON：请上传 ai-pose-gallery-zh 的 data/pose-zh.json")
		}
		if len(rows) == 0 || rows[0].ID == "" || rows[0].Name == "" {
			return nil, kernel.BadAuthRequest("文件不是 ai-pose-gallery-zh 的 pose-zh.json（缺少 id / 姿势名称 字段）")
		}
		pack := &importPack{format: SourceAIPoseGalleryZH, source: model.PoseLibrarySource{
			Key:         SourceAIPoseGalleryZH,
			Name:        "AI 姿势参考图库（ai-pose-gallery-zh）",
			Attribution: "姿势素体原作者 ギア（@giaaibusi），中文整理 Anhao",
			Homepage:    "https://github.com/anhao/ai-pose-gallery-zh",
		}}
		for _, row := range rows {
			pack.entries = append(pack.entries, importEntry{
				key: row.ID, group: upstreamGroup(row.ID), code: row.Code, system: row.System, category: row.Category,
				name: row.Name, angle: row.Angle, thumb: row.Thumb, image: row.Image,
			})
		}
		return pack, nil
	case '{':
		var raw genericPack
		if err := json.Unmarshal(data, &raw); err != nil {
			return nil, kernel.BadAuthRequest("无法解析姿势包 JSON")
		}
		if raw.Format != PackFormat || raw.Version != 1 {
			return nil, kernel.BadAuthRequest(fmt.Sprintf("姿势包须声明 format=%q、version=1", PackFormat))
		}
		key := strings.TrimSpace(raw.Source.Key)
		if !validSourceKey(key) || key == SourceCustom {
			return nil, kernel.BadAuthRequest("姿势包 source.key 只能使用 2–64 位小写字母、数字、- 或 _，且不能为 custom")
		}
		name := clip(raw.Source.Name, 120)
		if name == "" {
			name = key
		}
		pack := &importPack{format: PackFormat, source: model.PoseLibrarySource{
			Key: key, Name: name, Attribution: clip(raw.Source.Attribution, 300), Homepage: clip(raw.Source.Homepage, 500), BaseURL: strings.TrimSpace(raw.Source.BaseURL),
		}}
		for _, item := range raw.Items {
			group := strings.TrimSpace(item.Group)
			if group == "" {
				group = item.Key
			}
			pack.entries = append(pack.entries, importEntry{
				key: item.Key, group: group, code: item.Code, system: item.System, category: item.Category,
				name: item.Name, angle: item.Angle, thumb: item.Thumb, image: item.Image, keywords: item.Keywords,
			})
		}
		return pack, nil
	default:
		return nil, kernel.BadAuthRequest("导入文件必须是 JSON")
	}
}

// upstreamGroup 去掉 ID 末尾的视角段：full_single_P001_front -> full_single_P001。
func upstreamGroup(id string) string {
	if index := strings.LastIndex(id, "_"); index > 0 {
		return id[:index]
	}
	return id
}

func validSourceKey(key string) bool {
	if len(key) < 2 || len(key) > 64 {
		return false
	}
	for _, char := range key {
		if !(char >= 'a' && char <= 'z' || char >= '0' && char <= '9' || char == '-' || char == '_') {
			return false
		}
	}
	return true
}

func clip(value string, limit int) string {
	value = strings.TrimSpace(strings.Map(func(char rune) rune {
		if unicode.IsControl(char) {
			return -1
		}
		return char
	}, value))
	if utf8.RuneCountInString(value) <= limit {
		return value
	}
	return string([]rune(value)[:limit])
}

func normalizeAngle(value string) string {
	value = clip(value, 20)
	if value == "" {
		return angleOrder[0]
	}
	if alias, ok := angleAliases[strings.ToLower(value)]; ok {
		return alias
	}
	return value
}

func searchText(parts ...string) string {
	joined := strings.ToLower(strings.Join(parts, " "))
	for len(joined) > 1000 {
		_, size := utf8.DecodeLastRuneInString(joined)
		joined = joined[:len(joined)-size]
	}
	return joined
}

// parseBaseURL 校验图片来源根地址；导入时解析一次 DNS，实际下载时出站客户端仍按 SSRF 策略逐次拦截。
func parseBaseURL(raw string) (*url.URL, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	if len(raw) > 500 {
		return nil, kernel.BadAuthRequest("图片来源地址过长")
	}
	parsed, err := validateOutboundURL(raw)
	if err != nil {
		return nil, err
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, kernel.BadAuthRequest("图片来源地址不能包含查询参数")
	}
	if !strings.HasSuffix(parsed.Path, "/") {
		parsed.Path += "/"
	}
	return parsed, nil
}

// validateOutboundURL 把出站校验的参数错误转成 400，其余错误（如 DNS 失败）保持原样。
func validateOutboundURL(raw string) (*url.URL, error) {
	parsed, err := outbound.ValidateOutboundURL(raw)
	var invalid *outbound.BadRequestError
	if errors.As(err, &invalid) {
		return nil, kernel.BadAuthRequest(invalid.Message)
	}
	return parsed, err
}

// resolveRemote 把条目里的相对路径拼到来源根地址；绝对地址只允许 http/https。
func resolveRemote(base *url.URL, ref string) (string, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return "", nil
	}
	if len(ref) > 600 || strings.ContainsAny(ref, "\\\x00") {
		return "", fmt.Errorf("图片路径无效")
	}
	parsed, err := url.Parse(ref)
	if err != nil {
		return "", fmt.Errorf("图片路径无效")
	}
	if parsed.Scheme != "" || parsed.Host != "" {
		if parsed.Scheme != "https" && parsed.Scheme != "http" || parsed.Host == "" || parsed.User != nil {
			return "", fmt.Errorf("图片地址只支持 http/https")
		}
		return parsed.String(), nil
	}
	if base == nil {
		return "", fmt.Errorf("缺少图片来源地址")
	}
	if strings.HasPrefix(ref, "/") || strings.Contains(ref, "..") {
		return "", fmt.Errorf("图片路径不能以 / 开头或包含 ..")
	}
	return base.ResolveReference(parsed).String(), nil
}

// Import 解析并写入姿势包：新条目进入待同步，已有条目只更新元数据，已同步的图片保持不动。
func (s *Service) Import(actor *model.User, req ImportRequest) (*ImportResult, error) {
	if err := s.admin.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if int64(len(req.Data)) > MaxImportBytes {
		return nil, kernel.BadAuthRequest("导入文件不能超过 16 MB")
	}
	pack, err := parseImportPack(req.Data)
	if err != nil {
		return nil, err
	}
	if len(pack.entries) > maxImportItems {
		return nil, kernel.BadAuthRequest(fmt.Sprintf("单次最多导入 %d 条姿势", maxImportItems))
	}
	baseRaw := strings.TrimSpace(req.BaseURL)
	if baseRaw == "" {
		baseRaw = pack.source.BaseURL
	}
	base, err := parseBaseURL(baseRaw)
	if err != nil {
		return nil, err
	}
	if base != nil {
		pack.source.BaseURL = base.String()
	} else {
		pack.source.BaseURL = ""
	}
	selected := map[string]bool{}
	for _, system := range req.Systems {
		if system = clip(system, 80); system != "" {
			selected[system] = true
		}
	}
	if len(selected) == 0 {
		return nil, kernel.BadAuthRequest("请至少选择一个要导入的体系")
	}

	result := &ImportResult{Format: pack.format, Total: len(pack.entries)}
	systemIndex := map[string]int{}
	type candidate struct {
		entry       importEntry
		order       int
		remoteThumb string
		remoteImage string
	}
	candidates := make([]candidate, 0, len(pack.entries))
	seen := map[string]bool{}
	invalid := func(index int, reason string) {
		result.Skipped++
		if len(result.Invalid) < 8 {
			result.Invalid = append(result.Invalid, fmt.Sprintf("第 %d 条：%s", index+1, reason))
		}
	}
	for index, entry := range pack.entries {
		entry.key = clip(entry.key, 160)
		entry.name = clip(entry.name, 160)
		entry.system = clip(entry.system, 80)
		if entry.system == "" {
			entry.system = "未分类"
		}
		entry.category = clip(entry.category, 80)
		if entry.category == "" {
			entry.category = "其他"
		}
		entry.code = clip(entry.code, 40)
		entry.angle = normalizeAngle(entry.angle)
		entry.group = clip(entry.group, 160)
		if entry.group == "" {
			entry.group = entry.key
		}
		position, known := systemIndex[entry.system]
		if !known {
			position = len(result.Systems)
			systemIndex[entry.system] = position
			result.Systems = append(result.Systems, ImportSystem{Name: entry.system, Imported: selected[entry.system]})
		}
		result.Systems[position].Count++
		if !selected[entry.system] {
			continue
		}
		if entry.key == "" || entry.name == "" {
			invalid(index, "缺少 ID 或名称")
			continue
		}
		if seen[entry.key] {
			invalid(index, "ID 重复："+entry.key)
			continue
		}
		remoteImage, err := resolveRemote(base, entry.image)
		if err != nil || remoteImage == "" {
			reason := "缺少原图路径"
			if err != nil {
				reason = err.Error()
			}
			invalid(index, reason)
			continue
		}
		remoteThumb, err := resolveRemote(base, entry.thumb)
		if err != nil {
			invalid(index, err.Error())
			continue
		}
		seen[entry.key] = true
		candidates = append(candidates, candidate{entry: entry, order: index, remoteThumb: remoteThumb, remoteImage: remoteImage})
	}
	if len(candidates) == 0 {
		return nil, kernel.BadAuthRequest("所选体系里没有可导入的姿势")
	}

	keys := make([]string, 0, len(candidates))
	for _, item := range candidates {
		keys = append(keys, item.entry.key)
	}
	existing, err := s.repo.PoseLibraryItemsByExternalKeys(pack.source.Key, keys)
	if err != nil {
		return nil, err
	}
	orders := make(map[string]int, len(candidates))
	for _, item := range candidates {
		orders[item.entry.key] = item.order
	}
	sortBase, err := s.sourceSortBase(existing, orders)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	created := make([]model.PoseLibraryItem, 0, len(candidates))
	updated := make([]model.PoseLibraryItem, 0)
	for _, item := range candidates {
		entry := item.entry
		record, found := existing[entry.key]
		if !found {
			record = model.PoseLibraryItem{ID: kernel.NewID(), SourceKey: pack.source.Key, ExternalKey: entry.key, Enabled: true, Status: model.PoseLibraryStatusPending, CreatedBy: actor.ID, CreatedAt: now}
		}
		record.GroupKey = pack.source.Key + ":" + entry.group
		record.Code = entry.code
		record.System = entry.system
		record.Category = entry.category
		record.Name = entry.name
		record.Angle = entry.angle
		record.SearchText = searchText(append([]string{entry.name, entry.category, entry.system, entry.code, entry.angle, entry.key}, entry.keywords...)...)
		record.SortOrder = sortBase + item.order
		record.RemoteThumb = item.remoteThumb
		record.RemoteImage = item.remoteImage
		record.UpdatedAt = now
		if record.Status == model.PoseLibraryStatusFailed {
			// 换了来源地址或重新导入后让失败条目重新排队。
			record.Status = model.PoseLibraryStatusPending
			record.Error = ""
		}
		if found {
			updated = append(updated, record)
		} else {
			created = append(created, record)
		}
	}
	source := pack.source
	source.CreatedBy = actor.ID
	source.CreatedAt = now
	source.UpdatedAt = now
	if err := s.repo.SavePoseLibraryImport(&source, created, updated); err != nil {
		return nil, err
	}
	result.Source = source
	result.Created = len(created)
	result.Updated = len(updated)
	if err := s.admin.AppendAudit(actor, "pose_library.import", "pose_library_source", source.Key, fmt.Sprintf("导入姿势库 %s：新增 %d，更新 %d", source.Name, result.Created, result.Updated), map[string]any{"created": result.Created, "updated": result.Updated, "skipped": result.Skipped, "systems": req.Systems}); err != nil {
		return nil, err
	}
	return result, nil
}

// sortSourceStride 给每个导入来源预留一段排序号，同一来源追加体系时不会插进其他来源中间。
const sortSourceStride = 100000

// sourceSortBase 让同一来源重新导入时沿用原来的排序起点，新来源从下一段排序号开始。
func (s *Service) sourceSortBase(existing map[string]model.PoseLibraryItem, orders map[string]int) (int, error) {
	found := false
	base := 0
	for key, item := range existing {
		candidate := item.SortOrder - orders[key]
		if !found || candidate < base {
			base, found = candidate, true
		}
	}
	if found {
		return base, nil
	}
	maxOrder, err := s.repo.MaxPoseLibrarySortOrder()
	if err != nil {
		return 0, err
	}
	return (maxOrder/sortSourceStride + 1) * sortSourceStride, nil
}
