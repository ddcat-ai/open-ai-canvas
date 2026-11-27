import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { App, Button, Input, Modal, Tag } from "antd";
import { AntTooltip as Tooltip } from "@/components/ui/base/tooltip/ant-tooltip";
import { CanvasAnchoredDropdown as Dropdown } from "./canvas-anchored-dropdown";
import type { MenuProps } from "antd";
import { Camera, Check, ChevronDown, ChevronRight, Ellipsis, Grid3x3, Palette, Plus, SlidersHorizontal, Wrench } from "lucide-react";

import { canvasDockStyle } from "@/lib/canvas/canvas-aceternity-style";
import { avoidCanvasNodePanels, canvasNodePanelBounds, canvasOverlayBounds, observeCanvasOverlayBounds, subscribeCanvasNodePanelBounds } from "@/lib/canvas/canvas-overlay-layout";
import { buildNodeToolbarEntries, resolvePinnedToolbarEntries, visibleToolbarEntryCount, type NodeToolbarEntry, type NodeToolbarTool } from "@/lib/canvas/node-toolbar-entries";
import { useNodeToolbarPreferences } from "@/hooks/use-node-toolbar-preferences";
import { ASSET_ASSIGNABLE_CATEGORY_OPTIONS } from "@/lib/asset-category";
import { canvasThemes } from "@/lib/canvas-theme";
import { resolveNodeToolbarPlacement, resolveToolbarTools, type ToolContext, type ToolbarHandlers } from "@/lib/canvas/tool-registry";
import { subscribeCanvasGraphicsViewportPreview, subscribeCanvasNodeDragPreview } from "@/lib/canvas/canvas-live-viewport";
import { canvasNodeAssetCategory } from "@/lib/canvas/canvas-node-asset";
import type { ImageSplitParams } from "@/lib/canvas/canvas-image-data";
import { formatBytes, getDataUrlByteSize } from "@/lib/image-utils";
import { generationErrorMessage } from "@/lib/generation-error";
import { useCopyText } from "@/hooks/use-copy-text";
import { producedModelLabel } from "@/lib/canvas/produced-model";
import { nodeGenerationPrompt } from "@/lib/canvas/generation-contract";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata, type CanvasWorkspaceMode, type Position, type ViewportTransform } from "@/types/canvas";
import { buildImageToolbarTools, getNineGridMenuItems } from "./canvas-image-toolbar-tools";
import { TOOL_ICON_MAP } from "./canvas-mention-chips";
import { CanvasGridSplitPicker } from "./canvas-grid-split-picker";
import { CanvasNineGridPicker } from "./canvas-nine-grid-picker";
import { CanvasToolMenuOption, CanvasToolMenuSurface } from "./canvas-tool-menu";
import { useCanvasNodeResizeMotion } from "./canvas-node-resize-motion";
import { NodeToolbarSettingsModal } from "./toolbars/node-toolbar-settings-modal";
import { translate } from "@/i18n";

type CanvasNodeToolbarProps = {
    node: CanvasNodeData | null;
    viewport: ViewportTransform;
    containerRef: RefObject<HTMLDivElement | null>;
    onKeep: (nodeId: string) => void;
    onLeave: () => void;
    onInfo: (node: CanvasNodeData) => void;
    onEditText: (node: CanvasNodeData) => void;
    onDecreaseFont: (node: CanvasNodeData) => void;
    onIncreaseFont: (node: CanvasNodeData) => void;
    onToggleDialog: (node: CanvasNodeData) => void;
    onAnnotate: (node: CanvasNodeData) => void;
    onAnnotationEdit: (node: CanvasNodeData) => void;
    onTextEdit: (node: CanvasNodeData) => void;
    onGenerateImage: (node: CanvasNodeData) => void;
    onUpload: (node: CanvasNodeData) => void;
    onDownload: (node: CanvasNodeData) => void;
    onDownloadSubtitles?: (node: CanvasNodeData) => void;
    onSaveAsset: (node: CanvasNodeData) => void;
    onRegionEdit: (node: CanvasNodeData) => void;
    onRemoveBackground: (node: CanvasNodeData) => void;
    onLayerDecomposition: (node: CanvasNodeData) => void;
    onEmotion: (node: CanvasNodeData) => void;
    onPortraitTexture: (node: CanvasNodeData) => void;
    onCrop: (node: CanvasNodeData) => void;
    onCreateEditCopy?: (node: CanvasNodeData) => void;
    onRotateImage?: (node: CanvasNodeData, direction: -1 | 0 | 1) => void;
    rotatingImage?: boolean;
    onSplit: (node: CanvasNodeData, params: ImageSplitParams) => void;
    onUpscale: (node: CanvasNodeData) => void;
    onSuperResolve: (node: CanvasNodeData) => void;
    onAngle: (node: CanvasNodeData) => void;
    onLighting: (node: CanvasNodeData) => void;
    onPanorama: (node: CanvasNodeData) => void;
    onPrevis: (node: CanvasNodeData) => void;
    onViewImage: (node: CanvasNodeData) => void;
    onExtractVideoFrames: (node: CanvasNodeData) => void;
    onExtractAudioFromVideo: (node: CanvasNodeData) => void;
    onRemakeVideo?: (node: CanvasNodeData) => void;
    onTrimVideoSegments: (node: CanvasNodeData) => void;
    onEnhanceVideo?: (node: CanvasNodeData) => void;
    onDepthVideo?: (node: CanvasNodeData) => void;
    onVersions?: (node: CanvasNodeData) => void;
    onAdoptToDrama?: (node: CanvasNodeData) => void;
    onRefreshFromDrama?: (node: CanvasNodeData) => void;
    extractingVideoFrames: boolean;
    extractingAudio: boolean;
    trimmingVideo: boolean;
    onReversePrompt: (node: CanvasNodeData) => void;
    onRetry: (node: CanvasNodeData) => void;
    onToggleFreeResize: (node: CanvasNodeData) => void;
    onToggleLocked: (node: CanvasNodeData) => void;
    onDelete: (node: CanvasNodeData) => void;
    onNineGrid: (node: CanvasNodeData, toolId: number, label: string, icon: string) => void;
    workspaceMode?: CanvasWorkspaceMode;
};

type CanvasAssetCategory = NonNullable<NonNullable<CanvasNodeData["metadata"]>["assetCategory"]>;

const assetCategoryOptions: Array<{ value: CanvasAssetCategory; label: string }> = ASSET_ASSIGNABLE_CATEGORY_OPTIONS;

type ToolbarTool = NodeToolbarTool;

