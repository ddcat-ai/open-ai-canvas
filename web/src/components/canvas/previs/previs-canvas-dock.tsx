import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Camera, Check, ChevronUp, Focus, MousePointer2, Move3d, Rotate3d, Route, Scale3d, Scan, SlidersHorizontal, WandSparkles, type LucideIcon } from "lucide-react";

import type { CanvasTheme } from "@/lib/canvas-theme";
import { PREVIS_VIEW_MODES, type PrevisViewMode } from "@/lib/canvas/previs/previs-view-modes";
import type { PrevisCamera } from "@/types/previs";
import { PREVIS_TOOL_LABELS, type PrevisToolMode } from "@/lib/canvas/previs/previs-shortcuts";

type TransformMode = PrevisToolMode;

export type PrevisCanvasDockProps = {
    theme: CanvasTheme;
    transformMode: TransformMode;
    onTransformModeChange: (mode: TransformMode) => void;
    trajectoryDrawing: boolean;
    trajectoryKind: "actor" | "camera" | null;
    onToggleTrajectory: () => void;
    viewMode: PrevisViewMode;
    onViewModeChange: (mode: PrevisViewMode) => void;
    cameras: PrevisCamera[];
    viewedCameraId: string | null;
    onViewCamera: (id: string) => void;
    onFocusSelected: () => void;
    onFrameScene: () => void;
    onZoom: (factor: number) => void;
    timelineOpen: boolean;
    onOpenTimeline: () => void;
    scenePanelOpen: boolean;
    onToggleScenePanel: () => void;
    inspectorOpen: boolean;
    onToggleInspector: () => void;
    shortcutHelpOpen: boolean;
    onToggleShortcutHelp: () => void;
};

const TOOLS: Array<{ mode: TransformMode; label: string; icon: LucideIcon }> = [
    { mode: "select", label: "选择", icon: MousePointer2 },
    { mode: "translate", label: "移动", icon: Move3d },
    { mode: "rotate", label: "旋转", icon: Rotate3d },
    { mode: "scale", label: "缩放", icon: Scale3d },
];

/** 常用取景直接摆在工具条上，其余正交视图收进「更多」。 */
const QUICK_VIEWS: Array<{ mode: PrevisViewMode; label: string }> = [
    { mode: "free", label: "3D" },
    { mode: "camera", label: "机位" },
    { mode: "top", label: "俯视" },
];

/**
 * 预演台底部工具条：浅色、图标带文字，当前工具实心高亮，一眼看清在用什么。
 * 左到右：编辑工具 → 画路径 → 取景 → 导航 → 面板。场景列表与快捷键在左侧工具条。
 */
