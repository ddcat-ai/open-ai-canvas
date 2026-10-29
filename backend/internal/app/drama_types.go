package app

import (
	"encoding/json"
	"strings"

	"yingce/backend/internal/model"
	"yingce/backend/internal/production"
)

// DramaModelChoice 是一条可在服务端独立执行的模型选择：逻辑模型或系统渠道模型二选一。
// 自定义渠道的密钥只存在浏览器，无法驱动无人值守的流水线，因此不在这里出现。
type DramaModelChoice struct {
	LogicalModelID string `json:"logicalModelId,omitempty"`
	ChannelID      string `json:"channelId,omitempty"`
	ModelKey       string `json:"modelKey,omitempty"`
	Label          string `json:"label,omitempty"`
	PriceLabel     string `json:"priceLabel,omitempty"`
}

func (c DramaModelChoice) Empty() bool {
	return strings.TrimSpace(c.LogicalModelID) == "" && (strings.TrimSpace(c.ChannelID) == "" || strings.TrimSpace(c.ModelKey) == "")
}

// DramaModels 是制作用到的三类模型：文本（改编、分镜、视频提示词）、图片（角色/道具/场景参考图）、
// 视频（按剧情段生成带对白与音效的视频）。
type DramaModels struct {
	Text  DramaModelChoice `json:"text"`
	Image DramaModelChoice `json:"image"`
	Video DramaModelChoice `json:"video"`
}

func (m DramaModels) choice(capability string) DramaModelChoice {
	switch capability {
	case "text":
		return m.Text
	case "image":
		return m.Image
	case "video":
		return m.Video
	}
	return DramaModelChoice{}
}

// 生成节奏：manual 先只跑文本（作品圣经、分集、剧本、分镜与视频提示词），用户确认后再生成参考图与视频；
// auto 一路跑到成片。
const (
	DramaMediaManual = "manual"
	DramaMediaAuto   = "auto"
)

// 审阅方式：sample 先完整做出第 1 集样片，确认后其余集才生成视频；every 每集生成视频前确认视频提示词；auto 不打断。
const (
	DramaReviewSample = "sample"
	DramaReviewEvery  = "every"
	DramaReviewAuto   = "auto"
)

// DramaSkillRef 指向用户技能库里的一个技能文件，用作剧情段视频提示词的写作方法。
type DramaSkillRef struct {
	SkillID   string `json:"skillId"`
	SkillName string `json:"skillName"`
	Path      string `json:"path"`
}

type DramaSettings struct {
	production.Settings
	// PromptSkill 为空时按内置格式撰写段视频提示词。
	PromptSkill *DramaSkillRef `json:"promptSkill,omitempty"`
	ReviewMode  string         `json:"reviewMode"`
	MediaMode   string         `json:"mediaMode"`
	Concurrency int            `json:"concurrency"`
	Models      DramaModels    `json:"models"`
	// ReferenceLimit 是自动取参考图时每段最多随请求发送的张数，0 表示按视频模型上限；手动指定参考图的段只受模型上限约束。
	ReferenceLimit int `json:"referenceLimit"`
	// EpisodeMode 是小说的分集方式：chapter 按章节固定分组（每 ChaptersPerEpisode 章一集），auto 由文本模型规划。
	// 空串是早于该设置创建的作品（分集方式没有记录）；分集完成后不能再修改。剧本与分镜总是每章一集。
	EpisodeMode        string `json:"episodeMode,omitempty"`
	ChaptersPerEpisode int    `json:"chaptersPerEpisode,omitempty"`
	// VideoContinuity 是剧情段视频的衔接方式，见 DramaContinuityTailFrame / DramaContinuityParallel。
	VideoContinuity string `json:"videoContinuity"`
}

// 剧情段视频衔接方式：tail_frame 第 2 段起用上一段视频的最后一帧做首帧，同集各段按顺序生成；
// parallel 每段只按角色/场景参考图独立生成，同集各段同时提交，适合按班次批量出片的渠道。
const (
	DramaContinuityTailFrame = "tail_frame"
	DramaContinuityParallel  = "parallel"
)

