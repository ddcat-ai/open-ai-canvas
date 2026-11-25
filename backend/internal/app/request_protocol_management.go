package app

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

type RequestProtocolBinding struct {
	ChannelID       string `json:"channelId"`
	ModelID         string `json:"modelId"`
	ModelKey        string `json:"modelKey"`
	ProtocolRelease string `json:"protocolRelease,omitempty"`
}

type RequestProtocolRelease struct {
	Version  string                   `json:"version"`
	SHA256   string                   `json:"sha256"`
	Current  bool                     `json:"current"`
	Manifest protocol.Manifest        `json:"manifest"`
	Bindings []RequestProtocolBinding `json:"bindings"`
}

type RequestProtocolView struct {
	ID         string                   `json:"id"`
	ProviderID string                   `json:"providerId"`
	Version    string                   `json:"version"`
	SHA256     string                   `json:"sha256"`
	Source     string                   `json:"source"`
	ReadOnly   bool                     `json:"readOnly"`
	Enabled    bool                     `json:"enabled"`
	UpdatedAt  time.Time                `json:"updatedAt"`
	Manifest   protocol.Manifest        `json:"manifest"`
	Bindings   []RequestProtocolBinding `json:"bindings"`
	Releases   []RequestProtocolRelease `json:"releases"`
}

type RequestProtocolCheck struct {
	Manifest json.RawMessage            `json:"manifest"`
	Request  protocol.GenerationRequest `json:"request"`
	Response json.RawMessage            `json:"response,omitempty"`
	Phase    string                     `json:"phase"`
	TaskID   string                     `json:"taskId,omitempty"`
}

type RequestProtocolCheckResult struct {
	Create   protocol.RequestSpec  `json:"create"`
	Poll     *protocol.RequestSpec `json:"poll,omitempty"`
	Download *protocol.RequestSpec `json:"download,omitempty"`
	Parsed   any                   `json:"parsed,omitempty"`
	Warnings []string              `json:"warnings"`
}

type PublishRequestProtocolRequest struct {
	ID             string               `json:"id"`
	ExpectedSHA256 string               `json:"expectedSha256,omitempty"`
	Check          RequestProtocolCheck `json:"check"`
}

var (
	requestProtocolIDPattern              = regexp.MustCompile(`^[a-z][a-z0-9-]{0,39}$`)
	defaultDeclarativeProtocolPermissions = []string{"generation.run", "media.read"}
)

func normalizeDeclarativeProtocolPermissions(permissions []string) []string {
	normalized := make([]string, 0, len(permissions))
	seen := make(map[string]struct{}, len(permissions))
	for _, permission := range permissions {
		trimmed := strings.TrimSpace(permission)
		if trimmed == "" {
			continue
		}
		if _, exists := seen[trimmed]; exists {
			continue
		}
		seen[trimmed] = struct{}{}
		normalized = append(normalized, trimmed)
	}
	if len(normalized) == 0 {
		return append([]string(nil), defaultDeclarativeProtocolPermissions...)
	}
	return normalized
}

func isSingleDeclarativeProtocolManifest(manifest protocol.Manifest) bool {
	allowed := protocol.ManifestContributions{Providers: manifest.Contributes.Providers}
	actual, _ := json.Marshal(manifest.Contributes)
	expected, _ := json.Marshal(allowed)
	return len(manifest.Contributes.Providers) == 1 && bytes.Equal(actual, expected) &&
		manifest.Entry == "" && len(manifest.Surfaces) == 0 && manifest.Runtime.Web == "" &&
		(manifest.Runtime.Backend == "" || manifest.Runtime.Backend == "declarative")
}

func isEditableDeclarativeProtocolManifest(manifest protocol.Manifest) bool {
	return isSingleDeclarativeProtocolManifest(manifest) && manifest.Metadata.ID != "" && manifest.Metadata.ID == manifest.Contributes.Providers[0].ID
}

