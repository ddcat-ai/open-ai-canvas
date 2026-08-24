import { t } from "@/i18n";
export type ResourceStorageLocation = "oss" | "local" | "none";

export function resourceStorageLocation(storageKey?: string): ResourceStorageLocation {
    if (!storageKey) return "none";
    return storageKey.startsWith("resource:") ? "oss" : "local";
}

export function resourceStorageLabel(storageKey?: string) {
    const location = resourceStorageLocation(storageKey);
    if (location === "oss") return t("canvas:uploaded");
    if (location === "local") return t("canvas:local-only");
    return t("canvas:not-synced");
}

export function resourceStorageTitle(storageKey?: string) {
    const location = resourceStorageLocation(storageKey);
    if (location === "oss") return t("canvas:uploaded-to-object-storage-and-synced-as-an-account-resource");
    if (location === "local") return t("canvas:stored-locally-in-this-browser-usually-because-object-storage-is-disable");
    return t("canvas:no-resource-identifier-to-sync-yet");
}
