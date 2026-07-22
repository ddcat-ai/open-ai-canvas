import type { CSSProperties } from "react";

import type { CanvasTheme } from "@/lib/canvas-theme";

export function canvasDockStyle(theme: CanvasTheme, color: string = theme.toolbar.item): CSSProperties {
    return {
        background: theme.spatial.elevated,
        borderColor: theme.toolbar.border,
        color,
        boxShadow: `0 18px 52px ${theme.spatial.shadow}, inset 0 1px 0 rgba(255,255,255,.14)`,
        "--dock-command-bg": theme.spatial.surface,
        "--dock-command-hover": theme.toolbar.itemHover,
        "--dock-command-active": theme.node.text,
        "--dock-command-active-text": theme.canvas.background,
        "--dock-command-danger": theme.accent.danger,
        "--dock-tooltip-bg": theme.spatial.elevated,
        "--dock-tooltip-border": theme.toolbar.border,
    } as CSSProperties;
}
