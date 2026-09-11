import type { Asset, AssetKind, AssetStatus, AudioAsset, EntityAsset, ImageAsset, ModelAsset, TextAsset, VideoAsset } from "@/stores/use-asset-store";
import { parseAssetCategory } from "@/lib/asset-category";

const ASSET_KINDS: readonly AssetKind[] = ["text", "image", "video", "audio", "model", "entity"];
const ASSET_STATUSES: readonly AssetStatus[] = ["draft", "review", "confirmed", "archived"];

/**
 * 素材持久化合同的运行时边界。它只接受能被后续业务安全消费的完整记录，绝不通过空 URL、通配 MIME 或零尺寸伪造默认值。
 * 展示层可以隔离历史坏记录，但新增、更新和写回前必须经过这里的严格校验。
 */

export function parseAssetRecord(value: unknown): Asset {
    if (!isRecord(value)) throw new Error("素材记录不是对象");
    const id = requireTrimmedString(value, "id");
    const kind = requireTrimmedString(value, "kind");
    if (!ASSET_KINDS.includes(kind as AssetKind)) throw new Error(`不支持的素材类型 ${kind}`);
    const title = requireString(value, "title");
    const coverUrl = requireString(value, "coverUrl");
    const tags = requireStringArray(value.tags, "tags");
    const createdAt = requireString(value, "createdAt");
    const updatedAt = requireString(value, "updatedAt");
    const folderId = optionalTrimmedString(value, "folderId");
    const status = optionalAssetStatus(value.status);
    const primaryVersionId = optionalTrimmedString(value, "primaryVersionId");
    const source = optionalString(value, "source");
    const note = optionalString(value, "note");
    const arkAssetId = optionalTrimmedString(value, "arkAssetId");
    const portraitCertified = optionalBoolean(value, "portraitCertified");
    const metadata = optionalRecord(value.metadata, "metadata");
    const category = value.category === undefined ? undefined : parseAssetCategory(value.category);
    const data = requireRecord(value.data, "data");
    const base = {
        id,
        title,
        coverUrl,
        tags,
        createdAt,
        updatedAt,
        ...(folderId ? { folderId } : {}),
        ...(category ? { category } : {}),
        ...(status ? { status } : {}),
        ...(primaryVersionId ? { primaryVersionId } : {}),
        ...(source !== undefined ? { source } : {}),
        ...(note !== undefined ? { note } : {}),
        ...(arkAssetId ? { arkAssetId } : {}),
        ...(portraitCertified !== undefined ? { portraitCertified } : {}),
        ...(metadata ? { metadata } : {}),
    };

    if (kind === "text") {
        return { ...base, kind, data: { content: requireString(data, "content") } } satisfies TextAsset;
    }
    if (kind === "image") {
        const parsed = {
            dataUrl: requireString(data, "dataUrl"),
            storageKey: optionalString(data, "storageKey"),
            width: requirePositiveNumber(data, "width"),
            height: requirePositiveNumber(data, "height"),
            bytes: requireNonNegativeNumber(data, "bytes"),
            mimeType: requireMediaMimeType(data, "image"),
        };
        requireMediaLocator(parsed.dataUrl, parsed.storageKey, "图片", "dataUrl");
        return { ...base, kind, data: parsed } satisfies ImageAsset;
    }
    if (kind === "video") {
        const parsed = {
            url: requireString(data, "url"),
            storageKey: optionalString(data, "storageKey"),
            width: requirePositiveNumber(data, "width"),
            height: requirePositiveNumber(data, "height"),
            durationMs: optionalNonNegativeNumber(data, "durationMs"),
            hasAudio: optionalBoolean(data, "hasAudio"),
            bytes: requireNonNegativeNumber(data, "bytes"),
            mimeType: requireMediaMimeType(data, "video"),
        };
        requireMediaLocator(parsed.url, parsed.storageKey, "视频", "url");
        return { ...base, kind, data: parsed } satisfies VideoAsset;
    }
    if (kind === "audio") {
        const parsed = {
            url: requireString(data, "url"),
            storageKey: optionalString(data, "storageKey"),
            durationMs: optionalNonNegativeNumber(data, "durationMs"),
            bytes: requireNonNegativeNumber(data, "bytes"),
            mimeType: requireMediaMimeType(data, "audio"),
        };
        requireMediaLocator(parsed.url, parsed.storageKey, "音频", "url");
        return { ...base, kind, data: parsed } satisfies AudioAsset;
    }
    if (kind === "model") {
        const parsed = {
            url: requireString(data, "url"),
            storageKey: optionalString(data, "storageKey"),
            bytes: requireNonNegativeNumber(data, "bytes"),
            mimeType: requireConcreteMimeType(data),
            fileName: requireTrimmedString(data, "fileName"),
        };
        requireMediaLocator(parsed.url, parsed.storageKey, "模型", "url");
        return { ...base, kind, data: parsed } satisfies ModelAsset;
    }
    if (kind === "entity") {
        return { ...base, kind, data: { definition: requireRecord(data.definition, "definition") } } satisfies EntityAsset;
    }
    throw new Error(`不支持的素材类型 ${kind}`);
}