export function CanvasNodeToolbar({
    node,
    viewport,
    containerRef,
    onKeep,
    onLeave,
    onInfo,
    onEditText,
    onDecreaseFont,
    onIncreaseFont,
    onToggleDialog,
    onAnnotate,
    onAnnotationEdit,
    onTextEdit,
    onGenerateImage,
    onUpload,
    onDownload,
    onDownloadSubtitles,
    onSaveAsset,
    onRegionEdit,
    onRemoveBackground,
    onLayerDecomposition,
    onEmotion,
    onPortraitTexture,
    onCrop,
    onCreateEditCopy,
    onRotateImage,
    rotatingImage = false,
    onSplit,
    onUpscale,
    onSuperResolve,
    onAngle,
    onLighting,
    onPanorama,
    onPrevis,
    onViewImage,
    onExtractVideoFrames,
    onExtractAudioFromVideo,
    onRemakeVideo,
    onTrimVideoSegments,
    onEnhanceVideo,
    onDepthVideo,
    onVersions,
    onAdoptToDrama,
    onRefreshFromDrama,
    extractingVideoFrames,
    extractingAudio,
    trimmingVideo,
    onReversePrompt,
    onRetry,
    onToggleFreeResize,
    onToggleLocked,
    onDelete,
    onNineGrid,
    workspaceMode = "professional",
}: CanvasNodeToolbarProps) {
    const [openMenuId, setOpenMenuId] = useState<string | null>(null);
    const [containerWidth, setContainerWidth] = useState(1000);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const preferences = useNodeToolbarPreferences(node?.type);
    const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);
    const toolbarRef = useRef<HTMLDivElement>(null);
    const { message } = App.useApp();
    const copyText = useCopyText();
    const themeName = useActiveTheme();
    const theme = canvasThemes[themeName];
    const simpleMode = workspaceMode === "simple";
    const resizeMotion = useCanvasNodeResizeMotion();

    useEffect(() => {
        setOpenMenuId(null);
        setSettingsOpen(false);
    }, [node?.id, preferences.userId]);

    useLayoutEffect(() => {
        const container = containerRef.current;
        if (!node || !container) {
            setAnchor(null);
            return;
        }
        const element = container.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(node.id)}"]`);
        if (!element) {
            setAnchor(null);
            return;
        }
        let disposed = false;
        let queued = false;
        let liveViewport = viewport;
        let liveDragOffset: Position | null = null;
        let containerRect = container.getBoundingClientRect();
        let availableBounds = canvasOverlayBounds(containerRect);
        let toolbarWidth = toolbarRef.current?.offsetWidth || 0;
        let toolbarHeight = toolbarRef.current?.offsetHeight || 44;
        const update = () => {
            // 视口预览帧已经修改了世界层 transform；直接用节点世界坐标计算，
            // 避免随后读取 getBoundingClientRect() 强制同步布局。
            const scale = Math.max(liveViewport.k, 0.05);
            const offsetX = liveDragOffset?.x || 0;
            const offsetY = liveDragOffset?.y || 0;
            const visualNode = resizeMotion?.resolveNode(node) || node;
            const nodeLeft = liveViewport.x + (visualNode.position.x + offsetX) * scale;
            const nodeTop = liveViewport.y + (visualNode.position.y + offsetY) * scale;
            const nodeWidth = visualNode.width * scale;
            const preferredLeft = nodeLeft + nodeWidth / 2;
            const halfToolbar = toolbarWidth / 2;
            const preferredAnchorLeft = Math.min(Math.max(preferredLeft, availableBounds.left + halfToolbar), Math.max(availableBounds.left + halfToolbar, availableBounds.right - halfToolbar));
            const above = nodeTop - 30;
            const preferredAnchorTop = Math.max(availableBounds.top + toolbarHeight, Math.min(above, availableBounds.bottom));
            // 面板在定位时发布矩形；这里不读取 DOM，可在实时平移和尺寸收敛后继续避让。
            const { left, top } = avoidCanvasNodePanels({ left: preferredAnchorLeft, top: preferredAnchorTop }, { width: toolbarWidth, height: toolbarHeight }, availableBounds, canvasNodePanelBounds(container));
            if (toolbarRef.current) {
                toolbarRef.current.style.transform = `translate3d(${left}px, ${top}px, 0)`;
                return;
            }
            setAnchor((current) => (current?.left === left && current.top === top ? current : { left, top }));
        };
        const scheduleUpdate = (nextViewport?: ViewportTransform) => {
            if (nextViewport) liveViewport = nextViewport;
            if (queued || disposed) return;
            queued = true;
            queueMicrotask(() => {
                queued = false;
                if (!disposed) update();
            });
        };
        const measure = () => {
            containerRect = container.getBoundingClientRect();
            toolbarWidth = toolbarRef.current?.offsetWidth || 0;
            toolbarHeight = toolbarRef.current?.offsetHeight || 44;
            const availableWidth = Math.max(0, availableBounds.right - availableBounds.left);
            setContainerWidth(availableWidth);
            scheduleUpdate();
        };
        measure();
        const resizeObserver = new ResizeObserver(measure);
        resizeObserver.observe(element);
        resizeObserver.observe(container);
        if (toolbarRef.current) resizeObserver.observe(toolbarRef.current);
        const stopBounds = observeCanvasOverlayBounds(container, (bounds) => {
            availableBounds = bounds;
            measure();
        });
        const unsubscribePanels = subscribeCanvasNodePanelBounds(container, () => scheduleUpdate());
        const unsubscribeViewport = subscribeCanvasGraphicsViewportPreview(container, scheduleUpdate);
        const unsubscribeResize = resizeMotion?.subscribeNode(node.id, () => scheduleUpdate());
        const unsubscribeDrag = subscribeCanvasNodeDragPreview(container, (preview) => {
            liveDragOffset = preview?.nodeIds.has(node.id) ? { x: preview.x, y: preview.y } : null;
            scheduleUpdate();
        });
        window.addEventListener("resize", measure);
        return () => {
            disposed = true;
            resizeObserver.disconnect();
            stopBounds();
            unsubscribePanels();
            unsubscribeViewport();
            unsubscribeResize?.();
            unsubscribeDrag();
            window.removeEventListener("resize", measure);
        };
    }, [anchor === null, containerRef, node, resizeMotion, viewport.k, viewport.x, viewport.y]);

    if (!node || !anchor) return null;

    const isImage = node.type === CanvasNodeType.Image;
    const isVideo = node.type === CanvasNodeType.Video;
    const isAudio = node.type === CanvasNodeType.Audio;
    const hasImage = isImage && Boolean(node.metadata?.content);
    const copyImagePrompt = (target: CanvasNodeData) => {
        const prompt = nodeGenerationPrompt(target).trim();
        if (!prompt) {
            message.warning("暂无可复制的提示词");
            return;
        }
        copyText(prompt, "提示词已复制");
    };
    const imageTools = buildImageToolbarTools(node, {
        onUpload,
        onToggleFreeResize,
        onAnnotate,
        onAnnotationEdit,
        onTextEdit,
        onRegionEdit,
        onRemoveBackground,
        onLayerDecomposition,
        onEmotion,
        onPortraitTexture,
        onCrop,
        onUpscale,
        onSuperResolve,
        onAngle,
        onLighting,
        onPanorama,
        onPrevis,
        onViewImage,
        onCopyPrompt: copyImagePrompt,
        onReversePrompt,
    });

    // 构建 ToolContext——供注册表解析工具
    const nodeHoverHandlers = {
        onNodeInfo: onInfo,
        onNodeDelete: onDelete,
        onNodeRetry: onRetry,
        onNodeEditText: onEditText,
        onNodeDecreaseFont: onDecreaseFont,
        onNodeIncreaseFont: onIncreaseFont,
        onNodeToggleDialog: onToggleDialog,
        onNodeAnnotate: onAnnotate,
        onNodeGenerateImage: onGenerateImage,
        onNodeUpload: onUpload,
        onNodeDownload: onDownload,
        onNodeSaveAsset: onSaveAsset,
        onNodeRegionEdit: onRegionEdit,
        onNodeRemoveBackground: onRemoveBackground,
        onNodeEmotion: onEmotion,
        onNodePortraitTexture: onPortraitTexture,
        onNodeCrop: onCrop,
        onNodeCreateEditCopy: onCreateEditCopy,
        onNodeRotateImage: onRotateImage,
        onNodeSplit: (target) => onSplit(target, { rows: 2, columns: 2 }),
        onNodeUpscale: onUpscale,
        onNodeSuperResolve: onSuperResolve,
        onNodeAngle: onAngle,
        onNodeViewImage: onViewImage,
        onNodeExtractVideoFrames: onExtractVideoFrames,
        onNodeExtractAudioFromVideo: onExtractAudioFromVideo,
        onNodeRemakeVideo: onRemakeVideo,
        onNodeTrimVideoSegments: onTrimVideoSegments,
        onNodeEnhanceVideo: onEnhanceVideo,
        onNodeDepthVideo: onDepthVideo,
        onNodeReversePrompt: onReversePrompt,
        onNodeToggleFreeResize: onToggleFreeResize,
        onNodeDownloadSubtitles: onDownloadSubtitles,
        onNodeVersions: onVersions,
        onNodeToggleLocked: onToggleLocked,
        onNodeCopyPrompt: copyImagePrompt,
        onNodeAdoptToDrama: onAdoptToDrama,
        onNodeRefreshFromDrama: onRefreshFromDrama,
    } as Partial<ToolbarHandlers> as ToolbarHandlers;

    const nodeHoverCtx: ToolContext = {
        selectedCount: 0,
        selectedNodeTypes: new Set(),
        selectedVideoCount: 0,
        canvasTool: "move",
        workspaceMode: workspaceMode || "professional",
        isProjectLinked: false,
        canUndo: false,
        canRedo: false,
        node,
        nodeMetadata: node.metadata,
        extractingVideoFrames,
        extractingAudio,
        trimmingVideo,
        rotatingImage,
        mergingVideos: false,
        addPanelOpen: false,
        appearancePanelOpen: false,
        settingsPanelOpen: false,
        handlers: nodeHoverHandlers,
    };

    // 注册表统一提供动作合同、适用性和节点 Dock 层级。
    const registryTools = resolveToolbarTools("node-hover", nodeHoverCtx, null);
    const registryToolbarTools: ToolbarTool[] = registryTools.map((tool) => {
        const placement = resolveNodeToolbarPlacement(tool, nodeHoverCtx);
        return {
            id: tool.id,
            label: tool.displayLabel ? (typeof tool.displayLabel === "function" ? tool.displayLabel(nodeHoverCtx) : tool.displayLabel) : typeof tool.label === "function" ? tool.label(nodeHoverCtx) : tool.label,
            icon: typeof tool.icon === "function" ? tool.icon(nodeHoverCtx) : tool.icon,
            group: placement.group,
            order: placement.order,
            section: tool.nodeToolbar?.section,
            description: tool.nodeToolbar?.description,
            active: tool.active?.(nodeHoverCtx),
            danger: tool.danger,
            disabled: tool.disabled?.(nodeHoverCtx),
            onClick: () => tool.run(nodeHoverCtx),
        };
    });
    const presetTools: ToolbarTool[] =
        hasImage && !simpleMode
            ? getNineGridMenuItems().map((preset, order) => {
                  const Icon = TOOL_ICON_MAP[preset.toolIconName] ?? Grid3x3;
                  return {
                      id: preset.id,
                      label: preset.label,
                      icon: <Icon className="size-3.5" />,
                      group: "sheet",
                      order,
                      section: preset.section,
                      description: preset.description,
                      onClick: () => onNineGrid(node, preset.toolId, preset.label, preset.toolIconName),
                  };
              })
            : [];
    const allTools: ToolbarTool[] = hasImage && !simpleMode ? [...registryToolbarTools, ...imageTools, ...presetTools] : registryToolbarTools;
    const processMenuLabel = isVideo ? "视频工具" : isImage ? "图片工具" : isAudio ? "音频处理" : "文本调整";
    const entries = buildNodeToolbarEntries(allTools, [
        { group: "adjust", label: "画面调整", icon: <Palette className="size-3.5" /> },
        { group: "camera", label: "镜头", icon: <Camera className="size-3.5" /> },
        { group: "sheet", label: translate("canvasB.nineGrid.creativePresets"), icon: <Grid3x3 className="size-3.5" /> },
        { group: "process", label: processMenuLabel, icon: isVideo ? <Wrench className="size-3.5" /> : <SlidersHorizontal className="size-3.5" /> },
    ]);
    const handleMenuOpenChange = (menuId: string, open: boolean) => {
        setOpenMenuId((current) => (open ? menuId : current === menuId ? null : current));
        if (open) onKeep(node.id);
        else if (!settingsOpen && !toolbarRef.current?.contains(document.activeElement)) onLeave();
    };
    const dockStyle = canvasDockStyle(theme, theme.node.text);

    return (
        <div
            ref={toolbarRef}
            data-popover-anchor-container
            className="canvas-node-toolbar absolute z-[var(--z-node-toolbar)] -translate-x-1/2 -translate-y-full"
            style={{ left: 0, top: 0, transform: `translate3d(${anchor.left}px, ${anchor.top}px, 0)`, width: "max-content", maxWidth: containerWidth, color: theme.node.text }}
            onMouseEnter={() => onKeep(node.id)}
            onMouseLeave={() => {
                if (!openMenuId && !settingsOpen) onLeave();
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            data-canvas-no-zoom
            onKeyDown={(event) => event.stopPropagation()}
            onFocus={() => onKeep(node.id)}
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget) && !openMenuId && !settingsOpen) onLeave();
            }}
        >
            <NodeToolbarDock
                entries={entries}
                mediaMenu={isImage || isVideo}
                pinnedEntryIds={preferences.pinnedEntryIds}
                availableWidth={containerWidth}
                style={{ ...dockStyle, borderColor: "color-mix(in srgb, currentColor 8%, transparent)" }}
                openMenuId={openMenuId}
                onOpenChange={handleMenuOpenChange}
                onSettings={
                    preferences.canEdit
                        ? () => {
                              setOpenMenuId(null);
                              setSettingsOpen(true);
                              onKeep(node.id);
                          }
                        : undefined
                }
                split={hasImage && !simpleMode ? { node, onSplit } : undefined}
                onPreset={hasImage && !simpleMode ? (id, label, icon) => onNineGrid(node, id, label, icon) : undefined}
            />
            {preferences.canEdit ? (
                <NodeToolbarSettingsModal
                    key={`${preferences.userId}:${node.type}`}
                    open={settingsOpen}
                    entries={entries}
                    renderPreview={(ids) => <NodeToolbarPreview entries={entries} mediaMenu={isImage || isVideo} pinnedEntryIds={ids} style={{ ...dockStyle, borderColor: "color-mix(in srgb, currentColor 8%, transparent)" }} />}
                    pinnedEntryIds={preferences.pinnedEntryIds}
                    loading={preferences.loading}
                    readError={preferences.error}
                    onReload={() => void preferences.reload()}
                    onSave={preferences.save}
                    onClose={() => setSettingsOpen(false)}
                />
            ) : null}
        </div>
    );
}

