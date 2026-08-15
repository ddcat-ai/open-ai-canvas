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
    const percent = usage?.totalBytes ? Math.min(100, Math.round((usage.usedBytes / usage.totalBytes) * 1_000) / 10) : 0;
    const full = Boolean(usage && usage.usedBytes >= usage.totalBytes);

    return (
        <section className={`assets-storage-usage ${full ? "is-full" : ""}`} aria-label="账号文件容量" aria-busy={query.isPending}>
            <span className="assets-storage-usage-icon" aria-hidden="true"><HardDrive /></span>
            <div className="assets-storage-usage-body">
                <div className="assets-storage-usage-head">
                    <span className="assets-storage-usage-title">账号文件容量</span>
                    {usage ? <span className="assets-storage-usage-value">{storageBytes(usage.usedBytes)} / {storageBytes(usage.totalBytes)}</span> : null}
                </div>
                {usage ? (
                    <>
                        <span className="assets-storage-usage-track" role="progressbar" aria-label="账号文件容量使用进度" aria-valuemin={0} aria-valuemax={usage.totalBytes} aria-valuenow={Math.min(usage.usedBytes, usage.totalBytes)} aria-valuetext={`已使用 ${storageBytes(usage.usedBytes)}，总容量 ${storageBytes(usage.totalBytes)}`}>
                            <span style={{ width: `${percent}%` }} />
                        </span>
                        <span className="assets-storage-usage-meta">
                            <span>包含素材文件和 Agent 会话附件</span>
                            <span>{percent}%</span>
                        </span>
                    </>
                ) : query.isError ? (
                    <span className="assets-storage-usage-status">容量统计暂时不可用。<button type="button" onClick={() => void query.refetch()}>重试</button></span>
                ) : (
                    <span className="assets-storage-usage-status">正在统计已用容量…</span>
                )}
            </div>
        </section>
    );
}

function storageBytes(value: number) {
    return formatBytes(value) || "0 B";
}
