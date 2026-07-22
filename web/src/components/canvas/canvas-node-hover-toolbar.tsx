import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { App, Button, Input, Modal, Segmented, Tag } from "antd";
import { Download, Ellipsis, FolderPlus, GalleryHorizontalEnd, Image as ImageIcon, Info, LoaderCircle, Lock, MessageSquare, Minus, Music2, Pencil, Plus, RefreshCw, Settings2, Trash2, Unlock, Upload, Video } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { canvasDockStyle } from "@/lib/canvas/canvas-aceternity-style";
import { subscribeCanvasViewportPreview } from "@/lib/canvas/canvas-live-viewport";
import { formatBytes, getDataUrlByteSize } from "@/lib/image-utils";
import { CONTENT_MODERATION_ERROR_CODE, isContentModerationError } from "@/lib/generation-error";
import { useCopyText } from "@/hooks/use-copy-text";
import { useThemeStore } from "@/stores/use-theme-store";
import { FloatingDock, type FloatingDockEntry } from "@/components/ui/aceternity/floating-dock";
import { CanvasNodeType, type CanvasNodeData, type CanvasWorkspaceMode, type ViewportTransform } from "@/types/canvas";
import { ImageToolSettingsModal } from "./canvas-image-toolbar-settings-modal";
import { IMAGE_QUICK_TOOLS_STORAGE_KEY, buildImageToolbarTools, defaultImageQuickToolIds, isImageQuickToolId, readImageQuickToolsConfig, type ImageQuickToolId } from "./canvas-image-toolbar-tools";

type CanvasNodeHoverToolbarProps = {
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
    onCrop: (node: CanvasNodeData) => void;
    onSplit: (node: CanvasNodeData) => void;
    onUpscale: (node: CanvasNodeData) => void;
    onSuperResolve: (node: CanvasNodeData) => void;
    onAngle: (node: CanvasNodeData) => void;
    onViewImage: (node: CanvasNodeData) => void;
    onExtractVideoLastFrame: (node: CanvasNodeData) => void;
    extractingVideoFrame: boolean;
    onReversePrompt: (node: CanvasNodeData) => void;
    onRetry: (node: CanvasNodeData) => void;
    onToggleFreeResize: (node: CanvasNodeData) => void;
    onToggleLocked: (node: CanvasNodeData) => void;
    onDelete: (node: CanvasNodeData) => void;
    workspaceMode?: CanvasWorkspaceMode;
};

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

