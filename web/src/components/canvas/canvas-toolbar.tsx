import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { Segmented, Switch } from "antd";
import { CircleDot, Clapperboard, Eraser, FileText, FolderOpen, Grid2x2, Hand, Image as ImageIcon, Info, Layers3, Moon, Music2, Palette, PanelTop, Plus, Redo2, Square, Sun, Trash2, Type, Undo2, UploadCloud, Video, WandSparkles, X } from "lucide-react";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { FloatingDock, type FloatingDockEntry } from "@/components/ui/aceternity/floating-dock";
import { SpotlightSurface } from "@/components/ui/aceternity/spotlight-surface";
import { CanvasCreateCommandGrid, type CanvasCreateCommand } from "@/components/canvas/canvas-create-command-grid";
import { aceternityMotion } from "@/lib/aceternity-motion";
import { canvasDockStyle } from "@/lib/canvas/canvas-aceternity-style";
import { canvasThemes, type CanvasBackgroundMode, type CanvasColorTheme, type CanvasTheme } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasWorkspaceMode } from "@/types/canvas";

export function CanvasToolbar({
    selectedCount,
    workspaceMode,
    canUndo,
    canRedo,
    backgroundMode,
    showImageInfo,
    onAddImage,
    onAddVideo,
    onAddAudio,
    onAddText,
    onAddNovel,
    onChooseStyle,
    onAddScript,
    onAddFrame,
    onAddConfig,
    onOpenDirector,
    onUndo,
    onRedo,
    onUpload,
    onDelete,
    onClear,
    onDeselect,
    onBackgroundModeChange,
    onShowImageInfoChange,
    onOpenMyAssets,
}: {
    selectedCount: number;
    workspaceMode: CanvasWorkspaceMode;
    canUndo: boolean;
    canRedo: boolean;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    onAddImage: () => void;
    onAddVideo: () => void;
    onAddAudio: () => void;
    onAddText: () => void;
    onAddNovel: () => void;
    onChooseStyle: () => void;
    onAddScript: () => void;
    onAddFrame: () => void;
    onAddConfig: () => void;
    onOpenDirector: () => void;
    onUndo: () => void;
    onRedo: () => void;
    onUpload: () => void;
    onDelete: () => void;
    onClear: () => void;
    onDeselect: () => void;
    onBackgroundModeChange: (mode: CanvasBackgroundMode) => void;
    onShowImageInfoChange: (show: boolean) => void;
    onOpenMyAssets: () => void;
}) {
    const rootRef = useRef<HTMLDivElement>(null);
    const dockRef = useRef<HTMLDivElement>(null);
    const colorTheme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const theme = canvasThemes[colorTheme];
    const [addOpen, setAddOpen] = useState(false);
    const [appearanceOpen, setAppearanceOpen] = useState(false);
    const [panelX, setPanelX] = useState(0);

    const placePanel = (event: ReactMouseEvent<HTMLElement>) => setPanelX(getPanelX(dockRef.current, event.currentTarget));
    const runAddAction = (action: () => void) => {
        action();
        setAddOpen(false);
    };

    useEffect(() => {
        if (!addOpen && !appearanceOpen) return;
        const closeFloatingPanels = (event: PointerEvent) => {
            const target = event.target instanceof Node ? event.target : null;
            if (target && rootRef.current?.contains(target)) return;
            setAddOpen(false);
            setAppearanceOpen(false);
        };
        document.addEventListener("pointerdown", closeFloatingPanels, true);
        return () => document.removeEventListener("pointerdown", closeFloatingPanels, true);
    }, [addOpen, appearanceOpen]);

    const items: FloatingDockEntry[] = [
        { id: selectedCount ? "tool-close-selection" : "tool-hand", label: selectedCount ? `取消选择${selectedCount > 1 ? ` ${selectedCount} 个节点` : ""}` : "移动与选择", icon: selectedCount ? <X /> : <Hand />, active: !selectedCount, onClick: () => onDeselect() },
        { kind: "separator", id: "history-separator" },
        { id: "tool-undo", label: "撤销", icon: <Undo2 />, disabled: !canUndo, onClick: () => onUndo() },
        { id: "tool-redo", label: "重做", icon: <Redo2 />, disabled: !canRedo, onClick: () => onRedo() },
        { kind: "separator", id: "create-separator" },
        { id: "tool-add", label: "添加节点", icon: <Plus />, active: addOpen, onClick: (event) => { placePanel(event); setAppearanceOpen(false); setAddOpen((value) => !value); } },
        { id: "tool-assets", label: "素材库", icon: <FolderOpen />, onClick: () => onOpenMyAssets() },
        { id: "tool-style", label: "画布外观", icon: <Palette />, active: appearanceOpen, onClick: (event) => { placePanel(event); setAddOpen(false); setAppearanceOpen((value) => !value); } },
        ...(selectedCount ? [{ kind: "separator" as const, id: "selection-separator" }, { id: "tool-delete", label: selectedCount > 1 ? `删除 ${selectedCount} 个节点` : "删除选中节点", icon: <Trash2 />, danger: true, onClick: () => onDelete() }] : []),
        { id: "tool-clear", label: "清空画布", icon: <Eraser />, danger: true, onClick: () => onClear() },
    ];

    return (
        <div ref={rootRef} data-canvas-no-zoom className="pointer-events-none absolute inset-x-4 bottom-4 z-50 flex justify-center">
            <AnimatePresence>
                {addOpen ? (
                    <AddNodeMenu
                        x={panelX}
                        theme={theme}
                        workspaceMode={workspaceMode}
                        onAddText={() => runAddAction(onAddText)}
                        onAddNovel={() => runAddAction(onAddNovel)}
                        onChooseStyle={() => runAddAction(onChooseStyle)}
                        onAddScript={() => runAddAction(onAddScript)}
                        onAddFrame={() => runAddAction(onAddFrame)}
                        onAddImage={() => runAddAction(onAddImage)}
                        onAddVideo={() => runAddAction(onAddVideo)}
                        onAddAudio={() => runAddAction(onAddAudio)}
                        onAddConfig={() => runAddAction(onAddConfig)}
                        onOpenDirector={() => runAddAction(onOpenDirector)}
                        onUpload={() => runAddAction(onUpload)}
                        onOpenAssets={() => runAddAction(onOpenMyAssets)}
                    />
                ) : null}
            </AnimatePresence>

            <FloatingDock ref={dockRef} items={items} className="canvas-floating-dock pointer-events-auto max-w-full" style={canvasDockStyle(theme)} />

            <AnimatePresence>
                {appearanceOpen ? (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: aceternityMotion.duration.instant }} className="pointer-events-auto absolute bottom-[50px] z-30 w-[224px] -translate-x-1/2" style={{ left: panelX || "50%" }}>
                        <SpotlightSurface spotlightColor={theme.toolbar.itemHover} initial={{ y: 6, scale: 0.97 }} animate={{ y: 0, scale: 1 }} exit={{ y: 4, scale: 0.98 }} transition={{ duration: aceternityMotion.duration.instant, ease: aceternityMotion.easing.enter }} className="aceternity-floating-panel overflow-hidden rounded-[17px] border p-2.5 backdrop-blur-2xl" style={{ background: theme.spatial.elevated, borderColor: theme.toolbar.border, color: theme.toolbar.item, boxShadow: `0 24px 64px ${theme.spatial.shadow}` }} onWheel={(event) => event.stopPropagation()}>
                            <PanelHeading icon={<Palette className="size-4" />} title="画布外观" subtitle="调整整个创作空间" theme={theme} />
                            <div className="mt-3 text-[9px] font-semibold uppercase opacity-45">主题模式</div>
                            <div className="mt-1 grid grid-cols-2 gap-1 rounded-[11px] border p-1" style={{ background: theme.spatial.surface, borderColor: theme.toolbar.border }}>
                                <CanvasThemeButton colorTheme={colorTheme} targetTheme="light" onThemeChange={setTheme}><Sun className="size-3.5" />浅色</CanvasThemeButton>
                                <CanvasThemeButton colorTheme={colorTheme} targetTheme="dark" onThemeChange={setTheme}><Moon className="size-3.5" />深色</CanvasThemeButton>
                            </div>
                            <div className="mt-3 text-[9px] font-semibold uppercase opacity-45">空间网格</div>
                            <Segmented
                                className="mt-1 w-full !rounded-[11px] !p-0.5 [&_.ant-segmented-group]:!flex [&_.ant-segmented-item]:!min-h-7 [&_.ant-segmented-item]:!flex-1 [&_.ant-segmented-item-label]:!min-h-7 [&_.ant-segmented-item-label]:!text-[10px] [&_.ant-segmented-item-label]:!leading-7"
                                value={backgroundMode}
                                onChange={(value) => onBackgroundModeChange(value as CanvasBackgroundMode)}
                                options={[
                                    { value: "dots", label: <span className="inline-flex items-center gap-1.5"><CircleDot className="size-3.5" />点</span> },
                                    { value: "lines", label: <span className="inline-flex items-center gap-1.5"><Grid2x2 className="size-3.5" />线</span> },
                                    { value: "blank", label: <span className="inline-flex items-center gap-1.5"><Square className="size-3.5" />空白</span> },
                                ]}
                            />
                            <div className="mt-2.5 flex items-center justify-between gap-2 rounded-[11px] border px-2.5 py-2" style={{ background: theme.spatial.surface, borderColor: theme.toolbar.border }}>
                                <span className="inline-flex min-w-0 items-center gap-1.5 text-[10px] font-semibold"><Info className="size-3" />图片信息</span>
                                <Switch size="small" checked={showImageInfo} onChange={onShowImageInfoChange} />
                            </div>
                        </SpotlightSurface>
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
}

function AddNodeMenu({ x, theme, workspaceMode, onAddText, onAddNovel, onChooseStyle, onAddScript, onAddFrame, onAddImage, onAddVideo, onAddAudio, onAddConfig, onOpenDirector, onUpload, onOpenAssets }: {
    x: number;
    theme: CanvasTheme;
    workspaceMode: CanvasWorkspaceMode;
    onAddText: () => void;
    onAddNovel: () => void;
    onChooseStyle: () => void;
    onAddScript: () => void;
    onAddFrame: () => void;
    onAddImage: () => void;
    onAddVideo: () => void;
    onAddAudio: () => void;
    onAddConfig: () => void;
    onOpenDirector: () => void;
    onUpload: () => void;
    onOpenAssets: () => void;
}) {
    const simpleMode = workspaceMode === "simple";
    const nodeCommands: CanvasCreateCommand[] = [
        { id: "text", label: "文本", icon: <Type />, onClick: onAddText },
        { id: "novel", label: "小说", icon: <FileText />, badge: "文档", onClick: onAddNovel },
        { id: "style", label: "项目画风", icon: <Palette />, onClick: onChooseStyle },
        { id: "script", label: "分镜脚本", icon: <Clapperboard />, badge: "核心", onClick: onAddScript },
        ...(!simpleMode ? [{ id: "frame", label: "背板", icon: <PanelTop />, onClick: onAddFrame }] : []),
        { id: "image", label: "图片", icon: <ImageIcon />, onClick: onAddImage },
        { id: "video", label: "视频", icon: <Video />, onClick: onAddVideo },
        ...(!simpleMode ? [
            { id: "director", label: "导演台", icon: <Layers3 />, badge: "3D", onClick: onOpenDirector },
            { id: "audio", label: "音频", icon: <Music2 />, onClick: onAddAudio },
            { id: "config", label: "生成配置", icon: <WandSparkles />, onClick: onAddConfig },
        ] : []),
    ];
    const resourceCommands: CanvasCreateCommand[] = [
        { id: "upload", label: "上传文件", icon: <UploadCloud />, onClick: onUpload },
        { id: "assets", label: "素材库", icon: <FolderOpen />, onClick: onOpenAssets },
    ];
    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: aceternityMotion.duration.instant }} className="pointer-events-auto absolute bottom-[50px] z-40 w-[260px] max-w-[calc(100vw-24px)] -translate-x-1/2" style={{ left: x || "50%" }}>
            <SpotlightSurface spotlightColor={theme.toolbar.itemHover} initial={{ y: 6, scale: 0.97 }} animate={{ y: 0, scale: 1 }} exit={{ y: 4, scale: 0.98 }} transition={{ duration: aceternityMotion.duration.instant, ease: aceternityMotion.easing.enter }} className="aceternity-floating-panel overflow-hidden rounded-[16px] border p-2 backdrop-blur-2xl" style={{ background: theme.spatial.elevated, borderColor: theme.toolbar.border, color: theme.node.text, boxShadow: `0 24px 64px ${theme.spatial.shadow}` }} onWheel={(event) => event.stopPropagation()}>
                <PanelHeading icon={<Plus className="size-4" />} title="创建内容" subtitle="选择节点类型" theme={theme} />
                <MenuSection title="创作节点" />
                <CanvasCreateCommandGrid commands={nodeCommands} />
                <MenuSection title="导入资源" />
                <CanvasCreateCommandGrid commands={resourceCommands} variant="resource" />
            </SpotlightSurface>
        </motion.div>
    );
}

