import "@/lib/plugins/builtin";

import { getRegisteredPlugin } from "@/lib/plugins/plugin-registry";
import { pluginStorageFor } from "@/lib/plugins/plugin-storage";
import type { Asset } from "@/stores/use-asset-store";
import { usePluginStore } from "@/stores/use-plugin-store";
import type { AssetSourceProvider, ExternalAssetItem, PluginInstallation } from "@/lib/plugins/plugin-types";

export type HostedAssetSource = {
    id: string;
    name: string;
    provider: AssetSourceProvider;
};

export type ExternalAssetSyncRecord = {
    sourceId: string;
    sourceName: string;
    status: "synced" | "failed";
    externalId?: string;
    folderId?: string;
    error?: string;
    updatedAt: string;
};

export type ExternalAssetSyncResult = {
    records: ExternalAssetSyncRecord[];
    uploaded: ExternalAssetItem[];
    failures: Array<{ sourceId: string; sourceName: string; error: string }>;
};

export function createHostedAssetSources(installations: PluginInstallation[]): HostedAssetSource[] {
    return installations.flatMap((installation) => {
        if (!installation.enabled) return [];
        const plugin = getRegisteredPlugin(installation.manifest.id);
        if (!plugin?.createAssetSource) return [];
        try {
            return [
                {
                    id: plugin.manifest.id,
                    name: plugin.manifest.name,
                    provider: plugin.createAssetSource({
                        manifest: plugin.manifest,
                        permissions: new Set(plugin.manifest.permissions),
                        storage: pluginStorageFor(plugin.manifest.id),
                        config: installation.config,
                    }),
                },
            ];
        } catch {
            return [];
        }
    });
}

export async function uploadGeneratedAssetToConfiguredSources(asset: Asset, signal?: AbortSignal): Promise<ExternalAssetSyncResult> {
    const installations = usePluginStore.getState().installations;
    const autoUploadInstallations = installations.filter((installation) => installation.enabled && isAutoUploadEnabled(installation.config.autoUploadGenerated));
    if (!autoUploadInstallations.length) return { records: readSyncRecords(asset), uploaded: [], failures: [] };

    const sources = createHostedAssetSources(installations);
    const records = readSyncRecords(asset);
    const uploaded: ExternalAssetItem[] = [];
    const failures: ExternalAssetSyncResult["failures"] = [];
    for (const installation of autoUploadInstallations) {
        if (signal?.aborted) throw new DOMException("请求已取消", "AbortError");
        const source = sources.find((candidate) => candidate.id === installation.manifest.id);
        const folderId = stringConfig(installation.config.generatedFolderId);
        const existing = records.find((record) => record.sourceId === installation.manifest.id);
        if (existing?.status === "synced" && existing.folderId === folderId) continue;

        if (!source) {
            const error = "插件未能加载素材来源";
            replaceSyncRecord(records, { sourceId: installation.manifest.id, sourceName: installation.manifest.name, status: "failed", folderId, error, updatedAt: new Date().toISOString() });
            failures.push({ sourceId: installation.manifest.id, sourceName: installation.manifest.name, error });
            continue;
        }
        if (!source.provider.uploadAsset && !source.provider.uploadAssetToFolder) {
            const error = "当前插件不支持自动写入生成结果";
            replaceSyncRecord(records, { sourceId: source.id, sourceName: source.name, status: "failed", folderId, error, updatedAt: new Date().toISOString() });
            failures.push({ sourceId: source.id, sourceName: source.name, error });
            continue;
        }

        try {
            const item = source.provider.uploadAssetToFolder ? await source.provider.uploadAssetToFolder(asset, folderId, signal) : await source.provider.uploadAsset!(asset, signal);
            uploaded.push(item);
            replaceSyncRecord(records, { sourceId: source.id, sourceName: source.name, status: "synced", externalId: item.id, folderId, updatedAt: new Date().toISOString() });
        } catch (reason) {
            if (reason instanceof DOMException && reason.name === "AbortError") throw reason;
            const error = reason instanceof Error ? reason.message : "插件写入失败";
            replaceSyncRecord(records, { sourceId: source.id, sourceName: source.name, status: "failed", folderId, error, updatedAt: new Date().toISOString() });
            failures.push({ sourceId: source.id, sourceName: source.name, error });
        }
    }
    return { records, uploaded, failures };
}

export function externalAssetSyncFailures(asset: Asset) {
    return readSyncRecords(asset).filter((record) => record.status === "failed");
}

function isAutoUploadEnabled(value: unknown) {
    return value !== false && value !== "false";
}

function stringConfig(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readSyncRecords(asset: Asset): ExternalAssetSyncRecord[] {
    const raw = asset.metadata?.externalSync;
    if (!Array.isArray(raw)) return [];
    return raw.filter((item): item is ExternalAssetSyncRecord => {
        if (!item || typeof item !== "object") return false;
        const candidate = item as Partial<ExternalAssetSyncRecord>;
        return typeof candidate.sourceId === "string" && typeof candidate.sourceName === "string" && (candidate.status === "synced" || candidate.status === "failed") && typeof candidate.updatedAt === "string";
    });
}

function replaceSyncRecord(records: ExternalAssetSyncRecord[], next: ExternalAssetSyncRecord) {
    const index = records.findIndex((record) => record.sourceId === next.sourceId);
    if (index === -1) records.push(next);
    else records[index] = next;
}
