// Package tool 是云端 Agent 工具元数据的唯一注册表。
//
// 工具是否为写入、只读、可缓存、媒体生成、是否可沉淀经验，全部由这里的 Policy
// 推导；业务代码禁止再用工具名字面量做 OR 链或 switch 判断类别。新增工具时只需
// 在 registry 表中登记一行，漏登记会让 TestRegistryCoversPlatformTools 失败。
package tool

import (
	"slices"
	"sort"
)

// Kind 描述工具对画布和计费的影响面。
type Kind int

const (
	// KindControl 是会话控制类工具（计划、提问、记忆、偏好），不读写画布。
	KindControl Kind = iota
	// KindRead 只读取事实，不产生副作用。
	KindRead
	// KindWrite 修改画布或结构化内容，但不提交收费任务。
	KindWrite
	// KindMedia 创建草稿并提交收费生成任务，总是走独立审批。
	KindMedia
	// KindPrepare 生成临时资源或请求，不修改画布也不收费（如标注图、白模预览）。
	KindPrepare
)

// CacheScope 说明只读结果的缓存键需要绑定哪种外部版本。
type CacheScope int

const (
	CacheNone CacheScope = iota
	// CacheCanvasRevision 结果随画布 revision 失效。
	CacheCanvasRevision
	// CacheSkillVersion 结果随技能版本失效。
	CacheSkillVersion
)

// Policy 是一个工具的全部运行时分类。
type Policy struct {
	Name string
	Kind Kind
	// Cacheable 表示同参同版本的读取可复用结果。
	Cacheable bool
	// CacheScope 仅对可读工具有效，用于构造版本绑定的缓存键。
	CacheScope CacheScope
	// OffsetDefaults 列出省略时等价于 0 的分页字段，缓存键归一化使用。
	OffsetDefaults []string
	// Vision 表示工具把图片交给模型，读循环收敛时与只读工具一起收起。
	Vision bool
	// RequiresCanvas / RequiresSkills / RequiresWriteMode / RequiresDrama are visibility gates,
	// not grants of business authorization. Execution still validates ownership.
	RequiresCanvas    bool
	RequiresSkills    bool
	RequiresWriteMode bool
	// RequiresMemory 只在用户没有关闭长期记忆时暴露。
	RequiresMemory bool
	// RequiresDrama 只在画布关联了当前用户的短剧作品时暴露。
	RequiresDrama bool
	// AlwaysApprove 让写入在 auto 模式下也先审批：写入会改变画布以外的业务对象（如短剧版本）。
	AlwaysApprove bool
	// OutsideTransaction performs storage IO before the checkpoint transaction.
	OutsideTransaction bool
}

// Scope contains server-derived capabilities for this run, never model claims.
type Scope struct {
	Canvas         bool
	Skills         bool
	Vision         bool
	ReadOnly       bool
	IncludeProfile bool
	// Drama 表示本轮画布关联了当前用户的短剧作品，由服务端建 run 时推导。
	Drama bool
	// Memory 表示本轮长期记忆处于开启状态（自动生效或需确认），由服务端建 run 时冻结。
	Memory bool
}

func (p Policy) Allowed(scope Scope) bool {
	return p.Name != "" &&
		(!p.RequiresCanvas || scope.Canvas) &&
		(!p.RequiresSkills || scope.Skills) &&
		(!p.RequiresMemory || scope.Memory) &&
		(!p.RequiresDrama || scope.Drama) &&
		(!p.Vision || scope.Vision) &&
		(!p.Write() && !p.RequiresWriteMode || !scope.ReadOnly) &&
		(p.Name != AgentProfileRead || scope.IncludeProfile)
}

// Write 表示该工具会产生画布写入或收费任务。
func (p Policy) Write() bool { return p.Kind == KindWrite || p.Kind == KindMedia }

// ReadOnly 表示该工具计入只读循环预算。
func (p Policy) ReadOnly() bool { return p.Kind == KindRead }

// Media 表示该工具提交收费媒体任务。
func (p Policy) Media() bool { return p.Kind == KindMedia }

func (p Policy) ApprovalRequired(permissionMode string) bool {
	return p.Media() || (p.Write() && (p.AlwaysApprove || permissionMode == "request_approval"))
}

// 工具名常量。业务包引用这些常量而不是字符串字面量。
const (
	AgentProfileRead       = "agent_profile_read"
	PlanUpdate             = "plan_update"
	AskUser                = "ask_user"
	PrevisSceneRead        = "previs_scene_read"
	PrevisPreview          = "previs_preview"
	PrevisSceneCreate      = "previs_scene_create"
	PrevisApplyPatch       = "previs_apply_patch"
	CanvasListNodeTypes    = "canvas_list_node_types"
	CanvasGetState         = "canvas_get_state"
	CanvasReadText         = "canvas_read_text"
	CanvasReadBatchTable   = "canvas_read_batch_table"
	CanvasReadStoryboard   = "canvas_read_storyboard"
	ImageTextDetect        = "image_text_detect"
	ImageAnnotationRender  = "image_annotation_render"
	SkillReadFile          = "skill_read_file"
	SkillSearch            = "skill_search"
	SkillMarketSearch      = "skill_market_search"
	SkillRecommend         = "skill_recommend"
	TaskGet                = "task_get"
	CanvasInspectImage     = "canvas_inspect_image"
	MemoryUpdate           = "memory_update"
	ImageLayerSplit        = "image_layer_split"
	ModelList              = "model_list"
	CanvasCreateStoryboard = "canvas_create_storyboard"
	CanvasEditStoryboard   = "canvas_edit_storyboard"
	CanvasCreateCharacter  = "canvas_create_character"
	CanvasEditBatchTable   = "canvas_edit_batch_table"
	CanvasApplyOps         = "canvas_apply_ops"
	CanvasArrangeNodes     = "canvas_arrange_nodes"
	GenerateMedia          = "generate_media"
	DramaGetContext        = "drama_get_context"
	DramaAdoptCanvasMedia  = "drama_adopt_canvas_media"
)

