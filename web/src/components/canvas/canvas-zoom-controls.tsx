import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Compass, Eye, EyeOff, Focus, HelpCircle, LayoutTemplate, Minus, Plus } from "lucide-react";

import { FloatingDock, type FloatingDockEntry } from "@/components/ui/aceternity/floating-dock";
import { aceternityMotion } from "@/lib/aceternity-motion";
import { canvasDockStyle } from "@/lib/canvas/canvas-aceternity-style";
import { canvasThemes } from "@/lib/canvas-theme";
import { subscribeCanvasViewportPreview } from "@/lib/canvas/canvas-live-viewport";
import { canvasBottomRowLayout } from "@/lib/canvas/canvas-overlay-layout";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import "./canvas-bottom-toolbar.css";
import "./canvas-zoom-controls.css";

type CanvasZoomControlsProps = {
    scale: number;
    onScaleChange: (scale: number) => void;
    onFitContent: () => void;
    onAutoArrange?: () => void;
    hideNodeConnections?: boolean;
    onHideNodeConnectionsChange?: (value: boolean) => void;
    isMiniMapOpen: boolean;
    onToggleMiniMap: () => void;
    onOpenShortcuts: () => void;
    containerRef?: RefObject<HTMLDivElement | null>;
};

const QUICK_ZOOM_LEVELS = [0.25, 0.5, 1, 2] as const;
/** 主工具条（canvas-toolbar.tsx）读取这个变量，从整行居中右移（让开左侧轨道、视图控制条，或在停靠 Agent 时两侧等距）。 */
const MAIN_TOOLBAR_SHIFT = "--canvas-main-toolbar-shift";
const MAIN_TOOLBAR_MAX_WIDTH = "--canvas-main-toolbar-max-width";