// parallelVideo 表示剧情段视频互不依赖：不等上一段、不带首帧，同集各段可同时生成。
func (s DramaSettings) parallelVideo() bool {
	return s.VideoContinuity == DramaContinuityParallel
}

// dramaMaxChaptersPerEpisode 是按章分集时每集最多合并的章数；dramaEpisodeSourceRunes 是合并后单集原文上限，
// 超过会让剧本提示词过长、改编时丢情节。
const (
	dramaMaxChaptersPerEpisode = 12
	dramaEpisodeSourceRunes    = 40000
)

// dramaMaxReferenceLimit 是每段参考图张数设置的上限。
const dramaMaxReferenceLimit = 20

func (s DramaSettings) normalized() DramaSettings {
	s.Settings = s.Settings.Normalized()
	switch s.ReviewMode {
	case DramaReviewSample, DramaReviewEvery, DramaReviewAuto:
	default:
		s.ReviewMode = DramaReviewSample
	}
	if s.MediaMode != DramaMediaManual {
		// 早于该设置创建的作品一直是全自动，保持原行为；新建作品由 CreateDrama 默认 manual。
		s.MediaMode = DramaMediaAuto
	}
	if s.PromptSkill != nil {
		ref := DramaSkillRef{SkillID: truncateRunes(strings.TrimSpace(s.PromptSkill.SkillID), 64), SkillName: truncateRunes(strings.TrimSpace(s.PromptSkill.SkillName), 120), Path: truncateRunes(strings.TrimSpace(s.PromptSkill.Path), 300)}
		s.PromptSkill = nil
		if ref.SkillID != "" {
			if ref.Path == "" {
				ref.Path = "SKILL.md"
			}
			s.PromptSkill = &ref
		}
	}
	if s.Concurrency <= 0 {
		s.Concurrency = 4
	}
	if s.Concurrency > 16 {
		s.Concurrency = 16
	}
	s.ReferenceLimit = max(0, min(dramaMaxReferenceLimit, s.ReferenceLimit))
	if s.VideoContinuity != DramaContinuityParallel {
		// 早于该设置创建的作品一直按尾帧续接，保持原行为。
		s.VideoContinuity = DramaContinuityTailFrame
	}
	switch s.EpisodeMode {
	case DramaEpisodeModeChapter, DramaEpisodeModeAuto, "":
	default:
		s.EpisodeMode = DramaEpisodeModeAuto
	}
	if s.EpisodeMode == DramaEpisodeModeChapter {
		s.ChaptersPerEpisode = max(1, min(dramaMaxChaptersPerEpisode, s.ChaptersPerEpisode))
	} else {
		s.ChaptersPerEpisode = 0
	}
	return s
}

func parseDramaSettings(raw string) DramaSettings {
	var settings DramaSettings
	_ = json.Unmarshal([]byte(raw), &settings)
	return settings.normalized()
}

func encodeDramaSettings(settings DramaSettings) string {
	encoded, _ := json.Marshal(settings.normalized())
	return string(encoded)
}

type dramaBibleMeta struct {
	Logline     string `json:"logline"`
	Tone        string `json:"tone"`
	VisualRules string `json:"visualRules"`
}

func parseDramaBibleMeta(raw string) dramaBibleMeta {
	var meta dramaBibleMeta
	_ = json.Unmarshal([]byte(raw), &meta)
	return meta
}

type DramaChapterInput struct {
	Title string `json:"title"`
	Text  string `json:"text"`
}

// 分集方式：auto 由文本模型把小说章节规划成集；chapter 每章就是一集，不经过分集规划，适合逐集制作。
const (
	DramaEpisodeModeAuto    = "auto"
	DramaEpisodeModeChapter = "chapter"
)

type CreateDramaRequest struct {
	Name               string              `json:"name"`
	Chapters           []DramaChapterInput `json:"chapters"`
	Settings           DramaSettings       `json:"settings"`
	BudgetMicrocredits int64               `json:"budgetMicrocredits"`
	Start              bool                `json:"start"`
	// SourceFormat 是素材类型：novel 小说、script 剧本、storyboard 分镜；剧本与分镜总是每章一集。
	SourceFormat string `json:"sourceFormat"`
	EpisodeMode  string `json:"episodeMode"`
}

