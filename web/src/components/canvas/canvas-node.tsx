import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { BookOpenCheck, ChevronRight, Clock3, FileText, Image as ImageIcon, LoaderCircle, Lock, Music2, Play, RefreshCw, Replace, Sparkles, Square, Star, Video } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { CometCard } from "@/components/ui/aceternity/comet-card";
import { resourceStorageLabel, resourceStorageLocation, resourceStorageTitle } from "@/lib/canvas/resource-storage-status";
import { formatBytes } from "@/lib/image-utils";
import { CONTENT_MODERATION_ERROR_CODE, isContentModerationError } from "@/lib/generation-error";
import { useThemeStore } from "@/stores/use-theme-store";
import { resourceIdFromStorageKey } from "@/services/api/resources";
import { cacheResourceObjectUrl, getCachedResourceObjectUrl } from "@/services/resource-blob-cache";
import { CanvasResourceMentionTextarea } from "./canvas-resource-mention-textarea";
import { storyboardMinNodeHeight } from "./canvas-script-node";
import { CanvasNodeType, type CanvasNodeData, type Position } from "@/types/canvas";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";

type ResizeCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
type CanvasTheme = (typeof canvasThemes)[keyof typeof canvasThemes];

type CanvasNodeProps = {
    data: CanvasNodeData;
    dragOffset?: Position;
    scale: number;
    isSelected: boolean;
    isRelated: boolean;
    isFocusRelated: boolean;
    isConnectionTarget: boolean;
    isConnecting: boolean;
    editRequestNonce?: number;
    showImageInfo: boolean;
    reduceMediaEffects?: boolean;
    readOnly?: boolean;
    resourceLabel?: CanvasResourceReference;
    mentionReferences?: CanvasResourceReference[];
    renderNodeContent?: (node: CanvasNodeData) => ReactNode;
    batchCount?: number;
    batchExpanded?: boolean;
    batchClosing?: boolean;
    batchOpening?: boolean;
    batchRecovering?: boolean;
    batchMotion?: { x: number; y: number; index: number };
    onMouseDown: (event: React.MouseEvent, nodeId: string) => void;
    onHoverStart: (nodeId: string) => void;
    onHoverEnd: (nodeId: string) => void;
    onConnectStart: (event: React.PointerEvent, nodeId: string, handleType: "source" | "target", handleId?: string) => void;
    onResize: (nodeId: string, width: number, height: number, position?: Position) => void;
    onContentChange: (nodeId: string, content: string) => void;
    onToggleBatch?: (nodeId: string) => void;
    onSetBatchPrimary?: (node: CanvasNodeData) => void;
    onRetry?: (node: CanvasNodeData) => void;
    onCancelTask?: (node: CanvasNodeData) => void;
    onOpenTaskDetails?: (node: CanvasNodeData) => void;
    onOpenVersions?: (node: CanvasNodeData) => void;
    onGenerateImage?: (node: CanvasNodeData) => void;
    onViewImage?: (node: CanvasNodeData) => void;
    onReplaceMedia?: (node: CanvasNodeData) => void;
    onOpenDirector?: (node: CanvasNodeData) => void;
    onOpenDocument?: (node: CanvasNodeData) => void;
    onContextMenu: (event: React.MouseEvent, nodeId: string) => void;
};

type NodeContentRendererProps = {
    node: CanvasNodeData;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    isEditingContent: boolean;
    textareaRef: React.RefObject<HTMLTextAreaElement | null>;
    isBatchRoot: boolean;
    batchCount: number;
    batchExpanded: boolean;
    batchOpening: boolean;
    batchRecovering: boolean;
    renderNodeContent?: (node: CanvasNodeData) => ReactNode;
    onContentChange: (nodeId: string, content: string) => void;
    onStopEditing: () => void;
    mentionReferences: CanvasResourceReference[];
    onRetry?: (node: CanvasNodeData) => void;
    onCancelTask?: (node: CanvasNodeData) => void;
    onOpenTaskDetails?: (node: CanvasNodeData) => void;
    onGenerateImage?: (node: CanvasNodeData) => void;
    onToggleBatch?: () => void;
    onSetBatchPrimary?: () => void;
    reduceMediaEffects?: boolean;
};

