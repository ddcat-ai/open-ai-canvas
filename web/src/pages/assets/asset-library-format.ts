// 素材库的展示格式化：摘要、尺寸、时长、时间、下载名与搜索文本。纯函数。

import { formatBytes } from "@/lib/image-utils";
import { audioAverageBitrateKbps, formatAudioSampleRate, imageResolutionTierLabel, isLosslessAudioMimeType, mediaAspectRatioLabel, mediaFormatLabel, videoResolutionTierLabel } from "@/lib/media-spec";
import { characterAssetSummary } from "@/components/assets/asset-rich-cover";
import { assetCategoryLabel } from "@/lib/asset-category";
import { type AssetKind } from "@/stores/use-asset-store";
import { type AssetGridDensity, parseAssetGridDensity } from "./asset-grid-density";
import { type Asset } from "@/stores/use-asset-store";
import { type LucideIcon, FileText, Image as ImageIcon, Clapperboard, AudioLines, Box, UserRound } from "lucide-react";

export type LibraryAsset = Asset;

export const ASSET_GRID_DENSITY_KEY = "yingce:asset-grid-density";

export const assetKindIcons: Record<LibraryAsset["kind"], LucideIcon> = {
    text: FileText,
    image: ImageIcon,
    video: Clapperboard,
    audio: AudioLines,
    model: Box,
    entity: UserRound,
};

/**
 * 卡片摘要只放挑素材时真正比较的规格：图片/视频是清晰度与画幅，音频是时长与采样率。
 * 像素尺寸、大小和格式留在素材档案里（见 assetSummaryDetail 与 assetArchiveFacts）。
 */
export function assetSummary(asset: LibraryAsset, audioSampleRate?: number) {
    if (asset.kind === "entity") return asset.category === "environment" || asset.category === "prop" ? String(asset.data.definition.description || "待生成图片") : characterAssetSummary(asset);
    if (asset.kind === "text") return asset.data.content;
    if (asset.kind === "audio") return [formatAssetClock(asset.data.durationMs) || formatAssetDuration(asset.data.durationMs), formatAudioSampleRate(audioSampleRate)].filter(Boolean).join(" · ");
    if (asset.kind === "model") return `${asset.data.fileName} · ${formatBytes(asset.data.bytes)} · ${asset.data.mimeType}`;
    const tier = asset.kind === "video" ? videoResolutionTierLabel(asset.data.width, asset.data.height) : imageResolutionTierLabel(asset.data.width, asset.data.height);
    const spec = [tier, mediaAspectRatioLabel(asset.data.width, asset.data.height)].filter(Boolean).join(" · ");
    return spec || `尺寸未知 · ${formatBytes(asset.data.bytes)}`;
}

/** 卡片摘要悬停提示：补上像素尺寸、文件大小和格式，不必打开档案也能核对。 */
export function assetSummaryDetail(asset: LibraryAsset, audioSampleRate?: number) {
    if (asset.kind === "image" || asset.kind === "video") return [assetSizeLabel(asset.data.width, asset.data.height), formatBytes(asset.data.bytes), mediaFormatLabel(asset.data.mimeType)].join(" · ");
    if (asset.kind === "audio") {
        const bitrate = isLosslessAudioMimeType(asset.data.mimeType) ? 0 : audioAverageBitrateKbps(asset.data.bytes, asset.data.durationMs);
        return [assetSummary(asset, audioSampleRate), bitrate ? `${bitrate} kbps` : "", formatBytes(asset.data.bytes), mediaFormatLabel(asset.data.mimeType)].filter(Boolean).join(" · ");
    }
    return assetSummary(asset);
}

export function assetSizeLabel(width: number, height: number) {
    // 旧版本后端把未知尺寸写成 1×1 占位；1 像素的边长不是真实媒体尺寸，同样按未知显示。
    return width > 1 && height > 1 ? `${width}x${height}` : "未知";
}

export function assetSearchText(asset: LibraryAsset) {
    const body = asset.kind === "text" ? asset.data.content : asset.kind === "entity" ? JSON.stringify(asset.data.definition) : asset.data.mimeType;
    return [asset.title, asset.source || "", asset.note || "", assetCategoryLabel(asset.category), (asset.tags || []).join(" "), body].join(" ").toLowerCase();
}

export function assetProjectLabel(asset: LibraryAsset) {
    const projectName = asset.metadata?.projectName;
    if (typeof projectName === "string" && projectName.trim()) return projectName;
    return Array.isArray(asset.metadata?.projectIds) && asset.metadata.projectIds.length ? "已关联项目" : "未关联项目";
}

export function assetKindLabel(kind: AssetKind, category?: string) {
    if (kind === "entity" && (category === "environment" || category === "prop")) return `${assetCategoryLabel(category)}设定`;
    return kind === "image" ? "图片" : kind === "video" ? "视频" : kind === "audio" ? "音频" : kind === "model" ? "3D 模型" : kind === "entity" ? "角色" : "文本";
}

export function assetDownloadLabel(asset: LibraryAsset) {
    if (asset.kind === "video") return "下载视频";
    if (asset.kind === "audio") return "下载音频";
    if (asset.kind === "model") return "下载模型";
    return "下载图片";
}

export function readAssetGridDensity(): AssetGridDensity {
    if (typeof window === "undefined") return 8;
    return parseAssetGridDensity(window.localStorage.getItem(ASSET_GRID_DENSITY_KEY));
}

export function assetCountMap<T extends { label: string; value: string }>(options: T[], remote: Record<string, number> | undefined, fallback: LibraryAsset[], valueOf: (asset: LibraryAsset) => string) {
    const result = new Map<string, number>();
    options.forEach((option) => {
        // “全部”只累计筛选条上声明的类型，避免未展示的分类把计数和列表对不上。
        if (remote) result.set(option.value, option.value === "all" ? options.reduce((sum, item) => (item.value === "all" ? sum : sum + (remote[item.value] || 0)), 0) : remote[option.value] || 0);
        else result.set(option.value, option.value === "all" ? fallback.length : fallback.filter((asset) => valueOf(asset) === option.value).length);
    });
    return result;
}

export function formatAssetDuration(durationMs?: number) {
    if (!durationMs) return "时长未知";
    return `${Math.round(durationMs / 100) / 10} 秒`;
}

export function formatAssetClock(durationMs?: number) {
    if (!durationMs || durationMs < 1000) return null;
    const total = Math.round(durationMs / 1000);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatAssetTime(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

export function formatAssetDateTime(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
