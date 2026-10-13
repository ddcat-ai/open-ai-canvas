package workbench

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

const (
	KindImage = model.WorkbenchKindImage
	KindVideo = model.WorkbenchKindVideo
)

type AdminGate interface {
	RequireAdmin(*model.User) error
	AppendAudit(*model.User, string, string, string, string, any) error
}

type ResourceAccessIssuer interface {
	WorkbenchResourceAccess(resourceID string) (string, error)
}

type Service struct {
	repo   *repository.Repository
	admin  AdminGate
	access ResourceAccessIssuer
}

func New(repo *repository.Repository, admin AdminGate, access ResourceAccessIssuer) *Service {
	return &Service{repo: repo, admin: admin, access: access}
}

type ToolInput struct {
	Kind            string             `json:"kind"`
	CategoryID      string             `json:"categoryId"`
	Name            string             `json:"name"`
	Subtitle        string             `json:"subtitle"`
	Description     string             `json:"description"`
	IconResourceID  string             `json:"iconResourceId"`
	CoverResourceID string             `json:"coverResourceId"`
	SortOrder       int                `json:"sortOrder"`
	Capability      json.RawMessage    `json:"capability"`
	Guide           json.RawMessage    `json:"guide"`
	Enabled         bool               `json:"enabled"`
	Presets         *[]ToolPresetInput `json:"presets,omitempty"`
}

// ToolPresetInput allows the editor to save a tool and its presets atomically.
type ToolPresetInput struct {
	ID string `json:"id,omitempty"`
	PresetInput
}

type PresetInput struct {
	ToolID            string          `json:"toolId"`
	Name              string          `json:"name"`
	Summary           string          `json:"summary"`
	PromptTemplate    string          `json:"promptTemplate"`
	DefaultParameters json.RawMessage `json:"defaultParameters"`
	SortOrder         int             `json:"sortOrder"`
	Enabled           bool            `json:"enabled"`
}

type ToolView struct {
	ID                  string            `json:"id"`
	Kind                string            `json:"kind"`
	CategoryID          string            `json:"categoryId"`
	Name                string            `json:"name"`
	Subtitle            string            `json:"subtitle"`
	Description         string            `json:"description"`
	IconResourceID      string            `json:"iconResourceId,omitempty"`
	CoverResourceID     string            `json:"coverResourceId,omitempty"`
	IconURL             string            `json:"iconUrl,omitempty"`
	CoverURL            string            `json:"coverUrl,omitempty"`
	SortOrder           int               `json:"sortOrder"`
	Capability          json.RawMessage   `json:"capability,omitempty"`
	Guide               json.RawMessage   `json:"guide,omitempty"`
	InputHint           string            `json:"inputHint,omitempty"`
	SearchKeywords      []string          `json:"searchKeywords,omitempty"`
	Surfaces            []string          `json:"surfaces,omitempty"`
	Recommended         bool              `json:"recommended"`
	RecommendationOrder int               `json:"recommendationOrder"`
	InputContract       InputContractView `json:"inputContract"`
	ResultExample       ResultExampleView `json:"resultExample"`
	Enabled             bool              `json:"enabled"`
	Version             int               `json:"version"`
	Presets             []PresetView      `json:"presets"`
	UpdatedAt           time.Time         `json:"updatedAt"`
}

type InputContractView struct {
	PromptRequired    bool                `json:"promptRequired"`
	MinTextReferences int                 `json:"minTextReferences"`
	Slots             []ReferenceSlotView `json:"slots"`
}

type ReferenceSlotView struct {
	Key              string   `json:"key"`
	Name             string   `json:"name"`
	MediaTypes       []string `json:"mediaTypes"`
	ResourceKind     string   `json:"resourceKind"`
	MaxCount         int      `json:"maxCount"`
	Required         bool     `json:"required"`
	MinCount         int      `json:"minCount"`
	CoverResourceID  string   `json:"coverResourceId,omitempty"`
	CoverURL         string   `json:"coverUrl,omitempty"`
	SampleResourceID string   `json:"sampleResourceId,omitempty"`
	SampleURL        string   `json:"sampleUrl,omitempty"`
}

