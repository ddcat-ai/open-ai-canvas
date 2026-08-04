import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { Segmented, Switch } from "antd";
import { CircleDot, Grid2x2, Moon, Plus, Palette, Sun, Square, Info } from "lucide-react";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { FloatingDock } from "@/components/ui/aceternity/floating-dock";
import { SpotlightSurface } from "@/components/ui/aceternity/spotlight-surface";
import { CanvasCreateCommandGrid, type CanvasCreateCommand } from "@/components/canvas/canvas-create-command-grid";
import { ToolbarSettingsModal } from "@/components/canvas/toolbars/toolbar-settings-modal";
import { aceternityMotion } from "@/lib/aceternity-motion";
import { canvasDockStyle } from "@/lib/canvas/canvas-aceternity-style";
import { canvasThemes, type CanvasBackgroundMode, type CanvasColorTheme, type CanvasTheme } from "@/lib/canvas-theme";
import { defaultToolbarPrefs, readToolbarPrefs, resolveAddNodeMenuCommands, resolveToolbarEntries, type AddNodeMenuCommand, type ToolContext, type ToolbarHandlers, type ToolbarPrefs } from "@/lib/canvas/tool-registry";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasToolMode, CanvasWorkspaceMode } from "@/types/canvas";

export function CanvasToolbar({
    selectedCount,
    workspaceMode,
    canvasTool,
    onToolChange,
    isProjectLinked,
    canUndo,
    canRedo,
    backgroundMode,
    showImageInfo,
    onAddImage,
    onAddVideo,
    onAddAudio,
    onAddText,
    onChooseStyle,
    onAddScript,
    onAddFrame,
    onAddDrawing,
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
    onOpenProjectCharacters,
}: {
    selectedCount: number;
    workspaceMode: CanvasWorkspaceMode;
    canvasTool: CanvasToolMode;
    onToolChange: (tool: CanvasToolMode) => void;
    isProjectLinked: boolean;
    canUndo: boolean;
    canRedo: boolean;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    onAddImage: () => void;
    onAddVideo: () => void;
    onAddAudio: () => void;
    onAddText: () => void;
    onChooseStyle: () => void;
    onAddScript: () => void;
    onAddFrame: () => void;
    onAddDrawing: () => void;
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
    onOpenProjectCharacters: () => void;
}) {
    const rootRef = useRef<HTMLDivElement>(null);
    const dockRef = useRef<HTMLDivElement>(null);
    const colorTheme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const theme = canvasThemes[colorTheme];
    const [addOpen, setAddOpen] = useState(false);
    const [appearanceOpen, setAppearanceOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [panelX, setPanelX] = useState(0);
    const [prefs, setPrefs] = useState<ToolbarPrefs | null>(() => readToolbarPrefs("main"));

    // 设置面板关闭后重新读取偏好（用户可能调整了排序/显隐）
    useEffect(() => {
        if (!settingsOpen) setPrefs(readToolbarPrefs("main"));
    }, [settingsOpen]);

    const placePanel = (event: ReactMouseEvent<HTMLElement>) => setPanelX(getPanelX(dockRef.current, event.currentTarget));
    const runAddAction = (action: () => void) => {
        action();
        setAddOpen(false);
    };

    // 点击外部关闭浮层面板
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

    // 构建 handlers（主工具栏只需要部分回调，其余用 no-op 占位满足类型）
    const handlers: ToolbarHandlers = {
        onToolChange,
        onDeselect,
        onUndo,
        onRedo,
        onClear,
        onAddText,
        onAddImage,
        onAddVideo,
        onAddAudio,
        onAddScript,
        onAddFrame,
        onAddDrawing,
        onChooseStyle,
        onOpenDirector,
        onUpload,
        onOpenMyAssets,
        onOpenProjectCharacters,
        onBackgroundModeChange,
        onShowImageInfoChange,
        onToggleAddPanel: (event: ReactMouseEvent<HTMLElement>) => { placePanel(event); setAppearanceOpen(false); setSettingsOpen(false); setAddOpen((value) => !value); },
        onToggleAppearancePanel: (event: ReactMouseEvent<HTMLElement>) => { placePanel(event); setAddOpen(false); setSettingsOpen(false); setAppearanceOpen((value) => !value); },
        onToggleSettingsPanel: () => { setAddOpen(false); setAppearanceOpen(false); setSettingsOpen((value) => !value); },
        onDeleteSelected: onDelete,
        // 以下为多选/节点悬停工具栏回调，主工具栏不使用，用 no-op 占位
        onAlign: () => {}, onArrange: () => {}, onCreateStoryboard: () => {}, onCreateReferenceGroup: () => {}, onMergeVideos: () => {},
        onNodeInfo: () => {}, onNodeDelete: () => {}, onNodeRetry: () => {}, onNodeEditText: () => {}, onNodeDecreaseFont: () => {}, onNodeIncreaseFont: () => {},
        onNodeToggleDialog: () => {}, onNodeAnnotate: () => {}, onNodeGenerateImage: () => {}, onNodeUpload: () => {}, onNodeDownload: () => {}, onNodeSaveAsset: () => {},
        onNodeMaskEdit: () => {}, onNodeEmotion: () => {}, onNodePortraitTexture: () => {}, onNodeCrop: () => {}, onNodeSplit: () => {}, onNodeUpscale: () => {},
        onNodeSuperResolve: () => {}, onNodeAngle: () => {}, onNodeViewImage: () => {}, onNodeExtractVideoLastFrame: () => {}, onNodeReversePrompt: () => {},
        onNodeToggleFreeResize: () => {}, onNodeToggleLocked: () => {}, onNodeCopyPrompt: () => {},
    } as ToolbarHandlers;

    const ctx: ToolContext = {
        selectedCount,
        selectedNodeTypes: new Set(),
        selectedVideoCount: 0,
        canvasTool,
        workspaceMode,
        isProjectLinked,
        canUndo,
        canRedo,
        extractingVideoFrame: false,
        mergingVideos: false,
        addPanelOpen: addOpen,
        appearancePanelOpen: appearanceOpen,
        settingsPanelOpen: settingsOpen,
        handlers,
    };

    const items = resolveToolbarEntries("main", ctx, prefs ?? defaultToolbarPrefs("main"));

    // 解析添加节点菜单命令——onClick 绑定到 runAddAction 以在执行后关闭面板
    const addNodeCommands = resolveAddNodeMenuCommands(ctx);
    const toCommand = (cmd: AddNodeMenuCommand): CanvasCreateCommand => ({
        id: cmd.id,
        label: cmd.label,
        icon: cmd.icon,
        badge: cmd.badge,
        onClick: () => runAddAction(() => cmd.run(ctx)),
    });
    const nodeCommands = addNodeCommands.filter((cmd) => cmd.section === "node").map(toCommand);
    const resourceCommands = addNodeCommands.filter((cmd) => cmd.section === "resource").map(toCommand);

    return (
        <div ref={rootRef} data-canvas-no-zoom className="pointer-events-none absolute inset-x-[var(--canvas-inset-x)] bottom-[var(--canvas-inset-y)] z-[var(--z-toolbar)] flex justify-center">
            <AnimatePresence>
                {addOpen ? (
                    <AddNodeMenu
                        x={panelX}
                        theme={theme}
                        nodeCommands={nodeCommands}
                        resourceCommands={resourceCommands}
                    />
                ) : null}
            </AnimatePresence>

            <FloatingDock ref={dockRef} items={items} className="canvas-floating-dock pointer-events-auto max-w-full" style={canvasDockStyle(theme)} />

            <AnimatePresence>
                {appearanceOpen ? (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: aceternityMotion.duration.instant }} className="pointer-events-auto absolute bottom-[var(--canvas-dock-popover-offset)] z-[var(--dock-z-popover)] w-[224px] max-w-[calc(100vw-24px)] -translate-x-1/2" style={{ left: panelX || "50%" }}>
                        <SpotlightSurface spotlightColor={theme.toolbar.itemHover} initial={{ y: 6, scale: 0.97 }} animate={{ y: 0, scale: 1 }} exit={{ y: 4, scale: 0.98 }} transition={{ duration: aceternityMotion.duration.instant, ease: aceternityMotion.easing.enter }} className="aceternity-floating-panel overflow-hidden rounded-[var(--panel-radius)] border p-2.5 backdrop-blur-2xl" style={{ background: theme.spatial.elevated, borderColor: theme.toolbar.border, color: theme.toolbar.item, boxShadow: `0 24px 64px ${theme.spatial.shadow}` }} onWheel={(event) => event.stopPropagation()}>
                            <PanelHeading icon={<Palette className="size-4" />} title="画布外观" subtitle="调整整个创作空间" theme={theme} />
                            <div className="mt-3 text-[var(--fs-micro)] font-semibold uppercase opacity-45">主题模式</div>
                            <div className="mt-1 grid grid-cols-2 gap-1 rounded-[var(--dock-item-radius-labeled)] border p-1" style={{ background: theme.spatial.surface, borderColor: theme.toolbar.border }}>
                                <CanvasThemeButton colorTheme={colorTheme} targetTheme="light" onThemeChange={setTheme}><Sun className="size-3.5" />浅色</CanvasThemeButton>
                                <CanvasThemeButton colorTheme={colorTheme} targetTheme="dark" onThemeChange={setTheme}><Moon className="size-3.5" />深色</CanvasThemeButton>
                            </div>
                            <div className="mt-3 text-[var(--fs-micro)] font-semibold uppercase opacity-45">空间网格</div>
                            <Segmented
                                className="mt-1 w-full !rounded-[var(--dock-item-radius-labeled)] !p-0.5 [&_.ant-segmented-group]:!flex [&_.ant-segmented-item]:!min-h-7 [&_.ant-segmented-item]:!flex-1 [&_.ant-segmented-item-label]:!min-h-7 [&_.ant-segmented-item-label]:!text-[var(--fs-tiny)] [&_.ant-segmented-item-label]:!leading-7"
                                value={backgroundMode}
                                onChange={(value) => onBackgroundModeChange(value as CanvasBackgroundMode)}
                                options={[
                                    { value: "dots", label: <span className="inline-flex items-center gap-1.5"><CircleDot className="size-3.5" />点</span> },
                                    { value: "lines", label: <span className="inline-flex items-center gap-1.5"><Grid2x2 className="size-3.5" />线</span> },
                                    { value: "blank", label: <span className="inline-flex items-center gap-1.5"><Square className="size-3.5" />空白</span> },
                                ]}
                            />
                            <div className="mt-2.5 flex items-center justify-between gap-2 rounded-[var(--dock-item-radius-labeled)] border px-2.5 py-2" style={{ background: theme.spatial.surface, borderColor: theme.toolbar.border }}>
                                <span className="inline-flex min-w-0 items-center gap-1.5 text-[var(--fs-tiny)] font-semibold"><Info className="size-3" />图片信息</span>
                                <Switch size="small" checked={showImageInfo} onChange={onShowImageInfoChange} />
                            </div>
                        </SpotlightSurface>
                    </motion.div>
                ) : null}
            </AnimatePresence>

            <ToolbarSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} toolbar="main" />
        </div>
    );
}

