import { App, Button, Dropdown, Tag } from "antd";
import type { MenuProps } from "antd";
import { CheckSquare2, MoreHorizontal, SearchX, X } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export const configuredSecretText = "已配置 · 留空不改";

function isStatusConfig(value: ReactNode | { label: string; color?: string }): value is { label: string; color?: string } {
    if (!value || typeof value !== "object") return false;
    return typeof (value as { label?: unknown }).label === "string";
}

export function AdminPageHeader({
    title,
    description,
    actions,
}: {
    title: string;
    description?: string;
    actions?: ReactNode;
}) {
    return (
        <header className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-b border-border bg-background px-4 sm:px-6">
            <div className="min-w-0">
                <h1 className="truncate text-lg font-semibold">{title}</h1>
                {description ? <p className="mt-0.5 truncate text-xs text-foreground/55">{description}</p> : null}
            </div>
            {actions ? <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div> : null}
        </header>
    );
}

export function AdminTableEmpty({
    filtered = false,
    title,
    description,
    action,
}: {
    filtered?: boolean;
    title?: string;
    description?: string;
    action?: ReactNode;
}) {
    return (
        <div className="flex min-h-64 flex-col items-center justify-center px-6 py-12 text-center">
            <span className="grid size-11 place-items-center rounded-lg border border-border bg-muted/35 text-foreground/45">
                <SearchX className="size-5" />
            </span>
            <div className="mt-3 text-sm font-medium">{title || (filtered ? "没有符合筛选条件的数据" : "暂无数据")}</div>
            <p className="mt-1 max-w-sm text-xs leading-5 text-foreground/50">
                {description || (filtered ? "调整搜索词或筛选条件后再试。" : "数据产生后会显示在这里。")}
            </p>
            {action ? <div className="mt-4">{action}</div> : null}
        </div>
    );
}

export function AdminTableSkeleton({ rows = 8, columns = 6 }: { rows?: number; columns?: number }) {
    return (
        <div className="animate-pulse motion-reduce:animate-none" aria-label="正在加载表格" role="status">
            <div className="grid h-11 items-center gap-4 border-b border-border bg-muted/30 px-4" style={{ gridTemplateColumns: `repeat(${columns}, minmax(72px, 1fr))` }}>
                {Array.from({ length: columns }).map((_, index) => <span key={index} className="h-3 w-16 max-w-full rounded bg-foreground/10" />)}
            </div>
            {Array.from({ length: Math.max(8, rows) }).map((_, rowIndex) => (
                <div key={rowIndex} className="grid min-h-14 items-center gap-4 border-b border-border/70 px-4 last:border-b-0" style={{ gridTemplateColumns: `repeat(${columns}, minmax(72px, 1fr))` }}>
                    {Array.from({ length: columns }).map((_, columnIndex) => (
                        <span key={columnIndex} className={cn("h-3 rounded bg-foreground/[0.07]", columnIndex === 0 ? "w-4/5" : columnIndex === columns - 1 ? "w-10" : "w-2/3")} />
                    ))}
                </div>
            ))}
        </div>
    );
}

export function AdminBatchBar({ count, onClear, children }: { count: number; onClear: () => void; children: ReactNode }) {
    if (count <= 0) return null;
    return (
        <div className="sticky top-0 z-20 mt-3 flex min-h-11 flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-background/95 px-3 py-2 shadow-sm backdrop-blur">
            <div className="flex items-center gap-2 text-sm font-medium"><CheckSquare2 className="size-4 text-foreground/60" />已选择 {count} 项</div>
            <div className="flex flex-wrap items-center gap-2">{children}<Button type="text" size="small" icon={<X className="size-3.5" />} onClick={onClear}>取消选择</Button></div>
        </div>
    );
}

export type AdminRowAction = {
    key: string;
    label: ReactNode;
    icon?: ReactNode;
    danger?: boolean;
    disabled?: boolean;
    onClick: () => void | Promise<void>;
    confirm?: {
        title: string;
        description: string;
        okText: string;
    };
};

export function AdminRowActions({
    primary,
    actions,
}: {
    primary?: { label: ReactNode; icon?: ReactNode; onClick: () => void; disabled?: boolean };
    actions: AdminRowAction[];
}) {
    const { modal } = App.useApp();
    const items: MenuProps["items"] = actions.map((action) => ({
        key: action.key,
        label: action.label,
        icon: action.icon,
        danger: action.danger,
        disabled: action.disabled,
    }));

    const runAction = (action: AdminRowAction) => {
        if (!action.confirm) {
            void action.onClick();
            return;
        }
        modal.confirm({
            title: action.confirm.title,
            content: action.confirm.description,
            okText: action.confirm.okText,
            cancelText: "取消",
            okButtonProps: { danger: action.danger },
            onOk: action.onClick,
        });
    };

    return (
        <div className="flex items-center justify-end gap-1.5">
            {primary ? (
                <Button size="small" icon={primary.icon} disabled={primary.disabled} onClick={primary.onClick}>
                    {primary.label}
                </Button>
            ) : null}
            {actions.length ? (
                <Dropdown
                    trigger={["click"]}
                    menu={{
                        items,
                        onClick: ({ key }) => {
                            const action = actions.find((item) => item.key === key);
                            if (action) runAction(action);
                        },
                    }}
                >
                    <Button size="small" type="text" icon={<MoreHorizontal className="size-4" />} aria-label="更多操作" />
                </Dropdown>
            ) : null}
        </div>
    );
}

export function SettingsSectionCard({
    icon,
    title,
    description,
    status,
    children,
    footer,
    className,
}: {
    icon?: ReactNode;
    title: string;
    description: string;
    status?: { label: string; color?: string } | ReactNode;
    children: ReactNode;
    footer?: ReactNode;
    className?: string;
}) {
    return (
        <section className={cn("overflow-hidden rounded-lg border border-border bg-background", className)}>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
                <div className="flex min-w-0 items-start gap-3">
                    {icon ? <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted/40">{icon}</span> : null}
                    <div className="min-w-0">
                        <h2 className="text-base font-semibold">{title}</h2>
                        <p className="mt-1 text-xs leading-5 text-foreground/55">{description}</p>
                    </div>
                </div>
                {isStatusConfig(status) ? <Tag bordered={false} color={status.color}>{status.label}</Tag> : status}
            </div>
            {children}
            {footer ? <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4">{footer}</div> : null}
        </section>
    );
}
