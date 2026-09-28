import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { App, Spin } from "antd";
import { Tooltip } from "@/components/ui/base/tooltip";
import { History, Sparkles, Maximize2 } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useNavigate } from "react-router";

import type { AssetLibraryPickerItem } from "@/components/assets/asset-library-picker-modal";
import { generationErrorCode, generationErrorMessage } from "@/lib/generation-error";
import { creationResultAssetIds } from "@/lib/canvas/canvas-asset-handoff";
import { getActiveUserScope } from "@/lib/user-scope";
import { continueCreationConversationOnCanvas } from "@/services/creation-canvas-conversation";
import { useExternalAssetSources } from "@/hooks/use-external-asset-sources";
import { modelCapabilityConfigFor, normalizeImageValue, normalizeVideoValue, videoDurationAllowed, videoDurationOptions } from "@/lib/model-capabilities";
import { inferVideoOperation, modelGroupReferenceLimits, resolveCompatibleModel, mergedImageCapabilityConfig, type ModelRequirements } from "@/lib/model-selection";
import type { BackendGenerationResult } from "@/services/api/generation-task";
import type { Skill } from "@/services/api/skills";
import type { GenerationTask } from "@/services/api/task-center";
import { loadCreationConversations, pendingCreationTaskIds, removeCreationConversationSnapshot, saveCreationConversations, updateCreationConversationSnapshot } from "@/services/creation-conversation-store";
import { resolveModelChannel, selectableModelsByCapability, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useCreationPreferencesStore } from "@/stores/use-creation-preferences-store";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { cn } from "@/lib/utils";
import { useUserStore } from "@/stores/use-user-store";
import type { PromptOptimizerProvider } from "@/lib/plugins/plugin-types";
import { promptOptimizerPlugin, PROMPT_OPTIMIZER_PLUGIN_ID } from "@/lib/plugins/builtin/prompt-optimizer";
import { createPluginHostContext } from "@/services/plugin-host";
import { usePluginStore } from "@/stores/use-plugin-store";
import { buildCreationMentionReferences, expandCreationPrompt, reconcileCreationAttachmentLimit, reconcileCreationAttachmentLimits, removeCreationReferenceTokens, replaceCreationAttachmentReference, selectedCreationReferences, type CreationReference, type CreationReferenceLimits } from "./creation-references";
import { creationAttachmentFromAsset, creationAttachmentFromAudio, creationAttachmentFromAudioAsset, creationAttachmentFromDocument, creationAttachmentFromExternalAsset, creationAttachmentFromImage, creationAttachmentFromVideo, creationAttachmentFromVideoAsset, creationAttachmentKind, creationAudioAsset, creationFileAccepted, creationImageAsset, creationMediaAspectRatio, creationUploadAccept, creationVideoAsset, removeCreationAttachment, splitCreationAttachments, type CreationAttachment } from "./creation-assets";
import { defaultCreationMode, modeLabels, type CreationConversation, type CreationMessage, type CreationMode, type CreationRetryContext, type CreationSettings, type CreationShotRailEntry, type CreationStatus } from "./creation-types";
import { attachCreationTaskContexts, completedCreationGenerationTask, conversationTimestamp, creationShotRail, creationVideoShotOrdinal, isImageAttachment, isVideoAttachment, materializeCreationTaskResults, newConversation, newMessage, reconcileCreationTaskMessages } from "./creation-conversations";
import { CreationComposer, CreationEmptySuggest, CreationFeaturedWorks, CreationHistoryDrawer, CreationMessageView, CreationModeTabs, CreationWorkspaceToolbar, creationAssetCategoryLabels } from "./creation-workspace";
import { CreationAgentEntry } from "./creation-agent-entry";
import { createCreationSubmitGate } from "./creation-submit-gate";
import { creationVideoConfig } from "./creation-generation-config";

const AssetLibraryPickerModal = lazy(() => import("@/components/assets/asset-library-picker-modal").then((module) => ({ default: module.AssetLibraryPickerModal })));
const loadCreationRuntime = () => import("./creation-runtime");
type CreationRuntime = Awaited<ReturnType<typeof loadCreationRuntime>>;

const TEXT_STREAMING_PREF_KEY = "creation.composer.text-streaming";
const TEXT_THINKING_PREF_KEY = "creation.composer.text-thinking";

function creationLibraryDisabledReason(mode: CreationMode, kind: string | undefined, videoLimits?: CreationReferenceLimits) {
    if (!kind) return undefined;
    if (mode === "image") return kind === "image" ? undefined : "图片创作仅支持参考图";
    if (mode !== "video") return undefined;

    const maximum = kind === "image" ? videoLimits?.maxImages : kind === "video" ? videoLimits?.maxVideos : kind === "audio" ? videoLimits?.maxAudios : 0;
    if ((maximum || 0) > 0) return undefined;
    const label = kind === "video" ? "视频" : kind === "audio" ? "音频" : kind === "image" ? "图片" : "此类素材";
    return `当前视频模型不支持参考${label}`;
}

function readComposerPref(key: string, fallback: boolean): boolean {
    try {
        const stored = window.localStorage.getItem(key);
        return stored === null ? fallback : stored === "1";
    } catch {
        return fallback;
    }
}
function writeComposerPref(key: string, value: boolean) {
    try {
        window.localStorage.setItem(key, value ? "1" : "0");
    } catch {
        // 存储不可用（隐私模式/禁用）：仅当前会话生效，忽略
    }
}

