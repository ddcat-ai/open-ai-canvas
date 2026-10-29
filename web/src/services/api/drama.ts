import { compactApiParams, http } from "@/services/api/request";
import type { Project } from "@/services/api/projects";

// 短剧自动制作：章节只承载小说原文，集是剧本、分镜与成片的基石。编排全部在服务端完成。

export type DramaModelChoice = {
    logicalModelId?: string;
    channelId?: string;
    modelKey?: string;
    label?: string;
    priceLabel?: string;
};

export type DramaCapability = "text" | "image" | "video";

export type DramaModels = Record<DramaCapability, DramaModelChoice>;

export type DramaReviewMode = "sample" | "every" | "auto";

/** manual：先只跑剧本、分镜、设定与视频提示词，确认后手动开始生成参考图与视频；auto：一路跑到成片。 */
export type DramaMediaMode = "manual" | "auto";

export type DramaAssetMode = "portrait" | "turnaround" | "fourview" | "custom";

/** 角色/场景参考图方案：保存的是全文提示词，用户看到的就是实际发送的内容。道具参考图使用固定模板。 */
export type DramaAssetSettings = {
    mode: DramaAssetMode;
    characterPrompt: string;
    scenePrompt: string;
    characterRatio: string;
    /** 参考图分辨率档位（1k / 1.5k / 2k / 4k）；空串或缺省按图片模型默认档位。 */
    resolution?: string;
    sourceSkillId?: string;
    sourceSkillName?: string;
    sourcePath?: string;
};

export type DramaAssetScheme = {
    mode: Exclude<DramaAssetMode, "custom">;
    name: string;
    description: string;
    ratio: string;
    frameHint: string;
    characterPrompt: string;
};

export type DramaAssetSchemeCatalog = { schemes: DramaAssetScheme[]; scenePrompt: string; characterVariables: string[]; sceneVariables: string[] };

/** 剧情段怎么切：智能按场景与冲突切、单段不超过模型上限；固定每段 segmentSeconds 秒；范围在 segmentMin–MaxSeconds 之间。 */
export type DramaSegmentMode = "auto" | "fixed" | "range";

/**
 * 分镜规则：剧情段（一次视频调用）怎么切、镜头节奏、对白密度与转场。
 * 剧本提示词、镜头时长、剧情段切分与成片渲染共用；三种切段模式的数值都保留，切换模式不丢值。
 */
export type DramaStoryboardSettings = {
    segmentMode: DramaSegmentMode;
    segmentSeconds: number;
    segmentMinSeconds: number;
    segmentMaxSeconds: number;
    pacing: "fast" | "standard" | "slow";
    dialogue: "dense" | "standard" | "sparse";
    transition: "auto" | "cut" | "fadeblack" | "fadewhite";
    transitionMs: number;
};

/** 用户技能库里的一个技能文件，作为剧情段视频提示词的写作方法。 */
export type DramaSkillRef = { skillId: string; skillName: string; path: string };

export type DramaTransition = "cut" | "fadeblack" | "fadewhite";

export type DramaSettings = {
    aspectRatio: string;
    episodeSeconds: number;
    stylePrompt: string;
    styleName: string;
    language: string;
    assets: DramaAssetSettings;
    storyboard: DramaStoryboardSettings;
    /** 为空时按内置格式撰写段视频提示词。 */
    promptSkill?: DramaSkillRef;
    reviewMode: DramaReviewMode;
    mediaMode: DramaMediaMode;
    concurrency: number;
    models: DramaModels;
    /** 自动取参考图时每段最多发送的张数，0 为按视频模型上限；手动指定参考图的段只受模型上限约束。 */
    referenceLimit: number;
    /** 小说分集方式：chapter 每 chaptersPerEpisode 章一集，auto 由模型规划；空表示早期作品没有记录。分集完成后不能修改。 */
    episodeMode?: DramaEpisodeMode;
    chaptersPerEpisode?: number;
    /** 剧情段视频衔接方式；缺省按尾帧续接。 */
    videoContinuity?: DramaVideoContinuity;
};