type ToolbarSplit = { node: CanvasNodeData; onSplit: (node: CanvasNodeData, params: ImageSplitParams) => void };
type ToolbarMenuEntry = Extract<NodeToolbarEntry, { kind: "menu" }>;
type NodeToolbarDockProps = {
    entries: NodeToolbarEntry[];
    mediaMenu?: boolean;
    pinnedEntryIds?: string[];
    availableWidth: number;
    style?: CSSProperties;
    openMenuId: string | null;
    onOpenChange: (menuId: string, open: boolean) => void;
    onSettings?: () => void;
    split?: ToolbarSplit;
    onPreset?: (id: number, label: string, icon: string) => void;
};
const ignoreMenuChange = () => {};

export function NodeToolbarPreview({ entries, pinnedEntryIds, style, mediaMenu = false }: { entries: NodeToolbarEntry[]; pinnedEntryIds: string[]; style?: CSSProperties; mediaMenu?: boolean }) {
    const viewportRef = useRef<HTMLDivElement>(null);
    const [availableWidth, setAvailableWidth] = useState(0);
    useLayoutEffect(() => {
        const viewport = viewportRef.current;
        if (!viewport) return;
        const measure = () => setAvailableWidth(viewport.clientWidth || viewport.getBoundingClientRect().width);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(viewport);
        return () => observer.disconnect();
    }, []);
    const previewEntries = entries.map((entry): NodeToolbarEntry => (entry.kind === "tool" ? { ...entry, tool: { ...entry.tool, onClick: ignoreMenuChange } } : { ...entry, tools: entry.tools.map((tool) => ({ ...tool, onClick: ignoreMenuChange })) }));
    return (
        <section aria-label="工具栏预览" className="rounded-[var(--r-md)] bg-surface-active p-3">
            <span className="text-[var(--fs-caption)] text-muted-foreground">工具栏预览</span>
            <span className="sr-only">
                当前顺序：
                {resolvePinnedToolbarEntries(entries, pinnedEntryIds)
                    .map((entry) => entry.label)
                    .join("、") || "仅保留更多入口"}
            </span>
            <div ref={viewportRef} className="relative mt-1 flex h-12 min-w-0 items-center justify-center overflow-hidden" inert>
                <NodeToolbarDock entries={previewEntries} mediaMenu={mediaMenu} pinnedEntryIds={pinnedEntryIds} availableWidth={availableWidth} style={style} openMenuId={null} onOpenChange={ignoreMenuChange} />
            </div>
        </section>
    );
}

