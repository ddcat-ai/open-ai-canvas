package model

import "time"

// 短剧自动制作域：章节（ProjectUnit kind=chapter）只承载小说原文，
// 集（DramaEpisode）是剧本、分镜和后续产物的唯一基石。
// 编排状态全部落库，由服务端调度循环推进，浏览器只读写意图。

const (
	DramaStatusDraft     = "draft"
	DramaStatusRunning   = "running"
	DramaStatusPaused    = "paused"
	DramaStatusCompleted = "completed"

	DramaStageBible   = "bible"
	DramaStageProduce = "produce"
	DramaStageDone    = "done"

	// 单集阶段：剧本 → 撰写各剧情段完整视频提示词 →（确认）→ 按段顺序生成视频 → 合成成片。
	DramaEpisodeQueued  = "queued"
	DramaEpisodeScript  = "script"
	DramaEpisodePrompts = "prompts"
	DramaEpisodeReview  = "review"
	DramaEpisodeVideo   = "video"
	DramaEpisodeRender  = "render"
	DramaEpisodeDone    = "done"

	// 单集素材类型：小说原文需要改编；剧本与分镜是用户写好的内容，只拆镜或转录，台词逐字保留。
	DramaSourceNovel      = "novel"
	DramaSourceScript     = "script"
	DramaSourceStoryboard = "storyboard"

	// 媒体槽位状态：空串表示尚未开始。
	DramaMediaQueued  = "queued"
	DramaMediaRunning = "running"
	DramaMediaReady   = "ready"
	DramaMediaFailed  = "failed"
	DramaMediaStale   = "stale"
	DramaMediaSkipped = "skipped"

	DramaJobQueued    = "queued"
	DramaJobRunning   = "running"
	DramaJobSucceeded = "succeeded"
	DramaJobFailed    = "failed"
	DramaJobCanceled  = "canceled"

	DramaJobBible     = "bible"
	DramaJobPlan      = "plan"
	DramaJobCastImage = "cast_image"
	DramaJobScript    = "script"
	DramaJobRender    = "render"
	// DramaJobSegmentPrompt 为一个剧情段撰写完整视频提示词；ShotID 存放 drama_segments.id。
	DramaJobSegmentPrompt = "segment_prompt"
	// DramaJobSegmentVideo 为一个剧情段生成整段视频；ShotID 存放 drama_segments.id。
	DramaJobSegmentVideo = "segment_video"
)

// DramaProduction 是一个项目的自动制作控制面，项目内唯一。
type DramaProduction struct {
	ProjectID          string `json:"projectId" gorm:"primaryKey;size:36"`
	UserID             string `json:"userId" gorm:"index;size:36"`
	Status             string `json:"status" gorm:"index;size:24"`
	Stage              string `json:"stage" gorm:"size:24"`
	SettingsJSON       string `json:"settingsJson" gorm:"type:text"`
	BibleJSON          string `json:"bibleJson" gorm:"type:text"`
	BudgetMicrocredits int64  `json:"budgetMicrocredits"`
	SpentMicrocredits  int64  `json:"spentMicrocredits"`
	PlanCursor         int    `json:"planCursor"`
	PlanDone           bool   `json:"planDone"`
	SampleApproved     bool   `json:"sampleApproved"`
	// AssetsReleased 为 true 后才自动生成角色/场景参考图；手动生图模式下由用户确认资产后打开。
	AssetsReleased bool       `json:"assetsReleased"`
	PauseReason    string     `json:"pauseReason" gorm:"size:500"`
	Revision       int64      `json:"revision"`
	LastTickAt     *time.Time `json:"lastTickAt,omitempty"`
	CreatedAt      time.Time  `json:"createdAt"`
	UpdatedAt      time.Time  `json:"updatedAt"`
}

// DramaCast 是全剧设定（角色 / 场景），镜头引用它的参考图保持一致性。
type DramaCast struct {
	Revision    int64  `json:"revision"`
	ID          string `json:"id" gorm:"primaryKey;size:36"`
	ProjectID   string `json:"projectId" gorm:"index;size:36;index:idx_drama_casts_project_kind,priority:1"`
	Kind        string `json:"kind" gorm:"size:16;index:idx_drama_casts_project_kind,priority:2"`
	Name        string `json:"name" gorm:"size:120"`
	AliasesJSON string `json:"aliasesJson" gorm:"type:text"`
	Role        string `json:"role" gorm:"size:120"`
	Description string `json:"description" gorm:"type:text"`
	Appearance  string `json:"appearance" gorm:"type:text"`
	// VoiceInstructions 是声线描述（音色、语速、情绪），写进视频提示词，由视频模型同步生成对白。
	VoiceInstructions string    `json:"voiceInstructions" gorm:"type:text"`
	Importance        int       `json:"importance"`
	ImageResourceID   string    `json:"imageResourceId,omitempty" gorm:"size:36"`
	ImageStatus       string    `json:"imageStatus" gorm:"size:16"`
	ImageVersion      int       `json:"imageVersion"`
	Locked            bool      `json:"locked"`
	Position          int       `json:"position"`
	CreatedAt         time.Time `json:"createdAt"`
	UpdatedAt         time.Time `json:"updatedAt"`
}

