import { saveAs } from "file-saver";
import { readZip } from "@/lib/zip";
import { MediaPackage } from "@/lib/media-package";
import { createClientUUID } from "@/lib/client-id";
import { isResourceUrl } from "@/services/api/resources";
import { setMediaBlob } from "@/services/file-storage";
import { setImageBlob } from "@/services/image-storage";
import type { Asset } from "@/stores/use-asset-store";
import type { CanvasExportAsset } from "@/types/canvas-export";

type AssetExportFile = { app: "yingce"; version: 1; exportedAt: string; assets: Asset[]; files: CanvasExportAsset[] };

export async function exportAssets(assets: Asset[]): Promise<void> {
    const media = assets.filter((asset) => ["image", "video", "audio", "model"].includes(asset.kind));
    const images = new Set<string>();
    const keys: string[] = [];
    for (const asset of media) {
        if (!("storageKey" in asset.data) || typeof asset.data.storageKey !== "string" || !asset.data.storageKey) continue;
        keys.push(asset.data.storageKey);
        if (asset.kind === "image") images.add(asset.data.storageKey);
    }
    const archive = new MediaPackage();
    const manifest: AssetExportFile = { app: "yingce", version: 1, assets, exportedAt: new Date().toISOString(), files: await archive.collect(keys, "files", images) };
    saveAs(await archive.finish("assets.json", manifest), "我的素材.zip");
}

export async function readAssetPackage(file: File): Promise<Asset[]> {
    const archive = await readZip(file);
    const manifestBlob = archive.get("assets.json");
    if (!manifestBlob) throw new Error("素材包缺少 assets.json");
    const manifest: unknown = JSON.parse(await manifestBlob.text());
    if (
        !manifest ||
        typeof manifest !== "object" ||
        !("app" in manifest) ||
        manifest.app !== "yingce" ||
        !("version" in manifest) ||
        manifest.version !== 1 ||
        !("assets" in manifest) ||
        !Array.isArray(manifest.assets) ||
        !("files" in manifest) ||
        !Array.isArray(manifest.files)
    )
        throw new Error("素材包格式或版本不受支持");
    const images = new Set<string>();
    for (const asset of manifest.assets) {
        if (!asset || typeof asset !== "object" || typeof asset.id !== "string" || !asset.data || typeof asset.data !== "object" || typeof asset.kind !== "string") throw new Error("素材包包含无效素材");
        if (asset.kind === "image" && typeof asset.data.storageKey === "string") images.add(asset.data.storageKey);
    }
    // Validate the whole manifest before making the first persistent write.
    const writes = manifest.files.map((entry: unknown) => {
        if (
            !entry ||
            typeof entry !== "object" ||
            !("storageKey" in entry) ||
            typeof entry.storageKey !== "string" ||
            !entry.storageKey ||
            !("path" in entry) ||
            typeof entry.path !== "string" ||
            !("mimeType" in entry) ||
            typeof entry.mimeType !== "string"
        )
            throw new Error("素材包文件索引无效");
        const blob = archive.get(entry.path);
        if (!blob) throw new Error(`素材包缺少文件：${entry.path}`);
        if ("bytes" in entry && entry.bytes !== blob.size) throw new Error(`素材包文件大小不匹配：${entry.path}`);
        return { key: entry.storageKey, blob: blob.slice(0, blob.size, entry.mimeType) };
    });
    const importedMedia = new Map<string, { storageKey: string; url: string }>();
    for (const { key, blob } of writes) {
        const kind = images.has(key) || key.startsWith("image:") ? "image" : blob.type.startsWith("video/") ? "video" : blob.type.startsWith("audio/") ? "audio" : "file";
        // 导出包里的 resource ID 属于来源账号；新本地键由现有同步流程上传到目标账号。
        const storageKey = `${kind}:${createClientUUID()}`;
        const url = await (kind === "image" ? setImageBlob(storageKey, blob) : setMediaBlob(storageKey, blob));
        importedMedia.set(key, { storageKey, url });
    }
    const assets = structuredClone(manifest.assets) as Asset[];
    for (const asset of assets) {
        // 包里没有目标账号的文件夹与素材版本，导入记录从未分类的新素材开始。
        delete asset.folderId;
        delete asset.primaryVersionId;
        if (asset.kind === "text" || asset.kind === "entity") continue;
        const media = asset.data.storageKey ? importedMedia.get(asset.data.storageKey) : undefined;
        if (!media) continue;
        const previousURL = asset.kind === "image" ? asset.data.dataUrl : asset.data.url;
        asset.data.storageKey = media.storageKey;
        if (asset.kind === "image") asset.data.dataUrl = media.url;
        else asset.data.url = media.url;
        if (asset.coverUrl === previousURL || isResourceUrl(asset.coverUrl)) asset.coverUrl = asset.kind === "image" ? media.url : "";
    }
    return assets;
}
