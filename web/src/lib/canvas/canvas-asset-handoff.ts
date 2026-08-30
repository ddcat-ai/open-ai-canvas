import type { InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import type { Asset } from "@/stores/use-asset-store";

const ASSET_PARAM = "asset";
const unique = (values: Iterable<string>) => Array.from(new Set(Array.from(values, (value) => value.trim()).filter(Boolean)));

export function creationCanvasHandoffPath(assetIds: Iterable<string>, expectedCount?: number) {
    const ids = unique(assetIds);
    if (!ids.length || (expectedCount !== undefined && ids.length !== expectedCount)) return undefined;
    const params = new URLSearchParams({ mode: "handoff" });
    ids.forEach((id) => params.append(ASSET_PARAM, id));
    return `/canvas?${params.toString()}`;
}

export function canvasAssetHandoffIds(searchParams: URLSearchParams) {
    return unique(searchParams.getAll(ASSET_PARAM));
}

export function consumeCanvasAssetHandoff(searchParams: URLSearchParams) {
    const next = new URLSearchParams(searchParams);
    next.delete("mode");
    next.delete(ASSET_PARAM);
    return next;
}

export function canvasAssetHandoffPayloads(assets: Asset[], assetIds: Iterable<string>) {
    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    const payloads: InsertAssetPayload[] = [];
    const missingAssetIds: string[] = [];

    unique(assetIds).forEach((assetId) => {
        const asset = byId.get(assetId);
        if (asset?.kind === "image") {
            payloads.push({ kind: "image", dataUrl: asset.data.dataUrl, storageKey: asset.data.storageKey, title: asset.title, assetId: asset.id });
            return;
        }
        if (asset?.kind === "video") {
            payloads.push({
                kind: "video",
                url: asset.data.url,
                storageKey: asset.data.storageKey,
                title: asset.title,
                width: asset.data.width,
                height: asset.data.height,
                durationMs: asset.data.durationMs,
                hasAudio: asset.data.hasAudio,
                bytes: asset.data.bytes,
                mimeType: asset.data.mimeType,
                assetId: asset.id,
            });
            return;
        }
        missingAssetIds.push(assetId);
    });

    return { payloads, missingAssetIds };
}

export function canvasAssetHandoffAttempt(assets: Asset[], searchParams: URLSearchParams) {
    const assetIds = canvasAssetHandoffIds(searchParams);
    const { payloads, missingAssetIds } = canvasAssetHandoffPayloads(assets, assetIds);
    return { kind: assetIds.length && !missingAssetIds.length ? ("ready" as const) : ("retry" as const), assetIds, payloads: missingAssetIds.length ? [] : payloads, missingAssetIds };
}

export function uninsertedCanvasAssetHandoffPayloads(nodes: Iterable<{ metadata?: { assetId?: unknown } }>, payloads: InsertAssetPayload[]) {
    const insertedAssetIds = new Set(Array.from(nodes, (node) => (typeof node.metadata?.assetId === "string" ? node.metadata.assetId : "")).filter(Boolean));
    return payloads.filter((payload) => !payload.assetId || !insertedAssetIds.has(payload.assetId));
}

export function creationResultAssetIds(assets: Asset[], input: { messageId: string; taskIds: string[]; resultUrls: string[] }) {
    const taskOrder = new Map(input.taskIds.map((taskId, index) => [taskId, index]));
    const candidates = assets
        .filter((asset) => asset.kind === "image" || asset.kind === "video")
        .filter((asset) => asset.metadata?.source === "create-generation" || asset.metadata?.source === "generation-task")
        .filter((asset) => asset.metadata?.messageId === input.messageId || (typeof asset.metadata?.taskId === "string" && taskOrder.has(asset.metadata.taskId)))
        .sort((left, right) => {
            const leftTask = typeof left.metadata?.taskId === "string" ? (taskOrder.get(left.metadata.taskId) ?? Number.MAX_SAFE_INTEGER) : 0;
            const rightTask = typeof right.metadata?.taskId === "string" ? (taskOrder.get(right.metadata.taskId) ?? Number.MAX_SAFE_INTEGER) : 0;
            if (leftTask !== rightTask) return leftTask - rightTask;
            const leftResult = typeof left.metadata?.outputIndex === "number" ? left.metadata.outputIndex : typeof left.metadata?.resultIndex === "number" ? left.metadata.resultIndex : 0;
            const rightResult = typeof right.metadata?.outputIndex === "number" ? right.metadata.outputIndex : typeof right.metadata?.resultIndex === "number" ? right.metadata.resultIndex : 0;
            return leftResult - rightResult;
        });
    const unused = new Set(candidates.map((asset) => asset.id));
    const allowOrderedFallback = candidates.length === input.resultUrls.length;
    return input.resultUrls.flatMap((url) => {
        const exact = candidates.find((asset) => unused.has(asset.id) && (asset.coverUrl === url || (asset.kind === "image" ? asset.data.dataUrl === url : asset.data.url === url)));
        const fallback = exact || (allowOrderedFallback ? candidates.find((asset) => unused.has(asset.id)) : undefined);
        if (!fallback) return [];
        unused.delete(fallback.id);
        return [fallback.id];
    });
}

export async function finalizeCanvasAssetHandoff<T extends { id: string }>(input: { searchParams: URLSearchParams; currentNodes: T[]; createdNodes: T[]; persist: (nodes: T[]) => Promise<void> }) {
    const created = new Set(input.createdNodes.map((node) => node.id));
    const nodes = [...input.currentNodes.filter((node) => !created.has(node.id)), ...input.createdNodes];
    await input.persist(nodes);
    return { nodes, searchParams: consumeCanvasAssetHandoff(input.searchParams) };
}
