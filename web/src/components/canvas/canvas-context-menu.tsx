import { AnimatePresence, useReducedMotion } from "motion/react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowLeft, Check, ChevronRight, Clapperboard, Clipboard, Copy, FolderOpen, FolderPlus, Image as ImageIcon, Layers3, Link2, Maximize2, Music2, PanelTop, Pencil, Plus, Redo2, Tags, Trash2, Type, Undo2, Upload, UserRound, Video } from "lucide-react";

import { aceternityMotion } from "@/lib/aceternity-motion";
import { SpotlightSurface } from "@/components/ui/aceternity/spotlight-surface";
import { CanvasCreateCommandGrid, type CanvasCreateCommand } from "@/components/canvas/canvas-create-command-grid";
import { canvasThemes } from "@/lib/canvas-theme";
import { canvasNodeAssetCategory } from "@/lib/canvas/canvas-node-asset";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData, type CanvasWorkspaceMode, type ContextMenuState, type Position } from "@/types/canvas";

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

type CanvasNodeContextMenuProps = {
    menu: ContextMenuState;
    node?: CanvasNodeData | null;
    workspaceMode?: CanvasWorkspaceMode;
    isProjectLinked?: boolean;
    canUndo: boolean;
    canRedo: boolean;
    canPaste: boolean;
    onClose: () => void;
    onAddNode: (type: CanvasNodeType) => void;
    onOpenDirector: (position: Position) => void;
    onUpload: () => void;
    onOpenAssets: () => void;
    onOpenProjectCharacters: () => void;
    onUndo: () => void;
    onRedo: () => void;
    onPaste: () => void;
    onCopyNode: () => void;
    onDuplicate: () => void;
    onDelete: () => void;
    onSaveAsset: () => void;
    onViewMedia: () => void;
    onEditText: () => void;
    onOpenDrawing: () => void;
    onGenerateImage: () => void;
    onCopyContent: () => void;
    onCopyMediaUrl: () => void;
    onSetAssetCategory: (category: CanvasAssetCategory) => void;
    onToggleFrame: () => void;
};