func managedRequestProtocol(raw []byte) (protocol.Manifest, protocol.Adapter, error) {
	var manifest protocol.Manifest
	if len(raw) == 0 || len(raw) > protocol.PluginManifestMaxBytes {
		return manifest, nil, BadAuthRequest("请求协议为空或超出大小限制")
	}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return manifest, nil, BadAuthRequest("请求协议 JSON 无效：" + err.Error())
	}
	// This editor manages declarative request plugins only; executable or UI
	// plugin contributions keep the standard package installation boundary.
	if !isSingleDeclarativeProtocolManifest(manifest) {
		return manifest, nil, BadAuthRequest("请求协议只支持一个声明式请求定义，不能包含可执行代码或其他插件贡献")
	}
	for _, field := range manifest.Configuration.Fields {
		if field.Type == "secret" && field.Default != nil && field.Default != "" {
			return manifest, nil, BadAuthRequest("密钥必须保存在渠道中，不能写入协议默认值")
		}
	}
	provider := manifest.Contributes.Providers[0]
	switch strings.ToLower(strings.TrimSpace(provider.Auth.Type)) {
	case "", "none", "bearer", "basic", "anthropic", "google-api-key", "gemini", "volcengine-v4", "aws-sigv4", "tc3":
	case "header", "api-key", "apikey":
		if strings.TrimSpace(provider.Auth.Header) == "" {
			return manifest, nil, BadAuthRequest("自定义鉴权需要填写请求头名称")
		}
	case "query":
		if strings.TrimSpace(provider.Auth.Query) == "" && strings.TrimSpace(provider.Auth.Field) == "" {
			return manifest, nil, BadAuthRequest("查询参数鉴权需要填写参数名称")
		}
	default:
		return manifest, nil, BadAuthRequest("不支持该鉴权类型")
	}
	operations := []*protocol.ManifestOperation{&provider.Create, provider.Poll, provider.Result, provider.Cancel, provider.Agent}
	if provider.Upload != nil {
		operations = append(operations, &provider.Upload.ManifestOperation)
	}
	for _, operation := range operations {
		if operation == nil {
			continue
		}
		for key := range operation.Headers {
			if sensitiveProtocolField(key) {
				return manifest, nil, BadAuthRequest("鉴权请求头请在鉴权方式中配置，密钥由渠道注入")
			}
		}
		for key := range operation.Query {
			if sensitiveProtocolField(key) {
				return manifest, nil, BadAuthRequest("鉴权参数请在鉴权方式中配置，密钥由渠道注入")
			}
		}
	}
	adapters, err := protocol.LoadInstalledProviders(raw, nil)
	if err != nil {
		return manifest, nil, BadAuthRequest("请求协议校验失败：" + err.Error())
	}
	return manifest, adapters[0], nil
}

func sensitiveProtocolField(name string) bool {
	value := strings.ToLower(strings.NewReplacer("-", "", "_", "").Replace(name))
	return value == "authorization" || value == "cookie" || strings.Contains(value, "apikey") ||
		value == "accesskey" || value == "secretkey" || value == "token" || value == "accesstoken"
}

