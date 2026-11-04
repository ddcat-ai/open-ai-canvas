import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { App, Button, Spin } from "antd";
import { Tooltip } from "@/components/ui/base/tooltip";
import { History, Maximize2, PenLine } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";

import type { AssetLibraryPickerItem } from "@/components/assets/asset-library-picker-modal";
import { generationErrorCode, generationErrorMessage } from "@/lib/generation-error";
import { imageParameterRequest, normalizeImageParameters } from "@/lib/image-parameters";
import { creationResultAssetIds } from "@/lib/canvas/canvas-asset-handoff";
import { getActiveUserScope } from "@/lib/user-scope";
import { continueCreationConversationOnCanvas } from "@/services/creation-canvas-conversation";
import { useAuthEntry } from "@/hooks/use-auth-entry";
import { useExternalAssetSources } from "@/hooks/use-external-asset-sources";
import { modelCapabilityConfigFor, normalizeImageValue, normalizeVideoValue, videoDurationAllowed, videoDurationOptions } from "@/lib/model-capabilities";
import { inferVideoOperation, modelGroupReferenceLimits, resolveCompatibleModel, mergedImageCapabilityConfig, type ModelRequirements } from "@/lib/model-selection";
import type { BackendGenerationResult } from "@/services/api/generation-task";
import type { Skill } from "@/services/api/skills";
import type { GenerationTask } from "@/services/api/task-center";
import { loadCreationConversations, pendingCreationTaskIds, removeCreationConversationSnapshot, saveCreationConversations, updateCreationConversationSnapshot } from "@/services/creation-conversation-store";
import { clearCreationConversationSnapshot, mergeCreationConversationSnapshot, readCreationConversationSnapshot, writeCreationConversationSnapshot } from "@/services/creation-conversation-snapshot";
import { resolveModelChannel, resolveModelRequestConfig, selectableModelsByCapability, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useCreationPreferencesStore } from "@/stores/use-creation-preferences-store";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";
import { loadAssetsForUse, saveRemoteUserDataNow } from "@/services/user-data-sync";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { cn } from "@/lib/utils";
import { useUserStore } from "@/stores/use-user-store";
import type { PromptOptimizerProvider } from "@/lib/plugins/plugin-types";
import { promptOptimizerPlugin, PROMPT_OPTIMIZER_PLUGIN_ID } from "@/lib/plugins/builtin/prompt-optimizer";
import { createPluginHostContext } from "@/services/plugin-host";
import { usePluginStore } from "@/stores/use-plugin-store";
import { buildCreationMentionReferences, expandCreationPrompt, reconcileCreationAttachmentLimit, reconcileCreationAttachmentLimits, removeCreationReferenceTokens, replaceCreationAttachmentReference, selectedCreationReferences, type CreationReference } from "./creation-references";
import { creationAttachmentFromAudio, creationAttachmentFromDocument, creationAttachmentFromImage, creationAttachmentFromVideo, creationAttachmentKind, creationAudioAsset, creationFileAccepted, creationImageAsset, creationMediaAspectRatio, creationUploadAccept, creationVideoAsset, removeCreationAttachment, splitCreationAttachments, type CreationAttachment } from "./creation-assets";
import { creationLibraryDisabledReason, creationLibrarySelectionToAttachments } from "./creation-library";
import { defaultCreationMode, modeLabels, type CreationConversation, type CreationMessage, type CreationMode, type CreationRetryContext, type CreationSettings, type CreationShotRailEntry, type CreationStatus } from "./creation-types";
import { attachCreationTaskContexts, completedCreationGenerationTask, conversationTimestamp, creationMessageNeedsResultSync, creationShotRail, creationVideoShotOrdinal, isImageAttachment, isVideoAttachment, materializeCreationTaskResults, newConversation, newMessage, reconcileCreationTaskMessages, type PersistedCreationTask } from "./creation-conversations";
import { CreationComposer, CreationEmptySuggest, CreationHistoryDrawer, CreationMessageView, CreationModeTabs, CreationWorkspaceToolbar, creationAssetCategoryLabels } from "./creation-workspace";
import { declaredInspirationSources } from "@/lib/inspirations/catalog";
import { fillablePrompt } from "@/lib/inspirations/resolve";
import { CreationRecentCanvases } from "./creation-recent-canvases";
import { CreationAgentEntry } from "./creation-agent-entry";
import { createCreationSubmitGate } from "./creation-submit-gate";
import { creationVideoConfig } from "./creation-generation-config";

const AssetLibraryPickerModal = lazy(() => import("@/components/assets/asset-library-picker-modal").then((module) => ({ default: module.AssetLibraryPickerModal })));
const InspirationHall = lazy(() => import("@/pages/inspirations"));
const loadCreationRuntime = () => import("./creation-runtime");
type CreationRuntime = Awaited<ReturnType<typeof loadCreationRuntime>>;

