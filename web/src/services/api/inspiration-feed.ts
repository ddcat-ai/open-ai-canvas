import { http } from "./request";

/** 后端定时从上游同步的灵感条目，字段与 CreationInspiration 对齐；addedAt 是本站首次收录时间。 */
export type InspirationFeedEntry = {
    id: string;
    title: string;
    description: string;
    image: string;
    mode: "text" | "image" | "video";
    prompt: string;
    category?: string;
    tags?: string[];
    sourceId: string;
    credit?: string;
    sourceUrl?: string;
    addedAt: string;
    publishedAt?: string;
};

export type InspirationFeed = {
    enabled: boolean;
    entries: InspirationFeedEntry[];
    /** 来源 → 分类码 → 中文名。 */
    categories: Record<string, Record<string, string>>;
    syncedAt?: string;
};

export type InspirationFeedSourceResult = {
    sourceId: string;
    upstream: number;
    accepted: number;
    created: number;
    updated: number;
    error?: string;
};

export type AdminInspirationFeedStatus = {
    enabled: boolean;
    intervalHours: number;
    lastAttemptAt?: string;
    lastSuccessAt?: string;
    nextSyncAt?: string;
    lastError?: string;
    trigger?: "schedule" | "manual";
    sources: InspirationFeedSourceResult[];
    total: number;
    bySource: Record<string, number>;
};

/** 公开接口，匿名访客也能读取。 */
export function getPublicInspirationFeed(signal?: AbortSignal) {
    return http.get<InspirationFeed>("/public/inspirations/feed", { signal });
}

export async function getAdminInspirationFeed(signal?: AbortSignal) {
    return (await http.get<{ status: AdminInspirationFeedStatus }>("/admin/settings/inspiration-feed", { signal })).status;
}

export async function updateAdminInspirationFeed(input: { enabled: boolean }) {
    return (await http.patch<{ status: AdminInspirationFeedStatus }>("/admin/settings/inspiration-feed", input)).status;
}

export async function syncAdminInspirationFeed() {
    return (await http.post<{ status: AdminInspirationFeedStatus }>("/admin/settings/inspiration-feed/sync")).status;
}
