import { createClientUUID } from "@/lib/client-id";
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { Button } from "antd";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { MoveDiagonal2 } from "lucide-react";
import { saveAs } from "file-saver";
import { buildAgentDebugExport } from "@/lib/canvas/agent-debug-export";
import { agentPlanVisible, latestAgentPlanItems, latestAgentPlanTerminal, pendingAgentQuestion } from "@/lib/canvas/cloud-agent-plan";
import { emptyAgentContextUsage, presentAgentContextUsage, reduceAgentContextUsage, type AgentContextUsage } from "@/lib/canvas/agent-context-usage";
import { nanoid } from "nanoid";

import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { canvasThemes } from "@/lib/canvas-theme";
import { agentSubmissionErrorTitle } from "@/lib/canvas/agent-error-presentation";
import { CanvasSyncPendingError, waitForCanvasSync } from "@/lib/canvas/sync-recovery";
import {
    cancelAgentRun,
    getAgentCapabilities,
    getAgentProfile,
    getAgentRun,
    createAgentRun,
    decideAgentApproval,
    sendAgentInterjection,
    sendAgentMessage,
    subscribeAgentEvents,
    undoAgentCanvasRun,
    updateAgentProfile,
    type AgentPermissionMode,
    type AgentProfileScope,
    type AgentProfileView,
    type AgentReasoningMode,
    type AgentRun,
} from "@/services/api/agent";
import { agentApprovalMatchesSettings, agentApprovalTargetGenerating } from "@/lib/canvas/agent-media-approval";
import { appendAgentPromptPrefill } from "@/lib/canvas/agent-prompt-prefill";
import type { CanvasNodeData } from "@/types/canvas";
import type { AgentMediaSettings } from "@/services/api/agent";
import { addSkill, listAddedSkills, listSkillLibraryCategories, listSkills, listSkillPresets, type Skill, type SkillCategory, type SkillLibraryCategory, type SkillPreset } from "@/services/api/skills";
import {
    clearCloudAgentPendingSubmission,
    cloudAgentConversationServerId,
    cloudAgentPendingMatchesRun,
    cloudAgentConversationTitle,
    loadCloudAgentConversations,
    loadCloudAgentPendingSubmission,
    saveCloudAgentConversations,
    saveCloudAgentPendingSubmission,
    type CloudAgentConversation,
    type CloudAgentPendingSubmission,
    type CloudAgentMessagePresentation,
} from "@/services/cloud-agent-conversations";
import { loadCloudAgentConversation, mergeCloudAgentConversations, refreshCloudAgentConversations } from "@/services/cloud-agent-history";
import { canvasCloudAgentConversation, cloudAgentFollowDecision } from "@/lib/canvas/cloud-agent-follow";
import { resolveCloudAgentModel } from "@/lib/canvas/cloud-agent-model-restore";
import { logicalModelIDForConfig, modelOptionName, resolveModelRequestConfig, selectableModelsByCapability, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { selectImageInspectionModel } from "@/lib/canvas/image-to-previs-agent";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { getActiveUserScope } from "@/lib/user-scope";
import { applyAgentCanvasPatches, refreshCanvasAfterAgent, prepareCanvasForCloudAction } from "@/services/user-data-sync";
import { createAgentCanvasSync } from "@/services/agent-canvas-sync";
import { agentCanvasUndoKey, type AgentCanvasUndoState, type AgentCanvasUndoTarget } from "@/lib/canvas/agent-canvas-undo";
import { canvasEditLeases } from "@/services/canvas-edit-leases";
import { buildSkillMentionReferences, resolveSkillMentions } from "@/services/skill-runtime";
import { AGENT_SCENE_DEFS, AgentChatComposer, parseCloudAgentFormAnswer, AgentPlanBar, AgentQuestionBar, AgentSceneCapsules, type AgentSceneBucket, type CloudAgentChatMessage } from "./canvas-cloud-agent-chat-ui";
import { CanvasAgentSkillLibraryModal } from "./canvas-agent-skill-library-modal";
import { useSkillCuration, curationQuery } from "@/components/skills/skill-curation-browser";
import { CanvasCloudAgentSettings, type AgentContextKey } from "./canvas-cloud-agent-settings";
import { useAgentPanelLayout } from "./use-agent-panel-layout";
import "./canvas-cloud-agent.css";
import { appendAgentError, appendUniqueMessage, applyAgentEvent, positiveNumber, type ApprovalState } from "./canvas-cloud-agent-events";
import { AgentContextRing, AgentConversation, AgentHeader, AgentHistory, AgentLauncher, ComposerControls } from "./canvas-cloud-agent-panel-parts";
import { AgentConnectorsBar } from "./canvas-cloud-agent-connectors";
import { useGlobalAgentStore, type AgentPrefillRequest } from "@/stores/use-global-agent-store";

type AgentPanelView = "chat" | "history" | "settings";

function approvalStateFromRun(nextRun: AgentRun | null): ApprovalState | null {
    const approval = nextRun?.approval;
    if (!approval?.approvalId || approval.decision) return null;
    return { approvalId: approval.approvalId, detail: approval, reason: approval.reason || "" };
}

const EMPTY_IDS: string[] = [];
const EMPTY_REFERENCES: CanvasResourceReference[] = [];

/**
 * 平台唯一的 Agent 面板，挂在用户布局上，所有页面共用同一份对话。
 * 画布编辑器通过 useGlobalAgentStore 发布当前画布；发送时有画布就绑定该画布，
 * 离开画布后下一轮不再携带画布 ID（后端只开放无画布工具）。
 */
export const CanvasCloudAgentPanel = memo(function CanvasCloudAgentPanel() {
    const canvasContext = useGlobalAgentStore((state) => state.canvas);
    const open = useGlobalAgentStore((state) => state.open);
    const onOpen = useGlobalAgentStore((state) => state.openAgent);
    const onCollapse = useGlobalAgentStore((state) => state.closeAgent);
    const canvasId = canvasContext?.canvasId ?? "";
    const domainProjectId = canvasContext?.domainProjectId;
    const nodeCount = canvasContext?.nodeCount ?? 0;
    const selectedNodeIds = canvasContext?.selectedNodeIds ?? EMPTY_IDS;
    const references = canvasContext?.references ?? EMPTY_REFERENCES;
    const prefillRequest = canvasContext?.prefillRequest ?? null;
    const onFocusNode = canvasContext?.onFocusNode;
    const canvasNodes = canvasContext?.canvasNodes;
    const runningNodeId = canvasContext?.runningNodeId;
    const userId = useUserStore((state) => state.user?.id);
    const accountScope = getActiveUserScope();
    const accountIsCurrent = () => getActiveUserScope() === accountScope && useUserStore.getState().user?.id === userId;
    const theme = canvasThemes[useActiveTheme()];
    const config = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const reducedMotion = useReducedMotion();
    const [view, setView] = useState<AgentPanelView>("chat");
    const [run, setRun] = useState<AgentRun | null>(null);
    const [contextUsage, setContextUsage] = useState<AgentContextUsage>(() => emptyAgentContextUsage(""));
    const [connectionStatus, setConnectionStatus] = useState<"connecting" | "connected" | "reconnecting" | "disconnected">("connecting");
    const [connectionEpoch, setConnectionEpoch] = useState(0);
    const [messages, setMessages] = useState<CloudAgentChatMessage[]>([]);
    const [prompt, setPrompt] = useState("");
    const [restoredModel, setRestoredModel] = useState<string | null>(null);
    const lastPrefillIdRef = useRef(0);
    const [pendingAutoSubmit, setPendingAutoSubmit] = useState<AgentPrefillRequest | null>(null);
    const prefilledSubmissionRef = useRef<AgentPrefillRequest | null>(null);
    const [reasoningMode, setReasoningMode] = useState<AgentReasoningMode>("off");
    const [profileView, setProfileView] = useState<AgentProfileView | null>(null);
    const [profileLoading, setProfileLoading] = useState(false);
    const [profileSaving, setProfileSaving] = useState(false);
    const [profileError, setProfileError] = useState<string>();
    const profileRequestRef = useRef(0);
    const [skills, setSkills] = useState<Skill[]>([]);
    const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
    const [marketSkills, setMarketSkills] = useState<Skill[]>([]);
    const [skillSearch, setSkillSearch] = useState("");
    const [debouncedSkillSearch, setDebouncedSkillSearch] = useState("");
    const [skillsLoading, setSkillsLoading] = useState(false);
    const [skillHasMore, setSkillHasMore] = useState(false);
    const [skillPage, setSkillPage] = useState(1);
    const [skillCategories, setSkillCategories] = useState<SkillCategory[]>([]);
    const [libraryCategories, setLibraryCategories] = useState<SkillLibraryCategory[]>([]);
    const [skillTag, setSkillTag] = useState("all");
    const [skillsOpen, setSkillsOpen] = useState(false);
    const curationState = useSkillCuration(skillsOpen);
    const [platformCategory, setPlatformCategory] = useState("");
    const skillBrowseKey = JSON.stringify([userId, skillTag, debouncedSkillSearch, platformCategory, curationState.curation?.revision, curationState.curation?.enabled]);
    const skillBrowseKeyRef = useRef(skillBrowseKey);
    skillBrowseKeyRef.current = skillBrowseKey;
    useEffect(() => { if (curationState.curation?.enabled) setSkillTag("all"); }, [curationState.curation?.enabled]);
    const [busy, setBusy] = useState(false);
    const [approvalSubmitting, setApprovalSubmitting] = useState(false);
    const [undoStates, setUndoStates] = useState<Record<string, AgentCanvasUndoState>>({});
    const undoRequestsRef = useRef(new Set<string>());
    const [exporting, setExporting] = useState(false);
    const [stopping, setStopping] = useState(false);
    const [approval, setApproval] = useState<ApprovalState | null>(null);
    const [permissionMode, setPermissionMode] = useState<AgentPermissionMode>("request_approval");
    const [contextScope, setContextScope] = useState<AgentContextKey[]>(["canvas"]);
    const [maxCredits, setMaxCredits] = useState("200");
    const [maxGenerationTasks, setMaxGenerationTasks] = useState("0");
    const [maxVideoSeconds, setMaxVideoSeconds] = useState("0");
    const [conversations, setConversations] = useState<CloudAgentConversation[]>([]);
    const conversationSnapshots = useRef(conversations);
    conversationSnapshots.current = conversations;
    const [activeConversationId, setActiveConversationId] = useState(() => nanoid());
    const [historyHydrated, setHistoryHydrated] = useState(false);
    const [pendingHydrated, setPendingHydrated] = useState(false);
    const [historyRestoreAttempt, setHistoryRestoreAttempt] = useState(0);
    const [cloudHistoryLoading, setCloudHistoryLoading] = useState(false);
    const [cloudHistoryError, setCloudHistoryError] = useState<string>();
    const [cloudHistoryReady, setCloudHistoryReady] = useState(false);
    const [cloudRefreshEpoch, setCloudRefreshEpoch] = useState(0);
    const [cloudOpeningId, setCloudOpeningId] = useState("");
    const cloudOpeningRef = useRef<string | null>(null);
    const conversationLoadControllerRef = useRef<AbortController | null>(null);
    const cloudRunTransitionRef = useRef<string | null>(null);
    const historyRestoreScope = useRef("");
    const hydratedAccount = useRef("");
    const [planMinimized, setPlanMinimized] = useState(false);
    const planItems = useMemo(() => latestAgentPlanItems(messages), [messages]);
    const planTerminal = useMemo(() => latestAgentPlanTerminal(messages), [messages]);
    const planVisible = agentPlanVisible(planItems);
    const pendingQuestion = useMemo(() => pendingAgentQuestion(messages), [messages]);
    const [scenePresets, setScenePresets] = useState<SkillPreset[]>([]);
    const [presetApplyingId, setPresetApplyingId] = useState("");
    const presetApplyingRef = useRef<string | null>(null);
    // 连接器条默认展示，关闭后本次会话内不再显示。
    const [connectorsVisible, setConnectorsVisible] = useState(true);
    const panelLayout = useAgentPanelLayout();
    const lastSeqRef = useRef(0);
    const replayCursorRef = useRef({ runId: "", seq: 0 });
    const canvasSyncRef = useRef<ReturnType<typeof createAgentCanvasSync> | null>(null);
    // 写回同步跟随“这一轮运行绑定的画布”，不跟随当前页面：离开画布后进行中的那一轮仍要把结果落回原画布。
    const runCanvasId = run?.canvasId || "";
    useEffect(() => {
        if (!runCanvasId) return;
        const sync = createAgentCanvasSync({
            canvasId: runCanvasId,
            applyPatches: (patches) => applyAgentCanvasPatches(runCanvasId, patches),
            refresh: () => refreshCanvasAfterAgent(runCanvasId),
            onError: (cause) => console.warn("画布后台同步尚未完成", cause),
        });
        canvasSyncRef.current = sync;
        return () => {
            sync.dispose();
            if (canvasSyncRef.current === sync) canvasSyncRef.current = null;
        };
    }, [runCanvasId]);
    const skillPageRequestRef = useRef(false);
    const approvalRequestRef = useRef<string | null>(null);
    const pendingSubmission = useRef<CloudAgentPendingSubmission | null>(null);
    const submissionRequestRef = useRef(false);
    const conversationScope = activeConversationId;
    const currentScope = useRef(conversationScope);
    currentScope.current = conversationScope;
    useEffect(() => () => { currentScope.current = ""; conversationLoadControllerRef.current?.abort(); }, []);
    const running = Boolean(run?.cleanupPending) || run?.status === "running" || run?.status === "queued" || run?.status === "waiting_approval";
    useSyncExternalStore(canvasEditLeases.subscribe, canvasEditLeases.snapshot, () => 0);
    const canvasAgent = canvasId ? canvasEditLeases.agent(canvasId) : null;
    const otherAgentRunning = Boolean(canvasAgent && canvasAgent.runId !== run?.id);
    const cloudLiveState = useRef({ activeConversationId, run, prompt, messages, busy, running, approvalSubmitting, canvasId, pendingHydrated });
    cloudLiveState.current = { activeConversationId, run, prompt, messages, busy, running, approvalSubmitting, canvasId, pendingHydrated };
    const canvasCloudConversation = useMemo(() => canvasCloudAgentConversation(conversations, canvasId, canvasAgent?.runId), [conversations, canvasId, canvasAgent?.runId]);
    const canvasCloudConversationIsCurrent = Boolean(canvasCloudConversation && (canvasCloudConversation.id === activeConversationId || cloudAgentConversationServerId(canvasCloudConversation) === run?.conversationId));
    const restoredModelResolution = useMemo(() => restoredModel ? resolveCloudAgentModel(restoredModel, selectableModelsByCapability(config, "text")) : null, [config, restoredModel]);
    const modelRestoreError = restoredModelResolution?.problem === "ambiguous" ? "原会话模型对应多个渠道，请先手动选择模型后继续。" : restoredModelResolution?.problem === "unavailable" ? "原会话模型当前不可用，请先手动选择模型后继续。" : "";
    const selectedModel = useMemo(() => {
        if (restoredModelResolution) return restoredModelResolution.model;
        const textModels = selectableModelsByCapability(config, "text");
        const preferred = config.textModel || config.model || "";
        return textModels.includes(preferred) ? preferred : textModels[0] || "";
    }, [config, restoredModelResolution]);
    const installedSkills = useMemo(() => skills.filter((skill) => skill.isAdded), [skills]);
    const installedSkillIds = useMemo(() => new Set(installedSkills.map((skill) => skill.skillId)), [installedSkills]);

    const [createdSkills, setCreatedSkills] = useState<Skill[]>([]);

    // 用户切换后重新加载，旧请求不得把其他账号的数据写回当前面板。
    useEffect(() => {
        let active = true;
        presetApplyingRef.current = null;
        setPresetApplyingId("");
        setScenePresets([]);
        listSkillPresets()
            .then((result) => {
                if (active) setScenePresets(result.presets || []);
            })
            .catch(() => {
                if (active) setScenePresets([]);
            });
        return () => {
            active = false;
        };
    }, [userId]);

    // 用户自建技能也要能出现在推荐里：官方种子库与剧典走「已装」，自建走 scope=created。
    useEffect(() => {
        let active = true;
        setCreatedSkills([]);
        listSkills({ scope: "created", pageSize: 50 })
            .then((result) => {
                if (active) setCreatedSkills(result.skills || []);
            })
            .catch((cause) => {
                if (active) setMessages((current) => appendAgentError(current, "created-skills-error", cause, "自建技能读取失败"));
            });
        return () => {
            active = false;
        };
    }, [userId]);

    // 场景分桶：把「常用 / 推荐配方 / 场景技能」收进同一个维度，一级只显示分类。
    // 常用度：自建 > 已收藏 > 已装，同级按市场热度降序。
    const sceneBuckets = useMemo<AgentSceneBucket[]>(() => {
        const merged = new Map<string, Skill>();
        for (const skill of [...installedSkills, ...createdSkills]) {
            if (!merged.has(skill.skillId)) merged.set(skill.skillId, skill);
        }
        const rank = (skill: Skill) => (skill.isOwner ? 0 : skill.isLike ? 1 : 2);
        const frequent = [...merged.values()].sort((a, b) => rank(a) - rank(b) || (b.addedCount || 0) - (a.addedCount || 0));
        const pool = frequent.slice(0, 24);
        const sceneOf = (skill: Skill) => skill.tag || "others";
        return AGENT_SCENE_DEFS.map((definition) => ({
            key: definition.key,
            label: definition.label,
            presets: definition.key === "frequent" ? [] : scenePresets.filter((preset) => preset.scene === definition.key),
            skills: definition.key === "frequent" ? frequent.slice(0, 8) : pool.filter((skill) => sceneOf(skill) === definition.key),
        }));
    }, [installedSkills, createdSkills, scenePresets]);

    const applyScenePreset = useCallback(
        async (preset: SkillPreset) => {
            if (running || busy || presetApplyingRef.current || !historyHydrated || !pendingHydrated) return;
            const scope = conversationScope;
            const account = getActiveUserScope();
            const token = createClientUUID();
            const isCurrent = () => presetApplyingRef.current === token && currentScope.current === scope && getActiveUserScope() === account;
            const missing = preset.skillIds.filter((id) => !installedSkillIds.has(id));
            presetApplyingRef.current = token;
            setPresetApplyingId(preset.presetId);
            try {
                // 安装是持久写操作；任何失败都不能谎称整个配方已挂载。
                for (const id of missing) {
                    if (!isCurrent()) return;
                    await addSkill(id);
                    if (!isCurrent()) return;
                }
                const refreshed = await listAddedSkills();
                if (!isCurrent()) return;
                if (preset.skillIds.some((id) => !refreshed.skills.some((skill) => skill.skillId === id && skill.isAdded))) {
                    throw new Error("技能库未确认全部预设技能已安装，请刷新后重试");
                }
                setSkills(refreshed.skills);
                setSelectedSkillIds(preset.skillIds);
                setMessages((current) =>
                    appendUniqueMessage(current, {
                        id: `preset-${preset.presetId}-${Date.now()}`,
                        role: "system",
                        text: `已按「${preset.name}」挂上 ${preset.skillIds.length} 个技能${missing.length ? `（新装 ${missing.length} 个）` : ""}。${preset.rationale}`,
                    }),
                );
            } catch (cause) {
                if (isCurrent()) setMessages((current) => appendAgentError(current, `preset-${preset.presetId}`, cause, `「${preset.name}」挂载失败（已安装的技能仍在技能库中）`));
            } finally {
                if (presetApplyingRef.current === token) {
                    presetApplyingRef.current = null;
                    setPresetApplyingId("");
                }
            }
        },
        [busy, conversationScope, historyHydrated, installedSkillIds, pendingHydrated, running],
    );

    // 单个技能（含用户自建）挂载到本会话；未装的先补装，已挂的不重复追加。
    const applySingleSkill = useCallback(
        async (skill: Skill) => {
            if (running || busy || presetApplyingRef.current || !historyHydrated || !pendingHydrated) return;
            const scope = conversationScope;
            const account = getActiveUserScope();
            const token = createClientUUID();
            const isCurrent = () => presetApplyingRef.current === token && currentScope.current === scope && getActiveUserScope() === account;
            presetApplyingRef.current = token;
            setPresetApplyingId(skill.skillId);
            try {
                if (!installedSkillIds.has(skill.skillId)) {
                    await addSkill(skill.skillId);
                    if (!isCurrent()) return;
                }
                const refreshed = await listAddedSkills();
                if (!isCurrent()) return;
                if (!refreshed.skills.some((item) => item.skillId === skill.skillId && item.isAdded)) {
                    throw new Error("技能库未确认该技能已安装，请刷新后重试");
                }
                setSkills(refreshed.skills);
                setSelectedSkillIds((current) => (current.includes(skill.skillId) ? current : [...current, skill.skillId]));
                setMessages((current) =>
                    appendUniqueMessage(current, {
                        id: `skill-${skill.skillId}-${Date.now()}`,
                        role: "system",
                        text: `已把「${skill.skillName}」挂到本会话。用哪张卡交给 Agent 按任务检索。`,
                    }),
                );
            } catch (cause) {
                if (isCurrent()) setMessages((current) => appendAgentError(current, `skill-${skill.skillId}`, cause, `「${skill.skillName}」挂载失败`));
            } finally {
                if (presetApplyingRef.current === token) {
                    presetApplyingRef.current = null;
                    setPresetApplyingId("");
                }
            }
        },
        [busy, conversationScope, historyHydrated, installedSkillIds, pendingHydrated, running],
    );
    const status = run?.status || "idle";
    const statusLabel =
        status === "waiting_approval" ? "等待审批" : status === "queued" ? "排队中" : status === "running" ? "运行中" : status === "completed" ? "已完成" : status === "failed" ? "异常" : status === "cancelled" ? "已停止" : status === "rejected" ? "已拒绝" : "待命";
    const statusColor = status === "failed" ? "#e66b6b" : status === "rejected" || status === "cancelled" ? theme.node.muted : status === "waiting_approval" ? "#d6a24a" : status === "running" || status === "queued" ? "#69c29b" : theme.node.muted;

    useEffect(() => {
        if (!prefillRequest || prefillRequest.id === lastPrefillIdRef.current) return;
        lastPrefillIdRef.current = prefillRequest.id;
        if (!prefillRequest.text.trim()) return;
        setPrompt((current) => appendAgentPromptPrefill(current, prefillRequest.displayText || prefillRequest.text));
        prefilledSubmissionRef.current = prefillRequest;
        setPendingAutoSubmit(prefillRequest.autoSubmit ? prefillRequest : null);
        setView("chat");
    }, [prefillRequest]);

    useEffect(() => {
        if (!open || view !== "chat") setSkillsOpen(false);
    }, [open, view]);

    const reloadProfile = useCallback(async () => {
        const requestId = ++profileRequestRef.current;
        setProfileLoading(true);
        setProfileError(undefined);
        setProfileView(null);
        try {
            const result = await getAgentProfile({ projectId: domainProjectId, canvasId });
            if (profileRequestRef.current === requestId) setProfileView(result);
        } catch (cause) {
            if (profileRequestRef.current === requestId) setProfileError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            if (profileRequestRef.current === requestId) setProfileLoading(false);
        }
    }, [canvasId, domainProjectId]);

    useEffect(() => {
        void reloadProfile();
    }, [reloadProfile]);

    const saveProfile = async (input: { scope: AgentProfileScope; projectId?: string; canvasId?: string; content: string; revision: number }) => {
        setProfileSaving(true);
        try {
            const result = await updateAgentProfile(input);
            setProfileView(result);
            setProfileError(undefined);
            return result;
        } finally {
            setProfileSaving(false);
        }
    };

    useEffect(() => {
        const timer = window.setTimeout(() => setDebouncedSkillSearch(skillSearch.trim()), 250);
        return () => window.clearTimeout(timer);
    }, [skillSearch]);

    useEffect(() => {
        let active = true;
        setSkills([]);
        const refresh = () => {
            void listAddedSkills()
                .then((result) => {
                    if (!active) return;
                    setSkills(result.skills);
                    setMessages((current) => current.filter((message) => message.id !== "skills-load-error"));
                })
                .catch((cause) => {
                    if (active) setMessages((current) => appendAgentError(current, "skills-load-error", cause, "技能库读取失败"));
                });
        };
        refresh();
        window.addEventListener("canvas-skills-changed", refresh);
        window.addEventListener("focus", refresh);
        return () => {
            active = false;
            window.removeEventListener("canvas-skills-changed", refresh);
            window.removeEventListener("focus", refresh);
        };
    }, [open, userId]);

    useEffect(() => {
        if (view !== "settings" && !skillsOpen) return;
        let active = true;
        setSkillsLoading(true);
        void listSkills({
            scope: "public",
            ...curationQuery(curationState.curation, platformCategory),
            search: debouncedSkillSearch || undefined,
            tag: skillsOpen && skillTag !== "all" ? skillTag : undefined,
            pageSize: 20,
            sort: "popular",
        })
            .then((result) => {
                if (active) {
                    setMarketSkills(result.skills);
                    setSkillHasMore(result.hasMore);
                    setSkillPage(result.page);
                    setSkillCategories(result.categories);
                }
            })
            .catch(() => {
                if (active) setMarketSkills([]);
            })
            .finally(() => {
                if (active) setSkillsLoading(false);
            });
        return () => {
            active = false;
        };
    }, [view, skillsOpen, debouncedSkillSearch, skillTag, curationState.curation, platformCategory]);

    useEffect(() => {
        if (view !== "settings" && !skillsOpen) return;
        let active = true;
        void listSkillLibraryCategories("mine")
            .then((result) => {
                if (active) setLibraryCategories(result.categories);
            })
            .catch(() => {
                if (active) setLibraryCategories([]);
            });
        return () => {
            active = false;
        };
    }, [skillsOpen, userId, view]);

    const loadMoreSkills = async () => {
        const requestKey = skillBrowseKeyRef.current;
        if (skillsLoading || skillPageRequestRef.current || !skillHasMore || skillSearch.trim() !== debouncedSkillSearch) return;
        skillPageRequestRef.current = true;
        setSkillsLoading(true);
        try {
            const result = await listSkills({
                scope: "public",
                ...curationQuery(curationState.curation, platformCategory),
                search: debouncedSkillSearch || undefined,
                tag: skillsOpen && skillTag !== "all" ? skillTag : undefined,
                page: skillPage + 1,
                pageSize: 20,
                sort: "popular",
            });
            if (requestKey !== skillBrowseKeyRef.current) return;
            setMarketSkills((current) => [...current, ...result.skills.filter((skill) => !current.some((item) => item.skillId === skill.skillId))]);
            setSkillCategories(result.categories);
            setSkillPage(result.page);
            setSkillHasMore(result.hasMore);
        } finally {
            skillPageRequestRef.current = false;
            if (requestKey === skillBrowseKeyRef.current) setSkillsLoading(false);
        }
    };

    useEffect(() => {
        let active = true;
        hydratedAccount.current = "";
        setHistoryHydrated(false);
        setPendingHydrated(false);
        setCloudHistoryReady(false);
        setCloudHistoryError(undefined);
        setCloudOpeningId("");
        cloudOpeningRef.current = null;
        conversationLoadControllerRef.current?.abort();
        cloudRunTransitionRef.current = null;
        replayCursorRef.current = { runId: "", seq: 0 };
        setRestoredModel(null);
        pendingSubmission.current = null;
        setBusy(false);
        presetApplyingRef.current = null;
        setPresetApplyingId("");
        setConversations([]);
        setRun(null);
        setUndoStates({});
        setMessages([]);
        setSelectedSkillIds([]);
        setApproval(null);
        setApprovalSubmitting(false);
        approvalRequestRef.current = null;
        const restoreScope = `${userId}:${accountScope}`;
        if (historyRestoreScope.current !== restoreScope) setPrompt("");
        historyRestoreScope.current = restoreScope;
        void waitForCanvasSync(loadCloudAgentConversations(accountScope))
            .then(async (document) => {
                if (!active) return;
                const current = document.conversations.find((conversation) => conversation.id === document.activeId) || document.conversations[0];
                let initialSkillIds = current?.skillIds || [];
                if (!document.conversations.length) {
                    initialSkillIds = [];
                }
                setConversations(document.conversations);
                if (current) {
                    setActiveConversationId(current.id);
                    setMessages(current.messages);
                    setRun(current.run);
                    replayCursorRef.current = { runId: current.run?.id || "", seq: current.lastEventSeq || 0 };
                    setApproval(approvalStateFromRun(current.run));
                    setPrompt(current.draft || "");
                    setPermissionMode(current.permissionMode);
                    setSelectedSkillIds(initialSkillIds);
                    setRestoredModel(current.model || null);
                    let pending = await waitForCanvasSync(loadCloudAgentPendingSubmission(current.id, accountScope));
                    if (!active) return;
                    if (cloudAgentPendingMatchesRun(pending, current.run)) {
                        await waitForCanvasSync(clearCloudAgentPendingSubmission(current.id, accountScope));
                        if (!active) return;
                        if (current.draft === (pending?.displayText || pending?.request?.prompt)) setPrompt("");
                        pending = null;
                    }
                    pendingSubmission.current = pending;
                    if (pending?.request) setPrompt(pending.displayText || pending.request.prompt);
                } else {
                    const initialConversationId = nanoid();
                    const now = new Date().toISOString();
                    const initialConversation: CloudAgentConversation = {
                        id: initialConversationId,
                        title: "新对话",
                        messages: [],
                        run: null,
                        model: selectedModel || undefined,
                        permissionMode,
                        skillIds: initialSkillIds,
                        createdAt: now,
                        updatedAt: now,
                    };
                    setActiveConversationId(initialConversationId);
                    setConversations([initialConversation]);
                    setSelectedSkillIds(initialSkillIds);
                    pendingSubmission.current = null;
                    await saveCloudAgentConversations(initialConversationId, [initialConversation], accountScope);
                }
                if (active) setPendingHydrated(true);
            })
            .catch((cause) => {
                if (!active) return;
                setMessages((current) => appendAgentError(current, "history-error", cause, "提交记录待确认，可继续输入并重新读取记录"));
            })
            .finally(() => {
                if (active) {
                    hydratedAccount.current = restoreScope;
                    setHistoryHydrated(true);
                }
            });
        return () => {
            active = false;
        };
    }, [userId, accountScope, historyRestoreAttempt]);

    useEffect(() => {
        if (!historyHydrated || !pendingHydrated || !userId || hydratedAccount.current !== `${userId}:${accountScope}`) return;
        let active = true;
        let refreshing = false;
        let timer: ReturnType<typeof setTimeout>;
        const controller = new AbortController();
        setCloudHistoryReady(false);
        const refresh = async () => {
            if (!active || refreshing || !accountIsCurrent()) return;
            refreshing = true;
            setCloudHistoryLoading(true);
            try {
                const cache = conversationSnapshots.current;
                const selected = cache.find((item) => item.id === cloudLiveState.current.activeConversationId);
                const selectedId = selected ? cloudAgentConversationServerId(selected) : undefined;
                const remote = await refreshCloudAgentConversations({ canvasId: canvasId || undefined, observedConversationIds: selectedId ? [selectedId] : [], existing: cache, scope: accountScope, signal: controller.signal });
                if (!active || !accountIsCurrent() || cloudLiveState.current.canvasId !== canvasId) return;
                const live = cloudLiveState.current;
                const updates = remote.filter((item) => !cache.includes(item));
                const merged = updates.length ? mergeCloudAgentConversations(conversationSnapshots.current, updates) : conversationSnapshots.current;
                if (updates.length) setConversations((current) => mergeCloudAgentConversations(current, updates));
                setCloudHistoryError(undefined);
                setCloudHistoryReady(true);
                const existing = merged.find((item) => item.id === live.activeConversationId);
                if (!existing) return;
                const current = { ...existing, run: live.run, messages: live.messages, draft: live.prompt };
                const currentId = cloudAgentConversationServerId(existing);
                const currentCloud = currentId ? merged.find((item) => cloudAgentConversationServerId(item) === currentId) : undefined;
                const latestCanvasCandidate = canvasCloudAgentConversation(merged, canvasId, canvasId ? canvasEditLeases.agent(canvasId)?.runId : undefined);
                const candidate = currentCloud?.run?.id !== live.run?.id ? currentCloud || latestCanvasCandidate : latestCanvasCandidate || currentCloud;
                const blocked = live.busy || live.approvalSubmitting || submissionRequestRef.current || Boolean(pendingSubmission.current) || Boolean(cloudOpeningRef.current) || !live.pendingHydrated;
                const decision = cloudAgentFollowDecision({ current, candidate, canvasId, blocked });
                if (!candidate?.run || decision !== "current" && decision !== "switch") return;
                const sameRun = candidate.id === live.activeConversationId && candidate.run.id === live.run?.id;
                if (sameRun && (candidate.lastEventSeq || 0) < lastSeqRef.current) return;
                if (sameRun && (candidate.run.revision || 0) <= (live.run?.revision || 0) && candidate.run.status === live.run?.status && Boolean(candidate.run.cleanupPending) === Boolean(live.run?.cleanupPending)) return;
                // 未知 POST 身份属于原本地对话；切换前必须先读出，不能用目录发现覆盖它。
                const pending = candidate.id === live.activeConversationId ? null : await loadCloudAgentPendingSubmission(candidate.id, accountScope);
                if (!active || !accountIsCurrent() || cloudLiveState.current.activeConversationId !== live.activeConversationId || cloudLiveState.current.prompt !== live.prompt || submissionRequestRef.current || pendingSubmission.current || cloudOpeningRef.current || cloudLiveState.current.canvasId !== canvasId) return;
                const sameConversation = decision === "current";
                currentScope.current = candidate.id;
                cloudRunTransitionRef.current = candidate.run.id;
                replayCursorRef.current = { runId: candidate.run.id, seq: candidate.lastEventSeq || 0 };
                // 同一轮 GET 可能先于缓冲中的 SSE delta 到达，两个水位必须一起前进。
                lastSeqRef.current = candidate.lastEventSeq || 0;
                presetApplyingRef.current = null;
                setPresetApplyingId("");
                pendingSubmission.current = pending;
                approvalRequestRef.current = null;
                setApprovalSubmitting(false);
                setActiveConversationId(candidate.id);
                setRun(candidate.run);
                setMessages(candidate.messages);
                setUndoStates({});
                const nextApproval = approvalStateFromRun(candidate.run);
                setApproval((previous) => previous?.approvalId && previous.approvalId === nextApproval?.approvalId ? { ...nextApproval, reason: previous.reason } : nextApproval);
                if (!sameRun) {
                    setContextUsage(emptyAgentContextUsage(candidate.run.id));
                    setConnectionStatus("connecting");
                }
                if (!sameConversation) {
                    setPrompt(pending?.request ? pending.displayText || pending.request.prompt : candidate.draft || "");
                    setPermissionMode(candidate.permissionMode);
                    setSelectedSkillIds(candidate.skillIds || []);
                    setRestoredModel(candidate.model || null);
                }
            } catch (cause) {
                if (active && !controller.signal.aborted && accountIsCurrent()) setCloudHistoryError(cause instanceof Error ? cause.message : "云端对话暂时无法读取");
            } finally {
                refreshing = false;
                if (active) {
                    setCloudHistoryLoading(false);
                    clearTimeout(timer);
                    timer = setTimeout(() => { void refresh(); }, 4000);
                }
            }
        };
        const wake = () => { if (document.visibilityState !== "hidden") void refresh(); };
        void refresh();
        window.addEventListener("focus", wake);
        window.addEventListener("online", wake);
        document.addEventListener("visibilitychange", wake);
        return () => {
            active = false;
            controller.abort();
            clearTimeout(timer);
            window.removeEventListener("focus", wake);
            window.removeEventListener("online", wake);
            document.removeEventListener("visibilitychange", wake);
        };
    }, [historyHydrated, pendingHydrated, userId, accountScope, canvasId, cloudRefreshEpoch]);

    useEffect(() => {
        if (!historyHydrated || !pendingHydrated || hydratedAccount.current !== `${userId}:${accountScope}`) return;
        const now = new Date().toISOString();
        setConversations((current) => {
            const existing = current.find((conversation) => conversation.id === activeConversationId);
            const next: CloudAgentConversation = {
                ...existing,
                id: activeConversationId,
                title: cloudAgentConversationTitle(messages),
                messages,
                run,
                lastEventSeq: run?.id === replayCursorRef.current.runId ? replayCursorRef.current.seq : existing?.lastEventSeq,
                draft: prompt || undefined,
                model: restoredModel || selectedModel || undefined,
                permissionMode,
                skillIds: selectedSkillIds,
                createdAt: existing?.createdAt || now,
                updatedAt: now,
            };
            return [next, ...current.filter((conversation) => conversation.id !== activeConversationId)];
        });
    }, [activeConversationId, historyHydrated, pendingHydrated, messages, permissionMode, prompt, run, selectedModel, restoredModel, selectedSkillIds, userId, accountScope]);

    useEffect(() => {
        if (!historyHydrated || !pendingHydrated || hydratedAccount.current !== `${userId}:${accountScope}`) return;
        void saveCloudAgentConversations(activeConversationId, conversations, accountScope).catch((cause) => {
            if (accountIsCurrent()) setCloudHistoryError(cause instanceof Error ? cause.message : "本机对话缓存保存失败");
        });
    }, [activeConversationId, conversations, historyHydrated, pendingHydrated, userId, accountScope]);

    useEffect(() => {
        if (!run?.id) return;
        cloudRunTransitionRef.current = run.id;
        const after = replayCursorRef.current.runId === run.id ? replayCursorRef.current.seq : 0;
        replayCursorRef.current = { runId: run.id, seq: after };
        lastSeqRef.current = after;
        return subscribeAgentEvents(
            run.id,
            (event) => {
                if (!accountIsCurrent() || currentScope.current !== conversationScope || cloudRunTransitionRef.current !== run.id) return;
                // Only persisted agent events participate in the replay cursor.
                // Snapshot-derived UI events intentionally use seq=0.
                if (event.seq > 0) {
                    if (event.seq <= lastSeqRef.current) return;
                    if (event.seq > lastSeqRef.current + 1) canvasSyncRef.current?.reconcile();
                    lastSeqRef.current = event.seq;
                    replayCursorRef.current = { runId: run.id, seq: event.seq };
                }
                setMessages((current) => current.some((item) => item.id === `stream-error-${run.id}`) ? current.filter((item) => item.id !== `stream-error-${run.id}`) : current);
                setContextUsage((current) => reduceAgentContextUsage(current, event));
                applyAgentEvent(event, setMessages, setRun, setApproval, setPrompt);
                canvasSyncRef.current?.receive(event);
            },
            {
                after,
                onConnectionChange: (next) => { if (accountIsCurrent() && currentScope.current === conversationScope && cloudRunTransitionRef.current === run.id) setConnectionStatus(next); },
                onError: (cause) => {
                    if (!accountIsCurrent() || currentScope.current !== conversationScope || cloudRunTransitionRef.current !== run.id) return;
                    canvasSyncRef.current?.reconcile();
                    setMessages((current) => appendAgentError(current, `stream-error-${run.id}`, cause, "Agent 事件流已断开"));
                    // The observation channel failed, not the durable run. Keep
                    // identity and approval so reconnect/cancel/continue remain available.
                    setConnectionStatus("disconnected");
                },
            },
        );
    }, [run?.id, connectionEpoch, accountScope, conversationScope]);

    useEffect(() => {
        if (!run?.id || connectionStatus !== "disconnected") return;
        let queued = false;
        const reconnect = () => {
            if (queued || !accountIsCurrent() || currentScope.current !== conversationScope || cloudRunTransitionRef.current !== run.id) return;
            queued = true;
            setConnectionEpoch((value) => value + 1);
        };
        const wake = () => { if (document.visibilityState !== "hidden") reconnect(); };
        window.addEventListener("online", reconnect);
        window.addEventListener("focus", wake);
        document.addEventListener("visibilitychange", wake);
        return () => {
            window.removeEventListener("online", reconnect);
            window.removeEventListener("focus", wake);
            document.removeEventListener("visibilitychange", wake);
        };
    }, [run?.id, connectionStatus, conversationScope, accountScope]);

    const interject = async (value: string) => {
        if (!accountIsCurrent() || pendingSubmission.current) return;
        const activeRun = run;
        if (!value || !activeRun?.id || busy || connectionStatus !== "connected" || currentScope.current !== conversationScope || !historyHydrated) return;
        const scope = conversationScope;
        const messageId = `user-${createClientUUID()}`;
        setBusy(true);
        try {
            await sendAgentInterjection(activeRun.id, { text: value, messageId });
            if (!accountIsCurrent() || currentScope.current !== scope) return;
            setPrompt("");
            setMessages((current) => appendUniqueMessage(current, { id: messageId, role: "user", text: value, interjection: "sent" }));
        } catch (cause) {
            if (!accountIsCurrent() || currentScope.current !== scope) return;
            const status = (cause as { status?: number }).status;
            setMessages((current) => appendAgentError(current, `interject-error-${activeConversationId}-${messageId}`, cause, "插话没有送达"));
            if (status === 409) setPrompt(value);
        } finally {
            if (accountIsCurrent() && currentScope.current === scope) setBusy(false);
        }
    };

    const submit = async (override?: string, options?: CloudAgentMessagePresentation & { requiresVision?: boolean }) => {
        if (!accountIsCurrent() || cloudOpeningRef.current || canvasId && !cloudHistoryReady && !pendingSubmission.current?.request || modelRestoreError && !pendingSubmission.current?.request) return;
        const activity = canvasId ? canvasEditLeases.agent(canvasId) : null;
        if (activity && activity.runId !== run?.id && !pendingSubmission.current?.request) return;
        const draft = (override ?? prompt).trim();
        const pendingRequest = pendingSubmission.current;
        const prefilled = prefilledSubmissionRef.current;
        const matchesPending = pendingRequest?.request && pendingRequest.displayText === draft;
        const matchesPrefill = prefilled?.displayText === draft;
        const value = matchesPending ? pendingRequest.request!.prompt : matchesPrefill ? prefilled!.text : draft;
        options = matchesPending ? { ...options, displayText: pendingRequest.displayText, canvasReferenceNodeId: pendingRequest.canvasReferenceNodeId } : matchesPrefill ? prefilled! : options;
        if (running && !pendingRequest?.request) {
            await interject(value);
            return;
        }
        if (!value || busy || (run && connectionStatus !== "connected" && !pendingRequest?.request) || submissionRequestRef.current || !historyHydrated || !pendingHydrated || currentScope.current !== conversationScope) return;
        const scope = conversationScope;
        submissionRequestRef.current = true;
        setBusy(true);
        let accepted = false;
        let requestSent = false;
        try {
            const effectiveModel = options?.requiresVision ? selectImageInspectionModel(config, selectedModel) : selectedModel;
            if (options?.requiresVision && !effectiveModel) throw new Error("当前没有配置支持图片输入的文本模型，请在模型能力设置中为一个文本模型开启图片输入后重试");
            const pending = pendingSubmission.current;
            // An ambiguous previous POST owns its body/key until reconciled.
            // Editing model settings or prompt must not silently create a new charge.
            if (pending?.request && pending.request.prompt !== value) throw new Error("上一条请求结果待确认，请先原样重试上一条消息，再发送新要求");
            if (!pending?.request) {
                if (profileLoading) throw new Error("正在确认长期偏好快照，请稍后再发送");
                if (!profileView || profileError) throw new Error("长期偏好快照尚未确认，请重新读取后再发送");
                const capabilities = await getAgentCapabilities();
                if (!accountIsCurrent() || currentScope.current !== scope) return;
                if (!capabilities.permissionModes.includes(permissionMode)) throw new Error("当前后端不支持所选 Agent 权限，请更新后端");
                if (selectedSkillIds.length && !capabilities.skills) throw new Error("当前后端尚未接入技能库");
                // 只有当前页面是画布时才绑定画布；其他页面发出的是平台级对话轮次。
                if (canvasId) await prepareCanvasForCloudAction(canvasId);
                if (!accountIsCurrent() || currentScope.current !== scope) return;
                const agentConfig = { ...config, model: effectiveModel };
                const requestConfig = resolveModelRequestConfig(agentConfig, effectiveModel);
                const logicalModelId = logicalModelIDForConfig(agentConfig);
                const input = {
                    canvasId,
                    prompt: value,
                    reasoningMode,
                    profileRevision: profileView.revision,
                    model: modelOptionName(effectiveModel) || undefined,
                    ...(logicalModelId ? { logicalModelId } : requestConfig.channelId ? { channelId: requestConfig.channelId, channelModelKey: modelOptionName(effectiveModel) || undefined } : {}),
                    skillIds: [...new Set([...selectedSkillIds, ...resolveSkillMentions(value, installedSkills).map((skill) => skill.skillId)])],
                    focusNodeIds: canvasId ? selectedNodeIds.slice(0, 8) : [],
                    focusNodeOmittedCount: canvasId ? Math.max(0, selectedNodeIds.length - 8) : 0,
                    permissionMode,
                    contextScope: canvasId ? contextScope : [],
                    budget: { maxCredits: positiveNumber(maxCredits), maxGenerationTasks: permissionMode === "read_only" ? 0 : Number(maxGenerationTasks), maxVideoSeconds: permissionMode === "read_only" ? 0 : Number(maxVideoSeconds) },
                };
                const fingerprint = JSON.stringify({ scope, parent: run?.id, input });
                if (pending && pending.fingerprint !== fingerprint) throw new Error("上一条请求尚未确认，请恢复原消息与设置后核对，不能覆盖原幂等记录");
                const key = pending?.key || createClientUUID();
                const next = { fingerprint, key, request: { ...input, idempotencyKey: key }, parentRunId: run?.id, messageId: `user-${key}`, displayText: options?.displayText, canvasReferenceNodeId: options?.canvasReferenceNodeId };
                // Persist before sending. A failed local save must not submit a request
                // whose recovery identity will disappear on reload.
                await waitForCanvasSync(saveCloudAgentPendingSubmission(activeConversationId, next, accountScope));
                if (!accountIsCurrent() || currentScope.current !== scope) return;
                pendingSubmission.current = next;
            }
            const submission = pendingSubmission.current!;
            const request = submission.request!;
            const formAnswer = parseCloudAgentFormAnswer(request.prompt);
            const nextMessages = appendUniqueMessage(messages, {
                id: submission.messageId || `user-${submission.key}`,
                role: "user",
                text: formAnswer ? "已确认创作方向" : submission.displayText || request.prompt,
                ...(formAnswer ? { formAnswer } : {}),
                ...(submission.canvasReferenceNodeId ? { canvasReferenceNodeId: submission.canvasReferenceNodeId } : {}),
            });
            const now = new Date().toISOString();
            const existing = conversations.find((item) => item.id === activeConversationId);
            // Persist a discoverable conversation before POST as well as its key;
            // otherwise a reload of a brand-new chat can orphan the pending record.
            await waitForCanvasSync(saveCloudAgentConversations(activeConversationId, [
                {
                    ...existing,
                    id: activeConversationId,
                    title: cloudAgentConversationTitle(nextMessages),
                    messages: nextMessages,
                    run,
                    model: request.model || effectiveModel || undefined,
                    permissionMode,
                    skillIds: selectedSkillIds,
                    createdAt: existing?.createdAt || now,
                    updatedAt: now,
                },
                ...conversations.filter((item) => item.id !== activeConversationId),
            ], accountScope));
            if (!accountIsCurrent() || currentScope.current !== scope) return;
            setPrompt("");
            prefilledSubmissionRef.current = null;
            setMessages(nextMessages);
            requestSent = true;
            const result = submission.parentRunId ? await sendAgentMessage(submission.parentRunId, request) : await createAgentRun(request);
            accepted = true;
            if (accountIsCurrent() && currentScope.current === scope) {
                replayCursorRef.current = { runId: result.run.id, seq: 0 };
                cloudRunTransitionRef.current = result.run.id;
                setRun(result.run);
                setConversations((current) => current.map((item) => item.id === activeConversationId ? { ...item, serverConversationId: result.run.conversationId, run: result.run, lastEventSeq: 0 } : item));
            }
            await waitForCanvasSync(clearCloudAgentPendingSubmission(activeConversationId, accountScope));
            if (accountIsCurrent() && currentScope.current === scope) pendingSubmission.current = null;
        } catch (cause) {
            if (!accountIsCurrent() || currentScope.current !== scope) return;
            if (cause instanceof CanvasSyncPendingError) return;
            if (canvasId) canvasEditLeases.agentRejected(canvasId, cause);
            if (!accepted) {
                setPrompt(value);
                const status = (cause as { status?: number }).status;
                const reason = (cause as { reason?: string }).reason;
                if (reason === "agent_conversation_stale_parent" || !pendingRequest?.request && (reason === "canvas_agent_busy" || (status && [400, 401, 403, 404, 422].includes(status)))) {
                    // These admission responses explicitly rejected the write.
                    // stale_parent is checked after same-key replay, so even an
                    // original retry has now been confirmed unaccepted. Other
                    // ambiguous retries retain their original body and key.
                    try {
                        const rejectedMessageId = pendingSubmission.current?.messageId;
                        await waitForCanvasSync(clearCloudAgentPendingSubmission(activeConversationId, accountScope));
                        if (!accountIsCurrent() || currentScope.current !== scope) return;
                        pendingSubmission.current = null;
                        if (reason === "agent_conversation_stale_parent") {
                            const correctedMessages = appendUniqueMessage(cloudLiveState.current.messages.filter((item) => item.id !== rejectedMessageId), {
                                id: `stale-parent-${activeConversationId}-${run?.id || "initial"}`,
                                role: "system",
                                text: "另一端已接续新一轮，正在同步对话。输入已保留，请确认最新上下文后再发送。",
                            });
                            const corrected = conversationSnapshots.current.map((item) => item.id === activeConversationId ? { ...item, messages: correctedMessages, draft: value } : item);
                            conversationSnapshots.current = corrected;
                            setConversations(corrected);
                            setMessages(correctedMessages);
                            setCloudRefreshEpoch((value) => value + 1);
                            return;
                        }
                        if (reason === "canvas_agent_busy") setCloudRefreshEpoch((value) => value + 1);
                    } catch (storageError) {
                        if (!accountIsCurrent() || currentScope.current !== scope) return;
                        setMessages((current) => appendAgentError(current, `pending-storage-${activeConversationId}`, storageError, "提交记录更新失败"));
                    }
                }
            }
            setMessages((current) => appendAgentError(current, `submit-error-${activeConversationId}`, cause, agentSubmissionErrorTitle(cause, accepted, requestSent)));
        } finally {
            submissionRequestRef.current = false;
            if (accountIsCurrent() && currentScope.current === scope) setBusy(false);
        }
    };

    useEffect(() => {
        const pending = pendingAutoSubmit;
        if (!pending || !historyHydrated || !pendingHydrated || !cloudHistoryReady || modelRestoreError || profileLoading || !profileView || profileError || busy || running || otherAgentRunning) return;
        setPendingAutoSubmit(null);
        void submit(pending.text, { requiresVision: pending.requiresVision, displayText: pending.displayText, canvasReferenceNodeId: pending.canvasReferenceNodeId });
    }, [busy, historyHydrated, cloudHistoryReady, modelRestoreError, otherAgentRunning, pendingAutoSubmit, pendingHydrated, profileError, profileLoading, profileView, running]);

    const undoCanvasStep = async (target: AgentCanvasUndoTarget) => {
        const activeRun = run;
        const scope = conversationScope;
        const key = agentCanvasUndoKey(target);
        if (!activeRun?.canvasId || target.canvasId !== activeRun.canvasId || busy || running || otherAgentRunning || currentScope.current !== scope || undoRequestsRef.current.has(key)) return;
        if (undoStates[key]?.status === "done" || undoStates[key]?.status === "pending") return;
        undoRequestsRef.current.add(key);
        setUndoStates((current) => ({ ...current, [key]: { status: "pending" } }));
        try {
            const result = await undoAgentCanvasRun(target.runId, { stepId: target.stepId, expectedSnapshotHash: target.expectedSnapshotHash, reason: "用户在 Agent 面板撤销画布写入" });
            if (!result.accepted) throw new Error("服务端没有确认撤销");
            if (!accountIsCurrent() || currentScope.current !== scope) return;
            setUndoStates((current) => ({ ...current, [key]: { status: "done" } }));
            setMessages((current) => current.map((item) => {
                const detail = item.detail as { runId?: string; callId?: string } | undefined;
                return detail?.runId === target.runId && detail.callId === target.stepId ? { ...item, detail: { ...detail, undoStatus: "undone" } } : item;
            }));
            try {
                const [, snapshot] = await Promise.all([refreshCanvasAfterAgent(target.canvasId), getAgentRun(activeRun.id, AbortSignal.timeout(10_000))]);
                if (accountIsCurrent() && currentScope.current === scope) {
                    setRun((current) => (current?.id === activeRun.id ? snapshot.run : current));
                    setConnectionEpoch((value) => value + 1);
                }
            } catch (refreshError) {
                if (accountIsCurrent() && currentScope.current === scope) setMessages((current) => appendAgentError(current, `undo-refresh-${key}`, refreshError, "已撤销，但画布或运行状态刷新失败"));
            }
        } catch (cause) {
            if (accountIsCurrent() && currentScope.current === scope) setUndoStates((current) => ({ ...current, [key]: { status: "error", error: cause instanceof Error ? cause.message : String(cause) } }));
        } finally {
            undoRequestsRef.current.delete(key);
        }
    };

    const stop = async () => {
        const activeRun = run;
        if (!activeRun?.id || stopping || otherAgentRunning) return;
        setStopping(true);
        try {
            await cancelAgentRun(activeRun.id);
            const snapshot = await getAgentRun(activeRun.id, AbortSignal.timeout(5_000));
            if (accountIsCurrent() && currentScope.current === conversationScope) {
                setRun((current) => (current?.id === activeRun.id ? snapshot.run : current));
                if (!snapshot.run.approval) setApproval(null);
                setConnectionEpoch((value) => value + 1);
            }
        } catch (cause) {
            if (accountIsCurrent() && currentScope.current === conversationScope) {
                // An ambiguous cancellation is not proof of a terminal run. Keep
                // the run and approval until the server confirms their state.
                setConnectionEpoch((value) => value + 1);
                setMessages((current) => appendAgentError(current, `cancel-${activeRun.id}`, cause, "取消结果未确认，正在重新核对运行状态"));
            }
        } finally {
            setStopping(false);
        }
    };

    const submitApproval = async (decision: "approve" | "reject", mediaSettings?: AgentMediaSettings) => {
        if (!run || !approval || otherAgentRunning || connectionStatus !== "connected" || approvalRequestRef.current === approval.approvalId) return;
        const runId = run.id;
        const approvalId = approval.approvalId;
        const scope = conversationScope;
        approvalRequestRef.current = approvalId;
        setApprovalSubmitting(true);
        try {
            if (decision === "approve" && run.canvasId) {
                await prepareCanvasForCloudAction(run.canvasId);
                if (!accountIsCurrent() || currentScope.current !== scope) return;
            }
            if (!accountIsCurrent() || currentScope.current !== scope) return;
            await decideAgentApproval(runId, approvalId, decision, approval.reason, AbortSignal.timeout(15_000), mediaSettings);
            if (accountIsCurrent() && currentScope.current === scope) {
                setApproval((current) => (current?.approvalId === approvalId ? null : current));
                setRun((current) =>
                    current?.id === runId && current.status === "waiting_approval" && (!current.approval || current.approval.approvalId === approvalId)
                        ? { ...current, status: decision === "reject" ? "rejected" : "running", approval: undefined }
                        : current,
                );
            }
        } catch (cause) {
            if (!accountIsCurrent() || currentScope.current !== scope) return;
            if (cause instanceof CanvasSyncPendingError) return;
            // A timed-out response is ambiguous: query the durable decision before
            // asking the user to retry. The backend treats identical decisions idempotently.
            try {
                const snapshot = await getAgentRun(runId, AbortSignal.timeout(5_000));
                if (!accountIsCurrent() || currentScope.current !== scope) return;
                if (snapshot.run.approval?.approvalId !== approvalId || snapshot.run.approval?.decision || snapshot.run.status !== "waiting_approval") {
                    // 另一端已经处理审批：读取实际状态，不自动重发当前端的决定。
                    setRun(snapshot.run);
                    setApproval(approvalStateFromRun(snapshot.run));
                    setConnectionEpoch((value) => value + 1);
                    setCloudRefreshEpoch((value) => value + 1);
                    return;
                }
                const decided = snapshot.run.events?.some(
                    (event) => event.type === "approval_decided" && event.payload.approvalId === approvalId && event.payload.decision === decision && (!mediaSettings || agentApprovalMatchesSettings(event.payload.arguments, mediaSettings)),
                );
                if (decided) {
                    setApproval((current) => (current?.approvalId === approvalId ? null : current));
                    setRun(snapshot.run);
                    return;
                }
            } catch {
                // Preserve the pending approval so the same decision can be retried.
            }
            setMessages((current) => appendAgentError(current, `approval-error-${Date.now()}`, cause, "审批未确认，请重试"));
        } finally {
            if (approvalRequestRef.current === approvalId) approvalRequestRef.current = null;
            if (accountIsCurrent() && currentScope.current === scope) setApprovalSubmitting(false);
        }
    };

    const installSkill = async (skill: Skill) => {
        if (skill.isAdded) return;
        try {
            const result = await addSkill(skill.skillId);
            setSkills((current) => [...current.filter((item) => item.skillId !== skill.skillId), result.skill]);
            setMarketSkills((current) => current.map((item) => (item.skillId === skill.skillId ? result.skill : item)));
            setSelectedSkillIds((current) => (current.includes(skill.skillId) ? current : [...current, skill.skillId]));
        } catch (cause) {
            setMessages((current) => appendAgentError(current, `skill-error-${Date.now()}`, cause, "添加 Skill 失败"));
        }
    };

    const setModel = (model: string) => {
        setRestoredModel(null);
        updateConfig("textModel", model);
        updateConfig("model", model);
    };

    const canSwitchConversation = () => {
        if (!accountIsCurrent() || !historyHydrated || !pendingHydrated || busy || running || submissionRequestRef.current || pendingSubmission.current || cloudOpeningRef.current) return false;
        return true;
    };

    const newConversation = () => {
        if (!canSwitchConversation()) return;
        if (selectedModel) setModel(selectedModel);
        else setRestoredModel(null);
        const id = nanoid();
        const now = new Date().toISOString();
        const inheritedSkillIds = [...selectedSkillIds];
        currentScope.current = id;
        presetApplyingRef.current = null;
        setPresetApplyingId("");
        setPendingHydrated(true);
        setBusy(false);
        pendingSubmission.current = null;
        approvalRequestRef.current = null;
        setApprovalSubmitting(false);
        setActiveConversationId(id);
        setRun(null);
        setUndoStates({});
        setMessages([]);
        // Skills are a user-selected Agent workspace setting. Keep them when
        // starting a fresh conversation so the skill picker does not appear to
        // lose the skills the user just enabled.
        setSelectedSkillIds(inheritedSkillIds);
        setPrompt("");
        setApproval(null);
        lastSeqRef.current = 0;
        // Persist the blank conversation immediately. Otherwise the active id
        // can point at no conversation after a reload, losing the inherited
        // skill selection before the first message is sent.
        setConversations((current) => [
            {
                id,
                title: "新对话",
                messages: [],
                run: null,
                draft: "",
                localNewCanvasId: canvasId || "global",
                model: selectedModel || undefined,
                permissionMode,
                skillIds: inheritedSkillIds,
                createdAt: now,
                updatedAt: now,
            },
            ...current.filter((conversation) => conversation.messages.length > 0 || conversation.run || conversation.draft?.trim()),
        ]);
        setView("chat");
    };

    const restoreConversation = (conversation: CloudAgentConversation) => {
        const cursor = conversation.run?.id === replayCursorRef.current.runId ? Math.max(lastSeqRef.current, conversation.lastEventSeq || 0) : conversation.lastEventSeq || 0;
        currentScope.current = conversation.id;
        cloudRunTransitionRef.current = conversation.run?.id || null;
        replayCursorRef.current = { runId: conversation.run?.id || "", seq: cursor };
        lastSeqRef.current = cursor;
        presetApplyingRef.current = null;
        setPresetApplyingId("");
        setPendingHydrated(false);
        setBusy(false);
        pendingSubmission.current = null;
        approvalRequestRef.current = null;
        setApprovalSubmitting(false);
        setActiveConversationId(conversation.id);
        setRun(conversation.run);
        setUndoStates({});
        setMessages(conversation.messages);
        setPermissionMode(conversation.permissionMode);
        setSelectedSkillIds(conversation.skillIds || []);
        setApproval(approvalStateFromRun(conversation.run));
        setPrompt(conversation.draft || "");
        setRestoredModel(conversation.model || null);
        setView("chat");
        void waitForCanvasSync(loadCloudAgentPendingSubmission(conversation.id, accountScope))
            .then(async (pending) => {
                if (cloudAgentPendingMatchesRun(pending, conversation.run)) {
                    await waitForCanvasSync(clearCloudAgentPendingSubmission(conversation.id, accountScope));
                    if (accountIsCurrent() && currentScope.current === conversation.id && conversation.draft === (pending?.displayText || pending?.request?.prompt)) setPrompt("");
                    pending = null;
                }
                if (accountIsCurrent() && currentScope.current === conversation.id) {
                    pendingSubmission.current = pending;
                    setPendingHydrated(true);
                    if (pending?.request) setPrompt(pending.displayText || pending.request.prompt);
                }
            })
            .catch((cause) => {
                if (accountIsCurrent() && currentScope.current === conversation.id) setMessages((current) => appendAgentError(current, `pending-${conversation.id}`, cause, "待确认请求读取失败"));
            });
    };
    const openConversation = async (conversation: CloudAgentConversation) => {
        if (!canSwitchConversation()) return;
        const id = cloudAgentConversationServerId(conversation);
        if (!id) {
            const selected = { ...conversation, localSelectedCanvasId: canvasId || "global" };
            setConversations((current) => current.map((item) => item.id === selected.id ? selected : item));
            restoreConversation(selected);
            return;
        }
        const token = createClientUUID();
        const openingScope = currentScope.current;
        const openingCanvas = canvasId;
        const controller = new AbortController();
        conversationLoadControllerRef.current?.abort();
        conversationLoadControllerRef.current = controller;
        cloudOpeningRef.current = token;
        setCloudOpeningId(conversation.id);
        try {
            const loaded = await loadCloudAgentConversation(id, { signal: controller.signal, scope: accountScope, existing: conversation });
            if (!accountIsCurrent() || cloudOpeningRef.current !== token || currentScope.current !== openingScope || cloudLiveState.current.canvasId !== openingCanvas) return;
            const next = mergeCloudAgentConversations(conversationSnapshots.current, [loaded]);
            const matching = next.find((item) => cloudAgentConversationServerId(item) === id);
            if (!matching) throw new Error("云端对话尚未确认，请刷新后重试");
            const restored = { ...matching, localSelectedCanvasId: openingCanvas || "global" };
            setConversations(next.map((item) => item.id === restored.id ? restored : item));
            restoreConversation(restored);
        } catch (cause) {
            if (!controller.signal.aborted && accountIsCurrent() && cloudOpeningRef.current === token) setCloudHistoryError(cause instanceof Error ? cause.message : "云端对话读取失败");
        } finally {
            if (cloudOpeningRef.current === token) {
                cloudOpeningRef.current = null;
                setCloudOpeningId("");
            }
            if (conversationLoadControllerRef.current === controller) conversationLoadControllerRef.current = null;
        }
    };
    const deleteConversation = (id: string) => {
        if (!canSwitchConversation() || conversations.some((item) => item.id === id && cloudAgentConversationServerId(item))) return;
        const next = conversations.filter((item) => item.id !== id);
        setConversations(next);
        if (id === activeConversationId) newConversation();
        void saveCloudAgentConversations(id === activeConversationId ? null : activeConversationId, next, accountScope).catch((cause) => { if (accountIsCurrent()) setCloudHistoryError(String(cause)); });
    };

    return (
        <>
            <AgentLauncher theme={theme} statusColor={statusColor} approvalPending={Boolean(approval)} reducedMotion={Boolean(reducedMotion)} status={status} hidden={open} onOpen={onOpen} />
            <AnimatePresence>
                {open ? (
                    <motion.aside
                        initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 20, scale: 0.975 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.985 }}
                        transition={{ duration: reducedMotion ? 0 : 0.26, ease: [0.16, 1, 0.3, 1] }}
                        className="canvas-agent-panel fixed z-[calc(var(--z-toast)+1)] flex min-w-0 flex-col overflow-hidden"
                        style={
                            { ...panelLayout.style, "--agent-surface-base": theme.node.panel, "--agent-ink": theme.node.text, "--agent-accent": theme.accent.primary, "--agent-shadow-color": theme.spatial.shadow } as CSSProperties &
                                Record<`--${string}`, string>
                        }
                        aria-label="Agent 工作台"
                        data-popover-anchor-container
                        data-canvas-no-zoom
                        data-canvas-wheel-scroll
                        {...panelLayout.pointerHandlers}
                        onWheel={(event) => event.stopPropagation()}
                    >
                        <div data-agent-resize="north" className="absolute inset-x-5 top-0 z-10 hidden h-2 cursor-n-resize touch-none sm:block" />
                        <div data-agent-resize="west" className="absolute bottom-5 left-0 top-5 z-10 hidden w-2 cursor-w-resize touch-none sm:block" />
                        <button
                            type="button"
                            aria-label="调整 Agent 面板大小"
                            title="拖动调整宽高，也可用方向键调整"
                            data-agent-resize="northwest"
                            className="agent-panel-resize-corner absolute left-2 top-2 z-10 hidden size-5 cursor-nw-resize touch-none place-items-center rounded-md opacity-60 transition-opacity hover:opacity-100 focus-visible:outline focus-visible:outline-2 sm:grid"
                            onKeyDown={panelLayout.onResizeKeyDown}
                            style={{ color: theme.node.muted }}
                        >
                            <MoveDiagonal2 className="size-3" aria-hidden="true" />
                        </button>
                        <AnimatePresence mode="wait" initial={false}>
                            {view === "settings" ? (
                                <motion.div key="settings" className="flex min-h-0 flex-1" initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 18 }} transition={{ duration: reducedMotion ? 0 : 0.18 }}>
                                    <CanvasCloudAgentSettings
                                        theme={theme}
                                        config={config}
                                        selectedModel={selectedModel}
                                        permissionMode={permissionMode}
                                        contextScope={contextScope}
                                        nodeCount={canvasId ? nodeCount : null}
                                        installedSkills={installedSkills}
                                        marketSkills={marketSkills}
                                        selectedSkillIds={selectedSkillIds}
                                        skillSearch={skillSearch}
                                        skillsLoading={skillsLoading}
                                        skillHasMore={skillHasMore}
                                        maxCredits={maxCredits}
                                        maxGenerationTasks={maxGenerationTasks}
                                        maxVideoSeconds={maxVideoSeconds}
                                        onBack={() => setView("chat")}
                                        onModelChange={setModel}
                                        onPermissionChange={setPermissionMode}
                                        reasoningMode={reasoningMode}
                                        onReasoningModeChange={setReasoningMode}
                                        profileView={profileView}
                                        profileLoading={profileLoading}
                                        profileSaving={profileSaving}
                                        profileError={profileError}
                                        projectId={domainProjectId}
                                        canvasId={canvasId}
                                        onReloadProfile={reloadProfile}
                                        onSaveProfile={saveProfile}
                                        onContextToggle={(value) => setContextScope((current) => (current.includes(value) ? current.filter((item) => item !== value) : [...current, value]))}
                                        onSkillSearch={setSkillSearch}
                                        onSkillToggle={(id) => setSelectedSkillIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))}
                                        onSkillInstall={installSkill}
                                        onLoadMoreSkills={loadMoreSkills}
                                        onMaxCreditsChange={setMaxCredits}
                                        onMaxGenerationTasksChange={setMaxGenerationTasks}
                                        onMaxVideoSecondsChange={setMaxVideoSeconds}
                                    />
                                </motion.div>
                            ) : view === "history" ? (
                                <motion.div key="history" className="flex min-h-0 flex-1" initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 18 }} transition={{ duration: reducedMotion ? 0 : 0.18 }}>
                                    <AgentHistory conversations={conversations} activeConversationId={activeConversationId} theme={theme} onBack={() => setView("chat")} onNew={newConversation} onOpen={(conversation) => void openConversation(conversation)} onDelete={deleteConversation} loading={cloudHistoryLoading} error={cloudHistoryError} openingId={cloudOpeningId} onRefresh={() => setCloudRefreshEpoch((value) => value + 1)} />
                                </motion.div>
                            ) : (
                                <motion.div key="chat" className="flex min-h-0 flex-1 flex-col" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: reducedMotion ? 0 : 0.18 }}>
                                    <AgentHeader
                                        theme={theme}
                                        hasMessages={messages.length > 0}
                                        statusLabel={statusLabel}
                                        statusColor={statusColor}
                                        nodeCount={canvasId ? nodeCount : null}
                                        onNew={newConversation}
                                        onHistory={() => setView("history")}
                                        exporting={exporting}
                                        onExport={() => {
                                            if (exporting) return;
                                            setExporting(true);
                                            void (async () => {
                                                let snapshot = run;
                                                let snapshotError: string | undefined;
                                                if (run?.id) {
                                                    try {
                                                        snapshot = (await getAgentRun(run.id, AbortSignal.timeout(15_000))).run;
                                                    } catch (cause) {
                                                        snapshotError = cause instanceof Error ? cause.message : String(cause);
                                                    }
                                                }
                                                const text = buildAgentDebugExport({ canvasId, conversationId: activeConversationId, messages, run: snapshot, approval, model: selectedModel, permissionMode, snapshotError });
                                                saveAs(new Blob([text], { type: "application/json;charset=utf-8" }), `agent-debug-${activeConversationId}-${Date.now()}.json`);
                                            })()
                                                .catch((cause) => setMessages((current) => appendAgentError(current, `export-${Date.now()}`, cause, "导出失败")))
                                                .finally(() => setExporting(false));
                                        }}
                                        onSettings={() => setView("settings")}
                                        onResetLayout={panelLayout.reset}
                                        onCollapse={onCollapse}
                                    />
                                    {cloudHistoryError || canvasId && !cloudHistoryReady ? (
                                        <div role="status" className="flex items-center justify-between gap-2 px-5 py-2 text-xs" style={{ color: theme.node.muted }}>
                                            <span>{cloudHistoryError ? "云端对话暂时未同步，本机草稿已保留。" : "正在同步此画布的云端对话…"}</span>
                                            {cloudHistoryError ? <Button size="small" loading={cloudHistoryLoading} onClick={() => setCloudRefreshEpoch((value) => value + 1)}>重新同步</Button> : null}
                                        </div>
                                    ) : null}
                                    {run && connectionStatus !== "connected" ? (
                                        <div role="status" className="flex items-center justify-between gap-2 px-5 py-2 text-xs" style={{ color: theme.node.muted }}>
                                            <span>{connectionStatus === "disconnected" ? "连接已断开，服务端任务可能仍在执行；运行记录已保留" : "正在连接并校准运行状态…"}</span>
                                            {connectionStatus === "disconnected" ? (
                                                <Button size="small" onClick={() => setConnectionEpoch((value) => value + 1)}>
                                                    重新连接
                                                </Button>
                                            ) : null}
                                        </div>
                                    ) : null}
                                    <AgentConversation
                                        key={activeConversationId}
                                        theme={theme}
                                        messages={messages}
                                        onFocusNode={onFocusNode}
                                        onUndo={busy || running || otherAgentRunning ? undefined : (target) => void undoCanvasStep(target)}
                                        undoStates={undoStates}
                                        references={[...references, ...buildSkillMentionReferences(installedSkills)]}
                                        busy={busy || running}
                                        approval={approval}
                                        approvalTargetGenerating={approval ? agentApprovalTargetGenerating(approval.detail, canvasNodes, runningNodeId) : undefined}
                                        nodeCount={canvasId ? nodeCount : null}
                                        approvalSubmitting={otherAgentRunning || approvalSubmitting || connectionStatus !== "connected"}
                                        onChooseSkill={() => setSkillsOpen(true)}
                                        onDraftPrompt={(draft) => setPrompt((current) => (current.trim() ? `${current}\n\n${draft}` : draft))}
                                        onApprovalReasonChange={(reason) => setApproval((current) => (current ? { ...current, reason } : current))}
                                        onApprove={(settings) => void submitApproval("approve", settings)}
                                        onReject={() => void submitApproval("reject")}
                                    />
                                    {canvasCloudConversation && !canvasCloudConversationIsCurrent ? (
                                        <div role="status" className="flex items-center justify-between gap-2 px-5 py-2 text-xs" style={{ color: theme.node.muted }}>
                                            <span>此画布有可接续的云端对话。{prompt.trim() ? "未发送内容会保留在原对话。" : "手机、电脑可查看同一进度。"}</span>
                                            <Button size="small" loading={cloudOpeningId === canvasCloudConversation.id} disabled={busy || running || !pendingHydrated || Boolean(pendingSubmission.current) || Boolean(cloudOpeningId)} onClick={() => void openConversation(canvasCloudConversation)}>接续此画布对话</Button>
                                        </div>
                                    ) : otherAgentRunning ? (
                                        <div role="status" className="px-5 py-2 text-xs" style={{ color: theme.node.muted }}>
                                            {canvasAgent?.cleanupPending ? "当前画布的 Agent 正在收尾，完成后即可使用" : "当前画布有正在执行的 Agent 任务，正在同步对话；同步前暂不重复发送"}
                                        </div>
                                    ) : null}
                                    {planVisible ? (
                                        <AgentPlanBar
                                            items={planItems}
                                            theme={theme}
                                            minimized={planMinimized}
                                            terminal={planTerminal || Boolean(run && ["completed", "failed", "cancelled", "rejected"].includes(run.status))}
                                            waitingUser={Boolean(pendingQuestion)}
                                            onToggle={() => setPlanMinimized((value) => !value)}
                                        />
                                    ) : null}
                                    {historyHydrated && !messages.some((message) => message.role === "user" || message.role === "assistant") && !run ? (
                                        <AgentSceneCapsules
                                            buckets={sceneBuckets}
                                            installedIds={installedSkillIds}
                                            theme={theme}
                                            disabled={otherAgentRunning || busy || running || !pendingHydrated || Boolean(presetApplyingId)}
                                            onPick={(preset) => void applyScenePreset(preset)}
                                            onPickSkill={(skill) => void applySingleSkill(skill)}
                                        />
                                    ) : null}
                                    {pendingQuestion ? <AgentQuestionBar question={pendingQuestion} theme={theme} disabled={otherAgentRunning || approvalSubmitting || connectionStatus !== "connected"} onAnswer={(label) => void submit(label)} /> : null}
                                    {historyHydrated && !pendingHydrated ? <div className="flex items-center gap-2 px-5 py-2 text-xs" role="status"><span>提交记录尚未确认，输入保留；画布可继续编辑。</span><Button size="small" onClick={() => setHistoryRestoreAttempt((attempt) => attempt + 1)}>重新读取记录</Button></div> : null}
                                    {modelRestoreError ? <div className="px-5 py-2 text-xs" role="status" style={{ color: theme.node.muted }}>{modelRestoreError}</div> : null}
                                    <AgentChatComposer
                                        prompt={prompt}
                                        submitDisabled={otherAgentRunning && !pendingSubmission.current?.request || Boolean(run && connectionStatus !== "connected" && !pendingSubmission.current?.request) || !historyHydrated || !pendingHydrated || Boolean(canvasId && !cloudHistoryReady && !pendingSubmission.current?.request) || Boolean(cloudOpeningId) || Boolean(modelRestoreError && !pendingSubmission.current?.request)}
                                        sending={busy}
                                        running={running}
                                        placeholder={running ? "运行中可直接插话，会在它下一步生效" : "输入操作指导；用 @ 引用画布节点，用 / 或 、 引用 Skills"}
                                        theme={theme}
                                        onPromptChange={setPrompt}
                                        onSubmit={() => void submit()}
                                        onStop={!otherAgentRunning && run?.id && running ? stop : undefined}
                                        stopping={stopping}
                                        references={[...references, ...buildSkillMentionReferences(installedSkills)]}
                                        slashSkills={installedSkills}
                                        includeAssetLibrary={false}
                                        submitAccessory={<AgentContextRing view={presentAgentContextUsage(contextUsage)} theme={theme} />}
                                        footer={connectorsVisible ? <AgentConnectorsBar onClose={() => setConnectorsVisible(false)} /> : null}
                                        left={
                                            <ComposerControls
                                                config={config}
                                                selectedModel={selectedModel}
                                                permissionMode={permissionMode}
                                                theme={theme}
                                                onModelChange={setModel}
                                                onPermissionChange={setPermissionMode}
                                                skillsOpen={skillsOpen}
                                                onSkillsOpenChange={setSkillsOpen}
                                                selectedSkillCount={selectedSkillIds.length}
                                            />
                                        }
                                    />
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </motion.aside>
                ) : null}
            </AnimatePresence>
            <CanvasAgentSkillLibraryModal
                curationState={curationState}
                platformCategory={platformCategory}
                onPlatformCategoryChange={(value) => { setPlatformCategory(value); setSkillTag("all"); }}
                open={skillsOpen}
                theme={theme}
                installedSkills={installedSkills}
                marketSkills={marketSkills}
                selectedSkillIds={selectedSkillIds}
                categories={skillCategories}
                libraryCategories={libraryCategories}
                category={skillTag}
                search={skillSearch}
                loading={skillsLoading}
                hasMore={skillHasMore}
                onClose={() => setSkillsOpen(false)}
                onCategoryChange={setSkillTag}
                onSearch={setSkillSearch}
                onToggle={(id) =>
                    setSelectedSkillIds((current) => {
                        if (current.includes(id)) return current.filter((item) => item !== id);
                        return [...current, id];
                    })
                }
                onInstall={installSkill}
                onLoadMore={loadMoreSkills}
            />
        </>
    );
});
