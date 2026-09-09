import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { App, Dropdown, Tooltip } from "antd";
import type { MenuProps } from "antd";
import { Check, ChevronDown, Ellipsis, Images, Plus, SlidersHorizontal, UserRound } from "lucide-react";

import { canvasDockStyle } from "@/lib/canvas/canvas-aceternity-style";
import { ASSET_CATEGORY_OPTIONS } from "@/lib/asset-category";
import { canvasThemes } from "@/lib/canvas-theme";
import { resolveNodeToolbarPlacement, resolveToolbarTools, type NodeToolbarGroup, type ToolContext, type ToolbarHandlers } from "@/lib/canvas/tool-registry";
import { subscribeCanvasGraphicsViewportPreview } from "@/lib/canvas/canvas-live-viewport";
import { useCopyText } from "@/hooks/use-copy-text";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData, type CanvasWorkspaceMode, type ViewportTransform } from "@/types/canvas";
import { buildImageToolbarTools } from "./canvas-image-toolbar-tools";

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
    onGenerateImage: (node: CanvasNodeData) => void;
    onUpload: (node: CanvasNodeData) => void;
    onDownload: (node: CanvasNodeData) => void;
    onSaveAsset: (node: CanvasNodeData) => void;
    onCreateConversion?: (node: CanvasNodeData) => void;
    onMaskEdit: (node: CanvasNodeData) => void;
    onEmotion: (node: CanvasNodeData) => void;
    onPortraitTexture: (node: CanvasNodeData) => void;
    onCrop: (node: CanvasNodeData) => void;
    onSplit: (node: CanvasNodeData) => void;
    onUpscale: (node: CanvasNodeData) => void;
    onSuperResolve: (node: CanvasNodeData) => void;
    onAngle: (node: CanvasNodeData) => void;
    onViewImage: (node: CanvasNodeData) => void;
    onExtractVideoFrames: (node: CanvasNodeData) => void;
    onExtractAudioFromVideo: (node: CanvasNodeData) => void;
    onTrimVideoSegments: (node: CanvasNodeData) => void;
    onSubtitles: (node: CanvasNodeData) => void;
    onTimeline: (node: CanvasNodeData) => void;
    extractingVideoFrames: boolean;
    extractingAudio: boolean;
    trimmingVideo: boolean;
    onReversePrompt: (node: CanvasNodeData) => void;
    onRetry: (node: CanvasNodeData) => void;
    onToggleFreeResize: (node: CanvasNodeData) => void;
    onToggleLocked: (node: CanvasNodeData) => void;
    onDelete: (node: CanvasNodeData) => void;
    workspaceMode?: CanvasWorkspaceMode;
};

type CanvasAssetCategory = NonNullable<NonNullable<CanvasNodeData["metadata"]>["assetCategory"]>;

const assetCategoryOptions: Array<{ value: CanvasAssetCategory; label: string }> = ASSET_CATEGORY_OPTIONS;

