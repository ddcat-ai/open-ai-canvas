import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Camera, ChartGantt, Check, ChevronUp, Focus, MousePointer2, Move3d, Rotate3d, Route, Scale3d, Scan, SlidersHorizontal, type LucideIcon } from "lucide-react";

import type { CanvasTheme } from "@/lib/canvas-theme";
import { PREVIS_VIEW_MODES, type PrevisViewMode } from "@/lib/canvas/previs/previs-view-modes";
import { PREVIS_ASPECT_RATIOS, previsAspectOption } from "@/lib/canvas/previs/previs-optics";
import type { PrevisAspectRatio, PrevisCamera } from "@/types/previs";
import { PREVIS_TOOL_LABELS, type PrevisToolMode } from "@/lib/canvas/previs/previs-shortcuts";

type TransformMode = PrevisToolMode;

export type PrevisCanvasDockProps = {
    theme: CanvasTheme;
    transformMode: TransformMode;
    onTransformModeChange: (mode: TransformMode) => void;
    trajectoryDrawing: boolean;
    /** 当前选中、可以画轨迹的目标；null 时画下的是参考轨迹。 */
    trajectoryKind: "actor" | "object" | "camera" | null;
    onToggleTrajectory: () => void;
    viewMode: PrevisViewMode;
    onViewModeChange: (mode: PrevisViewMode) => void;
    /** 当前镜头画幅；选择后由宿主写入镜头并切到机位视图预览安全框。 */
    aspectRatio?: PrevisAspectRatio;
    onAspectRatioChange: (value: PrevisAspectRatio) => void;
    cameras: PrevisCamera[];
    viewedCameraId: string | null;
    onViewCamera: (id: string) => void;
    onFocusSelected: () => void;
    onFrameScene: () => void;
    onZoom: (factor: number) => void;
    timelineOpen: boolean;
    /** 时间轴开着时收起，否则进入动画模式并打开。 */
    onToggleTimeline: () => void;
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
 * 世界引擎底部工具条：浅色、图标带文字，当前工具实心高亮，一眼看清在用什么。
 * 左到右：编辑工具 → 画路径 → 取景 → 导航 → 面板。场景列表与快捷键在左侧工具条。
 */
export function PrevisCanvasDock(props: PrevisCanvasDockProps) {
    const rootRef = useRef<HTMLDivElement>(null);
    // 取景与画幅两个弹层互斥，同一时间只开一个。
    const [openMenu, setOpenMenu] = useState<"view" | "aspect" | null>(null);
    const toggleMenu = (menu: "view" | "aspect") => setOpenMenu((current) => (current === menu ? null : menu));
    useEffect(() => {
        if (!openMenu) return;
        const close = (event: PointerEvent) => {
            if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpenMenu(null);
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") setOpenMenu(null);
        };
        document.addEventListener("pointerdown", close, true);
        document.addEventListener("keydown", closeOnEscape);
        return () => {
            document.removeEventListener("pointerdown", close, true);
            document.removeEventListener("keydown", closeOnEscape);
        };
    }, [openMenu]);
    const trajectoryLabel = props.trajectoryDrawing ? "结束绘制" : props.trajectoryKind === "camera" ? "画运镜" : props.trajectoryKind === "actor" ? "画走位" : props.trajectoryKind === "object" ? "画路径" : "画轨迹";
    const trajectoryTitle =
        props.trajectoryKind === "camera"
            ? "为选中的摄影机画运镜路径"
            : props.trajectoryKind === "actor"
              ? "为选中的演员画走位；右键地面可直接打点、生成 A→B 移动"
              : props.trajectoryKind === "object"
                ? "为选中的道具画移动路径"
                : "没有选中对象：画下的是参考轨迹，之后可套用给人物或摄影机";
    const quickActive = QUICK_VIEWS.some((item) => item.mode === props.viewMode);
    const moreLabel = quickActive ? "更多" : (PREVIS_VIEW_MODES.find((item) => item.mode === props.viewMode)?.label ?? "更多");
    const currentAspect = previsAspectOption(props.aspectRatio);
    // 外层只负责定位和承载弹层；内层 .pv-dock 窄屏时横向滚动。
    // 滚动容器会把 overflow-y 一并算成 auto，弹层若放在里面会被裁掉、点不到。
    return (
        <div ref={rootRef} data-canvas-no-zoom className="pv-canvas-dock" onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
            <AnimatePresence>
                {openMenu === "aspect" ? (
                    <motion.div
                        key="aspect"
                        role="dialog"
                        aria-label="画幅比例"
                        initial={{ opacity: 0, y: 10, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 6, scale: 0.98 }}
                        transition={{ duration: 0.16 }}
                        className="pv-dock__menu pv-dock__menu--aspect"
                    >
                        <div className="pv-dock__menu-title">
                            <span>画幅比例</span>
                            <small>决定机位取景与输出尺寸</small>
                        </div>
                        <div className="pv-dock__aspect-grid" role="radiogroup" aria-label="画幅比例">
                            {PREVIS_ASPECT_RATIOS.map((item) => {
                                const checked = item.value === currentAspect.value;
                                return (
                                    <button
                                        key={item.value}
                                        type="button"
                                        role="radio"
                                        aria-checked={checked}
                                        aria-label={`${item.label} ${item.hint}`}
                                        title={item.hint}
                                        className={checked ? "is-active" : undefined}
                                        onClick={() => {
                                            props.onAspectRatioChange(item.value);
                                            setOpenMenu(null);
                                        }}
                                    >
                                        <PrevisAspectGlyph ratio={item.ratio} large />
                                        <span>{item.label}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </motion.div>
                ) : null}
                {openMenu === "view" ? (
                    <motion.div
                        key="view"
                        role="dialog"
                        aria-label="取景模式"
                        initial={{ opacity: 0, y: 10, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 6, scale: 0.98 }}
                        transition={{ duration: 0.16 }}
                        className="pv-dock__menu"
                    >
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
                                            setOpenMenu(null);
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
                                                    setOpenMenu(null);
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

            <div className="pv-dock" role="toolbar" aria-label="世界引擎视口工具">
                <div className="pv-dock__group" role="radiogroup" aria-label="变换模式">
                    {TOOLS.map((tool) => {
                        const active = props.transformMode === tool.mode;
                        return (
                            <button
                                key={tool.mode}
                                type="button"
                                role="radio"
                                aria-checked={active}
                                aria-label={PREVIS_TOOL_LABELS[tool.mode]}
                                title={PREVIS_TOOL_LABELS[tool.mode]}
                                className={`pv-dock__tool ${active ? "is-active" : ""}`}
                                onClick={() => props.onTransformModeChange(tool.mode)}
                            >
                                <tool.icon aria-hidden />
                                <span>{tool.label}</span>
                            </button>
                        );
                    })}
                </div>
                <span className="pv-dock__divider" />
                <button type="button" aria-pressed={props.trajectoryDrawing} title={trajectoryTitle} className={`pv-dock__tool ${props.trajectoryDrawing ? "is-active is-accent" : ""}`} onClick={props.onToggleTrajectory}>
                    <Route aria-hidden />
                    <span>{trajectoryLabel}</span>
                </button>
                <span className="pv-dock__divider" />
                <div className="pv-dock__views" role="radiogroup" aria-label="取景">
                    {QUICK_VIEWS.map((item) => {
                        const active = props.viewMode === item.mode;
                        return (
                            <button
                                key={item.mode}
                                type="button"
                                role="radio"
                                aria-checked={active}
                                title={PREVIS_VIEW_MODES.find((mode) => mode.mode === item.mode)?.hint}
                                className={active ? "is-active" : ""}
                                onClick={() => props.onViewModeChange(item.mode)}
                            >
                                {item.label}
                            </button>
                        );
                    })}
                    <button type="button" aria-expanded={openMenu === "view"} title="更多取景与机位（C 切换 3D / 机位）" className={!quickActive ? "is-active" : ""} onClick={() => toggleMenu("view")}>
                        {moreLabel}
                        <ChevronUp className={`size-3 transition-transform ${openMenu === "view" ? "" : "rotate-180"}`} aria-hidden />
                    </button>
                </div>
                <button
                    type="button"
                    aria-expanded={openMenu === "aspect"}
                    title={`画幅比例：${currentAspect.label}（${currentAspect.hint}）`}
                    className={`pv-dock__tool ${openMenu === "aspect" ? "is-active is-soft" : ""}`}
                    onClick={() => toggleMenu("aspect")}
                >
                    <PrevisAspectGlyph ratio={currentAspect.ratio} />
                    <span>{currentAspect.label}</span>
                </button>
                <span className="pv-dock__divider" />
                <button type="button" title="聚焦选中对象 (F)" className="pv-dock__tool" onClick={props.onFocusSelected}>
                    <Focus aria-hidden />
                    <span>聚焦</span>
                </button>
                <button type="button" aria-label="适配全部对象 (A)" title="适配全部对象 (A)" className="pv-dock__tool" onClick={props.onFrameScene}>
                    <Scan aria-hidden />
                    <span>全景</span>
                </button>
                <span className="pv-dock__divider" />
                <button type="button" aria-pressed={props.timelineOpen} title={props.timelineOpen ? "收起时间轴" : "打开动画时间轴"} className={`pv-dock__tool ${props.timelineOpen ? "is-active" : ""}`} onClick={props.onToggleTimeline}>
                    <ChartGantt aria-hidden />
                    <span>时间轴</span>
                </button>
                <button type="button" aria-pressed={props.inspectorOpen} title={props.inspectorOpen ? "收起属性面板" : "打开属性面板"} className={`pv-dock__tool ${props.inspectorOpen ? "is-active is-soft" : ""}`} onClick={props.onToggleInspector}>
                    <SlidersHorizontal aria-hidden />
                    <span>属性</span>
                </button>
            </div>
        </div>
    );
}

/** 画幅示意：按比例画一个居中矩形；自适应（无固定比例）画四角取景框。 */
function PrevisAspectGlyph({ ratio, large = false }: { ratio?: number; large?: boolean }) {
    const box = 16;
    const max = 13;
    const width = ratio ? (ratio >= 1 ? max : Math.max(4, max * ratio)) : 13;
    const height = ratio ? (ratio >= 1 ? Math.max(4, max / ratio) : max) : 10;
    const x = (box - width) / 2;
    const y = (box - height) / 2;
    const corner = 3.5;
    return (
        <span className={`pv-aspect-glyph ${large ? "is-large" : ""}`} aria-hidden>
            <svg viewBox={`0 0 ${box} ${box}`} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
                {ratio ? (
                    <rect x={x} y={y} width={width} height={height} rx={1.4} strokeWidth={1.4} />
                ) : (
                    <path
                        strokeWidth={1.4}
                        d={[
                            `M${x} ${y + corner}V${y}H${x + corner}`,
                            `M${x + width - corner} ${y}H${x + width}V${y + corner}`,
                            `M${x + width} ${y + height - corner}V${y + height}H${x + width - corner}`,
                            `M${x + corner} ${y + height}H${x}V${y + height - corner}`,
                        ].join("")}
                    />
                )}
            </svg>
        </span>
    );
}