export const CanvasNode = React.memo(function CanvasNode({
    data,
    dragOffset,
    scale,
    isSelected,
    isRelated,
    isFocusRelated,
    isConnectionTarget,
    isConnecting,
    editRequestNonce = 0,
    showImageInfo,
    reduceMediaEffects = false,
    readOnly = false,
    resourceLabel,
    mentionReferences = [],
    renderNodeContent,
    batchCount = 0,
    batchExpanded = false,
    batchClosing = false,
    batchOpening = false,
    batchRecovering = false,
    batchMotion,
    onMouseDown,
    onHoverStart,
    onHoverEnd,
    onConnectStart,
    onResize,
    onContentChange,
    onToggleBatch,
    onSetBatchPrimary,
    onRetry,
    onCancelTask,
    onOpenTaskDetails,
    onOpenVersions,
    onGenerateImage,
    onViewImage,
    onReplaceMedia,
    onOpenDirector,
    onOpenDocument,
    onContextMenu,
}: CanvasNodeProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [hovered, setHovered] = useState(false);
    const [isEditingContent, setIsEditingContent] = useState(false);
    const hasImageContent = data.type === CanvasNodeType.Image && Boolean(data.metadata?.content);
    const hasVideoContent = data.type === CanvasNodeType.Video && Boolean(data.metadata?.content);
    const hasAudioContent = data.type === CanvasNodeType.Audio && Boolean(data.metadata?.content);
    const hasMediaContent = hasImageContent || hasVideoContent || hasAudioContent;
    const isGeneratingNode = data.type !== CanvasNodeType.Frame && data.metadata?.status === "loading";
    const isBatchRoot = data.type === CanvasNodeType.Image && Boolean(data.metadata?.isBatchRoot) && batchCount > 1;
    const isBatchChild = data.type === CanvasNodeType.Image && Boolean(data.metadata?.batchRootId);
    const isActive = isConnectionTarget || isSelected || isFocusRelated;
    const imageBorderColor = isActive ? theme.accent.primary : isRelated && !isBatchChild ? theme.accent.primary : "transparent";
    const assetTags = data.metadata?.assetTags?.filter((tag) => tag.trim()) || [];
    const scriptMinHeight = data.type === CanvasNodeType.Script ? storyboardMinNodeHeight(data.metadata?.storyboardComposerHeight) : null;
    const cometDepth = hasMediaContent ? 6.8 : data.type === CanvasNodeType.Script ? 2.8 : 4.6;
    const cometTranslate = hasMediaContent ? 6 : data.type === CanvasNodeType.Script ? 2.5 : 4;
    const cometDisabled = reduceMediaEffects || Boolean(dragOffset) || isEditingContent || isGeneratingNode || scale < 0.32 || batchClosing || batchOpening;
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const resizeRef = useRef({
        isResizing: false,
        corner: "bottom-right" as ResizeCorner,
        startX: 0,
        startY: 0,
        startLeft: 0,
        startTop: 0,
        startWidth: 0,
        startHeight: 0,
        keepRatio: false,
        ratio: 1,
    });

    useEffect(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;

        const handleWheel = (event: WheelEvent) => event.stopPropagation();
        textarea.addEventListener("wheel", handleWheel, { passive: false });
        return () => textarea.removeEventListener("wheel", handleWheel);
    }, [data.type, isEditingContent]);

    useEffect(() => {
        if (!isEditingContent) return;
        const textarea = textareaRef.current;
        textarea?.focus();
        textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
    }, [isEditingContent]);

    useEffect(() => {
        if (readOnly || !editRequestNonce || data.type !== CanvasNodeType.Text) return;
        setIsEditingContent(true);
    }, [data.type, editRequestNonce, readOnly]);

    useEffect(() => {
        if (!isEditingContent) return;

        const handleOutsidePointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (isEditingContent && textareaRef.current?.contains(target)) return;

            setIsEditingContent(false);
        };

        window.addEventListener("pointerdown", handleOutsidePointerDown, true);
        return () => window.removeEventListener("pointerdown", handleOutsidePointerDown, true);
    }, [isEditingContent]);

    const handleResizeMove = useCallback(
        (event: MouseEvent) => {
            if (!resizeRef.current.isResizing) return;

            const dx = (event.clientX - resizeRef.current.startX) / scale;
            const dy = (event.clientY - resizeRef.current.startY) / scale;
            const minWidth = data.type === CanvasNodeType.Script ? 800 : 220;
            const minHeight = scriptMinHeight || 160;
            const startRight = resizeRef.current.startLeft + resizeRef.current.startWidth;
            const startBottom = resizeRef.current.startTop + resizeRef.current.startHeight;
            const fromLeft = resizeRef.current.corner.includes("left");
            const fromTop = resizeRef.current.corner.includes("top");
            const rawWidth = Math.max(minWidth, resizeRef.current.startWidth + (fromLeft ? -dx : dx));
            const rawHeight = Math.max(minHeight, resizeRef.current.startHeight + (fromTop ? -dy : dy));
            let width = rawWidth;
            let height = rawHeight;
            if (resizeRef.current.keepRatio) {
                const ratio = resizeRef.current.ratio;
                if (Math.abs(dx) >= Math.abs(dy)) {
                    height = width / ratio;
                } else {
                    width = height * ratio;
                }
                if (height < minHeight) {
                    height = minHeight;
                    width = height * ratio;
                }
                if (width < minWidth) {
                    width = minWidth;
                    height = width / ratio;
                }
            }

            onResize(data.id, width, height, {
                x: fromLeft ? startRight - width : resizeRef.current.startLeft,
                y: fromTop ? startBottom - height : resizeRef.current.startTop,
            });
        },
        [data.id, data.type, onResize, scale, scriptMinHeight],
    );

    const handleResizeUp = useCallback(() => {
        resizeRef.current.isResizing = false;
        window.removeEventListener("mousemove", handleResizeMove);
        window.removeEventListener("mouseup", handleResizeUp);
    }, [handleResizeMove]);

    const handleResizeMouseDown = (event: React.MouseEvent, corner: ResizeCorner) => {
        event.stopPropagation();
        event.preventDefault();
        resizeRef.current = {
            isResizing: true,
            corner,
            startX: event.clientX,
            startY: event.clientY,
            startLeft: data.position.x,
            startTop: data.position.y,
            startWidth: data.width,
            startHeight: data.height,
            keepRatio: (data.type === CanvasNodeType.Image && !data.metadata?.freeResize) || data.type === CanvasNodeType.Video,
            ratio: (data.metadata?.naturalWidth || data.width) / (data.metadata?.naturalHeight || data.height || 1),
        };
        window.addEventListener("mousemove", handleResizeMove);
        window.addEventListener("mouseup", handleResizeUp);
    };

    useEffect(() => {
        return () => {
            window.removeEventListener("mousemove", handleResizeMove);
            window.removeEventListener("mouseup", handleResizeUp);
        };
    }, [handleResizeMove, handleResizeUp]);

    return (
        <div
            data-node-id={data.id}
            className={`node-element absolute flex select-none flex-col ${dragOffset ? "cursor-grabbing" : "cursor-default"} ${isSelected ? "z-50" : "z-10"}`}
            style={{
                transform: `translate(${data.position.x + (dragOffset?.x || 0)}px, ${data.position.y + (dragOffset?.y || 0)}px)`,
                width: data.width,
                height: data.height,
                contain: "layout style",
            }}
            onMouseEnter={() => {
                setHovered(true);
                onHoverStart(data.id);
            }}
            onMouseLeave={() => {
                setHovered(false);
                onHoverEnd(data.id);
            }}
            onContextMenu={(event) => onContextMenu(event, data.id)}
        >
            <CometCard
                containerClassName="overflow-visible"
                className={`canvas-node-shell relative h-full w-full overflow-visible rounded-[18px] border ${isGeneratingNode ? "canvas-node-shell-generating" : ""}`}
                rotateDepth={cometDepth}
                translateDepth={cometTranslate}
                disabled={cometDisabled}
                glare={!isGeneratingNode}
                data-state={data.metadata?.status || (isActive ? "active" : isRelated ? "related" : "idle")}
                style={{
                    background: hasImageContent || hasVideoContent ? "transparent" : theme.node.fill,
                    borderColor: hasImageContent ? imageBorderColor : isActive ? theme.accent.primary : isRelated ? theme.accent.primary : theme.node.stroke,
                    boxShadow: isActive ? `0 0 0 1px ${theme.accent.primary}66, 0 28px 80px ${theme.spatial.shadow}` : isRelated && !isBatchChild ? `0 0 0 1px ${theme.accent.primary}35, 0 22px 60px ${theme.spatial.shadow}` : undefined,
                }}
                onMouseDown={(event) => onMouseDown(event, data.id)}
                onDoubleClick={(event) => {
                    if (isBatchRoot) {
                        event.stopPropagation();
                        onToggleBatch?.(data.id);
                        return;
                    }
                    if (data.type === CanvasNodeType.Image && hasImageContent) {
                        event.stopPropagation();
                        onViewImage?.(data);
                        return;
                    }
                    if (data.metadata?.directorSceneId) {
                        event.stopPropagation();
                        onOpenDirector?.(data);
                        return;
                    }
                    if (data.metadata?.document?.kind === "novel" && data.metadata?.storyInputMode !== "brief") {
                        event.stopPropagation();
                        onOpenDocument?.(data);
                        return;
                    }
                    if (readOnly || data.type !== CanvasNodeType.Text) return;
                    event.stopPropagation();
                    setIsEditingContent(true);
                }}
            >
                <div
                    className={`relative flex h-full w-full items-center justify-center rounded-[inherit] ${isBatchRoot || data.type === CanvasNodeType.Script ? "overflow-visible" : "overflow-hidden"}`}
                    style={
                        {
                            background: hasImageContent || hasVideoContent ? "transparent" : theme.node.fill,
                            "--batch-from-x": `${batchMotion?.x || 0}px`,
                            "--batch-from-y": `${batchMotion?.y || 0}px`,
                            "--batch-from-rotate": `${6 + (batchMotion?.index || 0) * 4}deg`,
                            animation: data.metadata?.batchRootId ? (batchClosing ? "canvas-batch-child-out 260ms cubic-bezier(.4,0,.2,1) both" : "canvas-batch-child-in 340ms cubic-bezier(.2,.85,.18,1) both") : undefined,
                            animationDelay: data.metadata?.batchRootId ? `${batchClosing ? 0 : 45 + (batchMotion?.index || 0) * 24}ms` : undefined,
                        } as React.CSSProperties
                    }
                >
                    <NodeContent
                        node={data}
                        theme={theme}
                        isEditingContent={isEditingContent}
                        textareaRef={textareaRef}
                        isBatchRoot={isBatchRoot}
                        batchCount={batchCount}
                        batchExpanded={batchExpanded}
                        batchOpening={batchOpening}
                        batchRecovering={batchRecovering}
                        renderNodeContent={renderNodeContent}
                        mentionReferences={mentionReferences}
                        onContentChange={onContentChange}
                        onStopEditing={() => setIsEditingContent(false)}
                        onRetry={onRetry}
                        onCancelTask={onCancelTask}
                        onOpenTaskDetails={onOpenTaskDetails}
                        onGenerateImage={onGenerateImage}
                        onToggleBatch={() => onToggleBatch?.(data.id)}
                        onSetBatchPrimary={() => onSetBatchPrimary?.(data)}
                        reduceMediaEffects={reduceMediaEffects}
                    />
                </div>

                {(hasImageContent || hasVideoContent) && !readOnly ? (
                    <div
                        className={`absolute bottom-[10%] left-1/2 z-40 -translate-x-1/2 motion-safe:transition motion-safe:duration-200 ${hovered || isSelected ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"}`}
                        onMouseDown={(event) => event.stopPropagation()}
                        onPointerDown={(event) => event.stopPropagation()}
                    >
                        <button
                            type="button"
                            className="inline-flex h-9 items-center gap-2 rounded-full border px-4 text-xs font-semibold shadow-lg backdrop-blur-xl transition hover:-translate-y-0.5 hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:hover:translate-y-0"
                            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text, outlineColor: theme.accent.primary }}
                            onClick={(event) => { event.stopPropagation(); onReplaceMedia?.(data); }}
                            aria-label="替换媒体"
                        >
                            <Replace className="size-3.5" />
                            替换
                        </button>
                    </div>
                ) : null}

                {hasMediaContent && !readOnly ? <ResourceStorageBadge storageKey={data.metadata?.storageKey} active={isActive} align={resourceLabel ? "left" : "right"} theme={theme} /> : null}
                {resourceLabel ? <ResourceLabelBadge reference={resourceLabel} theme={theme} /> : null}
                {data.metadata?.versionLabel ? (
                    <button
                        type="button"
                        className="absolute left-3 top-3 z-40 inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[10px] font-semibold backdrop-blur transition hover:brightness-110"
                        style={{ background: theme.toolbar.panel, borderColor: data.metadata.versionPrimary ? theme.node.activeStroke : theme.toolbar.border, color: data.metadata.versionPrimary ? theme.node.activeStroke : theme.node.text }}
                        title="查看版本对比"
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={(event) => { event.stopPropagation(); onOpenVersions?.(data); }}
                    >
                        <Star className={`size-3 ${data.metadata.versionPrimary ? "fill-current" : ""}`} />{data.metadata.versionLabel}
                    </button>
                ) : null}
                {data.metadata?.locked ? <div className="pointer-events-none absolute right-3 top-3 z-40 grid size-7 place-items-center rounded-md border backdrop-blur" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.muted }} title="节点已锁定"><Lock className="size-3.5" /></div> : null}
                {assetTags.length || (showImageInfo && hasImageContent) ? (
                    <div className="pointer-events-none absolute inset-x-3 bottom-3 z-40 flex items-end justify-between gap-2">
                        {assetTags.length ? <AssetTagBadges tags={assetTags} theme={theme} /> : null}
                        {showImageInfo && hasImageContent ? <ImageInfoBar node={data} /> : null}
                    </div>
                ) : null}

                {!hasImageContent && !hasVideoContent && !hasAudioContent ? <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12" style={{ background: `linear-gradient(to top, ${theme.canvas.background}66, transparent)` }} /> : null}

                {!readOnly && !data.metadata?.locked ? <>
                    <ResizeHandle corner="top-left" onMouseDown={handleResizeMouseDown} />
                    <ResizeHandle corner="top-right" onMouseDown={handleResizeMouseDown} />
                    <ResizeHandle corner="bottom-left" onMouseDown={handleResizeMouseDown} />
                    <ResizeHandle corner="bottom-right" onMouseDown={handleResizeMouseDown} />
                </> : null}
            </CometCard>

            {!readOnly && data.type !== CanvasNodeType.Script ? <ConnectionHandleDot side="left" scale={scale} visible={hovered || isSelected || isConnecting} theme={theme} onPointerDown={(event) => onConnectStart(event, data.id, "target")} /> : null}
            {!readOnly && data.type !== CanvasNodeType.Script ? <ConnectionHandleDot side="right" scale={scale} visible={data.type !== CanvasNodeType.Config && (hovered || isSelected || isConnecting)} theme={theme} onPointerDown={(event) => onConnectStart(event, data.id, "source")} /> : null}

        </div>
    );
});

