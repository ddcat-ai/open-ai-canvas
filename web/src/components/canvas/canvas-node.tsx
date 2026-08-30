import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AlertCircle, BookOpenCheck, CheckCircle2, ChevronRight, Clapperboard, Copy, Download, Image as ImageIcon, Lock, Maximize2, Music2, Pencil, RefreshCw, Settings2, Star, Trash2, Type, Video } from "lucide-react";

import { useCanvasNodeActions } from "./canvas-node-action-context";

import { canvasThemes } from "@/lib/canvas-theme";
import { storyboardMinNodeHeight } from "@/lib/canvas/canvas-storyboard-layout";
import { resourceStorageLabel, resourceStorageLocation, resourceStorageTitle } from "@/lib/canvas/resource-storage-status";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeTypeId, type Position } from "@/types/canvas";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { PortraitClearanceIcon } from "@/components/canvas/portrait-clearance/portrait-clearance-icon";
import { PORTRAIT_CLEARANCE_NODE_TYPE } from "@/lib/portrait-clearance/contracts";
import { getNodeDefinition, getNodeMinSize, shouldKeepAspectRatio } from "@/lib/canvas/node-registry";
import { CanvasNodeContent, CanvasNodeImageInfo } from "./canvas-node-content";

type ResizeCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
type CanvasTheme = (typeof canvasThemes)[keyof typeof canvasThemes];

type CanvasNodeProps = {
    data: CanvasNodeData;
    dragOffset?: Position;
    scale: number;
    isSelected: boolean;
    mediaActive?: boolean;
    hydrateMediaPreview?: boolean;
    isRelated: boolean;
    isFocusRelated: boolean;
    isConnectionTarget: boolean;
    forceInputVisible?: boolean;
    showImageInfo: boolean;
    reduceMediaEffects?: boolean;
    readOnly?: boolean;
    resourceLabel?: CanvasResourceReference;
    mentionReferences?: CanvasResourceReference[];
    renderNodeContent?: (node: CanvasNodeData) => ReactNode;
    drawingProjectId?: string;
    batchCount?: number;
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
    onContextMenu: (event: React.MouseEvent, nodeId: string) => void;
};

