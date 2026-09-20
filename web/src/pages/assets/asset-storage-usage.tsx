import { HardDrive } from "lucide-react";

import { useAccountFileStorageUsage } from "@/hooks/use-account-file-storage-usage";
import { accountFileStorageUsageQueryKey, accountStorageMeter, formatStorageBytes } from "@/lib/account-storage-usage";

export const assetStorageUsageQueryKey = accountFileStorageUsageQueryKey;

export function AssetStorageUsage() {
    const query = useAccountFileStorageUsage();
    const usage = query.data;
    const meter = accountStorageMeter(usage);

    return (
        <section className={`assets-storage-usage${meter.full ? " is-full" : ""}${usage?.usedBytes ? " has-usage" : ""}`} aria-label="账号文件容量" aria-busy={query.isPending} title="包含素材文件和 Agent 会话附件">
            <span className="assets-storage-usage-icon" aria-hidden="true">
                <HardDrive />
            </span>
            <span className="assets-storage-usage-title">账号容量</span>
            {usage ? (
                <>
                    <span className="assets-storage-usage-value">
                        {formatStorageBytes(usage.usedBytes)} / {formatStorageBytes(usage.totalBytes)}
                    </span>
                    <span
                        className="assets-storage-usage-track"
                        role="progressbar"
                        aria-label="账号文件容量使用进度"
                        aria-valuemin={0}
                        aria-valuemax={usage.totalBytes}
                        aria-valuenow={Math.min(usage.usedBytes, usage.totalBytes)}
                        aria-valuetext={`已使用 ${formatStorageBytes(usage.usedBytes)}，总容量 ${formatStorageBytes(usage.totalBytes)}`}
                    >
                        <span style={{ width: `${meter.percent}%` }} />
                    </span>
                    <span className="assets-storage-usage-percent">{meter.percentLabel}</span>
                </>
            ) : query.isError ? (
                <span className="assets-storage-usage-status">
                    容量统计暂时不可用。
                    <button type="button" onClick={() => void query.refetch()}>
                        重试
                    </button>
                </span>
            ) : (
                <span className="assets-storage-usage-status">正在统计已用容量…</span>
            )}
        </section>
    );
}
