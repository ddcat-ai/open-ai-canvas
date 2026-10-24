import { queryKnownResourceProvider } from "@/services/api/resources";

export type ResourceStorageLocation = "oss" | "server" | "local" | "none";

export function resourceStorageLocation(storageKey?: string): ResourceStorageLocation {
    if (!storageKey) return "none";
    if (storageKey.startsWith("resource:")) {
        const known = queryKnownResourceProvider(storageKey);
        if (known?.provider === "local") return "server";
        if (known?.provider && known.provider !== "local") return "oss";
        return "server";
    }
    return "local";
}

export function resourceStorageLabel(storageKey?: string) {
    const location = resourceStorageLocation(storageKey);
    if (location === "oss") return "OSS";
    if (location === "server") return "服务器";
    if (location === "local") return "本地";
    return "未就绪";
}

export function resourceStorageTitle(storageKey?: string) {
    const location = resourceStorageLocation(storageKey);
    if (location === "oss") return "保存在云端对象存储（OSS / S3）";
    if (location === "server") return "保存在服务器本地磁盘，不消耗 OSS 存储与外网下行流量";
    if (location === "local") return "保存在当前浏览器本地缓存中";
    return "尚未分配资源存储标识";
}