function AddNodeMenu({ x, theme, nodeCommands, resourceCommands }: {
    x: number;
    theme: CanvasTheme;
    nodeCommands: CanvasCreateCommand[];
    resourceCommands: CanvasCreateCommand[];
}) {
    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: aceternityMotion.duration.instant }} className="pointer-events-auto absolute bottom-[var(--canvas-dock-popover-offset)] z-[var(--dock-z-popover)] w-[260px] max-w-[calc(100vw-24px)] -translate-x-1/2" style={{ left: x || "50%" }}>
            <SpotlightSurface spotlightColor={theme.toolbar.itemHover} initial={{ y: 6, scale: 0.97 }} animate={{ y: 0, scale: 1 }} exit={{ y: 4, scale: 0.98 }} transition={{ duration: aceternityMotion.duration.instant, ease: aceternityMotion.easing.enter }} className="aceternity-floating-panel overflow-hidden rounded-[var(--panel-radius)] border p-2 backdrop-blur-2xl" style={{ background: theme.spatial.elevated, borderColor: theme.toolbar.border, color: theme.node.text, boxShadow: `0 24px 64px ${theme.spatial.shadow}` }} onWheel={(event) => event.stopPropagation()}>
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
            <span className="grid size-8 shrink-0 place-items-center rounded-[var(--dock-item-radius)] border opacity-75 [&_svg]:size-3.5" style={{ background: theme.spatial.surface, borderColor: theme.toolbar.border }}>{icon}</span>
            <span className="min-w-0"><span className="block text-xs font-semibold">{title}</span><span className="mt-0.5 block text-[var(--fs-micro)]" style={{ color: theme.node.muted }}>{subtitle}</span></span>
        </div>
    );
}

function MenuSection({ title }: { title: string }) {
    return <div className="mb-1 mt-3 px-1 text-[var(--fs-micro)] font-semibold uppercase opacity-42">{title}</div>;
}

function CanvasThemeButton({ colorTheme, targetTheme, onThemeChange, children }: { colorTheme: CanvasColorTheme; targetTheme: CanvasColorTheme; onThemeChange: (theme: CanvasColorTheme) => void; children: ReactNode }) {
    const theme = canvasThemes[colorTheme];
    const active = colorTheme === targetTheme;
    return (
        <AnimatedThemeToggler
            theme={colorTheme}
            targetTheme={targetTheme}
            onThemeChange={onThemeChange}
            className="inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-[var(--dock-item-radius)] px-2 text-xs font-semibold transition-colors"
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