export function parseAssetRecordList(values: unknown): Asset[] {
    if (!Array.isArray(values)) throw new Error("素材列表无效");
    return values.map((item, index) => {
        try {
            return parseAssetRecord(item);
        } catch (error) {
            const id = isRecord(item) && typeof item.id === "string" && item.id.trim() ? item.id : `#${index}`;
            throw new Error(`素材 ${id} 合同无效：${error instanceof Error ? error.message : String(error)}`);
        }
    });
}

function requireMediaLocator(primary: string, storageKey: string | undefined, label: string, primaryKey: string) {
    if (!primary.trim() && !storageKey?.trim()) {
        throw new Error(`${label}素材缺少 ${primaryKey} 或 storageKey`);
    }
}

function requireString(record: Record<string, unknown>, key: string): string {
    const value = record[key];
    if (typeof value !== "string") throw new Error(`素材字段 ${key} 必须是字符串`);
    return value;
}

function requireTrimmedString(record: Record<string, unknown>, key: string): string {
    const value = requireString(record, key).trim();
    if (!value) throw new Error(`素材字段 ${key} 不能为空`);
    return value;
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
    if (!Object.prototype.hasOwnProperty.call(record, key) || record[key] === undefined) return undefined;
    if (typeof record[key] !== "string") throw new Error(`素材字段 ${key} 必须是字符串`);
    return record[key] as string;
}

function optionalTrimmedString(record: Record<string, unknown>, key: string): string | undefined {
    const value = optionalString(record, key)?.trim();
    return value || undefined;
}

function requireStringArray(value: unknown, key: string): string[] {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
        throw new Error(`素材字段 ${key} 必须是字符串数组`);
    }
    return value;
}

function requireRecord(value: unknown, key: string): Record<string, unknown> {
    if (!isRecord(value)) throw new Error(`素材字段 ${key} 必须是对象`);
    return value;
}

function optionalRecord(value: unknown, key: string): Record<string, unknown> | undefined {
    if (value === undefined) return undefined;
    return requireRecord(value, key);
}

function requireNonNegativeNumber(record: Record<string, unknown>, key: string): number {
    const value = record[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        throw new Error(`素材字段 ${key} 必须是非负数字`);
    }
    return value;
}

function requirePositiveNumber(record: Record<string, unknown>, key: string): number {
    const value = requireNonNegativeNumber(record, key);
    if (value === 0) throw new Error(`素材字段 ${key} 必须大于 0`);
    return value;
}

function requireConcreteMimeType(record: Record<string, unknown>): string {
    const mimeType = requireTrimmedString(record, "mimeType").toLowerCase();
    if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mimeType) || mimeType.endsWith("/*")) {
        throw new Error("素材字段 mimeType 必须是具体 MIME 类型");
    }
    return mimeType;
}

function requireMediaMimeType(record: Record<string, unknown>, kind: "image" | "video" | "audio"): string {
    const mimeType = requireConcreteMimeType(record);
    // application/octet-stream 是诚实的“类型未知”；除此之外必须与素材种类一致，
    // 防止图片记录携带 audio/* 等跨类型元数据后在下载、转码阶段才暴露错误。
    if (mimeType !== "application/octet-stream" && !mimeType.startsWith(`${kind}/`)) {
        throw new Error(`素材字段 mimeType 与 ${kind} 类型不匹配`);
    }
    return mimeType;
}

function optionalNonNegativeNumber(record: Record<string, unknown>, key: string): number | undefined {
    if (!Object.prototype.hasOwnProperty.call(record, key) || record[key] === undefined) return undefined;
    return requireNonNegativeNumber(record, key);
}

function optionalBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
    if (!Object.prototype.hasOwnProperty.call(record, key) || record[key] === undefined) return undefined;
    if (typeof record[key] !== "boolean") throw new Error(`素材字段 ${key} 必须是布尔值`);
    return record[key] as boolean;
}

function optionalAssetStatus(value: unknown): AssetStatus | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !ASSET_STATUSES.includes(value as AssetStatus)) {
        throw new Error("素材 status 无效");
    }
    return value as AssetStatus;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
