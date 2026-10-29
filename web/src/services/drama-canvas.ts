import { getDramaCanvas, registerDramaCanvasAssets } from "@/services/api/drama";
import { createCanvasProjectWithRemoteSync, loadAssetsForUse, localSavedRemotePendingMessage, saveRemoteUserDataNow } from "@/services/user-data-sync";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";

// 短剧 ↔ 精修画布的副作用：找到或新建作品的精修画布、拼跳转地址、为投送的媒体登记素材记录。

export const DRAMA_CANVAS_PARAM = "drama";
export const DRAMA_CANVAS_FOCUS_PARAM = "dramaFocus";

/** 从制作台跳到画布时要投送或定位的对象；cut 表示把这一集的剪辑载入画布时间线。 */
export type DramaCanvasFocus = { kind: "cast"; castId: string } | { kind: "segment"; episodeId: string; segmentIndex: number } | { kind: "episode"; episodeId: string } | { kind: "final"; episodeId: string } | { kind: "cut"; episodeId: string };

export function encodeDramaCanvasFocus(focus: DramaCanvasFocus) {
    switch (focus.kind) {
        case "cast":
            return `cast:${focus.castId}`;
        case "segment":
            return `segment:${focus.episodeId}:${focus.segmentIndex}`;
        default:
            return `${focus.kind}:${focus.episodeId}`;
    }
}

export function parseDramaCanvasFocus(value: string | null | undefined): DramaCanvasFocus | null {
    const [kind, id, index] = (value || "").split(":");
    if (!id) return null;
    if (kind === "cast") return { kind, castId: id };
    if (kind === "segment") {
        const segmentIndex = Number(index);
        return Number.isInteger(segmentIndex) && segmentIndex >= 0 ? { kind, episodeId: id, segmentIndex } : null;
    }
    if (kind === "episode" || kind === "final" || kind === "cut") return { kind, episodeId: id };
    return null;
}

/** 作品的精修画布：服务端最近使用的关联画布，其次是本机尚未同步的关联画布，都没有时新建。 */
export async function resolveDramaCanvas(drama: { id: string; name: string }) {
    const { canvasId } = await getDramaCanvas(drama.id);
    if (canvasId) return canvasId;
    const local = useCanvasStore
        .getState()
        .projects.filter((project) => project.projectId === drama.id)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    if (local) return local.id;
    const created = await createCanvasProjectWithRemoteSync(`${drama.name} · 精修画布`, drama.id);
    if (created.syncError) console.warn("精修画布已在本机创建，云端保存稍后重试", created.syncError);
    return created.id;
}

export function dramaCanvasPath(canvasId: string, dramaId: string, focus?: DramaCanvasFocus) {
    const params = new URLSearchParams({ [DRAMA_CANVAS_PARAM]: dramaId });
    if (focus) params.set(DRAMA_CANVAS_FOCUS_PARAM, encodeDramaCanvasFocus(focus));
    return `/canvas/${encodeURIComponent(canvasId)}?${params.toString()}`;
}

export async function openDramaCanvasPath(drama: { id: string; name: string }, focus?: DramaCanvasFocus) {
    return dramaCanvasPath(await resolveDramaCanvas(drama), drama.id, focus);
}

export type DramaCanvasAssetItem = { resourceId: string; title?: string; category?: string };

const DRAMA_ASSET_BATCH = 64;

/**
 * 为投送到画布的短剧媒体登记素材记录并载入本机素材库：画布保存要求媒体节点由当前用户的素材引用资源。
 * 同一资源服务端只登记一次，重复投送直接复用。返回值里缺少的资源已不可用，由调用方决定是否继续。
 */
export async function ensureDramaCanvasAssets(dramaId: string, items: DramaCanvasAssetItem[]) {
    const byResource = new Map<string, DramaCanvasAssetItem>();
    for (const item of items) if (item.resourceId && !byResource.has(item.resourceId)) byResource.set(item.resourceId, item);
    const pending = [...byResource.values()];
    const assetIds = new Map<string, string>();
    for (let offset = 0; offset < pending.length; offset += DRAMA_ASSET_BATCH) {
        const { assets } = await registerDramaCanvasAssets(dramaId, pending.slice(offset, offset + DRAMA_ASSET_BATCH));
        for (const asset of assets) assetIds.set(asset.resourceId, asset.assetId);
    }
    if (assetIds.size) await loadAssetsForUse([...new Set(assetIds.values())]);
    return assetIds;
}

/**
 * 画布分镜交给短剧自动制作后，把原画布关联到新作品，成为它的精修画布；已关联其他项目的画布不改。
 * 本地关联立即生效；云端同步失败时返回提示文案由调用方展示，关联不回滚。
 */
export async function linkCanvasToDrama(canvasId: string, dramaId: string): Promise<{ linked: boolean; warning?: string }> {
    const store = useCanvasStore.getState();
    const canvas = store.projects.find((project) => project.id === canvasId);
    if (!canvas || canvas.projectId) return { linked: false };
    store.updateProject(canvasId, { projectId: dramaId });
    try {
        await saveRemoteUserDataNow(canvasId);
        return { linked: true };
    } catch (error) {
        return { linked: true, warning: localSavedRemotePendingMessage("画布已在本机关联到新短剧", error) };
    }
}