func checkDeclarativeRequestProtocol(ctx context.Context, check RequestProtocolCheck) (*RequestProtocolCheckResult, error) {
	manifest, adapter, err := managedRequestProtocol(check.Manifest)
	if err != nil {
		return nil, err
	}
	// Build and parse through the production adapter. Never execute the request,
	// resolve a channel credential, or download a URL during sample validation.
	create, err := adapter.BuildCreate(ctx, protocol.RequestContext{BaseURL: "https://example.com", Request: check.Request})
	if err != nil {
		return nil, BadAuthRequest("请求参数映射失败：" + err.Error())
	}
	if err := create.Validate(); err != nil {
		return nil, BadAuthRequest("创建请求无效：" + err.Error())
	}
	result := &RequestProtocolCheckResult{Create: create, Warnings: []string{}}
	pollContext := protocol.PollContext{BaseURL: "https://example.com", Model: check.Request.Model, Request: check.Request, TaskID: defaultString(check.TaskID, "example-task")}
	provider := manifest.Contributes.Providers[0]
	if provider.Poll != nil {
		poll, err := adapter.BuildPoll(ctx, pollContext)
		if err != nil {
			return nil, BadAuthRequest("查询接口映射失败：" + err.Error())
		}
		if err := poll.Validate(); err != nil {
			return nil, BadAuthRequest("查询请求无效：" + err.Error())
		}
		result.Poll = &poll
	}
	if provider.Result != nil {
		download, err := adapter.(protocol.ResultAdapter).BuildResult(ctx, pollContext)
		if err != nil {
			return nil, BadAuthRequest("下载接口映射失败：" + err.Error())
		}
		if err := download.Validate(); err != nil {
			return nil, BadAuthRequest("下载请求无效：" + err.Error())
		}
		result.Download = &download
		result.Warnings = append(result.Warnings, "独立下载接口仅校验请求映射，文件下载仍需用已有任务联调")
	}
	if len(check.Response) == 0 {
		return nil, BadAuthRequest("请提供示例响应，验证任务状态和结果解析")
	}
	if !json.Valid(check.Response) || len(check.Response) > protocol.PluginManifestMaxBytes {
		return nil, BadAuthRequest("示例响应不是有效 JSON，或超出大小限制")
	}
	var status protocol.Status
	var output *protocol.Result
	switch check.Phase {
	case "create":
		parsed, err := adapter.ParseCreate(ctx, check.Response)
		if err != nil {
			return nil, BadAuthRequest("创建响应解析失败：" + err.Error())
		}
		result.Parsed, status, output = parsed, parsed.Status, parsed.Result
		if (status == protocol.StatusPending || status == protocol.StatusProcessing) && (parsed.TaskID == "" || provider.Poll == nil) {
			return nil, BadAuthRequest("异步创建响应缺少任务 ID，或尚未配置查询接口")
		}
	case "poll":
		if provider.Poll == nil {
			return nil, BadAuthRequest("当前协议没有查询接口，请校验创建响应")
		}
		parsed, err := adapter.ParsePoll(ctx, pollContext, check.Response)
		if err != nil {
			return nil, BadAuthRequest("查询响应解析失败：" + err.Error())
		}
		result.Parsed, status, output = parsed, parsed.Status, parsed.Result
	default:
		return nil, BadAuthRequest("响应阶段只支持 create 或 poll")
	}
	if status == protocol.StatusSucceeded && !protocolResultHasOutput(string(provider.Capabilities[0]), output) && provider.Result == nil {
		return nil, BadAuthRequest("示例响应表示成功，但没有解析出作品内容或地址，请检查结果映射")
	}
	if status == protocol.StatusFailed || status == protocol.StatusCancelled {
		result.Warnings = append(result.Warnings, "示例响应被识别为失败或取消，请确认这是预期结果")
	}
	return result, nil
}

func (s *Service) AdminCheckRequestProtocol(ctx context.Context, actor *model.User, check RequestProtocolCheck) (*RequestProtocolCheckResult, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	return checkDeclarativeRequestProtocol(ctx, check)
}

func singleProviderManifest(base protocol.Manifest, provider protocol.ManifestProvider) protocol.Manifest {
	scoped := base
	scoped.APIVersion = defaultString(base.APIVersion, "yingce.plugin/v2")
	scoped.Contributes = protocol.ManifestContributions{Providers: []protocol.ManifestProvider{provider}}
	return scoped
}

func (c *pluginRuntime) recordSnapshot() []pluginRecord {
	c.mu.RLock()
	defer c.mu.RUnlock()
	records := make([]pluginRecord, 0, len(c.plugins))
	for _, record := range c.plugins {
		records = append(records, record)
	}
	sort.Slice(records, func(i, j int) bool { return records[i].Metadata.ID < records[j].Metadata.ID })
	return records
}