// AddDramaEpisodeRequest 在作品末尾追加一集：原文直接成为这一集，不经过分集规划。
type AddDramaEpisodeRequest struct {
	Title        string `json:"title"`
	Text         string `json:"text"`
	SourceFormat string `json:"sourceFormat"`
}

// UpdateDramaChapterRequest 修改原文；已写好的剧本不会自动重写，需要用户点重新改编。
type UpdateDramaChapterRequest struct {
	Title *string `json:"title"`
	Text  *string `json:"text"`
}

type UpdateDramaEpisodeRequest struct {
	Title        *string `json:"title"`
	SourceFormat *string `json:"sourceFormat"`
}

// InsertDramaShotRequest 在指定镜头前或后插入一个空镜头，归入同一剧情段。
type InsertDramaShotRequest struct {
	Position string `json:"position"`
}

// SetDramaCastImageRequest 用用户上传或画布采用的图片替换参考图并锁定，之后不会被重新生成覆盖。
type SetDramaCastImageRequest struct {
	ResourceID      string `json:"resourceId"`
	RestyleSegments bool   `json:"restyleSegments"`
	// Source 为 canvas 表示从精修画布采用，版本记录标为“来自画布”；空串或 upload 为直接上传。
	Source string `json:"source"`
	// TaskID 是产出这张图的画布生成任务，只用于版本来源与提示词回看；与资源对不上时忽略。
	TaskID string `json:"taskId"`
}

// AdoptDramaSegmentVideoRequest 把画布上的视频采用为剧情段当前视频。
type AdoptDramaSegmentVideoRequest struct {
	ResourceID string `json:"resourceId"`
	TaskID     string `json:"taskId"`
	// Cascade=true 时后续已生成过视频的段重新排队生成（首帧换成新视频的尾帧，保证衔接）；默认只换本段。
	// 并行出片的作品段与段互不依赖，忽略该选项。
	Cascade bool `json:"cascade"`
	// ExpectedRevision 是客户端看到的剧情段版本；版本已变时拒绝，避免覆盖刚发生的修改。
	ExpectedRevision *int64 `json:"expectedRevision"`
}

// DramaCanvasAssetsRequest 为投送到画布的短剧媒体登记素材记录：画布媒体节点必须由当前用户的素材引用资源。
type DramaCanvasAssetsRequest struct {
	Resources []DramaCanvasAssetInput `json:"resources"`
}

type DramaCanvasAssetInput struct {
	ResourceID string `json:"resourceId"`
	Title      string `json:"title"`
	Category   string `json:"category"`
}

// DramaTakeView 是一个产物版本；Source 区分流水线生成（pipeline）、直接上传（upload）与画布采用（canvas）。
type DramaTakeView struct {
	ID         string `json:"id"`
	OwnerID    string `json:"ownerId"`
	Kind       string `json:"kind"`
	Version    int    `json:"version"`
	ResourceID string `json:"resourceId"`
	TaskID     string `json:"taskId,omitempty"`
	Prompt     string `json:"prompt"`
	DurationMs int64  `json:"durationMs,omitempty"`
	Source     string `json:"source"`
	Current    bool   `json:"current"`
	CreatedAt  string `json:"createdAt"`
}

// DramaDialogueCheck 是原文台词与镜头台词的逐句核对结果；Missing 是被删掉或改写的原文台词（最多展示 30 句）。
type DramaDialogueCheck struct {
	SourceLines  int      `json:"sourceLines"`
	MissingCount int      `json:"missingCount"`
	Missing      []string `json:"missing"`
}

type UpdateDramaSettingsRequest struct {
	Settings           *DramaSettings `json:"settings"`
	BudgetMicrocredits *int64         `json:"budgetMicrocredits"`
}

