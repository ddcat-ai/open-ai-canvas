import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { App, Spin } from "antd";
import { Tooltip } from "@/components/ui/base/tooltip";
import { History, Sparkles, Maximize2 } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useLocation, useNavigate } from "react-router";
import { useCreationHomeNavigation } from "./use-creation-home-navigation";
import { useCreationConversationRoute } from "./use-creation-conversation-route";
import { createCreationHistoryWriter, creationConversationPath, creationHistoryInput, restoreCreationConversation } from "./creation-conversation-history";

import type { AssetLibraryPickerItem } from "@/components/assets/asset-library-picker-modal";
import { generationErrorMessage } from "@/lib/generation-error";
import { isGenerationTaskCapacityError } from "@/lib/canvas/canvas-generation-batch";
import { creationResultAssetIds } from "@/lib/canvas/canvas-asset-handoff";
import { getActiveUserScope } from "@/lib/user-scope";
import { createClientId } from "@/lib/client-id";
import { continueCreationConversationOnCanvas } from "@/services/creation-canvas-conversation";
import { useExternalAssetSources } from "@/hooks/use-external-asset-sources";
import { modelCapabilityConfigFor, normalizeImageValue, normalizeVideoValue, videoDurationAllowed, videoDurationOptions } from "@/lib/model-capabilities";
import { imageParameterRequest, normalizeImageParameters } from "@/lib/image-parameters";
import { inferVideoOperation, modelGroupReferenceLimits, resolveCompatibleModel, mergedImageCapabilityConfig, type ModelRequirements } from "@/lib/model-selection";
import type { BackendGenerationResult } from "@/services/api/generation-task";
import type { Skill } from "@/services/api/skills";
import type { GenerationTask } from "@/services/api/task-center";
import { ApiError } from "@/services/api/request";
import { createAgentMemory, listAgentMemories, updateAgentMemory } from "@/services/api/agent-memories";
import {
    clearPendingCreationAgentSubmission,
    flushCreationConversationsSave,
    loadCreationConversations,
    loadPendingCreationAgentSubmission,
    pendingCreationTaskIds,
    queueCreationConversationsSave,
    removeCreationConversationSnapshot,
    removeStoredCreationConversation,
    savePendingCreationAgentSubmission,
    updateCreationConversationSnapshot,
} from "@/services/creation-conversation-store";
import { resolveModelChannel, resolveModelRequestConfig, selectableModelsByCapability, useEffectiveConfig } from "@/stores/use-config-store";
import {
    createAgentRun,
    decideAgentApproval,
    deleteAgentSession,
    getAgentRun,
    getAgentSession,
    isAgentAdmissionRejection,
    listAgentSessions,
    sendAgentInterjection,
    sendAgentMessage,
    subscribeAgentEvents,
    type CreateAgentRunInput,
} from "@/services/api/agent";
import { subscribeGenerationTasks } from "@/services/api/task-center";
import { creationConfigWithPreferences, useCreationAgentPreferences, useCreationPreferencesStore } from "@/stores/use-creation-preferences-store";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";
import { loadAssetsForUse, saveRemoteUserDataNow } from "@/services/user-data-sync";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { useUserStore } from "@/stores/use-user-store";
import type { PromptOptimizerProvider, SmartCreationAgentPlan, SmartCreationAgentProvider, SmartCreationTaskSettings } from "@/lib/plugins/plugin-types";
import { listRegisteredPlugins } from "@/lib/plugins/plugin-registry";
import { resolveSmartCreationExecution } from "@/lib/plugins/smart-creation-agent";
import { resolveSmartCreationPlugin, type SmartCreationRemotePolicy } from "@/lib/plugins/smart-creation-policy";
import { fetchSmartCreationPlugins } from "@/services/api/plugins";
import type { HomepageCreationGenerationRequest } from "@/lib/plugins/plugin-types";
import { promptOptimizerPlugin, PROMPT_OPTIMIZER_PLUGIN_ID } from "@/lib/plugins/builtin/prompt-optimizer";
import { createPluginHostContext } from "@/services/plugin-host";
import { usePluginStore } from "@/stores/use-plugin-store";
import {
    buildCreationMentionReferences,
    expandCreationPrompt,
    reconcileCreationAttachmentLimit,
    reconcileCreationAttachmentLimits,
    removeCreationReferenceTokens,
    replaceCreationAttachmentReference,
    selectedCreationReferences,
    type CreationReference,
    type CreationReferenceLimits,
} from "./creation-references";
import {
    creationAttachmentFromAsset,
    creationAttachmentFromAudio,
    creationAttachmentFromAudioAsset,
    creationAttachmentFromDocument,
    creationAttachmentFromExternalAsset,
    creationAttachmentFromImage,
    creationAttachmentFromVideo,
    creationAttachmentFromVideoAsset,
    creationAttachmentKind,
    creationAudioAsset,
    creationFileAccepted,
    creationImageAsset,
    creationMediaAspectRatio,
    creationUploadAccept,
    creationVideoAsset,
    removeCreationAttachment,
    splitCreationAttachments,
    type CreationAttachment,
} from "./creation-assets";
import {
    creationHasInput,
    creationModelCapability,
    defaultCreationMode,
    modeLabels,
    type CreationConversation,
    type CreationHistoryEntry,
    type CreationMessage,
    type CreationMode,
    type CreationRetryContext,
    type CreationSettings,
    type CreationShotRailEntry,
    type CreationStatus,
} from "./creation-types";
import {
    applyRecoveredCreationResult,
    attachCreationTaskContexts,
    bindCreationSubmissionTask,
    completedCreationGenerationTask,
    consumeCreationImageResults,
    conversationTimestamp,
    creationConversationMode,
    creationShotRail,
    creationVideoShotOrdinal,
    isImageAttachment,
    isVideoAttachment,
    materializeCreationTaskResults,
    mergeCreationTaskObservations,
    newConversation,
    newMessage,
    projectCreationTaskWaitFailure,
    reconcileCreationTaskMessages,
    recoverCreationGenerationSubmission,
    refreshCreationMessageTasks,
    selectCreationConversationMode,
    type PersistedCreationTask,
} from "./creation-conversations";
import { CreationComposer, CreationEmptySuggest, CreationHistoryDrawer, CreationMessageView, CreationWorkspaceToolbar, creationAssetCategoryLabels } from "./creation-workspace";
import { declaredInspirationSources } from "@/lib/inspirations/catalog";
import { fillablePrompt } from "@/lib/inspirations/resolve";
import { CreationRecentCanvases } from "./creation-recent-canvases";
import { CreationLoginDialog } from "./creation-login-dialog";
import { expandSmartCreationPlan, projectSmartCreationBatch, runSmartCreationSchedule } from "./smart-creation-runtime";
import { createCreationSubmitGate, createCreationSubmitGateRelease, withCreationSubmitGate } from "./creation-submit-gate";
import { creationVideoConfig } from "./creation-generation-config";
import { buildCreationAgentRunInput, creationAgentAttachmentSelection, creationAgentImageInputError, creationAgentImageReferenceLimit, creationManagedModelSelection } from "./creation-agent-request";
import {
    appendCreationAgentEvent,
    applyCreationAgentTaskState,
    assertCreationAgentSession,
    beginCreationAgentSubmission,
    bindCreationAgentSubmission,
    creationAgentConversationTitle,
    creationAgentHistoryGapKey,
    creationAgentRecoveryClient,
    creationAgentRetryRun,
    failCreationAgentSubmission,
    mergeCreationAgentConversation,
    mergeCreationConversationHistory,
    projectCreationAgentConversation,
    recoverCreationAgentHistory,
    restoreCreationAgentConversation,
    retryCreationHistoryRead,
    settleCreationAgentSubmission,
} from "./creation-agent-conversation";
import { CreationAgentReview } from "./creation-agent-review";
import { creationAgentRunsToStop, stopCreationAgentRuns } from "./creation-agent-cancel";
import { creationLibraryDisabledReason, creationLibrarySelectionToAttachments } from "./creation-library";
import { emptyAgentContextUsage, presentAgentContextUsage } from "@/lib/canvas/agent-context-usage";
import type { AgentPermissionMode } from "@/services/api/agent";
import { creationAgentInterjectionRun, pendingCreationAgentInterjection, submitCreationAgentInterjection, upsertCreationAgentInterjection } from "./creation-agent-interjection";

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

function smartPlanContext(plan: SmartCreationAgentPlan, brand: string) {
    const tasks = plan.tasks.map((task) => {
        const settings = task.settings;
        return `- ${task.title}（${task.purpose}）：${task.prompt}；画幅 ${settings.aspectRatio}；质量 ${settings.quality}；数量 ${settings.count}`;
    });
    return [
        `【${brand} 已确认的创作计划】`,
        `目标：${plan.intent}`,
        `平台：${plan.targetPlatform}${plan.targetMarket !== "UNKNOWN" ? ` / ${plan.targetMarket}` : ""}；语言：${plan.targetLanguage}`,
        ...(plan.visualDirection ? [`整套视觉指导：${plan.visualDirection}`] : []),
        ...(plan.styleBible ? [`统一风格锁：${plan.styleBible.globalPrompt}`] : []),
        ...tasks,
        "后续消息默认沿用此计划，只有用户明确修改时才调整；不要重复询问已经确定的内容。",
    ].join("\n");
}

function smartPlanSummary(plan: SmartCreationAgentPlan) {
    const target = plan.targetPlatform === "amazon" ? `Amazon ${plan.targetMarket} / ${plan.targetLanguage}` : "通用图片创作";
    const tasks = plan.tasks.map((task) => `${task.title}（${task.settings.count} 张）`).join("、");
    return `我已根据提示词和参考图完成规划：${target}；${tasks}。后续默认沿用这套方案，除非你明确要求修改。`;
}

function smartCreationMemoryRequest(plan: SmartCreationAgentPlan, conversationId: string, owner: { brand: string; pluginId: string }) {
    const target = plan.targetPlatform === "amazon" ? `Amazon ${plan.targetMarket} / ${plan.targetLanguage}` : "通用图片创作";
    return {
        topic: `${owner.pluginId}:smart-creation:${conversationId}`,
        category: "smart_creation",
        situation: `创作 Composer 对话中的智能创作方案（${target}）`,
        lesson: smartPlanContext(plan, owner.brand),
        steps: plan.tasks.map((task) => ({
            tool: owner.brand,
            action: `${task.title}：${task.prompt}`,
            note: `${task.settings.aspectRatio} / ${task.settings.quality} / ${task.settings.count} 张`,
        })),
        source: owner.pluginId,
    };
}

async function persistSmartCreationMemory(plan: SmartCreationAgentPlan, conversationId: string, owner: { brand: string; pluginId: string }) {
    const request = smartCreationMemoryRequest(plan, conversationId, owner);
    try {
        const existing = await listAgentMemories("approved", 200);
        const current = existing.memories.find((memory) => memory.category === request.category && memory.topic === request.topic);
        if (current) {
            await updateAgentMemory(current.id, request);
        } else {
            await createAgentMemory(request);
        }
    } catch (error) {
        // 记忆写入不应阻塞当前图片生成；当前会话仍会把计划保存在本地对话消息中。
        console.warn("智能创作计划未能同步到 Agent 记忆", error);
    }
}

function inheritedSmartCreationReferences(messages: CreationMessage[]) {
    const latest = [...messages].reverse().find((message) => message.attachments?.some(isImageAttachment));
    return (latest?.attachments || []).filter(isImageAttachment).map((attachment) => ({
        title: attachment.name || "历史参考图",
        url: attachment.previewUrl || attachment.url,
        dataUrl: attachment.dataUrl,
        storageKey: attachment.storageKey,
        kind: "image",
        mimeType: attachment.type,
    }));
}

function inheritedSmartCreationAttachments(messages: CreationMessage[]) {
    const latest = [...messages].reverse().find((message) => message.attachments?.some(isImageAttachment));
    return latest?.attachments?.filter(isImageAttachment) || [];
}

