// 资产 → 时间线片段 的纯转换（M3.4 asset-ingest）。
// 资产是"仅时间线作用域"的直连媒体：nodeId 用 `asset:<id>` 前缀（不指向画布节点），
// 预览/导出从 directMedia 解析媒体，不回画布查节点。

import type { ProjectAsset } from "@/services/api/projects";
import type { TimelineClip, TimelineClipKind } from "@/types/timeline";

const MEDIA_TYPE_TO_KIND: Record<string, TimelineClipKind | undefined> = {
    video: "video",
    audio: "audio",
    image: "image",
    text: "text",
};

export function assetToClipKind(mediaType: string): TimelineClipKind | null {
    return MEDIA_TYPE_TO_KIND[mediaType] ?? null;
}

export type MakeClipFromAssetOptions = {
    /** 目标轨道 id（调用方已按 kind 选好轨道）。 */
    trackId: string;
    /** 时间线起点（毫秒，通常为该轨道当前末尾）。 */
    startMs: number;
    /** 默认时长（毫秒）；资产无时长元数据时使用。 */
    defaultDurationMs?: number;
    /** 时间线内唯一 id（调用方负责去重，通常 `asset:<id>:<n>`）。 */
    id?: string;
};

export function makeClipFromAsset(asset: ProjectAsset, options: MakeClipFromAssetOptions): TimelineClip | null {
    const kind = assetToClipKind(asset.mediaType);
    if (!kind) return null;
    if (kind === "text") return null; // 文本资产不直接入轨（走字幕/文字工具）
    return {
        id: options.id ?? `asset:${asset.id}`,
        kind,
        nodeId: `asset:${asset.id}`,
        trackId: options.trackId,
        startMs: options.startMs,
        durationMs: options.defaultDurationMs ?? 3_000,
        title: asset.title,
        directMedia: {
            id: asset.id,
            kind: kind === "subtitle" ? "text" : kind,
            title: asset.title,
            storageKey: asset.storageKey,
        },
    };
}
