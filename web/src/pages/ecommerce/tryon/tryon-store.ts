import { localForageStorageForScope } from "@/lib/localforage-storage";
import { resolveResourceVariantUrl, resourceStorageKey } from "@/services/api/resources";

import { isTryOnFunction, type TryOnFunction, type TryOnPrintMode } from "./tryon-kinds";
import { defaultTryOnDraft, type TryOnAnalysis, type TryOnDraft, type TryOnImage, type TryOnJobSpec } from "./tryon-plan";

/** 本机保存的批量换装草稿与批次记录。任务本身在服务端，这里只记任务编号、提示词与展示信息。 */

export type TryOnJobState = "waiting" | "submitting" | "submitted" | "failed";

export type TryOnJob = TryOnJobSpec & {
    taskId?: string;
    state: TryOnJobState;
    error?: string;
    /** 这张实际提交的比例（自动时按原图比例换算）。 */
    size?: string;
    /** 用户在作品区移除的张。 */
    hidden?: boolean;
};

export type TryOnPlanning = {
    state: "running" | "done" | "failed" | "skipped";
    taskId?: string;
    error?: string;
    garment?: TryOnAnalysis["garment"];
    knowledgeSource?: "backend" | "builtin";
    knowledgeEntries?: Array<{ id: string; title: string }>;
};

export type TryOnBatch = {
    /** 同时作为服务端任务的批次 ID：tryon_<功能>_<随机串>。 */
    id: string;
    fn: TryOnFunction;
    createdAt: string;
    summary: string;
    model: string;
    modelLabel: string;
    ratio: string;
    resolution: string;
    printMode?: TryOnPrintMode;
    /** 提交时的草稿快照：Agent 规划完成后按它生成每张提示词，「再次编辑」也从这里恢复。 */
    source: TryOnDraft;
    planning?: TryOnPlanning;
    jobs: TryOnJob[];
    /** 在其他设备创建、只从服务端任务恢复的批次：没有草稿快照，只能查看与下载。 */
    remote?: boolean;
};

const DRAFT_KEY = "ecommerce-tryon-draft:";
const BATCHES_KEY = "ecommerce-tryon-batches";
const MAX_BATCHES = 60;

function read<T>(key: string): T | null {
    try {
        const raw = window.localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T) : null;
    } catch {
        return null;
    }
}

function write(key: string, value: unknown) {
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch {
        return false;
    }
}

/** 草稿里的素材只保留已上传成功的；本机 blob 预览刷新后失效，改用资源缩略图地址。 */
function storableImages(images: TryOnImage[] = []): TryOnImage[] {
    return images
        .filter((image) => image.resourceId && !image.error)
        .map(({ id, slot, resourceId, name, width, height, catalogId, referenceInfo, previewUrl }) => ({ id, slot, resourceId, name, width, height, catalogId, referenceInfo, previewUrl: previewUrl.startsWith("blob:") ? "" : previewUrl }));
}

export function restoreImages(images: TryOnImage[] = []): TryOnImage[] {
    return images.filter((image) => image?.resourceId).map((image) => ({ ...image, previewUrl: image.previewUrl && !image.previewUrl.startsWith("blob:") ? image.previewUrl : resolveResourceVariantUrl(resourceStorageKey(image.resourceId), "thumbnail") }));
}

export function snapshotDraft(draft: TryOnDraft): TryOnDraft {
    const images: TryOnDraft["images"] = {};
    for (const [fn, list] of Object.entries(draft.images)) if (isTryOnFunction(fn)) images[fn] = storableImages(list);
    return { ...draft, images };
}

export function loadTryOnDraft(scope: string): TryOnDraft {
    const saved = read<Partial<TryOnDraft>>(DRAFT_KEY + scope);
    const base = defaultTryOnDraft();
    if (!saved || typeof saved !== "object") return base;
    const images: TryOnDraft["images"] = {};
    for (const [fn, list] of Object.entries(saved.images || {})) if (isTryOnFunction(fn) && Array.isArray(list)) images[fn] = restoreImages(list);
    return { ...base, ...saved, fn: isTryOnFunction(saved.fn) ? saved.fn : base.fn, images, consent: false };
}

export function saveTryOnDraft(scope: string, draft: TryOnDraft) {
    write(DRAFT_KEY + scope, snapshotDraft({ ...draft, consent: false }));
}

/** 批次记录含每张提示词，体积较大：按用户 scope 存在 localforage，不进 localStorage。 */
export async function loadTryOnBatches(scope: string): Promise<TryOnBatch[]> {
    let saved: TryOnBatch[] | null = null;
    try {
        const raw = await localForageStorageForScope(scope).getItem(BATCHES_KEY);
        saved = raw ? (JSON.parse(String(raw)) as TryOnBatch[]) : null;
    } catch {
        saved = null;
    }
    if (!Array.isArray(saved)) return [];
    return saved
        .filter((batch) => batch && typeof batch.id === "string" && isTryOnFunction(batch.fn) && Array.isArray(batch.jobs))
        .map((batch) => ({
            ...batch,
            // 页面关闭时正在提交的张：任务是否已创建无法确认，标记失败让用户手动重试，避免重复扣费。
            jobs: batch.jobs.map((job) => (job.state === "submitting" && !job.taskId ? { ...job, state: "failed" as const, error: "页面关闭时这张正在提交，未确认是否已创建，请查看后重试" } : job)),
            planning: batch.planning?.state === "running" && !batch.planning.taskId ? { ...batch.planning, state: "failed" as const, error: "页面关闭时 Agent 规划尚未提交" } : batch.planning,
        }));
}

export async function saveTryOnBatches(scope: string, batches: TryOnBatch[]) {
    const trimmed = batches.slice(0, MAX_BATCHES).map((batch) => ({ ...batch, source: snapshotDraft(batch.source) }));
    await localForageStorageForScope(scope).setItem(BATCHES_KEY, JSON.stringify(trimmed));
}

/** 服务端批次 ID：只允许字母、数字、- 与 _，长度 8–64。 */
export function newTryOnBatchId(fn: TryOnFunction, random: string) {
    return `tryon_${fn}_${random.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`;
}

export function tryOnFunctionFromBatchId(id: string): TryOnFunction | null {
    const match = /^tryon_([a-z-]+)_[a-zA-Z0-9]+$/.exec(id);
    return match && isTryOnFunction(match[1]) ? match[1] : null;
}

/** 提交租约：同一账号开着多个标签页时，只有一个标签页继续提交等待中的张。 */
const LEASE_KEY = "ecommerce-tryon-lease:";
export const TAB_ID = Math.random().toString(36).slice(2);

export function acquireLease(batchId: string, ttlMs = 45_000) {
    const now = Date.now();
    const current = read<{ tab: string; until: number }>(LEASE_KEY + batchId);
    if (current && current.tab !== TAB_ID && current.until > now) return false;
    write(LEASE_KEY + batchId, { tab: TAB_ID, until: now + ttlMs });
    return true;
}

export function releaseLease(batchId: string) {
    const current = read<{ tab: string; until: number }>(LEASE_KEY + batchId);
    if (current?.tab === TAB_ID) {
        try {
            window.localStorage.removeItem(LEASE_KEY + batchId);
        } catch {
            /* 存储不可用时租约自然过期。 */
        }
    }
}