type ResultExampleView struct {
	Title            string   `json:"title,omitempty"`
	Description      string   `json:"description,omitempty"`
	ImageResourceIDs []string `json:"imageResourceIds,omitempty"`
	ImageURLs        []string `json:"imageUrls,omitempty"`
	VideoResourceID  string   `json:"videoResourceId,omitempty"`
	VideoURL         string   `json:"videoUrl,omitempty"`
}

type PresetView struct {
	ID                string          `json:"id"`
	ToolID            string          `json:"toolId"`
	Name              string          `json:"name"`
	Summary           string          `json:"summary"`
	PromptTemplate    string          `json:"promptTemplate"`
	DefaultParameters json.RawMessage `json:"defaultParameters,omitempty"`
	SortOrder         int             `json:"sortOrder"`
	Enabled           bool            `json:"enabled"`
	Version           int             `json:"version"`
	UpdatedAt         time.Time       `json:"updatedAt"`
}

func (s *Service) PublicTools(kind string) ([]ToolView, error) {
	if !validKind(kind) {
		return nil, kernel.BadAuthRequest("工作台类型无效")
	}
	tools, err := s.repo.WorkbenchTools(kind, true)
	if err != nil {
		return nil, err
	}
	presetsByTool, err := s.repo.WorkbenchEnabledPresetsForTools(toolIDs(tools))
	if err != nil {
		return nil, err
	}
	views := make([]ToolView, 0, len(tools))
	for _, item := range tools {
		view := toolView(item, presetsByTool[item.ID])
		if s.access != nil {
			if err := s.attachToolMedia(&view); err != nil {
				return nil, err
			}
		}
		views = append(views, view)
	}
	return views, nil
}

func (s *Service) AdminTools(actor *model.User, kind string) ([]ToolView, error) {
	if err := s.requireAdmin(actor); err != nil {
		return nil, err
	}
	if kind != "" && !validKind(kind) {
		return nil, kernel.BadAuthRequest("工作台类型无效")
	}
	tools, err := s.repo.WorkbenchTools(kind, false)
	if err != nil {
		return nil, err
	}
	views := make([]ToolView, 0, len(tools))
	for _, item := range tools {
		presets, err := s.repo.WorkbenchPresets(item.ID, false)
		if err != nil {
			return nil, err
		}
		view := toolView(item, presets)
		view.IconURL, view.CoverURL = "", ""
		views = append(views, view)
	}
	return views, nil
}

func (s *Service) CreateTool(actor *model.User, req ToolInput) (*ToolView, error) {
	if err := s.requireAdmin(actor); err != nil {
		return nil, err
	}
	item, err := normalizeTool(req)
	if err != nil {
		return nil, err
	}
	if err := s.validateToolResources(actor.ID, item.IconResourceID, item.CoverResourceID, item.CapabilityJSON, item.GuideJSON); err != nil {
		return nil, err
	}
	item.ID, item.CreatedBy, item.UpdatedBy = kernel.NewID(), actor.ID, actor.ID
	item.Version, item.CreatedAt, item.UpdatedAt = 1, time.Now(), time.Now()
	presets, err := s.normalizeToolPresets(actor.ID, item.ID, req.Presets)
	if err != nil {
		return nil, err
	}
	if err := s.repo.SaveWorkbenchToolWithPresets(item, presets, true); err != nil {
		return nil, err
	}
	if err := s.audit(actor, "workbench_tool.create", item.ID, "创建工作台工具", map[string]any{"kind": item.Kind, "enabled": item.Enabled}); err != nil {
		return nil, err
	}
	return s.adminToolView(item)
}

