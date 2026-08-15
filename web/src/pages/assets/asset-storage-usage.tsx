import { useQuery } from "@tanstack/react-query";
import { HardDrive } from "lucide-react";

import { formatBytes } from "@/lib/image-utils";
import { getAccountFileStorageUsage } from "@/services/api/resources";

export const assetStorageUsageQueryKey = ["account-file-storage-usage"] as const;

export function AssetStorageUsage() {
    const query = useQuery({
        queryKey: assetStorageUsageQueryKey,
        queryFn: getAccountFileStorageUsage,
        refetchOnMount: "always",
    });
    const usage = query.data;
    const percent = usage?.totalBytes ? Math.min(100, (usage.usedBytes / usage.totalBytes) * 100) : 0;
    const percentLabel = usage?.usedBytes && percent < 0.1 ? "<0.1%" : `${Math.round(percent * 10) / 10}%`;
    const full = Boolean(usage && usage.usedBytes >= usage.totalBytes);

    return (
        <section className={`assets-storage-usage${full ? " is-full" : ""}${usage?.usedBytes ? " has-usage" : ""}`} aria-label="账号文件容量" aria-busy={query.isPending} title="包含素材文件和 Agent 会话附件">
            <span className="assets-storage-usage-icon" aria-hidden="true">
                <HardDrive />
            </span>
            <span className="assets-storage-usage-title">账号容量</span>
            {usage ? (
                <>
                    <span className="assets-storage-usage-value">
                        {storageBytes(usage.usedBytes)} / {storageBytes(usage.totalBytes)}
                    </span>
                    <span
                        className="assets-storage-usage-track"
                        role="progressbar"
                        aria-label="账号文件容量使用进度"
                        aria-valuemin={0}
                        aria-valuemax={usage.totalBytes}
                        aria-valuenow={Math.min(usage.usedBytes, usage.totalBytes)}
                        aria-valuetext={`已使用 ${storageBytes(usage.usedBytes)}，总容量 ${storageBytes(usage.totalBytes)}`}
                    >
                        <span style={{ width: `${percent}%` }} />
                    </span>
                    <span className="assets-storage-usage-percent">{percentLabel}</span>
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

function storageBytes(value: number) {
    return formatBytes(value) || "0 B";
}
