import { AnimatePresence, useReducedMotion } from "motion/react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronRight, Clapperboard, Clipboard, Copy, FileText, FolderOpen, FolderPlus, Image as ImageIcon, Layers3, Link2, Maximize2, MessageSquare, Music2, PanelTop, Plus, Redo2, Settings2, Trash2, Type, Undo2, Upload, Video } from "lucide-react";

import { aceternityMotion } from "@/lib/aceternity-motion";
import { SpotlightSurface } from "@/components/ui/aceternity/spotlight-surface";
import { CanvasCreateCommandGrid, type CanvasCreateCommand } from "@/components/canvas/canvas-create-command-grid";
import { canvasThemes } from "@/lib/canvas-theme";
import { resourceIdFromStorageKey } from "@/services/api/resources";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData, type CanvasWorkspaceMode, type ContextMenuState, type Position } from "@/types/canvas";

type CanvasNodeContextMenuProps = {
    menu: ContextMenuState;
    node?: CanvasNodeData | null;
    workspaceMode?: CanvasWorkspaceMode;
    canUndo: boolean;
    canRedo: boolean;
    canPaste: boolean;
    onClose: () => void;
    onAddNode: (type: CanvasNodeType) => void;
    onAddNovel: () => void;
    onOpenDirector: (position: Position) => void;
    onUpload: () => void;
    onOpenAssets: () => void;
    onUndo: () => void;
    onRedo: () => void;
    onPaste: () => void;
    onCopyNode: () => void;
    onDuplicate: () => void;
    onDelete: () => void;
    onSaveAsset: () => void;
    onViewImage: () => void;
    onEditNode: () => void;
    onEditText: () => void;
    onGenerateImage: () => void;
    onCopyContent: () => void;
    onCopyOssUrl: () => void;
    onToggleFrame: () => void;
};