func (s *Service) UpdateTool(actor *model.User, id string, req ToolInput) (*ToolView, error) {
	if err := s.requireAdmin(actor); err != nil {
		return nil, err
	}
	before, err := s.repo.WorkbenchTool(id)
	if err != nil {
		return nil, err
	}
	item, err := normalizeTool(req)
	if err != nil {
		return nil, err
	}
	if item.Kind != before.Kind {
		return nil, kernel.BadAuthRequest("工具类型创建后不可更改")
	}
	if err := s.validateToolResources(actor.ID, item.IconResourceID, item.CoverResourceID, item.CapabilityJSON, item.GuideJSON); err != nil {
		return nil, err
	}
	item.ID, item.CreatedBy, item.CreatedAt = before.ID, before.CreatedBy, before.CreatedAt
	item.UpdatedBy, item.UpdatedAt, item.Version = actor.ID, time.Now(), before.Version+1
	presets, err := s.normalizeToolPresets(actor.ID, item.ID, req.Presets)
	if err != nil {
		return nil, err
	}
	if err := s.repo.SaveWorkbenchToolWithPresets(item, presets, false); err != nil {
		return nil, err
	}
	if err := s.audit(actor, "workbench_tool.update", id, "更新工作台工具", map[string]any{"beforeVersion": before.Version, "version": item.Version, "enabled": item.Enabled}); err != nil {
		return nil, err
	}
	return s.adminToolView(item)
}

func (s *Service) SetToolEnabled(actor *model.User, id string, enabled bool) error {
	if err := s.requireAdmin(actor); err != nil {
		return err
	}
	item, err := s.repo.WorkbenchTool(id)
	if err != nil {
		return err
	}
	if enabled {
		if strings.TrimSpace(item.Name) == "" || !validKind(item.Kind) {
			return kernel.BadAuthRequest("工具缺少有效名称或类型")
		}
		if err := s.validateToolResources(actor.ID, item.IconResourceID, item.CoverResourceID, item.CapabilityJSON, item.GuideJSON); err != nil {
			return err
		}
	}
	before := item.Enabled
	item.Enabled, item.UpdatedBy, item.UpdatedAt, item.Version = enabled, actor.ID, time.Now(), item.Version+1
	if err := s.repo.SaveWorkbenchTool(item); err != nil {
		return err
	}
	return s.audit(actor, "workbench_tool.publish", id, map[bool]string{true: "发布工作台工具", false: "下线工作台工具"}[enabled], map[string]any{"before": before, "enabled": enabled, "version": item.Version})
}

func (s *Service) CreatePreset(actor *model.User, req PresetInput) (*PresetView, error) {
	if err := s.requireAdmin(actor); err != nil {
		return nil, err
	}
	tool, err := s.repo.WorkbenchTool(strings.TrimSpace(req.ToolID))
	if err != nil {
		return nil, err
	}
	item, err := normalizePreset(req)
	if err != nil {
		return nil, err
	}
	item.ID, item.CreatedBy, item.UpdatedBy = kernel.NewID(), actor.ID, actor.ID
	item.Version, item.CreatedAt, item.UpdatedAt = 1, time.Now(), time.Now()
	if err := s.repo.CreateWorkbenchPreset(item); err != nil {
		return nil, err
	}
	if err := s.audit(actor, "workbench_preset.create", item.ID, "创建工作台提示词预设", map[string]any{"toolId": tool.ID, "enabled": item.Enabled}); err != nil {
		return nil, err
	}
	view := presetView(*item)
	return &view, nil
}

func (s *Service) UpdatePreset(actor *model.User, id string, req PresetInput) (*PresetView, error) {
	if err := s.requireAdmin(actor); err != nil {
		return nil, err
	}
	before, err := s.repo.WorkbenchPreset(id)
	if err != nil {
		return nil, err
	}
	item, err := normalizePreset(req)
	if err != nil {
		return nil, err
	}
	if item.ToolID != before.ToolID {
		return nil, kernel.BadAuthRequest("预设所属工具不可更改")
	}
	item.ID, item.CreatedBy, item.CreatedAt = before.ID, before.CreatedBy, before.CreatedAt
	item.Version, item.UpdatedBy, item.UpdatedAt = before.Version+1, actor.ID, time.Now()
	if err := s.repo.SaveWorkbenchPreset(item); err != nil {
		return nil, err
	}
	if err := s.audit(actor, "workbench_preset.update", id, "更新工作台提示词预设", map[string]any{"beforeVersion": before.Version, "version": item.Version, "enabled": item.Enabled}); err != nil {
		return nil, err
	}
	view := presetView(*item)
	return &view, nil
}

