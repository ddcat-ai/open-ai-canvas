import { Button, Select } from "antd";
import { ChevronLeft, ChevronRight, ListFilter, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

export function WorkspacePage({ children, className, grid = false, fluid = false, scroll = true }: { children: ReactNode; className?: string; grid?: boolean; fluid?: boolean; scroll?: boolean }) {
    return (
        <main className={cn("app-user-content h-full text-foreground", scroll && "app-workspace-scroll overflow-y-auto", grid && "app-workspace-grid", className)}>
            <div className={fluid ? "h-full w-full" : "w-full px-3 py-3 sm:px-4 sm:py-4 xl:px-5"}>{children}</div>
        </main>
    );
}

export function PageHeader({ title, description, meta, actions }: { title: string; description?: string; meta?: ReactNode; actions?: ReactNode }) {
    return (
        <header className="app-page-header flex min-h-14 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
                <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                        <h1 className="app-page-header-title truncate font-semibold leading-7">{title}</h1>
                        {meta}
                    </div>
                    {description ? <p className="mt-1 text-xs leading-5 text-foreground/58">{description}</p> : null}
                </div>
            </div>
            {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
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
        <div className={cn("admin-list-toolbar mt-3 flex min-h-12 flex-col gap-2 pb-3 lg:flex-row lg:items-center lg:justify-between", className)}>
            <div className="admin-list-toolbar-main flex min-w-0 flex-1 flex-wrap items-center gap-2.5">
                {children}
                {filters ? (
                    <>
                        {!filtersAlwaysVisible ? (
                            <Button type="default" className="admin-filter-toggle" aria-expanded={filtersOpen} icon={<ListFilter className="size-3.5" />} onClick={() => setFiltersOpen((open) => !open)}>
                                筛选{active ? <span className="admin-filter-active-dot" aria-label="有已应用筛选" /> : null}
                            </Button>
                        ) : null}
                        <div className={cn("admin-list-toolbar-filters flex flex-wrap items-center gap-2", (filtersAlwaysVisible || filtersOpen) && "is-open")}>{filters}</div>
                    </>
                ) : null}
                {activeFilters ? <div className="admin-list-toolbar-chips">{activeFilters}</div> : null}
            </div>
            <div className="admin-list-toolbar-actions flex shrink-0 flex-wrap items-center gap-2">
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

export function TableSurface({ children, className }: { children: ReactNode; className?: string }) {
    return <div className={cn("app-table-surface mt-4 min-w-0 overflow-hidden rounded-lg bg-surface", className)}>{children}</div>;
}

export function CollectionGrid({ children, className }: { children: ReactNode; className?: string }) {
    return <div className={cn("mt-4 grid grid-cols-1 gap-4 sm:grid-cols-[repeat(auto-fill,minmax(248px,1fr))]", className)}>{children}</div>;
}

/* 自研轻量分页：页码胶囊 + 省略号 + 每页条数 + 总数，替代 AntD Pagination（无 AntD 残留样式，与工具栏容器同语言）。 */
function pageItems(current: number, pages: number): (number | "…")[] {
    if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
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
        <div className="app-pagination-bar admin-pagination-bar mt-4 flex min-h-10 min-w-0 items-center justify-end gap-2 px-2 py-1.5">
            <span className="admin-pagination-total">{total === 0 ? `共 0 ${itemLabel}` : `${start}-${end} / 共 ${total} ${itemLabel}`}</span>
            <Select size="small" value={pageSize} className="app-pagination-size" options={pageSizeOptions.map((size) => ({ value: size, label: `${size} ${itemLabel}/页` }))} onChange={(value) => onChange(1, Number(value))} />
            <div className="app-pagination-pages" role="navigation" aria-label="分页">
                <button type="button" className="app-pagination-btn app-pagination-prev" disabled={current <= 1} aria-label="上一页" onClick={() => onChange(current - 1, pageSize)}>
                    <ChevronLeft className="size-4" />
                </button>
                {items.map((item) =>
                    item === "…" ? (
                        <span key={`ellipsis-${items.indexOf(item)}`} className="app-pagination-ellipsis">
                            …
                        </span>
                    ) : (
                        <button key={item} type="button" className={`app-pagination-btn${item === current ? " is-active" : ""}`} aria-current={item === current ? "page" : undefined} onClick={() => onChange(item, pageSize)}>
                            {item}
                        </button>
                    ),
                )}
                <button type="button" className="app-pagination-btn app-pagination-next" disabled={current >= pages} aria-label="下一页" onClick={() => onChange(current + 1, pageSize)}>
                    <ChevronRight className="size-4" />
                </button>
            </div>
        </div>
    );
}
