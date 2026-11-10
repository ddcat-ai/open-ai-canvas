import { createClientUUID } from "@/lib/client-id";
import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type DragEvent as ReactDragEvent } from "react";
import { App, Button } from "antd";
import { appQueryClient } from "@/lib/query-client";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { EyeOff, FileText, ImagePlus, MoveDiagonal2, SquareDashedMousePointer, X } from "lucide-react";
import { canvasNodeMentionToken } from "@/lib/canvas/canvas-resource-references";
import { CANVAS_IMAGE_ASSET_DND_TYPE } from "@/lib/canvas/canvas-asset-dnd";
import {
    AGENT_ATTACHMENT_MAX,
    agentAttachmentFileKey,
    agentAttachmentStatusKey,
    appendAgentNodeReferences,
    checkAgentAttachmentFiles,
    mergeAgentFocusNodeIds,
    parseAgentAttachmentStatus,
    removeAgentNodeReference,
    replaceAgentPastedText,
} from "@/lib/canvas/agent-composer-attachments";
import type { InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import type { CloudAgentChatAttachment } from "./canvas-cloud-agent-attachments";
import { useAssetStore } from "@/stores/use-asset-store";
import { saveAs } from "file-saver";
import { buildAgentDebugExport } from "@/lib/canvas/agent-debug-export";
import { agentPlanVisible, latestAgentPlanItems, latestAgentPlanTerminal, pendingAgentQuestion } from "@/lib/canvas/cloud-agent-plan";
import { latestAgentMediaBatch } from "@/lib/canvas/cloud-agent-media-batch";
import { AgentMediaBatchBar } from "./canvas-cloud-agent-media-batch-bar";
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
    withdrawAgentInterjection,
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
import { addSkill, listAddedSkills, listSkillLibraryCategories, listSkills, listSkillPresets, setSkillAgentMode, type Skill, type SkillAgentMode, type SkillCategory, type SkillLibraryCategory, type SkillPreset } from "@/services/api/skills";
import { SkillRecommendationsModal } from "@/components/skills/skill-recommendations-modal";
import { reconcileSkillSelection } from "@/services/skill-runtime";
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
import { clearCloudAgentOutbox, loadCloudAgentOutbox, saveCloudAgentOutbox } from "@/services/cloud-agent-outbox";
import {
    AGENT_DOUBLE_ESCAPE_MS,
    AGENT_FOCUS_NODE_LIMIT,
    AGENT_OUTBOX_MAX_ITEMS,
    AGENT_PROMPT_MAX_CHARS,
    EMPTY_AGENT_OUTBOX,
    agentComposerSubmitMode,
    agentModifierShortcut,
    agentOutboxDispatchBlocker,
    agentOutboxFull,
    agentOutboxInterjectBlocker,
    agentOutboxItemEditable,
    agentOutboxMessageId,
    agentOutboxPauseForRunEnd,
    agentRunAcceptsInterjection,
    agentRunTerminal,
    agentTextLength,
    clearAgentOutboxPause,
    enqueueAgentOutboxItem,
    moveAgentOutboxItemToHead,
    pauseAgentOutbox,
    rebindAgentOutboxItem,
    reconcileAgentOutbox,
    removeAgentOutboxItem,
    restoreAgentOutbox,
    resumeAgentOutbox,
    updateAgentOutboxItem,
    type AgentOutbox,
    type AgentOutboxItem,
    type AgentOutboxPauseReason,
    type AgentRunSettings,
} from "@/lib/canvas/agent-outbox";
import { loadCloudAgentConversation, mergeCloudAgentConversations, refreshCloudAgentConversations } from "@/services/cloud-agent-history";
import { canvasCloudAgentConversation, cloudAgentFollowDecision } from "@/lib/canvas/cloud-agent-follow";
import { resolveCloudAgentModel } from "@/lib/canvas/cloud-agent-model-restore";
import { logicalModelIDForConfig, modelDisplayName, modelOptionName, resolveModelRequestConfig, selectableModelsByCapability, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { modelSupportsImageInspection, selectImageInspectionModel } from "@/lib/canvas/image-to-previs-agent";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { getActiveUserScope } from "@/lib/user-scope";
import { applyAgentCanvasPatches, refreshCanvasAfterAgent, prepareCanvasForCloudAction } from "@/services/user-data-sync";
import { createAgentCanvasSync } from "@/services/agent-canvas-sync";
import { agentCanvasUndoKey, type AgentCanvasUndoState, type AgentCanvasUndoTarget } from "@/lib/canvas/agent-canvas-undo";
import { canvasEditLeases } from "@/services/canvas-edit-leases";
import { buildSkillMentionReferences, resolveSkillMentions } from "@/services/skill-runtime";
import { AGENT_SCENE_DEFS, AgentChatComposer, parseCloudAgentFormAnswer, AgentPlanBar, AgentQuestionBar, AgentSceneCapsules, type AgentSceneBucket, type CloudAgentChatMessage } from "./canvas-cloud-agent-chat-ui";
import { AgentContextChip } from "./canvas-cloud-agent-composer";
import { CanvasAgentSkillLibraryModal } from "./canvas-agent-skill-library-modal";
import { useSkillCuration, curationQuery } from "@/components/skills/skill-curation-browser";
import { CanvasCloudAgentSettings, agentPermissionLabel, type AgentContextKey } from "./canvas-cloud-agent-settings";
import { AgentOutboxTray, type AgentOutboxPrimaryAction } from "./canvas-cloud-agent-outbox";
import { useAgentPanelLayout } from "./use-agent-panel-layout";
import { useAgentPanelDock } from "./use-agent-panel-dock";
import "./canvas-cloud-agent.css";
import { appendAgentError, appendUniqueMessage, applyAgentEvent, positiveNumber, type ApprovalState } from "./canvas-cloud-agent-events";
import { AgentContextRing, AgentConversation, AgentHeader, AgentHistory, AgentLauncher, ComposerControls } from "./canvas-cloud-agent-panel-parts";
import { useGlobalAgentStore, type AgentInsertedNode, type AgentPrefillRequest } from "@/stores/use-global-agent-store";

type AgentPanelView = "chat" | "history" | "settings";
// 素材库弹窗只在用户点「从素材库选择」时加载，不进面板首包。
const AgentAssetPickerModal = lazy(() => import("@/components/canvas/asset-picker-modal").then((module) => ({ default: module.AssetPickerModal })));
/**
 * 输入框草稿的附件：都是画布节点；createdHere 表示由这个输入框新建，移除时可一起从画布删除。
 * file 只留在内存里，用于上传失败后重试；sourceText 是长文本转节点前的原文，移除卡片时放回正文。
 */
type AgentDraftAttachment = {
    nodeId: string;
    name: string;
    url: string;
    objectUrl?: boolean;
    kind: "image" | "text" | "video" | "audio";
    canvasId: string;
    createdHere: boolean;
    fileKey?: string;
    file?: File;
    failure?: string;
    sourceText?: string;
};
/** 来自输入框的消息额外带上的内容：附件节点引用（排在选区前作为重点），以及是否不带选区。 */
type ComposerExtras = { attachmentNodeIds: string[]; excludeSelection: boolean };

function approvalStateFromRun(nextRun: AgentRun | null): ApprovalState | null {
    const approval = nextRun?.approval;
    if (!approval?.approvalId || approval.decision) return null;
    return { approvalId: approval.approvalId, detail: approval, reason: approval.reason || "" };
}

const EMPTY_IDS: string[] = [];
const CONVERSATION_AUTOSAVE_DELAY_MS = 600;
const CONVERSATION_AUTOSAVE_MAX_WAIT_MS = 3000;
const EMPTY_REFERENCES: CanvasResourceReference[] = [];

/**
 * 平台唯一的 Agent 面板，挂在用户布局上，所有页面共用同一份对话。
 * 画布编辑器通过 useGlobalAgentStore 发布当前画布；发送时有画布就绑定该画布，
 * 离开画布后下一轮不再携带画布 ID（后端只开放无画布工具）。
 */
export const CanvasCloudAgentPanel = memo(function CanvasCloudAgentPanel() {
    // 只订阅渲染要用的字段。画布每次选中、拖动或编辑都会重发上下文；订阅整份会让面板和全部消息跟着重渲染。
    // 选中节点只在发送时读取，审批目标节点状态只在有审批时订阅（见 approvalTargetGenerating）。
    const canvasId = useGlobalAgentStore((state) => state.canvas?.canvasId ?? "");
    const domainProjectId = useGlobalAgentStore((state) => state.canvas?.domainProjectId);
    const nodeCount = useGlobalAgentStore((state) => state.canvas?.nodeCount ?? 0);
    const references = useGlobalAgentStore((state) => state.canvas?.references ?? EMPTY_REFERENCES);
    const prefillRequest = useGlobalAgentStore((state) => state.canvas?.prefillRequest ?? null);
    const onFocusNode = useGlobalAgentStore((state) => state.canvas?.onFocusNode);
    const insertAgentMarkdown = useGlobalAgentStore((state) => state.canvas?.insertAgentMarkdown);
    const open = useGlobalAgentStore((state) => state.open);
    const onOpen = useGlobalAgentStore((state) => state.openAgent);
    const onCollapse = useGlobalAgentStore((state) => state.closeAgent);
    const setDocked = useGlobalAgentStore((state) => state.setDocked);
    const dock = useAgentPanelDock();
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
    const prefilledSubmissionRef = useRef<AgentPrefillRequest | null>(null);
    // 本机发送队列（排队 / 插话），按对话保存。owner 不是当前对话时视为还没读到，不能写也不能发。
    // 异步流程读写都走 outboxStoreRef，避免拿到旧闭包里的队列。
    const [outboxStore, setOutboxStore] = useState<{ conversationId: string; outbox: AgentOutbox } | null>(null);
    const outboxStoreRef = useRef(outboxStore);
    // 队列还没读出时到达的「发送到 Agent」，读出后按顺序补进队列。
    const pendingEnqueueRef = useRef<{ conversationId: string; item: AgentOutboxItem }[]>([]);
    const [outboxEdit, setOutboxEdit] = useState<{ itemId: string; stash: string } | null>(null);
    const [forceDispatchId, setForceDispatchId] = useState<string | null>(null);
    const outboxDispatchRef = useRef(false);
    const outboxRunEndRef = useRef("");
    const [escapeArmedAt, setEscapeArmedAt] = useState(0);
    const [reasoningMode, setReasoningMode] = useState<AgentReasoningMode>("off");
    const [profileView, setProfileView] = useState<AgentProfileView | null>(null);
    const [profileLoading, setProfileLoading] = useState(false);
    const [profileSaving, setProfileSaving] = useState(false);
    const [profileError, setProfileError] = useState<string>();
    const profileRequestRef = useRef(0);
    const { message: appMessage } = App.useApp();
    const [skills, setSkills] = useState<Skill[]>([]);
    // 读到技能库后才允许剔除失效技能；读失败保留已选。
    const [skillCatalogReady, setSkillCatalogReady] = useState(false);
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
    const [skillRecommendationsOpen, setSkillRecommendationsOpen] = useState(false);
    const curationState = useSkillCuration(skillsOpen);
    const [platformCategory, setPlatformCategory] = useState("");
    const skillBrowseKey = JSON.stringify([userId, skillTag, debouncedSkillSearch, platformCategory, curationState.curation?.revision, curationState.curation?.enabled]);
    const skillBrowseKeyRef = useRef(skillBrowseKey);
    skillBrowseKeyRef.current = skillBrowseKey;
    useEffect(() => {
        if (curationState.curation?.enabled) setSkillTag("all");
    }, [curationState.curation?.enabled]);
    const [busy, setBusy] = useState(false);
    const [approvalSubmitting, setApprovalSubmitting] = useState(false);
    const [undoStates, setUndoStates] = useState<Record<string, AgentCanvasUndoState>>({});
    const undoRequestsRef = useRef(new Set<string>());
    const [exporting, setExporting] = useState(false);
    const [stopping, setStopping] = useState(false);
    const [withdrawingInterjectionId, setWithdrawingInterjectionId] = useState<string | null>(null);
    const [approval, setApproval] = useState<ApprovalState | null>(null);
    const approvalDetail = approval?.detail;
    // 选择器返回节点对象本身：没有审批或目标节点没变时引用不变，不会触发重渲染。
    const approvalTargetGenerating = useGlobalAgentStore((state) => (approvalDetail ? agentApprovalTargetGenerating(approvalDetail, state.canvas?.canvasNodes, state.canvas?.runningNodeId) : undefined));
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
    const conversationAutosaveRef = useRef<{ timer: ReturnType<typeof setTimeout>; save: () => void; since: number } | null>(null);
    // 显式保存的快照总是更新；先丢掉还没写的旧快照，避免它晚到时覆盖（例如把刚删除的对话写回去）。
    const cancelConversationAutosave = () => {
        const pending = conversationAutosaveRef.current;
        if (!pending) return;
        clearTimeout(pending.timer);
        conversationAutosaveRef.current = null;
    };
    const [planMinimized, setPlanMinimized] = useState(false);
    const planItems = useMemo(() => latestAgentPlanItems(messages), [messages]);
    const planTerminal = useMemo(() => latestAgentPlanTerminal(messages), [messages]);
    const planVisible = agentPlanVisible(planItems);
    const mediaBatch = useMemo(() => latestAgentMediaBatch(messages), [messages]);
    const pendingQuestion = useMemo(() => pendingAgentQuestion(messages), [messages]);
    const [scenePresets, setScenePresets] = useState<SkillPreset[]>([]);
    const [presetApplyingId, setPresetApplyingId] = useState("");
    const presetApplyingRef = useRef<string | null>(null);
    // 连接器条默认展示，关闭后本次会话内不再显示。
    // ---- 输入框附件、选区与长文本（P0-2）----
    const selectionCount = useGlobalAgentStore((state) => (canvasId && state.canvas?.canvasId === canvasId ? state.canvas.selectedNodeIds.length : 0));
    const insertAgentFiles = useGlobalAgentStore((state) => (canvasId && state.canvas?.canvasId === canvasId ? state.canvas.insertAgentFiles : undefined));
    const insertAgentText = useGlobalAgentStore((state) => (canvasId && state.canvas?.canvasId === canvasId ? state.canvas.insertAgentText : undefined));
    const insertAgentAssets = useGlobalAgentStore((state) => (canvasId && state.canvas?.canvasId === canvasId ? state.canvas.insertAgentAssets : undefined));
    const insertAgentImageAsset = useGlobalAgentStore((state) => (canvasId && state.canvas?.canvasId === canvasId ? state.canvas.insertAgentImageAsset : undefined));
    const discardAgentNodes = useGlobalAgentStore((state) => state.canvas?.discardAgentNodes);
    const [draftAttachments, setDraftAttachments] = useState<AgentDraftAttachment[]>([]);
    const draftAttachmentsRef = useRef(draftAttachments);
    draftAttachmentsRef.current = draftAttachments;
    const seenAttachmentNodesRef = useRef(new Set<string>());
    const attachmentIdsCsv = draftAttachments.map((item) => item.nodeId).join(",");
    // 只订阅附件节点的上传状态签名：画布拖动、编辑不会让面板重渲染。
    const attachmentStatusKey = useGlobalAgentStore((state) => agentAttachmentStatusKey(state.canvas?.canvasNodes, attachmentIdsCsv));
    const attachmentStates = useMemo(() => parseAgentAttachmentStatus(attachmentStatusKey), [attachmentStatusKey]);
    const [selectionExcluded, setSelectionExcluded] = useState(false);
    const [longTextOffer, setLongTextOffer] = useState<{ text: string } | null>(null);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [dropActive, setDropActive] = useState(false);
    const dropDepthRef = useRef(0);
    const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine !== false);
    const [retryingRun, setRetryingRun] = useState(false);
    const releaseAttachmentUrls = (items: readonly AgentDraftAttachment[]) => {
        for (const item of items) if (item.objectUrl) URL.revokeObjectURL(item.url);
    };
    // 消息发出或入队：附件的引用已经写进正文，草稿里的附件、「不带选区」和长文本提示一起清掉。
    const consumeDraftAttachments = () => {
        releaseAttachmentUrls(draftAttachmentsRef.current);
        draftAttachmentsRef.current = [];
        setDraftAttachments([]);
        setSelectionExcluded(false);
        setLongTextOffer(null);
    };
    useEffect(() => {
        attachmentStates.forEach((state, id) => {
            if (state.status !== "pending") seenAttachmentNodesRef.current.add(id);
        });
    }, [attachmentStates]);
    // 离开或切换画布：附件节点留在原画布上，草稿里不再带它们。
    useEffect(() => {
        const stale = draftAttachmentsRef.current.filter((item) => item.canvasId !== canvasId);
        if (stale.length) {
            releaseAttachmentUrls(stale);
            draftAttachmentsRef.current = draftAttachmentsRef.current.filter((item) => item.canvasId === canvasId);
            setDraftAttachments(draftAttachmentsRef.current);
        }
        setSelectionExcluded(false);
        setLongTextOffer(null);
    }, [canvasId]);
    useEffect(() => () => releaseAttachmentUrls(draftAttachmentsRef.current), []);
    useEffect(() => {
        const update = () => setOnline(navigator.onLine !== false);
        window.addEventListener("online", update);
        window.addEventListener("offline", update);
        return () => {
            window.removeEventListener("online", update);
            window.removeEventListener("offline", update);
        };
    }, []);
    // ⌘/Ctrl+J：任何页面打开 Agent 并把光标放进输入框；焦点已在 Agent 里时收起。
    useEffect(() => {
        const focusComposer = (attempt = 0) => {
            const input = document.querySelector<HTMLElement>('.canvas-agent-panel [aria-label="Agent 输入"]');
            if (input) input.focus();
            else if (attempt < 10) window.setTimeout(() => focusComposer(attempt + 1), 50);
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key.toLowerCase() !== "j" || !(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey || event.isComposing) return;
            event.preventDefault();
            const store = useGlobalAgentStore.getState();
            const panel = document.querySelector(".canvas-agent-panel");
            if (store.open && panel?.contains(document.activeElement)) {
                store.closeAgent();
                return;
            }
            if (!store.open) store.openAgent();
            setView("chat");
            focusComposer();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, []);
    const panelLayout = useAgentPanelLayout(dock);
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
    useEffect(
        () => () => {
            currentScope.current = "";
            conversationLoadControllerRef.current?.abort();
        },
        [],
    );
    const running = Boolean(run?.cleanupPending) || run?.status === "running" || run?.status === "queued" || run?.status === "waiting_approval";
    const outbox = outboxStore?.conversationId === activeConversationId ? outboxStore.outbox : EMPTY_AGENT_OUTBOX;
    const outboxReady = outboxStore?.conversationId === activeConversationId;
    // 只订阅本画布的 Agent 活动。租约每次续期、保存确认都会通知；按整体版本号订阅会让面板跟着画布编辑反复重渲染。
    // agent() 在内容不变时返回同一个对象，useSyncExternalStore 据此跳过渲染。
    const canvasAgent = useSyncExternalStore(
        canvasEditLeases.subscribe,
        () => (canvasId ? (canvasEditLeases.agent(canvasId) ?? null) : null),
        () => null,
    );
    const otherAgentRunning = Boolean(canvasAgent && canvasAgent.runId !== run?.id);
    const cloudLiveState = useRef({ activeConversationId, run, prompt, messages, busy, running, approvalSubmitting, canvasId, pendingHydrated, outboxCount: outbox.items.length });
    cloudLiveState.current = { activeConversationId, run, prompt, messages, busy, running, approvalSubmitting, canvasId, pendingHydrated, outboxCount: outbox.items.length };
    const canvasCloudConversation = useMemo(() => canvasCloudAgentConversation(conversations, canvasId, canvasAgent?.runId), [conversations, canvasId, canvasAgent?.runId]);
    const canvasCloudConversationIsCurrent = Boolean(canvasCloudConversation && (canvasCloudConversation.id === activeConversationId || cloudAgentConversationServerId(canvasCloudConversation) === run?.conversationId));
    const restoredModelResolution = useMemo(() => (restoredModel ? resolveCloudAgentModel(restoredModel, selectableModelsByCapability(config, "text")) : null), [config, restoredModel]);
    const modelRestoreError = restoredModelResolution?.problem === "ambiguous" ? "原会话模型对应多个渠道，请先手动选择模型后继续。" : restoredModelResolution?.problem === "unavailable" ? "原会话模型当前不可用，请先手动选择模型后继续。" : "";
    const selectedModel = useMemo(() => {
        if (restoredModelResolution) return restoredModelResolution.model;
        const textModels = selectableModelsByCapability(config, "text");
        const preferred = config.textModel || config.model || "";
        return textModels.includes(preferred) ? preferred : textModels[0] || "";
    }, [config, restoredModelResolution]);
    const installedSkills = useMemo(() => skills.filter((skill) => skill.isAdded), [skills]);
    // 消息和输入框共用的引用表：每次渲染都新建会让全部消息重新解析 Markdown。
    const conversationReferences = useMemo(() => [...references, ...buildSkillMentionReferences(installedSkills)], [references, installedSkills]);
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
        // 服务端 queued 是等待执行资源，叫「等待启动」，与输入框的排队消息区分开。
        status === "waiting_approval"
            ? "等待审批"
            : pendingQuestion
              ? "等待回答"
              : status === "queued"
                ? "等待启动"
                : status === "running"
                  ? "运行中"
                  : status === "completed"
                    ? "已完成"
                    : status === "failed"
                      ? "异常"
                      : status === "cancelled"
                        ? "已停止"
                        : status === "rejected"
                          ? "已拒绝"
                          : "待命";
    // 状态色走语义 token（皮肤和明暗主题自动适配）；停止、拒绝、待命用次要文字色。
    const statusColor = status === "failed" ? "var(--status-error)" : status === "waiting_approval" ? "var(--status-warning)" : status === "running" || status === "queued" ? "var(--status-success)" : theme.node.muted;

    useEffect(() => {
        // 画布页卸载后预填撤回；新画布页的编号从 1 重新开始，不能被上一页的编号挡住。
        if (!prefillRequest) {
            lastPrefillIdRef.current = 0;
            return;
        }
        if (prefillRequest.id === lastPrefillIdRef.current) return;
        lastPrefillIdRef.current = prefillRequest.id;
        if (!prefillRequest.text.trim()) return;
        setView("chat");
        // 自动发送的预填直接进入队列：空闲时立即发出，运行中排在队尾，可见、可删，只发一次。
        if (prefillRequest.autoSubmit) {
            if (enqueueOutboxItem(outboxItemFromDraft(prefillRequest.text, prefillRequest))) return;
            void appMessage.warning(`排队消息已满 ${AGENT_OUTBOX_MAX_ITEMS} 条，这条已放进输入框`);
        }
        setPrompt((current) => appendAgentPromptPrefill(current, prefillRequest.displayText || prefillRequest.text));
        prefilledSubmissionRef.current = prefillRequest;
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
        setSkillCatalogReady(false);
        const refresh = () => {
            void listAddedSkills()
                .then((result) => {
                    if (!active) return;
                    setSkills(result.skills);
                    setSkillCatalogReady(true);
                    setMessages((current) => current.filter((message) => message.id !== "skills-load-error"));
                })
                .catch((cause) => {
                    if (!active) return;
                    setSkillCatalogReady(false);
                    setMessages((current) => appendAgentError(current, "skills-load-error", cause, "技能库读取失败"));
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

    // 本地对话会留着已删除技能的 ID，按当前技能库剔除，避免发送时整轮被拒。
    useEffect(() => {
        if (!skillCatalogReady) return;
        const reconciled = reconcileSkillSelection(selectedSkillIds, skills);
        if (!reconciled.removedSkillIds.length) return;
        setSelectedSkillIds(reconciled.skillIds);
        void appMessage.warning(`已取消 ${reconciled.removedSkillIds.length} 个已失效的技能：该技能已被删除或取消安装`);
    }, [appMessage, selectedSkillIds, skillCatalogReady, skills]);

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
        // 队列按账号隔离：换账号时丢掉内存里的旧队列，重新从新账号的本机存储读。
        outboxStoreRef.current = null;
        setOutboxStore(null);
        setOutboxEdit(null);
        setForceDispatchId(null);
        pendingEnqueueRef.current = [];
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
                    cancelConversationAutosave();
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
        // 后台轮询（定时、回到前台、恢复联网）不切换加载状态：每 4 秒一次的两次重渲染会让面板和画布周期性掉帧。
        const refresh = async (background = false) => {
            if (!active || refreshing || !accountIsCurrent()) return;
            refreshing = true;
            if (!background) setCloudHistoryLoading(true);
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
                const followDecision = cloudAgentFollowDecision({ current, candidate, canvasId, blocked });
                // 有排队消息时不切到别的对话：队列属于当前对话，切走会让它停在看不见的地方。同一对话的更新照常跟随。
                const decision = followDecision === "switch" && live.outboxCount > 0 ? "offer" : followDecision;
                if (!candidate?.run || (decision !== "current" && decision !== "switch")) return;
                const sameRun = candidate.id === live.activeConversationId && candidate.run.id === live.run?.id;
                if (sameRun && (candidate.lastEventSeq || 0) < lastSeqRef.current) return;
                if (sameRun && (candidate.run.revision || 0) <= (live.run?.revision || 0) && candidate.run.status === live.run?.status && Boolean(candidate.run.cleanupPending) === Boolean(live.run?.cleanupPending)) return;
                // 未知 POST 身份属于原本地对话；切换前必须先读出，不能用目录发现覆盖它。
                const pending = candidate.id === live.activeConversationId ? null : await loadCloudAgentPendingSubmission(candidate.id, accountScope);
                if (
                    !active ||
                    !accountIsCurrent() ||
                    cloudLiveState.current.activeConversationId !== live.activeConversationId ||
                    cloudLiveState.current.prompt !== live.prompt ||
                    submissionRequestRef.current ||
                    pendingSubmission.current ||
                    cloudOpeningRef.current ||
                    cloudLiveState.current.canvasId !== canvasId
                )
                    return;
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
                setApproval((previous) => (previous?.approvalId && previous.approvalId === nextApproval?.approvalId ? { ...nextApproval, reason: previous.reason } : nextApproval));
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
                    if (!background) setCloudHistoryLoading(false);
                    clearTimeout(timer);
                    // 后台标签页不轮询；回到前台由 visibilitychange 立即补一次并恢复定时。
                    timer = setTimeout(() => {
                        if (document.visibilityState !== "hidden") void refresh(true);
                    }, 4000);
                }
            }
        };
        const wake = () => {
            if (document.visibilityState !== "hidden") void refresh(true);
        };
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
                // 编辑排队消息时输入框里是那条消息，草稿是暂存的原输入。
                draft: (outboxEdit ? outboxEdit.stash : prompt) || undefined,
                model: restoredModel || selectedModel || undefined,
                permissionMode,
                skillIds: selectedSkillIds,
                createdAt: existing?.createdAt || now,
                updatedAt: now,
            };
            return [next, ...current.filter((conversation) => conversation.id !== activeConversationId)];
        });
    }, [activeConversationId, historyHydrated, pendingHydrated, messages, permissionMode, prompt, outboxEdit, run, selectedModel, restoredModel, selectedSkillIds, userId, accountScope]);

    // 本机对话缓存只用于界面恢复。输入和流式事件会高频改动对话，每次都把全部对话序列化写入
    // IndexedDB 会占满主线程；这里合并后再写，连续变化时最长 3 秒也会落一次。显式保存（发送前、删除）
    // 先取消待写的旧快照，页面隐藏或面板卸载时立即补写。
    useEffect(() => {
        if (!historyHydrated || !pendingHydrated || hydratedAccount.current !== `${userId}:${accountScope}`) return;
        const previous = conversationAutosaveRef.current;
        if (previous) clearTimeout(previous.timer);
        const since = previous?.since ?? Date.now();
        const save = () => {
            if (conversationAutosaveRef.current?.save === save) conversationAutosaveRef.current = null;
            void saveCloudAgentConversations(activeConversationId, conversations, accountScope).catch((cause) => {
                if (accountIsCurrent()) setCloudHistoryError(cause instanceof Error ? cause.message : "本机对话缓存保存失败");
            });
        };
        const delay = Math.max(0, Math.min(CONVERSATION_AUTOSAVE_DELAY_MS, since + CONVERSATION_AUTOSAVE_MAX_WAIT_MS - Date.now()));
        conversationAutosaveRef.current = { timer: setTimeout(save, delay), save, since };
    }, [activeConversationId, conversations, historyHydrated, pendingHydrated, userId, accountScope]);

    useEffect(() => {
        const flush = () => {
            const pending = conversationAutosaveRef.current;
            if (!pending) return;
            clearTimeout(pending.timer);
            pending.save();
        };
        const flushWhenHidden = () => {
            if (document.visibilityState === "hidden") flush();
        };
        window.addEventListener("pagehide", flush);
        document.addEventListener("visibilitychange", flushWhenHidden);
        return () => {
            window.removeEventListener("pagehide", flush);
            document.removeEventListener("visibilitychange", flushWhenHidden);
            flush();
        };
    }, []);

    // 读出当前对话的本机队列。读出的非空队列处于暂停（刷新不自动发起计费）；读失败时提示，不当成空队列静默吞掉。
    useEffect(() => {
        if (!historyHydrated || !userId || hydratedAccount.current !== `${userId}:${accountScope}`) return;
        const conversationId = activeConversationId;
        if (outboxStoreRef.current?.conversationId === conversationId) return;
        let active = true;
        void loadCloudAgentOutbox(conversationId, accountScope)
            .then((stored) => restoreAgentOutbox(stored))
            .catch((cause) => {
                if (active && accountIsCurrent()) void appMessage.error(`本机排队记录无法读取，其中的消息不能恢复：${cause instanceof Error ? cause.message : String(cause)}`);
                return EMPTY_AGENT_OUTBOX;
            })
            .then((restored) => {
                if (!active || !accountIsCurrent() || currentScope.current !== conversationId) return;
                let next = restored;
                const waiting = pendingEnqueueRef.current;
                pendingEnqueueRef.current = waiting.filter((entry) => entry.conversationId !== conversationId);
                for (const entry of waiting) if (entry.conversationId === conversationId) next = enqueueAgentOutboxItem(next, entry.item, { ignoreLimit: true });
                const store = { conversationId, outbox: next };
                outboxStoreRef.current = store;
                setOutboxStore(store);
                if (next !== restored) void saveCloudAgentOutbox(conversationId, next, accountScope).catch(() => undefined);
            });
        return () => {
            active = false;
        };
    }, [activeConversationId, historyHydrated, userId, accountScope]);

    // 已离开队列的条目从队列移除：插话已被服务端接收、已作为新一轮提交，或待确认提交正持有它（刷新后的重复项）。
    const sentOutboxMessageIds = useMemo(() => {
        const ids = new Set<string>();
        for (const message of messages) {
            if (message.role === "user" && message.interjection !== "sending" && message.interjection !== "withdrawn" && message.interjection !== "requeued") ids.add(message.id);
        }
        return ids;
    }, [messages]);
    useEffect(() => {
        if (!outboxReady || !pendingHydrated || !outbox.items.length) return;
        const ids = new Set(sentOutboxMessageIds);
        const pendingMessageId = pendingSubmission.current?.messageId;
        if (pendingMessageId) ids.add(pendingMessageId);
        updateOutbox(activeConversationId, (current) => reconcileAgentOutbox(current, ids));
    }, [outboxReady, pendingHydrated, sentOutboxMessageIds, outbox]);

    useEffect(() => {
        if (!escapeArmedAt) return;
        const timer = window.setTimeout(() => setEscapeArmedAt(0), AGENT_DOUBLE_ESCAPE_MS);
        return () => window.clearTimeout(timer);
    }, [escapeArmedAt]);

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
                setMessages((current) => (current.some((item) => item.id === `stream-error-${run.id}`) ? current.filter((item) => item.id !== `stream-error-${run.id}`) : current));
                setContextUsage((current) => reduceAgentContextUsage(current, event));
                applyAgentEvent(event, setMessages, setRun, setApproval);
                canvasSyncRef.current?.receive(event);
                // 采用到短剧改的是短剧数据而不是画布：刷新短剧侧栏、过期标记与制作台缓存。
                if (event.type === "tool_completed" && event.payload?.toolName === "drama_adopt_canvas_media") void appQueryClient.invalidateQueries({ queryKey: ["drama"] });
            },
            {
                after,
                onConnectionChange: (next) => {
                    if (accountIsCurrent() && currentScope.current === conversationScope && cloudRunTransitionRef.current === run.id) setConnectionStatus(next);
                },
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
        const wake = () => {
            if (document.visibilityState !== "hidden") reconnect();
        };
        window.addEventListener("online", reconnect);
        window.addEventListener("focus", wake);
        document.addEventListener("visibilitychange", wake);
        return () => {
            window.removeEventListener("online", reconnect);
            window.removeEventListener("focus", wake);
            document.removeEventListener("visibilitychange", wake);
        };
    }, [run?.id, connectionStatus, conversationScope, accountScope]);

    // ---- 本机发送队列：读写、入队、插话 ----
    const updateOutbox = (conversationId: string, updater: (current: AgentOutbox) => AgentOutbox) => {
        const store = outboxStoreRef.current;
        if (!store || store.conversationId !== conversationId) return null;
        const next = updater(store.outbox);
        if (next === store.outbox) return next;
        const nextStore = { conversationId, outbox: next };
        outboxStoreRef.current = nextStore;
        setOutboxStore(nextStore);
        void saveCloudAgentOutbox(conversationId, next, accountScope).catch((cause) => {
            if (accountIsCurrent()) void appMessage.error(cause instanceof Error ? `排队消息没能保存到本机：${cause.message}` : "排队消息没能保存到本机");
        });
        return next;
    };
    const pauseOutbox = (reason: AgentOutboxPauseReason, detail?: string) => updateOutbox(conversationScope, (current) => pauseAgentOutbox(current, reason, detail));
    const currentRunSettings = (): AgentRunSettings => ({ model: selectedModel, permissionMode, reasoningMode, skillIds: [...selectedSkillIds], contextScope: [...contextScope], maxCredits, maxGenerationTasks, maxVideoSeconds });
    // 发送时才读当前选中节点：面板只订阅选中数量，点选节点不会让对话重渲染。排队时在入队那一刻读。
    // 来自输入框的消息：附件节点排在选区前面；用户点了「不带选区」时只带附件。
    const liveFocusSnapshot = (extras?: ComposerExtras) => {
        const liveCanvas = useGlobalAgentStore.getState().canvas;
        const selectedNodeIds = canvasId && liveCanvas?.canvasId === canvasId && !extras?.excludeSelection ? liveCanvas.selectedNodeIds : EMPTY_IDS;
        return mergeAgentFocusNodeIds(extras?.attachmentNodeIds ?? EMPTY_IDS, selectedNodeIds, AGENT_FOCUS_NODE_LIMIT);
    };
    // 排队时的选区快照：出队时去掉已经不在画布上的节点。
    const outboxFocus = (item: AgentOutboxItem) => {
        const liveCanvas = useGlobalAgentStore.getState().canvas;
        const nodes = liveCanvas?.canvasId === item.canvasId ? liveCanvas.canvasNodes : undefined;
        const existing = nodes ? new Set(nodes.map((node) => node.id)) : null;
        return { focusNodeIds: existing ? item.focusNodeIds.filter((id) => existing.has(id)) : item.focusNodeIds, focusNodeOmittedCount: item.focusNodeOmittedCount };
    };
    const outboxItemFromDraft = (text: string, presentation?: CloudAgentMessagePresentation & { requiresVision?: boolean }, extras?: ComposerExtras): AgentOutboxItem => {
        const attachmentIds = extras?.attachmentNodeIds ?? EMPTY_IDS;
        return {
            id: createClientUUID(),
            text: appendAgentNodeReferences(text, attachmentIds),
            ...(presentation?.displayText ? { displayText: appendAgentNodeReferences(presentation.displayText, attachmentIds) } : {}),
            ...(presentation?.canvasReferenceNodeId ? { canvasReferenceNodeId: presentation.canvasReferenceNodeId } : {}),
            ...(presentation?.requiresVision ? { requiresVision: true } : {}),
            canvasId,
            ...liveFocusSnapshot(extras),
            settings: currentRunSettings(),
            status: "queued",
            createdAt: new Date().toISOString(),
        };
    };
    /** 加入当前对话的队列；队列满时返回 false。队列还没读出时先暂存，读出后补进去。 */
    const enqueueOutboxItem = (item: AgentOutboxItem, options: { atHead?: boolean; ignoreLimit?: boolean } = {}) => {
        const conversationId = conversationScope;
        const store = outboxStoreRef.current;
        if (!store || store.conversationId !== conversationId) {
            pendingEnqueueRef.current = [...pendingEnqueueRef.current, { conversationId, item }];
            return true;
        }
        const next = updateOutbox(conversationId, (current) => enqueueAgentOutboxItem(current, item, options));
        return Boolean(next?.items.some((entry) => entry.id === item.id));
    };
    const outboxInterjectContext = () => ({ run, connected: connectionStatus === "connected", stopping, canvasBusy: otherAgentRunning, requestPending: Boolean(pendingSubmission.current?.request) });

    // 插话：把一条消息插进当前轮（⌘/Ctrl+Enter 也先生成队列项再走这里）。messageId 取队列项 ID，
    // 超时重试时服务端按它去重；没被接收时这条留在队首，内容不丢。
    const interjectOutboxItem = async (item: AgentOutboxItem) => {
        const activeRun = run;
        const scope = conversationScope;
        if (!accountIsCurrent() || !activeRun?.id || currentScope.current !== scope || !historyHydrated) return false;
        const blocked = agentOutboxInterjectBlocker(item, outboxInterjectContext());
        if (blocked) {
            void appMessage.warning(blocked);
            return false;
        }
        const placed = updateOutbox(scope, (current) => {
            const listed = current.items.some((entry) => entry.id === item.id) ? moveAgentOutboxItemToHead(current, item.id) : enqueueAgentOutboxItem(current, item, { atHead: true, ignoreLimit: true });
            return updateAgentOutboxItem(listed, item.id, { status: "interjecting", error: undefined });
        });
        if (!placed) return false;
        // 插话引用了刚放到画布上的节点：先把画布同步到服务端，Agent 才读得到它。
        if (item.canvasId && item.canvasId === canvasId && item.text.includes("@[node:")) {
            try {
                await prepareCanvasForCloudAction(item.canvasId);
            } catch (cause) {
                if (accountIsCurrent() && currentScope.current === scope)
                    updateOutbox(scope, (current) => updateAgentOutboxItem(current, item.id, { status: "queued", error: `画布还没同步完成，稍后再插话：${cause instanceof Error ? cause.message : String(cause)}` }));
                return false;
            }
            if (!accountIsCurrent() || currentScope.current !== scope) return false;
        }
        const value = item.text;
        const messageId = agentOutboxMessageId(item.id);
        // 请求发出即显示气泡；服务端回显后变为「等待送达」，送到模型后变为「已送达」。
        setMessages((current) => appendUniqueMessage(current, { id: messageId, role: "user", text: value, interjection: "sending" }));
        let failure: unknown;
        for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
                await sendAgentInterjection(activeRun.id, { text: value, messageId });
                failure = undefined;
                break;
            } catch (cause) {
                failure = cause;
                const reason = (cause as { reason?: string }).reason;
                const retryable = reason === "agent_run_state_busy" || (reason !== "agent_interjection_run_finished" && (cause as { retryable?: boolean }).retryable === true);
                if (attempt >= 2 || !retryable) break;
                await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
                if (!accountIsCurrent() || currentScope.current !== scope) return false;
            }
        }
        if (!accountIsCurrent() || currentScope.current !== scope) return false;
        if (!failure) {
            updateOutbox(scope, (current) => removeAgentOutboxItem(current, item.id));
            setMessages((current) => current.map((entry) => (entry.id === messageId && entry.interjection === "sending" ? { ...entry, interjection: "sent" as const } : entry)));
            return true;
        }
        // 没被确认接收：撤掉「发送中」气泡。事件流若已回显，气泡已变为「等待送达」会保留，队列项由对账移除。
        setMessages((current) => current.filter((entry) => !(entry.id === messageId && entry.interjection === "sending")));
        const reason = (failure as { reason?: string }).reason;
        const status = (failure as { status?: number }).status;
        if (reason === "agent_interjection_run_finished") {
            const next = updateOutbox(scope, (current) => updateAgentOutboxItem(current, item.id, { status: "queued", error: undefined }));
            void appMessage.info(next?.paused ? "本轮已经结束，这条留在队首，继续发送后作为下一轮" : "本轮刚结束，这条留在队首，会作为下一轮发送");
            return false;
        }
        const ambiguous = status === undefined || status >= 500 || (failure as { retryable?: boolean }).retryable === true;
        const detail = ambiguous ? "插话结果未确认；如果它出现在对话里，会自动从队列移出" : `插话没有成功：${failure instanceof Error ? failure.message : String(failure)}`;
        updateOutbox(scope, (current) => updateAgentOutboxItem(current, item.id, { status: "queued", error: detail }));
        return false;
    };

    // 编辑排队消息：正文载入输入框，原草稿暂存；Enter 保存，Esc 取消并恢复草稿。编辑中这一条及其后的条目都不出队。
    const startOutboxEdit = (item: AgentOutboxItem) => {
        const scope = conversationScope;
        const store = outboxStoreRef.current;
        const target = store?.conversationId === scope ? store.outbox.items.find((entry) => entry.id === item.id) : undefined;
        if (!target || !agentOutboxItemEditable(target)) return;
        const previous = outboxEdit;
        updateOutbox(scope, (current) => updateAgentOutboxItem(previous && previous.itemId !== target.id ? updateAgentOutboxItem(current, previous.itemId, { status: "queued" }) : current, target.id, { status: "editing" }));
        setOutboxEdit({ itemId: target.id, stash: previous ? previous.stash : prompt });
        setPrompt(target.text);
    };
    const finishOutboxEdit = (save: boolean) => {
        const edit = outboxEdit;
        if (!edit) return;
        const text = prompt.trim();
        if (save && !text) return;
        if (save && agentTextLength(text) > AGENT_PROMPT_MAX_CHARS) {
            void appMessage.warning(`单条消息最多 ${AGENT_PROMPT_MAX_CHARS} 字`);
            return;
        }
        updateOutbox(conversationScope, (current) => updateAgentOutboxItem(current, edit.itemId, save ? { text, displayText: undefined, status: "queued", error: undefined } : { status: "queued" }));
        setOutboxEdit(null);
        setPrompt(edit.stash);
    };
    const removeOutboxItem = (item: AgentOutboxItem) => {
        if (outboxEdit?.itemId === item.id) {
            setPrompt(outboxEdit.stash);
            setOutboxEdit(null);
        }
        updateOutbox(conversationScope, (current) => removeAgentOutboxItem(current, item.id));
    };
    // 清空不动正在插话或发送的条目，它们由各自流程收尾。
    const clearOutbox = () => {
        if (outboxEdit) {
            setPrompt(outboxEdit.stash);
            setOutboxEdit(null);
        }
        updateOutbox(conversationScope, (current) => {
            const inFlight = current.items.filter((entry) => entry.status === "interjecting" || entry.status === "dispatching");
            return inFlight.length ? { version: 1, items: inFlight } : EMPTY_AGENT_OUTBOX;
        });
    };
    // 队列项主按钮：运行中插进当前轮；空闲时立即发送（离开了入队时的画布则改在此页面发送；Agent 提问时作为回答）。
    const runOutboxPrimary = (item: AgentOutboxItem, action: AgentOutboxPrimaryAction) => {
        if (action.disabledReason) return;
        if (action.kind === "interject") {
            void interjectOutboxItem(item);
            return;
        }
        updateOutbox(conversationScope, (current) => {
            let next = rebindAgentOutboxItem(moveAgentOutboxItemToHead(current, item.id), item.id, canvasId);
            if (item.status === "failed") next = updateAgentOutboxItem(next, item.id, { status: "queued", error: undefined });
            return next;
        });
        setForceDispatchId(item.id);
    };
    // 未送达的插话：转为下一轮（入队首，空闲时直接发），或放回队列并编辑。
    const requeueInterjection = (messageId: string, mode: "send" | "edit") => {
        const original = messages.find((entry) => entry.id === messageId);
        if (!original || original.interjection !== "undelivered" || !original.text.trim()) return;
        const item = outboxItemFromDraft(original.text);
        if (!enqueueOutboxItem(item, { atHead: true, ignoreLimit: true })) return;
        setMessages((current) => current.map((entry) => (entry.id === messageId ? { ...entry, interjection: "requeued" as const } : entry)));
        if (mode === "edit") startOutboxEdit(item);
        else setForceDispatchId(item.id);
    };

    // 撤回只作用于这句尚未送达的插话：本轮继续运行，已提交的生成任务照常完成。
    // 原话回到排队队首（不写回输入框，避免覆盖正在输入的内容），可编辑、再插话或等下一轮。
    const withdrawInterjection = async (messageId: string) => {
        const activeRun = run;
        if (!accountIsCurrent() || !activeRun?.id || withdrawingInterjectionId) return;
        const scope = conversationScope;
        const original = messages.find((item) => item.id === messageId)?.text || "";
        setWithdrawingInterjectionId(messageId);
        try {
            await withdrawAgentInterjection(activeRun.id, messageId);
            if (!accountIsCurrent() || currentScope.current !== scope) return;
            // SSE 也会推送撤回事件；这里先落本地状态，断线时界面也与服务端一致。
            setMessages((current) => current.map((item) => (item.id === messageId ? { ...item, interjection: "withdrawn" as const } : item)));
            if (original.trim()) enqueueOutboxItem(outboxItemFromDraft(original), { atHead: true, ignoreLimit: true });
        } catch (cause) {
            if (!accountIsCurrent() || currentScope.current !== scope) return;
            if ((cause as { reason?: string }).reason === "agent_interjection_already_delivered") {
                setMessages((current) => current.map((item) => (item.id === messageId && (item.interjection === "sent" || item.interjection === "sending") ? { ...item, interjection: "delivered" as const } : item)));
                void appMessage.info("这句已经送到 Agent，不能再撤回");
                return;
            }
            setMessages((current) => appendAgentError(current, `interject-withdraw-${messageId}`, cause, "插话没有撤回"));
        } finally {
            if (accountIsCurrent() && currentScope.current === scope) setWithdrawingInterjectionId(null);
        }
    };

    // 发起新一轮：输入框发送、回答提问、点选项卡片、重试待确认请求，以及队列出队都走这里。
    // 队列项带着入队时的设置快照，幂等键就是队列项 ID；其余入口用当前设置。
    const submit = async (override?: string, options?: CloudAgentMessagePresentation & { requiresVision?: boolean; outboxItem?: AgentOutboxItem; composerExtras?: ComposerExtras }): Promise<"sent" | "skipped" | "failed"> => {
        const outboxItem = options?.outboxItem;
        const composerExtras = outboxItem ? undefined : options?.composerExtras;
        if (!accountIsCurrent() || cloudOpeningRef.current || (canvasId && !cloudHistoryReady && !pendingSubmission.current?.request) || (modelRestoreError && !pendingSubmission.current?.request && !outboxItem)) return "skipped";
        const activity = canvasId ? canvasEditLeases.agent(canvasId) : null;
        if (activity && activity.runId !== run?.id && !pendingSubmission.current?.request) return "skipped";
        const draft = (outboxItem ? outboxItem.text : (override ?? prompt)).trim();
        const pendingRequest = pendingSubmission.current;
        // 待确认的提交优先：它没核对完之前，队列不能越过它发出新一轮。
        if (outboxItem && pendingRequest?.request) return "skipped";
        const prefilled = outboxItem ? null : prefilledSubmissionRef.current;
        const matchesPending = !outboxItem && Boolean(pendingRequest?.request) && (pendingRequest!.displayText?.trim() || pendingRequest!.request!.prompt) === draft;
        const matchesPrefill = !outboxItem && !matchesPending && Boolean(prefilled?.displayText) && prefilled!.displayText!.trim() === draft;
        let value = matchesPending ? pendingRequest!.request!.prompt : matchesPrefill ? prefilled!.text : draft;
        options = outboxItem
            ? { displayText: outboxItem.displayText, canvasReferenceNodeId: outboxItem.canvasReferenceNodeId, requiresVision: outboxItem.requiresVision, outboxItem }
            : matchesPending
              ? { ...options, displayText: pendingRequest!.displayText, canvasReferenceNodeId: pendingRequest!.canvasReferenceNodeId }
              : matchesPrefill
                ? prefilled!
                : options;
        // 输入框附件：节点引用补到正文末尾。原样重试待确认提交时不改正文，否则会换掉幂等身份。
        if (composerExtras?.attachmentNodeIds.length && !matchesPending) {
            value = appendAgentNodeReferences(value, composerExtras.attachmentNodeIds);
            if (options?.displayText) options = { ...options, displayText: appendAgentNodeReferences(options.displayText, composerExtras.attachmentNodeIds) };
        }
        // 正文来自输入框本身时才清空或回填输入框；提问条、选项卡片、队列不碰用户的草稿。
        const fromPrompt = !outboxItem && (override === undefined || override.trim() === prompt.trim());
        if (running && !pendingRequest?.request && !outboxItem) {
            // 运行中一律排队（输入框已按排队处理，这里兜住提问条、选项卡片等其他入口）。
            if (enqueueOutboxItem(outboxItemFromDraft(value, options, composerExtras))) {
                if (fromPrompt) {
                    setPrompt("");
                    prefilledSubmissionRef.current = null;
                    if (composerExtras) consumeDraftAttachments();
                }
            } else void appMessage.warning(`排队已满 ${AGENT_OUTBOX_MAX_ITEMS} 条，请先移出一条`);
            return "skipped";
        }
        if (!value || busy || (run && connectionStatus !== "connected" && !pendingRequest?.request) || submissionRequestRef.current || !historyHydrated || !pendingHydrated || currentScope.current !== conversationScope) return "skipped";
        const scope = conversationScope;
        submissionRequestRef.current = true;
        setBusy(true);
        if (outboxItem) updateOutbox(scope, (current) => updateAgentOutboxItem(current, outboxItem.id, { status: "dispatching", error: undefined }));
        let accepted = false;
        let requestSent = false;
        // 队列项交给待确认提交之后就由它持有（不再留在队列里），失败时按它的结果处理。
        let outboxReleased = false;
        let bubbleId: string | undefined;
        const settings = outboxItem ? outboxItem.settings : currentRunSettings();
        try {
            const effectiveModel = options?.requiresVision ? selectImageInspectionModel(config, settings.model) : settings.model;
            if (options?.requiresVision && !effectiveModel) throw new Error("当前没有配置支持图片输入的文本模型，请在模型能力设置中为一个文本模型开启图片输入后重试");
            const pending = pendingSubmission.current;
            // 目录已读到就以技能库为准，防止刷新与发送之间带出失效 ID。
            const usableSkillIds = skillCatalogReady ? reconcileSkillSelection(settings.skillIds, installedSkills).skillIds : settings.skillIds;
            // An ambiguous previous POST owns its body/key until reconciled.
            // Editing model settings or prompt must not silently create a new charge.
            if (pending?.request && pending.request.prompt !== value) throw new Error("上一条请求结果待确认，请先原样重试上一条消息，再发送新要求");
            if (!pending?.request) {
                if (profileLoading) throw new Error("正在确认长期偏好快照，请稍后再发送");
                if (!profileView || profileError) throw new Error("长期偏好快照尚未确认，请重新读取后再发送");
                const capabilities = await getAgentCapabilities();
                if (!accountIsCurrent() || currentScope.current !== scope) return "skipped";
                if (!capabilities.permissionModes.includes(settings.permissionMode)) throw new Error("当前后端不支持所选 Agent 权限，请更新后端");
                if (settings.skillIds.length && !capabilities.skills) throw new Error("当前后端尚未接入技能库");
                // 只有当前页面是画布时才绑定画布；其他页面发出的是平台级对话轮次。
                if (canvasId) await prepareCanvasForCloudAction(canvasId);
                if (!accountIsCurrent() || currentScope.current !== scope) return "skipped";
                const agentConfig = { ...config, model: effectiveModel };
                const requestConfig = resolveModelRequestConfig(agentConfig, effectiveModel);
                const logicalModelId = logicalModelIDForConfig(agentConfig);
                const focus = outboxItem ? outboxFocus(outboxItem) : liveFocusSnapshot(composerExtras);
                const input = {
                    canvasId,
                    prompt: value,
                    reasoningMode: settings.reasoningMode,
                    profileRevision: profileView.revision,
                    model: modelOptionName(effectiveModel) || undefined,
                    ...(logicalModelId ? { logicalModelId } : requestConfig.channelId ? { channelId: requestConfig.channelId, channelModelKey: modelOptionName(effectiveModel) || undefined } : {}),
                    pinnedSkillIds: [...new Set([...usableSkillIds, ...resolveSkillMentions(value, installedSkills).map((skill) => skill.skillId)])].slice(0, 16),
                    focusNodeIds: canvasId ? focus.focusNodeIds : [],
                    focusNodeOmittedCount: canvasId ? focus.focusNodeOmittedCount : 0,
                    permissionMode: settings.permissionMode,
                    contextScope: canvasId ? settings.contextScope : [],
                    budget: {
                        maxCredits: positiveNumber(settings.maxCredits),
                        maxGenerationTasks: settings.permissionMode === "read_only" ? 0 : Number(settings.maxGenerationTasks),
                        maxVideoSeconds: settings.permissionMode === "read_only" ? 0 : Number(settings.maxVideoSeconds),
                    },
                };
                const fingerprint = JSON.stringify({ scope, parent: run?.id, input });
                if (pending && pending.fingerprint !== fingerprint) throw new Error("上一条请求尚未确认，请恢复原消息与设置后核对，不能覆盖原幂等记录");
                const key = pending?.key || outboxItem?.id || createClientUUID();
                const next = { fingerprint, key, request: { ...input, idempotencyKey: key }, parentRunId: run?.id, messageId: `user-${key}`, displayText: options?.displayText, canvasReferenceNodeId: options?.canvasReferenceNodeId };
                // Persist before sending. A failed local save must not submit a request
                // whose recovery identity will disappear on reload.
                await waitForCanvasSync(saveCloudAgentPendingSubmission(activeConversationId, next, accountScope));
                if (!accountIsCurrent() || currentScope.current !== scope) return "skipped";
                pendingSubmission.current = next;
                // 先写待确认记录、再移出队列：中途刷新时两边都有，读出后按 messageId 去重，不会丢也不会重发。
                if (outboxItem) {
                    updateOutbox(scope, (current) => removeAgentOutboxItem(current, outboxItem.id));
                    outboxReleased = true;
                }
            }
            const submission = pendingSubmission.current!;
            const request = submission.request!;
            const formAnswer = parseCloudAgentFormAnswer(request.prompt);
            const userMessage: CloudAgentChatMessage = {
                id: submission.messageId || `user-${submission.key}`,
                role: "user",
                text: formAnswer ? "已确认创作方向" : submission.displayText || request.prompt,
                ...(formAnswer ? { formAnswer } : {}),
                ...(submission.canvasReferenceNodeId ? { canvasReferenceNodeId: submission.canvasReferenceNodeId } : {}),
            };
            // 以最新一次渲染的消息为底：等待能力检查和画布保存期间到达的事件不能被覆盖。
            const nextMessages = appendUniqueMessage(cloudLiveState.current.messages, userMessage);
            const now = new Date().toISOString();
            const snapshots = conversationSnapshots.current;
            const existing = snapshots.find((item) => item.id === activeConversationId);
            // Persist a discoverable conversation before POST as well as its key;
            // otherwise a reload of a brand-new chat can orphan the pending record.
            cancelConversationAutosave();
            await waitForCanvasSync(
                saveCloudAgentConversations(
                    activeConversationId,
                    [
                        {
                            ...existing,
                            id: activeConversationId,
                            title: cloudAgentConversationTitle(nextMessages),
                            messages: nextMessages,
                            run,
                            model: request.model || effectiveModel || undefined,
                            permissionMode,
                            skillIds: usableSkillIds,
                            createdAt: existing?.createdAt || now,
                            updatedAt: now,
                        },
                        ...snapshots.filter((item) => item.id !== activeConversationId),
                    ],
                    accountScope,
                ),
            );
            if (!accountIsCurrent() || currentScope.current !== scope) return "skipped";
            if (fromPrompt) {
                setPrompt("");
                prefilledSubmissionRef.current = null;
                // 失败时要判断用户是否已在等待期间输入新内容；下一次渲染前先按已清空处理。
                cloudLiveState.current = { ...cloudLiveState.current, prompt: "" };
                // 附件的引用已经写进正文；发送失败回填正文时引用仍在，节点也还在画布上。
                if (composerExtras) consumeDraftAttachments();
            }
            bubbleId = userMessage.id;
            setMessages((current) => appendUniqueMessage(current, userMessage));
            requestSent = true;
            const result = submission.parentRunId ? await sendAgentMessage(submission.parentRunId, request) : await createAgentRun(request);
            accepted = true;
            if (accountIsCurrent() && currentScope.current === scope) {
                replayCursorRef.current = { runId: result.run.id, seq: 0 };
                cloudRunTransitionRef.current = result.run.id;
                setRun(result.run);
                setConversations((current) => current.map((item) => (item.id === activeConversationId ? { ...item, serverConversationId: result.run.conversationId, run: result.run, lastEventSeq: 0 } : item)));
                // 回答了 Agent 的提问：因提问暂停的队列自动恢复，在这一轮结束后继续发送。
                updateOutbox(scope, (current) => clearAgentOutboxPause(current, "question"));
            }
            await waitForCanvasSync(clearCloudAgentPendingSubmission(activeConversationId, accountScope));
            if (accountIsCurrent() && currentScope.current === scope) pendingSubmission.current = null;
            return "sent";
        } catch (cause) {
            if (!accountIsCurrent() || currentScope.current !== scope) return "failed";
            if (cause instanceof CanvasSyncPendingError) {
                // 画布仍在同步：还没交给服务端的队列项回到队列并暂停，等用户确认后再发，不反复重试。
                if (outboxItem && !outboxReleased) updateOutbox(scope, (current) => pauseAgentOutbox(updateAgentOutboxItem(current, outboxItem.id, { status: "queued" }), "sync"));
                return "skipped";
            }
            if (canvasId) canvasEditLeases.agentRejected(canvasId, cause);
            const status = (cause as { status?: number }).status;
            const reason = (cause as { reason?: string }).reason;
            // These admission responses explicitly rejected the write.
            // stale_parent is checked after same-key replay, so even an
            // original retry has now been confirmed unaccepted. Other
            // ambiguous retries retain their original body and key.
            const definitive = !accepted && (reason === "agent_conversation_stale_parent" || (!pendingRequest?.request && (reason === "canvas_agent_busy" || Boolean(status && [400, 401, 403, 404, 422].includes(status)))));
            if (definitive) {
                try {
                    await waitForCanvasSync(clearCloudAgentPendingSubmission(activeConversationId, accountScope));
                    if (!accountIsCurrent() || currentScope.current !== scope) return "failed";
                    pendingSubmission.current = null;
                    if (reason === "canvas_agent_busy" || reason === "agent_conversation_stale_parent") setCloudRefreshEpoch((value) => value + 1);
                } catch (storageError) {
                    if (!accountIsCurrent() || currentScope.current !== scope) return "failed";
                    setMessages((current) => appendAgentError(current, `pending-storage-${activeConversationId}`, storageError, "提交记录更新失败"));
                }
            }
            // 待确认记录还持有这条请求（结果不确定）时由它负责原样重试；否则把内容放回原处：
            // 队列项回到队首并暂停；输入框为空才回填，不为空就放进队首，不覆盖用户在等待期间新输入的内容。
            const ownedByPending = !accepted && pendingSubmission.current?.request?.prompt === value;
            let errorTitle = agentSubmissionErrorTitle(cause, accepted, requestSent);
            if (!accepted && !ownedByPending) {
                // 回填到输入框的正文同时写进会话草稿：随后的云端同步按草稿恢复输入框，不能把它清掉。
                let restoredDraft: string | undefined;
                const failureText = cause instanceof Error ? cause.message : String(cause);
                const pauseDetail = reason === "agent_conversation_stale_parent" ? "对话已在别处更新，请确认最新内容" : reason === "canvas_agent_busy" ? "画布上有别的 Agent 在运行" : "消息没有发出去";
                const requeue = (item: AgentOutboxItem) => {
                    updateOutbox(scope, (current) => {
                        const listed = current.items.some((entry) => entry.id === item.id) ? current : enqueueAgentOutboxItem(current, item, { atHead: true, ignoreLimit: true });
                        return pauseAgentOutbox(updateAgentOutboxItem(listed, item.id, { status: "failed", error: failureText }), "conflict", pauseDetail);
                    });
                    errorTitle = "消息没有发出去，已放回排队队首";
                };
                if (outboxItem) {
                    // 已交给服务端判定过的键不再复用，放回队列时换一个新身份。
                    requeue(outboxReleased ? { ...outboxItem, id: createClientUUID() } : outboxItem);
                } else if (fromPrompt) {
                    if (!cloudLiveState.current.prompt.trim()) {
                        restoredDraft = options?.displayText || value;
                        setPrompt(restoredDraft);
                        if (matchesPrefill) prefilledSubmissionRef.current = prefilled;
                    } else {
                        requeue({ ...outboxItemFromDraft(value, options), settings });
                    }
                }
                if (reason === "agent_conversation_stale_parent") {
                    const correctedMessages = appendUniqueMessage(
                        cloudLiveState.current.messages.filter((item) => item.id !== bubbleId),
                        {
                            id: `stale-parent-${activeConversationId}-${run?.id || "initial"}`,
                            role: "system",
                            text: "另一端已接续新一轮，正在同步对话。内容已保留，请确认最新上下文后再发送。",
                        },
                    );
                    const corrected = conversationSnapshots.current.map((item) => (item.id === activeConversationId ? { ...item, messages: correctedMessages, ...(restoredDraft !== undefined ? { draft: restoredDraft } : {}) } : item));
                    conversationSnapshots.current = corrected;
                    setConversations(corrected);
                    setMessages(correctedMessages);
                    return "failed";
                }
                // 没被接收的气泡撤掉：消息已经回到输入框或队列，提问条也会重新出现。
                if (bubbleId) setMessages((current) => current.filter((item) => item.id !== bubbleId));
            } else if (!accepted && fromPrompt && !cloudLiveState.current.prompt.trim()) {
                // 结果不确定：输入框为空时回填，原样再发会走同一个幂等键。
                setPrompt(pendingSubmission.current?.displayText || value);
            }
            setMessages((current) => appendAgentError(current, `submit-error-${activeConversationId}`, cause, errorTitle));
            return "failed";
        } finally {
            submissionRequestRef.current = false;
            if (outboxItem && !outboxReleased) updateOutbox(scope, (current) => (current.items.some((entry) => entry.id === outboxItem.id && entry.status === "dispatching") ? updateAgentOutboxItem(current, outboxItem.id, { status: "queued" }) : current));
            if (accountIsCurrent() && currentScope.current === scope) setBusy(false);
        }
    };

    // 队首出队：本轮结束、请求空闲、连接正常、未暂停时把队首作为新一轮发出，下一条自然等这一轮结束。
    // 本轮以停止、失败、拒绝或提问结束时先暂停队列，等用户点「继续发送」；每条都是一轮新的计费。
    const dispatchOutboxHead = async () => {
        const scope = conversationScope;
        const store = outboxStoreRef.current;
        const head = store?.conversationId === scope ? store.outbox.items[0] : undefined;
        if (!head || head.status !== "queued" || outboxDispatchRef.current) return;
        outboxDispatchRef.current = true;
        if (forceDispatchId) setForceDispatchId(null);
        try {
            await submit(undefined, { outboxItem: head });
        } finally {
            outboxDispatchRef.current = false;
        }
    };
    const outboxDispatchReady = historyHydrated && pendingHydrated && outboxReady && !cloudOpeningId && Boolean(profileView) && !profileLoading && !profileError;
    const outboxDispatchBlocker = agentOutboxDispatchBlocker(outbox, {
        ready: outboxDispatchReady,
        requestInFlight: busy || Boolean(pendingSubmission.current?.request),
        run,
        connected: online && (!run || connectionStatus === "connected"),
        canvasBusy: otherAgentRunning,
        canvasId,
        canvasReady: !canvasId || cloudHistoryReady,
        forceItemId: forceDispatchId,
    });
    useEffect(() => {
        if (!outboxReady) return;
        if (run && agentRunTerminal(run.status)) {
            const key = `${run.id}:${run.status}:${pendingQuestion ? "question" : ""}`;
            if (outboxRunEndRef.current !== key) {
                outboxRunEndRef.current = key;
                const reason = agentOutboxPauseForRunEnd(run.status, Boolean(pendingQuestion));
                if (reason && outbox.items.length && !outbox.paused) {
                    pauseOutbox(reason);
                    return;
                }
            }
        }
        if (outboxDispatchBlocker !== null || outboxDispatchRef.current) return;
        void dispatchOutboxHead();
    }, [outboxReady, outbox, outboxDispatchBlocker, run?.id, run?.status, pendingQuestion]);

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
            setMessages((current) =>
                current.map((item) => {
                    const detail = item.detail as { runId?: string; callId?: string } | undefined;
                    return detail?.runId === target.runId && detail.callId === target.stepId ? { ...item, detail: { ...detail, undoStatus: "undone" } } : item;
                }),
            );
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
        // 用户主动停止：排队消息不再自动续发，等用户点「继续发送」。
        pauseOutbox("stopped");
        setEscapeArmedAt(0);
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

    // 审批卡暂时不能提交的原因。卡片据此禁用按钮并说明，不再把它显示成“正在提交”：
    // 连接断开时没有请求在路上，转圈会让人以为审批卡死了。
    const approvalBlockedReason = otherAgentRunning ? "画布上有别的 Agent 在运行，它结束后才能确认" : connectionStatus === "disconnected" ? "连接已断开，重新连接后才能确认" : connectionStatus !== "connected" ? "正在连接服务端，连上后即可确认" : undefined;

    const submitApproval = async (decision: "approve" | "reject", mediaSettings?: AgentMediaSettings) => {
        if (!run || !approval || approvalBlockedReason || approvalRequestRef.current === approval.approvalId) return;
        const runId = run.id;
        const approvalId = approval.approvalId;
        const scope = conversationScope;
        approvalRequestRef.current = approvalId;
        // 拒绝会结束本轮：排队消息暂停，不在拒绝后自动开新一轮。
        if (decision === "reject") pauseOutbox("rejected");
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
            if (cause instanceof CanvasSyncPendingError) {
                // 画布修改还没存到服务端，审批请求没有发出；卡片保留，告诉用户稍后再点。
                void appMessage.warning("画布还在保存，审批没有提交；稍后再点一次「同意执行」");
                return;
            }
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

    // 安装只进技能库，不再自动固定：已安装且允许自动使用的技能，Agent 会按任务自己查找。
    const installSkill = async (skill: Skill) => {
        if (skill.isAdded) return;
        try {
            const result = await addSkill(skill.skillId);
            setSkills((current) => [...current.filter((item) => item.skillId !== skill.skillId), result.skill]);
            setMarketSkills((current) => current.map((item) => (item.skillId === skill.skillId ? result.skill : item)));
        } catch (cause) {
            setMessages((current) => appendAgentError(current, `skill-error-${Date.now()}`, cause, "添加 Skill 失败"));
        }
    };

    const changeSkillAgentMode = async (skill: Skill, mode: SkillAgentMode) => {
        try {
            const result = await setSkillAgentMode(skill.skillId, mode);
            const nextMode = result.skill.agentMode || mode;
            setSkills((current) => current.map((item) => (item.skillId === skill.skillId ? { ...item, agentMode: nextMode } : item)));
        } catch (cause) {
            void appMessage.error(cause instanceof Error ? cause.message : "技能使用方式保存失败");
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
        // 新对话从空队列开始；原对话的排队消息留在本机，切回去时以暂停状态恢复。
        const emptyOutbox = { conversationId: id, outbox: EMPTY_AGENT_OUTBOX };
        outboxStoreRef.current = emptyOutbox;
        setOutboxStore(emptyOutbox);
        setOutboxEdit(null);
        setForceDispatchId(null);
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
        setOutboxEdit(null);
        setForceDispatchId(null);
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
            setConversations((current) => current.map((item) => (item.id === selected.id ? selected : item)));
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
            setConversations(next.map((item) => (item.id === restored.id ? restored : item)));
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
        // 本机对话删除后，它的排队消息一并清掉。
        void clearCloudAgentOutbox(id, accountScope).catch(() => undefined);
        cancelConversationAutosave();
        void saveCloudAgentConversations(id === activeConversationId ? null : activeConversationId, next, accountScope).catch((cause) => {
            if (accountIsCurrent()) setCloudHistoryError(String(cause));
        });
    };

    // ---- 输入区：发送 / 排队 / 插话 / 保存的路由与提示 ----
    const modifierEnter = agentModifierShortcut("Enter");
    const pendingNow = pendingSubmission.current;
    const pendingRetryText = pendingNow?.request ? pendingNow.displayText || pendingNow.request.prompt : "";
    const retryingPending = Boolean(pendingRetryText) && prompt.trim() === pendingRetryText.trim();
    const composerSubmitMode = agentComposerSubmitMode({
        editing: Boolean(outboxEdit),
        retryingPending,
        pendingExists: Boolean(pendingNow?.request),
        running,
        requestInFlight: busy,
        canvasBusy: otherAgentRunning,
        // 离线时也先排队：只写本机，联网后自动发出。
        disconnected: Boolean(run && connectionStatus !== "connected") || !online,
        canvasSyncing: Boolean(canvasId && !cloudHistoryReady),
    });
    // 只拦「发送新一轮」的条件（连接、画布占用、云端同步）在排队时不适用：排队只写本机，条件恢复后自动发出。
    const composerSubmitDisabled =
        composerSubmitMode === "send"
            ? (otherAgentRunning && !pendingNow?.request) ||
              Boolean(run && connectionStatus !== "connected" && !pendingNow?.request) ||
              !historyHydrated ||
              !pendingHydrated ||
              Boolean(canvasId && !cloudHistoryReady && !pendingNow?.request) ||
              Boolean(cloudOpeningId) ||
              Boolean(modelRestoreError && !pendingNow?.request)
            : !historyHydrated || !pendingHydrated || !outboxReady || Boolean(cloudOpeningId) || (composerSubmitMode === "queue" && Boolean(modelRestoreError));
    const outboxIsFull = agentOutboxFull(outbox);
    const interjectable = agentRunAcceptsInterjection(run) && connectionStatus === "connected" && !otherAgentRunning && !stopping;

    // ---- 输入框附件：图片、素材、长文本都先放到画布上，再以节点引用随消息发出 ----
    const composerAttachments: CloudAgentChatAttachment[] = draftAttachments.map((item) => {
        const state = attachmentStates.get(item.nodeId);
        const seen = seenAttachmentNodesRef.current.has(item.nodeId);
        // 占位节点没建出来就失败（failure），或节点出现过又不见了（被删除）。
        const status = state?.status === "pending" ? (item.failure && !seen ? "error" : seen ? "missing" : "pending") : (state?.status ?? "pending");
        const error = status === "error" ? state?.error || item.failure : undefined;
        const failed = status === "error" || status === "local_only" || status === "missing";
        return { id: item.nodeId, nodeId: item.nodeId, name: item.name, url: item.url, kind: item.kind, status, progress: state?.progress, error, retryable: failed && Boolean(item.file) };
    });
    const readyAttachmentIds = composerAttachments.flatMap((item) => (item.status === "ready" && item.nodeId ? [item.nodeId] : []));
    const attachmentBlockReason = composerAttachments.some((item) => item.status === "uploading" || item.status === "pending")
        ? "图片还在上传，传完再发送"
        : composerAttachments.some((item) => item.status === "error" || item.status === "local_only" || item.status === "missing")
          ? "有附件没传到服务器或已从画布删除，Agent 看不到；移除它再发送"
          : null;
    const currentComposerExtras = (): ComposerExtras => ({ attachmentNodeIds: readyAttachmentIds, excludeSelection: selectionExcluded });
    const notOnCanvasReason = "进入画布后可以添加图片和素材：它们会先放到画布上，再引用给 Agent";
    const appendDraftAttachments = (added: readonly AgentDraftAttachment[]) => {
        if (!added.length) return;
        draftAttachmentsRef.current = [...draftAttachmentsRef.current, ...added];
        setDraftAttachments(draftAttachmentsRef.current);
    };
    const appendInsertedNodes = (nodes: readonly AgentInsertedNode[]) => appendDraftAttachments(nodes.map((node) => ({ nodeId: node.nodeId, name: node.title, url: node.previewUrl || "", kind: node.kind, canvasId, createdHere: true })));
    const addComposerFiles = (input: FileList | File[] | null) => {
        const files = Array.from(input ?? []);
        if (!files.length) return;
        if (!insertAgentFiles) {
            void appMessage.warning(notOnCanvasReason);
            return;
        }
        const existing = draftAttachmentsRef.current;
        const maxBytes = Math.max(1, useUserStore.getState().runtimeLimits.resourceUploadMB || 50) * 1024 * 1024;
        const check = checkAgentAttachmentFiles(files, { existingCount: existing.length, existingKeys: new Set(existing.flatMap((item) => (item.fileKey ? [item.fileKey] : []))), maxBytes });
        if (check.problems.length) void appMessage.warning(check.problems.join("；"));
        if (!check.accepted.length) return;
        const nodeIds = insertAgentFiles(check.accepted, markAttachmentFailure);
        appendDraftAttachments(
            check.accepted.map((file, index) => ({
                nodeId: nodeIds[index],
                name: file.name || `图片${existing.length + index + 1}`,
                url: URL.createObjectURL(file),
                objectUrl: true,
                kind: "image" as const,
                canvasId,
                createdHere: true,
                fileKey: agentAttachmentFileKey(file),
                file,
            })),
        );
        if (check.hasGif) void appMessage.info("GIF 图片 Agent 只看第一帧");
    };
    // 占位节点建出来之前就失败：原因写在卡片上，可以重试或移除。
    const markAttachmentFailure = (nodeId: string, details: string) => {
        if (!draftAttachmentsRef.current.some((item) => item.nodeId === nodeId)) return;
        draftAttachmentsRef.current = draftAttachmentsRef.current.map((item) => (item.nodeId === nodeId ? { ...item, failure: details || "图片读取失败" } : item));
        setDraftAttachments(draftAttachmentsRef.current);
    };
    // 重试：换一个新节点重新上传同一个文件；失败的旧节点（这次新建、没连线的）从画布删掉，正文里的引用换成新节点。
    const retryDraftAttachment = (nodeId: string) => {
        const target = draftAttachmentsRef.current.find((item) => item.nodeId === nodeId);
        if (!target?.file || !insertAgentFiles || target.canvasId !== canvasId) return;
        const [nextId] = insertAgentFiles([target.file], markAttachmentFailure);
        if (!nextId) return;
        if (target.createdHere) discardAgentNodes?.([nodeId]);
        draftAttachmentsRef.current = draftAttachmentsRef.current.map((item) => (item.nodeId === nodeId ? { ...item, nodeId: nextId, failure: undefined, createdHere: true } : item));
        setDraftAttachments(draftAttachmentsRef.current);
        setPrompt((current) => current.split(canvasNodeMentionToken(nodeId)).join(canvasNodeMentionToken(nextId)));
    };
    const pickAssets = async (payloads: InsertAssetPayload[]) => {
        setAssetPickerOpen(false);
        if (!insertAgentAssets || !payloads.length) return;
        const room = AGENT_ATTACHMENT_MAX - draftAttachmentsRef.current.length;
        if (room <= 0) {
            void appMessage.warning(`每条消息最多 ${AGENT_ATTACHMENT_MAX} 个附件`);
            return;
        }
        if (payloads.length > room) void appMessage.warning(`每条消息最多 ${AGENT_ATTACHMENT_MAX} 个附件，只添加了前 ${room} 个`);
        try {
            appendInsertedNodes(await insertAgentAssets(payloads.slice(0, room)));
        } catch {
            // 画布已经提示了失败原因。
        }
    };
    const addDraggedAsset = async (assetId: string) => {
        if (!insertAgentImageAsset) {
            void appMessage.warning(notOnCanvasReason);
            return;
        }
        if (draftAttachmentsRef.current.length >= AGENT_ATTACHMENT_MAX) {
            void appMessage.warning(`每条消息最多 ${AGENT_ATTACHMENT_MAX} 个附件`);
            return;
        }
        const asset = useAssetStore.getState().assets.find((item) => item.id === assetId);
        const nodeId = await insertAgentImageAsset(assetId);
        if (!nodeId) {
            void appMessage.warning("素材不存在或已不可用");
            return;
        }
        appendInsertedNodes([{ nodeId, title: asset?.title || "素材图片", kind: "image", previewUrl: asset?.coverUrl }]);
    };
    const removeDraftAttachment = (nodeId: string) => {
        const target = draftAttachmentsRef.current.find((item) => item.nodeId === nodeId);
        if (!target) return;
        releaseAttachmentUrls([target]);
        draftAttachmentsRef.current = draftAttachmentsRef.current.filter((item) => item.nodeId !== nodeId);
        setDraftAttachments(draftAttachmentsRef.current);
        const token = canvasNodeMentionToken(nodeId);
        // 长文本转成的节点：原文放回正文里引用所在的位置，不丢内容。
        setPrompt((current) => (target.sourceText && current.includes(token) ? current.split(token).join(target.sourceText) : removeAgentNodeReference(current, nodeId)));
        // 这次添加时新建、还没连线的节点一起从画布删掉（进撤销栈）。
        if (target.createdHere && target.canvasId === canvasId) discardAgentNodes?.([nodeId]);
    };
    const referenceSelection = () => {
        const liveCanvas = useGlobalAgentStore.getState().canvas;
        if (!canvasId || liveCanvas?.canvasId !== canvasId || !liveCanvas.selectedNodeIds.length) return;
        setPrompt((current) => {
            const tokens = liveCanvas.selectedNodeIds
                .slice(0, 16)
                .map(canvasNodeMentionToken)
                .filter((token) => !current.includes(token));
            if (!tokens.length) return current;
            return current.trim() ? `${current.replace(/\s+$/u, "")} ${tokens.join(" ")} ` : `${tokens.join(" ")} `;
        });
    };
    const longTextVisible = Boolean(longTextOffer && insertAgentText && prompt.replace(/\r\n?/gu, "\n").includes(longTextOffer.text.replace(/\r\n?/gu, "\n").trim().slice(0, 200)));
    const convertLongText = () => {
        const offer = longTextOffer;
        if (!offer || !insertAgentText) return;
        if (draftAttachmentsRef.current.length >= AGENT_ATTACHMENT_MAX) {
            void appMessage.warning(`每条消息最多 ${AGENT_ATTACHMENT_MAX} 个附件`);
            return;
        }
        const title = `粘贴文本（${agentTextLength(offer.text).toLocaleString()} 字）`;
        const nodeId = insertAgentText(offer.text, title);
        const replaced = replaceAgentPastedText(prompt, offer.text, canvasNodeMentionToken(nodeId));
        if (replaced !== null) setPrompt(replaced);
        else void appMessage.info("已放到画布上，发送时会带上这个文本节点；没找到刚才粘贴的原文，请手动删掉");
        appendDraftAttachments([{ nodeId, name: title, url: "", kind: "text", canvasId, createdHere: true, ...(replaced !== null ? { sourceText: offer.text } : {}) }]);
        setLongTextOffer(null);
    };
    const visionMissing = composerAttachments.some((item) => item.kind === "image") && Boolean(selectedModel) && !modelSupportsImageInspection(config, selectedModel);
    const visionCandidate = visionMissing ? selectImageInspectionModel(config, selectedModel) : "";
    const contextBar =
        (canvasId && selectionCount > 0) || visionMissing || longTextVisible ? (
            <>
                {canvasId && selectionCount > 0 ? (
                    <AgentContextChip
                        tone={selectionExcluded ? "off" : "default"}
                        title="发送时会把选中的节点作为重点交给 Agent"
                        icon={<SquareDashedMousePointer className="size-3.5 shrink-0" aria-hidden="true" />}
                        actions={
                            <button
                                type="button"
                                className="agent-context-chip-action"
                                aria-pressed={selectionExcluded}
                                aria-label={selectionExcluded ? "这条消息带上选中的节点" : "这条消息不带选中的节点"}
                                onClick={() => setSelectionExcluded((value) => !value)}
                            >
                                {selectionExcluded ? "带上" : <X className="size-3" aria-hidden="true" />}
                            </button>
                        }
                    >
                        {selectionExcluded ? `这条不带选中的 ${selectionCount} 个节点` : selectionCount > AGENT_FOCUS_NODE_LIMIT ? `已选 ${selectionCount} 个节点，前 ${AGENT_FOCUS_NODE_LIMIT} 个作为重点` : `已选 ${selectionCount} 个节点`}
                    </AgentContextChip>
                ) : null}
                {visionMissing ? (
                    <AgentContextChip
                        tone="warning"
                        icon={<EyeOff className="size-3.5 shrink-0" aria-hidden="true" />}
                        actions={
                            visionCandidate ? (
                                <button type="button" className="agent-context-chip-action" onClick={() => setModel(visionCandidate)}>
                                    切换到 {modelDisplayName(config, visionCandidate)}
                                </button>
                            ) : null
                        }
                    >
                        {visionCandidate ? "当前模型不能看图" : "当前模型不能看图，请在模型能力设置里给一个文本模型开启图片输入"}
                    </AgentContextChip>
                ) : null}
                {longTextVisible && longTextOffer ? (
                    <AgentContextChip
                        icon={<FileText className="size-3.5 shrink-0" aria-hidden="true" />}
                        actions={
                            <>
                                <button type="button" className="agent-context-chip-action" onClick={convertLongText}>
                                    转为文本节点并引用
                                </button>
                                <button type="button" className="agent-context-chip-action" onClick={() => setLongTextOffer(null)}>
                                    保留原文
                                </button>
                            </>
                        }
                    >
                        粘贴了 {agentTextLength(longTextOffer.text).toLocaleString()} 字，转成画布文本节点更稳
                    </AgentContextChip>
                ) : null}
            </>
        ) : null;
    // 拖进面板：文件和素材托盘的图片都接住，面板范围内的拖放一律拦下，避免浏览器打开文件。
    const acceptsPanelDrop = (event: ReactDragEvent) => {
        const types = Array.from(event.dataTransfer.types);
        return types.includes("Files") || types.includes(CANVAS_IMAGE_ASSET_DND_TYPE);
    };
    const panelDropHandlers = {
        onDragEnter: (event: ReactDragEvent) => {
            if (!acceptsPanelDrop(event)) return;
            event.preventDefault();
            dropDepthRef.current += 1;
            setDropActive(true);
        },
        onDragOver: (event: ReactDragEvent) => {
            if (!acceptsPanelDrop(event)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = insertAgentFiles ? "copy" : "none";
        },
        onDragLeave: (event: ReactDragEvent) => {
            if (!acceptsPanelDrop(event)) return;
            dropDepthRef.current = Math.max(0, dropDepthRef.current - 1);
            if (!dropDepthRef.current) setDropActive(false);
        },
        onDrop: (event: ReactDragEvent) => {
            if (!acceptsPanelDrop(event)) return;
            event.preventDefault();
            dropDepthRef.current = 0;
            setDropActive(false);
            if (view !== "chat") return;
            const assetId = event.dataTransfer.getData(CANVAS_IMAGE_ASSET_DND_TYPE);
            if (assetId) {
                void addDraggedAsset(assetId);
                return;
            }
            addComposerFiles(Array.from(event.dataTransfer.files));
        },
    };
    // 失败的这一轮可以原样重试：新的幂等键、当前设置，会重新计费。
    const retryableErrorId = run?.status === "failed" && run.userPrompt && !running && !busy && !otherAgentRunning && !pendingNow?.request ? `terminal-${run.id}` : null;
    const retryFailedRun = async () => {
        const failed = run;
        if (!failed?.userPrompt || retryingRun) return;
        const original = messages.find((item) => item.role === "user" && item.id === `user-${failed.idempotencyKey}`);
        setRetryingRun(true);
        try {
            await submit(failed.userPrompt, {
                ...(original && original.text !== failed.userPrompt && !original.formAnswer ? { displayText: original.text } : {}),
                ...(original?.canvasReferenceNodeId ? { canvasReferenceNodeId: original.canvasReferenceNodeId } : {}),
            });
        } finally {
            setRetryingRun(false);
        }
    };

    const handleComposerSubmit = (options?: { alternate: boolean }) => {
        const alternate = Boolean(options?.alternate);
        const draft = prompt.trim();
        const extras = currentComposerExtras();
        if (!draft && !extras.attachmentNodeIds.length) return;
        if (outboxEdit) {
            finishOutboxEdit(true);
            return;
        }
        if (composerSubmitMode === "send") {
            void submit(undefined, { composerExtras: extras });
            return;
        }
        if (!outboxReady) return;
        const prefilled = prefilledSubmissionRef.current;
        const matchesPrefill = Boolean(prefilled?.displayText) && prefilled!.displayText!.trim() === draft;
        const item = matchesPrefill ? outboxItemFromDraft(prefilled!.text, prefilled!, extras) : outboxItemFromDraft(draft, undefined, extras);
        if (agentTextLength(item.text) > AGENT_PROMPT_MAX_CHARS) {
            void appMessage.warning(`单条消息最多 ${AGENT_PROMPT_MAX_CHARS} 字`);
            return;
        }
        const consumeDraft = () => {
            setPrompt("");
            if (matchesPrefill) prefilledSubmissionRef.current = null;
            consumeDraftAttachments();
        };
        if (alternate) {
            const blocked = agentOutboxInterjectBlocker(item, outboxInterjectContext());
            if (!blocked) {
                consumeDraft();
                void interjectOutboxItem(item);
                return;
            }
            if (!enqueueOutboxItem(item)) {
                void appMessage.warning(`${blocked}；排队已满 ${AGENT_OUTBOX_MAX_ITEMS} 条，先移出一条`);
                return;
            }
            consumeDraft();
            void appMessage.info(`${blocked}，已改为排队`);
            return;
        }
        if (!enqueueOutboxItem(item)) {
            void appMessage.warning(`排队已满 ${AGENT_OUTBOX_MAX_ITEMS} 条：先移出一条${interjectable ? `，或用 ${modifierEnter} 直接插话` : ""}`);
            return;
        }
        consumeDraft();
    };

    // 输入框里按 Esc：编辑排队消息时取消编辑；运行中连按两次停止本轮。
    const handleComposerEscape = () => {
        if (outboxEdit) {
            finishOutboxEdit(false);
            return;
        }
        if (!running || !run?.id || stopping || otherAgentRunning) return;
        const now = Date.now();
        if (escapeArmedAt && now - escapeArmedAt <= AGENT_DOUBLE_ESCAPE_MS) {
            void stop();
            return;
        }
        setEscapeArmedAt(now);
    };

    const outboxSubtitle =
        outboxDispatchBlocker === "run_active"
            ? run?.status === "waiting_approval"
                ? "审批完成、本轮结束后依次发送"
                : run?.cleanupPending
                  ? "本轮收尾后依次发送"
                  : "本轮结束后依次发送"
            : outboxDispatchBlocker === "request"
              ? "上一条消息确认后发送"
              : outboxDispatchBlocker === "offline"
                ? online
                    ? "连接恢复后发送"
                    : "离线，联网后继续"
                : outboxDispatchBlocker === "canvas_busy"
                  ? "画布空闲后发送"
                  : outboxDispatchBlocker === "scope_changed"
                    ? "排在另一个页面，回去后继续，或在此页面发送"
                    : outboxDispatchBlocker === "item_busy"
                      ? outbox.items[0]?.status === "editing"
                          ? "第 1 条编辑完成后继续"
                          : outbox.items[0]?.status === "failed"
                            ? "第 1 条没发出去，处理后继续"
                            : "处理中…"
                      : outboxDispatchBlocker === "not_ready"
                        ? "正在准备…"
                        : outboxDispatchBlocker === null
                          ? "正在发送…"
                          : "";

    const outboxPrimaryAction = (item: AgentOutboxItem): AgentOutboxPrimaryAction => {
        if (agentRunAcceptsInterjection(run) || stopping) return { kind: "interject", label: "插话", disabledReason: agentOutboxInterjectBlocker(item, outboxInterjectContext()) };
        const kind = pendingQuestion ? "answer" : "send";
        const label = pendingQuestion ? "作为回答发送" : item.canvasId !== canvasId ? "在此页面发送" : item.status === "failed" ? "重试" : "立即发送";
        const disabledReason = running
            ? "本轮收尾中，结束后再发"
            : busy || pendingNow?.request
              ? "上一条消息确认后再发"
              : run && connectionStatus !== "connected"
                ? "连接断开，恢复后再发"
                : otherAgentRunning
                  ? "画布上有别的 Agent 在运行"
                  : !outboxDispatchReady
                    ? "正在准备…"
                    : item.status !== "queued" && item.status !== "failed"
                      ? "正在处理"
                      : null;
        return { kind, label, disabledReason };
    };

    const outboxItemMeta = (item: AgentOutboxItem) => {
        const parts: string[] = [];
        if (item.canvasId !== canvasId) parts.push(item.canvasId ? "排在另一个画布" : "排在画布外");
        if (item.settings.model && item.settings.model !== selectedModel) parts.push(`模型：${modelDisplayName(config, item.settings.model)}`);
        if (item.settings.permissionMode !== permissionMode) parts.push(agentPermissionLabel(item.settings.permissionMode));
        if (item.focusNodeIds.length && item.canvasId === canvasId) parts.push(`带 ${item.focusNodeIds.length} 个选中节点${item.focusNodeOmittedCount ? `（另 ${item.focusNodeOmittedCount} 个超出上限）` : ""}`);
        return parts.join(" · ");
    };

    const showPendingRetry = Boolean(pendingRetryText) && !retryingPending;
    const outboxTray =
        outbox.items.length || showPendingRetry ? (
            <AgentOutboxTray
                outbox={outbox}
                references={conversationReferences}
                subtitle={outboxSubtitle}
                primaryAction={outboxPrimaryAction}
                itemMeta={outboxItemMeta}
                pendingRetry={showPendingRetry ? { text: pendingRetryText, disabled: busy || !historyHydrated || !pendingHydrated, onRetry: () => void submit(pendingRetryText) } : null}
                onPrimary={runOutboxPrimary}
                onEdit={startOutboxEdit}
                onRemove={removeOutboxItem}
                onPause={() => pauseOutbox("user")}
                onResume={() => updateOutbox(conversationScope, resumeAgentOutbox)}
                onClear={clearOutbox}
            />
        ) : null;

    return (
        <>
            <AgentLauncher theme={theme} statusColor={statusColor} approvalPending={Boolean(approval)} reducedMotion={Boolean(reducedMotion)} status={status} hidden={open} onOpen={onOpen} />
            <AnimatePresence>
                {open ? (
                    <motion.aside
                        initial={reducedMotion ? { opacity: 0 } : dock.active ? { opacity: 0, x: 24 } : { opacity: 0, y: 20, scale: 0.975 }}
                        animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
                        exit={reducedMotion ? { opacity: 0 } : dock.active ? { opacity: 0, x: 24 } : { opacity: 0, y: 12, scale: 0.985 }}
                        transition={{ duration: reducedMotion ? 0 : 0.26, ease: [0.16, 1, 0.3, 1] }}
                        className={`canvas-agent-panel fixed z-[calc(var(--z-toast)+1)] flex min-w-0 flex-col overflow-hidden${dock.active ? " is-docked" : ""}`}
                        style={
                            { ...panelLayout.style, "--agent-surface-base": theme.node.panel, "--agent-ink": theme.node.text, "--agent-accent": theme.accent.primary, "--agent-shadow-color": theme.spatial.shadow } as CSSProperties &
                                Record<`--${string}`, string>
                        }
                        aria-label="Agent 工作台"
                        data-popover-anchor-container
                        data-canvas-no-zoom
                        data-canvas-wheel-scroll
                        {...panelLayout.pointerHandlers}
                        {...panelDropHandlers}
                        onWheel={(event) => event.stopPropagation()}
                    >
                        {dropActive ? (
                            <div className="agent-drop-overlay" aria-hidden="true">
                                <ImagePlus className="size-5" />
                                <span>{insertAgentFiles ? "松开以添加到对话：图片会放到画布上，再引用给 Agent" : "进入画布后才能添加图片"}</span>
                            </div>
                        ) : null}
                        {dock.active ? (
                            // 停靠时只保留左边缘：拖动或用左右方向键调宽，画布同步让出空间。
                            <div
                                role="separator"
                                tabIndex={0}
                                aria-orientation="vertical"
                                aria-label="调整 Agent 面板宽度"
                                aria-valuenow={dock.width}
                                aria-valuemin={dock.bounds.min}
                                aria-valuemax={dock.bounds.max}
                                title="拖动调整宽度，也可用左右方向键调整"
                                data-agent-resize="dock"
                                className="agent-panel-dock-resizer"
                                onKeyDown={panelLayout.onResizeKeyDown}
                            />
                        ) : (
                            <>
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
                            </>
                        )}
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
                                        onCollapse={onCollapse}
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
                                        onSkillAgentModeChange={changeSkillAgentMode}
                                        onOpenSkillRecommendations={() => setSkillRecommendationsOpen(true)}
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
                                        onOpen={(conversation) => void openConversation(conversation)}
                                        onDelete={deleteConversation}
                                        loading={cloudHistoryLoading}
                                        error={cloudHistoryError}
                                        openingId={cloudOpeningId}
                                        onRefresh={() => setCloudRefreshEpoch((value) => value + 1)}
                                        onCollapse={onCollapse}
                                    />
                                </motion.div>
                            ) : (
                                <motion.div key="chat" className="flex min-h-0 flex-1 flex-col" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: reducedMotion ? 0 : 0.18 }}>
                                    <AgentHeader
                                        theme={theme}
                                        hasMessages={messages.length > 0}
                                        statusLabel={statusLabel}
                                        statusColor={statusColor}
                                        live={running}
                                        conversationTitle={conversations.find((conversation) => conversation.id === activeConversationId)?.title}
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
                                        docked={dock.active}
                                        onToggleDock={dock.available ? () => setDocked(!dock.active) : undefined}
                                        onCollapse={onCollapse}
                                    />
                                    {cloudHistoryError || (canvasId && !cloudHistoryReady) ? (
                                        <div role="status" className="flex items-center justify-between gap-2 px-5 py-2 text-xs" style={{ color: theme.node.muted }}>
                                            <span>{cloudHistoryError ? "云端对话暂时未同步，本机草稿已保留。" : "正在同步此画布的云端对话…"}</span>
                                            {cloudHistoryError ? (
                                                <Button size="small" loading={cloudHistoryLoading} onClick={() => setCloudRefreshEpoch((value) => value + 1)}>
                                                    重新同步
                                                </Button>
                                            ) : null}
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
                                        nodeCount={canvasId ? nodeCount : null}
                                        onChooseSkill={() => setSkillsOpen(true)}
                                        onDraftPrompt={historyHydrated && pendingHydrated && !cloudOpeningId && (!canvasId || cloudHistoryReady) ? (draft) => setPrompt((current) => (current.trim() ? `${current}\n\n${draft}` : draft)) : undefined}
                                        onFocusNode={onFocusNode}
                                        onUndo={busy || running || otherAgentRunning ? undefined : (target) => void undoCanvasStep(target)}
                                        undoStates={undoStates}
                                        references={conversationReferences}
                                        busy={busy || running}
                                        activity={stopping ? "stopping" : busy ? "submitting" : status === "queued" ? "queued" : "running"}
                                        approval={approval}
                                        approvalTargetGenerating={approvalTargetGenerating}
                                        approvalSubmitting={approvalSubmitting}
                                        approvalBlockedReason={approvalBlockedReason}
                                        onApprovalReasonChange={(reason) => setApproval((current) => (current ? { ...current, reason } : current))}
                                        onApprove={(settings) => void submitApproval("approve", settings)}
                                        onReject={() => void submitApproval("reject")}
                                        onWithdrawInterjection={running && !otherAgentRunning && connectionStatus === "connected" ? (messageId) => void withdrawInterjection(messageId) : undefined}
                                        withdrawingInterjectionId={withdrawingInterjectionId}
                                        onRequeueInterjection={outboxReady && !otherAgentRunning ? requeueInterjection : undefined}
                                        retryableErrorId={retryableErrorId}
                                        onRetryRun={retryableErrorId ? () => void retryFailedRun() : undefined}
                                        retryingRun={retryingRun}
                                        // ask_user 提问条在输入区上方时不再重复出选项卡片。
                                        onReplyOption={pendingQuestion ? undefined : (text) => void submit(text)}
                                        replyOptionsDisabled={
                                            otherAgentRunning ||
                                            Boolean(pendingSubmission.current?.request) ||
                                            Boolean(run && connectionStatus !== "connected") ||
                                            !historyHydrated ||
                                            !pendingHydrated ||
                                            Boolean(canvasId && !cloudHistoryReady) ||
                                            Boolean(cloudOpeningId) ||
                                            Boolean(modelRestoreError)
                                        }
                                    />
                                    {canvasCloudConversation && !canvasCloudConversationIsCurrent ? (
                                        <div role="status" className="flex items-center justify-between gap-2 px-5 py-2 text-xs" style={{ color: theme.node.muted }}>
                                            <span>此画布有可接续的云端对话。{prompt.trim() ? "未发送内容会保留在原对话。" : "手机、电脑可查看同一进度。"}</span>
                                            <Button
                                                size="small"
                                                loading={cloudOpeningId === canvasCloudConversation.id}
                                                disabled={busy || running || !pendingHydrated || Boolean(pendingSubmission.current) || Boolean(cloudOpeningId)}
                                                onClick={() => void openConversation(canvasCloudConversation)}
                                            >
                                                接续此画布对话
                                            </Button>
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
                                    {mediaBatch && mediaBatch.phase !== "approval" ? <AgentMediaBatchBar batch={mediaBatch} theme={theme} onFocusNode={onFocusNode} /> : null}
                                    {pendingQuestion ? (
                                        <AgentQuestionBar
                                            question={pendingQuestion}
                                            theme={theme}
                                            disabled={otherAgentRunning || approvalSubmitting || connectionStatus !== "connected"}
                                            onAnswer={(label) => void submit(label)}
                                            onRecordDecision={insertAgentMarkdown ? (record) => insertAgentMarkdown(record.markdown, record.title) : undefined}
                                        />
                                    ) : null}
                                    {historyHydrated && !pendingHydrated ? (
                                        <div className="flex items-center gap-2 px-5 py-2 text-xs" role="status">
                                            <span>提交记录尚未确认，输入保留；画布可继续编辑。</span>
                                            <Button size="small" onClick={() => setHistoryRestoreAttempt((attempt) => attempt + 1)}>
                                                重新读取记录
                                            </Button>
                                        </div>
                                    ) : null}
                                    {modelRestoreError ? (
                                        <div className="px-5 py-2 text-xs" role="status" style={{ color: theme.node.muted }}>
                                            {modelRestoreError}
                                        </div>
                                    ) : null}
                                    <AgentChatComposer
                                        prompt={prompt}
                                        submitDisabled={composerSubmitDisabled}
                                        submitMode={composerSubmitMode}
                                        primaryDisabled={composerSubmitMode === "queue" && outboxIsFull}
                                        sending={busy}
                                        running={running}
                                        placeholder={canvasId ? "说说要做什么，@ 引用节点，/ 或 、 引用技能，可粘贴图片" : "说说要做什么，/ 或 、 引用技能；进入画布后可引用节点和图片"}
                                        theme={theme}
                                        onPromptChange={setPrompt}
                                        onSubmit={handleComposerSubmit}
                                        onEscape={handleComposerEscape}
                                        tray={outboxTray}
                                        attachments={composerAttachments}
                                        onAddFiles={addComposerFiles}
                                        onRemoveAttachment={removeDraftAttachment}
                                        onRetryAttachment={retryDraftAttachment}
                                        addMenu={{
                                            disabledReason: insertAgentFiles ? null : notOnCanvasReason,
                                            onPickAssets: insertAgentAssets ? () => setAssetPickerOpen(true) : undefined,
                                            selectionCount,
                                            onReferenceSelection: referenceSelection,
                                        }}
                                        contextBar={contextBar}
                                        charLimit={AGENT_PROMPT_MAX_CHARS}
                                        blockReason={attachmentBlockReason}
                                        onLongTextPaste={insertAgentText ? (text) => setLongTextOffer({ text }) : undefined}
                                        onStop={!otherAgentRunning && run?.id && running ? stop : undefined}
                                        stopping={stopping}
                                        references={conversationReferences}
                                        slashSkills={installedSkills}
                                        includeAssetLibrary={false}
                                        submitAccessory={<AgentContextRing view={presentAgentContextUsage(contextUsage)} theme={theme} />}
                                        left={
                                            <ComposerControls
                                                config={config}
                                                selectedModel={selectedModel}
                                                permissionMode={permissionMode}
                                                theme={theme}
                                                onModelChange={setModel}
                                                onPermissionChange={setPermissionMode}
                                                reasoningMode={reasoningMode}
                                                onReasoningModeChange={setReasoningMode}
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
            {assetPickerOpen ? (
                <Suspense fallback={null}>
                    <AgentAssetPickerModal open multiple onInsert={pickAssets} onClose={() => setAssetPickerOpen(false)} />
                </Suspense>
            ) : null}
            <CanvasAgentSkillLibraryModal
                curationState={curationState}
                platformCategory={platformCategory}
                onPlatformCategoryChange={(value) => {
                    setPlatformCategory(value);
                    setSkillTag("all");
                }}
                open={skillsOpen}
                theme={theme}
                presets={
                    skillsOpen && sceneBuckets.some((bucket) => bucket.presets.length || bucket.skills.length) ? (
                        <div className="agent-skill-presets" style={{ "--agent-ink": theme.node.text, "--agent-caption": theme.node.muted, "--agent-focus-ring": theme.accent.primary } as CSSProperties}>
                            <AgentSceneCapsules
                                buckets={sceneBuckets}
                                installedIds={installedSkillIds}
                                theme={theme}
                                disabled={otherAgentRunning || busy || running || !historyHydrated || !pendingHydrated || Boolean(presetApplyingId)}
                                onPick={(preset) => void applyScenePreset(preset)}
                                onPickSkill={(skill) => void applySingleSkill(skill)}
                            />
                        </div>
                    ) : null
                }
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
            {/* 安装结果通过 canvas-skills-changed 事件刷新技能库，这里不重复拉取。 */}
            <SkillRecommendationsModal open={skillRecommendationsOpen} onClose={() => setSkillRecommendationsOpen(false)} />
        </>
    );
});