func (s *Service) SetPresetEnabled(actor *model.User, id string, enabled bool) error {
	if err := s.requireAdmin(actor); err != nil {
		return err
	}
	item, err := s.repo.WorkbenchPreset(id)
	if err != nil {
		return err
	}
	if _, err := s.repo.WorkbenchTool(item.ToolID); err != nil {
		return err
	}
	before := item.Enabled
	item.Enabled, item.Version, item.UpdatedBy, item.UpdatedAt = enabled, item.Version+1, actor.ID, time.Now()
	if err := s.repo.SaveWorkbenchPreset(item); err != nil {
		return err
	}
	return s.audit(actor, "workbench_preset.publish", id, map[bool]string{true: "启用工作台预设", false: "停用工作台预设"}[enabled], map[string]any{"before": before, "enabled": enabled, "version": item.Version})
}

func (s *Service) adminToolView(item *model.WorkbenchTool) (*ToolView, error) {
	presets, err := s.repo.WorkbenchPresets(item.ID, false)
	if err != nil {
		return nil, err
	}
	view := toolView(*item, presets)
	view.IconURL, view.CoverURL = "", ""
	return &view, nil
}

func (s *Service) requireAdmin(actor *model.User) error {
	if s == nil || s.admin == nil {
		return errors.New("工作台管理权限未配置")
	}
	return s.admin.RequireAdmin(actor)
}
func (s *Service) audit(actor *model.User, action, id, summary string, data any) error {
	if s == nil || s.admin == nil {
		return errors.New("工作台审计未配置")
	}
	return s.admin.AppendAudit(actor, action, "workbench", id, summary, data)
}

func (s *Service) normalizeToolPresets(actorID, toolID string, inputs *[]ToolPresetInput) (*[]model.WorkbenchPreset, error) {
	if inputs == nil {
		return nil, nil
	}
	if len(*inputs) > 50 {
		return nil, kernel.BadAuthRequest("每个工具最多配置 50 条预设")
	}
	items := make([]model.WorkbenchPreset, 0, len(*inputs))
	seen := map[string]bool{}
	for _, input := range *inputs {
		input.ToolID = toolID
		item, err := normalizePreset(input.PresetInput)
		if err != nil {
			return nil, err
		}
		item.ID = strings.TrimSpace(input.ID)
		if item.ID == "" {
			item.ID = kernel.NewID()
		} else {
			before, err := s.repo.WorkbenchPreset(item.ID)
			if err != nil || before.ToolID != toolID {
				return nil, kernel.BadAuthRequest("预设不属于当前工具")
			}
			item.CreatedBy, item.CreatedAt, item.Version = before.CreatedBy, before.CreatedAt, before.Version
		}
		if seen[item.ID] {
			return nil, kernel.BadAuthRequest("预设重复")
		}
		seen[item.ID] = true
		if item.CreatedBy == "" {
			item.CreatedBy, item.CreatedAt = actorID, time.Now()
		}
		item.UpdatedBy, item.UpdatedAt, item.Version = actorID, time.Now(), item.Version+1
		items = append(items, *item)
	}
	return &items, nil
}

func (s *Service) validateToolResources(adminID, iconID, coverID, capabilityJSON, guideJSON string) error {
	seen := map[string]bool{}
	for _, id := range []string{iconID, coverID} {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		resource, err := s.repo.ResourceForUser(adminID, id)
		if err != nil || resource.Status != model.ResourceStatusReady || resource.Kind != "image" {
			return kernel.BadAuthRequest("工具图标和封面必须引用当前管理员已就绪的图片资源")
		}
	}
	config, err := parseCatalogConfig(capabilityJSON, guideJSON)
	if err != nil {
		return kernel.BadAuthRequest("工具输入配置无效")
	}
	for _, reference := range catalogResourceIDs(config) {
		if seen[reference.id] {
			continue
		}
		seen[reference.id] = true
		resource, resourceErr := s.repo.ResourceForUser(adminID, reference.id)
		if resourceErr != nil || resource.Status != model.ResourceStatusReady || resource.Kind != reference.kind {
			return kernel.BadAuthRequest("工具输入槽位和效果示例必须引用当前管理员已就绪的对应媒体")
		}
	}
	return nil
}