export const CanvasNode = React.memo(function CanvasNode({
    data,
    dragOffset,
    scale,
    isSelected,
    mediaActive = false,
    hydrateMediaPreview = false,
    isRelated,
    isFocusRelated,
    isConnectionTarget,
    forceInputVisible = false,
    showImageInfo,
    reduceMediaEffects = false,
    readOnly = false,
    resourceLabel,
    mentionReferences = [],
    renderNodeContent,
    drawingProjectId,
    batchCount = 0,
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
    onOpenVersions,
    onViewImage,
    onOpenTextEditor,
    onOpenDirector,
    onOpenDrawing,
    onContextMenu,
}: CanvasNodeProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [hovered, setHovered] = useState(false);
    const [isEditingContent, setIsEditingContent] = useState(false);
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [titleDraft, setTitleDraft] = useState(data.title);
    const { download: downloadNode, duplicate: duplicateNode, deleteNode } = useCanvasNodeActions();
    const hasImageContent = data.type === CanvasNodeType.Image && Boolean(data.metadata?.content);
    const hasVideoContent = data.type === CanvasNodeType.Video && Boolean(data.metadata?.content);
    const hasAudioContent = data.type === CanvasNodeType.Audio && Boolean(data.metadata?.content || data.metadata?.storageKey);
    const mediaDimensionLabel = formatMediaDimensionLabel(data, hasImageContent || hasVideoContent);
    const isComposerNode = data.type === CanvasNodeType.Config;
    const hasMediaContent = hasImageContent || hasVideoContent || hasAudioContent;
    const isBatchRoot = data.type === CanvasNodeType.Image && Boolean(data.metadata?.isBatchRoot) && batchCount > 1;
    const isBatchChild = data.type === CanvasNodeType.Image && Boolean(data.metadata?.batchRootId);
    const showStatusTrack = Boolean(resourceLabel || data.metadata?.locked || isBatchRoot || (isBatchChild && !readOnly) || (hasMediaContent && !readOnly));
    const isActive = isConnectionTarget || isSelected || isFocusRelated;
    const nodeState = isFocusRelated ? "focus" : isConnectionTarget ? "target" : isSelected ? "selected" : isRelated && !isBatchChild ? "related" : "idle";
    const showOutputConnection = data.type !== PORTRAIT_CLEARANCE_NODE_TYPE && getNodeDefinition(data.type)?.showOutputConnection !== false;
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

    return (
        <div
            data-node-id={data.id}
            className={`node-element absolute flex select-none flex-col ${dragOffset ? "cursor-grabbing" : data.type === CanvasNodeType.Drawing ? "cursor-pointer" : "cursor-default"} ${isSelected && data.type === CanvasNodeType.Video ? "z-[var(--z-node-toolbar)]" : isSelected || isFocusRelated || isConnectionTarget ? "z-[var(--z-node-active)]" : "z-[var(--z-node)]"}`}
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
                className="canvas-node-shell relative h-full w-full overflow-visible rounded-[var(--node-radius)]"
                data-node-state={nodeState}
                data-state={data.metadata?.status || (isActive ? "active" : isRelated ? "related" : "idle")}
                style={{
                    background: hasImageContent || hasVideoContent ? "transparent" : theme.node.fill,
                    // 固定占位但不绘制描边，避免聚焦切换时边框宽度变化造成白边跳动。
                    border: isComposerNode ? "0" : "1px solid transparent",
                    boxShadow: isComposerNode ? "none" : isSelected || isFocusRelated ? theme.node.hoverShadow : theme.node.shadow,
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
                            background: hasImageContent || hasVideoContent || hasAudioContent ? "transparent" : theme.node.fill,
                            "--batch-from-x": `${batchMotion?.x || 0}px`,
                            "--batch-from-y": `${batchMotion?.y || 0}px`,
                            "--batch-from-rotate": `${6 + (batchMotion?.index || 0) * 4}deg`,
                            animation: data.metadata?.batchRootId ? (batchClosing ? `canvas-batch-child-out var(--motion-dur-base-calc) var(--motion-ease-in-out) both` : `canvas-batch-child-in var(--motion-dur-slow-calc) var(--motion-ease-out) both`) : undefined,
                            animationDelay: data.metadata?.batchRootId ? `${batchClosing ? 0 : 45 + (batchMotion?.index || 0) * 24}ms` : undefined,
                        } as React.CSSProperties
                    }
                >
                    {/* 节点状态徽章（对应 #97 决策2：左上角 loading/success/error，近距离确认信号）*/}
                    {data.metadata?.status && data.metadata.status !== "idle" && data.type !== CanvasNodeType.Frame ? (
                        <NodeStatusBadge status={data.metadata.status} />
                    ) : null}
                    <CanvasNodeContent
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
                        drawingProjectId={drawingProjectId}
                        mentionReferences={mentionReferences}
                        onContentChange={onContentChange}
                        onStopEditing={() => setIsEditingContent(false)}
                        onRetry={onRetry}
                        onReloadResource={onReloadResource}
                        onOpenTaskDetails={onOpenTaskDetails}
                        onToggleBatch={() => onToggleBatch?.(data.id)}
                        reduceMediaEffects={reduceMediaEffects}
                        mediaActive={mediaActive}
                        hydrateMediaPreview={hydrateMediaPreview}
                    />
                </div>

                {data.type === CanvasNodeType.Text && data.metadata?.workflowKind !== "character" && !readOnly ? (
                    <div
                        className={`absolute bottom-[10%] left-1/2 z-[var(--node-z-overlay)] -translate-x-1/2 motion-safe:transition motion-safe:duration-200 ${isSelected ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"}`}
                        onMouseDown={(event) => event.stopPropagation()}
                        onPointerDown={(event) => event.stopPropagation()}
                    >
                        <button
                            type="button"
                            className="canvas-node-inline-action inline-flex h-9 items-center gap-2 px-3 text-xs font-medium backdrop-blur-xl transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                            style={{ outlineColor: theme.accent.primary }}
                            onClick={(event) => { event.stopPropagation(); onOpenTextEditor?.(data); }}
                            aria-label="放大编辑文本"
                        >
                            <Maximize2 className="size-3.5" />
                            放大编辑
                        </button>
                    </div>
                ) : null}

                {data.metadata?.versionLabel ? (
                    <button
                        type="button"
                        className="absolute left-3 top-3 z-[var(--node-z-overlay)] grid size-7 place-items-center rounded-[var(--r-full)] border p-0.5 text-[var(--node-badge-fs)] font-semibold leading-none backdrop-blur-md transition-[transform,background,border-color,box-shadow] hover:-translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:hover:translate-y-0"
                        style={{
                            background: data.metadata.versionPrimary ? theme.accent.primarySoft : theme.toolbar.panel,
                            borderColor: data.metadata.versionPrimary ? theme.accent.primary : theme.toolbar.border,
                            color: data.metadata.versionPrimary ? theme.accent.primary : theme.node.text,
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
                {showStatusTrack ? (
                    <div className={`absolute right-3 top-3 z-[var(--node-z-overlay)] flex min-w-0 items-center justify-end gap-1 ${data.metadata?.versionLabel ? "max-w-[calc(100%-104px)]" : "max-w-[calc(100%-24px)]"}`}>
                        {resourceLabel && data.type !== CanvasNodeType.Image ? <ResourceLabelBadge reference={resourceLabel} theme={theme} /> : null}
                        {hasMediaContent && !readOnly ? <ResourceStorageBadge storageKey={data.metadata?.storageKey} active={isActive} theme={theme} /> : null}
                        {isBatchRoot ? <BatchToggleBadge count={batchCount} expanded={batchExpanded} theme={theme} onToggle={() => onToggleBatch?.(data.id)} /> : null}
                        {isBatchChild && !readOnly ? <BatchPrimaryBadge visible={batchPrimary || hovered || isSelected} selected={batchPrimary} theme={theme} onSelect={() => onSetBatchPrimary?.(data)} /> : null}
                        {data.metadata?.locked ? <NodeLockBadge theme={theme} /> : null}
                    </div>
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

            {!readOnly && data.type !== CanvasNodeType.Script ? <ConnectionSideRail side="left" scale={scale} theme={theme} visible={hovered || forceInputVisible} onPointerDown={(event, anchorRatio) => onConnectStart(event, data.id, "target", undefined, anchorRatio)} /> : null}
            {!readOnly && data.type !== CanvasNodeType.Script && data.type !== CanvasNodeType.Config && showOutputConnection ? <ConnectionSideRail side="right" scale={scale} theme={theme} visible={hovered} onPointerDown={(event, anchorRatio) => onConnectStart(event, data.id, "source", undefined, anchorRatio)} /> : null}

        </div>
    );
}, areCanvasNodePropsEqual);

function areCanvasNodePropsEqual(previous: CanvasNodeProps, next: CanvasNodeProps) {
    return (
        previous.data === next.data &&
        previous.dragOffset?.x === next.dragOffset?.x &&
        previous.dragOffset?.y === next.dragOffset?.y &&
        previous.scale === next.scale &&
        previous.isSelected === next.isSelected &&
        previous.mediaActive === next.mediaActive &&
        previous.isRelated === next.isRelated &&
        previous.isFocusRelated === next.isFocusRelated &&
        previous.isConnectionTarget === next.isConnectionTarget &&
        previous.forceInputVisible === next.forceInputVisible &&
        previous.showImageInfo === next.showImageInfo &&
        previous.reduceMediaEffects === next.reduceMediaEffects &&
        previous.readOnly === next.readOnly &&
        previous.resourceLabel === next.resourceLabel &&
        previous.mentionReferences === next.mentionReferences &&
        previous.renderNodeContent === next.renderNodeContent &&
        previous.drawingProjectId === next.drawingProjectId &&
        previous.batchCount === next.batchCount &&
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

function ResourceLabelBadge({ reference, theme }: { reference: CanvasResourceReference; theme: CanvasTheme }) {
    return (
        <span className="pointer-events-none min-w-0 max-w-28 truncate rounded-md px-1.5 py-1 text-[var(--fs-tiny)] font-medium leading-none" style={{ background: reference.active ? theme.accent.primary : "rgba(0,0,0,.35)", color: reference.active ? theme.accent.onPrimary : "#ffffff", opacity: reference.active ? 1 : 0.75 }} title={reference.title || reference.label}>
            {reference.label}
        </span>
    );
}

function ResourceStorageBadge({ storageKey, active, theme }: { storageKey?: string; active: boolean; theme: CanvasTheme }) {
    const location = resourceStorageLocation(storageKey);
    const background = active ? (location === "local" ? "rgba(245,158,11,.9)" : theme.accent.primary) : "rgba(0,0,0,.35)";
    return (
        <span className="pointer-events-auto shrink-0 rounded-md px-1.5 py-1 text-[var(--fs-tiny)] font-medium leading-none" style={{ background, color: active && location !== "local" ? theme.accent.onPrimary : "#ffffff", opacity: active ? 1 : 0.75 }} title={resourceStorageTitle(storageKey)}>
            {resourceStorageLabel(storageKey)}
        </span>
    );
}

function NodeLockBadge({ theme }: { theme: CanvasTheme }) {
    return <span className="pointer-events-none grid size-7 shrink-0 place-items-center rounded-md border backdrop-blur" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.muted }} title="节点已锁定"><Lock className="size-3.5" /></span>;
}

function BatchToggleBadge({ count, expanded, theme, onToggle }: { count: number; expanded: boolean; theme: CanvasTheme; onToggle: () => void }) {
    return (
        <button type="button" className="canvas-node-tool-button inline-flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 text-[var(--fs-tiny)] font-semibold backdrop-blur-md" style={{ background: `${theme.toolbar.panel}d9`, borderColor: `${theme.toolbar.border}cc`, color: theme.node.text }} aria-label={expanded ? "图片组已展开" : "图片组已收起"} onClick={(event) => { event.stopPropagation(); onToggle(); }} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            <span className="leading-none" style={{ color: theme.accent.primary }}>{count}</span>
            <ChevronRight className={`size-3 opacity-55 transition-transform ${expanded ? "rotate-90" : ""}`} />
        </button>
    );
}

function BatchPrimaryBadge({ visible, selected, theme, onSelect }: { visible: boolean; selected: boolean; theme: CanvasTheme; onSelect: () => void }) {
    return (
        <button type="button" className={`canvas-node-tool-button inline-flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 text-[var(--fs-tiny)] font-medium backdrop-blur-md transition-opacity ${visible ? "opacity-100" : "pointer-events-none opacity-0"}`} style={{ background: theme.toolbar.panel, borderColor: selected ? theme.accent.primary : theme.toolbar.border, color: selected ? theme.accent.primary : theme.node.text }} aria-label={selected ? "当前主图" : "设置为主图"} aria-pressed={selected} onClick={(event) => { event.stopPropagation(); onSelect(); }} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            <Star className={`size-3 ${selected ? "fill-current" : ""}`} style={{ color: theme.accent.primary }} />
            {selected ? "当前主图" : "主图"}
        </button>
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
    if (type === CanvasNodeType.Skill) return BookOpenCheck;
    if (type === PORTRAIT_CLEARANCE_NODE_TYPE) return PortraitClearanceIcon;
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
    const handleRef = useRef<HTMLSpanElement>(null);
    const [railHovered, setRailHovered] = useState(false);
    const inverseScale = 1 / Math.max(scale, 0.05);
    const railSize = 80;
    // Keep the control responsive to zoom, but avoid sub-pixel circles and
    // strokes at far zoom levels where the plus sign appears visually off-center.
    const handleSize = Math.max(20, 8 * inverseScale);
    // LibTV centers the visual quick-add icon in an approximately 80px
    // circular hit zone, then offsets it toward the node edge. Keep that
    // visual layer separate from the real centered connection anchor.
    const sideOffset = side === "left" ? 25 : -25;

    const resetHandle = useCallback(() => {
        if (!handleRef.current) return;
        handleRef.current.style.transform = `translate(${sideOffset}px, 0) scale(1)`;
    }, [sideOffset]);

    const updateHandle = (event: React.PointerEvent<HTMLButtonElement>) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const width = Math.max(bounds.width, 1);
        const height = Math.max(bounds.height, 1);
        const followLimit = 30;
        const deltaX = event.clientX - (bounds.left + width / 2);
        const deltaY = event.clientY - (bounds.top + height / 2);
        const offsetScreenX = Math.max(-followLimit, Math.min(followLimit, deltaX));
        const offsetScreenY = Math.max(-followLimit, Math.min(followLimit, deltaY));
        const focus = 1 + Math.max(0, 1 - Math.hypot(offsetScreenX, offsetScreenY) / followLimit) * 0.1;
        // While the pointer is inside the rail LibTV uses the rail center as
        // the origin. The side-specific +/-25px offset is only the resting
        // position used after leaving the rail.
        const offsetX = offsetScreenX * inverseScale;
        const offsetY = offsetScreenY * inverseScale;
        if (handleRef.current) handleRef.current.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${focus})`;
    };

    return (
        <button
            type="button"
            data-canvas-connection-rail={side}
            className={`group pointer-events-auto absolute top-1/2 z-[var(--node-z-overlay)] flex -translate-y-1/2 items-center justify-center touch-none cursor-crosshair rounded-full outline-none transition-opacity duration-150 ${visible || railHovered ? "opacity-100" : "opacity-0"}`}
            style={{ width: railSize, height: `min(100%, ${railSize}px)`, cursor: "crosshair", ...(side === "left" ? { right: "100%" } : { left: "100%" }) }}
            onPointerEnter={(event) => {
                setRailHovered(true);
                updateHandle(event);
            }}
            onPointerMove={updateHandle}
            onPointerLeave={() => {
                setRailHovered(false);
                resetHandle();
            }}
            onPointerDown={(event) => onPointerDown(event, 0.5)}
            aria-label={`${side === "left" ? "输入" : "输出"}连接点，单击创建节点或拖动连线`}
        >
            <span
                ref={handleRef}
                className="absolute left-1/2 top-1/2 block transition-transform duration-[80ms] ease-out group-hover:brightness-125 group-focus-visible:brightness-125"
                style={{
                    width: handleSize,
                    height: handleSize,
                    marginLeft: -handleSize / 2,
                    marginTop: -handleSize / 2,
                    transform: `translate(${sideOffset}px, 0) scale(1)`,
                    transition: "transform 80ms ease-out",
                    transformOrigin: "center",
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
                    }}
                >
                    <circle cx="10" cy="10" r="9.35" fill={theme.spatial.elevated} />
                    <circle cx="10" cy="10" r="9.35" stroke={theme.node.activeStroke} strokeWidth="1.2" />
                    <path d="M10 6.5v7M6.5 10h7" stroke={theme.node.activeStroke} strokeWidth="1.5" strokeLinecap="round" />
                </svg>
            </span>
        </button>
    );
}
