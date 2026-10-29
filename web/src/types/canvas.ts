import type { CanvasColorGrade } from "@/lib/canvas/canvas-color-grade";
import type { MediaConversionNodeState } from "@/lib/media-conversion/contracts";
import type { AssetCategory } from "@/lib/asset-category";
import type { PortraitTextureSettings } from "@/lib/canvas/canvas-portrait-texture";
import type { StyleExecutionPlan } from "@/lib/canvas/style-profile";
import type { ArtCritiqueNodeState } from "@/lib/art-critique/contracts";
import type { CameraControlOptions } from "@/lib/canvas/camera-prompt-library";
import type { SrtEntry, SubtitleHighlight, SubtitleStyle } from "@/types/timeline";
import type { GenerationSpec } from "@/lib/canvas/generation-contract.generated";
import type { GenerationTask } from "@/services/api/task-center";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

export type Position = {
    x: number;
    y: number;
};

export type ViewportTransform = {
    x: number;
    y: number;
    k: number;
};

export enum CanvasNodeType {
    Image = "image",
    Text = "text",
    Drawing = "drawing",
    Script = "script",
    Skill = "skill",
    Config = "config",
    Video = "video",
    Audio = "audio",
    Frame = "frame",
    Markdown = "markdown",
    Svg = "svg",
    Html = "html",
    Panorama = "panorama",
    Compare = "compare",
    Chart = "chart",
    ColorGrade = "colorgrade",
    MediaConversion = "media-conversion",
    BatchTable = "batch-table",
}

/** Runtime IDs contributed by plugins share the persisted node type field. */
export type PluginCanvasNodeType = string & { readonly __pluginCanvasNodeType?: unique symbol };
export type CanvasNodeTypeId = CanvasNodeType | PluginCanvasNodeType;

export function isBuiltinCanvasNodeType(type: CanvasNodeTypeId): type is CanvasNodeType {
    return Object.values(CanvasNodeType).includes(type as CanvasNodeType);
}

export type CanvasNodeStatus = "idle" | "success" | "loading" | "error";
export type CanvasWorkspaceMode = "simple" | "professional";
export type CanvasToolMode = "move" | "box-select";
export type CanvasFolderStyle = "glass" | "stacked" | "midnight" | "paper" | "cinema" | "compact";
export type CanvasFolderTheme = "aurora" | "obsidian" | "ember" | "pearl";
export type StoryboardShotDuration = "auto" | "5" | "10" | "15" | "30";
export type StoryboardShotCount = "auto" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10";
export type StoryboardVideoInputMode = "direct" | "keyframe";
export type CanvasGenerationMode = "text" | "image" | "video" | "audio";
export type CanvasGenerationBatchMode = "storyboard_image" | "storyboard_video" | "action_board" | "batch_image";
export type CanvasGenerationBatchStatus = "queued" | "running" | "partial_failed" | "completed" | "cancelled";
export type CanvasGenerationBatchItemStatus = "waiting" | "submitting" | "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type CanvasImageGenerationType = "generation" | "edit";
export type CanvasWorkflowKind = "free" | "script" | "story_input" | "character" | "scene" | "storyboard" | "shot" | "final" | "styleboard" | "reference_set" | "reference_video" | "action_board";
export type CanvasVideoEditOperation = "text_to_video" | "image_to_video" | "reference_to_video" | "extend" | "inpaint" | "replace_element" | "camera_motion" | "style_transfer" | "audio_to_video" | "compare_versions" | "concat" | "enhance";
export type CanvasSkillCategory = "writing" | "storyboard" | "image" | "video" | "utility";
export type CanvasSkillOutputMode = "text" | "json" | "image_prompt" | "workflow";
export type StoryboardColumn =
    | "shotNumber"
    | "durationSeconds"
    | "plotDescription"
    | "dialogue"
    | "narrativeIntent"
    | "viewerPOV"
    | "performanceBlocking"
    | "shotSize"
    | "emotion"
    | "lightingAndAtmosphere"
    | "audioEffects"
    | "camera"
    | "motion"
    | "timeBeats"
    | "imageGenerationPrompt"
    | "videoMotionPrompt"
    | "assets"
    | "continuityOut"
    | "negativePrompt";