export function PrevisCanvasDock(props: PrevisCanvasDockProps) {
    const rootRef = useRef<HTMLDivElement>(null);
    const [viewMenuOpen, setViewMenuOpen] = useState(false);
    useEffect(() => {
        if (!viewMenuOpen) return;
        const close = (event: PointerEvent) => {
            if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setViewMenuOpen(false);
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") setViewMenuOpen(false);
        };
        document.addEventListener("pointerdown", close, true);
        document.addEventListener("keydown", closeOnEscape);
        return () => {
            document.removeEventListener("pointerdown", close, true);
            document.removeEventListener("keydown", closeOnEscape);
        };
    }, [viewMenuOpen]);
    const trajectoryLabel = props.trajectoryDrawing ? "结束绘制" : props.trajectoryKind === "camera" ? "画运镜" : "画走位";
    const quickActive = QUICK_VIEWS.some((item) => item.mode === props.viewMode);
    const moreLabel = quickActive ? "更多" : (PREVIS_VIEW_MODES.find((item) => item.mode === props.viewMode)?.label ?? "更多");
    return (
        <div ref={rootRef} data-canvas-no-zoom className="pv-canvas-dock pv-dock" role="toolbar" aria-label="预演台视口工具" onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
            <AnimatePresence>
                {viewMenuOpen ? (
                    <motion.div role="dialog" aria-label="取景模式" initial={{ opacity: 0, y: 10, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6, scale: 0.98 }} transition={{ duration: 0.16 }} className="pv-dock__menu">
                        <div className="pv-dock__menu-title">
                            <span>取景</span>
                            <small>只改变观察方式，不写入场景</small>
                        </div>
                        <div className="pv-dock__view-grid" role="radiogroup" aria-label="取景模式">
                            {PREVIS_VIEW_MODES.map((item) => {
                                const checked = item.mode === props.viewMode;
                                return (
                                    <button
                                        key={item.mode}
                                        type="button"
                                        role="radio"
                                        aria-checked={checked}
                                        title={item.hint}
                                        className={checked ? "is-active" : undefined}
                                        onClick={() => {
                                            props.onViewModeChange(item.mode);
                                            setViewMenuOpen(false);
                                        }}
                                    >
                                        {item.label}
                                    </button>
                                );
                            })}
                        </div>
                        {props.cameras.length ? (
                            <>
                                <div className="pv-dock__menu-title is-sub">
                                    <span>机位</span>
                                </div>
                                <div className="pv-dock__camera-list">
                                    {props.cameras.map((camera) => {
                                        const current = props.viewMode === "camera" && camera.id === props.viewedCameraId;
                                        return (
                                            <button
                                                key={camera.id}
                                                type="button"
                                                aria-pressed={current}
                                                className={current ? "is-active" : undefined}
                                                onClick={() => {
                                                    props.onViewCamera(camera.id);
                                                    setViewMenuOpen(false);
                                                }}
                                            >
                                                <Camera className="size-3.5" />
                                                <span>{camera.name}</span>
                                                <small>{camera.focalLength}mm</small>
                                                {current ? <Check className="size-3.5" /> : null}
                                            </button>
                                        );
                                    })}
                                </div>
                            </>
                        ) : null}
                    </motion.div>
                ) : null}
            </AnimatePresence>

            <div className="pv-dock__group" role="radiogroup" aria-label="编辑工具">
                {TOOLS.map((tool) => {
                    const active = props.transformMode === tool.mode;
                    return (
                        <button key={tool.mode} type="button" role="radio" aria-checked={active} title={PREVIS_TOOL_LABELS[tool.mode]} className={`pv-dock__tool ${active ? "is-active" : ""}`} onClick={() => props.onTransformModeChange(tool.mode)}>
                            <tool.icon aria-hidden />
                            <span>{tool.label}</span>
                        </button>
                    );
                })}
            </div>
            <span className="pv-dock__divider" />
            <button type="button" aria-pressed={props.trajectoryDrawing} title={props.trajectoryKind === "camera" ? "为选中的摄影机画运镜路径" : "为选中的演员画走位；右键地面可直接打点、生成 A→B 移动"} className={`pv-dock__tool ${props.trajectoryDrawing ? "is-active is-accent" : ""}`} onClick={props.onToggleTrajectory}>
                <Route aria-hidden />
                <span>{trajectoryLabel}</span>
            </button>
            <span className="pv-dock__divider" />
            <div className="pv-dock__views" role="radiogroup" aria-label="取景">
                {QUICK_VIEWS.map((item) => {
                    const active = props.viewMode === item.mode;
                    return (
                        <button key={item.mode} type="button" role="radio" aria-checked={active} title={PREVIS_VIEW_MODES.find((mode) => mode.mode === item.mode)?.hint} className={active ? "is-active" : ""} onClick={() => props.onViewModeChange(item.mode)}>
                            {item.label}
                        </button>
                    );
                })}
                <button type="button" aria-expanded={viewMenuOpen} title="更多取景与机位（C 切换 3D / 机位）" className={!quickActive ? "is-active" : ""} onClick={() => setViewMenuOpen((value) => !value)}>
                    {moreLabel}
                    <ChevronUp className={`size-3 transition-transform ${viewMenuOpen ? "" : "rotate-180"}`} aria-hidden />
                </button>
            </div>
            <span className="pv-dock__divider" />
            <button type="button" title="聚焦选中对象 (F)" className="pv-dock__tool" onClick={props.onFocusSelected}>
                <Focus aria-hidden />
                <span>聚焦</span>
            </button>
            <button type="button" title="适配全部对象 (A)" className="pv-dock__tool" onClick={props.onFrameScene}>
                <Scan aria-hidden />
                <span>全景</span>
            </button>
            <span className="pv-dock__divider" />
            <button type="button" aria-pressed={props.timelineOpen} title="动画时间轴" className={`pv-dock__tool ${props.timelineOpen ? "is-active" : ""}`} onClick={props.onOpenTimeline}>
                <WandSparkles aria-hidden />
                <span>时间轴</span>
            </button>
            <button type="button" aria-pressed={props.inspectorOpen} title={props.inspectorOpen ? "收起属性面板" : "打开属性面板"} className={`pv-dock__tool ${props.inspectorOpen ? "is-active is-soft" : ""}`} onClick={props.onToggleInspector}>
                <SlidersHorizontal aria-hidden />
                <span>属性</span>
            </button>
        </div>
    );
}