type DramaProductionView struct {
	Status             string        `json:"status"`
	Stage              string        `json:"stage"`
	PauseReason        string        `json:"pauseReason"`
	Settings           DramaSettings `json:"settings"`
	BudgetMicrocredits int64         `json:"budgetMicrocredits"`
	// SpentMicrocredits 是作品总花费：流水线任务加关联画布上的精修任务，预算按它判断。
	SpentMicrocredits       int64  `json:"spentMicrocredits"`
	CanvasSpentMicrocredits int64  `json:"canvasSpentMicrocredits"`
	PlanDone                bool   `json:"planDone"`
	PlanCursor              int    `json:"planCursor"`
	SampleApproved          bool   `json:"sampleApproved"`
	AssetsReleased          bool   `json:"assetsReleased"`
	Logline                 string `json:"logline"`
	Tone                    string `json:"tone"`
	ChapterCount            int    `json:"chapterCount"`
	WordCount               int    `json:"wordCount"`
}

// DramaEpisodeStats 按剧情段统计进度：视频提示词写好几段、视频生成几段、失败几段。
type DramaEpisodeStats struct {
	Segments    int64 `json:"segments"`
	PromptReady int64 `json:"promptReady"`
	VideoReady  int64 `json:"videoReady"`
	Failed      int64 `json:"failed"`
}

type DramaEpisodeRow struct {
	ID              string            `json:"id"`
	Number          int               `json:"number"`
	Title           string            `json:"title"`
	Synopsis        string            `json:"synopsis"`
	Stage           string            `json:"stage"`
	SourceFormat    string            `json:"sourceFormat"`
	Error           string            `json:"error"`
	ShotCount       int               `json:"shotCount"`
	DurationMs      int64             `json:"durationMs"`
	Approved        bool              `json:"approved"`
	MediaReleased   bool              `json:"mediaReleased"`
	AwaitingMedia   bool              `json:"awaitingMedia"`
	FinalResourceID string            `json:"finalResourceId,omitempty"`
	FinalStale      bool              `json:"finalStale"`
	Stats           DramaEpisodeStats `json:"stats"`
}

type DramaInboxItem struct {
	ID        string `json:"id"`
	Kind      string `json:"kind"`
	Severity  string `json:"severity"`
	Title     string `json:"title"`
	Detail    string `json:"detail"`
	EpisodeID string `json:"episodeId,omitempty"`
	CastID    string `json:"castId,omitempty"`
	// 以下字段供前端把同类问题折叠成组：角色/道具/场景、所在集、段号与失败环节（prompt 提示词 / video 视频）。
	CastKind      string `json:"castKind,omitempty"`
	EpisodeNumber int    `json:"episodeNumber,omitempty"`
	SegmentIndex  int    `json:"segmentIndex"`
	Media         string `json:"media,omitempty"`
}

type DramaJobView struct {
	ID               string `json:"id"`
	Kind             string `json:"kind"`
	Status           string `json:"status"`
	Label            string `json:"label"`
	Error            string `json:"error,omitempty"`
	EpisodeID        string `json:"episodeId,omitempty"`
	ShotID           string `json:"shotId,omitempty"`
	TaskID           string `json:"taskId,omitempty"`
	CostMicrocredits int64  `json:"costMicrocredits"`
	Attempt          int    `json:"attempt"`
	CreatedAt        string `json:"createdAt"`
	StartedAt        string `json:"startedAt,omitempty"`
	FinishedAt       string `json:"finishedAt,omitempty"`
	UpdatedAt        string `json:"updatedAt"`
	// ProviderStage 是生成中任务的上游进度文案（如“候车 · 前面 3 条”），只在上游已接收任务时给出。
	ProviderStage string `json:"providerStage,omitempty"`
}

// DramaJobAttempt 是工作的一次提交记录；status 为任务状态，或 rejected（提交时被准入拒绝）。
type DramaJobAttempt struct {
	TaskID           string `json:"taskId,omitempty"`
	Status           string `json:"status"`
	Error            string `json:"error,omitempty"`
	CostMicrocredits int64  `json:"costMicrocredits"`
	At               string `json:"at"`
}

// DramaJobTaskView 是队列详情里展示的任务快照：只暴露请求参数白名单，不回显渠道配置。
type DramaJobTaskView struct {
	ID          string            `json:"id"`
	Status      string            `json:"status"`
	Stage       string            `json:"stage,omitempty"`
	Operation   string            `json:"operation,omitempty"`
	Model       string            `json:"model"`
	ModelLabel  string            `json:"modelLabel"`
	Prompt      string            `json:"prompt"`
	Params      map[string]string `json:"params"`
	Error       string            `json:"error,omitempty"`
	MediaStage  string            `json:"mediaStage,omitempty"`
	CreatedAt   string            `json:"createdAt"`
	StartedAt   string            `json:"startedAt,omitempty"`
	CompletedAt string            `json:"completedAt,omitempty"`
	ResultMode  string            `json:"resultMode,omitempty"`
	ResultText  string            `json:"resultText,omitempty"`
	ResourceIDs []string          `json:"resourceIds,omitempty"`
}