export type StoryboardAssetRole = "character" | "environment" | "wardrobe" | "prop" | "weapon" | "style" | "motion" | "audio";

export type StoryboardAssetBinding = {
    nodeId: string;
    role: StoryboardAssetRole;
    priority: number;
};

export type StoryboardCharacterReference = {
    characterName: string;
    characterAssetId?: string;
    characterVersionId?: string;
    characterDescription?: string;
    characterImageNodeId?: string;
};

export type StoryboardRow = {
    id: string;
    shotNumber: number;
    durationSeconds: number;
    plotDescription: string;
    dialogue: string;
    characters: StoryboardCharacterReference[];
    narrativeIntent: string;
    viewerPOV: string;
    performanceBlocking: string;
    shotSize: string;
    emotion: string;
    lightingAndAtmosphere: string;
    audioEffects: string;
    camera: string;
    motion: string;
    timeBeats: string;
    imageGenerationPrompt: string;
    videoMotionPrompt: string;
    imagePromptTemplateVariables?: Record<string, string>;
    videoPromptTemplateVariables?: Record<string, string>;
    mustHave: string[];
    optionalDetails: string[];
    continuityOut: string;
    negativePrompt: string;
    assetBindings: StoryboardAssetBinding[];
    /** 原视频拆解时的时间范围，用于自动抽取关键帧。 */
    sourceStartMs?: number;
    sourceEndMs?: number;
    keyframeTimeMs?: number;
    imageNodeId?: string;
    videoNodeId?: string;
    status?: CanvasNodeStatus;
    errorDetails?: string;
    /** 与该分镜行关联的预演台场景 ID。由 Agent 或用户创建预演后写入。 */
    previsSceneId?: string;
    /** 最后一次生成白膜预演后的缩略图 URL，用于在分镜行内展示预览图。 */
    previsSnapshotUrl?: string;
};

export type StoryboardData = {
    rows: StoryboardRow[];
    visibleColumns: StoryboardColumn[];
    referenceNodeIds: string[];
};

/** 批量创作入队时的输入，保留资源版本；队列重试继续使用同一份输入。 */
export type CanvasBatchInputSnapshot = {
    version: 1;
    prompt: string;
    context: {
        prompt: string;
        referenceImages: ReferenceImage[];
        referenceVideos: ReferenceVideo[];
        referenceAudios: ReferenceAudio[];
        referenceImageSlots: Array<{ nodeId: string; kind: "image" | "character"; imageId?: string }>;
        characterReferences: Array<{ nodeId: string; assetId: string; requestedVersionId?: string }>;
        resolvedCharacterVersions: Array<{ assetId: string; versionId: string }>;
        resolvedCharacterVoices: Array<{ assetId: string; versionId: string; characterName: string; voiceKey: string; sampleResourceId?: string; language?: string; voiceAge?: string; timbre?: string; deliveryInstructions?: string; instructions: string }>;
        textCount: number;
        imageCount: number;
        videoCount: number;
        audioCount: number;
    };
};

export type CanvasGenerationBatchItem = {
    id: string;
    rowId: string;
    nodeId: string;
    taskId?: string;
    status: CanvasGenerationBatchItemStatus;
    retryCount: number;
    errorDetails?: string;
    costUncertain?: boolean;
    inputSnapshot?: CanvasBatchInputSnapshot;
};

export type CanvasGenerationBatch = {
    id: string;
    projectId: string;
    sourceNodeId: string;
    mode: CanvasGenerationBatchMode;
    status: CanvasGenerationBatchStatus;
    items: CanvasGenerationBatchItem[];
    concurrency?: number;
    createdAt: string;
    updatedAt: string;
};

