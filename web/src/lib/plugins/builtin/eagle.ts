import { nanoid } from "nanoid";

import { addEagleItem, createEagleFolder, downloadEagleItem, eagleItemFileUrl, eagleItemThumbnailUrl, getEagleLibrary, listEagleItems, type EagleFolder, type EagleItem } from "@/services/api/eagle";
import { getMediaBlob, uploadMediaFile } from "@/services/file-storage";
import { imageToDataUrl, uploadImage } from "@/services/image-storage";
import type { Asset } from "@/stores/use-asset-store";
import { registerPlugin } from "../plugin-registry";
import type { AssetSourceProvider, ExternalAssetItem, PluginHostContext, RegisteredPlugin } from "../plugin-types";

export const EAGLE_PLUGIN_ID = "eagle-asset-connector";
export const EAGLE_DEFAULT_BASE_URL = "http://127.0.0.1:41595";

const eaglePluginDocumentation = `# Eagle 素材库

Eagle 插件把桌面 Eagle 资料库接入影策素材面板。浏览器不会直接访问 Eagle：所有读取、搜索、下载和写入请求先到影策后端，再由后端访问管理员配置的 Eagle Local API 地址。

## 使用前准备

1. 安装并启动 Eagle 桌面客户端，打开要使用的资料库。
2. 确认 Eagle Local API 可用；默认地址为 \`${EAGLE_DEFAULT_BASE_URL}\`。
3. 以管理员身份进入插件设置，填写 Base URL 并读取文件夹。
4. 保存配置后，在素材库选择 Eagle 来源，即可浏览和导入素材。

> Eagle 必须保持运行。关闭客户端、切换资料库或修改本地 API 端口后，影策会收到连接失败，不能用空列表掩盖。

## 影策后端接口

| 操作 | 影策接口 | 用途 |
| --- | --- | --- |
| 读取资料库 | \`GET /api/plugins/eagle/library?baseUrl=...\` | 获取 Eagle 版本、资料库名称和文件夹树 |
| 列出素材 | \`GET /api/plugins/eagle/items\` | 按文件夹、关键词和分页读取素材 |
| 缩略图 | \`GET /api/plugins/eagle/items/{id}/thumbnail\` | 代理 Eagle 缩略图 |
| 原文件 | \`GET /api/plugins/eagle/items/{id}/file\` | 下载并导入影策资源存储 |
| 写入素材 | \`POST /api/plugins/eagle/items?baseUrl=...\` | 把图片、视频或音频写回 Eagle |
| 创建文件夹 | \`POST /api/plugins/eagle/folders?baseUrl=...\` | 在 Eagle 中创建目录 |

这些是影策内部登录态 API，使用 Cookie 鉴权；不要把它们当作 Eagle 官方接口直接调用。

## 浏览与搜索

插件读取 Eagle 文件夹树并生成完整层级路径。素材列表支持 \`folderId\`、\`keyword\`、\`limit\`、\`offset\`。文件夹列表在当前插件实例内缓存；创建文件夹后会失效并重新读取。切换 Eagle 资料库时应重新打开插件设置确认目录。

## 导入到影策

导入时，后端代理下载 Eagle 原文件，前端再写入影策自己的图片或媒体存储。图片保留可识别的宽高和 MIME；视频、音频和其他模型文件保留字节数、扩展名、Eagle item ID、文件夹和来源元数据。

| Eagle 内容 | 影策结果 | 当前限制 |
| --- | --- | --- |
| 图片 | 图片素材 | 使用原图，不把缩略图当成品 |
| 视频 | 视频素材 | 元数据缺宽高时使用 1280×720 展示兜底，不改写原文件 |
| 音频 | 音频素材 | 时长以浏览器媒体探测结果为准 |
| 其他文件 | 模型素材 | 仅作为文件资源保存 |
| 文本/实体 | 不支持 | 导入会明确报错 |

## 写回 Eagle

插件可把影策图片、视频或音频转换为 data URL，再调用 Eagle 添加素材。已有本地 Blob 优先直接读取；只有没有本地副本时才下载远程生成地址。默认单个手动上传文件不超过 96 MB，且 MIME 必须以 \`image/\`、\`video/\` 或 \`audio/\` 开头。

启用“自动上传生成结果”后，生成资产可以写入配置的目标文件夹。自动写回失败必须显示为写回失败，不应把“影策已保存”误报为“Eagle 已保存”。

## 配置字段

| 字段 | 说明 | 默认值 |
| --- | --- | --- |
| \`baseUrl\` | Eagle Local API 地址，只允许明确的 HTTP(S) 地址 | \`${EAGLE_DEFAULT_BASE_URL}\` |
| \`autoUploadGenerated\` | 是否把支持的生成结果自动写回 Eagle | 开启 |
| \`generatedFolderId\` | 自动写回目标文件夹 ID | 空，使用 Eagle 默认位置 |

## 安全边界

- Eagle 通常运行在本机。后端必须继续执行私网目标校验，只允许管理员明确配置的本机服务，不能把该代理变成任意 URL 抓取器。
- \`baseUrl\` 只保存服务地址，不包含 Token、Cookie 或查询密钥。
- 原文件和 data URL 不进入日志、localStorage 或错误上报。
- 多用户部署中，服务器的 \`127.0.0.1\` 指服务器自身，不是访问者电脑；这种部署需要本地 Agent/隧道方案，不能假装直连可用。

## 常见问题

| 现象 | 检查项 |
| --- | --- |
| 无法读取资料库 | Eagle 是否运行、Base URL/端口、后端能否访问该主机 |
| 文件夹为空 | Eagle 当前打开的资料库、筛选条件、文件夹层级 |
| 有缩略图但导入失败 | 原文件是否仍存在、文件权限、后端响应状态 |
| 写回失败 | 文件大小/MIME、目标文件夹是否存在、远程生成链接是否过期 |
| 部署服务器连接不到本机 Eagle | 网络拓扑不成立，需要本地桥接而不是更换前端 URL |

## 官方资料

- [Eagle API Documentation](https://api.eagle.cool/)
- [Eagle 产品与下载](https://eagle.cool/)
`;