/**
 * 剧情段视频衔接方式：tail_frame 第 2 段起用上一段最后一帧做首帧，同集各段按顺序生成；
 * parallel 每段只按角色/场景参考图独立生成，同集各段同时提交，适合按班次批量出片的渠道。
 */
export type DramaVideoContinuity = "tail_frame" | "parallel";

export type DramaStatus = "draft" | "running" | "paused" | "completed";

/** 单集素材类型：novel 小说需改编；script 剧本按原文拆镜；storyboard 分镜原样转录。剧本与分镜的台词逐字保留。 */
export type DramaSourceFormat = "novel" | "script" | "storyboard";

/** 分集方式：auto 由模型把小说章节规划成集；chapter 每章一集，适合逐集制作。 */
export type DramaEpisodeMode = "auto" | "chapter";

export type DramaEpisodeStage = "queued" | "script" | "prompts" | "review" | "video" | "render" | "done";

export type DramaMediaStatus = "" | "queued" | "running" | "ready" | "failed" | "stale" | "skipped";

export type DramaProductionView = {
    status: DramaStatus;
    stage: "bible" | "produce" | "done";
    pauseReason: string;
    settings: DramaSettings;
    budgetMicrocredits: number;
    /** 作品总花费：流水线任务加关联精修画布上的生成任务，预算按它判断。 */
    spentMicrocredits: number;
    /** 其中精修画布上的花费。 */
    canvasSpentMicrocredits: number;
    planDone: boolean;
    planCursor: number;
    sampleApproved: boolean;
    assetsReleased: boolean;
    logline: string;
    tone: string;
    chapterCount: number;
    wordCount: number;
};

/** 按剧情段统计的单集进度。 */
export type DramaEpisodeStats = { segments: number; promptReady: number; videoReady: number; failed: number };

export type DramaEpisodeRow = {
    id: string;
    number: number;
    title: string;
    synopsis: string;
    stage: DramaEpisodeStage;
    sourceFormat: DramaSourceFormat;
    error: string;
    shotCount: number;
    durationMs: number;
    approved: boolean;
    mediaReleased: boolean;
    awaitingMedia: boolean;
    finalResourceId?: string;
    finalStale: boolean;
    stats: DramaEpisodeStats;
};

export type DramaInboxItem = {
    id: string;
    kind: "media_ready" | "review" | "episode_error" | "paused" | "cast_failed" | "segment_failed";
    severity: "info" | "warning" | "error";
    title: string;
    detail: string;
    episodeId?: string;
    castId?: string;
    castKind?: DramaCastKind;
    episodeNumber?: number;
    segmentIndex: number;
    media?: "prompt" | "video";
};

export type DramaSummary = {
    project: Project;
    production: DramaProductionView;
    episodes: DramaEpisodeRow[];
    jobCounts: Partial<Record<"queued" | "running" | "succeeded" | "failed" | "canceled", number>>;
    inbox: DramaInboxItem[];
    castCount: number;
};

export type DramaShot = {
    id: string;
    projectId: string;
    episodeId: string;
    position: number;
    segmentIndex: number;
    segmentTitle: string;
    scene: string;
    sceneCastId?: string;
    castIdsJson: string;
    propIdsJson: string;
    speaker: string;
    dialogue: string;
    action: string;
    shotSize: string;
    camera: string;
    transition: DramaTransition | "";
    durationMs: number;
    imagePrompt: string;
    videoPrompt: string;
    sourceQuote: string;
};

export type DramaEpisode = {
    id: string;
    projectId: string;
    number: number;
    title: string;
    synopsis: string;
    hook: string;
    cliffhanger: string;
    chapterIdsJson: string;
    /** 旧集为空串，按小说处理。 */
    sourceFormat: DramaSourceFormat | "";
    stage: DramaEpisodeStage;
    error: string;
    shotCount: number;
    durationMs: number;
    approved: boolean;
    finalResourceId?: string;
    finalStale: boolean;
    subtitleSrt: string;
    revision: number;
};

