import { infiniteQueryOptions } from "@tanstack/react-query";

import type { CreationMode } from "@/pages/create/creation-types";
import { LIBTV_GALLERY_PAGE_SIZE } from "@/services/api/libtv-gallery";
import type { LibTVGalleryItem, LibTVGalleryParams, LibTVGalleryResponse, LibTVGalleryTag, LibTVWorkStep } from "@/types/libtv-gallery";

export type LibTVGalleryPageParam = { page: number; requestId?: string };
export type LibTVGalleryFetcher = (params: LibTVGalleryParams) => Promise<LibTVGalleryResponse>;

/** 后续页沿用首页返回的 requestId，requestId 不进 queryKey，避免首页响应触发重新查询。 */
export function getNextLibTVGalleryPageParam(lastPage: LibTVGalleryResponse, allPages: LibTVGalleryResponse[]): LibTVGalleryPageParam | undefined {
    if (!lastPage.hasMore) return undefined;
    return { page: allPages.length + 1, requestId: allPages[0]?.requestId || undefined };
}

export function libTVGalleryInfiniteQuery(filters: { keyword: string; tagId?: number }, fetcher: LibTVGalleryFetcher) {
    const keyword = filters.keyword.trim();
    return infiniteQueryOptions({
        queryKey: ["libtv-gallery", keyword, filters.tagId ?? null] as const,
        queryFn: ({ pageParam }) =>
            fetcher({
                page: pageParam.page,
                pageSize: LIBTV_GALLERY_PAGE_SIZE,
                keyword: keyword || undefined,
                tagId: filters.tagId,
                requestId: pageParam.requestId,
            }),
        initialPageParam: { page: 1 } as LibTVGalleryPageParam,
        getNextPageParam: getNextLibTVGalleryPageParam,
    });
}

/** 每次进入使用新种子，逐页洗牌；追加页不移动已展示的作品，也不改写共享查询缓存。 */
export function shuffleLibTVGalleryPages<T extends { templateUuid: string }>(pages: { items: T[] }[], seed: number): T[] {
    let state = seed >>> 0;
    const seen = new Set<string>();
    return pages.flatMap((page) => {
        const items = [...page.items];
        for (let index = items.length - 1; index > 0; index -= 1) {
            state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
            const other = Math.floor((state / 0x100000000) * (index + 1));
            [items[index], items[other]] = [items[other], items[index]];
        }
        return items.filter((item) => {
            if (seen.has(item.templateUuid)) return false;
            seen.add(item.templateUuid);
            return true;
        });
    });
}

const LIBTV_TEMPLATE_MARKER_PATTERN = /\{\{\s*(?:Mixed|Image|Video|Audio|Text)\s+\d+\s*\}\}/i;

export function hasLibTVTemplateMarker(text?: string) {
    return Boolean(text && LIBTV_TEMPLATE_MARKER_PATTERN.test(text));
}

export type LibTVMakeSameState = { mode: CreationMode; prompt: string; ratio?: string };
export type LibTVMakeSameResolution = { ok: true; state: LibTVMakeSameState } | { ok: false; reason: "unsupported-type" | "missing-prompt" | "has-references" };

/** 做同款只预填提示词和比例；模型与未提供的参数保留用户当前设置，不自动提交。 */
export function resolveLibTVMakeSame(step: LibTVWorkStep): LibTVMakeSameResolution {
    if (step.type !== "image" && step.type !== "video") return { ok: false, reason: "unsupported-type" };
    const prompt = step.prompt?.trim();
    if (!prompt) return { ok: false, reason: "missing-prompt" };
    if (step.referenceNodeIds?.length || hasLibTVTemplateMarker(prompt)) return { ok: false, reason: "has-references" };
    const ratio = step.aspectRatio?.trim();
    return { ok: true, state: { mode: step.type, prompt, ...(ratio ? { ratio } : {}) } };
}

export type LibTVStepPrompt = { id: string; index: number; title: string; type: LibTVWorkStep["type"]; prompt: string };

/**
 * 上游没有整片提示词字段，只有逐步骤提示词。这里按步骤返回，绝不拼接成一条「完整视频提示词」冒充模板。
 */
export function collectLibTVStepPrompts(steps: LibTVWorkStep[]): LibTVStepPrompt[] {
    return steps
        .map((step, index) => ({ id: step.id, index, title: step.title?.trim() || `步骤 ${index + 1}`, type: step.type, prompt: step.prompt?.trim() || "" }))
        .filter((item) => Boolean(item.prompt));
}

export type LibTVReplicationOption = { index: number; step: LibTVWorkStep; state: LibTVMakeSameState };
export type LibTVReplicationPlan = { kind: "options"; options: LibTVReplicationOption[] } | { kind: "canvas-only"; reason: "no-video-step" | "blocked" };

/**
 * 一键复刻只针对「可独立复用的视频步骤」：只取视频步骤，且不含引用/模板标记、有真实提示词。
 * 不做整片一键复刻——不能拿第一个节点提示词或拼接文本冒充整片模板，也不预置任何要付费的提交。
 */
