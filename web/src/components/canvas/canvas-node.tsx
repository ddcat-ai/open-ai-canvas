import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AlertCircle, BookOpenCheck, CheckCircle2, Clapperboard, Copy, Download, Image as ImageIcon, Music2, Pencil, RefreshCw, ScanSearch, Settings2, Star, Trash2, Type, Video } from "lucide-react";

import { useCanvasNodeActions } from "./canvas-node-action-context";

import { canvasThemes } from "@/lib/canvas-theme";
import { canvasConnectionTilt } from "@/lib/canvas/canvas-connection-tilt";
import { storyboardMinNodeHeight } from "@/lib/canvas/canvas-storyboard-layout";
import { isEmptyMediaNode, isLocalReadOnlyAssetNode, shouldShowInlineNodeStatus } from "@/lib/canvas/canvas-node-ui-policy";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeTypeId, type Position } from "@/types/canvas";
import { ART_CRITIQUE_NODE_TYPE } from "@/lib/art-critique/contracts";
import { getNodeDefinition, getNodeMinSize, shouldKeepAspectRatio } from "@/lib/canvas/node-registry";
import { CanvasNodeContent, CanvasNodeImageInfo } from "./canvas-node-content";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";

type ResizeCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
type CanvasTheme = (typeof canvasThemes)[keyof typeof canvasThemes];

type CanvasNodeProps = {
    data: CanvasNodeData;
    dragOffset?: Position;
    isDragging?: boolean;
    scale: number;
    isSelected: boolean;
    mediaActive?: boolean;
    isRelated: boolean;
    isFocusRelated: boolean;
    isConnectionTarget: boolean;
    connectionApproach?: Position;
    forceInputVisible?: boolean;
    showImageInfo: boolean;
    reduceMediaEffects?: boolean;
    readOnly?: boolean;
    mentionReferences?: CanvasResourceReference[];
    renderNodeContent?: (node: CanvasNodeData) => ReactNode;
    drawingProjectId?: string;
    batchCount?: number;
    batchPreviewNodes?: CanvasNodeData[];
    batchExpanded?: boolean;
    batchClosing?: boolean;
    batchOpening?: boolean;
    batchRecovering?: boolean;
    batchPrimary?: boolean;
    batchMotion?: { x: number; y: number; index: number };
    onMouseDown: (event: React.MouseEvent, nodeId: string) => void;
    onHoverStart: (nodeId: string) => void;
    onHoverEnd: (nodeId: string) => void;
    onConnectStart: (event: React.PointerEvent, nodeId: string, handleType: "source" | "target", handleId?: string, anchorRatio?: number) => void;
    onResize: (nodeId: string, width: number, height: number, position?: Position) => void;
    onTitleChange?: (nodeId: string, title: string) => void;
    onContentChange: (nodeId: string, content: string) => void;
    onToggleBatch?: (nodeId: string) => void;
    onSetBatchPrimary?: (node: CanvasNodeData) => void;
    onRetry?: (node: CanvasNodeData) => void;
    onReloadResource?: (node: CanvasNodeData) => void;
    onOpenTaskDetails?: (node: CanvasNodeData) => void;
    onOpenVersions?: (node: CanvasNodeData) => void;
    onViewImage?: (node: CanvasNodeData) => void;
    onReplaceMedia?: (node: CanvasNodeData) => void;
    onOpenTextEditor?: (node: CanvasNodeData) => void;
    onOpenDirector?: (node: CanvasNodeData) => void;
    onOpenDrawing?: (node: CanvasNodeData) => void;
    onMediaPlayRequest?: (nodeId: string) => void;
    mediaPreloadRequested?: boolean;
    onMediaPreloadRequest?: (nodeId: string) => void;
    onMediaPreloadCancel?: (nodeId: string) => void;
    onContextMenu: (event: React.MouseEvent, nodeId: string) => void;
};

