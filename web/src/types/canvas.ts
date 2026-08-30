import type { CanvasColorGrade } from "@/lib/canvas/canvas-color-grade";
import type { PortraitTextureSettings } from "@/lib/canvas/canvas-portrait-texture";
import type { StyleExecutionPlan } from "@/lib/canvas/style-profile";
import type { PortraitClearanceNodeState } from "@/lib/portrait-clearance/contracts";
import type { SrtEntry, SubtitleHighlight, SubtitleStyle } from "@/types/timeline";

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
}

/** Runtime IDs contributed by plugins share the persisted node type field. */
export type PluginCanvasNodeType = string & { readonly __pluginCanvasNodeType?: unique symbol };
export type CanvasNodeTypeId = CanvasNodeType | PluginCanvasNodeType;

export function isBuiltinCanvasNodeType(type: CanvasNodeTypeId): type is CanvasNodeType {
    return Object.values(CanvasNodeType).includes(type as CanvasNodeType);
}

export type CanvasNodeStatus = "idle" | "success" | "loading" | "error";
export type CanvasMediaPerformanceMode = "auto" | "quality" | "performance";
export type CanvasWorkspaceMode = "simple" | "professional";
export type CanvasToolMode = "move" | "box-select";
export type CanvasFolderStyle = "glass" | "stacked" | "midnight" | "paper" | "cinema" | "compact";
export type CanvasFolderTheme = "aurora" | "obsidian" | "ember" | "pearl";
export type StoryboardShotDuration = "auto" | "5" | "10" | "15" | "30";
export type StoryboardShotCount = "auto" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10";
export type StoryboardVideoInputMode = "direct" | "keyframe";
export type CanvasGenerationMode = "text" | "image" | "video" | "audio";
export type CanvasGenerationBatchMode = "storyboard_image" | "storyboard_video" | "action_board";
export type CanvasGenerationBatchStatus = "queued" | "running" | "partial_failed" | "completed" | "cancelled";
export type CanvasGenerationBatchItemStatus = "waiting" | "submitting" | "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type CanvasImageGenerationType = "generation" | "edit";
export type CanvasWorkflowKind = "free" | "script" | "story_input" | "character" | "scene" | "storyboard" | "shot" | "final" | "styleboard" | "reference_set" | "reference_video" | "action_board";
export type CanvasVideoEditOperation = "text_to_video" | "image_to_video" | "reference_to_video" | "extend" | "inpaint" | "replace_element" | "camera_motion" | "style_transfer" | "audio_to_video" | "compare_versions" | "concat";
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
    imageNodeId?: string;
    videoNodeId?: string;
    status?: CanvasNodeStatus;
    errorDetails?: string;
};

export type StoryboardData = {
    rows: StoryboardRow[];
    visibleColumns: StoryboardColumn[];
    referenceNodeIds: string[];
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
};

export type CanvasGenerationBatch = {
    id: string;
    projectId: string;
    sourceNodeId: string;
    mode: CanvasGenerationBatchMode;
    status: CanvasGenerationBatchStatus;
    items: CanvasGenerationBatchItem[];
    createdAt: string;
    updatedAt: string;
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

export type CanvasNodeMetadata = {
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
    promptTemplateOperation?: string;
    promptTemplateVariables?: Record<string, string>;
    status?: CanvasNodeStatus;
    locked?: boolean;
    errorDetails?: string;
    generationErrorCode?: string;
    resourceReloadAvailable?: boolean;
    failedPromptFingerprint?: string;
    lastGenerationRequestFingerprint?: string;
    fontSize?: number;
    generationMode?: CanvasGenerationMode;
    generationType?: CanvasImageGenerationType;
    model?: string;
    workflowProvider?: "model" | "runninghub" | "comfyui";
    runningHubWorkflowId?: string;
    runningHubWorkflowKind?: "workflow" | "app";
    comfyBridgeWorkflowId?: string;
    /** 当前画布节点覆盖的工作流动态字段，键为 source:* 或 field:nodeId:fieldName。 */
    workflowParameters?: Record<string, unknown>;
    size?: string;
    quality?: string;
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
    audioInstructions?: string;
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
    storageKey?: string;
    mimeType?: string;
    bytes?: number;
    durationMs?: number;
    /** Whether the video file contains an audio track when this is known. */
    hasAudio?: boolean;
    assetId?: string;
    assetTags?: string[];
    assetCategory?: "character" | "environment" | "wardrobe" | "prop" | "weapon" | "style" | "other";
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
    copiedFromNodeId?: string;
    directorSceneId?: string;
    directorShotId?: string;
    directorPreviewNodeId?: string;
    directorDepthNodeId?: string;
    directorNormalNodeId?: string;
    directorClayVideoNodeId?: string;
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
    /** 用户手动拉伸过尺寸；图片按真实比例自动适配时避让它。 */
    manualSize?: boolean;
    storyboard?: StoryboardData;
    storyboardShotDuration?: StoryboardShotDuration;
    storyboardShotCount?: StoryboardShotCount;
    storyboardVideoInputMode?: StoryboardVideoInputMode;
    storyboardComposerHeight?: number;
    generationBatches?: CanvasGenerationBatch[];
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
    /** 肖像排查节点只保存可恢复的 UI 状态，不保存图片、embedding 或完整结果。 */
    portraitClearance?: PortraitClearanceNodeState;
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
    relation?: "storyboard-output" | "storyboard-asset-reference";
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

export type SelectionBox = {
    startWorldX: number;
    startWorldY: number;
    currentWorldX: number;
    currentWorldY: number;
    additive: boolean;
    subtractive: boolean;
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
