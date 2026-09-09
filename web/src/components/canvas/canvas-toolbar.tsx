import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { Switch } from "antd";
import { FolderOpen, Hand, Info, MousePointer2, Palette, Redo2, Trash2, Undo2, History } from "lucide-react";

import { CanvasAppearanceControls } from "@/components/canvas/canvas-appearance-controls";
import { SpotlightSurface } from "@/components/ui/aceternity/spotlight-surface";
import { aceternityMotion } from "@/lib/aceternity-motion";
import type { CanvasAppearance } from "@/lib/canvas/canvas-appearance";
import { canvasThemes, type CanvasBackgroundMode, type CanvasTheme } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasToolMode } from "@/types/canvas";

type CanvasToolbarProps = {
    canvasTool: CanvasToolMode;
    canUndo: boolean;
    canRedo: boolean;
    appearance: CanvasAppearance;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    rightInset?: number;
    onToolChange: (tool: CanvasToolMode) => void;
    onOpenAssets: () => void;
    onOpenGenerationHistory: () => void;
    onClear: () => void;
    onUndo: () => void;
    onRedo: () => void;
    onAppearanceChange: (appearance: CanvasAppearance) => void;
    onSaveAppearanceDefault: (appearance: CanvasAppearance) => void;
    onBackgroundModeChange: (mode: CanvasBackgroundMode) => void;
    onShowImageInfoChange: (show: boolean) => void;
};