export type DramaJob = {
    id: string;
    kind: "bible" | "plan" | "cast_image" | "script" | "segment_prompt" | "segment_video" | "render";
    status: "queued" | "running" | "succeeded" | "failed" | "canceled";
    label: string;
    error?: string;
    episodeId?: string;
    shotId?: string;
    taskId?: string;
    costMicrocredits: number;
    attempt: number;
    createdAt: string;
    startedAt?: string;
    finishedAt?: string;
    updatedAt: string;
    /** 生成中任务的上游进度文案（如“候车 · 前面 3 条”），上游已接收任务时才有。 */
    providerStage?: string;
};

export type DramaJobTask = {
    id: string;
    status: string;
    stage?: string;
    operation?: string;
    model: string;
    modelLabel: string;
    prompt: string;
    params: Record<string, string>;
    error?: string;
    mediaStage?: string;
    createdAt: string;
    startedAt?: string;
    completedAt?: string;
    resultMode?: string;
    resultText?: string;
    resourceIds?: string[];
};

export type DramaJobAttempt = { taskId?: string; status: string; error?: string; costMicrocredits: number; at: string; task?: DramaJobTask };

export type DramaJobDetail = { job: DramaJob; target: string; attempts: DramaJobAttempt[] };

export type DramaChapterRef = { id: string; title: string; position: number; wordCount: number };

export type DramaEpisodeDetail = {
    episode: DramaEpisode;
    shots: DramaShot[];
    /** 剧情段是视频生成单位：一段一次调用视频模型，对白与音效由视频模型生成。 */
    segments: DramaSegment[];
    chapters: DramaChapterRef[];
    jobs: DramaJob[];
    scriptJob?: DramaJob;
    /** 原文台词与镜头台词的逐句核对；章节被多集共用或还没有镜头时不提供。 */
    dialogueCheck?: DramaDialogueCheck;
};

/** missing 是没有逐字出现在镜头台词里的原文台词（被删或被改写），最多 30 句；missingCount 是总数。 */
export type DramaDialogueCheck = { sourceLines: number; missingCount: number; missing: string[] };

/** 剧情段视频提示词的撰写状态：none 无记录、stale 镜头或设定改过后过期。 */
export type DramaSegmentPromptStatus = "none" | "queued" | "running" | "ready" | "stale" | "failed";

/** 一个剧情段；videoPrompt 为生效内容（手动改写优先），generated 为模型撰写的版本。 */
export type DramaSegment = {
    id: string;
    /** 段版本；从画布采用视频时用于乐观并发校验。 */
    revision: number;
    index: number;
    title: string;
    shotIds: string[];
    durationMs: number;
    videoPrompt: string;
    generated: string;
    custom: boolean;
    promptStatus: DramaSegmentPromptStatus;
    promptError?: string;
    videoStatus: DramaMediaStatus;
    videoResourceId?: string;
    tailFrameResourceId?: string;
    /** 当前视频进入成片的秒数，与成片时间线一致。 */
    videoSeconds?: number;
    videoError?: string;
    /** 视频已生成，只是后处理（如抽尾帧）失败；可重新处理已有视频，不重新生成。 */
    videoReprocessable?: boolean;
    videoModel: DramaModelChoice;
    /** auto 按本段镜头自动取参考图；custom 为手动指定（顺序即参考图编号）。 */
    referenceMode: "auto" | "custom";
    request: DramaSegmentRequest;
    promptJob?: DramaJob;
    videoJob?: DramaJob;
    /** 视频已请求但尚未提交时，调度实际卡住的原因（等待上一段、参考图、放行或制作暂停）。 */
    videoWait?: string;
};

/** 参考图编号与提交顺序一致；sent=false 表示未就绪或超过模型上限，不随请求发送。 */
export type DramaSegmentReference = { castId: string; label: string; kind: DramaCastKind; name: string; resourceId?: string; sent: boolean };

/**
 * 生成本段视频时实际发送的内容，与提交同一函数计算。
 * operation：image_to_video（上一段最后一帧作首帧）、reference_to_video（参考图）、text_to_video。
 * firstFramePending：上一段视频还没生成，本段要等它完成后才能提交。
 */
