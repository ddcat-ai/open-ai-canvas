import { HardDrive } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useAccountFileStorageUsage } from "@/hooks/use-account-file-storage-usage";
import { accountFileStorageUsageQueryKey, accountStorageMeter, accountStorageStateMessage, formatStorageBytes } from "@/lib/account-storage-usage";
import { openStoragePurchase } from "@/lib/workspace-storage";
import { progressFillStyle } from "@/lib/progress-fill";

export const assetStorageUsageQueryKey = accountFileStorageUsageQueryKey;

export function AssetStorageUsage() {
    const { t } = useTranslation();
    const query = useAccountFileStorageUsage();
    const usage = query.data;
    const meter = accountStorageMeter(usage);
    const stateMessage = accountStorageStateMessage(meter);
    const showUpsell = meter.state !== "ok" || meter.tone !== "ok";

    return (
        <section
            className={`assets-storage-usage${meter.full || meter.state !== "ok" ? " is-full" : ""}${usage?.usedBytes ? " has-usage" : ""}`}
            aria-label={t("library.assets.storage.label")}
            aria-busy={query.isPending}
            title={stateMessage ? t("library.assets.storage.hintWithState", { state: stateMessage }) : t("library.assets.storage.hint")}
        >
            <span className="assets-storage-usage-icon" aria-hidden="true">
                <HardDrive />
            </span>
            <span className="assets-storage-usage-title">{meter.state === "read_only" ? t("library.assets.storage.readOnly") : meter.state === "grace" ? t("library.assets.storage.overQuota") : t("library.assets.storage.title")}</span>
            {usage ? (
                <>
                    <span className="assets-storage-usage-value">
                        {formatStorageBytes(usage.usedBytes)} / {formatStorageBytes(usage.totalBytes)}
                    </span>
                    <span
                        className="assets-storage-usage-track"
                        role="progressbar"
                        aria-label={t("library.assets.storage.progress")}
                        aria-valuemin={0}
                        aria-valuemax={usage.totalBytes}
                        aria-valuenow={Math.min(usage.usedBytes, usage.totalBytes)}
                        aria-valuetext={t("library.assets.storage.valueText", { used: formatStorageBytes(usage.usedBytes), total: formatStorageBytes(usage.totalBytes) })}
                    >
                        <span style={progressFillStyle(meter.percent)} />
                    </span>
                    <span className="assets-storage-usage-percent">{meter.percentLabel}</span>
                    <button type="button" className="assets-storage-usage-action" onClick={() => openStoragePurchase()}>
                        {showUpsell ? t("library.assets.storage.expand") : t("library.assets.storage.buy")}
                    </button>
                </>
            ) : query.isError ? (
                <span className="assets-storage-usage-status">
                    {t("library.assets.storage.unavailable")}
                    <button type="button" onClick={() => void query.refetch()}>
                        {t("common.retry")}
                    </button>
                </span>
            ) : (
                <span className="assets-storage-usage-status">{t("library.assets.storage.loading")}</span>
            )}
        </section>
    );
}
