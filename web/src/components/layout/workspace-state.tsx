import { Button, Skeleton } from "antd";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { WorkspaceSignalIcon, type WorkspaceSignalIconVariant } from "@/components/ui/aceternity/workspace-signal-icon";
import { cn } from "@/lib/utils";

/**
 * 空态四种场景各有固定的文案结构与操作，页面不要再各自拼一套：
 * - first-use：说明这里会放什么 + 一个主按钮（可再加一个次要链接或 2–3 个示例模板）。
 * - no-results：显示用户搜了什么 + 「清除筛选」。用 WorkspaceNoResultsState。
 * - error：说明加载失败 + 重试。用 WorkspaceErrorState。
 * - forbidden：说明没有权限 + 返回或申请入口。用 WorkspaceForbiddenState。
 *
 * 版式：页面级空态落在内容区约 40% 高度处（上 2 份、下 3 份留白），大屏上不显得偏低；
 * compact 用于面板、抽屉内的局部空态，保持居中。
 */
export type WorkspaceStateKind = "first-use" | "no-results" | "error" | "forbidden";

export function WorkspaceState({
    icon = "empty",
    kind = "first-use",
    title,
    description,
    action,
    secondaryAction,
    compact = false,
    className,
}: {
    icon?: WorkspaceSignalIconVariant;
    kind?: WorkspaceStateKind;
    title: string;
    description?: ReactNode;
    action?: ReactNode;
    secondaryAction?: ReactNode;
    compact?: boolean;
    className?: string;
}) {
    return (
        <section
            data-kind={kind}
            role={kind === "error" ? "alert" : undefined}
            className={cn(
                "workspace-state grid w-full justify-items-center text-center",
                compact ? "min-h-44 content-center py-8" : "min-h-[360px] grid-rows-[2fr_auto_3fr] py-12",
                className,
            )}
        >
            {compact ? null : <span aria-hidden />}
            <div className="flex max-w-[44ch] flex-col items-center">
                <WorkspaceSignalIcon variant={icon} size={compact ? "md" : "lg"} />
                <h2 className={cn("mt-4 font-medium leading-[var(--lh-heading)] text-[var(--text-primary)]", compact ? "text-[var(--fs-body)]" : "text-[var(--fs-heading)]")}>{title}</h2>
                {description ? <p className="mt-2 text-[var(--fs-ui)] leading-[var(--lh-body)] text-[var(--text-secondary)]">{description}</p> : null}
                {action || secondaryAction ? (
                    <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                        {action}
                        {secondaryAction}
                    </div>
                ) : null}
            </div>
            {compact ? null : <span aria-hidden />}
        </section>
    );
}

/** 搜索或筛选无结果：回显关键词，提供「清除筛选」。 */
export function WorkspaceNoResultsState({
    query,
    onClear,
    icon = "empty",
    title,
    description,
    clearLabel,
    compact = false,
}: {
    query?: string;
    onClear?: () => void;
    icon?: WorkspaceSignalIconVariant;
    title?: string;
    description?: ReactNode;
    clearLabel?: string;
    compact?: boolean;
}) {
    const { t } = useTranslation();
    const keyword = query?.trim();
    return (
        <WorkspaceState
            kind="no-results"
            icon={icon}
            compact={compact}
            title={title || (keyword ? t("account.layout.state.noResultsFor", { keyword }) : t("account.layout.state.noResults"))}
            description={description ?? t("account.layout.state.noResultsHint")}
            action={onClear ? <Button onClick={onClear}>{clearLabel ?? t("account.layout.state.clearFilters")}</Button> : undefined}
        />
    );
}

export function WorkspaceErrorState({ title, description, actionLabel, onRetry, compact = false }: { title?: string; description?: string; actionLabel?: string; onRetry?: () => void; compact?: boolean }) {
    const { t } = useTranslation();
    return <WorkspaceState kind="error" icon="error" title={title ?? t("account.layout.state.errorTitle")} description={description || t("account.layout.state.errorDescription")} compact={compact} action={onRetry ? <Button onClick={onRetry}>{actionLabel ?? t("account.layout.state.reload")}</Button> : undefined} />;
}

/** 没有权限：说明原因，给出返回或申请的出口，不展示内容结构。 */
export function WorkspaceForbiddenState({ title, description, action, compact = false }: { title?: string; description?: ReactNode; action?: ReactNode; compact?: boolean }) {
    const { t } = useTranslation();
    return <WorkspaceState kind="forbidden" icon="settings" title={title ?? t("account.layout.state.forbiddenTitle")} description={description ?? t("account.layout.state.forbiddenDescription")} compact={compact} action={action} />;
}

export function WorkspaceLoadingState({ label, detail, rows = 3, className }: { label?: string; detail?: string; rows?: number; className?: string }) {
    const { t } = useTranslation();
    return (
        <section className={cn("workspace-loading-state py-8", className)} aria-busy="true" aria-live="polite">
            <div className="mb-5 flex items-center gap-3">
                <WorkspaceSignalIcon variant="loading" size="sm" />
                <div>
                    <div className="text-sm font-medium">{label ?? t("account.layout.state.loading")}</div>
                    {detail ? <div className="mt-1 text-xs text-[var(--text-tertiary)]">{detail}</div> : null}
                </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: rows }, (_, index) => (
                    <div key={index} className="rounded-md bg-surface-active p-4">
                        <Skeleton active title={{ width: `${48 + index * 8}%` }} paragraph={{ rows: 3 }} />
                    </div>
                ))}
            </div>
        </section>
    );
}
