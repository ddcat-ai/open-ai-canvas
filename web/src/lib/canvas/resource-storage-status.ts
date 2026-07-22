export type ResourceStorageLocation = "oss" | "local" | "none";

export function resourceStorageLocation(storageKey?: string): ResourceStorageLocation {
    if (!storageKey) return "none";
    return storageKey.startsWith("resource:") ? "oss" : "local";
}

export function resourceStorageLabel(storageKey?: string) {
    const location = resourceStorageLocation(storageKey);
    if (location === "oss") return "已上传";
    if (location === "local") return "本地";
    return "未同步";
}

export function resourceStorageTitle(storageKey?: string) {
    const location = resourceStorageLocation(storageKey);
    if (location === "oss") return "已上传到 OSS，并以账号资源同步";
    if (location === "local") return "保存在当前浏览器本地，通常是 OSS 未启用或上传失败后的降级";
    return "还没有可同步的资源标识";
}
