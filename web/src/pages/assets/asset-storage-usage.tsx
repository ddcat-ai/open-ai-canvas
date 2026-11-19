import { useMemo } from "react";
import { HardDrive } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useAccountFileStorageUsage } from "@/hooks/use-account-file-storage-usage";
import { accountFileStorageUsageQueryKey, accountStorageMeter, accountStorageStateMessage, formatStorageBytes } from "@/lib/account-storage-usage";
import { openStoragePurchase } from "@/lib/workspace-storage";
import { progressFillStyle } from "@/lib/progress-fill";
import { useAssetStore } from "@/stores/use-asset-store";
import { useUserStore } from "@/stores/use-user-store";

export const assetStorageUsageQueryKey = accountFileStorageUsageQueryKey;

/** 本机素材的字节数合计；文本按内容长度估算，其余用上传时记下的 bytes。 */
function localAssetBytes(assets: ReturnType<typeof useAssetStore.getState>["assets"]) {
    return assets.reduce((sum, asset) => {
        if (asset.kind === "text") return sum + new Blob([asset.data.content || ""]).size;
        // 资产设定（entity）只有结构化定义，没有文件字节。
        if (asset.kind === "entity") return sum;
        return sum + (Number(asset.data.bytes) || 0);
    }, 0);
}

export function AssetStorageUsage() {
    const { t } = useTranslation();
    // C 端免登录：没有账户额度体系，存储用量改按「本机素材合计」如实显示，
    // 不去打 /api/resources/storage-usage（免登录必然 401，会让整页冒出一个「重试」）。
    const userId = useUserStore((state) => state.user?.id || "");
    const assets = useAssetStore((state) => state.assets);
    const localBytes = useMemo(() => localAssetBytes(assets), [assets]);
    const query = useAccountFileStorageUsage(Boolean(userId));
    const usage = query.data;
    const meter = accountStorageMeter(usage);
    const stateMessage = accountStorageStateMessage(meter);
    const showUpsell = meter.state !== "ok" || meter.tone !== "ok";

    if (!userId) {
        return (
            <section
                className={`assets-storage-usage${localBytes ? " has-usage" : ""}`}
                aria-label={t("library.assets.storage.label")}
                title="素材只存在这台电脑的浏览器里，占用的是本机空间，不占云端额度。"
            >
                <span className="assets-storage-usage-icon" aria-hidden="true">
                    <HardDrive />
                </span>
                <span className="assets-storage-usage-title">本机素材</span>
                <span className="assets-storage-usage-value">{formatStorageBytes(localBytes)}</span>
                <span className="assets-storage-usage-percent">{assets.length} 个</span>
            </section>
        );
    }

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