export function NodeToolbarDock({ entries, pinnedEntryIds, availableWidth, style, openMenuId, onOpenChange, onSettings, split, onPreset, mediaMenu = false }: NodeToolbarDockProps) {
    const pinned = resolvePinnedToolbarEntries(entries, pinnedEntryIds);
    const [visibleCount, setVisibleCount] = useState(pinned.length);
    const dockRef = useRef<HTMLDivElement>(null);
    const measureRef = useRef<HTMLDivElement>(null);
    const measureKey = pinned.map((entry) => `${entry.id}:${entry.label}:${entry.iconOnly}`).join("|");
    useLayoutEffect(() => {
        const measure = () => {
            const dock = dockRef.current;
            const row = measureRef.current;
            if (!dock || !row) return;
            const widths = [...row.querySelectorAll<HTMLElement>("[data-node-toolbar-entry-width]")].map((element) => element.getBoundingClientRect().width);
            const moreWidth = row.querySelector<HTMLElement>("[data-node-toolbar-more-width]")?.getBoundingClientRect().width || 32;
            const computed = getComputedStyle(dock);
            const padding = (parseFloat(computed.paddingLeft) || 0) + (parseFloat(computed.paddingRight) || 0) + 2;
            setVisibleCount(visibleToolbarEntryCount(widths, availableWidth, moreWidth + padding, parseFloat(computed.columnGap) || 2));
        };
        measure();
        const observer = new ResizeObserver(measure);
        if (measureRef.current) observer.observe(measureRef.current);
        return () => observer.disconnect();
    }, [measureKey, availableWidth]);
    const visible = pinned.slice(0, visibleCount);
    const visibleIds = new Set(visible.map((entry) => entry.id));
    const pinnedIds = new Set(pinned.map((entry) => entry.id));
    const menus = entries.filter((entry): entry is ToolbarMenuEntry => entry.kind === "menu");
    const groupedToolIds = new Set(menus.flatMap((entry) => entry.tools.map((tool) => tool.id)));
    const moreTools = entries.flatMap((entry) => (entry.kind === "tool" && !visibleIds.has(entry.id) && (!groupedToolIds.has(entry.id) || pinnedIds.has(entry.id)) ? [entry.tool] : []));
    if (onSettings) moreTools.push({ id: "node-toolbar-settings", label: "自定义工具栏", icon: <SlidersHorizontal className="size-3.5" />, group: "more", order: Number.MAX_SAFE_INTEGER, section: "工具栏设置", onClick: onSettings });
    const renderEntry = (entry: NodeToolbarEntry, measuring = false) => {
        const menuProps = { openMenuId: measuring ? null : openMenuId, onOpenChange: measuring ? ignoreMenuChange : onOpenChange };
        if (entry.kind === "menu" && entry.id === "menu:sheet" && onPreset)
            return (
                <CanvasNineGridPicker
                    toolbar
                    open={!measuring && openMenuId === entry.id}
                    onOpenChange={(open) => menuProps.onOpenChange(entry.id, open)}
                    onSelect={(id, label, icon) => {
                        menuProps.onOpenChange(entry.id, false);
                        onPreset(id, label, icon);
                    }}
                />
            );
        if (entry.kind === "menu") return <NodeDockMenuButton mediaMenu={mediaMenu} menuId={entry.id} label={entry.label} icon={entry.icon} tools={entry.tools} split={split} {...menuProps} />;
        if (entry.id === "split" && split) return <NodeDockSplitButton tool={entry.tool} split={split} {...menuProps} />;
        return <NodeDockToolButton tool={entry.tool} iconOnly={entry.iconOnly} />;
    };
    return (
        <div ref={dockRef} role="toolbar" aria-label="节点快捷工具" className="canvas-node-toolbar-dock flex h-11 max-w-full items-center gap-0.5 overflow-visible rounded-[var(--dock-radius-tight)] border px-2 backdrop-blur-2xl" style={style}>
            {visible.map((entry) => (
                <span key={entry.id} className="inline-flex shrink-0" data-node-toolbar-entry={entry.id}>
                    {renderEntry(entry)}
                </span>
            ))}
            <NodeDockMenuButton
                mediaMenu={mediaMenu}
                menuId="more"
                label="更多"
                icon={<Ellipsis className="size-3.5" />}
                tools={moreTools}
                submenus={menus.filter((entry) => !visibleIds.has(entry.id))}
                openMenuId={openMenuId}
                onOpenChange={onOpenChange}
                split={split}
                placement="topRight"
                iconOnly
            />
            {/* 全量测量行不参与布局和交互，保证被收纳的入口在空间恢复后仍能被准确测量。 */}
            <div ref={measureRef} aria-hidden inert className="pointer-events-none invisible absolute left-0 top-0 flex w-max items-center gap-0.5">
                {pinned.map((entry) => (
                    <span key={entry.id} className="inline-flex shrink-0" data-node-toolbar-entry-width={entry.id}>
                        {renderEntry(entry, true)}
                    </span>
                ))}
                <span className="inline-flex shrink-0" data-node-toolbar-more-width>
                    <NodeDockMenuButton mediaMenu={mediaMenu} menuId="measure-more" label="更多" icon={<Ellipsis className="size-3.5" />} tools={[]} openMenuId={null} onOpenChange={ignoreMenuChange} iconOnly />
                </span>
            </div>
        </div>
    );
}