type DramaEpisode struct {
	ID             string `json:"id" gorm:"primaryKey;size:36"`
	ProjectID      string `json:"projectId" gorm:"size:36;uniqueIndex:idx_drama_episodes_project_number,priority:1"`
	Number         int    `json:"number" gorm:"uniqueIndex:idx_drama_episodes_project_number,priority:2"`
	Title          string `json:"title" gorm:"size:240"`
	Synopsis       string `json:"synopsis" gorm:"type:text"`
	Hook           string `json:"hook" gorm:"type:text"`
	Cliffhanger    string `json:"cliffhanger" gorm:"type:text"`
	ChapterIDsJSON string `json:"chapterIdsJson" gorm:"type:text"`
	// SourceFormat 是本集原文的素材类型（novel / script / storyboard），空串按小说处理。
	SourceFormat string `json:"sourceFormat" gorm:"size:16"`
	Stage        string `json:"stage" gorm:"index;size:16"`
	Error        string `json:"error" gorm:"type:text"`
	ShotCount    int    `json:"shotCount"`
	DurationMs   int64  `json:"durationMs"`
	// Approved 表示用户已确认本集视频提示词（逐集确认模式下的审阅关口）。
	Approved bool `json:"approved"`
	// MediaReleased 为 true 后才为本集生成视频；手动模式下由用户确认剧本与提示词后打开。
	MediaReleased   bool      `json:"mediaReleased"`
	FinalResourceID string    `json:"finalResourceId,omitempty" gorm:"size:36"`
	FinalStale      bool      `json:"finalStale"`
	SubtitleSRT     string    `json:"subtitleSrt" gorm:"type:text"`
	Revision        int64     `json:"revision"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

// DramaShot 保存镜头脚本，作为剧情段视频提示词的素材。
type DramaShot struct {
	ID        string `json:"id" gorm:"primaryKey;size:36"`
	ProjectID string `json:"projectId" gorm:"index;size:36"`
	EpisodeID string `json:"episodeId" gorm:"size:36;index:idx_drama_shots_episode_position,priority:1"`
	Position  int    `json:"position" gorm:"index:idx_drama_shots_episode_position,priority:2"`
	// SegmentIndex/SegmentTitle 把一集切成剧情段；一段总时长不超过视频模型单次上限，一段生成一个视频。
	SegmentIndex int    `json:"segmentIndex"`
	SegmentTitle string `json:"segmentTitle" gorm:"size:240"`
	Scene        string `json:"scene" gorm:"size:240"`
	SceneCastID  string `json:"sceneCastId,omitempty" gorm:"size:36"`
	CastIDsJSON  string `json:"castIdsJson" gorm:"type:text"`
	// PropIDsJSON 是画面里出现的关键道具设定（DramaCast kind=prop）。
	PropIDsJSON string `json:"propIdsJson" gorm:"type:text"`
	Speaker     string `json:"speaker" gorm:"size:120"`
	Dialogue    string `json:"dialogue" gorm:"type:text"`
	Action      string `json:"action" gorm:"type:text"`
	ShotSize    string `json:"shotSize" gorm:"size:40"`
	Camera      string `json:"camera" gorm:"size:80"`
	// Transition 是进入本镜头的转场：cut / fadeblack / fadewhite；作品统一指定时以作品设置为准。
	Transition string `json:"transition" gorm:"size:16"`
	DurationMs int64  `json:"durationMs"`
	// ImagePrompt 是本镜起幅画面描述，VideoPrompt 是镜头内的动作与运镜描述。
	ImagePrompt string    `json:"imagePrompt" gorm:"type:text"`
	VideoPrompt string    `json:"videoPrompt" gorm:"type:text"`
	SourceQuote string    `json:"sourceQuote" gorm:"type:text"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// DramaSegment 是视频生成单位：一段一次调用视频模型，台词、音效与镜头切换都由视频模型在一个视频里完成。
// 段由镜头的 SegmentIndex 决定，重新改编剧本时随镜头一起重建。
type DramaSegment struct {
	PromptSeconds int    `json:"promptSeconds"`
	Revision      int64  `json:"revision"`
	ID            string `json:"id" gorm:"primaryKey;size:36"`
	ProjectID     string `json:"projectId" gorm:"index;size:36"`
	EpisodeID     string `json:"episodeId" gorm:"size:36;uniqueIndex:idx_drama_segments_episode_index,priority:1"`
	SegmentIndex  int    `json:"segmentIndex" gorm:"uniqueIndex:idx_drama_segments_episode_index,priority:2"`
	// VideoPrompt 是文本模型按镜头表撰写的完整视频提示词；PromptStatus 为空表示待撰写。
	VideoPrompt  string `json:"videoPrompt" gorm:"type:text"`
	PromptStatus string `json:"promptStatus" gorm:"size:16;index"`
	PromptError  string `json:"promptError" gorm:"type:text"`
	// VideoPromptOverride 是用户改写的完整视频提示词；非空时优先于模型撰写的版本。
	VideoPromptOverride string `json:"videoPromptOverride" gorm:"type:text"`
	// VideoModelJSON 为空时使用全剧默认视频模型。
	VideoModelJSON string `json:"videoModelJson" gorm:"type:text"`
	// ReferenceCastIDsJSON 为空表示按镜头自动取参考图；非空是用户为本段指定的设定 ID 列表（顺序即参考图编号，可为 []）。
	ReferenceCastIDsJSON string `json:"referenceCastIdsJson" gorm:"type:text"`
	// VideoStatus 为空表示待生成；TailFrameResourceID 是本段视频最后一帧，作为下一段的参考图，保证段与段衔接。
	VideoStatus         string    `json:"videoStatus" gorm:"size:16"`
	VideoResourceID     string    `json:"videoResourceId,omitempty" gorm:"size:36"`
	TailFrameResourceID string    `json:"tailFrameResourceId,omitempty" gorm:"size:36"`
	VideoSeconds        int       `json:"videoSeconds"`
	VideoError          string    `json:"videoError" gorm:"type:text"`
	CreatedAt           time.Time `json:"createdAt"`
	UpdatedAt           time.Time `json:"updatedAt"`
}

// DramaTake 保存每个产物的全部版本：角色/场景参考图（cast）、剧情段视频（video）与成片（final）。
type DramaTake struct {
	ID         string    `json:"id" gorm:"primaryKey;size:36"`
	ProjectID  string    `json:"projectId" gorm:"index;size:36"`
	OwnerID    string    `json:"ownerId" gorm:"size:36;index:idx_drama_takes_owner_kind,priority:1"`
	Kind       string    `json:"kind" gorm:"size:16;index:idx_drama_takes_owner_kind,priority:2"`
	Version    int       `json:"version"`
	ResourceID string    `json:"resourceId" gorm:"size:36"`
	TaskID     string    `json:"taskId" gorm:"size:36"`
	Prompt     string    `json:"prompt" gorm:"type:text"`
	DurationMs int64     `json:"durationMs"`
	CreatedAt  time.Time `json:"createdAt"`
}

// DramaJob 是调度队列中的一项工作；任务创建延迟到派发时，保证使用最新数据。
type DramaJob struct {
	ID          string `json:"id" gorm:"primaryKey;size:36"`
	ProjectID   string `json:"projectId" gorm:"size:36;index:idx_drama_jobs_project_status,priority:1"`
	Status      string `json:"status" gorm:"size:16;index:idx_drama_jobs_project_status,priority:2"`
	Kind        string `json:"kind" gorm:"size:16"`
	EpisodeID   string `json:"episodeId,omitempty" gorm:"index;size:36"`
	ShotID      string `json:"shotId,omitempty" gorm:"index;size:36"`
	CastID      string `json:"castId,omitempty" gorm:"size:36"`
	TaskID      string `json:"taskId,omitempty" gorm:"index;size:36"`
	Priority    int    `json:"priority"`
	Attempt     int    `json:"attempt"`
	Label       string `json:"label" gorm:"size:240"`
	PayloadJSON string `json:"-" gorm:"type:text"`
	// AttemptsJSON 记录每次提交过的任务（重试会清空 TaskID），用于在队列里回看历次请求。
	AttemptsJSON     string     `json:"-" gorm:"type:text"`
	Error            string     `json:"error" gorm:"type:text"`
	CostMicrocredits int64      `json:"costMicrocredits"`
	StartedAt        *time.Time `json:"startedAt,omitempty"`
	FinishedAt       *time.Time `json:"finishedAt,omitempty"`
	CreatedAt        time.Time  `json:"createdAt"`
	UpdatedAt        time.Time  `json:"updatedAt"`
}