export function CanvasZoomControls({ scale, onScaleChange, onFitContent, onAutoArrange, hideNodeConnections = false, onHideNodeConnectionsChange, isMiniMapOpen, onToggleMiniMap, onOpenShortcuts, containerRef }: CanvasZoomControlsProps) {
    const theme = canvasThemes[useActiveTheme()];
    const rootRef = useRef<HTMLDivElement>(null);
    const liveScaleRef = useRef(scale);
    const rangeRef = useRef<HTMLInputElement>(null);
    const dockLabelRef = useRef<HTMLSpanElement>(null);
    const panelLabelRef = useRef<HTMLSpanElement>(null);
    const [precisionOpen, setPrecisionOpen] = useState(false);

    useLayoutEffect(() => {
        const root = rootRef.current;
        const shell = root?.closest<HTMLElement>(".canvas-workspace-zoom-controls");
        const main = root?.closest("main");
        const toolbar = main?.querySelector<HTMLElement>(".canvas-main-toolbar");
        const dock = toolbar?.querySelector<HTMLElement>(":scope > .canvas-floating-dock");
        if (!root || !shell || !main || !toolbar || !dock) return;
        // 停靠的 Agent 会让工作区让出右侧宽度（user-layout 写 data-agent-docked）；收起或浮窗时 Agent 悬浮在画布上，不占宽度。
        const workspace = main.closest<HTMLElement>(".app-user-workspace");
        // Share one bottom row with the main toolbar, measured from real widths (toolbar preferences, side panels, docked Agent):
        // with a docked Agent the main toolbar is centered in the space right of these controls, so its gaps to them and to the Agent stay even;
        // otherwise it is centered on the canvas like the top bar and only moves right to clear these controls.
        // Align the compact view bar and the main toolbar by their middle line.
        const measure = () => {
            const container = shell.offsetParent?.getBoundingClientRect();
            // Measure the complete view controls when avoiding the main toolbar.
            const controls = shell.getBoundingClientRect();
            const bar = dock.getBoundingClientRect();
            if (!container || !bar.width || !bar.height) return;
            // The gap to these controls equals the row's own inset, so both sides of the main toolbar get the same space.
            const row = toolbar.getBoundingClientRect();
            const gap = parseFloat(getComputedStyle(toolbar).left) || 0;
            const availableWidth = `${Math.max(0, Math.floor(row.right - controls.left))}px`;
            if (shell.style.maxWidth !== availableWidth) shell.style.maxWidth = availableWidth;
            if (toolbar.style.getPropertyValue(MAIN_TOOLBAR_MAX_WIDTH) !== availableWidth) toolbar.style.setProperty(MAIN_TOOLBAR_MAX_WIDTH, availableWidth);
            const layout = canvasBottomRowLayout(controls, row, bar.width, gap, { evenGaps: workspace?.dataset.agentDocked === "true" });
            const bottom = layout.stacked ? `${Math.round(container.bottom - bar.top + gap)}px` : `${Math.round(container.bottom - (bar.top + bar.height / 2) - controls.height / 2)}px`;
            shell.dataset.bottomLayout = layout.stacked ? "stacked" : "inline";
            if (shell.style.bottom !== bottom) shell.style.bottom = bottom;
            const shift = layout.shift ? `${layout.shift}px` : "";
            if (toolbar.style.getPropertyValue(MAIN_TOOLBAR_SHIFT) === shift) return;
            if (shift) toolbar.style.setProperty(MAIN_TOOLBAR_SHIFT, shift);
            else toolbar.style.removeProperty(MAIN_TOOLBAR_SHIFT);
        };
        const resize = new ResizeObserver(measure);
        for (const element of [shell, main, toolbar, dock, ...main.querySelectorAll(".canvas-workspace-shell,.canvas-project-sidebar")]) resize.observe(element);
        const state = new MutationObserver(measure);
        state.observe(main, { attributes: true, attributeFilter: ["class"] });
        if (workspace) state.observe(workspace, { attributes: true, attributeFilter: ["data-agent-docked"] });
        window.addEventListener("resize", measure);
        measure();
        return () => {
            resize.disconnect();
            state.disconnect();
            window.removeEventListener("resize", measure);
            shell.style.removeProperty("bottom");
            shell.style.removeProperty("max-width");
            delete shell.dataset.bottomLayout;
            toolbar.style.removeProperty(MAIN_TOOLBAR_SHIFT);
            toolbar.style.removeProperty(MAIN_TOOLBAR_MAX_WIDTH);
        };
    }, []);

    useEffect(() => updateScaleDisplay(scale), [scale]);

    useEffect(() => {
        const container = containerRef?.current;
        if (!container) return;
        return subscribeCanvasViewportPreview(container, (viewport) => updateScaleDisplay(viewport.k));
    }, [containerRef]);

    useEffect(() => {
        if (!precisionOpen) return;
        const close = (event: PointerEvent) => {
            if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setPrecisionOpen(false);
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") setPrecisionOpen(false);
        };
        document.addEventListener("pointerdown", close, true);
        document.addEventListener("keydown", closeOnEscape, true);
        return () => {
            document.removeEventListener("pointerdown", close, true);
            document.removeEventListener("keydown", closeOnEscape, true);
        };
    }, [precisionOpen]);

    function updateScaleDisplay(nextScale: number) {
        liveScaleRef.current = nextScale;
        const percent = String(Math.round(nextScale * 100));
        if (rangeRef.current) rangeRef.current.value = percent;
        if (dockLabelRef.current) dockLabelRef.current.textContent = percent;
        if (panelLabelRef.current) panelLabelRef.current.textContent = `${percent}%`;
    }

    function commitScale(nextScale: number) {
        const clampedScale = Math.min(2, Math.max(0.05, nextScale));
        updateScaleDisplay(clampedScale);
        onScaleChange(clampedScale);
    }

    const items: FloatingDockEntry[] = [
        { id: "zoom-minimap", label: isMiniMapOpen ? "关闭小地图" : "打开小地图", icon: <Compass />, active: isMiniMapOpen, onClick: onToggleMiniMap },
        { id: "zoom-fit", label: "适应画布", icon: <Focus />, onClick: onFitContent },
        ...(onAutoArrange ? [{ id: "zoom-auto-arrange", label: "自动整理节点", icon: <LayoutTemplate />, onClick: onAutoArrange }] : []),
        ...(onHideNodeConnectionsChange
            ? [
                  {
                      id: "zoom-hide-node-connections",
                      label: hideNodeConnections ? "显示全部连线" : "设置隐藏节点连线",
                      icon: hideNodeConnections ? <Eye /> : <EyeOff />,
                      active: hideNodeConnections,
                      onClick: () => onHideNodeConnectionsChange(!hideNodeConnections),
                  },
              ]
            : []),
        { kind: "separator", id: "zoom-separator" },
        { id: "zoom-out", label: "缩小画布", icon: <Minus />, onClick: () => commitScale(liveScaleRef.current - 0.1) },
        {
            id: "zoom-precision",
            label: "精确缩放",
            expands: true,
            wide: true,
            quiet: true,
            icon: (
                <span className="inline-flex h-full items-center justify-center whitespace-nowrap text-[var(--fs-caption)] font-semibold leading-none tabular-nums">
                    <span ref={dockLabelRef}>{Math.round(scale * 100)}</span>
                    <span className="ml-px text-[var(--fs-micro)] font-medium leading-none opacity-50">%</span>
                </span>
            ),
            active: precisionOpen,
            onClick: () => setPrecisionOpen((value) => !value),
        },
        { id: "zoom-in", label: "放大画布", icon: <Plus />, onClick: () => commitScale(liveScaleRef.current + 0.1) },
        { kind: "separator", id: "help-separator" },
        { id: "zoom-shortcuts", label: "画布快捷键", icon: <HelpCircle />, onClick: onOpenShortcuts },
    ];

    return (
        <div ref={rootRef} data-canvas-no-zoom className="canvas-zoom-controls relative z-[var(--z-toolbar)]" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
            <AnimatePresence>
                {precisionOpen ? (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: aceternityMotion.duration.panel }}
                        className="aceternity-floating-panel absolute bottom-full left-0 mb-2 w-[220px] max-w-full overflow-hidden rounded-[var(--panel-radius)] border p-2"
                        style={{ background: theme.node.panel, borderColor: theme.toolbar.border, color: theme.node.text, boxShadow: "var(--elevation-overlay)" }}
                    >
                        <div className="flex items-center justify-between gap-3">
                            <span>
                                <span className="block text-[var(--fs-tiny)] font-semibold">画布尺度</span>
                                <span className="mt-0.5 block text-[var(--fs-micro)]" style={{ color: theme.node.muted }}>
                                    精确控制视野密度
                                </span>
                            </span>
                            <span
                                ref={panelLabelRef}
                                className="rounded-[var(--r-sm)] px-2 py-1 text-[var(--fs-caption)] font-medium tabular-nums"
                                style={{ background: theme.spatial.surface, borderColor: theme.toolbar.border, color: theme.accent.primary }}
                            >
                                {Math.round(scale * 100)}%
                            </span>
                        </div>
                        <input
                            ref={rangeRef}
                            type="range"
                            min="5"
                            max="200"
                            step="1"
                            defaultValue={Math.round(scale * 100)}
                            className="aceternity-zoom-range mt-3 h-4 w-full"
                            style={{ accentColor: theme.accent.primary }}
                            onChange={(event) => commitScale(Number(event.target.value) / 100)}
                            aria-label="精确缩放画布"
                        />
                        <div className="mt-2 grid grid-cols-4 gap-1">
                            {QUICK_ZOOM_LEVELS.map((level) => (
                                <motion.button
                                    key={level}
                                    type="button"
                                    className="h-7 rounded-[var(--dock-item-radius)] border text-[var(--fs-micro)] font-semibold tabular-nums outline-none focus-visible:ring-2"
                                    style={{ background: theme.spatial.surface, borderColor: theme.toolbar.border, color: theme.node.muted }}
                                    onClick={() => commitScale(level)}
                                >
                                    {Math.round(level * 100)}%
                                </motion.button>
                            ))}
                        </div>
                    </motion.div>
                ) : null}
            </AnimatePresence>

            <FloatingDock items={items} variant="toolbar" size="compact" className="canvas-floating-dock canvas-bottom-dock" style={canvasDockStyle(theme, theme.node.text)} ariaLabel="画布视图控制" />
        </div>
    );
}