export function CanvasNodeContextMenu({
    menu,
    node,
    workspaceMode = "professional",
    canUndo,
    canRedo,
    canPaste,
    onClose,
    onAddNode,
    onAddNovel,
    onOpenDirector,
    onUpload,
    onOpenAssets,
    onUndo,
    onRedo,
    onPaste,
    onCopyNode,
    onDuplicate,
    onDelete,
    onSaveAsset,
    onViewImage,
    onEditNode,
    onEditText,
    onGenerateImage,
    onCopyContent,
    onCopyOssUrl,
    onToggleFrame,
}: CanvasNodeContextMenuProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const reducedMotion = useReducedMotion();
    const [addOpen, setAddOpen] = useState(false);

    useEffect(() => {
        const close = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Element && target.closest(".ant-popover")) return;
            onClose();
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };
        window.addEventListener("pointerdown", close);
        window.addEventListener("keydown", closeOnEscape);
        return () => {
            window.removeEventListener("pointerdown", close);
            window.removeEventListener("keydown", closeOnEscape);
        };
    }, [onClose]);

    useEffect(() => {
        setAddOpen(false);
    }, [menu.type, menu.x, menu.y]);

    const runAction = (action: () => void) => {
        action();
        onClose();
    };
    const nodeContent = typeof node?.metadata?.content === "string" ? node.metadata.content : "";
    const isImage = node?.type === CanvasNodeType.Image;
    const isText = node?.type === CanvasNodeType.Text;
    const isVideo = node?.type === CanvasNodeType.Video;
    const isAudio = node?.type === CanvasNodeType.Audio;
    const isFrame = node?.type === CanvasNodeType.Frame;
    const hasNodeContent = isText ? Boolean(nodeContent.trim()) : Boolean(nodeContent);
    const canSaveAsset = Boolean(node && (isText ? hasNodeContent : hasNodeContent && (isImage || isVideo || isAudio)));
    const canOpenPreview = Boolean(isImage && hasNodeContent);
    const canOpenEditor = Boolean(node && (isText || isImage || isVideo));
    const canGenerateFromText = Boolean(isText && hasNodeContent);
    const canCopyOssUrl = Boolean((isImage || isVideo) && resourceIdFromStorageKey(node?.metadata?.storageKey));
    const position = getContextMenuPosition(menu);

    return (
        <>
            <SpotlightSurface
                spotlightColor={theme.toolbar.itemHover}
                initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97, x: -3, y: -3 }}
                animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
                transition={{ duration: aceternityMotion.duration.instant, ease: aceternityMotion.easing.enter }}
                className="aceternity-floating-panel fixed z-[80] flex w-[184px] max-h-[calc(100vh-56px)] origin-top-left flex-col overflow-hidden rounded-[14px] border p-1 backdrop-blur-2xl"
                style={{ left: position.left, top: position.top, background: theme.spatial.elevated, borderColor: theme.toolbar.border, color: theme.node.text, boxShadow: `0 30px 90px ${theme.spatial.shadow}` }}
                onContextMenu={(event) => event.preventDefault()}
                onPointerDown={(event) => event.stopPropagation()}
            >
                <div className="absolute inset-x-8 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${theme.toolbar.border}, transparent)` }} />
                <div className="thin-scrollbar min-h-0 overflow-y-auto">
                    {menu.type === "canvas" ? (
                        <>
                            <MenuHeader title="画布命令" />
                            <MenuButton icon={<Plus className="size-4" />} label="添加节点" chevron active={addOpen} onClick={() => setAddOpen((value) => !value)} />
                            <MenuButton icon={<Upload className="size-4" />} label="上传到这里" onClick={() => runAction(onUpload)} />
                            <MenuButton icon={<FolderOpen className="size-4" />} label="从素材库插入" onClick={() => runAction(onOpenAssets)} />
                            <MenuDivider />
                            <MenuSection label="历史与剪贴板" />
                            <MenuButton icon={<Undo2 className="size-4" />} label="撤销" shortcut="⌘Z" disabled={!canUndo} onClick={() => runAction(onUndo)} />
                            <MenuButton icon={<Redo2 className="size-4" />} label="重做" shortcut="⇧⌘Z" disabled={!canRedo} onClick={() => runAction(onRedo)} />
                            <MenuButton icon={<Clipboard className="size-4" />} label="粘贴" shortcut="⌘V" disabled={!canPaste} onClick={() => runAction(onPaste)} />
                        </>
                    ) : menu.type === "node" ? (
                        <>
                            <MenuHeader title={node?.title || nodeTypeLabel(node)} />
                            <MenuSection label="节点操作" />
                            {isFrame ? <MenuButton icon={<PanelTop className="size-4" />} label={node?.metadata?.frame?.collapsed ? "展开背板" : "折叠背板"} onClick={() => runAction(onToggleFrame)} /> : <MenuButton icon={<FolderPlus className="size-4" />} label="保存到我的素材" disabled={!canSaveAsset} onClick={() => runAction(onSaveAsset)} />}
                            {isImage ? <MenuButton icon={<Maximize2 className="size-4" />} label="进入全景预览" disabled={!canOpenPreview} onClick={() => runAction(onViewImage)} /> : null}
                            {isText ? <MenuButton icon={<MessageSquare className="size-4" />} label="编辑文本" onClick={() => runAction(onEditText)} /> : null}
                            {isText ? <MenuButton icon={<ImageIcon className="size-4" />} label="用文本生图" disabled={!canGenerateFromText} onClick={() => runAction(onGenerateImage)} /> : null}
                            {!isText && canOpenEditor ? <MenuButton icon={<MessageSquare className="size-4" />} label="编辑提示词" onClick={() => runAction(onEditNode)} /> : null}
                            <MenuDivider />
                            <MenuSection label="副本与内容" />
                            <MenuButton icon={<Copy className="size-4" />} label={isFrame ? "复制背板及内容" : "复制节点"} shortcut="⌘C" onClick={() => runAction(onCopyNode)} />
                            {isImage ? <MenuButton icon={<ImageIcon className="size-4" />} label="复制图片" disabled={!hasNodeContent} onClick={() => runAction(onCopyContent)} /> : null}
                            {isText ? <MenuButton icon={<Clipboard className="size-4" />} label="复制文本" disabled={!hasNodeContent} onClick={() => runAction(onCopyContent)} /> : null}
                            {isImage || isVideo ? <MenuButton icon={<Link2 className="size-4" />} label="复制 OSS 地址" disabled={!canCopyOssUrl} onClick={() => runAction(onCopyOssUrl)} /> : null}
                            <MenuButton icon={<Copy className="size-4" />} label={isFrame ? "创建背板副本" : "创建参数变体"} shortcut="⌘D" onClick={() => runAction(onDuplicate)} />
                            <MenuButton icon={<Clipboard className="size-4" />} label="粘贴" shortcut="⌘V" disabled={!canPaste} onClick={() => runAction(onPaste)} />
                            <MenuButton icon={<Trash2 className="size-4" />} label={isFrame ? "删除背板" : "删除节点"} danger onClick={() => runAction(onDelete)} />
                        </>
                    ) : (
                        <>
                            <MenuHeader title="连接" />
                            <MenuButton icon={<Trash2 className="size-4" />} label="删除连接" danger onClick={() => runAction(onDelete)} />
                        </>
                    )}
                </div>
            </SpotlightSurface>

            <AnimatePresence>
                {menu.type === "canvas" && addOpen ? (
                    <AddNodeContextMenu
                        parentPosition={position}
                        workspaceMode={workspaceMode}
                        reducedMotion={Boolean(reducedMotion)}
                        onAddNode={(type) => runAction(() => onAddNode(type))}
                        onAddNovel={() => runAction(onAddNovel)}
                        onOpenDirector={() => runAction(() => onOpenDirector(menu.position))}
                        onUpload={() => runAction(onUpload)}
                        onOpenAssets={() => runAction(onOpenAssets)}
                    />
                ) : null}
            </AnimatePresence>
        </>
    );
}

