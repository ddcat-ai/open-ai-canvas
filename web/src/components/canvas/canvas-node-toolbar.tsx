import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { App, Button, Dropdown, Input, Modal, Segmented, Tag } from "antd";
import { Ellipsis, Lock, Plus, Settings2, Unlock } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { canvasDockStyle } from "@/lib/canvas/canvas-aceternity-style";
import { defaultToolbarPrefs, readToolbarPrefs, resolveToolbarTools, type ToolContext, type ToolbarHandlers } from "@/lib/canvas/tool-registry";
import { subscribeCanvasViewportPreview } from "@/lib/canvas/canvas-live-viewport";
import { canvasNodeAssetCategory } from "@/lib/canvas/canvas-node-asset";
import { formatBytes, getDataUrlByteSize } from "@/lib/image-utils";
import { CONTENT_MODERATION_ERROR_CODE, generationErrorMessage, isContentModerationError } from "@/lib/generation-error";
import { useCopyText } from "@/hooks/use-copy-text";
import { useThemeStore } from "@/stores/use-theme-store";
import { FloatingDock, type FloatingDockEntry } from "@/components/ui/aceternity/floating-dock";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata, type CanvasWorkspaceMode, type ViewportTransform } from "@/types/canvas";
import { ImageToolSettingsModal } from "./canvas-image-toolbar-settings-modal";
import { IMAGE_QUICK_TOOLS_STORAGE_KEY, buildImageToolbarTools, defaultImageQuickToolIds, isImageQuickToolId, readImageQuickToolsConfig, type ImageQuickToolId } from "./canvas-image-toolbar-tools";

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
    onMaskEdit: (node: CanvasNodeData) => void;
    onEmotion: (node: CanvasNodeData) => void;
    onPortraitTexture: (node: CanvasNodeData) => void;
    onCrop: (node: CanvasNodeData) => void;
    onSplit: (node: CanvasNodeData) => void;
    onUpscale: (node: CanvasNodeData) => void;
    onSuperResolve: (node: CanvasNodeData) => void;
    onAngle: (node: CanvasNodeData) => void;
    onViewImage: (node: CanvasNodeData) => void;
    onExtractVideoLastFrame: (node: CanvasNodeData) => void;
    onExtractAudioFromVideo: (node: CanvasNodeData) => void;
    onTrimVideoRegenerate: (node: CanvasNodeData) => void;
    onSubtitles: (node: CanvasNodeData) => void;
    onTimeline: (node: CanvasNodeData) => void;
    extractingVideoFrame: boolean;
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

const assetCategoryOptions: Array<{ value: CanvasAssetCategory; label: string }> = [
    { value: "character", label: "角色" },
    { value: "environment", label: "场景" },
    { value: "wardrobe", label: "服饰" },
    { value: "prop", label: "道具" },
    { value: "weapon", label: "武器" },
    { value: "style", label: "画风" },
    { value: "other", label: "其他" },
];

type ToolbarTool = {
    id: string;
    title: string;
    label: string;
    icon: ReactNode;
    onClick: () => void;
    active?: boolean;
    danger?: boolean;
    disabled?: boolean;
};

