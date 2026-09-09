import type { ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * IconButton — 纯图标按钮（正方形、尺寸档位、语义变体、loading 态）。
 *
 * 用途：面板/工具条里的图标触发按钮（新建、删除、收起、关闭等）；替代 AntD
 *   Button `type="text"/"ghost" icon` 小尺寸场景与各页私有 icon-button。
 * token：底 bg-surface-hover（ghost 悬停）/bg-surface-active（active 按压）、
 *   图标 text-muted-foreground（danger 用 text-status-error）、焦点环 ring-ring；
 *   hover/active 态全用语义 token，无裸色。
 * 图标契约：`icon` 传 lucide 组件引用，尺寸按 `size` 档位由本组件决定；禁止调用方
 *   传 icon className 改尺寸。必须传 `aria-label`（纯图标无文本）。
 * 对标：dbx ui/button variants（ghost/outline/destructive、icon-xs/sm/lg）；
 *   AntD Button icon-only。
 * 明暗：全部颜色走 token；active 按压底用 bg-surface-active，明暗自动适配。
 */
export const iconButtonVariants = cva(
    ["inline-flex shrink-0 items-center justify-center rounded-md", "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", "disabled:pointer-events-none disabled:opacity-45", "motion-safe:active:scale-[0.96]"],
    {
        variants: {
            variant: {
                // 纯透明 + hover 浮底（最常用：面板/工具条）
                ghost: "text-muted-foreground hover:bg-surface-hover hover:text-foreground active:bg-surface-active",
                // 常驻浅底
                default: "bg-surface-secondary text-muted-foreground hover:bg-surface-hover hover:text-foreground active:bg-surface-active",
                // 描边
                outline: "border border-border bg-transparent text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                // 危险（文本色常驻红）
                danger: "text-status-error hover:bg-surface-hover active:bg-surface-active",
                // 实心（中性黑底白图标，主操作；active 反转成白底黑字 + 内描边，供选中态使用）
                solid: "bg-foreground text-background hover:opacity-85 active:opacity-75 data-[active=true]:bg-background data-[active=true]:text-foreground data-[active=true]:ring-1 data-[active=true]:ring-inset data-[active=true]:ring-border",
            },
            size: {
                xs: "size-6 [&_svg]:size-3.5",
                sm: "size-7 [&_svg]:size-4",
                default: "size-8 [&_svg]:size-4",
                lg: "size-9 [&_svg]:size-[18px]",
            },
        },
        defaultVariants: {
            variant: "ghost",
            size: "default",
        },
    },
);

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
    VariantProps<typeof iconButtonVariants> & {
        /** lucide 图标组件引用 */
        icon: LucideIcon;
        /** loading：替换为 spinner 并禁用 */
        loading?: boolean;
        /** data-active 语义高亮（如开关组内当前项），仅装饰，不改变 aria-pressed */
        active?: boolean;
    };

export function IconButton({ variant, size, icon: Icon, loading = false, active = false, className, type = "button", disabled, ...props }: IconButtonProps) {
    return (
        <button data-slot="icon-button" type={type} disabled={disabled || loading} aria-busy={loading || undefined} data-active={active || undefined} className={cn(iconButtonVariants({ variant, size }), className)} {...props}>
            {loading ? <Loader2 aria-hidden className="animate-spin" /> : <Icon aria-hidden />}
        </button>
    );
}
