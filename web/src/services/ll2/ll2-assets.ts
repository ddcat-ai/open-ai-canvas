/**
 * DMC C 端「本机资产库」：读影策原有的 useAssetStore（IndexedDB / 免登录可用）。
 *
 * 为什么不用影策原版 /assets 页：那页的上传走 /api/resources、官方素材库 / 方舟认证 /
 * 跨设备同步都要登录态会话；C 端是免登录 BYOK，那些按钮会变成点不动的死入口。
 * 这里写同一个 store，所以**以前在影策存过的本机素材也能看到**，但新上传完全不碰后端。
 *
 * 存储分工（照顾低配机，别把大 base64 塞进 zustand 的持久化 JSON）：
 *   图片  → data.dataUrl 直接存 data URI，缩略图和提交都能直接用
 *   视频  → setMediaBlob 把 Blob 存进本机 localForage，store 里只留 storageKey 元数据
 * 历史云端素材（只有远端 URL、本机无 Blob）会在引用时明确报错，不假装可用。
 */

import { getMediaBlob, setMediaBlob } from "@/services/file-storage";
import { ll2HomeMediaKindOf, type LL2MediaInput } from "@/services/ll2/ll2-media";
import { flushAssetStorePersistence, useAssetStore, type Asset, type AssetCategory } from "@/stores/use-asset-store";

export type LL2LibraryKind = "image" | "video";

export type LL2LibraryItem = {
    id: string;
    title: string;
    kind: LL2LibraryKind;
    /** 图片是 data URI；视频为空，界面用图标占位。 */
    coverUrl: string;
    bytes: number;
    mimeType: string;
    durationSeconds: number;
    createdAt: string;
    archived: boolean;
};

type LibraryAsset = Extract<Asset, { kind: "image" | "video" }>;

function toItem(asset: LibraryAsset): LL2LibraryItem {
    return {
        id: asset.id,
        title: asset.title || "未命名素材",
        kind: asset.kind,
        coverUrl: asset.kind === "image" ? asset.data.dataUrl : "",
        bytes: asset.data.bytes,
        mimeType: asset.data.mimeType,
        durationSeconds: asset.kind === "video" && asset.data.durationMs ? asset.data.durationMs / 1000 : 0,
        createdAt: asset.createdAt,
        archived: asset.status === "archived",
    };
}

/** 资产库列表：包含影策历史本机素材（image / video 两类）。默认不含回收站。 */
export function ll2LibraryItems(options: { includeArchived?: boolean } = {}): LL2LibraryItem[] {
    return useAssetStore.getState().assets
        .filter((asset): asset is LibraryAsset => asset.kind === "image" || asset.kind === "video")
        .map(toItem)
        .filter((item) => options.includeArchived || !item.archived);
}

function findAsset(id: string): Asset | undefined {
    return useAssetStore.getState().assets.find((entry) => entry.id === id);
}

/** @[名称] 靠名字解析，所以上传 / 重命名时都保证标题唯一，避免引用歧义。 */
function uniqueTitle(base: string, taken: readonly string[], exceptId?: string): string {
    const clean = base.trim().replace(/[\[\]\n]/g, "") || "素材";
    const others = ll2LibraryItems({ includeArchived: true })
        .filter((item) => item.id !== exceptId)
        .map((item) => item.title);
    const blocked = [...taken, ...others];
    if (!blocked.includes(clean)) return clean;
    for (let n = 2; n < 100; n += 1) {
        const next = `${clean} (${n})`;
        if (!blocked.includes(next)) return next;
    }
    return `${clean} (${Date.now()})`;
}

function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("读取文件失败，换一个试试"));
        reader.readAsDataURL(blob);
    });
}

function readImageSize(dataUrl: string): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => reject(new Error("浏览器读不了这张图的尺寸，请换 JPG / PNG / WebP"));
        image.src = dataUrl;
    });
}

/** 视频时长尽力读取；读不出返回 0，由提交前校验决定是否放行（不冒充已校验）。 */
function readVideoDurationMs(file: File): Promise<number> {
    if (typeof document === "undefined") return Promise.resolve(0);
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    return new Promise((resolve) => {
        const finish = (value: number) => {
            URL.revokeObjectURL(url);
            resolve(Number.isFinite(value) && value > 0 ? Math.round(value * 1000) : 0);
        };
        const timer = window.setTimeout(() => finish(0), 5000);
        video.preload = "metadata";
        video.onloadedmetadata = () => {
            window.clearTimeout(timer);
            finish(video.duration);
        };
        video.onerror = () => {
            window.clearTimeout(timer);
            finish(0);
        };
        video.src = url;
    });
}

/** 上传一个文件到本机资产库，返回新素材 ID。 */
export async function ll2UploadAsset(file: File): Promise<string> {
    const kind = ll2HomeMediaKindOf(file);
    if (!kind) throw new Error(`「${file.name}」不是图片或视频；可上传 JPG / PNG / WebP / HEIC 图片，或 MP4 / MOV 视频`);
    const title = uniqueTitle(file.name.replace(/\.[^.]+$/, ""), []);
    const mimeType = file.type || "application/octet-stream";
    const common = { title, tags: ["DMC"], source: "dmc-local" };

    if (kind === "image") {
        const dataUrl = await blobToDataUrl(file);
        const { width, height } = await readImageSize(dataUrl);
        const id = useAssetStore.getState().addAsset({
            ...common,
            kind: "image",
            coverUrl: dataUrl,
            data: { dataUrl, width, height, bytes: file.size, mimeType },
        });
        await flushAssetStorePersistence();
        return id;
    }

    const durationMs = await readVideoDurationMs(file);
    const storageKey = `dmc-local-media-${crypto.randomUUID()}`;
    await setMediaBlob(storageKey, file);
    const id = useAssetStore.getState().addAsset({
        ...common,
        kind: "video",
        coverUrl: "",
        data: { url: "", storageKey, width: 0, height: 0, ...(durationMs ? { durationMs } : {}), bytes: file.size, mimeType },
    });
    await flushAssetStorePersistence();
    return id;
}