export default function CreatePage() {
    const [agentMode, setAgentMode] = useState(false);
    const { message: toast, modal } = App.useApp();
    const navigate = useNavigate();
    const [openingCanvas, setOpeningCanvas] = useState(false);
    const openingCanvasRef = useRef(false);
    const brandName = useAppearanceStore((state) => state.appearance.brandName);
    const config = useEffectiveConfig();
    const composerPreferencesHydrated = useCreationPreferencesStore((state) => state.hydrated);
    const rememberMode = useCreationPreferencesStore((state) => state.rememberMode);
    const rememberImageSettings = useCreationPreferencesStore((state) => state.rememberImageSettings);
    const rememberVideoSettings = useCreationPreferencesStore((state) => state.rememberVideoSettings);
    const initialComposerPreferences = useCreationPreferencesStore.getState().preferences;
    const promptOptimizerInstallation = usePluginStore((state) => state.installations.find((item) => item.manifest.id === PROMPT_OPTIMIZER_PLUGIN_ID));
    const promptOptimizerEnabled = usePluginStore((state) => state.pluginStates[PROMPT_OPTIMIZER_PLUGIN_ID]?.effectiveEnabled ?? Boolean(state.installations.find((item) => item.manifest.id === PROMPT_OPTIMIZER_PLUGIN_ID)?.enabled));
    const promptOptimizerProvider = useMemo<PromptOptimizerProvider | null>(() => {
        if (!promptOptimizerEnabled || !promptOptimizerInstallation || !promptOptimizerPlugin.createPromptOptimizer) return null;
        return promptOptimizerPlugin.createPromptOptimizer(createPluginHostContext(promptOptimizerPlugin, promptOptimizerInstallation, config));
    }, [config, promptOptimizerEnabled, promptOptimizerInstallation]);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const assets = useAssetStore((state) => state.assets);
    const addAsset = useAssetStore((state) => state.addAsset);
    const [conversations, setConversations] = useState<CreationConversation[]>([]);
    const conversationsRef = useRef<CreationConversation[]>([]);
    const [activeId, setActiveId] = useState("");
    const activeIdRef = useRef("");
    const [hydrated, setHydrated] = useState(false);
    const [mode, setMode] = useState<CreationMode>(() => initialComposerPreferences.mode || defaultCreationMode);
    const [prompt, setPrompt] = useState("");
    const [attachments, setAttachments] = useState<CreationAttachment[]>([]);
    const promptRef = useRef(prompt);
    const attachmentsRef = useRef(attachments);
    const [draftReferences, setDraftReferences] = useState<CreationReference[]>([]);
    const [addedSkills, setAddedSkills] = useState<Skill[]>([]);
    const addedSkillsRequestedRef = useRef(false);
    const [ratio, setRatio] = useState("16:9");
    const [seconds, setSeconds] = useState("6");
    const [quality, setQuality] = useState("auto");
    const [videoQuality, setVideoQuality] = useState(config.vquality || "720");
    const [count, setCount] = useState(String(Math.max(1, Math.min(4, Number(config.count) || 1))));
    const [textStreaming, setTextStreaming] = useState(() => readComposerPref(TEXT_STREAMING_PREF_KEY, true));
    const [textThinking, setTextThinking] = useState(() => readComposerPref(TEXT_THINKING_PREF_KEY, false));
    const [busy, setBusy] = useState(false);
    const [referenceReplacementBusy, setReferenceReplacementBusy] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [libraryOpen, setLibraryOpen] = useState(false);
    const externalAssetSources = useExternalAssetSources(libraryOpen);
    const abortRef = useRef<AbortController | null>(null);
    const composerFocusRef = useRef<HTMLTextAreaElement>(null);
    const threadScrollRef = useRef<HTMLElement>(null);
    const launchpadRef = useRef<HTMLElement>(null);
    const reducedMotion = useReducedMotion();
    const [launchpadCondensed, setLaunchpadCondensed] = useState(false);
    const followLatestMessageRef = useRef(true);
    const taskSyncWarningRef = useRef(false);
    const activeGenerationTaskIdsRef = useRef(new Set<string>());
    const retryPreparingRef = useRef(new Set<string>());
    const submitGateRef = useRef(createCreationSubmitGate());
    const pendingRetryRef = useRef<{ context: CreationRetryContext; lockKey: string } | null>(null);
    const [retrySequence, setRetrySequence] = useState(0);
    const [composerPreferencesInitialized, setComposerPreferencesInitialized] = useState(false);
    promptRef.current = prompt;
    attachmentsRef.current = attachments;

    const activeConversation = useMemo(() => conversations.find((item) => item.id === activeId) || conversations[0], [activeId, conversations]);
    const historyConversations = useMemo(
        () => conversations.filter((conversation) => conversation.id === activeId || conversation.messages.length > 0).sort((left, right) => conversationTimestamp(right.updatedAt) - conversationTimestamp(left.updatedAt)),
        [activeId, conversations],
    );
    const preferredModel = mode === "text" ? config.textModel : mode === "image" ? config.imageModel : config.videoModel;
    const hasPrompt = Boolean(prompt.trim());
    const modelRequirements = useMemo<ModelRequirements>(() => ({
        capability: mode,
        input: {
            textCount: hasPrompt ? 1 : 0,
            imageCount: attachments.filter(isImageAttachment).length,
            videoCount: attachments.filter(isVideoAttachment).length,
            audioCount: attachments.filter((attachment) => creationAttachmentKind(attachment) === "audio").length,
            characterCount: 0,
        },
        videoSeconds: mode === "video" ? seconds : undefined,
        imageSize: mode === "image" ? ratio : undefined,
		options: mode === "image"
			? { size: ratio, quality, count: Number(count), transparentBackground: config.transparentBackground === "true" }
			: mode === "video"
				? { size: ratio, videoSeconds: Number(seconds), vquality: videoQuality }
				: {},
	}), [attachments, config.transparentBackground, count, hasPrompt, mode, quality, ratio, seconds, videoQuality]);
    const selectedModel = resolveCompatibleModel(config, preferredModel, modelRequirements) || preferredModel;
    const generationConfig = useMemo(() => mode === "video"
        ? creationVideoConfig(config, selectedModel, { ratio, seconds, videoQuality })
        : config, [config, mode, ratio, seconds, selectedModel, videoQuality]);
    const imageProfile = useMemo(() => modelCapabilityConfigFor(config, selectedModel).image!, [config, selectedModel]);
    const videoProfile = useMemo(() => modelCapabilityConfigFor(config, selectedModel).video!, [config, selectedModel]);
    // 同名逻辑模型可能把文生视频、图生视频和全模态参考拆到不同路由。
    // 入口需要展示整个模型组的引用能力，添加素材后再由兼容路由选择具体模型。
    const videoReferenceLimits = useMemo(() => mode === "video"
        ? modelGroupReferenceLimits(config, preferredModel || selectedModel, "video") || { maxImages: 0, maxVideos: 0, maxAudios: 0 }
        : undefined, [config, mode, preferredModel, selectedModel]);
    const maxReferences = mode === "video"
        ? (videoReferenceLimits?.maxImages || 0) + (videoReferenceLimits?.maxVideos || 0) + (videoReferenceLimits?.maxAudios || 0)
        : mode === "image" ? imageProfile.references.maxImages : 6;
    const referenceImageSize = useMemo(() => {
        const imageAttachments = attachments.filter(isImageAttachment);
        if (imageAttachments.length !== 1) return undefined;
        const { width, height } = imageAttachments[0];
        if (typeof width !== "number" || typeof height !== "number" || width <= 0 || height <= 0) return undefined;
        return { width, height };
    }, [attachments]);
    const mentionReferences = useMemo(() => buildCreationMentionReferences(addedSkills, attachments, draftReferences), [addedSkills, attachments, draftReferences]);
    const isEmpty = !activeConversation?.messages.length;

    // 空首页从顶部开始；有消息的对话由跟随消息逻辑管理滚动。
    useLayoutEffect(() => {
        if (!hydrated || !isEmpty) return;
        const frame = window.requestAnimationFrame(() => {
            threadScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
        });
        return () => window.cancelAnimationFrame(frame);
    }, [activeId, hydrated, isEmpty]);
    const pendingTaskIds = useMemo(() => pendingCreationTaskIds(conversations), [conversations]);
    const recoveryTaskKey = useMemo(() => pendingTaskIds.filter((id) => !activeGenerationTaskIdsRef.current.has(id)).join("|"), [pendingTaskIds]);
    const videoShots = useMemo(() => creationShotRail(activeConversation?.messages || []), [activeConversation]);
    const jumpToShot = (shot: CreationShotRailEntry) => { const id = shot.result?.id; if (id) document.getElementById(`creation-shot-${id}`)?.scrollIntoView({ block: "start", behavior: "smooth" }); };


    useEffect(() => {
        writeComposerPref(TEXT_STREAMING_PREF_KEY, textStreaming);
        writeComposerPref(TEXT_THINKING_PREF_KEY, textThinking);
    }, [textStreaming, textThinking]);
    useEffect(() => {
        if (!composerPreferencesHydrated || composerPreferencesInitialized) return;
        const saved = useCreationPreferencesStore.getState().preferences;
        const nextMode = saved.mode || defaultCreationMode;
        setMode(nextMode);
        if (nextMode === "image" && saved.image) {
            if (saved.image.ratio) setRatio(saved.image.ratio);
            if (saved.image.quality) setQuality(saved.image.quality);
            if (saved.image.count) setCount(saved.image.count);
        }
        if (nextMode === "video" && saved.video) {
            if (saved.video.ratio) setRatio(saved.video.ratio);
            if (saved.video.seconds) setSeconds(saved.video.seconds);
            if (saved.video.videoQuality) setVideoQuality(saved.video.videoQuality);
        }
        setComposerPreferencesInitialized(true);
    }, [composerPreferencesHydrated, composerPreferencesInitialized]);

    useEffect(() => {
        if (!composerPreferencesHydrated || !composerPreferencesInitialized || mode !== "image") return;
        const saved = useCreationPreferencesStore.getState().preferences.image;
        // 优先恢复用户上次选择；只有当前模型不支持该值时，normalizeImageValue 才回退到模型默认值。
        const normalized = normalizeImageValue(imageProfile, {
            size: saved?.ratio || imageProfile.size.default,
            quality: saved?.quality || imageProfile.quality.default,
            count: saved?.count || count,
        });
        setRatio(normalized.size);
        setQuality(normalized.quality);
        setCount(normalized.count);
    }, [composerPreferencesHydrated, composerPreferencesInitialized, mode, selectedModel, imageProfile]);

    useEffect(() => {
        if (!composerPreferencesHydrated || !composerPreferencesInitialized || mode !== "video") return;
        const saved = useCreationPreferencesStore.getState().preferences.video;
        // 优先恢复用户上次选择；只有当前模型不支持该值时，normalizeVideoValue 才回退到模型默认值。
        const normalized = normalizeVideoValue(videoProfile, {
            seconds: saved?.seconds || String(videoProfile.duration.default),
            ratio: saved?.ratio || videoProfile.defaultRatio,
            resolution: saved?.videoQuality || videoProfile.defaultResolution,
        });
        setSeconds(normalized.seconds);
        setRatio(normalized.ratio);
        setVideoQuality(normalized.resolution.replace(/p$/i, ""));
    }, [composerPreferencesHydrated, composerPreferencesInitialized, mode, selectedModel, videoProfile]);

    useEffect(() => {
        const reconciled = mode === "video" && videoReferenceLimits
            ? reconcileCreationAttachmentLimits(attachments, mentionReferences, videoReferenceLimits)
            : reconcileCreationAttachmentLimit(attachments, mentionReferences, maxReferences);
        if (reconciled.attachments === attachments) return;
        setAttachments(reconciled.attachments);
        if (reconciled.removedReferences.length) setPrompt((current) => removeCreationReferenceTokens(current, reconciled.removedReferences));
    }, [attachments, maxReferences, mentionReferences, mode, videoReferenceLimits]);

    useEffect(() => {
        let cancelled = false;
        void loadCreationConversations<CreationConversation>().then((stored) => {
            if (cancelled) return;
            const next = stored?.length ? stored : [newConversation()];
            conversationsRef.current = next;
            setConversations(next);
            setActiveId(next[0].id);
            setHydrated(true);
        });
        return () => {
            cancelled = true;
            // 页面卸载只停止当前页面的状态更新，后台任务由任务中心继续执行，返回页面后再恢复状态。
        };
    }, []);

    useEffect(() => () => abortRef.current?.abort(), []);

    useEffect(() => {
        activeIdRef.current = activeId;
    }, [activeId]);

    useEffect(() => {
        conversationsRef.current = conversations;
        if (hydrated) void saveCreationConversations(conversations);
    }, [conversations, hydrated]);

    useEffect(() => {
        if (!hydrated || !recoveryTaskKey || !pendingTaskIds.length) return;
        // 当前页面主动提交的任务由 submit 自己等待并收尾；恢复监听只接管刷新前遗留的任务，避免同一任务被双重轮询。
        const recoverableTaskIds = pendingTaskIds.filter((id) => !activeGenerationTaskIdsRef.current.has(id));
        if (!recoverableTaskIds.length) return;
        let cancelled = false;
        const observationController = new AbortController();
        const applyTasks = async (tasks: GenerationTask[]) => {
            const runtime = await loadCreationRuntime();
            const contextual = attachCreationTaskContexts(tasks, conversations);
            const persistedTasks = await materializeCreationTaskResults(runtime, contextual, observationController.signal);
            if (cancelled) return;
            taskSyncWarningRef.current = false;
            const attachable = persistedTasks.filter((task) => task.status === "succeeded" && Boolean(task.clientContext?.messageId) && Boolean(task.creationResultUrls?.length || task.creationResultStorageKeys?.length));
            for (const task of attachable) {
                try {
                    await runtime.consumeGenerationTaskMessage(task, task.clientContext!.messageId!, async ({ effectKey, resultUrls, resultStorageKeys }) => {
                        if (cancelled) return;
                        await updateConversationMessage(task.clientContext!.conversationId!, task.clientContext!.messageId!, (item) =>
                            runtime.applyGenerationConsumerEffect(item, effectKey, (current) => ({ ...current, status: "done" as const, ...(resultUrls.length ? { resultUrls: Array.from(new Set([...(current.resultUrls || []), ...resultUrls])) } : {}), ...(resultStorageKeys.length ? { resultStorageKeys: Array.from(new Set([...(current.resultStorageKeys || []), ...resultStorageKeys])) } : {}) })).value,
                        );
                    }, { signal: observationController.signal, materialize: async () => task, materializedUrls: runtime.generationTaskMaterializedUrls, materializedStorageKeys: runtime.generationTaskMaterializedStorageKeys });
                } catch (error) {
                    if (cancelled || observationController.signal.aborted) return;
                    console.warn("创作任务结果挂载失败，将使用已物化结果收敛消息状态", error);
                }
            }
            if (!cancelled) setConversations((current) => reconcileCreationTaskMessages(runtime, current, persistedTasks));
        };
        const warnSync = (error: unknown) => {
            if (cancelled || observationController.signal.aborted) return;
            console.warn("创作任务状态同步失败", error);
            if (!taskSyncWarningRef.current) {
                taskSyncWarningRef.current = true;
                toast.warning("任务状态暂时无法同步，请稍后刷新");
            }
        };
        let applyChain = Promise.resolve();
        let unsubscribe: () => void = () => {};
        void loadCreationRuntime()
            .then((runtime) => {
                if (cancelled) return;
                unsubscribe = runtime.subscribeGenerationTasks(recoverableTaskIds, (task) => {
                    applyChain = applyChain.then(() => applyTasks([task])).catch(warnSync);
                });
            })
            .catch(warnSync);
        return () => {
            cancelled = true;
            observationController.abort();
            unsubscribe();
        };
    }, [hydrated, recoveryTaskKey, toast]);

    const loadAddedSkills = useCallback(() => {
        if (addedSkillsRequestedRef.current) return;
        addedSkillsRequestedRef.current = true;
        void import("@/services/api/skills")
            .then(({ listAddedSkills }) => listAddedSkills())
            .then(({ skills }) => setAddedSkills(skills))
            .catch(() => setAddedSkills([]));
    }, []);

    useEffect(() => {
        if (isEmpty || !followLatestMessageRef.current) return;
        const frame = window.requestAnimationFrame(() => {
            const container = threadScrollRef.current;
            if (container) container.scrollTop = container.scrollHeight;
        });
        return () => window.cancelAnimationFrame(frame);
    }, [activeConversation?.id, activeConversation?.messages, isEmpty]);

    const updateActive = useCallback((updater: (conversation: CreationConversation) => CreationConversation) => {
        const next = updateCreationConversationSnapshot(conversationsRef.current, activeId, updater);
        conversationsRef.current = next;
        setConversations(next);
    }, [activeId]);

    const updateConversationMessage = useCallback(async (conversationId: string, id: string, updater: (item: CreationMessage) => CreationMessage) => {
        const next = updateCreationConversationSnapshot(conversationsRef.current, conversationId, (conversation) => ({
            ...conversation,
            updatedAt: new Date().toISOString(),
            messages: conversation.messages.map((item) => item.id === id ? updater(item) : item),
        }));
        conversationsRef.current = next;
        setConversations(next);
        await saveCreationConversations(next);
    }, []);

    const selectMode = (next: CreationMode) => {
        setMode(next);
        rememberMode(next);
        const nextModels = selectableModelsByCapability(config, next);
        const current = next === "text" ? config.textModel : next === "image" ? config.imageModel : config.videoModel;
        if (!nextModels.includes(current) && nextModels[0]) {
            updateConfig(next === "text" ? "textModel" : next === "image" ? "imageModel" : "videoModel", nextModels[0]);
        }
    };

    const setComposerRatio = (value: string) => {
        setRatio(value);
        if (mode === "image") rememberImageSettings({ ratio: value });
        if (mode === "video") rememberVideoSettings({ ratio: value });
    };
    const setComposerSeconds = (value: string) => {
        setSeconds(value);
        if (mode === "video") rememberVideoSettings({ seconds: value });
    };
    const setComposerQuality = (value: string) => {
        setQuality(value);
        if (mode === "image") rememberImageSettings({ quality: value });
    };
    const setComposerVideoQuality = (value: string) => {
        setVideoQuality(value);
        if (mode === "video") rememberVideoSettings({ videoQuality: value });
    };
    const setComposerCount = (value: string) => {
        setCount(value);
        if (mode === "image") rememberImageSettings({ count: value });
    };

    const externalLibraryItems = useMemo<AssetLibraryPickerItem[]>(
        () => externalAssetSources.items.map((item) => ({
            ...item,
            disabledReason: creationLibraryDisabledReason(mode, item.external?.item.kind, videoReferenceLimits),
        })),
        [externalAssetSources.items, mode, videoReferenceLimits],
    );
    const libraryItems = useMemo<AssetLibraryPickerItem[]>(() => [
        ...assets
            .filter((asset): asset is Extract<Asset, { kind: "image" | "video" | "audio" }> => asset.kind === "image" || asset.kind === "video" || asset.kind === "audio")
            .map((asset) => ({
                id: asset.id,
                title: asset.title,
                category: asset.category || "other",
                kindLabel: asset.kind === "video" ? "视频" : asset.kind === "audio" ? "音频" : "图片",
                asset,
                searchText: (asset.tags || []).join(" "),
                disabledReason: creationLibraryDisabledReason(mode, asset.kind, videoReferenceLimits),
            })),
        ...externalLibraryItems,
    ], [assets, externalLibraryItems, mode, videoReferenceLimits]);
    const uploadCreationAsset = async (file: File) => {
        const { uploadImage, uploadMediaFile } = await loadCreationRuntime();
        if (file.type.startsWith("video/")) {
            const uploaded = await uploadMediaFile(file, "create-upload");
            return {
                asset: creationVideoAsset({ title: file.name, uploaded, metadata: { source: "create-upload", fileName: file.name } }),
                attachment: creationAttachmentFromVideo(file, uploaded),
            };
        }
        if (file.type.startsWith("audio/")) {
            const uploaded = await uploadMediaFile(file, "create-upload");
            return {
                asset: creationAudioAsset({ title: file.name, uploaded, metadata: { source: "create-upload", fileName: file.name } }),
                attachment: creationAttachmentFromAudio(file, uploaded),
            };
        }
        if (!file.type.startsWith("image/")) {
            const uploaded = await uploadMediaFile(file, "create-upload");
            return { attachment: creationAttachmentFromDocument(file, uploaded) };
        }
        const uploaded = await uploadImage(file);
        return {
            asset: creationImageAsset({ title: file.name, uploaded, metadata: { source: "create-upload", fileName: file.name } }),
            attachment: creationAttachmentFromImage(file, uploaded),
        };
    };
    const uploadLibraryAssets = async (files: FileList | File[]) => {
        const next = Array.from(files).filter((file) => creationFileAccepted(mode, file));
        if (!next.length) return [];
        const settled = await Promise.allSettled(next.map(async (file) => {
            const { asset } = await uploadCreationAsset(file);
            return asset ? addAsset(asset) : "";
        }));
        const assetIds = settled.flatMap((entry) => entry.status === "fulfilled" && entry.value ? [entry.value] : []);
        const failed = settled.filter((entry) => entry.status === "rejected");
        if (assetIds.length) toast.success(`${assetIds.length} 个素材已上传到素材库并自动选中`);
        if (failed.length) toast.error(`${failed.length} 个素材上传失败，请重试`);
        return assetIds;
    };

    const handleLibrarySelect = (selectedIds: string[]) => {
        const next = selectedIds.flatMap((id): CreationAttachment[] => {
            const asset = assets.find((item) => item.id === id);
            if (asset?.kind === "image") return [creationAttachmentFromAsset(asset)];
            if (asset?.kind === "video" && mode !== "image") return [creationAttachmentFromVideoAsset(asset)];
            if (asset?.kind === "audio" && mode !== "image") return [creationAttachmentFromAudioAsset(asset)];
            const external = libraryItems.find((item) => item.id === id)?.external;
            return external ? [creationAttachmentFromExternalAsset(external)] : [];
        });
        if (!next.length) return;
        setAttachments((current) => {
            const candidates = [...current.filter((item) => !next.some((candidate) => candidate.id === item.id)), ...next];
            const reconciled = mode === "video" && videoReferenceLimits
                ? reconcileCreationAttachmentLimits(candidates, [], videoReferenceLimits)
                : reconcileCreationAttachmentLimit(candidates, [], maxReferences);
            if (reconciled.attachments.length < candidates.length) toast.warning("部分素材超出当前模型的参考内容上限，未添加到创作中");
            return reconciled.attachments;
        });
        setLibraryOpen(false);
    };

    const removeAttachment = (id: string) => {
        const reference = mentionReferences.find((item) => item.attachmentId === id);
        setAttachments((current) => removeCreationAttachment(current, id));
        if (reference) setPrompt((current) => removeCreationReferenceTokens(current, [reference]));
    };

    const clearAttachments = () => {
        const attachmentIds = new Set(attachments.map((item) => item.id));
        const references = mentionReferences.filter((item) => item.attachmentId && attachmentIds.has(item.attachmentId));
        setAttachments([]);
        if (references.length) setPrompt((current) => removeCreationReferenceTokens(current, references));
    };

    const clearComposer = () => {
        promptRef.current = "";
        attachmentsRef.current = [];
        setPrompt("");
        setAttachments([]);
        setDraftReferences([]);
        window.requestAnimationFrame(() => composerFocusRef.current?.focus());
    };

    const reorderAttachments = useCallback((next: CreationAttachment[]) => {
        attachmentsRef.current = next;
        setAttachments(next);
    }, []);

    const replaceAttachmentReference = useCallback((targetAttachmentId: string, replacement: CreationAttachment) => {
        const currentAttachments = attachmentsRef.current;
        const target = currentAttachments.find((attachment) => attachment.id === targetAttachmentId);
        if (!target) throw new Error("要替换的参考图不存在");
        if (creationAttachmentKind(target) !== "image" || creationAttachmentKind(replacement) !== "image") throw new Error("目前只支持替换提示词中的图片引用");
        if (target.id === replacement.id) return false;

        const result = replaceCreationAttachmentReference(promptRef.current, currentAttachments, targetAttachmentId, replacement);
        promptRef.current = result.prompt;
        attachmentsRef.current = result.attachments;
        setPrompt(result.prompt);
        setAttachments(result.attachments);
        return true;
    }, []);

    const replaceReferenceFromTrack = useCallback((targetAttachmentId: string, replacement: CreationAttachment) => {
        try {
            if (replaceAttachmentReference(targetAttachmentId, replacement)) toast.success("参考图已替换，槽位不变，提示词无需修改");
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "参考图替换失败");
        }
    }, [replaceAttachmentReference, toast]);

    const replaceReferenceFromFiles = useCallback(async (targetAttachmentId: string, files: File[]) => {
        if (busy || referenceReplacementBusy) return;
        const file = files.find((item) => item.type.startsWith("image/"));
        if (!file) {
            toast.warning("请拖入图片文件进行替换");
            return;
        }
        setReferenceReplacementBusy(true);
        try {
            const { asset, attachment } = await uploadCreationAsset(file);
            if (creationAttachmentKind(attachment) !== "image") throw new Error("上传结果不是可用图片");
            if (asset) addAsset(asset);
            if (replaceAttachmentReference(targetAttachmentId, attachment)) toast.success("参考图已替换，槽位不变，提示词无需修改");
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "参考图上传或替换失败");
        } finally {
            setReferenceReplacementBusy(false);
        }
    }, [addAsset, busy, referenceReplacementBusy, replaceAttachmentReference, toast]);

    const submit = async (retryContext?: CreationRetryContext, retryLockKey?: string) => {
        const releaseRetryLock = () => {
            if (retryLockKey) retryPreparingRef.current.delete(retryLockKey);
        };
        if (!submitGateRef.current.tryAcquire()) {
            releaseRetryLock();
            return;
        }
        const releaseSubmitGate = () => submitGateRef.current.release();
        const text = prompt.trim();
        if (!text || busy || !activeConversation) {
            releaseRetryLock();
            releaseSubmitGate();
            return;
        }
        if (!selectedModel) {
            toast.warning(`请先在设置中配置${modeLabels[mode]}模型`);
            releaseRetryLock();
            releaseSubmitGate();
            return;
        }
        if (mode === "video" && !videoDurationAllowed(videoProfile, Number(seconds))) {
            toast.error("当前模型不支持所选视频时长，请重新选择");
            releaseRetryLock();
            releaseSubmitGate();
            return;
        }
        const reconciledAttachments = mode === "video" && videoReferenceLimits
            ? reconcileCreationAttachmentLimits(attachments, mentionReferences, videoReferenceLimits)
            : reconcileCreationAttachmentLimit(attachments, mentionReferences, maxReferences);
        if (reconciledAttachments.attachments !== attachments) {
            toast.warning("参考内容正在按当前模型能力调整，请稍后重试");
            releaseRetryLock();
            releaseSubmitGate();
            return;
        }
        const settings = { ratio, seconds, quality, videoQuality, count };
        const references = selectedCreationReferences(text, mentionReferences);
        // 后端对图片和视频使用不同的参考字段；这里先拆分，避免媒体类型在写入任务时被误判。
        const { referenceImages, referenceVideos, referenceAudios } = splitCreationAttachments(attachments);
        const videoOperation = inferVideoOperation({
            textCount: text ? 1 : 0,
            imageCount: referenceImages.length,
            videoCount: referenceVideos.length,
            audioCount: referenceAudios.length,
            characterCount: 0,
        });
        const skillReferences = references.flatMap((reference) => (reference.skill ? [reference.skill] : []));
        let runtime: CreationRuntime;
        try {
            runtime = await loadCreationRuntime();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "生成运行时加载失败");
            releaseRetryLock();
            releaseSubmitGate();
            return;
        }
        let skillExecution: Awaited<ReturnType<typeof runtime.skillRuntime.prepare>>;
        try {
            skillExecution = await runtime.skillRuntime.prepare({
                profile: "creation",
                prompt: expandCreationPrompt(text, references, attachments),
                skills: skillReferences,
                selectedSkillIds: skillReferences.map((skill) => skill.skillId),
            });
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "技能上下文加载失败");
            releaseRetryLock();
            releaseSubmitGate();
            return;
        }
        const expandedPrompt = skillExecution.prompt;
        const referenceMetadata = skillExecution.metadata;
        followLatestMessageRef.current = true;
        const userMessage = newMessage("user", text, { mode, model: selectedModel, attachments, references, settings });
        const assistantMessage = newMessage("assistant", "", { mode, model: selectedModel, status: mode === "text" && textStreaming ? "streaming" : "pending", settings, ...retryContext });
        const originConversationId = activeConversation.id;
        const updateOriginAssistant = (updater: (item: CreationMessage) => CreationMessage) => updateConversationMessage(originConversationId, assistantMessage.id, updater);
        const boundTaskIds = new Set<string>();
        const boundTaskIdsByBatchIndex = new Map<number, string>();
        const boundTasks = new Map<string, GenerationTask>();
        const bindTask = (task: GenerationTask) => {
            if (typeof task.clientContext?.batchIndex === "number") boundTaskIdsByBatchIndex.set(task.clientContext.batchIndex, task.id);
            boundTaskIds.add(task.id);
            activeGenerationTaskIdsRef.current.add(task.id);
            boundTasks.set(task.id, task);
            updateOriginAssistant((item) => ({ ...item, generationStage: task.stage, generationOperation: task.operation, generationErrorCode: task.errorCode, taskIds: Array.from(new Set([...(item.taskIds || []), task.id])), clientOperationId: task.clientOperationId, retryOf: task.retryOf, attemptGroupId: task.attemptGroupId }));
            if (abortRef.current === controller) {
                abortRef.current = null;
                setBusy(false);
            }
        };
        updateActive((conversation) => ({
            ...conversation,
            title: conversation.messages.length ? conversation.title : text.slice(0, 24),
            updatedAt: new Date().toISOString(),
            messages: [...conversation.messages, userMessage, assistantMessage],
        }));
        setPrompt("");
        setAttachments([]);
        setDraftReferences([]);
        setBusy(true);
        const controller = new AbortController();
        const requestLifecycle = runtime.beginGenerationConsumer(controller.signal);
        abortRef.current = controller;
        const normalizedImage = mode === "image" ? normalizeImageValue(imageProfile, { size: ratio, quality, count }) : undefined;
        const requestConfig = {
            ...generationConfig,
            model: selectedModel,
            imageModel: selectedModel,
            videoModel: selectedModel,
            textModel: selectedModel,
            ...(mode === "image"
                ? { size: normalizedImage?.size || ratio, quality: normalizedImage?.quality || quality, count: normalizedImage?.count || count, videoSeconds: config.videoSeconds }
                : {}),
        };
        try {
            if (mode === "text") {
                const result = await runtime.runGenerationOperationOnce(retryContext?.clientOperationId, () => runtime.runBackendGenerationTask({
                    mode: "text",
                    prompt: expandedPrompt,
                    config: requestConfig,
                    referenceImages,
                    referenceVideos,
                    referenceAudios,
                    textHistory: (activeConversation.messages || []).filter((item) => item.content.trim()).map((item) => ({ role: item.role, content: item.content })),
                    signal: requestLifecycle.signal,
                    metadata: { source: "create-page", conversationId: activeConversation.id, messageId: assistantMessage.id, ...referenceMetadata },
                    onTaskUpdate: bindTask,
                    streamText: textStreaming,
                    enableThinking: textThinking,
                    onTextDelta: textStreaming ? (value) => updateOriginAssistant((item) => ({ ...item, content: value })) : undefined,
                    ...retryContext,
                }));
                if (!result.text?.trim()) throw new Error("后端任务没有返回文本");
                updateOriginAssistant((item) => ({ ...item, content: result.text || "", reasoning: result.reasoning }));
            } else if (mode === "image") {
                const taskCount = Math.max(1, Math.min(imageProfile.maxOutputs, Math.floor(Number(count) || 1)));
                const settled = await runtime.runGenerationOperationOnce(retryContext?.clientOperationId, () => runtime.runBackendGenerationTaskBatch({
                    mode: "image",
                    prompt: expandedPrompt,
                    config: { ...requestConfig, count: "1" },
                    referenceImages,
                    signal: requestLifecycle.signal,
                    metadata: { source: "create-page", conversationId: activeConversation.id, messageId: assistantMessage.id, ...referenceMetadata },
                    onTaskUpdate: bindTask,
                    count: taskCount,
                    ...retryContext,
                }));
                if (requestLifecycle.signal.aborted) throw new DOMException("Aborted", "AbortError");
                const boundTaskIdList = Array.from(boundTaskIds);
                const generatedImages = settled.flatMap((entry, batchIndex) => {
                    if (entry.status !== "fulfilled") return [];
                    return (entry.value.images || []).map((image, resultIndex) => ({
                        image,
                        taskId: boundTaskIdsByBatchIndex.get(batchIndex) || boundTaskIdList[batchIndex],
                        batchIndex,
                        resultIndex,
                    }));
                });
                const taskFailures = settled.filter((entry): entry is PromiseRejectedResult => entry.status === "rejected");
                const storedImages = await Promise.allSettled(generatedImages.map(async ({ image, taskId, batchIndex }) => {
                    if (!taskId) throw new Error("生成任务缺少稳定任务标识");
                    const task = completedCreationGenerationTask(runtime, { taskId, task: boundTasks.get(taskId), mode: "image", prompt: expandedPrompt, result: { mode: "image", images: [image] }, conversationId: activeConversation.id, messageId: assistantMessage.id, batchIndex, batchCount: taskCount });
                    const materialized = await runtime.consumeGenerationTaskMessage(task, assistantMessage.id, async ({ resultUrls, resultStorageKeys, effectKey }) => {
                        await updateOriginAssistant((item) => runtime.applyGenerationConsumerEffect(item, effectKey, (current) => ({ ...current, status: "done" as const, content: "图片已生成", ...(resultUrls.length ? { resultUrls: Array.from(new Set([...(current.resultUrls || []), ...resultUrls])) } : {}), ...(resultStorageKeys.length ? { resultStorageKeys: Array.from(new Set([...(current.resultStorageKeys || []), ...resultStorageKeys])) } : {}) })).value);
                    }, { signal: requestLifecycle.signal });
                    const url = runtime.generationTaskMaterializedUrls(materialized)[0];
                    if (!url) throw new Error("图片结果资源不可用");
                    return url;
                }));
                const resultUrls = storedImages.flatMap((entry) => entry.status === "fulfilled" ? [entry.value] : []);
                const resourceFailures = storedImages.filter((entry) => entry.status === "rejected");
                const failedCount = taskFailures.length + resourceFailures.length;
                if (!resultUrls.length) {
                    const reason = taskFailures[0]?.reason || resourceFailures[0]?.reason;
                    throw reason instanceof Error ? reason : new Error("后端任务没有返回图片");
                }
                if (failedCount) toast.warning(`${resultUrls.length} 张图片已生成，${failedCount} 张生成失败`);
                updateOriginAssistant((item) => ({ ...item, content: failedCount ? `${resultUrls.length} 张图片已生成，${failedCount} 张失败` : "图片已生成" }));
            } else {
                const result = await runtime.runGenerationOperationOnce(retryContext?.clientOperationId, () => runtime.runBackendGenerationTask({
                    mode: "video",
                    prompt: expandedPrompt,
                    config: requestConfig,
                    referenceImages,
                    referenceVideos,
                    referenceAudios,
                    signal: requestLifecycle.signal,
                    metadata: { source: "create-page", conversationId: activeConversation.id, messageId: assistantMessage.id, videoEditOperation: videoOperation, ...referenceMetadata },
                    onTaskUpdate: bindTask,
                    ...retryContext,
                }));
                if (!result.video?.dataUrl) throw new Error("后端任务没有返回视频");
                const taskId = Array.from(boundTaskIds)[0];
                if (!taskId) throw new Error("生成任务缺少稳定任务标识");
                const task = completedCreationGenerationTask(runtime, { taskId, task: boundTasks.get(taskId), mode: "video", prompt: expandedPrompt, result, conversationId: activeConversation.id, messageId: assistantMessage.id });
                const materialized = await runtime.consumeGenerationTaskMessage(task, assistantMessage.id, async ({ resultUrls, resultStorageKeys, effectKey }) => {
                    await updateOriginAssistant((item) => runtime.applyGenerationConsumerEffect(item, effectKey, (current) => ({ ...current, status: "done" as const, content: "视频已生成", resultUrls, ...(resultStorageKeys.length ? { resultStorageKeys } : {}) })).value);
                }, { signal: requestLifecycle.signal });
                if (!runtime.generationTaskMaterializedUrls(materialized)[0]) throw new Error("视频结果资源不可用");
            }
            updateOriginAssistant((item) => ({ ...item, status: "done" }));
        } catch (error) {
            if (runtime.isGenerationTaskCancelled(error, requestLifecycle.signal)) {
                updateOriginAssistant((item) => ({ ...item, status: "cancelled", content: "已停止" }));
                return;
            }
            const message = generationErrorMessage(error);
            updateOriginAssistant((item) => ({ ...item, status: "error", error: message, generationErrorCode: item.generationErrorCode || generationErrorCode(error), generationOperation: item.generationOperation || (mode === "video" ? videoOperation : mode), createdAt: assistantMessage.createdAt, content: "生成失败" }));
        } finally {
            for (const taskId of boundTaskIds) activeGenerationTaskIdsRef.current.delete(taskId);
            requestLifecycle.release();
            releaseRetryLock();
            releaseSubmitGate();
            if (abortRef.current === controller) {
                abortRef.current = null;
                setBusy(false);
            }
        }
    };

    useEffect(() => {
        if (!retrySequence) return;
        const pending = pendingRetryRef.current;
        if (!pending) return;
        pendingRetryRef.current = null;
        void submit(pending.context, pending.lockKey);
    }, [retrySequence]);

    const startNewConversation = () => {
        const next = newConversation();
        followLatestMessageRef.current = true;
        setConversations((current) => [next, ...current]);
        setActiveId(next.id);
        setPrompt("");
        setAttachments([]);
        setDraftReferences([]);
        setHistoryOpen(false);
    };

    const continueOnCanvas = async (selectedAssetIds?: string[]) => {
        if (!activeConversation || openingCanvasRef.current) return;
        openingCanvasRef.current = true;
        setOpeningCanvas(true);
        const scope = getActiveUserScope();
        const source = activeConversation;
        try {
            const assets = useAssetStore.getState().assets;
            const generatedAssetIds = selectedAssetIds || source.messages.flatMap((item) => {
                const resultStorageKeys = item.resultStorageKeys || [];
                const resultUrls = item.resultUrls || [];
                if (!resultStorageKeys.length && !resultUrls.length) return [];
                const ids = creationResultAssetIds(assets, { messageId: item.id, taskIds: item.taskIds || [], resultUrls, resultStorageKeys });
                if (ids.length !== Math.max(resultStorageKeys.length, resultUrls.length)) throw new Error("部分生成素材还未保存完成，请稍后转入画布。");
                return ids;
            });
            const referenceKeys = new Set(source.messages.flatMap((item) => (item.attachments || []).map((attachment) => attachment.storageKey).filter(Boolean)));
            const referenceAssetIds = assets.filter((asset) => (asset.kind === "image" || asset.kind === "video") && asset.data.storageKey && referenceKeys.has(asset.data.storageKey)).map((asset) => asset.id);
            const assetIds = [...generatedAssetIds, ...referenceAssetIds];
            const result = await continueCreationConversationOnCanvas(source);
            if (scope !== getActiveUserScope()) return;
            const next = updateCreationConversationSnapshot(conversationsRef.current, source.id, (item) => ({ ...item, canvasId: result.id }));
            conversationsRef.current = next;
            setConversations(next);
            await saveCreationConversations(next);
            if (scope !== getActiveUserScope()) return;
            if (result.syncError) toast.warning("会话已保存在本机，云端同步尚未完成。");
            const params = new URLSearchParams({ conversation: result.sessionId });
            if (assetIds.length) {
                params.set("mode", "handoff");
                [...new Set(assetIds)].forEach((id) => params.append("asset", id));
            }
            navigate(`/canvas/${result.id}?${params.toString()}`);
        } catch (cause) {
            if (scope === getActiveUserScope()) toast.error(cause instanceof Error ? cause.message : "转入画布失败，原会话已保留");
        } finally { openingCanvasRef.current = false; setOpeningCanvas(false); }
    };

    const selectConversation = (conversation: CreationConversation) => {
        followLatestMessageRef.current = true;
        setActiveId(conversation.id);
        setPrompt("");
        setAttachments([]);
        setDraftReferences([]);
        setHistoryOpen(false);
    };

    const confirmDeleteConversation = (conversation: CreationConversation) => {
        const title = conversation.title.trim() || "新创作";
        const label = title.length > 32 ? `${title.slice(0, 32)}...` : title;
        modal.confirm({
            className: "workspace-modal workspace-modal-compact",
            title: "删除历史对话？",
            content: `确定删除「${label}」吗？这只会删除历史对话记录，不会删除已上传或生成的任何素材。此操作不可撤销。`,
            okText: "删除对话",
            okButtonProps: { danger: true },
            cancelText: "保留",
            onOk: async () => {
                try {
                    const remaining = removeCreationConversationSnapshot(conversationsRef.current, conversation.id);
                    const sortedRemaining = [...remaining].sort((left, right) => conversationTimestamp(right.updatedAt) - conversationTimestamp(left.updatedAt));
                    const fallback = sortedRemaining.find((item) => item.messages.length > 0) || sortedRemaining[0] || newConversation();
                    const next = remaining.length ? remaining : [fallback];
                    await saveCreationConversations(next);
                    conversationsRef.current = next;
                    setConversations(next);
                    if (activeIdRef.current === conversation.id) {
                        followLatestMessageRef.current = true;
                        activeIdRef.current = fallback.id;
                        setActiveId(fallback.id);
                        setPrompt("");
                        setAttachments([]);
                        setDraftReferences([]);
                    }
                    toast.success("历史对话已删除，素材仍保留");
                } catch (error) {
                    toast.error(error instanceof Error ? error.message : "历史对话删除失败");
                    throw error;
                }
            },
        });
    };

    const renameConversationTitle = (conversation: CreationConversation, title: string) => {
        const nextTitle = title.trim().slice(0, 120);
        if (!nextTitle || nextTitle === conversation.title.trim()) return;
        const next = updateCreationConversationSnapshot(conversationsRef.current, conversation.id, (item) => ({ ...item, title: nextTitle }));
        conversationsRef.current = next;
        setConversations(next);
        void saveCreationConversations(next).catch((error) => toast.error(error instanceof Error ? error.message : "对话重命名保存失败"));
    };

    const restoreMessageDraft = (item: CreationMessage) => {
        const nextMode = item.mode || "text";
        const nextSettings = item.settings;
        selectMode(nextMode);
        setPrompt(item.content);
        setAttachments(item.attachments ? [...item.attachments] : []);
        setDraftReferences(item.references ? [...item.references] : []);
        if (item.model) updateConfig(nextMode === "text" ? "textModel" : nextMode === "image" ? "imageModel" : "videoModel", item.model);
        if (!nextSettings) return;
        setRatio(nextSettings.ratio);
        setSeconds(nextSettings.seconds);
        setQuality(nextSettings.quality);
        setVideoQuality(nextSettings.videoQuality);
        setCount(nextSettings.count);
        if (nextMode === "image") rememberImageSettings({ ratio: nextSettings.ratio, quality: nextSettings.quality, count: nextSettings.count });
        if (nextMode === "video") rememberVideoSettings({ ratio: nextSettings.ratio, seconds: nextSettings.seconds, videoQuality: nextSettings.videoQuality });
    };

    const retryFailedMessage = async (item: CreationMessage, index: number) => {
        const previous = item.role === "assistant" ? activeConversation?.messages[index - 1] : item;
        if (!previous?.content || busy) return;
        const retryOf = item.taskIds?.[0];
        const restoreForRetry = () => {
            followLatestMessageRef.current = true;
            restoreMessageDraft(previous);
            const removedIds = new Set([item.id, previous.id]);
            updateActive((conversation) => {
                const messages = conversation.messages.filter((message) => !removedIds.has(message.id));
                const firstPrompt = messages.find((message) => message.role === "user")?.content.trim();
                return { ...conversation, title: firstPrompt ? firstPrompt.slice(0, 24) : "新创作", updatedAt: new Date().toISOString(), messages };
            });
        };
        if (!retryOf) {
            restoreForRetry();
            return;
        }
        if (retryPreparingRef.current.has(retryOf)) return;
        retryPreparingRef.current.add(retryOf);
        try {
            const runtime = await loadCreationRuntime();
            const attemptGroupId = item.attemptGroupId || item.retryOf || retryOf;
            const context: CreationRetryContext = { ...(await runtime.createGenerationRetryContext(retryOf, attemptGroupId)), ...(item.taskIds && item.taskIds.length > 1 ? { retryContextsByBatchIndex: await runtime.createGenerationBatchRetryContexts(item.taskIds, attemptGroupId) } : {}) };
            restoreForRetry();
            pendingRetryRef.current = { context, lockKey: retryOf };
            setRetrySequence((current) => current + 1);
        } catch (error) {
            retryPreparingRef.current.delete(retryOf);
            toast.error(generationErrorMessage(error));
        }
    };

    const createVariant = (item: CreationMessage, index: number) => {
        const previous = item.role === "assistant" ? activeConversation?.messages[index - 1] : item;
        if (!previous?.content || busy) return;
        restoreMessageDraft(previous);
    };

    if (!hydrated || !activeConversation) return <div className="grid h-full place-items-center"><Spin /></div>;

    const handleThreadScroll = () => {
        const container = threadScrollRef.current;
        if (!container) return;
        followLatestMessageRef.current = container.scrollHeight - container.scrollTop - container.clientHeight <= 160;
        if (isEmpty) {
            // Keep the original editor in flow: changing its height here feeds
            // scroll anchoring back into this handler and causes flicker.
            const bottom = launchpadRef.current?.getBoundingClientRect().bottom;
            if (bottom === undefined) return;
            const remaining = bottom - container.getBoundingClientRect().top;
            if (remaining < -16) setLaunchpadCondensed(true);
            else if (remaining > 24 || container.scrollTop <= 24) setLaunchpadCondensed(false);
        }
    };



    const generationActive = activeConversation.messages.some((message) => message.role === "assistant" && message.status === "pending");

    const composerProps = {
        mode,
        prompt,
        setPrompt,
        busy,
        generationActive,
        referenceReplacementBusy,
        attachments,
        referenceImageSize,
        maxReferences,
        references: mentionReferences,
        onRemoveAttachment: removeAttachment,
        onClearAttachments: clearAttachments,
        onClearComposer: clearComposer,
        onReorderAttachments: reorderAttachments,
        onReplaceAttachment: replaceReferenceFromTrack,
        onReplaceReferenceFiles: replaceReferenceFromFiles,
        onOpenLibrary: () => setLibraryOpen(true),
        onModeChange: selectMode,
        model: selectedModel,
        modelRequirements,
        imageProfile,
        videoProfile,
        config: generationConfig,
        onModelChange: (value: string) => updateConfig(mode === "text" ? "textModel" : mode === "image" ? "imageModel" : "videoModel", value),
        ratio,
        setRatio: setComposerRatio,
        seconds,
        setSeconds: setComposerSeconds,
        quality,
        setQuality: setComposerQuality,
        videoQuality,
        setVideoQuality: setComposerVideoQuality,
        count,
        setCount: setComposerCount,
        textStreaming,
        setTextStreaming,
        textThinking,
        setTextThinking,
        promptOptimizerProvider,
        composerFocusRef,
        onPromptFocus: loadAddedSkills,
        onSubmit: () => void submit(),
    };


    return <>
        <div className="creation-home relative flex h-full min-h-0 flex-col overflow-hidden">
            {isEmpty ? <>
                <div className="creation-top-actions">
                    <Tooltip title="历史对话"><button type="button" aria-label="查看历史对话" aria-expanded={historyOpen} className="creation-top-action" onClick={() => setHistoryOpen(true)}><History /></button></Tooltip>
                </div>
                <AnimatePresence>
                    {launchpadCondensed && !agentMode ? <motion.div className="creation-floating-prompt" key="floating-prompt"
                        style={{ x: "-50%" }}
                        initial={{ opacity: 0, y: -12, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: .98 }}
                        transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 360, damping: 32, mass: .8 }}>
                        <Sparkles aria-hidden="true" />
                        <input aria-label="快捷编辑提示词" placeholder="继续描述你的创作想法…" value={prompt} disabled={busy || referenceReplacementBusy} onChange={(event) => setPrompt(event.target.value)} />
                        <Tooltip title="展开完整创作区"><button type="button" aria-label="展开完整创作区" onClick={() => {
                            threadScrollRef.current?.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
                            composerFocusRef.current?.focus({ preventScroll: true });
                        }}><Maximize2 /></button></Tooltip>
                    </motion.div> : null}
                </AnimatePresence>
                <main ref={threadScrollRef} onScroll={handleThreadScroll} className="creation-empty-workspace creation-scrollbar">
                <div className="creation-home-heading">
                    <h1>和{brandName}聊聊创作想法</h1>
                    <p>从一个画面、一个角色或一句话开始，继续你的创作。</p>
                </div>
                <section ref={launchpadRef} className="creation-launchpad" aria-label="开始创作">
                    <div className={cn("creation-composer-stage is-home-mode", agentMode && "is-agent-mode")}>
                        <CreationModeTabs mode={mode} agentActive={agentMode} onAgentSelect={() => setAgentMode(true)} onModeChange={(next) => { setAgentMode(false); selectMode(next); }} />
                        {agentMode ? <CreationAgentEntry /> : <div className="creation-empty-composer"><CreationComposer {...composerProps} variant="empty" /></div>}
                    </div>
                    <CreationEmptySuggest
                        onStartPrompt={(nextMode, prompt) => { setAgentMode(false); selectMode(nextMode); setPrompt(prompt); window.requestAnimationFrame(() => composerFocusRef.current?.focus()); }}
                        onOpenLibrary={() => { setAgentMode(false); selectMode("image"); setLibraryOpen(true); }}
                    />
                </section>
                <CreationFeaturedWorks
                    onStartPrompt={(nextMode, prompt) => { setAgentMode(false); selectMode(nextMode); setPrompt(prompt); window.requestAnimationFrame(() => composerFocusRef.current?.focus()); }}
                />
            </main>
            </> : <div className="creation-thread-workbench">
                <CreationWorkspaceToolbar onNewConversation={startNewConversation} onOpenHistory={() => setHistoryOpen(true)} shots={videoShots} onJumpToShot={jumpToShot} onContinueCanvas={() => void continueOnCanvas()} openingCanvas={openingCanvas} />
                <main ref={threadScrollRef} onScroll={handleThreadScroll} className="creation-thread-scroll creation-scrollbar">
                    <section className="creation-thread-stage"><div className="creation-results">{activeConversation.messages.map((item, index) => <div key={item.id} id={`creation-shot-${item.id}`} className="creation-thread-message"><CreationMessageView
                        item={item}
                        shotNumber={creationVideoShotOrdinal(videoShots, item)}
                        onRetryFailure={() => retryFailedMessage(item, index)}
                        onCreateVariant={() => createVariant(item, index)}
                        onContinueCanvas={(ids) => void continueOnCanvas(ids)}
                        openingCanvas={openingCanvas}
                        onEditUserMessage={(text) => { setPrompt(text); window.requestAnimationFrame(() => composerFocusRef.current?.focus()); }}
                    /></div>)}</div></section>
                </main>
                <section className="creation-thread-composer"><CreationComposer {...composerProps} variant="thread" /></section>
            </div>}
        </div>
        <CreationHistoryDrawer open={historyOpen} conversations={historyConversations} activeId={activeConversation.id} onNew={startNewConversation} onClose={() => setHistoryOpen(false)} onSelect={selectConversation} onDelete={confirmDeleteConversation} onRename={renameConversationTitle} />
        {libraryOpen ? <Suspense fallback={null}><AssetLibraryPickerModal
            remoteLibrary
            open={libraryOpen}
            items={libraryItems}
            categoryLabels={{ ...creationAssetCategoryLabels, ...externalAssetSources.categoryLabels }}
            folders={externalAssetSources.folders}
            initialSelectedIds={attachments.flatMap((item) => item.id.startsWith("asset:") ? [item.id.slice(6)] : item.id.startsWith("external:") ? [item.id] : [])}
            upload={{ accept: creationUploadAccept(mode), description: mode === "text" ? "支持图片、视频、音频和常用文档；媒体会保存到素材库" : `支持图片${mode === "video" ? "、视频和音频" : ""}，上传后保存到素材库`, onUpload: uploadLibraryAssets, external: { accept: "image/*", description: "写入当前 Eagle 文件夹；Eagle 当前支持图片文件", onUpload: (files, folderId) => externalAssetSources.uploadExternalFiles(files, folderId) } }}
            onClose={() => setLibraryOpen(false)}
            onConfirm={handleLibrarySelect}
        /></Suspense> : null}
    </>;
}