export const CanvasNode = React.memo(function CanvasNode({
    data,
    dragOffset,
    isDragging,
    scale,
    isSelected,
    mediaActive = false,
    isRelated,
    isFocusRelated,
    isConnectionTarget,
    connectionApproach,
    forceInputVisible = false,
    showImageInfo,
    reduceMediaEffects = false,
    readOnly = false,
    mentionReferences = [],
    renderNodeContent,
    drawingProjectId,
    batchCount = 0,
    batchPreviewNodes,
    batchExpanded = false,
    batchClosing = false,
    batchOpening = false,
    batchRecovering = false,
    batchPrimary = false,
    batchMotion,
    onMouseDown,
    onHoverStart,
    onHoverEnd,
    onConnectStart,
    onResize,
    onTitleChange,
    onContentChange,
    onToggleBatch,
    onSetBatchPrimary,
    onRetry,
    onReloadResource,
    onOpenTaskDetails,
    onReplaceMedia,
    onOpenVersions,
    onViewImage,
    onOpenTextEditor,
    onOpenDirector,
    onOpenDrawing,
    onMediaPlayRequest,
    mediaPreloadRequested = false,
    onMediaPreloadRequest,
    onMediaPreloadCancel,
    onContextMenu,
}: CanvasNodeProps) {
    const canvasThemeName = useThemeStore((state) => state.theme);
    const theme = canvasThemes[canvasThemeName];
    const [hovered, setHovered] = useState(false);
    const [isEditingContent, setIsEditingContent] = useState(false);
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [titleDraft, setTitleDraft] = useState(data.title);
    const { download: downloadNode, duplicate: duplicateNode, deleteNode } = useCanvasNodeActions();
    const hasImageContent = data.type === CanvasNodeType.Image && Boolean(data.metadata?.content);
    const hasVideoContent = data.type === CanvasNodeType.Video && Boolean(data.metadata?.content || data.metadata?.storageKey);
    const hasAudioContent = data.type === CanvasNodeType.Audio && Boolean(data.metadata?.content || data.metadata?.storageKey);
    const mediaDimensionLabel = formatMediaDimensionLabel(data, hasImageContent || hasVideoContent);
    const isComposerNode = data.type === CanvasNodeType.Config;
    const isLocalUploadedAsset = isLocalReadOnlyAssetNode(data);
    const isBatchRoot = data.type === CanvasNodeType.Image && Boolean(data.metadata?.isBatchRoot) && batchCount > 1;
    const isBatchChild = data.type === CanvasNodeType.Image && Boolean(data.metadata?.batchRootId);
    const isActive = isConnectionTarget || isSelected || isFocusRelated;
    const inlineStatus = data.metadata?.status === "loading" || data.metadata?.status === "error" ? data.metadata.status : null;
    const nodeState = isFocusRelated ? "focus" : isConnectionTarget ? "target" : isSelected ? "selected" : isRelated && !isBatchChild ? "related" : "idle";
    const showOutputConnection = getNodeDefinition(data.type)?.showOutputConnection !== false;
    const assetTags = data.metadata?.assetTags?.filter((tag) => tag.trim()) || [];
    const scriptMinHeight = data.type === CanvasNodeType.Script ? storyboardMinNodeHeight(data.metadata?.storyboardComposerHeight) : null;
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
        if (!isEditingTitle) setTitleDraft(data.title);
    }, [data.title, isEditingTitle]);

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
            const minSize = getNodeMinSize(data.type);
            const minWidth = minSize.width;
            // 分镜脚本的高度由表格内容动态撑开，覆盖注册表里的静态下限。
            const minHeight = scriptMinHeight || minSize.height;
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
            keepRatio: shouldKeepAspectRatio(data),
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

    const commitTitle = () => {
        const next = titleDraft.trim();
        setIsEditingTitle(false);
        if (!next) {
            setTitleDraft(data.title);
            return;
        }
        if (next !== data.title) onTitleChange?.(data.id, next);
    };

    const dragActive = isDragging ?? Boolean(dragOffset);
    const canEditTextInline = !readOnly && data.type === CanvasNodeType.Text && !(data.metadata?.workflowKind === "character" && data.metadata.characterAssetId);
    const startEditingContent = useCallback(() => setIsEditingContent(true), []);
    const versionBadgeBackground = data.metadata?.versionPrimary
        ? theme.accent.primary
        : canvasThemeName === "dark"
            ? theme.node.panel
            : theme.node.activeStroke;
    const versionBadgeForeground = data.metadata?.versionPrimary
        ? theme.accent.onPrimary
        : canvasThemeName === "dark"
            ? theme.node.text
            : theme.accent.onPrimary;

    return (
        <div
            data-node-id={data.id}
            className={`node-element absolute flex select-none flex-col ${dragActive ? "cursor-grabbing" : data.type === CanvasNodeType.Drawing ? "cursor-pointer" : "cursor-default"} ${isSelected && data.type === CanvasNodeType.Video ? "z-[var(--z-node-toolbar)]" : isSelected || isFocusRelated || isConnectionTarget ? "z-[var(--z-node-active)]" : "z-[var(--z-node)]"}`}
            style={{
                // The main canvas applies transient movement through the CSS compositor.
                // Keep dragOffset for shared/read-only canvases that do not use that path.
                transform: `translate(${data.position.x + (dragOffset?.x || 0)}px, ${data.position.y + (dragOffset?.y || 0)}px)`,
                width: data.width,
                height: data.height,
                contain: "layout style",
            }}
            onMouseEnter={() => {
                setHovered(true);
                onHoverStart(data.id);
                if (data.type === CanvasNodeType.Video) onMediaPreloadRequest?.(data.id);
            }}
            onMouseLeave={() => {
                setHovered(false);
                onHoverEnd(data.id);
                if (data.type === CanvasNodeType.Video && !mediaActive) onMediaPreloadCancel?.(data.id);
            }}
            onContextMenu={(event) => onContextMenu(event, data.id)}
        >
            <NodeExternalHeader
                node={data}
                scale={scale}
                dimensionLabel={mediaDimensionLabel}
                active={isSelected || isFocusRelated}
                editable={!readOnly && !data.metadata?.locked && Boolean(onTitleChange)}
                editing={isEditingTitle}
                draft={titleDraft}
                theme={theme}
                onDraftChange={setTitleDraft}
                onEdit={() => setIsEditingTitle(true)}
                onCommit={commitTitle}
                onCancel={() => { setTitleDraft(data.title); setIsEditingTitle(false); }}
            />
            <div
                className={`canvas-node-shell relative h-full w-full overflow-visible ${isComposerNode ? "rounded-[var(--node-radius)]" : "canvas-node-card rounded-[var(--canvas-node-card-radius)]"}`}
                data-node-card={!isComposerNode ? "true" : undefined}
                data-node-selected={isSelected ? "true" : "false"}
                data-node-state={nodeState}
                data-connection-tilt={connectionTilt ? "true" : undefined}
                data-state={data.metadata?.status || (isActive ? "active" : isRelated ? "related" : "idle")}
                style={{
                    background: isComposerNode ? theme.node.fill : hasImageContent || hasVideoContent ? "transparent" : theme.node.cardFill,
                    // 固定占位但不绘制描边，避免聚焦切换时边框宽度变化造成白边跳动。
                    border: isComposerNode ? "0" : `1px solid ${theme.node.stroke}`,
                    boxShadow: isComposerNode ? "none" : hovered ? theme.node.hoverShadow : theme.node.shadow,
                    ["--canvas-node-selection-stroke" as string]: theme.node.selectionStroke,
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
                    if (data.type === CanvasNodeType.Drawing) {
                        event.stopPropagation();
                        onOpenDrawing?.(data);
                        return;
                    }
                    if (!readOnly && data.type === CanvasNodeType.Text && data.metadata?.workflowKind === "character" && data.metadata.characterAssetId) {
                        event.stopPropagation();
                        onOpenTextEditor?.(data);
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
                            background: isComposerNode ? theme.node.fill : hasImageContent || hasVideoContent || hasAudioContent ? "transparent" : theme.node.cardFill,
                            "--batch-from-x": `${batchMotion?.x || 0}px`,
                            "--batch-from-y": `${batchMotion?.y || 0}px`,
                            "--batch-from-rotate": `${6 + (batchMotion?.index || 0) * 4}deg`,
                            animation: isBatchChild && (batchClosing || batchOpening) ? (batchClosing ? `canvas-batch-child-out var(--motion-dur-base-calc) var(--motion-ease-in-out) both` : `canvas-batch-child-in var(--motion-dur-slow-calc) var(--motion-ease-out) both`) : undefined,
                            animationDelay: isBatchChild && (batchClosing || batchOpening) ? `${batchClosing ? 0 : 45 + (batchMotion?.index || 0) * 24}ms` : undefined,
                        } as React.CSSProperties
                    }
                >
                    {/* 节点状态徽章（对应 #97 决策2：左上角 loading/success/error，近距离确认信号）*/}
                    {shouldShowInlineNodeStatus(data) && inlineStatus && data.type !== CanvasNodeType.Frame ? (
                        <NodeStatusBadge status={inlineStatus} />
                    ) : null}
                    <CanvasNodeContent
                        node={data}
                        theme={theme}
                        isEditingContent={isEditingContent}
                        textareaRef={textareaRef}
                        isBatchRoot={isBatchRoot}
                        batchCount={batchCount}
                        batchPreviewNodes={batchPreviewNodes}
                        batchExpanded={batchExpanded}
                        batchOpening={batchOpening}
                        batchRecovering={batchRecovering}
                        renderNodeContent={renderNodeContent}
                        drawingProjectId={drawingProjectId}
                        mentionReferences={mentionReferences}
                        onContentChange={onContentChange}
                        onStartEditing={canEditTextInline ? startEditingContent : undefined}
                        onStopEditing={() => setIsEditingContent(false)}
                        onRetry={onRetry}
                        onReloadResource={onReloadResource}
                        onOpenTaskDetails={onOpenTaskDetails}
                        onReplaceMedia={onReplaceMedia}
                        onToggleBatch={() => onToggleBatch?.(data.id)}
                        reduceMediaEffects={reduceMediaEffects}
                        mediaActive={mediaActive}
                        onMediaPlayRequest={onMediaPlayRequest}
                        mediaPreloadRequested={mediaPreloadRequested}
                    />
                </div>

                {data.metadata?.versionLabel ? (
                    <button
                        type="button"
                        className="absolute left-2.5 top-2.5 z-[var(--node-z-overlay)] grid size-7 place-items-center rounded-[var(--r-full)] border p-0 font-sans text-xs font-semibold leading-none tracking-tight shadow-[var(--canvas-icon-shadow)] backdrop-blur-md transition-[transform,background,border-color,box-shadow] hover:-translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:hover:translate-y-0"
                        style={{
                            background: versionBadgeBackground,
                            borderColor: data.metadata.versionPrimary ? theme.accent.primary : theme.node.text,
                            color: versionBadgeForeground,
                            outlineColor: theme.accent.primary,
                        }}
                        title={data.metadata.versionLabel + (data.metadata.versionPrimary ? " · 主版本" : "") + "，点击查看版本对比"}
                        aria-label={data.metadata.versionLabel + (data.metadata.versionPrimary ? "，主版本" : "") + "，查看版本对比"}
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={(event) => { event.stopPropagation(); onOpenVersions?.(data); }}
                    >
                        {data.metadata.versionLabel}
                    </button>
                ) : null}
                {/* 批次子图操作条：成功子项提供下载/副本/设为主图，失败子项提供重试/删除 */}
                {isBatchChild && !readOnly && (hasImageContent || data.metadata?.status === "error") && (hovered || isSelected) ? (
                    <div
                        className="absolute inset-x-0 bottom-2 z-[var(--node-z-overlay)] flex justify-center"
                        onMouseDown={(event) => event.stopPropagation()}
                        onPointerDown={(event) => event.stopPropagation()}
                    >
                        <div className="flex items-center gap-0.5 rounded-[var(--r-md)] border px-1 py-1 backdrop-blur-xl" style={{ background: `${theme.toolbar.panel}e6`, borderColor: theme.toolbar.border }}>
                            {hasImageContent ? <BatchChildActionButton theme={theme} label="下载图片" icon={<Download className="size-3.5" />} onClick={() => downloadNode?.(data)} /> : null}
                            {hasImageContent ? <BatchChildActionButton theme={theme} label="创建副本" icon={<Copy className="size-3.5" />} onClick={() => duplicateNode?.(data)} /> : null}
                            {hasImageContent ? (
                                <BatchChildActionButton theme={theme} label={batchPrimary ? "当前主图" : "设为主图"} icon={<Star className={`size-3.5 ${batchPrimary ? "fill-current" : ""}`} style={{ color: theme.accent.primary }} />} onClick={() => onSetBatchPrimary?.(data)} />
                            ) : null}
                            {data.metadata?.status === "error" && data.metadata.resourceReloadAvailable ? <BatchChildActionButton theme={theme} label="重新加载资源" icon={<Download className="size-3.5" />} onClick={() => onReloadResource?.(data)} /> : null}
                            {data.metadata?.status === "error" ? <BatchChildActionButton theme={theme} label="重新生成" icon={<RefreshCw className="size-3.5" />} onClick={() => onRetry?.(data)} /> : null}
                            {data.metadata?.status === "error" ? <BatchChildActionButton theme={theme} label="删除" icon={<Trash2 className="size-3.5" />} danger onClick={() => deleteNode?.(data)} /> : null}
                        </div>
                    </div>
                ) : null}
                {/* 批次主图位（折叠根节点封面）常驻下载按钮 */}
                {isBatchRoot && hasImageContent && !readOnly ? (
                    <div className="absolute bottom-2 right-2 z-[var(--node-z-overlay)]" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                        <BatchChildActionButton theme={theme} label="下载主图" icon={<Download className="size-3.5" />} onClick={() => downloadNode?.(data)} />
                    </div>
                ) : null}
                {assetTags.length || (showImageInfo && hasImageContent) ? (
                    <div className="pointer-events-none absolute inset-x-3 bottom-3 z-[var(--node-z-overlay)] flex items-end justify-between gap-2">
                        {assetTags.length ? <AssetTagBadges tags={assetTags} theme={theme} /> : null}
                        {showImageInfo && hasImageContent ? <CanvasNodeImageInfo node={data} /> : null}
                    </div>
                ) : null}

                {!readOnly && !data.metadata?.locked && (isSelected || hovered) ? <>
                    <ResizeHandle corner="top-left" onMouseDown={handleResizeMouseDown} />
                    <ResizeHandle corner="top-right" onMouseDown={handleResizeMouseDown} />
                    <ResizeHandle corner="bottom-left" onMouseDown={handleResizeMouseDown} />
                    <ResizeHandle corner="bottom-right" onMouseDown={handleResizeMouseDown} />
                </> : null}
            </div>

            {!readOnly && !isLocalUploadedAsset && data.type !== CanvasNodeType.Script ? <ConnectionSideRail side="left" scale={scale} theme={theme} visible={hovered || forceInputVisible} onPointerDown={(event, anchorRatio) => onConnectStart(event, data.id, "target", undefined, anchorRatio)} /> : null}
            {!readOnly && data.type !== CanvasNodeType.Script && data.type !== CanvasNodeType.Config && showOutputConnection ? <ConnectionSideRail side="right" scale={scale} theme={theme} visible={hovered} onPointerDown={(event, anchorRatio) => onConnectStart(event, data.id, "source", undefined, anchorRatio)} /> : null}

        </div>
    );
}, areCanvasNodePropsEqual);