type DramaJobAttemptView struct {
	DramaJobAttempt
	Task *DramaJobTaskView `json:"task,omitempty"`
}

type DramaJobDetail struct {
	Job      DramaJobView          `json:"job"`
	Target   string                `json:"target"`
	Attempts []DramaJobAttemptView `json:"attempts"`
}

type DramaSummary struct {
	Project    model.Project       `json:"project"`
	Production DramaProductionView `json:"production"`
	Episodes   []DramaEpisodeRow   `json:"episodes"`
	JobCounts  map[string]int64    `json:"jobCounts"`
	Inbox      []DramaInboxItem    `json:"inbox"`
	CastCount  int                 `json:"castCount"`
}

type DramaChapterRef struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Position  int    `json:"position"`
	WordCount int    `json:"wordCount"`
}

type DramaEpisodeDetail struct {
	Episode  model.DramaEpisode `json:"episode"`
	Shots    []model.DramaShot  `json:"shots"`
	Segments []DramaSegmentView `json:"segments"`
	Chapters []DramaChapterRef  `json:"chapters"`
	Jobs     []DramaJobView     `json:"jobs"`
	// ScriptJob 是本集最近一次改编剧本的调度工作，可查看改编提示词与模型返回。
	ScriptJob *DramaJobView `json:"scriptJob,omitempty"`
	// DialogueCheck 只在本集有镜头、且原文章节不与其他集共用时给出（共用时无法判断哪些台词属于本集）。
	DialogueCheck *DramaDialogueCheck `json:"dialogueCheck,omitempty"`
}

// DramaSegmentView 是一个剧情段：视频提示词、参考图、生成方式与视频结果。
type DramaSegmentView struct {
	ID string `json:"id"`
	// Revision 用于画布采用时的乐观并发校验。
	Revision   int64    `json:"revision"`
	Index      int      `json:"index"`
	Title      string   `json:"title"`
	ShotIDs    []string `json:"shotIds"`
	DurationMs int64    `json:"durationMs"`
	// VideoPrompt 为生效内容：手动改写优先，其次是模型撰写的 Generated。
	VideoPrompt string `json:"videoPrompt"`
	Generated   string `json:"generated"`
	Custom      bool   `json:"custom"`
	// PromptStatus：none 无记录、queued 待撰写、running 撰写中、ready 完成、stale 镜头已改动、failed 失败。
	PromptStatus string `json:"promptStatus"`
	PromptError  string `json:"promptError,omitempty"`
	// VideoStatus：空串待生成、running、ready、stale（提示词或上一段已变）、failed。
	VideoStatus         string `json:"videoStatus"`
	VideoResourceID     string `json:"videoResourceId,omitempty"`
	TailFrameResourceID string `json:"tailFrameResourceId,omitempty"`
	// VideoSeconds 是当前视频进入成片的时长（秒），与成片时间线一致。
	VideoSeconds int    `json:"videoSeconds,omitempty"`
	VideoError   string `json:"videoError,omitempty"`
	// VideoReprocessable：视频已生成并入库，只是结果回写（如抽尾帧）失败；可重新处理已有视频，不重新生成。
	VideoReprocessable bool             `json:"videoReprocessable,omitempty"`
	VideoModel         DramaModelChoice `json:"videoModel"`
	// ReferenceMode：auto 按本段镜头自动取参考图；custom 为用户指定的参考图。
	ReferenceMode string `json:"referenceMode"`
	// Request 是生成本段视频时实际会发送的内容：生成方式、首帧、参考图、秒数与追加在提示词前的参考图说明。
	Request   DramaSegmentRequest `json:"request"`
	PromptJob *DramaJobView       `json:"promptJob,omitempty"`
	VideoJob  *DramaJobView       `json:"videoJob,omitempty"`
	// VideoWait 只在视频已请求（queued）但尚未提交时出现：调度实际卡住的原因，例如等待上一段或参考图。
	VideoWait string `json:"videoWait,omitempty"`
}

