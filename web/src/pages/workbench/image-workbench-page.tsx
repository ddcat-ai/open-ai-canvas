import { App, Button } from "antd";
import { Clapperboard, Image as ImageIcon, RotateCcw } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { CanvasResourceMentionTextarea } from "@/components/canvas/canvas-resource-mention-textarea";
import { ImageSizePicker } from "@/components/image-size-picker";
import { WorkspacePage } from "@/components/layout/workspace-page";
import { ModelPicker } from "@/components/model-picker";
import { SegmentedControl } from "@/components/ui/base/segmented-control/segmented-control";
import { AntTooltip as Tooltip } from "@/components/ui/base/tooltip/ant-tooltip";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { normalizeCanvasNodeMentionTokens, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { audioUploadTitleFromFileName } from "@/lib/audio-upload-title";
import { createClientUUID } from "@/lib/client-id";
import { togglePromptPhrase } from "@/lib/prompt-phrases";
import { imageQualityLabel } from "@/lib/image-quality";
import { imageResolutionUsesQuality } from "@/lib/image-size-presets";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { preserveImageSettings as normalizeImageValue, preserveVideoSettings as normalizeVideoValue, mediaSettingIssues } from "@/lib/media-settings";
import { MediaSettingsNotice } from "@/components/media-settings-notice";
import { modelQuoteRequest, requestCreditCost } from "@/lib/model-pricing";
import { creationVideoConfig } from "@/pages/create/creation-generation-config";
import { resolveBrowserMediaDownloadHref, startBrowserDownload } from "@/services/browser-download";
import { prepareBackendGenerationTask } from "@/services/api/generation-task";
import { quoteModel } from "@/services/api/logical-models";
import { resourceStorageKey, uploadResourceFile } from "@/services/api/resources";
import { cancelGenerationTask, createGenerationTask, queryGenerationTask, retryGenerationTask, type GenerationTask } from "@/services/api/task-center";
import { capabilitySupportedModes, createWorkbenchTask, listWorkbenchTasks, listWorkbenchTools, resolveWorkbenchResourceURL, type WorkbenchKind, type WorkbenchPromptPreset, type WorkbenchReferenceSlot, type WorkbenchTool } from "@/services/api/workbench";
import { useCreationPreferencesStore } from "@/stores/use-creation-preferences-store";
import { logicalModelIDForConfig, modelDisplayName, modelOptionName, resolveModelChannel, resolveModelRequestConfig, selectableModelsByCapability, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

import {
    aspectRatioOf,
    groupWorkbenchTasks,
    isActiveWorkbenchTask,
    planWorkbenchBatch,
    workbenchBatchLimit,
    workbenchDownloadName,
    workbenchParameterSummary,
    workbenchTaskOutputs,
    workbenchTaskSnapshot,
    type WorkbenchOutput,
    type WorkbenchTaskGroup,
} from "./workbench-batches";
import { ChoiceChips, ComposerFooter, ComposerSection, CountStepper, PromptSection, ReferenceSection, SceneSection, SwitchRow, videoRatioOptions, type WorkbenchReference } from "./workbench-composer";
import { WorkbenchGallery, type GalleryActions, type GalleryBatch, type GalleryFilter, type GalleryTile } from "./workbench-gallery";
import { missingWorkbenchInput, workbenchPromptRequired, workbenchVideoOperation } from "./workbench-input";
import { isModelIdLike, WORKBENCH_INSPIRATIONS, WORKBENCH_SPEC_TIPS, workbenchQuickTools, workbenchRatioUsage } from "./workbench-presets";
import { SceneLibraryModal } from "./workbench-scene-library";
import { WorkbenchViewer } from "./workbench-viewer";
import "./workbench.css";

export { filterWorkbenchTools } from "./workbench-presets";
export { workbenchTaskSnapshot } from "./workbench-batches";
export type { WorkbenchReference } from "./workbench-composer";

const WorkbenchAssetPicker = lazy(() => import("./workbench-asset-picker").then((module) => ({ default: module.WorkbenchAssetPicker })));

const BATCH_DOWNLOAD_INTERVAL_MS = 400;
const DETAIL_CONCURRENCY = 3;

type MediaKind = WorkbenchReference["kind"];

/** 提交那一刻冻结的请求；“继续提交剩余”使用同一份参数，不受之后编辑影响。 */
type BatchRequest = {
    kind: WorkbenchKind;
    route: "workbench" | "tasks";
    prompt: string;
    model: string;
    logicalModelId?: string;
    channelId?: string;
    toolId?: string;
    presetId?: string;
    parameters: Record<string, unknown>;
    references: WorkbenchReference[];
    generationConfig: ReturnType<typeof useEffectiveConfig>;
    videoOperation?: string;
};

type LocalBatch = {
    id: string;
    createdAt: string;
    prompt: string;
    toolName?: string;
    modelLabel: string;
    parameters: Record<string, unknown>;
    ratio?: number;
    plan: number[];
    states: Array<"pending" | "submitting" | "created" | "failed">;
    receipts: Record<number, GenerationTask>;
    submitting: boolean;
    error?: string;
    request: BatchRequest;
};

function revokeReferencePreview(reference: WorkbenchReference) {
    if (reference.previewUrl.startsWith("blob:")) URL.revokeObjectURL(reference.previewUrl);
}

function errorMessage(error: unknown, fallback: string) {
    return error instanceof Error && error.message ? error.message : fallback;
}

function mediaKindOfFile(file: File): MediaKind | null {
    if (file.type.startsWith("image/")) return "image";
    if (file.type.startsWith("video/")) return "video";
    if (file.type.startsWith("audio/")) return "audio";
    return null;
}

function mediaLabel(kind: MediaKind) {
    return kind === "image" ? "图片" : kind === "video" ? "视频" : "音频";
}

/** 视频的首帧、尾帧各只能有一个；新设为首帧/尾帧时把原来的降为普通参考。 */
function withUniqueFrameRole(references: WorkbenchReference[], targetId: string, role: WorkbenchReference["role"]) {
    return references.map((item) => {
        if (item.id === targetId) return { ...item, role };
        if (role !== "reference" && item.role === role) return { ...item, role: "reference" as const };
        return item;
    });
}

/** 视频图片素材的默认用途：首帧/尾帧槽位或无槽位时先占首帧，其余作为参考。 */
function defaultVideoRole(slot: WorkbenchReferenceSlot | undefined, existing: WorkbenchReference[]): WorkbenchReference["role"] {
    const name = slot?.name || "";
    if (name.includes("尾帧") && !existing.some((item) => item.role === "last_frame")) return "last_frame";
    if ((!slot || name.includes("首帧")) && !existing.some((item) => item.role === "first_frame")) return "first_frame";
    return "reference";
}

function receiptTask(raw: Partial<GenerationTask> & { id: string }, request: BatchRequest, batch: { id: string; index: number; count: number }): GenerationTask {
    const now = new Date().toISOString();
    return {
        type: request.kind === "image" ? "canvas_image" : "canvas_video",
        prompt: request.prompt,
        attempts: 0,
        createdAt: now,
        updatedAt: now,
        ...raw,
        status: raw.status || "queued",
        clientContext: { ...(raw.clientContext || {}), batchId: batch.id, batchIndex: batch.index, batchCount: batch.count },
    } as GenerationTask;
}

function mergeTaskUpdate(previous: GenerationTask | undefined, next: GenerationTask): GenerationTask {
    return previous ? { ...previous, ...next, clientContext: next.clientContext || previous.clientContext } : next;
}

export function WorkbenchPage({ kind }: { kind: WorkbenchKind }) {
    const { message, modal } = App.useApp();
    const navigate = useNavigate();
    const config = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const features = useUserStore((state) => state.features);
    const creditsEnabled = features.creditsEnabled;
    const activeTaskLimit = useUserStore((state) => state.runtimeLimits.activeTaskLimit);
    const [searchParams, setSearchParams] = useSearchParams();

    const [tools, setTools] = useState<WorkbenchTool[]>([]);
    const [directoryLoading, setDirectoryLoading] = useState(true);
    const [directoryError, setDirectoryError] = useState("");
    const [libraryOpen, setLibraryOpen] = useState(false);
    const [tool, setTool] = useState<WorkbenchTool | null>(null);
    const [preset, setPreset] = useState<WorkbenchPromptPreset | null>(null);
    const [presetPending, setPresetPending] = useState<WorkbenchPromptPreset | null>(null);
    const [prompt, setPrompt] = useState("");
    const [references, setReferencesState] = useState<WorkbenchReference[]>([]);
    const referencesRef = useRef<WorkbenchReference[]>([]);
    const setReferences = useCallback((update: WorkbenchReference[] | ((current: WorkbenchReference[]) => WorkbenchReference[])) => {
        const next = typeof update === "function" ? update(referencesRef.current) : update;
        referencesRef.current = next;
        setReferencesState(next);
    }, []);
    useEffect(() => () => referencesRef.current.forEach(revokeReferencePreview), []);
    const fileRef = useRef<HTMLInputElement>(null);
    const [uploadSlotKey, setUploadSlotKey] = useState<string | undefined>();
    const [assetPicker, setAssetPicker] = useState<{ slotKey?: string } | null>(null);

    const preferencesHydrated = useCreationPreferencesStore((state) => state.hydrated);
    const rememberImageSettings = useCreationPreferencesStore((state) => state.rememberImageSettings);
    const rememberVideoSettings = useCreationPreferencesStore((state) => state.rememberVideoSettings);
    const [settingsReady, setSettingsReady] = useState(false);
    const [ratio, setRatio] = useState(kind === "image" ? "1:1" : "16:9");
    const [quality, setQuality] = useState("auto");
    const [imageResolution, setImageResolution] = useState("auto");
    const [count, setCount] = useState(1);
    const [seconds, setSeconds] = useState("6");
    const [videoQuality, setVideoQuality] = useState("720");

    const [tasks, setTasks] = useState<GenerationTask[]>([]);
    const [tasksLoading, setTasksLoading] = useState(true);
    const [localBatches, setLocalBatchesState] = useState<LocalBatch[]>([]);
    const localBatchesRef = useRef<LocalBatch[]>([]);
    const setLocalBatches = useCallback((update: (current: LocalBatch[]) => LocalBatch[]) => {
        localBatchesRef.current = update(localBatchesRef.current);
        setLocalBatchesState(localBatchesRef.current);
    }, []);
    const updateLocalBatch = useCallback((id: string, update: (batch: LocalBatch) => LocalBatch) => setLocalBatches((current) => current.map((batch) => (batch.id === id ? update(batch) : batch))), [setLocalBatches]);
    const [details, setDetails] = useState<Record<string, GenerationTask>>({});
    const [detailErrors, setDetailErrors] = useState<ReadonlySet<string>>(() => new Set());
    const detailQueueRef = useRef<Array<{ id: string; version: string }>>([]);
    const detailInflightRef = useRef(new Set<string>());
    const detailFailedRef = useRef(new Map<string, string>());
    const detailActiveRef = useRef(0);
    const [visibleBatchKeys, setVisibleBatchKeys] = useState<ReadonlySet<string>>(() => new Set());
    const [measuredRatios, setMeasuredRatios] = useState<Record<string, number>>({});
    const [busy, setBusy] = useState(false);
    const [busyTaskIds, setBusyTaskIds] = useState<ReadonlySet<string>>(() => new Set());
    const [viewer, setViewer] = useState<{ batchKey: string; outputKey: string } | null>(null);
    const [filter, setFilter] = useState<GalleryFilter>("all");
    const [query, setQuery] = useState("");
    const [mobileTab, setMobileTab] = useState<"compose" | "gallery">("compose");
    const [estimateState, setEstimateState] = useState<{ key?: string; credits: number | null; estimated: boolean; tone: "quote" | "local" | "usage" | "loading" | "unavailable" }>({ credits: null, estimated: false, tone: "unavailable" });

    const capability = kind;
    const configuredModel = kind === "image" ? config.imageModel || config.model : config.videoModel || config.model;
    // 与创作页同一份可选目录。系统渠道模型通常没有 logicalModelId，不能据此滤成空列表。
    const models = useMemo(() => selectableModelsByCapability(config, capability), [capability, config]);
    const selectedModel = models.includes(configuredModel) ? configuredModel : models[0] || "";
    const profile = useMemo(() => modelCapabilityConfigFor(config, selectedModel), [config, selectedModel]);
    const imageProfile = profile.image;
    const videoProfile = profile.video;
    const maxOutputsPerTask = kind === "image" ? Math.max(1, imageProfile?.maxOutputs || 1) : 1;
    const batchLimit = workbenchBatchLimit(kind, maxOutputsPerTask, activeTaskLimit);
    const requestedCount = Math.min(batchLimit, Math.max(1, Math.floor(count) || 1));
    const plan = useMemo(() => planWorkbenchBatch(kind, requestedCount, maxOutputsPerTask), [kind, maxOutputsPerTask, requestedCount]);
    const promptMaxChars = kind === "image" ? imageProfile?.references.promptMaxChars || 32000 : videoProfile?.references.promptMaxChars || 8000;
    const unslottedLimit = kind === "image" ? imageProfile?.references.maxImages || 0 : (videoProfile?.references.maxImages || 0) + (videoProfile?.references.maxVideos || 0) + (videoProfile?.references.maxAudios || 0);
    const quickTools = useMemo(() => workbenchQuickTools(tools), [tools]);
    const promptRequired = workbenchPromptRequired(tool);
    const missingInput = missingWorkbenchInput(tool, references);
    const kindLabel = kind === "image" ? "图片" : "视频";

    const promptReferences = useMemo<CanvasResourceReference[]>(
        () =>
            references.map((reference) => ({
                id: reference.id,
                nodeId: reference.id,
                kind: reference.kind,
                label: reference.name,
                title: reference.name,
                previewUrl: reference.previewUrl,
                ...(reference.resourceId ? { storageKey: resourceStorageKey(reference.resourceId) } : {}),
                active: true,
            })),
        [references],
    );
    const composerConfig = useMemo(
        () =>
            kind === "video" && selectedModel
                ? creationVideoConfig(config, selectedModel, { ratio, seconds, videoQuality })
                : { ...config, model: selectedModel, imageModel: selectedModel, size: ratio, quality, imageResolution, count: String(plan[0] || 1) },
        [config, imageResolution, kind, plan, quality, ratio, seconds, selectedModel, videoQuality],
    );

    const loadDirectory = useCallback(
        (signal?: AbortSignal) => {
            setDirectoryLoading(true);
            setDirectoryError("");
            listWorkbenchTools(kind, signal, false)
                .then((directory) => {
                    if (signal?.aborted) return;
                    setTools(directory.tools.filter((item) => item.kind === kind && item.enabled !== false && (!capabilitySupportedModes(item).length || capabilitySupportedModes(item).includes(kind))).sort((a, b) => a.sortOrder - b.sortOrder));
                })
                .catch((error) => {
                    if (!signal?.aborted) setDirectoryError(errorMessage(error, "场景目录加载失败"));
                })
                .finally(() => {
                    if (!signal?.aborted) setDirectoryLoading(false);
                });
        },
        [kind],
    );
    useEffect(() => {
        const controller = new AbortController();
        loadDirectory(controller.signal);
        return () => controller.abort();
    }, [loadDirectory]);

    // ---------- 设置恢复：保留兼容值，按所选模型自动适配 ----------
    useEffect(() => {
        if (!preferencesHydrated || settingsReady || !imageProfile || !videoProfile) return;
        const saved = useCreationPreferencesStore.getState().preferences;
        if (kind === "image") {
            const normalized = normalizeImageValue(
                imageProfile,
                {
                    size: saved.image?.ratio || imageProfile.size.default,
                    quality: saved.image?.quality || imageProfile.quality.default,
                    imageResolution: saved.image?.imageResolution,
                    count: "1",
                },
                resolveModelRequestConfig(config, selectedModel).interfaceType,
            );
            setRatio(normalized.size);
            setQuality(normalized.quality);
            setImageResolution(normalized.imageResolution || imageProfile.resolution.default || "auto");
            // 批量数量可以超过模型单次张数（会拆成多个任务），不能用单任务上限收敛。
            setCount(Math.max(1, Math.floor(Number(saved.image?.count)) || 1));
        } else {
            const normalized = normalizeVideoValue(
                videoProfile,
                {
                    seconds: saved.video?.seconds || String(videoProfile.duration.default),
                    ratio: saved.video?.ratio || videoProfile.defaultRatio,
                    resolution: saved.video?.videoQuality || videoProfile.defaultResolution,
                },
                resolveModelRequestConfig(config, selectedModel).interfaceType,
            );
            setSeconds(normalized.seconds);
            setRatio(normalized.ratio);
            setVideoQuality(normalized.resolution.replace(/p$/i, ""));
        }
        setSettingsReady(true);
    }, [imageProfile, kind, preferencesHydrated, settingsReady, videoProfile]);

    useEffect(() => {
        if (!settingsReady || kind !== "image" || !imageProfile) return;
        const saved = useCreationPreferencesStore.getState().preferences.image;
        const normalized = normalizeImageValue(
            imageProfile,
            {
                size: saved?.ratio || imageProfile.size.default,
                quality: saved?.quality || imageProfile.quality.default,
                imageResolution: saved?.imageResolution,
                count: "1",
            },
            resolveModelRequestConfig(config, selectedModel).interfaceType,
        );
        setRatio(normalized.size);
        setQuality(normalized.quality);
        setImageResolution(normalized.imageResolution || imageProfile.resolution.default || "auto");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [imageProfile, kind, selectedModel, settingsReady]);

    useEffect(() => {
        if (!settingsReady || kind !== "video" || !videoProfile) return;
        const saved = useCreationPreferencesStore.getState().preferences.video;
        const normalized = normalizeVideoValue(
            videoProfile,
            {
                seconds: saved?.seconds || String(videoProfile.duration.default),
                ratio: saved?.ratio || videoProfile.defaultRatio,
                resolution: saved?.videoQuality || videoProfile.defaultResolution,
            },
            resolveModelRequestConfig(config, selectedModel).interfaceType,
        );
        setSeconds(normalized.seconds);
        setRatio(normalized.ratio);
        setVideoQuality(normalized.resolution.replace(/p$/i, ""));
    }, [kind, selectedModel, settingsReady, videoProfile]);

    // ---------- 报价：按拆分后的每个任务分别报价再求和 ----------
    const quoteRequirementsFor = useCallback(
        (outputs: number) => ({
            capability,
            input: {
                textCount: prompt.trim() ? 1 : 0,
                imageCount: references.filter((reference) => reference.kind === "image").length,
                referenceImageCount: references.filter((reference) => reference.kind === "image" && reference.role !== "first_frame" && reference.role !== "last_frame").length,
                videoCount: references.filter((reference) => reference.kind === "video").length,
                audioCount: references.filter((reference) => reference.kind === "audio").length,
                characterCount: 0,
            },
            ...(kind === "image"
                ? { imageSize: ratio, options: { size: ratio, quality, ...(imageProfile?.resolution.supported ? { imageResolution } : {}), count: outputs } }
                : { videoSeconds: seconds, options: { size: ratio, videoSeconds: Number(seconds), vquality: videoQuality } }),
        }),
        [capability, imageProfile, imageResolution, kind, prompt, quality, ratio, references, seconds, videoQuality],
    );
    const pickerRequirements = useMemo(() => quoteRequirementsFor(plan[0] || 1), [plan, quoteRequirementsFor]);
    const estimateKey = JSON.stringify([composerConfig.model, pickerRequirements, plan, composerConfig.videoGenerateAudio, composerConfig.videoWatermark, composerConfig.imageParameters, config.channels]);
    const estimate = estimateState.key === estimateKey ? estimateState : { credits: null, estimated: false, tone: "loading" as const };

    useEffect(() => {
        const setEstimate = (value: Omit<typeof estimateState, "key">) => setEstimateState({ ...value, key: estimateKey });
        if (!creditsEnabled || !selectedModel || mediaSettingIssues(composerConfig, kind, selectedModel).length) {
            setEstimate({ credits: null, estimated: false, tone: "unavailable" });
            return;
        }
        const priceChannel = resolveModelChannel(config, selectedModel);
        const distinct = [...new Set(plan)];
        const localFor = (outputs: number) =>
            requestCreditCost({
                channelMode: priceChannel.scope === "system" ? "remote" : "local",
                modelCosts: priceChannel.modelCosts,
                model: modelOptionName(selectedModel),
                count: kind === "image" ? outputs : 1,
                seconds: kind === "video" ? Number(seconds) || 1 : 1,
                capability,
                config: composerConfig,
                requirements: quoteRequirementsFor(outputs),
            });
        const localAmounts = new Map(distinct.map((outputs) => [outputs, localFor(outputs)]));
        const localTotal = plan.every((outputs) => localAmounts.get(outputs) !== null) ? plan.reduce((sum, outputs) => sum + (localAmounts.get(outputs) || 0), 0) : null;
        const requests = distinct.map((outputs) => ({ outputs, request: modelQuoteRequest(kind === "image" ? { ...composerConfig, count: String(outputs) } : composerConfig, selectedModel, capability, quoteRequirementsFor(outputs)) }));
        if (requests.some((item) => !item.request)) {
            setEstimate({ credits: localTotal, estimated: false, tone: localTotal === null ? "usage" : "local" });
            return;
        }
        const controller = new AbortController();
        setEstimate(localTotal === null ? { credits: null, estimated: false, tone: "loading" } : { credits: localTotal, estimated: false, tone: "local" });
        Promise.all(requests.map(async (item) => ({ outputs: item.outputs, quote: (await quoteModel(item.request!, controller.signal)).quote })))
            .then((quotes) => {
                if (controller.signal.aborted) return;
                const byOutputs = new Map(quotes.map((item) => [item.outputs, item.quote]));
                const total = plan.reduce((sum, outputs) => sum + (byOutputs.get(outputs)?.amountMicrocredits || 0), 0) / 1_000_000;
                setEstimate({ credits: total, estimated: quotes.some((item) => item.quote.estimated === true), tone: "quote" });
            })
            .catch(() => {
                if (controller.signal.aborted) return;
                setEstimate({ credits: localTotal, estimated: false, tone: localTotal === null ? "unavailable" : "local" });
            });
        return () => controller.abort();
    }, [capability, composerConfig, config, creditsEnabled, kind, plan, quoteRequirementsFor, seconds, selectedModel, estimateKey]);

    // ---------- 任务列表轮询 ----------
    const loadFailedRef = useRef(false);
    const loadTasks = useCallback(async () => {
        try {
            const result = await listWorkbenchTasks(kind, 100);
            loadFailedRef.current = false;
            setTasks(result);
            return result;
        } catch (error) {
            if (!loadFailedRef.current) message.error(errorMessage(error, "作品列表加载失败"));
            loadFailedRef.current = true;
            return null;
        } finally {
            setTasksLoading(false);
        }
    }, [kind, message]);
    const taskIds = useMemo(() => new Set(tasks.map((task) => task.id)), [tasks]);
    const hasActiveWork = tasks.some(isActiveWorkbenchTask) || localBatches.some((batch) => batch.submitting || Object.values(batch.receipts).some((receipt) => !taskIds.has(receipt.id) && isActiveWorkbenchTask(receipt)));
    const hasActiveWorkRef = useRef(hasActiveWork);
    hasActiveWorkRef.current = hasActiveWork;
    const pollKickRef = useRef<() => void>(() => undefined);
    useEffect(() => {
        let stopped = false;
        let timer = 0;
        const schedule = (delay: number) => {
            window.clearTimeout(timer);
            timer = window.setTimeout(() => void poll(), delay);
        };
        const poll = async () => {
            await loadTasks();
            if (!stopped) schedule(hasActiveWorkRef.current ? 4000 : 30000);
        };
        pollKickRef.current = () => {
            if (!stopped) schedule(600);
        };
        void poll();
        const onVisible = () => {
            if (!document.hidden && !stopped) schedule(0);
        };
        document.addEventListener("visibilitychange", onVisible);
        return () => {
            stopped = true;
            window.clearTimeout(timer);
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, [loadTasks]);
    useEffect(() => {
        if (hasActiveWork) pollKickRef.current();
    }, [hasActiveWork]);

    // ---------- 任务详情：列表只有首张预览，可见批次再按需取详情 ----------
    const pumpDetails = useCallback(() => {
        while (detailActiveRef.current < DETAIL_CONCURRENCY && detailQueueRef.current.length) {
            const { id, version } = detailQueueRef.current.shift()!;
            detailActiveRef.current += 1;
            detailInflightRef.current.add(id);
            queryGenerationTask(id)
                .then((task) => {
                    detailFailedRef.current.delete(id);
                    setDetails((current) => ({ ...current, [id]: task }));
                    setDetailErrors((current) => {
                        if (!current.has(id)) return current;
                        const next = new Set(current);
                        next.delete(id);
                        return next;
                    });
                })
                // 失败时记下当时的任务版本：同一版本不再重复请求，任务更新后再取；画廊不再为它保留加载占位。
                .catch(() => {
                    detailFailedRef.current.set(id, version);
                    setDetailErrors((current) => (current.has(id) ? current : new Set(current).add(id)));
                })
                .finally(() => {
                    detailActiveRef.current -= 1;
                    detailInflightRef.current.delete(id);
                    pumpDetails();
                });
        }
    }, []);
    const requestDetails = useCallback(
        (entries: Array<{ id: string; version?: string }>) => {
            for (const { id, version = "" } of entries) {
                if (!id || detailInflightRef.current.has(id) || detailQueueRef.current.some((entry) => entry.id === id)) continue;
                if (detailFailedRef.current.has(id) && detailFailedRef.current.get(id) === version) continue;
                detailQueueRef.current.push({ id, version });
            }
            pumpDetails();
        },
        [pumpDetails],
    );
    useEffect(
        () => () => {
            // 离开页面后不再继续排队读取详情。
            detailQueueRef.current = [];
        },
        [],
    );

    const receiptTasks = useMemo(() => localBatches.flatMap((batch) => Object.values(batch.receipts)).filter((receipt) => !taskIds.has(receipt.id)), [localBatches, taskIds]);
    const groups = useMemo(() => groupWorkbenchTasks([...tasks, ...receiptTasks]), [receiptTasks, tasks]);

    useEffect(() => {
        const wanted: Array<{ id: string; version: string }> = [];
        for (const group of groups) {
            if (!visibleBatchKeys.has(group.key)) continue;
            group.tasks.forEach((task, index) => {
                const detail = details[task.id];
                // 首个任务的详情提供场景与参数摘要；图片任务各自的张数不同（如 4 + 1），每个都要读一次；
                // 已完成任务的详情才有全部产物，运行中取到的旧详情完成后要刷新。
                const needsSummary = (index === 0 || kind === "image") && !detail;
                const needsOutputs = task.status === "succeeded" && (!detail || detail.status !== "succeeded");
                if (needsSummary || needsOutputs) wanted.push({ id: task.id, version: task.updatedAt });
            });
        }
        if (wanted.length) requestDetails(wanted);
    }, [details, groups, kind, requestDetails, visibleBatchKeys]);

    const taskModelLabel = useCallback(
        (task?: GenerationTask) => {
            const rawModel = task?.model?.trim() || "";
            if (!rawModel) return "";
            const configured = models.find((item) => item === rawModel || modelOptionName(item) === rawModel);
            const display = configured ? modelDisplayName(config, configured) : rawModel;
            return isModelIdLike(display) ? "" : display;
        },
        [config, models],
    );

    // ---------- 组装画廊批次 ----------
    const galleryBatches = useMemo<GalleryBatch[]>(() => {
        const localById = new Map(localBatches.map((batch) => [batch.id, batch]));
        const used = new Set<string>();
        const toolNames = new Map(tools.map((item) => [item.id, item.name]));
        const build = (group: WorkbenchTaskGroup | null, local: LocalBatch | undefined): GalleryBatch => {
            const groupTasks = group?.tasks || [];
            const first = groupTasks[0];
            const snapshot = first ? workbenchTaskSnapshot(details[first.id] || first) : null;
            const parameters = local?.parameters || snapshot?.parameters || {};
            const key = group?.key || `batch:${local!.id}`;
            const ratioValue = local?.ratio ?? aspectRatioOf(kind === "image" ? parameters.size : parameters.ratio) ?? measuredRatios[key];
            const tiles: GalleryTile[] = [];
            const outputs: WorkbenchOutput[] = [];
            const counts = { done: 0, active: 0, failed: 0, pending: 0, total: 0 };
            const expectedFor = (task: GenerationTask, index: number) => {
                if (local) return local.plan[index] || 1;
                if (kind !== "image") return 1;
                const taskSnapshot = details[task.id] ? workbenchTaskSnapshot(details[task.id]) : task === first ? snapshot : null;
                return Math.max(1, Math.floor(Number(taskSnapshot?.parameters.count)) || 1);
            };
            const addTask = (task: GenerationTask, expected: number) => {
                counts.total += expected;
                if (task.status === "succeeded") {
                    const detail = details[task.id];
                    const taskOutputs = workbenchTaskOutputs(task, kind, detail);
                    for (const output of taskOutputs) {
                        tiles.push({ type: "output", key: output.key, output, task });
                        outputs.push(output);
                    }
                    counts.done += taskOutputs.length;
                    const detailLoaded = Boolean(detail?.resultJson);
                    const missing = detailLoaded || detailErrors.has(task.id) ? 0 : Math.max(0, expected - taskOutputs.length);
                    for (let slot = 0; slot < missing; slot += 1) tiles.push({ type: "loading", key: `${task.id}:loading:${slot}`, task });
                    if (detailLoaded && !taskOutputs.length) tiles.push({ type: "failed", key: `${task.id}:missing`, task: { ...task, status: "failed", error: "作品已生成，但暂时无法载入预览" } });
                    if (detailLoaded) counts.total += taskOutputs.length - expected;
                    return;
                }
                if (isActiveWorkbenchTask(task)) {
                    counts.active += expected;
                    for (let slot = 0; slot < expected; slot += 1) tiles.push({ type: "active", key: `${task.id}:active:${slot}`, task, slot });
                    return;
                }
                counts.failed += expected;
                tiles.push({ type: "failed", key: `${task.id}:failed`, task });
            };
            let resumable = 0;
            if (local) {
                local.plan.forEach((outputsForTask, index) => {
                    const task = groupTasks.find((item) => (item.clientContext?.batchIndex ?? 0) === index) || local.receipts[index];
                    if (task) {
                        addTask(task, outputsForTask);
                        return;
                    }
                    const state = local.states[index];
                    const submitting = state === "submitting" || (state === "pending" && local.submitting);
                    if (!submitting) resumable += 1;
                    counts.total += outputsForTask;
                    if (submitting) counts.active += outputsForTask;
                    else counts.pending += outputsForTask;
                    for (let slot = 0; slot < outputsForTask; slot += 1) tiles.push({ type: "pending", key: `${local.id}:${index}:${slot}`, state: submitting ? "submitting" : "unsubmitted" });
                });
            } else {
                groupTasks.forEach((task, index) => addTask(task, expectedFor(task, index)));
            }
            const toolName = local?.toolName || snapshot?.toolName || (snapshot?.toolId ? toolNames.get(snapshot.toolId) : undefined);
            return {
                key,
                createdAt: local?.createdAt || group?.createdAt || new Date().toISOString(),
                prompt: local?.prompt || first?.prompt || "",
                ...(toolName ? { toolName } : {}),
                modelLabel: local?.modelLabel || taskModelLabel(first),
                chips: workbenchParameterSummary(kind, parameters, counts.total),
                ...(ratioValue ? { ratio: ratioValue } : {}),
                tiles,
                tasks: groupTasks,
                outputs,
                counts,
                resumable,
                ...(local?.error ? { resumeError: local.error } : {}),
                submitting: Boolean(local?.submitting),
                localOnly: Boolean(local) && !groupTasks.length,
            };
        };
        const result: GalleryBatch[] = [];
        for (const group of groups) {
            const local = group.batchId ? localById.get(group.batchId) : undefined;
            if (local) used.add(local.id);
            result.push(build(group, local));
        }
        for (const local of localBatches) if (!used.has(local.id)) result.push(build(null, local));
        return result.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    }, [detailErrors, details, groups, kind, localBatches, measuredRatios, taskModelLabel, tools]);

    // ---------- 场景与提示词 ----------
    // 提示词为空，或仍是当前预设原文（用户没改过），切换时可以直接替换；改过的内容先确认再动。
    const promptReplaceable = () => !prompt.trim() || (preset !== null && prompt.trim() === preset.promptTemplate.trim());

    // 切换场景后提示词必须跟着新场景走：未改动的模板直接换成新场景的预设（新场景没有预设则清空），
    // 用户改过的内容弹出“替换 / 追加 / 返回”确认，不能静默保留上一个场景的模板。
    const switchToolPrompt = (next: WorkbenchTool | null, preferredPresetId?: string | null) => {
        const replaceable = promptReplaceable();
        const nextPreset = next?.presets.find((item) => item.id === preferredPresetId) || next?.presets[0] || null;
        setPresetPending(null);
        if (!nextPreset) {
            setPreset(null);
            if (replaceable) setPrompt("");
            return;
        }
        if (replaceable) {
            setPrompt(nextPreset.promptTemplate);
            setPreset(nextPreset);
            return;
        }
        setPreset(null);
        setPresetPending(nextPreset);
    };

    const referenceLimitFor = useCallback(
        (mediaKind: MediaKind) => {
            if (kind === "image") return mediaKind === "image" ? imageProfile?.references.maxImages || 0 : 0;
            if (mediaKind === "image") return videoProfile?.references.maxImages || 0;
            if (mediaKind === "video") return videoProfile?.references.maxVideos || 0;
            return videoProfile?.references.maxAudios || 0;
        },
        [imageProfile, kind, videoProfile],
    );

    /** 换场景时尽量保留已上传素材：按媒体类型放进新场景的槽位，放不下的才移除。 */
    const reassignReferences = (next: WorkbenchTool | null) => {
        const slots = next?.inputContract?.slots || [];
        const used = new Map<string, number>();
        const kept: WorkbenchReference[] = [];
        const dropped: WorkbenchReference[] = [];
        for (const reference of referencesRef.current) {
            if (!slots.length) {
                const sameKind = kept.filter((item) => item.kind === reference.kind).length;
                if (sameKind < referenceLimitFor(reference.kind)) kept.push({ ...reference, slotKey: undefined });
                else dropped.push(reference);
                continue;
            }
            const fits = (slot: WorkbenchReferenceSlot) => slot.mediaTypes.includes(reference.kind) && (used.get(slot.key) || 0) < slot.maxCount;
            const slot = slots.find((item) => item.key === reference.slotKey && fits(item)) || slots.find(fits);
            if (!slot) {
                dropped.push(reference);
                continue;
            }
            used.set(slot.key, (used.get(slot.key) || 0) + 1);
            kept.push({ ...reference, slotKey: slot.key });
        }
        dropped.forEach(revokeReferencePreview);
        setReferences(kept);
        if (dropped.length) message.info(`${dropped.length} 个素材不适用于${next ? `“${next.name}”` : "自由创作"}，已移除`);
    };

    const chooseTool = (next: WorkbenchTool | null) => {
        reassignReferences(next);
        setUploadSlotKey(undefined);
        setTool(next);
        setLibraryOpen(false);
        const params = new URLSearchParams(searchParams);
        if (next) params.set("tool", next.id);
        else params.delete("tool");
        params.delete("preset");
        setSearchParams(params, { replace: true });
        switchToolPrompt(next);
        setMobileTab("compose");
    };

    useEffect(() => {
        const toolId = searchParams.get("tool");
        if (!toolId || !tools.length) return;
        const next = tools.find((item) => item.id === toolId);
        // 页内选择和任务恢复会先更新 tool 再改地址，这里只处理从外部链接切换过来的场景。
        if (!next || next.id === tool?.id) return;
        reassignReferences(next);
        setTool(next);
        switchToolPrompt(next, searchParams.get("preset"));
        // 只随地址和目录变化触发；tool 变化不能触发，否则任务恢复在改地址前会被旧地址拉回。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams, tools]);

    const choosePreset = (next: WorkbenchPromptPreset) => {
        if (promptReplaceable()) {
            setPrompt(next.promptTemplate);
            setPreset(next);
            return;
        }
        setPresetPending(next);
    };

    const applyPreset = (mode: "replace" | "append") => {
        if (!presetPending) return;
        setPrompt((current) => (mode === "append" ? `${current.trimEnd()}\n${presetPending.promptTemplate}` : presetPending.promptTemplate));
        setPreset(presetPending);
        setPresetPending(null);
    };

    // ---------- 参考素材 ----------
    const slotFor = (mediaKind: MediaKind, preferredKey: string | undefined, pending: WorkbenchReference[]) => {
        const slots = tool?.inputContract?.slots || [];
        const occupancy = (key: string) => [...referencesRef.current, ...pending].filter((item) => item.slotKey === key).length;
        const fits = (slot: WorkbenchReferenceSlot) => slot.mediaTypes.includes(mediaKind) && occupancy(slot.key) < slot.maxCount;
        const preferred = slots.find((slot) => slot.key === preferredKey);
        if (preferred) return fits(preferred) ? preferred : null;
        return slots.find(fits) || null;
    };

    const appendReferences = (items: Array<{ kind: MediaKind; name: string; previewUrl: string; resourceId?: string; file?: File }>, preferredSlotKey?: string) => {
        const slots = tool?.inputContract?.slots || [];
        const accepted: Array<{ reference: WorkbenchReference; file?: File }> = [];
        const rejected = new Set<string>();
        for (const item of items) {
            const pending = accepted.map((entry) => entry.reference);
            let slotKey: string | undefined;
            let slot: WorkbenchReferenceSlot | undefined;
            if (slots.length) {
                const target = slotFor(item.kind, preferredSlotKey, pending);
                if (!target) {
                    rejected.add(
                        preferredSlotKey
                            ? `“${slots.find((entry) => entry.key === preferredSlotKey)?.name || "该槽位"}”只接受${(slots.find((entry) => entry.key === preferredSlotKey)?.mediaTypes || []).map(mediaLabel).join("、")}或已满`
                            : `没有可以放${mediaLabel(item.kind)}的素材位置`,
                    );
                    if (item.previewUrl.startsWith("blob:")) URL.revokeObjectURL(item.previewUrl);
                    continue;
                }
                slot = target;
                slotKey = target.key;
            } else {
                const sameKind = [...referencesRef.current, ...pending].filter((entry) => entry.kind === item.kind).length;
                const limit = referenceLimitFor(item.kind);
                if (sameKind >= limit) {
                    rejected.add(limit ? `${mediaLabel(item.kind)}最多 ${limit} 个` : `当前模型不支持参考${mediaLabel(item.kind)}`);
                    if (item.previewUrl.startsWith("blob:")) URL.revokeObjectURL(item.previewUrl);
                    continue;
                }
            }
            const role = kind === "video" && item.kind === "image" ? defaultVideoRole(slot, [...referencesRef.current, ...pending]) : "reference";
            accepted.push({
                file: item.file,
                reference: {
                    id: createClientUUID(),
                    name: item.name,
                    kind: item.kind,
                    previewUrl: item.previewUrl,
                    ...(item.resourceId ? { resourceId: item.resourceId } : {}),
                    progress: item.file ? 0 : 100,
                    uploading: Boolean(item.file),
                    role,
                    ...(slotKey ? { slotKey } : {}),
                },
            });
        }
        if (rejected.size) message.warning([...rejected].join("；"));
        if (accepted.length) setReferences((current) => [...current, ...accepted.map((entry) => entry.reference)]);
        return accepted;
    };

    const addFiles = async (files: FileList | File[], preferredSlotKey?: string) => {
        const list = Array.from(files);
        const allowed = kind === "image" ? ["image"] : ["image", "video", "audio"];
        const typed = list.flatMap((file) => {
            const mediaKind = mediaKindOfFile(file);
            return mediaKind && allowed.includes(mediaKind) ? [{ file, mediaKind }] : [];
        });
        if (typed.length < list.length) message.warning(kind === "image" ? "只能上传图片" : "只能上传图片、视频或音频");
        const accepted = appendReferences(
            typed.map(({ file, mediaKind }) => ({ kind: mediaKind, name: mediaKind === "audio" ? audioUploadTitleFromFileName(file.name) : file.name, previewUrl: URL.createObjectURL(file), file })),
            preferredSlotKey,
        );
        await Promise.all(
            accepted.map(async ({ reference, file }) => {
                if (!file) return;
                try {
                    const resource = await uploadResourceFile(file, reference.kind, { fileName: file.name }, (uploaded, total) => {
                        setReferences((current) => current.map((item) => (item.id === reference.id ? { ...item, progress: total ? (uploaded / total) * 100 : 0 } : item)));
                    });
                    setReferences((current) => current.map((item) => (item.id === reference.id ? { ...item, resourceId: resource.id, uploading: false, progress: 100 } : item)));
                } catch (error) {
                    setReferences((current) => current.map((item) => (item.id === reference.id ? { ...item, uploading: false, error: errorMessage(error, "上传失败") } : item)));
                }
            }),
        );
    };

    /** 已在服务端的资源直接作为参考；换不到展示地址通常是资源已删除或不属于当前账号，不放进面板。 */
    const addResourceReferences = async (items: Array<{ resourceId: string; kind: MediaKind; name: string }>, preferredSlotKey?: string) => {
        const resolved = await Promise.all(items.map(async (item) => ({ ...item, previewUrl: (await resolveWorkbenchResourceURL(item.resourceId, item.kind === "image" ? "thumbnail" : "original")) || "" })));
        const available = resolved.filter((item) => item.previewUrl);
        if (available.length < resolved.length) message.warning(`${resolved.length - available.length} 个素材已不存在或暂时无法读取，未添加`);
        return appendReferences(available, preferredSlotKey);
    };

    const removeReference = (reference: WorkbenchReference) => {
        revokeReferencePreview(reference);
        setReferences((current) => current.filter((item) => item.id !== reference.id));
    };

    const clearReferences = () => {
        referencesRef.current.forEach(revokeReferencePreview);
        setReferences([]);
    };

    const handlePaste = (event: ClipboardEvent<HTMLElement>) => {
        const files = Array.from(event.clipboardData?.files || []).filter((file) => {
            const mediaKind = mediaKindOfFile(file);
            return mediaKind === "image" || (kind === "video" && mediaKind !== null);
        });
        if (!files.length) return;
        event.preventDefault();
        event.stopPropagation();
        void addFiles(files);
    };

    // “做成视频”从图片页带着资源 ID 过来：放进首帧位置，然后清掉地址参数。
    const handoffRef = useRef(false);
    useEffect(() => {
        const resourceId = searchParams.get("ref")?.trim() || "";
        if (!resourceId || kind !== "video" || directoryLoading || handoffRef.current) return;
        if (searchParams.get("tool") && !tool) return;
        handoffRef.current = true;
        const params = new URLSearchParams(searchParams);
        params.delete("ref");
        setSearchParams(params, { replace: true });
        if (!/^[A-Za-z0-9_-]{1,80}$/.test(resourceId)) return;
        void addResourceReferences([{ resourceId, kind: "image", name: "商品图" }]).then((accepted) => {
            if (accepted.length) message.success("已放入商品首帧，描述镜头后即可生成视频");
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [directoryLoading, kind, searchParams, tool]);

    // ---------- 参数 ----------
    const updateImageSettings = (size: string, nextQuality?: string, nextResolution?: string) => {
        setRatio(size);
        rememberImageSettings({ ratio: size });
        if (nextQuality) {
            setQuality(nextQuality);
            rememberImageSettings({ quality: nextQuality });
        }
        if (nextResolution) {
            setImageResolution(nextResolution);
            rememberImageSettings({ imageResolution: nextResolution });
        }
    };

    const changeCount = (value: number) => {
        setCount(value);
        if (kind === "image") rememberImageSettings({ count: String(value) });
    };

    const resetComposer = () => {
        referencesRef.current.forEach(revokeReferencePreview);
        setReferences([]);
        setUploadSlotKey(undefined);
        setTool(null);
        setPreset(null);
        setPresetPending(null);
        setPrompt("");
        setCount(1);
        if (kind === "image") rememberImageSettings({ count: "1" });
        setRatio(kind === "image" ? imageProfile?.size.default || "1:1" : videoProfile?.defaultRatio || "16:9");
        setQuality(imageProfile?.quality.default || "auto");
        setImageResolution(imageProfile?.resolution.default || "auto");
        setSeconds(String(videoProfile?.duration.default || 6));
        setVideoQuality((videoProfile?.defaultResolution || "720p").replace(/p$/i, ""));
        const params = new URLSearchParams(searchParams);
        params.delete("tool");
        params.delete("preset");
        setSearchParams(params, { replace: true });
        message.success("创作面板已重置，作品不受影响");
    };

    // ---------- 提交 ----------
    const settingsError = mediaSettingIssues(composerConfig, kind, selectedModel)
        .map((item) => item.message)
        .join("；");
    const disabledReason = settingsError
        ? settingsError
        : !selectedModel
          ? `先选择${kindLabel}模型`
          : missingInput
            ? `请上传“${missingInput.name || "必填素材"}”`
            : references.some((reference) => reference.uploading)
              ? "素材上传中，请稍候"
              : references.some((reference) => reference.error)
                ? "请移除上传失败的素材"
                : promptRequired && !prompt.trim()
                  ? "请填写画面描述"
                  : undefined;

    const buildBatchRequest = (): BatchRequest | string => {
        if (settingsError) return settingsError;
        const submittedPrompt = normalizeCanvasNodeMentionTokens(prompt.trim(), promptReferences);
        if (promptRequired && !submittedPrompt) return "请填写画面描述";
        const missing = missingWorkbenchInput(tool, references);
        if (missing) return `请上传“${missing.name || "必填素材"}”`;
        if (!selectedModel || !models.includes(selectedModel)) return `请选择可用的${kindLabel}模型`;
        if (!isAiConfigReady(config, selectedModel)) return "当前模型配置不完整，请先完成模型设置";
        if (references.some((reference) => reference.uploading || reference.error || !reference.resourceId)) return "请等待素材上传完成，或移除上传失败的素材";
        if (submittedPrompt.length > promptMaxChars) return "描述超过当前模型支持的长度";
        const logicalModelId = logicalModelIDForConfig({ ...composerConfig, model: selectedModel });
        const channel = resolveModelChannel(config, selectedModel);
        const imageRequest =
            kind === "image" && imageProfile
                ? normalizeImageValue(
                      imageProfile,
                      { size: ratio, quality, imageResolution, imageParameters: config.imageParameters, count: "1", transparentBackground: config.transparentBackground },
                      resolveModelRequestConfig(config, selectedModel).interfaceType,
                  )
                : null;
        const videoRequest = kind === "video" && videoProfile ? normalizeVideoValue(videoProfile, { seconds, ratio, resolution: videoQuality }, resolveModelRequestConfig(config, selectedModel).interfaceType) : null;
        const parameters: Record<string, unknown> = imageRequest
            ? {
                  ...(imageProfile?.size.parameter !== "none" ? { size: imageRequest.size } : {}),
                  ...(imageRequest.quality && !["auto", "any"].includes(imageRequest.quality.toLowerCase()) ? { quality: imageRequest.quality } : {}),
                  ...(imageRequest.imageResolution && !["auto", "any"].includes(imageRequest.imageResolution.toLowerCase()) ? { imageResolution: imageRequest.imageResolution } : {}),
              }
            : {
                  ...(videoProfile?.durationSupported !== false ? { seconds: Number(videoRequest?.seconds || seconds) } : {}),
                  ...(videoProfile?.ratios.length ? { ratio: videoRequest?.ratio || ratio } : {}),
                  ...(videoProfile?.resolutions.length ? { resolution: videoRequest?.resolution || videoQuality } : {}),
                  ...(videoProfile?.generateAudio.supported ? { generateAudio: composerConfig.videoGenerateAudio === "true" } : {}),
                  ...(videoProfile?.watermark.supported ? { watermark: composerConfig.videoWatermark === "true" } : {}),
              };
        const generationConfig = {
            ...composerConfig,
            model: selectedModel,
            ...(imageRequest ? { imageModel: selectedModel, size: imageRequest.size, quality: imageRequest.quality, imageResolution: imageRequest.imageResolution } : {}),
            ...(videoRequest ? { videoModel: selectedModel, size: videoRequest.ratio, videoSeconds: videoRequest.seconds, vquality: videoRequest.resolution.replace(/p$/i, "") } : {}),
        };
        const readyReferences = references.filter((reference) => reference.resourceId);
        return {
            kind,
            route: logicalModelId || channel?.scope === "system" ? "workbench" : "tasks",
            prompt: submittedPrompt,
            model: modelOptionName(selectedModel),
            ...(logicalModelId ? { logicalModelId } : channel?.id ? { channelId: channel.id } : {}),
            ...(tool ? { toolId: tool.id } : {}),
            ...(tool && preset ? { presetId: preset.id } : {}),
            parameters,
            references: readyReferences,
            generationConfig,
            ...(kind === "video" ? { videoOperation: workbenchVideoOperation(readyReferences) } : {}),
        };
    };

    const createBatchTask = async (request: BatchRequest, batchPlan: number[], index: number, batchId: string) => {
        const batch = { id: batchId, index, count: batchPlan.length };
        const outputs = batchPlan[index] || 1;
        const parameters = request.kind === "image" ? { ...request.parameters, count: outputs } : request.parameters;
        const referenceSnapshot = request.references.map((reference) => ({ resourceId: reference.resourceId!, kind: reference.kind, role: reference.role, ...(reference.slotKey ? { slotKey: reference.slotKey } : {}) }));
        if (request.route === "workbench") {
            const created = await createWorkbenchTask({
                kind: request.kind,
                ...(request.toolId ? { toolId: request.toolId } : {}),
                ...(request.presetId ? { presetId: request.presetId } : {}),
                prompt: request.prompt,
                model: request.model,
                ...(request.logicalModelId ? { logicalModelId: request.logicalModelId } : { channelId: request.channelId }),
                parameters,
                references: referenceSnapshot,
                batch,
            });
            return receiptTask(created as Partial<GenerationTask> & { id: string }, request, batch);
        }
        const mediaReference = (reference: WorkbenchReference, type: string) => ({
            id: reference.id,
            name: reference.name,
            type,
            storageKey: resourceStorageKey(reference.resourceId!),
            role: reference.role,
            ...(reference.slotKey ? { slotKey: reference.slotKey } : {}),
        });
        const taskInput = await prepareBackendGenerationTask({
            mode: request.kind,
            prompt: request.prompt,
            config: request.kind === "image" ? { ...request.generationConfig, count: String(outputs) } : request.generationConfig,
            referenceImages: request.references.filter((reference) => reference.kind === "image").map((reference) => ({ ...mediaReference(reference, "image/*"), dataUrl: "" })),
            referenceVideos: request.references.filter((reference) => reference.kind === "video").map((reference) => ({ ...mediaReference(reference, "video/*"), url: "" })),
            referenceAudios: request.references.filter((reference) => reference.kind === "audio").map((reference) => ({ ...mediaReference(reference, "audio/*"), url: "" })),
            metadata: {
                source: "workbench",
                workbenchKind: request.kind,
                ...(request.videoOperation ? { videoEditOperation: request.videoOperation } : {}),
                ...Object.fromEntries(
                    request.references.filter((reference) => reference.role === "first_frame" || reference.role === "last_frame").map((reference) => [reference.role === "first_frame" ? "videoStartFrameNodeId" : "videoEndFrameNodeId", reference.id]),
                ),
                ...(request.toolId ? { workbenchToolId: request.toolId, workbenchToolName: tools.find((item) => item.id === request.toolId)?.name || "" } : {}),
                ...(request.presetId ? { workbenchPresetId: request.presetId } : {}),
                workbench: { kind: request.kind, ...(request.toolId ? { toolId: request.toolId } : {}), ...(request.presetId ? { presetId: request.presetId } : {}), parameters, references: referenceSnapshot, batch },
            },
        });
        const created = await createGenerationTask({ ...taskInput, ...(request.videoOperation ? { operation: request.videoOperation } : {}) });
        return receiptTask(created, request, batch);
    };

    const runBatchSubmission = async (batchId: string, indices: number[]) => {
        setBusy(true);
        updateLocalBatch(batchId, (batch) => ({ ...batch, submitting: true, error: undefined, states: batch.states.map((state, index) => (indices.includes(index) ? "pending" : state)) }));
        let created = 0;
        let failure = "";
        try {
            for (let position = 0; position < indices.length; position += 1) {
                const index = indices[position];
                const local = localBatchesRef.current.find((batch) => batch.id === batchId);
                if (!local) return;
                updateLocalBatch(batchId, (batch) => ({ ...batch, states: batch.states.map((state, itemIndex) => (itemIndex === index ? "submitting" : state)) }));
                try {
                    const task = await createBatchTask(local.request, local.plan, index, batchId);
                    created += 1;
                    updateLocalBatch(batchId, (batch) => ({ ...batch, states: batch.states.map((state, itemIndex) => (itemIndex === index ? "created" : state)), receipts: { ...batch.receipts, [index]: task } }));
                } catch (error) {
                    // 一个任务失败（并发上限、积分不足、参数被拒）时后面的大概率同样失败：停下来，交给用户决定是否继续提交。
                    failure = errorMessage(error, "任务提交失败");
                    const remaining = new Set(indices.slice(position));
                    updateLocalBatch(batchId, (batch) => ({ ...batch, error: failure, states: batch.states.map((state, itemIndex) => (remaining.has(itemIndex) ? "failed" : state)) }));
                    break;
                }
            }
        } finally {
            updateLocalBatch(batchId, (batch) => ({ ...batch, submitting: false }));
            setBusy(false);
            pollKickRef.current();
        }
        const unit = kind === "image" ? "批" : "条";
        if (created && !failure) message.success(created > 1 ? `已提交 ${created} 个任务，正在生成` : "已提交，正在生成");
        else if (created) message.warning(`已提交 ${created} 个任务，其余未提交：${failure}`);
        else if (failure) message.error(indices.length > 1 ? `这${unit}没有提交成功：${failure}` : failure);
    };

    const submit = async () => {
        if (busy) return;
        const request = buildBatchRequest();
        if (typeof request === "string") {
            message.warning(request);
            return;
        }
        const batchPlan = planWorkbenchBatch(kind, requestedCount, maxOutputsPerTask);
        const parameters = kind === "image" ? { ...request.parameters, count: requestedCount } : request.parameters;
        const local: LocalBatch = {
            id: createClientUUID(),
            createdAt: new Date().toISOString(),
            prompt: request.prompt,
            ...(tool ? { toolName: tool.name } : {}),
            modelLabel: modelDisplayName(config, selectedModel),
            parameters,
            ...(aspectRatioOf(kind === "image" ? request.parameters.size : request.parameters.ratio) ? { ratio: aspectRatioOf(kind === "image" ? request.parameters.size : request.parameters.ratio) } : {}),
            plan: batchPlan,
            states: batchPlan.map(() => "pending"),
            receipts: {},
            submitting: true,
            request,
        };
        setLocalBatches((current) => [local, ...current]);
        setFilter("all");
        setQuery("");
        setMobileTab("gallery");
        await runBatchSubmission(
            local.id,
            batchPlan.map((_, index) => index),
        );
    };

    // ---------- 作品操作 ----------
    const markTaskBusy = (id: string, value: boolean) =>
        setBusyTaskIds((current) => {
            const next = new Set(current);
            if (value) next.add(id);
            else next.delete(id);
            return next;
        });

    const applyTaskUpdate = (next: GenerationTask) => {
        setTasks((current) => current.map((item) => (item.id === next.id ? mergeTaskUpdate(item, next) : item)));
        setLocalBatches((current) =>
            current.map((batch) => {
                const entry = Object.entries(batch.receipts).find(([, receipt]) => receipt.id === next.id);
                return entry ? { ...batch, receipts: { ...batch.receipts, [entry[0]]: mergeTaskUpdate(entry[1], next) } } : batch;
            }),
        );
    };

    const cancelTask = async (task: GenerationTask, notify = true) => {
        markTaskBusy(task.id, true);
        try {
            applyTaskUpdate(await cancelGenerationTask(task.id));
            if (notify) message.success("任务已取消");
        } catch (error) {
            message.error(errorMessage(error, "取消任务失败"));
        } finally {
            markTaskBusy(task.id, false);
        }
    };

    const retryTask = async (task: GenerationTask, notify = true) => {
        markTaskBusy(task.id, true);
        try {
            applyTaskUpdate(await retryGenerationTask(task.id));
            if (notify) message.success("已重新提交");
            pollKickRef.current();
            return true;
        } catch (error) {
            message.error(errorMessage(error, "重新生成失败"));
            return false;
        } finally {
            markTaskBusy(task.id, false);
        }
    };

    const restoreBatch = async (batch: GalleryBatch, sourceTask?: GenerationTask) => {
        const first = sourceTask || batch.tasks[0];
        if (!first) return;
        let detail = details[first.id];
        if (!detail?.inputJson) {
            try {
                detail = await queryGenerationTask(first.id);
                setDetails((current) => ({ ...current, [first.id]: detail! }));
            } catch (error) {
                message.error(errorMessage(error, "参数读取失败"));
                return;
            }
        }
        const snapshot = workbenchTaskSnapshot(detail);
        if (!snapshot || snapshot.kind !== kind) {
            message.warning("这组作品没有可复用的参数");
            return;
        }
        const restoredTool = snapshot.toolId ? tools.find((item) => item.id === snapshot.toolId) || null : null;
        const restoredPreset = restoredTool && snapshot.presetId ? restoredTool.presets.find((item) => item.id === snapshot.presetId) || null : null;
        const parameters = snapshot.parameters;
        if (kind === "image") {
            const restoredRatio = typeof parameters.size === "string" ? parameters.size : ratio;
            const restoredQuality = typeof parameters.quality === "string" ? parameters.quality : quality;
            const restoredResolution = typeof parameters.imageResolution === "string" ? parameters.imageResolution : imageResolution;
            setRatio(restoredRatio);
            setQuality(restoredQuality);
            setImageResolution(restoredResolution);
            rememberImageSettings({ ratio: restoredRatio, quality: restoredQuality, imageResolution: restoredResolution });
        } else {
            const restoredSeconds = parameters.seconds != null ? String(parameters.seconds) : seconds;
            const restoredRatio = typeof parameters.ratio === "string" ? parameters.ratio : ratio;
            const restoredQuality = typeof parameters.resolution === "string" ? parameters.resolution.replace(/p$/i, "") : videoQuality;
            setSeconds(restoredSeconds);
            setRatio(restoredRatio);
            setVideoQuality(restoredQuality);
            rememberVideoSettings({ seconds: restoredSeconds, ratio: restoredRatio, videoQuality: restoredQuality });
            if (typeof parameters.generateAudio === "boolean") updateConfig("videoGenerateAudio", String(parameters.generateAudio));
            if (typeof parameters.watermark === "boolean") updateConfig("videoWatermark", String(parameters.watermark));
        }
        const total = Math.max(1, batch.counts.total || batch.tasks.length);
        changeCount(Math.min(batchLimit, total));
        const restoredModel = first.model ? models.find((item) => item === first.model || modelOptionName(item) === first.model) : undefined;
        if (restoredModel) {
            updateConfig(kind === "image" ? "imageModel" : "videoModel", restoredModel);
            updateConfig("model", restoredModel);
        }
        setTool(restoredTool);
        setPreset(restoredPreset);
        setPresetPending(null);
        setPrompt(detail.prompt || first.prompt || "");
        setUploadSlotKey(undefined);
        referencesRef.current.forEach(revokeReferencePreview);
        const restoredReferences = await Promise.all(
            snapshot.references.map(async (reference, index): Promise<WorkbenchReference> => ({
                id: createClientUUID(),
                name: `${mediaLabel(reference.kind)} ${index + 1}`,
                kind: reference.kind,
                resourceId: reference.resourceId,
                previewUrl: (await resolveWorkbenchResourceURL(reference.resourceId, reference.kind === "image" ? "thumbnail" : "original")) || "",
                progress: 100,
                uploading: false,
                role: reference.role || "reference",
                ...(reference.slotKey ? { slotKey: reference.slotKey } : {}),
            })),
        );
        setReferences(restoredReferences);
        const params = new URLSearchParams(searchParams);
        if (restoredTool) params.set("tool", restoredTool.id);
        else params.delete("tool");
        if (restoredPreset) params.set("preset", restoredPreset.id);
        else params.delete("preset");
        setSearchParams(params, { replace: true });
        setViewer(null);
        setMobileTab("compose");
        message.success("参数已载入创作面板，确认后点击生成");
    };

    const downloadOutputs = async (items: Array<{ output: WorkbenchOutput; ordinal: number }>, baseName: string) => {
        const now = new Date();
        const resolved = await Promise.allSettled(
            items.map(({ output, ordinal }) => {
                const fileName = workbenchDownloadName(output, baseName, ordinal, now);
                return resolveBrowserMediaDownloadHref({ fileName, ...(output.resourceId ? { storageKey: resourceStorageKey(output.resourceId) } : { url: output.url }) }).then((href) => ({ href, fileName }));
            }),
        );
        let started = 0;
        const failures: string[] = [];
        for (const result of resolved) {
            if (result.status === "rejected") {
                failures.push(errorMessage(result.reason, "下载失败"));
                continue;
            }
            if (started > 0) await new Promise((resolve) => window.setTimeout(resolve, BATCH_DOWNLOAD_INTERVAL_MS));
            startBrowserDownload(result.value.href, result.value.fileName);
            started += 1;
        }
        if (!started) message.error(`下载失败：${failures[0] || "没有可下载的作品"}`);
        else if (failures.length) message.warning(`已开始下载 ${started} 个文件，${failures.length} 个失败：${failures[0]}`);
        else if (items.length > 1) message.success(`已开始下载 ${started} 个文件`);
    };

    const useAsReference = async (output: WorkbenchOutput) => {
        if (!output.resourceId) return;
        const accepted = await addResourceReferences([{ resourceId: output.resourceId, kind: "image", name: "生成结果" }]);
        if (accepted.length) {
            message.success("已加入商品素材，可继续调整描述再生成");
            setViewer(null);
            setMobileTab("compose");
        }
    };

    const makeVideo = (output: WorkbenchOutput) => {
        if (!output.resourceId) return;
        navigate(`/toolbox/video?ref=${encodeURIComponent(output.resourceId)}`);
    };

    const copyText = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            message.success("提示词已复制");
        } catch {
            message.error("复制失败，请手动选择文本复制");
        }
    };

    const handlersRef = useRef<GalleryActions | null>(null);
    handlersRef.current = {
        openOutput: (batch, output) => {
            setViewer({ batchKey: batch.key, outputKey: output.key });
            requestDetails([{ id: output.taskId, version: batch.tasks.find((task) => task.id === output.taskId)?.updatedAt }]);
        },
        download: (output, batch) => void downloadOutputs([{ output, ordinal: batch.outputs.findIndex((item) => item.key === output.key) + 1 || 1 }], batch.toolName || ""),
        useAsReference: kind === "image" ? (output) => void useAsReference(output) : undefined,
        makeVideo: kind === "image" && features.videoWorkbenchEnabled ? makeVideo : undefined,
        cancelTask: (task) => void cancelTask(task),
        retryTask: (task) => void retryTask(task),
        reuse: (batch) => void restoreBatch(batch),
        copyPrompt: (batch) => void copyText(batch.prompt),
        downloadAll: (batch) =>
            void downloadOutputs(
                batch.outputs.map((output, index) => ({ output, ordinal: index + 1 })),
                batch.toolName || "",
            ),
        cancelBatch: (batch) => {
            const active = batch.tasks.filter(isActiveWorkbenchTask);
            if (!active.length) return;
            modal.confirm({
                title: `取消这组 ${active.length} 个未完成的任务？`,
                content: "已完成的作品会保留；未完成的任务停止生成，费用按任务计费规则处理。",
                okText: "取消任务",
                cancelText: "返回",
                okButtonProps: { danger: true },
                onOk: async () => {
                    for (const task of active) await cancelTask(task, false);
                    message.success("已取消未完成的任务");
                },
            });
        },
        retryFailed: async (batch) => {
            const failed = batch.tasks.filter((task) => task.status === "failed" || task.status === "cancelled");
            let retried = 0;
            for (const task of failed) {
                if (!(await retryTask(task, false))) break;
                retried += 1;
            }
            if (retried) message.success(`已重新提交 ${retried} 个任务`);
        },
        resume: (batch) => {
            const local = localBatchesRef.current.find((item) => `batch:${item.id}` === batch.key);
            if (!local || local.submitting || busy) return;
            const indices = local.states.flatMap((state, index) => (state === "failed" || state === "pending" ? [index] : []));
            if (indices.length) void runBatchSubmission(local.id, indices);
        },
        dismiss: (batch) => setLocalBatches((current) => current.filter((item) => `batch:${item.id}` !== batch.key || item.submitting)),
        visible: (batchKey) =>
            setVisibleBatchKeys((current) => {
                if (current.has(batchKey)) return current;
                const next = new Set(current);
                next.add(batchKey);
                return next;
            }),
        measure: (batchKey, value) => setMeasuredRatios((current) => (current[batchKey] ? current : { ...current, [batchKey]: value })),
    };
    const galleryActions = useMemo<GalleryActions>(
        () => ({
            openOutput: (...args) => handlersRef.current!.openOutput(...args),
            download: (...args) => handlersRef.current!.download(...args),
            useAsReference: kind === "image" ? (...args) => handlersRef.current!.useAsReference?.(...args) : undefined,
            makeVideo: kind === "image" && features.videoWorkbenchEnabled ? (...args) => handlersRef.current!.makeVideo?.(...args) : undefined,
            cancelTask: (...args) => handlersRef.current!.cancelTask(...args),
            retryTask: (...args) => handlersRef.current!.retryTask(...args),
            reuse: (...args) => handlersRef.current!.reuse(...args),
            copyPrompt: (...args) => handlersRef.current!.copyPrompt(...args),
            downloadAll: (...args) => handlersRef.current!.downloadAll(...args),
            cancelBatch: (...args) => handlersRef.current!.cancelBatch(...args),
            retryFailed: (...args) => handlersRef.current!.retryFailed(...args),
            resume: (...args) => handlersRef.current!.resume(...args),
            dismiss: (...args) => handlersRef.current!.dismiss(...args),
            visible: (...args) => handlersRef.current!.visible(...args),
            measure: (...args) => handlersRef.current!.measure(...args),
        }),
        [features.videoWorkbenchEnabled, kind],
    );

    const viewerBatch = viewer ? galleryBatches.find((batch) => batch.key === viewer.batchKey) || null : null;
    const viewerOutput = viewerBatch?.outputs.find((output) => output.key === viewer?.outputKey);
    const viewerDetail = viewerOutput ? details[viewerOutput.taskId] : undefined;

    // ---------- 文案 ----------
    const unit = kind === "image" ? "张" : "条";
    const estimateLabel = !creditsEnabled
        ? ""
        : estimate.credits !== null
          ? `${estimate.estimated || estimate.tone !== "quote" ? "预估" : "预计"} ${estimate.credits.toLocaleString("zh-CN", { maximumFractionDigits: 6 })} 积分`
          : estimate.tone === "loading"
            ? "正在计算积分"
            : estimate.tone === "usage"
              ? "按实际用量结算"
              : "报价暂不可用";
    const countHint =
        kind === "image"
            ? plan.length > 1
                ? `模型单次最多 ${maxOutputsPerTask} 张，将拆成 ${plan.length} 个任务并行生成`
                : requestedCount > 1
                  ? `一个任务一次出 ${requestedCount} 张`
                  : `最多 ${batchLimit} 张`
            : requestedCount > 1
              ? `并行提交 ${requestedCount} 个任务，每条独立生成`
              : `最多 ${batchLimit} 条`;
    const limitHint = requestedCount >= batchLimit && batchLimit < (kind === "image" ? 12 : 8) ? `账号同时最多 ${activeTaskLimit} 个任务` : "";
    const durationOptions = videoProfile
        ? (videoProfile.duration.selection === "enum"
              ? videoProfile.duration.values || []
              : Array.from({ length: Math.floor(((videoProfile.duration.max || 15) - (videoProfile.duration.min || 1)) / (videoProfile.duration.step || 1)) + 1 }, (_, index) => (videoProfile.duration.min || 1) + index * (videoProfile.duration.step || 1))
          ).map((value) => ({ value: String(value), label: `${value} 秒` }))
        : [];
    const bothKinds = features.imageWorkbenchEnabled && features.videoWorkbenchEnabled;
    const galleryCount = galleryBatches.reduce((sum, batch) => sum + batch.outputs.length, 0);

    const specControls =
        kind === "image" && imageProfile ? (
            <>
                <ImageSizePicker profile={imageProfile} size={ratio} quality={quality} imageResolution={imageResolution} declaredSizeOptions ratioHint={(value) => workbenchRatioUsage("image", value)} onChange={updateImageSettings} />
                {imageProfile.quality.supported && !imageResolutionUsesQuality(imageProfile) && imageProfile.quality.values.length > 1 ? (
                    <ChoiceChips
                        label="画质"
                        value={quality}
                        options={imageProfile.quality.values.map((value) => ({ value, label: imageQualityLabel(value) }))}
                        onChange={(value) => {
                            setQuality(value);
                            rememberImageSettings({ quality: value });
                        }}
                    />
                ) : null}
            </>
        ) : videoProfile ? (
            <>
                {videoProfile.durationSupported !== false && durationOptions.length ? (
                    <ChoiceChips
                        label="时长"
                        value={seconds}
                        options={durationOptions}
                        onChange={(value) => {
                            setSeconds(value);
                            rememberVideoSettings({ seconds: value });
                        }}
                    />
                ) : null}
                {videoProfile.ratios.length ? (
                    <ChoiceChips
                        label="画幅"
                        value={ratio}
                        options={videoRatioOptions(videoProfile.ratios)}
                        columns={videoProfile.ratios.length <= 4 ? videoProfile.ratios.length : 3}
                        onChange={(value) => {
                            setRatio(value);
                            rememberVideoSettings({ ratio: value });
                        }}
                    />
                ) : null}
                {videoProfile.resolutions.length ? (
                    <ChoiceChips
                        label="清晰度"
                        value={videoQuality}
                        options={videoProfile.resolutions.map((value) => ({ value: value.replace(/p$/i, ""), label: value }))}
                        onChange={(value) => {
                            setVideoQuality(value);
                            rememberVideoSettings({ videoQuality: value });
                        }}
                    />
                ) : null}
                <SwitchRow
                    items={[
                        ...(videoProfile.generateAudio.supported
                            ? [{ key: "audio", label: "生成音频", detail: "同步生成环境音或配乐", checked: config.videoGenerateAudio === "true", onChange: (value: boolean) => updateConfig("videoGenerateAudio", String(value)) }]
                            : []),
                        ...(videoProfile.watermark.supported
                            ? [{ key: "watermark", label: "添加水印", detail: "投放素材建议关闭", checked: config.videoWatermark === "true", onChange: (value: boolean) => updateConfig("videoWatermark", String(value)) }]
                            : []),
                    ]}
                />
            </>
        ) : null;

    return (
        <WorkspacePage fluid scroll={false} className="wb-page">
            <div className="wb-shell" data-kind={kind} data-mobile-tab={mobileTab}>
                <div className="wb-mobile-tabs">
                    <SegmentedControl<"compose" | "gallery">
                        block
                        ariaLabel="切换创作面板与作品"
                        value={mobileTab}
                        onChange={setMobileTab}
                        options={[
                            { value: "compose", label: "创作" },
                            { value: "gallery", label: galleryCount ? `作品 ${galleryCount}` : "作品" },
                        ]}
                    />
                </div>
                <aside className="wb-composer" aria-label={`${kindLabel}创作面板`} onPasteCapture={handlePaste}>
                    <header className="wb-composer-head">
                        <h1 className="sr-only">{kindLabel}生成</h1>
                        {bothKinds ? (
                            <nav className="wb-kind-switch" aria-label="切换生成类型">
                                <button type="button" aria-pressed={kind === "image"} className={kind === "image" ? "is-active" : ""} onClick={() => kind !== "image" && navigate("/toolbox/image")}>
                                    <ImageIcon />
                                    商品图片
                                </button>
                                <button type="button" aria-pressed={kind === "video"} className={kind === "video" ? "is-active" : ""} onClick={() => kind !== "video" && navigate("/toolbox/video")}>
                                    <Clapperboard />
                                    商品视频
                                </button>
                            </nav>
                        ) : (
                            <strong className="wb-composer-title">{kind === "image" ? "商品图片" : "商品视频"}</strong>
                        )}
                        <Tooltip title="清空场景、素材、描述和参数（作品不受影响）">
                            <button type="button" className="wb-icon-button" data-icon-only aria-label="重置创作面板" onClick={resetComposer}>
                                <RotateCcw />
                            </button>
                        </Tooltip>
                    </header>
                    <div className="wb-composer-scroll">
                        <SceneSection kind={kind} tool={tool} quickTools={quickTools} loading={directoryLoading} error={directoryError} onOpenLibrary={() => setLibraryOpen(true)} onChoose={chooseTool} onRetry={() => loadDirectory()} />
                        <ReferenceSection
                            kind={kind}
                            tool={tool}
                            references={references}
                            unslottedLimit={unslottedLimit}
                            onPick={(slotKey) => {
                                setUploadSlotKey(slotKey);
                                window.setTimeout(() => fileRef.current?.click(), 0);
                            }}
                            onDropFiles={(files, slotKey) => void addFiles(files, slotKey)}
                            onOpenLibrary={(slotKey) => setAssetPicker({ slotKey })}
                            onRemove={removeReference}
                            onRoleChange={(reference, role) => setReferences((current) => withUniqueFrameRole(current, reference.id, role))}
                            onClear={clearReferences}
                        />
                        <PromptSection
                            kind={kind}
                            tool={tool}
                            preset={preset}
                            prompt={prompt}
                            maxChars={promptMaxChars}
                            inspirations={WORKBENCH_INSPIRATIONS[kind]}
                            onChoosePreset={choosePreset}
                            onTogglePhrase={(phrase) => setPrompt((current) => togglePromptPhrase(current, phrase))}
                            onClear={() => {
                                setPrompt("");
                                setPreset(null);
                            }}
                            editor={
                                <CanvasResourceMentionTextarea
                                    aria-label="画面描述，可输入 @ 引用素材"
                                    className="wb-prompt-input"
                                    containerClassName="wb-prompt-editor"
                                    value={prompt}
                                    references={promptReferences}
                                    onChange={setPrompt}
                                    onSubmit={() => void submit()}
                                    sendOnEnter={false}
                                    style={{ color: "var(--wb-ink)" }}
                                    placeholder={kind === "image" ? "例如：白色陶瓷马克杯放在浅色原木桌面上，清晨自然窗光，背景简洁，商品居中，保留杯身印花与把手细节" : "例如：镜头从商品正面缓慢推近，柔和光线从左向右扫过瓶身，结尾停在完整包装上 1 秒"}
                                    maxLength={promptMaxChars}
                                />
                            }
                        />
                        <ComposerSection title="模型与规格" hint="可选参数随模型变化">
                            {models.length ? (
                                <ModelPicker
                                    config={config}
                                    value={selectedModel}
                                    capability={capability}
                                    requirements={pickerRequirements}
                                    variant="creation"
                                    fullWidth
                                    className="creation-model-picker wb-model-picker"
                                    showSelectedPrice={false}
                                    showOptionPrices
                                    onChange={(value) => {
                                        updateConfig(kind === "image" ? "imageModel" : "videoModel", value);
                                        updateConfig("model", value);
                                    }}
                                    placeholder={`选择${kindLabel}模型`}
                                />
                            ) : (
                                <div className="wb-inline-error">
                                    <span>暂无可用的{kindLabel}模型</span>
                                    <a href="/settings?section=models" target="_blank" rel="noreferrer">
                                        去模型设置
                                    </a>
                                </div>
                            )}
                            {selectedModel ? (
                                <>
                                    <MediaSettingsNotice
                                        config={composerConfig}
                                        capability={kind}
                                        onChange={(field, value) => {
                                            if (field === "size") {
                                                setRatio(value);
                                                kind === "image" ? rememberImageSettings({ ratio: value }) : rememberVideoSettings({ ratio: value });
                                            } else if (field === "quality") {
                                                setQuality(value);
                                                rememberImageSettings({ quality: value });
                                            } else if (field === "imageResolution") {
                                                setImageResolution(value);
                                                rememberImageSettings({ imageResolution: value });
                                            } else if (field === "videoSeconds") {
                                                setSeconds(value);
                                                rememberVideoSettings({ seconds: value });
                                            } else if (field === "vquality") {
                                                setVideoQuality(value);
                                                rememberVideoSettings({ videoQuality: value });
                                            } else updateConfig(field as keyof typeof config, value);
                                        }}
                                    />
                                    {specControls}
                                </>
                            ) : null}
                            {selectedModel ? <p className="wb-muted-note">{WORKBENCH_SPEC_TIPS[kind]}</p> : null}
                        </ComposerSection>
                        <ComposerSection title="生成数量" hint={limitHint ? `${countHint} · ${limitHint}` : countHint}>
                            <CountStepper kind={kind} value={requestedCount} max={batchLimit} onChange={changeCount} />
                        </ComposerSection>
                    </div>
                    <ComposerFooter kind={kind} count={requestedCount} taskCount={plan.length} estimate={estimateLabel} busy={busy} disabledReason={disabledReason} onSubmit={() => void submit()} />
                </aside>
                <WorkbenchGallery
                    kind={kind}
                    batches={galleryBatches}
                    loading={tasksLoading}
                    filter={filter}
                    query={query}
                    busyTaskIds={busyTaskIds}
                    actions={galleryActions}
                    quickTools={quickTools}
                    historyCapped={tasks.length >= 100}
                    onFilterChange={setFilter}
                    onQueryChange={setQuery}
                    onRefresh={() => {
                        detailFailedRef.current.clear();
                        setDetailErrors(new Set());
                        void loadTasks();
                    }}
                    onOpenLibrary={() => {
                        setMobileTab("compose");
                        setLibraryOpen(true);
                    }}
                    onChooseTool={chooseTool}
                />
            </div>

            <input
                ref={fileRef}
                type="file"
                className="sr-only"
                tabIndex={-1}
                aria-hidden
                accept={
                    uploadSlotKey
                        ? tool?.inputContract?.slots
                              .find((slot) => slot.key === uploadSlotKey)
                              ?.mediaTypes.map((type) => `${type}/*`)
                              .join(",")
                        : kind === "image"
                          ? "image/*"
                          : "image/*,video/*,audio/*"
                }
                multiple
                onChange={(event) => {
                    if (event.target.files?.length) void addFiles(event.target.files, uploadSlotKey);
                    event.currentTarget.value = "";
                }}
            />

            <SceneLibraryModal open={libraryOpen} kind={kind} tools={tools} loading={directoryLoading} error={directoryError} selectedId={tool?.id} onRetry={() => loadDirectory()} onClose={() => setLibraryOpen(false)} onChoose={chooseTool} />

            <WorkbenchViewer
                kind={kind}
                batch={viewerBatch}
                outputKey={viewer?.outputKey || null}
                detail={viewerDetail}
                presetName={viewerDetail ? workbenchTaskSnapshot(viewerDetail)?.presetName : undefined}
                onNavigate={(output) => {
                    setViewer((current) => (current ? { ...current, outputKey: output.key } : current));
                    requestDetails([{ id: output.taskId, version: viewerBatch?.tasks.find((task) => task.id === output.taskId)?.updatedAt }]);
                }}
                onClose={() => setViewer(null)}
                onDownload={(output) => viewerBatch && galleryActions.download(output, viewerBatch)}
                onUseAsReference={kind === "image" ? (output) => void useAsReference(output) : undefined}
                onMakeVideo={kind === "image" && features.videoWorkbenchEnabled ? makeVideo : undefined}
                onReuse={(task) => viewerBatch && void restoreBatch(viewerBatch, task)}
                onCopyPrompt={(text) => void copyText(text)}
            />

            {assetPicker ? (
                <Suspense fallback={null}>
                    <WorkbenchAssetPicker
                        open
                        accept={(() => {
                            const slot = tool?.inputContract?.slots.find((item) => item.key === assetPicker.slotKey);
                            if (slot) return slot.mediaTypes;
                            return kind === "image" ? (["image"] as const) : (["image", "video", "audio"] as const).filter((mediaKind) => referenceLimitFor(mediaKind) > 0);
                        })()}
                        maxCount={(() => {
                            const slot = tool?.inputContract?.slots.find((item) => item.key === assetPicker.slotKey);
                            if (slot) return Math.max(0, slot.maxCount - references.filter((item) => item.slotKey === slot.key).length);
                            return Math.max(0, unslottedLimit - references.length);
                        })()}
                        slotName={tool?.inputContract?.slots.find((item) => item.key === assetPicker.slotKey)?.name}
                        onClose={() => setAssetPicker(null)}
                        onPick={(items) => void addResourceReferences(items, assetPicker.slotKey)}
                    />
                </Suspense>
            ) : null}

            <AppModal
                title="描述里已有内容"
                open={Boolean(presetPending)}
                onCancel={() => setPresetPending(null)}
                footer={[
                    <Button key="cancel" onClick={() => setPresetPending(null)}>
                        返回
                    </Button>,
                    <Button key="append" onClick={() => applyPreset("append")}>
                        追加到末尾
                    </Button>,
                    <Button key="replace" type="primary" onClick={() => applyPreset("replace")}>
                        替换
                    </Button>,
                ]}
            >
                {presetPending ? <p className="wb-modal-copy">将应用“{presetPending.name}”模板。可以替换当前描述，也可以追加到末尾。</p> : null}
            </AppModal>
        </WorkspacePage>
    );
}

export default function ImageWorkbenchPage() {
    return <WorkbenchPage kind="image" />;
}

export function VideoWorkbenchPage() {
    return <WorkbenchPage kind="video" />;
}
