import {
    AudioLines,
    Captions,
    Clapperboard,
    Download,
    FolderPlus,
    GalleryHorizontalEnd,
    Image as ImageIcon,
    Info,
    LoaderCircle,
    Lock,
    Maximize2,
    MessageSquare,
    Minus,
    Music2,
    Plus,
    RefreshCw,
    Scissors,
    Settings2,
    Trash2,
    Unlock,
    Upload,
    UserRound,
    Video,
} from "lucide-react";

import { CONTENT_MODERATION_ERROR_CODE, isContentModerationError } from "@/lib/generation-error";
import { registerToolbarTools, type ToolContext, type ToolDefinition } from "@/lib/canvas/tool-registry";
import { CanvasNodeType } from "@/types/canvas";
import { t } from "@/i18n";

// 节点状态判定辅助函数——从 ToolContext 派生
function isImage(ctx: ToolContext) {
    return ctx.node?.type === CanvasNodeType.Image;
}
function isVideo(ctx: ToolContext) {
    return ctx.node?.type === CanvasNodeType.Video;
}
function isAudio(ctx: ToolContext) {
    return ctx.node?.type === CanvasNodeType.Audio;
}
function isText(ctx: ToolContext) {
    return ctx.node?.type === CanvasNodeType.Text;
}
function isConfig(ctx: ToolContext) {
    return ctx.node?.type === CanvasNodeType.Config;
}
function hasImage(ctx: ToolContext) {
    return isImage(ctx) && Boolean(ctx.nodeMetadata?.content);
}
function hasVideo(ctx: ToolContext) {
    return isVideo(ctx) && Boolean(ctx.nodeMetadata?.content);
}
function hasAudio(ctx: ToolContext) {
    return isAudio(ctx) && Boolean(ctx.nodeMetadata?.content);
}
function isCharacterReference(ctx: ToolContext) {
    return isText(ctx) && ctx.nodeMetadata?.workflowKind === "character" && Boolean(ctx.nodeMetadata?.characterAssetId);
}
function isEditableText(ctx: ToolContext) {
    return isText(ctx) && !isCharacterReference(ctx);
}
function canOpenDialog(ctx: ToolContext) {
    return isEditableText(ctx) || isImage(ctx) || isVideo(ctx);
}
function simpleMode(ctx: ToolContext) {
    return ctx.workspaceMode === "simple";
}
function isImageBatchRoot(ctx: ToolContext) {
    return isImage(ctx) && Boolean(ctx.nodeMetadata?.isBatchRoot && ctx.nodeMetadata.batchChildIds?.length);
}
function canRetry(ctx: ToolContext) {
    const requiresPromptChange = ctx.nodeMetadata?.generationErrorCode === CONTENT_MODERATION_ERROR_CODE || isContentModerationError(ctx.nodeMetadata?.errorDetails);
    const batchHasFailures = isImageBatchRoot(ctx) && (ctx.nodeMetadata?.batchFailedCount || (ctx.nodeMetadata?.status === "error" ? 1 : 0)) > 0;
    return (ctx.nodeMetadata?.status === "error" || (batchHasFailures && ctx.nodeMetadata?.status !== "loading")) && !requiresPromptChange;
}