// DramaSegmentRequest 是一段视频请求的预演，与提交时同一函数计算。
type DramaSegmentRequest struct {
	// Operation：image_to_video（上一段最后一帧作首帧）、reference_to_video（参考图）、text_to_video。
	Operation       string `json:"operation"`
	Seconds         int    `json:"seconds"`
	MaxVideoSeconds int    `json:"maxVideoSeconds"`
	// AspectRatio 是作品画幅；Size / Resolution 是实际发送的画面参数：声明比例参数的模型发 Size，
	// 用完整分辨率标签表达横竖的模型发 Resolution（例如 768p竖）。
	AspectRatio string `json:"aspectRatio"`
	Size        string `json:"size,omitempty"`
	Resolution  string `json:"resolution,omitempty"`
	// GenerateAudio 表示视频模型同步生成对白与音效；为 false 时本段视频没有声音。
	GenerateAudio bool `json:"generateAudio"`
	// FirstFrame 是上一段视频的最后一帧；第一段为空。FirstFramePending 表示上一段还没生成，生成后才能提交本段。
	FirstFrameResourceID string                  `json:"firstFrameResourceId,omitempty"`
	FirstFramePending    bool                    `json:"firstFramePending"`
	References           []DramaSegmentReference `json:"references"`
	// ReferenceCapacity 是本段最多随请求发送的参考图张数（已扣除首帧，并受每段上限约束）；ModelMaxImages 是视频模型声明的图片上限。
	ReferenceCapacity int `json:"referenceCapacity"`
	ModelMaxImages    int `json:"modelMaxImages"`
	// ReferenceLimited 表示有参考图因“每段最多参考图”设置而未发送（而不是模型上限）。
	ReferenceLimited bool `json:"referenceLimited,omitempty"`
	// Header 是提交时放在提示词最前面的参考图对应说明，让模型知道每张图是谁。
	Header string `json:"header"`
	// Warning 说明请求的限制，例如模型不支持参考图、参考图超出模型上限。
	Warning string `json:"warning,omitempty"`
	// UnknownReferences 是提示词正文里不属于本段的“参考图N”（编号超出本段参考图数量），存在时不能提交视频。
	UnknownReferences []string `json:"unknownReferences,omitempty"`
}

type DramaSegmentReference struct {
	ResourceID string `json:"resourceId,omitempty"`
	CastID     string `json:"castId"`
	Label      string `json:"label"`
	Kind       string `json:"kind"`
	Name       string `json:"name"`
	// Sent 表示这张参考图会随请求发送；未生成或超过模型参考图上限时为 false。
	Sent bool `json:"sent"`
}

type UpdateDramaSegmentRequest struct {
	// VideoPromptOverride 传空串表示恢复模型撰写的版本。
	VideoPromptOverride *string `json:"videoPromptOverride"`
	// ReferenceCastIDs 指定本段参考图（顺序即编号，可为空数组表示不发参考图）；AutoReferences=true 恢复按镜头自动取。
	ReferenceCastIDs *[]string `json:"referenceCastIds"`
	AutoReferences   bool      `json:"autoReferences"`
}

// UpdateDramaShotRequest 修改镜头的剧本内容；镜头只是撰写视频提示词的素材，修改后本段提示词标记过期。
type UpdateDramaShotRequest struct {
	Speaker     *string `json:"speaker"`
	Dialogue    *string `json:"dialogue"`
	Action      *string `json:"action"`
	ShotSize    *string `json:"shotSize"`
	Camera      *string `json:"camera"`
	ImagePrompt *string `json:"imagePrompt"`
	VideoPrompt *string `json:"videoPrompt"`
	// Transition 是进入本镜头的转场；DurationSeconds 手动设置镜头时长。
	Transition      *string  `json:"transition"`
	DurationSeconds *float64 `json:"durationSeconds"`
}

