import { formatBytes } from "@/lib/image-utils";
import type { AccountFileStorageUsage } from "@/services/api/resources";

export const accountFileStorageUsageQueryKey = ["account-file-storage-usage"] as const;

export type AccountStorageTone = "ok" | "warn" | "critical";

export type AccountStorageMeter = {
    percent: number;
    remainingBytes: number;
    usedLabel: string;
    totalLabel: string;
    remainingLabel: string;
    percentLabel: string;
    tone: AccountStorageTone;
    full: boolean;
};

export function formatStorageBytes(value: number) {
    return formatBytes(value) || "0 B";
}

export function accountStorageMeter(usage?: AccountFileStorageUsage | null): AccountStorageMeter {
    const usedBytes = usage && Number.isFinite(usage.usedBytes) ? Math.max(0, usage.usedBytes) : 0;
    const totalBytes = usage && Number.isFinite(usage.totalBytes) ? Math.max(0, usage.totalBytes) : 0;
    const remainingBytes = Math.max(0, totalBytes - usedBytes);
    const percent = totalBytes > 0 ? Math.min(100, (usedBytes / totalBytes) * 100) : 0;
    const full = totalBytes > 0 && usedBytes >= totalBytes;
    const tone: AccountStorageTone = full || percent >= 90 ? "critical" : percent >= 70 ? "warn" : "ok";

    return {
        percent,
        remainingBytes,
        usedLabel: formatStorageBytes(usedBytes),
        totalLabel: formatStorageBytes(totalBytes),
        remainingLabel: formatStorageBytes(remainingBytes),
        percentLabel: usedBytes && percent < 0.1 ? "<0.1%" : `${Math.round(percent * 10) / 10}%`,
        tone,
        full,
    };
}