const MAX_IMAGE_QUICK_TOOLS = 7;
const NODE_DOCK_LABELS_STORAGE_KEY = "canvas-node-dock-show-labels-v1";

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
    onMaskEdit,
    onEmotion,
    onPortraitTexture,
    onCrop,
    onSplit,
    onUpscale,
    onSuperResolve,
    onAngle,
    onViewImage,
    onExtractVideoLastFrame,
    onExtractAudioFromVideo,
    onTrimVideoRegenerate,
    onSubtitles,
    onTimeline,
    extractingVideoFrame,
    extractingAudio,
    trimmingVideo,
    onReversePrompt,
    onRetry,
    onToggleFreeResize,
    onToggleLocked,
    onDelete,
    workspaceMode = "professional",
}: CanvasNodeToolbarProps) {
    const [quickImageToolIds, setQuickImageToolIds] = useState<ImageQuickToolId[]>(defaultImageQuickToolIds);
    const [draftImageToolIds, setDraftImageToolIds] = useState<ImageQuickToolId[]>(defaultImageQuickToolIds);
    const [showDockLabels, setShowDockLabels] = useState(true);
    const [draftShowDockLabels, setDraftShowDockLabels] = useState(true);
    const [imageToolSettingsOpen, setImageToolSettingsOpen] = useState(false);
    const [imageToolMenuOpen, setImageToolMenuOpen] = useState(false);
    const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);
    const toolbarRef = useRef<HTMLDivElement>(null);
    // Dropdown 关闭与菜单点击处于同一事件批次，ref 用来同步守住即将打开的 Modal，避免工具栏先被卸载。
    const imageToolSettingsOpenRef = useRef(false);
    const imageToolMenuOpenRef = useRef(false);
    const { message } = App.useApp();
    const copyText = useCopyText();
    const themeName = useThemeStore((state) => state.theme);
    const theme = canvasThemes[themeName];
    const simpleMode = workspaceMode === "simple";

    useEffect(() => {
        try {
            const stored = window.localStorage.getItem(IMAGE_QUICK_TOOLS_STORAGE_KEY);
            if (!stored) return;
            const parsed = JSON.parse(stored) as unknown;
            setQuickImageToolIds(readImageQuickToolsConfig(parsed));
        } catch {
            window.localStorage.removeItem(IMAGE_QUICK_TOOLS_STORAGE_KEY);
        }
    }, []);

    useEffect(() => {
        setShowDockLabels(window.localStorage.getItem(NODE_DOCK_LABELS_STORAGE_KEY) !== "0");
    }, []);

    useEffect(() => {
        imageToolSettingsOpenRef.current = false;
        imageToolMenuOpenRef.current = false;
        setImageToolSettingsOpen(false);
        setImageToolMenuOpen(false);
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
        const update = () => {
            const nodeRect = element.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            const preferredLeft = nodeRect.left - containerRect.left + nodeRect.width / 2;
            const toolbarWidth = toolbarRef.current?.offsetWidth || 0;
            const halfToolbar = toolbarWidth / 2;
            const canClamp = toolbarWidth > 0 && toolbarWidth <= containerRect.width - 20;
            const left = canClamp ? Math.min(Math.max(preferredLeft, halfToolbar + 10), containerRect.width - halfToolbar - 10) : preferredLeft;
            // 外置标题固定占 24px，额外保留 6px 即可兼顾层级和名称编辑入口。
            const top = nodeRect.top - containerRect.top - 30;
            if (toolbarRef.current) {
                toolbarRef.current.style.left = `${left}px`;
                toolbarRef.current.style.top = `${top}px`;
                return;
            }
            setAnchor((current) => current?.left === left && current.top === top ? current : { left, top });
        };
        update();
        const resizeObserver = new ResizeObserver(update);
        resizeObserver.observe(element);
        resizeObserver.observe(container);
        if (toolbarRef.current) resizeObserver.observe(toolbarRef.current);
        const viewportLayer = element.parentElement;
        const mutationObserver = new MutationObserver(update);
        if (viewportLayer) mutationObserver.observe(viewportLayer, { attributes: true, attributeFilter: ["style"] });
        const unsubscribeViewport = subscribeCanvasViewportPreview(container, update);
        window.addEventListener("resize", update);
        return () => {
            resizeObserver.disconnect();
            mutationObserver.disconnect();
            unsubscribeViewport();
            window.removeEventListener("resize", update);
        };
    }, [anchor === null, containerRef, node, showDockLabels, viewport.k, viewport.x, viewport.y]);

    if (!node || !anchor) return null;

    const activeNode = node;
    const isImage = node.type === CanvasNodeType.Image;
    const isVideo = node.type === CanvasNodeType.Video;
    const isAudio = node.type === CanvasNodeType.Audio;
    const hasImage = isImage && Boolean(node.metadata?.content);
    const hasVideo = isVideo && Boolean(node.metadata?.content);
    const hasAudio = isAudio && Boolean(node.metadata?.content);
    const isText = node.type === CanvasNodeType.Text;
    const isCharacterReference = isText && node.metadata?.workflowKind === "character" && Boolean(node.metadata.characterAssetId);
    const isEditableText = isText && !isCharacterReference;
    const isConfig = node.type === CanvasNodeType.Config;
    const canOpenDialog = isEditableText || isImage || isVideo;
    const requiresPromptChange = node.metadata?.generationErrorCode === CONTENT_MODERATION_ERROR_CODE || isContentModerationError(node.metadata?.errorDetails);
    const canRetry = node.metadata?.status === "error" && !requiresPromptChange;
    const quickImageToolIdSet = new Set(quickImageToolIds);
    const copyImagePrompt = (target: CanvasNodeData) => {
        const prompt = target.metadata?.prompt?.trim();
        if (!prompt) {
            message.warning("暂无可复制的提示词");
            return;
        }
        copyText(prompt, "提示词已复制");
    };
    const imageTools = buildImageToolbarTools(node, { onUpload, onToggleFreeResize, onAnnotate, onMaskEdit, onEmotion, onPortraitTexture, onCrop, onSplit, onUpscale, onSuperResolve, onAngle, onViewImage, onCopyPrompt: copyImagePrompt, onReversePrompt });

    function openImageToolSettings() {
        imageToolSettingsOpenRef.current = true;
        imageToolMenuOpenRef.current = false;
        onKeep(activeNode.id);
        setImageToolMenuOpen(false);
        setDraftImageToolIds(quickImageToolIds);
        setDraftShowDockLabels(showDockLabels);
        setImageToolSettingsOpen(true);
    }

    // 构建 ToolContext——供注册表解析工具
    const nodeHoverHandlers = {
        onNodeInfo: onInfo, onNodeDelete: onDelete, onNodeRetry: onRetry, onNodeEditText: onEditText, onNodeDecreaseFont: onDecreaseFont, onNodeIncreaseFont: onIncreaseFont,
        onNodeToggleDialog: onToggleDialog, onNodeAnnotate: onAnnotate, onNodeGenerateImage: onGenerateImage, onNodeUpload: onUpload, onNodeDownload: onDownload,
        onNodeSaveAsset: onSaveAsset, onNodeMaskEdit: onMaskEdit, onNodeEmotion: onEmotion, onNodePortraitTexture: onPortraitTexture, onNodeCrop: onCrop,
        onNodeSplit: onSplit, onNodeUpscale: onUpscale, onNodeSuperResolve: onSuperResolve, onNodeAngle: onAngle, onNodeViewImage: onViewImage,
        onNodeExtractVideoLastFrame: onExtractVideoLastFrame, onNodeExtractAudioFromVideo: onExtractAudioFromVideo, onNodeTrimVideoRegenerate: onTrimVideoRegenerate, onNodeReversePrompt: onReversePrompt, onNodeToggleFreeResize: onToggleFreeResize,
        onNodeSubtitles: onSubtitles, onNodeTimeline: onTimeline, onNodeToggleLocked: onToggleLocked, onNodeCopyPrompt: copyImagePrompt,
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
        extractingVideoFrame,
        extractingAudio,
        trimmingVideo,
        mergingVideos: false,
        addPanelOpen: false,
        appearancePanelOpen: false,
        settingsPanelOpen: false,
        handlers: nodeHoverHandlers,
    };

    // 从注册表解析工具（已按 applicable 过滤、用户偏好排序）
    const registryTools = resolveToolbarTools("node-hover", nodeHoverCtx, readToolbarPrefs("node-hover") ?? defaultToolbarPrefs("node-hover"));
    // 分离 node-lock（始终显示，不参与 quickImageToolIds 过滤）
    const otherRegistryTools = registryTools.filter((tool) => tool.id !== "node-lock");
    // 转为 ToolbarTool 供组件内部逻辑使用
    const otherTools: ToolbarTool[] = otherRegistryTools.map((tool) => ({
        id: tool.id,
        title: typeof tool.label === "function" ? tool.label(nodeHoverCtx) : tool.label,
        label: tool.displayLabel ? (typeof tool.displayLabel === "function" ? tool.displayLabel(nodeHoverCtx) : tool.displayLabel) : (typeof tool.label === "function" ? tool.label(nodeHoverCtx) : tool.label),
        icon: typeof tool.icon === "function" ? tool.icon(nodeHoverCtx) : tool.icon,
        active: tool.active?.(nodeHoverCtx),
        danger: tool.danger,
        disabled: tool.disabled?.(nodeHoverCtx),
        onClick: () => tool.run(nodeHoverCtx),
    }));
    // 合并图片工具（当 hasImage && !simpleMode 时追加到 otherTools 末尾）
    const allTools: ToolbarTool[] = hasImage && !simpleMode ? [...otherTools, ...imageTools.map((tool) => ({ id: tool.id, title: tool.title, label: tool.label, icon: tool.icon, active: tool.active, danger: undefined, disabled: undefined, onClick: tool.onClick }))] : otherTools;
    // hasImage 时按 quickImageToolIds 过滤
    const toolbarTools = hasImage ? allTools.filter((tool) => quickImageToolIdSet.has(tool.id as ImageQuickToolId)) : allTools;
    const selectableImageToolbarTools = allTools.filter((tool): tool is ToolbarTool & { id: ImageQuickToolId } => isImageQuickToolId(tool.id));
    const temporaryImageToolbarTools = selectableImageToolbarTools.filter((tool) => !quickImageToolIdSet.has(tool.id));
    const dockItems: FloatingDockEntry[] = [
        ...toolbarTools.map((tool) => ({ id: tool.id, label: tool.title, displayLabel: tool.label, icon: tool.icon, active: tool.active, danger: tool.danger, disabled: tool.disabled, onClick: () => tool.onClick() })),
        { kind: "separator", id: "node-state-separator" },
        { id: "node-lock", label: node.metadata?.locked ? "解锁节点" : "锁定位置和尺寸", displayLabel: node.metadata?.locked ? "解锁" : "锁定", icon: node.metadata?.locked ? <Unlock className="size-3.5" /> : <Lock className="size-3.5" />, active: Boolean(node.metadata?.locked), onClick: () => onToggleLocked(node) },
    ];

    const closeImageToolSettings = () => {
        imageToolSettingsOpenRef.current = false;
        setImageToolSettingsOpen(false);
        onLeave();
    };

    const runTemporaryImageTool = (tool: ToolbarTool) => {
        imageToolMenuOpenRef.current = false;
        setImageToolMenuOpen(false);
        tool.onClick();
    };

    const handleImageToolMenuOpenChange = (open: boolean) => {
        imageToolMenuOpenRef.current = open;
        setImageToolMenuOpen(open);
        if (open) onKeep(activeNode.id);
        else if (!imageToolSettingsOpenRef.current) onLeave();
    };

    const setDraftImageToolVisible = (id: ImageQuickToolId, visible: boolean) => {
        setDraftImageToolIds((current) => {
            const selected = new Set(current);
            if (visible && selected.size >= MAX_IMAGE_QUICK_TOOLS) {
                message.warning(`最多固定 ${MAX_IMAGE_QUICK_TOOLS} 个快捷工具`);
                return current;
            }
            if (visible) selected.add(id);
            else selected.delete(id);
            return selectableImageToolbarTools.filter((tool) => selected.has(tool.id)).map((tool) => tool.id);
        });
    };

    const saveImageToolSettings = () => {
        setQuickImageToolIds(draftImageToolIds);
        setShowDockLabels(draftShowDockLabels);
        window.localStorage.setItem(IMAGE_QUICK_TOOLS_STORAGE_KEY, JSON.stringify(draftImageToolIds));
        window.localStorage.setItem(NODE_DOCK_LABELS_STORAGE_KEY, draftShowDockLabels ? "1" : "0");
        closeImageToolSettings();
    };

    const dockShellStyle = canvasDockStyle(theme, theme.node.text);
    const embeddedDockStyle = { ...dockShellStyle, background: "transparent", borderColor: "transparent", boxShadow: "none" };
    const labeledDockStyle = {
        ...dockShellStyle,
        boxShadow: themeName === "dark"
            ? `0 18px 52px ${theme.spatial.shadow}`
            : "0 10px 30px rgba(15,23,42,.12), 0 1px 2px rgba(15,23,42,.05), inset 0 1px 0 rgba(255,255,255,.7)",
    };

    return (
        <>
            <div
                ref={toolbarRef}
                className="canvas-node-toolbar absolute z-[var(--z-node-toolbar)] flex -translate-x-1/2 -translate-y-full items-end justify-center overflow-visible"
                style={{ left: anchor.left, top: anchor.top, width: "max-content", maxWidth: `min(calc(100% - 20px), ${showDockLabels ? 840 : 560}px)`, color: theme.node.text }}
                onMouseEnter={() => onKeep(node.id)}
                onMouseLeave={() => {
                    if (!imageToolSettingsOpenRef.current && !imageToolMenuOpenRef.current) onLeave();
                }}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
            >
                <div className={`aceternity-floating-dock thin-scrollbar relative flex max-w-full overflow-x-auto rounded-[var(--dock-radius)] border backdrop-blur-2xl ${showDockLabels ? "h-11 items-center px-2 py-1" : "h-10 items-end gap-1 px-1.5 pb-1"}`} style={showDockLabels ? labeledDockStyle : dockShellStyle}>
                    {dockItems.length ? <FloatingDock embedded items={dockItems} size="compact" showLabels={showDockLabels} ariaLabel="节点快捷工具" className={`pointer-events-auto shrink-0 ${showDockLabels ? "" : "max-w-[min(calc(100vw-20px),400px)]"}`} style={embeddedDockStyle} /> : null}
                    {hasImage && !simpleMode ? (
                        <Dropdown
                            open={imageToolMenuOpen}
                            trigger={["click"]}
                            placement="topRight"
                            onOpenChange={handleImageToolMenuOpenChange}
                            menu={{
                                items: [
                                    ...temporaryImageToolbarTools.map((tool) => ({ key: tool.id, icon: tool.icon, label: tool.label, danger: tool.danger, onClick: () => runTemporaryImageTool(tool) })),
                                    ...(temporaryImageToolbarTools.length ? [{ type: "divider" as const }] : []),
                                    { key: "manage-image-quick-tools", icon: <Settings2 className="size-3.5" />, label: "管理快捷工具", onClick: openImageToolSettings },
                                ],
                            }}
                        >
                            <button
                                type="button"
                                className={`aceternity-dock-command pointer-events-auto shrink-0 outline-none focus-visible:ring-2 ${showDockLabels ? "is-labeled inline-flex h-8 items-center justify-center gap-1.5 rounded-[var(--dock-item-radius)] px-2.5" : "grid size-8 place-items-center rounded-full"}`}
                                style={{ color: theme.node.text, "--tw-ring-color": theme.accent.primary } as CSSProperties}
                                aria-label="更多图片工具"
                                title="更多图片工具"
                            >
                                <Ellipsis className="size-3.5" />
                                {showDockLabels ? <span className="inline-flex h-4 items-center text-[var(--fs-label)] font-medium leading-none">更多</span> : null}
                            </button>
                        </Dropdown>
                    ) : null}
                </div>
            </div>
            {hasImage ? (
                <ImageToolSettingsModal
                    open={imageToolSettingsOpen}
                    tools={selectableImageToolbarTools}
                    selectedIds={draftImageToolIds}
                    showLabels={draftShowDockLabels}
                    onToggle={setDraftImageToolVisible}
                    onShowLabelsChange={setDraftShowDockLabels}
                    onCancel={closeImageToolSettings}
                    onSave={saveImageToolSettings}
                />
            ) : null}
        </>
    );
}