type ToolbarTool = {
    section?: string;
    description?: string;
    id: string;
    label: string;
    icon: ReactNode;
    onClick: () => void;
    group: NodeToolbarGroup;
    order: number;
    active?: boolean;
    danger?: boolean;
    disabled?: boolean;
};

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
    onGenerateImage,
    onUpload,
    onDownload,
    onSaveAsset,
    onCreateConversion,
    onMaskEdit,
    onEmotion,
    onPortraitTexture,
    onCrop,
    onSplit,
    onUpscale,
    onSuperResolve,
    onAngle,
    onViewImage,
    onExtractVideoFrames,
    onExtractAudioFromVideo,
    onTrimVideoSegments,
    onSubtitles,
    onTimeline,
    extractingVideoFrames,
    extractingAudio,
    trimmingVideo,
    onReversePrompt,
    onRetry,
    onToggleFreeResize,
    onToggleLocked,
    onDelete,
    workspaceMode = "professional",
}: CanvasNodeToolbarProps) {
    const [openMenuId, setOpenMenuId] = useState<string | null>(null);
    const [containerWidth, setContainerWidth] = useState(1000);
    const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);
    const toolbarRef = useRef<HTMLDivElement>(null);
    const { message } = App.useApp();
    const copyText = useCopyText();
    const themeName = useThemeStore((state) => state.theme);
    const theme = canvasThemes[themeName];
    const simpleMode = workspaceMode === "simple";

    useEffect(() => {
        setOpenMenuId(null);
    }, [node?.id]);

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
        let containerRect = container.getBoundingClientRect();
        let toolbarWidth = toolbarRef.current?.offsetWidth || 0;
        let toolbarHeight = toolbarRef.current?.offsetHeight || 44;
        const update = () => {
            const nodeRect = element.getBoundingClientRect();
            const preferredLeft = nodeRect.left - containerRect.left + nodeRect.width / 2;
            const halfToolbar = toolbarWidth / 2;
            const canClamp = toolbarWidth > 0 && toolbarWidth <= containerRect.width - 20;
            let left = canClamp ? Math.min(Math.max(preferredLeft, halfToolbar + 10), containerRect.width - halfToolbar - 10) : preferredLeft;
            const above = nodeRect.top - containerRect.top - 30;
            let top = Math.max(toolbarHeight + 8, Math.min(above, containerRect.height - 8));
            for (const panel of container.querySelectorAll<HTMLElement>("[data-canvas-node-panel]")) {
                const panelRect = panel.getBoundingClientRect();
                const panelLeft = panelRect.left - containerRect.left;
                const panelRight = panelRect.right - containerRect.left;
                const panelTop = panelRect.top - containerRect.top;
                const panelBottom = panelRect.bottom - containerRect.top;
                if (left + halfToolbar <= panelLeft || left - halfToolbar >= panelRight || top <= panelTop || top - toolbarHeight >= panelBottom) continue;
                if (panelLeft >= toolbarWidth + 18) left = panelLeft - halfToolbar - 8;
                else if (containerRect.width - panelRight >= toolbarWidth + 18) left = panelRight + halfToolbar + 8;
                else if (panelTop >= toolbarHeight + 16) top = panelTop - 8;
                else if (containerRect.height - panelBottom >= toolbarHeight + 16) top = panelBottom + toolbarHeight + 8;
            }
            if (toolbarRef.current) {
                toolbarRef.current.style.transform = `translate3d(${left}px, ${top}px, 0)`;
                return;
            }
            setAnchor((current) => current?.left === left && current.top === top ? current : { left, top });
        };
        const scheduleUpdate = () => {
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
            setContainerWidth(containerRect.width);
            scheduleUpdate();
        };
        measure();
        const resizeObserver = new ResizeObserver(measure);
        resizeObserver.observe(element);
        resizeObserver.observe(container);
        if (toolbarRef.current) resizeObserver.observe(toolbarRef.current);
        const unsubscribeViewport = subscribeCanvasGraphicsViewportPreview(container, scheduleUpdate);
        window.addEventListener("resize", measure);
        return () => {
            disposed = true;
            resizeObserver.disconnect();
            unsubscribeViewport();
            window.removeEventListener("resize", measure);
        };
    }, [anchor === null, containerRef, node, viewport.k, viewport.x, viewport.y]);

    if (!node || !anchor) return null;
    // These nodes have no inline actions. Their edit/open and delete actions
    // live on the node itself/context menu, so a floating ellipsis shell only
    // adds empty chrome above the card.
    if (node.type === CanvasNodeType.Drawing || node.type === CanvasNodeType.Script || node.type === CanvasNodeType.Panorama) return null;

    const isImage = node.type === CanvasNodeType.Image;
    const isVideo = node.type === CanvasNodeType.Video;
    const isAudio = node.type === CanvasNodeType.Audio;
    const hasImage = isImage && Boolean(node.metadata?.content);
    const copyImagePrompt = (target: CanvasNodeData) => {
        const prompt = target.metadata?.prompt?.trim();
        if (!prompt) {
            message.warning("暂无可复制的提示词");
            return;
        }
        copyText(prompt, "提示词已复制");
    };
    const imageTools = buildImageToolbarTools(node, { onUpload, onToggleFreeResize, onAnnotate, onMaskEdit, onEmotion, onPortraitTexture, onCrop, onSplit, onUpscale, onSuperResolve, onAngle, onViewImage, onCopyPrompt: copyImagePrompt, onReversePrompt });

    // 构建 ToolContext——供注册表解析工具
    const nodeHoverHandlers = {
        onNodeInfo: onInfo, onNodeDelete: onDelete, onNodeRetry: onRetry, onNodeEditText: onEditText, onNodeDecreaseFont: onDecreaseFont, onNodeIncreaseFont: onIncreaseFont,
        onNodeToggleDialog: onToggleDialog, onNodeAnnotate: onAnnotate, onNodeGenerateImage: onGenerateImage, onNodeUpload: onUpload, onNodeDownload: onDownload,
        onNodeSaveAsset: onSaveAsset, onNodeCreateConversion: onCreateConversion, onNodeMaskEdit: onMaskEdit, onNodeEmotion: onEmotion, onNodePortraitTexture: onPortraitTexture, onNodeCrop: onCrop,
        onNodeSplit: onSplit, onNodeUpscale: onUpscale, onNodeSuperResolve: onSuperResolve, onNodeAngle: onAngle, onNodeViewImage: onViewImage,
        onNodeExtractVideoFrames: onExtractVideoFrames, onNodeExtractAudioFromVideo: onExtractAudioFromVideo, onNodeTrimVideoSegments: onTrimVideoSegments, onNodeReversePrompt: onReversePrompt, onNodeToggleFreeResize: onToggleFreeResize,
        onNodeSubtitles: onSubtitles, onNodeTimeline: onTimeline, onNodeToggleLocked: onToggleLocked, onNodeCopyPrompt: copyImagePrompt,
    } as Partial<ToolbarHandlers> as ToolbarHandlers;

    const nodeHoverCtx: ToolContext = {
        selectedCount: 0,
        selectedNodeTypes: new Set(),
        selectedVideoCount: 0,
        workspaceMode: workspaceMode || "professional",
        isProjectLinked: false,
        node,
        nodeMetadata: node.metadata,
        extractingVideoFrames,
        extractingAudio,
        trimmingVideo,
        mergingVideos: false,
        handlers: nodeHoverHandlers,
    };

    // 注册表统一提供动作合同、适用性和节点 Dock 层级。
    const registryTools = resolveToolbarTools("node-hover", nodeHoverCtx, null);
    const registryToolbarTools: ToolbarTool[] = registryTools.map((tool) => {
        const placement = resolveNodeToolbarPlacement(tool, nodeHoverCtx);
        return {
            id: tool.id,
            label: tool.displayLabel ? (typeof tool.displayLabel === "function" ? tool.displayLabel(nodeHoverCtx) : tool.displayLabel) : (typeof tool.label === "function" ? tool.label(nodeHoverCtx) : tool.label),
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
    const allTools: ToolbarTool[] = hasImage && !simpleMode
        ? [...registryToolbarTools, ...imageTools]
        : registryToolbarTools;
    // Empty nodes can still reach this shared toolbar while their tool registry
    // resolves to no applicable actions. Rendering the dock shell in that case
    // leaves its fixed height and horizontal padding visible as a narrow pill
    // above the node. Keep the toolbar mounted only when it has real actions.
    // Some node types (drawing, storyboard and panorama) only resolve the
    // destructive "remove" action. Do not render a floating shell containing
    // only an ellipsis for those nodes; deletion remains available from the
    // node context menu.
    if (!allTools.length || allTools.every((tool) => tool.danger)) return null;
    const compact = containerWidth < 640;
    const narrow = containerWidth < 420;
    const inGroup = (group: NodeToolbarGroup) => allTools.filter((tool) => tool.group === group).sort(compareToolbarTools);
    const primary = inGroup("primary");
    const primaryTools = narrow ? primary.slice(0, 1) : primary;
    const portraitTools = compact ? [] : inGroup("portrait");
    const viewpointTools = compact ? [] : inGroup("viewpoint");
    const processTools = compact ? [...inGroup("portrait"), ...inGroup("viewpoint"), ...inGroup("process")] : inGroup("process");
    const workspaceTools = narrow ? [] : inGroup("workspace");
    const utilityTools = inGroup("utility");
    const moreTools = [...(narrow ? [...primary.slice(1), ...inGroup("workspace")] : []), ...inGroup("more")];
    const processMenuLabel = compact ? "工具" : isVideo ? "提取素材" : isImage ? "图片工具" : isAudio ? "音频处理" : "文本调整";
    const handleMenuOpenChange = (menuId: string, open: boolean) => {
        setOpenMenuId((current) => open ? menuId : current === menuId ? null : current);
        if (open) onKeep(node.id);
        else if (!toolbarRef.current?.contains(document.activeElement)) onLeave();
    };
    const dockStyle = canvasDockStyle(theme, theme.node.text);

    return (
        <div
            ref={toolbarRef}
            className="canvas-node-toolbar absolute z-[var(--z-node-toolbar)] -translate-x-1/2 -translate-y-full"
            style={{ left: 0, top: 0, transform: `translate3d(${anchor.left}px, ${anchor.top}px, 0)`, width: "max-content", maxWidth: "calc(100% - 20px)", color: theme.node.text }}
            onMouseEnter={() => onKeep(node.id)}
            onMouseLeave={() => { if (!openMenuId) onLeave(); }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            data-canvas-no-zoom
            onKeyDown={(event) => event.stopPropagation()}
            onFocus={() => onKeep(node.id)}
            onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget) && !openMenuId) onLeave(); }}
        >
            <div
                role="toolbar"
                aria-label="节点快捷工具"
                className="flex h-11 max-w-full items-center gap-0.5 overflow-visible rounded-[var(--dock-radius-tight)] px-2 backdrop-blur-2xl"
                style={{ ...dockStyle, border: 0 }}
            >
                {primaryTools.map((tool) => <NodeDockToolButton key={tool.id} tool={tool} />)}
                {portraitTools.length ? <NodeDockMenuButton menuId="portrait" label="人像调整" icon={<UserRound className="size-3.5" />} tools={portraitTools} openMenuId={openMenuId} onOpenChange={handleMenuOpenChange} /> : null}
                {viewpointTools.map((tool) => <NodeDockToolButton key={tool.id} tool={tool} />)}
                {processTools.length ? <NodeDockMenuButton menuId="process" label={processMenuLabel} icon={isVideo ? <Images className="size-3.5" /> : <SlidersHorizontal className="size-3.5" />} tools={processTools} openMenuId={openMenuId} onOpenChange={handleMenuOpenChange} /> : null}
                {workspaceTools.length ? <span aria-hidden className="aceternity-dock-separator mx-1 h-5 w-px shrink-0" /> : null}
                {workspaceTools.map((tool) => <NodeDockToolButton key={tool.id} tool={tool} />)}
                {utilityTools.length || moreTools.length ? <span aria-hidden className="aceternity-dock-separator mx-1 h-5 w-px shrink-0" /> : null}
                {utilityTools.map((tool) => <NodeDockToolButton key={tool.id} tool={tool} iconOnly />)}
                {moreTools.length ? (
                    <NodeDockMenuButton menuId="more" label="更多" icon={<Ellipsis className="size-3.5" />} tools={moreTools} openMenuId={openMenuId} onOpenChange={handleMenuOpenChange} placement="topRight" iconOnly />
                ) : null}
            </div>
        </div>
    );
}
function NodeDockToolButton({ tool, iconOnly = false }: { tool: ToolbarTool; iconOnly?: boolean }) {
    return (
        <Tooltip title={tool.description ? `${tool.label}：${tool.description}` : tool.label}>
        <button
            type="button"
            className={`aceternity-dock-command is-labeled pointer-events-auto inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-[var(--dock-item-radius)] px-2.5 outline-none ${tool.active ? "is-active" : ""} ${tool.danger ? "is-danger" : ""}`}
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

function compareToolbarTools(left: ToolbarTool, right: ToolbarTool) {
    if (left.danger !== right.danger) return left.danger ? 1 : -1;
    return left.order - right.order;
}

function NodeDockMenuButton({ menuId, label, icon, tools, openMenuId, onOpenChange, placement = "top", iconOnly = false }: { menuId: string; label: string; icon: ReactNode; tools: ToolbarTool[]; openMenuId: string | null; onOpenChange: (menuId: string, open: boolean) => void; placement?: "top" | "topRight"; iconOnly?: boolean }) {
    const open = openMenuId === menuId;
    const triggerRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!open) return;
        const frame = requestAnimationFrame(() => triggerRef.current?.focus());
        return () => cancelAnimationFrame(frame);
    }, [open]);
    const sections = new Map<string, ToolbarTool[]>();
    for (const tool of tools) {
        const section = tool.danger ? "危险操作" : tool.section || "常用操作";
        sections.set(section, [...(sections.get(section) || []), tool]);
    }
    const items: MenuProps["items"] = [...sections].sort(([left], [right]) => Number(left === "危险操作") - Number(right === "危险操作")).map(([section, entries]) => ({
        type: "group", key: section, label: section,
        children: entries.map((tool) => ({ key: tool.id, icon: tool.icon, label: <div><span className="inline-flex items-center gap-2">{tool.label}{tool.active ? <Check className="size-3.5" /> : null}</span>{tool.description ? <div className="text-[var(--fs-tiny)] opacity-60">{tool.description}</div> : null}</div>, disabled: tool.disabled, danger: tool.danger, onClick: () => { onOpenChange(menuId, false); tool.onClick(); } })),
    }));
    return (
        <Dropdown open={open} trigger={["click"]} placement={placement} onOpenChange={(nextOpen) => onOpenChange(menuId, nextOpen)} menu={{ items }} autoFocus popupRender={(menu) => <div className="canvas-node-toolbar-menu" data-canvas-no-zoom data-canvas-wheel-scroll onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()} onKeyDownCapture={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); triggerRef.current?.focus(); onOpenChange(menuId, false); } }} onKeyDown={(event) => event.stopPropagation()}>{menu}</div>}>
            <button
                ref={triggerRef}
                type="button"
                className={`aceternity-dock-command is-labeled pointer-events-auto inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-[var(--dock-item-radius)] px-2.5 outline-none ${open ? "is-active" : ""}`}
                aria-label={label}
                aria-expanded={open}
                aria-haspopup="menu"
                title={label}
                onKeyDown={(event) => {
                    if (event.key === "ArrowDown" && open) {
                        event.preventDefault();
                        document.querySelector<HTMLElement>(".ant-dropdown:not(.ant-dropdown-hidden) .canvas-node-toolbar-menu [role='menuitem']:not([aria-disabled='true'])")?.focus();
                    }
                    if (event.key === "Escape" && open) {
                        event.preventDefault();
                        event.stopPropagation();
                        onOpenChange(menuId, false);
                    }
                }}
            >
                <span className="grid size-3.5 shrink-0 place-items-center">{icon}</span>
                {!iconOnly ? <><span className="inline-flex h-4 items-center whitespace-nowrap text-[var(--fs-label)] font-medium leading-none">{label}</span><ChevronDown className="size-3 shrink-0 opacity-55" /></> : null}
            </button>
        </Dropdown>
    );
}
