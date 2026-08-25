import type { Asset } from "@/stores/use-asset-store";

export const PLUGIN_API_VERSION = "1" as const;

export type PluginCategory = "asset-source" | "canvas-node" | "workflow" | "ai-capability" | "import-export" | "agent" | "protocol";
export type PluginSurface = "node" | "fullscreen" | "hybrid" | "asset-source";
export type ProtocolCapability = "text" | "image" | "video" | "audio";
export type ProtocolScope = "admin.system-channel" | "user.custom-channel" | "canvas" | "creation" | "agent" | string;
export type ProtocolPluginInfo = {
    categories: ProtocolCapability[];
    scopes: ProtocolScope[];
    create?: string;
    poll?: string;
    cancel?: string;
    contentType?: string;
    documentation?: string;
    parameters?: Array<{ name: string; type: string; required?: boolean; description?: string; values?: string[]; mapping?: string }>;
};
export type PluginPermission =
    | "canvas.read"
    | "canvas.write"
    | "asset.read"
    | "asset.search"
    | "asset.import"
    | "asset.upload"
    | "generation.run"
    | "ai.text"
    | "external.open";

export type PluginManifest = {
    id: string;
    name: string;
    version: string;
    publishedAt?: string;
    updatedAt?: string;
    apiVersion: string;
    category: PluginCategory;
    description: string;
    documentation?: string;
    author?: string;
    entry?: string;
    surfaces: PluginSurface[];
    permissions: PluginPermission[];
    trusted?: boolean;
    kind?: "ui" | "protocol";
    configuration?: {
        fields: string[];
    };
    protocol?: ProtocolPluginInfo;
};

export type PluginStorage = {
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T): Promise<void>;
    remove(key: string): Promise<void>;
};

export type PluginTextContentPart =
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } };

export type PluginTextMessage = {
    role: "system" | "user" | "assistant";
    content: string | PluginTextContentPart[];
};

export type PluginTextTool = {
    type: "function";
    function: {
        name: string;
        description?: string;
        parameters: Record<string, unknown>;
        strict?: boolean;
    };
};

export type PluginTextToolChoice = "auto" | "required" | { type: "function"; name: string };

export type PluginTextToolCall = {
    name: string;
    arguments: string;
};

export type PluginTextResponse = {
    content: string;
    toolCalls: PluginTextToolCall[];
};

export type PluginTextRequest = {
    model?: string;
    messages: PluginTextMessage[];
    tools?: PluginTextTool[];
    toolChoice?: PluginTextToolChoice;
    signal?: AbortSignal;
    onDelta?: (text: string) => void;
};

export type PluginAiTextService = {
    requestToolResponse: (request: PluginTextRequest) => Promise<PluginTextResponse>;
};

export type PluginHostServices = {
    ai?: {
        text?: PluginAiTextService;
    };
};

export type PluginHostContext = {
    manifest: PluginManifest;
    permissions: ReadonlySet<PluginPermission>;
    storage: PluginStorage;
    config: Readonly<PluginInstallation["config"]>;
    services?: PluginHostServices;
};

export type PromptOptimizationMode = "expand" | "refine" | "style" | "model-adapt" | "reference";

export type PromptOptimizationInput = {
    prompt: string;
    mode: PromptOptimizationMode;
    generationMode: "image" | "video";
    targetModel?: string;
    targetProtocol?: string;
    optimizerModel?: string;
    context?: {
        texts?: Array<{ title: string; text: string }>;
        images?: Array<{ title: string; url: string }>;
    };
};

export type PromptOptimizationVariant = {
    label: string;
    prompt: string;
};

export type PromptOptimizationResult = {
    optimizedPrompt: string;
    negativePrompt: string;
    changes: string[];
    assumptions: string[];
    variants: PromptOptimizationVariant[];
    modelProfile?: { id: string; label: string };
};

export type PromptOptimizerProvider = {
    optimize: (
        input: PromptOptimizationInput,
        options?: { signal?: AbortSignal; onDelta?: (text: string) => void },
    ) => Promise<PromptOptimizationResult>;
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
    source?: "bundled" | "uploaded" | string;
    activate?: (context: PluginHostContext) => Promise<void> | void;
    deactivate?: (context: PluginHostContext) => Promise<void> | void;
    createAssetSource?: (context: PluginHostContext) => AssetSourceProvider;
    createPromptOptimizer?: (context: PluginHostContext) => PromptOptimizerProvider;
};

export type PluginInstallation = {
    manifest: PluginManifest;
    enabled: boolean;
    config: Record<string, string | number | boolean>;
    installedAt: string;
    updatedAt: string;
    lastError?: string;
};
