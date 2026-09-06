import type { HTMLAttributes, ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle, type LucideIcon } from "lucide-react";

import { IconButton } from "@/components/ui/base/buttons";

import { cn } from "@/lib/utils";

/**
 * Callout — 语义提示横幅（图标 + 标题 + 正文 + 可选操作）。
 *
 * 用途：页面/面板内的轻量提示（信息/成功/告警/错误），可带操作按钮；替代 AntD
 *   Alert 的静态展示场景与页面私有提示块。
 * token：底 bg-surface-secondary、边框 var(--workspace-border)/border-border、
 *   标题 text-foreground、正文 text-muted-foreground、tone 图标色
 *   text-status-{success|warning|error}（info/default 用 text-muted-foreground）。
 * 对标：AntD Alert；dbx ErrorBanner（错误横幅场景）；形态参考 shadcn alert。
 * 明暗：全部颜色走 token，明暗双主题自动适配。
 */
export type CalloutTone = "info" | "success" | "warning" | "error";

const calloutIconByTone: Record<CalloutTone, LucideIcon> = {
    info: Info,
    success: CheckCircle2,
    warning: AlertTriangle,
    error: XCircle,
};

export interface CalloutProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
    /** 语义 tone：default 等同 info（中性） */
    tone?: CalloutTone | "default";
    title?: ReactNode;
    /** 自定义图标组件引用；默认按 tone 取 Info/CheckCircle2/AlertTriangle/XCircle */
    icon?: LucideIcon;
    action?: ReactNode;
    /** 显示右上角关闭按钮（closable）；点击后由调用方移除自身 */
    onClose?: () => void;
    /** 关闭按钮的无障碍标签 */
    closeLabel?: string;
}

export function Callout({ tone = "default", title, icon, action, onClose, closeLabel = "关闭", className, children, ...props }: CalloutProps) {
    const resolved = tone === "default" ? "info" : tone;
    const Icon = icon ?? calloutIconByTone[resolved];
    return (
        <div
            data-slot="callout"
            data-tone={resolved}
            className={cn(
                "flex items-start gap-2.5 rounded-lg border border-border bg-surface-secondary px-3.5 py-2.5",
                className,
            )}
            {...props}
        >
            <Icon
                aria-hidden
                strokeWidth={1.75}
                className={cn(
                    "mt-px size-4 shrink-0",
                    resolved === "success" && "text-status-success",
                    resolved === "warning" && "text-status-warning",
                    resolved === "error" && "text-status-error",
                    resolved === "info" && "text-muted-foreground",
                )}
            />
            <div className="min-w-0 flex-1">
                {title != null ? <p className="text-caption font-medium text-foreground">{title}</p> : null}
                {children != null ? (
                    <div className={cn("text-caption leading-relaxed text-muted-foreground", title != null && "mt-0.5")}>
                        {children}
                    </div>
                ) : null}
            </div>
            {action != null || onClose != null ? (
                <div className="flex shrink-0 items-start gap-1">
                    {action != null ? <div className="shrink-0">{action}</div> : null}
                    {onClose != null ? <IconButton variant="ghost" size="sm" icon={X} aria-label={closeLabel} onClick={onClose} /> : null}
                </div>
            ) : null}
        </div>
    );
}