export type DramaSegmentRequest = {
    operation: "image_to_video" | "reference_to_video" | "text_to_video" | "";
    seconds: number;
    maxVideoSeconds: number;
    firstFrameResourceId?: string;
    firstFramePending: boolean;
    references: DramaSegmentReference[];
    /** 本段最多随请求发送的参考图张数（已扣除首帧并受每段上限约束）；modelMaxImages 是模型声明的图片上限。 */
    referenceCapacity: number;
    modelMaxImages: number;
    /** 有参考图因“每段最多参考图”设置而未发送。 */
    referenceLimited?: boolean;
    header: string;
    warning?: string;
    /** 提示词正文里不属于本段的“参考图N”；存在时服务端拒绝生成视频。 */
    unknownReferences?: string[];
};

export type DramaCastKind = "character" | "prop" | "scene";

export type DramaCast = {
    id: string;
    projectId: string;
    kind: DramaCastKind;
    name: string;
    aliasesJson: string;
    role: string;
    description: string;
    appearance: string;
    voiceInstructions: string;
    importance: number;
    imageResourceId?: string;
    imageStatus: DramaMediaStatus;
    imageVersion: number;
    locked: boolean;
    position: number;
};

export type DramaListItem = {
    project: Project;
    status: DramaStatus;
    stage: string;
    pauseReason: string;
    episodeCount: number;
    doneCount: number;
    coverResourceId?: string;
    coverResourceIds?: string[];
    aspectRatio: string;
    styleName?: string;
    spentMicrocredits: number;
    updatedAt: string;
};

export type DramaListPage = { items: DramaListItem[]; page: number; pageSize: number; total: number; hasMore: boolean; statusCounts: Partial<Record<DramaStatus | "all", number>> };

/**
 * imageResolutions / defaultImageResolution / imageRatios 仅图片模型：可指定的参考图分辨率档位、默认档位，
 * 以及能按默认档位准确出图的参考图画幅（给不出的画幅会被服务端拒绝，而不是悄悄出方图）。
 */
export type DramaModelOption = {
    choice: DramaModelChoice;
    capability: DramaCapability;
    label: string;
    priceLabel: string;
    maxVideoSeconds?: number;
    /** 仅视频模型：支持图生视频，可用于尾帧续接；为 false 时只能并行出片。 */
    tailFrameChain?: boolean;
    imageResolutions?: string[];
    defaultImageResolution?: string;
    imageRatios?: string[];
};

/** 平台目录里有、但短剧流水线无法使用的模型及原因；前端置灰展示。 */
export type DramaModelUnavailable = { choice: DramaModelChoice; reason: string };

export type DramaModelCatalog = { defaults: DramaModels; options: Record<DramaCapability, DramaModelOption[]>; unavailable?: Partial<Record<DramaCapability, DramaModelUnavailable[]>> };

export type DramaEstimate = {
    episodes: number;
    shots: number;
    images: number;
    videos: number;
    textCalls: number;
    minMicrocredits: number;
    maxMicrocredits: number;
    sampleMicrocredits: number;
    priced: boolean;
    note: string;
    durationMinutes: number;
};

export type CreateDramaInput = {
    name: string;
    chapters: Array<{ title: string; text: string }>;
    settings: Partial<DramaSettings>;
    budgetMicrocredits: number;
    start: boolean;
    sourceFormat: DramaSourceFormat;
    /** 剧本与分镜总是每章一集，服务端忽略 auto。 */
    episodeMode: DramaEpisodeMode;
};

const base = (projectId: string) => `/dramas/${encodeURIComponent(projectId)}`;

export function listDramas(params: { page: number; pageSize: number; q?: string; status?: DramaStatus }, signal?: AbortSignal) {
    return http.get<DramaListPage>("/dramas", { params: compactApiParams(params), signal });
}

export function getDramaAssetSchemes() {
    return http.get<DramaAssetSchemeCatalog>("/dramas/asset-schemes");
}

export function getDramaModels() {
    return http.get<DramaModelCatalog>("/dramas/models");
}