export type CanvasBatchOperation = "try_on" | "creative";
export type CanvasBatchRow = {
    id: string;
    enabled: boolean;
    inputNodeIds: string[];
    /** Stable column IDs explicitly edited by the user, including deliberately empty cells. */
    referenceOverrides?: string[];
    /** Text nodes selected for this row; their contents are appended to prompt. */
    textNodeIds?: string[];
    prompt: string;
    outputNodeId?: string;
    /** Fingerprint of the inputs used when this row was last queued. */
    generatedInputSignature?: string;
    inputChanged?: boolean;
    /** AI-generated cell content keyed by column id (for aiGenerated tables). */
    cells?: Record<string, string>;
};
export type CanvasBatchColumnType = "image" | "text";
export type CanvasBatchTableContentKind = "content" | "storyboard";
export type CanvasBatchReferenceColumn = {
    id: string;
    label: string;
    type?: CanvasBatchColumnType;
};
export type CanvasBatchTableData = {
    operation: CanvasBatchOperation;
    concurrency: number;
    /** AI 输出的业务结构；分镜表会保留标准 StoryboardRow，避免依赖列名猜测。 */
    contentKind?: CanvasBatchTableContentKind;
    storyboardRows?: StoryboardRow[];
    storyboardTitle?: string;
    storyboardSourceNodeIds?: string[];
    /** Optional prompt override applied to every batch row while non-empty. */
    globalPrompt?: string;
    referenceColumns?: CanvasBatchReferenceColumn[];
    textColumns?: CanvasBatchReferenceColumn[];
    rows: CanvasBatchRow[];
    /** When true, columns are AI-generated with dynamic headers. */
    aiGenerated?: boolean;
    /** Cell overrides coexist with live column connections. */
    referenceMode?: "cells";
    /** 上次已应用的列输入顺序；行插入、删除及重开不重复分配引用。 */
    referenceColumnInputs?: Record<string, string[]>;
};

export type CanvasSkillSnapshot = {
    id: string;
    name: string;
    description: string;
    category: CanvasSkillCategory;
    template: string;
    outputMode: CanvasSkillOutputMode;
    outputContract: string;
    version: number;
    tags: string[];
};

/** 媒体字段沿用 metadata 原字段名，资源引用扫描和本地缓存清理可直接识别 storageKey/content。 */
export type CanvasMediaVersionMedia = Pick<
    CanvasNodeMetadata,
    "content" | "storageKey" | "previewContent" | "mimeType" | "bytes" | "durationMs" | "hasAudio" | "waveform" | "waveformVersion" | "naturalWidth" | "naturalHeight" | "videoPreview" | "imageRotation" | "assetId"
>;

export type CanvasMediaVersionGeneration = Pick<CanvasNodeMetadata, "prompt" | "model" | "producedModel" | "size" | "quality" | "seconds" | "references" | "taskId" | "taskDurationMs">;

export type CanvasMediaVersion = {
    id: string;
    /** 展示为 V1、V2…，按创建顺序递增。 */
    number: number;
    createdAt: string;
    source: "generate" | "upload";
    media: CanvasMediaVersionMedia;
    generation?: CanvasMediaVersionGeneration;
};

/**
 * 从短剧投送到精修画布的对象：设定参考图（cast）、剧情段（segment，挂在段框与段视频上）、成片（final）。
 * 采用到短剧、侧栏定位和“短剧侧已更新”提示都依赖它；画布只保存绑定与投送时的快照，短剧数据以服务端为准。
 */
export type CanvasDramaRef = {
    projectId: string;
    kind: "cast" | "segment" | "final";
    id: string;
    episodeId?: string;
    segmentIndex?: number;
    /** 投送或最近一次同步时短剧侧的当前资源；短剧现状与它不同且与节点媒体也不同，说明短剧侧已更新。 */
    baseResourceId?: string;
};

