import type { DramaCast, DramaCastKind, DramaEpisodeDetail, DramaSegment, DramaSegmentReference, DramaShot } from "@/services/api/drama";
import { dramaCastDisplayName } from "./drama-format";

export type DramaAssetUsageKind = DramaCastKind | "image";
export type DramaAssetUsageIssue = "missing-asset" | "missing-image" | "not-selected" | "not-sent";

export type DramaAssetUsage = {
    key: string;
    kind: DramaAssetUsageKind;
    name: string;
    castId?: string;
    resourceId?: string;
    reference?: DramaSegmentReference;
    shotIds: string[];
    issue?: DramaAssetUsageIssue;
};

export type DramaShotAssetUsage = { shot: DramaShot; assets: DramaAssetUsage[] };
export type DramaSegmentAssetUsage = {
    segment: DramaSegment;
    shots: DramaShotAssetUsage[];
    assets: DramaAssetUsage[];
    issueCount: number;
};

type ShotAssetBinding = { id: string; kind: DramaCastKind };

function readAssetIds(value: string, label: string, warnings: string[]) {
    if (!value.trim()) return [];
    try {
        const parsed: unknown = JSON.parse(value);
        if (Array.isArray(parsed) && parsed.every((id) => typeof id === "string" && id.trim())) return [...new Set(parsed as string[])];
    } catch {
        // 读展示路径保留其他可用配置，同时显式报告无法核查的字段。
    }
    warnings.push(`${label}配置无法读取，请打开该段核查`);
    return [];
}

function shotAssetBindings(shot: DramaShot, castById: Map<string, DramaCast>, warnings: string[]): ShotAssetBinding[] {
    const label = `镜头 ${shot.position + 1}`;
    const characters = readAssetIds(shot.castIdsJson, `${label}的人物`, warnings);
    const looks = readAssetIds(shot.lookCastIdsJson, `${label}的造型`, warnings);
    const props = readAssetIds(shot.propIdsJson, `${label}的道具`, warnings);
    const dressedCharacters = new Set(looks.map((id) => castById.get(id)?.parentId).filter(Boolean));
    const bindings: ShotAssetBinding[] = [
        ...characters.filter((id) => !dressedCharacters.has(id)).map((id) => ({ id, kind: "character" as const })),
        ...looks.map((id) => ({ id, kind: "character" as const })),
        ...props.map((id) => ({ id, kind: "prop" as const })),
        ...(shot.sceneCastId ? [{ id: shot.sceneCastId, kind: "scene" as const }] : []),
    ];
    return [...new Map(bindings.map((binding) => [binding.id, binding])).values()];
}

function castUsage(id: string, kind: DramaCastKind, castById: Map<string, DramaCast>): DramaAssetUsage {
    const asset = castById.get(id);
    return {
        key: `cast:${id}`,
        castId: asset?.id,
        kind: asset?.kind || kind,
        name: asset ? dramaCastDisplayName(asset) : "未找到的资产",
        resourceId: asset?.imageResourceId,
        shotIds: [],
        issue: !asset ? "missing-asset" : !asset.imageResourceId ? "missing-image" : "not-selected",
    };
}

/** 当前分镜配置与当前参考请求的对照；不把它当作历史视频的生成快照。 */
export function buildDramaAssetUsage(detail: Pick<DramaEpisodeDetail, "shots" | "segments">, cast: readonly DramaCast[]) {
    const castById = new Map(cast.map((asset) => [asset.id, asset]));
    const warnings: string[] = [];
    const bindings = new Map(detail.shots.map((shot) => [shot.id, shotAssetBindings(shot, castById, warnings)]));
    const assigned = new Set<string>();
    const shotById = new Map(detail.shots.map((shot) => [shot.id, shot]));
    const segments: DramaSegmentAssetUsage[] = detail.segments.map((segment) => {
        const assets = new Map<string, DramaAssetUsage>();
        segment.request.references.forEach((reference, index) => {
            const asset = reference.castId ? castById.get(reference.castId) : undefined;
            const resourceId = reference.resourceId || asset?.imageResourceId;
            const key = reference.castId ? `cast:${reference.castId}` : reference.resourceId ? `image:${reference.resourceId}` : `reference:${segment.id}:${index}`;
            assets.set(key, {
                key,
                kind: reference.kind,
                name: reference.name || (asset ? dramaCastDisplayName(asset) : "未命名素材"),
                castId: asset?.id,
                resourceId,
                reference,
                shotIds: [],
                issue: reference.castId && !asset ? "missing-asset" : !resourceId ? "missing-image" : reference.sent ? undefined : "not-sent",
            });
        });
        const shots: DramaShotAssetUsage[] = [];
        for (const id of new Set(segment.shotIds)) {
            const shot = shotById.get(id);
            if (!shot) {
                warnings.push(`第 ${segment.index + 1} 段有无法读取的镜头，请打开该段核查`);
                continue;
            }
            assigned.add(id);
            const shotAssets = (bindings.get(id) || []).map((binding) => {
                const key = `cast:${binding.id}`;
                const usage = assets.get(key) || castUsage(binding.id, binding.kind, castById);
                usage.shotIds.push(id);
                assets.set(key, usage);
                return usage;
            });
            shots.push({ shot, assets: shotAssets });
        }
        const list = [...assets.values()];
        return { segment, shots: shots.sort((a, b) => a.shot.position - b.shot.position), assets: list, issueCount: list.filter((asset) => asset.issue).length };
    });
    const unassignedShots: DramaShotAssetUsage[] = detail.shots
        .filter((shot) => !assigned.has(shot.id))
        .map((shot) => ({
            shot,
            assets: (bindings.get(shot.id) || []).map(({ id, kind }) => {
                const asset = castUsage(id, kind, castById);
                return { ...asset, shotIds: [shot.id], issue: asset.issue === "not-selected" ? undefined : asset.issue };
            }),
        }));
    const uniqueAssets = new Map([...segments.flatMap((segment) => segment.assets), ...unassignedShots.flatMap((shot) => shot.assets)].map((asset) => [asset.key, asset]));
    const counts: Record<DramaAssetUsageKind, number> = { character: 0, scene: 0, prop: 0, image: 0 };
    for (const asset of uniqueAssets.values()) counts[asset.kind] += 1;
    return { segments, unassignedShots, warnings: [...new Set(warnings)], counts, assetCount: uniqueAssets.size };
}