function AddNodeContextMenu({ parentPosition, workspaceMode, reducedMotion, onAddNode, onAddNovel, onOpenDirector, onUpload, onOpenAssets }: { parentPosition: { left: number; top: number }; workspaceMode: CanvasWorkspaceMode; reducedMotion: boolean; onAddNode: (type: CanvasNodeType) => void; onAddNovel: () => void; onOpenDirector: () => void; onUpload: () => void; onOpenAssets: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const left = getSubmenuLeft(parentPosition.left);
    const simpleMode = workspaceMode === "simple";
    const nodeCommands: CanvasCreateCommand[] = [
        { id: "text", label: "文本", icon: <Type />, onClick: () => onAddNode(CanvasNodeType.Text) },
        { id: "novel", label: "小说", icon: <FileText />, badge: "文档", onClick: onAddNovel },
        { id: "script", label: "分镜脚本", icon: <Clapperboard />, badge: "核心", onClick: () => onAddNode(CanvasNodeType.Script) },
        ...(!simpleMode ? [{ id: "frame", label: "背板", icon: <PanelTop />, onClick: () => onAddNode(CanvasNodeType.Frame) }] : []),
        { id: "image", label: "图片", icon: <ImageIcon />, onClick: () => onAddNode(CanvasNodeType.Image) },
        { id: "video", label: "视频", icon: <Video />, onClick: () => onAddNode(CanvasNodeType.Video) },
        ...(!simpleMode ? [
            { id: "director", label: "导演台", icon: <Layers3 />, badge: "3D", onClick: onOpenDirector },
            { id: "audio", label: "音频", icon: <Music2 />, onClick: () => onAddNode(CanvasNodeType.Audio) },
            { id: "config", label: "生成配置", icon: <Settings2 />, onClick: () => onAddNode(CanvasNodeType.Config) },
        ] : []),
    ];
    const resourceCommands: CanvasCreateCommand[] = [
        { id: "upload", label: "上传文件", icon: <Upload />, onClick: onUpload },
        { id: "assets", label: "素材库", icon: <FolderOpen />, onClick: onOpenAssets },
    ];

    return (
        <SpotlightSurface
            spotlightColor={theme.toolbar.itemHover}
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, x: left > parentPosition.left ? -5 : 5, scale: 0.97 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, x: left > parentPosition.left ? -4 : 4, scale: 0.98 }}
            transition={{ duration: aceternityMotion.duration.instant, ease: aceternityMotion.easing.enter }}
            className="aceternity-floating-panel fixed z-[81] w-[260px] origin-top overflow-hidden rounded-[14px] border p-2 backdrop-blur-2xl"
            style={{ left, top: parentPosition.top, background: theme.spatial.elevated, borderColor: theme.toolbar.border, color: theme.node.text, boxShadow: `0 30px 90px ${theme.spatial.shadow}` }}
            onContextMenu={(event) => event.preventDefault()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <div className="absolute inset-x-8 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${theme.toolbar.border}, transparent)` }} />
            <div>
                <MenuHeader title="添加节点" />
                <MenuSection label="创作节点" />
                <CanvasCreateCommandGrid commands={nodeCommands} />
                <MenuSection label="导入资源" />
                <CanvasCreateCommandGrid commands={resourceCommands} variant="resource" />
            </div>
        </SpotlightSurface>
    );
}

