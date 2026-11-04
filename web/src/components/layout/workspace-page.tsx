import { Button } from "antd";
import { ChevronLeft, ChevronRight, ListFilter, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { currentLocale } from "@/i18n";

import { cn } from "@/lib/utils";
import { Select } from "@/components/ui/base/select";

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
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
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
    const { t } = useTranslation();
    const [filtersOpen, setFiltersOpen] = useState(false);

    useEffect(() => {
        if (active) setFiltersOpen(true);
    }, [active]);

    return (
        <div className={cn("admin-list-toolbar mt-3 flex min-h-12 flex-col gap-2 pb-3 lg:flex-row lg:items-center lg:justify-between", className)}>
            <div className="admin-list-toolbar-main flex min-w-0 flex-1 flex-wrap items-center gap-2">
                {children}
                {filters ? (
                    <>
                        {!filtersAlwaysVisible ? (
                            <Button type="default" className="admin-filter-toggle" aria-expanded={filtersOpen} icon={<ListFilter className="size-3.5" />} onClick={() => setFiltersOpen((open) => !open)}>
                                {t("account.layout.list.filter")}{active ? <span className="admin-filter-active-dot" aria-label={t("account.layout.list.filterActive")} /> : null}
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
                        {t("account.layout.list.reset")}
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

export function CollectionGrid({ children, className, style }: { children: ReactNode; className?: string; style?: React.CSSProperties }) {
    return <div className={cn("mt-4 grid grid-cols-1 gap-4 sm:grid-cols-[repeat(auto-fill,minmax(248px,1fr))]", className)} style={style}>{children}</div>;
}

/* 自研轻量分页：总数 + 胶囊页码组 + 跳页 + 每页条数。用户端和后台共用，外观集中在 globals.css 的 app-pagination-*。 */
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
    itemLabel,
    className,
}: {
    current: number;
    pageSize: number;
    total: number;
    onChange: (page: number, pageSize: number) => void;
    pageSizeOptions?: number[];
    alwaysShow?: boolean;
    itemLabel?: string;
    className?: string;
}) {
    const { t } = useTranslation();
    const [jump, setJump] = useState("");
    const item = itemLabel ?? t("account.layout.pagination.item");
    if (!alwaysShow && total <= pageSize && current === 1) return null;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const start = total === 0 ? 0 : (current - 1) * pageSize + 1;
    const end = total === 0 ? 0 : Math.min(total, current * pageSize);
    const items = pageItems(current, pages);
    const go = (page: number) => onChange(Math.min(pages, Math.max(1, page)), pageSize);
    const submitJump = () => {
        const page = Number.parseInt(jump, 10);
        setJump("");
        if (Number.isFinite(page) && page !== current) go(page);
    };
    return (
        <nav className={cn("app-pagination-bar", className)} aria-label={t("account.layout.pagination.label")}>
            <span className="app-pagination-total">
                {total === 0 ? <Trans i18nKey="account.layout.pagination.totalEmpty" values={{ item }} components={{ b: <b /> }} /> : <Trans i18nKey="account.layout.pagination.totalRange" values={{ start, end, total: total.toLocaleString(currentLocale()), item }} components={{ b: <b /> }} />}
            </span>
            <div className="app-pagination-controls">
                <div className="app-pagination-pages">
                    <button type="button" className="app-pagination-btn app-pagination-prev" disabled={current <= 1} aria-label={t("account.layout.pagination.prev")} onClick={() => go(current - 1)}>
                        <ChevronLeft className="size-4" />
                    </button>
                    {items.map((item, index) =>
                        item === "…" ? (
                            <span key={`ellipsis-${index}`} className="app-pagination-ellipsis" aria-hidden>
                                …
                            </span>
                        ) : (
                            <button key={item} type="button" className={cn("app-pagination-btn", item === current && "is-active")} aria-current={item === current ? "page" : undefined} aria-label={t("account.layout.pagination.page", { page: item })} onClick={() => go(item)}>
                                {item}
                            </button>
                        ),
                    )}
                    <button type="button" className="app-pagination-btn app-pagination-next" disabled={current >= pages} aria-label={t("account.layout.pagination.next")} onClick={() => go(current + 1)}>
                        <ChevronRight className="size-4" />
                    </button>
                </div>
                {pages > 7 ? (
                    <label className="app-pagination-jump">
                        {t("account.layout.pagination.jumpBefore")}
                        <input inputMode="numeric" value={jump} placeholder={String(current)} aria-label={t("account.layout.pagination.jumpLabel")} onChange={(event) => setJump(event.target.value.replace(/\D/g, "").slice(0, 6))} onKeyDown={(event) => { if (event.key === "Enter") submitJump(); }} onBlur={() => { if (jump) submitJump(); }} />
                        {t("account.layout.pagination.jumpAfter")}
                    </label>
                ) : null}
                {pageSizeOptions.length > 1 ? (
                    <Select size="small" value={pageSize} className="app-pagination-size" popupMatchSelectWidth={false} ariaLabel={t("account.layout.pagination.pageSize")} options={pageSizeOptions.map((size) => ({ value: size, label: t("account.layout.pagination.perPage", { size, item }) }))} onChange={(value) => onChange(1, Number(value))} />
                ) : null}
            </div>
        </nav>
    );
}
