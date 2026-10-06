import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Camera, Check, Focus, Minus, Move3d, PanelLeft, Plus, Rotate3d, Route, Scale3d, Scan, SlidersHorizontal, WandSparkles } from "lucide-react";

import { FloatingDock, type FloatingDockEntry } from "@/components/ui/aceternity/floating-dock";
import { aceternityMotion } from "@/lib/aceternity-motion";
import { canvasDockStyle } from "@/lib/canvas/canvas-aceternity-style";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { PREVIS_VIEW_MODES, type PrevisViewMode } from "@/lib/canvas/previs/previs-view-modes";
import type { PrevisCamera } from "@/types/previs";

type TransformMode = "translate" | "rotate" | "scale";

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
};

/**
 * 预演台视口工具条：与画布主工具条共用 FloatingDock 组件、dock token 与提示/动效。
 * 一条 dock 承载「改内容」(变换、画轨迹) 与「怎么看」(取景、导航)，取景细项收进弹层，
 * 避免视口四角各挂一组浮层遮挡画面。
 */
export function PrevisCanvasDock(props: PrevisCanvasDockProps) {
    const { theme } = props;
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

    const currentView = PREVIS_VIEW_MODES.find((item) => item.mode === props.viewMode) ?? PREVIS_VIEW_MODES[0];
    const trajectoryLabel = props.trajectoryDrawing ? "结束绘制轨迹" : props.trajectoryKind === "camera" ? "画运镜路径" : "画走位";

    const items: FloatingDockEntry[] = [
        { id: "previs-scene-panel", label: props.scenePanelOpen ? "收起场景面板" : "打开场景面板", icon: <PanelLeft />, active: props.scenePanelOpen, expands: true, onClick: props.onToggleScenePanel },
        { kind: "separator", id: "previs-sep-scene" },
        {
            kind: "switch",
            id: "previs-transform",
            label: "变换模式",
            value: props.transformMode,
            onChange: (value) => props.onTransformModeChange(value as TransformMode),
            options: [
                { id: "previs-translate", value: "translate", label: "移动对象 (W)", icon: <Move3d /> },
                { id: "previs-rotate", value: "rotate", label: "旋转对象 (E)", icon: <Rotate3d /> },
                { id: "previs-scale", value: "scale", label: "缩放对象 (R)", icon: <Scale3d /> },
            ],
        },
        { id: "previs-trajectory", label: trajectoryLabel, icon: <Route />, active: props.trajectoryDrawing, onClick: props.onToggleTrajectory },
        { kind: "separator", id: "previs-sep-view" },
        {
            id: "previs-view-mode",
            label: `取景：${currentView.label}`,
            wide: true,
            quiet: true,
            expands: true,
            active: viewMenuOpen,
            icon: <span className="inline-flex h-full items-center justify-center whitespace-nowrap text-[var(--fs-caption)] font-semibold leading-none tracking-wide">{currentView.label}</span>,
            onClick: () => setViewMenuOpen((value) => !value),
        },
        { id: "previs-focus", label: "聚焦选中对象", icon: <Focus />, onClick: props.onFocusSelected },
        { id: "previs-frame", label: "适配全部对象", icon: <Scan />, onClick: props.onFrameScene },
        { id: "previs-zoom-out", label: "拉远视角", icon: <Minus />, onClick: () => props.onZoom(1.38) },
        { id: "previs-zoom-in", label: "拉近视角", icon: <Plus />, onClick: () => props.onZoom(0.72) },
        { kind: "separator", id: "previs-sep-panels" },
        { id: "previs-timeline", label: "动画时间轴", icon: <WandSparkles />, active: props.timelineOpen, onClick: props.onOpenTimeline },
        { id: "previs-inspector", label: props.inspectorOpen ? "收起属性面板" : "打开属性面板", icon: <SlidersHorizontal />, active: props.inspectorOpen, expands: true, onClick: props.onToggleInspector },
    ];

    return (
        <div ref={rootRef} data-canvas-no-zoom className="pv-canvas-dock" onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
            <AnimatePresence>
                {viewMenuOpen ? (
                    <motion.div
                        role="dialog"
                        aria-label="取景模式"
                        initial={{ opacity: 0, y: 14, scale: 0.92 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 9, scale: 0.96 }}
                        transition={aceternityMotion.spring.panel}
                        className="pv-canvas-dock__menu aceternity-floating-panel"
                        style={{ background: theme.spatial.elevated, color: theme.node.text, boxShadow: `0 28px 80px ${theme.spatial.shadow}` }}
                    >
                        <div className="pv-canvas-dock__menu-title">
                            <span>取景</span>
                            <small style={{ color: theme.node.muted }}>只改变观察方式，不写入场景</small>
                        </div>
                        <div className="pv-canvas-dock__view-grid" role="radiogroup" aria-label="取景模式">
                            {PREVIS_VIEW_MODES.map((item) => {
                                const checked = item.mode === props.viewMode;
                                return (
                                    <button
                                        key={item.mode}
                                        type="button"
                                        role="radio"
                                        aria-checked={checked}
                                        aria-label={`${item.label} ${item.hint}`}
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
                                <div className="pv-canvas-dock__menu-title is-sub"><span>机位</span></div>
                                <div className="pv-canvas-dock__camera-list">
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
            <FloatingDock items={items} className="canvas-floating-dock" style={canvasDockStyle(theme)} ariaLabel="预演台视口工具" />
        </div>
    );
}
