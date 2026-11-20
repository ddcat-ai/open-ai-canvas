// 方舟素材库的纯函数：类型、状态与费用的派生规则，供设置页、素材库与画布共用。

import type { ArkAssetConfig, ArkAssetStatus, ArkGroupKind, ArkPortraitGroup, ArkPortraitOverview } from "@/services/api/ark-portraits";
import type { ArkCertification, Asset } from "@/stores/use-asset-store";

export const ARK_GROUP_KINDS: readonly ArkGroupKind[] = ["real", "virtual", "ip"];

/** 用户自建素材组的单组费用（积分功能关闭或未开启收费时为 0）。 */
export function arkGroupPrice(config: ArkAssetConfig | undefined, kind: ArkGroupKind) {
    if (!config?.billingEnabled) return 0;
    if (kind === "real") return config.realGroupPriceMicrocredits;
    if (kind === "virtual") return config.virtualGroupPriceMicrocredits;
    return 0;
}

export function arkGroupLimit(config: ArkAssetConfig | undefined, kind: ArkGroupKind) {
    if (!config) return 0;
    return kind === "real" ? config.realGroupLimit : kind === "virtual" ? config.virtualGroupLimit : 0;
}

export function arkKindEnabled(config: ArkAssetConfig | undefined, kind: ArkGroupKind) {
    if (!config) return false;
    return kind === "real" ? config.realEnabled : kind === "virtual" ? config.virtualEnabled : false;
}

export function arkReviewRequired(config: ArkAssetConfig | undefined, kind: ArkGroupKind) {
    if (!config) return true;
    return kind === "real" ? config.realReviewRequired : kind === "virtual" ? config.virtualReviewRequired : false;
}

/** 还能新建的数量；真人额度包含认证中的会话。 */
export function arkGroupQuotaLeft(overview: ArkPortraitOverview | undefined, kind: ArkGroupKind) {
    if (!overview || kind === "ip") return 0;
    const used = kind === "real" ? overview.usage.real : overview.usage.virtual;
    return Math.max(0, arkGroupLimit(overview.config, kind) - used);
}

/** 自建、可用、未过期的素材组才能继续上传。 */
export function arkGroupWritable(group: ArkPortraitGroup) {
    return group.owned && group.available && group.expiryStatus !== "expired";
}

export function arkAssetStatusTone(status: ArkAssetStatus | string): "neutral" | "success" | "warning" | "error" | "loading" {
    if (status === "active") return "success";
    if (status === "processing") return "loading";
    if (status === "pending_review") return "warning";
    if (status === "rejected" || status === "failed") return "error";
    return "neutral";
}

/** 素材库图片在方舟侧的认证记录，用于卡片角标与详情；已通过的展示以素材 payload 的 arkCertification 为准。 */
export type ArkLibraryProgress = { status: ArkAssetStatus; error?: string; groupId: string; groupName: string; kind: ArkGroupKind; portraitAssetId: string; resourceId: string; createdAt: string };

/** 由概览建立「素材库素材 ID → 最近一次认证提交」的映射；同一素材多次提交时保留最近一次。 */
export function arkLibraryProgressMap(overview: ArkPortraitOverview | undefined) {
    const result = new Map<string, ArkLibraryProgress>();
    for (const group of overview?.groups || []) {
        if (!group.owned) continue;
        for (const asset of group.assets) {
            if (!asset.libraryAssetId) continue;
            const current = result.get(asset.libraryAssetId);
            if (current && current.createdAt > asset.createdAt) continue;
            result.set(asset.libraryAssetId, { status: asset.status as ArkAssetStatus, error: asset.error, groupId: group.id, groupName: group.name, kind: group.kind, portraitAssetId: asset.id, resourceId: asset.resourceId, createdAt: asset.createdAt });
        }
    }
    return result;
}

/**
 * 素材库图片还不能提交认证时返回提示文案的 i18n 键：已有认证在审核中，或同一文件已经通过。
 * 未通过、被驳回，或图片已换成其他文件时可以重新提交（与服务端校验一致）。
 */
export function arkLibrarySubmissionBlockerKey(progress: ArkLibraryProgress | undefined, resourceId: string) {
    if (!progress || progress.status === "rejected" || progress.status === "failed") return "";
    if (progress.status === "active") return progress.resourceId === resourceId ? "library.ark.upload.alreadyCertified" : "";
    return `library.ark.badge.${progress.status}`;
}

/**
 * 方舟素材 ID 只对应素材库里认证时的那张图。画布节点换过图片（存储键不同）后不再引用该 ID，
 * 也不显示认证标识；节点或素材缺少存储键时无法比对，按绑定关系处理。
 */
export function arkAssetMatchesImage(asset: Asset, storageKey: string | undefined) {
    if (asset.kind !== "image") return false;
    return !asset.data.storageKey || !storageKey || asset.data.storageKey === storageKey;
}

export function arkCertificationExpired(certification: ArkCertification | undefined, now = Date.now()) {
    if (!certification?.expiresAt) return false;
    const time = Date.parse(certification.expiresAt);
    return Number.isFinite(time) && time <= now;
}

/** i18n 键：方舟认证角标。 */
export function arkCertificationBadgeKey(certification: ArkCertification) {
    return arkCertificationExpired(certification) ? "library.ark.badge.expired" : `library.ark.badge.${certification.kind}`;
}

export function formatArkDate(value: string | undefined, locale: string) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(locale, { year: "numeric", month: "2-digit", day: "2-digit" });
}

export function formatArkTime(value: string | undefined, locale: string) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}
