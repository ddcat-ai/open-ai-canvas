import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
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
    cloudAgentConversationTitle,
    loadCloudAgentConversations,
    loadCloudAgentPendingSubmission,
    saveCloudAgentConversations,
    saveCloudAgentPendingSubmission,
    type CloudAgentConversation,
    type CloudAgentPendingSubmission,
} from "@/services/cloud-agent-conversations";
import { logicalModelIDForConfig, modelOptionName, resolveModelRequestConfig, selectableModelsByCapability, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { getActiveUserScope } from "@/lib/user-scope";
import { applyAgentCanvasPatches, refreshCanvasAfterAgent, saveRemoteUserDataNow } from "@/services/user-data-sync";
import { createAgentCanvasSync } from "@/services/agent-canvas-sync";
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

type CloudAgentPanelProps = {
    canvasId: string;
    domainProjectId?: string;
    nodeCount: number;
    selectedNodeIds: string[];
    references: CanvasResourceReference[];
    open: boolean;
    /** 外部预填请求（如右键“发送到 Agent”）；id 变化即追加一次 text。 */
    prefillRequest?: { id: number; text: string } | null;
    onOpen: () => void;
    onCollapse: () => void;
    onFocusNode?: (nodeId: string) => void;
    /** 画布节点快照：用于识别审批目标节点是否已被用户直接提交生成。 */
    canvasNodes?: readonly CanvasNodeData[];
    runningNodeId?: string | null;
};
type AgentPanelView = "chat" | "history" | "settings";

function approvalStateFromRun(nextRun: AgentRun | null): ApprovalState | null {
    const approval = nextRun?.approval;
    if (!approval?.approvalId || approval.decision) return null;
    return {
        approvalId: approval.approvalId,
        detail: approval,
        reason: approval.reason || "",
    };
}

export function CanvasCloudAgentPanel({ canvasId, domainProjectId, nodeCount, selectedNodeIds, references, open, prefillRequest, onOpen, onCollapse, onFocusNode, canvasNodes, runningNodeId }: CloudAgentPanelProps) {
    const userId = useUserStore((state) => state.user?.id);
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
    const lastPrefillIdRef = useRef(0);
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
    const [exporting, setExporting] = useState(false);
    const [stopping, setStopping] = useState(false);
    const [approval, setApproval] = useState<ApprovalState | null>(null);
    const [permissionMode, setPermissionMode] = useState<AgentPermissionMode>("request_approval");
    const [contextScope, setContextScope] = useState<AgentContextKey[]>(["canvas"]);
    const [maxCredits, setMaxCredits] = useState("200");
    const [maxGenerationTasks, setMaxGenerationTasks] = useState("0");
    const [maxVideoSeconds, setMaxVideoSeconds] = useState("0");
    const [conversations, setConversations] = useState<CloudAgentConversation[]>([]);
    const [activeConversationId, setActiveConversationId] = useState(() => nanoid());
    const [historyHydrated, setHistoryHydrated] = useState(false);
    const [pendingHydrated, setPendingHydrated] = useState(false);
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
    const canvasSyncRef = useRef<ReturnType<typeof createAgentCanvasSync> | null>(null);
    useEffect(() => {
        const sync = createAgentCanvasSync({
            canvasId,
            applyPatches: (patches) => applyAgentCanvasPatches(canvasId, patches),
            refresh: () => refreshCanvasAfterAgent(canvasId),
            onError: (cause) => setMessages((current) => appendAgentError(current, `canvas-sync-${canvasId}`, cause, "画布同步冲突")),
        });
        canvasSyncRef.current = sync;
        return () => {
            sync.dispose();
            if (canvasSyncRef.current === sync) canvasSyncRef.current = null;
        };
    }, [canvasId]);
    const skillPageRequestRef = useRef(false);
    const approvalRequestRef = useRef<string | null>(null);
    const pendingSubmission = useRef<CloudAgentPendingSubmission | null>(null);
    const submissionRequestRef = useRef(false);
    const conversationScope = `${canvasId}:${activeConversationId}`;
    const currentScope = useRef(conversationScope);
    currentScope.current = conversationScope;
    const running = Boolean(run?.cleanupPending) || run?.status === "running" || run?.status === "queued" || run?.status === "waiting_approval";
    const selectedModel = useMemo(() => {
        const textModels = selectableModelsByCapability(config, "text");
        const preferred = config.textModel || config.model || "";
        return textModels.includes(preferred) ? preferred : textModels[0] || "";
    }, [config]);
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
            const token = crypto.randomUUID();
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
            const token = crypto.randomUUID();
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
        status === "waiting_approval" ? "等待审批" : status === "running" || status === "queued" ? "运行中" : status === "completed" ? "已完成" : status === "failed" ? "异常" : status === "cancelled" ? "已停止" : status === "rejected" ? "已拒绝" : "待命";
    const statusColor = status === "failed" ? "#e66b6b" : status === "rejected" || status === "cancelled" ? theme.node.muted : status === "waiting_approval" ? "#d6a24a" : status === "running" || status === "queued" ? "#69c29b" : theme.node.muted;

    useEffect(() => {
        if (!prefillRequest || prefillRequest.id === lastPrefillIdRef.current) return;
        lastPrefillIdRef.current = prefillRequest.id;
        if (!prefillRequest.text.trim()) return;
        setPrompt((current) => appendAgentPromptPrefill(current, prefillRequest.text));
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
        setHistoryHydrated(false);
        setPendingHydrated(false);
        pendingSubmission.current = null;
        setBusy(false);
        presetApplyingRef.current = null;
        setPresetApplyingId("");
        setConversations([]);
        setRun(null);
        setMessages([]);
        setSelectedSkillIds([]);
        setApproval(null);
        setApprovalSubmitting(false);
        approvalRequestRef.current = null;
        setPrompt("");
        void loadCloudAgentConversations(canvasId)
            .then(async (document) => {
                if (!active) return;
                const current = document.conversations.find((conversation) => conversation.id === document.activeId) || document.conversations[0];
                setConversations(document.conversations);
                if (current) {
                    setActiveConversationId(current.id);
                    setMessages(current.messages);
                    setRun(current.run);
                    setApproval(approvalStateFromRun(current.run));
                    setPrompt(current.draft || "");
                    setPermissionMode(current.permissionMode);
                    setSelectedSkillIds(current.skillIds || []);
                    if (current.model) setModel(current.model);
                    const pending = await loadCloudAgentPendingSubmission(canvasId, current.id);
                    if (!active) return;
                    pendingSubmission.current = pending;
                    if (pending?.request) setPrompt(pending.request.prompt);
                } else {
                    setActiveConversationId(nanoid());
                    pendingSubmission.current = null;
                }
                setPendingHydrated(true);
            })
            .catch((cause) => {
                if (!active) return;
                setMessages((current) => appendAgentError(current, "history-error", cause, "对话恢复失败，已暂停发送；请重新打开对话核对"));
            })
            .finally(() => {
                if (active) setHistoryHydrated(true);
            });
        return () => {
            active = false;
        };
    }, [canvasId, userId]);

    useEffect(() => {
        if (!historyHydrated || (!messages.length && !run && !prompt.trim())) return;
        const now = new Date().toISOString();
        setConversations((current) => {
            const existing = current.find((conversation) => conversation.id === activeConversationId);
            const next: CloudAgentConversation = {
                id: activeConversationId,
                title: cloudAgentConversationTitle(messages),
                messages,
                run,
                draft: prompt || undefined,
                model: selectedModel || undefined,
                permissionMode,
                skillIds: selectedSkillIds,
                createdAt: existing?.createdAt || now,
                updatedAt: now,
            };
            return [next, ...current.filter((conversation) => conversation.id !== activeConversationId)];
        });
    }, [activeConversationId, historyHydrated, messages, permissionMode, prompt, run, selectedModel, selectedSkillIds]);

    useEffect(() => {
        if (!historyHydrated) return;
        const timer = window.setTimeout(() => {
            void saveCloudAgentConversations(canvasId, activeConversationId, conversations);
        }, 180);
        return () => window.clearTimeout(timer);
    }, [activeConversationId, canvasId, conversations, historyHydrated]);

    useEffect(() => {
        if (!run?.id) return;
        lastSeqRef.current = 0;
        return subscribeAgentEvents(
            run.id,
            (event) => {
                // Only persisted agent events participate in the replay cursor.
                // Snapshot-derived UI events intentionally use seq=0.
                if (event.seq > 0) {
                    if (event.seq <= lastSeqRef.current) return;
                    if (event.seq > lastSeqRef.current + 1) canvasSyncRef.current?.reconcile();
                    lastSeqRef.current = event.seq;
                }
                setMessages((current) => current.filter((item) => item.id !== `stream-error-${run.id}`));
                setContextUsage((current) => reduceAgentContextUsage(current, event));
                applyAgentEvent(event, setMessages, setRun, setApproval, setPrompt);
                canvasSyncRef.current?.receive(event);
            },
            {
                after: 0,
                onConnectionChange: setConnectionStatus,
                onError: (cause) => {
                    canvasSyncRef.current?.reconcile();
                    const status = (cause as { status?: number }).status;
                    if (status === 404) {
                        setMessages((current) => appendAgentError(current, `stream-error-${run.id}`, cause, "上一次 Agent 运行记录已失效，无法确认任务结果；请到任务中心或资产中核对"));
                        setRun((current) => (current?.id === run.id ? null : current));
                        setApproval(null);
                        setConnectionStatus("disconnected");
                        return;
                    }
                    setMessages((current) => appendAgentError(current, `stream-error-${run.id}`, cause, "Agent 事件流已断开"));
                    // The observation channel failed, not the durable run. Keep
                    // identity and approval so reconnect/cancel/continue remain available.
                    setConnectionStatus("disconnected");
                },
            },
        );
    }, [run?.id, connectionEpoch]);

    const reconnectAgent = async () => {
        const activeRun = run;
        if (!activeRun?.id || currentScope.current !== conversationScope) return;
        const scope = conversationScope;
        setConnectionStatus("connecting");
        try {
            const snapshot = (await getAgentRun(activeRun.id, AbortSignal.timeout(10_000))).run;
            if (currentScope.current !== scope) return;
            setRun(snapshot);
            setApproval(approvalStateFromRun(snapshot));
            if (!snapshot.cleanupPending && ["completed", "failed", "cancelled", "rejected"].includes(snapshot.status)) {
                setConnectionStatus("connected");
                setMessages((current) =>
                    appendUniqueMessage(current, {
                        id: `reconnect-complete-${snapshot.id}-${snapshot.updatedAt}`,
                        role: "system",
                        text: snapshot.status === "completed" ? "上一次任务已处理完成，结果已同步。" : `上一次任务已结束（${snapshot.status}）。`,
                    }),
                );
                return;
            }
            setMessages((current) =>
                appendUniqueMessage(current, {
                    id: `reconnect-active-${snapshot.id}-${snapshot.updatedAt}`,
                    role: "system",
                    text: snapshot.status === "waiting_approval" ? "上一次任务尚未完成，正在等待确认；已恢复状态监听。" : "上一次任务尚未处理完成，正在继续监听；完成后会自动更新。",
                }),
            );
            setConnectionEpoch((value) => value + 1);
        } catch (cause) {
            if (currentScope.current !== scope) return;
            setConnectionStatus("disconnected");
            const status = (cause as { status?: number }).status;
            setMessages((current) => appendAgentError(current, `reconnect-error-${activeRun.id}`, cause, status === 404 ? "找不到上一次 Agent 运行记录，无法确认任务是否完成；请到任务中心或资产中核对" : "暂时无法获取上一次任务状态，请稍后重试"));
        }
    };

    useEffect(() => {
        if (!run?.id || connectionStatus !== "disconnected") return;
        const reconnect = () => setConnectionEpoch((value) => value + 1);
        window.addEventListener("online", reconnect);
        return () => window.removeEventListener("online", reconnect);
    }, [run?.id, connectionStatus]);

    const interject = async (value: string) => {
        const activeRun = run;
        if (!value || !activeRun?.id || busy || currentScope.current !== conversationScope || !historyHydrated) return;
        if (connectionStatus !== "connected") {
            setMessages((current) => appendAgentError(current, `interject-disconnected-${activeRun.id}`, new Error("Agent 连接已断开"), "当前连接已断开，消息已保存为草稿；请点击“重新连接”后再发送"));
            return;
        }
        const scope = conversationScope;
        const messageId = `user-${crypto.randomUUID()}`;
        setBusy(true);
        try {
            await sendAgentInterjection(activeRun.id, { text: value, messageId });
            if (currentScope.current !== scope) return;
            setPrompt("");
            setMessages((current) => appendUniqueMessage(current, { id: messageId, role: "user", text: value, interjection: "sent" }));
        } catch (cause) {
            if (currentScope.current !== scope) return;
            const status = (cause as { status?: number }).status;
            setMessages((current) => appendAgentError(current, `interject-error-${activeConversationId}-${messageId}`, cause, "插话没有送达"));
            if (status === 409) setPrompt(value);
        } finally {
            if (currentScope.current === scope) setBusy(false);
        }
    };

    const submit = async (override?: string) => {
        const value = (override ?? prompt).trim();
        if (running) {
            await interject(value);
            return;
        }
        if (!value || busy || running || submissionRequestRef.current || !historyHydrated || !pendingHydrated || currentScope.current !== conversationScope) return;
        if (run && connectionStatus !== "connected") {
            setMessages((current) => appendAgentError(current, `submit-disconnected-${run.id}`, new Error("Agent 连接已断开"), "当前连接已断开，消息已保存为草稿；请点击“重新连接”后再发送"));
            return;
        }
        const scope = conversationScope;
        submissionRequestRef.current = true;
        setBusy(true);
        let accepted = false;
        try {
            const pending = pendingSubmission.current;
            // An ambiguous previous POST owns its body/key until reconciled.
            // Editing model settings or prompt must not silently create a new charge.
            if (pending?.request && pending.request.prompt !== value) throw new Error("上一条请求结果待确认，请先原样重试上一条消息，再发送新要求");
            if (!pending?.request) {
                if (profileLoading) throw new Error("正在确认长期偏好快照，请稍后再发送");
                if (!profileView || profileError) throw new Error("长期偏好快照尚未确认，请重新读取后再发送");
                const capabilities = await getAgentCapabilities();
                if (currentScope.current !== scope) return;
                if (!capabilities.permissionModes.includes(permissionMode)) throw new Error("当前后端不支持所选 Agent 权限，请更新后端");
                if (selectedSkillIds.length && !capabilities.skills) throw new Error("当前后端尚未接入技能库");
                await saveRemoteUserDataNow();
                if (currentScope.current !== scope) return;
                const agentConfig = { ...config, model: selectedModel };
                const requestConfig = resolveModelRequestConfig(agentConfig, selectedModel);
                const logicalModelId = logicalModelIDForConfig(agentConfig);
                const input = {
                    canvasId,
                    prompt: value,
                    reasoningMode,
                    profileRevision: profileView.revision,
                    model: modelOptionName(selectedModel) || undefined,
                    ...(logicalModelId ? { logicalModelId } : requestConfig.channelId ? { channelId: requestConfig.channelId, channelModelKey: modelOptionName(selectedModel) || undefined } : {}),
                    skillIds: [...new Set([...selectedSkillIds, ...resolveSkillMentions(value, installedSkills).map((skill) => skill.skillId)])],
                    focusNodeIds: selectedNodeIds.length <= 8 ? selectedNodeIds : [],
                    permissionMode,
                    contextScope,
                    budget: { maxCredits: positiveNumber(maxCredits), maxGenerationTasks: permissionMode === "read_only" ? 0 : Number(maxGenerationTasks), maxVideoSeconds: permissionMode === "read_only" ? 0 : Number(maxVideoSeconds) },
                };
                const fingerprint = JSON.stringify({ scope, parent: run?.id, input });
                if (pending && pending.fingerprint !== fingerprint) throw new Error("上一条请求尚未确认，请恢复原消息与设置后核对，不能覆盖原幂等记录");
                const key = pending?.key || crypto.randomUUID();
                const next = { fingerprint, key, request: { ...input, idempotencyKey: key }, parentRunId: run?.id, messageId: `user-${key}` };
                // Persist before sending. A failed local save must not submit a request
                // whose recovery identity will disappear on reload.
                await saveCloudAgentPendingSubmission(canvasId, activeConversationId, next);
                if (currentScope.current !== scope) return;
                pendingSubmission.current = next;
            }
            const submission = pendingSubmission.current!;
            const request = submission.request!;
            const formAnswer = parseCloudAgentFormAnswer(request.prompt);
            const nextMessages = appendUniqueMessage(messages, {
                id: submission.messageId || `user-${submission.key}`,
                role: "user",
                text: formAnswer ? "已确认创作方向" : request.prompt,
                ...(formAnswer ? { formAnswer } : {}),
            });
            const now = new Date().toISOString();
            const existing = conversations.find((item) => item.id === activeConversationId);
            // Persist a discoverable conversation before POST as well as its key;
            // otherwise a reload of a brand-new chat can orphan the pending record.
            await saveCloudAgentConversations(canvasId, activeConversationId, [
                {
                    id: activeConversationId,
                    title: cloudAgentConversationTitle(nextMessages),
                    messages: nextMessages,
                    run,
                    model: selectedModel || undefined,
                    permissionMode,
                    skillIds: selectedSkillIds,
                    createdAt: existing?.createdAt || now,
                    updatedAt: now,
                },
                ...conversations.filter((item) => item.id !== activeConversationId),
            ]);
            if (currentScope.current !== scope) return;
            setPrompt("");
            setMessages(nextMessages);
            const result = submission.parentRunId ? await sendAgentMessage(submission.parentRunId, request) : await createAgentRun(request);
            accepted = true;
            if (currentScope.current === scope) {
                setRun(result.run);
            }
            await clearCloudAgentPendingSubmission(canvasId, activeConversationId);
            if (currentScope.current === scope) pendingSubmission.current = null;
        } catch (cause) {
            if (currentScope.current !== scope) return;
            if (!accepted) {
                setPrompt(value);
                const status = (cause as { status?: number }).status;
                if (status && [400, 401, 403, 404, 422].includes(status)) {
                    // These admission responses explicitly rejected the write.
                    // Transport errors and conflicts retain the pending identity.
                    try {
                        await clearCloudAgentPendingSubmission(canvasId, activeConversationId);
                        pendingSubmission.current = null;
                    } catch (storageError) {
                        setMessages((current) => appendAgentError(current, `pending-storage-${activeConversationId}`, storageError, "提交记录更新失败"));
                    }
                }
            }
            setMessages((current) => appendAgentError(current, `submit-error-${activeConversationId}`, cause, agentSubmissionErrorTitle(cause, accepted)));
        } finally {
            submissionRequestRef.current = false;
            if (currentScope.current === scope) setBusy(false);
        }
    };

    const stop = async () => {
        const activeRun = run;
        if (!activeRun?.id || stopping) return;
        setStopping(true);
        try {
            await cancelAgentRun(activeRun.id);
            const snapshot = await getAgentRun(activeRun.id, AbortSignal.timeout(5_000));
            if (currentScope.current === conversationScope) {
                setRun((current) => (current?.id === activeRun.id ? snapshot.run : current));
                setApproval(approvalStateFromRun(snapshot.run));
                setConnectionEpoch((value) => value + 1);
            }
        } catch (cause) {
            if (currentScope.current === conversationScope) {
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
        if (!run || !approval || connectionStatus !== "connected" || approvalRequestRef.current === approval.approvalId) return;
        const runId = run.id;
        const approvalId = approval.approvalId;
        const scope = conversationScope;
        approvalRequestRef.current = approvalId;
        setApprovalSubmitting(true);
        try {
            if (decision === "approve") await saveRemoteUserDataNow();
            if (currentScope.current !== scope) return;
            await decideAgentApproval(runId, approvalId, decision, approval.reason, AbortSignal.timeout(15_000), mediaSettings);
            if (currentScope.current === scope) {
                setApproval((current) => (current?.approvalId === approvalId ? null : current));
                setRun((current) =>
                    current?.id === runId && current.status === "waiting_approval" && (!current.approval || current.approval.approvalId === approvalId)
                        ? { ...current, status: decision === "reject" ? "rejected" : "running", approval: undefined }
                        : current,
                );
            }
        } catch (cause) {
            if (currentScope.current !== scope) return;
            // A timed-out response is ambiguous: query the durable decision before
            // asking the user to retry. The backend treats identical decisions idempotently.
            try {
                const snapshot = await getAgentRun(runId, AbortSignal.timeout(5_000));
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
            if (currentScope.current === scope) setApprovalSubmitting(false);
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
        updateConfig("textModel", model);
        updateConfig("model", model);
    };

    const newConversation = () => {
        const id = nanoid();
        const now = new Date().toISOString();
        const inheritedSkillIds = [...selectedSkillIds];
        currentScope.current = `${canvasId}:${id}`;
        presetApplyingRef.current = null;
        setPresetApplyingId("");
        setPendingHydrated(true);
        setBusy(false);
        pendingSubmission.current = null;
        approvalRequestRef.current = null;
        setApprovalSubmitting(false);
        setActiveConversationId(id);
        setRun(null);
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

    const openConversation = (conversation: CloudAgentConversation) => {
        currentScope.current = `${canvasId}:${conversation.id}`;
        presetApplyingRef.current = null;
        setPresetApplyingId("");
        setPendingHydrated(false);
        setBusy(false);
        pendingSubmission.current = null;
        approvalRequestRef.current = null;
        setApprovalSubmitting(false);
        setActiveConversationId(conversation.id);
        setRun(conversation.run);
        setApproval(approvalStateFromRun(conversation.run));
        setMessages(conversation.messages);
        setPermissionMode(conversation.permissionMode);
        setSelectedSkillIds(conversation.skillIds || []);
        setPrompt(conversation.draft || "");
        if (conversation.model) setModel(conversation.model);
        setView("chat");
        void loadCloudAgentPendingSubmission(canvasId, conversation.id)
            .then((pending) => {
                if (currentScope.current === `${canvasId}:${conversation.id}`) {
                    pendingSubmission.current = pending;
                    setPendingHydrated(true);
                    if (pending?.request) setPrompt(pending.request.prompt);
                }
            })
            .catch((cause) => {
                if (currentScope.current === `${canvasId}:${conversation.id}`) setMessages((current) => appendAgentError(current, `pending-${conversation.id}`, cause, "待确认请求读取失败"));
            });
    };
    const deleteConversation = (id: string) => {
        const next = conversations.filter((item) => item.id !== id);
        setConversations(next);
        if (id === activeConversationId) newConversation();
        void saveCloudAgentConversations(canvasId, id === activeConversationId ? null : activeConversationId, next);
    };

    return (
        <>
            <AgentLauncher theme={theme} statusColor={statusColor} approvalPending={Boolean(approval)} reducedMotion={Boolean(reducedMotion)} hidden={open} onOpen={onOpen} />
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
                                        nodeCount={nodeCount}
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
                                    <AgentHistory conversations={conversations} activeConversationId={activeConversationId} theme={theme} onBack={() => setView("chat")} onNew={newConversation} onOpen={openConversation} onDelete={deleteConversation} />
                                </motion.div>
                            ) : (
                                <motion.div key="chat" className="flex min-h-0 flex-1 flex-col" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: reducedMotion ? 0 : 0.18 }}>
                                    <AgentHeader
                                        theme={theme}
                                        hasMessages={messages.length > 0}
                                        statusLabel={statusLabel}
                                        statusColor={statusColor}
                                        nodeCount={nodeCount}
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
                                    {run && connectionStatus !== "connected" ? (
                                        <div role="status" className="flex items-center justify-between gap-2 px-5 py-2 text-xs" style={{ color: theme.node.muted }}>
                                            <span>
                                                {connectionStatus === "disconnected"
                                                    ? run && ["queued", "running", "waiting_approval"].includes(run.status)
                                                        ? "连接已断开；上一次任务尚未完成，点击“重新连接”查看状态"
                                                        : "连接已断开；点击“重新连接”确认上一次任务状态"
                                                    : "正在连接并校准运行状态…"}
                                            </span>
                                            {connectionStatus === "disconnected" ? (
                                                <Button size="small" onClick={() => void reconnectAgent()}>
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
                                        references={[...references, ...buildSkillMentionReferences(installedSkills)]}
                                        busy={busy || running}
                                        approval={approval}
                                        approvalTargetGenerating={approval ? agentApprovalTargetGenerating(approval.detail, canvasNodes, runningNodeId) : undefined}
                                        nodeCount={nodeCount}
                                        approvalSubmitting={approvalSubmitting}
                                        approvalBlocked={connectionStatus !== "connected"}
                                        onChooseSkill={() => setSkillsOpen(true)}
                                        onDraftPrompt={(draft) => setPrompt((current) => (current.trim() ? `${current}\n\n${draft}` : draft))}
                                        onApprovalReasonChange={(reason) => setApproval((current) => (current ? { ...current, reason } : current))}
                                        onApprove={(settings) => void submitApproval("approve", settings)}
                                        onReject={() => void submitApproval("reject")}
                                    />
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
                                            disabled={busy || running || !pendingHydrated || Boolean(presetApplyingId)}
                                            onPick={(preset) => void applyScenePreset(preset)}
                                            onPickSkill={(skill) => void applySingleSkill(skill)}
                                        />
                                    ) : null}
                                    {pendingQuestion ? <AgentQuestionBar question={pendingQuestion} theme={theme} disabled={approvalSubmitting || connectionStatus !== "connected"} onAnswer={(label) => void submit(label)} /> : null}
                                    <AgentChatComposer
                                        prompt={prompt}
                                        disabled={!historyHydrated || !pendingHydrated}
                                        sending={busy}
                                        running={running}
                                        placeholder={running ? "运行中可直接插话，会在它下一步生效" : "输入操作指导；用 @ 引用画布节点，用 / 或 、 引用 Skills"}
                                        theme={theme}
                                        onPromptChange={setPrompt}
                                        onSubmit={() => void submit()}
                                        onStop={run?.id && running ? stop : undefined}
                                        stopping={stopping}
                                        references={[...references, ...buildSkillMentionReferences(installedSkills)]}
                                        slashSkills={installedSkills}
                                        includeAssetLibrary={false}
                                        submitAccessory={<AgentContextRing view={presentAgentContextUsage(contextUsage)} />}
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
}