function NodeContent(props: NodeContentRendererProps) {
    const hasCustomContent = props.node.type === CanvasNodeType.Config
        || props.node.type === CanvasNodeType.Script
        || (props.node.metadata?.workflowKind === "story_input" && !props.isEditingContent)
        || (props.node.metadata?.workflowKind === "styleboard" && !props.node.metadata.content);
    if (hasCustomContent && props.renderNodeContent) return props.renderNodeContent(props.node);
    if (props.isBatchRoot) return <ImageNodeContent {...props} />;
    if (props.node.metadata?.status === "loading") return <LoadingContent node={props.node} theme={props.theme} onCancelTask={props.onCancelTask} onOpenTaskDetails={props.onOpenTaskDetails} />;
    if (props.node.metadata?.status === "error") return <ErrorContent node={props.node} theme={props.theme} onRetry={props.onRetry} />;

    const Renderer = nodeContentRenderers[props.node.type];
    return Renderer ? <Renderer {...props} /> : <UnknownNodeContent theme={props.theme} />;
}

const nodeContentRenderers = {
    [CanvasNodeType.Text]: TextContent,
    [CanvasNodeType.Script]: UnknownNodeContent,
    [CanvasNodeType.Skill]: SkillContent,
    [CanvasNodeType.Image]: ImageNodeContent,
    [CanvasNodeType.Config]: EmptyImageContent,
    [CanvasNodeType.Video]: VideoNodeContent,
    [CanvasNodeType.Audio]: AudioNodeContent,
    [CanvasNodeType.Frame]: UnknownNodeContent,
} satisfies Record<CanvasNodeType, (props: NodeContentRendererProps) => ReactNode>;

