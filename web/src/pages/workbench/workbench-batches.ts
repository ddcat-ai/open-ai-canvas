import { playbackVariantUrl, resourceFileUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import type { GenerationTask } from "@/services/api/task-center";
import type { WorkbenchKind } from "@/services/api/workbench";

/** 一次提交的作品数上限：图片宫格最多 12 张，视频最多 8 条。实际上限还受模型单次张数和账号并发约束。 */
export const IMAGE_BATCH_MAX = 12;
export const VIDEO_BATCH_MAX = 8;

const RESOURCE_FILE_URL = /\/resources\/([A-Za-z0-9_-]{1,80})\/file(?:[?#]|$)/;

/**
 * 一次最多能生成多少条作品。
 * 视频每条一个任务，受账号同时任务数约束；图片可单任务多张，上限为单次张数 × 可用任务数。
 */
export function workbenchBatchLimit(kind: WorkbenchKind, maxOutputsPerTask: number, activeTaskLimit: number) {
    const slots = Math.max(1, Math.floor(activeTaskLimit) || 1);
    if (kind === "video") return Math.max(1, Math.min(VIDEO_BATCH_MAX, slots));
    const perTask = Math.max(1, Math.floor(maxOutputsPerTask) || 1);
    return Math.max(1, Math.min(IMAGE_BATCH_MAX, perTask * slots));
}

/**
 * 把请求的作品数拆成每个任务的产出数。
 * 图片优先让单个任务一次出多张（少占账号并发、少一次上游往返），模型只支持单张时才拆成多个任务；
 * 视频固定一条一个任务。
 */
export function planWorkbenchBatch(kind: WorkbenchKind, requested: number, maxOutputsPerTask: number) {
    const total = Math.max(1, Math.floor(requested) || 1);
    if (kind === "video") return Array.from({ length: total }, () => 1);
    const chunk = Math.max(1, Math.min(total, Math.floor(maxOutputsPerTask) || 1));
    const plan: number[] = [];
    for (let remaining = total; remaining > 0; remaining -= chunk) plan.push(Math.min(chunk, remaining));
    return plan;
}

export function isActiveWorkbenchTask(task: Pick<GenerationTask, "status">) {
    return task.status === "queued" || task.status === "running";
}

export function workbenchTaskStateLabel(task: Pick<GenerationTask, "status" | "stage" | "error">) {
    if (task.status === "queued") return "排队中";
    if (task.status === "running") return task.stage || "生成中";
    if (task.status === "succeeded") return "已完成";
    if (task.status === "cancelled") return "已取消";
    return task.error || task.stage || "生成失败";
}

export type WorkbenchTaskGroup = {
    /** `batch:<id>` 或 `task:<id>`，历史单任务各成一组。 */
    key: string;
    batchId?: string;
    tasks: GenerationTask[];
    /** 批次计划的任务数；部分任务创建失败时会大于已有任务数。 */
    expectedTasks: number;
    createdAt: string;
};

function timestamp(value?: string) {
    const parsed = value ? Date.parse(value) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : 0;
}

/** 按后端批次 ID 归组，组内按提交序号排列，组之间按最早创建时间倒序。 */
export function groupWorkbenchTasks(tasks: readonly GenerationTask[]): WorkbenchTaskGroup[] {
    const groups = new Map<string, WorkbenchTaskGroup>();
    const seen = new Set<string>();
    for (const task of tasks) {
        if (!task?.id || seen.has(task.id)) continue;
        seen.add(task.id);
        const batchId = task.clientContext?.batchId?.trim() || undefined;
        const key = batchId ? `batch:${batchId}` : `task:${task.id}`;
        let group = groups.get(key);
        if (!group) {
            group = { key, ...(batchId ? { batchId } : {}), tasks: [], expectedTasks: 0, createdAt: task.createdAt };
            groups.set(key, group);
        }
        group.tasks.push(task);
        group.expectedTasks = Math.max(group.expectedTasks, batchId ? task.clientContext?.batchCount || 1 : 1, group.tasks.length);
        if (timestamp(task.createdAt) < timestamp(group.createdAt)) group.createdAt = task.createdAt;
    }
    const result = [...groups.values()];
    for (const group of result) group.tasks.sort((a, b) => (a.clientContext?.batchIndex ?? 0) - (b.clientContext?.batchIndex ?? 0) || timestamp(a.createdAt) - timestamp(b.createdAt));
    return result.sort((a, b) => timestamp(b.createdAt) - timestamp(a.createdAt));
}

export type WorkbenchOutput = {
    key: string;
    taskId: string;
    index: number;
    kind: "image" | "video";
    /** 原图或可播放副本。 */
    url: string;
    /** 宫格展示用：图片走缩略图档，视频为封面（没有封面时为空）。 */
    thumbUrl: string;
    posterUrl?: string;
    resourceId?: string;
    storageKey?: string;
    mimeType?: string;
    width?: number;
    height?: number;
};

type RawMedia = { url?: string; resourceId?: string; storageKey?: string; mimeType?: string; posterUrl?: string; width?: number; height?: number };

function text(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function positive(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function resourceIdFromMediaUrl(url?: string) {
    return url ? RESOURCE_FILE_URL.exec(url)?.[1] || "" : "";
}

function mediaUrlValue(value: unknown) {
    const url = text(value) || (value && typeof value === "object" ? text((value as Record<string, unknown>).url) : "");
    return /^(https?:|data:image\/|data:video\/|blob:|\/)/i.test(url) ? url : "";
}

function rawMedia(value: unknown): RawMedia | null {
    if (typeof value === "string") {
        const url = mediaUrlValue(value);
        return url ? { url } : null;
    }
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    const url = mediaUrlValue(record.url) || mediaUrlValue(record.dataUrl) || mediaUrlValue(record.resultUrl);
    const storageKey = text(record.storageKey);
    const resourceId = text(record.resourceId) || resourceIdFromStorageKey(storageKey) || resourceIdFromMediaUrl(url);
    if (!url && !resourceId) return null;
    const poster = ["posterUrl", "poster", "thumbnailUrl", "coverUrl", "cover"].map((key) => mediaUrlValue(record[key])).find(Boolean);
    const mimeType = text(record.mimeType) || text(record.type);
    return {
        ...(url ? { url } : {}),
        ...(resourceId ? { resourceId } : {}),
        ...(storageKey ? { storageKey } : {}),
        ...(/^(image|video)\//i.test(mimeType) ? { mimeType } : {}),
        ...(poster ? { posterUrl: poster } : {}),
        ...(positive(record.width) ? { width: positive(record.width) } : {}),
        ...(positive(record.height) ? { height: positive(record.height) } : {}),
    };
}

function resultMedia(resultJson: string | undefined, kind: WorkbenchKind) {
    if (!resultJson) return [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(resultJson);
    } catch {
        return [];
    }
    if (!parsed || typeof parsed !== "object") return [];
    const result = parsed as Record<string, unknown>;
    const collect = (value: unknown) => (Array.isArray(value) ? value : value ? [value] : []).map(rawMedia).filter((item): item is RawMedia => Boolean(item));
    const primary = kind === "video" ? [...collect(result.video), ...collect(result.videos)] : [...collect(result.images), ...collect(result.image)];
    if (primary.length) return primary;
    return collect(result.url || result.resultUrl || result.outputUrl);
}

function displayMedia(task: GenerationTask, kind: WorkbenchKind, media: RawMedia, index: number): WorkbenchOutput {
    const resourceId = media.resourceId || "";
    const shared = {
        key: `${task.id}:${index}`,
        taskId: task.id,
        index,
        kind,
        ...(resourceId ? { resourceId } : {}),
        ...(media.storageKey ? { storageKey: media.storageKey } : {}),
        ...(media.mimeType ? { mimeType: media.mimeType } : {}),
        ...(media.width ? { width: media.width } : {}),
        ...(media.height ? { height: media.height } : {}),
    };
    if (kind === "video") {
        const posterId = resourceIdFromMediaUrl(media.posterUrl);
        const posterUrl = posterId ? `${resourceFileUrl(posterId)}?variant=thumbnail` : media.posterUrl || "";
        // 视频走可播放副本（H.265 等转码结果），副本未就绪时后端回退原件。
        return { ...shared, url: resourceId ? playbackVariantUrl(resourceId) : media.url || "", thumbUrl: posterUrl, ...(posterUrl ? { posterUrl } : {}) };
    }
    return { ...shared, url: resourceId ? resourceFileUrl(resourceId) : media.url || "", thumbUrl: resourceId ? `${resourceFileUrl(resourceId)}?variant=thumbnail` : media.url || "" };
}

const DOWNLOAD_EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif", "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" };

/** 下载文件名：`场景名_日期_序号.扩展名`，扩展名优先取产物的 MIME，未知时图片用 png、视频用 mp4。 */
export function workbenchDownloadName(output: Pick<WorkbenchOutput, "kind" | "mimeType" | "url">, baseName: string, ordinal: number, now = new Date()) {
    const safe =
        baseName
            .replace(/[\x00-\x1f\\/:*?"<>|]/g, "_")
            .trim()
            .slice(0, 60) || (output.kind === "image" ? "商品图" : "商品视频");
    const fromPath = /\.([a-z0-9]{3,4})(?:[?#]|$)/i.exec(output.url.split(/[?#]/, 1)[0])?.[1]?.toLowerCase();
    const extension = (output.mimeType && DOWNLOAD_EXTENSIONS[output.mimeType.toLowerCase()]) || (fromPath && Object.values(DOWNLOAD_EXTENSIONS).includes(fromPath) ? fromPath : "") || (output.kind === "image" ? "png" : "mp4");
    const pad = (value: number) => String(value).padStart(2, "0");
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
    return `${safe}_${stamp}_${pad(ordinal)}.${extension}`;
}

/**
 * 任务的全部可展示产物。列表接口只带首个预览地址；详情（含 resultJson）到达后返回全部图片。
 */
export function workbenchTaskOutputs(task: GenerationTask, kind: WorkbenchKind, detail?: GenerationTask): WorkbenchOutput[] {
    if (task.status !== "succeeded") return [];
    const fromResult = resultMedia(detail?.resultJson || task.resultJson, kind);
    if (fromResult.length) return fromResult.map((media, index) => displayMedia(task, kind, media, index));
    const previewUrl = text(task.previewUrl);
    if (!previewUrl) return [];
    const resourceId = resourceIdFromMediaUrl(previewUrl);
    return [displayMedia(task, kind, { url: previewUrl, ...(resourceId ? { resourceId } : {}), ...(task.previewPosterUrl ? { posterUrl: task.previewPosterUrl } : {}) }, 0)];
}

/** `16:9`、`1824x1024` 解析为宽高比；`auto`、`adaptive` 等返回 undefined。 */
export function aspectRatioOf(value?: unknown) {
    const match = typeof value === "string" ? /^\s*(\d+(?:\.\d+)?)\s*[:x×*]\s*(\d+(?:\.\d+)?)\s*$/i.exec(value) : null;
    if (!match) return undefined;
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!width || !height) return undefined;
    const ratio = width / height;
    return ratio >= 0.2 && ratio <= 5 ? ratio : undefined;
}

export function parseWorkbenchInput(inputJson?: string) {
    if (!inputJson) return null;
    try {
        const parsed: unknown = JSON.parse(inputJson);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, any>) : null;
    } catch {
        return null;
    }
}

export type WorkbenchTaskReferenceSnapshot = {
    resourceId: string;
    kind: "image" | "video" | "audio";
    role?: "reference" | "first_frame" | "last_frame";
    slotKey?: string;
};

export type WorkbenchTaskSnapshot = {
    kind: WorkbenchKind;
    toolId?: string;
    toolName?: string;
    presetId?: string;
    presetName?: string;
    parameters: Record<string, unknown>;
    references: WorkbenchTaskReferenceSnapshot[];
};

/** 从任务详情的安全输入里恢复工作台参数；列表摘要没有 inputJson，返回 null。 */
export function workbenchTaskSnapshot(task: GenerationTask): WorkbenchTaskSnapshot | null {
    const input = parseWorkbenchInput(task.inputJson);
    if (!input) return null;
    const metadata = input.metadata && typeof input.metadata === "object" ? (input.metadata as Record<string, any>) : {};
    const metadataSnapshot = metadata.workbench && typeof metadata.workbench === "object" ? (metadata.workbench as Record<string, any>) : {};
    const snapshot = input.workbench && typeof input.workbench === "object" ? (input.workbench as Record<string, any>) : metadataSnapshot;
    const kind = snapshot.kind || metadata.workbenchKind;
    if (kind !== "image" && kind !== "video") return null;
    const rawReferences = Array.isArray(snapshot.references) ? snapshot.references : [];
    const references = rawReferences.flatMap((value: unknown): WorkbenchTaskReferenceSnapshot[] => {
        if (!value || typeof value !== "object") return [];
        const reference = value as Record<string, unknown>;
        const resourceId = typeof reference.resourceId === "string" ? reference.resourceId.trim() : "";
        const referenceKind = reference.kind;
        if (!resourceId || (referenceKind !== "image" && referenceKind !== "video" && referenceKind !== "audio")) return [];
        const role = reference.role === "first_frame" || reference.role === "last_frame" || reference.role === "reference" ? reference.role : undefined;
        const slotKey = typeof reference.slotKey === "string" ? reference.slotKey : undefined;
        return [{ resourceId, kind: referenceKind, ...(role ? { role } : {}), ...(slotKey ? { slotKey } : {}) }];
    });
    const rawParameters = snapshot.parameters && typeof snapshot.parameters === "object" ? snapshot.parameters : {};
    const toolName = typeof metadata.workbenchToolName === "string" ? metadata.workbenchToolName : undefined;
    const presetName = typeof metadata.workbenchPresetName === "string" ? metadata.workbenchPresetName : undefined;
    return {
        kind,
        ...(typeof snapshot.toolId === "string" ? { toolId: snapshot.toolId } : typeof metadata.workbenchToolId === "string" ? { toolId: metadata.workbenchToolId } : {}),
        ...(toolName ? { toolName } : {}),
        ...(typeof snapshot.presetId === "string" ? { presetId: snapshot.presetId } : typeof metadata.workbenchPresetId === "string" ? { presetId: metadata.workbenchPresetId } : {}),
        ...(presetName ? { presetName } : {}),
        parameters: rawParameters as Record<string, unknown>,
        references,
    };
}

const STANDARD_RATIOS = ["1:1", "3:4", "4:3", "9:16", "16:9", "2:3", "3:2", "4:5", "5:4", "21:9"];

/** 像素尺寸优先显示成常用比例（1024×1360 → 3:4），对不上常用比例时保留像素值。 */
function ratioLabel(value: unknown) {
    const raw = text(value);
    if (!raw) return "";
    if (raw === "auto") return "自动尺寸";
    if (raw === "adaptive") return "自适应画幅";
    if (raw.includes(":")) return raw;
    const ratio = aspectRatioOf(raw);
    const standard = ratio ? STANDARD_RATIOS.find((item) => Math.abs((aspectRatioOf(item) || 0) - ratio) / ratio < 0.02) : undefined;
    return standard || raw.replace(/x/i, " × ");
}

/** 批次头和预览面板里的参数摘要，例如“1:1 · 2K · 4 张”“6 秒 · 9:16 · 720p · 有声”。 */
export function workbenchParameterSummary(kind: WorkbenchKind, parameters: Record<string, unknown>, outputCount?: number) {
    const items: string[] = [];
    if (kind === "image") {
        const ratio = ratioLabel(parameters.size);
        if (ratio) items.push(ratio);
        const resolution = text(parameters.imageResolution);
        if (resolution && resolution !== "auto") items.push(resolution.toUpperCase());
        const quality = text(parameters.quality);
        if (quality && quality !== "auto" && !/^\d(\.\d)?k$/i.test(quality)) items.push({ low: "快速", medium: "标准", high: "高清", standard: "标准", hd: "高清" }[quality.toLowerCase()] || quality);
    } else {
        const seconds = Number(parameters.seconds);
        if (Number.isFinite(seconds) && seconds > 0) items.push(`${seconds} 秒`);
        const ratio = ratioLabel(parameters.ratio);
        if (ratio) items.push(ratio);
        const resolution = text(parameters.resolution);
        if (resolution) items.push(/^\d+$/.test(resolution) ? `${resolution}p` : resolution);
        if (parameters.generateAudio === true) items.push("有声");
    }
    if (outputCount && outputCount > 0) items.push(kind === "image" ? `${outputCount} 张` : `${outputCount} 条`);
    return items;
}
