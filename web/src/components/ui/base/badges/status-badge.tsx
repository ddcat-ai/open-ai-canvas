import type { HTMLAttributes, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * StatusBadge — 语义状态徽章。
 *
 * 两种形态：
 * - outline（默认）：圆点 + 文本，圆点承担状态色，底色 bg-secondary/60。
 * - filled：tone 色块纯文本胶囊（AntD Tag variant="filled" 观感），无圆点。
 *
 * 用途：展示实体的语义状态（成功/告警/失败/进行中/中性），如任务状态、同步状态、
 *   节点状态；替代 AntD Tag 的状态标签场景与各页面私有实现。
 * token：outline 圆点取 bg-status-{success|warning|error|loading}、中性取前景色；
 *   底色 bg-secondary/60、文本 text-muted-foreground；filled 容器取
 *   bg-status-{tone}/15 + text-status-{tone}（中性取前景色混合）。
 * 对标：AntD Tag（状态色标签，variant="filled" 对应 filled）、BoardUI status-dot（状态点）。
 * 明暗：全部颜色走 token，明暗双主题自动适配。
 */
export const statusBadgeTone = cva("shrink-0 rounded-full", {
    variants: {
        tone: {
            neutral: "bg-foreground/50",
            success: "bg-status-success",
            warning: "bg-status-warning",
            error: "bg-status-error",
            loading: "bg-status-loading",
        },
    },
    defaultVariants: {
        tone: "neutral",
    },
});

export const statusBadgeVariants = cva("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full", {
    variants: {
        variant: {
            outline: "bg-secondary/60",
            filled: "font-medium",
        },
        size: {
            default: "px-2 py-0.5 text-caption",
            sm: "gap-1 px-1.5 py-px text-tiny",
        },
    },
    defaultVariants: {
        variant: "outline",
        size: "default",
    },
});

/** filled 容器底色：tone 色 12–15% 淡底（中性为前景色 8%） */
const filledTintClass: Record<string, string> = {
    neutral: "bg-foreground/8",
    success: "bg-status-success/15",
    warning: "bg-status-warning/15",
    error: "bg-status-error/15",
    loading: "bg-status-loading/15",
};

/** filled 文本色：tone 原色（中性为前景色 70%） */
const filledInkClass: Record<string, string> = {
    neutral: "text-foreground/70",
    success: "text-status-success",
    warning: "text-status-warning",
    error: "text-status-error",
    loading: "text-status-loading",
};

export type StatusBadgeProps = HTMLAttributes<HTMLSpanElement> &
    VariantProps<typeof statusBadgeTone> &
    VariantProps<typeof statusBadgeVariants> & {
        /** 徽章文本；状态语义由文本承担（无文本时组件退化为纯圆点/色块） */
        label?: ReactNode;
    };

export function StatusBadge({ tone, variant = "outline", size, label, className, children, ...props }: StatusBadgeProps) {
    const resolvedTone = tone ?? "neutral";
    return (
        <span
            data-slot="status-badge"
            className={cn(statusBadgeVariants({ variant, size }), variant === "filled" && filledTintClass[resolvedTone], className)}
            {...props}
        >
            {variant === "outline" ? (
                <span aria-hidden className={cn(statusBadgeTone({ tone }), "size-1.5", tone === "loading" && "motion-safe:animate-pulse")} />
            ) : null}
            {label != null ? (
                <span className={cn("text-muted-foreground", variant === "filled" && filledInkClass[resolvedTone])}>{label}</span>
            ) : null}
            {children}
        </span>
    );
}