export const nodeHoverToolbarTools: ToolDefinition[] = [
    // 基础工具组
    {
        id: "info",
        toolbar: "node-hover",
        category: "node-state",
        label: (ctx) => (isCharacterReference(ctx) ? t("canvas:view-character-details") : t("canvas:view-node-info")),
        displayLabel: (ctx) => (isCharacterReference(ctx) ? t("canvas:character-details") : t("canvas:info")),
        icon: (ctx) => (isCharacterReference(ctx) ? <UserRound className="size-3.5" /> : <Info className="size-3.5" />),
        defaultVisible: true,
        defaultOrder: 10,
        run: (ctx) => ctx.handlers.onNodeInfo(ctx.node!),
    },
    {
        id: "delete",
        toolbar: "node-hover",
        category: "node-state",
        label: t("canvas:remove-node"),
        displayLabel: t("canvas:delete-5"),
        icon: <Trash2 className="size-3.5" />,
        defaultVisible: true,
        defaultOrder: 20,
        danger: true,
        run: (ctx) => ctx.handlers.onNodeDelete(ctx.node!),
    },
    // 节点操作工具组——通过 applicable 谓词实现上下文感知
    {
        id: "retry",
        toolbar: "node-hover",
        category: "node-state",
        label: (ctx) => (isImageBatchRoot(ctx) ? t("canvas:retry-failed-images-in-batch") : t("canvas:regenerate-2")),
        displayLabel: (ctx) => (isImageBatchRoot(ctx) ? t("canvas:retry-failed-items") : t("canvas:retry-2")),
        icon: <RefreshCw className="size-3.5" />,
        defaultVisible: true,
        defaultOrder: 30,
        applicable: canRetry,
        run: (ctx) => ctx.handlers.onNodeRetry(ctx.node!),
    },
    {
        id: "extractLastFrame",
        toolbar: "node-hover",
        category: "node-state",
        label: (ctx) => (ctx.extractingVideoFrame ? t("canvas:grabbing-last-frame") : t("canvas:grab-last-frame")),
        displayLabel: (ctx) => (ctx.extractingVideoFrame ? t("canvas:trimming") : t("canvas:last-frame")),
        icon: (ctx) => (ctx.extractingVideoFrame ? <LoaderCircle className="size-3.5 animate-spin" /> : <GalleryHorizontalEnd className="size-3.5" />),
        defaultVisible: true,
        defaultOrder: 40,
        applicable: (ctx) => hasVideo(ctx) && !simpleMode(ctx),
        disabled: (ctx) => ctx.extractingVideoFrame,
        run: (ctx) => ctx.handlers.onNodeExtractVideoLastFrame(ctx.node!),
    },
    {
        id: "extractAudio",
        toolbar: "node-hover",
        category: "node-state",
        label: (ctx) => (ctx.extractingAudio ? t("canvas:extracting-audio-to-mp3") : t("canvas:extract-audio-as-mp3")),
        displayLabel: (ctx) => (ctx.extractingAudio ? t("canvas:extracting") : t("canvas:extract-audio")),
        icon: (ctx) => (ctx.extractingAudio ? <LoaderCircle className="size-3.5 animate-spin" /> : <AudioLines className="size-3.5" />),
        defaultVisible: true,
        defaultOrder: 42,
        applicable: (ctx) => hasVideo(ctx) && !simpleMode(ctx),
        disabled: (ctx) => ctx.extractingAudio || ctx.trimmingVideo,
        run: (ctx) => ctx.handlers.onNodeExtractAudioFromVideo(ctx.node!),
    },
    {
        id: "trimRegenerate",
        toolbar: "node-hover",
        category: "node-state",
        label: (ctx) => (ctx.trimmingVideo ? t("canvas:trimming-segments") : t("canvas:trim-by-segment-and-regenerate")),
        displayLabel: (ctx) => (ctx.trimmingVideo ? t("canvas:trimming") : t("canvas:trim-and-regenerate")),
        icon: (ctx) => (ctx.trimmingVideo ? <LoaderCircle className="size-3.5 animate-spin" /> : <Scissors className="size-3.5" />),
        defaultVisible: true,
        defaultOrder: 44,
        applicable: (ctx) => hasVideo(ctx) && !simpleMode(ctx),
        disabled: (ctx) => ctx.extractingAudio || ctx.trimmingVideo,
        run: (ctx) => ctx.handlers.onNodeTrimVideoRegenerate(ctx.node!),
    },
    {
        id: "saveAsset",
        toolbar: "node-hover",
        category: "node-state",
        label: t("canvas:save-to-my-assets-2"),
        displayLabel: t("canvas:save-asset"),
        icon: <FolderPlus className="size-3.5" />,
        defaultVisible: true,
        defaultOrder: 50,
        applicable: (ctx) => hasImage(ctx) || hasVideo(ctx) || isEditableText(ctx),
        run: (ctx) => ctx.handlers.onNodeSaveAsset(ctx.node!),
    },
    {
        id: "download",
        toolbar: "node-hover",
        category: "node-state",
        label: (ctx) => (hasAudio(ctx) ? t("canvas:download-audio") : hasVideo(ctx) ? t("canvas:download-video") : t("canvas:download-image")),
        displayLabel: t("canvas:download-2"),
        icon: <Download className="size-3.5" />,
        defaultVisible: true,
        defaultOrder: 60,
        applicable: (ctx) => hasImage(ctx) || hasVideo(ctx) || hasAudio(ctx),
        run: (ctx) => ctx.handlers.onNodeDownload(ctx.node!),
    },
    {
        id: "edit",
        toolbar: "node-hover",
        category: "node-state",
        label: (ctx) => (isEditableText(ctx) ? t("canvas:call-text-model-to-generate-content") : t("canvas:edit")),
        displayLabel: (ctx) => (isEditableText(ctx) ? t("canvas:text-generation") : t("canvas:edit")),
        icon: <MessageSquare className="size-3.5" />,
        defaultVisible: true,
        defaultOrder: 70,
        applicable: canOpenDialog,
        run: (ctx) => ctx.handlers.onNodeToggleDialog(ctx.node!),
    },
    {
        id: "editText",
        toolbar: "node-hover",
        category: "node-state",
        label: t("canvas:zoom-edit-text"),
        displayLabel: t("canvas:zoom-edit-3"),
        icon: <Maximize2 className="size-3.5" />,
        defaultVisible: true,
        defaultOrder: 80,
        applicable: isEditableText,
        run: (ctx) => ctx.handlers.onNodeEditText(ctx.node!),
    },
    {
        id: "generateImage",
        toolbar: "node-hover",
        category: "node-state",
        label: t("canvas:text-to-image"),
        displayLabel: t("canvas:image-gen-3"),
        icon: <ImageIcon className="size-3.5" />,
        defaultVisible: true,
        defaultOrder: 90,
        applicable: isEditableText,
        run: (ctx) => ctx.handlers.onNodeGenerateImage(ctx.node!),
    },
    {
        id: "config",
        toolbar: "node-hover",
        category: "node-state",
        label: t("canvas:generation-config"),
        displayLabel: t("canvas:generation-config"),
        icon: <Settings2 className="size-3.5" />,
        defaultVisible: true,
        defaultOrder: 100,
        applicable: (ctx) => isConfig(ctx) && !simpleMode(ctx),
        run: (ctx) => ctx.handlers.onNodeToggleDialog(ctx.node!),
    },
    {
        id: "decreaseFont",
        toolbar: "node-hover",
        category: "node-state",
        label: t("canvas:smaller-font"),
        displayLabel: t("canvas:zoom-out"),
        icon: <Minus className="size-3.5" />,
        defaultVisible: true,
        defaultOrder: 110,
        applicable: (ctx) => isEditableText(ctx) && !simpleMode(ctx),
        run: (ctx) => ctx.handlers.onNodeDecreaseFont(ctx.node!),
    },
    {
        id: "increaseFont",
        toolbar: "node-hover",
        category: "node-state",
        label: t("canvas:larger-font"),
        displayLabel: t("canvas:zoom-in"),
        icon: <Plus className="size-3.5" />,
        defaultVisible: true,
        defaultOrder: 120,
        applicable: (ctx) => isEditableText(ctx) && !simpleMode(ctx),
        run: (ctx) => ctx.handlers.onNodeIncreaseFont(ctx.node!),
    },
    {
        id: "uploadImage",
        toolbar: "node-hover",
        category: "node-state",
        label: t("canvas:upload-image"),
        displayLabel: t("canvas:upload-image"),
        icon: <Upload className="size-3.5" />,
        defaultVisible: true,
        defaultOrder: 130,
        applicable: (ctx) => isImage(ctx) && !hasImage(ctx),
        run: (ctx) => ctx.handlers.onNodeUpload(ctx.node!),
    },
    {
        id: "uploadVideo",
        toolbar: "node-hover",
        category: "node-state",
        label: (ctx) => (hasVideo(ctx) ? t("canvas:replace-video") : t("canvas:upload-video")),
        displayLabel: (ctx) => (hasVideo(ctx) ? t("canvas:replace-video") : t("canvas:upload-video")),
        icon: <Video className="size-3.5" />,
        defaultVisible: true,
        defaultOrder: 140,
        applicable: isVideo,
        run: (ctx) => ctx.handlers.onNodeUpload(ctx.node!),
    },
    {
        id: "subtitles",
        toolbar: "node-hover",
        category: "node-state",
        label: t("canvas:edit-subtitles"),
        displayLabel: t("canvas:subtitles"),
        icon: <Captions className="size-3.5" />,
        defaultVisible: true,
        defaultOrder: 145,
        applicable: (ctx) => hasVideo(ctx),
        run: (ctx) => ctx.handlers.onNodeSubtitles(ctx.node!),
    },
    {
        id: "timeline",
        toolbar: "node-hover",
        category: "node-state",
        label: t("canvas:timeline-editing"),
        displayLabel: t("canvas:timeline"),
        icon: <Clapperboard className="size-3.5" />,
        defaultVisible: true,
        defaultOrder: 148,
        applicable: (ctx) => hasVideo(ctx) || hasAudio(ctx),
        run: (ctx) => ctx.handlers.onNodeTimeline(ctx.node!),
    },
    {
        id: "uploadAudio",
        toolbar: "node-hover",
        category: "node-state",
        label: (ctx) => (hasAudio(ctx) ? t("canvas:replace-audio") : t("canvas:upload-audio")),
        displayLabel: (ctx) => (hasAudio(ctx) ? t("canvas:replace-audio") : t("canvas:upload-audio")),
        icon: <Music2 className="size-3.5" />,
        defaultVisible: true,
        defaultOrder: 150,
        applicable: isAudio,
        run: (ctx) => ctx.handlers.onNodeUpload(ctx.node!),
    },
    // 节点锁定——独立分类，自动插入前置分隔符
    {
        id: "node-lock",
        toolbar: "node-hover",
        category: "navigation",
        label: (ctx) => (ctx.nodeMetadata?.locked ? t("canvas:unlock-node") : t("canvas:lock-position-and-size")),
        displayLabel: (ctx) => (ctx.nodeMetadata?.locked ? t("canvas:unlock") : t("canvas:lock")),
        icon: (ctx) => (ctx.nodeMetadata?.locked ? <Unlock className="size-3.5" /> : <Lock className="size-3.5" />),
        defaultVisible: true,
        defaultOrder: 160,
        active: (ctx) => Boolean(ctx.nodeMetadata?.locked),
        run: (ctx) => ctx.handlers.onNodeToggleLocked(ctx.node!),
    },
];

registerToolbarTools(nodeHoverToolbarTools);