export function estimateDrama(input: { chapterCount: number; wordCount: number; settings: Partial<DramaSettings>; episodeMode?: DramaEpisodeMode }, signal?: AbortSignal) {
    return http.post<DramaEstimate>("/dramas/estimate", input, { signal });
}

export function createDrama(input: CreateDramaInput) {
    return http.post<DramaSummary>("/dramas", input, { timeout: 120_000 });
}

export function deleteDrama(projectId: string) {
    return http.delete<{ deleted: boolean }>(base(projectId));
}

export function getDrama(projectId: string, signal?: AbortSignal) {
    return http.get<DramaSummary>(base(projectId), { signal });
}

export function updateDramaSettings(projectId: string, input: { settings?: DramaSettings; budgetMicrocredits?: number }) {
    return http.patch<DramaSummary>(`${base(projectId)}/settings`, input);
}

export function startDrama(projectId: string) {
    return http.post<DramaSummary>(`${base(projectId)}/start`);
}

export function pauseDrama(projectId: string) {
    return http.post<DramaSummary>(`${base(projectId)}/pause`);
}

export function retryFailedDrama(projectId: string) {
    return http.post<{ segments: number; casts: number }>(`${base(projectId)}/retry-failed`);
}

export function listDramaJobs(projectId: string, limit = 60, signal?: AbortSignal) {
    return http.get<{ jobs: DramaJob[] }>(`${base(projectId)}/jobs`, { params: { limit }, signal });
}

export function getDramaJob(projectId: string, jobId: string, signal?: AbortSignal) {
    return http.get<DramaJobDetail>(`${base(projectId)}/jobs/${encodeURIComponent(jobId)}`, { signal });
}

export function getDramaChapter(projectId: string, chapterId: string, signal?: AbortSignal) {
    return http.get<{ chapter: { id: string; title: string; sourceText: string; wordCount: number; position: number } }>(`${base(projectId)}/chapters/${encodeURIComponent(chapterId)}`, { signal });
}

export function getDramaEpisode(projectId: string, episodeId: string, signal?: AbortSignal) {
    return http.get<DramaEpisodeDetail>(`${base(projectId)}/episodes/${encodeURIComponent(episodeId)}`, { signal });
}

export function updateDramaEpisode(projectId: string, episodeId: string, patch: { title?: string; sourceFormat?: DramaSourceFormat }) {
    return http.patch<{ episode: DramaEpisode }>(`${base(projectId)}/episodes/${encodeURIComponent(episodeId)}`, patch);
}

export function renameDramaEpisode(projectId: string, episodeId: string, title: string) {
    return updateDramaEpisode(projectId, episodeId, { title });
}

/** 在作品末尾追加一集：原文直接成为新的一集，单集最多 1.2 万字。 */
export function addDramaEpisode(projectId: string, input: { title: string; text: string; sourceFormat: DramaSourceFormat }) {
    return http.post<DramaEpisodeDetail>(`${base(projectId)}/episodes`, input, { timeout: 60_000 });
}

/** 修改原文；已写好的剧本不会自动重写，需要再点重新改编。 */
export function updateDramaChapter(projectId: string, chapterId: string, patch: { title?: string; text?: string }) {
    return http.patch<{ chapter: { id: string; title: string; sourceText: string; wordCount: number; position: number } }>(`${base(projectId)}/chapters/${encodeURIComponent(chapterId)}`, patch);
}

/** 在镜头前或后插入一个空镜头，归入同一剧情段。 */
export function insertDramaShot(projectId: string, shotId: string, position: "before" | "after") {
    return http.post<{ shot: DramaShot }>(`${base(projectId)}/shots/${encodeURIComponent(shotId)}/insert`, { position });
}

export function deleteDramaShot(projectId: string, shotId: string) {
    return http.delete<{ deleted: boolean }>(`${base(projectId)}/shots/${encodeURIComponent(shotId)}`);
}

export function approveDramaEpisode(projectId: string, episodeId: string) {
    return http.post<DramaEpisodeDetail>(`${base(projectId)}/episodes/${encodeURIComponent(episodeId)}/approve`);
}

