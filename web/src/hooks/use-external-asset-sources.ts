import { useCallback, useEffect, useMemo, useState } from "react";

import type { AssetLibraryPickerFolder, AssetLibraryPickerItem } from "@/components/assets/asset-library-picker-modal";
import "@/lib/plugins/builtin";
import { createHostedAssetSources, type HostedAssetSource } from "@/services/external-asset-sources";
import type { ExternalAssetFolder, ExternalAssetItem, ExternalAssetPickerReference } from "@/lib/plugins/plugin-types";
import { usePluginStore } from "@/stores/use-plugin-store";
import type { Asset } from "@/stores/use-asset-store";

type LoadedAssetSource = {
    source: HostedAssetSource;
    folders: ExternalAssetFolder[];
    items: ExternalAssetItem[];
};

export type ExternalAssetSourceState = {
    items: AssetLibraryPickerItem[];
    folders: AssetLibraryPickerFolder[];
    categoryLabels: Record<string, string>;
    loading: boolean;
    error: string;
    importExternalAsset: (reference: ExternalAssetPickerReference, signal?: AbortSignal) => Promise<Asset>;
    uploadExternalFiles: (files: FileList | File[], folderId?: string, signal?: AbortSignal) => Promise<AssetLibraryPickerItem[]>;
};

export function useExternalAssetSources(open: boolean): ExternalAssetSourceState {
    const hydrated = usePluginStore((state) => state.hydrated);
    const installations = usePluginStore((state) => state.installations);
    const sources = useMemo(() => createHostedAssetSources(hydrated ? installations : []), [hydrated, installations]);
    const [loadedSources, setLoadedSources] = useState<LoadedAssetSource[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        const controller = new AbortController();
        if (!open || !sources.length) {
            setLoadedSources([]);
            setLoading(false);
            setError("");
            return () => controller.abort();
        }

        setLoading(true);
        setError("");
        void Promise.allSettled(sources.map(async (source) => {
            try {
                const [folders, items] = await Promise.all([
                    source.provider.listFolders?.(controller.signal) || Promise.resolve([]),
                    source.provider.list?.({ limit: 200, offset: 0, signal: controller.signal }) || Promise.resolve([]),
                ]);
                return { source, folders: folders || [], items: items || [] };
            } catch (reason) {
                const detail = reason instanceof Error ? reason.message : "读取失败";
                throw new Error(source.name + "：" + detail);
            }
        })).then((results) => {
            if (controller.signal.aborted) return;
            const loaded: LoadedAssetSource[] = [];
            const errors: string[] = [];
            results.forEach((result) => {
                if (result.status === "fulfilled") loaded.push(result.value);
                else errors.push(result.reason instanceof Error ? result.reason.message : "外部素材来源读取失败");
            });
            setLoadedSources(loaded);
            setError(errors.join("；"));
        }).finally(() => {
            if (!controller.signal.aborted) setLoading(false);
        });

        return () => controller.abort();
    }, [open, sources]);

    const items = useMemo(() => loadedSources.flatMap(({ source, items: sourceItems }) => sourceItems.filter(isPickerMedia).map((item) => toPickerItem(source, item))), [loadedSources]);
    const folders = useMemo(() => loadedSources.flatMap(({ source, folders: sourceFolders }) => sourceFolders.map((folder) => ({
        id: externalFolderId(source.id, folder.id),
        parentId: folder.parentId ? externalFolderId(source.id, folder.parentId) : undefined,
        name: folder.name,
    }))), [loadedSources]);
    const categoryLabels = useMemo(
        () => Object.fromEntries(sources.map((source) => [externalCategory(source.id), source.name])),
        [sources],
    );

    const importExternalAsset = useCallback(async (reference: ExternalAssetPickerReference, signal?: AbortSignal) => {
        const source = sources.find((item) => item.id === reference.sourceId);
        if (!source?.provider.importAsset) throw new Error(`${reference.sourceName}暂不支持导入项目资产`);
        return source.provider.importAsset(reference.item, signal);
    }, [sources]);

    const uploadExternalFiles = useCallback(async (files: FileList | File[], folderId?: string, signal?: AbortSignal) => {
        const source = resolveUploadSource(sources, folderId);
        if (!source?.provider.uploadFile) throw new Error("当前插件不支持写入文件");
        const providerFolderId = folderId ? externalFolderValue(source.id, folderId) : undefined;
        const uploadedItems: ExternalAssetItem[] = [];
        for (const file of Array.from(files)) {
            uploadedItems.push(await source.provider.uploadFile(file, providerFolderId, signal));
        }
        const pickerItems = uploadedItems.map((item) => toPickerItem(source, item));
        setLoadedSources((current) => {
            const existing = current.find((item) => item.source.id === source.id);
            if (!existing) return [...current, { source, folders: [], items: uploadedItems }];
            return current.map((item) => item.source.id === source.id ? { ...item, items: [...item.items, ...uploadedItems] } : item);
        });
        return pickerItems;
    }, [sources]);

    return { items, folders, categoryLabels, loading, error, importExternalAsset, uploadExternalFiles };
}

function isPickerMedia(item: ExternalAssetItem) {
    return item.kind === "image" || item.kind === "video" || item.kind === "audio";
}

function externalCategory(sourceId: string) {
    return "external:" + sourceId;
}

export function externalAssetPickerId(reference: ExternalAssetPickerReference) {
    return "external:" + reference.sourceId + ":" + reference.item.id;
}

function externalFolderId(sourceId: string, folderId: string) {
    return "external-folder:" + sourceId + ":" + folderId;
}

function externalFolderValue(sourceId: string, folderId: string) {
    const prefix = externalFolderId(sourceId, "");
    return folderId.startsWith(prefix) ? folderId.slice(prefix.length) : folderId;
}

function resolveUploadSource(sources: HostedAssetSource[], folderId?: string) {
    if (folderId) return sources.find((source) => folderId.startsWith(externalFolderId(source.id, "")));
    if (sources.length === 1) return sources[0];
    throw new Error("请先选择一个插件文件夹，再写入素材");
}

function toPickerItem(source: HostedAssetSource, item: ExternalAssetItem): AssetLibraryPickerItem {
    const reference: ExternalAssetPickerReference = { sourceId: source.id, sourceName: source.name, item };
    const folderPath = item.folderPath?.join(" / ");
    return {
        id: externalAssetPickerId(reference),
        title: item.title,
        category: externalCategory(source.id),
        kindLabel: item.kind === "video" ? "视频" : item.kind === "audio" ? "音频" : "图片",
        imageUrl: item.thumbnailUrl,
        description: folderPath || item.description || undefined,
        searchText: [item.title, ...(item.tags || []), item.description || "", folderPath || ""].join(" "),
        folderId: item.folderId ? externalFolderId(source.id, item.folderId) : undefined,
        external: reference,
    };
}