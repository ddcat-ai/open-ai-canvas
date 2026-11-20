import { apiBaseURL, compactApiParams, http } from "./request";
import type { RemoteResource } from "./resources";

/** 一次插入画布的姿势图上限，与后端 poselibrary.MaxUseItems 一致。 */
export const POSE_LIBRARY_MAX_USE = 16;
/** ai-pose-gallery-zh 线上演示站，同步图片时的默认来源根地址。 */
export const POSE_LIBRARY_DEFAULT_BASE_URL = "https://ai-pose-gallery.anhao.app/";
export const POSE_LIBRARY_UPSTREAM_REPO = "https://github.com/anhao/ai-pose-gallery-zh";
export const POSE_LIBRARY_ANGLES = ["正面", "斜侧", "侧面", "背面", "俯视", "仰视"] as const;

export type PoseLibraryFacet = { name: string; count: number };

export type PoseLibraryItem = { id: string; angle: string; width: number; height: number; version: number };

export type PoseLibraryPose = {
    key: string;
    code: string;
    name: string;
    system: string;
    category: string;
    sourceKey: string;
    items: PoseLibraryItem[];
};

export type PoseLibraryCatalog = {
    poses: PoseLibraryPose[];
    total: number;
    page: number;
    pageSize: number;
    facets: { systems: PoseLibraryFacet[]; categories: PoseLibraryFacet[]; angles: PoseLibraryFacet[] };
};

export type PoseLibraryCatalogParams = { keyword?: string; system?: string; category?: string; angle?: string; page?: number; pageSize?: number };

export type PoseLibraryUseResult = { itemId: string; name: string; angle: string; category: string; resource: RemoteResource };

export type PoseLibraryStatus = "pending" | "ready" | "failed";

export type AdminPoseLibraryItem = {
    id: string;
    sourceKey: string;
    externalKey: string;
    groupKey: string;
    code: string;
    system: string;
    category: string;
    name: string;
    angle: string;
    sortOrder: number;
    enabled: boolean;
    status: PoseLibraryStatus;
    error?: string;
    remoteThumb?: string;
    remoteImage?: string;
    imageMime?: string;
    imageBytes: number;
    width: number;
    height: number;
    syncedAt?: string;
    createdAt: string;
    updatedAt: string;
    version: number;
};

export type PoseLibraryStats = { total: number; ready: number; pending: number; failed: number; disabled: number };

export type AdminPoseLibrarySource = { key: string; name: string; attribution: string; homepage: string; baseUrl: string; createdAt: string; updatedAt: string };

export type AdminPoseLibrarySystem = { sourceKey: string; system: string; total: number; ready: number; enabled: number };

export type AdminPoseLibraryPage = {
    items: AdminPoseLibraryItem[];
    total: number;
    page: number;
    pageSize: number;
    stats: PoseLibraryStats;
    sources: AdminPoseLibrarySource[];
    systems: AdminPoseLibrarySystem[];
};

export type AdminPoseLibraryParams = { keyword?: string; source?: string; system?: string; status?: string; page?: number; pageSize?: number };

export type PoseLibraryImportResult = {
    source: AdminPoseLibrarySource;
    format: string;
    total: number;
    created: number;
    updated: number;
    skipped: number;
    invalid?: string[];
    systems: { name: string; count: number; imported: boolean }[];
};

export type PoseLibrarySyncResult = {
    processed: number;
    succeeded: number;
    failed: number;
    failures?: { id: string; name: string; message: string }[];
    stats: PoseLibraryStats;
};

export type PoseLibraryBulkAction = "enable" | "disable" | "delete" | "resync";

/** 姿势图地址带同步版本号：文件更新后地址变化，浏览器缓存不会显示旧图。 */
export function poseLibraryFileUrl(item: Pick<PoseLibraryItem, "id" | "version">, variant: "thumb" | "image" = "thumb") {
    const base = String(apiBaseURL).replace(/\/+$/, "");
    return `${base}/pose-library/items/${encodeURIComponent(item.id)}/${variant}?v=${item.version}`;
}

export function listPoseLibrary(params: PoseLibraryCatalogParams, signal?: AbortSignal) {
    return http.get<PoseLibraryCatalog>("/pose-library/poses", { params: compactApiParams(params), signal });
}

/** 把姿势原图复制成当前用户的资源；同一张图重复选用会复用已有资源。 */
export async function copyPoseLibraryItems(ids: string[]) {
    const data = await http.post<{ items: PoseLibraryUseResult[] }>("/pose-library/use", { ids });
    return data.items;
}