export function rescriptDramaEpisode(projectId: string, episodeId: string) {
    return http.post<DramaEpisodeDetail>(`${base(projectId)}/episodes/${encodeURIComponent(episodeId)}/rescript`);
}

export type DramaShotPatch = Partial<Pick<DramaShot, "speaker" | "dialogue" | "action" | "shotSize" | "camera" | "imagePrompt" | "videoPrompt">> & { transition?: DramaTransition; durationSeconds?: number };

/** 让文本模型（重新）撰写指定剧情段的完整视频提示词。 */
export function writeDramaSegmentPrompts(projectId: string, episodeId: string, segments: number[]) {
    return http.post<{ queued: number }>(`${base(projectId)}/episodes/${encodeURIComponent(episodeId)}/segments/prompts`, { segments });
}

/** 保存整段视频提示词改写；传空串恢复为模型撰写的版本。 */
export function updateDramaSegment(projectId: string, episodeId: string, index: number, videoPromptOverride: string) {
    return http.patch<{ saved: boolean }>(`${base(projectId)}/episodes/${encodeURIComponent(episodeId)}/segments/${index}`, { videoPromptOverride });
}

/** 指定本段参考图（顺序即编号，空数组表示不发参考图）；传 null 恢复按镜头自动取。模型撰写的提示词会标记过期。 */
export function updateDramaSegmentReferences(projectId: string, episodeId: string, index: number, castIds: string[] | null) {
    return http.patch<{ saved: boolean }>(`${base(projectId)}/episodes/${encodeURIComponent(episodeId)}/segments/${index}`, castIds ? { referenceCastIds: castIds } : { autoReferences: true });
}

export function updateDramaShot(projectId: string, shotId: string, patch: DramaShotPatch) {
    return http.patch<{ shot: DramaShot }>(`${base(projectId)}/shots/${encodeURIComponent(shotId)}`, patch);
}

export function listDramaCast(projectId: string, signal?: AbortSignal) {
    return http.get<{ cast: DramaCast[] }>(`${base(projectId)}/cast`, { signal });
}

export type DramaCastPatch = Partial<Pick<DramaCast, "name" | "appearance" | "description" | "voiceInstructions" | "locked">> & { aliases?: string[] };

export function updateDramaCast(projectId: string, castId: string, patch: DramaCastPatch) {
    return http.patch<{ cast: DramaCast }>(`${base(projectId)}/cast/${encodeURIComponent(castId)}`, patch);
}

/**
 * 用已上传或画布采用的图片资源替换参考图并锁定；restyleSegments=true 时引用它的剧情段视频标记过期。
 * origin.source=canvas 时版本记录标为“来自画布”，taskId 是产出这张图的画布生成任务（可省略）。
 */
export function setDramaCastImage(projectId: string, castId: string, resourceId: string, restyleSegments: boolean, origin?: { source: "canvas"; taskId?: string }) {
    return http.put<{ cast: DramaCast; affectedSegments: number; unchanged?: boolean }>(`${base(projectId)}/cast/${encodeURIComponent(castId)}/image`, {
        resourceId,
        restyleSegments,
        ...(origin ? { source: origin.source, taskId: origin.taskId || "" } : {}),
    });
}

export function getDramaCastImpact(projectId: string, castId: string, signal?: AbortSignal) {
    return http.get<{ segments: number; episodes: number }>(`${base(projectId)}/cast/${encodeURIComponent(castId)}/impact`, { signal });
}

/** restyleSegments=true 时引用该设定的剧情段视频标记过期，需要重新生成；段提示词保持不变。 */
export function regenerateDramaCast(projectId: string, castId: string, restyleSegments: boolean) {
    return http.post<{ affectedSegments: number }>(`${base(projectId)}/cast/${encodeURIComponent(castId)}/regenerate`, { restyleSegments });
}

/** 重新处理已生成但后处理失败的段视频：重放原任务结果，不重新生成、不扣费。 */
export function reprocessDramaSegmentVideo(projectId: string, episodeId: string, segmentIndex: number) {
    return http.post<{ reprocessing: boolean }>(`${base(projectId)}/episodes/${encodeURIComponent(episodeId)}/segments/${segmentIndex}/reprocess`);
}