func (s *Service) attachToolMedia(view *ToolView) error {
	if s.access == nil {
		return nil
	}
	if view.IconResourceID != "" {
		url, err := s.access.WorkbenchResourceAccess(view.IconResourceID)
		if err != nil {
			return err
		}
		view.IconURL = url
	}
	if view.CoverResourceID != "" {
		url, err := s.access.WorkbenchResourceAccess(view.CoverResourceID)
		if err != nil {
			return err
		}
		view.CoverURL = url
	}
	for index := range view.InputContract.Slots {
		slot := &view.InputContract.Slots[index]
		if slot.CoverResourceID != "" {
			if url, err := s.access.WorkbenchResourceAccess(slot.CoverResourceID); err == nil {
				slot.CoverURL = url
			}
		}
		if slot.SampleResourceID != "" {
			if url, err := s.access.WorkbenchResourceAccess(slot.SampleResourceID); err == nil {
				slot.SampleURL = url
			}
		}
	}
	for _, resourceID := range view.ResultExample.ImageResourceIDs {
		if url, err := s.access.WorkbenchResourceAccess(resourceID); err == nil {
			view.ResultExample.ImageURLs = append(view.ResultExample.ImageURLs, url)
		}
	}
	if view.ResultExample.VideoResourceID != "" {
		if url, err := s.access.WorkbenchResourceAccess(view.ResultExample.VideoResourceID); err == nil {
			view.ResultExample.VideoURL = url
		}
	}
	return nil
}

func normalizeTool(req ToolInput) (*model.WorkbenchTool, error) {
	item := &model.WorkbenchTool{
		Kind: strings.TrimSpace(req.Kind), CategoryID: strings.TrimSpace(req.CategoryID), Name: strings.TrimSpace(req.Name),
		Subtitle: strings.TrimSpace(req.Subtitle), Description: strings.TrimSpace(req.Description), IconResourceID: strings.TrimSpace(req.IconResourceID),
		CoverResourceID: strings.TrimSpace(req.CoverResourceID), SortOrder: req.SortOrder, Enabled: req.Enabled,
	}
	if !validKind(item.Kind) {
		return nil, kernel.BadAuthRequest("工作台类型只能是 image 或 video")
	}
	if !validCategoryID(item.CategoryID) {
		return nil, kernel.BadAuthRequest("工具分类无效")
	}
	if item.Name == "" || utf8.RuneCountInString(item.Name) > 120 || utf8.RuneCountInString(item.CategoryID) > 64 || utf8.RuneCountInString(item.Subtitle) > 240 || utf8.RuneCountInString(item.Description) > 12000 {
		return nil, kernel.BadAuthRequest("工具名称、分类或说明长度无效")
	}
	if item.SortOrder < 0 || item.SortOrder > 1_000_000 {
		return nil, kernel.BadAuthRequest("工具排序值无效")
	}
	var err error
	item.CapabilityJSON, err = optionalJSONObject(req.Capability)
	if err != nil {
		return nil, fmt.Errorf("capability: %w", err)
	}
	item.GuideJSON, err = optionalJSONObject(req.Guide)
	if err != nil {
		return nil, fmt.Errorf("guide: %w", err)
	}
	config, err := parseCatalogConfig(item.CapabilityJSON, item.GuideJSON)
	if err != nil {
		return nil, kernel.BadAuthRequest("工具预设结构无效")
	}
	config, err = normalizeCatalogConfig(config)
	if err != nil {
		return nil, kernel.BadAuthRequest(err.Error())
	}
	capability := map[string]any{}
	guide := map[string]any{}
	_ = json.Unmarshal([]byte(item.CapabilityJSON), &capability)
	_ = json.Unmarshal([]byte(item.GuideJSON), &guide)
	capability["inputContract"] = config.InputContract
	capability["searchKeywords"], capability["surfaces"] = config.SearchKeywords, config.Surfaces
	capability["recommended"], capability["recommendationOrder"] = config.Recommended, config.RecommendationOrder
	guide["inputHint"], guide["resultExample"] = config.InputHint, config.ResultExample
	encodedCapability, err := json.Marshal(capability)
	if err != nil {
		return nil, err
	}
	encodedGuide, err := json.Marshal(guide)
	if err != nil {
		return nil, err
	}
	item.CapabilityJSON, item.GuideJSON = string(encodedCapability), string(encodedGuide)
	return item, nil
}

