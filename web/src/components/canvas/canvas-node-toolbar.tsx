import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { App, Button, Dropdown, Input, Modal, Tag } from "antd";
import type { MenuProps } from "antd";
import { ChevronDown, Ellipsis, Lock, Plus, Unlock } from "lucide-react";

import { canvasDockStyle } from "@/lib/canvas/canvas-aceternity-style";
import { canvasThemes } from "@/lib/canvas-theme";
import { resolveToolbarTools, type ToolContext, type ToolbarHandlers } from "@/lib/canvas/tool-registry";
import { subscribeCanvasViewportPreview } from "@/lib/canvas/canvas-live-viewport";
import { canvasNodeAssetCategory } from "@/lib/canvas/canvas-node-asset";
import { formatBytes, getDataUrlByteSize } from "@/lib/image-utils";
import { generationErrorMessage } from "@/lib/generation-error";
import { useCopyText } from "@/hooks/use-copy-text";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata, type CanvasWorkspaceMode, type ViewportTransform } from "@/types/canvas";
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
    label: string;
    icon: ReactNode;
    onClick: () => void;
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
        const update = () => {
            const nodeRect = element.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            const preferredLeft = nodeRect.left - containerRect.left + nodeRect.width / 2;
            const toolbarWidth = toolbarRef.current?.offsetWidth || 0;
            const halfToolbar = toolbarWidth / 2;
            const canClamp = toolbarWidth > 0 && toolbarWidth <= containerRect.width - 20;
            const left = canClamp ? Math.min(Math.max(preferredLeft, halfToolbar + 10), containerRect.width - halfToolbar - 10) : preferredLeft;
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
    }, [anchor === null, containerRef, node, viewport.k, viewport.x, viewport.y]);

    if (!node || !anchor) return null;

    const isImage = node.type === CanvasNodeType.Image;
    const isVideo = node.type === CanvasNodeType.Video;
    const isAudio = node.type === CanvasNodeType.Audio;
    const hasImage = isImage && Boolean(node.metadata?.content);
    const isText = node.type === CanvasNodeType.Text;
    const isCharacterReference = isText && node.metadata?.workflowKind === "character" && Boolean(node.metadata.characterAssetId);
    const isEditableText = isText && !isCharacterReference;
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
        onNodeSaveAsset: onSaveAsset, onNodeMaskEdit: onMaskEdit, onNodeEmotion: onEmotion, onNodePortraitTexture: onPortraitTexture, onNodeCrop: onCrop,
        onNodeSplit: onSplit, onNodeUpscale: onUpscale, onNodeSuperResolve: onSuperResolve, onNodeAngle: onAngle, onNodeViewImage: onViewImage,
        onNodeExtractVideoFrames: onExtractVideoFrames, onNodeExtractAudioFromVideo: onExtractAudioFromVideo, onNodeTrimVideoSegments: onTrimVideoSegments, onNodeReversePrompt: onReversePrompt, onNodeToggleFreeResize: onToggleFreeResize,
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
        extractingVideoFrames,
        extractingAudio,
        trimmingVideo,
        mergingVideos: false,
        addPanelOpen: false,
        appearancePanelOpen: false,
        settingsPanelOpen: false,
        handlers: nodeHoverHandlers,
    };

    // 注册表只负责动作合同与适用性，Dock 的业务分组在此处唯一确定。
    const registryTools = resolveToolbarTools("node-hover", nodeHoverCtx, null);
    // 锁定始终放在菜单末尾，避免与业务工具混排。
    const otherRegistryTools = registryTools.filter((tool) => tool.id !== "node-lock");
    // 转为 ToolbarTool 供组件内部逻辑使用
    const otherTools: ToolbarTool[] = otherRegistryTools.map((tool) => ({
        id: tool.id,
        label: tool.displayLabel ? (typeof tool.displayLabel === "function" ? tool.displayLabel(nodeHoverCtx) : tool.displayLabel) : (typeof tool.label === "function" ? tool.label(nodeHoverCtx) : tool.label),
        icon: typeof tool.icon === "function" ? tool.icon(nodeHoverCtx) : tool.icon,
        active: tool.active?.(nodeHoverCtx),
        danger: tool.danger,
        disabled: tool.disabled?.(nodeHoverCtx),
        onClick: () => tool.run(nodeHoverCtx),
    }));
    const allTools: ToolbarTool[] = hasImage && !simpleMode
        ? [...otherTools, ...imageTools.map((tool) => ({ id: tool.id, label: tool.label, icon: tool.icon, onClick: tool.onClick }))]
        : otherTools;
    const toolById = new Map(allTools.map((tool) => [tool.id, tool]));
    const takeTools = (ids: string[]) => ids.map((id) => toolById.get(id)).filter((tool): tool is ToolbarTool => Boolean(tool));
    const imageBaseTools = takeTools(hasImage ? ["delete", "download"] : ["delete", "uploadImage"]);
    const imageEditTools = takeTools(["maskEdit", "crop", "split"]);
    const imagePortraitTools = takeTools(["emotion", "portraitTexture"]).map((tool) => tool.id === "emotion" ? { ...tool, label: "人物情绪" } : tool);
    const imageAngleTool = toolById.get("angle");
    const videoTools = takeTools(["delete", "download", "subtitles", "timeline", "extractFrames", "extractAudio", "trimRegenerate", "uploadVideo"]).map((tool) => {
        if (tool.id === "extractFrames") return { ...tool, label: "提取画面" };
        if (tool.id === "trimRegenerate") return { ...tool, label: "截取片段" };
        return tool;
    });
    const genericTools = takeTools(isAudio ? ["delete", "download", "timeline", "uploadAudio"] : isEditableText ? ["delete", "edit", "editText", "generateImage", "saveAsset"] : ["delete", "info", "config"]);
    const visibleToolIds = new Set([
        ...(isImage ? [...imageBaseTools, ...imageEditTools, ...imagePortraitTools, ...(imageAngleTool ? [imageAngleTool] : [])] : isVideo ? videoTools : genericTools).map((tool) => tool.id),
    ]);
    const overflowTools = allTools
        .filter((tool) => !visibleToolIds.has(tool.id))
        .map((tool) => tool.id === "edit" && (isImage || isVideo) ? { ...tool, label: "生成设置" } : tool);
    const lockTool: ToolbarTool = {
        id: "node-lock",
        label: node.metadata?.locked ? "解锁" : "锁定",
        icon: node.metadata?.locked ? <Unlock className="size-3.5" /> : <Lock className="size-3.5" />,
        active: Boolean(node.metadata?.locked),
        onClick: () => onToggleLocked(node),
    };
    const handleMenuOpenChange = (menuId: string, open: boolean) => {
        setOpenMenuId((current) => open ? menuId : current === menuId ? null : current);
        if (open) onKeep(node.id);
        else onLeave();
    };
    const dockStyle = canvasDockStyle(theme, theme.node.text);

    return (
        <div
            ref={toolbarRef}
            className="canvas-node-toolbar absolute z-[var(--z-node-toolbar)] -translate-x-1/2 -translate-y-full"
            style={{ left: anchor.left, top: anchor.top, width: "max-content", maxWidth: "min(calc(100% - 20px), 960px)", color: theme.node.text }}
            onMouseEnter={() => onKeep(node.id)}
            onMouseLeave={() => { if (!openMenuId) onLeave(); }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <div
                role="toolbar"
                aria-label="节点快捷工具"
                className="thin-scrollbar flex h-11 max-w-full items-center gap-0.5 overflow-x-auto rounded-[var(--dock-radius-tight)] px-2 backdrop-blur-2xl"
                style={{ ...dockStyle, border: 0 }}
            >
                {isImage ? (
                    <>
                        {imageBaseTools.map((tool) => <NodeDockToolButton key={tool.id} tool={tool} />)}
                        {imageEditTools.length ? <NodeDockMenuButton menuId="image-edit" label="编辑" icon={imageEditTools[0].icon} tools={imageEditTools} openMenuId={openMenuId} onOpenChange={handleMenuOpenChange} /> : null}
                        {imagePortraitTools.length ? <NodeDockMenuButton menuId="image-portrait" label="人物调整" icon={imagePortraitTools[0].icon} tools={imagePortraitTools} openMenuId={openMenuId} onOpenChange={handleMenuOpenChange} /> : null}
                        {imageAngleTool ? <NodeDockToolButton tool={imageAngleTool} /> : null}
                    </>
                ) : isVideo ? videoTools.map((tool) => <NodeDockToolButton key={tool.id} tool={tool} />) : genericTools.map((tool) => <NodeDockToolButton key={tool.id} tool={tool} />)}
                <span aria-hidden className="aceternity-dock-separator mx-1.5 h-6 w-px shrink-0" />
                <NodeDockToolButton tool={lockTool} />
                {overflowTools.length ? (
                    <NodeDockMenuButton menuId="more" label="更多" icon={<Ellipsis className="size-3.5" />} tools={overflowTools} openMenuId={openMenuId} onOpenChange={handleMenuOpenChange} placement="topRight" />
                ) : null}
            </div>
        </div>
    );
}