export function CanvasNodeContextMenu({
    menu,
    node,
    workspaceMode = "professional",
    isProjectLinked = false,
    canUndo,
    canRedo,
    canPaste,
    onClose,
    onAddNode,
    onOpenDirector,
    onUpload,
    onOpenAssets,
    onOpenProjectCharacters,
    onUndo,
    onRedo,
    onPaste,
    onCopyNode,
    onDuplicate,
    onDelete,
    onSaveAsset,
    onViewMedia,
    onEditText,
    onOpenDrawing,
    onGenerateImage,
    onCopyContent,
    onCopyMediaUrl,
    onSetAssetCategory,
    onToggleFrame,
}: CanvasNodeContextMenuProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const reducedMotion = useReducedMotion();
    const [addOpen, setAddOpen] = useState(false);
    const [categoryOpen, setCategoryOpen] = useState(false);

    useEffect(() => {
        const close = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Element && target.closest(".ant-popover")) return;
            onClose();
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            if (categoryOpen) setCategoryOpen(false);
            else onClose();
        };
        window.addEventListener("pointerdown", close);
        window.addEventListener("keydown", closeOnEscape);
        return () => {
            window.removeEventListener("pointerdown", close);
            window.removeEventListener("keydown", closeOnEscape);
        };
    }, [categoryOpen, onClose]);

    useEffect(() => {
        setAddOpen(false);
        setCategoryOpen(false);
    }, [menu.type, menu.x, menu.y]);

    const runAction = (action: () => void) => {
        action();
        onClose();
    };
    const nodeContent = typeof node?.metadata?.content === "string" ? node.metadata.content : "";
    const isImage = node?.type === CanvasNodeType.Image;
    const isText = node?.type === CanvasNodeType.Text;
    const isCharacterReference = Boolean(isText && node?.metadata?.workflowKind === "character" && node.metadata.characterAssetId);
    const isDrawing = node?.type === CanvasNodeType.Drawing;
    const isVideo = node?.type === CanvasNodeType.Video;
    const isMedia = isImage || isVideo;
    const isAudio = node?.type === CanvasNodeType.Audio;
    const isFrame = node?.type === CanvasNodeType.Frame;
    const hasNodeContent = isText ? Boolean(nodeContent.trim()) : Boolean(nodeContent);
    const canSaveAsset = Boolean(node && !isCharacterReference && (isText ? hasNodeContent : hasNodeContent && (isImage || isVideo || isAudio)));
    const canOpenPreview = Boolean(isMedia && hasNodeContent);
    const canGenerateFromText = Boolean(isText && !isCharacterReference && hasNodeContent);
    const canCopyMediaUrl = Boolean(isMedia && hasNodeContent);
    const assetCategory = node ? canvasNodeAssetCategory(node) : "other";
    const position = getContextMenuPosition(menu);

    return (
        <>
            <SpotlightSurface
                spotlightColor={theme.toolbar.itemHover}
                initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97, x: -3, y: -3 }}
                animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
                transition={{ duration: aceternityMotion.duration.instant, ease: aceternityMotion.easing.enter }}
                className="aceternity-floating-panel fixed z-[var(--z-popover)] flex w-[224px] max-h-[calc(100vh-56px)] origin-top-left flex-col overflow-hidden rounded-xl border p-1.5 backdrop-blur-2xl"
                style={{ left: position.left, top: position.top, background: theme.spatial.elevated, borderColor: theme.toolbar.border, color: theme.node.text, boxShadow: `0 30px 90px ${theme.spatial.shadow}` }}
                onContextMenu={(event) => event.preventDefault()}
                onPointerDown={(event) => event.stopPropagation()}
            >
                <div className="absolute inset-x-8 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${theme.toolbar.border}, transparent)` }} />
                <div className="thin-scrollbar min-h-0 overflow-y-auto">
                    {menu.type === "node" && isMedia && categoryOpen ? (
                        <>
                            <MenuHeader title="设置资产分类" description={node?.title || nodeTypeLabel(node)} onBack={() => setCategoryOpen(false)} />
                            <MenuSection label="项目用途" />
                            {assetCategoryOptions.map((option) => (
                                <MenuButton
                                    key={option.value}
                                    icon={assetCategory === option.value ? <Check /> : <Tags />}
                                    label={option.label}
                                    active={assetCategory === option.value}
                                    onClick={() => runAction(() => onSetAssetCategory(option.value))}
                                />
                            ))}
                        </>
                    ) : menu.type === "canvas" ? (
                        <>
                            <MenuHeader title="画布命令" />
                            <MenuButton icon={<Plus className="size-4" />} label="添加节点" chevron active={addOpen} onClick={() => setAddOpen((value) => !value)} />
                            <MenuButton icon={<Upload className="size-4" />} label="上传到这里" onClick={() => runAction(onUpload)} />
                            {!isProjectLinked ? <MenuButton icon={<FolderOpen className="size-4" />} label="从素材库插入" onClick={() => runAction(onOpenAssets)} /> : null}
                            <MenuDivider />
                            <MenuSection label="历史与剪贴板" />
                            <MenuButton icon={<Undo2 className="size-4" />} label="撤销" shortcut="⌘Z" disabled={!canUndo} onClick={() => runAction(onUndo)} />
                            <MenuButton icon={<Redo2 className="size-4" />} label="重做" shortcut="⇧⌘Z" disabled={!canRedo} onClick={() => runAction(onRedo)} />
                            <MenuButton icon={<Clipboard className="size-4" />} label="粘贴" shortcut="⌘V" disabled={!canPaste} onClick={() => runAction(onPaste)} />
                        </>
                    ) : menu.type === "node" ? (
                        <>
                            {isCharacterReference ? (
                                <>
                                    <MenuHeader title="角色卡" description={node?.metadata?.characterName || node?.title} />
                                    <MenuSection label="角色引用" />
                                    <MenuButton icon={<UserRound />} label="查看角色详情" onClick={() => runAction(onEditText)} />
                                    <MenuDivider />
                                    <MenuSection label="节点" />
                                    <MenuButton icon={<Copy />} label="复制角色引用" shortcut="⌘C" onClick={() => runAction(onCopyNode)} />
                                    <MenuButton icon={<Layers3 />} label="创建引用副本" shortcut="⌘D" onClick={() => runAction(onDuplicate)} />
                                    <MenuButton icon={<Trash2 />} label="删除节点" danger onClick={() => runAction(onDelete)} />
                                </>
                            ) : isMedia ? (
                                <>
                                    <MenuHeader title={isImage ? "图片" : "视频"} description={node?.title || nodeTypeLabel(node)} />
                                    <MenuSection label="查看与归档" />
                                    <MenuButton icon={<Maximize2 />} label="进入全景预览" disabled={!canOpenPreview} onClick={() => runAction(onViewMedia)} />
                                    <MenuButton icon={<Tags />} label="设置资产分类" chevron onClick={() => setCategoryOpen(true)} />
                                    <MenuDivider />
                                    <MenuSection label="节点" />
                                    <MenuButton icon={<Copy />} label="复制节点" shortcut="⌘C" onClick={() => runAction(onCopyNode)} />
                                    <MenuButton icon={<Link2 />} label={isImage ? "复制图片地址" : "复制视频地址"} disabled={!canCopyMediaUrl} onClick={() => runAction(onCopyMediaUrl)} />
                                    <MenuButton icon={<Layers3 />} label="创建参数变体" shortcut="⌘D" onClick={() => runAction(onDuplicate)} />
                                    <MenuButton icon={<Trash2 />} label="删除节点" danger onClick={() => runAction(onDelete)} />
                                </>
                            ) : (
                                <>
                                    <MenuHeader title={node?.title || nodeTypeLabel(node)} />
                                    <MenuSection label="节点操作" />
                                    {isFrame ? <MenuButton icon={<PanelTop />} label={node?.metadata?.frame?.collapsed ? "展开背板" : "折叠背板"} onClick={() => runAction(onToggleFrame)} /> : <MenuButton icon={<FolderPlus />} label="保存到我的素材" disabled={!canSaveAsset} onClick={() => runAction(onSaveAsset)} />}
                                    {isText ? <MenuButton icon={<Maximize2 />} label="放大编辑" onClick={() => runAction(onEditText)} /> : null}
                                    {isDrawing ? <MenuButton icon={<Pencil />} label="打开绘图" onClick={() => runAction(onOpenDrawing)} /> : null}
                                    {isText ? <MenuButton icon={<ImageIcon />} label="用文本生图" disabled={!canGenerateFromText} onClick={() => runAction(onGenerateImage)} /> : null}
                                    <MenuDivider />
                                    <MenuSection label="副本与内容" />
                                    <MenuButton icon={<Copy />} label={isFrame ? "复制背板及内容" : "复制节点"} shortcut="⌘C" onClick={() => runAction(onCopyNode)} />
                                    {isText ? <MenuButton icon={<Clipboard />} label="复制文本" disabled={!hasNodeContent} onClick={() => runAction(onCopyContent)} /> : null}
                                    <MenuButton icon={<Copy />} label={isFrame ? "创建背板副本" : "创建参数变体"} shortcut="⌘D" onClick={() => runAction(onDuplicate)} />
                                    <MenuButton icon={<Clipboard />} label="粘贴" shortcut="⌘V" disabled={!canPaste} onClick={() => runAction(onPaste)} />
                                    <MenuButton icon={<Trash2 />} label={isFrame ? "删除背板" : "删除节点"} danger onClick={() => runAction(onDelete)} />
                                </>
                            )}
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
                        isProjectLinked={isProjectLinked}
                        reducedMotion={Boolean(reducedMotion)}
                        onAddNode={(type) => runAction(() => onAddNode(type))}
                        onOpenDirector={() => runAction(() => onOpenDirector(menu.position))}
                        onUpload={() => runAction(onUpload)}
                        onOpenAssets={() => runAction(onOpenAssets)}
                        onOpenProjectCharacters={() => runAction(onOpenProjectCharacters)}
                    />
                ) : null}
            </AnimatePresence>
        </>
    );
}