func normalizePreset(req PresetInput) (*model.WorkbenchPreset, error) {
	item := &model.WorkbenchPreset{
		ToolID: strings.TrimSpace(req.ToolID), Name: strings.TrimSpace(req.Name), Summary: strings.TrimSpace(req.Summary),
		PromptTemplate: strings.TrimSpace(req.PromptTemplate), SortOrder: req.SortOrder, Enabled: req.Enabled,
	}
	if item.ToolID == "" || item.Name == "" || item.PromptTemplate == "" || utf8.RuneCountInString(item.Name) > 120 || utf8.RuneCountInString(item.Summary) > 500 || utf8.RuneCountInString(item.PromptTemplate) > 12000 {
		return nil, kernel.BadAuthRequest("预设工具、名称、提示词或文本长度无效")
	}
	if item.SortOrder < 0 || item.SortOrder > 1_000_000 {
		return nil, kernel.BadAuthRequest("预设排序值无效")
	}
	var err error
	item.DefaultParamsJSON, err = optionalJSONObject(req.DefaultParameters)
	if err != nil {
		return nil, fmt.Errorf("defaultParameters: %w", err)
	}
	return item, nil
}

func optionalJSONObject(raw json.RawMessage) (string, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return "{}", nil
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil || value == nil {
		return "", kernel.BadAuthRequest("字段必须是 JSON 对象")
	}
	return string(raw), nil
}

func toolIDs(items []model.WorkbenchTool) []string {
	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
	}
	return ids
}

func validKind(kind string) bool { return kind == KindImage || kind == KindVideo }

func toolView(item model.WorkbenchTool, presets []model.WorkbenchPreset) ToolView {
	config, _ := parseCatalogConfig(item.CapabilityJSON, item.GuideJSON)
	view := ToolView{
		ID: item.ID, Kind: item.Kind, CategoryID: item.CategoryID, Name: item.Name, Subtitle: item.Subtitle, Description: item.Description,
		IconResourceID: item.IconResourceID, CoverResourceID: item.CoverResourceID, SortOrder: item.SortOrder,
		Capability: json.RawMessage(item.CapabilityJSON), Guide: json.RawMessage(item.GuideJSON), InputHint: config.InputHint,
		SearchKeywords: config.SearchKeywords, Surfaces: config.Surfaces, Recommended: config.Recommended, RecommendationOrder: config.RecommendationOrder,
		InputContract: inputContractView(config.InputContract), ResultExample: resultExampleView(config.ResultExample), Enabled: item.Enabled, Version: item.Version, UpdatedAt: item.UpdatedAt,
		Presets: make([]PresetView, 0, len(presets)),
	}
	for _, preset := range presets {
		view.Presets = append(view.Presets, presetView(preset))
	}
	return view
}

func inputContractView(contract InputContract) InputContractView {
	view := InputContractView{PromptRequired: contract.PromptRequired, MinTextReferences: contract.MinTextReferences, Slots: make([]ReferenceSlotView, 0, len(contract.Slots))}
	for _, slot := range contract.Slots {
		view.Slots = append(view.Slots, ReferenceSlotView{Key: slot.Key, Name: slot.Name, MediaTypes: slot.MediaTypes, ResourceKind: slot.ResourceKind, MaxCount: slot.MaxCount, Required: slot.Required, MinCount: slot.MinCount, CoverResourceID: slot.CoverResourceID, SampleResourceID: slot.SampleResourceID})
	}
	return view
}

func resultExampleView(example ResultExample) ResultExampleView {
	return ResultExampleView{Title: example.Title, Description: example.Description, ImageResourceIDs: example.ImageResourceIDs, VideoResourceID: example.VideoResourceID}
}

func presetView(item model.WorkbenchPreset) PresetView {
	return PresetView{ID: item.ID, ToolID: item.ToolID, Name: item.Name, Summary: item.Summary, PromptTemplate: item.PromptTemplate,
		DefaultParameters: json.RawMessage(item.DefaultParamsJSON), SortOrder: item.SortOrder, Enabled: item.Enabled, Version: item.Version, UpdatedAt: item.UpdatedAt}
}
