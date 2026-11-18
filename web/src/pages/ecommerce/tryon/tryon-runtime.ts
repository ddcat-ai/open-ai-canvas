import { createClientUUID } from "@/lib/client-id";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { captureUserSession, getActiveUserScope } from "@/lib/user-scope";
import { appQueryClient } from "@/lib/query-client";
import { ApiError } from "@/services/api/request";
import { useAssetStore, flushAssetStorePersistence } from "@/stores/use-asset-store";
import { resourceIdFromStorageKey, resourceStorageKey, resolveResourceVariantUrl, uploadResourceFile } from "@/services/api/resources";
import { createGenerationTask, listGenerationTasks, retryGenerationTask, subscribeGenerationTasks, type GenerationTask } from "@/services/api/task-center";
import { parseBackendGenerationResult, prepareBackendGenerationTask } from "@/services/api/generation-task";
import { createWorkbenchTask, listWorkbenchTasks, deleteTryOnBatch } from "@/services/api/workbench";
import { materializeGenerationTaskAssets } from "@/services/project-asset-sync";
import { logicalModelIDForConfig, modelOptionName, resolveModelChannel, type AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

import { resolveAutoImageSize } from "../catalog";
import { submitCommerceTaskWhenSlotAvailable } from "../generation-slot";
import type { CommerceModelProfile } from "../model-catalog";
import { commerceImageParameters } from "../workflow";
import { fetchTryOnKnowledge } from "./tryon-api";
import { REFERENCE_ANGLES, referenceView, referenceSelectionKey, type ReferenceSelection } from "./reference-catalog";
import { copyPoseLibraryItems } from "@/services/api/pose-library";
import { cropFaceReferences } from "./tryon-face-crop";
import { tryOnFunction, type TryOnFunction, type TryOnSlotKey } from "./tryon-kinds";
import {
    agentReferenceIds,
    buildTryOnJobs,
    isFaceSwapFunction,
    missingInput,
    needsAgentPlan,
    parseTryOnAnalysis,
    parseTryOnFaceRead,
    readyImages,
    type TryOnAnalysis,
    tryOnAgentPrompt,
    tryOnSummary,
    usesAiModel,
    type TryOnDraft,
    type TryOnImage,
} from "./tryon-plan";
import { acquireLease, loadTryOnBatches, loadTryOnDraft, newTryOnBatchId, releaseLease, restoreImages, saveTryOnBatches, saveTryOnDraft, snapshotDraft, tryOnFunctionFromBatchId, type TryOnBatch, type TryOnJob } from "./tryon-store";

/**
 * 批量换装的运行时：草稿、批次与任务放在页面之外的小型存储里。
 * 面板卸载（切到商品视频、离开页面）后，正在上传的素材和排队提交的图片继续完成，回来时界面直接接上。
 */

export type TryOnNotice = { text: string; paused?: boolean };

export type TryOnRuntimeState = {
    scope: string;
    draft: TryOnDraft;
    batches: TryOnBatch[];
    /** 本机批次记录（localforage）读完之前不写回，避免空列表覆盖已有记录。 */
    batchesLoaded: boolean;
    tasks: Record<string, GenerationTask>;
    notices: Record<string, TryOnNotice>;
};

export type TryOnMarket = { platform: string; platformLabel: string; region: string; language: string; languageLabel: string };

export type TryOnRunContext = {
    scope: string;
    config: AiConfig;
    /** 读图规划用的文本模型（后台指定的电商 Agent 识图模型）。 */
    agentModel: string;
    market: TryOnMarket;
};

let state: TryOnRuntimeState | null = null;
let lastContext: TryOnRunContext | null = null;
const listeners = new Set<() => void>();
let draftTimer = 0;
let batchesTimer = 0;
const deletedBatchIds = new Set<string>();

function emit() {
    for (const listener of listeners) listener();
}

export function subscribeTryOn(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

const byNewest = (a: TryOnBatch, b: TryOnBatch) => b.createdAt.localeCompare(a.createdAt);

export function tryOnState(scope: string): TryOnRuntimeState {
    if (!state || state.scope !== scope) {
        state = { scope, draft: loadTryOnDraft(scope), batches: [], batchesLoaded: false, tasks: {}, notices: {} };
        lastContext = null;
        remoteChecked = false;
        deletedBatchIds.clear();
        void loadTryOnBatches(scope).then((saved) => {
            if (state?.scope !== scope) return;
            const known = new Set(state.batches.map((batch) => batch.id));
            state = { ...state, batches: [...state.batches, ...saved.filter((batch) => !known.has(batch.id))].sort(byNewest), batchesLoaded: true };
            persistBatches(scope);
            emit();
        });
    }
    return state;
}

function current(scope: string) {
    if (getActiveUserScope() !== scope) throw new DOMException("账号已切换", "AbortError");
    return tryOnState(scope);
}

export function updateTryOnDraft(scope: string, updater: (draft: TryOnDraft) => TryOnDraft) {
    if (getActiveUserScope() !== scope) return;
    const value = tryOnState(scope);
    const next = updater(value.draft);
    if (next === value.draft) return;
    state = { ...value, draft: next };
    window.clearTimeout(draftTimer);
    draftTimer = window.setTimeout(() => {
        if (state?.scope === scope) saveTryOnDraft(scope, state.draft);
    }, 300);
    emit();
}

function persistBatches(scope: string) {
    window.clearTimeout(batchesTimer);
    batchesTimer = window.setTimeout(() => {
        if (state?.scope === scope && state.batchesLoaded) void saveTryOnBatches(scope, state.batches).catch(() => undefined);
    }, 200);
}

function setBatches(scope: string, updater: (batches: TryOnBatch[]) => TryOnBatch[]) {
    if (getActiveUserScope() !== scope) return;
    const value = tryOnState(scope);
    state = { ...value, batches: updater(value.batches) };
    persistBatches(scope);
    emit();
}

export function updateTryOnBatch(scope: string, id: string, updater: (batch: TryOnBatch) => TryOnBatch) {
    setBatches(scope, (batches) => batches.map((batch) => (batch.id === id ? updater(batch) : batch)));
}

function updateJob(scope: string, batchId: string, key: string, patch: Partial<TryOnJob>) {
    updateTryOnBatch(scope, batchId, (batch) => ({ ...batch, jobs: batch.jobs.map((job) => (job.key === key ? { ...job, ...patch } : job)) }));
}

function setNotice(scope: string, batchId: string, notice: TryOnNotice | null) {
    if (getActiveUserScope() !== scope) return;
    const value = tryOnState(scope);
    const previous = value.notices[batchId];
    if ((!notice && !previous) || (notice && previous && notice.text === previous.text && notice.paused === previous.paused)) return;
    const notices = { ...value.notices };
    if (notice) notices[batchId] = notice;
    else delete notices[batchId];
    state = { ...value, notices };
    emit();
}

const findBatch = (scope: string, id: string) => tryOnState(scope).batches.find((batch) => batch.id === id);

// ---------- 任务 ----------

const materializing = new Set<string>();

export function outputResourceId(task?: GenerationTask) {
    if (!task || task.status !== "succeeded") return "";
    try {
        return resourceIdFromStorageKey(parseBackendGenerationResult(task).images?.[0]?.storageKey) || "";
    } catch {
        return "";
    }
}

export function setTryOnTask(scope: string, task: GenerationTask) {
    if (getActiveUserScope() !== scope) return;
    const value = tryOnState(scope);
    const previous = value.tasks[task.id];
    const merged: GenerationTask = {
        ...task,
        outputs: task.outputs?.map((output) => ({ ...output, materializedAssetId: output.materializedAssetId || previous?.outputs?.find((item) => item.outputIndex === output.outputIndex)?.materializedAssetId })) || previous?.outputs,
    };
    state = { ...value, tasks: { ...value.tasks, [task.id]: merged } };
    emit();
    // 成片登记进资产库，素材库里可以直接复用（与商品图片一致）。
    if (merged.status === "succeeded" && !merged.outputs?.some((output) => output.materializedAssetId) && !materializing.has(task.id)) {
        materializing.add(task.id);
        void materializeGenerationTaskAssets(merged)
            .then((ready) => {
                if (state?.scope === scope) setTryOnTask(scope, ready);
            })
            .catch(() => materializing.delete(task.id));
    }
    if (["succeeded", "failed", "cancelled"].includes(merged.status)) onLeadSettled(scope, merged);
}

/** 统一模特的首张结束：成功就继续提交后续张，失败就把后续张标记为未继续。 */
function onLeadSettled(scope: string, task: GenerationTask) {
    for (const batch of tryOnState(scope).batches) {
        const lead = batch.jobs.find((job) => job.anchor === "lead");
        if (!lead || lead.taskId !== task.id || !batch.jobs.some((job) => job.anchor === "follow" && job.state === "waiting")) continue;
        if (task.status === "succeeded" && outputResourceId(task)) {
            if (lastContext?.scope === scope) void pumpTryOnBatch(lastContext, batch.id);
        } else if (task.status !== "succeeded") {
            updateTryOnBatch(scope, batch.id, (item) => ({
                ...item,
                jobs: item.jobs.map((job) => (job.anchor === "follow" && job.state === "waiting" ? { ...job, state: "failed", error: "首张没有生成成功，统一模特的后续张未提交；重试首张成功后可继续" } : job)),
            }));
        }
    }
}

export function watchTryOnTasks(scope: string, ids: string[]) {
    if (!ids.length) return () => undefined;
    return subscribeGenerationTasks(ids, (task) => {
        if (state?.scope === scope) setTryOnTask(scope, task);
    });
}

function waitTerminal(scope: string, id: string) {
    return new Promise<GenerationTask>((resolve, reject) => {
        const session = captureUserSession();
        if (session.scope !== scope) {
            reject(new DOMException("账号已切换", "AbortError"));
            return;
        }
        let done = false;
        let stop: (() => void) | undefined;
        // 订阅时如果已有缓存状态会同步回调一次，此时 stop 还没赋值：结束标记先记下，订阅返回后再退订。
        const finish = () => {
            done = true;
            session.signal.removeEventListener("abort", abort);
            queueMicrotask(() => stop?.());
        };
        const abort = () => {
            if (done) return;
            finish();
            reject(new DOMException("账号已切换", "AbortError"));
        };
        session.signal.addEventListener("abort", abort, { once: true });
        stop = subscribeGenerationTasks([id], (task) => {
            if (done) return;
            if (getActiveUserScope() !== scope) {
                finish();
                reject(new DOMException("账号已切换", "AbortError"));
                return;
            }
            setTryOnTask(scope, task);
            if (["succeeded", "failed", "cancelled"].includes(task.status)) {
                finish();
                resolve(task);
            }
        });
        if (done) queueMicrotask(() => stop?.());
    });
}

const watchedLeads = new Set<string>();

/** Follow-up images must continue even after the studio route unmounts. */
function watchLeadUntilSettled(ctx: TryOnRunContext, taskId: string, batchId: string) {
    if (watchedLeads.has(taskId)) return;
    watchedLeads.add(taskId);
    void waitTerminal(ctx.scope, taskId)
        .then(() => {
            if (getActiveUserScope() === ctx.scope) void pumpTryOnBatch(ctx, batchId);
        })
        .catch(() => undefined)
        .finally(() => watchedLeads.delete(taskId));
}

// ---------- 素材 ----------

const IMAGE_MAX_BYTES = 30 * 1024 * 1024;

async function imageSize(file: Blob) {
    try {
        const bitmap = await createImageBitmap(file);
        const size = { width: bitmap.width, height: bitmap.height };
        bitmap.close();
        return size;
    } catch {
        return { width: 0, height: 0 };
    }
}

function patchImage(scope: string, id: string, patch: Partial<TryOnImage>) {
    updateTryOnDraft(scope, (draft) => {
        const images: TryOnDraft["images"] = {};
        let changed = false;
        for (const [fn, list] of Object.entries(draft.images) as Array<[TryOnFunction, TryOnImage[]]>) {
            images[fn] = list.map((image) => {
                if (image.id !== id) return image;
                changed = true;
                return { ...image, ...patch };
            });
        }
        return changed ? { ...draft, images } : draft;
    });
}

function slotRoom(draft: TryOnDraft, slot: TryOnSlotKey) {
    const config = tryOnFunction(draft.fn).slots.find((item) => item.key === slot);
    const used = (draft.images[draft.fn] || []).filter((image) => image.slot === slot && !image.error).length;
    return { max: config?.max || 1, room: Math.max(0, (config?.max || 1) - used), label: config?.label || "素材" };
}

function insertImages(scope: string, slot: TryOnSlotKey, images: TryOnImage[]) {
    updateTryOnDraft(scope, (draft) => {
        const { max } = slotRoom(draft, slot);
        const list = draft.images[draft.fn] || [];
        // 单张位直接替换，多张位追加。
        const base = max === 1 ? list.filter((image) => image.slot !== slot) : list;
        return { ...draft, images: { ...draft.images, [draft.fn]: [...base, ...images] } };
    });
}

/** 上传本地图片到某个上传位；返回需要提示的问题（超出数量、类型或大小）。 */
export async function addTryOnFiles(scope: string, slot: TryOnSlotKey, files: File[]) {
    const draft = current(scope).draft;
    const { max, room, label } = slotRoom(draft, slot);
    const images = files.filter((file) => file.type.startsWith("image/"));
    const problems: string[] = [];
    if (images.length < files.length) problems.push("只能上传图片，其他文件未添加");
    const limit = max === 1 ? 1 : room;
    if (images.length > limit) problems.push(limit ? `${label}最多 ${max} 张，超出的部分未添加` : `${label}已满 ${max} 张`);
    const accepted = images.slice(0, limit);
    for (const file of accepted) {
        if (file.size > IMAGE_MAX_BYTES) {
            problems.push(`${file.name} 超过 30MB`);
            continue;
        }
        const id = createClientUUID();
        const previewUrl = URL.createObjectURL(file);
        const size = await imageSize(file);
        if (current(scope).draft.fn !== draft.fn) {
            URL.revokeObjectURL(previewUrl);
            problems.push("当前功能已切换，请在新功能里重新上传图片");
            break;
        }
        insertImages(scope, slot, [{ id, slot, resourceId: "", name: file.name, previewUrl, progress: 0, ...size }]);
        void uploadResourceFile(file, "image", { expectedUserId: scope, fileName: file.name, width: size.width || undefined, height: size.height || undefined }, (done, total) => patchImage(scope, id, { progress: total ? done / total : 0 }))
            .then((resource) => patchImage(scope, id, { resourceId: resource.id, progress: undefined }))
            .catch((error) => patchImage(scope, id, { error: error instanceof Error ? error.message : "上传失败", progress: undefined }));
    }
    return problems;
}

/** 素材库或作品区里已有的资源，直接放进上传位。 */
export function addTryOnResources(scope: string, slot: TryOnSlotKey, picked: Array<{ resourceId: string; name: string; width?: number; height?: number }>) {
    const draft = tryOnState(scope).draft;
    const { max, room } = slotRoom(draft, slot);
    const accepted = picked.slice(0, max === 1 ? 1 : room);
    insertImages(
        scope,
        slot,
        accepted.map((item) => ({ id: createClientUUID(), slot, resourceId: item.resourceId, name: item.name, previewUrl: resolveResourceVariantUrl(resourceStorageKey(item.resourceId), "thumbnail"), width: item.width, height: item.height })),
    );
    return picked.length - accepted.length;
}

const CATALOG_CACHE = "ecommerce-tryon-catalog:";

/** Copy the selected full-resolution reference into this user's own resources. */
export async function addTryOnReferences(scope: string, slot: TryOnSlotKey, selections: ReferenceSelection[]) {
    const initial = current(scope).draft;
    const fn = initial.fn;
    const room = slotRoom(initial, slot);
    const max = room.max === 1 ? 1 : room.room;
    if (!selections.length || selections.length > max) throw new Error("选择数量已超过上传位上限，请减少后重试");
    const images: TryOnImage[] = [];
    for (const selection of selections) {
        const { entry, angle } = selection;
        if (entry.kind === "pose" ? slot !== "pose" : slot !== "garment" && slot !== "garment-back") throw new Error("素材类型与上传位不匹配");
        const camera = REFERENCE_ANGLES.find((view) => view.id === angle)!;
        const view = referenceView(entry, angle);
        if (!view.itemId) throw new Error("素材编号缺失，请刷新素材库");
        const copied = await copyPoseLibraryItems([view.itemId]);
        const resource = copied.find((item) => item.itemId === view.itemId)?.resource;
        current(scope);
        if (!resource?.id) throw new Error("素材未保存成功，请重试");
        current(scope);
        images.push({
            id: createClientUUID(),
            slot,
            resourceId: resource.id,
            name: `${entry.title}${entry.kind === "pose" ? ` · ${camera.label}` : ""}`,
            previewUrl: resolveResourceVariantUrl(resourceStorageKey(resource.id), "thumbnail"),
            width: view.width,
            height: view.height,
            referenceInfo: {
                id: referenceSelectionKey(selection),
                title: entry.title,
                category: entry.category,
                angle: entry.kind === "pose" ? camera.label : undefined,
                instruction: entry.kind === "pose" ? "" : "服装搭配参考，以图中实际设计为准",
            },
        });
    }
    const latest = current(scope).draft;
    if (latest.fn !== fn) throw new Error("当前功能已切换，图片已保存到我的素材，请在当前上传位重新选择");
    const latestRoom = slotRoom(latest, slot);
    if (latestRoom.max !== 1 && images.length > latestRoom.room) throw new Error("上传位数量已变化，图片已保存到我的素材，请重新选择");
    insertImages(scope, slot, images);
}

/** 内置模特库的角色卡：首次使用时上传为自己的资源，之后复用同一个资源。 */
export async function addTryOnCatalog(scope: string, slot: TryOnSlotKey, profile: CommerceModelProfile) {
    const fn = current(scope).draft.fn;
    const key = `${CATALOG_CACHE}${scope}:${profile.id}`;
    let resourceId = "";
    try {
        resourceId = window.localStorage.getItem(key) || "";
    } catch {
        resourceId = "";
    }
    if (!resourceId) {
        const response = await fetch(profile.image);
        if (!response.ok) throw new Error(`读取模特库图片失败（${response.status}）`);
        const blob = await response.blob();
        current(scope);
        const resource = await uploadResourceFile(blob, "image", { expectedUserId: scope, fileName: `${profile.id}.png`, width: 1672, height: 941 });
        current(scope);
        if (!resource.id) throw new Error("模特图片未保存成功，请重试");
        resourceId = resource.id;
        try {
            window.localStorage.setItem(key, resourceId);
        } catch {
            /* 不缓存也能用，只是下次会重新上传。 */
        }
    }
    const draft = current(scope).draft;
    if (draft.fn !== fn) throw new Error("当前功能已切换，请重新选择模特");
    const { max, room } = slotRoom(draft, slot);
    if (max !== 1 && room <= 0) throw new Error("模特已满，请先移除一位");
    insertImages(scope, slot, [{ id: createClientUUID(), slot, resourceId, name: profile.name, previewUrl: profile.image, catalogId: profile.id, width: 1672, height: 941 }]);
}

export function removeTryOnImage(scope: string, id: string) {
    updateTryOnDraft(scope, (draft) => {
        const images: TryOnDraft["images"] = {};
        for (const [fn, list] of Object.entries(draft.images) as Array<[TryOnFunction, TryOnImage[]]>) {
            images[fn] = list.filter((image) => {
                if (image.id !== id) return true;
                // 同一个 blob 预览只属于这一张。
                if (image.previewUrl.startsWith("blob:") && !Object.values(draft.images).some((other) => other !== list && other?.some((item) => item.previewUrl === image.previewUrl))) URL.revokeObjectURL(image.previewUrl);
                return false;
            });
        }
        return { ...draft, images };
    });
}

/** 两个上传位互换素材（例如把放反了的模特和服装对调）。 */
export function swapTryOnSlots(scope: string, a: TryOnSlotKey, b: TryOnSlotKey): string {
    const draft = tryOnState(scope).draft;
    const config = tryOnFunction(draft.fn);
    const slotA = config.slots.find((item) => item.key === a);
    const slotB = config.slots.find((item) => item.key === b);
    if (!slotA || !slotB) return "";
    const list = draft.images[draft.fn] || [];
    const inA = list.filter((image) => image.slot === a);
    const inB = list.filter((image) => image.slot === b);
    if (!inA.length && !inB.length) return "先上传素材再互换";
    if (inA.length > slotB.max || inB.length > slotA.max) return `${slotA.label}最多 ${slotA.max} 张、${slotB.label}最多 ${slotB.max} 张，当前数量不能直接互换`;
    updateTryOnDraft(scope, (value) => ({
        ...value,
        images: { ...value.images, [value.fn]: (value.images[value.fn] || []).map((image) => (image.slot === a ? { ...image, slot: b } : image.slot === b ? { ...image, slot: a } : image)) },
    }));
    return "";
}

/** 切换换装功能：新功能的空位沿用上一个功能里同类的素材（模特图可以直接当主体用）。 */
export function switchTryOnFunction(scope: string, fn: TryOnFunction) {
    updateTryOnDraft(scope, (draft) => {
        if (draft.fn === fn) return draft;
        const previous = draft.images[draft.fn] || [];
        const existing = draft.images[fn] || [];
        const target = tryOnFunction(fn);
        let carried: TryOnImage[] = existing;
        if (!existing.length && previous.length) {
            carried = [];
            for (const slot of target.slots) {
                const source = slot.key === "subject" ? previous.filter((image) => image.slot === "model" || image.slot === "subject") : previous.filter((image) => image.slot === slot.key);
                carried.push(
                    ...source
                        .filter((image) => image.resourceId && !image.error)
                        .slice(0, slot.max)
                        .map((image) => ({ ...image, id: createClientUUID(), slot: slot.key })),
                );
            }
        }
        return {
            ...draft,
            fn,
            images: { ...draft.images, [fn]: carried },
            // 场景类功能沿用上次的场景设置；AI 选角没有原图时由 effectiveSceneMode 自动改为多场景。
            sceneMode: target.scenes ? draft.sceneMode : "keep",
            // 换脸、换头、姿势默认跟随原图比例，换装默认 3:4，印花默认 1:1；模型不支持时由面板回落到模型默认值。
            ratio: target.defaultRatio,
            // 多模特同款至少出 3 张才有对比意义；上传的模特更多时由张数下限自动补足。
            count: fn === "multi-model" ? Math.max(draft.count, 3) : draft.count,
            consent: false,
        };
    });
}

// ---------- 提交 ----------

function nearestRatio(width: number, height: number, values: string[], fallback: string) {
    if (!width || !height) return fallback;
    const target = width / height;
    let best = fallback;
    let bestDiff = Infinity;
    for (const value of values) {
        const match = /^(\d+(?:\.\d+)?)\s*[:x×]\s*(\d+(?:\.\d+)?)$/i.exec(value);
        if (!match) continue;
        const diff = Math.abs(Math.log(Number(match[1]) / Number(match[2]) / target));
        if (diff < bestDiff) {
            bestDiff = diff;
            best = value;
        }
    }
    return best;
}

function jobSize(ctx: TryOnRunContext, batch: TryOnBatch, job: TryOnJob) {
    const profile = modelCapabilityConfigFor(ctx.config, batch.model).image;
    const values = profile?.size.values.length ? profile.size.values : [profile?.size.default || "1:1"];
    if (batch.ratio && batch.ratio !== "auto" && values.includes(batch.ratio)) return batch.ratio;
    const fallback = values.includes("auto") ? "auto" : profile?.size.default || values[0];
    if (job.sizeSource?.width && job.sizeSource.height)
        return nearestRatio(
            job.sizeSource.width,
            job.sizeSource.height,
            values.filter((value) => value !== "auto"),
            fallback,
        );
    return resolveAutoImageSize("auto", values, ctx.market.platform, "set") || fallback;
}

const running = new Set<string>();

/** 模型限制了提示词长度时，按优先级去掉通用段落（任务、保真与身份要求始终保留），真人质感最后才去掉，仍超长才截断。 */
const DROPPABLE_BLOCKS = ["【服装识别", "模特参考图如果是同一个人的多视角角色卡", "【成片要求】", "【避免】", "【人物实拍质感"];

function fitPrompt(prompt: string, max: number) {
    if (!max || prompt.length <= max) return prompt;
    let blocks = prompt.split("\n\n");
    for (const tag of DROPPABLE_BLOCKS) {
        if (blocks.join("\n\n").length <= max) break;
        blocks = blocks.filter((block) => !block.startsWith(tag));
    }
    const joined = blocks.join("\n\n");
    return joined.length <= max ? joined : joined.slice(0, max);
}

function errorText(cause: unknown, fallback = "提交失败") {
    return cause instanceof Error && cause.message ? cause.message : fallback;
}

/** 依次提交批次里等待中的张：遵守账号同时进行的任务上限，失败时暂停，不连续扣费。 */
export async function pumpTryOnBatch(ctx: TryOnRunContext, batchId: string) {
    const { scope } = ctx;
    lastContext = ctx;
    if (running.has(batchId) || !acquireLease(batchId)) return;
    running.add(batchId);
    try {
        for (;;) {
            const value = current(scope);
            const batch = value.batches.find((item) => item.id === batchId);
            if (!batch || value.notices[batchId]?.paused) break;
            const lead = batch.jobs.find((job) => job.anchor === "lead");
            const leadTask = lead?.taskId ? value.tasks[lead.taskId] : undefined;
            const anchorId = outputResourceId(leadTask);
            const next = batch.jobs.find((job) => job.state === "waiting" && (job.anchor !== "follow" || Boolean(anchorId)));
            if (!next) break;
            const profile = modelCapabilityConfigFor(ctx.config, batch.model).image;
            if (!profile) {
                updateJob(scope, batchId, next.key, { state: "failed", error: "这批使用的图片模型已不可用，请换一个模型后重新生成" });
                setNotice(scope, batchId, { text: "图片模型已不可用，已暂停提交", paused: true });
                break;
            }
            const references =
                next.anchor === "follow" && anchorId ? (next.anchorAt === "last" ? [...next.references, { resourceId: anchorId, role: "anchor" as const }] : [{ resourceId: anchorId, role: "anchor" as const }, ...next.references]) : next.references;
            if (!references.length || references.some((item) => !item.resourceId?.trim())) {
                updateJob(scope, batchId, next.key, { state: "failed", error: "参考素材编号缺失，请重新选择素材后生成" });
                setNotice(scope, batchId, { text: "参考素材不完整，已暂停提交", paused: true });
                break;
            }
            if (references.length > Math.min(20, profile.references.maxImages || 0)) {
                updateJob(scope, batchId, next.key, { state: "failed", error: `当前图片模型最多接收 ${profile.references.maxImages} 张参考图，这张需要 ${references.length} 张` });
                continue;
            }
            const size = jobSize(ctx, batch, next);
            const parameters = commerceImageParameters(profile, size, batch.resolution);
            const logicalModelId = logicalModelIDForConfig({ ...ctx.config, model: batch.model });
            const position = batch.jobs.indexOf(next);
            const count = Math.min(20, batch.jobs.length);
            updateJob(scope, batchId, next.key, { state: "submitting", size, error: undefined });
            try {
                const task = await submitCommerceTaskWhenSlotAvailable({
                    activeLimit: () => useUserStore.getState().runtimeLimits.activeTaskLimit,
                    listActive: (limit) => listGenerationTasks(limit, { activeOnly: true }),
                    assertCurrent: () => {
                        if (getActiveUserScope() !== scope) throw new DOMException("账号已切换", "AbortError");
                        if (!acquireLease(batchId)) throw new DOMException("另一个页面正在提交这批任务", "AbortError");
                    },
                    onWaiting: (_active, limit) => setNotice(scope, batchId, { text: `同时进行的任务已达上限 ${limit} 个，前面的图片完成后自动继续提交` }),
                    submit: () =>
                        createWorkbenchTask({
                            kind: "image",
                            prompt: fitPrompt(next.prompt, profile.references.promptMaxChars),
                            model: modelOptionName(batch.model),
                            ...(logicalModelId ? { logicalModelId } : { channelId: resolveModelChannel(ctx.config, batch.model).id }),
                            parameters,
                            references: references.map((item) => ({ resourceId: item.resourceId, kind: "image" as const, role: "reference" as const })),
                            batch: { id: batchId, index: Math.min(position, count - 1), count },
                        }),
                });
                setNotice(scope, batchId, null);
                updateJob(scope, batchId, next.key, { state: "submitted", taskId: task.id });
                setTryOnTask(scope, task);
                if (next.anchor === "lead") watchLeadUntilSettled(ctx, task.id, batchId);
            } catch (cause) {
                if (cause instanceof DOMException && cause.name === "AbortError") {
                    updateJob(scope, batchId, next.key, { state: "waiting" });
                    break;
                }
                const message = errorText(cause);
                updateJob(scope, batchId, next.key, { state: "failed", error: message });
                // 余额不足、权限或模型问题会让后面每一张都失败：暂停整批，等用户处理后点「继续提交」。
                setNotice(scope, batchId, { text: `提交未完成：${message}`, paused: true });
                break;
            }
        }
    } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError")) setNotice(scope, batchId, { text: errorText(cause, "提交中断"), paused: true });
    } finally {
        running.delete(batchId);
        releaseLease(batchId);
    }
}

const planningInFlight = new Set<string>();

/** Agent 读图规划：检索后台知识库 → 识图模型输出每张的场景、姿势与选角 → 生成每张提示词并提交。 */
export async function planTryOnBatch(ctx: TryOnRunContext, batchId: string) {
    const { scope } = ctx;
    lastContext = ctx;
    const batch = findBatch(scope, batchId);
    if (!batch?.planning || batch.planning.state !== "running" || planningInFlight.has(batchId)) return;
    planningInFlight.add(batchId);
    try {
        let taskId = batch.planning.taskId;
        if (!taskId) {
            if (!ctx.agentModel) throw new Error("后台没有可读图的电商 Agent 模型");
            const face = isFaceSwapFunction(batch.fn);
            const garment = batch.source.notes.trim().slice(0, 60);
            // 换脸读图不需要服饰知识库。
            const knowledge = face
                ? { knowledge: "", entries: [], source: "builtin" as const }
                : await fetchTryOnKnowledge({ function: batch.fn, garment, scene: batch.summary, platform: ctx.market.platform, region: ctx.market.region, language: ctx.market.language, markets: batch.source.markets });
            if (!face) updateTryOnBatch(scope, batchId, (item) => ({ ...item, planning: { ...item.planning!, knowledgeSource: knowledge.source, knowledgeEntries: knowledge.entries.map(({ id, title }) => ({ id, title })) } }));
            const ids = agentReferenceIds(batch.source);
            const input = await prepareBackendGenerationTask({
                mode: "text",
                prompt: tryOnAgentPrompt(batch.source, knowledge, ctx.market),
                config: { ...ctx.config, model: ctx.agentModel },
                referenceImages: ids.map((id, index) => ({ id, name: `参考图${index + 1}`, type: "image/*", dataUrl: "", storageKey: resourceStorageKey(id) })),
                metadata: { source: "ecommerce-tryon", stage: "tryon-planning", tryonBatchId: batchId, tryonFunction: batch.fn },
            });
            current(scope);
            const task = await createGenerationTask(input);
            taskId = task.id;
            setTryOnTask(scope, task);
            updateTryOnBatch(scope, batchId, (item) => ({ ...item, planning: { ...item.planning!, taskId: task.id } }));
        }
        const task = await waitTerminal(scope, taskId);
        if (task.status !== "succeeded") throw new Error(task.error || "Agent 规划没有完成");
        const text = parseBackendGenerationResult(task).text || "";
        let analysis: TryOnAnalysis;
        if (isFaceSwapFunction(batch.fn)) {
            const read = parseTryOnFaceRead(text, batch.source);
            const faceIds = batch.fn === "face-swap" ? readyImages(batch.source, "face").map((image) => image.resourceId) : [];
            analysis = { shots: [], faceRead: { ...read, crops: faceIds.length ? await cropFaceReferences(faceIds, read.boxes, scope) : [] } };
        } else analysis = parseTryOnAnalysis(text);
        if (batch.fn === "pose" && (analysis.shots.length !== batch.source.count || analysis.shots.some((shot) => !shot.pose || !shot.camera))) throw new Error("Agent 未完整识别每张姿势与机位，请调整参考图后重新提交");
        updateTryOnBatch(scope, batchId, (item) => ({
            ...item,
            planning: { ...item.planning!, state: "done", garment: analysis.garment, error: undefined },
            jobs: buildTryOnJobs(item.source, analysis).map((spec) => ({ ...spec, state: "waiting" as const })),
        }));
    } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        // 规划失败不阻断出图：按内置场景库生成每张的拍摄方案，并在批次上说明原因。
        updateTryOnBatch(scope, batchId, (item) => ({
            ...item,
            planning: { ...item.planning!, state: "failed", error: errorText(cause, "Agent 规划失败") },
            jobs: batch.fn === "pose" ? [] : item.jobs.length ? item.jobs : buildTryOnJobs(item.source).map((spec) => ({ ...spec, state: "waiting" as const })),
        }));
    } finally {
        planningInFlight.delete(batchId);
    }
    void pumpTryOnBatch(ctx, batchId);
}

