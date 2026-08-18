import { Button, Pagination } from "antd";
import { ListFilter, RotateCcw } from "lucide-react";
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

export function ListToolbar({ children, filters, activeFilters, trailing, active, onReset, className }: { children: ReactNode; filters?: ReactNode; activeFilters?: ReactNode; trailing?: ReactNode; active?: boolean; onReset?: () => void; className?: string }) {
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
                        <Button type="default" className="admin-filter-toggle" aria-expanded={filtersOpen} icon={<ListFilter className="size-3.5" />} onClick={() => setFiltersOpen((open) => !open)}>
                            筛选{active ? <span className="admin-filter-active-dot" aria-label="有已应用筛选" /> : null}
                        </Button>
                        <div className={cn("admin-list-toolbar-filters flex flex-wrap items-center gap-2", filtersOpen && "is-open")}>{filters}</div>
                    </>
                ) : null}
                {activeFilters ? <div className="admin-list-toolbar-chips">{activeFilters}</div> : null}
            </div>
            <div className="admin-list-toolbar-actions flex shrink-0 flex-wrap items-center gap-2">
                {active && onReset ? <Button type="text" icon={<RotateCcw className="size-3.5" />} onClick={onReset}>重置</Button> : null}
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

export function PaginationBar({ current, pageSize, total, onChange, pageSizeOptions = [20, 50, 100], alwaysShow = false }: { current: number; pageSize: number; total: number; onChange: (page: number, pageSize: number) => void; pageSizeOptions?: number[]; alwaysShow?: boolean }) {
    if (!alwaysShow && total <= pageSize && current === 1) return null;
    const start = total === 0 ? 0 : (current - 1) * pageSize + 1;
    const end = total === 0 ? 0 : Math.min(current * pageSize, total);
    return (
        <div className="app-pagination-bar admin-pagination-bar min-w-0">
            <span className="admin-pagination-total">{total === 0 ? "共 0 条" : `${start}-${end} / 共 ${total} 条`}</span>
            <Pagination
                size="small"
                current={current}
                pageSize={pageSize}
                total={total}
                showSizeChanger={pageSizeOptions.length > 1}
                responsive
                showLessItems
                pageSizeOptions={pageSizeOptions.map(String)}
                onChange={onChange}
            />
        </div>
    );
}
