import { App, Button, Dropdown, Select, Table } from "antd";
import type { ButtonProps, MenuProps, TableProps } from "antd";
import { saveAs } from "file-saver";
import { CheckSquare2, ChevronDown, ChevronLeft, ChevronRight, Download, ListFilter, RotateCcw, SearchX, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export const configuredSecretText = "已配置 · 留空不改";

export type AdminStatusTone = "neutral" | "success" | "warning" | "error" | "info";

export function AdminStatusBadge({ label, tone = "neutral", title }: { label: string; tone?: AdminStatusTone; title?: string; variant?: string }) {
    return (
        <span className={cn("admin-status-badge", tone !== "neutral" && `is-${tone}`)} title={title}>
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
                    {trend && detail ? <span className="mx-1.5">·</span> : null}
                    {detail ? <span>{detail}</span> : null}
                </div>
            ) : null}
        </div>
    );
}

export function ListToolbar({
    children,
    filters,
    filtersAlwaysVisible = false,
    activeFilters,
    trailing,
    active,
    onReset,
    className,
}: {
    children: ReactNode;
    filters?: ReactNode;
    filtersAlwaysVisible?: boolean;
    activeFilters?: ReactNode;
    trailing?: ReactNode;
    active?: boolean;
    onReset?: () => void;
    className?: string;
}) {
    const [filtersOpen, setFiltersOpen] = useState(false);

    useEffect(() => {
        if (active) setFiltersOpen(true);
    }, [active]);

    return (
        <div className={cn("admin-list-toolbar", className)}>
            <div className="admin-list-toolbar-main">
                {children}
                {filters ? (
                    <>
                        {!filtersAlwaysVisible ? (
                            <Button type="default" className="admin-filter-toggle" aria-expanded={filtersOpen} icon={<ListFilter className="size-3.5" />} onClick={() => setFiltersOpen((open) => !open)}>
                                筛选{active ? <span className="admin-filter-active-dot" aria-label="有已应用筛选" /> : null}
                            </Button>
                        ) : null}
                        <div className={cn("admin-list-toolbar-filters", (filtersAlwaysVisible || filtersOpen) && "is-open")}>{filters}</div>
                    </>
                ) : null}
                {activeFilters ? <div className="admin-list-toolbar-chips">{activeFilters}</div> : null}
            </div>
            <div className="admin-list-toolbar-actions">
                {active && onReset ? (
                    <Button type="text" icon={<RotateCcw className="size-3.5" />} onClick={onReset}>
                        重置
                    </Button>
                ) : null}
                {trailing}
            </div>
        </div>
    );
}

function pageItems(current: number, pages: number): Array<number | "…"> {
    if (pages <= 7) return Array.from({ length: pages }, (_, index) => index + 1);
    if (current <= 4) return [1, 2, 3, 4, 5, "…", pages];
    if (current >= pages - 3) return [1, "…", pages - 4, pages - 3, pages - 2, pages - 1, pages];
    return [1, "…", current - 1, current, current + 1, "…", pages];
}

