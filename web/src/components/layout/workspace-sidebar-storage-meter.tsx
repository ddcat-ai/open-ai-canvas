import { HardDrive } from "lucide-react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";

import { useAccountFileStorageUsage } from "@/hooks/use-account-file-storage-usage";
import { accountStorageMeter, accountStorageStateMessage } from "@/lib/account-storage-usage";
import { cn } from "@/lib/utils";
import { preloadWorkspaceRoute } from "@/lib/workspace-route-modules";
import { progressFillStyle } from "@/lib/progress-fill";

function StorageGlyph() {
    return (
        <span className="app-workspace-sidebar-storage-icon" aria-hidden="true">
            <HardDrive strokeWidth={1.75} />
        </span>
    );
}

export function WorkspaceSidebarStorageMeter({ collapsed }: { collapsed: boolean }) {
    const { t } = useTranslation();
    const query = useAccountFileStorageUsage();
    const meter = accountStorageMeter(query.data);
    const usedText = query.data ? t("account.layout.storage.used", { size: meter.usedLabel }) : query.isError ? t("account.layout.storage.unavailable") : t("account.layout.storage.counting");
    const remainingText = query.data
        ? meter.state === "read_only"
            ? t("account.layout.storage.readOnly")
            : meter.state === "grace"
              ? t("account.layout.storage.over")
              : meter.full
                ? t("account.layout.storage.full")
                : t("account.layout.storage.remaining", { size: meter.remainingLabel })
        : "";
    const totalText = query.data ? t("account.layout.storage.total", { size: meter.totalLabel }) : "";
    const summary = query.data ? t("account.layout.storage.summary", { used: usedText, remaining: remainingText, total: totalText }) : usedText;
    const stateMessage = accountStorageStateMessage(meter);

    const track = (
        <span
            className="app-workspace-sidebar-storage-track"
            role="progressbar"
            aria-label={t("account.layout.storage.progress")}
            aria-valuemin={0}
            aria-valuemax={query.data?.totalBytes ?? 0}
            aria-valuenow={query.data ? Math.min(query.data.usedBytes, query.data.totalBytes) : 0}
            aria-valuetext={summary}
        >
            <span style={progressFillStyle(meter.percent)} />
        </span>
    );

    if (query.isError && !query.data) {
        return (
            <div className={cn("app-workspace-sidebar-storage is-error", collapsed && "is-collapsed")}>
                {collapsed ? (
                    <button type="button" title={t("account.layout.storage.retryTitle")} aria-label={t("account.layout.storage.retryLabel")} onClick={() => void query.refetch()}>
                        <StorageGlyph />
                    </button>
                ) : (
                    <>
                        <StorageGlyph />
                        <span>{t("account.layout.storage.unavailable")}</span>
                        <button type="button" onClick={() => void query.refetch()}>
                            {t("common.retry")}
                        </button>
                    </>
                )}
            </div>
        );
    }

    return (
        <Link
            to="/assets"
            className={cn(
                "app-workspace-sidebar-storage",
                collapsed && "is-collapsed",
                meter.tone === "warn" && "is-warn",
                (meter.tone === "critical" || meter.state !== "ok") && "is-critical",
                query.data?.usedBytes ? "has-usage" : null,
                query.isPending && !query.data && "is-pending",
            )}
            title={stateMessage ? t("account.layout.storage.titleWithState", { summary, state: stateMessage }) : t("account.layout.storage.title", { summary })}
            aria-label={t("account.layout.storage.label", { summary })}
            aria-busy={query.isPending && !query.data}
            onFocus={() => preloadWorkspaceRoute("/assets")}
            onPointerEnter={() => preloadWorkspaceRoute("/assets")}
        >
            <StorageGlyph />
            {collapsed ? (
                track
            ) : (
                <span className="app-workspace-sidebar-storage-body">
                    <span className="app-workspace-sidebar-storage-copy">
                        <span className="app-workspace-sidebar-storage-meta">
                            <span className="app-workspace-sidebar-storage-used">{usedText}</span>
                            {totalText ? <span className="app-workspace-sidebar-storage-total">{totalText}</span> : null}
                        </span>
                    </span>
                    <span className="app-workspace-sidebar-storage-foot">
                        {track}
                        {remainingText ? <span className="app-workspace-sidebar-storage-remain">{remainingText}</span> : null}
                    </span>
                </span>
            )}
        </Link>
    );
}