/** 开始一批：建批次（需要时先规划），立即返回，提交在后台进行。 */
export function startTryOnBatch(ctx: TryOnRunContext, draft: TryOnDraft, modelLabel: string) {
    current(ctx.scope);
    const invalid = missingInput(draft);
    if (invalid) throw new Error(invalid);
    const source = snapshotDraft(draft);
    const id = newTryOnBatchId(draft.fn, createClientUUID());
    const planned = needsAgentPlan(draft) && (!isFaceSwapFunction(draft.fn) || !!ctx.agentModel);
    const batch: TryOnBatch = {
        id,
        fn: draft.fn,
        createdAt: new Date().toISOString(),
        summary: tryOnSummary(draft),
        model: draft.imageModel,
        modelLabel,
        ratio: draft.ratio,
        resolution: draft.resolution,
        printMode: draft.fn === "print" ? draft.printMode : undefined,
        source,
        planning: planned ? { state: "running" } : undefined,
        jobs: planned ? [] : buildTryOnJobs(source).map((spec) => ({ ...spec, state: "waiting" as const })),
    };
    setBatches(ctx.scope, (batches) => [batch, ...batches]);
    if (planned) void planTryOnBatch(ctx, id);
    else void pumpTryOnBatch(ctx, id);
    return batch;
}

