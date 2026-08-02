import type { CSSProperties } from "react";

import type { CanvasTheme } from "@/lib/canvas-theme";

/**
 * 画布浮层视觉令牌约定（供后续维护参照）：
 * - 圆角层级（内紧外松）：图标按钮 rounded-full、面板内操作/图标容器 rounded-xl(12px)、面板容器 rounded-2xl(16px)、大型浮层 rounded-3xl(24px)
 * - hover 语言：统一为背景色变化 + 微阴影，避免位移（位移会破坏 dock proximity 视觉连贯性）
 * - active 语言：dock 用强调色填充（工具模式语义），面板内列表项用软背景 + 强调色文字
 * - 入场动效：统一复用 aceternityMotion.panelEnter 基线
 */
export function canvasDockStyle(theme: CanvasTheme, color: string = theme.toolbar.item): CSSProperties {
    return {
        background: theme.spatial.elevated,
        borderColor: theme.toolbar.border,
        color,
        boxShadow: `0 18px 52px ${theme.spatial.shadow}, inset 0 1px 0 rgba(255,255,255,.14)`,
        "--dock-command-bg": theme.spatial.surface,
        "--dock-command-hover": theme.toolbar.itemHover,
        "--dock-command-active": theme.toolbar.activeBg,
        "--dock-command-active-text": theme.toolbar.activeText,
        "--dock-command-danger": theme.accent.danger,
        "--dock-tooltip-bg": theme.spatial.elevated,
        "--dock-tooltip-border": theme.toolbar.border,
    } as CSSProperties;
}
