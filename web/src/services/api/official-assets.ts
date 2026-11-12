// 官方素材库前端 API 模块（迁移 v61，表 official_assets / official_asset_imports）。
//
// 唯一调用入口是 `@/services/api/request` 的 `http`（仓库 AGENTS.md §4）：
// 它解包 `{ code, data, msg, reason }` 信封，业务 code 非 0 时抛 ApiError。
// 本模块不做 try/catch 兜底、不返回默认成功——写失败必须向上抛错，由调用方展示。
//
// 后端路由（步骤 2，`backend/internal/handler/official_asset_routes.go`）：
//   GET  /official-assets                        用户列表（只看已发布）
//   GET  /official-assets/:id                   用户详情
//   POST /official-assets/:id/import            导入个人库（路径 A）
//   POST /official-assets/:id/import-to-project 导入当前项目（路径 A）
//   GET  /official-assets/:id/reference         直接引用载荷（路径 B，读取端）
//   POST /admin/official-assets                 管理员新建（默认 draft）
//   GET  /admin/official-assets                 管理员全状态列表
//   GET  /admin/official-assets/:id             管理员详情
//   PATCH /admin/official-assets/:id            管理员编辑
//   PATCH /admin/official-assets/:id/publish    发布
//   PATCH /admin/official-assets/:id/unpublish  下架
//   PATCH /admin/official-assets/:id/sort       调整排序
//   DELETE /admin/official-assets/:id           删除（仅未发布未引用草稿）
//
// 依赖：步骤 1（迁移 v61）+ 步骤 2（后端路由）+ 步骤 3（插件策略；
// 用户侧接口先调 RequirePluginForUser，步骤 3 未落地时返回“插件不存在”）。
// 管理端接口不受插件开关影响。
import { compactApiParams, http } from "@/services/api/request";
import type { AssetCategory } from "@/lib/asset-category";
import type { ProjectCharacterDetail } from "@/services/api/projects";

export type OfficialAssetMediaType = "image" | "video" | "audio" | "entity";
export type OfficialAssetStatus = "draft" | "published" | "unpublished";

export type OfficialAsset = {
    id: string;
    resourceId: string;
    title: string;
    description: string;
    mediaType: OfficialAssetMediaType;
    category: AssetCategory;
    tags: string[];
    sourceName: string;
    sourceUrl: string;
    licenseNote: string;
    usageNote: string;
    status: OfficialAssetStatus;
    sortOrder: number;
    /** 只给 `resource:` 存储键，不给签名地址；封面用 CachedResourceImage 按此键换取。 */
    coverStorageKey: string;
    width: number;
    height: number;
    /** 图片为 0；视频为毫秒时长。 */
    durationMs: number;
    size: number;
    publishedAt: string | null;
    updatedAt: string;
    /** 当前用户是否已导入个人库。项目维度的“已加入”不在列表里，由选择器本地记录。 */
    imported: boolean;
};

export type OfficialAssetPage = {
    items: OfficialAsset[];
    kindCounts: Record<string, number>;
    categoryCounts: Record<string, number>;
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
};

export type OfficialAssetListParams = {
    page?: number;
    pageSize?: number;
    /** 关键词：命中标题 / 介绍 / 标签。 */
    q?: string;
    mediaType?: OfficialAssetMediaType | "all";
    category?: AssetCategory | "all";
    tag?: string;
};

/** 导入接口的返回：导入后得到的 Asset（已是客户端可直接用的 PayloadJSON 形状）。 */
export type ImportedOfficialAssetPayload = {
    id: string;
    kind: OfficialAssetMediaType;
    category: AssetCategory;
    status: string;
    primaryVersionId: string;
    title: string;
    coverUrl: string;
    tags: string[];
    data: {
        storageKey: string;
        width: number;
        height: number;
        bytes: number;
        mimeType: string;
        officialAssetId: string;
        officialTitle: string;
        sourceName: string;
        sourceUrl: string;
        licenseNote: string;
        usageNote: string;
        importedAt: string;
        resourceId: string;
    };
    createdAt: string;
    updatedAt: string;
};

export type OfficialAssetImportResult = {
    asset: ImportedOfficialAssetPayload;
    /** true 表示幂等命中：本次没有新建任何记录，返回的是已存在的那条资产。 */
    alreadyImported: boolean;
};

/** 路径 B（画布直接引用）的引用载荷：只读，不建任何资产记录。是否启用待画布插入契约核对。 */
export type OfficialAssetReference = {
    officialAssetId: string;
    storageKey: string;
    mediaType: OfficialAssetMediaType;
    title: string;
    character?: {
        versionId?: string;
        version?: number;
        definition: Record<string, unknown>;
        representations?: Array<{
            id?: string;
            resourceId?: string;
            mediaType?: string;
            role?: string;
            status?: string;
            failureReason?: string;
        }>;
        images?: Array<{ resourceId?: string; role?: string }>;
        voice?: {
            profile?: { name?: string; provider?: string; language?: string; timbre?: string; sampleResourceId?: string };
            instructions?: string;
        };
        visualStatus?: string;
        voiceStatus?: string;
        partialReasons?: string[];
    };
};

export type CreateOfficialAssetBody = {
    resourceId: string;
    title: string;
    description?: string;
    mediaType: OfficialAssetMediaType;
    category?: AssetCategory;
    tags?: string[];
    sourceName?: string;
    sourceUrl?: string;
    licenseNote?: string;
    usageNote?: string;
    sortOrder?: number;
};