func (s *Service) AdminRequestProtocols(actor *model.User) ([]RequestProtocolView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if s.pluginRuntime == nil {
		return nil, fmt.Errorf("协议运行时未初始化")
	}
	items := []RequestProtocolView{}
	for _, record := range s.pluginRuntime.recordSnapshot() {
		view := record.view()
		management := pluginManagementFromView(view)
		if management.Kind != PluginKindProtocol {
			continue
		}
		var manifest protocol.Manifest
		if err := json.Unmarshal(record.Raw, &manifest); err != nil {
			continue
		}
		editable := record.Source == PluginOriginUploaded && isEditableDeclarativeProtocolManifest(manifest)
		archivedManifests := make([]struct {
			release  requestPackageVersion
			manifest protocol.Manifest
		}, 0, len(record.History))
		for index := len(record.History) - 1; index >= 0; index-- {
			release := record.History[index]
			verified, err := s.pluginRuntime.verifiedRequestManifest(record.Metadata.ID, release, record.Metadata.Enabled)
			if err != nil {
				continue
			}
			archivedManifests = append(archivedManifests, struct {
				release  requestPackageVersion
				manifest protocol.Manifest
			}{release: release, manifest: *verified})
		}
		for _, provider := range manifest.Contributes.Providers {
			currentManifest := singleProviderManifest(manifest, provider)
			releases := []RequestProtocolRelease{{
				Version:  manifest.Metadata.Version,
				SHA256:   record.SHA256,
				Current:  true,
				Manifest: currentManifest,
				Bindings: []RequestProtocolBinding{},
			}}
			for _, archived := range archivedManifests {
				for _, archivedProvider := range archived.manifest.Contributes.Providers {
					if archivedProvider.ID == provider.ID {
						releases = append(releases, RequestProtocolRelease{
							Version:  archived.release.Version,
							SHA256:   archived.release.SHA256,
							Current:  false,
							Manifest: singleProviderManifest(archived.manifest, archivedProvider),
							Bindings: []RequestProtocolBinding{},
						})
						break
					}
				}
			}
			items = append(items, RequestProtocolView{
				ID:         manifest.Metadata.ID,
				ProviderID: provider.ID,
				Version:    manifest.Metadata.Version,
				SHA256:     record.SHA256,
				Source:     record.Source,
				ReadOnly:   !(editable && manifest.Metadata.ID == provider.ID),
				Enabled:    record.Status == "enabled",
				UpdatedAt:  record.UpdatedAt,
				Manifest:   currentManifest,
				Bindings:   []RequestProtocolBinding{},
				Releases:   releases,
			})
		}
	}
	providerIDs := make([]string, 0, len(items))
	for _, item := range items {
		providerIDs = append(providerIDs, item.ProviderID)
	}
	bindings, err := s.repo.ChannelModelsForRequestProtocols(providerIDs)
	if err != nil {
		return nil, err
	}
	for index := range items {
		for _, binding := range bindings {
			if string(binding.Protocol) != items[index].ProviderID {
				continue
			}
			entry := RequestProtocolBinding{
				ChannelID:       binding.ChannelID,
				ModelID:         binding.ID,
				ModelKey:        binding.ModelKey,
				ProtocolRelease: binding.ProtocolRelease,
			}
			items[index].Bindings = append(items[index].Bindings, entry)
			for releaseIndex := range items[index].Releases {
				release := &items[index].Releases[releaseIndex]
				if binding.ProtocolRelease == release.SHA256 || (binding.ProtocolRelease == "" && release.Current) {
					release.Bindings = append(release.Bindings, entry)
				}
			}
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].ReadOnly != items[j].ReadOnly {
			return !items[i].ReadOnly
		}
		if items[i].ID == items[j].ID {
			return items[i].ProviderID < items[j].ProviderID
		}
		return items[i].ID < items[j].ID
	})
	return items, nil
}