const TEXT_STREAMING_PREF_KEY = "creation.composer.text-streaming";
const TEXT_THINKING_PREF_KEY = "creation.composer.text-thinking";

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
    const { t } = useTranslation();
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
    const userId = useUserStore((state) => state.user?.id || null);
    const userSessionHydrated = useUserStore((state) => state.hydrated);
    const activeConversationScope = getActiveUserScope();
    const initialConversationSnapshot = userSessionHydrated ? readCreationConversationSnapshot<CreationConversation>(activeConversationScope) : null;
    const [conversations, setConversations] = useState<CreationConversation[]>(() => initialConversationSnapshot || []);
    const conversationsRef = useRef<CreationConversation[]>(initialConversationSnapshot || []);
    const [activeId, setActiveId] = useState(() => initialConversationSnapshot?.[0]?.id || "");
    const activeIdRef = useRef(activeId);
    const [hydrated, setHydrated] = useState(() => Boolean(initialConversationSnapshot?.length));
    const [conversationStorageReady, setConversationStorageReady] = useState(false);
    const [conversationStorageError, setConversationStorageError] = useState("");
    const [conversationLoadAttempt, setConversationLoadAttempt] = useState(0);
    const inspirationSourcesVisible = useUserStore((state) => state.features.inspirationSourcesVisible);
    const [conversationScope, setConversationScope] = useState<string | null>(() => initialConversationSnapshot ? activeConversationScope : null);
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
    const [imageResolution, setImageResolution] = useState("auto");
    const [imageParameters, setImageParameters] = useState("{}");
    const [videoQuality, setVideoQuality] = useState(config.vquality || "720");
    const [count, setCount] = useState(String(Math.max(1, Math.min(4, Number(config.count) || 1))));
    const [textStreaming, setTextStreaming] = useState(() => readComposerPref(TEXT_STREAMING_PREF_KEY, true));
    const [textThinking, setTextThinking] = useState(() => readComposerPref(TEXT_THINKING_PREF_KEY, false));
    const [busy, setBusy] = useState(false);
    const [referenceReplacementBusy, setReferenceReplacementBusy] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);
    const { openAuth } = useAuthEntry();
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
    // 递增即重建恢复监听：订阅服务会缓存已结束的任务快照，任务被重新拉起或交接时需要重新订阅。
    const [recoveryEpoch, setRecoveryEpoch] = useState(0);
    const resultRefreshIdsRef = useRef(new Set<string>());
    const [resultRefreshIds, setResultRefreshIds] = useState<ReadonlySet<string>>(() => new Set());
    const resultRefreshControllersRef = useRef(new Set<AbortController>());
    const [composerPreferencesInitialized, setComposerPreferencesInitialized] = useState(false);
    promptRef.current = prompt;
    attachmentsRef.current = attachments;

    const activeConversation = useMemo(() => conversationScope === activeConversationScope ? conversations.find((item) => item.id === activeId) || conversations[0] : undefined, [activeConversationScope, activeId, conversationScope, conversations]);
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
            ? imageParameterRequest(modelCapabilityConfigFor(config, preferredModel).image!, { ...config, size: ratio, imageResolution, quality, count, imageParameters }) ?? { size: ratio, imageResolution, quality, count: Number(count), transparentBackground: config.transparentBackground === "true" }
			: mode === "video"
				? { size: ratio, videoSeconds: Number(seconds), vquality: videoQuality }
				: {},
    }), [attachments, config, preferredModel, count, hasPrompt, imageResolution, imageParameters, mode, quality, ratio, seconds, videoQuality]);
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
    const recoveryTaskKey = useMemo(() => {
        const ids = pendingTaskIds.filter((id) => !activeGenerationTaskIdsRef.current.has(id));
        return ids.length ? `${recoveryEpoch}:${ids.join("|")}` : "";
    }, [pendingTaskIds, recoveryEpoch]);
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
            imageResolution: saved?.imageResolution || imageProfile.resolution.default,
            imageParameters: saved?.model === selectedModel ? saved.imageParameters : undefined,
            count: saved?.count || count,
        });
        setRatio(normalized.size);
        setQuality(normalized.quality);
        setImageResolution(normalized.imageResolution || imageProfile.resolution.default);
        setImageParameters(JSON.stringify(normalizeImageParameters(imageProfile.parameters, saved?.model === selectedModel ? saved.imageParameters : undefined)));
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
        if (!userSessionHydrated) return;
        let cancelled = false;
        const scope = getActiveUserScope();
        const cached = readCreationConversationSnapshot<CreationConversation>(scope);
        setConversationStorageReady(false);
        setConversationStorageError("");
        if (cached?.length) {
            conversationsRef.current = cached;
            setConversations(cached);
            setActiveId((current) => cached.some((item) => item.id === current) ? current : cached[0].id);
            setConversationScope(scope);
            setConversationStorageError("");
            setHydrated(true);
        } else {
            setHydrated(false);
            setConversationScope(null);
            setConversations([]);
            setActiveId("");
        }
        void loadCreationConversations<CreationConversation>().then((stored) => {
            if (cancelled || getActiveUserScope() !== scope || (useUserStore.getState().user?.id || null) !== userId) return;
            const next = cached?.length ? mergeCreationConversationSnapshot(cached, stored || []) : stored?.length ? stored : [newConversation()];
            conversationsRef.current = next;
            writeCreationConversationSnapshot(scope, next);
            setConversations(next);
            setActiveId((current) => next.some((item) => item.id === current) ? current : next[0].id);
            setConversationScope(scope);
            setConversationStorageError("");
            setConversationStorageReady(true);
            setHydrated(true);
        }).catch((error: unknown) => {
            if (cancelled || getActiveUserScope() !== scope || (useUserStore.getState().user?.id || null) !== userId) return;
            setConversationStorageError(error instanceof Error ? error.message : "读取本地创作记录失败");
            if (!cached?.length) setHydrated(true);
        });
        return () => { cancelled = true; };
    }, [userId, userSessionHydrated, conversationLoadAttempt]);

    useEffect(() => () => abortRef.current?.abort(), []);

    useEffect(() => {
        activeIdRef.current = activeId;
    }, [activeId]);

    useEffect(() => {
        conversationsRef.current = conversations;
        if (!userSessionHydrated || !hydrated || !conversationStorageReady || conversationScope !== getActiveUserScope()) return;
        writeCreationConversationSnapshot(conversationScope, conversations);
        void saveCreationConversations(conversations).catch((error) => {
            console.warn("创作会话持久化失败；当前会话仍保留在内存快照", error);
        });
    }, [conversations, conversationScope, hydrated, userSessionHydrated]);

    useEffect(
        () => () => {
            for (const controller of resultRefreshControllersRef.current) controller.abort();
            resultRefreshControllersRef.current.clear();
        },
        [],
    );

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

    /**
     * 把后端任务快照接回创作消息：成功的任务先资源化再挂到对应消息上。
     * 刷新恢复、断线重连和“重新获取结果”共用这一条链路，只读取原任务，从不创建新任务。
     */
    const applyCreationTaskSnapshots = useCallback(
        async (runtime: CreationRuntime, tasks: GenerationTask[], signal: AbortSignal): Promise<PersistedCreationTask[]> => {
            const contextual = attachCreationTaskContexts(tasks, conversationsRef.current);
            const persistedTasks = await materializeCreationTaskResults(runtime, contextual, signal);
            if (signal.aborted) return persistedTasks;
            const attachable = persistedTasks.filter((task) => task.status === "succeeded" && Boolean(task.clientContext?.conversationId && task.clientContext.messageId) && Boolean(task.creationResultUrls?.length || task.creationResultStorageKeys?.length));
            for (const task of attachable) {
                const conversationId = task.clientContext!.conversationId!;
                const messageId = task.clientContext!.messageId!;
                try {
                    await runtime.consumeGenerationTaskMessage(task, messageId, async ({ effectKey, resultUrls, resultStorageKeys }) => {
                        if (signal.aborted) return;
                        await updateConversationMessage(conversationId, messageId, (item) =>
                            runtime.applyGenerationConsumerEffect(item, effectKey, (current) => ({
                                ...current,
                                status: "done" as const,
                                content: current.mode === "video" ? t("create.status.videoGenerated") : t("create.status.imageGenerated"),
                                error: undefined,
                                errorKind: undefined,
                                syncInterrupted: undefined,
                                mediaRecoverable: undefined,
                                generationStatus: "succeeded" as const,
                                ...(resultUrls.length ? { resultUrls: Array.from(new Set([...(current.resultUrls || []), ...resultUrls])) } : {}),
                                ...(resultStorageKeys.length ? { resultStorageKeys: Array.from(new Set([...(current.resultStorageKeys || []), ...resultStorageKeys])) } : {}),
                            })).value,
                        );
                    }, { signal, materialize: async () => task, materializedUrls: runtime.generationTaskMaterializedUrls, materializedStorageKeys: runtime.generationTaskMaterializedStorageKeys });
                } catch (error) {
                    if (signal.aborted) return persistedTasks;
                    console.warn("创作任务结果挂载失败，将使用已物化结果收敛消息状态", error);
                }
            }
            return persistedTasks;
        },
        [updateConversationMessage],
    );

    useEffect(() => {
        if (!hydrated || !recoveryTaskKey || !pendingTaskIds.length) return;
        // 当前页面主动提交的任务由 submit 自己等待并收尾；恢复监听只接管刷新前遗留、或 submit 交接过来的任务，避免同一任务被双重轮询。
        const recoverableTaskIds = pendingTaskIds.filter((id) => !activeGenerationTaskIdsRef.current.has(id));
        if (!recoverableTaskIds.length) return;
        let cancelled = false;
        const observationController = new AbortController();
        // 一条消息可能对应多张图的多个任务：保留每个任务的最新快照一起收敛，不会只看到其中一个就提前定论。
        const knownTasks = new Map<string, PersistedCreationTask>();
        const applyTasks = async (tasks: GenerationTask[]) => {
            const runtime = await loadCreationRuntime();
            const persistedTasks = await applyCreationTaskSnapshots(runtime, tasks, observationController.signal);
            if (cancelled) return;
            taskSyncWarningRef.current = false;
            for (const task of persistedTasks) knownTasks.set(task.id, task);
            setConversations((current) => reconcileCreationTaskMessages(runtime, current, [...knownTasks.values()]));
        };
        const warnSync = (error: unknown) => {
            if (cancelled || observationController.signal.aborted) return;
            console.warn("创作任务状态同步失败", error);
            if (!taskSyncWarningRef.current) {
                taskSyncWarningRef.current = true;
                toast.warning(t("create.page.taskSyncFailed"));
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
    }, [applyCreationTaskSnapshots, hydrated, recoveryTaskKey, toast]);

    const beginResultRefresh = (messageId: string) => {
        if (resultRefreshIdsRef.current.has(messageId)) return null;
        resultRefreshIdsRef.current.add(messageId);
        setResultRefreshIds(new Set(resultRefreshIdsRef.current));
        const controller = new AbortController();
        resultRefreshControllersRef.current.add(controller);
        return {
            signal: controller.signal,
            finish() {
                resultRefreshControllersRef.current.delete(controller);
                resultRefreshIdsRef.current.delete(messageId);
                setResultRefreshIds(new Set(resultRefreshIdsRef.current));
            },
        };
    };

    // 重新查询原任务并接回结果：任务仍在进行就回到生成中继续跟进，已成功就补回作品；不会提交新任务。
    const refreshMessageResult = async (item: CreationMessage) => {
        const taskIds = item.taskIds || [];
        if (!taskIds.length) return;
        const refresh = beginResultRefresh(item.id);
        if (!refresh) return;
        const scope = getActiveUserScope();
        try {
            const runtime = await loadCreationRuntime();
            const tasks = await Promise.all(taskIds.map((id) => runtime.queryGenerationTask(id, { signal: refresh.signal })));
            if (refresh.signal.aborted || scope !== getActiveUserScope()) return;
            const persistedTasks = await applyCreationTaskSnapshots(runtime, tasks, refresh.signal);
            if (refresh.signal.aborted || scope !== getActiveUserScope()) return;
            setConversations((current) => reconcileCreationTaskMessages(runtime, current, persistedTasks, { reviveMessageIds: new Set([item.id]) }));
            if (tasks.some((task) => task.status === "queued" || task.status === "running")) {
                setRecoveryEpoch((value) => value + 1);
                toast.info(t("create.page.taskStillRunning"));
            } else if (persistedTasks.some((task) => task.status === "succeeded" && !task.creationResultUrls?.length && !task.creationResultStorageKeys?.length)) {
                toast.warning(t("create.page.resultNotLoaded"));
            }
        } catch (error) {
            if (refresh.signal.aborted || scope !== getActiveUserScope()) return;
            toast.error(t("create.page.resultFetchFailed", { reason: generationErrorMessage(error) }));
        } finally {
            refresh.finish();
        }
    };

    // 作品已生成但后端保存失败：重放保存检查点，不重新生成、不重复扣费，随后回到生成中跟进保存结果。
    const recoverMessageMedia = async (item: CreationMessage) => {
        const taskIds = item.taskIds || [];
        if (!taskIds.length) return;
        const refresh = beginResultRefresh(item.id);
        if (!refresh) return;
        const scope = getActiveUserScope();
        try {
            const runtime = await loadCreationRuntime();
            const recovered = await Promise.allSettled(taskIds.map((id) => runtime.recoverGenerationTaskMedia(id)));
            if (!recovered.some((entry) => entry.status === "fulfilled")) {
                const rejected = recovered.find((entry): entry is PromiseRejectedResult => entry.status === "rejected");
                throw rejected?.reason instanceof Error ? rejected.reason : new Error(t("create.page.resaveUnavailable"));
            }
            const tasks = await Promise.all(taskIds.map((id) => runtime.queryGenerationTask(id, { signal: refresh.signal })));
            if (refresh.signal.aborted || scope !== getActiveUserScope()) return;
            const persistedTasks = await applyCreationTaskSnapshots(runtime, tasks, refresh.signal);
            if (refresh.signal.aborted || scope !== getActiveUserScope()) return;
            setConversations((current) => reconcileCreationTaskMessages(runtime, current, persistedTasks, { reviveMessageIds: new Set([item.id]) }));
            setRecoveryEpoch((value) => value + 1);
        } catch (error) {
            if (refresh.signal.aborted || scope !== getActiveUserScope()) return;
            toast.error(t("create.page.resaveFailed", { reason: generationErrorMessage(error) }));
        } finally {
            refresh.finish();
        }
    };

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
    const setComposerImageResolution = (value: string) => {
        setImageResolution(value);
        if (mode === "image") rememberImageSettings({ imageResolution: value });
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
                kindLabel: asset.kind === "video" ? t("create.kind.video") : asset.kind === "audio" ? t("create.kind.audio") : t("create.kind.image"),
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
        if (assetIds.length) toast.success(t("create.page.uploadSucceeded", { count: assetIds.length }));
        if (failed.length) toast.error(t("create.page.uploadFailed", { count: failed.length }));
        return assetIds;
    };

    const handleLibrarySelect = async (selectedIds: string[], pickedItems = libraryItems) => {
        const next = creationLibrarySelectionToAttachments(selectedIds, pickedItems, mode, videoReferenceLimits);
        if (!next.length) return;
        const selected = new Set(selectedIds);
        const cachedIds = new Set(useAssetStore.getState().assets.map((asset) => asset.id));
        const uncachedAssetIds = pickedItems.filter((item) => item.asset && selected.has(item.id) && !cachedIds.has(item.id)).map((item) => item.id);
        if (uncachedAssetIds.length) await loadAssetsForUse(uncachedAssetIds);
        setAttachments((current) => {
            const candidates = [...current.filter((item) => !next.some((candidate) => candidate.id === item.id)), ...next];
            const reconciled = mode === "video" && videoReferenceLimits
                ? reconcileCreationAttachmentLimits(candidates, [], videoReferenceLimits)
                : reconcileCreationAttachmentLimit(candidates, [], maxReferences);
            if (reconciled.attachments.length < candidates.length) toast.warning(t("create.page.referenceLimitExceeded"));
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
        if (!target) throw new Error(t("create.page.replaceTargetMissing"));
        if (creationAttachmentKind(target) !== "image" || creationAttachmentKind(replacement) !== "image") throw new Error(t("create.page.replaceImageOnly"));
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
            if (replaceAttachmentReference(targetAttachmentId, replacement)) toast.success(t("create.page.referenceReplaced"));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : t("create.page.replaceFailed"));
        }
    }, [replaceAttachmentReference, toast]);

    const replaceReferenceFromFiles = useCallback(async (targetAttachmentId: string, files: File[]) => {
        if (busy || referenceReplacementBusy) return;
        const file = files.find((item) => item.type.startsWith("image/"));
        if (!file) {
            toast.warning(t("create.page.dropImageToReplace"));
            return;
        }
        setReferenceReplacementBusy(true);
        try {
            const { asset, attachment } = await uploadCreationAsset(file);
            if (creationAttachmentKind(attachment) !== "image") throw new Error(t("create.page.uploadNotImage"));
            if (asset) addAsset(asset);
            if (replaceAttachmentReference(targetAttachmentId, attachment)) toast.success(t("create.page.referenceReplaced"));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : t("create.page.uploadReplaceFailed"));
        } finally {
            setReferenceReplacementBusy(false);
        }
    }, [addAsset, busy, referenceReplacementBusy, replaceAttachmentReference, toast]);

    const submit = async (retryContext?: CreationRetryContext, retryLockKey?: string) => {
        const releaseRetryLock = () => {
            if (retryLockKey) retryPreparingRef.current.delete(retryLockKey);
        };
        const submitToken = submitGateRef.current.tryAcquire();
        if (!submitToken) {
            // 以前这里是静默返回：上一条还在生成时点发送毫无反应，只能靠猜。
            releaseRetryLock();
            toast.warning(t("create.page.submitInProgress"));
            return;
        }
        const releaseSubmitGate = () => submitGateRef.current.release(submitToken);
        const text = prompt.trim();
        if (!text || busy || !activeConversation) {
            releaseRetryLock();
            releaseSubmitGate();
            return;
        }
        if (!useUserStore.getState().user) {
            // 未发送的提示词只保存在本页内存里，跳转登录页会丢失；两种登录模式都改用弹窗。
            openAuth({ preferDialog: true });
            releaseRetryLock();
            releaseSubmitGate();
            return;
        }
        if (!selectedModel) {
            toast.warning(t("create.page.configureModel", { mode: modeLabels[mode] }));
            releaseRetryLock();
            releaseSubmitGate();
            return;
        }
        if (mode === "video" && !videoDurationAllowed(videoProfile, Number(seconds))) {
            toast.error(t("create.page.durationUnsupported"));
            releaseRetryLock();
            releaseSubmitGate();
            return;
        }
        const reconciledAttachments = mode === "video" && videoReferenceLimits
            ? reconcileCreationAttachmentLimits(attachments, mentionReferences, videoReferenceLimits)
            : reconcileCreationAttachmentLimit(attachments, mentionReferences, maxReferences);
        if (reconciledAttachments.attachments !== attachments) {
            toast.warning(t("create.page.referencesAdjusting"));
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
            toast.error(error instanceof Error ? error.message : t("create.page.runtimeLoadFailed"));
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
            toast.error(error instanceof Error ? error.message : t("create.page.skillContextFailed"));
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
            updateOriginAssistant((item) => ({
                ...item,
                generationStage: task.stage,
                generationStatus: task.status,
                generationMediaStage: task.mediaStage,
                generationProgress: typeof task.progress === "number" && Number.isFinite(task.progress) ? Math.round(task.progress) : undefined,
                syncInterrupted: undefined,
                generationOperation: task.operation,
                generationErrorCode: task.errorCode,
                taskIds: Array.from(new Set([...(item.taskIds || []), task.id])),
                clientOperationId: task.clientOperationId,
                retryOf: task.retryOf,
                attemptGroupId: task.attemptGroupId,
            }));
            if (abortRef.current === controller) {
                abortRef.current = null;
                setBusy(false);
                // 任务已经建出来了：提交阶段到此结束。立刻放闸，这样上一条还在生成时
                // 也能继续提交下一条，不必等它跑完。
                releaseSubmitGate();
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
        const normalizedImage = mode === "image"
            ? imageProfile.parameters
                ? { size: ratio, quality, imageResolution, imageParameters, count }
                : normalizeImageValue(imageProfile, { size: ratio, quality, imageResolution, imageParameters, count }, resolveModelRequestConfig(config, selectedModel).interfaceType)
            : undefined;
        const requestConfig = {
            ...generationConfig,
            model: selectedModel,
            imageModel: selectedModel,
            imageResolution: normalizedImage?.imageResolution || imageResolution,
            imageParameters: normalizedImage?.imageParameters || imageParameters,
            videoModel: selectedModel,
            textModel: selectedModel,
            ...(mode === "image"
                ? { size: normalizedImage?.size || ratio, quality: normalizedImage?.quality || quality, count: normalizedImage?.count || count, videoSeconds: config.videoSeconds }
                : {}),
        };
        let handedOverToRecovery = false;
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
                if (!result.text?.trim()) throw new Error(t("create.page.noTextResult"));
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
                const generatedTasks = settled.flatMap((entry, batchIndex) => {
                    if (entry.status !== "fulfilled") return [];
                    return [{
                        result: entry.value,
                        taskId: boundTaskIdsByBatchIndex.get(batchIndex) || boundTaskIdList[batchIndex],
                        batchIndex,
                    }];
                });
                const taskFailures = settled.filter((entry): entry is PromiseRejectedResult => entry.status === "rejected");
                const storedImages = await Promise.allSettled(generatedTasks.map(async ({ result, taskId, batchIndex }) => {
                    if (!taskId) throw new Error(t("create.page.missingTaskId"));
                    const task = completedCreationGenerationTask(runtime, { taskId, task: boundTasks.get(taskId), mode: "image", prompt: expandedPrompt, result, conversationId: activeConversation.id, messageId: assistantMessage.id, batchIndex, batchCount: taskCount });
                    const materialized = await runtime.consumeGenerationTaskMessage(task, assistantMessage.id, async ({ resultUrls, resultStorageKeys, effectKey }) => {
                        await updateOriginAssistant((item) => runtime.applyGenerationConsumerEffect(item, effectKey, (current) => ({ ...current, status: "done" as const, content: t("create.status.imageGenerated"), ...(resultUrls.length ? { resultUrls: Array.from(new Set([...(current.resultUrls || []), ...resultUrls])) } : {}), ...(resultStorageKeys.length ? { resultStorageKeys: Array.from(new Set([...(current.resultStorageKeys || []), ...resultStorageKeys])) } : {}) })).value);
                    }, { signal: requestLifecycle.signal });
                    const urls = runtime.generationTaskMaterializedUrls(materialized);
                    if (!urls.length) throw new Error(t("create.page.imageResultUnavailable"));
                    return urls;
                }));
                const resultUrls = storedImages.flatMap((entry) => entry.status === "fulfilled" ? entry.value : []);
                const resourceFailures = storedImages.filter((entry): entry is PromiseRejectedResult => entry.status === "rejected");
                const failedCount = taskFailures.length + resourceFailures.length;
                if (!resultUrls.length) {
                    // 只要有一张图是“页面没跟上”而不是后端确认失败，就交给恢复监听继续跟进，而不是整条判失败。
                    const reasons = [...taskFailures, ...resourceFailures].map((entry) => entry.reason);
                    const reason = reasons.find((candidate) => !runtime.isGenerationTaskTerminalError(candidate)) ?? reasons[0];
                    throw reason instanceof Error ? reason : new Error(t("create.page.noImageResult"));
                }
                if (failedCount) toast.warning(t("create.page.imagesPartiallyGenerated", { done: resultUrls.length, failed: failedCount }));
                updateOriginAssistant((item) => ({ ...item, content: failedCount ? t("create.status.imagesPartiallyGenerated", { done: resultUrls.length, failed: failedCount }) : t("create.status.imageGenerated") }));
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
                if (!result.video?.dataUrl) throw new Error(t("create.page.noVideoResult"));
                const taskId = Array.from(boundTaskIds)[0];
                if (!taskId) throw new Error(t("create.page.missingTaskId"));
                const task = completedCreationGenerationTask(runtime, { taskId, task: boundTasks.get(taskId), mode: "video", prompt: expandedPrompt, result, conversationId: activeConversation.id, messageId: assistantMessage.id });
                const materialized = await runtime.consumeGenerationTaskMessage(task, assistantMessage.id, async ({ resultUrls, resultStorageKeys, effectKey }) => {
                    await updateOriginAssistant((item) => runtime.applyGenerationConsumerEffect(item, effectKey, (current) => ({ ...current, status: "done" as const, content: t("create.status.videoGenerated"), resultUrls, ...(resultStorageKeys.length ? { resultStorageKeys } : {}) })).value);
                }, { signal: requestLifecycle.signal });
                if (!runtime.generationTaskMaterializedUrls(materialized)[0]) throw new Error(t("create.page.videoResultUnavailable"));
            }
            updateOriginAssistant((item) => ({ ...item, status: "done" }));
        } catch (error) {
            if (runtime.isGenerationTaskCancelled(error, requestLifecycle.signal)) {
                updateOriginAssistant((item) => ({ ...item, status: "cancelled", content: t("create.status.stopped") }));
                return;
            }
            if (boundTaskIds.size && !runtime.isGenerationTaskTerminalError(error)) {
                // 任务已在后端建立，只是页面没等到终态或没读到结果（轮询中断、网络抖动、结果下载失败）：
                // 这不是生成失败。交给恢复监听继续跟进原任务；默认引导重新生成会让用户再付一次费。
                handedOverToRecovery = true;
                console.warn("创作任务等待中断，转交恢复监听继续跟进原任务", error);
                updateOriginAssistant((item) => ({ ...item, status: "pending", syncInterrupted: true, error: undefined, errorKind: undefined, createdAt: assistantMessage.createdAt }));
                return;
            }
            const message = generationErrorMessage(error);
            const failedTask = runtime.isGenerationTaskTerminalError(error) ? error.task : undefined;
            updateOriginAssistant((item) => ({
                ...item,
                status: "error",
                error: message,
                errorKind: boundTaskIds.size ? "task" : undefined,
                mediaRecoverable: failedTask?.canRecoverMedia || undefined,
                generationStatus: failedTask?.status ?? item.generationStatus,
                generationErrorCode: item.generationErrorCode || generationErrorCode(error),
                generationOperation: item.generationOperation || (mode === "video" ? videoOperation : mode),
                createdAt: assistantMessage.createdAt,
                content: t("create.status.failed"),
            }));
        } finally {
            for (const taskId of boundTaskIds) activeGenerationTaskIdsRef.current.delete(taskId);
            if (handedOverToRecovery) setRecoveryEpoch((value) => value + 1);
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
                if (ids.length !== Math.max(resultStorageKeys.length, resultUrls.length)) throw new Error(t("create.page.handoffAssetsPending"));
                return ids;
            });
            const referenceKeys = new Set(source.messages.flatMap((item) => (item.attachments || []).map((attachment) => attachment.storageKey).filter(Boolean)));
            const referenceAssetIds = assets.filter((asset) => (asset.kind === "image" || asset.kind === "video") && asset.data.storageKey && referenceKeys.has(asset.data.storageKey)).map((asset) => asset.id);
            const assetIds = [...generatedAssetIds, ...referenceAssetIds];
            if (assetIds.length) await saveRemoteUserDataNow([]);
            const result = await continueCreationConversationOnCanvas(source);
            if (scope !== getActiveUserScope()) return;
            const next = updateCreationConversationSnapshot(conversationsRef.current, source.id, (item) => ({ ...item, canvasId: result.id }));
            conversationsRef.current = next;
            setConversations(next);
            await saveCreationConversations(next);
            if (scope !== getActiveUserScope()) return;
            if (result.syncError) toast.warning(t("create.page.handoffSyncPending"));
            const params = new URLSearchParams({ conversation: result.sessionId });
            if (assetIds.length) {
                params.set("mode", "handoff");
                [...new Set(assetIds)].forEach((id) => params.append("asset", id));
            }
            navigate(`/canvas/${result.id}?${params.toString()}`);
        } catch (cause) {
            if (scope === getActiveUserScope()) toast.error(cause instanceof Error ? cause.message : t("create.page.handoffFailed"));
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
        const title = conversation.title.trim() || t("create.conversation.untitled");
        const label = title.length > 32 ? `${title.slice(0, 32)}...` : title;
        modal.confirm({
            className: "workspace-modal workspace-modal-compact",
            title: t("create.page.deleteTitle"),
            content: t("create.page.deleteContent", { title: label }),
            okText: t("create.history.delete"),
            okButtonProps: { danger: true },
            cancelText: t("create.page.deleteKeep"),
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
                    toast.success(t("create.page.deleted"));
                } catch (error) {
                    toast.error(error instanceof Error ? error.message : t("create.page.deleteFailed"));
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
        void saveCreationConversations(next).catch((error) => toast.error(error instanceof Error ? error.message : t("create.page.renameFailed")));
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
                return { ...conversation, title: firstPrompt ? firstPrompt.slice(0, 24) : t("create.conversation.untitled"), updatedAt: new Date().toISOString(), messages };
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

    // 作品可能已经生成（页面只是没拿到结果，或仍在重连）时，重新生成会提交新任务并再次扣费，先确认。
    const regenerateMessage = (item: CreationMessage, index: number) => {
        if (!creationMessageNeedsResultSync(item) && !(item.syncInterrupted && (item.status === "pending" || item.status === "streaming"))) {
            void retryFailedMessage(item, index);
            return;
        }
        modal.confirm({
            className: "workspace-modal workspace-modal-compact",
            title: t("create.page.regenerateTitle"),
            content: t("create.page.regenerateContent"),
            okText: t("create.page.regenerateConfirm"),
            cancelText: t("create.page.regenerateCancel"),
            onOk: () => retryFailedMessage(item, index),
        });
    };

    const createVariant = (item: CreationMessage, index: number) => {
        const previous = item.role === "assistant" ? activeConversation?.messages[index - 1] : item;
        if (!previous?.content || busy) return;
        restoreMessageDraft(previous);
    };

    if ((!hydrated || !activeConversation) && conversationStorageError) {
        return (
            <div className="grid h-full place-items-center">
                <div className="text-center">
                    <p role="alert" className="mb-3 text-sm text-foreground/65">创作记录读取失败：{conversationStorageError}</p>
                    <Button onClick={() => { setConversationStorageError(""); setConversationLoadAttempt((attempt) => attempt + 1); }}>重试</Button>
                </div>
            </div>
        );
    }
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
    const startPrompt = (nextMode: CreationMode, nextPrompt: string) => {
        setAgentMode(false);
        selectMode(nextMode);
        setPrompt(nextPrompt);
        threadScrollRef.current?.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
        window.requestAnimationFrame(() => composerFocusRef.current?.focus({ preventScroll: true }));
    };

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
        imageResolution,
        setImageResolution: setComposerImageResolution,
        imageParameters,
        setImageParameters: (value: string) => { setImageParameters(value); rememberImageSettings({ model: selectedModel, imageParameters: value }); },
        setTransparentBackground: (value: string) => useConfigStore.getState().updateConfig("transparentBackground", value),
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
            {conversationStorageError ? <p role="status" className="mx-auto mb-3 max-w-3xl px-4 text-xs text-foreground/55">本地历史读取失败，当前会话仍保留。 {conversationStorageError} <button type="button" className="underline underline-offset-2" onClick={() => { setConversationStorageError(""); setConversationLoadAttempt((attempt) => attempt + 1); }}>重试</button></p> : null}
            {isEmpty ? <>
                <AnimatePresence>
                    {launchpadCondensed && !agentMode ? <motion.div className="creation-floating-prompt" key="floating-prompt"
                        style={{ x: "-50%" }}
                        initial={{ opacity: 0, y: -12, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: .98 }}
                        transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 360, damping: 32, mass: .8 }}>
                        <PenLine aria-hidden="true" />
                        <input aria-label={t("create.page.quickEditLabel")} placeholder={t("create.page.quickEditPlaceholder")} value={prompt} disabled={busy || referenceReplacementBusy} onChange={(event) => setPrompt(event.target.value)} />
                        <Tooltip title={t("create.page.expandComposer")}><button type="button" aria-label={t("create.page.expandComposer")} onClick={() => {
                            threadScrollRef.current?.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
                            composerFocusRef.current?.focus({ preventScroll: true });
                        }}><Maximize2 /></button></Tooltip>
                    </motion.div> : null}
                </AnimatePresence>
                <main ref={threadScrollRef} onScroll={handleThreadScroll} className="creation-home-scroll creation-scrollbar">
                <section ref={launchpadRef} className="creation-launchpad" aria-label={t("create.page.launchpadLabel")}>
                    <header className="creation-start-heading">
                        <div>
                            <h1>{t("create.page.heading", { brand: brandName })}</h1>
                            <p>{t("create.page.subheading")}</p>
                        </div>
                        <button type="button" className="creation-history-entry" aria-label={t("create.page.viewHistory")} aria-expanded={historyOpen} onClick={() => setHistoryOpen(true)}><History aria-hidden="true" /><span>{t("create.history.title")}</span></button>
                    </header>
                    <div className={cn("creation-composer-stage is-home-mode", agentMode && "is-agent-mode")}>
                        <CreationModeTabs mode={mode} agentActive={agentMode} onAgentSelect={() => setAgentMode(true)} onModeChange={(next) => { setAgentMode(false); selectMode(next); }} />
                        {agentMode ? <CreationAgentEntry /> : <div className="creation-empty-composer"><CreationComposer {...composerProps} variant="empty" /></div>}
                    </div>
                    <CreationEmptySuggest
                        onStartPrompt={startPrompt}
                        onOpenLibrary={() => { setAgentMode(false); selectMode("image"); setLibraryOpen(true); }}
                    />
                </section>
                <CreationRecentCanvases onRequireLogin={() => openAuth()} />
                <Suspense fallback={<div className="creation-hall-loading" role="status">{t("create.page.hallLoading")}</div>}>
                    <InspirationHall onUse={(item) => startPrompt(item.mode, fillablePrompt(item))} />
                </Suspense>
                {inspirationSourcesVisible ? <div className="creation-source-notice">
                    <details>
                        <summary>{t("create.page.sourcesSummary")}</summary>
                        {declaredInspirationSources().map((source) => (
                            <p key={source.name ?? source.label}>
                                {source.notice}
                                {source.repository ? (
                                    <>
                                        {" "}
                                        <a href={source.repository} target="_blank" rel="noreferrer">
                                            {source.name} · {source.license}
                                        </a>
                                    </>
                                ) : null}
                            </p>
                        ))}
                    </details>
                </div> : null}
                </main>
            </> : <div className="creation-thread-workbench">
                <CreationWorkspaceToolbar onNewConversation={startNewConversation} onOpenHistory={() => setHistoryOpen(true)} shots={videoShots} onJumpToShot={jumpToShot} onContinueCanvas={() => void continueOnCanvas()} openingCanvas={openingCanvas} />
                <main ref={threadScrollRef} onScroll={handleThreadScroll} className="creation-thread-scroll creation-scrollbar">
                    <section className="creation-thread-stage"><div className="creation-results">{activeConversation.messages.map((item, index) => <div key={item.id} id={`creation-shot-${item.id}`} className="creation-thread-message"><CreationMessageView
                        item={item}
                        shotNumber={creationVideoShotOrdinal(videoShots, item)}
                        onRetryFailure={() => regenerateMessage(item, index)}
                        onRefreshResult={() => void refreshMessageResult(item)}
                        onRecoverMedia={() => void recoverMessageMedia(item)}
                        refreshingResult={resultRefreshIds.has(item.id)}
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
            acceptRemoteItems
            remoteItemDisabledReason={(asset) => creationLibraryDisabledReason(mode, asset.kind, videoReferenceLimits)}
            open={libraryOpen}
            items={libraryItems}
            categoryLabels={{ ...creationAssetCategoryLabels, ...externalAssetSources.categoryLabels }}
            folders={externalAssetSources.folders}
            initialSelectedIds={attachments.flatMap((item) => item.id.startsWith("asset:") ? [item.id.slice(6)] : item.id.startsWith("external:") ? [item.id] : [])}
            upload={{ accept: creationUploadAccept(mode), description: mode === "text" ? t("create.page.uploadHintText") : mode === "video" ? t("create.page.uploadHintVideo") : t("create.page.uploadHintImage"), onUpload: uploadLibraryAssets, external: { accept: "image/*", description: t("create.page.uploadHintEagle"), onUpload: (files, folderId) => externalAssetSources.uploadExternalFiles(files, folderId) } }}
            onClose={() => setLibraryOpen(false)}
            onConfirm={handleLibrarySelect}
        /></Suspense> : null}
    </>;
}