export function CanvasToolbar({
    canvasTool,
    canUndo,
    canRedo,
    appearance,
    backgroundMode,
    showImageInfo,
    rightInset = 0,
    onToolChange,
    onOpenAssets,
    onOpenGenerationHistory,
    onClear,
    onUndo,
    onRedo,
    onAppearanceChange,
    onSaveAppearanceDefault,
    onBackgroundModeChange,
    onShowImageInfoChange,
}: CanvasToolbarProps) {
    const rootRef = useRef<HTMLDivElement>(null);
    const dockRef = useRef<HTMLDivElement>(null);
    const reducedMotion = useReducedMotion();
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const [appearanceOpen, setAppearanceOpen] = useState(false);
    const [panelX, setPanelX] = useState(0);

    useEffect(() => {
        if (!appearanceOpen) return;
        const closeAppearance = (event: PointerEvent) => {
            const target = event.target instanceof Node ? event.target : null;
            if (target && rootRef.current?.contains(target)) return;
            const element = event.target instanceof Element ? event.target : null;
            if (element?.closest(".ant-color-picker,.ant-popover")) return;
            setAppearanceOpen(false);
        };
        document.addEventListener("pointerdown", closeAppearance, true);
        return () => document.removeEventListener("pointerdown", closeAppearance, true);
    }, [appearanceOpen]);

    const toggleAppearance = (event: ReactMouseEvent<HTMLButtonElement>) => {
        setPanelX(getPanelX(dockRef.current, event.currentTarget));
        setAppearanceOpen((open) => !open);
    };

    return (
        <div
            ref={rootRef}
            data-canvas-no-zoom
            className="canvas-fixed-toolbar-shell pointer-events-none absolute z-[var(--z-toolbar)]"
            style={{ "--canvas-toolbar-right-inset": `${Math.max(0, rightInset)}px` } as CSSProperties}
            onKeyDown={(event) => {
                if (event.key !== "Escape" || !appearanceOpen) return;
                event.stopPropagation();
                setAppearanceOpen(false);
            }}
        >
            <AnimatePresence>
                {appearanceOpen ? (
                    <motion.div
                        id="canvas-appearance-popover"
                        initial={reducedMotion ? false : { opacity: 0, scaleY: 0.92, y: 8 }}
                        animate={{ opacity: 1, scaleY: 1, y: 0 }}
                        exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scaleY: 0.94, y: 6 }}
                        transition={{ duration: reducedMotion ? 0 : aceternityMotion.duration.panel, ease: aceternityMotion.easing.enter }}
                        className="canvas-fixed-toolbar-popover pointer-events-auto absolute z-[var(--dock-z-popover)] w-[320px] max-w-[calc(100vw-24px)]"
                        style={{ left: panelX || "50%", transformOrigin: "bottom center", x: "-50%" }}
                    >
                        <SpotlightSurface
                            spotlightColor={theme.toolbar.itemHover}
                            initial={reducedMotion ? false : { opacity: 0, scale: 0.97 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: reducedMotion ? 1 : 0.97, transition: { duration: 0 } }}
                            transition={{ duration: reducedMotion ? 0 : aceternityMotion.duration.instant, ease: aceternityMotion.easing.enter }}
                            className="aceternity-floating-panel overflow-hidden rounded-[var(--panel-radius)] border p-2.5 backdrop-blur-2xl"
                            style={{ background: theme.spatial.elevated, borderColor: theme.toolbar.border, color: theme.toolbar.item }}
                            onWheel={(event) => event.stopPropagation()}
                        >
                            <PanelHeading icon={<Palette aria-hidden="true" />} title="画布外观" subtitle="调整整个创作空间" theme={theme} />
                            <CanvasAppearanceControls
                                appearance={appearance}
                                backgroundMode={backgroundMode}
                                colorTheme={colorTheme}
                                theme={theme}
                                onAppearanceChange={onAppearanceChange}
                                onSaveAppearanceDefault={onSaveAppearanceDefault}
                                onBackgroundModeChange={onBackgroundModeChange}
                            />
                            <div className="mt-2.5 flex items-center justify-between gap-2 rounded-[var(--dock-item-radius-labeled)] border px-2.5 py-2" style={{ background: theme.spatial.surface, borderColor: theme.toolbar.border }}>
                                <span className="inline-flex min-w-0 items-center gap-1.5 text-[var(--fs-tiny)] font-semibold"><Info className="size-3" aria-hidden="true" />图片信息</span>
                                <Switch size="small" checked={showImageInfo} onChange={onShowImageInfoChange} />
                            </div>
                        </SpotlightSurface>
                    </motion.div>
                ) : null}
            </AnimatePresence>

            <div
                ref={dockRef}
                className="canvas-fixed-toolbar pointer-events-auto"
                role="toolbar"
                aria-label="画布工具栏"
                style={{
                    "--canvas-toolbar-surface": colorTheme === "dark" ? "rgba(23,23,23,.75)" : "rgba(255,255,255,.85)",
                    "--canvas-toolbar-border": colorTheme === "dark" ? "rgba(255,255,255,.10)" : "rgba(0,0,0,.08)",
                    "--canvas-toolbar-foreground": colorTheme === "dark" ? "#fafafa" : "#0a0a0a",
                    "--canvas-toolbar-item-surface": "transparent",
                    "--canvas-toolbar-hover": colorTheme === "dark" ? "rgba(255,255,255,.10)" : "rgba(17,24,39,.08)",
                    "--canvas-toolbar-hover-text": colorTheme === "dark" ? "#fafafa" : "#0a0a0a",
                    // Updream 的选中态在深色主题使用白色圆形，浅色主题使用浅灰圆形，
                    // 两种主题都保持高对比图标，但不让浅色工具栏出现突兀的黑色块。
                    "--canvas-toolbar-active": colorTheme === "dark" ? "#ffffff" : "#e5e7eb",
                    "--canvas-toolbar-active-text": colorTheme === "dark" ? "#0a0a0a" : "#18181b",
                    "--canvas-toolbar-mode-active": colorTheme === "dark" ? "#ffffff" : "#dfe2e7",
                    "--canvas-toolbar-mode-active-text": colorTheme === "dark" ? "#0a0a0a" : "#18181b",
                    "--canvas-toolbar-focus": colorTheme === "dark" ? "rgba(255,255,255,.10)" : "rgba(17,24,39,.08)",
                    "--canvas-toolbar-mode-surface": colorTheme === "dark" ? "rgba(255,255,255,.10)" : "rgba(0,0,0,.04)",
                    "--canvas-toolbar-mode-inactive": colorTheme === "dark" ? "#737373" : "#525252",
                    "--canvas-toolbar-separator": colorTheme === "dark" ? "rgba(255,255,255,.20)" : "rgba(0,0,0,.15)",
                    "--canvas-toolbar-tooltip-surface": colorTheme === "dark" ? "rgba(18,18,18,.94)" : "rgba(255,255,255,.96)",
                    "--canvas-toolbar-tooltip-text": colorTheme === "dark" ? "#ffffff" : "#0a0a0a",
                    "--canvas-toolbar-tooltip-border": colorTheme === "dark" ? "rgba(255,255,255,.12)" : "rgba(0,0,0,.10)",
                } as CSSProperties}
            >
                <span className="canvas-fixed-toolbar-mode-group">
                    <ToolbarCommand label="选中" icon={<MousePointer2 />} pressed={canvasTool === "box-select"} active={canvasTool === "box-select"} onClick={() => onToolChange("box-select")} />
                    <ToolbarCommand label="拖动" icon={<Hand />} pressed={canvasTool === "move"} active={canvasTool === "move"} onClick={() => onToolChange("move")} />
                </span>
                <span className="canvas-fixed-toolbar-separator" aria-hidden="true" />
                <ToolbarCommand label="素材库" icon={<FolderOpen />} onClick={onOpenAssets} />
                <ToolbarCommand label="画布外观" icon={<Palette />} expanded={appearanceOpen} active={appearanceOpen} controls="canvas-appearance-popover" onClick={toggleAppearance} />
                <ToolbarCommand label="生成历史" icon={<History />} onClick={onOpenGenerationHistory} />
                <span className="canvas-fixed-toolbar-separator" aria-hidden="true" />
                <ToolbarCommand label="撤销" icon={<Undo2 />} disabled={!canUndo} onClick={onUndo} />
                <ToolbarCommand label="重做" icon={<Redo2 />} disabled={!canRedo} onClick={onRedo} />
                <ToolbarCommand label="清空画布" icon={<Trash2 />} disabled={false} onClick={onClear} />
            </div>
        </div>
    );
}

type ToolbarCommandProps = {
    label: string;
    icon: ReactNode;
    active?: boolean;
    disabled?: boolean;
    pressed?: boolean;
    expanded?: boolean;
    controls?: string;
    onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
};

function ToolbarCommand({ label, icon, active = false, disabled = false, pressed, expanded, controls, onClick }: ToolbarCommandProps) {
    const [focused, setFocused] = useState(false);
    return (
        <span className="canvas-fixed-toolbar-tooltip" data-tooltip={label}>
            <button
                type="button"
                className={`canvas-fixed-toolbar-item${active ? " is-active" : ""}${pressed !== undefined ? " is-mode" : ""}${focused ? " is-focused" : ""}`}
                aria-label={label}
                aria-pressed={pressed}
                aria-expanded={expanded}
                aria-controls={controls}
                aria-haspopup={expanded === undefined ? undefined : "dialog"}
                disabled={disabled}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onClick={onClick}
            >
                <span aria-hidden="true">{icon}</span>
            </button>
        </span>
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

function getPanelX(dock: HTMLDivElement | null, target: HTMLElement) {
    if (!dock) return 0;
    const rootBox = dock.parentElement?.getBoundingClientRect() || dock.getBoundingClientRect();
    const box = target.getBoundingClientRect();
    return box.left - rootBox.left + box.width / 2;
}
