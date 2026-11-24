import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { CircleDashed, Focus, Grip, HelpCircle, Map, Minus, Plus, RotateCcw, Search } from "lucide-react";
import { subscribeCanvasViewportPreview } from "@/lib/canvas/canvas-live-viewport";
import { canvasBottomRowLayout } from "@/lib/canvas/canvas-overlay-layout";
import { CanvasZoomReadout, useCanvasZoomPercent } from "./canvas-zoom-readout";
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
    const rootRef = useRef<HTMLDivElement>(null);
    const liveScaleRef = useRef(scale);
    const rangeRef = useRef<HTMLInputElement>(null);
    const dockLabelRef = useRef<HTMLSpanElement>(null);
    const panelLabelRef = useRef<HTMLSpanElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const panelId = useId();
    const scaleDescriptionId = useId();
    const targetPercent = useCanvasZoomPercent(scale);
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

    const updateScaleDisplay = useCallback(
        (nextScale: number) => {
            const previousPercent = Math.round(liveScaleRef.current * 100);
            liveScaleRef.current = nextScale;
            const percent = Math.round(nextScale * 100);
            if (percent === previousPercent) return;
            targetPercent.set(percent);
            const label = `${percent}%`;
            if (rangeRef.current && rangeRef.current.value !== String(percent)) rangeRef.current.value = String(percent);
            if (dockLabelRef.current && dockLabelRef.current.textContent !== label) dockLabelRef.current.textContent = label;
            if (panelLabelRef.current && panelLabelRef.current.textContent !== label) panelLabelRef.current.textContent = label;
        },
        [targetPercent],
    );

    useEffect(() => updateScaleDisplay(scale), [scale, updateScaleDisplay]);

    useEffect(() => {
        const container = containerRef?.current;
        if (!container) return;
        return subscribeCanvasViewportPreview(container, (viewport) => updateScaleDisplay(viewport.k));
    }, [containerRef, updateScaleDisplay]);

    useEffect(() => {
        if (!precisionOpen) return;
        panelRef.current?.querySelector("button")?.focus({ preventScroll: true });
        const close = (event: PointerEvent) => {
            if (event.target instanceof Node && !panelRef.current?.contains(event.target) && !triggerRef.current?.contains(event.target)) setPrecisionOpen(false);
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            setPrecisionOpen(false);
            triggerRef.current?.focus({ preventScroll: true });
        };
        document.addEventListener("pointerdown", close, true);
        document.addEventListener("keydown", closeOnEscape, true);
        return () => {
            document.removeEventListener("pointerdown", close, true);
            document.removeEventListener("keydown", closeOnEscape, true);
        };
    }, [precisionOpen]);

    function commitScale(nextScale: number) {
        const clampedScale = Math.min(2, Math.max(0.05, nextScale));
        updateScaleDisplay(clampedScale);
        onScaleChange(clampedScale);
    }

    const modifier = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl ";
    const connectionLabel = hideNodeConnections ? "显示全部连线" : "设置隐藏节点连线";
    const mapLabel = isMiniMapOpen ? "关闭小地图" : "打开小地图";

    return (
        <div ref={rootRef} data-canvas-no-zoom className="canvas-zoom-controls relative z-[var(--z-toolbar)]" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
            <div className="canvas-view-pill" role="group" aria-label="画布视图控制">
                {onAutoArrange && (
                    <button type="button" aria-label="自动整理节点" title="自动整理节点" onClick={onAutoArrange}>
                        <Grip />
                    </button>
                )}
                {onHideNodeConnectionsChange && (
                    <button type="button" aria-label={connectionLabel} title={connectionLabel} aria-pressed={hideNodeConnections} onClick={() => onHideNodeConnectionsChange(!hideNodeConnections)}>
                        <CircleDashed />
                    </button>
                )}
                {(onAutoArrange || onHideNodeConnectionsChange) && <i className="canvas-view-divider" aria-hidden />}
                <button
                    ref={triggerRef}
                    type="button"
                    className="canvas-view-scale"
                    aria-label="精确缩放"
                    title="精确缩放"
                    aria-describedby={scaleDescriptionId}
                    aria-expanded={precisionOpen}
                    aria-haspopup="dialog"
                    aria-controls={precisionOpen ? panelId : undefined}
                    onClick={() => setPrecisionOpen(!precisionOpen)}
                >
                    <Search />
                    <span ref={dockLabelRef} id={scaleDescriptionId} className="sr-only">
                        {Math.round(scale * 100)}%
                    </span>
                    <CanvasZoomReadout target={targetPercent} />
                </button>
                {precisionOpen && (
                    <div
                        ref={panelRef}
                        id={panelId}
                        className="canvas-zoom-menu"
                        role="dialog"
                        aria-label="画布缩放"
                        data-canvas-wheel-scroll
                        onBlur={(event) => {
                            if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== triggerRef.current) setPrecisionOpen(false);
                        }}
                        onKeyDown={(event) => {
                            if (event.target instanceof HTMLInputElement || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
                            event.preventDefault();
                            event.stopPropagation();
                            const buttons = Array.from(event.currentTarget.querySelectorAll("button"));
                            const index = buttons.indexOf(event.target as HTMLButtonElement);
                            const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
                            buttons[next]?.focus();
                        }}
                    >
                        <button type="button" aria-label="放大画布" onClick={() => commitScale(liveScaleRef.current + 0.1)}>
                            <Plus />
                            放大<kbd>{modifier}+</kbd>
                        </button>
                        <button type="button" aria-label="缩小画布" onClick={() => commitScale(liveScaleRef.current - 0.1)}>
                            <Minus />
                            缩小<kbd>{modifier}−</kbd>
                        </button>
                        <hr />
                        <button type="button" aria-label="适应画布" onClick={onFitContent}>
                            <Focus />
                            适应画布<kbd>{modifier}2</kbd>
                        </button>
                        <button type="button" onClick={() => commitScale(1)}>
                            <RotateCcw />
                            缩放到 100%<kbd>{modifier}0</kbd>
                        </button>
                        <hr />
                        <div className="canvas-zoom-range-row">
                            <input ref={rangeRef} type="range" min="5" max="200" step="1" defaultValue={Math.round(liveScaleRef.current * 100)} onChange={(event) => commitScale(Number(event.target.value) / 100)} aria-label="精确缩放画布" />
                            <span ref={panelLabelRef}>{Math.round(liveScaleRef.current * 100)}%</span>
                        </div>
                        <div className="canvas-zoom-stops">
                            {QUICK_ZOOM_LEVELS.map((level) => (
                                <button type="button" key={level} onClick={() => commitScale(level)}>
                                    {Math.round(level * 100)}%
                                </button>
                            ))}
                        </div>
                    </div>
                )}
                <button type="button" aria-label={mapLabel} title={mapLabel} aria-pressed={isMiniMapOpen} onClick={onToggleMiniMap}>
                    <Map />
                </button>
            </div>
            <button type="button" className="canvas-view-help" aria-label="画布快捷键" title="画布快捷键" onClick={onOpenShortcuts}>
                <HelpCircle />
            </button>
        </div>
    );
}