var offsets = []string{"offset", "connectionOffset", "storyboardOffset"}

var registry = map[string]Policy{}

func register(p Policy) {
	if _, exists := registry[p.Name]; exists {
		panic("agent tool registered twice: " + p.Name)
	}
	registry[p.Name] = p
}

func init() {
	for _, p := range policies() {
		register(p)
	}
}

func policies() []Policy {
	return []Policy{
		{Name: AgentProfileRead, Kind: KindRead, Cacheable: true},
		{Name: PlanUpdate, Kind: KindControl},
		{Name: AskUser, Kind: KindControl},
		{Name: PrevisSceneRead, Kind: KindRead, Cacheable: true, CacheScope: CacheCanvasRevision, RequiresCanvas: true},
		{Name: PrevisPreview, Kind: KindPrepare, RequiresCanvas: true, RequiresWriteMode: true},
		{Name: PrevisSceneCreate, Kind: KindWrite, RequiresCanvas: true},
		{Name: PrevisApplyPatch, Kind: KindWrite, RequiresCanvas: true},
		{Name: CanvasListNodeTypes, Kind: KindRead, RequiresCanvas: true},
		{Name: CanvasGetState, Kind: KindRead, Cacheable: true, CacheScope: CacheCanvasRevision, OffsetDefaults: offsets, RequiresCanvas: true},
		{Name: CanvasReadText, Kind: KindRead, CacheScope: CacheCanvasRevision, OffsetDefaults: offsets, RequiresCanvas: true, OutsideTransaction: true},
		{Name: CanvasReadBatchTable, Kind: KindRead, OffsetDefaults: offsets, RequiresCanvas: true},
		{Name: CanvasReadStoryboard, Kind: KindRead, Cacheable: true, CacheScope: CacheCanvasRevision, OffsetDefaults: offsets, RequiresCanvas: true},
		{Name: ImageTextDetect, Kind: KindPrepare, RequiresCanvas: true},
		{Name: ImageAnnotationRender, Kind: KindPrepare, RequiresCanvas: true, OutsideTransaction: true},
		{Name: SkillReadFile, Kind: KindRead, Cacheable: true, CacheScope: CacheSkillVersion, OffsetDefaults: offsets, RequiresSkills: true, OutsideTransaction: true},
		{Name: SkillSearch, Kind: KindRead, RequiresSkills: true, OutsideTransaction: true},
		{Name: SkillMarketSearch, Kind: KindRead, OutsideTransaction: true},
		{Name: SkillRecommend, Kind: KindControl},
		{Name: TaskGet, Kind: KindRead},
		{Name: CanvasInspectImage, Kind: KindPrepare, Vision: true, RequiresCanvas: true},
		{Name: MemoryUpdate, Kind: KindControl, RequiresWriteMode: true, RequiresMemory: true, OutsideTransaction: true},
		{Name: ImageLayerSplit, Kind: KindMedia, RequiresCanvas: true},
		{Name: ModelList, Kind: KindRead, Cacheable: true, RequiresCanvas: true, RequiresWriteMode: true, OutsideTransaction: true},
		{Name: CanvasCreateStoryboard, Kind: KindWrite, RequiresCanvas: true},
		{Name: CanvasEditStoryboard, Kind: KindWrite, RequiresCanvas: true},
		{Name: CanvasCreateCharacter, Kind: KindWrite, RequiresCanvas: true},
		{Name: CanvasEditBatchTable, Kind: KindWrite, RequiresCanvas: true},
		{Name: CanvasApplyOps, Kind: KindWrite, RequiresCanvas: true},
		{Name: CanvasArrangeNodes, Kind: KindWrite, RequiresCanvas: true},
		{Name: GenerateMedia, Kind: KindMedia, RequiresCanvas: true},
		{Name: DramaGetContext, Kind: KindRead, RequiresCanvas: true, RequiresDrama: true, OutsideTransaction: true},
		{Name: DramaAdoptCanvasMedia, Kind: KindWrite, RequiresCanvas: true, RequiresDrama: true, AlwaysApprove: true},
	}
}

// Get 返回工具策略；未登记的工具名返回 false，调用方必须按未知工具处理。
func Get(name string) (Policy, bool) {
	p, ok := registry[name]
	p.OffsetDefaults = slices.Clone(p.OffsetDefaults)
	return p, ok
}

// Of 返回工具策略的副本，未知工具按不可写、不可缓存处理。
func Of(name string) Policy {
	p, _ := Get(name)
	return p
}

// Names 返回全部登记工具名（字典序），用于覆盖性测试。
func Names() []string {
	names := make([]string, 0, len(registry))
	for name := range registry {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}
