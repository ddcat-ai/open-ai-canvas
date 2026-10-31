import { createClientUUID } from "@/lib/client-id";
import { App, Button, Input, Modal, Popover, Progress, Segmented, Select, Spin, Switch, Tooltip } from "antd";
import { ArrowUp, BookOpen, Check, Camera, ChevronDown, ChevronUp, Clapperboard, Expand, FileImage, ImagePlus, Images, LoaderCircle, Mic, Palette, Plus, RefreshCw, RotateCcw, Search, ShoppingBag, Upload, UserRound, Video, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";

import { ImageSizePicker } from "@/components/image-size-picker";
import { MediaPreview } from "@/components/media-preview";
import { ModelPicker } from "@/components/model-picker";
import { SpotlightSurface } from "@/components/ui/aceternity/spotlight-surface";
import { WorkspacePage } from "@/components/layout/workspace-page";
import { CanvasResourceMentionTextarea } from "@/components/canvas/canvas-resource-mention-textarea";
import { normalizeCanvasNodeMentionTokens, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { imageResolutionUsesQuality } from "@/lib/image-size-presets";
import { modelCapabilityConfigFor, normalizeImageValue, normalizeVideoValue } from "@/lib/model-capabilities";
import { creationVideoConfig } from "@/pages/create/creation-generation-config";
import { imageQualityLabel } from "@/lib/image-quality";
import { modelQuoteRequest } from "@/lib/model-pricing";
import { quoteModel } from "@/services/api/logical-models";
import { prepareBackendGenerationTask } from "@/services/api/generation-task";
import { createGenerationTask, cancelGenerationTask, queryGenerationTask, retryGenerationTask, type GenerationTask } from "@/services/api/task-center";
import { capabilitySupportedModes, createWorkbenchTask, listWorkbenchTasks, listWorkbenchTools, normalizeWorkbenchGuide, resolveWorkbenchResourceURL, type WorkbenchKind, type WorkbenchPromptPreset, type WorkbenchTool } from "@/services/api/workbench";
import { resourceStorageKey, uploadResourceFile } from "@/services/api/resources";
import { formatCredits, requestCreditCost } from "@/constant/credits";
import { useCreationPreferencesStore } from "@/stores/use-creation-preferences-store";
import { logicalModelIDForConfig, modelDisplayName, modelOptionName, resolveModelChannel, selectableModelsByCapability, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

import { workbenchCategoryLabel, workbenchCategories } from "./workbench-catalog";
import { missingWorkbenchInput, workbenchPromptRequired, workbenchVideoOperation } from "./workbench-input";
import "./workbench.css";
import "./workbench-count-picker.css";

export type WorkbenchReference = {
    id: string;
    name: string;
    kind: "image" | "video" | "audio";
    resourceId?: string;
    previewUrl: string;
    progress: number;
    uploading: boolean;
    error?: string;
    role: "reference" | "first_frame" | "last_frame";
    slotKey?: string;
};

export function filterWorkbenchTools(tools: WorkbenchTool[], category: string, query: string) {
    const normalized = query.trim().toLocaleLowerCase();
    return tools.filter(
        (tool) =>
            (category === "all" || (category === "recommended" ? tool.recommended || tool.categoryId === category : tool.categoryId === category)) &&
            (!normalized || `${tool.name} ${tool.subtitle} ${tool.description} ${workbenchCategoryLabel(tool.categoryId)} ${(tool.searchKeywords || []).join(" ")}`.toLocaleLowerCase().includes(normalized)),
    );
}

function parseInput(inputJson?: string) {
    if (!inputJson) return null;
    try {
        const parsed: unknown = JSON.parse(inputJson);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, any>) : null;
    } catch {
        return null;
    }
}

type WorkbenchTaskReferenceSnapshot = {
    resourceId: string;
    kind: WorkbenchReference["kind"];
    role?: WorkbenchReference["role"];
    slotKey?: string;
};

type WorkbenchTaskSnapshot = {
    kind: WorkbenchKind;
    toolId?: string;
    presetId?: string;
    parameters: Record<string, unknown>;
    references: WorkbenchTaskReferenceSnapshot[];
};

export function workbenchTaskSnapshot(task: GenerationTask): WorkbenchTaskSnapshot | null {
    const input = parseInput(task.inputJson);
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
    return {
        kind,
        ...(typeof snapshot.toolId === "string" ? { toolId: snapshot.toolId } : typeof metadata.workbenchToolId === "string" ? { toolId: metadata.workbenchToolId } : {}),
        ...(typeof snapshot.presetId === "string" ? { presetId: snapshot.presetId } : typeof metadata.workbenchPresetId === "string" ? { presetId: metadata.workbenchPresetId } : {}),
        parameters: rawParameters as Record<string, unknown>,
        references,
    };
}

export function taskMediaUrls(task: GenerationTask): string[] {
    try {
        const result = task.resultJson ? (JSON.parse(task.resultJson) as { images?: Array<{ url?: string; dataUrl?: string }>; video?: { url?: string; dataUrl?: string } }) : null;
        if (task.previewKind === "video" || result?.video) {
            const videoUrl = result?.video?.url || result?.video?.dataUrl || task.previewUrl || "";
            return videoUrl ? [videoUrl] : [];
        }
        const urls = (result?.images || []).map((item) => item?.url || item?.dataUrl || "").filter(Boolean);
        if (urls.length) return urls;
    } catch {
        // Ignore malformed resultJson and fall back to previewUrl.
    }
    return task.previewUrl ? [task.previewUrl] : [];
}

function taskPreview(task: GenerationTask) {
    return taskMediaUrls(task)[0] || "";
}

function elapsedLabel(task: GenerationTask) {
    const start = task.startedAt ? Date.parse(task.startedAt) : Date.parse(task.createdAt);
    const end = task.completedAt ? Date.parse(task.completedAt) : Date.now();
    if (!Number.isFinite(start) || !Number.isFinite(end)) return "";
    const seconds = Math.max(0, Math.floor((end - start) / 1000));
    return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

function displayTaskState(task: GenerationTask) {
    if (task.status === "queued") return "排队中";
    if (task.status === "running") return task.stage || "生成中";
    if (task.status === "succeeded") return "已完成";
    if (task.status === "cancelled") return "已取消";
    return task.error || task.stage || "生成失败";
}

function revokeReferencePreview(reference: WorkbenchReference) {
    if (reference.previewUrl.startsWith("blob:")) URL.revokeObjectURL(reference.previewUrl);
}

// 当后台工具副标题看起来像模型 ID（前后端配置错误遗留），回退到工具描述或留空，避免泄露原始模型标识。
function isModelIdLike(value: string | undefined) {
    if (!value) return true;
    const normalized = value.trim();
    if (!normalized) return true;
    if (/^[a-z0-9][a-z0-9._-]{1,40}$/i.test(normalized) && /[._-]/.test(normalized)) return true;
    return false;
}

function toolVisual(tool: WorkbenchTool, kind: WorkbenchKind) {
    const text = `${tool.name} ${tool.subtitle || ""} ${tool.description || ""} ${(tool.searchKeywords || []).join(" ")}`.toLocaleLowerCase();
    if (text.includes("模特") || text.includes("人物") || text.includes("上身") || text.includes("穿搭")) return { icon: <UserRound />, tone: "people", label: "模特与人物" };
    if (text.includes("视频") || kind === "video") return { icon: <Clapperboard />, tone: "video", label: "商品视频" };
    if (text.includes("场景") || text.includes("氛围") || text.includes("背景")) return { icon: <Images />, tone: "scene", label: "场景与氛围" };
    if (text.includes("风格") || text.includes("海报") || text.includes("视觉")) return { icon: <Palette />, tone: "style", label: "风格与视觉" };
    if (text.includes("主图") || text.includes("商品") || text.includes("电商") || text.includes("白底")) return { icon: <ShoppingBag />, tone: "product", label: "商品出品" };
    return { icon: kind === "image" ? <Camera /> : <Clapperboard />, tone: "creative", label: "创意生成" };
}

export function WorkbenchPage({ kind: initialKind = "image" }: { kind?: WorkbenchKind }) {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const location = useLocation();
    const config = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const [searchParams, setSearchParams] = useSearchParams();
    const [kind, setKind] = useState<WorkbenchKind>(initialKind);
    useEffect(() => {
        setKind(initialKind);
    }, [initialKind]);

    const imageWorkbenchEnabled = useUserStore((state) => state.features.imageWorkbenchEnabled);
    const videoWorkbenchEnabled = useUserStore((state) => state.features.videoWorkbenchEnabled);
    // 两个功能同时开启（或未初始化默认状态）时支持页内直切图片/视频。
    const canSwitchKind = (imageWorkbenchEnabled && videoWorkbenchEnabled) || (!imageWorkbenchEnabled && !videoWorkbenchEnabled);

    const [tools, setTools] = useState<WorkbenchTool[]>([]);
    const [directoryLoading, setDirectoryLoading] = useState(true);
    const [directoryError, setDirectoryError] = useState("");
    const [toolLibraryOpen, setToolLibraryOpen] = useState(false);
    const [toolSearch, setToolSearch] = useState("");
    const [toolCategory, setToolCategory] = useState("all");
    const [tool, setTool] = useState<WorkbenchTool | null>(null);
    const [prompt, setPrompt] = useState("");
    const [references, setReferencesState] = useState<WorkbenchReference[]>([]);
    const referencesRef = useRef<WorkbenchReference[]>([]);
    const setReferences = (update: WorkbenchReference[] | ((current: WorkbenchReference[]) => WorkbenchReference[])) => {
        const next = typeof update === "function" ? update(referencesRef.current) : update;
        referencesRef.current = next;
        setReferencesState(next);
    };
    useEffect(() => () => referencesRef.current.forEach(revokeReferencePreview), []);
    const [activeTask, setActiveTask] = useState<GenerationTask | null>(null);
    const activeTaskIdRef = useRef<string | null>(null);
    activeTaskIdRef.current = activeTask?.id ?? null;
    const taskDetailsRef = useRef<Map<string, GenerationTask>>(new Map());
    const [stageMediaIndex, setStageMediaIndex] = useState(0);
    const [detailMediaIndex, setDetailMediaIndex] = useState(0);
    const [resultHidden, setResultHidden] = useState(false);
    const workbenchRevisionRef = useRef(0);
    const [tasks, setTasks] = useState<GenerationTask[]>([]);
    const [tasksLoading, setTasksLoading] = useState(true);
    const [detailTask, setDetailTask] = useState<GenerationTask | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const detailRequestRef = useRef(0);
    const [preset, setPreset] = useState<WorkbenchPromptPreset | null>(null);
    const [presetPending, setPresetPending] = useState<WorkbenchPromptPreset | null>(null);
    const [busy, setBusy] = useState(false);
    const [taskBusyId, setTaskBusyId] = useState("");
    const [mobileTab, setMobileTab] = useState("generate");
    const [query, setQuery] = useState("");
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const [estimateCredits, setEstimateCredits] = useState<number | null>(null);
    const [estimateEstimated, setEstimateEstimated] = useState(false);
    const [estimateTone, setEstimateTone] = useState<"quote" | "local" | "usage" | "loading" | "unavailable">("unavailable");
    const fileRef = useRef<HTMLInputElement>(null);
    const [uploadSlotKey, setUploadSlotKey] = useState<string | undefined>();
    const preferencesHydrated = useCreationPreferencesStore((state) => state.hydrated);
    const rememberImageSettings = useCreationPreferencesStore((state) => state.rememberImageSettings);
    const rememberVideoSettings = useCreationPreferencesStore((state) => state.rememberVideoSettings);
    const [settingsReady, setSettingsReady] = useState(false);
    const [ratio, setRatio] = useState(kind === "image" ? "1:1" : "16:9");
    const [quality, setQuality] = useState("auto");
    const [imageResolution, setImageResolution] = useState("auto");
    const [count, setCount] = useState("1");
    const [seconds, setSeconds] = useState("6");
    const [videoQuality, setVideoQuality] = useState("720");
    const capability = kind;
    const configuredModel = kind === "image" ? config.imageModel || config.model : config.videoModel || config.model;
    const models = useMemo(() => selectableModelsByCapability(config, capability), [capability, config]);
    const selectedModel = models.includes(configuredModel) ? configuredModel : models[0] || "";
    const profile = useMemo(() => modelCapabilityConfigFor(config, selectedModel), [config, selectedModel]);
    const imageProfile = profile.image;
    const videoProfile = profile.video;
    const filteredTools = useMemo(() => filterWorkbenchTools(tools, toolCategory, toolSearch), [toolCategory, toolSearch, tools]);
    const quickTools = useMemo(() => {
        const preferred = tools.filter((item) => item.recommended || item.categoryId === "ecommerce" || item.categoryId === "product");
        return (preferred.length ? preferred : tools).slice(0, 3);
    }, [tools]);
    const promptRequired = workbenchPromptRequired(tool);
    const missingInput = missingWorkbenchInput(tool, references);
    const activeTasks = useMemo(() => tasks.filter((task) => task.status === "queued" || task.status === "running"), [tasks]);
    const historyTasks = useMemo(() => tasks.filter((task) => task.status !== "queued" && task.status !== "running"), [tasks]);
    const filteredHistoryTasks = useMemo(() => historyTasks.filter((task) => !query.trim() || task.prompt.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 30), [historyTasks, query]);
    const selectedCount = Number(count) || 1;
    const maxReferenceCount = useMemo(
        () => (kind === "image" ? imageProfile?.references.maxImages || 0 : (videoProfile?.references.maxImages || 0) + (videoProfile?.references.maxVideos || 0) + (videoProfile?.references.maxAudios || 0)),
        [imageProfile, kind, videoProfile],
    );
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
        () => (kind === "video" && selectedModel ? creationVideoConfig(config, selectedModel, { ratio, seconds, videoQuality }) : { ...config, model: selectedModel, imageModel: selectedModel, size: ratio, quality, imageResolution, count }),
        [config, count, imageResolution, kind, quality, ratio, seconds, selectedModel, videoQuality],
    );

    useEffect(() => {
        const controller = new AbortController();
        setDirectoryLoading(true);
        setDirectoryError("");
        listWorkbenchTools(kind, controller.signal, false)
            .then((directory) => {
                setTools(directory.tools.filter((item) => item.kind === kind && item.enabled !== false && (!capabilitySupportedModes(item).length || capabilitySupportedModes(item).includes(kind))).sort((a, b) => a.sortOrder - b.sortOrder));
            })
            .catch((error) => {
                if (!controller.signal.aborted) setDirectoryError(error instanceof Error ? error.message : "工具目录加载失败");
            })
            .finally(() => {
                if (!controller.signal.aborted) setDirectoryLoading(false);
            });
        return () => controller.abort();
    }, [kind]);

    useEffect(() => {
        const toolId = searchParams.get("tool");
        if (!toolId || !tools.length) return;
        const next = tools.find((item) => item.id === toolId);
        // 页内选择和任务恢复会先更新 tool 再改地址，这里只处理从外部链接切换过来的工具。
        if (!next || next.id === tool?.id) return;
        setTool(next);
        switchToolPrompt(next, searchParams.get("preset"));
        // 只随地址和目录变化触发；tool 变化不能触发，否则任务恢复在改地址前会被旧地址拉回。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams, tools]);

    useEffect(() => {
        if (!preferencesHydrated || settingsReady || !imageProfile || !videoProfile) return;
        const saved = useCreationPreferencesStore.getState().preferences;
        if (kind === "image") {
            const normalized = normalizeImageValue(imageProfile, {
                size: saved.image?.ratio || imageProfile.size.default,
                quality: saved.image?.quality || imageProfile.quality.default,
                imageResolution: saved.image?.imageResolution || imageProfile.resolution.default,
                count: saved.image?.count || "1",
            });
            setRatio(normalized.size);
            setQuality(normalized.quality);
            setImageResolution(normalized.imageResolution || imageProfile.resolution.default || "auto");
            setCount(normalized.count);
        } else {
            const normalized = normalizeVideoValue(videoProfile, {
                seconds: saved.video?.seconds || String(videoProfile.duration.default),
                ratio: saved.video?.ratio || videoProfile.defaultRatio,
                resolution: saved.video?.videoQuality || videoProfile.defaultResolution,
            });
            setSeconds(normalized.seconds);
            setRatio(normalized.ratio);
            setVideoQuality(normalized.resolution.replace(/p$/i, ""));
        }
        setSettingsReady(true);
    }, [imageProfile, kind, preferencesHydrated, selectedModel, settingsReady, videoProfile]);

    useEffect(() => {
        if (!settingsReady || kind !== "image" || !imageProfile) return;
        const saved = useCreationPreferencesStore.getState().preferences.image;
        const normalized = normalizeImageValue(imageProfile, {
            size: saved?.ratio || imageProfile.size.default,
            quality: saved?.quality || imageProfile.quality.default,
            imageResolution: saved?.imageResolution || imageProfile.resolution.default,
            count: saved?.count || count,
        });
        setRatio(normalized.size);
        setQuality(normalized.quality);
        setImageResolution(normalized.imageResolution || imageProfile.resolution.default || "auto");
        setCount(normalized.count);
    }, [imageProfile, kind, selectedModel, settingsReady]);

    useEffect(() => {
        if (!settingsReady || kind !== "video" || !videoProfile) return;
        const saved = useCreationPreferencesStore.getState().preferences.video;
        const normalized = normalizeVideoValue(videoProfile, {
            seconds: saved?.seconds || String(videoProfile.duration.default),
            ratio: saved?.ratio || videoProfile.defaultRatio,
            resolution: saved?.videoQuality || videoProfile.defaultResolution,
        });
        setSeconds(normalized.seconds);
        setRatio(normalized.ratio);
        setVideoQuality(normalized.resolution.replace(/p$/i, ""));
    }, [kind, selectedModel, settingsReady, videoProfile]);

    const quoteRequirements = useMemo(
        () => ({
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
                ? { imageSize: ratio, options: { size: ratio, quality, ...(imageProfile?.resolution.supported ? { imageResolution } : {}), count: selectedCount } }
                : { videoSeconds: seconds, options: { size: ratio, videoSeconds: Number(seconds), vquality: videoQuality } }),
        }),
        [capability, imageProfile, imageResolution, kind, prompt, quality, ratio, references, seconds, selectedCount, videoQuality],
    );

    useEffect(() => {
        if (!creditsEnabled || !selectedModel) {
            setEstimateCredits(null);
            setEstimateTone("unavailable");
            return;
        }
        const priceChannel = resolveModelChannel(config, selectedModel);
        const localCredits = requestCreditCost({
            channelMode: priceChannel.scope === "system" ? "remote" : "local",
            modelCosts: priceChannel.modelCosts,
            model: modelOptionName(selectedModel),
            count: kind === "image" ? selectedCount : 1,
            seconds: kind === "video" ? Number(seconds) || 1 : 1,
            capability,
            config: composerConfig,
            requirements: quoteRequirements,
        });
        const request = modelQuoteRequest(composerConfig, selectedModel, capability, quoteRequirements);
        if (!request) {
            setEstimateCredits(localCredits);
            setEstimateEstimated(false);
            setEstimateTone(localCredits === null ? "usage" : "local");
            return;
        }
        const controller = new AbortController();
        if (localCredits === null) setEstimateTone("loading");
        else {
            setEstimateCredits(localCredits);
            setEstimateTone("local");
        }
        quoteModel(request, controller.signal)
            .then(({ quote }) => {
                setEstimateCredits(quote.amountMicrocredits / 1_000_000);
                setEstimateEstimated(quote.estimated === true);
                setEstimateTone("quote");
            })
            .catch(() => {
                if (controller.signal.aborted) return;
                setEstimateCredits(localCredits);
                setEstimateEstimated(false);
                setEstimateTone(localCredits === null ? "unavailable" : "local");
            });
        return () => controller.abort();
    }, [capability, composerConfig, config, creditsEnabled, kind, quoteRequirements, seconds, selectedCount, selectedModel]);

    const mergeWithCachedDetail = useCallback((item: GenerationTask): GenerationTask => {
        const cached = taskDetailsRef.current.get(item.id);
        if (!cached) return item;
        return {
            ...item,
            ...(item.inputJson ? {} : cached.inputJson ? { inputJson: cached.inputJson } : {}),
            ...(item.resultJson ? {} : cached.resultJson ? { resultJson: cached.resultJson } : {}),
        };
    }, []);

    const rememberTaskDetail = useCallback((detail: GenerationTask) => {
        taskDetailsRef.current.set(detail.id, detail);
        setTasks((current) => current.map((item) => (item.id === detail.id ? { ...item, ...detail } : item)));
        setActiveTask((current) => (current?.id === detail.id ? { ...current, ...detail } : current));
    }, []);

    const loadTasks = useCallback(async () => {
        try {
            const result = await listWorkbenchTasks(kind, 100);
            const merged = result.map(mergeWithCachedDetail);
            setTasks(merged);
            return merged;
        } catch (error) {
            message.error(error instanceof Error ? error.message : "任务列表加载失败");
            return [];
        } finally {
            setTasksLoading(false);
        }
    }, [kind, mergeWithCachedDetail, message]);

    useEffect(() => {
        let stopped = false;
        let timer = 0;
        const poll = async () => {
            const revision = workbenchRevisionRef.current;
            const result = await loadTasks();
            if (stopped) return;
            const currentActiveId = activeTaskIdRef.current;
            if (currentActiveId && revision === workbenchRevisionRef.current) {
                const latest = result.find((item) => item.id === currentActiveId);
                if (latest) {
                    setActiveTask((prev) => (prev && prev.id === latest.id ? mergeWithCachedDetail(latest) : latest));
                    if (latest.status === "succeeded" || latest.status === "failed" || latest.status === "cancelled") setMobileTab("result");
                }
            }
            timer = window.setTimeout(() => void poll(), result.some((task) => task.status === "queued" || task.status === "running") ? 5000 : 30000);
        };
        void poll();
        const onVisible = () => {
            if (!document.hidden) {
                window.clearTimeout(timer);
                void poll();
            }
        };
        document.addEventListener("visibilitychange", onVisible);
        return () => {
            stopped = true;
            window.clearTimeout(timer);
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, [loadTasks, mergeWithCachedDetail]);

    const switchKind = (nextKind: WorkbenchKind) => {
        if (nextKind === kind) return;
        workbenchRevisionRef.current += 1;
        referencesRef.current.forEach(revokeReferencePreview);
        setReferences([]);
        setUploadSlotKey(undefined);
        setTool(null);
        setPreset(null);
        setPresetPending(null);
        setActiveTask(null);
        setResultHidden(false);
        detailRequestRef.current += 1;
        setDetailLoading(false);
        setDetailTask(null);
        setTasksLoading(true);
        setSettingsReady(false);
        setKind(nextKind);
        if (location.pathname.startsWith("/toolbox")) {
            navigate(nextKind === "video" ? "/toolbox/video" : "/toolbox/image", { replace: true });
        } else {
            const params = new URLSearchParams(searchParams);
            params.delete("tool");
            params.delete("preset");
            setSearchParams(params, { replace: true });
        }
    };

    const resetWorkbench = () => {
        workbenchRevisionRef.current += 1;
        references.forEach(revokeReferencePreview);
        setReferences([]);
        setUploadSlotKey(undefined);
        setTool(null);
        setPreset(null);
        setPresetPending(null);
        setPrompt("");
        setActiveTask(null);
        setResultHidden(true);
        detailRequestRef.current += 1;
        setDetailLoading(false);
        setDetailTask(null);
        setMobileTab("generate");
        setCount("1");
        setRatio(kind === "image" ? imageProfile?.size.default || "1:1" : videoProfile?.defaultRatio || "16:9");
        setQuality(imageProfile?.quality.default || "auto");
        setImageResolution(imageProfile?.resolution.default || "auto");
        setSeconds(String(videoProfile?.duration.default || 6));
        setVideoQuality((videoProfile?.defaultResolution || "720p").replace(/p$/i, ""));
        const params = new URLSearchParams(searchParams);
        params.delete("tool");
        params.delete("preset");
        setSearchParams(params, { replace: true });
        message.success("工作台已重置");
    };

    // 提示词为空，或仍是当前预设的原文（用户没改过），切换时可以直接替换；改过的内容先确认再动。
    const promptReplaceable = () => !prompt.trim() || (preset !== null && prompt.trim() === preset.promptTemplate.trim());

    // 切换工具后提示词必须跟着新工具走：未改动的模板直接换成新工具的预设（新工具没有预设则清空），
    // 用户改过的内容弹出"替换 / 追加 / 返回"确认，不能静默保留上一个工具的模板。
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

    const chooseTool = (next: WorkbenchTool | null) => {
        references.forEach(revokeReferencePreview);
        setReferences([]);
        setUploadSlotKey(undefined);
        setTool(next);
        setToolLibraryOpen(false);
        const params = new URLSearchParams(searchParams);
        if (next) params.set("tool", next.id);
        else params.delete("tool");
        params.delete("preset");
        setSearchParams(params, { replace: true });
        switchToolPrompt(next);
    };

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

    const addFiles = async (files: FileList | File[], targetSlotKey = uploadSlotKey) => {
        const list = Array.from(files);
        const slot = tool?.inputContract?.slots.find((item) => item.key === targetSlotKey);
        const allowedTypes = slot?.mediaTypes || (kind === "image" ? ["image"] : ["image", "video", "audio"]);
        const accepted = list.filter((file) => allowedTypes.some((type) => file.type.startsWith(`${type}/`)));
        if (accepted.length !== list.length) message.warning(`该输入槽位仅支持${allowedTypes.map((type) => (type === "image" ? "图片" : type === "video" ? "视频" : "音频")).join("、")}`);
        const currentCount = references.filter((reference) => reference.slotKey === targetSlotKey).length;
        const maxCount = slot?.maxCount || maxReferenceCount;
        const picked = accepted.slice(0, Math.max(0, maxCount - currentCount));
        if (picked.length < accepted.length) message.warning("部分素材超过当前输入槽位数量上限，未添加");
        const pending: WorkbenchReference[] = picked.map((file) => ({
            id: createClientUUID(),
            name: file.name,
            kind: (file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : "audio") as WorkbenchReference["kind"],
            previewUrl: URL.createObjectURL(file),
            progress: 0,
            uploading: true,
            role: "reference" as const,
            ...(targetSlotKey ? { slotKey: targetSlotKey } : {}),
        }));
        setReferences((current) => [...current, ...pending]);
        await Promise.all(
            pending.map(async (reference, index) => {
                const file = picked[index];
                try {
                    const resource = await uploadResourceFile(file, reference.kind, { fileName: file.name }, (uploaded, total) => {
                        setReferences((current) => current.map((item) => (item.id === reference.id ? { ...item, progress: total ? (uploaded / total) * 100 : 0 } : item)));
                    });
                    setReferences((current) => current.map((item) => (item.id === reference.id ? { ...item, resourceId: resource.id, uploading: false, progress: 100 } : item)));
                } catch (error) {
                    setReferences((current) => current.map((item) => (item.id === reference.id ? { ...item, uploading: false, error: error instanceof Error ? error.message : "上传失败" } : item)));
                }
            }),
        );
    };

    const removeReference = (reference: WorkbenchReference) => {
        revokeReferencePreview(reference);
        setReferences((current) => current.filter((item) => item.id !== reference.id));
    };

    const submit = async () => {
        const revision = workbenchRevisionRef.current;
        const submittedPrompt = normalizeCanvasNodeMentionTokens(prompt.trim(), promptReferences);
        if (tool?.inputContract?.promptRequired && !submittedPrompt) {
            message.warning("当前工具需要填写提示词");
            return;
        }
        if (!tool && !submittedPrompt) {
            message.warning("请填写提示词");
            return;
        }
        const missing = missingWorkbenchInput(tool, references);
        if (missing) {
            message.warning(`请补齐“${missing.name || "输入素材"}”`);
            return;
        }
        const logicalModelId = logicalModelIDForConfig({ ...composerConfig, model: selectedModel });
        const channel = resolveModelChannel(config, selectedModel);
        if (!selectedModel || !models.includes(selectedModel)) {
            message.error(`请选择可用的${kind === "image" ? "图片" : "视频"}模型`);
            return;
        }
        if (!isAiConfigReady(config, selectedModel)) {
            message.error("当前模型配置不完整，请先完成模型设置");
            return;
        }
        if (references.some((reference) => reference.uploading || reference.error || !reference.resourceId)) {
            message.warning("请等待参考素材上传完成或移除失败素材");
            return;
        }
        if (submittedPrompt.length > (kind === "image" ? imageProfile?.references.promptMaxChars || 32000 : videoProfile?.references.promptMaxChars || 8000)) {
            message.error("提示词超过当前模型支持的长度");
            return;
        }
        setBusy(true);
        try {
            const imageRequest = kind === "image" && imageProfile ? normalizeImageValue(imageProfile, { size: ratio, quality, imageResolution, imageParameters: config.imageParameters, count, transparentBackground: config.transparentBackground }) : null;
            const videoRequest = kind === "video" && videoProfile ? normalizeVideoValue(videoProfile, { seconds, ratio, resolution: videoQuality }) : null;
            const parameters = imageRequest
                ? { size: imageRequest.size, quality: imageRequest.quality, imageResolution: imageRequest.imageResolution, count: Number(imageRequest.count) }
                : {
                      seconds: Number(videoRequest?.seconds || seconds),
                      ratio: videoRequest?.ratio || ratio,
                      resolution: videoRequest?.resolution || videoQuality,
                      generateAudio: composerConfig.videoGenerateAudio === "true",
                      watermark: composerConfig.videoWatermark === "true",
                  };
            const generationConfig = {
                ...composerConfig,
                model: selectedModel,
                ...(imageRequest ? { imageModel: selectedModel, size: imageRequest.size, quality: imageRequest.quality, imageResolution: imageRequest.imageResolution, count: imageRequest.count } : {}),
                ...(videoRequest ? { videoModel: selectedModel, size: videoRequest.ratio, videoSeconds: videoRequest.seconds, vquality: videoRequest.resolution.replace(/p$/i, "") } : {}),
            };
            const readyReferences = references.filter((reference) => reference.resourceId);
            const videoOperation = kind === "video" ? workbenchVideoOperation(readyReferences) : undefined;
            const referenceSnapshot = readyReferences.map((reference) => ({ resourceId: reference.resourceId!, kind: reference.kind, role: reference.role, ...(reference.slotKey ? { slotKey: reference.slotKey } : {}) }));
            const createdTask =
                logicalModelId || channel?.scope === "system"
                    ? await createWorkbenchTask({
                          kind,
                          ...(tool ? { toolId: tool.id } : {}),
                          ...(tool && preset ? { presetId: preset.id } : {}),
                          prompt: submittedPrompt,
                          model: modelOptionName(selectedModel),
                          ...(logicalModelId ? { logicalModelId } : { channelId: channel.id }),
                          parameters,
                          references: readyReferences.map((reference) => ({ resourceId: reference.resourceId!, kind: reference.kind, role: reference.role, ...(reference.slotKey ? { slotKey: reference.slotKey } : {}) })),
                      })
                    : await prepareBackendGenerationTask({
                          mode: kind,
                          prompt: submittedPrompt,
                          config: generationConfig,
                          referenceImages: readyReferences
                              .filter((reference) => reference.kind === "image")
                              .map((reference) => ({
                                  id: reference.id,
                                  name: reference.name,
                                  type: "image/*",
                                  dataUrl: "",
                                  storageKey: resourceStorageKey(reference.resourceId!),
                                  role: reference.role,
                                  ...(reference.slotKey ? { slotKey: reference.slotKey } : {}),
                              })),
                          referenceVideos: readyReferences
                              .filter((reference) => reference.kind === "video")
                              .map((reference) => ({
                                  id: reference.id,
                                  name: reference.name,
                                  type: "video/*",
                                  url: "",
                                  storageKey: resourceStorageKey(reference.resourceId!),
                                  role: reference.role,
                                  ...(reference.slotKey ? { slotKey: reference.slotKey } : {}),
                              })),
                          referenceAudios: readyReferences
                              .filter((reference) => reference.kind === "audio")
                              .map((reference) => ({
                                  id: reference.id,
                                  name: reference.name,
                                  type: "audio/*",
                                  url: "",
                                  storageKey: resourceStorageKey(reference.resourceId!),
                                  role: reference.role,
                                  ...(reference.slotKey ? { slotKey: reference.slotKey } : {}),
                              })),
                          metadata: {
                              source: "workbench",
                              workbenchKind: kind,
                              ...(videoOperation ? { videoEditOperation: videoOperation } : {}),
                              ...Object.fromEntries(
                                  readyReferences
                                      .filter((reference) => reference.role === "first_frame" || reference.role === "last_frame")
                                      .map((reference) => [reference.role === "first_frame" ? "videoStartFrameNodeId" : "videoEndFrameNodeId", reference.id]),
                              ),
                              ...(tool ? { workbenchToolId: tool.id, workbenchToolName: tool.name } : {}),
                              ...(tool && preset ? { workbenchPresetId: preset.id } : {}),
                              workbench: { kind, ...(tool ? { toolId: tool.id } : {}), ...(tool && preset ? { presetId: preset.id } : {}), parameters, references: referenceSnapshot },
                          },
                      }).then((taskInput) => createGenerationTask({ ...taskInput, ...(videoOperation ? { operation: videoOperation } : {}) }));
            const task = await queryGenerationTask(createdTask.id);
            rememberTaskDetail(task);
            setTasks((current) => [task, ...current.filter((item) => item.id !== task.id)]);
            if (revision === workbenchRevisionRef.current) {
                setResultHidden(false);
                setStageMediaIndex(0);
                setActiveTask(task);
                setMobileTab("result");
            }
            message.success("生成任务已提交");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "任务提交失败");
        } finally {
            setBusy(false);
        }
    };

    const cancelTask = async (task: GenerationTask) => {
        setTaskBusyId(task.id);
        try {
            const next = await cancelGenerationTask(task.id);
            setTasks((current) => current.map((item) => (item.id === task.id ? next : item)));
            if (activeTask?.id === task.id) setActiveTask(next);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "取消任务失败");
        } finally {
            setTaskBusyId("");
        }
    };

    const restoreTaskToComposer = async (task: GenerationTask, notify = true) => {
        let sourceTask = mergeWithCachedDetail(task);
        if (!sourceTask.inputJson) {
            try {
                const detail = await queryGenerationTask(sourceTask.id);
                rememberTaskDetail(detail);
                sourceTask = detail;
            } catch {
                // Fall back to existing task object if detail fetch fails.
            }
        }
        const snapshot = workbenchTaskSnapshot(sourceTask);
        if (!snapshot || snapshot.kind !== kind) {
            if (notify) message.warning("该任务没有可恢复的工作台参数");
            return false;
        }
        const restoredTool = snapshot.toolId ? tools.find((item) => item.id === snapshot.toolId) || null : null;
        const restoredPreset = restoredTool && snapshot.presetId ? restoredTool.presets.find((item) => item.id === snapshot.presetId) || null : null;
        const parameters = snapshot.parameters;
        if (kind === "image") {
            const restoredRatio = typeof parameters.size === "string" ? parameters.size : ratio;
            const restoredQuality = typeof parameters.quality === "string" ? parameters.quality : quality;
            const restoredResolution = typeof parameters.imageResolution === "string" ? parameters.imageResolution : imageResolution;
            const restoredCount = parameters.count != null ? String(parameters.count) : count;
            setRatio(restoredRatio);
            setQuality(restoredQuality);
            setImageResolution(restoredResolution);
            setCount(restoredCount);
            rememberImageSettings({ ratio: restoredRatio, quality: restoredQuality, imageResolution: restoredResolution, count: restoredCount });
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
        const restoredModel = sourceTask.model ? models.find((item) => item === sourceTask.model || modelOptionName(item) === sourceTask.model) : undefined;
        if (restoredModel) {
            updateConfig(kind === "image" ? "imageModel" : "videoModel", restoredModel);
            updateConfig("model", restoredModel);
        }
        setTool(restoredTool);
        setPreset(restoredPreset);
        setPrompt(sourceTask.prompt || "");
        setUploadSlotKey(undefined);
        referencesRef.current.forEach(revokeReferencePreview);
        setReferences([]);
        const restoredReferences = await Promise.all(
            snapshot.references.map(async (reference, index): Promise<WorkbenchReference> => ({
                id: createClientUUID(),
                name: `${reference.kind === "image" ? "图片" : reference.kind === "video" ? "视频" : "音频"} ${index + 1}`,
                kind: reference.kind,
                resourceId: reference.resourceId,
                previewUrl: (await resolveWorkbenchResourceURL(reference.resourceId, "original")) || "",
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
        setActiveTask(sourceTask);
        setResultHidden(false);
        setMobileTab("generate");
        setDetailTask(null);
        if (notify) message.success("任务配置已载入编辑器");
        return true;
    };

    const retryTask = async (task: GenerationTask) => {
        setTaskBusyId(task.id);
        try {
            let restoreSource = task;
            if (!restoreSource.inputJson) {
                try {
                    restoreSource = await queryGenerationTask(task.id);
                } catch {
                    // The retry response also contains the safe restore snapshot.
                }
            }
            const restored = await restoreTaskToComposer(restoreSource, false);
            const next = await retryGenerationTask(task.id);
            if (!restored) await restoreTaskToComposer(next, false);
            setTasks((current) => [next, ...current.filter((item) => item.id !== next.id)]);
            setActiveTask(next);
            message.success("任务已重新提交");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "重试任务失败");
        } finally {
            setTaskBusyId("");
        }
    };

    const openDetail = async (task: GenerationTask) => {
        const requestId = ++detailRequestRef.current;
        const merged = mergeWithCachedDetail(task);
        setDetailMediaIndex(0);
        setDetailTask(merged);
        if (merged.resultJson && merged.inputJson) {
            setDetailLoading(false);
            return;
        }
        setDetailLoading(true);
        try {
            const detail = await queryGenerationTask(task.id);
            rememberTaskDetail(detail);
            if (requestId === detailRequestRef.current) setDetailTask(detail);
        } catch (error) {
            if (requestId === detailRequestRef.current) message.error(error instanceof Error ? error.message : "任务详情加载失败");
        } finally {
            if (requestId === detailRequestRef.current) setDetailLoading(false);
        }
    };

    const estimateLabel = !creditsEnabled
        ? ""
        : estimateCredits !== null
          ? `${estimateEstimated || estimateTone !== "quote" ? "预估" : "预计"} ${estimateCredits.toLocaleString("zh-CN", { maximumFractionDigits: 6 })} 积分`
          : estimateTone === "loading"
            ? "正在计算积分"
            : estimateTone === "usage"
              ? "按实际用量结算"
              : "报价暂不可用";
    const taskModelLabel = (task: GenerationTask) => {
        const rawModel = task.model?.trim() || "";
        if (!rawModel) return kind === "image" ? "图片生成" : "视频生成";
        const configuredModel = models.find((item) => item === rawModel || modelOptionName(item) === rawModel);
        const display = configuredModel ? modelDisplayName(config, configuredModel) : rawModel;
        return isModelIdLike(display) ? "生成模型" : display;
    };
    const resultTask = resultHidden ? null : activeTask || tasks.find((task) => task.status === "succeeded") || null;
    const resultUrls = useMemo(() => (resultTask ? taskMediaUrls(resultTask) : []), [resultTask]);
    const activeStageUrl = resultUrls[Math.min(stageMediaIndex, Math.max(0, resultUrls.length - 1))] || "";
    const detailUrls = useMemo(() => (detailTask ? taskMediaUrls(detailTask) : []), [detailTask]);
    const activeDetailUrl = detailUrls[Math.min(detailMediaIndex, Math.max(0, detailUrls.length - 1))] || "";

    useEffect(() => {
        setStageMediaIndex(0);
    }, [resultTask?.id]);

    // 列表接口只下发首图 previewUrl，当前舞台展示已完成任务时自动补拉一次详情，确保多张生成结果（resultJson.images）与可恢复参数（inputJson）完整就位。
    useEffect(() => {
        if (!resultTask || resultTask.status !== "succeeded" || (resultTask.resultJson && resultTask.inputJson)) return;
        let cancelled = false;
        queryGenerationTask(resultTask.id)
            .then((detail) => {
                if (!cancelled) rememberTaskDetail(detail);
            })
            .catch(() => {
                // Keep summary preview if detail fetch fails.
            });
        return () => {
            cancelled = true;
        };
    }, [rememberTaskDetail, resultTask?.id, resultTask?.inputJson, resultTask?.resultJson, resultTask?.status]);
    const guideText = tool ? normalizeWorkbenchGuide(tool.guide) : "";
    const hasToolGuideDetails = Boolean(tool && (guideText || tool.inputContract?.slots.length || tool.resultExample?.imageUrls?.length || tool.resultExample?.videoUrl));

    const settingsPanel =
        kind === "image" && imageProfile ? (
            <div className="workbench-settings-content">
                <ImageSizePicker profile={imageProfile} size={ratio} quality={quality} imageResolution={imageResolution} onChange={updateImageSettings} />
                {imageProfile.quality.supported && !imageResolutionUsesQuality(imageProfile) ? (
                    <label className="workbench-setting-row">
                        <span>图片质量</span>
                        <Select
                            value={quality}
                            onChange={(value) => {
                                setQuality(value);
                                rememberImageSettings({ quality: value });
                            }}
                            options={imageProfile.quality.values.map((value) => ({ value, label: imageQualityLabel(value) }))}
                        />
                    </label>
                ) : null}
                <CountPicker
                    value={count}
                    max={imageProfile.maxOutputs}
                    onChange={(value) => {
                        setCount(value);
                        rememberImageSettings({ count: value });
                    }}
                />
            </div>
        ) : videoProfile ? (
            <div className="workbench-settings-content">
                <ParameterChips
                    label="视频时长"
                    value={seconds}
                    options={(videoProfile.duration.selection === "enum"
                        ? videoProfile.duration.values || []
                        : Array.from(
                              { length: Math.floor(((videoProfile.duration.max || 15) - (videoProfile.duration.min || 1)) / (videoProfile.duration.step || 1)) + 1 },
                              (_, index) => (videoProfile.duration.min || 1) + index * (videoProfile.duration.step || 1),
                          )
                    ).map((value) => ({ value: String(value), label: `${value} 秒` }))}
                    onChange={(value) => {
                        setSeconds(value);
                        rememberVideoSettings({ seconds: value });
                    }}
                />
                <ParameterChips
                    label="画面比例"
                    value={ratio}
                    options={videoProfile.ratios.map((value) => ({ value, label: value === "adaptive" ? "自适应" : value }))}
                    onChange={(value) => {
                        setRatio(value);
                        rememberVideoSettings({ ratio: value });
                    }}
                />
                <ParameterChips
                    label="清晰度"
                    value={videoQuality}
                    options={videoProfile.resolutions.map((value) => ({ value: value.replace(/p$/i, ""), label: value }))}
                    onChange={(value) => {
                        setVideoQuality(value);
                        rememberVideoSettings({ videoQuality: value });
                    }}
                />
                {videoProfile.generateAudio.supported || videoProfile.watermark.supported ? (
                    <div className="workbench-switch-row">
                        {videoProfile.generateAudio.supported ? (
                            <label>
                                <span>生成音频</span>
                                <Switch checked={config.videoGenerateAudio === "true"} onChange={(value) => updateConfig("videoGenerateAudio", String(value))} />
                            </label>
                        ) : null}
                        {videoProfile.watermark.supported ? (
                            <label>
                                <span>添加水印</span>
                                <Switch checked={config.videoWatermark === "true"} onChange={(value) => updateConfig("videoWatermark", String(value))} />
                            </label>
                        ) : null}
                    </div>
                ) : null}
            </div>
        ) : (
            <p className="workbench-list-empty">选择模型后，这里会显示该模型支持的参数。</p>
        );

    const toolLibrary = (
        <div className="workbench-tool-library" id="workbench-tool-library">
            <div className="workbench-tool-library-heading">
                <div>
                    <span>选择一个场景工具，或直接输入提示词创作</span>
                </div>
                {tool ? (
                    <button type="button" className="workbench-direct-create" onClick={() => chooseTool(null)}>
                        清除选择
                    </button>
                ) : null}
            </div>
            <Input aria-label="搜索创作工具" prefix={<Search className="size-4" />} value={toolSearch} onChange={(event) => setToolSearch(event.target.value)} placeholder="搜索工具" allowClear />
            <div className="workbench-tool-categories" role="tablist" aria-label="工具分类">
                {[{ value: "all", label: "全部" }, ...workbenchCategories].map((category) => (
                    <button type="button" key={category.value} role="tab" aria-selected={toolCategory === category.value} className={toolCategory === category.value ? "is-active" : ""} onClick={() => setToolCategory(category.value)}>
                        {category.label}
                    </button>
                ))}
            </div>
            {directoryLoading ? (
                <div className="workbench-picker-state">
                    <Spin size="small" />
                </div>
            ) : directoryError ? (
                <div className="workbench-tool-library-error">
                    <span>{directoryError}</span>
                    <Button
                        size="small"
                        onClick={() => {
                            setDirectoryError("");
                            setDirectoryLoading(true);
                            listWorkbenchTools(kind)
                                .then((directory) =>
                                    setTools(
                                        directory.tools.filter((item) => item.kind === kind && item.enabled !== false && (!capabilitySupportedModes(item).length || capabilitySupportedModes(item).includes(kind))).sort((a, b) => a.sortOrder - b.sortOrder),
                                    ),
                                )
                                .catch((error) => setDirectoryError(error instanceof Error ? error.message : "工具目录加载失败"))
                                .finally(() => setDirectoryLoading(false));
                        }}
                    >
                        重试
                    </Button>
                </div>
            ) : (
                <div className="workbench-tool-grid">
                    {filteredTools.map((item) => (
                        <ToolCard
                            key={item.id}
                            tool={item}
                            selected={item.id === tool?.id}
                            onClick={() => {
                                chooseTool(item);
                                setToolLibraryOpen(false);
                            }}
                        />
                    ))}
                    {!filteredTools.length ? <div className="workbench-picker-state">没有找到匹配的创作工具</div> : null}
                </div>
            )}
        </div>
    );

    const toolGuidePopoverContent = tool ? (
        <div className="workbench-guide-popover">
            <strong>{tool.name}</strong>
            <p className="workbench-guide-description">{tool.description || tool.subtitle}</p>
            {guideText ? (
                <div className="workbench-guide-copy">
                    {guideText
                        .split("\n")
                        .filter(Boolean)
                        .map((line, index) => (
                            <p key={`${index}:${line}`}>{line}</p>
                        ))}
                </div>
            ) : null}
            {tool.inputHint ? <p className="workbench-guide-input-hint">{tool.inputHint}</p> : null}
            {tool.inputContract?.slots.length ? (
                <div className="workbench-guide-contract">
                    <strong>输入素材要求</strong>
                    {tool.inputContract.slots.map((slot) => (
                        <span key={slot.key}>
                            {slot.name} · {slot.required ? "必填" : "可选"} · 最多 {slot.maxCount} 个
                        </span>
                    ))}
                </div>
            ) : null}
            {tool.resultExample?.imageUrls?.length || tool.resultExample?.videoUrl ? (
                <div className="workbench-example-strip">
                    <span>{tool.resultExample.title || "效果参考"}</span>
                    {tool.resultExample.imageUrls?.slice(0, 3).map((url) => (
                        <span className="workbench-example-thumb" key={url}>
                            <img src={url} alt="工具效果参考" />
                        </span>
                    ))}
                    {tool.resultExample.videoUrl ? (
                        <span className="workbench-example-thumb">
                            <video src={tool.resultExample.videoUrl} muted />
                        </span>
                    ) : null}
                </div>
            ) : null}
        </div>
    ) : null;

    return (
        <WorkspacePage fluid scroll={false} className="workbench-page">
            <div className="workbench-shell" data-kind={kind}>
                <section className={`workbench-columns ${mobileTab !== "generate" ? "is-mobile-secondary" : ""}`}>
                    <div className="workbench-mobile-tabs">
                        <Segmented
                            value={mobileTab}
                            onChange={(value) => setMobileTab(String(value))}
                            options={[
                                { label: "生成", value: "generate" },
                                { label: "结果", value: "result" },
                                { label: "记录", value: "tasks" },
                            ]}
                        />
                    </div>

                    <section className={`workbench-input-column ${mobileTab === "generate" ? "is-mobile-active" : ""}`} aria-label="生成参数">
                        <div className="workbench-composer">
                            <div className="workbench-tool-bar">
                                {canSwitchKind ? (
                                    <div className="workbench-mode-switch" role="tablist" aria-label="生成模式">
                                        <button type="button" role="tab" aria-selected={kind === "image"} className={kind === "image" ? "is-active" : ""} onClick={() => switchKind("image")}>
                                            <FileImage className="size-3.5" />
                                            <span>图片</span>
                                        </button>
                                        <button type="button" role="tab" aria-selected={kind === "video"} className={kind === "video" ? "is-active" : ""} onClick={() => switchKind("video")}>
                                            <Video className="size-3.5" />
                                            <span>视频</span>
                                        </button>
                                    </div>
                                ) : (
                                    <span className="workbench-kind-label">{kind === "image" ? "图片生成" : "视频生成"}</span>
                                )}

                                <div className="workbench-tool-selector-group">
                                    <button
                                        type="button"
                                        className={`workbench-tool-choice ${tool ? "has-tool" : ""}`}
                                        aria-expanded={toolLibraryOpen}
                                        aria-haspopup="dialog"
                                        aria-controls="workbench-tool-library"
                                        onClick={() => setToolLibraryOpen((open) => !open)}
                                    >
                                        <span className="workbench-tool-choice-mark">{tool?.iconUrl ? <img src={tool.iconUrl} alt="" /> : kind === "image" ? <FileImage /> : <Video />}</span>
                                        <span className="workbench-tool-choice-copy">
                                            <strong>{tool?.name || "选择创作工具"}</strong>
                                        </span>
                                        <ChevronDown className={toolLibraryOpen ? "is-open" : ""} />
                                    </button>
                                    {tool ? (
                                        <Tooltip title="退出当前工具，返回直接创作">
                                            <button type="button" className="workbench-tool-clear" aria-label="清除当前工具" onClick={() => chooseTool(null)}>
                                                <X className="size-3.5" />
                                            </button>
                                        </Tooltip>
                                    ) : null}
                                </div>

                                <Tooltip title="清空工具、提示词、参考素材和生成结果">
                                    <button type="button" className="workbench-flow-reset" onClick={resetWorkbench} aria-label="重置工作台">
                                        <RotateCcw />
                                        <span>重置</span>
                                    </button>
                                </Tooltip>
                            </div>

                            <Modal title="选择创作工具" open={toolLibraryOpen} onCancel={() => setToolLibraryOpen(false)} footer={null} width="min(1120px, calc(100vw - 32px))" className="workbench-picker-modal">
                                {toolLibrary}
                            </Modal>

                            {!tool && quickTools.length ? (
                                <div className="workbench-quick-tools" aria-label="快速选择出品目标">
                                    <div className="workbench-quick-tools-list">
                                        {quickTools.map((item) => (
                                            <button key={item.id} type="button" className="workbench-quick-tool-chip" title={item.name} onClick={() => chooseTool(item)}>
                                                <span>{item.name}</span>
                                            </button>
                                        ))}
                                        <button type="button" className="workbench-quick-tool-more" onClick={() => setToolLibraryOpen(true)}>
                                            <span>更多</span>
                                            <ChevronDown className="-rotate-90 size-3" />
                                        </button>
                                    </div>
                                </div>
                            ) : null}

                            {tool ? (
                                <div className="workbench-tool-inline-guide" aria-label="当前工具说明">
                                    <span className="workbench-tool-inline-summary">{tool.inputHint || tool.description || tool.subtitle || `已启用「${tool.name}」场景配置`}</span>
                                    {hasToolGuideDetails ? (
                                        <Popover trigger="click" placement="bottomRight" content={toolGuidePopoverContent}>
                                            <button type="button" className="workbench-tool-inline-more">
                                                <BookOpen className="size-3.5" />
                                                <span>创作指南</span>
                                            </button>
                                        </Popover>
                                    ) : null}
                                </div>
                            ) : null}

                            <div className="workbench-studio">
                                {tool?.presets.length ? (
                                    <div className="workbench-preset-row" role="group" aria-label="工具提示词模板">
                                        {tool.presets.slice(0, 5).map((item) => (
                                            <button
                                                type="button"
                                                key={item.id}
                                                className={`workbench-preset-chip ${preset?.id === item.id ? "is-active" : ""}`}
                                                aria-pressed={preset?.id === item.id}
                                                title={item.summary || item.name}
                                                onClick={() => choosePreset(item)}
                                            >
                                                {item.name}
                                            </button>
                                        ))}
                                    </div>
                                ) : null}

                                <div className="workbench-prompt-surface">
                                    <CanvasResourceMentionTextarea
                                        aria-label="生成提示词，可输入 @ 引用参考素材"
                                        className="workbench-prompt-input workbench-prompt-rich-editor"
                                        containerClassName="workbench-prompt-mention-container"
                                        value={prompt}
                                        references={promptReferences}
                                        onChange={setPrompt}
                                        onSubmit={() => void submit()}
                                        sendOnEnter={false}
                                        style={{ color: "var(--wb-text)" }}
                                        placeholder={kind === "image" ? "描述画面主体、场景、光影与风格，输入 @ 可引用参考素材" : "描述镜头动作、运镜节奏与光影氛围，输入 @ 可引用参考素材"}
                                        maxLength={kind === "image" ? imageProfile?.references.promptMaxChars || 32000 : videoProfile?.references.promptMaxChars || 8000}
                                    />
                                    <div className="workbench-prompt-meta">
                                        <span>
                                            {prompt.length} / {kind === "image" ? imageProfile?.references.promptMaxChars || 32000 : videoProfile?.references.promptMaxChars || 8000}
                                        </span>
                                        <span>⌘ / Ctrl + Enter</span>
                                    </div>
                                </div>

                                <div className="workbench-reference-section">
                                    <div className="workbench-composer-toolbar">
                                        <span className="workbench-ref-count">
                                            参考素材 {references.length} / {maxReferenceCount}
                                        </span>
                                        <div className="workbench-toolbar-actions">
                                            <Tooltip title="添加参考素材">
                                                <button
                                                    type="button"
                                                    aria-label="添加参考素材"
                                                    onClick={() => {
                                                        setUploadSlotKey(undefined);
                                                        fileRef.current?.click();
                                                    }}
                                                >
                                                    <Upload />
                                                    <span>上传</span>
                                                </button>
                                            </Tooltip>
                                            {references.length ? (
                                                <Tooltip title="清空参考素材">
                                                    <button type="button" aria-label="清空参考素材" onClick={() => references.forEach(removeReference)}>
                                                        <X />
                                                    </button>
                                                </Tooltip>
                                            ) : null}
                                        </div>
                                    </div>

                                    {tool?.inputContract?.slots.length ? (
                                        <div className="workbench-reference-slots">
                                            {tool.inputContract.slots.map((slot) => {
                                                const slotReferences = references.filter((reference) => reference.slotKey === slot.key);
                                                const mediaLabel = slot.mediaTypes.map((type) => (type === "image" ? "图片" : type === "video" ? "视频" : "音频")).join(" / ");
                                                const openSlotPicker = () => {
                                                    setUploadSlotKey(slot.key);
                                                    fileRef.current?.click();
                                                };
                                                return (
                                                    <section className="workbench-reference-slot" key={slot.key}>
                                                        <div className="workbench-reference-slot-heading">
                                                            <div className="workbench-reference-slot-copy">
                                                                <div className="workbench-reference-slot-title">
                                                                    <strong>{slot.name || "参考素材"}</strong>
                                                                    <span className={`workbench-reference-slot-requirement${slot.required ? " is-required" : ""}`}>{slot.required ? "必填" : "可选"}</span>
                                                                </div>
                                                                <div className="workbench-reference-slot-meta">
                                                                    <span>
                                                                        {slot.minCount}-{slot.maxCount} 个
                                                                    </span>
                                                                    <span>{mediaLabel}</span>
                                                                </div>
                                                            </div>
                                                            {slotReferences.length ? (
                                                                <button type="button" className="workbench-slot-upload" onClick={openSlotPicker} aria-label={`为${slot.name}添加素材`} disabled={slotReferences.length >= slot.maxCount}>
                                                                    <ImagePlus /> <span>添加</span>
                                                                </button>
                                                            ) : null}
                                                        </div>
                                                        <div className="workbench-reference-grid">
                                                            {slotReferences.map((reference) => (
                                                                <ReferenceCard
                                                                    key={reference.id}
                                                                    reference={reference}
                                                                    kind={kind}
                                                                    onRemove={removeReference}
                                                                    onRoleChange={(role) => setReferences((current) => current.map((item) => (item.id === reference.id ? { ...item, role } : item)))}
                                                                />
                                                            ))}
                                                            {!slotReferences.length ? (
                                                                <button type="button" className="workbench-reference-slot-empty" onClick={openSlotPicker} disabled={slotReferences.length >= slot.maxCount}>
                                                                    <span className="workbench-reference-slot-empty-icon">
                                                                        <ImagePlus />
                                                                    </span>
                                                                    <span className="workbench-reference-slot-empty-copy">
                                                                        <strong>上传{slot.name || "参考"}素材</strong>
                                                                        <small>从设备中选择文件</small>
                                                                    </span>
                                                                </button>
                                                            ) : null}
                                                        </div>
                                                    </section>
                                                );
                                            })}
                                        </div>
                                    ) : references.length ? (
                                        <div className="workbench-reference-grid">
                                            {references.map((reference) => (
                                                <ReferenceCard
                                                    key={reference.id}
                                                    reference={reference}
                                                    kind={kind}
                                                    onRemove={removeReference}
                                                    onRoleChange={(role) => setReferences((current) => current.map((item) => (item.id === reference.id ? { ...item, role } : item)))}
                                                />
                                            ))}
                                            {!maxReferenceCount || references.length < maxReferenceCount ? (
                                                <button
                                                    type="button"
                                                    className="workbench-reference-add"
                                                    onClick={() => {
                                                        setUploadSlotKey(undefined);
                                                        fileRef.current?.click();
                                                    }}
                                                >
                                                    <ImagePlus />
                                                    <span>添加{kind === "image" ? "参考图" : "参考素材"}</span>
                                                </button>
                                            ) : null}
                                        </div>
                                    ) : null}
                                </div>

                                <input
                                    ref={fileRef}
                                    type="file"
                                    className="sr-only"
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
                                        if (event.target.files) void addFiles(event.target.files, uploadSlotKey);
                                        event.currentTarget.value = "";
                                    }}
                                />

                                <section className="workbench-parameters" aria-label="生成参数">
                                    <header>
                                        <strong>{kind === "image" ? "图片参数" : "视频参数"}</strong>
                                    </header>
                                    {selectedModel ? settingsPanel : <p className="workbench-list-empty">先选择模型，再调整尺寸、数量或时长。</p>}
                                </section>
                            </div>

                            <div className="workbench-composer-dock" aria-label="生成设置">
                                {models.length ? (
                                    <ModelPicker
                                        config={config}
                                        value={selectedModel}
                                        capability={capability}
                                        requirements={quoteRequirements}
                                        variant="creation"
                                        fullWidth
                                        className="creation-model-picker workbench-model-picker"
                                        showSelectedPrice={false}
                                        showOptionPrices
                                        onChange={(value) => {
                                            if (kind === "image") updateConfig("imageModel", value);
                                            else updateConfig("videoModel", value);
                                            updateConfig("model", value);
                                        }}
                                        placeholder={`选择${kind === "image" ? "图片" : "视频"}模型`}
                                    />
                                ) : (
                                    <div className="workbench-model-empty">
                                        <span>暂无可用的{kind === "image" ? "图片" : "视频"}模型</span>
                                        <a href="/settings?section=models" target="_blank" rel="noreferrer">
                                            模型设置
                                        </a>
                                    </div>
                                )}
                                <div className="workbench-composer-dock-submit">
                                    {estimateLabel ? (
                                        <div className="workbench-submit-estimate" aria-live="polite">
                                            <span className="workbench-submit-estimate-label">{estimateLabel}</span>
                                        </div>
                                    ) : null}
                                    <Button
                                        className="workbench-submit"
                                        type="primary"
                                        loading={busy}
                                        disabled={(promptRequired && !prompt.trim()) || Boolean(missingInput) || !selectedModel || references.some((reference) => reference.uploading || Boolean(reference.error))}
                                        onClick={() => void submit()}
                                    >
                                        <ArrowUp />
                                        <span>{kind === "image" ? "生成图片" : "生成视频"}</span>
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </section>

                    <section className={`workbench-result-column ${mobileTab === "result" ? "is-mobile-active" : ""}`} aria-label="生成结果">
                        <div className="workbench-result-stage">
                            <div className="workbench-section-heading">
                                <div>
                                    <h2>生成结果</h2>
                                    <span>
                                        {resultTask
                                            ? `${taskModelLabel(resultTask)} · ${displayTaskState(resultTask)}${resultUrls.length > 1 ? ` · 共 ${resultUrls.length} 张（第 ${Math.min(stageMediaIndex + 1, resultUrls.length)} 张）` : ""}`
                                            : "作品会在这里呈现"}
                                    </span>
                                </div>
                                <div className="workbench-stage-actions">
                                    {resultTask?.status === "running" || resultTask?.status === "queued" ? <LoaderCircle className="size-4 animate-spin text-foreground/45" /> : null}
                                    {resultTask ? (
                                        <>
                                            <Button size="small" onClick={() => void restoreTaskToComposer(resultTask)}>
                                                载入参数
                                            </Button>
                                            <Button size="small" icon={<Expand className="size-3.5" />} onClick={() => void openDetail(resultTask)}>
                                                查看详情
                                            </Button>
                                        </>
                                    ) : null}
                                </div>
                            </div>
                            {!resultTask ? (
                                <div className="workbench-empty-result">
                                    <div className="workbench-stage-frame" aria-hidden>
                                        <span className="workbench-viewfinder-corner is-tl" />
                                        <span className="workbench-viewfinder-corner is-tr" />
                                        <span className="workbench-viewfinder-corner is-bl" />
                                        <span className="workbench-viewfinder-corner is-br" />
                                        <div className="workbench-stage-hud-top">
                                            <span className="workbench-stage-hud-badge">
                                                <i />
                                                {kind === "image" ? "IMAGE CANVAS" : "VIDEO STAGE"}
                                            </span>
                                            <span className="workbench-stage-hud-spec">
                                                {ratio === "adaptive" ? "自适应" : ratio} · {kind === "image" ? `${selectedCount} 张` : `${seconds}s · ${videoQuality}P`}
                                            </span>
                                        </div>
                                        <div className="workbench-stage-illustration">
                                            {kind === "image" ? (
                                                <svg viewBox="0 0 160 120" fill="none" className="workbench-stage-svg">
                                                    <rect x="20" y="22" width="88" height="68" rx="10" className="wb-illust-card-back" />
                                                    <rect x="42" y="28" width="96" height="72" rx="12" className="wb-illust-card-front" />
                                                    <circle cx="70" cy="52" r="8" className="wb-illust-sun" />
                                                    <path d="M52 88L76 64L94 80L110 66L128 88H52Z" className="wb-illust-mountain" />
                                                    <g className="wb-illust-sparkle">
                                                        <rect x="116" y="14" width="28" height="28" rx="9" className="wb-illust-badge" />
                                                        <path d="M130 21L131.8 26.2L137 28L131.8 29.8L130 35L128.2 29.8L123 28L128.2 26.2L130 21Z" fill="currentColor" />
                                                    </g>
                                                </svg>
                                            ) : (
                                                <svg viewBox="0 0 160 120" fill="none" className="workbench-stage-svg">
                                                    <rect x="18" y="24" width="124" height="72" rx="12" className="wb-illust-card-front" />
                                                    <line x1="32" y1="24" x2="32" y2="96" className="wb-illust-film-line" />
                                                    <line x1="128" y1="24" x2="128" y2="96" className="wb-illust-film-line" />
                                                    <circle cx="80" cy="60" r="18" className="wb-illust-play-ring" />
                                                    <path d="M76 52L90 60L76 68V52Z" className="wb-illust-play-icon" />
                                                    <g className="wb-illust-sparkle">
                                                        <rect x="120" y="12" width="28" height="28" rx="9" className="wb-illust-badge" />
                                                        <path d="M134 19L135.8 24.2L141 26L135.8 27.8L134 33L132.2 27.8L127 26L132.2 24.2L134 19Z" fill="currentColor" />
                                                    </g>
                                                </svg>
                                            )}
                                        </div>
                                        <div className="workbench-stage-hud-bottom">
                                            <span className="workbench-stage-grid-ticks" />
                                            <span>{selectedModel ? modelDisplayName(config, selectedModel) : "待选择模型"}</span>
                                        </div>
                                    </div>
                                    <div className="workbench-empty-copy">
                                        <strong>{tool ? `已就绪 · ${tool.name}` : kind === "image" ? "等待生成图片作品" : "等待生成视频作品"}</strong>
                                        <span>{kind === "image" ? "在左侧输入画面描述并确认参数，生成结果将在此呈现" : "在左侧输入镜头描述或上传参考帧，生成后可直接预览播放"}</span>
                                    </div>
                                    <div className="workbench-empty-tags" aria-hidden>
                                        {kind === "image" ? (
                                            <>
                                                <span>@ 引用参考图</span>
                                                <span>多画幅比例</span>
                                                <span>高清原图预览</span>
                                            </>
                                        ) : (
                                            <>
                                                <span>首尾帧控制</span>
                                                <span>多时长画幅</span>
                                                <span>沉浸式播放</span>
                                            </>
                                        )}
                                    </div>
                                </div>
                            ) : resultTask.status === "queued" || resultTask.status === "running" ? (
                                <div className="workbench-generating">
                                    <div className="workbench-flow-skeleton">
                                        <span />
                                        <span />
                                        <span />
                                    </div>
                                    <strong>{displayTaskState(resultTask)}</strong>
                                    <span>正在生成画面，完成后将自动呈现结果</span>
                                    <Progress percent={resultTask.progress || 8} showInfo={false} />
                                    <Button size="small" loading={taskBusyId === resultTask.id} onClick={() => void cancelTask(resultTask)}>
                                        取消任务
                                    </Button>
                                </div>
                            ) : resultTask.status === "succeeded" && activeStageUrl ? (
                                <div className="workbench-result-media">
                                    {resultTask.previewKind === "video" || kind === "video" ? (
                                        <video src={activeStageUrl} controls playsInline />
                                    ) : (
                                        <MediaPreview src={activeStageUrl} kind="image" alt="生成结果" className="size-full object-contain" fallbackLabel="结果暂不可用" />
                                    )}
                                    {resultUrls.length > 1 ? (
                                        <div className="workbench-result-thumbs" role="tablist" aria-label="多图结果切换">
                                            {resultUrls.map((url, index) => (
                                                <button
                                                    key={`${index}:${url}`}
                                                    type="button"
                                                    role="tab"
                                                    aria-selected={stageMediaIndex === index}
                                                    aria-label={`查看第 ${index + 1} 张图片`}
                                                    className={`workbench-result-thumb ${stageMediaIndex === index ? "is-active" : ""}`}
                                                    onClick={() => setStageMediaIndex(index)}
                                                >
                                                    <MediaPreview src={url} kind="image" alt={`第 ${index + 1} 张`} className="size-full object-cover" />
                                                    <span>{index + 1}</span>
                                                </button>
                                            ))}
                                        </div>
                                    ) : null}
                                    {resultTask.prompt ? (
                                        <div className="workbench-result-caption">
                                            <span className="truncate" title={resultTask.prompt}>
                                                {resultTask.prompt}
                                            </span>
                                        </div>
                                    ) : null}
                                </div>
                            ) : (
                                <div className="workbench-result-error">
                                    <span>{displayTaskState(resultTask)}</span>
                                    <div className="flex items-center gap-2">
                                        <Button onClick={() => void openDetail(resultTask)}>查看任务详情</Button>
                                        <Button type="primary" loading={taskBusyId === resultTask.id} onClick={() => void retryTask(resultTask)}>
                                            重新生成
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </section>

                    <aside className={`workbench-task-column ${mobileTab === "tasks" ? "is-mobile-active" : ""}`} aria-label="生成记录">
                        <section className="workbench-history-panel">
                            <div className="workbench-section-heading">
                                <div>
                                    <h2>生成记录</h2>
                                    <span>{activeTasks.length ? `${activeTasks.length} 个进行中 · ${historyTasks.length} 条历史` : `${historyTasks.length} 条记录`}</span>
                                </div>
                                <Tooltip title="刷新记录">
                                    <button type="button" aria-label="刷新任务列表" onClick={() => void loadTasks()}>
                                        <RefreshCw className={tasksLoading ? "animate-spin" : ""} />
                                    </button>
                                </Tooltip>
                            </div>
                            <Input aria-label="搜索历史任务" prefix={<Search className="size-3.5" />} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索提示词" allowClear />

                            <div className="workbench-task-list">
                                {activeTasks.length ? (
                                    <div className="workbench-task-group">
                                        <div className="workbench-task-group-title">
                                            <LoaderCircle className="size-3 animate-spin" />
                                            <span>进行中 ({activeTasks.length})</span>
                                        </div>
                                        {activeTasks.map((task) => (
                                            <TaskRow
                                                key={task.id}
                                                task={task}
                                                kind={kind}
                                                selected={resultTask?.id === task.id}
                                                modelLabel={taskModelLabel(task)}
                                                busy={taskBusyId === task.id}
                                                onSelect={() => {
                                                    setResultHidden(false);
                                                    setActiveTask(task);
                                                }}
                                                onOpenDetail={() => void openDetail(task)}
                                                onCancel={() => void cancelTask(task)}
                                            />
                                        ))}
                                    </div>
                                ) : null}

                                {tasksLoading ? (
                                    <div className="py-6 text-center">
                                        <Spin size="small" />
                                    </div>
                                ) : (
                                    filteredHistoryTasks.map((task) => (
                                        <TaskRow
                                            key={task.id}
                                            task={task}
                                            kind={kind}
                                            selected={resultTask?.id === task.id}
                                            modelLabel={taskModelLabel(task)}
                                            busy={taskBusyId === task.id}
                                            onSelect={() => {
                                                setResultHidden(false);
                                                setActiveTask(task);
                                            }}
                                            onOpenDetail={() => void openDetail(task)}
                                            onRetry={() => void retryTask(task)}
                                        />
                                    ))
                                )}
                                {!tasksLoading && !activeTasks.length && !filteredHistoryTasks.length ? <p className="workbench-list-empty">{query.trim() ? "没有找到匹配的任务记录" : "生成的作品记录会保留在这里"}</p> : null}
                            </div>
                        </section>
                    </aside>
                </section>
            </div>

            <Modal
                title={detailTask ? (detailTask.previewKind === "video" || kind === "video" ? "视频任务详情" : "图片任务详情") : "任务详情"}
                open={Boolean(detailTask)}
                onCancel={() => {
                    detailRequestRef.current += 1;
                    setDetailLoading(false);
                    setDetailTask(null);
                }}
                footer={null}
                width={960}
                className="workbench-detail-modal"
            >
                {detailTask ? (
                    <div className="workbench-detail-grid">
                        <div className="workbench-detail-media">
                            {activeDetailUrl ? (
                                detailTask.previewKind === "video" || kind === "video" ? (
                                    <video src={activeDetailUrl} controls playsInline />
                                ) : (
                                    <MediaPreview src={activeDetailUrl} kind="image" alt="生成结果" className="size-full object-contain" />
                                )
                            ) : (
                                <div className="workbench-guide-empty">{displayTaskState(detailTask)}</div>
                            )}
                            {detailUrls.length > 1 ? (
                                <div className="workbench-result-thumbs is-detail" role="tablist" aria-label="详情多图切换">
                                    {detailUrls.map((url, index) => (
                                        <button
                                            key={`${index}:${url}`}
                                            type="button"
                                            role="tab"
                                            aria-selected={detailMediaIndex === index}
                                            aria-label={`查看第 ${index + 1} 张图片`}
                                            className={`workbench-result-thumb ${detailMediaIndex === index ? "is-active" : ""}`}
                                            onClick={() => setDetailMediaIndex(index)}
                                        >
                                            <MediaPreview src={url} kind="image" alt={`第 ${index + 1} 张`} className="size-full object-cover" />
                                            <span>{index + 1}</span>
                                        </button>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                        <div className="workbench-detail-info">
                            <span className={`workbench-status is-${detailTask.status}`}>{displayTaskState(detailTask)}</span>
                            <h3>{taskModelLabel(detailTask)}</h3>
                            <label>提示词</label>
                            <p className="workbench-detail-prompt">{detailTask.prompt}</p>
                            <label>参数</label>
                            <pre>{detailLoading ? "正在加载任务参数…" : JSON.stringify(workbenchTaskSnapshot(detailTask)?.parameters || {}, null, 2)}</pre>
                            <dl>
                                <div>
                                    <dt>耗时</dt>
                                    <dd>{elapsedLabel(detailTask)}</dd>
                                </div>
                                <div>
                                    <dt>积分</dt>
                                    <dd>{detailTask.billing ? `${formatCredits(detailTask.billing.amountMicrocredits)} · ${detailTask.billing.status}` : "--"}</dd>
                                </div>
                                <div>
                                    <dt>创建时间</dt>
                                    <dd>{new Date(detailTask.createdAt).toLocaleString()}</dd>
                                </div>
                            </dl>
                            <div className="workbench-detail-actions">
                                <Button disabled={detailLoading} onClick={() => void restoreTaskToComposer(detailTask)}>
                                    载入到编辑器
                                </Button>
                                {detailTask.status === "failed" || detailTask.status === "cancelled" ? (
                                    <Button type="primary" loading={taskBusyId === detailTask.id} disabled={detailLoading} onClick={() => void retryTask(detailTask)}>
                                        重新生成
                                    </Button>
                                ) : null}
                            </div>
                        </div>
                    </div>
                ) : null}
            </Modal>

            <Modal
                title="提示词已有内容"
                open={Boolean(presetPending)}
                onCancel={() => setPresetPending(null)}
                footer={[
                    <Button key="cancel" onClick={() => setPresetPending(null)}>
                        返回
                    </Button>,
                    <Button key="append" onClick={() => applyPreset("append")}>
                        追加
                    </Button>,
                    <Button key="replace" type="primary" onClick={() => applyPreset("replace")}>
                        替换
                    </Button>,
                ]}
            >
                {presetPending ? <p>将应用“{presetPending.name}”提示词。你可以替换当前内容，也可以追加到末尾。</p> : null}
            </Modal>
        </WorkspacePage>
    );
}

function CountPicker({ value, max, onChange }: { value: string; max: number; onChange: (value: string) => void }) {
    const limit = Math.max(1, max || 15);
    const current = Math.min(limit, Math.max(1, Math.floor(Number(value) || 1)));
    const isSelected = current >= 4;
    const [draftValue, setDraftValue] = useState(() => (current >= 4 ? String(current) : "4"));

    useEffect(() => {
        if (current >= 4) {
            setDraftValue(String(current));
        }
    }, [current]);

    const handleSelectStepper = () => {
        const num = Math.max(1, Math.min(limit, parseInt(draftValue, 10) || 4));
        onChange(String(num));
    };

    const handleStepUp = (e: React.MouseEvent) => {
        e.stopPropagation();
        const base = current >= 4 ? current : parseInt(draftValue, 10) || 4;
        const next = Math.min(limit, base + 1);
        setDraftValue(String(next));
        onChange(String(next));
    };

    const handleStepDown = (e: React.MouseEvent) => {
        e.stopPropagation();
        const base = current >= 4 ? current : parseInt(draftValue, 10) || 4;
        const next = Math.max(1, base - 1);
        setDraftValue(String(next));
        onChange(String(next));
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setDraftValue(e.target.value);
    };

    const handleInputBlur = (e: React.FocusEvent<HTMLInputElement>) => {
        const num = Math.max(1, Math.min(limit, parseInt(e.target.value, 10) || 4));
        setDraftValue(String(num));
        onChange(String(num));
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            e.currentTarget.blur();
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            const base = current >= 4 ? current : parseInt(draftValue, 10) || 4;
            const next = Math.min(limit, base + 1);
            setDraftValue(String(next));
            onChange(String(next));
        } else if (e.key === "ArrowDown") {
            e.preventDefault();
            const base = current >= 4 ? current : parseInt(draftValue, 10) || 4;
            const next = Math.max(1, base - 1);
            setDraftValue(String(next));
            onChange(String(next));
        }
    };

    return (
        <div className="workbench-count-picker">
            <span>生成张数</span>
            <div>
                {Array.from({ length: Math.min(3, limit) }, (_, index) => index + 1).map((item) => (
                    <button key={item} type="button" aria-pressed={current === item} className={current === item ? "is-active" : ""} onClick={() => onChange(String(item))}>
                        {item}
                    </button>
                ))}
                {limit >= 4 ? (
                    <div className={`workbench-count-stepper ${isSelected ? "is-active" : ""}`} onClick={handleSelectStepper}>
                        <input
                            type="text"
                            inputMode="numeric"
                            aria-label="自定义生成张数"
                            value={draftValue}
                            onChange={handleInputChange}
                            onBlur={handleInputBlur}
                            onKeyDown={handleKeyDown}
                            onFocus={(e) => {
                                e.currentTarget.select();
                                if (current < 4) {
                                    handleSelectStepper();
                                }
                            }}
                        />
                        <div className="workbench-count-stepper-controls">
                            <button type="button" tabIndex={-1} onClick={handleStepUp} disabled={current >= limit && isSelected} className="workbench-count-stepper-btn" title="增加 1 张" aria-label="增加 1 张">
                                <ChevronUp className="size-2.5" />
                            </button>
                            <button type="button" tabIndex={-1} onClick={handleStepDown} disabled={current <= 1 && isSelected} className="workbench-count-stepper-btn" title="减少 1 张" aria-label="减少 1 张">
                                <ChevronDown className="size-2.5" />
                            </button>
                        </div>
                    </div>
                ) : null}
            </div>
        </div>
    );
}

function ParameterChips({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
    if (options.length > 7) {
        return (
            <label className="workbench-setting-row">
                <span>{label}</span>
                <Select aria-label={label} value={value} onChange={onChange} options={options} />
            </label>
        );
    }
    return (
        <div className="workbench-chip-field">
            <span>{label}</span>
            <div role="radiogroup" aria-label={label}>
                {options.map((option) => (
                    <button key={option.value} type="button" role="radio" aria-checked={value === option.value} className={value === option.value ? "is-active" : ""} onClick={() => onChange(option.value)}>
                        {option.label}
                    </button>
                ))}
            </div>
        </div>
    );
}

function ToolCard({ tool, selected, onClick }: { tool: WorkbenchTool; selected: boolean; onClick: () => void }) {
    const visual = toolVisual(tool, tool.kind);
    const subtitle = isModelIdLike(tool.subtitle) ? tool.description || "" : tool.subtitle || tool.description;
    return (
        <button type="button" className={`workbench-tool-card ${selected ? "is-selected" : ""} is-${visual.tone}`} aria-pressed={selected} onClick={onClick}>
            <SpotlightSurface className="workbench-tool-card-spotlight" contentClassName="workbench-tool-card-surface relative z-[1]" spotlightColor="color-mix(in srgb, var(--user-ink) 5%, transparent)">
                <span className="workbench-tool-card-image">{tool.coverUrl || tool.iconUrl ? <img src={tool.coverUrl || tool.iconUrl} alt="" /> : visual.icon}</span>
                <span className="workbench-tool-card-copy">
                    <strong>{tool.name}</strong>
                    <small>{subtitle}</small>
                </span>
                {selected ? (
                    <span className="workbench-tool-check">
                        <Check />
                    </span>
                ) : null}
            </SpotlightSurface>
        </button>
    );
}

function ReferenceCard({ reference, kind, onRemove, onRoleChange }: { reference: WorkbenchReference; kind: WorkbenchKind; onRemove: (reference: WorkbenchReference) => void; onRoleChange: (role: WorkbenchReference["role"]) => void }) {
    return (
        <div className="workbench-reference">
            {reference.kind === "video" ? (
                <video src={reference.previewUrl} muted />
            ) : reference.kind === "audio" ? (
                <span className="workbench-audio-reference">
                    <Mic />
                </span>
            ) : (
                <img src={reference.previewUrl} alt={reference.name} />
            )}
            {reference.uploading ? <Progress type="circle" percent={Math.round(reference.progress)} size={34} /> : null}
            {reference.error ? (
                <span className="workbench-reference-error" title={reference.error}>
                    上传失败
                </span>
            ) : null}
            <button type="button" aria-label={`移除${reference.name}`} onClick={() => onRemove(reference)}>
                <X />
            </button>
            {kind === "video" && reference.kind === "image" && !reference.slotKey ? (
                <Select
                    size="small"
                    value={reference.role}
                    onChange={onRoleChange}
                    options={[
                        { label: "参考图", value: "reference" },
                        { label: "首帧", value: "first_frame" },
                        { label: "尾帧", value: "last_frame" },
                    ]}
                />
            ) : null}
        </div>
    );
}

function TaskRow({
    task,
    kind,
    selected,
    modelLabel,
    busy,
    onSelect,
    onOpenDetail,
    onCancel,
    onRetry,
}: {
    task: GenerationTask;
    kind: WorkbenchKind;
    selected?: boolean;
    modelLabel: string;
    busy: boolean;
    onSelect: () => void;
    onOpenDetail: () => void;
    onCancel?: () => void;
    onRetry?: () => void;
}) {
    const url = taskPreview(task);
    return (
        <article className={`workbench-task-row ${selected ? "is-selected" : ""}`}>
            <button type="button" className="workbench-task-main" onClick={onSelect} onDoubleClick={onOpenDetail}>
                <span className="workbench-task-thumb">{url && task.previewKind !== "video" ? <MediaPreview src={url} kind="image" alt="" className="size-full object-cover" /> : kind === "video" ? <Video /> : <FileImage />}</span>
                <span className="workbench-task-copy">
                    <strong>{modelLabel}</strong>
                    <small>{task.prompt || "无提示词任务"}</small>
                    <em>
                        {displayTaskState(task)}
                        {elapsedLabel(task) ? ` · ${elapsedLabel(task)}` : ""}
                    </em>
                </span>
            </button>
            <Tooltip title="查看任务详情">
                <Button type="text" aria-label="查看任务详情" icon={<Expand className="size-3.5" />} onClick={onOpenDetail} />
            </Tooltip>
            {onCancel ? (
                <Tooltip title="取消任务">
                    <Button type="text" aria-label="取消任务" icon={<X className="size-3.5" />} loading={busy} onClick={onCancel} />
                </Tooltip>
            ) : null}
            {onRetry ? (
                <Tooltip title="重试任务">
                    <Button type="text" aria-label="重试任务" icon={busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} disabled={busy} onClick={onRetry} />
                </Tooltip>
            ) : null}
        </article>
    );
}

export default function ImageWorkbenchPage() {
    return <WorkbenchPage kind="image" />;
}

export function VideoWorkbenchPage() {
    return <WorkbenchPage kind="video" />;
}