function NodeDockSplitButton({ tool, split, openMenuId, onOpenChange }: { tool: ToolbarTool; split: ToolbarSplit; openMenuId: string | null; onOpenChange: (id: string, open: boolean) => void }) {
    const menuId = "split-direct";
    return (
        <Dropdown
            disabled={tool.disabled}
            open={openMenuId === menuId}
            trigger={["click"]}
            onOpenChange={(open) => onOpenChange(menuId, open)}
            menu={{ items: [] }}
            popupRender={() => (
                <div data-canvas-no-zoom onMouseDown={(event) => event.stopPropagation()}>
                    <CanvasGridSplitPicker
                        onPick={(params) => {
                            onOpenChange(menuId, false);
                            split.onSplit(split.node, params);
                        }}
                    />
                </div>
            )}
        >
            <button
                type="button"
                aria-label={tool.label}
                aria-haspopup="dialog"
                aria-expanded={openMenuId === menuId}
                className="aceternity-dock-command is-labeled inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded-[var(--dock-item-radius)] px-2 outline-none"
            >
                <span className="grid size-3.5 shrink-0 place-items-center">{tool.icon}</span>
                <span className="whitespace-nowrap text-[var(--fs-label)] font-medium">{tool.label}</span>
            </button>
        </Dropdown>
    );
}

function NodeDockToolButton({ tool, iconOnly = false }: { tool: ToolbarTool; iconOnly?: boolean }) {
    return (
        // 默认 250px 宽度会把“名称：说明”折成两行，放宽到 360px 让常见说明单行显示。
        <Tooltip title={tool.description ? `${tool.label}：${tool.description}` : tool.label} styles={{ root: { maxWidth: 360 } }}>
            <button
                type="button"
                className={`aceternity-dock-command is-labeled pointer-events-auto inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded-[var(--dock-item-radius)] outline-none ${iconOnly ? "w-8 px-0" : "px-2"} ${tool.active ? "is-active" : ""} ${tool.danger ? "is-danger" : ""}`}
                aria-label={tool.label}
                aria-pressed={tool.active}
                disabled={tool.disabled}
                onClick={tool.onClick}
            >
                <span className="grid size-3.5 shrink-0 place-items-center">{tool.icon}</span>
                {!iconOnly ? <span className="inline-flex h-4 items-center whitespace-nowrap text-[var(--fs-label)] font-medium leading-none">{tool.label}</span> : null}
            </button>
        </Tooltip>
    );
}

const firstEnabledMenuItem = '[role^="menuitem"]:not([aria-disabled="true"])';