function areCanvasNodePropsEqual(previous: CanvasNodeProps, next: CanvasNodeProps) {
    return (
        previous.data === next.data &&
        previous.isDragging === next.isDragging &&
        previous.dragOffset?.x === next.dragOffset?.x &&
        previous.dragOffset?.y === next.dragOffset?.y &&
        previous.scale === next.scale &&
        previous.isSelected === next.isSelected &&
        previous.mediaActive === next.mediaActive &&
        previous.mediaPreloadRequested === next.mediaPreloadRequested &&
        previous.isRelated === next.isRelated &&
        previous.isFocusRelated === next.isFocusRelated &&
        previous.isConnectionTarget === next.isConnectionTarget &&
        previous.connectionApproach?.x === next.connectionApproach?.x &&
        previous.connectionApproach?.y === next.connectionApproach?.y &&
        previous.forceInputVisible === next.forceInputVisible &&
        previous.showImageInfo === next.showImageInfo &&
        previous.reduceMediaEffects === next.reduceMediaEffects &&
        previous.readOnly === next.readOnly &&
        previous.mentionReferences === next.mentionReferences &&
        previous.renderNodeContent === next.renderNodeContent &&
        previous.drawingProjectId === next.drawingProjectId &&
        previous.batchCount === next.batchCount &&
        previous.batchPreviewNodes === next.batchPreviewNodes &&
        previous.batchExpanded === next.batchExpanded &&
        previous.batchClosing === next.batchClosing &&
        previous.batchOpening === next.batchOpening &&
        previous.batchRecovering === next.batchRecovering &&
        previous.batchPrimary === next.batchPrimary &&
        previous.batchMotion?.x === next.batchMotion?.x &&
        previous.batchMotion?.y === next.batchMotion?.y &&
        previous.batchMotion?.index === next.batchMotion?.index &&
        previous.onMouseDown === next.onMouseDown &&
        previous.onHoverStart === next.onHoverStart &&
        previous.onHoverEnd === next.onHoverEnd &&
        previous.onConnectStart === next.onConnectStart &&
        previous.onResize === next.onResize &&
        previous.onTitleChange === next.onTitleChange &&
        previous.onContentChange === next.onContentChange &&
        previous.onToggleBatch === next.onToggleBatch &&
        previous.onSetBatchPrimary === next.onSetBatchPrimary &&
        previous.onRetry === next.onRetry &&
        previous.onReloadResource === next.onReloadResource &&
        previous.onOpenTaskDetails === next.onOpenTaskDetails &&
        previous.onOpenVersions === next.onOpenVersions &&
        previous.onViewImage === next.onViewImage &&
        previous.onReplaceMedia === next.onReplaceMedia &&
        previous.onOpenTextEditor === next.onOpenTextEditor &&
        previous.onOpenDirector === next.onOpenDirector &&
        previous.onOpenDrawing === next.onOpenDrawing &&
        previous.onContextMenu === next.onContextMenu
    );
}

