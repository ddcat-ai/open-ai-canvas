import type { ReactNode } from "react";
import { Tooltip as RACTooltip, TooltipTrigger, type Placement } from "react-aria-components";

import { cn } from "@/lib/utils";

/**
 * Tooltip — 气泡提示（自研，react-aria-components overlay）。
 *
 * - API 对齐 AntD Tooltip（title/placement/children），title 为空时不渲染浮层。
 * - 浮层定位、进出场、焦点管理由 RAC 承担（ADR-0008：复杂浮层以 RAC 为无障碍地基）。
 * - 样式只吃语义 token：bg-surface-strong（light #fff / dark #2a2a2a）+ text-foreground +
 *   border-border hairline，无裸色；motion 走 RAC 动画类 + motion-reduce 关停。
 * - trigger 包一层 inline-flex span：保证 RAC ref 定位可用（children 可为任意组件）。
 * - placement 映射 AntD → RAC（topLeft→top left …）。
 * 对标：AntD Tooltip；boardui base/tooltip。
 */

export type TooltipPlacement = "top" | "topLeft" | "topRight" | "bottom" | "bottomLeft" | "bottomRight" | "left" | "right";

const PLACEMENT_MAP: Record<TooltipPlacement, Placement> = {
    top: "top",
    topLeft: "top left",
    topRight: "top right",
    bottom: "bottom",
    bottomLeft: "bottom left",
    bottomRight: "bottom right",
    left: "left",
    right: "right",
};

export interface TooltipProps {
    title?: ReactNode;
    placement?: TooltipPlacement;
    /** 悬停延迟 ms（默认 350，贴近 AntD mouseEnterDelay） */
    delay?: number;
    className?: string;
    children: ReactNode;
}

export function Tooltip({ title, placement = "top", delay = 350, className, children }: TooltipProps) {
    if (!title) return <>{children}</>;

    return (
        <TooltipTrigger delay={delay}>
            <span className="inline-flex">{children}</span>
            <RACTooltip
                placement={PLACEMENT_MAP[placement]}
                offset={6}
                className={cn(
                    "z-50 max-w-64 rounded-md border border-border bg-surface-strong px-2 py-1 text-xs leading-relaxed text-foreground shadow-md",
                    "ra-pop-in",
                    className,
                )}
            >
                {title}
            </RACTooltip>
        </TooltipTrigger>
    );
}
