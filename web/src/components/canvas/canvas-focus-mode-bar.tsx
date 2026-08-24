import { motion, useReducedMotion } from "motion/react";
import { Bot, PanelBottom, X, ZoomIn, ZoomOut } from "lucide-react";
import { Tooltip } from "antd";

import { aceternityMotion } from "@/lib/aceternity-motion";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { useTranslation } from "react-i18next";

type CanvasFocusModeBarProps = {
    dockRevealed: boolean;
    agentOpen: boolean;
    zoomPercent: number;
    onToggleDock: () => void;
    onToggleAgent: () => void;
    onExit: () => void;
    onZoomIn: () => void;
    onZoomOut: () => void;
    onFit: () => void;
};

export function CanvasFocusModeBar({ dockRevealed, agentOpen, zoomPercent, onToggleDock, onToggleAgent, onExit, onZoomIn, onZoomOut, onFit }: CanvasFocusModeBarProps) {
    const { t } = useTranslation("canvas");
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const reducedMotion = useReducedMotion();

    return (
        <motion.div
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={reducedMotion ? { duration: 0 } : aceternityMotion.spring.panel}
            className="pointer-events-auto absolute left-1/2 top-2 z-[var(--z-toolbar)] -translate-x-1/2"
            role="toolbar"
            aria-label={t("domain:focus-mode-toolbar")}
        >
            <div className="flex items-center gap-0.5 rounded-full p-1 backdrop-blur-2xl" style={{ background: theme.spatial.elevated, color: theme.node.text, boxShadow: "var(--workspace-overlay-shadow)" }}>
                <Tooltip title={t("domain:exit-focus-mode-esc")}>
                    <button type="button" onClick={onExit} className="grid size-8 place-items-center rounded-full transition hover:bg-black/5 dark:hover:bg-white/10" style={{ color: theme.node.text }} aria-label={t("domain:exit-focus-mode")}>
                        <X className="size-4" />
                    </button>
                </Tooltip>
                <span className="mx-0.5 h-4 w-px" style={{ background: theme.toolbar.border }} />
                <Tooltip title={dockRevealed ? t("domain:collapse-tools") : t("domain:tools")}>
                    <button
                        type="button"
                        onClick={onToggleDock}
                        className="grid size-8 place-items-center rounded-full transition hover:bg-black/5 dark:hover:bg-white/10"
                        style={{ color: theme.node.text, background: dockRevealed ? theme.toolbar.itemHover : undefined }}
                        aria-label={t("domain:tools")}
                        aria-pressed={dockRevealed}
                    >
                        <PanelBottom className="size-4" />
                    </button>
                </Tooltip>
                <Tooltip title={agentOpen ? t("domain:collapse-agent-2") : t("domain:agent")}>
                    <button
                        type="button"
                        onClick={onToggleAgent}
                        className="grid size-8 place-items-center rounded-full transition hover:bg-black/5 dark:hover:bg-white/10"
                        style={{ color: theme.node.text, background: agentOpen ? theme.toolbar.itemHover : undefined }}
                        aria-label={t("domain:agent")}
                        aria-pressed={agentOpen}
                    >
                        <Bot className="size-4" />
                    </button>
                </Tooltip>
                <span className="mx-0.5 h-4 w-px" style={{ background: theme.toolbar.border }} />
                <Tooltip title={t("domain:zoom-out")}>
                    <button type="button" onClick={onZoomOut} className="grid size-8 place-items-center rounded-full transition hover:bg-black/5 dark:hover:bg-white/10" style={{ color: theme.node.text }} aria-label={t("domain:zoom-out")}>
                        <ZoomOut className="size-4" />
                    </button>
                </Tooltip>
                <button
                    type="button"
                    onClick={onFit}
                    className="grid h-8 min-w-14 place-items-center rounded-full px-2 text-xs font-medium tabular-nums transition hover:bg-black/5 dark:hover:bg-white/10"
                    style={{ color: theme.node.text }}
                    title={t("domain:fit-canvas")}
                >
                    {Math.round(zoomPercent * 100)}%
                </button>
                <Tooltip title={t("domain:zoom-in")}>
                    <button type="button" onClick={onZoomIn} className="grid size-8 place-items-center rounded-full transition hover:bg-black/5 dark:hover:bg-white/10" style={{ color: theme.node.text }} aria-label={t("domain:zoom-in")}>
                        <ZoomIn className="size-4" />
                    </button>
                </Tooltip>
            </div>
        </motion.div>
    );
}