/** 按剧情段生成视频；段会按顺序提交，第 2 段起等上一段最后一帧。可同时换视频模型。 */
export function generateDramaSegments(projectId: string, episodeId: string, segments: number[], videoModel?: DramaModelChoice) {
    return http.post<{ queued: number }>(`${base(projectId)}/episodes/${encodeURIComponent(episodeId)}/segments/generate`, { segments, ...(videoModel ? { videoModel } : {}) });
}

export function regenerateDramaCasts(projectId: string, kind: DramaCastKind, restyleSegments: boolean) {
    return http.post<{ queued: number; skipped: number; affectedSegments: number }>(`${base(projectId)}/cast/regenerate-all`, { kind, restyleSegments });
}

/** 手动模式下放行生成：assets 只生成参考图，episodes 生成指定集的参考图与段视频，all 全部开始。 */
export function releaseDramaMedia(projectId: string, target: "assets" | "episodes" | "all", episodeIds?: string[]) {
    return http.post<DramaSummary>(`${base(projectId)}/media/release`, { target, ...(episodeIds ? { episodeIds } : {}) });
}

// ===== 精修画布 =====

/** 服务端稳定原因：预算已用完（含画布精修），以及采用时剧情段刚被修改。 */
export const DRAMA_ERROR_REASON = { budgetExhausted: "drama_budget_exhausted", segmentChanged: "drama_segment_changed" } as const;

export type DramaTakeKind = "cast" | "video" | "final";
/** pipeline 流水线生成；upload 制作台上传；canvas 从精修画布采用。 */
export type DramaTakeSource = "pipeline" | "upload" | "canvas";

export type DramaTake = {
    id: string;
    ownerId: string;
    kind: DramaTakeKind;
    version: number;
    resourceId: string;
    taskId?: string;
    prompt: string;
    durationMs?: number;
    source: DramaTakeSource;
    current: boolean;
    createdAt: string;
};

export type DramaSegmentAdoptResult = {
    adopted: boolean;
    unchanged?: boolean;
    /** cascade 时重新排队的后续段数量。 */
    requeued: number;
    /** 制作暂停中：重新合成成片要等继续制作。 */
    paused: boolean;
    tailPending?: boolean;
    tailError?: string;
    videoError?: string;
    videoSeconds?: number;
    /** 后续段已排队，但恢复制作被拒（例如预算用完）。 */
    resumeError?: string;
};

/** 作品最近使用的精修画布；canvasId 为空表示还没有，由前端新建并关联。 */
export function getDramaCanvas(projectId: string, signal?: AbortSignal) {
    return http.get<{ canvasId: string; canvasCount: number }>(`${base(projectId)}/canvas`, { signal });
}

/** 为投送到画布的短剧媒体登记素材记录；同一资源只登记一次，返回资源到素材的对应关系。不存在或未就绪的资源不在结果里。 */
export function registerDramaCanvasAssets(projectId: string, resources: Array<{ resourceId: string; title?: string; category?: string }>) {
    return http.post<{ assets: Array<{ resourceId: string; assetId: string }> }>(`${base(projectId)}/canvas-assets`, { resources });
}

export function listDramaTakes(projectId: string, ownerId: string, kind: DramaTakeKind, signal?: AbortSignal) {
    return http.get<{ takes: DramaTake[]; currentResourceId: string }>(`${base(projectId)}/takes`, { params: { ownerId, kind }, signal });
}

/** 把画布视频采用为剧情段当前视频；默认只换本段，cascade 时后续已生成的段重新排队生成。 */
export function adoptDramaSegmentVideo(projectId: string, episodeId: string, segmentIndex: number, input: { resourceId: string; taskId?: string; cascade: boolean; expectedRevision?: number }) {
    return http.put<DramaSegmentAdoptResult>(`${base(projectId)}/episodes/${encodeURIComponent(episodeId)}/segments/${segmentIndex}/video`, input, { timeout: 300_000 });
}