function NodeDockToolButton({ tool }: { tool: ToolbarTool }) {
    return (
        <button
            type="button"
            className={`aceternity-dock-command is-labeled pointer-events-auto inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-[var(--dock-item-radius)] px-2.5 outline-none ${tool.active ? "is-active" : ""} ${tool.danger ? "is-danger" : ""}`}
            aria-label={tool.label}
            aria-pressed={tool.active || undefined}
            disabled={tool.disabled}
            onClick={tool.onClick}
        >
            <span className="grid size-3.5 shrink-0 place-items-center">{tool.icon}</span>
            <span className="inline-flex h-4 items-center whitespace-nowrap text-[var(--fs-label)] font-medium leading-none">{tool.label}</span>
        </button>
    );
}

function NodeDockMenuButton({ menuId, label, icon, tools, openMenuId, onOpenChange, placement = "top" }: { menuId: string; label: string; icon: ReactNode; tools: ToolbarTool[]; openMenuId: string | null; onOpenChange: (menuId: string, open: boolean) => void; placement?: "top" | "topRight" }) {
    const open = openMenuId === menuId;
    const items: MenuProps["items"] = tools.map((tool) => ({ key: tool.id, icon: tool.icon, label: tool.label, disabled: tool.disabled, onClick: tool.onClick }));
    return (
        <Dropdown open={open} trigger={["click"]} placement={placement} onOpenChange={(nextOpen) => onOpenChange(menuId, nextOpen)} menu={{ items }}>
            <button
                type="button"
                className={`aceternity-dock-command is-labeled pointer-events-auto inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-[var(--dock-item-radius)] px-2.5 outline-none ${open ? "is-active" : ""}`}
                aria-label={label}
                aria-expanded={open}
            >
                <span className="grid size-3.5 shrink-0 place-items-center">{icon}</span>
                <span className="inline-flex h-4 items-center whitespace-nowrap text-[var(--fs-label)] font-medium leading-none">{label}</span>
                <ChevronDown className="size-3 shrink-0 opacity-55" />
            </button>
        </Dropdown>
    );
}