export type CanvasNodeMetadata = {
    /** Credential-free editable generation contract; submitted recipes live with tasks. */
    generationSpec?: GenerationSpec;
    dramaRef?: CanvasDramaRef;
    /** Namespaced extension ownership for nodes contributed by a unified plugin. */
    pluginId?: string;
    pluginNodeId?: string;
    pluginData?: Record<string, unknown>;
    importSource?:
        | {
              provider: "libtv";
              projectUuid: string;
              nodeKey: string;
              batchId: string;
              sourceType?: string;
              styleAssetUuid?: string;
              styleVersionUuid?: string;
              styleName?: string;
          }
        | {
              provider: "tapnow";
              shareId: string;
              nodeId: string;
              batchId: string;
              sourceType?: string;
          };
    content?: string;
    previewContent?: string;
    /** Original file and immutable pixel-corrected variants; references share the current content/storageKey. */
    imageRotation?: {
        quarterTurns: 0 | 1 | 2 | 3;
        original: { content: string; storageKey?: string; width: number; height: number; bytes?: number; mimeType?: string };
        variants?: Partial<Record<1 | 2 | 3, { content: string; storageKey: string; width: number; height: number; bytes: number; mimeType: string }>>;
    };
    videoPreview?: {
        content: string;
        storageKey?: string;
        width?: number;
        height?: number;
        bytes?: number;
        mimeType?: string;
    };
    richText?: Record<string, unknown>;
    composerContent?: string;
    prompt?: string;
    /** 文本节点是否处于列表模式；用于触发多模态分析并创建多维表格。 */
    listMode?: boolean;
    promptTemplateOperation?: string;
    promptTemplateVariables?: Record<string, string>;
    status?: CanvasNodeStatus;
    /** 浏览器文件上传，与模型生成任务状态独立。 */
    fileUpload?: "uploading" | "error";
    fileUploadProgress?: number;
    locked?: boolean;
    errorDetails?: string;
    generationErrorCode?: string;
    resourceReloadAvailable?: boolean;
    failedPromptFingerprint?: string;
    lastGenerationRequestFingerprint?: string;
    fontSize?: number;
    generationMode?: CanvasGenerationMode;
    generationType?: CanvasImageGenerationType;
    /** 选用模型：下一次生成将使用的模型，随提示词面板下拉变化。 */
    model?: string;
    /** 产出模型：当前图片、视频或音频内容生成成功时冻结的模型身份。 */
    producedModel?: string;
    /** 本次生成已提交、尚未成功落盘的模型身份。失败或改下拉都不改产出模型。 */
    producedModelCandidate?: string;
    workflowProvider?: "model" | "runninghub";
    runningHubWorkflowId?: string;
    runningHubWorkflowKind?: "workflow" | "app";
    /** 当前画布节点覆盖的工作流动态字段，键为 source:* 或 field:nodeId:fieldName。 */
    workflowParameters?: Record<string, unknown>;
    size?: string;
    quality?: string;
    imageResolution?: string;
    imageParameters?: string;
    transparentBackground?: string;
    count?: number;
    textCount?: number;
    seconds?: string;
    vquality?: string;
    generateAudio?: string;
    watermark?: string;
    audioVoice?: string;
    audioFormat?: string;
    audioSpeed?: string;
    audioLanguage?: string;
    audioDialect?: string;
    audioInstructions?: string;
    audioEmotionControlMethod?: string;
    audioEmotionRandom?: string;
    audioEmotionHappy?: string;
    audioEmotionAngry?: string;
    audioEmotionSad?: string;
    audioEmotionAfraid?: string;
    audioEmotionDisgusted?: string;
    audioEmotionMelancholic?: string;
    audioEmotionSurprised?: string;
    audioEmotionCalm?: string;
    references?: string[];
    naturalWidth?: number;
    naturalHeight?: number;
    freeResize?: boolean;
    isBatchRoot?: boolean;
    batchRootId?: string;
    batchChildIds?: string[];
    batchFailedCount?: number;
    batchUsesReferenceImages?: boolean;
    primaryImageId?: string;
    imageBatchExpanded?: boolean;
    /** 拆层请求身份与画布展开位置分离，恢复任务时沿用同一结果消费流程。 */
    layerDecomposition?: { sourceNodeId: string; canvas?: { width: number; height: number } };
    /** 一次拆分从视觉规划起计时；刷新不续发尚未提交的拆图请求。 */
    imageLayerWorkflow?: { sourceNodeId: string; startedAt: string; stage: "planning" | "extract"; total?: number; plannerModel: string; planningTaskId?: string };
    /** 普通生图模型逐层提取；刷新只恢复已提交任务，不自动提交下一次付费请求。 */
    experimentalLayerPlan?: {
        sourceNodeId: string;
        requests: Array<{
            nodeId: string;
            target: string;
            removeFromBackground?: boolean;
            extraction?: import("@/lib/canvas/canvas-image-layer-strategy").ImageLayerExtraction;
            generation?: import("@/lib/canvas/canvas-image-layers").ImageLayerGeneration;
        }>;
        errorSignature?: string;
        composedSignature?: string;
        plannerModel?: string;
        planningTaskId?: string;
        progress?: string;
    };
    layerExtraction?: {
        sourceNodeId: string;
        groupId: string;
        index: number;
        strategy?: import("@/lib/canvas/canvas-image-layer-strategy").ImageLayerExtraction;
        source?: import("@/lib/canvas/canvas-image-layer-strategy").ImageLayerSource;
        backgroundPatch?: import("@/lib/canvas/canvas-image-layer-strategy").ImageLayerBackgroundPatch;
        allowBackgroundRemoval?: boolean;
        backgroundRemovalModel?: string;
        phase?: "extract" | "background-removal-required" | "remove-background" | "complete";
        extractionTaskId?: string;
        /** 原任务资源与本地归一化/修补后的资源分开登记，不能沿用原素材身份。 */
        sourceResultStorageKey?: string;
        rejectedTaskId?: string;
        canvas?: { width: number; height: number };
    };
    imageLayerGroup?: {
        width: number;
        height: number;
        /** 从底到顶；x/y 为合成像素坐标，不是画布节点位置。 */
        layers: Array<{ nodeId: string; x: number; y: number; visible: boolean }>;
        compositeSignature?: string;
        compositeStatus?: "ready" | "updating" | "error";
        compositeError?: string;
        incomplete?: { completed: number; total: number; failed: number; missingBackground: boolean };
    };
    imageLayer?: { groupId: string; outputIndex: number; kind?: "base" | "transparent" };
    /** 裁切素材与完整画布尺寸的图层合成分别保存。 */
    imageLayerMaterials?: { auto?: boolean; status?: "loading" | "ready" | "error"; groupId?: string; error?: string };
    imageLayerMaterial?: { sourceLayerId: string; sourceGroupId: string; bounds: { left: number; top: number; width: number; height: number } };
    storageKey?: string;
    mimeType?: string;
    bytes?: number;
    durationMs?: number;
    /** Normalized waveform peak samples (0..1) for audio visualization. */
    waveform?: number[];
    waveformVersion?: number;
    /** Whether the video file contains an audio track when this is known. */
    hasAudio?: boolean;
    assetId?: string;
    assetTags?: string[];
    assetCategory?: AssetCategory;
    workflowKind?: CanvasWorkflowKind;
    workflowTitle?: string;
    workflowDescription?: string;
    stylePresetId?: string;
    styleProfileJson?: string;
    styleExecutionPlan?: StyleExecutionPlan;
    skillIds?: string[];
    skillVersions?: Array<{ skillId: string; versionId: string; version: string }>;
    skillFiles?: Array<{ skillId: string; path: string; sha256?: string }>;
    chapterId?: string;
    chapterTitle?: string;
    shotIndex?: number;
    sceneId?: string;
    characterIds?: string[];
    referenceSetId?: string;
    referenceAssetNodeIds?: string[];
    assetBindings?: StoryboardAssetBinding[];
    characterName?: string;
    characterPrompt?: string;
    characterAliases?: string[];
    characterDefinition?: Record<string, unknown>;
    characterAssetId?: string;
    characterVersionId?: string;
    characterVersionPolicy?: "current" | "pinned";
    characterVisualStatus?: string;
    characterVoiceStatus?: string;
    characterVoiceName?: string;
    characterVoiceProfile?: {
        name: string;
        provider: string;
        language: string;
        timbre: string;
    };
    characterVoiceInstructions?: string;
    characterCoverUrl?: string;
    characterView?: "front" | "side" | "back" | "multi";
    characterViewNodeIds?: {
        front?: string;
        side?: string;
        back?: string;
    };
    actionBoardRows?: number;
    actionBoardColumns?: number;
    taskId?: string;
    taskClientOperationId?: string;
    retryOf?: string;
    attemptGroupId?: string;
    taskStatus?: "queued" | "running" | "succeeded" | "failed" | "cancelled" | string;
    taskProgress?: number;
    taskStage?: string;
    taskMediaStage?: GenerationTask["mediaStage"];
    taskCanRecoverMedia?: boolean;
    taskProvider?: string;
    taskStartedAt?: string;
    taskCompletedAt?: string;
    taskDurationMs?: number;
    taskErrorCode?: string;
    taskOfficialStatus?: "pending" | "processing" | "completed" | "failed" | "cancelled";
    taskReceiptRecorded?: boolean;
    taskCreatedAt?: string;
    taskUpdatedAt?: string;
    generationEffectKeys?: string[];
    generationOutputCount?: number;
    agentGenerationContinuation?: {
        id: string;
        taskId: string;
        conversationId?: string;
        messageId?: string;
        source?: "online" | "local";
        status: "pending" | "completed" | "failed";
        effectKey?: string;
    };
    sessionId?: string;
    /** 视频画质增强任务参数；重试按这里重建请求，而不是沿用源节点的生成配置。 */
    videoEnhance?: {
        sourceNodeId: string;
        model: string;
        resolution: string;
        fps?: number;
        bitrateLevel?: "low" | "medium" | "high";
        bitrate?: number;
    };
    videoEditOperation?: CanvasVideoEditOperation;
    arkPrivateAssetUpload?: string;
    videoCameraMoveId?: string;
    videoCameraMovePrompt?: string;
    videoStartFrameNodeId?: string;
    videoEndFrameNodeId?: string;
    videoFrameSourceNodeId?: string;
    videoFrameTimeMs?: number;
    versionOfNodeId?: string;
    versionLabel?: string;
    versionPrimary?: boolean;
    /** 节点内媒体版本历史；切换版本只替换媒体字段，节点 ID 与连线保持不变。 */
    mediaVersions?: CanvasMediaVersion[];
    currentMediaVersionId?: string;
    copiedFromNodeId?: string;
    /** Explicit editing copy; subsequent orientation tools modify this node in place. */
    imageEditSourceNodeId?: string;
    generationResultPlacement?: "replace-node" | "new-version";
    previsSceneId?: string;
    previsShotId?: string;
    previsPreviewNodeId?: string;
    previsDepthNodeId?: string;
    previsDepthVideoNodeId?: string;
    previsNormalNodeId?: string;
    previsClayVideoNodeId?: string;
    subtitleEntries?: SrtEntry[];
    subtitleHighlights?: SubtitleHighlight[];
    subtitleStyle?: SubtitleStyle;
    subtitleUpdatedAt?: string;
    skillId?: string;
    skillVersion?: number;
    skillSnapshot?: CanvasSkillSnapshot;
    /** 图表节点的图形类型，缺省柱状图。落盘字段——新增扩展节点的自有字段都要在这里声明。 */
    chartKind?: "bar" | "line";
    /** 调色节点的参数；缺省视为未调色。 */
    colorGrade?: CanvasColorGrade;
    mediaConversion?: MediaConversionNodeState;
    /** 用户手动拉伸过尺寸；图片按真实比例自动适配时避让它。 */
    manualSize?: boolean;
    storyboard?: StoryboardData;
    storyboardShotDuration?: StoryboardShotDuration;
    storyboardShotCount?: StoryboardShotCount;
    storyboardVideoInputMode?: StoryboardVideoInputMode;
    storyboardComposerHeight?: number;
    generationBatches?: CanvasGenerationBatch[];
    batchTable?: CanvasBatchTableData;
    batchSourceNodeId?: string;
    batchRowId?: string;
    batchOperation?: CanvasBatchOperation;
    batchInputNodeIds?: string[];
    /** 本次批量生成准备时的输入签名；不代表旧缩略图已采用这些输入。 */
    batchInputSignature?: string;
    /** 只有成功媒体写入后才记录，等待或失败时保持空缺。 */
    batchResultInputSignature?: string;
    frame?: {
        collapsed: boolean;
        expandedWidth: number;
        expandedHeight: number;
    };
    folder?: {
        style: CanvasFolderStyle;
        theme?: CanvasFolderTheme;
        createdAt: string;
        // 自定义主题资源覆盖预置主题；目录内容永远从 childNodes 读取。
        themeCover?: string;
        assetFolderId?: string;
        projectId?: string;
    };
    drawingId?: string;
    drawingEngine?: "tldraw" | "excalidraw";
    drawingRevision?: number;
    drawingUpdatedAt?: string;
    drawingPreviewStorageKey?: string;
    drawingPreviewUrl?: string;
    drawingShapeCount?: number;
    drawingPageCount?: number;
    emotionEdit?: {
        sourceNodeId: string;
        characterName: string;
        presetId: string;
        intimacy: number;
        arousal: number;
        label: string;
        faceBox: {
            id: string;
            x: number;
            y: number;
            width: number;
            height: number;
            confidence?: number;
            source: "detected" | "manual";
        };
        editRegion?: {
            x: number;
            y: number;
            width: number;
            height: number;
        };
        sourceWidth?: number;
        sourceHeight?: number;
        providerSize?: string;
        maskStorageKey?: string;
        editMode?: "provider-mask" | "local-composite";
    };
    portraitTexture?: PortraitTextureSettings;
    /** AI 审美批改节点只保存当前报告和输入指纹，不保存图片二进制。 */
    artCritique?: ArtCritiqueNodeState;
    /** 摄像机控制选项，启用后生成时自动追加摄影机/镜头/焦距/光圈提示词。 */
    cameraControl?: CameraControlOptions;
    /** 全景节点配置：投影方式、生成方式和比例兜底开关。 */
    panoramaConfig?: {
        projection: "spherical" | "cylindrical";
        sourceMode: "ai" | "image";
        smartBase: boolean;
        directImageUrl?: string | null;
    };
};