function PanelHeading({ icon, title, subtitle, theme }: { icon: ReactNode; title: string; subtitle: string; theme: CanvasTheme }) {
    return (
        <div className="flex items-center gap-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-[10px] border opacity-75 [&_svg]:size-3.5" style={{ background: theme.spatial.surface, borderColor: theme.toolbar.border }}>{icon}</span>
            <span className="min-w-0"><span className="block text-xs font-semibold">{title}</span><span className="mt-0.5 block text-[9px]" style={{ color: theme.node.muted }}>{subtitle}</span></span>
        </div>
    );
}

function MenuSection({ title }: { title: string }) {
    return <div className="mb-1 mt-3 px-1 text-[9px] font-semibold uppercase opacity-42">{title}</div>;
}

function CanvasThemeButton({ colorTheme, targetTheme, onThemeChange, children }: { colorTheme: CanvasColorTheme; targetTheme: CanvasColorTheme; onThemeChange: (theme: CanvasColorTheme) => void; children: ReactNode }) {
    const theme = canvasThemes[colorTheme];
    const active = colorTheme === targetTheme;
    return (
        <AnimatedThemeToggler
            theme={colorTheme}
            targetTheme={targetTheme}
            onThemeChange={onThemeChange}
            className="inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-[10px] px-2 text-xs font-semibold transition-colors"
            style={active ? { background: theme.node.text, color: theme.node.panel } : { color: theme.toolbar.item }}
            aria-label={`切换到${targetTheme === "dark" ? "深色" : "浅色"}主题`}
            title={`切换到${targetTheme === "dark" ? "深色" : "浅色"}主题`}
        >
            {children}
        </AnimatedThemeToggler>
    );
}

function getPanelX(dock: HTMLDivElement | null, target: HTMLElement) {
    if (!dock) return 0;
    const rootBox = dock.parentElement?.getBoundingClientRect() || dock.getBoundingClientRect();
    const box = target.getBoundingClientRect();
    return box.left - rootBox.left + box.width / 2;
}