function NodeDockMenuButton({
    menuId,
    label,
    icon,
    tools,
    openMenuId,
    onOpenChange,
    mediaMenu = true,
    placement = "top",
    iconOnly = false,
    split,
    submenus = [],
}: {
    menuId: string;
    label: string;
    icon: ReactNode;
    tools: ToolbarTool[];
    openMenuId: string | null;
    onOpenChange: (menuId: string, open: boolean) => void;
    mediaMenu?: boolean;
    placement?: "top" | "topRight";
    iconOnly?: boolean;
    split?: ToolbarSplit;
    submenus?: ToolbarMenuEntry[];
}) {
    const open = openMenuId === menuId;
    const triggerRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const keyboardOpen = useRef(false);
    const [inspectedId, setInspectedId] = useState<string>();
    const [splitPanelOpen, setSplitPanelOpen] = useState(false);
    useEffect(() => {
        if (!open) {
            setSplitPanelOpen(false);
            setInspectedId(undefined);
            return;
        }
        const frame = requestAnimationFrame(() => {
            if (keyboardOpen.current) menuRef.current?.querySelector<HTMLElement>(firstEnabledMenuItem)?.focus();
            else triggerRef.current?.focus();
            keyboardOpen.current = false;
        });
        return () => cancelAnimationFrame(frame);
    }, [open]);
    useLayoutEffect(() => {
        if (!open || !splitPanelOpen) return;
        const menu = menuRef.current;
        const picker = menu?.querySelector<HTMLElement>(".canvas-grid-split-picker");
        if (!menu || !picker) return;
        let frame = 0;
        const placePicker = () => {
            frame = 0;
            const anchor = menu.getBoundingClientRect();
            const width = picker.offsetWidth;
            const height = picker.offsetHeight;
            const gap = 4;
            const inset = 12;
            const preferredLeft = anchor.right + gap + width <= window.innerWidth - inset ? anchor.right + gap : anchor.left - width - gap;
            const left = Math.max(inset, Math.min(preferredLeft, window.innerWidth - width - inset));
            const top = Math.max(inset, Math.min(anchor.top, window.innerHeight - height - inset));
            picker.style.left = `${left - anchor.left}px`;
            picker.style.top = `${top - anchor.top}px`;
        };
        const schedule = () => {
            if (!frame) frame = requestAnimationFrame(placePicker);
        };
        const resizeObserver = new ResizeObserver(schedule);
        resizeObserver.observe(menu);
        resizeObserver.observe(picker);
        const popup = menu.closest(".ant-dropdown");
        const positionObserver = new MutationObserver(schedule);
        if (popup) positionObserver.observe(popup, { attributes: true, attributeFilter: ["style"] });
        window.addEventListener("resize", schedule);
        window.addEventListener("scroll", schedule, true);
        placePicker();
        picker.querySelector("button")?.focus({ preventScroll: true });
        return () => {
            if (frame) cancelAnimationFrame(frame);
            resizeObserver.disconnect();
            positionObserver.disconnect();
            window.removeEventListener("resize", schedule);
            window.removeEventListener("scroll", schedule, true);
        };
    }, [open, splitPanelOpen]);
    const allMenuTools = [...tools, ...submenus.flatMap((entry) => entry.tools)];
    const inspected = allMenuTools.find((tool) => tool.id === inspectedId) ?? allMenuTools.find((tool) => !tool.disabled) ?? allMenuTools[0];
    const buildItems = (menuTools: ToolbarTool[], prefix = ""): MenuProps["items"] => {
        const sections = new Map<string, ToolbarTool[]>();
        for (const tool of menuTools) {
            const section = tool.danger ? "危险操作" : tool.section || "常用操作";
            const group = sections.get(section);
            if (group) group.push(tool);
            else sections.set(section, [tool]);
        }
        return [...sections]
            .sort(([left], [right]) => Number(left === "危险操作") - Number(right === "危险操作"))
            .map(([section, entries]) => ({
                type: "group",
                key: `${prefix}${section}`,
                label: section,
                children: entries.map((tool) => {
                    const isSplit = Boolean(split && tool.id === "split");
                    const inspect = mediaMenu ? () => setInspectedId(tool.id) : undefined;
                    return {
                        key: `${prefix}${tool.id}`,
                        icon: mediaMenu ? undefined : tool.icon,
                        role: tool.active === undefined ? "menuitem" : "menuitemcheckbox",
                        "aria-checked": tool.active,
                        "aria-description": tool.description,
                        "aria-haspopup": isSplit ? "dialog" : undefined,
                        "aria-expanded": isSplit ? splitPanelOpen : undefined,
                        onPointerEnter: inspect,
                        onFocus: inspect,
                        label: mediaMenu ? (
                            <CanvasToolMenuOption icon={tool.icon} label={tool.label} checked={tool.active} endIcon={isSplit ? <ChevronRight aria-hidden className="canvas-grid-split-chevron" /> : undefined} />
                        ) : (
                            <div className="canvas-node-toolbar-menu-label" title={tool.description ? `${tool.label}：${tool.description}` : tool.label}>
                                <span className="canvas-node-toolbar-menu-name">
                                    {tool.label}
                                    {tool.active ? <Check className="size-3.5 shrink-0" /> : null}
                                </span>
                                {tool.description ? <div className="canvas-node-toolbar-menu-description">{tool.description}</div> : null}
                            </div>
                        ),
                        disabled: tool.disabled,
                        danger: tool.danger,
                        onClick: (info) => {
                            if (isSplit) {
                                info.domEvent.preventDefault();
                                info.domEvent.stopPropagation();
                                setSplitPanelOpen((current) => !current);
                                return;
                            }
                            onOpenChange(menuId, false);
                            tool.onClick();
                        },
                    };
                }),
            }));
    };
    const sectionNames = new Set(tools.map((tool) => (tool.danger ? "危险操作" : tool.section || "常用操作")));
    const spreadGroup = submenus.length === 0 && sectionNames.size === 1 && tools.length > 1;
    const columns = spreadGroup || sectionNames.size === 4 ? 2 : Math.max(1, Math.min(sectionNames.size + submenus.length, 3));
    const items: MenuProps["items"] = [...submenus.map((entry) => ({ key: entry.id, label: entry.label, icon: entry.icon, children: buildItems(entry.tools, `${entry.id}:`) })), ...(buildItems(tools) || [])];
    return (
        <Dropdown
            open={open}
            trigger={["click"]}
            placement={placement}
            autoAdjustOverflow
            // rc-trigger preserves the placement offset while shifting. Use measured
            // padding for the gap so either flipped placement stays inside the viewport.
            align={{ offset: [0, 0], overflow: { adjustX: true, adjustY: true, shiftX: true, shiftY: true } }}
            styles={{ root: { paddingBlock: 12 } }}
            onOpenChange={(nextOpen, info) => {
                if (info.source === "trigger") onOpenChange(menuId, nextOpen);
            }}
            menu={{ items, "aria-label": label }}
            autoFocus
            popupRender={(menu) => (
                <div
                    ref={menuRef}
                    className={`canvas-node-toolbar-menu${mediaMenu ? "" : " canvas-node-toolbar-menu-actions"}${split ? " canvas-node-toolbar-menu-split" : ""}`}
                    data-canvas-no-zoom
                    data-canvas-wheel-scroll
                    onPointerDown={(event) => event.stopPropagation()}
                    onMouseDown={(event) => event.stopPropagation()}
                    onWheel={(event) => event.stopPropagation()}
                    onKeyDownCapture={(event) => {
                        if (event.key === "Escape") {
                            event.preventDefault();
                            event.stopPropagation();
                            if (splitPanelOpen) {
                                setSplitPanelOpen(false);
                                menuRef.current?.querySelector<HTMLElement>('[aria-haspopup="dialog"]')?.focus({ preventScroll: true });
                                return;
                            }
                            triggerRef.current?.focus();
                            onOpenChange(menuId, false);
                        }
                    }}
                    onKeyDown={(event) => event.stopPropagation()}
                >
                    {mediaMenu ? (
                        <CanvasToolMenuSurface columns={columns} spreadGroup={spreadGroup} description={inspected?.description ?? inspected?.label ?? label}>
                            {menu}
                        </CanvasToolMenuSurface>
                    ) : (
                        <div className="canvas-node-toolbar-menu-stack">{menu}</div>
                    )}
                    {splitPanelOpen && split ? (
                        <CanvasGridSplitPicker
                            onPick={(params) => {
                                setSplitPanelOpen(false);
                                onOpenChange(menuId, false);
                                split.onSplit(split.node, params);
                            }}
                        />
                    ) : null}
                </div>
            )}
        >
            <button
                ref={triggerRef}
                type="button"
                className={`aceternity-dock-command is-labeled pointer-events-auto inline-flex h-8 shrink-0 items-center justify-center rounded-[var(--dock-item-radius)] outline-none ${iconOnly ? "w-8 gap-2 px-0" : "gap-1 pl-2 pr-2"}`}
                aria-label={label}
                aria-expanded={open}
                aria-haspopup="menu"
                title={label}
                onKeyDown={(event) => {
                    if (event.key === "ArrowDown") {
                        event.preventDefault();
                        if (open) menuRef.current?.querySelector<HTMLElement>(firstEnabledMenuItem)?.focus();
                        else {
                            keyboardOpen.current = true;
                            onOpenChange(menuId, true);
                        }
                    }
                    if (event.key === "Escape" && open) {
                        event.preventDefault();
                        event.stopPropagation();
                        onOpenChange(menuId, false);
                    }
                }}
            >
                <span className="grid size-3.5 shrink-0 place-items-center">{icon}</span>
                {!iconOnly ? (
                    <>
                        <span className="ml-0.5 inline-flex h-4 items-center whitespace-nowrap text-[var(--fs-label)] font-medium leading-none">{label}</span>
                        <ChevronDown className="canvas-node-toolbar-chevron size-3 shrink-0" aria-hidden />
                    </>
                ) : null}
            </button>
        </Dropdown>
    );
}