export function resolveLibTVReplicationPlan(steps: LibTVWorkStep[]): LibTVReplicationPlan {
    const videoSteps = steps.map((step, index) => ({ index, step })).filter((item) => item.step.type === "video");
    if (videoSteps.length === 0) return { kind: "canvas-only", reason: "no-video-step" };
    const options = videoSteps.flatMap((item) => {
        const resolution = resolveLibTVMakeSame(item.step);
        return resolution.ok ? [{ index: item.index, step: item.step, state: resolution.state }] : [];
    });
    if (options.length === 0) return { kind: "canvas-only", reason: "blocked" };
    return { kind: "options", options };
}

/**
 * 精选推荐只能来自真实列表数据：排除当前作品、按 uuid 去重、必须有标题，
 * 优先同标签，其次已加载顺序；凑不满就少给，不用占位卡片充数。
 */
export function pickLibTVRecommendations(items: LibTVGalleryItem[], currentTemplateUuid: string, limit = 6, preferredTagIds: number[] = []): LibTVGalleryItem[] {
    const preferred = new Set(preferredTagIds);
    const seen = new Set<string>();
    const candidates: LibTVGalleryItem[] = [];
    for (const item of items) {
        if (!item.templateUuid || item.templateUuid === currentTemplateUuid) continue;
        if (seen.has(item.templateUuid) || !item.title?.trim()) continue;
        seen.add(item.templateUuid);
        candidates.push(item);
    }
    const byTag = preferred.size > 0 ? candidates.filter((item) => item.tags.some((tag) => preferred.has(tag.id))) : [];
    const rest = candidates.filter((item) => !byTag.includes(item));
    return [...byTag, ...rest].slice(0, Math.max(0, limit));
}

export type LibTVGalleryTagRank = { visible: LibTVGalleryTag[]; hiddenCount: number };

/**
 * 标签很多时只平铺常用的几个，其余按需展开；不虚构层级、不改写标签，仍然拿真实 tagId 筛选。
 * 顺序按已加载作品的真实出现次数（并列时保持首次出现顺序），当前选中的标签始终可见，切到冷门标签也不会「看不见自己在筛什么」。
 *
 * catalog 是累积过的标签目录（跨搜索/切标签保留）。加载中、搜索 0 结果、请求失败时 items 为空，
 * 只看 items 会把选中标签连同「全部」一起从首屏抹掉，用户就看不到、也清不掉自己在筛什么。
 */
export function rankLibTVGalleryTags(items: LibTVGalleryItem[], selectedTagId?: number, limit = 8, catalog: LibTVGalleryTag[] = []): LibTVGalleryTagRank {
    const count = new Map<number, number>();
    const order = new Map<number, number>();
    const byId = new Map<number, LibTVGalleryTag>();
    const remember = (tag: LibTVGalleryTag) => {
        if (byId.has(tag.id)) return;
        order.set(tag.id, order.size);
        byId.set(tag.id, tag);
    };
    for (const tag of catalog) remember(tag);
    for (const item of items) {
        for (const tag of item.tags) {
            count.set(tag.id, (count.get(tag.id) ?? 0) + 1);
            remember(tag);
        }
    }
    const sorted = [...byId.values()].sort((a, b) => (count.get(b.id) ?? 0) - (count.get(a.id) ?? 0) || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    if (selectedTagId === undefined) return { visible: sorted.slice(0, Math.max(0, limit)), hiddenCount: Math.max(0, sorted.length - limit) };
    const current = sorted.find((tag) => tag.id === selectedTagId);
    if (!current) return { visible: sorted.slice(0, Math.max(0, limit)), hiddenCount: Math.max(0, sorted.length - limit) };
    const visible = [current, ...sorted.filter((tag) => tag.id !== selectedTagId).slice(0, Math.max(0, limit - 1))];
    return { visible, hiddenCount: Math.max(0, sorted.length - visible.length) };
}

export type LibTVCanvasDraftDeps = {
    create: (title: string) => Promise<{ id: string; syncError?: unknown }>;
    retry: (projectId: string) => Promise<unknown>;
    exists: (projectId: string) => boolean;
};
export type LibTVCanvasDraftResult = { ok: true; projectId: string } | { ok: false; projectId: string; phase: "create" | "retry"; error: unknown };

/**
 * 复制到画布前确保草稿画布已写入云端：模板导入接口要校验画布归属，远端不存在时不能进入导入。
 * 上次云端失败留下的本地草稿先显式重试同步，成功后才可导航；本地草稿已被删除时重新创建。
 */
export async function ensureRemoteLibTVCanvasDraft(draftProjectId: string | undefined, title: string, deps: LibTVCanvasDraftDeps): Promise<LibTVCanvasDraftResult> {
    if (draftProjectId && deps.exists(draftProjectId)) {
        try {
            await deps.retry(draftProjectId);
            return { ok: true, projectId: draftProjectId };
        } catch (error) {
            return { ok: false, projectId: draftProjectId, phase: "retry", error };
        }
    }
    const created = await deps.create(title);
    if (created.syncError) return { ok: false, projectId: created.id, phase: "create", error: created.syncError };
    return { ok: true, projectId: created.id };
}

/** 只让最近一次请求写回状态；关闭、切换模板或画布、卸载时调用 invalidate 作废在途请求。 */
export function createLatestRequestGuard() {
    let generation = 0;
    return {
        begin: () => ++generation,
        isCurrent: (token: number) => token === generation,
        invalidate: () => {
            generation += 1;
        },
    };
}