function MenuHeader({ title, description }: { title: string; description?: string }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return (
        <div className="mb-0.5 px-1.5 py-1.5">
            <span className="min-w-0"><span className="block truncate text-[11px] font-semibold">{title}</span>{description && description !== title ? <span className="mt-0.5 block truncate text-[8px]" style={{ color: theme.node.muted }}>{description}</span> : null}</span>
        </div>
    );
}

function MenuSection({ label }: { label: string }) {
    return <div className="px-1.5 pb-0.5 pt-1 text-[7px] font-bold uppercase opacity-40">{label}</div>;
}

function MenuButton({ icon, label, detail, shortcut, badge, chevron = false, active = false, disabled = false, danger = false, onClick }: { icon: ReactNode; label: string; detail?: string; shortcut?: string; badge?: string; chevron?: boolean; active?: boolean; disabled?: boolean; danger?: boolean; onClick?: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const color = danger ? theme.accent.danger : theme.node.text;
    return (
        <button
            type="button"
            className="canvas-menu-item group flex min-h-7 w-full items-center gap-1.5 rounded-[8px] border border-transparent px-1 py-0.5 text-left outline-none enabled:hover:border-black/10 enabled:hover:bg-black/5 focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-35 dark:enabled:hover:border-white/10 dark:enabled:hover:bg-white/8"
            style={{ color, background: active ? theme.toolbar.activeBg : undefined, "--tw-ring-color": theme.node.muted } as CSSProperties}
            disabled={disabled}
            onClick={onClick}
        >
            <span className="canvas-menu-item-icon grid size-5 shrink-0 place-items-center rounded-[6px] border opacity-75 group-hover:opacity-100 [&_svg]:size-2.5" style={{ background: danger ? `${theme.accent.danger}12` : theme.spatial.surface, borderColor: danger ? `${theme.accent.danger}33` : theme.toolbar.border, color: danger ? theme.accent.danger : theme.node.text }}>{icon}</span>
            <span className="min-w-0 flex-1"><span className="flex items-center gap-1 text-[9px] font-semibold"><span className="truncate">{label}</span>{badge ? <span className="rounded-full border px-1 py-0.5 text-[6px] font-bold" style={{ background: theme.toolbar.activeBg, borderColor: theme.toolbar.border, color: theme.node.muted }}>{badge}</span> : null}</span>{detail ? <span className="mt-0.5 block truncate text-[7px]" style={{ color: theme.node.muted }}>{detail}</span> : null}</span>
            {shortcut ? <span className="shrink-0 text-[8px] opacity-38">{shortcut}</span> : null}
            {chevron ? <ChevronRight className="size-3 shrink-0 opacity-45 transition-transform group-hover:translate-x-0.5" /> : null}
        </button>
    );
}

function MenuDivider() {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return <div className="mx-1.5 my-1 h-px" style={{ background: `linear-gradient(90deg, transparent, ${theme.toolbar.border}, transparent)` }} />;
}

function getContextMenuPosition(menu: ContextMenuState) {
    if (typeof window === "undefined") return { left: menu.x, top: menu.y };
    const width = 184;
    const estimatedHeight = menu.type === "node" ? Math.min(360, window.innerHeight - 72) : menu.type === "canvas" ? 250 : 84;
    return {
        left: clamp(menu.x, 12, Math.max(12, window.innerWidth - width - 12)),
        top: clamp(menu.y, 68, Math.max(68, window.innerHeight - estimatedHeight - 12)),
    };
}

function getSubmenuLeft(parentLeft: number) {
    if (typeof window === "undefined") return parentLeft + 192;
    return parentLeft + 184 + 8 + 260 <= window.innerWidth - 12 ? parentLeft + 192 : Math.max(12, parentLeft - 268);
}

function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
}

function nodeTypeLabel(node?: CanvasNodeData | null) {
    if (!node) return "节点";
    if (node.type === CanvasNodeType.Image) return "图片节点";
    if (node.type === CanvasNodeType.Text) return "文本节点";
    if (node.type === CanvasNodeType.Script) return "分镜脚本节点";
    if (node.type === CanvasNodeType.Skill) return "技能节点";
    if (node.type === CanvasNodeType.Video) return "视频节点";
    if (node.type === CanvasNodeType.Audio) return "音频节点";
    if (node.type === CanvasNodeType.Frame) return "背板";
    return "生成配置节点";
}