/** 页面打开时接上未完成的批次：继续规划、继续提交等待中的张。 */
export function resumeTryOnBatches(ctx: TryOnRunContext) {
    lastContext = ctx;
    for (const batch of tryOnState(ctx.scope).batches) {
        if (batch.remote) continue;
        if (batch.planning?.state === "running" && batch.planning.taskId) void planTryOnBatch(ctx, batch.id);
        else if (batch.jobs.some((job) => job.state === "waiting")) void pumpTryOnBatch(ctx, batch.id);
    }
}

export function continueTryOnBatch(ctx: TryOnRunContext, batchId: string) {
    setNotice(ctx.scope, batchId, null);
    updateTryOnBatch(ctx.scope, batchId, (batch) => ({ ...batch, jobs: batch.jobs.map((job) => (job.state === "failed" && !job.taskId ? { ...job, state: "waiting", error: undefined } : job)) }));
    void pumpTryOnBatch(ctx, batchId);
}

/** 重试失败的一张：已创建的任务走服务端重试（不重复计费规则沿用任务中心），未创建的重新提交。 */
export async function retryTryOnJob(ctx: TryOnRunContext, batchId: string, key: string) {
    const batch = findBatch(ctx.scope, batchId);
    const job = batch?.jobs.find((item) => item.key === key);
    if (!batch || !job) return;
    if (job.taskId) {
        const task = await retryGenerationTask(job.taskId);
        setTryOnTask(ctx.scope, task);
        updateJob(ctx.scope, batchId, key, { taskId: task.id, state: "submitted", error: undefined });
        if (job.anchor === "lead") watchLeadUntilSettled(ctx, task.id, batchId);
        if (job.anchor === "lead")
            updateTryOnBatch(ctx.scope, batchId, (item) => ({ ...item, jobs: item.jobs.map((entry) => (entry.anchor === "follow" && entry.state === "failed" && !entry.taskId ? { ...entry, state: "waiting", error: undefined } : entry)) }));
        return;
    }
    updateJob(ctx.scope, batchId, key, { state: "waiting", error: undefined });
    setNotice(ctx.scope, batchId, null);
    void pumpTryOnBatch(ctx, batchId);
}