func (s *Service) AdminPublishRequestProtocol(ctx context.Context, actor *model.User, request PublishRequestProtocolRequest) (*RequestProtocolView, error) {
	if _, err := s.AdminCheckRequestProtocol(ctx, actor, request.Check); err != nil {
		return nil, err
	}
	if !requestProtocolIDPattern.MatchString(request.ID) {
		return nil, BadAuthRequest("协议标识需以小写字母开头，使用小写字母、数字和连字符，最多 40 位")
	}
	expectedSHA256 := strings.ToLower(strings.TrimSpace(request.ExpectedSHA256))
	if expectedSHA256 != "" {
		if decoded, err := hex.DecodeString(expectedSHA256); err != nil || len(decoded) != 32 {
			return nil, BadAuthRequest("期望的协议包摘要格式无效")
		}
	}
	if s.pluginRuntime == nil {
		return nil, fmt.Errorf("协议运行时未初始化")
	}
	installed, err := s.pluginRuntime.publishDeclarativeProtocol(request.ID, expectedSHA256, func(nextVersion string) ([]byte, error) {
		manifest, _, err := managedRequestProtocol(request.Check.Manifest)
		if err != nil {
			return nil, err
		}
		oldID := manifest.Contributes.Providers[0].ID
		manifest.APIVersion = "yingce.plugin/v2"
		manifest.Metadata.ID = request.ID
		manifest.Metadata.Version = nextVersion
		manifest.Metadata.Enabled = true
		manifest.Permissions = normalizeDeclarativeProtocolPermissions(manifest.Permissions)
		manifest.Runtime.Backend = "declarative"
		manifest.Contributes.Providers[0].ID = request.ID
		raw, err := json.Marshal(manifest)
		if err != nil {
			return nil, err
		}
		check := request.Check
		if oldID != "" && oldID != request.ID {
			// When copying an existing template under a new ID, rewrite option
			// namespace references without mutating literal prompt/config text.
			var tree any
			if err := json.Unmarshal(raw, &tree); err != nil {
				return nil, err
			}
			renameProtocolReferences(tree, oldID, request.ID)
			raw, err = json.Marshal(tree)
			if err != nil {
				return nil, err
			}
			if values, exists := check.Request.ProviderOptions[oldID]; exists {
				cloned := make(map[string]map[string]any, len(check.Request.ProviderOptions))
				for key, value := range check.Request.ProviderOptions {
					cloned[key] = value
				}
				delete(cloned, oldID)
				cloned[request.ID] = values
				check.Request.ProviderOptions = cloned
			}
		}
		check.Manifest = raw
		if _, err := checkDeclarativeRequestProtocol(ctx, check); err != nil {
			return nil, err
		}
		return packDeclarativeProtocolPlugin(raw)
	})
	if err != nil {
		return nil, err
	}
	if s.repo != nil {
		now := time.Now().UTC()
		state := &model.PluginPlatformState{
			PluginID:  installed.Manifest.ID,
			Available: installed.Status == "enabled",
			UpdatedBy: actor.ID,
			CreatedAt: now,
			UpdatedAt: now,
		}
		if err := s.repo.SavePluginPlatformState(state); err != nil {
			return nil, fmt.Errorf("保存插件平台状态：%w", err)
		}
	}
	s.invalidateRouteCatalog()
	if err := s.appendAdminAudit(actor, "request_protocol.publish", "plugin", request.ID, "发布请求协议版本", map[string]any{
		"version":    installed.Manifest.Version,
		"sha256":     installed.SHA256,
		"providerId": request.ID,
	}); err != nil {
		return nil, err
	}
	items, err := s.AdminRequestProtocols(actor)
	if err != nil {
		return nil, err
	}
	for _, item := range items {
		if item.ID == request.ID && item.ProviderID == request.ID {
			return &item, nil
		}
	}
	return nil, fmt.Errorf("请求协议发布后未能回读")
}

// publishDeclarativeProtocol publishes a new SemVer release for a declarative
// request plugin using the native .yingce-plugin archive pipeline. Existing
// releases stay archived under requestReleases so bound models and active tasks
// remain pinned to their SHA-256 digests.
func (c *pluginRuntime) publishDeclarativeProtocol(id, expectedSHA256 string, prepare func(nextVersion string) ([]byte, error)) (PluginView, error) {
	c.mutationMu.Lock()
	defer c.mutationMu.Unlock()

	stored, err := c.readRegistry()
	if err != nil {
		return PluginView{}, err
	}
	var existingStored *pluginRegistryRecord
	for index := range stored {
		if stored[index].ID == id {
			existingStored = &stored[index]
			break
		}
	}
	if existingStored != nil && isBuiltInPluginSource(existingStored.Source) {
		return PluginView{}, BadAuthRequest("内置插件不能覆盖，请使用新的协议标识")
	}

	c.mu.RLock()
	active, activeExists := c.plugins[id]
	otherPlugins := make([]pluginRecord, 0, len(c.plugins))
	for otherID, rec := range c.plugins {
		if otherID != id {
			otherPlugins = append(otherPlugins, rec)
		}
	}
	registry := c.registry
	c.mu.RUnlock()

	if activeExists {
		if isBuiltInPluginSource(active.Source) {
			return PluginView{}, BadAuthRequest("内置插件不能覆盖，请使用新的协议标识")
		}
		var currentManifest protocol.Manifest
		if err := json.Unmarshal(active.Raw, &currentManifest); err != nil || !isEditableDeclarativeProtocolManifest(currentManifest) {
			return PluginView{}, BadAuthRequest("该标识已被其他类型插件占用，请更换协议标识")
		}
		if expectedSHA256 == "" {
			return PluginView{}, &AuthError{Status: http.StatusConflict, Message: "协议标识已存在，请更换标识或刷新后编辑"}
		}
		if !strings.EqualFold(active.PackageSHA256, expectedSHA256) {
			return PluginView{}, &AuthError{Status: http.StatusConflict, Message: "协议已被其他管理员更新，请刷新后重新编辑"}
		}
	} else if expectedSHA256 != "" {
		return PluginView{}, &AuthError{Status: http.StatusConflict, Message: "协议已被卸载或变更，请刷新后重试"}
	}

	if err := ensureDeclarativeProviderIDAvailable(id, otherPlugins, stored, registry); err != nil {
		return PluginView{}, err
	}
	nextVersion := nextDeclarativeProtocolVersion(existingStored)
	pkgBytes, err := prepare(nextVersion)
	if err != nil {
		return PluginView{}, err
	}
	return c.installLocked(pkgBytes, id+".yingce-plugin")
}