export function CanvasNodeHoverToolbar({
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
    onCrop,
    onSplit,
    onUpscale,
    onSuperResolve,
    onAngle,
    onViewImage,
    onExtractVideoLastFrame,
    extractingVideoFrame,
    onReversePrompt,
    onRetry,
    onToggleFreeResize,
    onToggleLocked,
    onDelete,
    workspaceMode = "professional",
}: CanvasNodeHoverToolbarProps) {
    const [quickImageToolIds, setQuickImageToolIds] = useState<ImageQuickToolId[]>(defaultImageQuickToolIds);
    const [draftImageToolIds, setDraftImageToolIds] = useState<ImageQuickToolId[]>(defaultImageQuickToolIds);
    const [imageToolSettingsOpen, setImageToolSettingsOpen] = useState(false);
    const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);
    const toolbarRef = useRef<HTMLDivElement>(null);
    const { message } = App.useApp();
    const copyText = useCopyText();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
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
        setImageToolSettingsOpen(false);
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
            const left = nodeRect.left - containerRect.left + nodeRect.width / 2;
            const top = nodeRect.top - containerRect.top - 10;
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
    }, [containerRef, node, viewport.k, viewport.x, viewport.y]);

    if (!node || !anchor) return null;

    const activeNode = node;
    const isImage = node.type === CanvasNodeType.Image;
    const isVideo = node.type === CanvasNodeType.Video;
    const isAudio = node.type === CanvasNodeType.Audio;
    const hasImage = isImage && Boolean(node.metadata?.content);
    const hasVideo = isVideo && Boolean(node.metadata?.content);
    const hasAudio = isAudio && Boolean(node.metadata?.content);
    const isText = node.type === CanvasNodeType.Text;
    const isConfig = node.type === CanvasNodeType.Config;
    const canOpenDialog = isText || isImage || isVideo;
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
    const imageTools = buildImageToolbarTools(node, { onUpload, onToggleFreeResize, onAnnotate, onMaskEdit, onCrop, onSplit, onUpscale, onSuperResolve, onAngle, onViewImage, onCopyPrompt: copyImagePrompt, onReversePrompt });

    function openImageToolSettings() {
        onKeep(activeNode.id);
        setDraftImageToolIds(quickImageToolIds);
        setImageToolSettingsOpen(true);
    }

    const baseToolbarTools: ToolbarTool[] = [
        { id: "info", title: "查看节点信息", label: "信息", icon: <Info className="size-3.5" />, onClick: () => onInfo(node) },
        { id: "delete", title: "移除节点", label: "删除", icon: <Trash2 className="size-3.5" />, onClick: () => onDelete(node), danger: true },
    ];
    const nodeToolbarTools: ToolbarTool[] = [
        ...(canRetry ? [{ id: "retry", title: "重新生成", label: "重试", icon: <RefreshCw className="size-3.5" />, onClick: () => onRetry(node) }] : []),
        ...(hasVideo && !simpleMode ? [{ id: "extractLastFrame", title: extractingVideoFrame ? "正在截取尾帧" : "截取尾帧", label: extractingVideoFrame ? "截取中" : "尾帧", icon: extractingVideoFrame ? <LoaderCircle className="size-3.5 animate-spin" /> : <GalleryHorizontalEnd className="size-3.5" />, onClick: () => onExtractVideoLastFrame(node), disabled: extractingVideoFrame }] : []),
        ...(hasImage || hasVideo || isText ? [{ id: "saveAsset", title: "加入我的素材", label: "存素材", icon: <FolderPlus className="size-3.5" />, onClick: () => onSaveAsset(node) }] : []),
        ...(hasImage || hasVideo || hasAudio ? [{ id: "download", title: hasAudio ? "下载音频" : hasVideo ? "下载视频" : "下载图片", label: "下载", icon: <Download className="size-3.5" />, onClick: () => onDownload(node) }] : []),
        ...(canOpenDialog ? [{ id: "edit", title: "编辑", label: "编辑", icon: <MessageSquare className="size-3.5" />, onClick: () => onToggleDialog(node) }] : []),
        ...(isText ? [{ id: "editText", title: "编辑文本", label: "编辑文字", icon: <Pencil className="size-3.5" />, onClick: () => onEditText(node) }] : []),
        ...(isText ? [{ id: "generateImage", title: "用文本生图", label: "生图", icon: <ImageIcon className="size-3.5" />, onClick: () => onGenerateImage(node) }] : []),
        ...(isConfig && !simpleMode ? [{ id: "config", title: "生成配置", label: "生成配置", icon: <Settings2 className="size-3.5" />, onClick: () => onToggleDialog(node) }] : []),
        ...(isText && !simpleMode ? [{ id: "decreaseFont", title: "减小字号", label: "缩小", icon: <Minus className="size-3.5" />, onClick: () => onDecreaseFont(node) }] : []),
        ...(isText && !simpleMode ? [{ id: "increaseFont", title: "增大字号", label: "放大", icon: <Plus className="size-3.5" />, onClick: () => onIncreaseFont(node) }] : []),
        ...(isImage && !hasImage ? [{ id: "uploadImage", title: "上传图片", label: "上传图片", icon: <Upload className="size-3.5" />, onClick: () => onUpload(node) }] : []),
        ...(isVideo ? [{ id: "uploadVideo", title: hasVideo ? "替换视频" : "上传视频", label: hasVideo ? "替换视频" : "上传视频", icon: <Video className="size-3.5" />, onClick: () => onUpload(node) }] : []),
        ...(isAudio ? [{ id: "uploadAudio", title: hasAudio ? "替换音频" : "上传音频", label: hasAudio ? "替换音频" : "上传音频", icon: <Music2 className="size-3.5" />, onClick: () => onUpload(node) }] : []),
        ...(hasImage && !simpleMode ? imageTools.map((tool) => ({ id: tool.id, title: tool.title, label: tool.label, icon: tool.icon, active: tool.active, onClick: tool.onClick })) : []),
    ];
    const toolbarTools = hasImage ? [...baseToolbarTools, ...nodeToolbarTools].filter((tool) => quickImageToolIdSet.has(tool.id as ImageQuickToolId)) : [...baseToolbarTools, ...nodeToolbarTools];
    const selectableImageToolbarTools = [...baseToolbarTools, ...nodeToolbarTools].filter((tool): tool is ToolbarTool & { id: ImageQuickToolId } => isImageQuickToolId(tool.id));
    const dockItems: FloatingDockEntry[] = [
        ...toolbarTools.map((tool) => ({ id: tool.id, label: tool.title, icon: tool.icon, active: tool.active, danger: tool.danger, disabled: tool.disabled, onClick: () => tool.onClick() })),
        { kind: "separator", id: "node-state-separator" },
        { id: "node-lock", label: node.metadata?.locked ? "解锁节点" : "锁定位置和尺寸", icon: node.metadata?.locked ? <Unlock className="size-3.5" /> : <Lock className="size-3.5" />, active: Boolean(node.metadata?.locked), onClick: () => onToggleLocked(node) },
        ...(hasImage && !simpleMode ? [{ kind: "separator" as const, id: "image-tools-separator" }, { id: "image-tools-settings", label: "自定义节点工具", icon: <Ellipsis className="size-3.5" />, onClick: openImageToolSettings }] : []),
    ];

    const closeImageToolSettings = () => {
        setImageToolSettingsOpen(false);
        onLeave();
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
        window.localStorage.setItem(IMAGE_QUICK_TOOLS_STORAGE_KEY, JSON.stringify(draftImageToolIds));
        closeImageToolSettings();
    };

    const dockShellStyle = canvasDockStyle(theme, theme.node.text);
    const embeddedDockStyle = { ...dockShellStyle, background: "transparent", borderColor: "transparent", boxShadow: "none" };

    return (
        <>
            <div
                ref={toolbarRef}
                className="canvas-node-toolbar absolute z-[70] flex -translate-x-1/2 -translate-y-full items-end justify-center overflow-visible"
                style={{ left: anchor.left, top: anchor.top, width: "max-content", maxWidth: "min(calc(100vw - 20px), 560px)", color: theme.node.text }}
                onMouseEnter={() => onKeep(node.id)}
                onMouseLeave={() => {
                    if (!imageToolSettingsOpen) onLeave();
                }}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
            >
                <div className="aceternity-floating-dock relative flex h-10 items-end gap-1 rounded-[14px] border px-1.5 pb-1 backdrop-blur-2xl" style={dockShellStyle}>
                    {dockItems.length ? <FloatingDock embedded items={dockItems} size="compact" ariaLabel="节点快捷工具" className="pointer-events-auto max-w-[min(calc(100vw-20px),400px)]" style={embeddedDockStyle} /> : null}
                </div>
            </div>
            {hasImage ? (
                <ImageToolSettingsModal
                    open={imageToolSettingsOpen}
                    tools={selectableImageToolbarTools}
                    selectedIds={draftImageToolIds}
                    onToggle={setDraftImageToolVisible}
                    onCancel={closeImageToolSettings}
                    onSave={saveImageToolSettings}
                />
            ) : null}
        </>
    );
}