export const eagleAssetPlugin: RegisteredPlugin = {
    manifest: {
        id: EAGLE_PLUGIN_ID,
        name: "Eagle 素材库",
        version: "0.3.0",
        publishedAt: "2026-08-21",
        updatedAt: "2026-08-22",
        apiVersion: "yingce.plugin/v1",
        description: "把 Eagle 作为影策的外部素材来源，直接浏览原始文件夹并读写 Eagle 文件。",
        documentation: eaglePluginDocumentation,
        author: "影策社区",
        permissions: ["asset.read", "asset.search", "asset.upload", "external.open"],
        trusted: true,
        configuration: {
            fields: [
                { name: "baseUrl", type: "url", label: "Eagle Base URL", required: true, default: EAGLE_DEFAULT_BASE_URL },
                { name: "autoUploadGenerated", type: "boolean", label: "自动上传生成结果", default: true },
                { name: "generatedFolderId", type: "string", label: "生成结果文件夹" },
            ],
        },
        runtime: { web: "trusted-backend" },
        contributes: { assetSources: ["eagle"] },
    },
    createAssetSource: ({ config }: PluginHostContext) => {
        const configuredBaseUrl = config.baseUrl;
        return createEagleAssetSource(typeof configuredBaseUrl === "string" && configuredBaseUrl.trim() ? configuredBaseUrl.trim() : undefined);
    },
};

