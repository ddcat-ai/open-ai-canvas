import { Button, Pagination } from "antd";
import { RotateCcw } from "lucide-react";
import type { ReactNode } from "react";

import { WorkspaceSignalIcon, type WorkspaceSignalIconVariant } from "@/components/ui/aceternity/workspace-signal-icon";
import { cn } from "@/lib/utils";

export function WorkspacePage({ children, className, grid = false, fluid = false }: { children: ReactNode; className?: string; grid?: boolean; fluid?: boolean }) {
    return (
        <main className={cn("app-user-content thin-scrollbar h-full overflow-y-auto text-foreground", grid && "app-workspace-grid", className)}>
            <div className={fluid ? "h-full w-full" : "w-full px-3 py-3 sm:px-4 sm:py-4 xl:px-5"}>{children}</div>
        </main>
    );
}

export function PageHeader({ title, description, meta, actions, icon }: { title: string; description?: string; meta?: ReactNode; actions?: ReactNode; icon?: WorkspaceSignalIconVariant }) {
    return (
        <header className="app-page-header flex min-h-14 flex-col gap-3 border-b border-border/80 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
                {icon ? <WorkspaceSignalIcon variant={icon} /> : null}
                <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-baseline gap-2.5">
                        <h1 className="truncate text-[22px] font-semibold leading-7">{title}</h1>
                        {meta}
                    </div>
                    {description ? <p className="mt-1 text-xs leading-5 text-foreground/58">{description}</p> : null}
                </div>
            </div>
            {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
    );
}

export function ListToolbar({ children, trailing, active, onReset }: { children: ReactNode; trailing?: ReactNode; active?: boolean; onReset?: () => void }) {
    return (
        <div className="mt-3 flex min-h-12 flex-col gap-2 border-b border-border/75 pb-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2.5">{children}</div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
                {active && onReset ? <Button type="text" icon={<RotateCcw className="size-3.5" />} onClick={onReset}>重置</Button> : null}
                {trailing}
            </div>
        </div>
    );
}

export function TableSurface({ children, className }: { children: ReactNode; className?: string }) {
    return <div className={cn("app-table-surface mt-4 min-w-0 overflow-hidden rounded-lg border border-border bg-background", className)}>{children}</div>;
}

export function CollectionGrid({ children, className }: { children: ReactNode; className?: string }) {
    return <div className={cn("mt-4 grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-[repeat(auto-fill,minmax(248px,1fr))]", className)}>{children}</div>;
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
