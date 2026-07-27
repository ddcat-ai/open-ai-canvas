import { canvasNodeToAsset, declaredCanvasNodeAssetCategory, findCanvasNodeAsset, type CanvasAssetSource } from "@/lib/canvas/canvas-node-asset";
import { linkProjectAsset, updateProjectAssetCategory } from "@/services/api/projects";
import { saveRemoteUserDataNow } from "@/services/user-data-sync";
import { useAssetStore, type AssetCategory, type AssetStatus } from "@/stores/use-asset-store";
import type { CanvasNodeData } from "@/types/canvas";

type EnsureCanvasNodeAssetOptions = {
    canvasId: string;
    domainProjectId?: string;
    node: CanvasNodeData;
    source: CanvasAssetSource;
    taskId?: string;
    category?: AssetCategory;
};

export type CanvasNodeAssetResult = {
    assetId: string;
    created: boolean;
    linkedToProject: boolean;
};

const pendingAssetSyncs = new Map<string, Promise<CanvasNodeAssetResult>>();

export function ensureCanvasNodeAsset(options: EnsureCanvasNodeAssetOptions) {
    const identity = options.taskId || options.node.metadata?.taskId || options.node.metadata?.storageKey || options.node.id;
    const key = [options.domainProjectId || "personal", options.canvasId, options.node.id, identity].join(":");
    const pending = pendingAssetSyncs.get(key);
    if (pending) return pending;
    const request = persistCanvasNodeAsset(options).finally(() => pendingAssetSyncs.delete(key));
    pendingAssetSyncs.set(key, request);
    return request;
}

async function persistCanvasNodeAsset(options: EnsureCanvasNodeAssetOptions): Promise<CanvasNodeAssetResult> {
    const store = useAssetStore.getState();
    let asset = findCanvasNodeAsset(store.assets, options.node, options.canvasId, options.taskId);
    const declaredCategory = options.category || declaredCanvasNodeAssetCategory(options.node);
    let created = false;
    if (!asset) {
        const input = canvasNodeToAsset(options.node, { canvasId: options.canvasId, source: options.source, taskId: options.taskId });
        if (!input) throw new Error("当前节点没有可保存的素材内容");
        const assetId = store.addAsset(options.category ? { ...input, category: options.category } : input);
        asset = useAssetStore.getState().assets.find((item) => item.id === assetId);
        created = true;
    }
    if (!asset) throw new Error("素材写入本地失败");
    if (declaredCategory && asset.category !== declaredCategory) {
        store.updateAsset(asset.id, { category: declaredCategory });
        asset = useAssetStore.getState().assets.find((item) => item.id === asset?.id) || asset;
    }
    if (!options.domainProjectId) return { assetId: asset.id, created, linkedToProject: false };
    const linkedProjectIds = Array.isArray(asset.metadata?.projectIds) ? asset.metadata.projectIds.filter((id): id is string => typeof id === "string") : [];

    // 项目关联依赖后端 assets 记录，先强制完成素材同步，不能依赖延迟自动同步的时序。
    await saveRemoteUserDataNow();
    const { asset: linkedAsset } = await linkProjectAsset(options.domainProjectId, {
        assetId: asset.id,
        category: declaredCategory || asset.category || "other",
    });
    const linked = declaredCategory && linkedAsset.category !== declaredCategory
        ? (await updateProjectAssetCategory(options.domainProjectId, asset.id, declaredCategory)).asset
        : linkedAsset;
    useAssetStore.getState().updateAsset(asset.id, {
        category: linked.category as AssetCategory,
        status: linked.status as AssetStatus,
        primaryVersionId: linked.primaryVersionId,
        metadata: { ...asset.metadata, projectIds: [...new Set([...linkedProjectIds, options.domainProjectId])] },
    });
    await saveRemoteUserDataNow();
    return { assetId: asset.id, created, linkedToProject: true };
}
