import type { Asset } from "@/stores/use-asset-store";

export const PLUGIN_API_VERSION = "1" as const;

export type PluginCategory = "asset-source" | "canvas-node" | "workflow" | "ai-capability" | "import-export" | "agent";
export type PluginSurface = "node" | "fullscreen" | "hybrid" | "asset-source";
export type PluginPermission =
    | "canvas.read"
    | "canvas.write"
    | "asset.read"
    | "asset.search"
    | "asset.import"
    | "asset.upload"
    | "generation.run"
    | "external.open";

export type PluginManifest = {
    id: string;
    name: string;
    version: string;
    apiVersion: string;
    category: PluginCategory;
    description: string;
    author?: string;
    entry?: string;
    surfaces: PluginSurface[];
    permissions: PluginPermission[];
    trusted?: boolean;
};

export type PluginStorage = {
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T): Promise<void>;
    remove(key: string): Promise<void>;
};

export type PluginHostContext = {
    manifest: PluginManifest;
    permissions: ReadonlySet<PluginPermission>;
    storage: PluginStorage;
    config: Readonly<PluginInstallation["config"]>;
};

export type AssetSourceQuery = {
    keyword?: string;
    folderId?: string;
    tags?: string[];
    kind?: Asset["kind"];
    limit?: number;
    offset?: number;
    signal?: AbortSignal;
};

export type ExternalAssetFolder = {
    id: string;
    name: string;
    parentId?: string;
};

export type ExternalAssetItem = {
    id: string;
    title: string;
    kind: Asset["kind"];
    thumbnailUrl?: string;
    fileUrl?: string;
    mimeType?: string;
    width?: number;
    height?: number;
    bytes?: number;
    tags?: string[];
    folderId?: string;
    folderIds?: string[];
    folderPath?: string[];
    description?: string;
    metadata?: Record<string, unknown>;
};

export type ExternalAssetPickerReference = {
    sourceId: string;
    sourceName: string;
    item: ExternalAssetItem;
};

export type AssetSourceProvider = {
    listFolders?: (signal?: AbortSignal) => Promise<ExternalAssetFolder[]>;
    list?: (query: AssetSourceQuery) => Promise<ExternalAssetItem[]>;
    importAsset?: (item: ExternalAssetItem, signal?: AbortSignal) => Promise<Asset>;
    uploadAsset?: (asset: Asset, signal?: AbortSignal) => Promise<ExternalAssetItem>;
    uploadAssetToFolder?: (asset: Asset, folderId?: string, signal?: AbortSignal) => Promise<ExternalAssetItem>;
    uploadFile?: (file: File, folderId?: string, signal?: AbortSignal) => Promise<ExternalAssetItem>;
    createFolder?: (name: string, parentId?: string) => Promise<void>;
    openAsset?: (item: ExternalAssetItem) => Promise<void>;
};

export type RegisteredPlugin = {
    manifest: PluginManifest;
    activate?: (context: PluginHostContext) => Promise<void> | void;
    deactivate?: (context: PluginHostContext) => Promise<void> | void;
    createAssetSource?: (context: PluginHostContext) => AssetSourceProvider;
};

export type PluginInstallation = {
    manifest: PluginManifest;
    enabled: boolean;
    config: Record<string, string | number | boolean>;
    installedAt: string;
    updatedAt: string;
    lastError?: string;
};