const REDO_SHIFTS = ["换一个机位与景别", "换一个姿势与表情", "换一个光线方向与色温", "换一个构图与人物朝向"];

/** 同一张再生成一版：提示词不变，追加「换一版」的变化要求，作为本批次的新一张。 */
export function regenerateTryOnJob(ctx: TryOnRunContext, batchId: string, key: string) {
    const batch = findBatch(ctx.scope, batchId);
    const job = batch?.jobs.find((item) => item.key === key);
    if (!batch || !job) return;
    const keep = /【保持原图】|【保持不变】|印花提取/.test(job.prompt);
    const shift = REDO_SHIFTS[Math.floor(Math.random() * REDO_SHIFTS.length)];
    const suffix = keep ? "\n\n【重新生成·换一版】保持上面全部要求不变，在细节上自然变化（面料褶皱、表情、手部与光影），成品与上一版有可见差异。" : `\n\n【重新生成·换一版】服装与人物要求不变，${shift}，成品与上一版明显不同。`;
    const copy: TryOnJob = { ...job, key: `${job.key}-r${createClientUUID().slice(0, 6)}`, title: `${job.title} · 新版本`, prompt: job.prompt + suffix, taskId: undefined, state: "waiting", error: undefined, hidden: false, anchor: undefined };
    // 统一模特的后续张已带上首张成片作为参考；单独再生成时直接沿用这次实际提交的参考图。
    const lead = batch.jobs.find((item) => item.anchor === "lead");
    const anchorId = job.anchor === "follow" ? outputResourceId(lead?.taskId ? tryOnState(ctx.scope).tasks[lead.taskId] : undefined) : "";
    if (anchorId) copy.references = job.anchorAt === "last" ? [...job.references, { resourceId: anchorId, role: "anchor" }] : [{ resourceId: anchorId, role: "anchor" }, ...job.references];
    updateTryOnBatch(ctx.scope, batchId, (item) => {
        const index = item.jobs.findIndex((entry) => entry.key === key);
        const jobs = [...item.jobs];
        jobs.splice(index + 1, 0, copy);
        return { ...item, jobs };
    });
    setNotice(ctx.scope, batchId, null);
    void pumpTryOnBatch(ctx, batchId);
}