export default function CreatePage() {
    const [smartCreationActive, setSmartCreationActive] = useState(false);
    const [smartCreationPlanning, setSmartCreationPlanning] = useState(false);
    const { message: toast, modal } = App.useApp();
    const navigate = useNavigate();
    const location = useLocation();
    const [openingCanvas, setOpeningCanvas] = useState(false);
    const [loginDialogOpen, setLoginDialogOpen] = useState(false);
    const openingCanvasRef = useRef(false);
    const brandName = useAppearanceStore((state) => state.appearance.brandName);
    const sharedConfig = useEffectiveConfig();
    const creationModels = useCreationPreferencesStore((state) => state.preferences.models);
    const creationImagePreferences = useCreationPreferencesStore((state) => state.preferences.image);
    const config = useMemo(() => creationConfigWithPreferences(sharedConfig, { models: creationModels, image: creationImagePreferences }), [sharedConfig, creationModels, creationImagePreferences]);
    const composerPreferencesHydrated = useCreationPreferencesStore((state) => state.hydrated);
    const rememberMode = useCreationPreferencesStore((state) => state.rememberMode);
    const rememberImageSettings = useCreationPreferencesStore((state) => state.rememberImageSettings);
    const rememberVideoSettings = useCreationPreferencesStore((state) => state.rememberVideoSettings);
    const rememberActiveConversation = useCreationPreferencesStore((state) => state.rememberActiveConversation);
    const agentOutputPreference = useCreationPreferencesStore((state) => state.preferences.outputPreference || "concise");
    const rememberOutputPreference = useCreationPreferencesStore((state) => state.rememberOutputPreference);
    const promptOptimizerInstallation = usePluginStore((state) => state.installations.find((item) => item.manifest.id === PROMPT_OPTIMIZER_PLUGIN_ID));
    const promptOptimizerEnabled = usePluginStore((state) => state.pluginStates[PROMPT_OPTIMIZER_PLUGIN_ID]?.effectiveEnabled ?? Boolean(state.installations.find((item) => item.manifest.id === PROMPT_OPTIMIZER_PLUGIN_ID)?.enabled));
    const promptOptimizerProvider = useMemo<PromptOptimizerProvider | null>(() => {
        if (!promptOptimizerEnabled || !promptOptimizerInstallation || !promptOptimizerPlugin.createPromptOptimizer) return null;
        return promptOptimizerPlugin.createPromptOptimizer(createPluginHostContext(promptOptimizerPlugin, promptOptimizerInstallation, config));
    }, [config, promptOptimizerEnabled, promptOptimizerInstallation]);
    const smartCreationPlugins = useMemo(() => listRegisteredPlugins().filter((plugin) => plugin.createSmartCreationAgent && plugin.manifest.contributes.smartCreation), []);
    const smartCreationInstallations = usePluginStore((state) => state.installations);
    const smartCreationPluginStates = usePluginStore((state) => state.pluginStates);
    const smartCreationUserId = useUserStore((state) => state.user?.id);
    const inspirationSourcesVisible = useUserStore((state) => state.features.inspirationSourcesVisible);
    const activeTaskLimit = useUserStore((state) => state.runtimeLimits.activeTaskLimit);
    // 插件包里的最新策略由后端下发；插件更新后创作页刷新即可生效，无需改宿主代码。
    const [smartCreationRemotePolicies, setSmartCreationRemotePolicies] = useState<SmartCreationRemotePolicy[] | undefined>(undefined);
    useEffect(() => {
        if (!smartCreationUserId || !smartCreationPlugins.length) return;
        const controller = new AbortController();
        fetchSmartCreationPlugins({ signal: controller.signal })
            .then((policies) => setSmartCreationRemotePolicies(policies))
            // 请求失败时保留本地内置声明，智能创作入口仍可使用。
            .catch(() => undefined);
        return () => controller.abort();
    }, [smartCreationPluginStates, smartCreationUserId, smartCreationPlugins]);
    const smartCreationResolved = useMemo(
        () =>
            resolveSmartCreationPlugin({
                plugins: smartCreationPlugins,
                installations: smartCreationInstallations,
                effectiveEnabled: Object.fromEntries(Object.entries(smartCreationPluginStates).map(([id, state]) => [id, state.effectiveEnabled])),
                remote: smartCreationRemotePolicies,
            }),
        [smartCreationInstallations, smartCreationPluginStates, smartCreationPlugins, smartCreationRemotePolicies],
    );
    const smartCreationProvider = useMemo<SmartCreationAgentProvider | null>(() => {
        if (!smartCreationResolved?.plugin.createSmartCreationAgent) return null;
        const { plugin, installation, manifest } = smartCreationResolved;
        if (!plugin.createSmartCreationAgent) return null;
        return plugin.createSmartCreationAgent(createPluginHostContext({ ...plugin, manifest }, installation, config));
    }, [config, smartCreationResolved]);
    const smartCreationExecution = useMemo(() => resolveSmartCreationExecution(smartCreationResolved?.contribution), [smartCreationResolved]);
    const smartCreationLabel = smartCreationResolved?.contribution.label?.trim() || "智能创作";
    const smartCreationBrand = smartCreationResolved?.manifest.name || "智能创作";
    useEffect(() => {
        if (!smartCreationProvider) setSmartCreationActive(false);
    }, [smartCreationProvider]);
    const updateConfig = useCreationPreferencesStore((state) => state.rememberModel);
    const assets = useAssetStore((state) => state.assets);
    const addAsset = useAssetStore((state) => state.addAsset);
    const [conversations, setConversations] = useState<CreationConversation[]>([]);
    const conversationsRef = useRef<CreationConversation[]>([]);
    const conversationUserRef = useRef(smartCreationUserId);
    const recoveryTaskSnapshotRef = useRef<{ userId: string | undefined; tasks: Map<string, PersistedCreationTask> }>({ userId: smartCreationUserId, tasks: new Map() });
    const conversationSaveChainRef = useRef(Promise.resolve());
    const cloudHistoryWriterRef = useRef(createCreationHistoryWriter());
    const cloudHistoryFingerprintsRef = useRef(new Map<string, string>());
    const [cloudHistoryError, setCloudHistoryError] = useState("");
    const [conversationRetentionDays, setConversationRetentionDays] = useState<number | undefined>(undefined);
    const [activeId, setActiveId] = useState("");
    const activeIdRef = useRef("");
    const [hydrated, setHydrated] = useState(false);
    const [mode, setMode] = useState<CreationMode>(defaultCreationMode);
    const {
        agentPermissionMode,
        setAgentPermissionMode,
        agentImageSelectionMode,
        setAgentImageSelectionMode,
        agentVideoSelectionMode,
        setAgentVideoSelectionMode,
        agentImageParameterMode,
        setAgentImageParameterMode,
        agentVideoParameterMode,
        setAgentVideoParameterMode,
        agentBudget,
        setAgentBudget,
        agentImageSettings,
        setAgentImageSettings,
        agentVideoSettings,
        setAgentVideoSettings,
    } = useCreationAgentPreferences();
    const [agentConnectionError, setAgentConnectionError] = useState("");
    const [agentConnectionEpoch, setAgentConnectionEpoch] = useState(0);
    const [agentTaskSyncFailures, setAgentTaskSyncFailures] = useState<Set<string>>(new Set());
    const [agentTaskRecoveryEpoch, setAgentTaskRecoveryEpoch] = useState(0);
    const [agentApprovalSubmitting, setAgentApprovalSubmitting] = useState(false);
    const [agentApprovalBaseline, setAgentApprovalBaseline] = useState("");
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
    const [submittingMessageIds, setSubmittingMessageIds] = useState<Set<string>>(() => new Set());
    const [stoppingConversationId, setStoppingConversationId] = useState("");
    const stoppingConversationRef = useRef("");
    const [referenceReplacementBusy, setReferenceReplacementBusy] = useState(false);
    const [referencePasteBusy, setReferencePasteBusy] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [historyPending, setHistoryPending] = useState<CreationHistoryEntry[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historySyncError, setHistorySyncError] = useState("");
    const [historyRefreshEpoch, setHistoryRefreshEpoch] = useState(0);
    const [historyDeleteOpen, setHistoryDeleteOpen] = useState(false);
    const [libraryOpen, setLibraryOpen] = useState(false);
    const externalAssetSources = useExternalAssetSources(libraryOpen);
    const abortRef = useRef<AbortController | null>(null);
    const unmountedRef = useRef(false);
    const composerFocusRef = useRef<HTMLTextAreaElement>(null);
    const threadScrollRef = useRef<HTMLElement>(null);
    const launchpadRef = useRef<HTMLElement>(null);
    const reducedMotion = useReducedMotion();
    const [launchpadCondensed, setLaunchpadCondensed] = useState(false);
    const followLatestMessageRef = useRef(true);
    const taskSyncWarningRef = useRef(false);
    const activeGenerationTaskIdsRef = useRef(new Set<string>());
    const historyRecoveryDeletedRef = useRef(new Set<string>());
    const historySelectionRef = useRef<AbortController | null>(null);
    const retryPreparingRef = useRef(new Set<string>());
    const submitGateRef = useRef(createCreationSubmitGate());
    const smartPlanningGateRef = useRef(createCreationSubmitGate());
    const pendingRetryRef = useRef<{ context?: CreationRetryContext; lockKey: string } | null>(null);
    const [retrySequence, setRetrySequence] = useState(0);
    const [composerPreferencesInitialized, setComposerPreferencesInitialized] = useState(false);
    promptRef.current = prompt;
    attachmentsRef.current = attachments;

    const activeConversation = useMemo(() => conversations.find((item) => item.id === activeId), [activeId, conversations]);
    const activeAgentRun = activeConversation?.agentRuns?.find((run) => run.id === activeConversation.agentRunId);
    const agentAttachmentSelection = creationAgentAttachmentSelection(attachments);
    const agentInputError = creationAgentImageInputError(config, config.textModel, agentAttachmentSelection.imageCount);
    const agentContextView = useMemo(() => presentAgentContextUsage(activeConversation?.agentContextUsage || emptyAgentContextUsage("")), [activeConversation?.agentContextUsage]);
    const agentSettingsFingerprint = JSON.stringify({
        permissionMode: agentPermissionMode,
        imageModel: config.imageModel,
        videoModel: config.videoModel,
        imageSelectionMode: agentImageSelectionMode,
        videoSelectionMode: agentVideoSelectionMode,
        imageParameterMode: agentImageParameterMode,
        videoParameterMode: agentVideoParameterMode,
        imageSettings: agentImageSettings,
        videoSettings: agentVideoSettings,
        budget: agentBudget,
    });
    useEffect(() => {
        setAgentApprovalBaseline(activeConversation?.agentApproval?.approvalId ? agentSettingsFingerprint : "");
    }, [activeConversation?.agentApproval?.approvalId]);
    const agentApprovalSettingsChanged = Boolean(activeConversation?.agentApproval && agentApprovalBaseline && agentApprovalBaseline !== agentSettingsFingerprint);
    const historyConversations = useMemo(() => {
        const entries = new Map<string, CreationHistoryEntry>(conversations.filter((conversation) => conversation.id === activeId || conversation.messages.length > 0).map((conversation) => [conversation.agentSessionId || conversation.id, conversation]));
        for (const pending of historyPending) {
            if (historyRecoveryDeletedRef.current.has(pending.id)) continue;
            const cached = conversations.find((conversation) => conversation.agentSessionId === pending.id);
            entries.set(pending.id, { ...pending, ...cached, title: pending.title, updatedAt: pending.updatedAt, historyStatus: pending.historyStatus });
        }
        return [...entries.values()].sort((left, right) => conversationTimestamp(right.updatedAt) - conversationTimestamp(left.updatedAt));
    }, [activeId, conversations, historyPending]);
    const pendingApprovals = historyConversations.filter((conversation) => conversation.agentApproval);
    const pendingApproval = pendingApprovals.find((conversation) => conversation.id === activeId) || pendingApprovals[0];
    const preferredModel = mode === "text" || mode === "agent" ? config.textModel : mode === "image" ? config.imageModel : config.videoModel;
    const hasPrompt = Boolean(prompt.trim());
    const modelRequirements = useMemo<ModelRequirements>(
        () => ({
            capability: creationModelCapability(mode),
            input: {
                textCount: hasPrompt ? 1 : 0,
                imageCount: mode === "agent" ? 0 : attachments.filter(isImageAttachment).length,
                videoCount: mode === "agent" ? 0 : attachments.filter(isVideoAttachment).length,
                audioCount: mode === "agent" ? 0 : attachments.filter((attachment) => creationAttachmentKind(attachment) === "audio").length,
                characterCount: 0,
            },
            videoSeconds: mode === "video" ? seconds : undefined,
            imageSize: mode === "image" && !smartCreationActive ? ratio : undefined,
            options:
                mode === "image" && !smartCreationActive
                    ? (imageParameterRequest(modelCapabilityConfigFor(config, preferredModel).image!, { ...config, size: ratio, imageResolution, quality, count, imageParameters }) ?? {
                          size: ratio,
                          imageResolution,
                          quality,
                          count: Number(count),
                          transparentBackground: config.transparentBackground === "true",
                      })
                    : mode === "video"
                      ? { size: ratio, videoSeconds: Number(seconds), vquality: videoQuality }
                      : {},
        }),
        [attachments, config, preferredModel, count, hasPrompt, imageResolution, imageParameters, mode, quality, ratio, seconds, smartCreationActive, videoQuality],
    );
    const selectedModel = mode === "agent" ? preferredModel : resolveCompatibleModel(config, preferredModel, modelRequirements) || preferredModel;
    const generationConfig = useMemo(() => (mode === "video" ? creationVideoConfig(config, selectedModel, { ratio, seconds, videoQuality }) : config), [config, mode, ratio, seconds, selectedModel, videoQuality]);
    const imageProfile = useMemo(() => modelCapabilityConfigFor(config, selectedModel).image!, [config, selectedModel]);
    const videoProfile = useMemo(() => modelCapabilityConfigFor(config, selectedModel).video!, [config, selectedModel]);
    // 同名逻辑模型可能把文生视频、图生视频和全模态参考拆到不同路由。
    // 入口需要展示整个模型组的引用能力，添加素材后再由兼容路由选择具体模型。
    const videoReferenceLimits = useMemo(() => (mode === "video" ? modelGroupReferenceLimits(config, preferredModel || selectedModel, "video") || { maxImages: 0, maxVideos: 0, maxAudios: 0 } : undefined), [config, mode, preferredModel, selectedModel]);
    const maxReferences =
        mode === "video"
            ? (videoReferenceLimits?.maxImages || 0) + (videoReferenceLimits?.maxVideos || 0) + (videoReferenceLimits?.maxAudios || 0)
            : mode === "image"
              ? imageProfile.references.maxImages
              : creationAgentImageReferenceLimit(config, config.textModel);
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
    const pendingTaskIds = useMemo(() => pendingCreationTaskIds(activeConversation ? [activeConversation] : []), [activeConversation]);
    const recoveryTaskKey = useMemo(() => pendingTaskIds.filter((id) => !activeGenerationTaskIdsRef.current.has(id)).join("|"), [pendingTaskIds]);
    const videoShots = useMemo(() => creationShotRail(activeConversation?.messages || []), [activeConversation]);
    const jumpToShot = (shot: CreationShotRailEntry) => {
        const id = shot.result?.id;
        if (id) document.getElementById(`creation-shot-${id}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
    };

    useEffect(() => {
        writeComposerPref(TEXT_STREAMING_PREF_KEY, textStreaming);
        writeComposerPref(TEXT_THINKING_PREF_KEY, textThinking);
    }, [textStreaming, textThinking]);
    useEffect(() => {
        if (!composerPreferencesHydrated || composerPreferencesInitialized) return;
        const saved = useCreationPreferencesStore.getState().preferences;
        const nextMode = defaultCreationMode;
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
        let cancelled = false;
        const controller = new AbortController();
        const scope = getActiveUserScope();
        if (conversationUserRef.current !== smartCreationUserId) {
            historySelectionRef.current?.abort();
            conversationUserRef.current = smartCreationUserId;
            historyRecoveryDeletedRef.current.clear();
            setHistoryPending([]);
            conversationsRef.current = [];
            activeIdRef.current = "";
            setHydrated(false);
            setConversations([]);
            setActiveId("");
            setPrompt("");
            setAttachments([]);
            setDraftReferences([]);
            cloudHistoryWriterRef.current = createCreationHistoryWriter();
            cloudHistoryFingerprintsRef.current.clear();
            setCloudHistoryError("");
            setConversationRetentionDays(undefined);
        }
        if (!composerPreferencesHydrated) return;
        setHistoryLoading(Boolean(smartCreationUserId));
        setHistorySyncError("");
        void (async () => {
            let stored: CreationConversation[] | null = null;
            try {
                stored = await loadCreationConversations<CreationConversation>(scope);
            } catch (error) {
                if (!cancelled) toast.warning(error instanceof Error ? error.message : "本地草稿暂时无法恢复");
            }
            if (cancelled) return;
            if (!conversationsRef.current.length) {
                const restored = mergeCreationConversationHistory(stored || [], [], useCreationPreferencesStore.getState().preferences.activeConversationId);
                const next = restored.conversations.length ? restored.conversations : [newConversation()];
                const selected = next.find((item) => item.id === restored.activeId) || next[0];
                conversationsRef.current = next;
                activeIdRef.current = selected.id;
                setConversations(next);
                setActiveId(selected.id);
                setMode(creationConversationMode(selected));
            }
            setHydrated(true);
            if (smartCreationUserId)
                try {
                    const { sessions, deletedSessionIds = [], conversationRetentionDays: retentionDays } = await retryCreationHistoryRead(() => listAgentSessions({ surface: "creation", limit: 100, signal: controller.signal }), controller.signal);
                    if (cancelled) return;
                    setConversationRetentionDays(retentionDays);
                    for (const id of deletedSessionIds) historyRecoveryDeletedRef.current.add(id);
                    const retained = conversationsRef.current.filter((entry) => !historyRecoveryDeletedRef.current.has(entry.agentSessionId || entry.id));
                    if (retained.length !== conversationsRef.current.length) {
                        conversationsRef.current = retained.length ? retained : [newConversation()];
                        setConversations(conversationsRef.current);
                        if (!conversationsRef.current.some((entry) => entry.id === activeIdRef.current)) {
                            activeIdRef.current = conversationsRef.current[0].id;
                            setActiveId(activeIdRef.current);
                        }
                    }
                    // 目录只保存标题与时间；正文、事件和图片只在用户打开该会话时读取。
                    setHistoryPending((current) =>
                        sessions
                            .filter((session) => !historyRecoveryDeletedRef.current.has(session.id))
                            .map((session) => ({
                                ...projectCreationAgentConversation(session, []),
                                historyStatus: current.find((entry) => entry.id === session.id)?.historyStatus === "loading" ? "loading" : conversationsRef.current.some((entry) => entry.agentSessionId === session.id) ? undefined : "unloaded",
                            })),
                    );
                } catch (error) {
                    if (!cancelled) setHistorySyncError(error instanceof Error ? `Agent 历史暂时无法同步：${error.message}` : "Agent 历史暂时无法同步，请重试");
                }
        })().finally(() => {
            if (!cancelled) {
                setHistoryLoading(false);
            }
        });
        return () => {
            cancelled = true;
            controller.abort();
            // 页面卸载只停止当前页面的状态更新，后台任务由任务中心继续执行，返回页面后再恢复状态。
        };
    }, [smartCreationUserId, composerPreferencesHydrated, historyRefreshEpoch, toast]);

    useEffect(() => {
        unmountedRef.current = false;
        const flush = () => {
            void flushCreationConversationsSave(conversationSaveChainRef.current).catch(() => undefined);
        };
        window.addEventListener("pagehide", flush);
        return () => {
            window.removeEventListener("pagehide", flush);
            flush();
            unmountedRef.current = true;
            historySelectionRef.current?.abort();
            abortRef.current?.abort();
        };
    }, []);

    useEffect(() => {
        activeIdRef.current = activeId;
        if (hydrated && composerPreferencesHydrated && activeId) rememberActiveConversation(activeId);
    }, [activeId, hydrated, composerPreferencesHydrated, rememberActiveConversation]);

    useEffect(() => {
        conversationsRef.current = conversations;
        if (hydrated) {
            const save = queueCreationConversationsSave(conversationSaveChainRef.current, conversations, smartCreationUserId || "guest", { defer: true });
            conversationSaveChainRef.current = save;
            void save.catch(() => undefined);
        }
    }, [conversations, hydrated]);

    useEffect(() => {
        if (recoveryTaskSnapshotRef.current.userId !== smartCreationUserId) {
            recoveryTaskSnapshotRef.current = { userId: smartCreationUserId, tasks: new Map() };
        }
        mergeCreationTaskObservations(recoveryTaskSnapshotRef.current.tasks, [], pendingTaskIds);
        if (!hydrated || !recoveryTaskKey || !pendingTaskIds.length) return;
        // 当前页面主动提交的任务由 submit 自己等待并收尾；恢复监听只接管刷新前遗留的任务，避免同一任务被双重轮询。
        const recoverableTaskIds = pendingTaskIds.filter((id) => !activeGenerationTaskIdsRef.current.has(id));
        if (!recoverableTaskIds.length) return;
        let cancelled = false;
        const observationController = new AbortController();
        const applyTasks = async (tasks: GenerationTask[]) => {
            const runtime = await loadCreationRuntime();
            const contextual = attachCreationTaskContexts(tasks, conversationsRef.current);
            const persistedTasks = await materializeCreationTaskResults(runtime, contextual, observationController.signal);
            if (cancelled) return;
            const observedTasks = mergeCreationTaskObservations(recoveryTaskSnapshotRef.current.tasks, persistedTasks, recoverableTaskIds);
            taskSyncWarningRef.current = false;
            const attachable = persistedTasks.filter((task) => task.status === "succeeded" && Boolean(task.clientContext?.messageId) && Boolean(task.creationResultUrls?.length || task.creationResultStorageKeys?.length));
            for (const task of attachable) {
                try {
                    await runtime.consumeGenerationTaskMessage(
                        task,
                        task.clientContext!.messageId!,
                        async ({ effectKey, resultUrls, resultStorageKeys }) => {
                            if (cancelled) return;
                            await updateConversationMessage(
                                task.clientContext!.conversationId!,
                                task.clientContext!.messageId!,
                                (item) => runtime.applyGenerationConsumerEffect(item, effectKey, (current) => applyRecoveredCreationResult(current, resultUrls, resultStorageKeys, task.clientContext?.batchCount || current.taskIds?.length || 1)).value,
                            );
                        },
                        { signal: observationController.signal, materialize: async () => task, materializedUrls: runtime.generationTaskMaterializedUrls, materializedStorageKeys: runtime.generationTaskMaterializedStorageKeys },
                    );
                } catch (error) {
                    if (cancelled || observationController.signal.aborted) return;
                    console.warn("创作任务结果挂载失败，将使用已物化结果收敛消息状态", error);
                }
            }
            if (!cancelled) setConversations((current) => reconcileCreationTaskMessages(runtime, current, observedTasks));
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
    }, [hydrated, recoveryTaskKey, smartCreationUserId, toast]);

    const loadAddedSkills = useCallback(() => {
        if (addedSkillsRequestedRef.current) return;
        addedSkillsRequestedRef.current = true;
        void import("@/services/api/skills")
            .then(({ listAddedSkills }) => listAddedSkills())
            .then(({ skills }) => setAddedSkills(skills))
            .catch(() => setAddedSkills([]));
    }, []);

    useLayoutEffect(() => {
        if (isEmpty || !followLatestMessageRef.current) return;
        // 历史恢复与任务复核都在绘制前定位，避免先展示旧位置再跳到底部。
        const container = threadScrollRef.current;
        if (container) container.scrollTop = container.scrollHeight;
    }, [activeConversation?.id, activeConversation?.messages, isEmpty]);

    const updateConversation = useCallback((id: string, updater: (conversation: CreationConversation) => CreationConversation) => {
        const next = updateCreationConversationSnapshot(conversationsRef.current, id, updater);
        conversationsRef.current = next;
        setConversations(next);
        return next;
    }, []);
    const updateActive = useCallback((updater: (conversation: CreationConversation) => CreationConversation) => updateConversation(activeId, updater), [activeId, updateConversation]);

    const syncConversationHistory = useCallback(
        async (conversation: CreationConversation, title?: string) => {
            const scope = getActiveUserScope();
            if (!smartCreationUserId || scope !== smartCreationUserId) throw new Error("请先登录后保存会话");
            const id = await cloudHistoryWriterRef.current(conversation, scope, title);
            if (scope !== getActiveUserScope()) throw new Error("账号已切换，请重新打开会话");
            const current = conversationsRef.current.find((item) => item.id === conversation.id);
            if (current && current.agentSessionId !== id) {
                const next = updateConversation(current.id, (item) => ({ ...item, agentSessionId: id }));
                const save = queueCreationConversationsSave(conversationSaveChainRef.current, next, scope);
                conversationSaveChainRef.current = save;
                await save;
            }
            cloudHistoryFingerprintsRef.current.set(conversation.id, JSON.stringify(creationHistoryInput(conversation)));
            setCloudHistoryError("");
            return id;
        },
        [smartCreationUserId, updateConversation],
    );

    useEffect(() => {
        if (!hydrated || !smartCreationUserId) return;
        let cancelled = false;
        const timer = setTimeout(() => {
            void (async () => {
                for (const conversation of conversationsRef.current) {
                    if (cancelled) break;
                    if (!conversation.messages.length || historyRecoveryDeletedRef.current.has(conversation.agentSessionId || conversation.id)) continue;
                    if (cloudHistoryFingerprintsRef.current.get(conversation.id) === JSON.stringify(creationHistoryInput(conversation))) continue;
                    try {
                        await syncConversationHistory(conversation);
                    } catch (error) {
                        if (!cancelled) setCloudHistoryError(`会话已缓存到本机，云端同步未完成：${error instanceof Error ? error.message : "请稍后重试"}`);
                    }
                }
            })();
        }, 500);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [conversations, hydrated, smartCreationUserId, syncConversationHistory]);

    useEffect(() => {
        const id = activeConversation?.id;
        const runId = activeConversation?.agentRunId;
        const run = activeConversation?.agentRuns?.find((item) => item.id === runId);
        if (!id || !runId || !run || ["completed", "failed", "cancelled", "rejected"].includes(run.status)) return;
        const after = Math.max(0, ...(run.events || []).map((event) => event.seq));
        const scope = getActiveUserScope();
        setAgentConnectionError("");
        return subscribeAgentEvents(
            runId,
            (event) => {
                if (scope !== getActiveUserScope()) return;
                const next = updateCreationConversationSnapshot(conversationsRef.current, id, (conversation) => appendCreationAgentEvent(conversation, event));
                conversationsRef.current = next;
                setConversations(next);
                if (
                    event.type.startsWith("user_interjection") ||
                    event.type === "approval_requested" ||
                    event.type === "user_question" ||
                    (event.type === "run_status" && ["completed", "failed", "cancelled", "rejected"].includes(String(event.payload?.status)))
                ) {
                    const saved = queueCreationConversationsSave(conversationSaveChainRef.current, next, scope);
                    conversationSaveChainRef.current = saved;
                    void saved.catch(() => undefined);
                }
            },
            {
                after,
                onError: (error) => {
                    if (scope === getActiveUserScope()) setAgentConnectionError(error instanceof Error ? error.message : "Agent 连接中断");
                },
            },
        );
    }, [activeConversation?.id, activeConversation?.agentRunId, agentConnectionEpoch]);

    const agentHistoryGapKey = useMemo(() => creationAgentHistoryGapKey(activeConversation), [activeConversation]);
    useEffect(() => {
        const id = activeConversation?.id;
        if (!hydrated || !id || !agentHistoryGapKey || !smartCreationUserId) return;
        const controller = new AbortController();
        const scope = getActiveUserScope();
        const current = () => (!controller.signal.aborted && scope === getActiveUserScope() && activeIdRef.current === id ? conversationsRef.current.find((conversation) => conversation.id === id) : undefined);
        void recoverCreationAgentHistory(current, creationAgentRecoveryClient, controller.signal)
            .then((restored) => {
                if (!restored || !current()) return;
                updateConversation(id, (latest) => mergeCreationAgentConversation(latest, restored));
                setAgentConnectionError("");
            })
            .catch((error) => {
                if (current()) setAgentConnectionError(error instanceof Error ? error.message : "原任务记录暂时无法同步，请重新连接");
            });
        return () => controller.abort();
    }, [hydrated, activeConversation?.id, agentHistoryGapKey, smartCreationUserId, agentConnectionEpoch, updateConversation]);

    const activeAgentTaskKey = activeConversation?.agentSessionId ? activeConversation.messages.flatMap((message) => message.taskIds || []).join("|") : "";
    useEffect(() => {
        setAgentTaskSyncFailures(new Set());
        const id = activeConversation?.id;
        const taskIds = [...new Set(activeAgentTaskKey.split("|").filter(Boolean))];
        if (!id || !taskIds.length) return;
        let active = true;
        const scope = getActiveUserScope();
        const apply = (task: GenerationTask) => {
            if (!active || scope !== getActiveUserScope()) return;
            setAgentTaskSyncFailures((current) => {
                if (!current.has(task.id)) return current;
                const next = new Set(current);
                next.delete(task.id);
                return next;
            });
            const next = updateCreationConversationSnapshot(conversationsRef.current, id, (conversation) => applyCreationAgentTaskState(conversation, task));
            conversationsRef.current = next;
            setConversations(next);
            if (["succeeded", "failed", "cancelled"].includes(task.status)) {
                const saved = queueCreationConversationsSave(conversationSaveChainRef.current, next, scope);
                conversationSaveChainRef.current = saved;
                void saved.catch(() => undefined);
            }
        };
        const unsubscribe = subscribeGenerationTasks(taskIds, apply, (taskId) => {
            if (!active || scope !== getActiveUserScope()) return;
            setAgentTaskSyncFailures((current) => (current.has(taskId) ? current : new Set([...current, taskId])));
        });
        return () => {
            active = false;
            unsubscribe();
        };
    }, [activeConversation?.id, activeAgentTaskKey, agentTaskRecoveryEpoch]);

    const updateConversationMessage = useCallback(async (conversationId: string, id: string, updater: (item: CreationMessage) => CreationMessage) => {
        const next = updateCreationConversationSnapshot(conversationsRef.current, conversationId, (conversation) => ({
            ...conversation,
            updatedAt: new Date().toISOString(),
            messages: conversation.messages.map((item) => (item.id === id ? updater(item) : item)),
        }));
        conversationsRef.current = next;
        setConversations(next);
        const save = queueCreationConversationsSave(conversationSaveChainRef.current, next, conversationUserRef.current || "guest");
        conversationSaveChainRef.current = save;
        await save;
    }, []);

    const selectMode = (requested: CreationMode) => {
        const next = requested === "text" ? "agent" : requested;
        if (next !== "image") setSmartCreationActive(false);
        setMode(next);
        updateActive((conversation) => selectCreationConversationMode(conversation, next));
        if (next !== "agent") rememberMode(next);
        const capability = next === "agent" ? "text" : next;
        const nextModels = selectableModelsByCapability(config, capability);
        const current = capability === "text" ? config.textModel : capability === "image" ? config.imageModel : config.videoModel;
        if (!nextModels.includes(current) && nextModels[0]) {
            updateConfig(capability === "text" ? "textModel" : capability === "image" ? "imageModel" : "videoModel", nextModels[0]);
        }
    };

    const executeSmartCreationPlan = async (plan: SmartCreationAgentPlan, requestAttachments: CreationAttachment[], displayPrompt = plan.intent, parentUserMessageId?: string) => {
        if (!plan.tasks.length) throw new Error("智能创作计划没有可执行任务");
        const { tasks: generationTasks, truncated } = expandSmartCreationPlan(plan, smartCreationExecution);
        if (!generationTasks.length) throw new Error("智能创作计划没有可执行任务");
        if (truncated) toast.warning(`计划共 ${generationTasks.length + truncated} 张，已按插件上限提交前 ${generationTasks.length} 张`);
        const batchId = `smart-creation-batch:${Date.now()}`;
        const batchSettings = generationTasks[0]?.settings;
        const batchUserMessage = newMessage("user", displayPrompt, {
            mode: "image",
            model: selectedModel,
            attachments: requestAttachments,
            settings: {
                ratio: batchSettings?.aspectRatio || ratio,
                seconds,
                quality: batchSettings?.quality || quality,
                videoQuality,
                count: String(generationTasks.length),
            },
            batchId,
            batchTotal: generationTasks.length,
        });
        const batchAssistantMessage = newMessage("assistant", "", {
            mode: "image",
            model: selectedModel,
            status: "pending",
            settings: batchUserMessage.settings,
            batchId,
            batchTotal: generationTasks.length,
            batchCompletedCount: 0,
            batchFailedCount: 0,
        });
        updateActive((conversation) => {
            const nextMessages = parentUserMessageId
                ? conversation.messages
                      .map((message) =>
                          message.id === parentUserMessageId ? { ...message, batchId, batchTotal: generationTasks.length, settings: message.settings ? { ...message.settings, count: String(generationTasks.length) } : batchUserMessage.settings } : message,
                      )
                      .concat(batchAssistantMessage)
                : [...conversation.messages, batchUserMessage, batchAssistantMessage];
            return {
                ...conversation,
                title: conversation.messages.length ? conversation.title : displayPrompt.slice(0, 24),
                updatedAt: new Date().toISOString(),
                messages: nextMessages,
            };
        });
        // 在并发窗口内逐张提交：账号任务数满时等空位，而不是一次推满后被后端拒绝。
        const concurrency = Math.max(1, Math.min(smartCreationExecution.maxConcurrency, activeTaskLimit || smartCreationExecution.maxConcurrency));
        const outcomes = await runSmartCreationSchedule(
            generationTasks,
            (task) =>
                submit(undefined, undefined, {
                    source: "smart-creation-agent",
                    batchId,
                    batchMessageId: batchAssistantMessage.id,
                    batchTotal: generationTasks.length,
                    prompt: task.prompt,
                    itemId: task.itemId,
                    queuePosition: task.position,
                    queueSize: generationTasks.length,
                    imageCount: 1,
                    planVersion: plan.planVersion,
                    targetPlatform: plan.targetPlatform,
                    targetMarket: plan.targetMarket,
                    targetLanguage: plan.targetLanguage,
                    styleFingerprint: plan.styleBible?.fingerprint,
                    settings: { ...task.settings, count: 1 },
                    attachments: requestAttachments,
                    displayPrompt: `${task.title}（${task.position}/${generationTasks.length}） · ${displayPrompt}`,
                }),
            {
                concurrency,
                capacityWaitMs: smartCreationExecution.capacityWaitMs,
                anchorFirst: smartCreationExecution.anchorFirst,
                isCapacityError: isGenerationTaskCapacityError,
            },
        );
        const rejected = outcomes.filter((outcome) => outcome.status === "rejected").length;
        if (rejected === generationTasks.length) {
            const reason = outcomes.find((outcome) => outcome.status === "rejected");
            throw reason?.status === "rejected" && reason.reason instanceof Error ? reason.reason : new Error("智能创作任务全部提交失败");
        }
        toast.success(`${smartCreationBrand} 已提交 ${generationTasks.length - rejected} 张图片任务${rejected ? `，${rejected} 张提交失败` : ""}，结果将聚合返回`);
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
        const normalized = normalizeVideoValue(videoProfile, { seconds, ratio, resolution: value });
        setVideoQuality(normalized.resolution.replace(/p$/i, ""));
        setSeconds(normalized.seconds);
        if (mode === "video") rememberVideoSettings({ videoQuality: value });
        if (mode === "video") rememberVideoSettings({ seconds: normalized.seconds });
    };
    const setComposerCount = (value: string) => {
        setCount(value);
        if (mode === "image") rememberImageSettings({ count: value });
    };

    const externalLibraryItems = useMemo<AssetLibraryPickerItem[]>(
        () =>
            externalAssetSources.items.map((item) => ({
                ...item,
                disabledReason: creationLibraryDisabledReason(mode, item.external?.item.kind, videoReferenceLimits),
            })),
        [externalAssetSources.items, mode, videoReferenceLimits],
    );
    const libraryItems = useMemo<AssetLibraryPickerItem[]>(
        () => [
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
        ],
        [assets, externalLibraryItems, mode, videoReferenceLimits],
    );
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
        const settled = await Promise.allSettled(
            next.map(async (file) => {
                const { asset } = await uploadCreationAsset(file);
                return asset ? addAsset(asset) : "";
            }),
        );
        const assetIds = settled.flatMap((entry) => (entry.status === "fulfilled" && entry.value ? [entry.value] : []));
        const failed = settled.filter((entry) => entry.status === "rejected");
        if (assetIds.length) toast.success(`${assetIds.length} 个素材已上传到素材库并自动选中`);
        if (failed.length) toast.error(`${failed.length} 个素材上传失败，请重试`);
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
            const reconciled = mode === "video" && videoReferenceLimits ? reconcileCreationAttachmentLimits(candidates, [], videoReferenceLimits) : reconcileCreationAttachmentLimit(candidates, [], maxReferences);
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

        const result = replaceCreationAttachmentReference(promptRef.current, currentAttachments, targetAttachmentId, { ...replacement, role: target.role || replacement.role });
        promptRef.current = result.prompt;
        attachmentsRef.current = result.attachments;
        setPrompt(result.prompt);
        setAttachments(result.attachments);
        return true;
    }, []);

    const replaceReferenceFromTrack = useCallback(
        (targetAttachmentId: string, replacement: CreationAttachment) => {
            try {
                if (replaceAttachmentReference(targetAttachmentId, replacement)) toast.success("参考图已替换，槽位不变，提示词无需修改");
            } catch (error) {
                toast.error(error instanceof Error ? error.message : "参考图替换失败");
            }
        },
        [replaceAttachmentReference, toast],
    );

    const replaceReferenceFromFiles = useCallback(
        async (targetAttachmentId: string, files: File[]) => {
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
        },
        [addAsset, busy, referenceReplacementBusy, replaceAttachmentReference, toast],
    );

    const addPastedReferenceFiles = useCallback(
        async (files: File[]) => {
            if (busy || referenceReplacementBusy || referencePasteBusy) return;
            const imageFiles = files.filter((file) => file.type.startsWith("image/"));
            if (!imageFiles.length) return;
            const availableSlots = Math.max(0, maxReferences - attachmentsRef.current.length);
            if (!availableSlots) {
                toast.warning(`当前模型最多支持 ${maxReferences} 个参考内容`);
                return;
            }
            const acceptedFiles = imageFiles.slice(0, availableSlots);
            setReferencePasteBusy(true);
            try {
                const settled = await Promise.allSettled(acceptedFiles.map((file) => uploadCreationAsset(file)));
                const uploads = settled.flatMap((entry) => (entry.status === "fulfilled" ? [entry.value] : []));
                const nextAttachments = uploads.map((item) => item.attachment).filter((attachment) => creationAttachmentKind(attachment) === "image");
                uploads.forEach(({ asset }) => {
                    if (asset) addAsset(asset);
                });
                if (nextAttachments.length) {
                    const candidates = [...attachmentsRef.current, ...nextAttachments];
                    const reconciled = mode === "video" && videoReferenceLimits ? reconcileCreationAttachmentLimits(candidates, mentionReferences, videoReferenceLimits) : reconcileCreationAttachmentLimit(candidates, mentionReferences, maxReferences);
                    attachmentsRef.current = reconciled.attachments;
                    setAttachments(reconciled.attachments);
                    if (reconciled.removedReferences.length) setPrompt((current) => removeCreationReferenceTokens(current, reconciled.removedReferences));
                    toast.success(`${nextAttachments.length} 张图片已添加为参考内容`);
                }
                const failed = settled.filter((entry) => entry.status === "rejected");
                if (failed.length) toast.error(`${failed.length} 张图片粘贴失败，请重试`);
                if (imageFiles.length > acceptedFiles.length) toast.warning(`已添加前 ${acceptedFiles.length} 张图片，当前模型最多支持 ${maxReferences} 个参考内容`);
            } finally {
                setReferencePasteBusy(false);
            }
        },
        [addAsset, busy, maxReferences, mentionReferences, mode, referencePasteBusy, referenceReplacementBusy, toast, videoReferenceLimits],
    );

    type HomepageGenerationOverride = Omit<HomepageCreationGenerationRequest, "styleFingerprint"> & {
        styleFingerprint?: string;
        attachments?: CreationAttachment[];
        displayPrompt?: string;
        source?: "homepage-agent" | "smart-creation-agent";
        batchId?: string;
        batchMessageId?: string;
        batchTotal?: number;
        planVersion?: string;
        targetPlatform?: string;
        targetMarket?: string;
        targetLanguage?: string;
        settings?: SmartCreationTaskSettings;
        imageCount?: number;
    };

    const submitSmartCreation = async () => {
        const text = prompt.trim();
        if (!smartCreationProvider || mode !== "image" || !text || busy || smartCreationPlanning || !activeConversation) return;
        const currentAttachments = [...attachmentsRef.current];
        const explicitlyDropsReferences = /(不要|不需要|去掉|移除|忽略).{0,12}(参考图|参考图片|图片|素材)/i.test(text);
        const inheritedAttachments = currentAttachments.length || explicitlyDropsReferences ? [] : inheritedSmartCreationAttachments(activeConversation.messages);
        const requestAttachments = Array.from(new Map([...currentAttachments, ...inheritedAttachments].map((attachment) => [attachment.storageKey || attachment.id, attachment])).values());
        const originConversationId = activeConversation.id;
        const references = selectedCreationReferences(text, mentionReferences);
        const settings = { ratio, seconds, quality, videoQuality, count };
        const previousPlan = [...activeConversation.messages].reverse().find((message) => message.agentPlan)?.agentPlan;
        const conversation = activeConversation.messages.filter((message) => message.content.trim()).map((message) => ({ role: message.role, content: message.content }));
        if (previousPlan) conversation.push({ role: "assistant", content: smartPlanContext(previousPlan, smartCreationBrand) });
        conversation.push({ role: "user", content: text });
        const currentReferences = mentionReferences
            .filter((reference) => reference.active)
            .map((reference) => ({ title: reference.title || reference.label, url: reference.previewUrl, storageKey: reference.storageKey, kind: reference.kind, text: reference.text }));
        const inheritedReferences = currentAttachments.length || explicitlyDropsReferences ? [] : inheritedSmartCreationReferences(activeConversation.messages);
        const agentReferences = Array.from(new Map([...currentReferences, ...inheritedReferences].map((reference) => [reference.storageKey || reference.url || reference.title, reference])).values());
        const planningUserMessage = newMessage("user", text, { mode: "image", model: selectedModel, attachments: requestAttachments, references, settings });
        const planningAssistantMessage = newMessage("assistant", "正在理解你的提示词和参考图，规划生成方案…", { mode: "text", model: selectedModel, status: "streaming", settings });
        followLatestMessageRef.current = true;
        updateActive((conversationItem) => ({
            ...conversationItem,
            title: conversationItem.messages.length ? conversationItem.title : text.slice(0, 24),
            updatedAt: new Date().toISOString(),
            messages: [...conversationItem.messages, planningUserMessage, planningAssistantMessage],
        }));
        setSmartCreationPlanning(true);
        let planningCompleted = false;
        let executionStarted = false;
        try {
            const response = await smartCreationProvider.plan({
                conversation,
                generationMode: "image",
                targetModel: selectedModel,
                targetProtocol: resolveModelChannel(config, selectedModel).interfaceType,
                references: agentReferences,
            });
            const plan = response.plan;
            if (!plan) throw new Error(response.message || "智能创作 Agent 没有返回可执行计划");
            if (plan.questions.length) {
                await updateConversationMessage(originConversationId, planningAssistantMessage.id, (item) => ({
                    ...item,
                    content: response.message || `为了准确生成，我只需要确认：\n- ${plan.questions[0]}`,
                    status: "done",
                    agentPlan: plan,
                }));
                planningCompleted = true;
                setPrompt("");
                return;
            }
            await updateConversationMessage(originConversationId, planningAssistantMessage.id, (item) => ({
                ...item,
                content: smartPlanSummary(plan),
                status: "done",
                agentPlan: plan,
            }));
            planningCompleted = true;
            setPrompt("");
            setAttachments([]);
            setDraftReferences([]);
            void persistSmartCreationMemory(plan, originConversationId, { brand: smartCreationBrand, pluginId: smartCreationResolved?.manifest.id || "smart-creation" });
            executionStarted = true;
            await executeSmartCreationPlan(plan, requestAttachments, text, planningUserMessage.id);
        } catch (error) {
            if (!planningCompleted || executionStarted) {
                await updateConversationMessage(originConversationId, planningAssistantMessage.id, (item) => ({
                    ...item,
                    content: executionStarted ? "智能创作生成失败，请重试。" : "智能创作规划失败，请检查需求或重试。",
                    status: "error",
                    error: error instanceof Error ? error.message : String(error),
                }));
            }
            toast.error(error instanceof Error ? error.message : "智能创作规划失败，请重试");
        } finally {
            setSmartCreationPlanning(false);
        }
    };

    const stopCreationGeneration = async () => {
        const conversation = activeConversation;
        if (!conversation?.agentSessionId || busy || stoppingConversationRef.current) return;
        const scope = getActiveUserScope();
        stoppingConversationRef.current = conversation.id;
        setStoppingConversationId(conversation.id);
        try {
            await stopCreationAgentRuns(conversation, (run) => {
                if (unmountedRef.current || scope !== getActiveUserScope()) return;
                updateConversation(conversation.id, (current) =>
                    mergeCreationAgentConversation(
                        current,
                        projectCreationAgentConversation({ id: conversation.agentSessionId!, title: current.title, surface: "creation", status: "active", revision: 0, createdAt: run.createdAt, updatedAt: run.updatedAt }, [run]),
                    ),
                );
            });
            if (!unmountedRef.current && scope === getActiveUserScope()) toast.success("Agent 已停止；已提交的图片、视频继续生成并正常计费，可继续发送新需求");
        } catch (error) {
            if (!unmountedRef.current && scope === getActiveUserScope()) toast.error(error instanceof Error ? error.message : "未能确认停止，请重试");
        } finally {
            stoppingConversationRef.current = "";
            if (!unmountedRef.current) setStoppingConversationId("");
        }
    };

    const interjectCreationAgent = async (conversation: CreationConversation, text: string, messageId?: string, heldToken?: symbol): Promise<boolean> => {
        if ((!heldToken && busy) || stoppingConversationRef.current === conversation.id) return false;
        const token = heldToken || submitGateRef.current.tryAcquire();
        if (!token) return false;
        const scope = getActiveUserScope();
        const assertCurrent = () => {
            if (scope !== getActiveUserScope() || unmountedRef.current) throw new Error("账号或页面已切换，原补充说明仍保留在原会话");
            if (!conversationsRef.current.some((item) => item.id === conversation.id && item.agentSessionId === conversation.agentSessionId)) throw new Error("原会话已关闭，请从历史核对补充说明");
        };
        let accepted = false;
        const clearAcceptedDraft = () => {
            const current = conversationsRef.current.find((item) => item.id === conversation.id);
            if (activeIdRef.current === conversation.id && current && creationConversationMode(current) === "agent" && promptRef.current.trim() === text && !attachmentsRef.current.length) {
                setPrompt("");
                setDraftReferences([]);
            }
        };
        setBusy(true);
        try {
            if (!messageId && (await loadPendingCreationAgentSubmission(conversation.id))) throw new Error("上一条 Agent 创建回执仍待确认，请先核对原任务，再发送补充说明");
            assertCurrent();
            const result = await submitCreationAgentInterjection(
                { conversation, text, messageId, attachments: messageId ? undefined : attachmentsRef.current },
                {
                    assertCurrent,
                    accepted: () => {
                        accepted = true;
                    },
                    createId: () => `interjection-${createClientId()}`,
                    read: async (id, after) => (await getAgentRun(id, undefined, { sinceSeq: after, fromStart: after === 0, eventLimit: 500 })).run,
                    send: sendAgentInterjection,
                    observe: (run) =>
                        updateConversation(conversation.id, (current) =>
                            mergeCreationAgentConversation(
                                current,
                                projectCreationAgentConversation({ id: conversation.agentSessionId!, title: current.title, surface: "creation", status: "active", revision: 0, createdAt: run.createdAt, updatedAt: run.updatedAt }, [run]),
                            ),
                        ),
                    save: async (message) => {
                        assertCurrent();
                        const next = updateConversation(conversation.id, (current) => upsertCreationAgentInterjection(current, message));
                        const persisted = queueCreationConversationsSave(conversationSaveChainRef.current, next, scope);
                        conversationSaveChainRef.current = persisted;
                        await persisted;
                    },
                },
            );
            assertCurrent();
            if (result.message.agentInterjection === "undelivered") {
                toast.warning(result.message.error || "本轮已结束，补充说明未送达；草稿已保留");
                return false;
            }
            clearAcceptedDraft();
            return true;
        } catch (error) {
            if (accepted) {
                if (scope === getActiveUserScope() && !unmountedRef.current) {
                    clearAcceptedDraft();
                    toast.warning("补充说明已被原轮次接收，本地记录暂未同步；可从历史核对，不需要再次发送");
                }
                return true;
            }
            if (scope === getActiveUserScope() && !unmountedRef.current) toast.warning(error instanceof Error ? error.message : "补充说明回执待确认，请核对原消息");
            return false;
        } finally {
            setBusy(false);
            submitGateRef.current.release(token);
        }
    };

    const submitCreationAgent = async (textOverride?: string, conversationOverride?: CreationConversation, replanning = false, action?: { retry?: CreateAgentRunInput["retry"]; recoverPending?: boolean }): Promise<boolean> => {
        let conversation = conversationOverride || conversationsRef.current.find((item) => item.id === activeIdRef.current) || activeConversation;
        const text = (textOverride ?? prompt).trim();
        if ((!action && !creationHasInput("agent", text, attachments)) || busy || !conversation || stoppingConversationRef.current === conversation.id) return false;
        if (!action && agentInputError) {
            toast.warning(agentInputError);
            return false;
        }
        const submittedConversation = conversation;
        let parentRunId = conversation.agentRunId;
        const submitToken = submitGateRef.current.tryAcquire();
        if (!submitToken) return false;
        const conversationId = conversation.id;
        const submissionId = `agent-submission-${conversationId}`;
        const scope = getActiveUserScope();
        const assertScope = () => {
            if (scope !== getActiveUserScope()) throw new Error("账号已切换，请重新打开创作会话");
        };
        const submittedAttachmentKeys = attachments.map((item) => item.storageKey || item.id).join("|");
        let mayClearDraft = true;
        const clearSubmittedDraft = () => {
            if (action || !mayClearDraft || activeIdRef.current !== conversationId || promptRef.current.trim() !== text || attachmentsRef.current.map((item) => item.storageKey || item.id).join("|") !== submittedAttachmentKeys) return;
            setPrompt("");
            setAttachments([]);
            setDraftReferences([]);
        };
        setBusy(true);
        followLatestMessageRef.current = true;
        let submissionKey: string | undefined;
        let recoveringPending = false,
            requestSent = false,
            accepted = false;
        try {
            const pending = await loadPendingCreationAgentSubmission(conversationId);
            recoveringPending = Boolean(pending);
            if (pending) parentRunId = pending.parentRunId;
            if (pending) mayClearDraft = text === pending.prompt && attachments.map((item) => item.storageKey).join("|") === (pending.request.attachments || []).map((item) => item.storageKey).join("|");
            assertScope();
            if (action?.recoverPending && !pending) throw new Error("待确认请求已处理，请刷新本会话后查看结果");
            const sessionId = pending?.sessionId || (await syncConversationHistory({ ...conversation, title: conversation.messages.length ? conversation.title : creationAgentConversationTitle(text, attachments) }));
            assertScope();
            if (activeIdRef.current === conversationId) conversationRoute.show(sessionId, true);
            const snapshot = pending || conversation.agentSessionId ? await getAgentSession(sessionId) : undefined;
            assertScope();
            if (snapshot) {
                assertCreationAgentSession(snapshot.session, snapshot.runs);
                const projected = projectCreationAgentConversation(snapshot.session, snapshot.runs);
                const merged = updateConversation(conversationId, (current) => mergeCreationAgentConversation(current, projected));
                conversation = merged.find((item) => item.id === conversationId) || conversation;
                // A different tab may have added a newer requirement. Fresh
                // submissions follow that run; unknown submissions keep their
                // original immutable parent and request identity.
                if (!pending) parentRunId = projected.agentRunId;
            }
            if (pending && snapshot?.runs.some((run) => run.idempotencyKey === pending.key)) {
                accepted = true;
                const restored = await restoreCreationAgentConversation(sessionId, creationAgentRecoveryClient);
                assertScope();
                const merged = updateConversation(conversationId, (current) => mergeCreationAgentConversation(current, restored));
                conversation = merged.find((item) => item.id === conversationId) || conversation;
                await clearPendingCreationAgentSubmission(conversationId, scope, pending.key);
                assertScope();
                // A received run is a fact even if the user has since edited
                // the composer. Confirm it before comparing the old request
                // fingerprint, then send new text only to its active run.
                if (!action && !mayClearDraft) {
                    if (!replanning && (creationAgentInterjectionRun(conversation) || pendingCreationAgentInterjection(conversation))) return await interjectCreationAgent(conversation, text, undefined, submitToken);
                    toast.warning("原请求已确认，当前草稿已保留；请核对最新结果后发送");
                    return false;
                }
                clearSubmittedDraft();
                return true;
            }
            if (!pending && !action && !replanning && (creationAgentInterjectionRun(conversation) || pendingCreationAgentInterjection(conversation))) return await interjectCreationAgent(conversation, text, undefined, submitToken);
            if (parentRunId) {
                const parent = snapshot?.runs.find((run) => run.id === parentRunId) || (await getAgentRun(parentRunId)).run;
                assertScope();
                if (parent.sessionId !== sessionId || parent.canvasId || parent.surface !== "creation") throw new Error("此轮次不属于当前首页会话，请从对应历史入口继续");
                if (!pending && (parent.cleanupPending || ["queued", "running", "waiting_approval"].includes(parent.status))) {
                    toast.warning(parent.status === "waiting_approval" ? "请先处理当前待审批计划" : "Agent 正在运行，请等待本轮结束后继续");
                    return false;
                }
            }
            assertScope();
            updateConversation(conversationId, (current) =>
                beginCreationAgentSubmission(current, {
                    id: submissionId,
                    prompt: pending?.prompt ?? text,
                    attachments: action || pending ? [] : attachments,
                    references: action || pending ? [] : draftReferences,
                    silent: Boolean(action?.retry || pending?.request.retry),
                    createdAt: new Date().toISOString(),
                    model: config.textModel,
                }),
            );
            const key = pending?.key || createClientId();
            const imageSelection = config.imageModel ? creationManagedModelSelection(config, config.imageModel) : undefined;
            const videoSelection = config.videoModel ? creationManagedModelSelection(config, config.videoModel) : undefined;
            const request =
                action && pending
                    ? pending.request
                    : buildCreationAgentRunInput({
                          conversation: pending ? submittedConversation : conversation,
                          retry: action?.retry,
                          prompt: text,
                          idempotencyKey: key,
                          sessionId,
                          permissionMode: agentPermissionMode,
                          textSelection: creationManagedModelSelection(config, config.textModel),
                          imageSelection,
                          videoSelection,
                          imageParameters: { selectionMode: agentImageSelectionMode, parameterMode: replanning ? "auto" : agentImageParameterMode, size: agentImageSettings.size, quality: agentImageSettings.quality, count: agentImageSettings.count },
                          videoParameters: {
                              selectionMode: agentVideoSelectionMode,
                              parameterMode: replanning ? "auto" : agentVideoParameterMode,
                              size: agentVideoSettings.size,
                              quality: agentVideoSettings.quality,
                              durationSeconds: agentVideoSettings.durationSeconds,
                          },
                          budget: agentBudget,
                          attachments: action ? [] : attachments,
                          attachmentMode: action ? "inherit" : agentAttachmentSelection.attachmentMode,
                          outputPreference: pending ? pending.request.outputPreference : agentOutputPreference,
                          skillIds: addedSkills.filter((skill) => text.includes(`/${skill.skillName}`)).map((skill) => skill.skillId),
                      });
            const effectiveParentRunId = action && pending ? pending.parentRunId : parentRunId;
            const fingerprint = JSON.stringify({ ...request, idempotencyKey: "", parentRunId: effectiveParentRunId });
            if (pending && pending.fingerprint !== fingerprint) throw new Error("上次 Agent 请求结果待确认，请保持原提示词和设置后重试，避免重复提交");
            submissionKey = key;
            if (!pending) await savePendingCreationAgentSubmission(conversationId, { sessionId, key, fingerprint, prompt: text, request, parentRunId, createdAt: new Date().toISOString() });
            assertScope();
            const bound = updateConversation(conversationId, (current) => bindCreationAgentSubmission(current, submissionId, sessionId, key));
            const persisted = queueCreationConversationsSave(conversationSaveChainRef.current, bound, scope);
            conversationSaveChainRef.current = persisted;
            await persisted;
            assertScope();
            requestSent = true;
            const response = effectiveParentRunId ? await sendAgentMessage(effectiveParentRunId, request) : await createAgentRun(request);
            if (!response.run?.id) throw new Error("Agent 未返回运行回执，请恢复原请求核对结果");
            accepted = true;
            assertScope();
            const run = { ...response.run, userPrompt: response.run.userPrompt ?? request.prompt, sessionId };
            const session = {
                id: sessionId,
                title: conversation.title === "新创作" ? creationAgentConversationTitle(text, attachments) : conversation.title,
                surface: "creation",
                status: "active",
                revision: 0,
                createdAt: conversation.updatedAt,
                updatedAt: run.updatedAt,
            };
            const projected = projectCreationAgentConversation(session, [...(conversation.agentRuns || []), run]);
            updateConversation(conversationId, (current) => settleCreationAgentSubmission(current, projected, submissionId));
            await clearPendingCreationAgentSubmission(conversationId, scope, key);
            clearSubmittedDraft();
            void restoreCreationAgentConversation(sessionId, creationAgentRecoveryClient)
                .then((restored) => {
                    if (scope !== getActiveUserScope()) return;
                    const current = conversationsRef.current.find((item) => item.id === conversationId);
                    if (current?.agentRunId === run.id) updateConversation(conversationId, (latest) => mergeCreationAgentConversation(latest, restored));
                })
                .catch(() => undefined);
            return true;
        } catch (error) {
            if (accepted) {
                if (scope === getActiveUserScope()) {
                    clearSubmittedDraft();
                    toast.warning("Agent 请求已提交，本地恢复记录暂未清理；请从当前会话或历史查看进度");
                }
                return true;
            }
            let rejectedKey: string | undefined;
            let cleanupError: unknown;
            if (submissionKey && !recoveringPending && (!requestSent || isAgentAdmissionRejection(error))) {
                try {
                    await clearPendingCreationAgentSubmission(conversationId, scope, submissionKey);
                    rejectedKey = submissionKey;
                } catch (cause) {
                    cleanupError = cause;
                }
            }
            if (scope === getActiveUserScope()) {
                const failure = error instanceof Error ? error.message : "Agent 请求失败；运行记录仍可从历史恢复";
                const detail = cleanupError ? `${failure}；本地待确认记录未能清理（${cleanupError instanceof Error ? cleanupError.message : "存储不可用"}），已保留原请求以便恢复核对` : failure;
                updateConversation(conversationId, (current) => failCreationAgentSubmission(current, submissionId, detail, rejectedKey));
                toast.error(detail);
            }
            return false;
        } finally {
            setBusy(false);
            submitGateRef.current.release(submitToken);
        }
    };

    const decideCreationApproval = async (decision: "approve" | "reject" | "refresh"): Promise<CreationConversation | undefined> => {
        const conversation = activeConversation;
        const approval = conversation?.agentApproval;
        const runId = conversation?.agentRunId;
        if (!conversation?.agentSessionId || !runId || !approval || agentApprovalSubmitting) return;
        if (decision === "approve" && agentApprovalSettingsChanged) {
            toast.error("设置已变更，请填写备注修改方案后重新审批");
            return;
        }
        const scope = getActiveUserScope();
        setAgentApprovalSubmitting(true);
        try {
            const current = (await getAgentRun(runId)).run;
            if (current.surface !== "creation" || current.canvasId || current.sessionId !== conversation.agentSessionId) throw new Error("此审批不属于当前首页会话，请在对应画布中处理");
            if (current.status !== "waiting_approval" || current.approval?.approvalId !== approval.approvalId) throw new Error("审批状态已变化，已重新读取会话，请核对最新方案");
            if (scope !== getActiveUserScope()) throw new Error("账号已切换，请重新打开创作会话");
            await decideAgentApproval(runId, approval.approvalId, decision);
            const restored = await restoreCreationAgentConversation(conversation.agentSessionId, creationAgentRecoveryClient);
            if (scope !== getActiveUserScope()) return;
            updateConversation(conversation.id, (current) => mergeCreationAgentConversation(current, restored));
            if (decision === "refresh") toast.success("报价已更新，核对后可继续批准");
            return { ...restored, id: conversation.id };
        } catch (error) {
            if (scope !== getActiveUserScope()) return;
            toast.error(error instanceof Error ? error.message : "审批未能提交，请核对运行状态");
            try {
                const restored = await restoreCreationAgentConversation(conversation.agentSessionId, creationAgentRecoveryClient);
                if (scope === getActiveUserScope()) updateConversation(conversation.id, (current) => mergeCreationAgentConversation(current, restored));
            } catch {
                /* Keep the last reviewable plan until recovery succeeds. */
            }
        } finally {
            setAgentApprovalSubmitting(false);
        }
    };

    const modifyCreationPlan = async (notes: string): Promise<boolean> => {
        const plan = activeConversation?.agentCommercePlan;
        if (!plan || busy || agentApprovalSubmitting || !notes.trim()) return false;
        let conversation = activeConversation;
        if (conversation.agentApproval) {
            const restored = await decideCreationApproval("reject");
            if (!restored) return false;
            conversation = restored;
        }
        const text = `请根据备注修改方案 ${plan.planId} 第 ${plan.version} 版。原创作目标：${plan.intent}；平台/站点 ${plan.platform}/${plan.site}，语言 ${plan.language}，共 ${plan.items.length} 项。未提及的产品身份、素材角色、规格与文案沿用本会话最新方案；备注覆盖冲突的旧要求。

修改备注：${notes.trim()}

请使用同一计划 ID、递增版本，重新规划完整方案、风格锁定与真实报价。${agentPermissionMode === "auto" ? "沿用当前自动执行权限与预算继续生成，不额外请求确认。" : agentPermissionMode === "read_only" ? "沿用当前只读权限，仅更新方案，不生成媒体。" : "沿用当前执行权限与预算，按原有权限流程继续处理。"}`;
        return submitCreationAgent(text, conversation, true);
    };

    const submit = async (retryContext?: CreationRetryContext, retryLockKey?: string, generationOverride?: HomepageGenerationOverride, bypassSmartCreation = false) => {
        if (!generationOverride && mode === "agent") return submitCreationAgent();
        if (!generationOverride && !bypassSmartCreation && smartCreationActive && smartCreationProvider && mode === "image") {
            await withCreationSubmitGate(smartPlanningGateRef.current, submitSmartCreation);
            return;
        }
        const releaseRetryLock = () => {
            if (retryLockKey) retryPreparingRef.current.delete(retryLockKey);
        };
        const smartBatchSubmission = generationOverride?.source === "smart-creation-agent";
        const submitToken = smartBatchSubmission ? null : submitGateRef.current.tryAcquire();
        if (!smartBatchSubmission && !submitToken) {
            releaseRetryLock();
            if (generationOverride) throw new Error("已有创作任务正在运行，请等待当前任务完成");
            return;
        }
        const releaseSubmitGate = submitToken ? createCreationSubmitGateRelease(submitGateRef.current, submitToken) : () => undefined;
        const text = (generationOverride?.prompt || prompt).trim();
        if (!text || (!smartBatchSubmission && busy) || !activeConversation) {
            releaseRetryLock();
            releaseSubmitGate();
            if (generationOverride) throw new Error("Agent 运行时缺少可用的创作会话");
            return;
        }
        const originConversationId = activeConversation.id;
        const requestScope = getActiveUserScope();
        const requestModel = generationOverride?.settings?.model?.trim() || selectedModel;
        if (!requestModel) {
            toast.warning(`请先在设置中配置${modeLabels[mode]}模型`);
            releaseRetryLock();
            releaseSubmitGate();
            if (generationOverride) throw new Error("请先在设置中配置图片模型");
            return;
        }
        if (mode === "video" && !videoDurationAllowed(videoProfile, Number(seconds), videoQuality)) {
            toast.error("当前模型不支持所选视频时长，请重新选择");
            releaseRetryLock();
            releaseSubmitGate();
            return;
        }
        const requestAttachments = generationOverride?.attachments || attachments;
        const unsupportedReference = requestAttachments.map((attachment) => creationLibraryDisabledReason(mode, creationAttachmentKind(attachment), videoReferenceLimits)).find(Boolean);
        if (unsupportedReference) {
            toast.warning(`${unsupportedReference}；原草稿已保留，请移除不支持的素材或切换模式`);
            releaseRetryLock();
            releaseSubmitGate();
            if (generationOverride) throw new Error(unsupportedReference);
            return;
        }
        const reconciledAttachments =
            mode === "video" && videoReferenceLimits ? reconcileCreationAttachmentLimits(requestAttachments, mentionReferences, videoReferenceLimits) : reconcileCreationAttachmentLimit(requestAttachments, mentionReferences, maxReferences);
        if (reconciledAttachments.attachments !== requestAttachments) {
            toast.warning("参考内容超出当前模型能力，请移除不支持的素材或切换模型；原草稿已保留");
            releaseRetryLock();
            releaseSubmitGate();
            if (generationOverride) throw new Error("参考素材不符合当前图片模型限制");
            return;
        }
        const requestCount = generationOverride?.imageCount ? String(generationOverride.imageCount) : generationOverride?.source !== "smart-creation-agent" && generationOverride?.queueSize ? "1" : count;
        const requestRatio = generationOverride?.settings?.aspectRatio || ratio;
        const requestQuality = generationOverride?.source === "smart-creation-agent" ? imageProfile.quality.default || "auto" : generationOverride?.settings?.quality || quality;
        const settings = { ratio: requestRatio, seconds, quality: requestQuality, videoQuality, count: requestCount, ...(mode === "image" ? { imageResolution, imageParameters, transparentBackground: config.transparentBackground } : {}) };
        const references = selectedCreationReferences(text, mentionReferences);
        // 后端对图片和视频使用不同的参考字段；这里先拆分，避免媒体类型在写入任务时被误判。
        const { referenceImages, referenceVideos, referenceAudios } = splitCreationAttachments(requestAttachments);
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
            if (requestScope !== getActiveUserScope()) throw new Error("账号已切换，未提交原账号的生成请求");
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "生成运行时加载失败");
            releaseRetryLock();
            releaseSubmitGate();
            if (generationOverride) throw error;
            return;
        }
        let skillExecution: Awaited<ReturnType<typeof runtime.skillRuntime.prepare>>;
        try {
            skillExecution = await runtime.skillRuntime.prepare({
                profile: "creation",
                prompt: expandCreationPrompt(text, references, requestAttachments),
                skills: skillReferences,
                selectedSkillIds: skillReferences.map((skill) => skill.skillId),
            });
            if (requestScope !== getActiveUserScope()) throw new Error("账号已切换，未提交原账号的生成请求");
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "技能上下文加载失败");
            releaseRetryLock();
            releaseSubmitGate();
            if (generationOverride) throw error;
            return;
        }
        const expandedPrompt = skillExecution.prompt;
        const referenceMetadata: Record<string, unknown> = { ...skillExecution.metadata };
        followLatestMessageRef.current = true;
        const batchSubmission = Boolean(generationOverride?.batchMessageId);
        const clientOperationId = retryContext?.clientOperationId || createClientId();
        const trackSubmission = !batchSubmission && (mode === "image" || mode === "video");
        const userMessage = newMessage("user", generationOverride?.displayPrompt || text, { mode, model: requestModel, attachments: requestAttachments, references, settings });
        const assistantMessage = batchSubmission
            ? ({ id: generationOverride!.batchMessageId!, createdAt: new Date().toISOString() } as CreationMessage)
            : newMessage("assistant", "", { mode, model: requestModel, status: mode === "text" && textStreaming ? "streaming" : "pending", settings, ...retryContext, clientOperationId, ...(trackSubmission ? { submissionPending: true } : {}) });
        const updateOriginAssistant = (updater: (item: CreationMessage) => CreationMessage) => updateConversationMessage(originConversationId, assistantMessage.id, updater);
        // 仅表示本页请求仍在发送；不落盘，刷新后仍按原操作身份核对回执。
        const finishSubmitting = () =>
            setSubmittingMessageIds((ids) => {
                if (!ids.has(assistantMessage.id)) return ids;
                const next = new Set(ids);
                next.delete(assistantMessage.id);
                return next;
            });
        if (trackSubmission) setSubmittingMessageIds((ids) => new Set(ids).add(assistantMessage.id));
        const boundTaskIds = new Set<string>();
        const boundTaskIdsByBatchIndex = new Map<number, string>();
        const boundTasks = new Map<string, GenerationTask>();
        const bindTask = (task: GenerationTask) => {
            const taskAccepted = task.status !== "failed" && task.status !== "cancelled" && !task.errorCode;
            if (typeof task.clientContext?.batchIndex === "number") boundTaskIdsByBatchIndex.set(task.clientContext.batchIndex, task.id);
            boundTaskIds.add(task.id);
            activeGenerationTaskIdsRef.current.add(task.id);
            boundTasks.set(task.id, task);
            if (taskAccepted) releaseSubmitGate();
            updateOriginAssistant((item) => bindCreationSubmissionTask(item, task));
            if (taskAccepted && abortRef.current === controller) {
                abortRef.current = null;
                setBusy(false);
                // 任务已经建出来了：提交阶段到此结束。立刻放闸，这样上一条还在生成时
                // 也能继续提交下一条，不必等它跑完。
                releaseSubmitGate();
            }
        };
        if (!batchSubmission)
            updateActive((conversation) => ({
                ...conversation,
                title: conversation.messages.length ? conversation.title : text.slice(0, 24),
                updatedAt: new Date().toISOString(),
                messages: [...conversation.messages, userMessage, assistantMessage],
            }));
        if (!generationOverride && activeIdRef.current === originConversationId) {
            setPrompt("");
            setAttachments([]);
            setDraftReferences([]);
        }
        setBusy(true);
        const controller = new AbortController();
        const requestLifecycle = runtime.beginGenerationConsumer(controller.signal);
        abortRef.current = controller;
        const normalizedImage =
            mode === "image"
                ? imageProfile.parameters
                    ? { size: generationOverride?.settings?.size || requestRatio, quality: requestQuality, imageResolution, imageParameters, count: requestCount }
                    : normalizeImageValue(
                          imageProfile,
                          { size: generationOverride?.settings?.size || requestRatio, quality: requestQuality, imageResolution, imageParameters, count: requestCount },
                          resolveModelRequestConfig(config, requestModel).interfaceType,
                      )
                : undefined;
        const requestConfig = {
            ...generationConfig,
            model: requestModel,
            imageModel: requestModel,
            imageResolution: normalizedImage?.imageResolution || imageResolution,
            imageParameters: normalizedImage?.imageParameters || imageParameters,
            videoModel: requestModel,
            textModel: requestModel,
            ...(mode === "image" ? { size: normalizedImage?.size || requestRatio, quality: normalizedImage?.quality || requestQuality, count: normalizedImage?.count || requestCount, videoSeconds: config.videoSeconds } : {}),
        };
        try {
            // 先保存本次操作标识。创建回执丢失或刷新后仍能沿原请求恢复。
            if (trackSubmission) await updateOriginAssistant((item) => item);
            const current = conversationsRef.current.find((item) => item.id === originConversationId);
            if (!current) throw new Error("创作会话已关闭，未提交生成请求");
            const creationSessionId = await syncConversationHistory(current);
            referenceMetadata.creationSessionId = creationSessionId;
            if (activeIdRef.current === originConversationId) conversationRoute.show(creationSessionId, true);
            if (requestScope !== getActiveUserScope()) throw new Error("账号已切换，未提交原账号的生成请求");
            if (mode === "text") {
                const result = await runtime.runGenerationOperationOnce(clientOperationId, () =>
                    runtime.runBackendGenerationTask({
                        mode: "text",
                        prompt: expandedPrompt,
                        config: requestConfig,
                        referenceImages,
                        referenceVideos,
                        referenceAudios,
                        textHistory: (activeConversation.messages || []).filter((item) => item.content.trim()).map((item) => ({ role: item.role, content: item.content })),
                        signal: requestLifecycle.signal,
                        metadata: {
                            source: generationOverride?.source || (generationOverride ? "homepage-agent" : "create-page"),
                            conversationId: activeConversation.id,
                            messageId: assistantMessage.id,
                            ...(generationOverride?.itemId
                                ? { homepageItemId: generationOverride.itemId, queuePosition: generationOverride.queuePosition, queueSize: generationOverride.queueSize, styleFingerprint: generationOverride.styleFingerprint }
                                : {}),
                            ...(generationOverride?.targetLanguage ? { targetLanguage: generationOverride.targetLanguage } : {}),
                            ...(generationOverride?.targetPlatform ? { targetPlatform: generationOverride.targetPlatform, targetMarket: generationOverride.targetMarket, planVersion: generationOverride.planVersion } : {}),
                            ...referenceMetadata,
                        },
                        onTaskUpdate: bindTask,
                        streamText: textStreaming,
                        enableThinking: textThinking,
                        onTextDelta: textStreaming ? (value) => updateOriginAssistant((item) => ({ ...item, content: value })) : undefined,
                        ...retryContext,
                        clientOperationId,
                    }),
                );
                if (!result.text?.trim()) throw new Error("后端任务没有返回文本");
                updateOriginAssistant((item) => ({ ...item, content: result.text || "", reasoning: result.reasoning }));
            } else if (mode === "image") {
                const taskCount = generationOverride?.imageCount
                    ? Math.max(1, Math.min(imageProfile.maxOutputs, Math.floor(generationOverride.imageCount)))
                    : generationOverride?.source !== "smart-creation-agent" && generationOverride?.queueSize
                      ? 1
                      : Math.max(1, Math.min(imageProfile.maxOutputs, Math.floor(Number(count) || 1)));
                const settled = await runtime.runGenerationOperationOnce(clientOperationId, () =>
                    runtime.runBackendGenerationTaskBatch({
                        mode: "image",
                        prompt: expandedPrompt,
                        config: { ...requestConfig, count: "1" },
                        referenceImages,
                        signal: requestLifecycle.signal,
                        metadata: {
                            source: generationOverride?.source || (generationOverride ? "homepage-agent" : "create-page"),
                            conversationId: activeConversation.id,
                            messageId: assistantMessage.id,
                            ...(generationOverride?.itemId
                                ? { homepageItemId: generationOverride.itemId, queuePosition: generationOverride.queuePosition, queueSize: generationOverride.queueSize, styleFingerprint: generationOverride.styleFingerprint }
                                : {}),
                            ...(generationOverride?.targetLanguage ? { targetLanguage: generationOverride.targetLanguage } : {}),
                            ...(generationOverride?.targetPlatform ? { targetPlatform: generationOverride.targetPlatform, targetMarket: generationOverride.targetMarket, planVersion: generationOverride.planVersion } : {}),
                            ...referenceMetadata,
                        },
                        onTaskUpdate: bindTask,
                        count: taskCount,
                        onSubmissionUnconfirmed: finishSubmitting,
                        ...retryContext,
                        clientOperationId,
                    }),
                );
                if (requestLifecycle.signal.aborted) throw new DOMException("Aborted", "AbortError");
                const boundTaskIdList = Array.from(boundTaskIds);
                const generatedTasks = settled.flatMap((entry, batchIndex) => {
                    if (entry.status !== "fulfilled") return [];
                    return [
                        {
                            result: entry.value,
                            taskId: boundTaskIdsByBatchIndex.get(batchIndex) || boundTaskIdList[batchIndex],
                            batchIndex,
                        },
                    ];
                });
                const unconfirmed = settled.filter((entry): entry is PromiseRejectedResult => entry.status === "rejected" && runtime.isGenerationSubmissionUnconfirmed(entry.reason));
                const taskFailures = settled.filter((entry): entry is PromiseRejectedResult => entry.status === "rejected" && !runtime.isGenerationSubmissionUnconfirmed(entry.reason));
                const storedImages = await Promise.allSettled(
                    generatedTasks.map(async ({ result, taskId, batchIndex }) => {
                        if (!taskId) throw new Error("生成任务缺少稳定任务标识");
                        const task = completedCreationGenerationTask(runtime, {
                            taskId,
                            task: boundTasks.get(taskId),
                            mode: "image",
                            prompt: expandedPrompt,
                            result,
                            conversationId: activeConversation.id,
                            messageId: assistantMessage.id,
                            batchIndex,
                            batchCount: taskCount,
                        });
                        return consumeCreationImageResults(runtime, task, assistantMessage.id, taskCount, updateOriginAssistant, requestLifecycle.signal);
                    }),
                );
                const successfulImages = storedImages.flatMap((entry) => (entry.status === "fulfilled" ? entry.value : []));
                const resourceFailures = storedImages.filter((entry) => entry.status === "rejected");
                const failedCount = taskFailures.length + resourceFailures.length;
                const completedCount = successfulImages.length;
                if (!completedCount) {
                    const reason = unconfirmed[0]?.reason || taskFailures[0]?.reason || resourceFailures[0]?.reason;
                    throw reason instanceof Error ? reason : new Error("后端任务没有返回图片");
                }
                if (failedCount) toast.warning(`${completedCount} 张图片已生成，${failedCount} 张生成失败`);
                if (!batchSubmission) updateOriginAssistant((item) => ({ ...item, content: failedCount ? `${completedCount} 张图片已生成，${failedCount} 张失败` : "图片已生成" }));
            } else {
                const result = await runtime.runGenerationOperationOnce(clientOperationId, () =>
                    runtime.runBackendGenerationTask({
                        mode: "video",
                        prompt: expandedPrompt,
                        config: requestConfig,
                        referenceImages,
                        referenceVideos,
                        referenceAudios,
                        signal: requestLifecycle.signal,
                        metadata: { source: "create-page", conversationId: activeConversation.id, messageId: assistantMessage.id, videoEditOperation: videoOperation, ...referenceMetadata },
                        onTaskUpdate: bindTask,
                        onSubmissionUnconfirmed: finishSubmitting,
                        ...retryContext,
                        clientOperationId,
                    }),
                );
                if (!result.video?.dataUrl) throw new Error("后端任务没有返回视频");
                const taskId = Array.from(boundTaskIds)[0];
                if (!taskId) throw new Error("生成任务缺少稳定任务标识");
                const task = completedCreationGenerationTask(runtime, { taskId, task: boundTasks.get(taskId), mode: "video", prompt: expandedPrompt, result, conversationId: activeConversation.id, messageId: assistantMessage.id });
                const materialized = await runtime.consumeGenerationTaskMessage(
                    task,
                    assistantMessage.id,
                    async ({ resultUrls, resultStorageKeys, effectKey }) => {
                        await updateOriginAssistant(
                            (item) => runtime.applyGenerationConsumerEffect(item, effectKey, (current) => ({ ...current, status: "done" as const, content: "视频已生成", resultUrls, ...(resultStorageKeys.length ? { resultStorageKeys } : {}) })).value,
                        );
                    },
                    { signal: requestLifecycle.signal },
                );
                if (!runtime.generationTaskMaterializedUrls(materialized)[0]) throw new Error("视频结果资源不可用");
            }
            if (!batchSubmission) {
                const submissionPending = trackSubmission && (await runtime.hasPendingGenerationSubmission(clientOperationId));
                await updateOriginAssistant((item) => ({ ...item, status: submissionPending ? "pending" : "done", submissionPending: submissionPending || undefined }));
            }
        } catch (error) {
            // 批次任务在提交阶段就被账号任务上限拒绝时，交还调度器等空位重试，不计入批次失败。
            if (batchSubmission && !boundTaskIds.size && isGenerationTaskCapacityError(error)) throw error;
            if (trackSubmission && (runtime.isGenerationSubmissionUnconfirmed(error) || (await runtime.hasPendingGenerationSubmission(clientOperationId)))) {
                await updateOriginAssistant((item) => ({ ...item, status: "pending", submissionPending: true, error: undefined, generationErrorCode: undefined }));
                return;
            }
            const cancelled = runtime.isGenerationTaskCancelled(error, requestLifecycle.signal);
            await updateOriginAssistant((item) =>
                projectCreationTaskWaitFailure({ ...item, submissionPending: undefined }, error, {
                    cancelled,
                    unmounted: unmountedRef.current,
                    boundTaskCount: boundTaskIds.size,
                    batchSubmission,
                    batchTotal: generationOverride?.batchTotal || item.batchTotal || 0,
                    operation: mode === "video" ? videoOperation : mode,
                }),
            );
            if ((!batchSubmission && cancelled) || (unmountedRef.current && boundTaskIds.size > 0)) return;
            if (generationOverride) throw error;
        } finally {
            if (trackSubmission) finishSubmitting();
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
        void submit(pending.context, pending.lockKey, undefined, true);
    }, [retrySequence]);

    const startNewConversation = () => {
        cancelHistorySelection();
        const next = newConversation();
        followLatestMessageRef.current = true;
        conversationsRef.current = [next, ...conversationsRef.current];
        setConversations(conversationsRef.current);
        activeIdRef.current = next.id;
        setActiveId(next.id);
        setMode(defaultCreationMode);
        setPrompt("");
        setAttachments([]);
        setDraftReferences([]);
        setHistoryOpen(false);
        void navigate("/", { replace: false });
    };

    const continueOnCanvas = async (selectedAssetIds?: string[]) => {
        if (!activeConversation || openingCanvasRef.current) return;
        openingCanvasRef.current = true;
        setOpeningCanvas(true);
        const scope = getActiveUserScope();
        const source = activeConversation;
        try {
            const assets = useAssetStore.getState().assets;
            const generatedAssetIds =
                selectedAssetIds ||
                source.messages.flatMap((item) => {
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
            if (assetIds.length) await saveRemoteUserDataNow([]);
            const result = await continueCreationConversationOnCanvas(source);
            if (scope !== getActiveUserScope()) return;
            const next = updateCreationConversationSnapshot(conversationsRef.current, source.id, (item) => ({ ...item, canvasId: result.id }));
            conversationsRef.current = next;
            setConversations(next);
            const saved = queueCreationConversationsSave(conversationSaveChainRef.current, next, scope);
            conversationSaveChainRef.current = saved;
            await saved;
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
        } finally {
            openingCanvasRef.current = false;
            setOpeningCanvas(false);
        }
    };

    const refreshHistory = () => setHistoryRefreshEpoch((current) => current + 1);
    const openHistory = () => {
        setHistoryOpen(true);
        refreshHistory();
    };

    const cancelHistorySelection = () => {
        historySelectionRef.current?.abort();
        historySelectionRef.current = null;
        setHistoryPending((current) => current.map((entry) => (entry.historyStatus === "loading" ? { ...entry, historyStatus: "unloaded" } : entry)));
    };

    const selectConversation = async (conversation: CreationConversation, options: { fromRoute?: boolean; signal?: AbortSignal } = {}) => {
        cancelHistorySelection();
        const controller = new AbortController();
        options.signal?.addEventListener("abort", () => controller.abort(), { once: true, signal: controller.signal });
        if (options.signal?.aborted) controller.abort();
        historySelectionRef.current = controller;
        const scope = getActiveUserScope();
        let selected = conversation;
        const sessionId = conversation.agentSessionId;
        if (sessionId) {
            setHistoryPending((current) => [...current.filter((entry) => entry.id !== sessionId), { ...conversation, id: sessionId, historyStatus: "loading" }]);
            try {
                const incoming = await restoreCreationConversation(sessionId, controller.signal);
                if (controller.signal.aborted || scope !== getActiveUserScope()) return;
                if (historyRecoveryDeletedRef.current.has(sessionId)) throw new Error("会话已删除或已超过保留期限");
                const merged = mergeCreationConversationHistory(conversationsRef.current, [incoming], conversation.id, false);
                selected = merged.conversations.find((entry) => entry.agentSessionId === sessionId)!;
                conversationsRef.current = merged.conversations;
                setConversations(merged.conversations);
                setHistoryPending((current) => current.filter((entry) => entry.id !== sessionId));
                for (const confirmed of merged.confirmedSubmissions) {
                    try {
                        const pending = await loadPendingCreationAgentSubmission(confirmed.conversationId);
                        if (controller.signal.aborted || scope !== getActiveUserScope()) return;
                        if (pending?.key === confirmed.key) await clearPendingCreationAgentSubmission(confirmed.conversationId, scope);
                    } catch {
                        if (!controller.signal.aborted) toast.warning("运行已恢复，待确认请求记录暂时无法清理，请稍后刷新");
                    }
                }
            } catch (error) {
                if (controller.signal.aborted || scope !== getActiveUserScope()) return;
                setHistoryPending((current) => current.map((entry) => (entry.id === sessionId ? { ...entry, historyStatus: "error" } : entry)));
                toast.error(error instanceof Error ? error.message : "对话加载失败，请点击该标题重试");
                if (options.fromRoute) throw error;
                return;
            }
        }
        if (controller.signal.aborted || scope !== getActiveUserScope()) return;
        historySelectionRef.current = null;
        followLatestMessageRef.current = true;
        activeIdRef.current = selected.id;
        setActiveId(selected.id);
        setMode(creationConversationMode(selected));
        setPrompt("");
        setAttachments([]);
        setDraftReferences([]);
        setHistoryOpen(false);
        if (!options.fromRoute) {
            try {
                const id = await syncConversationHistory(selected);
                if (!controller.signal.aborted && scope === getActiveUserScope() && activeIdRef.current === selected.id) conversationRoute.show(id);
            } catch (error) {
                if (scope === getActiveUserScope()) setCloudHistoryError(`会话已缓存到本机，云端同步未完成：${error instanceof Error ? error.message : "请重试"}`);
            }
        }
    };

    const conversationRoute = useCreationConversationRoute(
        hydrated && composerPreferencesHydrated,
        smartCreationUserId,
        async (id, signal) => {
            if (!smartCreationUserId) throw new Error("请先登录后打开该会话");
            const cached = conversationsRef.current.find((item) => (item.agentSessionId || item.id) === id);
            const conversation = cached || { id, agentSessionId: id, title: "创作会话", updatedAt: new Date().toISOString(), messages: [] };
            await selectConversation({ ...conversation, agentSessionId: id }, { fromRoute: true, signal });
        },
        historyRecoveryDeletedRef.current,
    );

    useEffect(() => {
        if (!hydrated || location.state?.creationHome || conversationRoute.conversationId || !activeConversation?.agentSessionId || !activeConversation.messages.length) return;
        conversationRoute.show(activeConversation.agentSessionId, true);
    }, [hydrated, location.state, conversationRoute.conversationId, conversationRoute.show, activeConversation?.id, activeConversation?.agentSessionId]);

    const copyConversationLink = async (conversation: CreationConversation) => {
        try {
            const id = await syncConversationHistory(conversation);
            await navigator.clipboard.writeText(new URL(creationConversationPath({ id }), window.location.origin).href);
            toast.success("会话链接已复制，仅登录该账号后可访问");
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "会话链接复制失败");
        }
    };

    const confirmDeleteConversation = (conversation: CreationConversation) => {
        const scope = getActiveUserScope();
        const title = conversation.title.trim() || "新创作";
        const label = title.length > 32 ? `${title.slice(0, 32)}...` : title;
        setHistoryDeleteOpen(true);
        modal.confirm({
            className: "workspace-modal workspace-modal-compact",
            title: "删除历史对话？",
            content: `确定删除「${label}」吗？这会将该对话从历史记录中移除，不会删除已上传或生成的任何素材。此操作不可撤销。${conversation.agentSessionId ? "如有任务正在运行，请先停止或等待任务结束。" : ""}`,
            okText: "删除对话",
            okButtonProps: { danger: true },
            cancelText: "保留",
            afterClose: () => setHistoryDeleteOpen(false),
            onOk: async () => {
                try {
                    if (scope !== getActiveUserScope()) throw new Error("账号已切换，请在当前账号重新选择历史对话");
                    const current = conversationsRef.current.find((item) => item.id === conversation.id) || (conversation.agentSessionId ? conversation : undefined);
                    if (!current) throw new Error("要删除的创作对话不存在");
                    if (current.messages.some((message) => message.role === "assistant" && message.mode === "agent" && message.status === "streaming" && message.clientOperationId)) {
                        throw new Error("Agent 请求正在提交，请等待提交完成后再删除");
                    }
                    if (current.agentSessionId) await deleteAgentSession(current.agentSessionId);
                    if (scope !== getActiveUserScope()) {
                        const cleanup = conversationSaveChainRef.current.catch(() => undefined).then(() => removeStoredCreationConversation(conversation.id, scope));
                        conversationSaveChainRef.current = cleanup;
                        await cleanup;
                        return;
                    }
                    historyRecoveryDeletedRef.current.add(current.agentSessionId || current.id);
                    setHistoryPending((entries) => entries.filter((entry) => entry.id !== (current.agentSessionId || current.id)));
                    const remaining = removeCreationConversationSnapshot(conversationsRef.current, conversation.id);
                    const sortedRemaining = [...remaining].sort((left, right) => conversationTimestamp(right.updatedAt) - conversationTimestamp(left.updatedAt));
                    const fallback = sortedRemaining.find((item) => item.messages.length > 0) || sortedRemaining[0] || newConversation();
                    const next = remaining.length ? remaining : [fallback];
                    const save = queueCreationConversationsSave(conversationSaveChainRef.current, next, scope);
                    conversationSaveChainRef.current = save;
                    conversationsRef.current = next;
                    setConversations(next);
                    if (activeIdRef.current === conversation.id) {
                        followLatestMessageRef.current = true;
                        activeIdRef.current = fallback.id;
                        setActiveId(fallback.id);
                        setMode(creationConversationMode(fallback));
                        setPrompt("");
                        setAttachments([]);
                        setDraftReferences([]);
                        if (fallback.agentSessionId) conversationRoute.show(fallback.agentSessionId, true);
                        else void navigate("/", { replace: true });
                    }
                    await save;
                    void clearPendingCreationAgentSubmission(conversation.id, scope).catch(() => undefined);
                    if (scope !== getActiveUserScope()) return;
                    toast.success("历史对话已删除，素材仍保留");
                } catch (error) {
                    if (scope === getActiveUserScope()) toast.error(error instanceof Error ? error.message : "历史对话删除失败");
                    throw error;
                }
            },
        });
    };

    const renameConversationTitle = async (conversation: CreationConversation, title: string) => {
        const nextTitle = title.trim().slice(0, 120);
        if (!nextTitle || nextTitle === conversation.title.trim()) return;
        const scope = getActiveUserScope();
        try {
            await syncConversationHistory(conversation, nextTitle);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "对话重命名保存失败");
            return;
        }
        if (scope !== getActiveUserScope()) return;
        const next = updateCreationConversationSnapshot(conversationsRef.current, conversation.id, (item) => ({ ...item, title: nextTitle }));
        conversationsRef.current = next;
        setConversations(next);
        const saved = queueCreationConversationsSave(conversationSaveChainRef.current, next, conversationUserRef.current || "guest");
        conversationSaveChainRef.current = saved;
        void saved.catch((error) => toast.error(error instanceof Error ? error.message : "对话重命名保存失败"));
    };

    const restoreMessageDraft = (item: CreationMessage) => {
        const nextMode = item.mode || "text";
        const nextSettings = item.settings;
        selectMode(nextMode);
        setPrompt(item.content);
        const nextAttachments = item.attachments ? [...item.attachments] : [];
        setAttachments(nextAttachments);
        attachmentsRef.current = nextAttachments;
        setDraftReferences(item.references ? [...item.references] : []);
        if (item.model) updateConfig(nextMode === "text" || nextMode === "agent" ? "textModel" : nextMode === "image" ? "imageModel" : "videoModel", item.model);
        if (!nextSettings) return;
        setRatio(nextSettings.ratio);
        setSeconds(nextSettings.seconds);
        setQuality(nextSettings.quality);
        if (nextMode === "image") {
            setImageResolution(nextSettings.imageResolution || "auto");
            setImageParameters(nextSettings.imageParameters || "{}");
        }
        setVideoQuality(nextSettings.videoQuality);
        setCount(nextSettings.count);
        if (nextMode === "image")
            rememberImageSettings({
                model: item.model,
                ratio: nextSettings.ratio,
                quality: nextSettings.quality,
                count: nextSettings.count,
                imageResolution: nextSettings.imageResolution,
                imageParameters: nextSettings.imageParameters,
                transparentBackground: nextSettings.transparentBackground,
            });
        if (nextMode === "video") rememberVideoSettings({ ratio: nextSettings.ratio, seconds: nextSettings.seconds, videoQuality: nextSettings.videoQuality });
    };

    const retryFailedMessage = async (item: CreationMessage, index: number, failedItems?: CreationMessage[]) => {
        const previous =
            item.role === "assistant"
                ? activeConversation?.messages
                      .slice(0, index)
                      .reverse()
                      .find((message) => message.role === "user")
                : item;
        if (!previous || !creationHasInput(previous.mode || "text", previous.content, previous.attachments) || busy) return;
        if (item.mode === "agent" && item.clientOperationId) {
            const scope = getActiveUserScope();
            try {
                const pending = await loadPendingCreationAgentSubmission(activeConversation!.id);
                if (scope !== getActiveUserScope() || activeIdRef.current !== activeConversation!.id) return;
                if (pending) {
                    await submitCreationAgent(previous.content, activeConversation, false, { recoverPending: true });
                    return;
                }
                if (item.agentSubmissionRejected) {
                    restoreMessageDraft({ ...previous, mode: "agent", model: item.model || previous.model });
                    window.requestAnimationFrame(() => composerFocusRef.current?.focus());
                    toast.info("原请求未被受理，已恢复原输入；请确认模型偏好与预算后发送");
                    return;
                }
            } catch (error) {
                if (scope === getActiveUserScope()) toast.error(generationErrorMessage(error));
                return;
            }
        }
        const expectedTaskCount = item.mode === "image" ? item.batchTotal || Number(item.settings?.count) || 1 : 1;
        if ((item.submissionPending || (item.taskIds?.length || 0) < expectedTaskCount) && item.clientOperationId && !item.agentRunId && !item.id.startsWith("task-") && (item.mode === "image" || item.mode === "video")) {
            const scope = getActiveUserScope();
            const originId = activeConversation!.id;
            const key = `submission:${item.clientOperationId}`;
            if (retryPreparingRef.current.has(key)) return;
            retryPreparingRef.current.add(key);
            try {
                const runtime = await loadCreationRuntime();
                if (scope !== getActiveUserScope()) return;
                await recoverCreationGenerationSubmission(runtime, originId, item, async (updater) => {
                    if (scope !== getActiveUserScope()) return;
                    await updateConversationMessage(originId, item.id, updater);
                });
                return;
            } catch (error) {
                if (scope !== getActiveUserScope()) return;
                if (!(error instanceof ApiError && error.reason === "generation_submission_rejected")) {
                    toast.error(generationErrorMessage(error));
                    return;
                }
            } finally {
                retryPreparingRef.current.delete(key);
            }
        }
        if (item.mode === "agent" || item.agentRunId || item.id.startsWith("task-")) {
            let origin = activeConversation;
            const scope = getActiveUserScope();
            const retryKey = `agent:${item.agentRunId || item.id}`;
            if (retryPreparingRef.current.has(retryKey)) return;
            retryPreparingRef.current.add(retryKey);
            try {
                if (!origin?.agentSessionId) {
                    toast.error("缺少原创作会话记录，请从历史对话重新打开后重试");
                    return;
                }
                const projected = await restoreCreationAgentConversation(origin.agentSessionId, creationAgentRecoveryClient);
                if (scope !== getActiveUserScope() || activeIdRef.current !== origin.id) return;
                origin = mergeCreationAgentConversation(origin, projected);
                updateConversation(origin.id, (current) => mergeCreationAgentConversation(current, projected));
                const run = creationAgentRetryRun(projected, item);
                if (!run) {
                    toast.error("已查询原会话，暂未找到此消息对应的轮次，请从历史对话核对原任务");
                    return;
                }
                const runId = run.id;
                if (run.cleanupPending || ["queued", "running", "waiting_approval"].includes(run.status)) {
                    toast.info(run.status === "waiting_approval" ? "原轮次正在等待审批，请先处理原方案" : "原轮次仍在处理中，已恢复最新状态");
                    return;
                }
                const targets = failedItems || [item];
                if (targets.some((target) => creationAgentRetryRun(projected, target)?.id !== runId || target.status !== "error")) {
                    toast.info("只能重试同一轮中失败的任务");
                    return;
                }
                const targetTaskIds = targets.map((target) => (target.taskIds?.length ? target.taskIds : target.id.startsWith("task-") ? [target.id.slice(5)] : []));
                let taskIds = [...new Set(targetTaskIds.flat())];
                if (!taskIds.length && !failedItems) taskIds = [...new Set((run.events || []).flatMap((event) => (event.type === "generation_task_created" && typeof event.payload.taskId === "string" ? [event.payload.taskId] : [])))];
                if (failedItems && targetTaskIds.some((ids) => !ids.length)) {
                    toast.error("失败项缺少任务记录，请刷新历史后重试");
                    return;
                }
                if (taskIds.length) {
                    const runtime = await loadCreationRuntime();
                    const refreshed = await refreshCreationMessageTasks(runtime, origin, { ...item, taskIds });
                    if (scope !== getActiveUserScope() || activeIdRef.current !== origin.id) return;
                    updateConversation(origin.id, (current) => mergeCreationAgentConversation(current, refreshed.conversation));
                    taskIds = refreshed.retryableTaskIds;
                    if (!taskIds.length) {
                        toast.info("已刷新原任务状态，进行中、已完成或待恢复的任务不会重复生成");
                        return;
                    }
                    origin = refreshed.conversation;
                } else if (run.status === "completed") {
                    await updateConversationMessage(origin.id, item.id, (current) => ({ ...current, status: "done", agentRunId: runId, error: undefined }));
                    toast.info("原轮次已完成，已恢复最新结果");
                    return;
                }
                if (scope !== getActiveUserScope() || activeIdRef.current !== origin.id) return;
                await submitCreationAgent("重试失败项", origin, false, { retry: { runId, ...(taskIds.length > 1 ? { taskIds } : taskIds.length ? { taskId: taskIds[0] } : {}) } });
            } catch (error) {
                if (scope === getActiveUserScope()) toast.error(generationErrorMessage(error));
            } finally {
                retryPreparingRef.current.delete(retryKey);
            }
            return;
        }
        const retryOf = item.taskIds?.[0];
        const restoreForRetry = (retryCount?: number, preserveResults = false) => {
            followLatestMessageRef.current = true;
            restoreMessageDraft(retryCount && previous.settings ? { ...previous, settings: { ...previous.settings, count: String(retryCount) } } : previous);
            if (preserveResults) return;
            const removedIds = new Set([item.id, previous.id]);
            updateActive((conversation) => {
                const messages = conversation.messages.filter((message) => !removedIds.has(message.id));
                const firstPrompt = messages.find((message) => message.role === "user")?.content.trim();
                return { ...conversation, title: firstPrompt ? firstPrompt.slice(0, 24) : "新创作", updatedAt: new Date().toISOString(), messages };
            });
        };
        if (!retryOf) {
            const key = `message:${item.id}`;
            if (retryPreparingRef.current.has(key)) return;
            retryPreparingRef.current.add(key);
            restoreForRetry();
            pendingRetryRef.current = { lockKey: key };
            setRetrySequence((current) => current + 1);
            return;
        }
        if (retryPreparingRef.current.has(retryOf)) return;
        retryPreparingRef.current.add(retryOf);
        try {
            const runtime = await loadCreationRuntime();
            const origin = activeConversation;
            const scope = getActiveUserScope();
            if (!origin) {
                retryPreparingRef.current.delete(retryOf);
                return;
            }
            const refreshed = await refreshCreationMessageTasks(runtime, origin, item);
            if (getActiveUserScope() !== scope || activeIdRef.current !== origin.id) {
                retryPreparingRef.current.delete(retryOf);
                return;
            }
            if (!refreshed.canRetry) {
                const recovered = refreshed.conversation.messages.find((message) => message.id === item.id);
                if (recovered) await updateConversationMessage(origin.id, item.id, (current) => (JSON.stringify(current.taskIds || []) === JSON.stringify(item.taskIds || []) ? recovered : current));
                retryPreparingRef.current.delete(retryOf);
                toast.info(recovered?.status === "done" ? "已恢复原任务结果" : "原任务仍在处理或保存结果，请稍后查看任务状态");
                return;
            }
            const taskIds = refreshed.retryableTaskIds.length ? refreshed.retryableTaskIds : [...new Set(item.taskIds || [])];
            const attemptGroupId = item.attemptGroupId || item.retryOf || retryOf;
            const context: CreationRetryContext = {
                ...(await runtime.createGenerationRetryContext(taskIds[0], attemptGroupId)),
                ...(taskIds.length > 1 ? { retryContextsByBatchIndex: await runtime.createGenerationBatchRetryContexts(taskIds, attemptGroupId) } : {}),
            };
            if (scope !== getActiveUserScope() || activeIdRef.current !== origin.id) {
                retryPreparingRef.current.delete(retryOf);
                return;
            }
            const preserveResults = taskIds.length < new Set(item.taskIds).size;
            if (preserveResults) {
                const recovered = refreshed.conversation.messages.find((message) => message.id === item.id);
                if (recovered) await updateConversationMessage(origin.id, item.id, () => recovered);
            }
            restoreForRetry(item.mode === "image" ? taskIds.length : undefined, preserveResults);
            pendingRetryRef.current = { context, lockKey: retryOf };
            setRetrySequence((current) => current + 1);
        } catch (error) {
            retryPreparingRef.current.delete(retryOf);
            toast.error(generationErrorMessage(error));
        }
    };

    const createVariant = (item: CreationMessage, index: number) => {
        const previous =
            item.role === "assistant"
                ? activeConversation?.messages
                      .slice(0, index)
                      .reverse()
                      .find((message) => message.role === "user")
                : item;
        if (!previous || !creationHasInput(previous.mode || "text", previous.content, previous.attachments) || busy) return;
        if (item.mode === "agent" || item.agentRunId || item.id.startsWith("task-")) {
            selectMode("agent");
            setPrompt(previous.content ? `请基于之前的结果创作一个新版本：${previous.content}` : "请基于之前的结果创作一个新版本");
            window.requestAnimationFrame(() => composerFocusRef.current?.focus());
            return;
        }
        restoreMessageDraft(previous);
    };

    useCreationHomeNavigation(hydrated && composerPreferencesHydrated, startNewConversation);

    if (conversationRoute.loading)
        return (
            <div className="grid h-full place-items-center" role="status">
                <Spin tip="正在打开会话…" />
            </div>
        );
    if (conversationRoute.error)
        return (
            <div className="grid h-full place-content-center gap-4 text-center">
                <h2>无法打开会话</h2>
                <p role="alert">{conversationRoute.error}</p>
                <p>请确认链接及登录账号。会话可能已删除或已超过保留期限。</p>
                <button type="button" onClick={startNewConversation}>
                    开始新创作
                </button>
            </div>
        );
    if (!hydrated || !activeConversation)
        return (
            <div className="grid h-full place-items-center">
                <Spin />
            </div>
        );

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

    const canStopAgent = creationAgentRunsToStop(activeConversation).length > 0;
    const generationActive = canStopAgent || activeConversation.messages.some((message) => message.role === "assistant" && message.status === "pending");
    const startPrompt = (nextMode: CreationMode, nextPrompt: string) => {
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
        agentInterjectionStatus: creationAgentInterjectionRun(activeConversation)?.status as "queued" | "running" | "waiting_approval" | undefined,
        stopping: stoppingConversationId === activeConversation.id,
        onStop: canStopAgent
            ? () => {
                  void stopCreationGeneration();
              }
            : undefined,
        referenceReplacementBusy,
        referencePasteBusy,
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
        onPasteFiles: (files: File[]) => {
            void addPastedReferenceFiles(files);
        },
        onOpenLibrary: () => setLibraryOpen(true),
        onModeChange: selectMode,
        model: selectedModel,
        modelRequirements,
        imageProfile,
        videoProfile,
        config: generationConfig,
        onModelChange: (value: string) => updateConfig(mode === "text" || mode === "agent" ? "textModel" : mode === "image" ? "imageModel" : "videoModel", value),
        ratio,
        setRatio: setComposerRatio,
        seconds,
        setSeconds: setComposerSeconds,
        quality,
        setQuality: setComposerQuality,
        imageResolution,
        setImageResolution: setComposerImageResolution,
        imageParameters,
        setImageParameters: (value: string) => {
            setImageParameters(value);
            rememberImageSettings({ model: selectedModel, imageParameters: value });
        },
        setTransparentBackground: (value: string) => rememberImageSettings({ transparentBackground: value }),
        videoQuality,
        setVideoQuality: setComposerVideoQuality,
        count,
        setCount: setComposerCount,
        textStreaming,
        setTextStreaming,
        textThinking,
        setTextThinking,
        promptOptimizerProvider,
        smartCreationAvailable: Boolean(smartCreationProvider),
        smartCreationActive,
        smartCreationPlanning,
        onToggleSmartCreation: () => setSmartCreationActive((active) => !active),
        composerFocusRef,
        onPromptFocus: loadAddedSkills,
        onSubmit: () => void submit(),
        agentPermissionMode,
        onAgentPermissionChange: setAgentPermissionMode,
        agentOutputPreference,
        onAgentOutputPreferenceChange: rememberOutputPreference,
        agentContextView,
        agentInputError,
        agentImageModel: config.imageModel,
        agentImageSelectionMode,
        agentVideoSelectionMode,
        onAgentImageSelectionModeChange: setAgentImageSelectionMode,
        onAgentVideoSelectionModeChange: setAgentVideoSelectionMode,
        agentVideoModel: config.videoModel,
        onAgentImageModelChange: (value: string) => updateConfig("imageModel", value),
        onAgentVideoModelChange: (value: string) => updateConfig("videoModel", value),
        agentImageParameterMode,
        agentVideoParameterMode,
        onAgentImageParameterModeChange: setAgentImageParameterMode,
        onAgentVideoParameterModeChange: setAgentVideoParameterMode,
        agentMaxCredits: agentBudget.maxCredits,
        agentMaxGenerationTasks: agentBudget.maxGenerationTasks,
        agentMaxVideoSeconds: agentBudget.maxVideoSeconds,
        onAgentBudgetChange: (key: "maxCredits" | "maxGenerationTasks" | "maxVideoSeconds", value: number) => setAgentBudget((current) => ({ ...current, [key]: value })),
        agentImageSize: agentImageSettings.size,
        agentImageQuality: agentImageSettings.quality,
        agentImageCount: agentImageSettings.count,
        agentVideoSize: agentVideoSettings.size,
        agentVideoQuality: agentVideoSettings.quality,
        agentVideoSeconds: agentVideoSettings.durationSeconds,
        onAgentImageSettingChange: (key: "size" | "quality" | "count", value: string | number) => setAgentImageSettings((current) => ({ ...current, [key]: value })),
        onAgentVideoSettingChange: (key: "size" | "quality" | "durationSeconds", value: string | number) => setAgentVideoSettings((current) => ({ ...current, [key]: value })),
    };

    return (
        <>
            <div className="creation-home relative flex h-full min-h-0 flex-col overflow-hidden">
                {cloudHistoryError ? (
                    <div className="creation-agent-connection-error" role="status">
                        <span>{cloudHistoryError}</span>
                        <button
                            type="button"
                            onClick={() => {
                                cloudHistoryFingerprintsRef.current.clear();
                                setConversations([...conversationsRef.current]);
                            }}
                        >
                            重试同步
                        </button>
                    </div>
                ) : null}
                {pendingApproval ? (
                    <div className="creation-agent-pending-notice" role="status">
                        <span>
                            {pendingApprovals.length} 份方案待审批 · {pendingApproval.title}
                        </span>
                        <button
                            type="button"
                            onClick={async () => {
                                if (pendingApproval.id !== activeConversation.id) await selectConversation(pendingApproval);
                                window.requestAnimationFrame(() => document.getElementById(`creation-shot-${pendingApproval.agentRunId}:assistant`)?.scrollIntoView({ block: "end", behavior: reducedMotion ? "auto" : "smooth" }));
                            }}
                        >
                            查看待审批方案
                        </button>
                    </div>
                ) : null}
                {isEmpty ? (
                    <>
                        <AnimatePresence>
                            {launchpadCondensed ? (
                                <motion.div
                                    className="creation-floating-prompt"
                                    key="floating-prompt"
                                    style={{ x: "-50%" }}
                                    initial={{ opacity: 0, y: -12, scale: 0.97 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: -8, scale: 0.98 }}
                                    transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 360, damping: 32, mass: 0.8 }}
                                >
                                    <Sparkles aria-hidden="true" />
                                    <input aria-label="快捷编辑提示词" placeholder="继续描述你的创作想法…" value={prompt} disabled={busy || referenceReplacementBusy} onChange={(event) => setPrompt(event.target.value)} />
                                    <Tooltip title="展开完整创作区">
                                        <button
                                            type="button"
                                            aria-label="展开完整创作区"
                                            onClick={() => {
                                                threadScrollRef.current?.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
                                                composerFocusRef.current?.focus({ preventScroll: true });
                                            }}
                                        >
                                            <Maximize2 />
                                        </button>
                                    </Tooltip>
                                </motion.div>
                            ) : null}
                        </AnimatePresence>
                        <main ref={threadScrollRef} onScroll={handleThreadScroll} className="creation-home-scroll creation-scrollbar">
                            <section ref={launchpadRef} className="creation-launchpad" aria-label="开始创作">
                                <header className="creation-start-heading">
                                    <div>
                                        <h1>和{brandName}聊聊创作想法</h1>
                                        <p>从一个画面、一个角色或一句话开始。</p>
                                    </div>
                                    <button type="button" className="creation-history-entry" aria-label="查看历史对话" aria-expanded={historyOpen} onClick={openHistory}>
                                        <History aria-hidden="true" />
                                        <span>历史对话</span>
                                    </button>
                                </header>
                                <div className="creation-composer-stage is-home-mode">
                                    <div className="creation-empty-composer">
                                        <CreationComposer {...composerProps} variant="empty" />
                                    </div>
                                </div>
                                <CreationEmptySuggest
                                    onStartPrompt={startPrompt}
                                    onOpenLibrary={() => {
                                        selectMode("image");
                                        setLibraryOpen(true);
                                    }}
                                />
                            </section>
                            <CreationRecentCanvases onRequireLogin={() => setLoginDialogOpen(true)} />
                            <Suspense
                                fallback={
                                    <div className="creation-hall-loading" role="status">
                                        正在准备灵感大厅…
                                    </div>
                                }
                            >
                                <InspirationHall onUse={(item) => startPrompt(item.mode, fillablePrompt(item))} />
                            </Suspense>
                            {inspirationSourcesVisible ? (
                                <div className="creation-source-notice">
                                    <details>
                                        <summary>素材来源</summary>
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
                                </div>
                            ) : null}
                        </main>
                    </>
                ) : (
                    <div className="creation-thread-workbench">
                        <CreationWorkspaceToolbar onNewConversation={startNewConversation} onOpenHistory={openHistory} shots={videoShots} onJumpToShot={jumpToShot} onContinueCanvas={() => void continueOnCanvas()} openingCanvas={openingCanvas} />
                        <main ref={threadScrollRef} onScroll={handleThreadScroll} className="creation-thread-scroll creation-scrollbar">
                            <section className="creation-thread-stage">
                                <div className="creation-results">
                                    {activeConversation.messages.map((item, index) => {
                                        const isAgentTask = item.id.startsWith("task-") && item.agentRunId && activeConversation.messages.some((candidate) => candidate.id === `${item.agentRunId}:assistant`);
                                        if (isAgentTask) return null;
                                        const agentTasks =
                                            item.mode === "agent" && !item.agentContinuation && item.agentRunId ? activeConversation.messages.filter((candidate) => candidate.id.startsWith("task-") && candidate.agentRunId === item.agentRunId) : [];
                                        const currentAgentReply = item.mode === "agent" && item.agentRunId === activeConversation.agentRunId;
                                        return (
                                            <div key={item.id} id={`creation-shot-${item.id}`} className="creation-thread-message">
                                                <CreationMessageView
                                                    item={item}
                                                    submitting={submittingMessageIds.has(item.id)}
                                                    shotNumber={creationVideoShotOrdinal(videoShots, item)}
                                                    onRetryFailure={() => retryFailedMessage(item, index)}
                                                    onQueryInterjection={async (message) => {
                                                        const current = conversationsRef.current.find((conversation) => conversation.id === activeConversation.id);
                                                        if (current) await interjectCreationAgent(current, message.content, message.id);
                                                    }}
                                                    onCreateVariant={() => createVariant(item, index)}
                                                    agentTasks={agentTasks}
                                                    taskSyncFailed={agentTasks.some((task) => task.taskIds?.some((id) => agentTaskSyncFailures.has(id)))}
                                                    onRefreshAgentTasks={() => setAgentTaskRecoveryEpoch((value) => value + 1)}
                                                    outputPreference={agentOutputPreference}
                                                    onRetryAgentTasks={(tasks) =>
                                                        retryFailedMessage(
                                                            tasks[0],
                                                            activeConversation.messages.findIndex((candidate) => candidate.id === tasks[0].id),
                                                            tasks,
                                                        )
                                                    }
                                                    retryDisabled={busy || Boolean(activeAgentRun && (activeAgentRun.cleanupPending || ["queued", "running", "waiting_approval"].includes(activeAgentRun.status)))}
                                                    onCreateAgentTaskVariant={(task) =>
                                                        createVariant(
                                                            task,
                                                            activeConversation.messages.findIndex((candidate) => candidate.id === task.id),
                                                        )
                                                    }
                                                    agentReview={
                                                        item.mode === "agent" && !item.agentContinuation ? (
                                                            <CreationAgentReview
                                                                outputPreference={agentOutputPreference}
                                                                plan={item.commercePlan}
                                                                items={item.agentPlanItems}
                                                                approval={currentAgentReply ? activeConversation.agentApproval : undefined}
                                                                changed={agentApprovalSettingsChanged}
                                                                submitting={agentApprovalSubmitting}
                                                                onApprove={() => void decideCreationApproval("approve")}
                                                                onReject={() => void decideCreationApproval("reject")}
                                                                onModify={currentAgentReply ? modifyCreationPlan : undefined}
                                                                onDefer={() => composerFocusRef.current?.focus()}
                                                                onRefreshQuote={currentAgentReply && item.commercePlan ? () => void decideCreationApproval("refresh") : undefined}
                                                            />
                                                        ) : undefined
                                                    }
                                                    onContinueCanvas={(ids) => void continueOnCanvas(ids)}
                                                    openingCanvas={openingCanvas}
                                                    onEditUserMessage={(message) => {
                                                        restoreMessageDraft(message);
                                                        window.requestAnimationFrame(() => composerFocusRef.current?.focus());
                                                    }}
                                                />
                                            </div>
                                        );
                                    })}
                                    {agentConnectionError && activeConversation.agentRunId ? (
                                        <div role="status" className="creation-agent-connection-error">
                                            <span>Agent 连接中断，服务端运行仍保留：{agentConnectionError}</span>
                                            <button type="button" onClick={() => setAgentConnectionEpoch((value) => value + 1)}>
                                                重新连接
                                            </button>
                                        </div>
                                    ) : null}
                                </div>
                            </section>
                        </main>
                        <section className="creation-thread-composer">
                            <CreationComposer {...composerProps} variant="thread" />
                        </section>
                    </div>
                )}
            </div>
            <CreationHistoryDrawer
                open={historyOpen}
                deleteConfirmOpen={historyDeleteOpen}
                conversations={historyConversations}
                activeId={activeConversation.id}
                loading={historyLoading}
                syncError={historySyncError}
                retentionDays={conversationRetentionDays}
                onCopyLink={copyConversationLink}
                onRefresh={refreshHistory}
                onNew={startNewConversation}
                onClose={() => {
                    cancelHistorySelection();
                    setHistoryOpen(false);
                }}
                onSelect={selectConversation}
                onDelete={confirmDeleteConversation}
                onRename={renameConversationTitle}
            />
            <CreationLoginDialog open={loginDialogOpen} onClose={() => setLoginDialogOpen(false)} />
            {libraryOpen ? (
                <Suspense fallback={null}>
                    <AssetLibraryPickerModal
                        remoteLibrary
                        acceptRemoteItems
                        remoteItemDisabledReason={(asset) => creationLibraryDisabledReason(mode, asset.kind, videoReferenceLimits)}
                        open={libraryOpen}
                        items={libraryItems}
                        categoryLabels={{ ...creationAssetCategoryLabels, ...externalAssetSources.categoryLabels }}
                        folders={externalAssetSources.folders}
                        initialSelectedIds={attachments.flatMap((item) => (item.id.startsWith("asset:") ? [item.id.slice(6)] : item.id.startsWith("external:") ? [item.id] : []))}
                        upload={{
                            accept: creationUploadAccept(mode),
                            description: mode === "text" ? "支持图片、视频、音频和常用文档；媒体会保存到素材库" : `支持图片${mode === "video" ? "、视频和音频" : ""}，上传后保存到素材库`,
                            onUpload: uploadLibraryAssets,
                            external: { accept: "image/*", description: "写入当前 Eagle 文件夹；Eagle 当前支持图片文件", onUpload: (files, folderId) => externalAssetSources.uploadExternalFiles(files, folderId) },
                        }}
                        onClose={() => setLibraryOpen(false)}
                        onConfirm={handleLibrarySelect}
                    />
                </Suspense>
            ) : null}
        </>
    );
}
