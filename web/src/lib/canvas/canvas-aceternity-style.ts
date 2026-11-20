import type { CSSProperties } from "react";

import type { CanvasTheme } from "@/lib/canvas-theme";

export function canvasDockStyle(theme: CanvasTheme, color: string = theme.toolbar.item): CSSProperties {
    return {
        background: "var(--dock-surface)",
        borderColor: "var(--dock-border)",
        color,
        boxShadow: "var(--dock-shadow, var(--elevation-overlay))",
        "--dock-command-bg": theme.spatial.surface,
        "--dock-command-hover": theme.toolbar.itemHover,
        "--dock-command-active": theme.toolbar.activeBg,
        "--dock-command-active-text": theme.toolbar.activeText,
        "--dock-command-danger": theme.accent.danger,
        "--dock-tooltip-bg": theme.spatial.elevated,
        "--dock-tooltip-border": theme.toolbar.border,
        "--canvas-bottom-surface": theme.node.panel,
        "--canvas-bottom-border": theme.toolbar.border,
        // 分段控件跟随画布主题：浅色为白色滑块，深色为抬亮的灰色滑块。
        "--dock-switch-track": theme.toolbar.itemHover,
        "--dock-switch-thumb": theme.node.panel,
        "--dock-switch-thumb-text": theme.toolbar.activeText,
    } as CSSProperties;
}