function AddNodeContextMenu({ parentPosition, workspaceMode, isProjectLinked, reducedMotion, onAddNode, onOpenDirector, onUpload, onOpenAssets, onOpenProjectCharacters }: { parentPosition: { left: number; top: number }; workspaceMode: CanvasWorkspaceMode; isProjectLinked: boolean; reducedMotion: boolean; onAddNode: (type: CanvasNodeType) => void; onOpenDirector: () => void; onUpload: () => void; onOpenAssets: () => void; onOpenProjectCharacters: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const left = getSubmenuLeft(parentPosition.left);
    const simpleMode = workspaceMode === "simple";
    const nodeCommands: CanvasCreateCommand[] = [
        { id: "text", label: "文本", icon: <Type />, onClick: () => onAddNode(CanvasNodeType.Text) },
        { id: "drawing", label: "绘图", icon: <Pencil />, onClick: () => onAddNode(CanvasNodeType.Drawing) },
        { id: "script", label: "分镜脚本", icon: <Clapperboard />, badge: "核心", onClick: () => onAddNode(CanvasNodeType.Script) },
        ...(!simpleMode ? [{ id: "frame", label: "背板", icon: <PanelTop />, onClick: () => onAddNode(CanvasNodeType.Frame) }] : []),
        { id: "image", label: "图片", icon: <ImageIcon />, onClick: () => onAddNode(CanvasNodeType.Image) },
        { id: "video", label: "视频", icon: <Video />, onClick: () => onAddNode(CanvasNodeType.Video) },
        ...(!simpleMode ? [
            { id: "director", label: "导演台", icon: <Layers3 />, badge: "3D", onClick: onOpenDirector },
            { id: "audio", label: "音频", icon: <Music2 />, onClick: () => onAddNode(CanvasNodeType.Audio) },
        ] : []),
    ];
    const resourceCommands: CanvasCreateCommand[] = [
        { id: "upload", label: "上传文件", icon: <Upload />, onClick: onUpload },
        ...(isProjectLinked ? [{ id: "project-character", label: "添加角色卡", icon: <UserRound />, onClick: onOpenProjectCharacters }] : []),
        ...(!isProjectLinked ? [{ id: "assets", label: "素材库", icon: <FolderOpen />, onClick: onOpenAssets }] : []),
    ];

    return (
        <SpotlightSurface
            spotlightColor={theme.toolbar.itemHover}
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, x: left > parentPosition.left ? -5 : 5, scale: 0.97 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, x: left > parentPosition.left ? -4 : 4, scale: 0.98 }}
            transition={{ duration: aceternityMotion.duration.instant, ease: aceternityMotion.easing.enter }}
            className="aceternity-floating-panel fixed z-[var(--z-popover)] w-[260px] origin-top overflow-hidden rounded-[var(--dock-radius)] border p-2 backdrop-blur-2xl"
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

function MenuHeader({ title, description, onBack }: { title: string; description?: string; onBack?: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return (
        <div className="mb-0.5 flex items-start gap-1 px-1.5 py-1.5">
            {onBack ? <button type="button" onClick={onBack} className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md outline-none hover:bg-black/5 focus-visible:ring-2 dark:hover:bg-white/8" aria-label="返回媒体操作"><ArrowLeft className="size-3.5" /></button> : null}
            <span className="min-w-0"><span className="block truncate text-xs font-semibold">{title}</span>{description && description !== title ? <span className="mt-0.5 block truncate text-[var(--fs-micro)]" style={{ color: theme.node.muted }}>{description}</span> : null}</span>
        </div>
    );
}

function MenuSection({ label }: { label: string }) {
    return <div className="px-2 pb-1 pt-1.5 text-[var(--fs-micro)] font-medium opacity-45">{label}</div>;
}

function MenuButton({ icon, label, detail, shortcut, badge, chevron = false, active = false, disabled = false, danger = false, onClick }: { icon: ReactNode; label: string; detail?: string; shortcut?: string; badge?: string; chevron?: boolean; active?: boolean; disabled?: boolean; danger?: boolean; onClick?: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const color = danger ? theme.accent.danger : theme.node.text;
    return (
        <button
            type="button"
            className="canvas-menu-item group flex min-h-9 w-full items-center gap-2 rounded-lg border border-transparent px-1.5 py-1 text-left outline-none enabled:hover:border-black/10 enabled:hover:bg-black/5 focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-35 dark:enabled:hover:border-white/10 dark:enabled:hover:bg-white/8"
            style={{ color, background: active ? theme.toolbar.activeBg : undefined, "--tw-ring-color": theme.node.muted } as CSSProperties}
            disabled={disabled}
            onClick={onClick}
        >
            <span className="canvas-menu-item-icon grid size-7 shrink-0 place-items-center rounded-md border opacity-75 group-hover:opacity-100 [&_svg]:size-3.5" style={{ background: danger ? `${theme.accent.danger}12` : theme.spatial.surface, borderColor: danger ? `${theme.accent.danger}33` : theme.toolbar.border, color: danger ? theme.accent.danger : theme.node.text }}>{icon}</span>
            <span className="min-w-0 flex-1"><span className="flex items-center gap-1 text-xs font-medium"><span className="truncate">{label}</span>{badge ? <span className="rounded-full border px-1 py-0.5 text-[7px] font-bold" style={{ background: theme.toolbar.activeBg, borderColor: theme.toolbar.border, color: theme.node.muted }}>{badge}</span> : null}</span>{detail ? <span className="mt-0.5 block truncate text-[var(--fs-micro)]" style={{ color: theme.node.muted }}>{detail}</span> : null}</span>
            {shortcut ? <span className="shrink-0 text-[var(--fs-micro)] opacity-38">{shortcut}</span> : null}
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
    const width = 224;
    const estimatedHeight = menu.type === "node" ? Math.min(360, window.innerHeight - 72) : menu.type === "canvas" ? 250 : 84;
    return {
        left: clamp(menu.x, 12, Math.max(12, window.innerWidth - width - 12)),
        top: clamp(menu.y, 68, Math.max(68, window.innerHeight - estimatedHeight - 12)),
    };
}

function getSubmenuLeft(parentLeft: number) {
    if (typeof window === "undefined") return parentLeft + 192;
    return parentLeft + 224 + 8 + 260 <= window.innerWidth - 12 ? parentLeft + 232 : Math.max(12, parentLeft - 268);
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
    if (node.type === CanvasNodeType.Drawing) return "绘图节点";
    if (node.type === CanvasNodeType.Frame) return "背板";
    return "生成配置节点";
}