export function listAdminPoseLibrary(params: AdminPoseLibraryParams, signal?: AbortSignal) {
    return http.get<AdminPoseLibraryPage>("/admin/pose-library/items", { params: compactApiParams(params), signal });
}

export function importPoseLibrary(input: { file: File; baseUrl: string; systems: string[] }) {
    const form = new FormData();
    form.append("file", input.file, input.file.name);
    form.append("baseUrl", input.baseUrl.trim());
    form.append("systems", JSON.stringify(input.systems));
    return http.post<PoseLibraryImportResult>("/admin/pose-library/import", form);
}

export function syncPoseLibraryImages(input: { limit?: number; retryFailed?: boolean }, signal?: AbortSignal) {
    return http.post<PoseLibrarySyncResult>("/admin/pose-library/sync", input, { signal });
}

export function createPoseLibraryItem(input: { file: File; name: string; system: string; category: string; angle: string; code: string }) {
    const form = new FormData();
    form.append("file", input.file, input.file.name);
    form.append("name", input.name.trim());
    form.append("system", input.system.trim());
    form.append("category", input.category.trim());
    form.append("angle", input.angle);
    form.append("code", input.code.trim());
    return http.post<{ item: AdminPoseLibraryItem }>("/admin/pose-library/items", form);
}

export function updatePoseLibraryItem(id: string, input: Partial<Pick<AdminPoseLibraryItem, "name" | "system" | "category" | "angle" | "code" | "enabled">>) {
    return http.patch<{ item: AdminPoseLibraryItem }>(`/admin/pose-library/items/${encodeURIComponent(id)}`, input);
}

export function deletePoseLibraryItem(id: string) {
    return http.delete<{ ok: boolean }>(`/admin/pose-library/items/${encodeURIComponent(id)}`);
}

export function bulkPoseLibraryItems(input: { action: PoseLibraryBulkAction; ids?: string[]; sourceKey?: string; system?: string }) {
    return http.post<{ affected: number }>("/admin/pose-library/bulk", input);
}

export type PoseLibraryPackPreview = {
    format: "ai-pose-gallery-zh" | "yingce-pose-library";
    sourceName: string;
    baseUrl: string;
    total: number;
    systems: { name: string; count: number }[];
};

/** 浏览器端只做导入前预览（格式、体系和条数），真正的校验以后端为准。 */
export function previewPoseLibraryPack(text: string): PoseLibraryPackPreview {
    let data: unknown;
    try {
        data = JSON.parse(text.replace(/^\uFEFF/, ""));
    } catch {
        throw new Error("文件不是有效的 JSON");
    }
    const count = (systems: string[]) => {
        const counts = new Map<string, number>();
        for (const system of systems) counts.set(system || "未分类", (counts.get(system || "未分类") || 0) + 1);
        return Array.from(counts, ([name, total]) => ({ name, count: total }));
    };
    if (Array.isArray(data)) {
        const rows = data as Record<string, unknown>[];
        if (!rows.length || typeof rows[0]?.id !== "string" || typeof rows[0]?.["姿势名称"] !== "string") throw new Error("不是 ai-pose-gallery-zh 的 data/pose-zh.json");
        return { format: "ai-pose-gallery-zh", sourceName: "AI 姿势参考图库（ai-pose-gallery-zh）", baseUrl: POSE_LIBRARY_DEFAULT_BASE_URL, total: rows.length, systems: count(rows.map((row) => String(row["体系"] || "").trim())) };
    }
    const pack = data as { format?: unknown; source?: { name?: unknown; key?: unknown; baseUrl?: unknown }; items?: unknown };
    if (pack && pack.format === "yingce-pose-library" && Array.isArray(pack.items)) {
        const items = pack.items as Record<string, unknown>[];
        return {
            format: "yingce-pose-library",
            sourceName: String(pack.source?.name || pack.source?.key || "自定义姿势包"),
            baseUrl: typeof pack.source?.baseUrl === "string" ? pack.source.baseUrl : "",
            total: items.length,
            systems: count(items.map((item) => String(item.system || "").trim())),
        };
    }
    throw new Error("无法识别的姿势包格式");
}

/** 原始数据里的成人向体系默认不勾选，由站长确认后再导入。 */
export function isAdultPoseSystem(name: string) {
    return /性感|缠绵|成人|18\+|NSFW/i.test(name);
}