/**
 * 首页拖图 / 选图后，带上用户填的标题、分类、标签存进本机资产库。
 * 与「拖进来直接当首帧」不同：这里是把图变成可复用素材，之后在句子里 @ 引用它。
 */
export async function ll2SaveImageAsset(
    file: File,
    meta: { title?: string; category?: AssetCategory; tags?: string[] } = {},
): Promise<{ id: string; title: string; dataUrl: string }> {
    if (!file.type.startsWith("image/")) throw new Error("这里只能存图片；视频请到资产页上传");
    const dataUrl = await blobToDataUrl(file);
    const { width, height } = await readImageSize(dataUrl);
    const fallback = file.name.replace(/\.[^.]+$/, "").trim() || "未命名素材";
    const title = uniqueTitle(String(meta.title || "").trim() || fallback, []);
    const tags = (meta.tags || []).map((tag) => tag.trim()).filter(Boolean);
    const id = useAssetStore.getState().addAsset({
        kind: "image",
        title,
        coverUrl: dataUrl,
        tags: tags.length ? tags : ["DMC"],
        category: meta.category || "other",
        source: "dmc-local",
        data: { dataUrl, width, height, bytes: file.size, mimeType: file.type || "image/png" },
    });
    await flushAssetStorePersistence();
    return { id, title, dataUrl };
}

/** 重命名（保证标题唯一，@ 引用不会串台）。 */
export async function ll2RenameAsset(id: string, nextTitle: string): Promise<string> {
    const asset = findAsset(id);
    if (!asset) throw new Error("素材已经不在资产库里了");
    const title = uniqueTitle(nextTitle, [], id);
    useAssetStore.getState().updateAsset(id, { title });
    await flushAssetStorePersistence();
    return title;
}

/** 移入回收站 / 还原。软删除用影策自带的 archived 状态，不真删文件。 */
export async function ll2SetAssetArchived(id: string, archived: boolean): Promise<void> {
    useAssetStore.getState().updateAsset(id, { status: archived ? "archived" : "confirmed" });
    await flushAssetStorePersistence();
}

/** 彻底删除（回收站里用）；同时清理本机 Blob 由 store 负责。 */
export async function ll2RemoveAsset(id: string): Promise<void> {
    await useAssetStore.getState().removeAsset(id);
    await flushAssetStorePersistence();
}

/** 预览 / 下载 / 提交共用的可访问地址：图片直接 data URI，视频从本机 Blob 还原。 */
export async function ll2AssetMediaUrl(id: string): Promise<string> {
    const asset = findAsset(id);
    if (!asset || (asset.kind !== "image" && asset.kind !== "video")) {
        throw new Error("素材已经不在资产库里了");
    }
    if (asset.kind === "image") {
        if (asset.data.dataUrl.startsWith("data:")) return asset.data.dataUrl;
        if (asset.data.storageKey) {
            const blob = await getMediaBlob(asset.data.storageKey);
            if (blob) return blobToDataUrl(blob);
        }
    } else {
        if (asset.data.storageKey) {
            const blob = await getMediaBlob(asset.data.storageKey);
            if (blob) return blobToDataUrl(blob);
        }
        if (asset.data.url.startsWith("data:")) return asset.data.url;
    }
    throw new Error(`「${asset.title}」是云端素材，这台电脑上没有缓存；请重新上传一次`);
}

/** 被 @ 引用时，把资产还原成 ll2-media.ts 能提交的 data URI 素材。 */
export async function ll2AssetToMediaInput(id: string): Promise<LL2MediaInput> {
    const asset = findAsset(id);
    if (!asset || (asset.kind !== "image" && asset.kind !== "video")) {
        throw new Error("引用的素材已经不在资产库里了，请重新选一个");
    }
    if (asset.status === "archived") throw new Error(`「${asset.title}」在回收站里，请先还原再引用`);
    const dataUrl = await ll2AssetMediaUrl(id);
    if (!dataUrl.startsWith("data:")) throw new Error(`「${asset.title}」不是本机文件，请重新上传一次`);
    const durationSeconds = asset.kind === "video" && asset.data.durationMs ? asset.data.durationMs / 1000 : 0;
    return {
        id: `asset-${asset.id}`,
        kind: asset.kind,
        name: asset.title,
        mimeType: asset.data.mimeType,
        bytes: dataUrl.length,
        encodedBytes: dataUrl.length,
        dataUrl,
        durationSeconds,
    };
}

/** 供 @ 解析用：按标题找资产，标题在上传/重命名时已保证唯一；回收站里的不算。 */
export function ll2AssetIdByTitle(title: string): string | null {
    const hit = useAssetStore.getState().assets.find(
        (asset) => (asset.kind === "image" || asset.kind === "video") && asset.title === title && asset.status !== "archived",
    );
    return hit?.id || null;
}