export function CanvasNodeInfoModal({ node, open, onClose, onMetadataChange, readOnly = false, onUnauthorized }: { node: CanvasNodeData | null; open: boolean; onClose: () => void; onMetadataChange?: (nodeId: string, metadata: Partial<CanvasNodeData["metadata"]>) => void; readOnly?: boolean; onUnauthorized?: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [view, setView] = useState<"info" | "json">("info");
    const [assetTags, setAssetTags] = useState<string[]>([]);
    const [assetTagInput, setAssetTagInput] = useState("");
    const imageBytes = node?.type === CanvasNodeType.Image && node.metadata?.content ? getDataUrlByteSize(node.metadata.content) : 0;
    const batchCount = node?.type === CanvasNodeType.Image ? node.metadata?.batchChildIds?.length || 0 : 0;
    const nodeTypeLabel = node?.type === CanvasNodeType.Text ? "文本" : node?.type === CanvasNodeType.Script ? "分镜脚本" : node?.type === CanvasNodeType.Skill ? "技能" : node?.type === CanvasNodeType.Image ? "图片" : node?.type === CanvasNodeType.Video ? "视频" : node?.type === CanvasNodeType.Audio ? "音频" : node?.type === CanvasNodeType.Frame ? "背板" : "生成配置";
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
    }, [node?.id, node?.metadata?.assetTags]);

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
                <div className="text-[17px] font-semibold tracking-[-0.02em]">节点信息</div>
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
                                    {node.metadata.errorDetails}
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
