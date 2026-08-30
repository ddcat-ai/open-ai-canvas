import { App, Button, Dropdown, Table } from "antd";
import type { ButtonProps, MenuProps, TableProps } from "antd";
import { saveAs } from "file-saver";
import { CheckSquare2, ChevronDown, Download, SearchX, X } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import { ListToolbar } from "@/components/layout/workspace-page";
import { cn } from "@/lib/utils";

export const configuredSecretText = "已配置 · 留空不改";

export type AdminStatusTone = "neutral" | "success" | "warning" | "error" | "info";

export function AdminStatusBadge({ label, tone = "neutral", title }: { label: string; tone?: AdminStatusTone; title?: string }) {
    return (
        <span className="admin-status-badge" data-tone={tone} title={title}>
            {label}
        </span>
    );
}

export function AdminStatTile({ label, value, detail, trend }: { label: string; value: string | number; detail?: string; trend?: { value: string; tone?: AdminStatusTone } }) {
    return (
        <div className="admin-stat-tile">
            <div className="admin-stat-tile-label">{label}</div>
            <div className="admin-stat-tile-value">{value}</div>
            {trend || detail ? (
                <div className="admin-stat-tile-detail">
                    {trend ? <AdminStatusBadge label={trend.value} tone={trend.tone || "neutral"} /> : null}
                    {trend && detail ? <span className="mx-1.5 text-foreground/25">·</span> : null}
                    {detail ? <span>{detail}</span> : null}
                </div>
            ) : null}
        </div>
    );
}

export function AdminDataTable<RecordType extends object>({
    toolbar,
    toolbarActive,
    toolbarFilters,
    toolbarFiltersAlwaysVisible = true,
    toolbarActiveFilters,
    onReset,
    trailing,
    batchActions,
    footer,
    table,
    empty,
    skeletonColumns = 6,
    skeletonRows = 8,
    className,
}: {
    toolbar?: ReactNode;
    toolbarActive?: boolean;
    toolbarFilters?: ReactNode;
    toolbarFiltersAlwaysVisible?: boolean;
    toolbarActiveFilters?: ReactNode;
    onReset?: () => void;
    trailing?: ReactNode;
    batchActions?: ReactNode;
    footer?: ReactNode;
    table: TableProps<RecordType>;
    empty?: ReactNode;
    skeletonColumns?: number;
    skeletonRows?: number;
    className?: string;
}) {
    const dataSource = table.dataSource as readonly RecordType[] | undefined;
    const showSkeleton = Boolean(table.loading) && !dataSource?.length;

    return (
        <div className="admin-data-table">
            {toolbar ? (
                <ListToolbar active={toolbarActive} filters={toolbarFilters} filtersAlwaysVisible={toolbarFiltersAlwaysVisible} activeFilters={toolbarActiveFilters} onReset={onReset} trailing={trailing}>
                    {toolbar}
                </ListToolbar>
            ) : null}
            {batchActions}
            <div className={cn("admin-table-frame", footer && "has-pagination")}>
                <div className={cn("admin-table-surface", className)}>
                    <div className="admin-table-scroll">{showSkeleton ? <AdminTableSkeleton rows={skeletonRows} columns={skeletonColumns} /> : <Table {...table} locale={{ ...table.locale, emptyText: empty ?? table.locale?.emptyText }} />}</div>
                </div>
                {footer ? <div className="admin-table-pagination">{footer}</div> : null}
            </div>
        </div>
    );
}

function isStatusConfig(value: ReactNode | { label: string; color?: string }): value is { label: string; color?: string } {
    if (!value || typeof value !== "object") return false;
    return typeof (value as { label?: unknown }).label === "string";
}

export function AdminExportButton({
    exportFile,
    fileName,
    label = "导出",
    successMessage,
    errorMessage = "导出失败",
    size,
    ...buttonProps
}: Omit<ButtonProps, "children" | "icon" | "loading" | "onClick"> & {
    exportFile: () => Blob | Promise<Blob>;
    fileName: string | (() => string);
    label?: string;
    successMessage?: string;
    errorMessage?: string;
}) {
    const { message } = App.useApp();
    const [exporting, setExporting] = useState(false);

    const runExport = async () => {
        setExporting(true);
        try {
            const blob = await exportFile();
            saveAs(blob, typeof fileName === "function" ? fileName() : fileName);
            if (successMessage) message.success(successMessage);
        } catch (error) {
            message.error(error instanceof Error ? error.message : errorMessage);
        } finally {
            setExporting(false);
        }
    };

    return (
        <Button {...buttonProps} size={size} icon={<Download className={size === "small" ? "size-3.5" : "size-4"} />} loading={exporting} onClick={() => void runExport()}>
            {label}
        </Button>
    );
}

export function AdminTableEmpty({ filtered = false, title, description, action }: { filtered?: boolean; title?: string; description?: string; action?: ReactNode }) {
    return (
        <div className="flex min-h-40 flex-col items-center justify-center px-6 py-8 text-center">
            <span className="grid size-9 place-items-center rounded-md bg-muted/35 text-foreground/45">
                <SearchX className="size-4" />
            </span>
            <div className="mt-3 text-sm font-medium">{title || (filtered ? "没有符合筛选条件的数据" : "暂无数据")}</div>
            {description ? <p className="mt-1 max-w-sm text-xs leading-5 text-foreground/50">{description}</p> : null}
            {action ? <div className="mt-4">{action}</div> : null}
        </div>
    );
}