export function createEagleAssetSource(baseUrl = EAGLE_DEFAULT_BASE_URL): AssetSourceProvider {
    let folderCache: EagleFolder[] | null = null;

    const getFolders = async (signal?: AbortSignal) => {
        if (signal?.aborted) throw new DOMException("请求已取消", "AbortError");
        if (!folderCache) folderCache = (await getEagleLibrary(baseUrl)).library.folders;
        return folderCache;
    };

    return {
        listFolders: async (signal) => (await getFolders(signal)).map((folder) => ({ id: folder.id, name: folder.name, parentId: folder.parentId })),
        list: async (query) => {
            const [result, folders] = await Promise.all([listEagleItems({ baseUrl, folderId: query.folderId, keyword: query.keyword, limit: query.limit, offset: query.offset }), getFolders(query.signal)]);
            const pathMap = buildFolderPathMap(folders);
            return result.items.map((item) => toExternalItem(item, baseUrl, pathMap));
        },
        importAsset: (item, signal) => importEagleAsset(item, baseUrl, signal),
        uploadAsset: (asset, signal) => uploadEagleAsset(asset, baseUrl, undefined, signal),
        uploadAssetToFolder: (asset, folderId, signal) => uploadEagleAsset(asset, baseUrl, folderId, signal),
        uploadFile: (file, folderId, signal) => uploadEagleFile(file, baseUrl, folderId, signal),
        createFolder: async (name, parentId) => {
            await createEagleFolder(baseUrl, { name, parentId });
            folderCache = null;
        },
    };
}

async function importEagleAsset(item: ExternalAssetItem, baseUrl: string, signal?: AbortSignal): Promise<Asset> {
    const kind = item.kind;
    if (kind === "text" || kind === "entity") throw new Error("当前 Eagle 导入暂不支持文本或实体素材");
    const blob = await downloadEagleItem(item.id, baseUrl, signal);
    const now = new Date().toISOString();
    const metadata = {
        source: "eagle",
        eagle: {
            itemId: item.id,
            baseUrl,
            folderId: item.folderId,
            folderIds: item.folderIds || [],
            folderPath: item.folderPath || [],
            extension: item.metadata?.extension,
        },
    };
    if (kind === "image") {
        const uploaded = await uploadImage(blob);
        return {
            id: nanoid(), kind, title: item.title, coverUrl: uploaded.url, tags: item.tags || [], source: "Eagle 素材库", createdAt: now, updatedAt: now, metadata,
            data: { dataUrl: uploaded.url, storageKey: uploaded.storageKey, width: item.width || uploaded.width, height: item.height || uploaded.height, bytes: uploaded.bytes, mimeType: uploaded.mimeType },
        };
    }
    const uploaded = await uploadMediaFile(blob, `eagle-${kind}`);
    if (kind === "video") {
        return {
            id: nanoid(), kind, title: item.title, coverUrl: "", tags: item.tags || [], source: "Eagle 素材库", createdAt: now, updatedAt: now, metadata,
            data: { url: uploaded.url, storageKey: uploaded.storageKey, width: item.width || uploaded.width || 1280, height: item.height || uploaded.height || 720, bytes: uploaded.bytes, mimeType: uploaded.mimeType },
        };
    }
    if (kind === "audio") {
        return {
            id: nanoid(), kind, title: item.title, coverUrl: "", tags: item.tags || [], source: "Eagle 素材库", createdAt: now, updatedAt: now, metadata,
            data: { url: uploaded.url, storageKey: uploaded.storageKey, durationMs: uploaded.durationMs, bytes: uploaded.bytes, mimeType: uploaded.mimeType },
        };
    }
    return {
        id: nanoid(), kind: "model", title: item.title, coverUrl: "", tags: item.tags || [], source: "Eagle 素材库", createdAt: now, updatedAt: now, metadata,
        data: { url: uploaded.url, storageKey: uploaded.storageKey, bytes: uploaded.bytes, mimeType: uploaded.mimeType, fileName: item.title },
    };
}

type EagleWritableAsset = Extract<Asset, { kind: "image" | "video" | "audio" }>;