function LoadingContent({ node, theme, onCancelTask, onOpenTaskDetails }: Pick<NodeContentRendererProps, "node" | "theme" | "onCancelTask" | "onOpenTaskDetails">) {
    const taskId = node.metadata?.taskId;
    const progress = typeof node.metadata?.taskProgress === "number" ? Math.max(0, Math.min(100, Math.round(node.metadata.taskProgress))) : null;
    const statusLabel = taskStatusLabel(node.metadata?.taskStatus);
    const elapsed = useTaskElapsed(node.metadata?.taskCreatedAt);
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2.5 px-5 text-center" style={{ color: theme.node.activeStroke }}>
            <div className="size-10 animate-spin rounded-full border-2" style={{ borderColor: theme.node.stroke, borderTopColor: theme.node.activeStroke }} />
            <span className="text-[10px] font-semibold">{node.metadata?.taskStage || (taskId ? "任务处理中" : "正在创建任务")}</span>
            {taskId ? (
                <div className="flex w-full max-w-[210px] flex-col items-center gap-1.5">
                    <div className="max-w-full truncate text-[11px] font-medium" style={{ color: theme.node.text }}>
                        {statusLabel}
                        {progress !== null ? ` · ${progress}%` : ""}
                    </div>
                    {progress !== null ? (
                        <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: theme.node.stroke }}>
                            <div className="h-full rounded-full transition-[width]" style={{ width: `${progress}%`, background: theme.node.activeStroke }} />
                        </div>
                    ) : null}
                    <div className="max-w-full truncate text-[10px] tabular-nums" style={{ color: theme.node.muted }}>
                        <Clock3 className="mr-1 inline size-3" />{elapsed} · {shortTaskId(taskId)}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5">
                        <button type="button" className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[10px] font-medium transition hover:brightness-110" style={{ background: theme.toolbar.itemHover, color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onOpenTaskDetails?.(node); }}><FileText className="size-3" />详情</button>
                        <button type="button" className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[10px] font-medium transition hover:brightness-110" style={{ background: `${theme.accent.danger}16`, color: theme.accent.danger }} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onCancelTask?.(node); }}><Square className="size-2.5 fill-current" />取消</button>
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function useTaskElapsed(createdAt?: string) {
    const [, setTick] = useState(0);
    useEffect(() => {
        if (!createdAt) return;
        const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
        return () => window.clearInterval(timer);
    }, [createdAt]);
    if (!createdAt) return "刚刚";
    const seconds = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000));
    if (seconds < 60) return `${seconds}秒`;
    const minutes = Math.floor(seconds / 60);
    return minutes < 60 ? `${minutes}分${seconds % 60}秒` : `${Math.floor(minutes / 60)}时${minutes % 60}分`;
}

function taskStatusLabel(status?: string) {
    if (status === "queued") return "排队中";
    if (status === "running") return "生成中";
    if (status === "succeeded") return "任务已完成";
    if (status === "failed") return "任务失败";
    if (status === "cancelled") return "任务已取消";
    return status ? String(status) : "等待任务状态";
}

