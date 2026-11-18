import { App } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { systemModelQuoteRequest } from "@/lib/model-pricing";
import { quoteModel } from "@/services/api/logical-models";
import { logicalModelIDForConfig, modelDisplayName, resolveModelChannel, selectableModelsByCapability, useEffectiveConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

import { useCommerceAdminModels } from "../admin-models";
import { displayImageSizeChoices } from "../catalog";
import type { CommerceModelProfile } from "../model-catalog";
import { MAX_TRYON_COUNT, tryOnFunction, type TryOnFunction, type TryOnSlotKey } from "./tryon-kinds";
import { agentReferenceIds, castingSelectable, isFaceSwapFunction, missingInput, needsAgentPlan, readyImages, slotImages, tryOnUnits, type TryOnDraft } from "./tryon-plan";
import {
    addTryOnCatalog,
    addTryOnFiles,
    addTryOnResources,
    addTryOnReferences,
    continueTryOnBatch,
    discoverRemoteTryOnBatches,
    hideTryOnJob,
    regenerateTryOnJob,
    removeTryOnBatch,
    removeTryOnImage,
    restoreTryOnBatch,
    resumeTryOnBatches,
    retryTryOnJob,
    startTryOnBatch,
    subscribeTryOn,
    swapTryOnSlots,
    switchTryOnFunction,
    tryOnState,
    updateTryOnDraft,
    watchTryOnTasks,
    type TryOnMarket,
    type TryOnRunContext,
} from "./tryon-runtime";

/** 一张图在当前功能里最多带几张参考图（决定可选模型与报价）。 */
function referencesPerImage(draft: TryOnDraft) {
    const garments = readyImages(draft, "garment").length || 1;
    switch (draft.fn) {
        case "model-views":
            return tryOnFunction(draft.fn).slots.reduce((count, slot) => count + readyImages(draft, slot.key).length, 0);
        case "outfit":
            return 1 + garments;
        case "fine-outfit":
            // 精细化换装和普通换装一样：每张图同时提交图一人物和所有服装角度参考。
            return 1 + garments;
        case "multi-model":
            return (draft.modelSource === "ai" ? (draft.casting === "unified" ? 1 : 0) : 1) + garments;
        case "multi-outfit":
            // 上传模特或统一 AI 模特的后续张都多带 1 张人物参考。
            return 1 + (draft.outfitMode === "set" ? garments : 1);
        case "pose":
            return readyImages(draft, "pose").length ? 2 : 1;
        case "face-swap":
            return 1 + (readyImages(draft, "face").length || 1);
        case "smart-face":
        case "smart-head":
            return draft.casting === "unified" && draft.count > 1 ? 2 : 1;
        case "background":
        case "scene":
            // 图一主体 + 图二环境，顺序与 buildTryOnJobs 保持一致。
            return 2;
        case "enhance":
            return 1;
        default:
            return 1;
    }
}

export type TryOnState = ReturnType<typeof useTryOn>;

export function useTryOn({ scope, fn, market, defaultModel = "" }: { scope: string; fn: TryOnFunction; market: TryOnMarket; defaultModel?: string }) {
    const { message } = App.useApp();
    const config = useEffectiveConfig();
    const admin = useCommerceAdminModels(config);
    const runtime = useSyncExternalStore(subscribeTryOn, () => tryOnState(scope));
    const { draft, batches, tasks, notices } = runtime;
    const [submitting, setSubmitting] = useState(false);
    const [visibleBatches, setVisibleBatches] = useState(10);

    // 外部选择的功能（批量换装按钮）就是当前功能；只在选择变化时切换，「再次编辑」恢复草稿时由外部同步选择。
    useEffect(() => {
        switchTryOnFunction(scope, fn);
    }, [fn, scope]);

    const update = useCallback((patch: Partial<TryOnDraft>) => updateTryOnDraft(scope, (current) => ({ ...current, ...patch })), [scope]);

    // ---------- 模型与规格：和「商品图片」同一套规则 ----------
    // 工作台任务只接受系统模型目录里的模型（逻辑模型或系统渠道），自定义渠道不出现在选项里。
    const systemModel = useCallback((model: string) => Boolean(logicalModelIDForConfig({ ...config, model })) || resolveModelChannel(config, model).scope === "system", [config]);
    const imageModels = useMemo(() => selectableModelsByCapability(config, "image").filter(systemModel), [config, systemModel]);
    const refsPerImage = referencesPerImage(draft);
    // 没选过模型时沿用「商品图片」里选中的模型（能接收多张参考图时），否则取第一个支持多图参考的模型。
    const multiReference = (model: string) => (modelCapabilityConfigFor(config, model).image?.references.maxImages || 0) >= 2;
    const imageModel =
        draft.imageModel && imageModels.includes(draft.imageModel) ? draft.imageModel : defaultModel && imageModels.includes(defaultModel) && multiReference(defaultModel) ? defaultModel : imageModels.find(multiReference) || imageModels[0] || "";
    const profile = imageModel ? modelCapabilityConfigFor(config, imageModel).image : undefined;
    const ratioValues = profile?.size.values.length ? profile.size.values : [profile?.size.default || "1:1"];
    const ratio = draft.ratio && ratioValues.includes(draft.ratio) ? draft.ratio : ratioValues.includes(tryOnFunction(draft.fn).defaultRatio) ? tryOnFunction(draft.fn).defaultRatio : profile?.size.default || ratioValues[0];
    const ratioChoices = useMemo(() => displayImageSizeChoices(ratioValues, ratio), [ratio, ratioValues.join("|")]);
    const resolutionChoices = profile?.resolution.supported ? profile.resolution.values : [profile?.quality.default || "auto"];
    const resolution = resolutionChoices.includes(draft.resolution) ? draft.resolution : profile?.resolution.supported ? profile.resolution.default : resolutionChoices[0];
    const maxReferences = Math.min(20, profile?.references.maxImages || 0);
    const units = tryOnUnits(draft);
    const count = Math.max(units, Math.min(MAX_TRYON_COUNT, draft.count));
    // 素材数量变化后张数不能少于单元数（例如 3 位模特至少 3 张）。
    useEffect(() => {
        if (draft.count !== count) update({ count });
    }, [count, draft.count, update]);
    const setModel = useCallback(
        (model: string) => {
            const next = modelCapabilityConfigFor(config, model).image;
            const values = next?.size.values.length ? next.size.values : [next?.size.default || "1:1"];
            const preferred = tryOnFunction(tryOnState(scope).draft.fn).defaultRatio;
            update({
                imageModel: model,
                ratio: values.includes(ratio) ? ratio : values.includes(preferred) ? preferred : next?.size.default || values[0],
                resolution: next?.resolution.supported ? next.resolution.default : next?.quality.default || "auto",
            });
        },
        [config, ratio, scope, update],
    );

    // ---------- Agent 读图模型 ----------
    const agentRefs = agentReferenceIds(draft).length;
    const agentCandidates = [admin.visionModel, admin.planningModel].filter(Boolean);
    const agentModel = agentCandidates.find((model) => (modelCapabilityConfigFor(config, model).text?.references.maxImages || 0) >= Math.max(1, agentRefs)) || "";
    // 换脸读图没有可用模型时直接出图（与 startTryOnBatch 同一规则）。
    const planned = needsAgentPlan(draft) && (!isFaceSwapFunction(draft.fn) || !!agentModel);

    const context = useMemo<TryOnRunContext>(() => ({ scope, config, agentModel, market }), [agentModel, config, market, scope]);
    const contextRef = useRef(context);
    contextRef.current = context;

    // 打开时接上未完成的批次，并找回其他设备创建的批量换装任务。
    const resumed = useRef("");
    useEffect(() => {
        if (!imageModels.length || !admin.loaded || !runtime.batchesLoaded || resumed.current === scope) return;
        resumed.current = scope;
        resumeTryOnBatches(contextRef.current);
        void discoverRemoteTryOnBatches(scope);
    }, [imageModels.length, admin.loaded, runtime.batchesLoaded, scope]);

    // 只订阅展示中的批次的任务。
    const shown = useMemo(() => batches.slice(0, visibleBatches), [batches, visibleBatches]);
    const watchIds = useMemo(() => [...new Set(shown.flatMap((batch) => [...batch.jobs.map((job) => job.taskId || ""), batch.planning?.taskId || ""]).filter(Boolean))], [shown]);
    useEffect(() => watchTryOnTasks(scope, watchIds), [scope, watchIds.join("|")]);

    // ---------- 报价 ----------
    const [estimate, setEstimate] = useState<{ image: number | null; agent: number | null; loading: boolean }>({ image: null, agent: null, loading: false });
    useEffect(() => {
        if (!imageModel) {
            setEstimate({ image: null, agent: null, loading: false });
            return;
        }
        const controller = new AbortController();
        setEstimate((value) => ({ ...value, loading: true }));
        const timer = window.setTimeout(() => {
            const size = ratio === "auto" ? ratioValues.find((value) => value !== "auto") || ratio : ratio;
            const imageRequest = systemModelQuoteRequest(config, imageModel, "image", {
                capability: "image",
                input: { textCount: 1, imageCount: refsPerImage, referenceImageCount: refsPerImage, videoCount: 0, audioCount: 0, characterCount: 0 },
                imageSize: size,
                options: { size, imageResolution: resolution, count: 1 },
            });
            const agentRequest =
                planned && agentModel
                    ? systemModelQuoteRequest(config, agentModel, "text", { capability: "text", input: { textCount: 1, imageCount: agentRefs, referenceImageCount: agentRefs, videoCount: 0, audioCount: 0, characterCount: 0 } })
                    : undefined;
            void Promise.all([imageRequest ? quoteModel(imageRequest, controller.signal).catch(() => null) : Promise.resolve(null), agentRequest ? quoteModel(agentRequest, controller.signal).catch(() => null) : Promise.resolve(null)]).then(
                ([image, agent]) => {
                    if (controller.signal.aborted) return;
                    setEstimate({ image: image ? image.quote.amountMicrocredits / 1_000_000 : null, agent: agent ? agent.quote.amountMicrocredits / 1_000_000 : planned ? null : 0, loading: false });
                },
            );
        }, 250);
        return () => {
            controller.abort();
            window.clearTimeout(timer);
        };
    }, [agentModel, agentRefs, config, imageModel, planned, ratio, ratioValues.join("|"), refsPerImage, resolution]);
    const total = estimate.image === null || (planned && estimate.agent === null) ? null : estimate.image * count + (planned ? estimate.agent || 0 : 0);

    // ---------- 校验 ----------
    const uploading = Object.values(draft.images).some((list) => list?.some((image) => !image.resourceId && !image.error));
    const modelIssue = !imageModels.length
        ? "当前没有可用的图片模型"
        : !imageModel
          ? "请选择图片模型"
          : refsPerImage > maxReferences
            ? `当前图片模型最多接收 ${maxReferences} 张参考图，这个功能每张需要 ${refsPerImage} 张，请换用支持多图参考的模型或减少素材`
            : planned && !agentModel
              ? admin.loaded
                  ? admin.problem || "后台指定的电商 Agent 模型不能读取这么多张图片，请关闭 Agent 多场景或减少素材"
                  : "正在读取电商 Agent 模型配置"
              : "";
    // 与商品图片一致：开启积分时必须先拿到服务端报价才允许提交。
    const creditsEnabled = useUserStore((store) => store.features.creditsEnabled);
    const quoteIssue = creditsEnabled && total === null ? (estimate.loading ? "正在报价，请稍候" : "当前配置暂时无法报价，请稍后重试或更换模型") : "";
    const missing = missingInput({ ...draft, count }) || modelIssue || quoteIssue;

    const generate = useCallback(async () => {
        if (submitting) return;
        const latest = { ...tryOnState(scope).draft, imageModel, ratio, resolution, count };
        const reason = missingInput(latest) || modelIssue || quoteIssue;
        if (reason) {
            message.warning(reason);
            return;
        }
        setSubmitting(true);
        try {
            const batch = await startTryOnBatch(contextRef.current, latest, modelDisplayName(config, imageModel));
            message.success(`已开始生成 ${count} 张`);
            return batch;
        } catch (error) {
            message.error(error instanceof Error ? error.message : "任务未能保存，请重试");
        } finally {
            setSubmitting(false);
        }
    }, [config, count, imageModel, message, modelIssue, quoteIssue, ratio, resolution, scope, submitting]);

    const addFiles = useCallback(
        async (slot: TryOnSlotKey, files: File[]) => {
            const problems = await addTryOnFiles(scope, slot, files);
            if (problems.length) message.warning(problems.join("；"));
        },
        [message, scope],
    );
    const addResources = useCallback(
        (slot: TryOnSlotKey, picked: Array<{ resourceId: string; name: string; width?: number; height?: number }>) => {
            const skipped = addTryOnResources(scope, slot, picked);
            if (skipped > 0) message.warning(`已达上限，${skipped} 张未添加`);
        },
        [message, scope],
    );
    const addCatalog = useCallback(
        async (slot: TryOnSlotKey, profile: CommerceModelProfile) => {
            try {
                await addTryOnCatalog(scope, slot, profile);
                message.success(`已添加 ${profile.name}`);
            } catch (cause) {
                message.error(cause instanceof Error ? cause.message : "添加模特失败");
            }
        },
        [message, scope],
    );
    const swap = useCallback(
        (a: TryOnSlotKey, b: TryOnSlotKey) => {
            const problem = swapTryOnSlots(scope, a, b);
            if (problem) message.info(problem);
        },
        [message, scope],
    );

    return {
        scope,
        config,
        draft,
        update,
        batches,
        batchesLoaded: runtime.batchesLoaded,
        shown,
        hasMoreBatches: batches.length > shown.length,
        showMoreBatches: () => setVisibleBatches((value) => value + 10),
        tasks,
        notices,
        slotImages: (slot: TryOnSlotKey) => slotImages(draft, slot),
        addFiles,
        addResources,
        addReferences: (slot: TryOnSlotKey, selections: import("./reference-catalog").ReferenceSelection[]) => addTryOnReferences(scope, slot, selections),
        addCatalog,
        removeImage: (id: string) => removeTryOnImage(scope, id),
        swap,
        imageModel,
        imageModels,
        systemModel,
        setModel,
        ratio,
        ratioChoices,
        resolution,
        resolutionChoices,
        maxReferences,
        refsPerImage,
        count,
        units,
        setCount: (value: number) => update({ count: Math.max(units, Math.min(MAX_TRYON_COUNT, value)) }),
        castingSelectable: castingSelectable(draft),
        planned,
        agentModel,
        estimate,
        total,
        uploading,
        missing,
        submitting,
        generate,
        retry: (batchId: string, key: string) => retryTryOnJob(contextRef.current, batchId, key).catch((cause) => message.error(cause instanceof Error ? cause.message : "重试失败")),
        regenerate: (batchId: string, key: string) => regenerateTryOnJob(contextRef.current, batchId, key),
        hideJob: (batchId: string, key: string) => hideTryOnJob(scope, batchId, key),
        removeBatch: (batchId: string) => removeTryOnBatch(scope, batchId),
        continueBatch: (batchId: string) => continueTryOnBatch(contextRef.current, batchId),
        restoreBatch: (batchId: string) => restoreTryOnBatch(scope, batchId),
        market,
    };
}
