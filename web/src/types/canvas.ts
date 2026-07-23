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
    Script = "script",
    Skill = "skill",
    Config = "config",
    Video = "video",
    Audio = "audio",
    Frame = "frame",
}

export type CanvasNodeStatus = "idle" | "success" | "loading" | "error";
export type CanvasMediaPerformanceMode = "auto" | "quality" | "performance";
export type CanvasWorkspaceMode = "simple" | "professional";
export type CanvasDocumentKind = "novel" | "brief" | "notes";
export type CanvasDocumentChapterStatus = "idle" | "processing" | "success" | "error";
export type CanvasDocumentChapter = {
    id: string;
    title: string;
    order: number;
    json: Record<string, unknown>;
    plainText: string;
    characterCount: number;
    storyboardStatus?: CanvasDocumentChapterStatus;
    storyboardNodeId?: string;
    updatedAt: string;
};
export type CanvasRichDocument = {
    kind: CanvasDocumentKind;
    format: "tiptap-json";
    json: Record<string, unknown>;
    plainText: string;
    characterCount: number;
    chapters?: CanvasDocumentChapter[];
    activeChapterId?: string;
    sourceFileName?: string;
    updatedAt: string;
};
export type StoryboardShotDuration = "auto" | "5" | "10" | "15" | "30";
export type StoryboardShotCount = "auto" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10";
export type CanvasGenerationMode = "text" | "image" | "video" | "audio";
export type CanvasGenerationBatchMode = "storyboard_image" | "storyboard_video" | "action_board";
export type CanvasGenerationBatchStatus = "queued" | "running" | "partial_failed" | "completed" | "cancelled";
export type CanvasGenerationBatchItemStatus = "waiting" | "submitting" | "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type CanvasImageGenerationType = "generation" | "edit";
export type CanvasWorkflowKind = "free" | "script" | "story_input" | "character" | "scene" | "storyboard" | "shot" | "final" | "styleboard" | "reference_set" | "action_board";
export type CanvasVideoEditOperation = "text_to_video" | "image_to_video" | "extend" | "inpaint" | "replace_element" | "camera_motion" | "style_transfer" | "audio_to_video" | "compare_versions" | "concat";
export type CanvasSkillCategory = "writing" | "storyboard" | "image" | "video" | "utility";
export type CanvasSkillOutputMode = "text" | "json" | "image_prompt" | "workflow";
export type StoryboardColumn = "shotNumber" | "durationSeconds" | "plotDescription" | "dialogue" | "shotSize" | "emotion" | "lightingAndAtmosphere" | "audioEffects" | "camera" | "motion" | "timeBeats" | "imageGenerationPrompt" | "videoMotionPrompt" | "negativePrompt";

export type StoryboardCharacterReference = {
    characterName: string;
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
    shotSize: string;
    emotion: string;
    lightingAndAtmosphere: string;
    audioEffects: string;
    camera: string;
    motion: string;
    timeBeats: string;
    imageGenerationPrompt: string;
    videoMotionPrompt: string;
    negativePrompt: string;
    referenceNodeIds: string[];
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
    content?: string;
    document?: CanvasRichDocument;
    composerContent?: string;
    prompt?: string;
    status?: CanvasNodeStatus;
    locked?: boolean;
    errorDetails?: string;
    generationErrorCode?: string;
    failedPromptFingerprint?: string;
    fontSize?: number;
    generationMode?: CanvasGenerationMode;
    generationType?: CanvasImageGenerationType;
    model?: string;
    size?: string;
    quality?: string;
    transparentBackground?: string;
    count?: number;
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
    batchUsesReferenceImages?: boolean;
    primaryImageId?: string;
    imageBatchExpanded?: boolean;
    storageKey?: string;
    mimeType?: string;
    bytes?: number;
    durationMs?: number;
    assetTags?: string[];
    workflowKind?: CanvasWorkflowKind;
    workflowTitle?: string;
    workflowDescription?: string;
    stylePresetId?: string;
    documentNodeId?: string;
    chapterId?: string;
    chapterTitle?: string;
    shotIndex?: number;
    sceneId?: string;
    characterIds?: string[];
    referenceSetId?: string;
    referenceAssetNodeIds?: string[];
    characterName?: string;
    characterPrompt?: string;
    characterAliases?: string[];
    characterView?: "front" | "side" | "back" | "multi";
    characterViewNodeIds?: {
        front?: string;
        side?: string;
        back?: string;
    };
    actionBoardRows?: number;
    actionBoardColumns?: number;
    taskId?: string;
    taskStatus?: "queued" | "running" | "succeeded" | "failed" | "cancelled" | string;
    taskProgress?: number;
    taskStage?: string;
    taskCreatedAt?: string;
    taskUpdatedAt?: string;
    sessionId?: string;
    videoEditOperation?: CanvasVideoEditOperation;
    videoCameraMoveId?: string;
    videoCameraMovePrompt?: string;
    videoStartFrameNodeId?: string;
    videoEndFrameNodeId?: string;
    versionOfNodeId?: string;
    versionLabel?: string;
    versionPrimary?: boolean;
    directorSceneId?: string;
    directorShotId?: string;
    directorPreviewNodeId?: string;
    directorDepthNodeId?: string;
    directorNormalNodeId?: string;
    skillId?: string;
    skillVersion?: number;
    skillSnapshot?: CanvasSkillSnapshot;
    storyboard?: StoryboardData;
    storyboardShotDuration?: StoryboardShotDuration;
    storyboardShotCount?: StoryboardShotCount;
    storyboardComposerHeight?: number;
    storyInputMode?: "novel" | "brief";
    generationBatches?: CanvasGenerationBatch[];
    frame?: {
        collapsed: boolean;
        expandedWidth: number;
        expandedHeight: number;
    };
};

export type CanvasNodeData = {
    id: string;
    type: CanvasNodeType;
    title: string;
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
};

export type CanvasAssistantReference = {
    id: string;
    type: CanvasNodeType;
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
    createdAt: string;
    updatedAt: string;
};

export type ConnectionHandle = {
    nodeId: string;
    handleType: "source" | "target";
    handleId?: string;
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
