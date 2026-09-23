import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type SetStateAction } from "react";
import { Button, Dropdown, Input } from "antd";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowLeft, Check, ChevronRight, CircleDot, Clock3, Download, History, LoaderCircle, MessageSquarePlus, MoveDiagonal2, Settings2, ShieldCheck, Trash2, Sparkles, X } from "lucide-react";
import { saveAs } from "file-saver";
import { buildAgentDebugExport } from "@/lib/canvas/agent-debug-export";
import { markdownPlainText } from "@/lib/markdown-plain-text";
import { agentToolRetry, mergeAgentToolRetry } from "@/lib/canvas/agent-tool-retry";
import { agentPlanVisible, latestAgentPlanItems, pendingAgentQuestion } from "@/lib/canvas/cloud-agent-plan";
import { nanoid } from "nanoid";

import { ModelPicker } from "@/components/model-picker";
import { FluidOrb } from "@/components/ui/fluid-orb";
import { cn } from "@/lib/utils";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import { agentErrorPresentation, agentSubmissionErrorTitle } from "@/lib/canvas/agent-error-presentation";
import { cancelAgentRun, getAgentCapabilities, getAgentProfile, getAgentRun, createAgentRun, decideAgentApproval, sendAgentInterjection, sendAgentMessage, subscribeAgentEvents, updateAgentProfile, type AgentEvent, type AgentPermissionMode, type AgentProfileScope, type AgentProfileView, type AgentReasoningMode, type AgentRun } from "@/services/api/agent";
import { agentApprovalPresentation } from "@/lib/canvas/agent-approval-presentation";
import { agentApprovalMatchesSettings, agentImageApproval } from "@/lib/canvas/agent-media-approval";
import type { AgentMediaSettings } from "@/services/api/agent";
import { CanvasAgentImageApprovalSettings } from "./canvas-agent-image-approval-settings";
import { addSkill, listAddedSkills, listSkills, listSkillPresets, type Skill, type SkillCategory, type SkillPreset } from "@/services/api/skills";
import { clearCloudAgentPendingSubmission, cloudAgentConversationTitle, loadCloudAgentConversations, loadCloudAgentPendingSubmission, saveCloudAgentConversations, saveCloudAgentPendingSubmission, type CloudAgentConversation, type CloudAgentPendingSubmission } from "@/services/cloud-agent-conversations";
import { logicalModelIDForConfig, modelOptionName, resolveModelRequestConfig, selectableModelsByCapability, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { useUserStore } from "@/stores/use-user-store";
import { getActiveUserScope } from "@/lib/user-scope";
import { applyAgentCanvasPatches, refreshCanvasAfterAgent, saveRemoteUserDataNow } from "@/services/user-data-sync";
import { createAgentCanvasSync } from "@/services/agent-canvas-sync";
import { buildSkillMentionReferences, resolveSkillMentions } from "@/services/skill-runtime";
import { AgentChatComposer, AgentChatMessage, AgentPlanBar, AgentQuestionBar, AgentSceneCapsules, AgentWorkingMessage, AGENT_SCENE_DEFS, type AgentSceneBucket, type CloudAgentChatMessage, type CloudAgentPlanItem } from "./canvas-cloud-agent-chat-ui";
import { CanvasAgentSkillLibraryModal } from "./canvas-agent-skill-library-modal";
import { CanvasCloudAgentSettings, agentPermissionLabel, agentPermissionMenuItems, agentPermissionVisual, type AgentContextKey } from "./canvas-cloud-agent-settings";
import { useAgentPanelLayout } from "./use-agent-panel-layout";
import { useAgentLauncherPosition } from "./use-agent-launcher-position";
import { AgentWelcome } from "./canvas-agent-welcome";
import { DEFAULT_CANVAS_APPEARANCE, agentCopy } from "@/lib/canvas/agent-appearance";
import { live2DModelURL } from "@/services/api/appearance";
import { Live2DAvatar } from "./live2d-avatar";
import "./canvas-cloud-agent.css";

type CloudAgentPanelProps = { canvasId: string; domainProjectId?: string; nodeCount: number; references: CanvasResourceReference[]; open: boolean; prefillPrompt?: string; onOpen: () => void; onCollapse: () => void; onFocusNode?: (nodeId: string) => void };
type ApprovalState = { approvalId: string; detail: Record<string, unknown>; reason: string };
type AgentPanelView = "chat" | "history" | "settings";

export function CanvasCloudAgentPanel({ canvasId, domainProjectId, nodeCount, references, open, prefillPrompt, onOpen, onCollapse, onFocusNode }: CloudAgentPanelProps) {
    const userId = useUserStore((state) => state.user?.id);
    const appearance = useAppearanceStore((state) => state.appearance.canvas) || DEFAULT_CANVAS_APPEARANCE;
    const theme = canvasThemes[useActiveTheme()];
    const config = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const reducedMotion = useReducedMotion();
    const [view, setView] = useState<AgentPanelView>("chat");
    const [run, setRun] = useState<AgentRun | null>(null);
    const [connectionStatus, setConnectionStatus] = useState<"connecting" | "connected" | "reconnecting" | "disconnected">("connecting");
    const [connectionEpoch, setConnectionEpoch] = useState(0);
    const [messages, setMessages] = useState<CloudAgentChatMessage[]>([]);
    const [prompt, setPrompt] = useState("");
    const lastPrefillPromptRef = useRef("");
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
    const [skillTag, setSkillTag] = useState("all");
    const [skillsOpen, setSkillsOpen] = useState(false);
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
    const planVisible = agentPlanVisible(planItems);
    const pendingQuestion = useMemo(() => pendingAgentQuestion(messages), [messages]);
    const [scenePresets, setScenePresets] = useState<SkillPreset[]>([]);
    const [presetApplyingId, setPresetApplyingId] = useState("");
    const presetApplyingRef = useRef<string | null>(null);
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
        return () => { sync.dispose(); if (canvasSyncRef.current === sync) canvasSyncRef.current = null; };
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
        return textModels.includes(preferred) ? preferred : (textModels[0] || "");
    }, [config]);
    const reasoningSupported = Boolean(modelCapabilityConfigFor(config, selectedModel).text?.thinking);
    useEffect(() => { if (!reasoningSupported && reasoningMode !== "off") setReasoningMode("off"); }, [reasoningSupported, reasoningMode]);
    const installedSkills = useMemo(() => skills.filter((skill) => skill.isAdded), [skills]);
    const enabledSkills = useMemo(() => installedSkills.filter((skill) => selectedSkillIds.includes(skill.skillId)), [installedSkills, selectedSkillIds]);
    const installedSkillIds = useMemo(() => new Set(installedSkills.map((skill) => skill.skillId)), [installedSkills]);

    const [createdSkills, setCreatedSkills] = useState<Skill[]>([]);

    // 用户切换后重新加载，旧请求不得把其他账号的数据写回当前面板。
    useEffect(() => {
        let active = true;
        presetApplyingRef.current = null;
        setPresetApplyingId("");
        setScenePresets([]);
        listSkillPresets()
            .then((result) => { if (active) setScenePresets(result.presets || []); })
            .catch(() => { if (active) setScenePresets([]); });
        return () => { active = false; };
    }, [userId]);

    // 用户自建技能也要能出现在推荐里：官方种子库与剧典走「已装」，自建走 scope=created。
    useEffect(() => {
        let active = true;
        setCreatedSkills([]);
        listSkills({ scope: "created", pageSize: 50 })
            .then((result) => { if (active) setCreatedSkills(result.skills || []); })
            .catch((cause) => { if (active) setMessages((current) => appendAgentError(current, "created-skills-error", cause, "自建技能读取失败")); });
        return () => { active = false; };
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

    const applyScenePreset = useCallback(async (preset: SkillPreset) => {
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
            setMessages((current) => appendUniqueMessage(current, {
                id: `preset-${preset.presetId}-${Date.now()}`,
                role: "system",
                text: `已按「${preset.name}」挂上 ${preset.skillIds.length} 个技能${missing.length ? `（新装 ${missing.length} 个）` : ""}。${preset.rationale}`,
            }));
        } catch (cause) {
            if (isCurrent()) setMessages((current) => appendAgentError(current, `preset-${preset.presetId}`, cause, `「${preset.name}」挂载失败（已安装的技能仍在技能库中）`));
        } finally {
            if (presetApplyingRef.current === token) {
                presetApplyingRef.current = null;
                setPresetApplyingId("");
            }
        }
    }, [busy, conversationScope, historyHydrated, installedSkillIds, pendingHydrated, running]);

    // 单个技能（含用户自建）挂载到本会话；未装的先补装，已挂的不重复追加。
    const applySingleSkill = useCallback(async (skill: Skill) => {
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
            setMessages((current) => appendUniqueMessage(current, {
                id: `skill-${skill.skillId}-${Date.now()}`,
                role: "system",
                text: `已把「${skill.skillName}」挂到本会话。用哪张卡交给 Agent 按任务检索。`,
            }));
        } catch (cause) {
            if (isCurrent()) setMessages((current) => appendAgentError(current, `skill-${skill.skillId}`, cause, `「${skill.skillName}」挂载失败`));
        } finally {
            if (presetApplyingRef.current === token) {
                presetApplyingRef.current = null;
                setPresetApplyingId("");
            }
        }
    }, [busy, conversationScope, historyHydrated, installedSkillIds, pendingHydrated, running]);
    const status = run?.status || "idle";
    const statusLabel = status === "waiting_approval" ? "等待审批" : status === "running" || status === "queued" ? "运行中" : status === "completed" ? "已完成" : status === "failed" ? "异常" : status === "cancelled" ? "已停止" : status === "rejected" ? "已拒绝" : "待命";
    const statusColor = status === "failed" ? "#e66b6b" : status === "rejected" || status === "cancelled" ? theme.node.muted : status === "waiting_approval" ? "#d6a24a" : status === "running" || status === "queued" ? "#69c29b" : theme.node.muted;

    useEffect(() => {
        const value = prefillPrompt?.trim();
        if (!value || value === lastPrefillPromptRef.current) return;
        lastPrefillPromptRef.current = value;
        setPrompt(value);
        setView("chat");
    }, [prefillPrompt]);

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
        const refresh = () => { void listAddedSkills()
            .then((result) => {
                if (!active) return;
                setSkills(result.skills);
                setMessages((current) => current.filter((message) => message.id !== "skills-load-error"));
            })
            .catch((cause) => { if (active) setMessages((current) => appendAgentError(current, "skills-load-error", cause, "技能库读取失败")); }); };
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
                    if (result.categories.length > 0) setSkillCategories(result.categories);
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
    }, [view, skillsOpen, debouncedSkillSearch, skillTag]);

    const loadMoreSkills = async () => {
        if (skillsLoading || skillPageRequestRef.current || !skillHasMore || skillSearch.trim() !== debouncedSkillSearch) return;
        skillPageRequestRef.current = true;
        setSkillsLoading(true);
        try {
            const result = await listSkills({
                scope: "public",
                search: debouncedSkillSearch || undefined,
                tag: skillsOpen && skillTag !== "all" ? skillTag : undefined,
                page: skillPage + 1,
                pageSize: 20,
                sort: "popular",
            });
            setMarketSkills((current) => [...current, ...result.skills.filter((skill) => !current.some((item) => item.skillId === skill.skillId))]);
            setSkillPage(result.page);
            setSkillHasMore(result.hasMore);
        } finally {
            skillPageRequestRef.current = false;
            setSkillsLoading(false);
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
        if (!historyHydrated || (!messages.length && !run)) return;
        const now = new Date().toISOString();
        setConversations((current) => {
            const existing = current.find((conversation) => conversation.id === activeConversationId);
            const next: CloudAgentConversation = {
                id: activeConversationId,
                title: cloudAgentConversationTitle(messages),
                messages,
                run,
                model: selectedModel || undefined,
                permissionMode,
                skillIds: selectedSkillIds,
                createdAt: existing?.createdAt || now,
                updatedAt: now,
            };
            return [next, ...current.filter((conversation) => conversation.id !== activeConversationId)];
        });
    }, [activeConversationId, historyHydrated, messages, permissionMode, run, selectedModel, selectedSkillIds]);

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
                applyAgentEvent(event, setMessages, setRun, setApproval, setPrompt);
                canvasSyncRef.current?.receive(event);
            },
            {
                after: 0,
                onConnectionChange: setConnectionStatus,
                onError: (cause) => {
                    canvasSyncRef.current?.reconcile();
                    setMessages((current) => appendAgentError(current, `stream-error-${run.id}`, cause, "Agent 事件流已断开"));
                    // The observation channel failed, not the durable run. Keep
                    // identity and approval so reconnect/cancel/continue remain available.
                    setConnectionStatus("disconnected");
                },
            },
        );
    }, [run?.id, connectionEpoch]);

    useEffect(() => {
        if (!run?.id || connectionStatus !== "disconnected") return;
        const reconnect = () => setConnectionEpoch((value) => value + 1);
        window.addEventListener("online", reconnect);
        return () => window.removeEventListener("online", reconnect);
    }, [run?.id, connectionStatus]);

    const interject = async (value: string) => {
        const activeRun = run;
        if (!value || !activeRun?.id || busy || connectionStatus !== "connected" || currentScope.current !== conversationScope || !historyHydrated) return;
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
        if (!value || busy || running || (run && connectionStatus !== "connected") || submissionRequestRef.current || !historyHydrated || !pendingHydrated || currentScope.current !== conversationScope) return;
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
                    canvasId, prompt: value, reasoningMode: reasoningSupported ? reasoningMode : "off", profileRevision: profileView.revision,
                    model: modelOptionName(selectedModel) || undefined,
                    ...(logicalModelId ? { logicalModelId } : requestConfig.channelId ? { channelId: requestConfig.channelId, channelModelKey: modelOptionName(selectedModel) || undefined } : {}),
                    skillIds: [...new Set([...selectedSkillIds, ...resolveSkillMentions(value, installedSkills).map((skill) => skill.skillId)])],
                    permissionMode, contextScope,
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
            const nextMessages = appendUniqueMessage(messages, { id: submission.messageId || `user-${submission.key}`, role: "user", text: request.prompt });
            const now = new Date().toISOString();
            const existing = conversations.find((item) => item.id === activeConversationId);
            // Persist a discoverable conversation before POST as well as its key;
            // otherwise a reload of a brand-new chat can orphan the pending record.
            await saveCloudAgentConversations(canvasId, activeConversationId, [{
                id: activeConversationId, title: cloudAgentConversationTitle(nextMessages), messages: nextMessages, run,
                model: selectedModel || undefined, permissionMode, skillIds: selectedSkillIds,
                createdAt: existing?.createdAt || now, updatedAt: now,
            }, ...conversations.filter((item) => item.id !== activeConversationId)]);
            if (currentScope.current !== scope) return;
            setPrompt("");
            setMessages(nextMessages);
            const result = submission.parentRunId ? await sendAgentMessage(submission.parentRunId, request) : await createAgentRun(request);
            accepted = true;
            if (currentScope.current === scope) setRun(result.run);
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
                setRun((current) => current?.id === activeRun.id ? snapshot.run : current);
                if (!snapshot.run.approval) setApproval(null);
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
                setApproval((current) => current?.approvalId === approvalId ? null : current);
                setRun((current) => current?.id === runId && current.status === "waiting_approval" && (!current.approval || current.approval.approvalId === approvalId) ? { ...current, status: decision === "reject" ? "rejected" : "running", approval: undefined } : current);
            }
        } catch (cause) {
            if (currentScope.current !== scope) return;
            // A timed-out response is ambiguous: query the durable decision before
            // asking the user to retry. The backend treats identical decisions idempotently.
            try {
                const snapshot = await getAgentRun(runId, AbortSignal.timeout(5_000));
                const decided = snapshot.run.events?.some((event) => event.type === "approval_decided" && event.payload.approvalId === approvalId && event.payload.decision === decision && (!mediaSettings || agentApprovalMatchesSettings(event.payload.arguments, mediaSettings)));
                if (decided) {
                    setApproval((current) => current?.approvalId === approvalId ? null : current);
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
        setSelectedSkillIds([]);
        setPrompt("");
        setApproval(null);
        lastSeqRef.current = 0;
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
        setMessages(conversation.messages);
        setPermissionMode(conversation.permissionMode);
        setSelectedSkillIds(conversation.skillIds || []);
        setApproval(null);
        setPrompt("");
        if (conversation.model) setModel(conversation.model);
        setView("chat");
        void loadCloudAgentPendingSubmission(canvasId, conversation.id).then((pending) => {
            if (currentScope.current === `${canvasId}:${conversation.id}`) {
                pendingSubmission.current = pending;
                setPendingHydrated(true);
                if (pending?.request) setPrompt(pending.request.prompt);
            }
        }).catch((cause) => {
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
            {!open ? <AgentLauncher theme={theme} statusColor={statusColor} approvalPending={Boolean(approval)} reducedMotion={Boolean(reducedMotion)} onOpen={onOpen} /> : null}
            <AnimatePresence>
                {open ? (
                    <motion.aside
                        initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 20, scale: 0.975 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.985 }}
                        transition={{ duration: reducedMotion ? 0 : 0.26, ease: [0.16, 1, 0.3, 1] }}
                        className="canvas-agent-panel fixed z-[var(--z-modal-overlay)] flex min-w-0 flex-col overflow-hidden"
                        style={{ ...panelLayout.style, "--agent-surface-base": theme.node.panel, "--agent-ink": theme.node.text, "--agent-accent": theme.accent.primary, "--agent-shadow-color": theme.spatial.shadow } as CSSProperties & Record<`--${string}`, string>}
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
                                    <AgentHistory
                                        conversations={conversations}
                                        activeConversationId={activeConversationId}
                                        theme={theme}
                                        onBack={() => setView("chat")}
                                        onNew={newConversation}
                                        onOpen={openConversation}
                                        onDelete={deleteConversation}
                                    />
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
                                                    try { snapshot = (await getAgentRun(run.id, AbortSignal.timeout(15_000))).run; }
                                                    catch (cause) { snapshotError = cause instanceof Error ? cause.message : String(cause); }
                                                }
                                                const text = buildAgentDebugExport({ canvasId, conversationId: activeConversationId, messages, run: snapshot, approval, model: selectedModel, permissionMode, snapshotError });
                                                saveAs(new Blob([text], { type: "application/json;charset=utf-8" }), `agent-debug-${activeConversationId}-${Date.now()}.json`);
                                            })().catch((cause) => setMessages((current) => appendAgentError(current, `export-${Date.now()}`, cause, "导出失败"))).finally(() => setExporting(false));
                                        }}
                                        onSettings={() => setView("settings")}
                                        onCollapse={onCollapse}
                                    />
                                    {run && connectionStatus !== "connected" ? (
                                        <div role="status" className="flex items-center justify-between gap-2 px-5 py-2 text-xs" style={{ color: theme.node.muted }}>
                                            <span>{connectionStatus === "disconnected" ? "连接已断开，服务端任务可能仍在执行；运行记录已保留" : "正在连接并校准运行状态…"}</span>
                                            {connectionStatus === "disconnected" ? <Button size="small" onClick={() => setConnectionEpoch((value) => value + 1)}>重新连接</Button> : null}
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
                                        nodeCount={nodeCount}
                                        approvalSubmitting={approvalSubmitting || connectionStatus !== "connected"}
                                        onChooseSkill={() => setSkillsOpen(true)}
                                        onDraftPrompt={(draft) => setPrompt((current) => current.trim() ? `${current}\n\n${draft}` : draft)}
                                        onApprovalReasonChange={(reason) => setApproval((current) => (current ? { ...current, reason } : current))}
                                        onApprove={(settings) => void submitApproval("approve", settings)}
                                        onReject={() => void submitApproval("reject")}
                                    />
                                    {planVisible ? <AgentPlanBar items={planItems} theme={theme} minimized={planMinimized} onToggle={() => setPlanMinimized((value) => !value)} /> : null}
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
                                    {pendingQuestion ? (
                                        <AgentQuestionBar
                                            question={pendingQuestion}
                                            theme={theme}
                                            disabled={approvalSubmitting || connectionStatus !== "connected"}
                                            onAnswer={(label) => void submit(label)}
                                        />
                                    ) : null}
                                    <AgentChatComposer
                                        prompt={prompt}
                                        disabled={Boolean(run && connectionStatus !== "connected") || !historyHydrated || !pendingHydrated}
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
                                        left={
                                            <ComposerControls
                                                reasoningMode={reasoningSupported ? reasoningMode : "off"}
                                                reasoningSupported={reasoningSupported}
                                                onReasoningModeChange={(value) => { if (reasoningSupported) setReasoningMode(value); }}
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
                open={skillsOpen}
                theme={theme}
                installedSkills={installedSkills}
                marketSkills={marketSkills}
                selectedSkillIds={selectedSkillIds}
                categories={skillCategories}
                category={skillTag}
                search={skillSearch}
                loading={skillsLoading}
                hasMore={skillHasMore}
                onClose={() => setSkillsOpen(false)}
                onCategoryChange={setSkillTag}
                onSearch={setSkillSearch}
                onToggle={(id) => setSelectedSkillIds((current) => {
                    if (current.includes(id)) return current.filter((item) => item !== id);
                    return [...current, id];
                })}
                onInstall={installSkill}
                onLoadMore={loadMoreSkills}
            />
        </>
    );
}

function AgentLauncher({ theme, statusColor, approvalPending, reducedMotion, onOpen }: { theme: CanvasTheme; statusColor: string; approvalPending: boolean; reducedMotion: boolean; onOpen: () => void }) {
    const appearance = useAppearanceStore((state) => state.appearance.canvas) || DEFAULT_CANVAS_APPEARANCE;
    const live = appearance.avatarType === "live2d" && Boolean(appearance.live2dResourceId && appearance.live2dEntry);
    const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
    useEffect(() => {
        const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
        window.addEventListener("resize", resize);
        return () => window.removeEventListener("resize", resize);
    }, []);
    const height = live ? Math.max(40, Math.min(appearance.avatarHeight, viewport.height - 60, (viewport.width - 40) / 0.75)) : 76;
    const width = live ? Math.round(height * 0.75) : 76;
    const { position, dragging, handlers } = useAgentLauncherPosition(onOpen, width, height);
    return (
        <motion.button
            type="button"
            aria-label={`打开${appearance.agentName}`}
            title={`${approvalPending ? "Agent 等待你的审批" : "打开 Agent 助手"} · 拖动可调整位置，聚焦后可用方向键移动`}
            className={cn("canvas-agent-launcher fixed z-[var(--z-modal-overlay)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/35", dragging && "is-dragging", live && "canvas-agent-launcher-live2d")}
            style={{ ...position, width, height, color: theme.node.text, "--canvas-agent-launcher-shadow": theme.spatial.shadow } as CSSProperties}
            data-canvas-no-zoom
            {...handlers}
            whileHover={reducedMotion || dragging ? undefined : { scale: 1.035 }}
            whileTap={reducedMotion || dragging ? undefined : { scale: 0.96 }}
            transition={{ duration: reducedMotion ? 0 : 0.18 }}
        >
            {live ? <Live2DAvatar url={live2DModelURL(appearance.live2dResourceId, appearance.live2dEntry)} width={width} height={height} reducedMotion={reducedMotion} fallback={<FluidOrb size={62} color="#7164f6" />} /> : <FluidOrb size={62} color="#7164f6" />}
            {appearance.launcherLabel ? <span className="canvas-agent-launcher-label">{appearance.launcherLabel}</span> : null}
            <span className={cn("canvas-agent-launcher-status", approvalPending && "is-pending")} style={{ "--canvas-agent-status-color": statusColor } as CSSProperties} />
            {approvalPending ? <span className="canvas-agent-launcher-badge">待审批</span> : null}
        </motion.button>
    );
}

function AgentHeader({ theme, hasMessages, statusLabel, statusColor, nodeCount, onNew, onHistory, onSettings, onCollapse, onExport, exporting }: { theme: CanvasTheme; hasMessages: boolean; statusLabel: string; statusColor: string; nodeCount: number; onNew: () => void; onHistory: () => void; onSettings: () => void; onCollapse: () => void; onExport: () => void; exporting: boolean }) {
    const appearance = useAppearanceStore((state) => state.appearance.canvas) || DEFAULT_CANVAS_APPEARANCE;
    return (
        <header data-agent-drag-handle className="agent-panel-header flex shrink-0 items-center gap-3">
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="agent-panel-title">{agentCopy(appearance.panelTitle, appearance.agentName)}{hasMessages ? "" : " · 新对话"}</span>
                    <span className="agent-panel-status flex items-center gap-1" style={{ color: statusColor }}>
                        <CircleDot className="size-3" />
                        {statusLabel}
                    </span>
                </div>
                <div className="agent-panel-context">{appearance.agentName} · 当前画布 {nodeCount} 个节点</div>
            </div>
            <div className="agent-header-actions flex items-center gap-0.5" style={{ color: theme.node.muted }}>
                <Button type="text" shape="circle" icon={<Download className="size-4" />} loading={exporting} onClick={onExport} aria-label="导出 Agent 调试记录" title="导出对话、工具参数、审批和错误（分享前请检查隐私）" />
                <Button type="text" shape="circle" icon={<MessageSquarePlus className="size-4" />} onClick={onNew} aria-label="新建对话" title="新建对话" />
                <Button type="text" shape="circle" icon={<History className="size-4" />} onClick={onHistory} aria-label="历史对话" title="历史对话" />
                <Button type="text" shape="circle" icon={<Settings2 className="size-4" />} onClick={onSettings} aria-label="Agent 设置" title="Agent 设置" />
                <Button type="text" shape="circle" icon={<X className="size-4" />} onClick={onCollapse} aria-label="收起 Agent" title="收起" />
            </div>
        </header>
    );
}

function AgentHistory({ conversations, activeConversationId, theme, onBack, onNew, onOpen, onDelete }: { conversations: CloudAgentConversation[]; activeConversationId: string; theme: CanvasTheme; onBack: () => void; onNew: () => void; onOpen: (conversation: CloudAgentConversation) => void; onDelete: (id: string) => void }) {
    return (
        <div className="canvas-agent-history-root flex min-h-0 min-w-0 flex-1 flex-col">
            <header data-agent-drag-handle className="agent-panel-header flex shrink-0 items-center gap-2">
                <Button type="text" shape="circle" icon={<ArrowLeft className="size-4" />} onClick={onBack} aria-label="返回对话" />
                <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">历史对话</div>
                    <div className="mt-0.5 text-[11px] opacity-40">保存在当前账号与画布下</div>
                </div>
                <Button type="text" shape="circle" icon={<MessageSquarePlus className="size-4" />} onClick={onNew} aria-label="新建对话" title="新建对话" />
            </header>
            <div className="canvas-agent-history-scroll thin-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto px-3 py-3">
                {conversations.length ? (
                    <div className="space-y-1">
                        {conversations.map((conversation) => {
                            const preview = truncateConversationPreview(conversation.messages.at(-1)?.text || "尚未发送消息");
                            const active = conversation.id === activeConversationId;
                            return (
                                <div key={conversation.id} className="canvas-agent-history-item group flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors" style={{ background: active ? theme.toolbar.itemHover : "transparent", color: theme.node.text }}>
                                    <button type="button" className="canvas-agent-history-open flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => onOpen(conversation)} aria-current={active ? "page" : undefined}>
                                        <span className="grid size-8 shrink-0 place-items-center rounded-full" style={{ background: theme.node.fill, color: theme.node.muted }}><Clock3 className="size-3.5" /></span>
                                        <span className="canvas-agent-history-text min-w-0 flex-1">
                                            <span className="canvas-agent-history-title block truncate text-[13px] font-medium">{conversation.title}</span>
                                            <span className="canvas-agent-history-preview mt-0.5 block text-[11px] opacity-40" title={preview}>{preview}</span>
                                        </span>
                                        <span className="canvas-agent-history-time shrink-0 text-[10px] opacity-35">{formatConversationTime(conversation.updatedAt)}</span>
                                    </button>
                                    <Button type="text" size="small" danger className="canvas-agent-history-delete !h-7 !px-2 !text-xs !opacity-80" icon={<Trash2 className="size-3.5" />} onClick={() => onDelete(conversation.id)} aria-label={`删除对话 ${conversation.title}`} title="删除对话">删除</Button>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="flex h-full min-h-72 flex-col items-center justify-center text-center">
                        <History className="size-5 opacity-30" />
                        <div className="mt-3 text-sm font-medium">还没有历史对话</div>
                        <div className="mt-1 text-xs opacity-40">发送第一条消息后会自动保存</div>
                    </div>
                )}
            </div>
        </div>
    );
}

function AgentConversation({
    theme,
    messages,
    references,
    busy,
    approval,
    approvalSubmitting,
    nodeCount,
    onChooseSkill,
    onDraftPrompt,
    onFocusNode,
    onApprovalReasonChange,
    onApprove,
    onReject,
}: {
    theme: CanvasTheme;
    messages: CloudAgentChatMessage[];
    references: CanvasResourceReference[];
    busy: boolean;
    approval: ApprovalState | null;
    approvalSubmitting: boolean;
    nodeCount: number;
    onChooseSkill: () => void;
    onDraftPrompt: (prompt: string) => void;
    onFocusNode?: (nodeId: string) => void;
    onApprovalReasonChange: (reason: string) => void;
    onApprove: (settings?: AgentMediaSettings) => void;
    onReject: () => void;
}) {
    const appearance = useAppearanceStore((state) => state.appearance.canvas) || DEFAULT_CANVAS_APPEARANCE;
    const scrollRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const followRef = useRef(true);
    const lastUserId = messages.findLast((item) => item.role === "user")?.id;

    // 自己发送时恢复跟随；阅读旧消息时不让流式输出抢走滚动位置。
    useLayoutEffect(() => {
        followRef.current = true;
    }, [lastUserId]);
    useLayoutEffect(() => {
        const element = scrollRef.current;
        if (element && followRef.current) element.scrollTop = element.scrollHeight;
    }, [messages, busy, approval]);
    useEffect(() => {
        const element = scrollRef.current;
        const content = contentRef.current;
        if (!element || !content) return;
        const observer = new ResizeObserver(() => {
            if (followRef.current) element.scrollTop = element.scrollHeight;
        });
        observer.observe(element);
        observer.observe(content);
        return () => observer.disconnect();
    }, []);

    return (
        <div ref={scrollRef} data-agent-conversation className="agent-conversation thin-scrollbar min-h-0 flex-1 overflow-y-auto" onScroll={(event) => {
            const element = event.currentTarget;
            followRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
        }}>
            {!messages.length ? <AgentWelcome appearance={appearance} nodeCount={nodeCount} onChooseSkill={onChooseSkill} onDraftPrompt={onDraftPrompt} /> : null}
            <div ref={contentRef} className="agent-conversation-messages">
                {messages.map((item) => (
                    <AgentChatMessage key={item.id} item={item} theme={theme} references={references} onFocusNode={onFocusNode} isStreaming={busy && !approval && item.streaming === true && item === messages.at(-1)} />
                ))}
                {approval ? <ApprovalCard key={approval.approvalId} approval={approval} theme={theme} submitting={approvalSubmitting} onFocusNode={onFocusNode} onReasonChange={onApprovalReasonChange} onApprove={onApprove} onReject={onReject} /> : null}
                {busy && !approval ? (
                    <AgentWorkingMessage theme={theme} label="正在处理当前画布" />
                ) : null}
            </div>
        </div>
    );
}

function ComposerControls({
    reasoningMode,
    reasoningSupported,
    onReasoningModeChange,
    config,
    selectedModel,
    permissionMode,
    theme,
    onModelChange,
    onPermissionChange,
    skillsOpen,
    onSkillsOpenChange,
    selectedSkillCount,
}: {
    reasoningMode: AgentReasoningMode;
    reasoningSupported: boolean;
    onReasoningModeChange: (value: AgentReasoningMode) => void;
    config: ReturnType<typeof useEffectiveConfig>;
    selectedModel: string;
    permissionMode: AgentPermissionMode;
    theme: CanvasTheme;
    onModelChange: (model: string) => void;
    onPermissionChange: (mode: AgentPermissionMode) => void;
    skillsOpen: boolean;
    onSkillsOpenChange: (open: boolean) => void;
    selectedSkillCount: number;
}) {
    const permissionVisual = agentPermissionVisual(permissionMode);
    const PermissionIcon = permissionVisual.icon;
    return (
        <div className="flex min-w-0 flex-wrap items-center gap-0.5">
            <ModelPicker
                config={config}
                value={selectedModel}
                capability="text"
                onChange={onModelChange}
                variant="creation"
                className="!h-8 !min-w-0 !w-52 !max-w-full !border-0 !bg-transparent !px-1.5 !shadow-none"
                popoverClassName="agent-model-picker-popover"
                showSelectedPrice={false}
                showOptionPrices
                placeholder="选择文本模型"
            />
            {reasoningSupported ? <Dropdown trigger={["click"]} placement="topLeft" menu={{ items: reasoningMenuItems(reasoningMode, onReasoningModeChange) }}>
                <button type="button" aria-label="选择 Agent 推理模式" title="推理模式：只用于规划和工具选择" className="flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/25" style={{ color: reasoningMode === "off" ? theme.node.muted : theme.accent.primary, background: reasoningMode === "off" ? "transparent" : theme.node.fill }}>
                    <Sparkles className="size-3.5" />{reasoningModeLabel(reasoningMode)}
                </button>
            </Dropdown> : null}
            <Dropdown trigger={["click"]} placement="topLeft" menu={{ items: agentPermissionMenuItems(permissionMode, onPermissionChange) }}>
                <button
                    type="button"
                    className="grid size-8 shrink-0 place-items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/25"
                    style={{ color: theme.node.muted, background: "transparent" }}
                    aria-label={`执行权限：${agentPermissionLabel(permissionMode)}，点击切换`}
                    title={`执行权限：${agentPermissionLabel(permissionMode)}，点击切换`}
                >
                    <PermissionIcon className="size-3.5" style={{ color: permissionVisual.color }} aria-hidden="true" />
                </button>
            </Dropdown>
            <button
                type="button"
                className="flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/25"
                style={{ color: selectedSkillCount ? theme.accent.primary : theme.node.muted, background: skillsOpen ? theme.node.fill : "transparent" }}
                aria-label={`打开 Skills 技能库${selectedSkillCount ? `，已启用 ${selectedSkillCount} 个` : ""}`}
                aria-expanded={skillsOpen}
                aria-haspopup="dialog"
                title="打开 Skills 技能库"
                onClick={() => onSkillsOpenChange(true)}
            >
                <Sparkles className="size-3.5" />
                <span className="max-w-28 truncate">Skills({selectedSkillCount})</span>
            </button>
        </div>
    );
}

const reasoningLabels: Record<AgentReasoningMode, string> = { off: "直达", auto: "自动推理", deep: "深入推理" };

function reasoningModeLabel(mode: AgentReasoningMode) { return reasoningLabels[mode]; }

function reasoningMenuItems(mode: AgentReasoningMode, onChange: (value: AgentReasoningMode) => void) {
    return (Object.keys(reasoningLabels) as AgentReasoningMode[]).map((value) => ({
        key: value,
        label: reasoningLabels[value],
        icon: value === mode ? <Check className="size-3.5" /> : undefined,
        onClick: () => onChange(value),
    }));
}

function ApprovalCard({ approval, theme, submitting, onFocusNode, onReasonChange, onApprove, onReject }: { approval: ApprovalState; theme: CanvasTheme; submitting: boolean; onFocusNode?: (nodeId: string) => void; onReasonChange: (value: string) => void; onApprove: (settings?: AgentMediaSettings) => void; onReject: () => void }) {
    const [showReason, setShowReason] = useState(Boolean(approval.reason));
    const [mediaSettings, setMediaSettings] = useState<AgentMediaSettings>();
    const imageApproval = agentImageApproval(approval.detail);
    const action = agentApprovalPresentation(approval.detail);
    return (
        <section className="canvas-agent-approval-card" aria-label={action.title}>
            <div className="canvas-agent-approval-header">
                <span className="canvas-agent-approval-icon" aria-hidden="true"><ShieldCheck className="size-4" /></span>
                <h3>{action.title}</h3>
                <span className="canvas-agent-approval-badge">等待你的确认</span>
            </div>
            <p className="canvas-agent-approval-description" style={{ color: theme.node.muted }}>{action.description}</p>
            {action.items.length ? (
                <div className="canvas-agent-approval-items" aria-label="涉及节点">
                    {action.items.map((item, index) => <ApprovalPreviewItemView key={`${item.operation}-${item.nodeId || item.nodeTitle || index}-${index}`} item={imageApproval ? { ...item, details: item.details?.filter((detail) => !/^(模型|画幅|质量)[：:]/.test(detail)) } : item} theme={theme} onFocusNode={onFocusNode} />)}
                </div>
            ) : <div className="canvas-agent-approval-empty" style={{ color: theme.node.muted }}>无法确认具体目标，继续前请重新读取画布。</div>}
            {imageApproval ? <CanvasAgentImageApprovalSettings initial={imageApproval} value={mediaSettings} onChange={setMediaSettings} theme={theme} disabled={submitting} /> : null}
            <button type="button" className="canvas-agent-approval-reason-toggle" aria-expanded={showReason} onClick={() => setShowReason((value) => !value)} disabled={submitting}>
                {showReason ? "收起拒绝理由" : "填写拒绝理由（可选）"}
            </button>
            {showReason ? <Input.TextArea className="canvas-agent-approval-reason" value={approval.reason} onChange={(event) => onReasonChange(event.target.value)} placeholder="告诉 Agent 为什么暂不执行" autoSize={{ minRows: 2, maxRows: 3 }} maxLength={2000} disabled={submitting} /> : null}
            <div className="canvas-agent-approval-actions">
                <button type="button" className="canvas-agent-approval-reject" disabled={submitting} onClick={onReject}>暂不执行</button>
                <button type="button" className="canvas-agent-approval-approve" disabled={submitting} onClick={() => onApprove(mediaSettings)}>
                    {submitting ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Check className="size-4" aria-hidden="true" />}
                    {submitting ? "正在提交" : "同意执行"}
                </button>
            </div>
        </section>
    );
}

function ApprovalPreviewItemView({ item, theme, onFocusNode }: { item: ReturnType<typeof agentApprovalPresentation>["items"][number]; theme: CanvasTheme; onFocusNode?: (nodeId: string) => void }) {
    const operationLabel = item.operation === "add_node" ? "新增" : item.operation === "update_node" ? "修改" : item.operation === "connect_nodes" ? "连线" : item.operation === "arrange_nodes" ? "整理" : item.operation === "create_storyboard" ? "创建分镜" : item.operation === "edit_storyboard" ? "修改分镜" : item.operation === "plan_step" ? "计划" : "生成";
    const renderNode = (title: string | undefined, id: string | undefined, typeLabel: string | undefined, role: "source" | "target" | "node") => {
        if (!title) return null;
        const content = <><span className="canvas-agent-approval-node-title">{title}</span>{typeLabel ? <span className="canvas-agent-approval-node-type">{typeLabel}</span> : null}</>;
        return id && onFocusNode ? <button type="button" className="canvas-agent-approval-node canvas-agent-approval-node-button" onClick={() => onFocusNode(id)} title="定位到画布节点">{content}</button> : <span className={`canvas-agent-approval-node canvas-agent-approval-node-${role}`}>{content}</span>;
    };
    return (
        <article className="canvas-agent-approval-item">
            <div className="canvas-agent-approval-item-main">
                <span className={`canvas-agent-approval-operation canvas-agent-approval-operation-${item.operation}`}>{operationLabel}</span>
                {item.operation === "connect_nodes" ? (
                    <div className="canvas-agent-approval-connection">
                        {renderNode(item.nodeTitle, item.nodeId, item.nodeTypeLabel, "source")}
                        <span className="canvas-agent-approval-arrow" aria-hidden="true">→</span>
                        {renderNode(item.targetNodeTitle, item.targetNodeId, undefined, "target")}
                    </div>
                ) : (
                    <div className="canvas-agent-approval-node-summary">
                        {renderNode(item.nodeTitle, item.nodeId, item.nodeTypeLabel, "node")}
                        {item.resultTitle ? <><span className="canvas-agent-approval-change-arrow" aria-hidden="true">改为</span><span className="canvas-agent-approval-result-title">《{item.resultTitle}》</span></> : null}
                    </div>
                )}
            </div>
            {item.fields?.length ? <div className="canvas-agent-approval-field-list">修改：{item.fields.map((field) => <span key={field}>{field}</span>)}</div> : null}
            {item.details?.length ? <div className="canvas-agent-approval-detail-list">{item.details.map((detail) => <span key={detail}>{detail}</span>)}</div> : null}
            <div className="canvas-agent-approval-summary">{item.summary}</div>
        </article>
    );
}

function positiveNumber(value: string) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : undefined;
}
function truncateConversationPreview(value: string, max = 96) {
    const compact = markdownPlainText(value);
    return compact.length > max ? `${compact.slice(0, max)}…` : compact || "尚未发送消息";
}

function formatConversationTime(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const today = new Date();
    if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
    return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}
function applyAgentEvent(event: AgentEvent, setMessages: Dispatch<SetStateAction<CloudAgentChatMessage[]>>, setRun: Dispatch<SetStateAction<AgentRun | null>>, setApproval: Dispatch<SetStateAction<ApprovalState | null>>, setPrompt?: Dispatch<SetStateAction<string>>) {
    const payload = event.payload || {};
    const text = String(payload.text || payload.summary || payload.message || "");
    if (event.type === "run_status") {
        const snapshotApproval = payload.approval && typeof payload.approval === "object" ? payload.approval as AgentRun["approval"] : undefined;
        setRun((current) => (current ? { ...current, status: String(payload.status || current.status) as AgentRun["status"], updatedAt: event.createdAt, revision: Number(payload.revision || 0), cleanupPending: Boolean(payload.cleanupPending), failureMessage: String(payload.failureMessage || ""), skills: payload.skills as AgentRun["skills"], spentCredits: Number(payload.spentCredits || 0), step: Number(payload.step || 0), approval: snapshotApproval } : current));
        if (payload.failureMessage) setMessages((current) => appendAgentError(current, `terminal-${event.runId}`, String(payload.failureMessage)));
        if (snapshotApproval && !snapshotApproval.decision && snapshotApproval.approvalId) {
            setApproval((current) => ({ approvalId: snapshotApproval.approvalId, detail: snapshotApproval, reason: current?.approvalId === snapshotApproval.approvalId ? current.reason : snapshotApproval.reason || "" }));
        } else {
            setApproval(null);
        }
        return;
    }
    if (event.type === "approval_decided") {
        setApproval(null);
        if (payload.decision === "reject") {
            setMessages((current) => appendUniqueMessage(current, {
                id: event.eventId,
                role: "system",
                text: text || "已拒绝本次操作，未写入画布。你可以告诉 Agent 修改方向后重新申请。",
            }));
        }
        return;
    }
    if (event.type === "progress_summary") {
        setMessages((current) => appendUniqueMessage(current, { id: event.eventId, role: "system", text: text || "Agent 正在整理执行计划" }));
        return;
    }
    if (event.type === "assistant_delta") {
        setMessages((current) => upsertTextMessage(current, String(payload.messageId || "assistant"), text, true));
        return;
    }
    if (event.type === "reasoning_delta" || event.type === "reasoning_message") {
        const id = String(payload.messageId || `${event.runId}:reasoning`);
        setMessages((current) => upsertTextMessage(current, id, text, event.type === "reasoning_delta")
            .map((item) => item.id === id ? { ...item, reasoning: true } : item));
        return;
    }
    if (event.type === "plan_updated" && Array.isArray(payload.items)) {
        const id = `plan-${event.runId}`;
        const planItems = payload.items as CloudAgentPlanItem[];
        setMessages((current) => {
            const index = current.findIndex((entry) => entry.id === id);
            const message: CloudAgentChatMessage = { id, role: "tool", text: "", planItems };
            if (index < 0) return [...current, message];
            const next = [...current];
            next[index] = message;
            return next;
        });
        return;
    }
    if (event.type === "user_interjection") {
        if (!text) return;
        setMessages((current) => appendUniqueMessage(current, { id: String(payload.messageId || event.eventId), role: "user", text, interjection: "sent" }));
        return;
    }
    if (event.type === "user_interjection_dropped") {
        const messageId = String(payload.messageId || event.eventId);
        const reason = String(payload.reason || "本轮已结束");
        setMessages((current) => {
            const marked = current.map((item) => item.id === messageId ? { ...item, interjection: "undelivered" as const } : item);
            return appendUniqueMessage(marked, { id: `interjection-dropped-${messageId}`, role: "system", text: `${reason}，这条插话没有送到模型。需要的话重新发一次，它会作为新一轮。` });
        });
        setPrompt?.((current) => (current.trim() ? current : text));
        return;
    }
    if (event.type === "user_question") {
        const options = Array.isArray(payload.options)
            ? (payload.options as Array<{ label?: unknown; detail?: unknown }>)
                .map((option) => ({ label: String(option?.label || "").trim(), detail: option?.detail === undefined ? undefined : String(option.detail) }))
                .filter((option) => option.label)
            : [];
        const question = String(payload.question || "").trim();
        if (!question || options.length < 2) return;
        const id = `question-${event.runId}:${event.seq ?? event.eventId}`;
        setMessages((current) => appendUniqueMessage(current, {
            id,
            role: "assistant",
            text: "",
            question: { question, options, allowFreeform: payload.allowFreeform !== false },
        }));
        return;
    }
    if (event.type === "assistant_message") {
        setMessages((current) => upsertTextMessage(current, String(payload.messageId || event.eventId), text, false));
        return;
    }
    if (event.type === "assistant_snapshot") {
        setMessages((current) => upsertTextMessage(current, String(payload.messageId || event.eventId), text, false));
        return;
    }
    if (event.type === "approval_requested") {
        const approvalId = String(payload.approvalId || "");
        setApproval((current) => ({ approvalId, detail: payload, reason: current?.approvalId === approvalId ? current.reason : "" }));
        return;
    }
    if (event.type === "canvas_updated" && Array.isArray(payload.actions)) {
        if (payload.operation === "generate_media_submit" || payload.operation === "generate_media_complete") return;
        const { canvasPatch: _patch, ...detail } = payload;
        const id = payload.callId ? `canvas-${event.runId}-${payload.callId}` : event.eventId;
        setMessages((current) => appendUniqueMessage(current, { id, role: "tool", title: "canvas_apply_ops", text: "画布操作已完成", detail: { ...detail, eventType: event.type } }));
        return;
    }
    if (event.type.startsWith("tool_") && agentToolRetry(payload)) {
        const message: CloudAgentChatMessage = { id: event.eventId, role: "tool", title: String(payload.toolName || "工具执行"), text, detail: { ...payload, eventType: event.type } };
        setMessages((current) => mergeAgentToolRetry(current, message));
        if (event.type === "tool_failed") return;
    }
    if (event.type === "tool_completed" && payload.toolName === "canvas_apply_ops" && payload.callId) {
        const id = `canvas-${event.runId}-${payload.callId}`;
        setMessages((current) => appendUniqueMessage(current, { id, role: "tool", title: "canvas_apply_ops", text: text || "画布操作已完成", detail: { ...payload, eventType: event.type } }));
        return;
    }
    if (event.type === "generation_task_created") {
        const message: CloudAgentChatMessage = { id: event.eventId, role: "tool", title: "generate_media", text: text || event.type, detail: { ...payload, eventType: event.type } };
        setMessages((current) => upsertMediaToolTrace(current, message));
        return;
    }
    if (event.type.startsWith("tool_")) {
        const message: CloudAgentChatMessage = { id: event.eventId, role: "tool", title: String(payload.toolName || payload.title || "工具执行"), text: text || event.type, detail: { ...payload, eventType: event.type } };
        if (payload.toolName === "generate_media") {
            setMessages((current) => upsertMediaToolTrace(current, message));
        } else {
            setMessages((current) => appendUniqueMessage(current, message));
        }
        return;
    }
    if (event.type === "run_failed" || event.type === "error") setMessages((current) => appendAgentError(current, event.eventId, text || "Agent 执行失败"));
}
function toolDetailRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function toolDetailNodeIds(detail: unknown): Set<string> {
    const payload = toolDetailRecord(detail);
    const ids = new Set<string>();
    for (const value of [payload.nodeId, toolDetailRecord(payload.result).nodeId]) {
        if (typeof value === "string" && value) ids.add(value);
    }
    if (Array.isArray(payload.actions)) {
        for (const action of payload.actions) {
            const nodeId = toolDetailRecord(action).nodeId;
            if (typeof nodeId === "string" && nodeId) ids.add(nodeId);
        }
    }
    if (typeof payload.arguments === "string") {
        try {
            const args = toolDetailRecord(JSON.parse(payload.arguments));
            if (Array.isArray(args.ops)) {
                for (const op of args.ops) {
                    const nodeId = toolDetailRecord(op).id;
                    if (typeof nodeId === "string" && nodeId) ids.add(nodeId);
                }
            }
        } catch {
            // Tool arguments are diagnostic data; a malformed value must not break the event feed.
        }
    }
    return ids;
}

function toolDetailTaskIds(detail: unknown): Set<string> {
    const payload = toolDetailRecord(detail);
    const ids = new Set<string>();
    for (const value of [payload.taskId, toolDetailRecord(payload.result).taskId]) {
        if (typeof value === "string" && value) ids.add(value);
    }
    return ids;
}

function mergeToolDetails(previous: unknown, next: unknown): Record<string, unknown> {
    const previousDetail = toolDetailRecord(previous);
    const nextDetail = toolDetailRecord(next);
    return {
        ...previousDetail,
        ...nextDetail,
        actions: Array.isArray(nextDetail.actions) ? nextDetail.actions : previousDetail.actions,
        arguments: nextDetail.arguments || previousDetail.arguments,
    };
}

function upsertMediaToolTrace(current: CloudAgentChatMessage[], message: CloudAgentChatMessage): CloudAgentChatMessage[] {
    const nextNodeIds = toolDetailNodeIds(message.detail);
    const nextTaskIds = toolDetailTaskIds(message.detail);
    const index = current.findIndex((item) => {
        if (item.role !== "tool") return false;
        const itemToolName = item.title || "";
        if (itemToolName !== "canvas_apply_ops" && itemToolName !== "generate_media") return false;
        const itemNodeIds = toolDetailNodeIds(item.detail);
        const itemTaskIds = toolDetailTaskIds(item.detail);
        return [...nextNodeIds].some((id) => itemNodeIds.has(id)) || [...nextTaskIds].some((id) => itemTaskIds.has(id));
    });
    if (index < 0) return appendUniqueMessage(current, message);
    const next = [...current];
    const previous = next[index];
    next[index] = {
        ...previous,
        ...message,
        id: previous.id,
        detail: mergeToolDetails(previous.detail, message.detail),
    };
    return next;
}

function appendUniqueMessage(current: CloudAgentChatMessage[], message: CloudAgentChatMessage) {
    return current.some((item) => item.id === message.id) ? current : [...current, message];
}
function upsertTextMessage(current: CloudAgentChatMessage[], id: string, text: string, append: boolean): CloudAgentChatMessage[] {
    const index = current.findIndex((item) => item.id === id);
    if (index < 0) return [...current, { id, role: "assistant" as const, text, streaming: append }];
    if (!append && current[index].text === text && !current[index].streaming) return current;
    const next = [...current];
    next[index] = { ...next[index], text: append ? `${next[index].text}${text}` : text, streaming: append };
    return next;
}

function appendAgentError(current: CloudAgentChatMessage[], id: string, cause: unknown, fallback?: string) {
    const message = agentErrorPresentation(cause, fallback);
    const last = current.at(-1);
    if (last?.role === "error" && last.title === message.title && last.text === message.text) return current;
    return appendUniqueMessage(current, { id, role: "error", ...message });
}

function isNotFoundError(cause: unknown) {
    if (!cause || typeof cause !== "object") return false;
    const status = "status" in cause ? (cause as { status?: unknown }).status : undefined;
    return status === 404 || (cause instanceof Error && /\(404\)/u.test(cause.message));
}