export function CanvasNodeInfoModal({
    node,
    open,
    onClose,
    onMetadataChange,
    readOnly = false,
    onUnauthorized,
}: {
    node: CanvasNodeData | null;
    open: boolean;
    onClose: () => void;
    onMetadataChange?: (nodeId: string, metadata: Partial<CanvasNodeMetadata>) => void;
    readOnly?: boolean;
    onUnauthorized?: () => void;
}) {
    const theme = canvasThemes[useActiveTheme()];
    const config = useEffectiveConfig();
    const [assetTags, setAssetTags] = useState<string[]>([]);
    const [assetTagInput, setAssetTagInput] = useState("");
    const [assetCategory, setAssetCategory] = useState<CanvasAssetCategory>("other");
    const imageBytes = node?.type === CanvasNodeType.Image && node.metadata?.content ? getDataUrlByteSize(node.metadata.content) : 0;
    const batchCount = node?.type === CanvasNodeType.Image ? node.metadata?.batchChildIds?.length || 0 : 0;
    const nodeTypeLabel =
        node?.type === CanvasNodeType.Text
            ? "文本"
            : node?.type === CanvasNodeType.Script
              ? "分镜脚本"
              : node?.type === CanvasNodeType.Skill
                ? "技能"
                : node?.type === CanvasNodeType.Image
                  ? "图片"
                  : node?.type === CanvasNodeType.Video
                    ? "视频"
                    : node?.type === CanvasNodeType.Audio
                      ? "音频"
                      : node?.type === CanvasNodeType.Drawing
                        ? "绘图"
                        : node?.type === CanvasNodeType.Frame
                          ? "背板"
                          : "生成配置";
    useEffect(() => {
        setAssetTags(node?.metadata?.assetTags || []);
        setAssetTagInput("");
        setAssetCategory(node ? canvasNodeAssetCategory(node) : "other");
    }, [node?.id, node?.metadata?.assetCategory, node?.metadata?.assetTags]);

    const saveAssetCategory = (category: CanvasAssetCategory) => {
        if (!node || node.type !== CanvasNodeType.Image) return;
        setAssetCategory(category);
        onMetadataChange?.(node.id, { assetCategory: category });
    };

    const saveAssetTags = (nextTags: string[]) => {
        if (!node || node.type !== CanvasNodeType.Image) return;
        const tags = Array.from(new Set(nextTags.map((item) => item.trim()).filter(Boolean)));
        setAssetTags(tags);
        onMetadataChange?.(node.id, { assetTags: tags });
    };

    const addAssetTag = () => {
        const tags = assetTagInput
            .split(/\n|,|，/)
            .map((item) => item.trim())
            .filter(Boolean);
        if (!tags.length) return;
        saveAssetTags([...assetTags, ...tags]);
        setAssetTagInput("");
    };

    const removeAssetTag = (tag: string) => {
        saveAssetTags(assetTags.filter((item) => item !== tag));
    };

    const title = (
        <div className="canvas-node-inspector-title">
            <div className="min-w-0">
                <div className="text-[var(--fs-heading-lg)] font-semibold">节点信息</div>
                {node ? <div className="canvas-node-inspector-id">{node.id}</div> : null}
            </div>
        </div>
    );

    return (
        <Modal className="workspace-modal canvas-node-info-modal" title={title} open={open && Boolean(node)} centered footer={null} onCancel={onClose} width="min(920px, calc(100vw - 32px))" styles={{ body: { paddingTop: 4 } }}>
            {node ? (
                <div className="canvas-node-inspector" style={{ color: theme.node.text }}>
                    <div className="thin-scrollbar canvas-node-inspector-scroll">
                        <section className="canvas-node-inspector-section">
                            <div className="canvas-node-inspector-section-heading">
                                <span>基础信息</span>
                                <em>{node.metadata?.status || "idle"}</em>
                            </div>
                            <div className="canvas-node-inspector-facts">
                                <InfoRow label="类型" value={nodeTypeLabel} />
                                <InfoRow label="尺寸" value={`${Math.round(node.width)} x ${Math.round(node.height)}`} />
                                <InfoRow label="位置" value={`${Math.round(node.position.x)}, ${Math.round(node.position.y)}`} />
                                {batchCount > 1 ? <InfoRow label="图片组" value={`${batchCount} 张`} /> : null}
                                {imageBytes ? <InfoRow label="图片大小" value={formatBytes(imageBytes)} /> : null}
                            </div>
                        </section>

                        {node.type === CanvasNodeType.Image ? (
                            <section className="canvas-node-inspector-section">
                                <div className="canvas-node-inspector-section-heading">
                                    <span>项目资产分类</span>
                                </div>
                                <div className="canvas-node-inspector-options">
                                    {assetCategoryOptions.map((option) => {
                                        const active = assetCategory === option.value;
                                        return (
                                            <button key={option.value} type="button" disabled={readOnly} aria-pressed={active} onClick={() => saveAssetCategory(option.value)} className={active ? "is-active" : ""}>
                                                {option.label}
                                            </button>
                                        );
                                    })}
                                </div>
                                <p className="canvas-node-inspector-help">生成后会按此分类进入项目资产；角色、场景和画风工作流会自动预填。</p>
                            </section>
                        ) : null}

                        {nodeGenerationPrompt(node) ? (
                            <section className="canvas-node-inspector-section">
                                <div className="canvas-node-inspector-section-heading">
                                    <span>提示词</span>
                                </div>
                                <div className="canvas-node-inspector-copy canvas-node-inspector-prompt">{nodeGenerationPrompt(node)}</div>
                            </section>
                        ) : null}

                        {nodeGenerationRows(node, producedModelLabel(config, node.metadata?.producedModel)).length ? (
                            <section className="canvas-node-inspector-section">
                                <div className="canvas-node-inspector-section-heading">
                                    <span>生成信息</span>
                                </div>
                                <div className="canvas-node-inspector-facts">
                                    {nodeGenerationRows(node, producedModelLabel(config, node.metadata?.producedModel)).map((item) => (
                                        <InfoRow key={item.label} label={item.label} value={item.value} />
                                    ))}
                                </div>
                            </section>
                        ) : null}

                        {node.type === CanvasNodeType.Skill && node.metadata?.skillSnapshot ? (
                            <section className="canvas-node-inspector-section">
                                <div className="canvas-node-inspector-section-heading">
                                    <span>技能模板</span>
                                </div>
                                <div className="canvas-node-inspector-copy">{node.metadata.skillSnapshot.template}</div>
                                {node.metadata.skillSnapshot.outputContract ? (
                                    <>
                                        <div className="canvas-node-inspector-subheading">输出约束</div>
                                        <div className="canvas-node-inspector-copy">{node.metadata.skillSnapshot.outputContract}</div>
                                    </>
                                ) : null}
                            </section>
                        ) : null}

                        {node.type === CanvasNodeType.Image ? (
                            <section className="canvas-node-inspector-section">
                                <div className="canvas-node-inspector-section-heading">
                                    <div>
                                        <span>资产标签</span>
                                        <p>一条标签描述一个角色、环境、道具或镜头用途。</p>
                                    </div>
                                    <em>{assetTags.length} 条</em>
                                </div>
                                {readOnly ? (
                                    <div className="canvas-node-inspector-notice">分享画布为只读，标签无法编辑。</div>
                                ) : (
                                    <div className="canvas-node-inspector-tag-editor">
                                        <Input value={assetTagInput} placeholder="例如：角色: 张三" onChange={(event) => setAssetTagInput(event.target.value)} onPressEnter={addAssetTag} />
                                        <Button type="primary" icon={<Plus className="size-4" />} disabled={!assetTagInput.trim()} onClick={addAssetTag}>
                                            加入
                                        </Button>
                                    </div>
                                )}
                                <div className="canvas-node-inspector-tags">
                                    {assetTags.length ? (
                                        assetTags.map((tag) => (
                                            <Tag key={tag} closable={!readOnly} onClose={() => (readOnly ? onUnauthorized?.() : removeAssetTag(tag))} className="!m-0 !rounded-lg !px-2 !py-1 !text-sm">
                                                {tag}
                                            </Tag>
                                        ))
                                    ) : (
                                        <span className="canvas-node-inspector-empty-label">{readOnly ? "暂无标签" : "还没有标签，输入后点击“加入”或按 Enter。"}</span>
                                    )}
                                </div>
                            </section>
                        ) : null}

                        {node.metadata?.errorDetails ? <section className="canvas-node-inspector-error">{generationErrorMessage(node.metadata.errorDetails)}</section> : null}
                    </div>
                </div>
            ) : null}
        </Modal>
    );
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
    return (
        <div className="canvas-node-inspector-fact">
            <div>{label}</div>
            <strong>{value}</strong>
        </div>
    );
}