export function hideTryOnJob(scope: string, batchId: string, key: string) {
    updateTryOnBatch(scope, batchId, (batch) => ({ ...batch, jobs: batch.jobs.map((job) => (job.key === key ? { ...job, hidden: true } : job)) }));
}

export async function removeTryOnBatch(scope: string, batchId: string) {
    current(scope);
    const { assetIds } = await deleteTryOnBatch(batchId);
    current(scope);
    deletedBatchIds.add(batchId);
    setBatches(scope, (batches) => batches.filter((batch) => batch.id !== batchId));
    setNotice(scope, batchId, null);
    await saveTryOnBatches(scope, current(scope).batches);
    await useAssetStore.getState().removeAssets(assetIds);
    await flushAssetStorePersistence();
    void appQueryClient.invalidateQueries({ queryKey: ["asset-library"] });
    void appQueryClient.invalidateQueries({ queryKey: ["asset-picker"] });
}

/** 用这批的草稿快照恢复面板，方便调整后再生成。 */
export function restoreTryOnBatch(scope: string, batchId: string) {
    const batch = findBatch(scope, batchId);
    if (!batch || batch.remote) return false;
    updateTryOnDraft(scope, (draft) => ({ ...batch.source, images: { ...draft.images, [batch.fn]: restoreImages(batch.source.images[batch.fn]).map((image) => ({ ...image, id: createClientUUID() })) }, consent: false }));
    return true;
}

