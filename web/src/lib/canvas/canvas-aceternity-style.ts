import type { CSSProperties } from "react";

import type { CanvasTheme } from "@/lib/canvas-theme";

export function canvasDockStyle(theme: CanvasTheme, color: string = theme.toolbar.item): CSSProperties {
    return {
        // 画布浮层必须跟当前画布主题走：浅色应用 + 深色画布时，不能用全局白色底
        // 配画布白色文字，否则就是一块白底白字。
        background: theme.node.panel,
        borderColor: theme.toolbar.border,
        color,
        boxShadow: theme.node.shadow,
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