export function CanvasNodeInfoModal({ node, open, onClose, onMetadataChange, readOnly = false, onUnauthorized }: { node: CanvasNodeData | null; open: boolean; onClose: () => void; onMetadataChange?: (nodeId: string, metadata: Partial<CanvasNodeMetadata>) => void; readOnly?: boolean; onUnauthorized?: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [view, setView] = useState<"info" | "json">("info");
    const [assetTags, setAssetTags] = useState<string[]>([]);
    const [assetTagInput, setAssetTagInput] = useState("");
    const [assetCategory, setAssetCategory] = useState<CanvasAssetCategory>("other");
    const imageBytes = node?.type === CanvasNodeType.Image && node.metadata?.content ? getDataUrlByteSize(node.metadata.content) : 0;
    const batchCount = node?.type === CanvasNodeType.Image ? node.metadata?.batchChildIds?.length || 0 : 0;
    const nodeTypeLabel = node?.type === CanvasNodeType.Text ? "文本" : node?.type === CanvasNodeType.Script ? "分镜脚本" : node?.type === CanvasNodeType.Skill ? "技能" : node?.type === CanvasNodeType.Image ? "图片" : node?.type === CanvasNodeType.Video ? "视频" : node?.type === CanvasNodeType.Audio ? "音频" : node?.type === CanvasNodeType.Drawing ? "绘图" : node?.type === CanvasNodeType.Frame ? "背板" : "生成配置";
    const json = useMemo(() => {
        if (!node) return "";
        return JSON.stringify(
            node,
            (key, value) => {
                if (key === "title") return undefined;
                if (key === "content" && typeof value === "string" && value.startsWith("data:image/")) {
                    return "[base64 image]";
                }
                return value;
            },
            2,
        );
    }, [node]);

    useEffect(() => {
        if (open) setView("info");
    }, [node?.id, open]);

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
        <div className="flex items-center justify-between gap-4 pr-10">
            <div className="min-w-0">
                <div className="text-[var(--fs-heading-lg)] font-semibold tracking-[-0.02em]">节点信息</div>
                {node ? <div className="mt-0.5 truncate text-xs opacity-45">{node.id}</div> : null}
            </div>
            <Segmented
                size="small"
                value={view}
                onChange={(value) => setView(value as "info" | "json")}
                options={[
                    { label: "信息", value: "info" },
                    { label: "JSON", value: "json" },
                ]}
            />
        </div>
    );

    return (
        <Modal
            className="canvas-node-info-modal"
            title={title}
            open={open && Boolean(node)}
            centered
            footer={null}
            width={720}
            onCancel={onClose}
            styles={{ body: { paddingTop: 8 } }}
        >
            {node ? (
                <div className="h-[min(68vh,640px)] min-h-[420px] text-sm" style={{ color: theme.node.text }}>
                    {view === "info" ? (
                        <div className="thin-scrollbar h-full space-y-4 overflow-auto pr-1">
                            <div className="grid gap-2 rounded-2xl border p-3" style={{ background: theme.node.fill, borderColor: theme.node.stroke }}>
                                <div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
                                    <InfoRow label="类型" value={nodeTypeLabel} />
                                    <InfoRow label="状态" value={node.metadata?.status || "idle"} />
                                    <InfoRow label="尺寸" value={`${Math.round(node.width)} x ${Math.round(node.height)}`} />
                                    <InfoRow label="位置" value={`${Math.round(node.position.x)}, ${Math.round(node.position.y)}`} />
                                    {batchCount > 1 ? <InfoRow label="图片组" value={`${batchCount} 张`} /> : null}
                                    {imageBytes ? <InfoRow label="图片大小" value={formatBytes(imageBytes)} /> : null}
                                </div>
                                {node.type === CanvasNodeType.Image ? (
                                    <div className="border-t pt-3" style={{ borderColor: theme.toolbar.border }}>
                                        <div className="mb-2 text-xs font-medium opacity-45">项目资产分类</div>
                                        <div className="flex flex-wrap gap-1.5">
                                            {assetCategoryOptions.map((option) => {
                                                const active = assetCategory === option.value;
                                                return <button key={option.value} type="button" disabled={readOnly} onClick={() => saveAssetCategory(option.value)} className="h-7 rounded-md border px-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60" style={{ borderColor: active ? theme.accent.primary : theme.toolbar.border, background: active ? theme.accent.primarySoft : theme.toolbar.panel, color: active ? theme.accent.primary : theme.node.muted }}>{option.label}</button>;
                                            })}
                                        </div>
                                        <div className="mt-2 text-[var(--fs-label)] leading-5 opacity-45">生成后会按此分类进入项目资产；角色、场景和画风工作流会自动预填。</div>
                                    </div>
                                ) : null}
                                {node.metadata?.prompt ? (
                                    <div className="rounded-xl border px-3 py-2" style={{ borderColor: theme.toolbar.border, background: theme.toolbar.panel }}>
                                        <div className="mb-1 text-xs font-medium opacity-45">提示词</div>
                                        <div className="whitespace-pre-wrap break-words leading-6">{node.metadata.prompt}</div>
                                    </div>
                                ) : null}
                                {node.type === CanvasNodeType.Skill && node.metadata?.skillSnapshot ? (
                                    <div className="rounded-xl border px-3 py-2" style={{ borderColor: theme.toolbar.border, background: theme.toolbar.panel }}>
                                        <div className="mb-1 text-xs font-medium opacity-45">技能模板</div>
                                        <div className="whitespace-pre-wrap break-words leading-6">{node.metadata.skillSnapshot.template}</div>
                                        {node.metadata.skillSnapshot.outputContract ? (
                                            <>
                                                <div className="mb-1 mt-3 text-xs font-medium opacity-45">输出约束</div>
                                                <div className="whitespace-pre-wrap break-words leading-6">{node.metadata.skillSnapshot.outputContract}</div>
                                            </>
                                        ) : null}
                                    </div>
                                ) : null}
                            </div>

                            {node.type === CanvasNodeType.Image ? (
                                <div className="rounded-2xl border p-3" style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke }}>
                                    <div className="mb-2 flex items-center justify-between gap-3">
                                        <div>
                                            <div className="text-sm font-semibold">资产标签</div>
                                            <div className="mt-0.5 text-xs opacity-45">一条标签描述一个角色、环境、道具或镜头用途。</div>
                                        </div>
                                        <span className="shrink-0 text-xs opacity-45">{assetTags.length} 条</span>
                                    </div>
                                    {readOnly ? (
                                        <div className="mb-2 rounded-lg border px-3 py-2 text-xs opacity-55" style={{ borderColor: theme.toolbar.border }}>
                                            分享画布为只读，标签无法编辑。
                                        </div>
                                    ) : (
                                        <div className="flex gap-2">
                                            <Input
                                                value={assetTagInput}
                                                placeholder="例如：角色: 张三"
                                                onChange={(event) => setAssetTagInput(event.target.value)}
                                                onPressEnter={addAssetTag}
                                            />
                                            <Button type="primary" icon={<Plus className="size-4" />} disabled={!assetTagInput.trim()} onClick={addAssetTag}>
                                                加入
                                            </Button>
                                        </div>
                                    )}
                                    <div className="mt-3 flex min-h-10 flex-wrap gap-2 rounded-xl border px-2 py-2" style={{ borderColor: theme.toolbar.border, background: theme.node.fill }}>
                                        {assetTags.length ? (
                                            assetTags.map((tag) => (
                                                <Tag key={tag} closable={!readOnly} onClose={() => (readOnly ? onUnauthorized?.() : removeAssetTag(tag))} className="!m-0 !rounded-lg !px-2 !py-1 !text-sm">
                                                    {tag}
                                                </Tag>
                                            ))
                                        ) : (
                                            <span className="px-1 py-1 text-xs opacity-40">{readOnly ? "暂无标签" : "还没有标签，输入后点击“加入”或按 Enter。"}</span>
                                        )}
                                    </div>
                                </div>
                            ) : null}

                            {node.metadata?.errorDetails ? (
                                <div className="rounded-2xl border p-3 text-red-500" style={{ borderColor: theme.node.stroke }}>
                                    {generationErrorMessage(node.metadata.errorDetails)}
                                </div>
                            ) : null}
                        </div>
                    ) : (
                        <pre className="thin-scrollbar h-full overflow-auto rounded-2xl border p-3 text-xs leading-5" style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text }}>
                            {json}
                        </pre>
                    )}
                </div>
            ) : null}
        </Modal>
    );
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
    return (
        <div className="rounded-xl border px-3 py-2" style={{ borderColor: "rgba(148,163,184,.22)" }}>
            <div className="mb-1 text-xs font-medium opacity-45">{label}</div>
            <div className="min-w-0 whitespace-pre-wrap break-words text-sm font-medium leading-5">{value}</div>
        </div>
    );
}
