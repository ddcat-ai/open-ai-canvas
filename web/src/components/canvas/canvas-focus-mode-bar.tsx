import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Bot, PanelBottom, X, ZoomIn, ZoomOut } from "lucide-react";
import { Tooltip } from "antd";

import { aceternityMotion } from "@/lib/aceternity-motion";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

type CanvasFocusModeBarProps = {
    visible: boolean;
    dockRevealed: boolean;
    agentOpen: boolean;
    zoomPercent: number;
    onToggleDock: () => void;
    onToggleAgent: () => void;
    onExit: () => void;
    onZoomIn: () => void;
    onZoomOut: () => void;
    onFit: () => void;
    onInteractionChange?: (active: boolean) => void;
};

export function CanvasFocusModeBar({ visible, dockRevealed, agentOpen, zoomPercent, onToggleDock, onToggleAgent, onExit, onZoomIn, onZoomOut, onFit, onInteractionChange }: CanvasFocusModeBarProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const reducedMotion = useReducedMotion();
    const [pointerInside, setPointerInside] = useState(false);
    const [focusWithin, setFocusWithin] = useState(false);
    const interacting = pointerInside || focusWithin;

    useEffect(() => {
        onInteractionChange?.(interacting);
    }, [interacting, onInteractionChange]);

    useEffect(() => () => onInteractionChange?.(false), [onInteractionChange]);

    return (
        <motion.div
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -12 }}
            animate={visible ? { opacity: 1, y: 0 } : { opacity: 0, y: -14 }}
            transition={reducedMotion ? { duration: 0 } : visible ? aceternityMotion.spring.panel : { duration: aceternityMotion.duration.state, ease: aceternityMotion.easing.exit }}
            className="pointer-events-auto absolute left-1/2 top-2 z-[var(--z-toolbar)] -translate-x-1/2"
            style={{ pointerEvents: visible ? "auto" : "none" }}
            data-canvas-immersive-toolbar
            data-visible={visible ? "true" : "false"}
            role="toolbar"
            aria-label="专注模式工具栏"
            onPointerEnter={() => setPointerInside(true)}
            onPointerLeave={() => setPointerInside(false)}
            onFocusCapture={() => setFocusWithin(true)}
            onBlurCapture={(event) => {
                if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
                setFocusWithin(false);
            }}
        >
            <div className="flex items-center gap-0.5 rounded-full p-1 backdrop-blur-2xl" style={{ background: theme.spatial.elevated, color: theme.node.text, boxShadow: "var(--workspace-overlay-shadow)" }}>
                <Tooltip title="退出专注模式（Esc）">
                    <button
                        type="button"
                        onClick={onExit}
                        className="grid size-8 place-items-center rounded-full transition hover:bg-black/5 dark:hover:bg-white/10"
                        style={{ color: theme.node.text }}
                        aria-label="退出专注模式"
                    >
                        <X className="size-4" />
                    </button>
                </Tooltip>
                <span className="mx-0.5 h-4 w-px" style={{ background: theme.toolbar.border }} />
                <Tooltip title={dockRevealed ? "收起工具" : "工具"}>
                    <button
                        type="button"
                        onClick={onToggleDock}
                        className="grid size-8 place-items-center rounded-full transition hover:bg-black/5 dark:hover:bg-white/10"
                        style={{ color: theme.node.text, background: dockRevealed ? theme.toolbar.itemHover : undefined }}
                        aria-label="工具"
                        aria-pressed={dockRevealed}
                    >
                        <PanelBottom className="size-4" />
                    </button>
                </Tooltip>
                <Tooltip title={agentOpen ? "收起智能体" : "智能体"}>
                    <button
                        type="button"
                        onClick={onToggleAgent}
                        className="grid size-8 place-items-center rounded-full transition hover:bg-black/5 dark:hover:bg-white/10"
                        style={{ color: theme.node.text, background: agentOpen ? theme.toolbar.itemHover : undefined }}
                        aria-label="智能体"
                        aria-pressed={agentOpen}
                    >
                        <Bot className="size-4" />
                    </button>
                </Tooltip>
                <span className="mx-0.5 h-4 w-px" style={{ background: theme.toolbar.border }} />
                <Tooltip title="缩小">
                    <button type="button" onClick={onZoomOut} className="grid size-8 place-items-center rounded-full transition hover:bg-black/5 dark:hover:bg-white/10" style={{ color: theme.node.text }} aria-label="缩小">
                        <ZoomOut className="size-4" />
                    </button>
                </Tooltip>
                <button
                    type="button"
                    onClick={onFit}
                    className="grid h-8 min-w-14 place-items-center rounded-full px-2 text-xs font-medium tabular-nums transition hover:bg-black/5 dark:hover:bg-white/10"
                    style={{ color: theme.node.text }}
                    title="适应画布"
                >
                    {Math.round(zoomPercent * 100)}%
                </button>
                <Tooltip title="放大">
                    <button type="button" onClick={onZoomIn} className="grid size-8 place-items-center rounded-full transition hover:bg-black/5 dark:hover:bg-white/10" style={{ color: theme.node.text }} aria-label="放大">
                        <ZoomIn className="size-4" />
                    </button>
                </Tooltip>
            </div>
        </motion.div>
    );
}
