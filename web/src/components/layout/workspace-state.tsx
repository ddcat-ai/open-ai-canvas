import { Button, Skeleton } from "antd";
import type { ReactNode } from "react";

import { WorkspaceSignalIcon, type WorkspaceSignalIconVariant } from "@/components/ui/aceternity/workspace-signal-icon";
import { cn } from "@/lib/utils";

export function WorkspaceState({ icon = "empty", title, description, action, compact = false, className }: { icon?: WorkspaceSignalIconVariant; title: string; description?: string; action?: ReactNode; compact?: boolean; className?: string }) {
    return (
        <section className={cn("workspace-state flex flex-col items-center justify-center text-center", compact ? "min-h-44 py-8" : "min-h-[320px] py-12", className)}>
            <WorkspaceSignalIcon variant={icon} size={compact ? "md" : "lg"} />
            <h2 className="mt-4 text-[var(--fs-body-lg)] font-semibold leading-6 text-foreground">{title}</h2>
            {description ? <p className="mt-1.5 max-w-[42ch] text-xs leading-5 text-foreground/58">{description}</p> : null}
            {action ? <div className="mt-5">{action}</div> : null}
        </section>
    );
}

export function WorkspaceErrorState({ title = "暂时无法加载", description, actionLabel = "重新加载", onRetry, compact = false }: { title?: string; description?: string; actionLabel?: string; onRetry?: () => void; compact?: boolean }) {
    return <WorkspaceState icon="error" title={title} description={description || "请检查网络连接后重试，当前内容不会被覆盖。"} compact={compact} action={onRetry ? <Button onClick={onRetry}>{actionLabel}</Button> : undefined} />;
}

export function WorkspaceLoadingState({ label = "正在加载内容", detail, rows = 3, className }: { label?: string; detail?: string; rows?: number; className?: string }) {
    return (
        <section className={cn("workspace-loading-state py-8", className)} aria-busy="true" aria-live="polite">
            <div className="mb-5 flex items-center gap-3">
                <WorkspaceSignalIcon variant="loading" size="sm" />
                <div><div className="text-sm font-medium">{label}</div>{detail ? <div className="mt-0.5 text-xs text-foreground/50">{detail}</div> : null}</div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: rows }, (_, index) => <div key={index} className="rounded-md border border-border/75 p-4"><Skeleton active title={{ width: `${48 + index * 8}%` }} paragraph={{ rows: 3 }} /></div>)}
            </div>
        </section>
    );
}