export type CanvasNodeData = {
    id: string;
    type: CanvasNodeTypeId;
    title: string;
    createdAt?: string;
    updatedAt?: string;
    position: Position;
    width: number;
    height: number;
    parentId?: string;
    metadata?: CanvasNodeMetadata;
};

export type CanvasConnection = {
    id: string;
    fromNodeId: string;
    toNodeId: string;
    fromHandleId?: string;
    toHandleId?: string;
    fromAnchorRatio?: number;
    toAnchorRatio?: number;
    relation?: "storyboard-output" | "storyboard-asset-reference" | "batch-output" | "batch-input";
    storyboardRowId?: string;
};

export type CanvasDisplayConnection = {
    connection: CanvasConnection;
    from: CanvasNodeData;
    to: CanvasNodeData;
};

export type CanvasAssistantReference = {
    id: string;
    type: CanvasNodeTypeId;
    title: string;
    dataUrl?: string;
    storageKey?: string;
    text?: string;
};

export type CanvasAssistantImage = {
    id: string;
    dataUrl: string;
    storageKey?: string;
    prompt: string;
};

export type CanvasAssistantMessage = {
    id: string;
    role: "user" | "assistant" | "system" | "tool" | "error";
    title?: string;
    text: string;
    meta?: string;
    detail?: unknown;
    references?: CanvasAssistantReference[];
};

