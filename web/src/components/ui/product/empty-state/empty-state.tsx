import type { HTMLAttributes, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Inbox, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * EmptyState — 空态占位（图标 + 标题 + 说明 + 可选操作）。
 *
 * 用途：列表/面板/画布无数据或零结果时的引导占位；替代 AntD Empty 的使用场景
 *   （搜索零结果、资源为空、列表为空等页面私有实现）。
 * token：图标圈底 bg-secondary 半透明、图标色 text-muted-foreground、标题
 *   text-foreground、说明 text-muted-foreground、字号 fs-body/fs-caption；间距走 --space-*。
 * 图标契约：`icon` 传 lucide 组件引用（默认 Inbox），尺寸/颜色由本组件用 token 决定，
 *   禁止调用方传 icon className 改尺寸。
 * 对标：AntD Empty；形态参考 BoardUI empty-state。
 * 明暗：全部颜色走 token，明暗双主题自动适配。
 */
export const emptyStateVariants = cva("flex flex-col items-center justify-center text-center", {
    variants: {
        size: {
            default: "gap-2.5 py-12",
            compact: "gap-1.5 py-6",
        },
    },
    defaultVariants: {
        size: "default",
    },
});

export type EmptyStateProps = HTMLAttributes<HTMLDivElement> &
    VariantProps<typeof emptyStateVariants> & {
        /** lucide 图标组件引用；默认 Inbox */
        icon?: LucideIcon;
        title?: ReactNode;
        description?: ReactNode;
        /** 操作区（按钮/链接等），非必须 */
        action?: ReactNode;
    };

export function EmptyState({ size, icon: Icon = Inbox, title, description, action, className, ...props }: EmptyStateProps) {
    return (
        <div data-slot="empty-state" className={cn(emptyStateVariants({ size }), className)} {...props}>
            <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-secondary/60">
                <Icon aria-hidden className="size-5 text-muted-foreground" strokeWidth={1.75} />
            </div>
            {title != null ? <p className="text-body font-medium text-foreground">{title}</p> : null}
            {description != null ? <p className="max-w-sm text-caption text-muted-foreground">{description}</p> : null}
            {action != null ? <div className="mt-1">{action}</div> : null}
        </div>
    );
}
