// 官方素材库 service 层（迁移 v61，表 official_assets / official_asset_imports）。
//
// 分层约定（仓库 AGENTS.md §3）：权限、可见性、状态机、导入幂等都在这里；
// repository 只做持久化；handler 只做入参、取 currentUser、调 service。
//
// 落地顺序要求（必读）：用户侧接口（浏览/详情/导入）先调
// RequirePluginForUser("official-asset-library")，该调用依赖步骤 3 在
// plugin_management.go 的 officialApplicationPolicies 里加的策略条目。
// 步骤 3 未落地时用户侧接口会返回“插件不存在”的错误（不是静默放行，
// 也不是当成已停用）——步骤 2 与步骤 3 必须一起落地，或先落步骤 3。
// 管理端接口不受插件开关影响（否则停用后管理员自己都进不去）。
//
// 常量归属：PluginOfficialAssetLibrary 定义在本文件（package app）。
// 步骤 3 的 plugin_management.go 直接引用它，不要重新声明同名常量。
package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/gorm"
)

// PluginOfficialAssetLibrary 是官方素材库插件 ID。
// 步骤 3（plugin_management.go）在 officialApplicationPolicies 里加策略时
// 引用本常量，不要重新声明。
const PluginOfficialAssetLibrary = "official-asset-library"

// OfficialAssetPageFilter 是官方素材分页查询的过滤条件。
// Status 只在管理端使用；用户端固定只看已发布。
type OfficialAssetPageFilter struct {
	MediaType string
	Category  string
	Tag       string
	Query     string
	Status    string
}

// OfficialAssetPage 是官方素材分页结果。
type OfficialAssetPage struct {
	Items          []OfficialAssetDetail `json:"items"`
	KindCounts     map[string]int64      `json:"kindCounts"`
	CategoryCounts map[string]int64      `json:"categoryCounts"`
	Page           int                   `json:"page"`
	PageSize       int                   `json:"pageSize"`
	Total          int64                 `json:"total"`
	HasMore        bool                  `json:"hasMore"`
}

// OfficialAssetDetail 是官方素材的对外展示结构。
// 封面与播放地址只给 resource: 存储键，不给签名地址；
// 宽高/时长/体积从 Resource 取，不存在官方素材表里。
type OfficialAssetDetail struct {
	ID              string                    `json:"id"`
	ResourceID      string                    `json:"resourceId"`
	Title           string                    `json:"title"`
	Description     string                    `json:"description"`
	MediaType       string                    `json:"mediaType"`
	Category        model.AssetCategory       `json:"category"`
	Tags            []string                  `json:"tags"`
	SourceName      string                    `json:"sourceName"`
	SourceURL       string                    `json:"sourceUrl"`
	LicenseNote     string                    `json:"licenseNote"`
	UsageNote       string                    `json:"usageNote"`
	Status          model.OfficialAssetStatus `json:"status"`
	SortOrder       int                       `json:"sortOrder"`
	CoverStorageKey string                    `json:"coverStorageKey"`
	Width           int                       `json:"width"`
	Height          int                       `json:"height"`
	DurationMs      int64                     `json:"durationMs"`
	Size            int64                     `json:"size"`
	PublishedAt     *time.Time                `json:"publishedAt,omitempty"`
	UpdatedAt       time.Time                 `json:"updatedAt"`
	Imported        bool                      `json:"imported"`
}