export function AdminFilterChip({ label, onRemove }: { label: ReactNode; onRemove: () => void }) {
    return (
        <button type="button" className="admin-filter-chip" onClick={onRemove}>
            <span>{label}</span>
            <X className="size-3" aria-hidden="true" />
            <span className="sr-only">移除筛选</span>
        </button>
    );
}

export function AdminTableSkeleton({ rows = 8, columns = 6 }: { rows?: number; columns?: number }) {
    return (
        <div className="animate-pulse motion-reduce:animate-none" aria-label="正在加载表格" role="status">
            <div className="grid h-11 items-center gap-4 border-b border-border bg-muted/30 px-4" style={{ gridTemplateColumns: `repeat(${columns}, minmax(72px, 1fr))` }}>
                {Array.from({ length: columns }).map((_, index) => (
                    <span key={index} className="h-3 w-16 max-w-full rounded bg-foreground/10" />
                ))}
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
        <div className="admin-batch-bar sticky top-0 z-20 mt-3 flex min-h-11 flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-background/95 px-3 py-2 shadow-sm backdrop-blur">
            <div className="flex items-center gap-2 text-sm font-medium">
                <CheckSquare2 className="size-4 text-foreground/60" />
                已选择 {count} 项
            </div>
            <div className="flex flex-wrap items-center gap-2">
                {children}
                <Button type="text" size="small" icon={<X className="size-3.5" />} onClick={onClear}>
                    取消选择
                </Button>
            </div>
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

export function AdminRowActions({ primary, actions, visibleActionCount }: { primary?: { label: ReactNode; icon?: ReactNode; onClick: () => void | Promise<void>; disabled?: boolean }; actions: AdminRowAction[]; visibleActionCount?: number }) {
    const { modal } = App.useApp();
    // 行内只保留一个最常用的次操作；低频或危险操作收进菜单，避免操作列堆成一排文字链接。
    const resolvedVisibleActionCount = visibleActionCount ?? (actions.length <= 1 ? actions.length : 1);
    const visibleActions = actions.slice(0, Math.max(0, resolvedVisibleActionCount));
    const menuActions = actions.slice(Math.max(0, resolvedVisibleActionCount));
    const items: MenuProps["items"] = menuActions.map((action) => ({
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

    const renderActionButton = (action: AdminRowAction) => (
        <Button key={action.key} type="text" size="small" className={cn("admin-row-action", action.danger && "admin-row-action-danger")} icon={action.icon} disabled={action.disabled} onClick={() => runAction(action)}>
            {action.label}
        </Button>
    );

    return (
        <div className="admin-row-actions">
            {primary ? (
                <Button type="text" size="small" className="admin-row-action admin-row-action-primary" icon={primary.icon} disabled={primary.disabled} onClick={primary.onClick}>
                    {primary.label}
                </Button>
            ) : null}
            {visibleActions.map(renderActionButton)}
            {menuActions.length ? (
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
                    <Button type="text" size="small" className="admin-row-action admin-row-action-more" aria-label="更多操作">
                        <span>更多</span>
                        <ChevronDown className="admin-row-action-chevron" aria-hidden="true" />
                    </Button>
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
    contentClassName,
    layout = "split",
}: {
    icon?: ReactNode;
    title: string;
    description?: string;
    status?: { label: string; color?: string } | ReactNode;
    children: ReactNode;
    footer?: ReactNode;
    className?: string;
    contentClassName?: string;
    layout?: "split" | "stacked";
}) {
    const isStacked = layout === "stacked";
    return (
        <section className={cn("admin-settings-section", isStacked && "is-stacked", className)}>
            <div className={cn("admin-settings-section-summary flex flex-wrap items-start justify-between gap-3 px-4 py-4", icon && "has-icon")}>
                <div className="admin-settings-section-summary-main flex min-w-0 items-start gap-3">
                    {icon ? <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted/40">{icon}</span> : null}
                    <div className="min-w-0">
                        <h2 className="text-sm font-semibold leading-5">{title}</h2>
                        {description ? <p className="mt-1 text-xs leading-5 text-foreground/55">{description}</p> : null}
                    </div>
                </div>
                {status ? (
                    <div className="admin-settings-section-status shrink-0">
                        {isStatusConfig(status) ? (
                            <AdminStatusBadge label={status.label} tone={status.color === "success" ? "success" : status.color === "warning" ? "warning" : status.color === "error" ? "error" : status.color === "blue" ? "info" : "neutral"} />
                        ) : (
                            status
                        )}
                    </div>
                ) : null}
            </div>
            <div className={cn("admin-settings-section-content min-w-0", contentClassName)}>
                {children}
                {footer ? <div className="admin-settings-section-footer flex flex-wrap items-center justify-between gap-3 px-4 py-3">{footer}</div> : null}
            </div>
        </section>
    );
}