async function uploadEagleAsset(asset: Asset, baseUrl: string, folderId?: string, signal?: AbortSignal): Promise<ExternalAssetItem> {
    if (!isEagleWritableAsset(asset)) throw new Error("当前仅支持将图片、视频或音频写回 Eagle");
    const dataUrl = await assetToDataUrl(asset, signal);
    const result = await addEagleItem(baseUrl, {
        url: dataUrl,
        name: eagleAssetName(asset),
        folderId,
        tags: asset.tags,
        annotation: asset.note,
        website: typeof asset.metadata?.eagle === "object" && asset.metadata.eagle && "url" in asset.metadata.eagle ? String(asset.metadata.eagle.url || "") : undefined,
    });
    return { id: result.item.id || "eagle:" + asset.id, title: eagleAssetName(asset), kind: asset.kind, tags: asset.tags, mimeType: asset.data.mimeType };
}

function isEagleWritableAsset(asset: Asset): asset is EagleWritableAsset {
    return asset.kind === "image" || asset.kind === "video" || asset.kind === "audio";
}

async function assetToDataUrl(asset: EagleWritableAsset, signal?: AbortSignal) {
    if (asset.kind === "image") {
        return imageToDataUrl({ dataUrl: asset.data.dataUrl, storageKey: asset.data.storageKey, url: asset.data.dataUrl, name: asset.title, mimeType: asset.data.mimeType });
    }
    const stored = asset.data.storageKey ? await getMediaBlob(asset.data.storageKey) : null;
    if (stored) return fileToDataUrl(withMimeType(stored, asset.data.mimeType), signal);
    const url = asset.data.url;
    if (!url) throw new Error("生成结果没有可写入 Eagle 的媒体地址");
    if (url.startsWith("data:")) return url;
    const response = await fetch(url, { credentials: "include", signal });
    if (!response.ok) throw new Error("读取生成媒体失败，无法写入 Eagle");
    return fileToDataUrl(withMimeType(await response.blob(), asset.data.mimeType), signal);
}

function eagleAssetName(asset: EagleWritableAsset) {
    const title = asset.title.trim() || (asset.kind === "image" ? "生成图片" : asset.kind === "video" ? "生成视频" : "生成音频");
    if (/\.[a-z0-9]{2,8}$/i.test(title)) return title;
    const extension = asset.kind === "image" ? extensionFromMime(asset.data.mimeType, "png") : asset.kind === "video" ? extensionFromMime(asset.data.mimeType, "mp4") : extensionFromMime(asset.data.mimeType, "mp3");
    return title + "." + extension;
}

function extensionFromMime(mimeType: string, fallback: string) {
    const value = mimeType.toLowerCase();
    if (value.includes("png")) return "png";
    if (value.includes("jpeg") || value.includes("jpg")) return "jpg";
    if (value.includes("webm")) return "webm";
    if (value.includes("quicktime")) return "mov";
    if (value.includes("wav")) return "wav";
    if (value.includes("ogg")) return "ogg";
    if (value.includes("mp4")) return "mp4";
    if (value.includes("mpeg") || value.includes("mp3")) return "mp3";
    return fallback;
}

function withMimeType(blob: Blob, mimeType: string) {
    return mimeType && blob.type !== mimeType ? blob.slice(0, blob.size, mimeType) : blob;
}
async function uploadEagleFile(file: File, baseUrl: string, folderId?: string, signal?: AbortSignal): Promise<ExternalAssetItem> {
    if (file.size > 96 * 1024 * 1024) throw new Error("单个文件不能超过 96 MB");
    if (!isEagleMediaType(file.type)) throw new Error("Eagle 写入目前支持图片、视频和音频文件");
    const dataUrl = await fileToDataUrl(file, signal);
    const result = await addEagleItem(baseUrl, {
        url: dataUrl,
        name: file.name,
        folderId,
    });
    const itemId = result.item.id || "eagle:" + nanoid();
    const extension = file.name.includes(".") ? file.name.split(".").pop() || "" : "";
    return {
        id: itemId,
        title: file.name,
        kind: kindFromExtension(extension),
        thumbnailUrl: result.item.id ? eagleItemThumbnailUrl(result.item.id, baseUrl) : undefined,
        fileUrl: result.item.id ? eagleItemFileUrl(result.item.id, baseUrl) : undefined,
        mimeType: file.type || mimeTypeFromExtension(extension),
        bytes: file.size,
        folderId,
        folderIds: folderId ? [folderId] : [],
        metadata: { extension },
    };
}

