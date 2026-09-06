import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

/**
 * Kbd — 快捷键提示键帽。
 *
 * 用途：展示键盘快捷键（⌘K、Shift+Enter、Esc 等），纯展示，非交互。
 * token：字号 `fs-tiny`（text-tiny）、字体 font-mono、背景 bg-background（半透明）、
 *   边框 var(--workspace-border)、文本 text-foreground。
 * 对标：接管私有实现 workspace-sidebar-nav.tsx / workspace-command-palette.tsx /
 *   canvas 快捷键弹窗中的 `<kbd>` 重复样式；形态参考 shadcn kbd 与 BoardUI kbd。
 * 明暗：背景为背景色半透明 + 主题边框，明暗双主题自动适配，无额外差异。
 */
export interface KbdProps extends HTMLAttributes<HTMLElement> {}

export function Kbd({ className, children, ...props }: KbdProps) {
    return (
        <kbd
            data-slot="kbd"
            className={cn(
                "inline-flex h-5 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-sm",
                "border border-[color:var(--workspace-border)] bg-background/60 px-1.5",
                "font-mono text-tiny font-medium text-foreground/60",
                className,
            )}
            {...props}
        >
            {children}
        </kbd>
    );
}