function BatchChildActionButton({ theme, label, icon, onClick, danger = false }: { theme: CanvasTheme; label: string; icon: ReactNode; onClick: () => void; danger?: boolean }) {
    return (
        <button
            type="button"
            data-canvas-no-zoom
            className="canvas-node-inline-action grid size-8 place-items-center rounded-[var(--r-sm)] p-0 backdrop-blur-xl transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            style={{ color: danger ? theme.accent.danger : theme.node.text, outlineColor: theme.accent.primary }}
            title={label}
            aria-label={label}
            onClick={(event) => { event.stopPropagation(); onClick(); }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            {icon}
        </button>
    );
}

function AssetTagBadges({ tags, theme }: { tags: string[]; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    return (
        <div className="flex min-w-0 flex-1 flex-wrap items-end gap-1">
            {tags.map((tag, index) => (
                <span
                    key={`${tag}-${index}`}
                    className="max-w-full truncate rounded-md border px-1.5 py-1 text-[var(--fs-tiny)] font-medium leading-none backdrop-blur-sm"
                    style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                >
                    {tag.trim()}
                </span>
            ))}
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

    return <div className={`absolute z-[var(--node-z-handle)] size-7 ${positionClass}`} onMouseDown={(event) => onMouseDown(event, corner)} />;
}

const NODE_EXTERNAL_HEADER_MIN_SCALE = 0.35;

function formatMediaDimensionLabel(node: CanvasNodeData, hasVisualMediaContent: boolean) {
    const width = node.metadata?.naturalWidth;
    const height = node.metadata?.naturalHeight;
    if (!hasVisualMediaContent || !Number.isFinite(width) || !Number.isFinite(height) || !width || !height || width <= 0 || height <= 0) return null;
    return `${Math.round(width)}*${Math.round(height)}`;
}

function NodeExternalHeader({ node, scale, dimensionLabel, active, editable, editing, draft, theme, onDraftChange, onEdit, onCommit, onCancel }: {
    node: CanvasNodeData;
    scale: number;
    dimensionLabel: string | null;
    active: boolean;
    editable: boolean;
    editing: boolean;
    draft: string;
    theme: CanvasTheme;
    onDraftChange: (value: string) => void;
    onEdit: () => void;
    onCommit: () => void;
    onCancel: () => void;
}) {
    // 标题保持屏幕尺寸只适用于近景；远景继续反向缩放会遮住节点和连线。
    if (scale < NODE_EXTERNAL_HEADER_MIN_SCALE && !editing) return null;
    const inverseScale = 1 / Math.max(scale, 0.05);
    const Icon = nodeTypeIcon(node.type);
    const isTextNode = node.type === CanvasNodeType.Text;
    const maxHeaderWidth = Math.min(240, node.width * scale);

    return (
        <div
            className="canvas-node-external-header absolute bottom-full left-0 z-[var(--node-z-overlay)] flex h-6 items-center gap-1 overflow-hidden"
            style={{
                width: dimensionLabel ? "calc(var(--canvas-node-width) * var(--canvas-live-scale, 1))" : undefined,
                maxWidth: dimensionLabel ? undefined : maxHeaderWidth,
                "--canvas-node-width": `${node.width}px`,
                borderRadius: "var(--r-sm)",
                background: "transparent",
                paddingInline: "var(--space-1-half)",
                color: active ? theme.node.text : theme.node.label,
                transform: `scale(var(--canvas-live-inverse-scale, ${inverseScale}))`,
                transformOrigin: "left bottom",
            } as React.CSSProperties}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <div className="flex min-w-0 items-center gap-1" style={{ maxWidth: maxHeaderWidth }}>
                <Icon className="size-3 shrink-0" strokeWidth={1.8} />
                {editing ? (
                    <input
                        autoFocus
                        value={draft}
                        className="h-6 min-w-20 max-w-[190px] flex-1 truncate rounded bg-transparent px-1.5 text-xs font-medium outline-none"
                        style={{ background: "transparent", color: theme.node.text }}
                        onChange={(event) => onDraftChange(event.target.value)}
                        onFocus={(event) => event.currentTarget.select()}
                        onBlur={onCommit}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") event.currentTarget.blur();
                            if (event.key === "Escape") onCancel();
                        }}
                        aria-label="节点名称"
                    />
                ) : editable ? (
                    <button type="button" className="group flex min-w-0 flex-1 items-center gap-1 rounded px-0.5 text-xs font-medium outline-none transition-opacity hover:opacity-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1" style={{ opacity: active ? 1 : 0.78, outlineColor: theme.node.muted }} onClick={onEdit} aria-label={`编辑节点名称：${node.title}`}>
                        <span className="min-w-0 flex-1 truncate" title={node.title}>{node.title}</span>
                        <Pencil className="size-2.5 shrink-0 opacity-55 transition-opacity group-hover:opacity-100" />
                    </button>
                ) : (
                    <span className="min-w-0 flex-1 truncate text-xs font-medium" title={node.title} style={{ opacity: active ? 1 : 0.78 }}>{node.title}</span>
                )}
            </div>
            {dimensionLabel ? <span className="ml-auto shrink-0 whitespace-nowrap text-[var(--fs-micro)] font-medium leading-none tabular-nums" style={{ color: theme.node.muted }}>{dimensionLabel}</span> : null}
        </div>
    );
}

function nodeTypeIcon(type: CanvasNodeTypeId) {
    if (type === CanvasNodeType.Image) return ImageIcon;
    if (type === CanvasNodeType.Video) return Video;
    if (type === CanvasNodeType.Audio) return Music2;
    if (type === CanvasNodeType.Drawing) return Pencil;
    if (type === CanvasNodeType.Script) return Clapperboard;
    if (type === CanvasNodeType.Config) return Settings2;
    if (type === CanvasNodeType.MediaConversion) return WandSparkles;
    if (type === CanvasNodeType.Skill) return BookOpenCheck;
    if (type === ART_CRITIQUE_NODE_TYPE) return ScanSearch;
    return Type;
}

// 节点状态徽章（对应 #97 决策2：左上角状态指示，loading/success/error）
function NodeStatusBadge({ status }: { status: "loading" | "success" | "error" }) {
    if (status === "loading") {
        return (
            <div
                className="pointer-events-none absolute left-2 top-2 z-20 flex items-center gap-1 rounded-full px-2 py-0.5 backdrop-blur-sm"
                style={{ background: "color-mix(in oklch, var(--status-loading) 20%, transparent)", color: "var(--status-loading)" }}
                aria-label="生成中"
            >
                <span className="size-1.5 animate-pulse rounded-full" style={{ background: "var(--status-loading)" }} />
                <span className="text-[var(--fs-micro)] font-medium leading-none">生成中</span>
            </div>
        );
    }
    if (status === "error") {
        return (
            <div
                className="pointer-events-none absolute left-2 top-2 z-20 flex items-center gap-1 rounded-full px-2 py-0.5 backdrop-blur-sm"
                style={{ background: "color-mix(in oklch, var(--status-error) 20%, transparent)", color: "var(--status-error)" }}
                aria-label="生成失败"
            >
                <AlertCircle className="size-3" strokeWidth={2} />
                <span className="text-[var(--fs-micro)] font-medium leading-none">失败</span>
            </div>
        );
    }
    // success：短暂闪现后淡出（由 CSS animation 控制，2s 后消失）
    return (
        <div
            className="pointer-events-none absolute left-2 top-2 z-20 flex items-center gap-1 rounded-full px-2 py-0.5 backdrop-blur-sm"
            style={{ background: "color-mix(in oklch, var(--status-success) 20%, transparent)", color: "var(--status-success)", animation: "canvas-status-success-fade 2s ease-out forwards" }}
            aria-label="生成完成"
        >
            <CheckCircle2 className="size-3" strokeWidth={2} />
            <span className="text-[var(--fs-micro)] font-medium leading-none">完成</span>
        </div>
    );
}

function ConnectionSideRail({ side, scale, theme, visible = false, onPointerDown }: { side: "left" | "right"; scale: number; theme: CanvasTheme; visible?: boolean; onPointerDown: (event: React.PointerEvent, anchorRatio: number) => void }) {
    const railRef = useRef<HTMLButtonElement>(null);
    const pinRef = useRef<HTMLSpanElement>(null);
    const inverseScale = 1 / Math.max(scale, 0.05);
    const animationFrameRef = useRef<number | null>(null);
    const pointerInsideRef = useRef(false);
    const targetOffsetRef = useRef({ x: 0, y: 0 });
    const currentOffsetRef = useRef({ x: 0, y: 0 });
    // Keep the hit rail fixed. Moving the hit target itself makes adjacent
    // rails repeatedly steal pointer events and causes the pin to jump.
    const handleSize = 24;
    const restOffset = side === "left" ? "24px" : "-24px";
    const railStyle = {
        cursor: "crosshair",
        "--canvas-connection-plus-rest-x": restOffset,
        ...(side === "left" ? { right: "100%" } : { left: "100%" }),
    } as React.CSSProperties & Record<"--canvas-connection-plus-rest-x", string>;

    const animatePin = () => {
        animationFrameRef.current = null;
        const pin = pinRef.current;
        if (!pin || !pointerInsideRef.current) return;
        const current = currentOffsetRef.current;
        const target = targetOffsetRef.current;
        current.x += (target.x - current.x) * 0.22;
        current.y += (target.y - current.y) * 0.22;
        pin.style.transform = `translate3d(${current.x}px, ${current.y}px, 0)`;
        if (Math.abs(target.x - current.x) > 0.1 || Math.abs(target.y - current.y) > 0.1) {
            animationFrameRef.current = requestAnimationFrame(animatePin);
        }
    };

    const updatePinTarget = (event: React.PointerEvent<HTMLButtonElement>) => {
        const rail = railRef.current;
        if (!rail) return;
        const bounds = rail.getBoundingClientRect();
        const followLimit = 30;
        const deltaX = event.clientX - (bounds.left + bounds.width / 2);
        const deltaY = event.clientY - (bounds.top + bounds.height / 2);
        targetOffsetRef.current = {
            x: Math.max(-followLimit, Math.min(followLimit, deltaX)) * inverseScale,
            y: Math.max(-followLimit, Math.min(followLimit, deltaY)) * inverseScale,
        };
        if (animationFrameRef.current === null) animationFrameRef.current = requestAnimationFrame(animatePin);
    };

    return (
        <button
            ref={railRef}
            type="button"
            data-canvas-connection-rail={side}
            data-visible={visible ? "true" : "false"}
            className="canvas-connection-rail canvas-connection-handle group pointer-events-auto absolute top-1/2 z-[var(--node-z-overlay)] flex items-center justify-center touch-none cursor-crosshair rounded-full outline-none"
            style={railStyle}
            onPointerEnter={(event) => {
                pointerInsideRef.current = true;
                updatePinTarget(event);
            }}
            onPointerMove={updatePinTarget}
            onPointerLeave={() => {
                pointerInsideRef.current = false;
                targetOffsetRef.current = { x: 0, y: 0 };
                currentOffsetRef.current = { x: 0, y: 0 };
                if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
                animationFrameRef.current = null;
                pinRef.current?.style.removeProperty("transform");
            }}
            onPointerDown={(event) => onPointerDown(event, 0.5)}
            aria-label={`${side === "left" ? "输入" : "输出"}连接点，单击创建节点或拖动连线`}
        >
            <span
                ref={pinRef}
                className="absolute left-1/2 top-1/2 block transition-[filter] duration-150 ease-out group-hover:brightness-125 group-focus-visible:brightness-125"
                style={{
                    width: handleSize,
                    height: handleSize,
                    marginLeft: -handleSize / 2,
                    marginTop: -handleSize / 2,
                    willChange: "transform",
                }}
            >
                <svg
                    aria-hidden="true"
                    className="block"
                    width={handleSize}
                    height={handleSize}
                    viewBox="0 0 20 20"
                    fill="none"
                    style={{
                        position: "absolute",
                        left: "50%",
                        top: "50%",
                        marginLeft: -handleSize / 2,
                        marginTop: -handleSize / 2,
                        shapeRendering: "geometricPrecision",
                    }}
                >
                    <circle cx="10" cy="10" r="9.2" fill={theme.spatial.elevated} />
                    <circle cx="10" cy="10" r="9.2" stroke={theme.node.activeStroke} strokeWidth="1.25" />
                    <path d="M10 5.5v9M5.5 10h9" stroke={theme.node.activeStroke} strokeWidth="1.8" strokeLinecap="round" />
                </svg>
            </span>
        </button>
    );
}