function isEagleMediaType(mimeType: string) {
    const value = mimeType.toLowerCase();
    return value.startsWith("image/") || value.startsWith("video/") || value.startsWith("audio/");
}
function fileToDataUrl(file: Blob, signal?: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        const cleanup = () => signal?.removeEventListener("abort", abort);
        const abort = () => {
            reader.abort();
            cleanup();
            reject(new DOMException("请求已取消", "AbortError"));
        };
        reader.onload = () => {
            cleanup();
            if (typeof reader.result !== "string") {
                reject(new Error("无法读取待写入的文件"));
                return;
            }
            resolve(reader.result);
        };
        reader.onerror = () => {
            cleanup();
            reject(new Error("无法读取待写入的文件"));
        };
        if (signal?.aborted) {
            abort();
            return;
        }
        signal?.addEventListener("abort", abort, { once: true });
        reader.readAsDataURL(file);
    });
}

function toExternalItem(item: EagleItem, baseUrl: string, pathMap: Map<string, string[]>) {
    const kind = kindFromExtension(item.extension);
    const folderIds = item.folderIds || [];
    const tags = item.tags || [];
    return {
        id: item.id,
        title: item.name,
        kind,
        thumbnailUrl: eagleItemThumbnailUrl(item.id, baseUrl),
        fileUrl: eagleItemFileUrl(item.id, baseUrl),
        mimeType: mimeTypeFromExtension(item.extension),
        width: item.width,
        height: item.height,
        bytes: item.size,
        tags,
        folderId: folderIds[0],
        folderIds,
        folderPath: folderIds[0] ? pathMap.get(folderIds[0]) : [],
        description: item.annotation,
        metadata: { extension: item.extension, modificationTime: item.modificationTime, url: item.url, deleted: item.deleted },
    } satisfies ExternalAssetItem;
}

function buildFolderPathMap(folders: EagleFolder[]) {
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const result = new Map<string, string[]>();
    for (const folder of folders) {
        const path: string[] = [];
        const seen = new Set<string>();
        let current: EagleFolder | undefined = folder;
        while (current && !seen.has(current.id)) {
            seen.add(current.id);
            path.unshift(current.name);
            current = current.parentId ? byId.get(current.parentId) : undefined;
        }
        result.set(folder.id, path);
    }
    return result;
}

function kindFromExtension(extension: string): Asset["kind"] {
    const value = extension.toLowerCase();
    if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif", "svg"].includes(value)) return "image";
    if (["mp4", "mov", "webm", "mkv", "avi"].includes(value)) return "video";
    if (["mp3", "wav", "m4a", "aac", "flac", "ogg"].includes(value)) return "audio";
    if (["glb", "gltf", "obj", "fbx", "usdz", "blend"].includes(value)) return "model";
    return "model";
}

function mimeTypeFromExtension(extension: string) {
    const value = extension.toLowerCase();
    if (["jpg", "jpeg"].includes(value)) return "image/jpeg";
    if (value === "png") return "image/png";
    if (value === "webp") return "image/webp";
    if (value === "gif") return "image/gif";
    if (value === "svg") return "image/svg+xml";
    if (value === "mp4") return "video/mp4";
    if (value === "webm") return "video/webm";
    if (value === "mp3") return "audio/mpeg";
    if (value === "wav") return "audio/wav";
    if (value === "glb") return "model/gltf-binary";
    return "application/octet-stream";
}


registerPlugin(eagleAssetPlugin);