// CreateOfficialAssetRequest 是管理员新建官方素材的入参。
// 新建默认 draft；文件本身不经此接口上传，管理员先走现有上传流程
// 拿到 Resource ID 再调此接口。
type CreateOfficialAssetRequest struct {
	ResourceID  string   `json:"resourceId"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	MediaType   string   `json:"mediaType"`
	Category    string   `json:"category"`
	Tags        []string `json:"tags"`
	SourceName  string   `json:"sourceName"`
	SourceURL   string   `json:"sourceUrl"`
	LicenseNote string   `json:"licenseNote"`
	UsageNote   string   `json:"usageNote"`
	SortOrder   int      `json:"sortOrder"`
}

// UpdateOfficialAssetRequest 是管理员编辑官方素材的入参。
// 指针字段表示“只改传了的字段”；Status 不走这个接口改，
// 只接受 publish / unpublish 两个专用接口。
type UpdateOfficialAssetRequest struct {
	ResourceID  *string  `json:"resourceId,omitempty"`
	Title       *string  `json:"title,omitempty"`
	Description *string  `json:"description,omitempty"`
	MediaType   *string  `json:"mediaType,omitempty"`
	Category    *string  `json:"category,omitempty"`
	Tags        []string `json:"tags,omitempty"`
	TagsSet     bool     `json:"-"`
	SourceName  *string  `json:"sourceName,omitempty"`
	SourceURL   *string  `json:"sourceUrl,omitempty"`
	LicenseNote *string  `json:"licenseNote,omitempty"`
	UsageNote   *string  `json:"usageNote,omitempty"`
	SortOrder   *int     `json:"sortOrder,omitempty"`
}

// OfficialAssetImportResult 是导入接口的返回：导入后得到的 Asset
// （已是客户端可直接用的 PayloadJSON）与是否本次新建。
// AlreadyImported=true 表示幂等命中，本次没有新建任何记录。
type OfficialAssetImportResult struct {
	Asset           json.RawMessage `json:"asset"`
	AlreadyImported bool            `json:"alreadyImported"`
}

// officialAssetImportSnapshot 是导入时固化进 Asset.PayloadJSON 的快照。
// 之后官方素材改标题/版权不回写已导入副本（“全站共同修改同一份素材”是不做的）。
type officialAssetImportSnapshot struct {
	OfficialAssetID string `json:"officialAssetId"`
	OfficialTitle   string `json:"officialTitle"`
	SourceName      string `json:"sourceName"`
	SourceURL       string `json:"sourceUrl"`
	LicenseNote     string `json:"licenseNote"`
	UsageNote       string `json:"usageNote"`
	ImportedAt      string `json:"importedAt"`
	ResourceID      string `json:"resourceId"`
}

// officialAssetStatusTransitions 是唯一允许的状态流转表。
// 不允许 published/unpublished → draft；同状态重复发布/下架一律拒绝。
var officialAssetStatusTransitions = map[model.OfficialAssetStatus][]model.OfficialAssetStatus{
	model.OfficialAssetStatusDraft:       {model.OfficialAssetStatusPublished, model.OfficialAssetStatusUnpublished},
	model.OfficialAssetStatusPublished:   {model.OfficialAssetStatusUnpublished},
	model.OfficialAssetStatusUnpublished: {model.OfficialAssetStatusPublished},
}

func officialAssetTransitionAllowed(from model.OfficialAssetStatus, to model.OfficialAssetStatus) bool {
	for _, next := range officialAssetStatusTransitions[from] {
		if next == to {
			return true
		}
	}
	return false
}

// requireOfficialAssetLibraryForUser 校验官方素材库插件对该用户可用。
// 管理员停用后返回 Forbidden("管理员已停用该插件")；
// 步骤 3 的策略条目未落地时返回“插件不存在”的错误，见文件头落地顺序要求。
func (s *Service) requireOfficialAssetLibraryForUser(userID string) error {
	return s.RequirePluginForUser(userID, PluginOfficialAssetLibrary)
}

// officialAssetDetail 把一行官方素材组装成对外展示结构。
// resource 为 nil 时宽高/时长/体积留 0（单条资源缺失不拖垮整页列表）；
// tags 解码失败是数据错误，直接返回，不静默当成无标签。
func officialAssetDetail(asset model.OfficialAsset, resource *model.Resource, imported bool) (OfficialAssetDetail, error) {
	tags, err := model.DecodeOfficialAssetTags(asset.TagsJSON)
	if err != nil {
		return OfficialAssetDetail{}, err
	}
	if tags == nil {
		tags = []string{}
	}
	detail := OfficialAssetDetail{
		ID: asset.ID, ResourceID: asset.ResourceID, Title: asset.Title,
		Description: asset.Description, MediaType: asset.MediaType, Category: asset.Category,
		Tags: tags, SourceName: asset.SourceName, SourceURL: asset.SourceURL,
		LicenseNote: asset.LicenseNote, UsageNote: asset.UsageNote, Status: asset.Status,
		SortOrder: asset.SortOrder, CoverStorageKey: "resource:" + asset.ResourceID,
		PublishedAt: asset.PublishedAt, UpdatedAt: asset.UpdatedAt, Imported: imported,
	}
	if resource != nil {
		detail.Width, detail.Height, detail.DurationMs, detail.Size = resource.Width, resource.Height, resource.DurationMs, resource.Size
	}
	return detail, nil
}

// officialAssetResources 批量取一批官方素材引用的 Resource，
// 找不到的行不报错（展示时宽高留 0），只返回找得到的。
func (s *Service) officialAssetResources(assets []model.OfficialAsset) map[string]*model.Resource {
	result := make(map[string]*model.Resource, len(assets))
	seen := make(map[string]struct{}, len(assets))
	for _, asset := range assets {
		if asset.ResourceID == "" {
			continue
		}
		if _, exists := seen[asset.ResourceID]; exists {
			continue
		}
		seen[asset.ResourceID] = struct{}{}
		if resource, err := s.repo.Resource(asset.ResourceID); err == nil {
			result[asset.ResourceID] = resource
		}
	}
	return result
}

func validateOfficialAssetMediaType(value string) error {
	switch strings.TrimSpace(value) {
	case model.OfficialAssetMediaTypeImage, model.OfficialAssetMediaTypeVideo, model.OfficialAssetMediaTypeAudio, model.OfficialAssetMediaTypeEntity:
		return nil
	default:
		return BadAuthRequest("官方素材类型只支持图片、视频、音频或角色卡")
	}
}

func validateOfficialAssetTitle(value string) error {
	title := strings.TrimSpace(value)
	if title == "" {
		return BadAuthRequest("请填写官方素材标题")
	}
	if utf8.RuneCountInString(title) > 240 {
		return BadAuthRequest("官方素材标题不能超过 240 个字符")
	}
	return nil
}

func validateOfficialAssetTags(tags []string) ([]string, error) {
	normalized := model.NormalizeOfficialAssetTags(tags)
	if len(normalized) > model.OfficialAssetTagMaxCount {
		return nil, BadAuthRequest("官方素材标签最多 20 个")
	}
	for _, tag := range normalized {
		if utf8.RuneCountInString(tag) > model.OfficialAssetTagMaxRunes {
			return nil, BadAuthRequest("单个标签不能超过 40 个字符")
		}
	}
	return normalized, nil
}

func validateOfficialAssetCategory(value string, mediaType string) model.AssetCategory {
	return model.NormalizeAssetCategory(model.AssetCategory(strings.TrimSpace(value)), mediaType)
}

// validateOfficialAssetPageFilter 校验分页筛选入参；
// 非法值直接 400，不要静默忽略后返回全量。
func validateOfficialAssetPageFilter(filter OfficialAssetPageFilter, admin bool) (repository.OfficialAssetPageFilter, error) {
	out := repository.OfficialAssetPageFilter{
		MediaType: strings.TrimSpace(filter.MediaType),
		Category:  strings.TrimSpace(filter.Category),
		Tag:       strings.TrimSpace(filter.Tag),
		Query:     strings.TrimSpace(filter.Query),
		Status:    strings.TrimSpace(filter.Status),
	}
	if out.MediaType != "" && out.MediaType != model.OfficialAssetMediaTypeImage && out.MediaType != model.OfficialAssetMediaTypeVideo {
		return out, BadAuthRequest("官方素材类型只支持图片或视频")
	}
	if out.Category != "" {
		switch model.AssetCategory(out.Category) {
		case model.AssetCategoryCharacter, model.AssetCategoryEnvironment, model.AssetCategoryProp, model.AssetCategoryMaterial, model.AssetCategoryOther:
		default:
			return out, BadAuthRequest("官方素材分类无效")
		}
	}
	if utf8.RuneCountInString(out.Tag) > model.OfficialAssetTagMaxRunes {
		return out, BadAuthRequest("标签不能超过 40 个字符")
	}
	if utf8.RuneCountInString(out.Query) > 200 {
		return out, BadAuthRequest("搜索关键词不能超过 200 个字符")
	}
	if !admin {
		out.Status = ""
		return out, nil
	}
	switch out.Status {
	case "", "all", string(model.OfficialAssetStatusDraft), string(model.OfficialAssetStatusPublished), string(model.OfficialAssetStatusUnpublished):
	default:
		return out, BadAuthRequest("官方素材状态无效")
	}
	return out, nil
}

// officialAssetsPage 是用户浏览与管理浏览的公共实现。
// publishedOnly=true 时只返回已发布；false 时返回全部状态（仅管理端）。
func (s *Service) officialAssetsPage(userID string, page int, pageSize int, filter OfficialAssetPageFilter, publishedOnly bool) (OfficialAssetPage, error) {
	page, pageSize = normalizeProjectPage(page, pageSize, 120)
	repoFilter, err := validateOfficialAssetPageFilter(filter, !publishedOnly)
	if err != nil {
		return OfficialAssetPage{}, err
	}
	assets, total, err := s.repo.OfficialAssetsPage(page, pageSize, repoFilter, publishedOnly)
	if err != nil {
		return OfficialAssetPage{}, err
	}
	mediaTypeRows, categoryRows, err := s.repo.OfficialAssetFacets(publishedOnly)
	if err != nil {
		return OfficialAssetPage{}, err
	}
	resources := s.officialAssetResources(assets)
	ids := make([]string, 0, len(assets))
	for _, asset := range assets {
		ids = append(ids, asset.ID)
	}
	imported := make(map[string]string)
	if strings.TrimSpace(userID) != "" {
		imported, err = s.repo.ImportedAssetIDs(model.OfficialAssetImportScopeLibrary, userID, ids)
		if err != nil {
			return OfficialAssetPage{}, err
		}
	}
	items := make([]OfficialAssetDetail, 0, len(assets))
	for _, asset := range assets {
		detail, err := officialAssetDetail(asset, resources[asset.ResourceID], imported[asset.ID] != "")
		if err != nil {
			return OfficialAssetPage{}, err
		}
		items = append(items, detail)
	}
	return OfficialAssetPage{
		Items: items, KindCounts: assetFacetMap(mediaTypeRows), CategoryCounts: assetFacetMap(categoryRows),
		Page: page, PageSize: pageSize, Total: total, HasMore: int64(page*pageSize) < total,
	}, nil
}

// OfficialAssetsPage 是普通用户浏览已发布官方素材的入口。
// 未登录、插件被管理员停用时直接拒绝，不返回空列表假装成功。
func (s *Service) OfficialAssetsPage(userID string, page int, pageSize int, filter OfficialAssetPageFilter) (OfficialAssetPage, error) {
	if strings.TrimSpace(userID) == "" {
		return OfficialAssetPage{}, Unauthorized("请先登录")
	}
	if err := s.requireOfficialAssetLibraryForUser(userID); err != nil {
		return OfficialAssetPage{}, err
	}
	return s.officialAssetsPage(userID, page, pageSize, filter, true)
}

// OfficialAssetDetail 是普通用户查看单条官方素材详情的入口。
// 未发布/已下架/不存在/已软删一律返回 NotFound，不泄露“存在但未发布”。
func (s *Service) OfficialAssetDetail(userID string, id string) (OfficialAssetDetail, error) {
	if strings.TrimSpace(userID) == "" {
		return OfficialAssetDetail{}, Unauthorized("请先登录")
	}
	if err := s.requireOfficialAssetLibraryForUser(userID); err != nil {
		return OfficialAssetDetail{}, err
	}
	asset, err := s.repo.OfficialAssetByID(strings.TrimSpace(id))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return OfficialAssetDetail{}, NotFound("官方素材不存在")
		}
		return OfficialAssetDetail{}, err
	}
	if asset.Status != model.OfficialAssetStatusPublished || asset.DeletedAt != nil {
		return OfficialAssetDetail{}, NotFound("官方素材不存在")
	}
	var resource *model.Resource
	if asset.ResourceID != "" {
		if found, err := s.repo.Resource(asset.ResourceID); err == nil {
			resource = found
		}
	}
	imported := false
	if record, err := s.repo.ImportRecord(model.OfficialAssetImportScopeLibrary, userID, asset.ID); err == nil && record != nil {
		imported = true
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return OfficialAssetDetail{}, err
	}
	return officialAssetDetail(*asset, resource, imported)
}

// loadPublishedOfficialAsset 供导入流程共用：取素材并校验“存在且已发布且未软删”，
// 否则一律按不存在处理（不泄露存在性）。
func (s *Service) loadPublishedOfficialAsset(id string) (*model.OfficialAsset, error) {
	asset, err := s.repo.OfficialAssetByID(strings.TrimSpace(id))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, NotFound("官方素材不存在")
		}
		return nil, err
	}
	if asset.Status != model.OfficialAssetStatusPublished || asset.DeletedAt != nil {
		return nil, NotFound("官方素材不存在")
	}
	return asset, nil
}

// buildImportedAsset 构造导入时要创建的 Asset / 首版本 / 主表现。
// Asset ID 与版本 ID 均为 newID；表现的 TaskID 也用 newID，
// 避免 (task_id, role) 唯一索引冲突。
// PayloadJSON 是客户端可直接用的形状（仿照 project_asset_image.go 的
// 画像导入载荷）：data 里同时放 resource: 存储键与导入快照，
// 之后官方素材改标题/版权不回写这份快照。
func buildImportedAsset(userID string, official model.OfficialAsset, resource *model.Resource) (*model.Asset, *model.AssetVersion, *model.AssetRepresentation, error) {
	now := time.Now().UTC()
	assetID := newID()
	versionID := newID()
	snapshot := officialAssetImportSnapshot{
		OfficialAssetID: official.ID, OfficialTitle: official.Title,
		SourceName: official.SourceName, SourceURL: official.SourceURL,
		LicenseNote: official.LicenseNote, UsageNote: official.UsageNote,
		ImportedAt: now.Format(time.RFC3339Nano), ResourceID: official.ResourceID,
	}
	data := map[string]any{
		"storageKey": "resource:" + official.ResourceID,
		"width":      resource.Width, "height": resource.Height,
		"bytes": resource.Size, "mimeType": resource.MimeType,
		"officialAssetId": snapshot.OfficialAssetID, "officialTitle": snapshot.OfficialTitle,
		"sourceName": snapshot.SourceName, "sourceUrl": snapshot.SourceURL,
		"licenseNote": snapshot.LicenseNote, "usageNote": snapshot.UsageNote,
		"importedAt": snapshot.ImportedAt, "resourceId": snapshot.ResourceID,
	}
	payload, err := json.Marshal(map[string]any{
		"id": assetID, "kind": official.MediaType, "category": official.Category,
		"status": model.AssetVersionStatusConfirmed, "primaryVersionId": versionID,
		"title": official.Title, "coverUrl": "", "tags": []string{},
		"data": data, "createdAt": now.Format(time.RFC3339Nano), "updatedAt": now.Format(time.RFC3339Nano),
	})
	if err != nil {
		return nil, nil, nil, err
	}
	asset := &model.Asset{
		ID: assetID, UserID: userID, Kind: official.MediaType, Category: official.Category,
		Status: model.AssetVersionStatusConfirmed, PrimaryVersionID: versionID,
		Title: official.Title, PayloadJSON: string(payload), CreatedAt: now, UpdatedAt: now,
	}
	version := &model.AssetVersion{
		ID: versionID, AssetID: assetID, Version: 1, Status: model.AssetVersionStatusConfirmed,
		DefinitionJSON: fmt.Sprintf(`{"storageKey":"resource:%s","mediaType":%q}`, official.ResourceID, official.MediaType),
		CreatedAt:      now, UpdatedAt: now,
	}
	representation := &model.AssetRepresentation{
		ID: newID(), AssetVersionID: versionID, TaskID: newID(),
		ResourceID: official.ResourceID, MediaType: official.MediaType,
		Role: "primary", MetadataJSON: "{}", CreatedAt: now,
	}
	return asset, version, representation, nil
}

// importResultForExistingAsset 幂等命中时返回已导入的资产。
func (s *Service) importResultForExistingAsset(userID string, record *model.OfficialAssetImport) (OfficialAssetImportResult, error) {
	asset, err := s.repo.AssetForUser(userID, record.AssetID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return OfficialAssetImportResult{}, NotFound("已导入的素材不存在，请重新导入")
		}
		return OfficialAssetImportResult{}, err
	}
	return OfficialAssetImportResult{Asset: json.RawMessage(asset.PayloadJSON), AlreadyImported: true}, nil
}

// ImportOfficialAssetToLibrary 把一份已发布官方素材导入当前用户的个人素材库。
// 路径 A（导入建资产）：重复导入返回已存在的那条资产，不新建；
// 并发重复导入靠导入记录唯一索引拦截，失败后重查记录返回先到者的资产。
func (s *Service) ImportOfficialAssetToLibrary(userID string, officialAssetID string) (OfficialAssetImportResult, error) {
	if strings.TrimSpace(userID) == "" {
		return OfficialAssetImportResult{}, Unauthorized("请先登录")
	}
	if err := s.requireOfficialAssetLibraryForUser(userID); err != nil {
		return OfficialAssetImportResult{}, err
	}
	official, err := s.loadPublishedOfficialAsset(officialAssetID)
	if err != nil {
		return OfficialAssetImportResult{}, err
	}
	if record, err := s.repo.ImportRecord(model.OfficialAssetImportScopeLibrary, userID, official.ID); err == nil {
		return s.importResultForExistingAsset(userID, record)
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return OfficialAssetImportResult{}, err
	}
	resource, err := s.repo.Resource(official.ResourceID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return OfficialAssetImportResult{}, NotFound("官方素材不存在")
		}
		return OfficialAssetImportResult{}, err
	}
	if resource.Kind != official.MediaType {
		return OfficialAssetImportResult{}, NotFound("官方素材不存在")
	}
	asset, version, representation, err := buildImportedAsset(userID, *official, resource)
	if err != nil {
		return OfficialAssetImportResult{}, err
	}
	record := &model.OfficialAssetImport{
		ID: newID(), OfficialAssetID: official.ID,
		Scope: model.OfficialAssetImportScopeLibrary, OwnerID: userID,
		AssetID: asset.ID, CreatedAt: time.Now().UTC(),
	}
	if err := s.repo.CreateImportedLibraryAsset(asset, version, representation, record); err != nil {
		// 并发重复导入：唯一索引冲突说明先到者已写完导入记录，重查后返回它。
		if existing, readErr := s.repo.ImportRecord(model.OfficialAssetImportScopeLibrary, userID, official.ID); readErr == nil {
			return s.importResultForExistingAsset(userID, existing)
		}
		return OfficialAssetImportResult{}, err
	}
	return OfficialAssetImportResult{Asset: json.RawMessage(asset.PayloadJSON), AlreadyImported: false}, nil
}

// ImportOfficialAssetToProject 把一份已发布官方素材导入当前项目资产。
// 项目归属用 ProjectForUser 校验（不是本人项目按不存在处理）。
// 同一项目重复导入返回已存在的那条资产，不新建、不重复建链接。
func (s *Service) ImportOfficialAssetToProject(userID string, projectID string, officialAssetID string) (OfficialAssetImportResult, error) {
	if strings.TrimSpace(userID) == "" {
		return OfficialAssetImportResult{}, Unauthorized("请先登录")
	}
	if err := s.requireOfficialAssetLibraryForUser(userID); err != nil {
		return OfficialAssetImportResult{}, err
	}
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		return OfficialAssetImportResult{}, BadAuthRequest("请选择要导入的项目")
	}
	if _, err := s.repo.ProjectForUser(userID, projectID); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return OfficialAssetImportResult{}, NotFound("项目不存在")
		}
		return OfficialAssetImportResult{}, err
	}
	official, err := s.loadPublishedOfficialAsset(officialAssetID)
	if err != nil {
		return OfficialAssetImportResult{}, err
	}
	if record, err := s.repo.ImportRecord(model.OfficialAssetImportScopeProject, projectID, official.ID); err == nil {
		return s.importResultForExistingAsset(userID, record)
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return OfficialAssetImportResult{}, err
	}
	resource, err := s.repo.Resource(official.ResourceID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return OfficialAssetImportResult{}, NotFound("官方素材不存在")
		}
		return OfficialAssetImportResult{}, err
	}
	if resource.Kind != official.MediaType {
		return OfficialAssetImportResult{}, NotFound("官方素材不存在")
	}
	asset, version, representation, err := buildImportedAsset(userID, *official, resource)
	if err != nil {
		return OfficialAssetImportResult{}, err
	}
	folderID, err := s.resolveProjectAssetFolderID(projectID, nil)
	if err != nil {
		return OfficialAssetImportResult{}, err
	}
	position, err := s.repo.NextProjectAssetPosition(projectID, folderID)
	if err != nil {
		return OfficialAssetImportResult{}, err
	}
	now := time.Now().UTC()
	link := &model.ProjectAssetLink{
		ID: newID(), ProjectID: projectID, AssetID: asset.ID,
		FolderID: folderID, Position: position, CreatedAt: now,
	}
	record := &model.OfficialAssetImport{
		ID: newID(), OfficialAssetID: official.ID,
		Scope: model.OfficialAssetImportScopeProject, OwnerID: projectID,
		AssetID: asset.ID, CreatedAt: now,
	}
	// Asset + 首版本 + 主表现 + 项目链接 + 导入记录 + 修订号全部在
	// 同一个事务内提交（见 repository.ImportOfficialAssetToProject）。
	if _, err := s.repo.ImportOfficialAssetToProject(asset, version, representation, link, record); err != nil {
		if existing, readErr := s.repo.ImportRecord(model.OfficialAssetImportScopeProject, projectID, official.ID); readErr == nil {
			return s.importResultForExistingAsset(userID, existing)
		}
		return OfficialAssetImportResult{}, err
	}
	return OfficialAssetImportResult{Asset: json.RawMessage(asset.PayloadJSON), AlreadyImported: false}, nil
}

// AdminOfficialAssetsPage 是管理端浏览全部官方素材的入口（含草稿与已下架，
// 不含已软删）。插件开关不影响管理端。
func (s *Service) AdminOfficialAssetsPage(actor *model.User, page int, pageSize int, filter OfficialAssetPageFilter) (OfficialAssetPage, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return OfficialAssetPage{}, err
	}
	return s.officialAssetsPage(actor.ID, page, pageSize, filter, false)
}

// AdminOfficialAssetDetail 是管理端查看单条官方素材的入口（任意状态，供编辑页回填）。
func (s *Service) AdminOfficialAssetDetail(actor *model.User, id string) (OfficialAssetDetail, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return OfficialAssetDetail{}, err
	}
	asset, err := s.repo.OfficialAssetByID(strings.TrimSpace(id))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return OfficialAssetDetail{}, NotFound("官方素材不存在")
		}
		return OfficialAssetDetail{}, err
	}
	if asset.DeletedAt != nil {
		return OfficialAssetDetail{}, NotFound("官方素材不存在")
	}
	var resource *model.Resource
	if asset.ResourceID != "" {
		if found, err := s.repo.Resource(asset.ResourceID); err == nil {
			resource = found
		}
	}
	return officialAssetDetail(*asset, resource, false)
}

// validateOfficialAssetResource 校验官方素材引用的 Resource 存在且
// 其 Kind 与 mediaType 一致。待 Mac 核对：v1692 是否要求 Resource
// 必须为 Ready 态——草案只要求存在与 Kind 一致，本步骤按草案实现，
// 不额外加 Ready 校验。
func (s *Service) validateOfficialAssetResource(resourceID string, mediaType string) (*model.Resource, error) {
	resource, err := s.repo.Resource(strings.TrimSpace(resourceID))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, BadAuthRequest("引用的资源不存在")
		}
		return nil, err
	}
	if resource.Kind != mediaType {
		return nil, BadAuthRequest("资源类型与官方素材类型不一致")
	}
	return resource, nil
}

// CreateOfficialAsset 是管理员新建官方素材的入口（新建默认 draft）。
func (s *Service) CreateOfficialAsset(actor *model.User, req CreateOfficialAssetRequest) (OfficialAssetDetail, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return OfficialAssetDetail{}, err
	}
	if err := validateOfficialAssetMediaType(req.MediaType); err != nil {
		return OfficialAssetDetail{}, err
	}
	if err := validateOfficialAssetTitle(req.Title); err != nil {
		return OfficialAssetDetail{}, err
	}
	tags, err := validateOfficialAssetTags(req.Tags)
	if err != nil {
		return OfficialAssetDetail{}, err
	}
	if _, err := s.validateOfficialAssetResource(req.ResourceID, strings.TrimSpace(req.MediaType)); err != nil {
		return OfficialAssetDetail{}, err
	}
	tagsJSON, err := model.EncodeOfficialAssetTags(tags)
	if err != nil {
		return OfficialAssetDetail{}, err
	}
	now := time.Now().UTC()
	asset := &model.OfficialAsset{
		ID: newID(), ResourceID: strings.TrimSpace(req.ResourceID),
		Title: strings.TrimSpace(req.Title), Description: strings.TrimSpace(req.Description),
		MediaType: strings.TrimSpace(req.MediaType),
		Category:  validateOfficialAssetCategory(req.Category, strings.TrimSpace(req.MediaType)),
		TagsJSON:  tagsJSON, SourceName: strings.TrimSpace(req.SourceName),
		SourceURL: strings.TrimSpace(req.SourceURL), LicenseNote: strings.TrimSpace(req.LicenseNote),
		UsageNote: strings.TrimSpace(req.UsageNote), Status: model.OfficialAssetStatusDraft,
		SortOrder: req.SortOrder, CreatedBy: actor.ID, CreatedAt: now, UpdatedAt: now,
	}
	if err := s.repo.CreateOfficialAsset(asset); err != nil {
		return OfficialAssetDetail{}, err
	}
	return s.AdminOfficialAssetDetail(actor, asset.ID)
}

// UpdateOfficialAsset 是管理员编辑官方素材的入口。
// 只改传了的字段；Status 不走这个接口改；换文件（改 ResourceID）时
// 重新校验 Resource 与 Kind 一致。
func (s *Service) UpdateOfficialAsset(actor *model.User, id string, req UpdateOfficialAssetRequest) (OfficialAssetDetail, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return OfficialAssetDetail{}, err
	}
	asset, err := s.repo.OfficialAssetByID(strings.TrimSpace(id))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return OfficialAssetDetail{}, NotFound("官方素材不存在")
		}
		return OfficialAssetDetail{}, err
	}
	if asset.DeletedAt != nil {
		return OfficialAssetDetail{}, NotFound("官方素材不存在")
	}
	fields := map[string]any{}
	mediaType := asset.MediaType
	if req.MediaType != nil {
		if err := validateOfficialAssetMediaType(*req.MediaType); err != nil {
			return OfficialAssetDetail{}, err
		}
		mediaType = strings.TrimSpace(*req.MediaType)
		fields["media_type"] = mediaType
	}
	if req.ResourceID != nil {
		if _, err := s.validateOfficialAssetResource(*req.ResourceID, mediaType); err != nil {
			return OfficialAssetDetail{}, err
		}
		fields["resource_id"] = strings.TrimSpace(*req.ResourceID)
	} else if req.MediaType != nil {
		if _, err := s.validateOfficialAssetResource(asset.ResourceID, mediaType); err != nil {
			return OfficialAssetDetail{}, err
		}
	}
	if req.Title != nil {
		if err := validateOfficialAssetTitle(*req.Title); err != nil {
			return OfficialAssetDetail{}, err
		}
		fields["title"] = strings.TrimSpace(*req.Title)
	}
	if req.Description != nil {
		fields["description"] = strings.TrimSpace(*req.Description)
	}
	if req.Category != nil {
		fields["category"] = validateOfficialAssetCategory(*req.Category, mediaType)
	}
	if req.TagsSet {
		tags, err := validateOfficialAssetTags(req.Tags)
		if err != nil {
			return OfficialAssetDetail{}, err
		}
		tagsJSON, err := model.EncodeOfficialAssetTags(tags)
		if err != nil {
			return OfficialAssetDetail{}, err
		}
		fields["tags_json"] = tagsJSON
	}
	if req.SourceName != nil {
		fields["source_name"] = strings.TrimSpace(*req.SourceName)
	}
	if req.SourceURL != nil {
		fields["source_url"] = strings.TrimSpace(*req.SourceURL)
	}
	if req.LicenseNote != nil {
		fields["license_note"] = strings.TrimSpace(*req.LicenseNote)
	}
	if req.UsageNote != nil {
		fields["usage_note"] = strings.TrimSpace(*req.UsageNote)
	}
	if req.SortOrder != nil {
		fields["sort_order"] = *req.SortOrder
	}
	if len(fields) == 0 {
		return s.AdminOfficialAssetDetail(actor, asset.ID)
	}
	fields["updated_at"] = time.Now().UTC()
	if _, err := s.repo.UpdateOfficialAssetFields(asset.ID, fields); err != nil {
		return OfficialAssetDetail{}, err
	}
	return s.AdminOfficialAssetDetail(actor, asset.ID)
}

// setOfficialAssetStatus 是发布/下架的公共实现：
// 按状态机校验后写 status；首次发布时写 published_at，之后不再改。
func (s *Service) setOfficialAssetStatus(actor *model.User, id string, target model.OfficialAssetStatus) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	asset, err := s.repo.OfficialAssetByID(strings.TrimSpace(id))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return NotFound("官方素材不存在")
		}
		return err
	}
	if asset.DeletedAt != nil {
		return NotFound("官方素材不存在")
	}
	if !officialAssetTransitionAllowed(asset.Status, target) {
		return BadAuthRequest("当前状态不支持该操作")
	}
	fields := map[string]any{"status": target, "updated_at": time.Now().UTC()}
	if target == model.OfficialAssetStatusPublished && asset.PublishedAt == nil {
		fields["published_at"] = time.Now().UTC()
	}
	if _, err := s.repo.UpdateOfficialAssetFields(asset.ID, fields); err != nil {
		return err
	}
	return nil
}

// PublishOfficialAsset 发布官方素材（draft/unpublished → published）。
func (s *Service) PublishOfficialAsset(actor *model.User, id string) error {
	return s.setOfficialAssetStatus(actor, id, model.OfficialAssetStatusPublished)
}

// UnpublishOfficialAsset 下架官方素材（published → unpublished）。
// 下架后新浏览、新导入一律拒绝；已导入的资产不受影响。
func (s *Service) UnpublishOfficialAsset(actor *model.User, id string) error {
	return s.setOfficialAssetStatus(actor, id, model.OfficialAssetStatusUnpublished)
}

// UpdateOfficialAssetSortOrder 只改一条官方素材的排序值。
func (s *Service) UpdateOfficialAssetSortOrder(actor *model.User, id string, sortOrder int) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	asset, err := s.repo.OfficialAssetByID(strings.TrimSpace(id))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return NotFound("官方素材不存在")
		}
		return err
	}
	if asset.DeletedAt != nil {
		return NotFound("官方素材不存在")
	}
	_, err = s.repo.UpdateOfficialAssetFields(asset.ID, map[string]any{
		"sort_order": sortOrder, "updated_at": time.Now().UTC(),
	})
	return err
}

// DeleteOfficialAsset 删除官方素材：仅 draft 且引用数为 0 时允许软删除。
// 已发布/已下架不允许删除；被引用过的草稿也不允许删除；
// 删除后 Resource 行保留（可能被其他素材复用）。
func (s *Service) DeleteOfficialAsset(actor *model.User, id string) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	asset, err := s.repo.OfficialAssetByID(strings.TrimSpace(id))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return NotFound("官方素材不存在")
		}
		return err
	}
	if asset.DeletedAt != nil {
		return NotFound("官方素材不存在")
	}
	if asset.Status != model.OfficialAssetStatusDraft {
		return BadAuthRequest("已发布或已下架的官方素材不能删除，请先下架")
	}
	count, err := s.repo.OfficialAssetImportCount(asset.ID)
	if err != nil {
		return err
	}
	if count > 0 {
		return NewAppError(409, "该草稿已被导入，无法删除")
	}
	return s.repo.SoftDeleteOfficialAsset(asset.ID, time.Now().UTC())
}

// OfficialAssetReference 是路径 B（画布直接引用，不强制导入）的引用载荷。
// 本步骤只定义结构、不接画布插入契约：画布是否接受非 Asset 的引用载荷
// 取决于 v1692 的插入契约，待 Mac 核对后再决定是否启用。
// 选择器先走路径 A（导入建资产），不要把“使用”默认做成自动导入。
type OfficialAssetReference struct {
	OfficialAssetID string          `json:"officialAssetId"`
	StorageKey      string          `json:"storageKey"`
	MediaType       string          `json:"mediaType"`
	Title           string          `json:"title"`
	Character       json.RawMessage `json:"character,omitempty"`
}

// OfficialAssetReferenceForUser 返回一条已发布官方素材的直接引用载荷
// （路径 B 的读取端）。调用方拿到它之后是否能直接插入画布，
// 由画布插入契约决定；本方法不创建任何资产记录。
func (s *Service) OfficialAssetReferenceForUser(userID string, id string) (OfficialAssetReference, error) {
	if strings.TrimSpace(userID) == "" {
		return OfficialAssetReference{}, Unauthorized("请先登录")
	}
	if err := s.requireOfficialAssetLibraryForUser(userID); err != nil {
		return OfficialAssetReference{}, err
	}
	asset, err := s.loadPublishedOfficialAsset(id)
	if err != nil {
		return OfficialAssetReference{}, err
	}
	ref := OfficialAssetReference{
		OfficialAssetID: asset.ID, StorageKey: "resource:" + asset.ResourceID,
		MediaType: asset.MediaType, Title: asset.Title,
	}
	if asset.MediaType == model.OfficialAssetMediaTypeEntity && strings.TrimSpace(asset.CharacterSnapshotJSON) != "" {
		ref.Character = json.RawMessage(asset.CharacterSnapshotJSON)
	}
	return ref, nil
}
