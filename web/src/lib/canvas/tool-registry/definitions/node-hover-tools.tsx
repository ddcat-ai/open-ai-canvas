import { Download, FolderPlus, GalleryHorizontalEnd, Image as ImageIcon, Info, LoaderCircle, Lock, Maximize2, MessageSquare, Minus, Music2, Plus, RefreshCw, Settings2, Trash2, Unlock, Upload, UserRound, Video } from "lucide-react";

import { CONTENT_MODERATION_ERROR_CODE, isContentModerationError } from "@/lib/generation-error";
import { registerToolbarTools, type ToolContext, type ToolDefinition } from "@/lib/canvas/tool-registry";
import { CanvasNodeType } from "@/types/canvas";

// 节点状态判定辅助函数——从 ToolContext 派生
function isImage(ctx: ToolContext) { return ctx.node?.type === CanvasNodeType.Image; }
function isVideo(ctx: ToolContext) { return ctx.node?.type === CanvasNodeType.Video; }
function isAudio(ctx: ToolContext) { return ctx.node?.type === CanvasNodeType.Audio; }
function isText(ctx: ToolContext) { return ctx.node?.type === CanvasNodeType.Text; }
function isConfig(ctx: ToolContext) { return ctx.node?.type === CanvasNodeType.Config; }
function hasImage(ctx: ToolContext) { return isImage(ctx) && Boolean(ctx.nodeMetadata?.content); }
function hasVideo(ctx: ToolContext) { return isVideo(ctx) && Boolean(ctx.nodeMetadata?.content); }
function hasAudio(ctx: ToolContext) { return isAudio(ctx) && Boolean(ctx.nodeMetadata?.content); }
function isCharacterReference(ctx: ToolContext) { return isText(ctx) && ctx.nodeMetadata?.workflowKind === "character" && Boolean(ctx.nodeMetadata?.characterAssetId); }
function isEditableText(ctx: ToolContext) { return isText(ctx) && !isCharacterReference(ctx); }
function canOpenDialog(ctx: ToolContext) { return isEditableText(ctx) || isImage(ctx) || isVideo(ctx); }
function simpleMode(ctx: ToolContext) { return ctx.workspaceMode === "simple"; }
function canRetry(ctx: ToolContext) {
    const requiresPromptChange = ctx.nodeMetadata?.generationErrorCode === CONTENT_MODERATION_ERROR_CODE || isContentModerationError(ctx.nodeMetadata?.errorDetails);
    return ctx.nodeMetadata?.status === "error" && !requiresPromptChange;
}

export const nodeHoverToolbarTools: ToolDefinition[] = [
    // 基础工具组
    {
        id: "info",
        toolbar: "node-hover",
        category: "node-state",
        label: (ctx) => isCharacterReference(ctx) ? "查看角色详情" : "查看节点信息",
        displayLabel: (ctx) => isCharacterReference(ctx) ? "角色详情" : "信息",
        icon: (ctx) => isCharacterReference(ctx) ? <UserRound className="size-3.5" /> : <Info className="size-3.5" />,
        defaultVisible: true,
        defaultOrder: 10,
        run: (ctx) => ctx.handlers.onNodeInfo(ctx.node!),
    },
    {
        id: "delete",
        toolbar: "node-hover",
        category: "node-state",
        label: "移除节点",
        displayLabel: "删除",
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
        label: "重新生成",
        displayLabel: "重试",
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
        label: (ctx) => ctx.extractingVideoFrame ? "正在截取尾帧" : "截取尾帧",
        displayLabel: (ctx) => ctx.extractingVideoFrame ? "截取中" : "尾帧",
        icon: (ctx) => ctx.extractingVideoFrame ? <LoaderCircle className="size-3.5 animate-spin" /> : <GalleryHorizontalEnd className="size-3.5" />,
        defaultVisible: true,
        defaultOrder: 40,
        applicable: (ctx) => hasVideo(ctx) && !simpleMode(ctx),
        disabled: (ctx) => ctx.extractingVideoFrame,
        run: (ctx) => ctx.handlers.onNodeExtractVideoLastFrame(ctx.node!),
    },
    {
        id: "saveAsset",
        toolbar: "node-hover",
        category: "node-state",
        label: "加入我的素材",
        displayLabel: "存素材",
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
        label: (ctx) => hasAudio(ctx) ? "下载音频" : hasVideo(ctx) ? "下载视频" : "下载图片",
        displayLabel: "下载",
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
        label: (ctx) => isEditableText(ctx) ? "调用文本模型生成内容" : "编辑",
        displayLabel: (ctx) => isEditableText(ctx) ? "文本生成" : "编辑",
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
        label: "放大编辑文本",
        displayLabel: "放大编辑",
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
        label: "用文本生图",
        displayLabel: "生图",
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
        label: "生成配置",
        displayLabel: "生成配置",
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
        label: "减小字号",
        displayLabel: "缩小",
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
        label: "增大字号",
        displayLabel: "放大",
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
        label: "上传图片",
        displayLabel: "上传图片",
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
        label: (ctx) => hasVideo(ctx) ? "替换视频" : "上传视频",
        displayLabel: (ctx) => hasVideo(ctx) ? "替换视频" : "上传视频",
        icon: <Video className="size-3.5" />,
        defaultVisible: true,
        defaultOrder: 140,
        applicable: isVideo,
        run: (ctx) => ctx.handlers.onNodeUpload(ctx.node!),
    },
    {
        id: "uploadAudio",
        toolbar: "node-hover",
        category: "node-state",
        label: (ctx) => hasAudio(ctx) ? "替换音频" : "上传音频",
        displayLabel: (ctx) => hasAudio(ctx) ? "替换音频" : "上传音频",
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
        label: (ctx) => ctx.nodeMetadata?.locked ? "解锁节点" : "锁定位置和尺寸",
        displayLabel: (ctx) => ctx.nodeMetadata?.locked ? "解锁" : "锁定",
        icon: (ctx) => ctx.nodeMetadata?.locked ? <Unlock className="size-3.5" /> : <Lock className="size-3.5" />,
        defaultVisible: true,
        defaultOrder: 160,
        active: (ctx) => Boolean(ctx.nodeMetadata?.locked),
        run: (ctx) => ctx.handlers.onNodeToggleLocked(ctx.node!),
    },
];

registerToolbarTools(nodeHoverToolbarTools);