let remoteChecked = false;

/** 在其他设备或旧标签页创建的批量换装任务：按服务端任务的批次 ID 归组展示（只读）。 */
export async function discoverRemoteTryOnBatches(scope: string) {
    if (remoteChecked) return;
    remoteChecked = true;
    let tasks: GenerationTask[] = [];
    try {
        tasks = await listWorkbenchTasks("image", 100);
    } catch (cause) {
        if (!(cause instanceof ApiError)) remoteChecked = false;
        return;
    }
    if (getActiveUserScope() !== scope || state?.scope !== scope) return;
    const known = new Set(state.batches.map((batch) => batch.id));
    const groups = new Map<string, GenerationTask[]>();
    for (const task of tasks) {
        const id = task.clientContext?.batchId || "";
        if (!id.startsWith("tryon_") || known.has(id) || deletedBatchIds.has(id)) continue;
        groups.set(id, [...(groups.get(id) || []), task]);
    }
    if (!groups.size) return;
    const remote: TryOnBatch[] = [];
    for (const [id, items] of groups) {
        const fn = tryOnFunctionFromBatchId(id);
        if (!fn) continue;
        const sorted = [...items].sort((a, b) => (a.clientContext?.batchIndex || 0) - (b.clientContext?.batchIndex || 0));
        for (const task of sorted) setTryOnTask(scope, task);
        remote.push({
            id,
            fn,
            createdAt: sorted.map((task) => task.createdAt).sort()[0] || new Date().toISOString(),
            summary: tryOnFunction(fn).label,
            model: "",
            modelLabel: sorted[0]?.model || "",
            ratio: "",
            resolution: "",
            source: { ...tryOnState(scope).draft, fn, images: {} },
            jobs: sorted.map((task, index) => ({ key: task.id, index, title: `第 ${index + 1} 张`, prompt: task.prompt, references: [], taskId: task.id, state: "submitted" as const })),
            remote: true,
        });
    }
    if (remote.length) setBatches(scope, (batches) => [...batches, ...remote].sort(byNewest));
}

export { usesAiModel };
