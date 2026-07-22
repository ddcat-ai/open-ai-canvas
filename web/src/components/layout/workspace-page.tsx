import { Button, Pagination } from "antd";
import { RotateCcw } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function WorkspacePage({ children, className, grid = false }: { children: ReactNode; className?: string; grid?: boolean }) {
    return (
        <main className={cn("app-user-content thin-scrollbar h-full overflow-y-auto text-foreground", grid && "app-workspace-grid", className)}>
            <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">{children}</div>
        </main>
    );
}

export function PageHeader({ title, description, meta, actions }: { title: string; description?: string; meta?: ReactNode; actions?: ReactNode }) {
    return (
        <header className="app-page-header flex flex-col gap-4 pb-6 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                    <h1 className="truncate text-2xl font-semibold leading-8">{title}</h1>
                    {meta}
                </div>
                {description ? <p className="mt-1.5 text-sm leading-5 text-foreground/62">{description}</p> : null}
            </div>
            {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
    );
}

export function ListToolbar({ children, trailing, active, onReset }: { children: ReactNode; trailing?: ReactNode; active?: boolean; onReset?: () => void }) {
    return (
        <div className="mt-4 flex flex-col gap-3 border-b border-border pb-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
                {active && onReset ? <Button icon={<RotateCcw className="size-3.5" />} onClick={onReset}>重置筛选</Button> : null}
                {trailing}
            </div>
        </div>
    );
}

export function TableSurface({ children, className }: { children: ReactNode; className?: string }) {
    return <div className={cn("app-table-surface mt-4 min-w-0 overflow-hidden rounded-lg border border-border bg-background", className)}>{children}</div>;
}

export function CollectionGrid({ children, className }: { children: ReactNode; className?: string }) {
    return <div className={cn("mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(220px,1fr))]", className)}>{children}</div>;
}

export function PaginationBar({ current, pageSize, total, onChange, pageSizeOptions = [20, 50, 100] }: { current: number; pageSize: number; total: number; onChange: (page: number, pageSize: number) => void; pageSizeOptions?: number[] }) {
    if (total <= pageSize && current === 1) return null;
    return (
        <div className="app-pagination-bar sticky bottom-0 z-10 flex min-w-0 justify-end border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
            <Pagination
                current={current}
                pageSize={pageSize}
                total={total}
                showSizeChanger
                responsive
                pageSizeOptions={pageSizeOptions.map(String)}
                showTotal={(value, range) => `${range[0]}-${range[1]} / 共 ${value} 条`}
                onChange={onChange}
            />
        </div>
    );
}