export type CanvasAssistantPendingBackendSession = {
    id: string;
    kind: "cinematic";
    messageId: string;
    status: "pending";
    startedAt: string;
};

export type CanvasAssistantSession = {
    id: string;
    title: string;
    messages: CanvasAssistantMessage[];
    pendingBackendSession?: CanvasAssistantPendingBackendSession;
    generationEffectKeys?: string[];
    createdAt: string;
    updatedAt: string;
};

export type ConnectionHandle = {
    nodeId: string;
    handleType: "source" | "target";
    handleId?: string;
    anchorRatio?: number;
};

export type CanvasSelectionStrategy = "replace" | "add" | "toggle" | "subtract";
export type CanvasSelectionHitMode = "contain" | "intersect";

export type SelectionBox = {
    startWorldX: number;
    startWorldY: number;
    currentWorldX: number;
    currentWorldY: number;
    strategy: CanvasSelectionStrategy;
    hitMode: CanvasSelectionHitMode;
    initialSelectedNodeIds: string[];
};

export type ContextMenuState =
    | {
          type: "canvas";
          x: number;
          y: number;
          position: Position;
          createOpen?: boolean;
      }
    | {
          type: "node";
          x: number;
          y: number;
          nodeId: string;
      }
    | {
          type: "connection";
          x: number;
          y: number;
          connectionId: string;
      };