type UpdateDramaCastRequest struct {
	Name              *string   `json:"name"`
	Aliases           *[]string `json:"aliases"`
	Appearance        *string   `json:"appearance"`
	Description       *string   `json:"description"`
	VoiceInstructions *string   `json:"voiceInstructions"`
	Locked            *bool     `json:"locked"`
}

type DramaListItem struct {
	Project         model.Project `json:"project"`
	Status          string        `json:"status"`
	Stage           string        `json:"stage"`
	PauseReason     string        `json:"pauseReason"`
	EpisodeCount    int64         `json:"episodeCount"`
	DoneCount       int64         `json:"doneCount"`
	CoverResourceID string        `json:"coverResourceId,omitempty"`
	// CoverResourceIDs 是前几张角色参考图，卡片拼成封面；CoverResourceID 保留第一张。
	CoverResourceIDs  []string `json:"coverResourceIds,omitempty"`
	AspectRatio       string   `json:"aspectRatio"`
	StyleName         string   `json:"styleName,omitempty"`
	SpentMicrocredits int64    `json:"spentMicrocredits"`
	UpdatedAt         string   `json:"updatedAt"`
}

type DramaModelOption struct {
	Choice     DramaModelChoice `json:"choice"`
	Capability string           `json:"capability"`
	Label      string           `json:"label"`
	PriceLabel string           `json:"priceLabel"`
	// MaxVideoSeconds 仅视频模型：单次最长生成秒数，0 表示未声明。
	MaxVideoSeconds int `json:"maxVideoSeconds,omitempty"`
	// TailFrameChain 仅视频模型：是否支持图生视频，可用于“尾帧续接”；不支持的模型只能并行出片。
	TailFrameChain bool `json:"tailFrameChain,omitempty"`
	// VideoRatios 仅视频模型：能准确给出的作品画幅；不含作品画幅的模型不能用于该作品。
	VideoRatios []string `json:"videoRatios,omitempty"`
	// GenerateAudio 仅视频模型：是否同步生成对白与音效；false 时段视频没有声音。
	GenerateAudio *bool `json:"generateAudio,omitempty"`
	// 以下仅图片模型：可指定的参考图分辨率档位、默认档位，以及能按默认档位准确出图的参考图画幅。
	ImageResolutions       []string `json:"imageResolutions,omitempty"`
	DefaultImageResolution string   `json:"defaultImageResolution,omitempty"`
	ImageRatios            []string `json:"imageRatios,omitempty"`
}

// DramaModelUnavailable 是平台目录里有、但短剧流水线无法使用的模型及原因，前端置灰展示而不是隐藏。
type DramaModelUnavailable struct {
	Choice DramaModelChoice `json:"choice"`
	Reason string           `json:"reason"`
}

type DramaModelCatalog struct {
	Defaults    DramaModels                        `json:"defaults"`
	Options     map[string][]DramaModelOption      `json:"options"`
	Unavailable map[string][]DramaModelUnavailable `json:"unavailable"`
}

type DramaEstimateRequest struct {
	ChapterCount int           `json:"chapterCount"`
	WordCount    int           `json:"wordCount"`
	Settings     DramaSettings `json:"settings"`
	// EpisodeMode 为 chapter 时每章一集，集数等于章节数。
	EpisodeMode string `json:"episodeMode"`
}

// DramaEstimate 的 Videos 是剧情段数（一段一次视频调用），Images 是参考图数。
type DramaEstimate struct {
	Episodes          int    `json:"episodes"`
	Shots             int    `json:"shots"`
	Images            int    `json:"images"`
	Videos            int    `json:"videos"`
	TextCalls         int    `json:"textCalls"`
	MinMicrocredits   int64  `json:"minMicrocredits"`
	MaxMicrocredits   int64  `json:"maxMicrocredits"`
	SampleMicrocredit int64  `json:"sampleMicrocredits"`
	Priced            bool   `json:"priced"`
	Note              string `json:"note"`
	DurationMinutes   int    `json:"durationMinutes"`
}

// ReleaseDramaMediaRequest 在手动模式下放行生成：assets 只放行参考图，episodes 放行指定集，all 放行全部。
type ReleaseDramaMediaRequest struct {
	Target     string   `json:"target"`
	EpisodeIDs []string `json:"episodeIds"`
}