export function CanvasNodeInfoModal({ node, open, onClose, onMetadataChange, readOnly = false, onUnauthorized }: { node: CanvasNodeData | null; open: boolean; onClose: () => void; onMetadataChange?: (nodeId: string, metadata: Partial<CanvasNodeMetadata>) => void; readOnly?: boolean; onUnauthorized?: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [assetTags, setAssetTags] = useState<string[]>([]);
    const [assetTagInput, setAssetTagInput] = useState("");
    const [assetCategory, setAssetCategory] = useState<CanvasAssetCategory>("other");
    const imageBytes = node?.type === CanvasNodeType.Image && node.metadata?.content ? getDataUrlByteSize(node.metadata.content) : 0;
    const batchCount = node?.type === CanvasNodeType.Image ? node.metadata?.batchChildIds?.length || 0 : 0;
    const nodeTypeLabel = node?.type === CanvasNodeType.Text ? "文本" : node?.type === CanvasNodeType.Script ? "分镜脚本" : node?.type === CanvasNodeType.Skill ? "技能" : node?.type === CanvasNodeType.Image ? "图片" : node?.type === CanvasNodeType.Video ? "视频" : node?.type === CanvasNodeType.Audio ? "音频" : node?.type === CanvasNodeType.Drawing ? "绘图" : node?.type === CanvasNodeType.Frame ? "背板" : "生成配置";
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
        <Modal
            className="workspace-modal canvas-node-info-modal"
            title={title}
            open={open && Boolean(node)}
            centered
            footer={null}
            onCancel={onClose}
            width="min(920px, calc(100vw - 32px))"
            styles={{ body: { paddingTop: 4 } }}
        >
            {node ? (
                <div className="canvas-node-inspector" style={{ color: theme.node.text }}>
                        <div className="thin-scrollbar canvas-node-inspector-scroll">
                            <section className="canvas-node-inspector-section">
                                <div className="canvas-node-inspector-section-heading"><span>基础信息</span><em>{node.metadata?.status || "idle"}</em></div>
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
                                    <div className="canvas-node-inspector-section-heading"><span>项目资产分类</span></div>
                                    <div className="canvas-node-inspector-options">
                                        {assetCategoryOptions.map((option) => {
                                            const active = assetCategory === option.value;
                                            return <button key={option.value} type="button" disabled={readOnly} aria-pressed={active} onClick={() => saveAssetCategory(option.value)} className={active ? "is-active" : ""}>{option.label}</button>;
                                        })}
                                    </div>
                                    <p className="canvas-node-inspector-help">生成后会按此分类进入项目资产；角色、场景和画风工作流会自动预填。</p>
                                </section>
                            ) : null}

                            {node.metadata?.prompt ? (
                                <section className="canvas-node-inspector-section">
                                    <div className="canvas-node-inspector-section-heading"><span>提示词</span></div>
                                    <div className="canvas-node-inspector-copy canvas-node-inspector-prompt">{node.metadata.prompt}</div>
                                </section>
                            ) : null}

                            {nodeGenerationRows(node).length ? (
                                <section className="canvas-node-inspector-section">
                                    <div className="canvas-node-inspector-section-heading"><span>生成信息</span></div>
                                    <div className="canvas-node-inspector-facts">
                                        {nodeGenerationRows(node).map((item) => <InfoRow key={item.label} label={item.label} value={item.value} />)}
                                    </div>
                                </section>
                            ) : null}

                            {node.type === CanvasNodeType.Skill && node.metadata?.skillSnapshot ? (
                                <section className="canvas-node-inspector-section">
                                    <div className="canvas-node-inspector-section-heading"><span>技能模板</span></div>
                                    <div className="canvas-node-inspector-copy">{node.metadata.skillSnapshot.template}</div>
                                    {node.metadata.skillSnapshot.outputContract ? <><div className="canvas-node-inspector-subheading">输出约束</div><div className="canvas-node-inspector-copy">{node.metadata.skillSnapshot.outputContract}</div></> : null}
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

                            {node.metadata?.errorDetails ? (
                                <section className="canvas-node-inspector-error">
                                    {generationErrorMessage(node.metadata.errorDetails)}
                                </section>
                            ) : null}
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

function nodeGenerationRows(node: CanvasNodeData) {
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

    add("模型", metadata.model);
    add("生成尺寸", metadata.size);
    add("分辨率", metadata.vquality || metadata.quality);
    add("秒数", metadata.seconds ? `${metadata.seconds} 秒` : undefined);
    add("生成声音", metadata.generateAudio === undefined ? undefined : metadata.generateAudio === "true" ? "开启" : "关闭");
    add("水印", metadata.watermark === undefined ? undefined : metadata.watermark === "true" ? "开启" : "关闭");
    if (metadata.references?.length) {
        const referenceNames = metadata.references.slice(0, 3).map((reference) => reference.split("/").pop() || reference).join("、");
        add("引用素材", `${metadata.references.length} 个${referenceNames ? `（${referenceNames}${metadata.references.length > 3 ? "…" : ""}）` : ""}`);
    }
    addTime("创建时间", metadata.taskCreatedAt);
    addTime("开始时间", metadata.taskStartedAt);
    addTime("完成时间", metadata.taskCompletedAt);
    addDuration(metadata.taskDurationMs);
    return rows;
}