function shortTaskId(id: string) {
    if (id.length <= 20) return id;
    return `${id.slice(0, 14)}...${id.slice(-4)}`;
}

function ErrorContent({ node, theme, onRetry }: Pick<NodeContentRendererProps, "node" | "theme" | "onRetry">) {
    const moderationFailure = node.metadata?.generationErrorCode === CONTENT_MODERATION_ERROR_CODE || isContentModerationError(node.metadata?.errorDetails);
    return (
        <div className="flex max-w-[260px] flex-col items-center gap-3 px-5 text-center">
            <div className="text-xs leading-5" style={{ color: theme.accent.danger }}>{node.metadata?.errorDetails || "生成失败"}</div>
            {moderationFailure ? (
                <div className="rounded-md border px-3 py-2 text-[11px] leading-4" style={{ background: theme.node.fill, borderColor: theme.toolbar.border, color: theme.node.muted }}>
                    修改节点提示词后，可重新点击生成。
                </div>
            ) : (
                <button
                    type="button"
                    className="inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition hover:scale-[1.02]"
                    style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                    onClick={(event) => {
                        event.stopPropagation();
                        onRetry?.(node);
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                >
                    <RefreshCw className="size-3.5" />
                    重试
                </button>
            )}
        </div>
    );
}

function UnknownNodeContent({ theme }: Pick<NodeContentRendererProps, "theme">) {
    return (
        <div className="flex h-full w-full items-center justify-center text-sm" style={{ color: theme.node.placeholder }}>
            未知节点
        </div>
    );
}

function TextContent({ node, theme, isEditingContent, textareaRef, mentionReferences, onContentChange, onStopEditing, onGenerateImage }: NodeContentRendererProps) {
    const fontSize = node.metadata?.fontSize || 14;
    const textStyle = { fontSize: `${fontSize}px`, lineHeight: `${Math.round(fontSize * 1.65)}px`, color: theme.node.text, boxSizing: "border-box" } as React.CSSProperties;

    if (node.metadata?.document?.kind === "novel" && !isEditingContent) {
        return <NovelDocumentContent node={node} theme={theme} />;
    }

    return (
        <div className="flex h-full w-full flex-col overflow-hidden pt-8">
            <button
                type="button"
                className="absolute right-3 top-3 z-20 inline-flex h-8 items-center gap-1 rounded-full border px-2.5 text-xs font-medium opacity-85 backdrop-blur-md transition hover:scale-[1.02] hover:opacity-100"
                style={{ background: `${theme.toolbar.panel}dd`, borderColor: theme.node.stroke, color: theme.node.text }}
                onClick={(event) => {
                    event.stopPropagation();
                    onGenerateImage?.(node);
                }}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                title="用文本生图"
                aria-label="用文本生图"
            >
                <ImageIcon className="size-3.5" />
                生图
            </button>
            {isEditingContent ? (
                <CanvasResourceMentionTextarea
                    ref={textareaRef}
                    className="thin-scrollbar block h-full w-full resize-none overflow-y-auto whitespace-pre-wrap break-words border-none bg-transparent pl-4 pr-14 pt-0 pb-4 m-0 font-mono outline-none select-text appearance-none"
                    style={textStyle}
                    value={node.metadata?.content || ""}
                    references={mentionReferences}
                    highlightLabels={false}
                    onChange={(value) => onContentChange(node.id, value)}
                    onBlur={onStopEditing}
                    onKeyDown={(event) => {
                        if (event.key === "Escape") onStopEditing();
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    onWheel={(event) => event.stopPropagation()}
                />
            ) : (
                <div
                    className="thin-scrollbar block h-full w-full overflow-y-auto whitespace-pre-wrap break-words bg-transparent pl-4 pr-14 pt-0 pb-4 font-mono"
                    style={textStyle}
                    onWheel={(event) => event.stopPropagation()}
                >
                    {node.metadata?.content || <span style={{ color: theme.node.placeholder }}>双击编辑文字</span>}
                </div>
            )}
        </div>
    );
}

function NovelDocumentContent({ node, theme }: { node: CanvasNodeData; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const document = node.metadata?.document;
    const plainText = document?.plainText || node.metadata?.content || "";
    const excerpt = plainText.replace(/\s+/g, " ").trim().slice(0, 180);
    return (
        <div className="flex h-full w-full flex-col overflow-hidden p-4" style={{ color: theme.node.text }}>
            <div className="mb-3 flex items-start gap-2">
                <span className="grid size-8 shrink-0 place-items-center rounded-xl" style={{ background: `${theme.accent.primary}18`, color: theme.accent.primary }}><FileText className="size-4" /></span>
                <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{node.title || "小说"}</div>
                    <div className="mt-0.5 text-[11px]" style={{ color: theme.node.muted }}>小说文本节点 · 双击打开编辑</div>
                </div>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden rounded-xl border px-3 py-2.5 text-xs leading-6" style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.muted }}>
                {excerpt || <span style={{ color: theme.node.placeholder }}>导入小说或开始写作…</span>}
            </div>
            <div className="mt-3 flex items-center gap-3 text-[10px]" style={{ color: theme.node.muted }}>
                <span>{document?.characterCount || Array.from(plainText).length} 字</span>
                <span>{document?.sourceFileName || "未导入文件"}</span>
            </div>
        </div>
    );
}

function SkillContent({ node, theme }: NodeContentRendererProps) {
    const skill = node.metadata?.skillSnapshot;
    const tags = skill?.tags?.slice(0, 4) || [];
    const template = skill?.template || node.metadata?.content || "";

    return (
        <div className="flex h-full w-full flex-col overflow-hidden p-4" style={{ color: theme.node.text }}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="grid size-8 shrink-0 place-items-center rounded-xl" style={{ background: `${theme.node.activeStroke}18`, color: theme.node.activeStroke }}>
                            <BookOpenCheck className="size-4" />
                        </span>
                        <div className="min-w-0">
                            <div className="truncate text-sm font-semibold">{skill?.name || node.title || "技能"}</div>
                            <div className="mt-0.5 flex items-center gap-1.5 text-[11px]" style={{ color: theme.node.muted }}>
                                <span>{skillCategoryLabel(skill?.category)}</span>
                                <span>·</span>
                                <span>{skillOutputModeLabel(skill?.outputMode)}</span>
                                {skill?.version ? (
                                    <>
                                        <span>·</span>
                                        <span>v{skill.version}</span>
                                    </>
                                ) : null}
                            </div>
                        </div>
                    </div>
                </div>
                <Sparkles className="mt-1 size-4 shrink-0 opacity-50" />
            </div>

            {skill?.description ? <div className="mt-3 line-clamp-2 text-xs leading-5" style={{ color: theme.node.muted }}>{skill.description}</div> : null}

            <div className="thin-scrollbar mt-3 min-h-0 flex-1 overflow-hidden rounded-xl border px-3 py-2 text-xs leading-5" style={{ borderColor: theme.node.stroke, background: theme.node.panel, color: theme.node.text }}>
                <div className="mb-1 font-semibold opacity-55">模板</div>
                <div className="line-clamp-4 whitespace-pre-wrap break-words">{template || "未配置技能模板"}</div>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
                {tags.length ? tags.map((tag) => (
                    <span key={tag} className="rounded-md border px-1.5 py-0.5 text-[10px]" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                        {tag}
                    </span>
                )) : <span className="text-[11px]" style={{ color: theme.node.muted }}>连接到生成配置节点后生效</span>}
            </div>
        </div>
    );
}

function skillCategoryLabel(category?: string) {
    if (category === "writing") return "剧情";
    if (category === "storyboard") return "分镜";
    if (category === "image") return "生图";
    if (category === "video") return "视频";
    return "通用";
}

function skillOutputModeLabel(mode?: string) {
    if (mode === "json") return "JSON";
    if (mode === "image_prompt") return "生图提示词";
    if (mode === "workflow") return "工作流";
    return "文本";
}

function ResourceLabelBadge({ reference, theme }: { reference: CanvasResourceReference; theme: CanvasTheme }) {
    return (
        <span className="pointer-events-none absolute right-2 top-2 z-30 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-white shadow-sm" style={{ background: reference.active ? theme.accent.primary : "rgba(0,0,0,.35)", opacity: reference.active ? 1 : 0.75 }}>
            {reference.label}
        </span>
    );
}

function ResourceStorageBadge({ storageKey, active, align, theme }: { storageKey?: string; active: boolean; align: "left" | "right"; theme: CanvasTheme }) {
    const location = resourceStorageLocation(storageKey);
    const position = align === "right" ? "right-2" : "left-2";
    const background = active ? (location === "local" ? "rgba(245,158,11,.9)" : theme.accent.primary) : "rgba(0,0,0,.35)";
    return (
        <span className={`pointer-events-auto absolute ${position} top-2 z-30 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-white shadow-sm`} style={{ background, opacity: active ? 1 : 0.75 }} title={resourceStorageTitle(storageKey)}>
            {resourceStorageLabel(storageKey)}
        </span>
    );
}

function AssetTagBadges({ tags, theme }: { tags: string[]; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    return (
        <div className="flex min-w-0 flex-1 flex-wrap items-end gap-1">
            {tags.map((tag, index) => (
                <span
                    key={`${tag}-${index}`}
                    className="max-w-full truncate rounded-md border px-1.5 py-1 text-[10px] font-medium leading-none backdrop-blur-sm"
                    style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                >
                    {tag.trim()}
                </span>
            ))}
        </div>
    );
}

function ImageNodeContent(props: NodeContentRendererProps) {
    if (!props.node.metadata?.content && props.isBatchRoot) {
        const content =
            props.node.metadata?.status === "loading" ? (
                <LoadingContent node={props.node} theme={props.theme} />
            ) : props.node.metadata?.status === "error" ? (
                <ErrorContent node={props.node} theme={props.theme} onRetry={props.onRetry} />
            ) : (
                <EmptyImageContent {...props} isBatchRoot={false} />
            );
        return (
            <BatchFrame batchCount={props.batchCount} batchExpanded={props.batchExpanded} batchOpening={props.batchOpening} batchRecovering={props.batchRecovering} theme={props.theme} onToggleBatch={props.onToggleBatch}>
                {content}
            </BatchFrame>
        );
    }
    if (!props.node.metadata?.content) return <EmptyImageContent {...props} />;

    return (
        <ImageContent
            node={props.node}
            theme={props.theme}
            isBatchRoot={props.isBatchRoot}
            batchCount={props.batchCount}
            batchExpanded={props.batchExpanded}
            batchOpening={props.batchOpening}
            batchRecovering={props.batchRecovering}
            onToggleBatch={props.onToggleBatch}
            onSetBatchPrimary={props.onSetBatchPrimary}
        />
    );
}

function EmptyImageContent({ node, theme, isBatchRoot, batchCount, batchExpanded, batchOpening, batchRecovering, onToggleBatch }: NodeContentRendererProps) {
    const isCharacterReference = node.metadata?.workflowKind === "character" && node.metadata?.characterView === "multi";
    const content = (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3" style={{ color: theme.node.placeholder }}>
            <div className="flex size-14 items-center justify-center rounded-2xl" style={{ background: theme.toolbar.activeBg }}>
                <ImageIcon className="size-6 opacity-30" />
            </div>
            {isCharacterReference ? (
                <div className="max-w-[80%] text-center">
                    <div className="truncate text-xs font-medium" style={{ color: theme.node.muted }}>{node.metadata?.characterName || node.title}</div>
                    <div className="mt-1 text-[10px] tracking-[0.12em] opacity-50">多视角参考 · 待生成</div>
                </div>
            ) : <span className="text-[10px] tracking-[0.18em] opacity-50">空图片节点</span>}
        </div>
    );
    if (isBatchRoot)
        return (
            <BatchFrame batchCount={batchCount} batchExpanded={batchExpanded} batchOpening={batchOpening} batchRecovering={batchRecovering} theme={theme} onToggleBatch={onToggleBatch}>
                {content}
            </BatchFrame>
        );
    return content;
}

function VideoNodeContent({ node, theme, reduceMediaEffects }: NodeContentRendererProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const playWhenReadyRef = useRef(false);
    const { url, loading, load } = useNodeResourceUrl(node, false);
    useEffect(() => {
        if (!url || !playWhenReadyRef.current) return;
        playWhenReadyRef.current = false;
        void videoRef.current?.play().catch(() => undefined);
    }, [url]);
    if (!node.metadata?.content)
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3" style={{ color: theme.node.placeholder }}>
                <Video className="size-7 opacity-35" />
                <span className="text-sm">空视频节点</span>
            </div>
        );
    if (!url) {
        return <DeferredMediaLoad icon={loading ? <LoaderCircle className="size-5 animate-spin" /> : <Play className="size-5 fill-current" />} label={loading ? "正在缓存视频" : "加载并缓存视频"} disabled={loading} onClick={() => { playWhenReadyRef.current = true; void load(); }} />;
    }
    return <video ref={videoRef} src={url} controls preload={reduceMediaEffects ? "none" : "metadata"} className="h-full w-full rounded-[18px] bg-black object-contain" data-canvas-no-zoom />;
}

function AudioNodeContent({ node, theme }: NodeContentRendererProps) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const playWhenReadyRef = useRef(false);
    const { url, loading, load } = useNodeResourceUrl(node, false);
    useEffect(() => {
        if (!url || !playWhenReadyRef.current) return;
        playWhenReadyRef.current = false;
        void audioRef.current?.play().catch(() => undefined);
    }, [url]);
    if (!node.metadata?.content)
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2" style={{ color: theme.node.placeholder }}>
                <Music2 className="size-7 opacity-35" />
                <span className="text-sm">空音频节点</span>
            </div>
        );
    if (!url) {
        return <DeferredMediaLoad icon={loading ? <LoaderCircle className="size-5 animate-spin" /> : <Play className="size-5 fill-current" />} label={loading ? "正在缓存音频" : "加载并缓存音频"} disabled={loading} onClick={() => { playWhenReadyRef.current = true; void load(); }} />;
    }
    return (
        <div className="flex h-full w-full flex-col justify-center gap-3 px-4" style={{ background: theme.node.fill, color: theme.node.text }}>
            <div className="flex min-w-0 items-center gap-2 text-sm opacity-70">
                <Music2 className="size-4 shrink-0" />
                <span className="truncate">{node.title || "音频"}</span>
            </div>
            <audio ref={audioRef} src={url} controls preload="metadata" className="w-full" data-canvas-no-zoom />
        </div>
    );
}

function ImageContent({
    node,
    theme,
    isBatchRoot,
    batchCount,
    batchExpanded,
    batchOpening,
    batchRecovering,
    onToggleBatch,
    onSetBatchPrimary,
}: {
    node: CanvasNodeData;
    theme: CanvasTheme;
    isBatchRoot: boolean;
    batchCount: number;
    batchExpanded: boolean;
    batchOpening: boolean;
    batchRecovering: boolean;
    onToggleBatch?: () => void;
    onSetBatchPrimary?: () => void;
}) {
    const isBatchChild = Boolean(node.metadata?.batchRootId);
    const imageContainerRef = useRef<HTMLDivElement>(null);
    const nearViewport = useNearViewport(imageContainerRef);
    const { url, loading } = useNodeResourceUrl(node, nearViewport);

    return (
        <BatchFrame batchCount={isBatchRoot ? batchCount : 0} batchExpanded={batchExpanded} batchOpening={batchOpening} batchRecovering={batchRecovering} theme={theme} onToggleBatch={onToggleBatch}>
            <div ref={imageContainerRef} className="h-full w-full overflow-hidden rounded-[16px]">
                {url ? (
                    <img
                        src={url}
                        alt={node.title}
                        loading="lazy"
                        decoding="async"
                        draggable={false}
                        onDragStart={(event) => event.preventDefault()}
                        className={`pointer-events-none block h-full w-full select-none ${node.metadata?.freeResize ? "object-fill" : "object-contain"}`}
                    />
                ) : <div className="grid size-full place-items-center" style={{ color: theme.node.muted }}>{loading ? <LoaderCircle className="size-5 animate-spin" /> : <ImageIcon className="size-5 opacity-45" />}</div>}
            </div>
            {isBatchRoot ? (
                <button
                    type="button"
                    className="canvas-node-tool-button absolute right-2.5 top-2.5 z-30 flex h-8 items-center justify-center gap-1 rounded-full border px-2.5 text-xs font-semibold backdrop-blur-md"
                    style={{ background: `${theme.toolbar.panel}d9`, borderColor: `${theme.toolbar.border}cc`, color: theme.node.text }}
                    aria-label={batchExpanded ? "图片组已展开" : "图片组已收起"}
                    onClick={(event) => {
                        event.stopPropagation();
                        onToggleBatch?.();
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    <span className="leading-none" style={{ color: theme.accent.primary }}>{batchCount}</span>
                    <ChevronRight className={`size-3.5 opacity-55 transition-transform ${batchExpanded ? "rotate-90" : ""}`} />
                </button>
            ) : null}
            {isBatchChild ? (
                <button
                    type="button"
                    className="canvas-node-tool-button absolute right-3 top-3 z-30 flex h-9 items-center gap-1.5 rounded-xl border px-2.5 text-xs font-medium opacity-0 backdrop-blur-md group-hover/batch:opacity-100"
                    style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                    onClick={(event) => {
                        event.stopPropagation();
                        onSetBatchPrimary?.();
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    <Star className="size-3.5" style={{ color: theme.accent.primary }} />
                    设为主图
                </button>
            ) : null}
        </BatchFrame>
    );
}

function DeferredMediaLoad({ icon, label, disabled, onClick }: { icon: ReactNode; label: string; disabled: boolean; onClick: () => void }) {
    return (
        <button type="button" data-canvas-no-zoom className="flex size-full flex-col items-center justify-center gap-2 rounded-[16px] bg-black text-white/75 transition hover:text-white disabled:cursor-wait" disabled={disabled} onClick={(event) => { event.stopPropagation(); onClick(); }} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            <span className="grid size-10 place-items-center rounded-full bg-white/10">{icon}</span>
            <span className="text-xs font-medium">{label}</span>
        </button>
    );
}

function useNodeResourceUrl(node: CanvasNodeData, eager: boolean) {
    const storageKey = node.metadata?.storageKey || "";
    const fallback = node.metadata?.content || "";
    const isRemoteResource = Boolean(resourceIdFromStorageKey(storageKey));
    const [url, setUrl] = useState(isRemoteResource ? "" : fallback);
    const [loading, setLoading] = useState(isRemoteResource && eager);

    useEffect(() => {
        let cancelled = false;
        if (!isRemoteResource) {
            setUrl(fallback);
            setLoading(false);
            return;
        }
        setUrl("");
        setLoading(eager);
        const resolve = eager ? cacheResourceObjectUrl(storageKey) : getCachedResourceObjectUrl(storageKey);
        void resolve
            .then((cached) => {
                if (!cancelled) setUrl(cached || (eager ? fallback : ""));
            })
            .catch(() => {
                if (!cancelled && eager) setUrl(fallback);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [eager, fallback, isRemoteResource, storageKey]);

    const load = useCallback(async () => {
        if (url) return url;
        if (!isRemoteResource) return fallback;
        setLoading(true);
        try {
            const next = (await cacheResourceObjectUrl(storageKey)) || fallback;
            setUrl(next);
            return next;
        } catch {
            setUrl(fallback);
            return fallback;
        } finally {
            setLoading(false);
        }
    }, [fallback, isRemoteResource, storageKey, url]);

    return { url, loading, load };
}

function useNearViewport(ref: React.RefObject<Element | null>) {
    const [nearViewport, setNearViewport] = useState(false);

    useEffect(() => {
        const element = ref.current;
        if (!element || typeof IntersectionObserver === "undefined") {
            setNearViewport(true);
            return;
        }
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    setNearViewport(true);
                    observer.disconnect();
                }
            },
            { rootMargin: "600px" },
        );
        observer.observe(element);
        return () => observer.disconnect();
    }, [ref]);

    return nearViewport;
}

function ImageInfoBar({ node }: { node: CanvasNodeData }) {
    const width = Math.round(node.metadata?.naturalWidth || node.width);
    const height = Math.round(node.metadata?.naturalHeight || node.height);
    const size = formatBytes(node.metadata?.bytes || 0);
    return (
        <span className="ml-auto max-w-full shrink-0 truncate rounded-md bg-black/55 px-2 py-1 text-[11px] font-medium leading-none text-white backdrop-blur-sm">
            {width} x {height}
            {size ? ` · ${size}` : ""}
        </span>
    );
}

function BatchFrame({ batchCount, batchExpanded, batchOpening, batchRecovering, theme, onToggleBatch, children }: { batchCount: number; batchExpanded: boolean; batchOpening: boolean; batchRecovering: boolean; theme: CanvasTheme; onToggleBatch?: () => void; children: ReactNode }) {
    const isBatchRoot = batchCount > 1;
    return (
        <div
            className="group/batch relative h-full w-full overflow-visible"
            onDoubleClick={
                isBatchRoot
                    ? (event) => {
                          event.stopPropagation();
                          onToggleBatch?.();
                      }
                    : undefined
            }
        >
            {isBatchRoot ? (
                <div className="pointer-events-none absolute inset-0 overflow-visible">
                    {Array.from({ length: Math.min(batchCount - 1, 5) }).map((_, index) => (
                        <div
                            key={index}
                            className="absolute rounded-[inherit] border shadow-[0_14px_34px_rgba(68,64,60,.16)] transition-all duration-300 group-hover/batch:translate-x-2"
                            style={{
                                inset: 0,
                                background: `linear-gradient(135deg, ${theme.node.panel}, ${theme.node.fill})`,
                                borderColor: theme.node.stroke,
                                opacity: batchExpanded && !batchOpening ? 0.34 : 1,
                                transform:
                                    batchOpening || batchRecovering ? `translate(${54 + index * 22}px, ${20 + index * 12}px) rotate(${8 + index * 5}deg) scale(.98)` : `translate(${34 + index * 18}px, ${14 + index * 10}px) rotate(${6 + index * 4}deg)`,
                                zIndex: -index - 1,
                            }}
                        />
                    ))}
                </div>
            ) : null}
            {children}
        </div>
    );
}
function ResizeHandle({ corner, onMouseDown }: { corner: ResizeCorner; onMouseDown: (event: React.MouseEvent, corner: ResizeCorner) => void }) {
    const positionClass = {
        "top-left": "-left-[14px] -top-[14px] cursor-nwse-resize",
        "top-right": "-right-[14px] -top-[14px] cursor-nesw-resize",
        "bottom-left": "-bottom-[14px] -left-[14px] cursor-nesw-resize",
        "bottom-right": "-bottom-[14px] -right-[14px] cursor-nwse-resize",
    }[corner];

    return <div className={`absolute z-50 size-7 ${positionClass}`} onMouseDown={(event) => onMouseDown(event, corner)} />;
}

function ConnectionHandleDot({ side, scale, visible, theme, onPointerDown }: { side: "left" | "right"; scale: number; visible: boolean; theme: CanvasTheme; onPointerDown: (event: React.PointerEvent) => void }) {
    const inverseScale = 1 / Math.max(scale, 0.05);

    return (
        <div
            className={`canvas-connection-handle absolute top-1/2 z-30 flex -translate-y-1/2 cursor-pointer items-center justify-center transition-opacity duration-150 ${
                side === "left" ? "left-0 -translate-x-1/2" : "right-0 translate-x-1/2"
            } ${visible ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}
            style={{ width: 40 * inverseScale, height: 40 * inverseScale }}
            onPointerDown={onPointerDown}
        >
            <div className="canvas-node-tool-button grid place-items-center rounded-full border" style={{ width: 16 * inverseScale, height: 16 * inverseScale, borderWidth: inverseScale, background: theme.node.panel, borderColor: theme.accent.primary }}>
                <span className="block rounded-full" style={{ width: 6 * inverseScale, height: 6 * inverseScale, background: theme.accent.primary }} />
            </div>
        </div>
    );
}