function nodeGenerationRows(node: CanvasNodeData, producedModelText: string) {
    const metadata = node.metadata;
    if (!metadata) return [] as Array<{ label: string; value: string }>;
    const rows: Array<{ label: string; value: string }> = [];
    const add = (label: string, value: unknown) => {
        if (value === undefined || value === null || value === "") return;
        rows.push({ label, value: String(value) });
    };
    const addTime = (label: string, value?: string) => {
        if (!value) return;
        const timestamp = Date.parse(value);
        add(label, Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : value);
    };
    const addDuration = (value?: number) => {
        if (typeof value !== "number" || !Number.isFinite(value)) return;
        const totalSeconds = Math.max(0, Math.round(value / 1000));
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        add("耗时", minutes ? `${minutes}分 ${seconds}秒` : `${seconds}秒`);
    };

    add("产出模型", producedModelText);
    add("生成尺寸", metadata.size);
    add("分辨率", metadata.vquality || metadata.quality);
    add("秒数", metadata.seconds ? `${metadata.seconds} 秒` : undefined);
    add("生成声音", metadata.generateAudio === undefined ? undefined : metadata.generateAudio === "true" ? "开启" : "关闭");
    add("水印", metadata.watermark === undefined ? undefined : metadata.watermark === "true" ? "开启" : "关闭");
    if (metadata.references?.length) {
        const referenceNames = metadata.references
            .slice(0, 3)
            .map((reference) => reference.split("/").pop() || reference)
            .join("、");
        add("引用素材", `${metadata.references.length} 个${referenceNames ? `（${referenceNames}${metadata.references.length > 3 ? "…" : ""}）` : ""}`);
    }
    addTime("创建时间", metadata.taskCreatedAt);
    addTime("开始时间", metadata.taskStartedAt);
    addTime("完成时间", metadata.taskCompletedAt);
    addDuration(metadata.taskDurationMs);
    return rows;
}