export type UpdateOfficialAssetBody = {
    resourceId?: string;
    title?: string;
    description?: string;
    mediaType?: OfficialAssetMediaType;
    category?: AssetCategory;
    /** 传了即覆盖（含 [] 清空）；不传表示不动。后端用原始 JSON 区分两者。 */
    tags?: string[];
    sourceName?: string;
    sourceUrl?: string;
    licenseNote?: string;
    usageNote?: string;
    sortOrder?: number;
};

export type AdminOfficialAssetListParams = OfficialAssetListParams & {
    status?: OfficialAssetStatus | "all";
};

/** 用户列表：只返回已发布且未软删的素材。`mediaType` 非法值后端返回 400，不要静默忽略。 */
export async function fetchOfficialAssets(params: OfficialAssetListParams, signal?: AbortSignal) {
    return http.get<OfficialAssetPage>("/official-assets", {
        params: compactApiParams({
            page: params.page,
            pageSize: params.pageSize,
            q: params.q,
            mediaType: params.mediaType === "all" ? undefined : params.mediaType,
            category: params.category === "all" ? undefined : params.category,
            tag: params.tag,
        }),
        signal,
    });
}

/** 用户详情：未发布 / 已下架 / 不存在一律 404，不泄露存在性。 */
export async function fetchOfficialAsset(id: string, signal?: AbortSignal) {
    return http.get<OfficialAsset>(`/official-assets/${encodeURIComponent(id)}`, { signal });
}

/** 路径 A：导入个人素材库。重复导入返回已存在资产（alreadyImported=true），不新建。 */
export async function importOfficialAssetToLibrary(id: string) {
    return http.post<OfficialAssetImportResult>(`/official-assets/${encodeURIComponent(id)}/import`, {});
}

/** 路径 A：导入当前项目。重复导入同一项目返回已存在资产，不重复建链接。 */
export async function importOfficialAssetToProject(id: string, projectId: string) {
    return http.post<OfficialAssetImportResult>(`/official-assets/${encodeURIComponent(id)}/import-to-project`, { projectId });
}

/** 路径 B 读取端：只返回引用载荷，不建资产记录。画布是否接受该载荷待 Mac 核对。 */
export async function fetchOfficialAssetReference(id: string, signal?: AbortSignal) {
    return http.get<OfficialAssetReference>(`/official-assets/${encodeURIComponent(id)}/reference`, { signal });
}

export async function copyOfficialCharacter(id: string, input: { name: string; definition: Record<string, unknown>; sourceVersionId: string }) {
    return http.post<ProjectCharacterDetail>(`/official-assets/${encodeURIComponent(id)}/copy-character`, input);
}

/** 管理员列表：全部状态（含草稿与已下架，不含已软删）。 */
export async function fetchAdminOfficialAssets(params: AdminOfficialAssetListParams, signal?: AbortSignal) {
    return http.get<OfficialAssetPage>("/admin/official-assets", {
        params: compactApiParams({
            page: params.page,
            pageSize: params.pageSize,
            q: params.q,
            mediaType: params.mediaType === "all" ? undefined : params.mediaType,
            category: params.category === "all" ? undefined : params.category,
            tag: params.tag,
            status: params.status === "all" ? undefined : params.status,
        }),
        signal,
    });
}

/** 管理员详情：任意状态，供编辑页回填。 */
export async function fetchAdminOfficialAsset(id: string, signal?: AbortSignal) {
    return http.get<OfficialAsset>(`/admin/official-assets/${encodeURIComponent(id)}`, { signal });
}

/**
 * 管理员新建：默认 draft。文件本身不经此接口上传——先走现有
 * `uploadResourceFile`（`@/services/api/resources`）拿到 Resource ID 再调此接口。
 */
export async function createOfficialAsset(body: CreateOfficialAssetBody) {
    return http.post<OfficialAsset>("/admin/official-assets", body);
}

/** 管理员编辑：只改传了的字段；`status` 不走这里改。 */
export async function updateOfficialAsset(id: string, body: UpdateOfficialAssetBody) {
    return http.patch<OfficialAsset>(`/admin/official-assets/${encodeURIComponent(id)}`, body);
}

/** 发布：draft/unpublished → published；已是 published 返回明确错误，不静默成功。 */
export async function publishOfficialAsset(id: string) {
    return http.patch<{ ok: boolean }>(`/admin/official-assets/${encodeURIComponent(id)}/publish`, {});
}

/** 下架：published → unpublished；已导入的资产不受影响。 */
export async function unpublishOfficialAsset(id: string) {
    return http.patch<{ ok: boolean }>(`/admin/official-assets/${encodeURIComponent(id)}/unpublish`, {});
}

/** 调整排序。 */
export async function updateOfficialAssetSortOrder(id: string, sortOrder: number) {
    return http.patch<{ ok: boolean }>(`/admin/official-assets/${encodeURIComponent(id)}/sort`, { sortOrder });
}

/** 删除：仅 draft 且引用数为 0 时允许；其余一律明确拒绝（400/409）。 */
export async function deleteOfficialAsset(id: string) {
    return http.delete<{ ok: boolean }>(`/admin/official-assets/${encodeURIComponent(id)}`);
}