func ensureDeclarativeProviderIDAvailable(id string, otherPlugins []pluginRecord, stored []pluginRegistryRecord, registry *protocol.Registry) error {
	for _, other := range otherPlugins {
		if manifestClaimsProviderID(other.Raw, id) {
			return BadAuthRequest("协议标识已被其他插件占用，请更换标识")
		}
	}
	for _, rec := range stored {
		if rec.ID != id && manifestClaimsProviderID(rec.Raw, id) {
			return BadAuthRequest("协议标识已被其他插件占用，请更换标识")
		}
	}
	if registry != nil {
		for _, release := range registry.Releases(id) {
			if release.PluginID != id {
				return BadAuthRequest("协议标识已被其他插件占用，请更换标识")
			}
		}
		if adapter, ok := registry.Resolve(id); ok && adapter.Metadata().ID != id {
			return BadAuthRequest("协议标识与已有协议别名冲突，请更换标识")
		}
	}
	return nil
}

func manifestClaimsProviderID(raw []byte, id string) bool {
	var manifest protocol.Manifest
	if json.Unmarshal(raw, &manifest) != nil {
		return false
	}
	for _, provider := range manifest.Contributes.Providers {
		if provider.ID == id {
			return true
		}
	}
	return false
}

func nextDeclarativeProtocolVersion(record *pluginRegistryRecord) string {
	if record == nil {
		return "1.0.0"
	}
	used := make(map[string]struct{}, len(record.History)+1)
	maxMajor := 0
	var current protocol.Manifest
	if json.Unmarshal(record.Raw, &current) == nil && current.Metadata.Version != "" {
		used[current.Metadata.Version] = struct{}{}
		maxMajor = max(maxMajor, majorVersionNumber(current.Metadata.Version))
	}
	for _, release := range record.History {
		used[release.Version] = struct{}{}
		maxMajor = max(maxMajor, majorVersionNumber(release.Version))
	}
	major := maxMajor + 1
	for {
		candidate := fmt.Sprintf("%d.0.0", major)
		if _, exists := used[candidate]; !exists {
			return candidate
		}
		major++
	}
}

func majorVersionNumber(version string) int {
	trimmed := strings.TrimPrefix(strings.TrimSpace(version), "v")
	head, _, _ := strings.Cut(trimmed, ".")
	value, err := strconv.Atoi(head)
	if err != nil || value < 0 {
		return 0
	}
	return value
}

func packDeclarativeProtocolPlugin(manifestRaw []byte) ([]byte, error) {
	var data bytes.Buffer
	writer := zip.NewWriter(&data)
	header := &zip.FileHeader{Name: "manifest.json", Method: zip.Deflate}
	entry, err := writer.CreateHeader(header)
	if err != nil {
		return nil, err
	}
	if _, err := entry.Write(manifestRaw); err != nil {
		return nil, err
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	return data.Bytes(), nil
}

func renameProtocolReferences(value any, previous, next string) {
	switch value := value.(type) {
	case map[string]any:
		for key, child := range value {
			if text, ok := child.(string); ok && (key == "$ref" || key == "binding") {
				prefix := "providerOptions." + previous + "."
				requestPrefix := "request." + prefix
				if strings.HasPrefix(text, prefix) {
					value[key] = "providerOptions." + next + "." + strings.TrimPrefix(text, prefix)
				} else if strings.HasPrefix(text, requestPrefix) {
					value[key] = "request.providerOptions." + next + "." + strings.TrimPrefix(text, requestPrefix)
				}
			} else {
				renameProtocolReferences(child, previous, next)
			}
		}
	case []any:
		for _, child := range value {
			renameProtocolReferences(child, previous, next)
		}
	}
}