export function PaginationBar({
    current,
    pageSize,
    total,
    onChange,
    pageSizeOptions = [20, 50, 100],
    alwaysShow = false,
    itemLabel = "条",
}: {
    current: number;
    pageSize: number;
    total: number;
    onChange: (page: number, pageSize: number) => void;
    pageSizeOptions?: number[];
    alwaysShow?: boolean;
    itemLabel?: string;
}) {
    if (!alwaysShow && total <= pageSize && current === 1) return null;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const start = total === 0 ? 0 : (current - 1) * pageSize + 1;
    const end = total === 0 ? 0 : Math.min(total, current * pageSize);
    const items = pageItems(current, pages);
    return (
        <div className="admin-pagination-bar">
            <span className="admin-pagination-total">{total === 0 ? `共 0 ${itemLabel}` : `${start}-${end} / 共 ${total} ${itemLabel}`}</span>
            <Select size="small" value={pageSize} className="admin-pagination-size" options={pageSizeOptions.map((size) => ({ value: size, label: `${size} ${itemLabel}/页` }))} onChange={(value) => onChange(1, Number(value))} aria-label="每页条数" />
            <div className="admin-pagination-pages" role="navigation" aria-label="分页">
                <button type="button" className="admin-pagination-btn" disabled={current <= 1} aria-label="上一页" onClick={() => onChange(current - 1, pageSize)}>
                    <ChevronLeft className="size-4" />
                </button>
                {items.map((item, index) =>
                    item === "…" ? (
                        <span key={`ellipsis-${index}`} className="admin-pagination-ellipsis">
                            …
                        </span>
                    ) : (
                        <button key={item} type="button" className={cn("admin-pagination-btn", item === current && "is-active")} aria-current={item === current ? "page" : undefined} onClick={() => onChange(item, pageSize)}>
                            {item}
                        </button>
                    ),
                )}
                <button type="button" className="admin-pagination-btn" disabled={current >= pages} aria-label="下一页" onClick={() => onChange(current + 1, pageSize)}>
                    <ChevronRight className="size-4" />
                </button>
            </div>
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
        <div className="admin-empty">
            <SearchX className="size-5" aria-hidden="true" />
            <h3>{title || (filtered ? "没有符合筛选条件的数据" : "暂无数据")}</h3>
            {description ? <p>{description}</p> : null}
            {action}
        </div>
    );
}

export function AdminEmpty({ title, description, action }: { title?: string; description?: string; action?: ReactNode; size?: string; icon?: unknown }) {
    return <AdminTableEmpty title={title} description={description} action={action} />;
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
        <div aria-label="正在加载表格" role="status">
            <div className="grid h-9 items-center gap-4 border-b px-3" style={{ borderColor: "var(--admin-border)", gridTemplateColumns: `repeat(${columns}, minmax(72px, 1fr))` }}>
                {Array.from({ length: columns }).map((_, index) => (
                    <span key={index} className="h-2.5 w-16 max-w-full rounded" style={{ background: "color-mix(in srgb, var(--admin-text) 10%, transparent)" }} />
                ))}
            </div>
            {Array.from({ length: Math.max(8, rows) }).map((_, rowIndex) => (
                <div key={rowIndex} className="grid h-10 items-center gap-4 border-b px-3 last:border-b-0" style={{ borderColor: "var(--admin-row-border)", gridTemplateColumns: `repeat(${columns}, minmax(72px, 1fr))` }}>
                    {Array.from({ length: columns }).map((_, columnIndex) => (
                        <span key={columnIndex} className="h-2.5 rounded" style={{ width: columnIndex === 0 ? "80%" : columnIndex === columns - 1 ? "40px" : "66%", background: "color-mix(in srgb, var(--admin-text) 7%, transparent)" }} />
                    ))}
                </div>
            ))}
        </div>
    );
}

export function AdminBatchBar({ count, onClear, children }: { count: number; onClear: () => void; children: ReactNode }) {
    if (count <= 0) return null;
    return (
        <div className="admin-batch-bar sticky top-0 z-20 flex min-h-11 flex-wrap items-center justify-between gap-3 px-3 py-2">
            <div className="flex items-center gap-2 text-sm font-medium">
                <CheckSquare2 className="size-4" />
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
            <div className={cn("admin-settings-section-summary", icon && "has-icon")}>
                <div className="admin-settings-section-summary-main flex min-w-0 items-center gap-3">
                    {icon ? <span className="admin-feature-domain-icon">{icon}</span> : null}
                    <div className="min-w-0">
                        <h2>{title}</h2>
                        {description ? <p>{description}</p> : null}
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
                {footer ? <div className="admin-settings-section-footer flex flex-wrap items-center justify-between gap-3 px-3 py-3">{footer}</div> : null}
            </div>
        </section>
    );
}
