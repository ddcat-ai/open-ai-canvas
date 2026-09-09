import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface SettingsRowProps {
    label: string;
    description?: string;
    control?: ReactNode;
    align?: "center" | "top";
    className?: string;
    controlClassName?: string;
}

/**
 * SettingsRow —— 设置项行（左侧标签/说明 + 右侧控件）。
 *
 * 用途：设置页与偏好面板内"一行一个设置项"的排版，替代 Form.Item 的纵向大块布局。
 *   行间以细分隔线区分，信息密度高、便于扫读；最后一行自动去掉分隔线。
 * token：分隔线 border-foreground/10，标签 text-foreground，说明 text-foreground/55。
 */
export function SettingsRow({ label, description, control, align = "center", className, controlClassName }: SettingsRowProps) {
    return (
        <div className={cn("flex w-full items-center gap-4 border-b border-foreground/10 py-2.5 last:border-b-0", align === "top" && "items-start", className)}>
            <div className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">{label}</span>
                {description ? <span className="mt-0.5 block text-xs leading-4 text-foreground/55">{description}</span> : null}
            </div>
            {control ? <div className={cn("shrink-0", controlClassName)}>{control}</div> : null}
        </div>
    );
}
