import { useEffect, useMemo, useRef, useState } from "react";
import copyToClipboard from "copy-to-clipboard";
import { Copy, Cpu, History, MessageSquareText, Plus, ScrollText, Settings2, Trash2, X } from "lucide-react";
import { Button, Modal, Segmented, Select, Tooltip } from "antd";
import { motion } from "motion/react";

import { modelDisplayName, modelIcon, normalizeModelOptionValue, resolveModelChannel, resolveModelRequestConfig, selectableModelsByCapability, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { canvasThemes } from "@/lib/canvas-theme";
import { nanoid } from "nanoid";
import { requestToolResponse, type ResponseFunctionTool, type ResponseInputMessage, type ResponseToolCall } from "@/services/api/image";
import { backendModelRuntimeRequired, runBackendToolGenerationTask } from "@/services/api/generation-task";
import { buildCanvasAgentContext, findCanvasAgentNodes, getCanvasAgentResources, validateCanvasAgentOps } from "@/lib/canvas/canvas-agent-context";
import { imageToDataUrl } from "@/services/image-storage";
import { isCanvasGenerationDurableAckError, persistCanvasCinematicSessionContinuationEffect } from "@/services/canvas-generation-consumer";
import { consumeGenerationTaskAgent } from "@/services/project-asset-sync";
import { applyGenerationConsumerEffect, generationEffectApplied } from "@/services/generation-consumer-dedupe";
import { activeGenerationConsumerController } from "@/services/generation-consumer-lifecycle";
import { useAssetStore } from "@/stores/use-asset-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { navigateToSettings } from "@/lib/settings-navigation";
import { cinematicAgentSessionOpsJson, createCinematicAgentSession, isAgentSessionPollingAbort, resumeCinematicAgentSession } from "@/lib/canvas/canvas-agent-session";
import { summarizeCanvasContext } from "@/lib/canvas/canvas-context-summary";
import { AgentChatComposer, AgentChatMessage, AgentPanelTabs, AgentWorkingMessage, type CanvasAgentChatMessage, type CanvasAgentMode } from "./canvas-agent-chat-ui";
import { VoiceRecordingButton } from "@/components/conversation/voice-recording-button";
import { ModelLogo } from "@/components/model-logo";
import { AgentChatEmptyState, AgentPanelChrome } from "./canvas-agent-panel-chrome";
import { CanvasLocalAgentPanel } from "./canvas-local-agent-panel";
import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { CanvasNodeType, type CanvasAssistantMessage, type CanvasAssistantPendingBackendSession, type CanvasAssistantReference, type CanvasAssistantSession, type CanvasNodeData } from "@/types/canvas";
import { useCanvasAgentStore } from "@/stores/canvas/use-canvas-agent-store";
import { previewCanvasAgentOps, summarizeCanvasAgentOps, type CanvasAgentOp, type CanvasAgentOperationImpact, type CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { canvasAgentPromptCacheKey } from "@/lib/openai-prompt-cache";
import { resolveStoryboardGenerationContext } from "@/lib/canvas/canvas-storyboard-context";
import { ONLINE_AGENT_MAX_STEPS, ONLINE_AGENT_PROMPT, ONLINE_AGENT_TOOLS, ONLINE_READ_TOOLS } from "@/components/canvas/canvas-online-agent-protocol";
import { useTranslation } from "react-i18next";
import { t } from "@/i18n";

export const CANVAS_AGENT_PANEL_MOTION_MS = 500;
const PANEL_MOTION_SECONDS = CANVAS_AGENT_PANEL_MOTION_MS / 1000;
type OnlineAgentTab = "setup" | "chat" | "history" | "log";
type OnlineAgentLog = { id: string; time: string; title: string; data?: unknown };
type OnlineAgentLogContext = { model: string; running: boolean; confirmTools: boolean; messages: number; nodes: number; connections: number };
type OnlineLoopContext = { step: number };
type OnlineToolResult = { ok: true; message: string; data?: unknown } | { ok: false; message: string };
type OnlineExecutedToolCall = { toolCallId: string; name: string; result: OnlineToolResult };
type PendingOnlineToolContext = { messages: ResponseInputMessage[]; toolCalls: ResponseToolCall[]; assistantId: string; step: number };

type CanvasAssistantPanelProps = {
    nodes: CanvasNodeData[];
    selectedNodeIds: Set<string>;
    snapshot: CanvasAgentSnapshot;
    projectId: string;
    sessions: CanvasAssistantSession[];
    activeSessionId: string | null;
    onSelectNodeIds: (ids: Set<string>) => void;
    onSessionsChange: (sessions: CanvasAssistantSession[], activeSessionId: string | null) => void;
    onApplyOps: (ops?: CanvasAgentOp[], context?: { conversationId?: string; messageId?: string; source?: "online" | "local" }) => Promise<CanvasAgentSnapshot>;
    canUndoOps: boolean;
    undoOpsCount: number;
    onUndoOps: () => CanvasAgentSnapshot | null;
    onPasteImage: (file: File) => void;
    agentMode: CanvasAgentMode;
    onAgentModeChange: (mode: CanvasAgentMode) => void;
    autoConnectLocal?: boolean;
    closing: boolean;
    onCollapse: () => void;
    cinematicEntry?: boolean;
    onCinematicEntryConsumed?: () => void;
    resizing?: boolean;
};

export type CinematicContinuationFailureDisposition = "abort" | "durable-ack" | "provider-failed";

type CinematicContinuationLiveSessionState = { sessions: CanvasAssistantSession[]; activeChatId: string | null };

type CanvasCinematicContinuationBoundaryInput<T> = {
    projectId: string;
    effectKey?: string;
    signal?: AbortSignal;
    readSnapshot: () => CanvasAgentSnapshot;
    executeOps: () => Promise<T>;
    completeSession: (effectKey?: string) => CanvasAssistantSession[];
    readLiveSessionState: () => CinematicContinuationLiveSessionState;
    restoreLiveSessions: (sessions: CanvasAssistantSession[], activeChatId: string | null) => void;
    restoreLiveSnapshot: (state: Pick<CanvasAgentSnapshot, "nodes" | "connections">) => void;
    failProvider: (error: unknown) => void;
    onFailureDisposition?: (disposition: CinematicContinuationFailureDisposition, error: unknown) => void;
    persistContinuation?: typeof persistCanvasCinematicSessionContinuationEffect;
};

export function handleCinematicContinuationFailure(error: unknown, failProvider: (error: unknown) => void): CinematicContinuationFailureDisposition {
    if (isAgentSessionPollingAbort(error)) return "abort";
    if (isCanvasGenerationDurableAckError(error)) return "durable-ack";
    failProvider(error);
    return "provider-failed";
}

export async function runCanvasCinematicContinuationBoundary<T>(input: CanvasCinematicContinuationBoundaryInput<T>) {
    const previousSnapshot = input.readSnapshot();
    const previousSessionState = input.readLiveSessionState();
    try {
        if (input.signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
        const result = await input.executeOps();
        const attemptedSnapshot = input.readSnapshot();
        input.completeSession(input.effectKey);
        const attemptedSessionState = input.readLiveSessionState();
        if (input.effectKey) {
            await (input.persistContinuation ?? persistCanvasCinematicSessionContinuationEffect)({
                projectId: input.projectId,
                effectKey: input.effectKey,
                previousNodes: previousSnapshot.nodes,
                nodes: attemptedSnapshot.nodes,
                previousConnections: previousSnapshot.connections,
                connections: attemptedSnapshot.connections,
                previousChatSessions: previousSessionState.sessions,
                chatSessions: attemptedSessionState.sessions,
                previousActiveChatId: previousSessionState.activeChatId,
                activeChatId: attemptedSessionState.activeChatId,
                signal: input.signal,
                readLiveSessionState: input.readLiveSessionState,
                restoreLiveSessions: input.restoreLiveSessions,
                restoreLiveSnapshot: input.restoreLiveSnapshot,
            });
        }
        return result;
    } catch (error) {
        const disposition = handleCinematicContinuationFailure(error, input.failProvider);
        input.onFailureDisposition?.(disposition, error);
        throw error;
    }
}

export const canvasCinematicContinuationEntryAdapters = {
    "online-tool": runCanvasCinematicContinuationBoundary,
    "submit-cinematic": runCanvasCinematicContinuationBoundary,
    "resume-cinematic": runCanvasCinematicContinuationBoundary,
} as const;

export function CanvasAssistantPanel({
    nodes,
    selectedNodeIds,
    snapshot,
    projectId,
    sessions,
    activeSessionId,
    onSelectNodeIds,
    onSessionsChange,
    onApplyOps,
    canUndoOps,
    undoOpsCount,
    onUndoOps,
    onPasteImage,
    agentMode,
    onAgentModeChange,
    autoConnectLocal,
    closing,
    onCollapse,
    cinematicEntry = false,
    onCinematicEntryConsumed,
    resizing = false,
}: CanvasAssistantPanelProps) {
    const { t } = useTranslation("canvas");
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const user = useUserStore((state) => state.user);
    const effectiveConfig = useEffectiveConfig();
    const cleanupImages = useAssetStore((state) => state.cleanupImages);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const confirmTools = useCanvasAgentStore((state) => state.confirmTools);
    const setAgentState = useCanvasAgentStore((state) => state.setAgentState);
    const [view, setView] = useState<OnlineAgentTab>("chat");
    const [prompt, setPrompt] = useState("");
    const [cinematicEntryActive, setCinematicEntryActive] = useState(cinematicEntry);
    const [isRunning, setIsRunning] = useState(false);
    const [deleteChatIds, setDeleteChatIds] = useState<string[]>([]);
    const [onlineLogs, setOnlineLogs] = useState<OnlineAgentLog[]>([]);
    const [removedReferenceIds, setRemovedReferenceIds] = useState<Set<string>>(new Set());
    const [localSessions, setLocalSessions] = useState<CanvasAssistantSession[]>(() => (sessions.length ? sessions : [createSession(t("canvas:new-conversation-2"))]));
    const localSessionsRef = useRef(localSessions);
    const [localActiveSessionId, setLocalActiveSessionIdState] = useState<string | null>(activeSessionId);
    const localActiveSessionIdRef = useRef(localActiveSessionId);
    const setLocalActiveSessionId = (activeId: string | null) => {
        localActiveSessionIdRef.current = activeId;
        setLocalActiveSessionIdState(activeId);
    };
    const applyingExternalSessionsRef = useRef(false);
    const chatListRef = useRef<HTMLDivElement>(null);
    const snapshotRef = useRef(snapshot);
    const pendingToolContextRef = useRef(new Map<string, PendingOnlineToolContext>());
    const cinematicSessionControllersRef = useRef(new Map<string, AbortController>());
    const generationConsumerControllerRef = useRef(new AbortController());

    useEffect(() => {
        if (!sessions.length) return;
        if (sessions === localSessions && activeSessionId === localActiveSessionId) return;
        applyingExternalSessionsRef.current = true;
        localSessionsRef.current = sessions;
        setLocalSessions(sessions);
        setLocalActiveSessionId(activeSessionId);
    }, [activeSessionId, sessions]);

    useEffect(() => {
        snapshotRef.current = snapshot;
    }, [snapshot]);

    useEffect(() => {
        generationConsumerControllerRef.current = activeGenerationConsumerController(generationConsumerControllerRef.current);
        return () => {
            // 收起面板或刷新页面时只停止前端查询，后台任务由下次挂载根据持久化 ID 继续接管。
            cinematicSessionControllersRef.current.forEach((controller) => controller.abort());
            cinematicSessionControllersRef.current.clear();
            generationConsumerControllerRef.current.abort();
        };
    }, []);

    useEffect(() => {
        if (applyingExternalSessionsRef.current) {
            applyingExternalSessionsRef.current = false;
            return;
        }
        if (sessions === localSessions && activeSessionId === localActiveSessionId) return;
        onSessionsChange(localSessions, localActiveSessionId);
    }, [activeSessionId, localActiveSessionId, localSessions, onSessionsChange, sessions]);

    const safeSessions = localSessions.length ? localSessions : [createSession(t("canvas:new-conversation-2"))];
    const activeSession = useMemo(() => safeSessions.find((session) => session.id === localActiveSessionId) || safeSessions[0] || null, [localActiveSessionId, safeSessions]);
    const historySessions = safeSessions.filter((session) => session.messages.length > 0);
    const messages = activeSession?.messages || [];
    const hasMessages = messages.length > 0;
    const agentBusy = isRunning || safeSessions.some((session) => session.pendingBackendSession?.status === "pending");
    const activeModel = effectiveConfig.textModel || effectiveConfig.model;
    const activeModelName = activeModel ? modelDisplayName(effectiveConfig, activeModel) : "";
    const selectedNodeKey = useMemo(() => Array.from(selectedNodeIds).sort().join(","), [selectedNodeIds]);
    const allSelectedReferences = useMemo(() => buildAssistantReferences(nodes, selectedNodeIds), [nodes, selectedNodeIds]);
    const selectedReferences = useMemo(() => allSelectedReferences.filter((item) => !removedReferenceIds.has(item.id)), [allSelectedReferences, removedReferenceIds]);
    const contextSummary = useMemo(() => summarizeCanvasContext(nodes, selectedNodeIds), [nodes, selectedNodeIds]);
    const iconButtonStyle = { color: theme.node.muted };

    useEffect(() => {
        if (agentMode !== "online" || view !== "chat") return;
        const frame = requestAnimationFrame(() => chatListRef.current?.scrollTo({ top: chatListRef.current.scrollHeight }));
        return () => cancelAnimationFrame(frame);
    }, [agentBusy, agentMode, localActiveSessionId, messages, view]);

    useEffect(() => {
        setRemovedReferenceIds(new Set());
    }, [selectedNodeKey]);

    const updateSession = (sessionId: string, updater: (session: CanvasAssistantSession) => CanvasAssistantSession) => {
        const next = localSessionsRef.current.map((session) => (session.id === sessionId ? updater(session) : session));
        localSessionsRef.current = next;
        setLocalSessions(next);
        return next;
    };

    const readCinematicSessionState = (): CinematicContinuationLiveSessionState => ({ sessions: localSessionsRef.current, activeChatId: localActiveSessionIdRef.current });

    const restoreCinematicSessions = (sessions: CanvasAssistantSession[], activeId: string | null) => {
        localSessionsRef.current = sessions;
        setLocalSessions(sessions);
        setLocalActiveSessionId(activeId);
    };
    const restoreCinematicSnapshot = (state: Pick<CanvasAgentSnapshot, "nodes" | "connections">) => {
        snapshotRef.current = { ...snapshotRef.current, nodes: state.nodes, connections: state.connections };
    };

    const hasAgentGenerationEffect = (sessionId: string, effectKey?: string) => {
        const session = localSessionsRef.current.find((candidate) => candidate.id === sessionId);
        return Boolean(session && generationEffectApplied(session, effectKey));
    };

    const appendMessage = (sessionId: string, message: CanvasAssistantMessage) => {
        updateSession(sessionId, (session) => ({
            ...session,
            title: session.messages.length ? session.title : message.text.slice(0, 18) || t("canvas:new-conversation-2"),
            messages: [...session.messages, message],
            updatedAt: new Date().toISOString(),
        }));
    };
    const addOnlineLog = (title: string, data?: unknown) => setOnlineLogs((prev) => [{ id: nanoid(), time: new Date().toLocaleTimeString(), title, data }, ...prev].slice(0, 80));

    const upsertMessage = (sessionId: string, message: CanvasAssistantMessage) => {
        updateSession(sessionId, (session) => {
            const exists = session.messages.some((item) => item.id === message.id);
            return {
                ...session,
                title: session.messages.length ? session.title : message.text.slice(0, 18) || t("canvas:new-conversation-2"),
                messages: exists ? session.messages.map((item) => (item.id === message.id ? { ...item, ...message } : item)) : [...session.messages, message],
                updatedAt: new Date().toISOString(),
            };
        });
    };

    const setPendingCinematicSession = (sessionId: string, backendSessionId: string) => {
        const startedAt = new Date().toISOString();
        const pending: CanvasAssistantPendingBackendSession = {
            id: backendSessionId,
            kind: "cinematic",
            messageId: cinematicSessionMessageId(backendSessionId),
            status: "pending",
            startedAt,
        };
        updateSession(sessionId, (session) => ({
            ...session,
            pendingBackendSession: pending,
            messages: upsertAssistantMessage(session.messages, {
                id: pending.messageId,
                role: "assistant",
                title: t("domain:film-project-generating"),
                text: t("domain:the-backend-film-agent-is-processing-even-after-a-page-refresh-it-keeps"),
                detail: { kind: "cinematic", backendSessionId, status: "pending", startedAt },
            }),
            updatedAt: startedAt,
        }));
    };

    const completeCinematicSession = (sessionId: string, backendSessionId: string, ops: CanvasAgentOp[], recovered = false, effectKey?: string) => {
        return updateSession(sessionId, (session) => {
            const pending = session.pendingBackendSession;
            if (pending?.id !== backendSessionId) return session;
            const completedAt = new Date().toISOString();
            const summary = summarizeCanvasAgentOps(ops) || t("domain:film-project-written-back-to-this-canvas");
            const completed = {
                ...session,
                pendingBackendSession: undefined,
                messages: upsertAssistantMessage(session.messages, {
                    id: pending.messageId,
                    role: "assistant",
                    title: recovered ? t("domain:film-project-restored-and-written-back") : t("domain:film-project-written-back"),
                    text: recovered ? t("domain:background-results-restored-after-reconnection-param", { summary: summary }) : summary,
                    detail: { kind: "cinematic", backendSessionId, status: "completed", recovered, completedAt },
                }),
                updatedAt: completedAt,
            };
            return effectKey ? applyGenerationConsumerEffect(completed, effectKey, (current) => current).value : completed;
        });
    };

    const failCinematicSession = (sessionId: string, backendSessionId: string, error: unknown) => {
        updateSession(sessionId, (session) => {
            const pending = session.pendingBackendSession;
            if (pending?.id !== backendSessionId) return session;
            const failedAt = new Date().toISOString();
            const text = error instanceof Error ? error.message : t("domain:film-project-generation-failed");
            return {
                ...session,
                pendingBackendSession: undefined,
                messages: upsertAssistantMessage(session.messages, {
                    id: pending.messageId,
                    role: "error",
                    title: t("domain:film-project-generation-failed"),
                    text,
                    detail: { kind: "cinematic", backendSessionId, status: "failed", failedAt },
                }),
                updatedAt: failedAt,
            };
        });
    };

    const runCinematicSession = async (sessionId: string, text: string, current: CanvasAgentSnapshot, config: AiConfig, onCreated?: (backendSessionId: string) => void) => {
        const requestConfig = resolveModelRequestConfig(config, config.textModel || config.model);
        const storyboardContext = resolveStoryboardGenerationContext(current.nodes);
        const controller = new AbortController();
        const requestKey = `creating:${nanoid()}`;
        let backendSessionId = "";
        cinematicSessionControllersRef.current.set(requestKey, controller);
        try {
            const detail = await createCinematicAgentSession(
                {
                    projectId,
                    prompt: text,
                    canvasSnapshot: compactSnapshot(current) as unknown as Record<string, unknown>,
                    projectStyle: storyboardContext.projectStyle,
                    characters: storyboardContext.characters,
                    config: backendAgentProviderConfig(requestConfig),
                },
                {
                    signal: controller.signal,
                    onCreated: (created) => {
                        backendSessionId = created.session.id;
                        cinematicSessionControllersRef.current.delete(requestKey);
                        cinematicSessionControllersRef.current.set(backendSessionId, controller);
                        setPendingCinematicSession(sessionId, backendSessionId);
                        addOnlineLog(t("domain:backend-film-agent-session-created"), { backendSessionId });
                        onCreated?.(backendSessionId);
                    },
                },
            );
            return {
                backendSessionId: detail.session.id,
                ops: requireOps(JSON.parse(cinematicAgentSessionOpsJson(detail))),
                continuationTask: [...detail.tasks].reverse().find((task) => task.status === "succeeded"),
            };
        } catch (error) {
            if (backendSessionId && !isAgentSessionPollingAbort(error)) failCinematicSession(sessionId, backendSessionId, error);
            throw error;
        } finally {
            cinematicSessionControllersRef.current.delete(requestKey);
            if (backendSessionId) cinematicSessionControllersRef.current.delete(backendSessionId);
        }
    };

    const startChatSession = () => {
        if (activeSession && activeSession.messages.length === 0) {
            setLocalActiveSessionId(activeSession.id);
            return;
        }
        const session = createSession(t("canvas:new-conversation-2"));
        setLocalSessions((prev) => [session, ...prev]);
        setLocalActiveSessionId(session.id);
    };

    const removeSessions = (ids: string[]) => {
        const next = safeSessions.filter((session) => !ids.includes(session.id));
        if (!next.length) {
            const session = createSession(t("canvas:new-conversation-2"));
            setLocalSessions([session]);
            setLocalActiveSessionId(session.id);
        } else {
            setLocalSessions(next);
            setLocalActiveSessionId(localActiveSessionId && ids.includes(localActiveSessionId) ? next[0].id : localActiveSessionId);
        }
        cleanupImages({ sessions: next });
    };

    const clearSessions = () => {
        const session = createSession(t("canvas:new-conversation-2"));
        setLocalSessions([session]);
        setLocalActiveSessionId(session.id);
        cleanupImages({ sessions: [session] });
    };

    const sendMessage = async (text: string, history: CanvasAssistantMessage[], savedReferences?: CanvasAssistantReference[]) => {
        const requestConfig = { ...effectiveConfig, model: effectiveConfig.textModel || effectiveConfig.model };
        if (!isAiConfigReady(requestConfig, requestConfig.model)) {
            navigateToSettings({ continueCreation: true });
            return;
        }

        const session = activeSession || createSession(t("canvas:new-conversation-2"));
        if (!activeSession) {
            setLocalSessions([session]);
            setLocalActiveSessionId(session.id);
        }

        const refs = savedReferences || selectedReferences;
        const userMessage: CanvasAssistantMessage = { id: nanoid(), role: "user", text, references: refs };
        const assistantId = nanoid();
        appendMessage(session.id, userMessage);
        addOnlineLog(t("domain:send-request"), { text, selectedNodeIds: snapshotRef.current.selectedNodeIds, nodeCount: snapshotRef.current.nodes.length, connectionCount: snapshotRef.current.connections.length });
        setPrompt("");
        setIsRunning(true);
        void runOnlineAgentStep(session.id, assistantId, history, userMessage, { step: 1 });
    };

    const runOnlineAgentStep = async (sessionId: string, assistantId: string, history: CanvasAssistantMessage[], userMessage: CanvasAssistantMessage, loop: OnlineLoopContext) => {
        const requestConfig = { ...effectiveConfig, model: effectiveConfig.textModel || effectiveConfig.model };
        try {
            setIsRunning(true);
            const messages = await buildToolAgentMessages(snapshotRef.current, history, userMessage);
            addOnlineLog(t("domain:agent-tool-loop-param-started", { step: loop.step }), { toolChoice: "required" });
            let streamed = "";
            const result = await requestOnlineAgentModel(
                { ...requestConfig, systemPrompt: "" },
                messages,
                "required",
                userMessage.text,
                (text) => {
                    streamed = text;
                    if (text.trim()) upsertMessage(sessionId, { id: assistantId, role: "assistant", text });
                },
                canvasAgentPromptCacheKey(sessionId),
            );
            addOnlineLog(t("domain:model-tool-reply"), result);
            if (result.toolCalls.length) {
                const writableCalls = result.toolCalls.filter(isWritableToolCall);
                if (confirmTools && writableCalls.length) {
                    upsertMessage(sessionId, { id: assistantId, role: "assistant", text: result.content || streamed || t("domain:tool-ready-awaiting-confirmation") });
                    const toolMessageId = nanoid();
                    pendingToolContextRef.current.set(toolMessageId, { messages, toolCalls: result.toolCalls, assistantId, step: loop.step });
                    const toolMessage: CanvasAssistantMessage = {
                        id: toolMessageId,
                        role: "tool",
                        title: t("domain:confirm-tool-call-2"),
                        text: summarizeToolCalls(result.toolCalls),
                        detail: { status: "pending", step: loop.step, toolCalls: result.toolCalls, impact: previewOnlineToolCalls(result.toolCalls, snapshotRef.current, effectiveConfig) },
                    };
                    appendMessage(sessionId, toolMessage);
                    addOnlineLog(t("domain:awaiting-user-confirmation"), result.toolCalls);
                    return;
                }
                await continueOnlineToolLoop(sessionId, assistantId, messages, result, loop.step);
            } else {
                if (!result.content.trim()) throw new Error(t("domain:the-model-returned-nothing-the-canvas-was-not-changed"));
                upsertMessage(sessionId, { id: assistantId, role: "assistant", text: result.content || streamed || t("domain:no-content-returned") });
                addOnlineLog(t("domain:agent-tool-loop-param-finished", { step: loop.step }), { reply: result.content });
            }
        } catch (error) {
            if (isAgentSessionPollingAbort(error)) return;
            addOnlineLog(t("domain:request-failed"), error instanceof Error ? error.message : error);
            appendMessage(sessionId, { id: nanoid(), role: "error", title: t("domain:operation-failed"), text: error instanceof Error ? error.message : t("domain:operation-failed") });
        } finally {
            setIsRunning(false);
        }
    };

    const continueOnlineToolLoop = async (sessionId: string, assistantId: string, messages: ResponseInputMessage[], result: { content: string; toolCalls: ResponseToolCall[] }, step: number) => {
        const toolResults = await executeOnlineToolCalls(sessionId, result.toolCalls);
        addOnlineLog(t("domain:tool-execution-result"), toolResults);
        appendMessage(sessionId, {
            id: nanoid(),
            role: "tool",
            title: t("domain:tools-auto-executed"),
            text: toolResults.map((item) => toolResultText(item.result)).join("\n"),
            detail: { status: "completed", step, toolCalls: result.toolCalls, results: toolResults },
        });
        await continueOnlineToolLoopAfterResults(sessionId, assistantId, messages, result.toolCalls, toolResults, step);
    };

    const continueOnlineToolLoopAfterResults = async (sessionId: string, assistantId: string, messages: ResponseInputMessage[], toolCalls: ResponseToolCall[], toolResults: OnlineExecutedToolCall[], step: number) => {
        const nextMessages: ResponseInputMessage[] = [...messages, ...toolCalls.map(toolCallToResponseInput), ...toolResults.map((item) => ({ role: "tool" as const, tool_call_id: item.toolCallId, content: JSON.stringify(item.result) }))];
        if (step >= ONLINE_AGENT_MAX_STEPS) {
            upsertMessage(sessionId, { id: assistantId, role: "assistant", text: toolResults.map((item) => toolResultText(item.result)).join("\n") || t("domain:tool-executed") });
            addOnlineLog(t("domain:agent-tool-loop-param-finished", { step }), { maxSteps: ONLINE_AGENT_MAX_STEPS });
            return;
        }
        const requestConfig = { ...effectiveConfig, model: effectiveConfig.textModel || effectiveConfig.model };
        let streamed = "";
        const next = await requestOnlineAgentModel(
            { ...requestConfig, systemPrompt: "" },
            nextMessages,
            "auto",
            t("domain:continue-processing-canvas-tool-results"),
            (text) => {
                streamed = text;
                if (text.trim()) upsertMessage(sessionId, { id: assistantId, role: "assistant", text });
            },
            canvasAgentPromptCacheKey(sessionId),
        );
        addOnlineLog(`Agent Tool Loop ${step + 1} 回复`, next);
        if (next.toolCalls.length) {
            const writableCalls = next.toolCalls.filter(isWritableToolCall);
            if (confirmTools && writableCalls.length) {
                upsertMessage(sessionId, { id: assistantId, role: "assistant", text: next.content || streamed || t("domain:tool-ready-awaiting-confirmation") });
                const toolMessageId = nanoid();
                pendingToolContextRef.current.set(toolMessageId, { messages: nextMessages, toolCalls: next.toolCalls, assistantId, step: step + 1 });
                appendMessage(sessionId, {
                    id: toolMessageId,
                    role: "tool",
                    title: t("domain:confirm-tool-call-2"),
                    text: summarizeToolCalls(next.toolCalls),
                    detail: { status: "pending", step: step + 1, toolCalls: next.toolCalls, impact: previewOnlineToolCalls(next.toolCalls, snapshotRef.current, effectiveConfig) },
                });
                addOnlineLog(t("domain:awaiting-user-confirmation"), next.toolCalls);
                return;
            }
            await continueOnlineToolLoop(sessionId, assistantId, nextMessages, next, step + 1);
            return;
        }
        upsertMessage(sessionId, { id: assistantId, role: "assistant", text: next.content || streamed || toolResults.map((item) => toolResultText(item.result)).join("\n") || t("domain:tool-executed") });
    };

    const executeOps = async (ops: CanvasAgentOp[], context?: { conversationId?: string; messageId?: string; source?: "online" | "local" }) => {
        const beforeSnapshot = snapshotRef.current;
        const before = snapshotSignature(beforeSnapshot);
        const next = await onApplyOps(ops, context);
        snapshotRef.current = next;
        const ranGeneration = ops.some((op) => op.type === "run_generation" && Boolean(op.nodeId));
        const changed = before !== snapshotSignature(next) || ranGeneration;
        const noopReason = changed ? "" : explainNoop(ops, beforeSnapshot);
        return { changed, ops, ranGeneration, noopReason, before: JSON.parse(before), after: JSON.parse(snapshotSignature(next)) };
    };

    const executeOnlineTool = async (sessionId: string, name: string, args: Record<string, unknown>, messageId?: string): Promise<OnlineToolResult> => {
        const current = snapshotRef.current;
        try {
            const expectedStateHash = typeof args.expectedStateHash === "string" ? args.expectedStateHash : "";
            if (expectedStateHash && expectedStateHash !== buildCanvasAgentContext(current).stateHash) return { ok: false, message: t("domain:canvas-state-changed-reread-context") };
            if (name === "canvas_get_state") return { ok: true, message: describeCanvasSnapshot(current), data: compactSnapshot(current) };
            if (name === "canvas_get_context") return { ok: true, message: t("domain:canvas-context-read"), data: buildCanvasAgentContext(current) };
            if (name === "canvas_find_nodes") return { ok: true, message: t("domain:canvas-nodes-found"), data: findCanvasAgentNodes(current, args as Parameters<typeof findCanvasAgentNodes>[1]) };
            if (name === "canvas_get_resources") return { ok: true, message: t("domain:canvas-resources-read"), data: getCanvasAgentResources(current, args as Parameters<typeof getCanvasAgentResources>[1]) };
            if (name === "canvas_validate_ops") {
                const result = validateCanvasAgentOps(current, requireOps(args.ops));
                return { ok: result.ok, message: result.ok ? t("domain:ops-validation-passed") : t("domain:ops-validation-failed"), data: result };
            }
            if (name === "canvas_export_snapshot") return { ok: true, message: describeCanvasSnapshot(current), data: compactSnapshot(current) };
            if (name === "canvas_get_selection") {
                const ids = new Set(current.selectedNodeIds || []);
                return { ok: true, message: t("domain:param-nodes-selected", { size: ids.size }), data: { nodes: compactSnapshot({ ...current, nodes: current.nodes.filter((node) => ids.has(node.id)) }).nodes } };
            }
            if (name === "canvas_create_cinematic_session") {
                const cinematic = await runCinematicSession(sessionId, requireString(args.prompt, "prompt"), current, effectiveConfig);
                let continuationResult: OnlineToolResult | undefined;
                const applyContinuation = async ({ effectKey, signal }: { effectKey?: string; signal?: AbortSignal } = {}) => {
                    if (hasAgentGenerationEffect(sessionId, effectKey)) return;
                    const result = await canvasCinematicContinuationEntryAdapters["online-tool"]({
                        projectId,
                        effectKey,
                        signal,
                        readSnapshot: () => snapshotRef.current,
                        executeOps: () => executeOps(cinematic.ops),
                        completeSession: (key) => completeCinematicSession(sessionId, cinematic.backendSessionId, cinematic.ops, false, key),
                        readLiveSessionState: readCinematicSessionState,
                        restoreLiveSessions: restoreCinematicSessions,
                        restoreLiveSnapshot: restoreCinematicSnapshot,
                        failProvider: (failure) => failCinematicSession(sessionId, cinematic.backendSessionId, failure),
                    });
                    continuationResult = {
                        ok: result.changed,
                        message: result.changed ? summarizeCanvasAgentOps(cinematic.ops) || t("domain:backend-film-agent-wrote-back-to-the-canvas") : result.noopReason,
                        data: result,
                    };
                };
                if (cinematic.continuationTask) {
                    await consumeGenerationTaskAgent(cinematic.continuationTask, cinematic.backendSessionId, applyContinuation, { signal: generationConsumerControllerRef.current.signal });
                } else {
                    await applyContinuation();
                }
                return continuationResult ?? { ok: true, message: t("domain:skip") };
            }
            const ops = onlineToolToOps(name, args, current, effectiveConfig);
            const result = await executeOps(ops, { source: "online", conversationId: sessionId, messageId: messageId || sessionId });
            return { ok: result.changed, message: result.changed ? summarizeCanvasAgentOps(ops) || t("domain:skip-2") : result.noopReason, data: result };
        } catch (error) {
            if (isAgentSessionPollingAbort(error)) throw error;
            return { ok: false, message: error instanceof Error ? error.message : t("domain:tool-execution-failed") };
        }
    };

    const executeOnlineToolCall = async (sessionId: string, toolCall: ResponseToolCall): Promise<OnlineExecutedToolCall> => {
        try {
            const result = await executeOnlineTool(sessionId, toolCall.function.name, parseToolArguments(toolCall.function.arguments), toolCall.id);
            return { toolCallId: toolCall.id, name: toolCall.function.name, result };
        } catch (error) {
            if (isAgentSessionPollingAbort(error)) throw error;
            return { toolCallId: toolCall.id, name: toolCall.function.name, result: { ok: false, message: error instanceof Error ? error.message : t("domain:invalid-tool-arguments") } };
        }
    };

    const executeOnlineToolCalls = async (sessionId: string, toolCalls: ResponseToolCall[]) => {
        const results: OnlineExecutedToolCall[] = [];
        let stopped = false;
        for (const toolCall of toolCalls) {
            if (stopped) {
                results.push({ toolCallId: toolCall.id, name: toolCall.function.name, result: { ok: false, message: t("domain:previous-tool-call-failed-execution-stopped") } });
                continue;
            }
            const result = await executeOnlineToolCall(sessionId, toolCall);
            results.push(result);
            if (!result.result.ok) stopped = true;
        }
        return results;
    };

    const approveOnlineTool = async (messageId: string) => {
        const message = safeSessions.flatMap((session) => session.messages).find((item) => item.id === messageId);
        const detail = objectDetail(message?.detail);
        const pendingContext = pendingToolContextRef.current.get(messageId);
        const toolCalls = pendingContext?.toolCalls || toolCallsFromDetail(detail);
        const previousMessages = pendingContext?.messages || [];
        const session = safeSessions.find((session) => session.messages.some((item) => item.id === messageId));
        addOnlineLog(t("domain:approve-tool"), { messageId, toolCalls });
        const assistantId = pendingContext?.assistantId || "";
        if (!session) return;
        if (!toolCalls.length || !previousMessages.length || !assistantId) {
            upsertMessage(session.id, { id: messageId, role: "tool", title: t("domain:tool-execution-failed"), text: t("domain:incomplete-tool-context-cannot-execute"), detail: { ...detail, status: "failed" } });
            return;
        }
        try {
            setIsRunning(true);
            const results = await executeOnlineToolCalls(session.id, toolCalls);
            addOnlineLog(t("domain:tool-execution-result"), results);
            upsertMessage(session.id, { id: messageId, role: "tool", title: t("domain:tool-execution-finished"), text: results.map((item) => toolResultText(item.result)).join("\n"), detail: { ...detail, results, status: "completed" } });
            pendingToolContextRef.current.delete(messageId);
            await continueOnlineToolLoopAfterResults(session.id, assistantId, previousMessages, toolCalls, results, pendingContext?.step || Number(detail.step) || 1);
        } catch (error) {
            if (isAgentSessionPollingAbort(error)) return;
            addOnlineLog(t("domain:failed-to-resume-tool-run"), error instanceof Error ? error.message : error);
            appendMessage(session.id, { id: nanoid(), role: "error", title: t("domain:operation-failed"), text: error instanceof Error ? error.message : t("domain:operation-failed") });
        } finally {
            setIsRunning(false);
        }
    };

    const rejectOnlineTool = (messageId: string) => {
        const session = safeSessions.find((session) => session.messages.some((item) => item.id === messageId));
        addOnlineLog(t("domain:decline-tool"), { messageId });
        pendingToolContextRef.current.delete(messageId);
        if (session)
            upsertMessage(session.id, { id: messageId, role: "tool", title: t("domain:declined"), text: t("domain:tool-call-cancelled"), detail: { ...objectDetail(session.messages.find((item) => item.id === messageId)?.detail), status: "rejected" } });
    };

    const undoLastOnlineBatch = () => {
        const restored = onUndoOps();
        if (!restored) return;
        snapshotRef.current = restored;
        if (activeSession)
            appendMessage(activeSession.id, {
                id: nanoid(),
                role: "tool",
                title: t("canvas:agent-batch-undone"),
                text: t("canvas:canvas-restored-to-its-state-before-this-write-back"),
                detail: { status: "completed", remainingUndoCount: Math.max(0, undoOpsCount - 1) },
            });
    };

    const submit = async () => {
        const text = prompt.trim();
        if (!text || agentBusy) return;
        await sendMessage(text, messages);
    };

    useEffect(() => {
        if (!cinematicEntry) return;
        setCinematicEntryActive(true);
        setView("chat");
        setPrompt("");
        onCinematicEntryConsumed?.();
    }, [cinematicEntry, onCinematicEntryConsumed]);

    const submitCinematicProject = async (text: string) => {
        const value = text.trim();
        if (!value || agentBusy) return;
        const requestConfig = { ...effectiveConfig, model: effectiveConfig.textModel || effectiveConfig.model };
        if (!isAiConfigReady(requestConfig, requestConfig.model)) {
            navigateToSettings({ continueCreation: true });
            return;
        }
        const session = activeSession || createSession(t("canvas:new-conversation-2"));
        if (!activeSession) {
            setLocalSessions([session]);
            setLocalActiveSessionId(session.id);
        }
        appendMessage(session.id, { id: nanoid(), role: "user", text: value });
        setPrompt("");
        setIsRunning(true);
        let backendSessionId = "";
        let continuationFailureDisposition: CinematicContinuationFailureDisposition | undefined;
        try {
            const cinematic = await runCinematicSession(session.id, value, snapshotRef.current, effectiveConfig, (createdId) => {
                backendSessionId = createdId;
            });
            const applyContinuation = async ({ effectKey, signal }: { effectKey?: string; signal?: AbortSignal } = {}) => {
                if (hasAgentGenerationEffect(session.id, effectKey)) return;
                await canvasCinematicContinuationEntryAdapters["submit-cinematic"]({
                    projectId,
                    effectKey,
                    signal,
                    readSnapshot: () => snapshotRef.current,
                    executeOps: async () => {
                        const next = await onApplyOps(cinematic.ops);
                        snapshotRef.current = next;
                        return next;
                    },
                    completeSession: (key) => completeCinematicSession(session.id, cinematic.backendSessionId, cinematic.ops, false, key),
                    readLiveSessionState: readCinematicSessionState,
                    restoreLiveSessions: restoreCinematicSessions,
                    restoreLiveSnapshot: restoreCinematicSnapshot,
                    failProvider: (failure) => failCinematicSession(session.id, cinematic.backendSessionId, failure),
                    onFailureDisposition: (disposition) => {
                        continuationFailureDisposition = disposition;
                    },
                });
                setCinematicEntryActive(false);
            };
            if (cinematic.continuationTask) {
                await consumeGenerationTaskAgent(cinematic.continuationTask, cinematic.backendSessionId, applyContinuation, { signal: generationConsumerControllerRef.current.signal });
            } else {
                await applyContinuation();
            }
        } catch (error) {
            if (continuationFailureDisposition) return;
            handleCinematicContinuationFailure(error, (failure) => {
                if (backendSessionId) failCinematicSession(session.id, backendSessionId, failure);
                else appendMessage(session.id, { id: nanoid(), role: "error", title: t("domain:film-project-generation-failed"), text: failure instanceof Error ? failure.message : t("domain:film-project-generation-failed") });
            });
        } finally {
            setIsRunning(false);
        }
    };

    const resumePendingCinematicSession = async (sessionId: string, pending: CanvasAssistantPendingBackendSession) => {
        if (cinematicSessionControllersRef.current.has(pending.id)) return;
        const controller = new AbortController();
        cinematicSessionControllersRef.current.set(pending.id, controller);
        setIsRunning(true);
        addOnlineLog(t("domain:restore-backend-film-agent-session"), { backendSessionId: pending.id });
        let continuationFailureDisposition: CinematicContinuationFailureDisposition | undefined;
        try {
            const detail = await resumeCinematicAgentSession(pending.id, { signal: controller.signal });
            const ops = requireOps(JSON.parse(cinematicAgentSessionOpsJson(detail)));
            const continuationTask = [...detail.tasks].reverse().find((task) => task.status === "succeeded");
            const applyContinuation = async ({ effectKey, signal }: { effectKey?: string; signal?: AbortSignal } = {}) => {
                if (hasAgentGenerationEffect(sessionId, effectKey)) return;
                await canvasCinematicContinuationEntryAdapters["resume-cinematic"]({
                    projectId,
                    effectKey,
                    signal,
                    readSnapshot: () => snapshotRef.current,
                    executeOps: () => executeOps(ops),
                    completeSession: (key) => completeCinematicSession(sessionId, pending.id, ops, true, key),
                    readLiveSessionState: readCinematicSessionState,
                    restoreLiveSessions: restoreCinematicSessions,
                    restoreLiveSnapshot: restoreCinematicSnapshot,
                    failProvider: (failure) => {
                        failCinematicSession(sessionId, pending.id, failure);
                        addOnlineLog(t("domain:failed-to-restore-backend-film-agent-session"), failure instanceof Error ? failure.message : failure);
                    },
                    onFailureDisposition: (disposition, error) => {
                        continuationFailureDisposition = disposition;
                        if (disposition === "durable-ack") addOnlineLog(t("domain:failed-to-persist-backend-film-agent-session-kept-for-recovery"), error instanceof Error ? error.message : error);
                    },
                });
                addOnlineLog(t("domain:backend-film-agent-session-restored"), { backendSessionId: pending.id });
            };
            if (continuationTask) {
                await consumeGenerationTaskAgent(continuationTask, pending.id, applyContinuation, { signal: controller.signal });
            } else {
                await applyContinuation();
            }
        } catch (error) {
            if (continuationFailureDisposition) return;
            const disposition = handleCinematicContinuationFailure(error, (failure) => {
                failCinematicSession(sessionId, pending.id, failure);
                addOnlineLog(t("domain:failed-to-restore-backend-film-agent-session"), failure instanceof Error ? failure.message : failure);
            });
            if (disposition === "durable-ack") addOnlineLog(t("domain:failed-to-persist-backend-film-agent-session-kept-for-recovery"), error instanceof Error ? error.message : error);
        } finally {
            if (cinematicSessionControllersRef.current.get(pending.id) === controller) cinematicSessionControllersRef.current.delete(pending.id);
            if (cinematicSessionControllersRef.current.size === 0) setIsRunning(false);
        }
    };

    useEffect(() => {
        localSessions.forEach((session) => {
            const pending = session.pendingBackendSession;
            if (pending?.kind === "cinematic" && pending.status === "pending") void resumePendingCinematicSession(session.id, pending);
        });
    }, [localSessions]);

    const addImagesToCanvas = (files: FileList | File[] | null) => {
        const file = Array.from(files || []).find((item) => item.type.startsWith("image/"));
        if (file) onPasteImage(file);
    };

    const collapse = () => {
        onCollapse();
    };

    const onlineContent = (
        <>
            <AgentPanelTabs
                value={view}
                theme={theme}
                items={[
                    { value: "setup", label: t("domain:configure-2"), icon: <Settings2 className="size-3.5" /> },
                    { value: "chat", label: t("canvas:conversations-2"), icon: <MessageSquareText className="size-3.5" /> },
                    { value: "history", label: t("canvas:history-2"), icon: <History className="size-3.5" />, count: historySessions.length },
                    { value: "log", label: t("canvas:record-3"), icon: <ScrollText className="size-3.5" />, count: onlineLogs.length },
                ]}
                onChange={setView}
                right={
                    <>
                        {view === "history" ? (
                            <Tooltip title={t("domain:delete-all")}>
                                <Button
                                    type="text"
                                    shape="circle"
                                    className="!h-8 !w-8 !min-w-8"
                                    style={iconButtonStyle}
                                    icon={<X className="size-4" />}
                                    disabled={!historySessions.length}
                                    onClick={() => setDeleteChatIds(historySessions.map((session) => session.id))}
                                />
                            </Tooltip>
                        ) : null}
                        <Tooltip title={t("canvas:new-conversation-2")}>
                            <Button
                                type="text"
                                shape="circle"
                                className="!h-8 !w-8 !min-w-8"
                                style={iconButtonStyle}
                                icon={<Plus className="size-4" />}
                                disabled={!hasMessages}
                                onClick={() => {
                                    startChatSession();
                                    setView("chat");
                                }}
                            />
                        </Tooltip>
                    </>
                }
            />

            {view === "setup" ? (
                <OnlineAgentSetupView theme={theme} activeModel={activeModelName} onOpenConfig={() => navigateToSettings({ continueCreation: true })} />
            ) : (
                <div ref={chatListRef} className="thin-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
                    {view === "history" ? (
                        <AssistantHistory
                            sessions={historySessions}
                            activeSession={activeSession}
                            onOpen={(id) => {
                                setLocalActiveSessionId(id);
                                setView("chat");
                            }}
                            onDelete={(id) => setDeleteChatIds([id])}
                        />
                    ) : view === "log" ? (
                        <OnlineAgentLogView
                            logs={onlineLogs}
                            theme={theme}
                            context={{ model: activeModelName, running: agentBusy, confirmTools, messages: messages.length, nodes: snapshot.nodes.length, connections: snapshot.connections.length }}
                            onClear={() => setOnlineLogs([])}
                        />
                    ) : messages.length ? (
                        <>
                            {messages.map((message) => (
                                <div key={message.id} className="space-y-2">
                                    <AgentChatMessage
                                        item={assistantMessageToChatMessage(message)}
                                        theme={theme}
                                        user={user}
                                        isStreaming={agentBusy && message.id === messages.at(-1)?.id && message.role === "assistant"}
                                        onRejectTool={rejectOnlineTool}
                                        onApproveTool={approveOnlineTool}
                                    />
                                    {message.references?.length ? <MessageReferences message={message} /> : null}
                                </div>
                            ))}
                            {agentBusy ? <AgentWorkingMessage theme={theme} /> : null}
                        </>
                    ) : (
                        <AgentChatEmptyState
                            theme={theme}
                            nodeCount={contextSummary.nodeCount}
                            onSelect={(text) => {
                                setPrompt(text);
                                void sendMessage(text, messages);
                            }}
                        />
                    )}
                </div>
            )}

            {view === "chat" ? (
                <>
                    {selectedReferences.length ? (
                        <div className="thin-scrollbar flex max-w-full gap-1.5 overflow-x-auto px-3 pb-1">
                            {selectedReferences.map((item, index) => (
                                <AssistantReferenceChip
                                    key={item.id}
                                    item={item}
                                    label={assistantImageReferenceLabel(selectedReferences, index)}
                                    onRemove={() => {
                                        setRemovedReferenceIds((prev) => new Set(prev).add(item.id));
                                        if (selectedNodeIds.has(item.id)) onSelectNodeIds(new Set(Array.from(selectedNodeIds).filter((nodeId) => nodeId !== item.id)));
                                    }}
                                />
                            ))}
                        </div>
                    ) : null}
                    <AgentChatComposer
                        prompt={prompt}
                        sending={agentBusy}
                        placeholder={cinematicEntryActive ? t("domain:one-line-genre-characters-core-conflict") : t("domain:describe-how-the-agent-should-operate-the-canvas")}
                        theme={theme}
                        onPromptChange={setPrompt}
                        onSubmit={cinematicEntryActive ? () => submitCinematicProject(prompt) : submit}
                        onAddFiles={addImagesToCanvas}
                        left={
                            <>
                                <VoiceRecordingButton disabled={agentBusy} onTranscribed={(text) => setPrompt((prev) => (prev.trim() ? `${prev} ${text}` : text))} />
                                <AgentTextModelPicker config={effectiveConfig} value={effectiveConfig.textModel} onChange={(model) => updateConfig("textModel", model)} />
                                {cinematicEntryActive ? (
                                    <span className="ml-2 inline-flex h-6 items-center rounded-md px-2 text-[var(--fs-tiny)] font-medium" style={{ background: theme.spatial.surface, color: theme.node.muted }}>
                                        {t("domain:film-project")}
                                    </span>
                                ) : null}
                            </>
                        }
                    />
                </>
            ) : null}

            <Modal
                title={t("domain:delete-conversation-history")}
                open={deleteChatIds.length > 0}
                centered
                onCancel={() => setDeleteChatIds([])}
                footer={
                    <>
                        <Button onClick={() => setDeleteChatIds([])}>{t("canvas:cancel-11")}</Button>
                        <Button
                            danger
                            type="primary"
                            onClick={() => {
                                deleteChatIds.length === historySessions.length ? clearSessions() : removeSessions(deleteChatIds);
                                setDeleteChatIds([]);
                            }}
                        >
                            {t("canvas:delete-5")}
                        </Button>
                    </>
                }
            >
                <p className="text-sm opacity-60">
                    {t("domain:will-be-deleted-2")} {deleteChatIds.length} {t("domain:conversation-records-this-cannot-be-undone")}
                </p>
            </Modal>
        </>
    );

    return (
        <motion.aside
            className="pointer-events-auto relative flex h-full w-full flex-col overflow-hidden rounded-[var(--panel-radius)] border"
            initial={{ x: 48, opacity: 0 }}
            animate={{ x: closing ? 28 : 0, opacity: closing ? 0 : 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: [0.22, 1, 0.36, 1] }}
            style={{
                borderColor: theme.toolbar.border,
                background: theme.spatial.elevated,
                color: theme.node.text,
                boxShadow: `0 24px 72px ${theme.spatial.shadow}`,
            }}
        >
            <AgentPanelChrome
                theme={theme}
                mode={agentMode}
                context={contextSummary}
                referenceCount={selectedReferences.length}
                confirmTools={confirmTools}
                canUndo={agentMode === "online" && canUndoOps}
                undoCount={agentMode === "online" ? undoOpsCount : 0}
                onModeChange={onAgentModeChange}
                onConfirmToolsChange={(confirmTools) => setAgentState({ confirmTools })}
                onUndo={undoLastOnlineBatch}
                onCollapse={collapse}
            />
            {agentMode === "local" ? <CanvasLocalAgentPanel embedded snapshot={snapshot} canUndoOps={canUndoOps} undoOpsCount={undoOpsCount} onApplyOps={onApplyOps} onUndoOps={onUndoOps} autoConnect={autoConnectLocal} /> : onlineContent}
        </motion.aside>
    );
}

function AgentTextModelPicker({ config, value, onChange }: { config: AiConfig; value: string; onChange: (model: string) => void }) {
    const { t } = useTranslation("canvas");
    const options = useMemo(() => Array.from(new Set([value, ...selectableModelsByCapability(config, "text")].filter(Boolean))), [config, value]);
    const current = value || "";
    return (
        <div className="min-w-0 max-w-[240px]" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            <Select<string>
                size="small"
                variant="borderless"
                value={current || undefined}
                className="agent-text-model-select w-full"
                popupMatchSelectWidth={288}
                options={options.map((model) => ({ value: model, label: agentModelLabel(config, model) }))}
                notFoundContent={<span className="block py-2 text-center text-xs text-foreground/48">{t("domain:no-text-models-available")}</span>}
                optionRender={(option) => {
                    const model = String(option.value);
                    return (
                        <span className="flex min-w-0 items-center gap-2">
                            <AgentModelIcon config={config} model={model} />
                            <span className="min-w-0 flex-1 truncate">{modelDisplayName(config, model)}</span>
                            {agentModelSource(config, model) ? <span className="shrink-0 text-xs opacity-55">{agentModelSource(config, model)}</span> : null}
                        </span>
                    );
                }}
                labelRender={() => (
                    <span className="flex min-w-0 items-center gap-1.5">
                        <AgentModelIcon config={config} model={current} />
                        <span className="min-w-0 truncate">{current ? modelDisplayName(config, current) : t("canvas:select-text-model")}</span>
                        {current && agentModelSource(config, current) ? <span className="shrink-0 opacity-55">{agentModelSource(config, current)}</span> : null}
                    </span>
                )}
                onChange={onChange}
                aria-label={t("domain:choose-agent-text-model")}
                title={current ? agentModelLabel(config, current) : t("canvas:select-text-model")}
            />
        </div>
    );
}

function agentModelSource(config: AiConfig, model: string) {
    const channel = resolveModelChannel(config, model);
    return channel.scope === "system" ? "" : channel.name;
}

function agentModelLabel(config: AiConfig, model: string) {
    const source = agentModelSource(config, model);
    return source ? `${modelDisplayName(config, model)} · ${source}` : modelDisplayName(config, model);
}

function AgentModelIcon({ config, model }: { config: AiConfig; model: string }) {
    const icon = modelIcon(config, model);
    return icon ? (
        <span className="inline-flex size-4 shrink-0 items-center justify-center">
            <ModelLogo icon={icon} size={16} />
        </span>
    ) : (
        <Cpu className="size-4 shrink-0 opacity-70" />
    );
}

function AssistantHistory({ sessions, activeSession, onOpen, onDelete }: { sessions: CanvasAssistantSession[]; activeSession: CanvasAssistantSession | null; onOpen: (id: string) => void; onDelete: (id: string) => void }) {
    const { t } = useTranslation("canvas");
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <div className="space-y-3">
            <div className="text-sm" style={{ color: theme.node.muted }}>
                {sessions.length ? t("canvas:param-entries", { length: sessions.length }) : t("canvas:no-history-yet-2")}
            </div>
            {sessions.map((session) => (
                <div key={session.id} className="rounded-md px-2.5 py-2 transition-colors" style={{ background: session.id === activeSession?.id ? theme.accent.primarySoft : "transparent", color: theme.node.text }}>
                    <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-1.5">
                                {session.id === activeSession?.id ? (
                                    <span className="shrink-0 text-[var(--fs-tiny)] font-medium" style={{ color: theme.node.text }}>
                                        {t("canvas:current-4")}
                                    </span>
                                ) : null}
                                <div className="truncate text-sm font-medium leading-5">{session.title}</div>
                            </div>
                            <div className="truncate text-[var(--fs-label)] leading-4 opacity-65">{sessionPreview(session)}</div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                            <span className="text-[var(--fs-tiny)] opacity-55">{formatSessionTime(session.updatedAt || session.createdAt)}</span>
                            <Button size="small" className="!h-6 !px-2" onClick={() => onOpen(session.id)}>
                                {t("canvas:enter-2")}
                            </Button>
                            <Tooltip title={t("canvas:delete-record")}>
                                <Button size="small" danger type="text" className="!h-6 !w-6 !min-w-6" icon={<Trash2 className="size-3.5" />} onClick={() => onDelete(session.id)} />
                            </Tooltip>
                        </div>
                    </div>
                </div>
            ))}
            {!sessions.length ? (
                <div className="px-3 py-8 text-center text-sm" style={{ color: theme.node.muted }}>
                    {t("domain:web-agent-conversations-appear-here")}
                </div>
            ) : null}
        </div>
    );
}

function OnlineAgentSetupView({ theme, activeModel, onOpenConfig }: { theme: (typeof canvasThemes)[keyof typeof canvasThemes]; activeModel: string; onOpenConfig: () => void }) {
    const { t } = useTranslation("canvas");
    return (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
            <div className="space-y-4">
                <div>
                    <div className="text-base font-semibold leading-6">{t("domain:connection")}</div>
                    <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                        {t("domain:the-web-agent-uses-this-browser-s-configured-text-model-and-api-directly")}
                    </div>
                </div>
                <div className="rounded-md p-3" style={{ background: theme.spatial.surface }}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium leading-5">{t("domain:text-model")}</div>
                            <div className="mt-1 truncate text-xs leading-5" style={{ color: theme.node.muted }}>
                                {activeModel || t("domain:no-model-configured")}
                            </div>
                        </div>
                        <Button className="!h-8 !px-3" type="primary" icon={<Settings2 className="size-4" />} onClick={onOpenConfig}>
                            {t("domain:configure-2")}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function OnlineAgentLogView({ logs, theme, context, onClear }: { logs: OnlineAgentLog[]; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; context: OnlineAgentLogContext; onClear: () => void }) {
    const { t } = useTranslation("canvas");
    const [mode, setMode] = useState<"text" | "json">("text");
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const content = mode === "text" ? formatOnlineLogText(logs, context) : formatOnlineLogJson(logs, context);
    const lastError = [...logs].reverse().find((item) => /错误|失败|error/i.test(`${item.title}\n${stringifyLog(item.data)}`));
    const copy = async (value = content) => {
        if (await copyToClipboard(value)) return;
        textareaRef.current?.focus();
        textareaRef.current?.select();
    };
    return (
        <div className="flex min-h-full flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <Segmented
                    size="small"
                    value={mode}
                    onChange={(value) => setMode(value as "text" | "json")}
                    options={[
                        { label: t("canvas:diagnostics-log"), value: "text" },
                        { label: t("canvas:raw-json"), value: "json" },
                    ]}
                />
                <div className="flex items-center gap-2">
                    <span className="text-xs" style={{ color: theme.node.muted }}>
                        {logs.length} {t("canvas:item-4")}
                    </span>
                    <Button size="small" icon={<Copy className="size-3.5" />} disabled={!logs.length} onClick={() => void copy()}>
                        {t("canvas:copy-4")}
                    </Button>
                    <Button size="small" disabled={!lastError} onClick={() => lastError && void copy(formatOnlineLogText([lastError], context))}>
                        {t("canvas:latest-error-2")}
                    </Button>
                    <Button size="small" danger type="text" icon={<Trash2 className="size-3.5" />} disabled={!logs.length} onClick={onClear}>
                        {t("canvas:clear-4")}
                    </Button>
                </div>
            </div>
            <textarea
                ref={textareaRef}
                readOnly
                value={content}
                className="thin-scrollbar min-h-[360px] flex-1 resize-none rounded-md border-0 p-3 font-mono text-xs leading-5 outline-none"
                style={{ background: theme.spatial.surface, color: theme.node.text }}
                onFocus={(event) => event.currentTarget.select()}
            />
        </div>
    );
}

function MessageReferences({ message }: { message: CanvasAssistantMessage }) {
    return (
        <div className={`flex max-w-[88%] flex-wrap gap-2 ${message.role === "user" ? "ml-auto justify-end" : "ml-11 justify-start"}`}>
            {message.references?.map((item, index, references) => (
                <AssistantReferenceChip key={item.id} item={item} label={assistantImageReferenceLabel(references, index)} />
            ))}
        </div>
    );
}

function AssistantReferenceChip({ item, label, onRemove }: { item: CanvasAssistantReference; label?: string; onRemove?: () => void }) {
    const { t } = useTranslation("canvas");
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const text = (item.text || item.title).replace(/\s+/g, " ").trim().slice(0, 1) || t("domain:chars");
    return (
        <div className="group/chip relative inline-flex h-8 max-w-[150px] shrink-0 items-center gap-1.5 rounded-lg text-sm" style={{ color: theme.node.text }}>
            {item.dataUrl ? (
                <span className="relative block size-8 shrink-0">
                    <img src={item.dataUrl} alt="" className="size-8 rounded-lg object-cover" />
                    {label ? <span className="absolute left-0.5 top-0.5 rounded bg-black/60 px-1 py-0.5 text-[var(--fs-micro)] font-medium leading-none text-white">{label}</span> : null}
                </span>
            ) : (
                <span className="grid size-8 place-items-center rounded-md text-sm font-medium" style={{ background: theme.spatial.surface }}>
                    {text}
                </span>
            )}
            {onRemove ? (
                <button
                    type="button"
                    className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full border opacity-0 shadow-sm transition group-hover/chip:opacity-100"
                    style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke }}
                    onClick={onRemove}
                    aria-label={t("domain:remove-reference")}
                >
                    <X className="size-3" />
                </button>
            ) : null}
        </div>
    );
}

function assistantImageReferenceLabel(references: CanvasAssistantReference[], index: number) {
    if (!references[index]?.dataUrl) return undefined;
    const imageIndex = references.slice(0, index + 1).filter((item) => item.dataUrl).length - 1;
    return imageIndex >= 0 ? imageReferenceLabel(imageIndex) : undefined;
}

function assistantMessageToChatMessage(message: CanvasAssistantMessage): CanvasAgentChatMessage {
    return { id: message.id, role: message.role, title: message.title, text: message.text, meta: message.meta, detail: message.detail };
}

function formatSessionTime(value?: string) {
    return value ? new Date(value).toLocaleString() : "";
}

function sessionPreview(session: CanvasAssistantSession) {
    return session.messages.at(-1)?.text || t("domain:param-messages", { length: session.messages.length });
}

function objectDetail(value: unknown) {
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringifyLog(value: unknown) {
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function formatOnlineLogText(logs: OnlineAgentLog[], context: OnlineAgentLogContext) {
    const head = [
        t("domain:yingce-web-agent-diagnostics-log"),
        `model: ${context.model || "none"}`,
        `running: ${context.running}`,
        `confirmTools: ${context.confirmTools}`,
        `messages: ${context.messages}`,
        `nodes: ${context.nodes}`,
        `connections: ${context.connections}`,
        `logs: ${logs.length}`,
    ].join("\n");
    const body = logs.map((log, index) => [`#${index + 1} ${log.time} ${log.title}`, log.data === undefined ? "" : stringifyLog(log.data)].filter(Boolean).join("\n")).join("\n\n---\n\n");
    return [head, body || t("canvas:no-event-logs-yet")].join("\n\n");
}

function formatOnlineLogJson(logs: OnlineAgentLog[], context: OnlineAgentLogContext) {
    return JSON.stringify({ context, logs: logs.map(({ time, title, data }) => ({ time, title, data })) }, null, 2);
}

function describeCanvasSnapshot(snapshot: CanvasAgentSnapshot) {
    const counts = snapshot.nodes.reduce<Record<string, number>>((acc, node) => {
        acc[node.type] = (acc[node.type] || 0) + 1;
        return acc;
    }, {});
    return `当前画布有 ${snapshot.nodes.length} 个节点、${snapshot.connections.length} 条连线。背板 ${counts[CanvasNodeType.Frame] || 0} 个，文本 ${counts[CanvasNodeType.Text] || 0} 个，绘图 ${counts[CanvasNodeType.Drawing] || 0} 个，分镜脚本 ${counts[CanvasNodeType.Script] || 0} 个，技能 ${counts[CanvasNodeType.Skill] || 0} 个，图片 ${counts[CanvasNodeType.Image] || 0} 个，生成配置 ${counts[CanvasNodeType.Config] || 0} 个，视频 ${counts[CanvasNodeType.Video] || 0} 个，音频 ${counts[CanvasNodeType.Audio] || 0} 个。`;
}

function parseToolArguments(value: string) {
    try {
        const parsed = JSON.parse(value || "{}");
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(t("domain:tool-arguments-must-be-a-json-object"));
        return parsed as Record<string, unknown>;
    } catch {
        throw new Error(t("domain:tool-arguments-are-not-a-valid-json-object"));
    }
}

export function onlineToolToOps(name: string, input: Record<string, unknown>, snapshot: CanvasAgentSnapshot, config: AiConfig): CanvasAgentOp[] {
    if (name === "canvas_apply_ops") return requireOps(input.ops);
    if (name === "canvas_create_node") {
        const nodeType = requireNodeType(input.nodeType);
        const x = numberOr(input.x, nextCanvasX(snapshot));
        const y = numberOr(input.y, 0);
        return [{ type: "add_node", nodeType, title: stringOptional(input.title), position: { x, y }, width: numberOptional(input.width), height: numberOptional(input.height), metadata: recordOptional(input.metadata) as CanvasNodeData["metadata"] }];
    }
    if (name === "canvas_create_text_node") return [textNodeOp(input, numberOr(input.x, nextCanvasX(snapshot)), numberOr(input.y, 0))];
    if (name === "canvas_create_text_nodes") {
        const items = requireRecordArray(input.items, "items");
        const x = numberOr(input.x, nextCanvasX(snapshot));
        const y = numberOr(input.y, 0);
        const gap = numberOr(input.gap, 40);
        const direction = input.direction === "row" ? "row" : "column";
        return items.map((item, index) =>
            textNodeOp(
                { ...item, text: requireString(item.text, "text") },
                numberOr(item.x, direction === "row" ? x + index * (NODE_DEFAULT_SIZE[CanvasNodeType.Text].width + gap) : x),
                numberOr(item.y, direction === "row" ? y : y + index * (NODE_DEFAULT_SIZE[CanvasNodeType.Text].height + gap)),
            ),
        );
    }
    if (name === "canvas_create_image_prompt_flow") return generationFlowOps({ ...input, mode: "image" }, snapshot, config);
    if (name === "canvas_create_generation_flow") return generationFlowOps(input, snapshot, config);
    if (name === "canvas_generate_text") return generationFlowOps({ ...input, mode: "text", autoRun: true }, snapshot, config);
    if (name === "canvas_generate_image") return generationFlowOps({ ...input, mode: "image", autoRun: true }, snapshot, config);
    if (name === "canvas_generate_video") return generationFlowOps({ ...input, mode: "video", autoRun: true }, snapshot, config);
    if (name === "canvas_generate_audio") return generationFlowOps({ ...input, mode: "audio", autoRun: true }, snapshot, config);
    if (name === "canvas_update_node") return [{ type: "update_node", id: requireString(input.id, "id"), patch: recordOptional(input.patch) as Partial<CanvasNodeData> | undefined, metadata: recordOptional(input.metadata) as CanvasNodeData["metadata"] }];
    if (name === "canvas_update_node_text")
        return [{ type: "update_node", id: requireString(input.id, "id"), patch: stringOptional(input.title) ? { title: stringOptional(input.title) } : undefined, metadata: { content: requireString(input.text, "text"), status: "success" } }];
    if (name === "canvas_move_nodes") {
        return requireRecordArray(input.items, "items").map((item) => {
            const id = requireString(item.id, "id");
            const current = snapshot.nodes.find((node) => node.id === id);
            return { type: "update_node", id, patch: { position: { x: numberOr(item.x, (current?.position.x || 0) + numberOr(item.dx, 0)), y: numberOr(item.y, (current?.position.y || 0) + numberOr(item.dy, 0)) } } };
        });
    }
    if (name === "canvas_resize_node")
        return [
            {
                type: "update_node",
                id: requireString(input.id, "id"),
                patch: { width: requireNumber(input.width, "width"), height: requireNumber(input.height, "height") },
                metadata: typeof input.freeResize === "boolean" ? { freeResize: input.freeResize } : undefined,
            },
        ];
    if (name === "canvas_delete_nodes") return [{ type: "delete_node", ids: requireStringArray(input.ids, "ids") }];
    if (name === "canvas_connect_nodes")
        return requireRecordArray(input.connections, "connections").map((connection) => ({ type: "connect_nodes", fromNodeId: requireString(connection.fromNodeId, "fromNodeId"), toNodeId: requireString(connection.toNodeId, "toNodeId") }));
    if (name === "canvas_select_nodes") return [{ type: "select_nodes", ids: requireStringArray(input.ids, "ids") }];
    if (name === "canvas_set_viewport") return [{ type: "set_viewport", viewport: requireViewport(input.viewport) }];
    if (name === "canvas_run_generation") return [runGenerationOp(requireString(input.nodeId, "nodeId"), generationMode(input.mode), stringOptional(input.prompt), input.retry === true)];
    throw new Error(t("domain:unsupported-tool-param", { name: name }));
}

function generationFlowOps(input: Record<string, unknown>, snapshot: CanvasAgentSnapshot, config: AiConfig): CanvasAgentOp[] {
    const mode = generationMode(input.mode);
    const prompt = requireString(input.prompt, "prompt");
    const x = numberOr(input.x, nextCanvasX(snapshot));
    const y = numberOr(input.y, 0);
    const textId = `text-${nanoid()}`;
    const targetId = `${mode}-${nanoid()}`;
    const referenceNodeIds = Array.isArray(input.referenceNodeIds) ? input.referenceNodeIds.filter((id): id is string => typeof id === "string") : [];
    const tokens = [`@[node:${textId}]`, ...referenceNodeIds.map((id) => `@[node:${id}]`)];
    return [
        textNodeOp({ id: textId, text: prompt, title: stringOptional(input.title) || t("canvas:prompt-4") }, x, y),
        generationTargetNodeOp(targetId, { ...input, prompt: tokens.join("\n") }, x + NODE_DEFAULT_SIZE[CanvasNodeType.Text].width + 80, y, config),
        { type: "connect_nodes", fromNodeId: textId, toNodeId: targetId },
        ...referenceNodeIds.map((fromNodeId) => ({ type: "connect_nodes" as const, fromNodeId, toNodeId: targetId })),
        { type: "select_nodes", ids: [targetId] },
        ...(input.autoRun ? [runGenerationOp(targetId, mode, tokens.join("\n"))] : []),
    ];
}

function textNodeOp(input: Record<string, unknown>, x: number, y: number): CanvasAgentOp {
    return {
        type: "add_node",
        id: stringOptional(input.id),
        nodeType: CanvasNodeType.Text,
        title: stringOptional(input.title),
        position: { x, y },
        width: numberOptional(input.width),
        height: numberOptional(input.height),
        metadata: { content: stringOptional(input.text), status: "success", fontSize: 14 },
    };
}

function generationTargetNodeOp(id: string, input: Record<string, unknown>, x: number, y: number, config: AiConfig): CanvasAgentOp {
    const mode = generationMode(input.mode);
    const prompt = stringOptional(input.prompt);
    const nodeType = generationNodeType(mode);
    return {
        type: "add_node",
        id,
        nodeType,
        title: stringOptional(input.title) || generationTitle(mode),
        position: { x, y },
        width: numberOptional(input.width),
        height: numberOptional(input.height),
        metadata: cleanRecord({
            content: "",
            fontSize: nodeType === CanvasNodeType.Text ? 14 : undefined,
            generationMode: mode,
            composerContent: prompt,
            prompt,
            status: "idle",
            model: resolveGenerationModel(config, mode, stringOptional(input.model)),
            size: stringOptional(input.size) || config.size,
            quality: stringOptional(input.quality) || config.quality,
            transparentBackground: stringOptional(input.transparentBackground) || config.transparentBackground,
            count: numberOptional(input.count) ?? generationCount(mode === "image" ? config.canvasImageCount || config.count : config.count),
            seconds: stringOptional(input.seconds) || config.videoSeconds,
            vquality: stringOptional(input.vquality) || config.vquality,
            generateAudio: stringOptional(input.generateAudio) || config.videoGenerateAudio,
            watermark: stringOptional(input.watermark) || config.videoWatermark,
            audioVoice: stringOptional(input.audioVoice) || config.audioVoice,
            audioFormat: stringOptional(input.audioFormat) || config.audioFormat,
            audioSpeed: stringOptional(input.audioSpeed) || config.audioSpeed,
            audioInstructions: stringOptional(input.audioInstructions) || config.audioInstructions,
        }) as CanvasNodeData["metadata"],
    };
}

function generationNodeType(mode: "text" | "image" | "video" | "audio") {
    if (mode === "text") return CanvasNodeType.Text;
    if (mode === "video") return CanvasNodeType.Video;
    if (mode === "audio") return CanvasNodeType.Audio;
    return CanvasNodeType.Image;
}

function runGenerationOp(nodeId: string, mode: "text" | "image" | "video" | "audio", prompt?: string, retry?: boolean): CanvasAgentOp {
    return { type: "run_generation", nodeId, mode, prompt, ...(retry ? { retry: true } : {}) };
}

function isWritableToolCall(call: ResponseToolCall) {
    return !ONLINE_READ_TOOLS.has(call.function.name);
}

function toolCallsFromDetail(detail: Record<string, unknown>): ResponseToolCall[] {
    return Array.isArray(detail.toolCalls) ? (detail.toolCalls.filter(isResponseToolCall) as ResponseToolCall[]) : [];
}

function isResponseToolCall(value: unknown): value is ResponseToolCall {
    const item = objectDetail(value);
    const fn = objectDetail(item.function);
    return typeof item.id === "string" && item.type === "function" && typeof fn.name === "string" && typeof fn.arguments === "string";
}

function toolCallToResponseInput(call: ResponseToolCall): ResponseInputMessage {
    return { type: "function_call", call_id: call.id, name: call.function.name, arguments: call.function.arguments, ...(call.thoughtSignature ? { thoughtSignature: call.thoughtSignature } : {}) };
}

async function requestOnlineAgentModel(config: AiConfig, messages: ResponseInputMessage[], toolChoice: "auto" | "required", prompt: string, onDelta: (text: string) => void, promptCacheKey?: string) {
    if (backendModelRuntimeRequired(config)) {
        const result = await runBackendToolGenerationTask({ prompt, config, messages, tools: ONLINE_AGENT_TOOLS, toolChoice });
        if (result.content.trim()) onDelta(result.content);
        return result;
    }
    return requestToolResponse(config, messages, ONLINE_AGENT_TOOLS, toolChoice, onDelta, { promptCacheKey });
}

function summarizeToolCalls(calls: ResponseToolCall[]) {
    return calls.map((call) => toolCallLabel(call.function.name)).join("，") || t("domain:tool-call");
}

function previewOnlineToolCalls(calls: ResponseToolCall[], snapshot: CanvasAgentSnapshot, config: AiConfig): CanvasAgentOperationImpact {
    const ops: CanvasAgentOp[] = [];
    let deferredCinematicCount = 0;
    calls.filter(isWritableToolCall).forEach((call) => {
        if (call.function.name === "canvas_create_cinematic_session") {
            deferredCinematicCount += 1;
            return;
        }
        try {
            ops.push(...onlineToolToOps(call.function.name, parseToolArguments(call.function.arguments), snapshot, config));
        } catch {
            // 参数错误会在真正执行时显式失败；预览阶段只展示可确定的影响。
        }
    });
    const impact = previewCanvasAgentOps(ops, snapshot);
    if (!deferredCinematicCount) return impact;
    return {
        ...impact,
        operationCount: impact.operationCount + deferredCinematicCount,
        items: [...impact.items, t("domain:skip-3")].slice(0, 8),
        warning: [impact.warning, t("domain:skip-4")].filter(Boolean).join(" "),
    };
}

function toolCallLabel(name: string) {
    if (name === "canvas_apply_ops") return t("canvas:canvas-operation");
    if (name === "canvas_get_state") return t("canvas:read-canvas-2");
    if (name === "canvas_get_selection") return t("canvas:read-selection");
    if (name === "canvas_export_snapshot") return t("canvas:export-snapshot");
    if (name === "canvas_create_cinematic_session") return t("domain:create-film-project");
    if (name === "canvas_create_node") return t("canvas:create-node");
    if (name === "canvas_create_text_node") return t("canvas:create-text");
    if (name === "canvas_create_text_nodes") return t("canvas:batch-create-text");
    if (name === "canvas_create_image_prompt_flow") return t("canvas:create-image-generation-flow");
    if (name === "canvas_create_generation_flow") return t("canvas:create-generation-flow");
    if (name === "canvas_generate_text") return t("canvas:generate-text");
    if (name === "canvas_generate_image") return t("canvas:generate-image");
    if (name === "canvas_generate_video") return t("canvas:generate-video");
    if (name === "canvas_generate_audio") return t("canvas:generate-audio-2");
    if (name === "canvas_update_node") return t("canvas:update-node");
    if (name === "canvas_update_node_text") return t("canvas:update-text");
    if (name === "canvas_move_nodes") return t("canvas:move-node");
    if (name === "canvas_resize_node") return t("canvas:resize-node");
    if (name === "canvas_delete_nodes") return t("canvas:delete-node");
    if (name === "canvas_connect_nodes") return t("canvas:connect-nodes");
    if (name === "canvas_select_nodes") return t("canvas:select-nodes");
    if (name === "canvas_set_viewport") return t("canvas:adjust-viewport");
    if (name === "canvas_run_generation") return t("canvas:trigger-generation");
    return name;
}

function toolResultText(result: OnlineToolResult) {
    return result.message;
}

function requireStringArray(value: unknown, field: string): string[] {
    if (!Array.isArray(value)) throw new Error(t("domain:param-must-be-an-array-of-strings", { field: field }));
    if (!value.every((item) => typeof item === "string" && Boolean(item))) throw new Error(t("domain:param-must-contain-only-non-empty-strings", { field: field }));
    return value as string[];
}

function requireOps(value: unknown): CanvasAgentOp[] {
    if (!Array.isArray(value)) throw new Error(t("domain:ops-must-be-an-array"));
    return value.map(toCanvasAgentOp);
}

function toCanvasAgentOp(value: unknown): CanvasAgentOp {
    const item = objectDetail(value);
    const type = item.type;
    if (type === "add_node") {
        return {
            type,
            id: stringOptional(item.id),
            nodeType: item.nodeType ? requireNodeType(item.nodeType) : undefined,
            title: stringOptional(item.title),
            position: recordOptional(item.position) ? { x: requireNumber(objectDetail(item.position).x, "position.x"), y: requireNumber(objectDetail(item.position).y, "position.y") } : undefined,
            x: numberOptional(item.x),
            y: numberOptional(item.y),
            width: numberOptional(item.width),
            height: numberOptional(item.height),
            metadata: recordOptional(item.metadata) as CanvasNodeData["metadata"],
        };
    }
    if (type === "update_node") return { type, id: requireString(item.id, "id"), patch: recordOptional(item.patch) as Partial<CanvasNodeData> | undefined, metadata: recordOptional(item.metadata) as CanvasNodeData["metadata"] };
    if (type === "delete_node") return { type, id: stringOptional(item.id), ids: Array.isArray(item.ids) ? requireStringArray(item.ids, "ids") : undefined };
    if (type === "delete_connections") return { type, id: stringOptional(item.id), ids: Array.isArray(item.ids) ? requireStringArray(item.ids, "ids") : undefined, all: typeof item.all === "boolean" ? item.all : undefined };
    if (type === "connect_nodes") return { type, id: stringOptional(item.id), fromNodeId: requireString(item.fromNodeId, "fromNodeId"), toNodeId: requireString(item.toNodeId, "toNodeId") };
    if (type === "set_viewport") return { type, viewport: requireViewport(item.viewport) };
    if (type === "select_nodes") return { type, ids: requireStringArray(item.ids, "ids") };
    if (type === "run_generation") return { type, nodeId: requireString(item.nodeId, "nodeId"), mode: generationMode(item.mode), prompt: stringOptional(item.prompt), ...(item.retry === true ? { retry: true } : {}) };
    throw new Error(t("domain:unsupported-canvas-operation-type"));
}

function requireRecordArray(value: unknown, field: string): Record<string, unknown>[] {
    if (!Array.isArray(value)) throw new Error(t("domain:param-must-be-an-array", { field: field }));
    return value.map((item) => {
        const record = objectDetail(item);
        if (!Object.keys(record).length) throw new Error(t("domain:param-must-contain-only-objects", { field: field }));
        return record;
    });
}

function requireString(value: unknown, field: string) {
    if (typeof value !== "string" || !value) throw new Error(t("domain:param-must-be-a-non-empty-string", { field: field }));
    return value;
}

function requireNumber(value: unknown, field: string) {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(t("domain:param-must-be-a-number", { field: field }));
    return value;
}

function requireNodeType(value: unknown): CanvasNodeType {
    if (Object.values(CanvasNodeType).includes(value as CanvasNodeType)) return value as CanvasNodeType;
    throw new Error(t("domain:node-type-must-be-text-image-config-video-or-audio"));
}

function requireViewport(value: unknown) {
    const item = objectDetail(value);
    return { x: requireNumber(item.x, "viewport.x"), y: requireNumber(item.y, "viewport.y"), k: requireNumber(item.k, "viewport.k") };
}

function recordOptional(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stringOptional(value: unknown) {
    return typeof value === "string" ? value : "";
}

function numberOptional(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function numberOr(value: unknown, fallback: number) {
    return numberOptional(value) ?? fallback;
}

function nextCanvasX(snapshot: CanvasAgentSnapshot) {
    return snapshot.nodes.length ? Math.max(...snapshot.nodes.map((node) => node.position.x + node.width)) + 80 : 0;
}

function generationMode(value: unknown): "text" | "image" | "video" | "audio" {
    return value === "text" || value === "video" || value === "audio" ? value : "image";
}

function generationTitle(mode: "text" | "image" | "video" | "audio") {
    if (mode === "text") return t("domain:text-generation");
    if (mode === "video") return t("canvas:video-generation");
    if (mode === "audio") return t("domain:audio-generation");
    return t("canvas:image-generation");
}

function defaultGenerationModel(config: AiConfig, mode: "text" | "image" | "video" | "audio") {
    if (mode === "image") return config.imageModel || config.model;
    if (mode === "video") return config.videoModel || config.model;
    if (mode === "audio") return config.audioModel || config.model;
    return config.textModel || config.model;
}

function resolveGenerationModel(config: AiConfig, mode: "text" | "image" | "video" | "audio", model?: string) {
    const normalized = normalizeModelOptionValue(model, config.channels);
    return normalized && selectableModelsByCapability(config, mode).includes(normalized) ? normalized : defaultGenerationModel(config, mode);
}

function generationCount(value: string) {
    return Math.max(1, Math.min(15, Math.floor(Math.abs(Number(value)) || 1)));
}

function cleanRecord(value: Record<string, unknown>) {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== ""));
}

function snapshotSignature(snapshot: CanvasAgentSnapshot) {
    return JSON.stringify({ nodes: snapshot.nodes, connections: snapshot.connections, selectedNodeIds: snapshot.selectedNodeIds, viewport: snapshot.viewport });
}

function explainNoop(ops: CanvasAgentOp[], snapshot: CanvasAgentSnapshot) {
    if (!ops.length) return t("domain:the-model-returned-no-executable-canvas-operations");
    const nodeIds = new Set(snapshot.nodes.map((node) => node.id));
    const connectionIds = new Set(snapshot.connections.map((conn) => conn.id));
    const deleteConnectionOps = ops.filter((op): op is Extract<CanvasAgentOp, { type: "delete_connections" }> => op.type === "delete_connections");
    const connectOps = ops.filter((op): op is Extract<CanvasAgentOp, { type: "connect_nodes" }> => op.type === "connect_nodes");
    const deleteNodeOps = ops.filter((op): op is Extract<CanvasAgentOp, { type: "delete_node" }> => op.type === "delete_node");
    const updateOps = ops.filter((op): op is Extract<CanvasAgentOp, { type: "update_node" }> => op.type === "update_node");
    const selectOps = ops.filter((op): op is Extract<CanvasAgentOp, { type: "select_nodes" }> => op.type === "select_nodes");
    const generationOps = ops.filter((op): op is Extract<CanvasAgentOp, { type: "run_generation" }> => op.type === "run_generation");
    if (deleteConnectionOps.length && !snapshot.connections.length) return t("domain:this-canvas-has-no-connections-to-delete");
    if (deleteConnectionOps.length && deleteConnectionOps.every((op) => !op.all && [...(op.ids || []), ...(op.id ? [op.id] : [])].every((id) => !connectionIds.has(id)))) return t("domain:no-matching-connection-to-delete");
    if (connectOps.length && connectOps.every((op) => snapshot.connections.some((conn) => conn.fromNodeId === op.fromNodeId && conn.toNodeId === op.toNodeId))) return t("domain:these-nodes-are-already-connected-no-need-to-connect-again");
    if (connectOps.length && connectOps.every((op) => !nodeIds.has(op.fromNodeId) || !nodeIds.has(op.toNodeId))) return t("domain:no-nodes-found-to-connect");
    if (deleteNodeOps.length && deleteNodeOps.every((op) => op.nodeType === CanvasNodeType.Config) && !snapshot.nodes.some((node) => node.type === CanvasNodeType.Config)) return t("domain:this-canvas-has-no-generation-config-nodes-to-delete");
    if (deleteNodeOps.length && deleteNodeOps.every((op) => [...(op.ids || []), ...(op.id ? [op.id] : [])].every((id) => !nodeIds.has(id)))) return t("domain:no-nodes-found-to-delete");
    if (updateOps.length && updateOps.every((op) => !nodeIds.has(op.id))) return t("domain:no-node-found-to-update");
    if (selectOps.length && selectOps.every((op) => !(op.ids || []).some((id) => nodeIds.has(id)))) return t("domain:no-node-found-to-select");
    if (generationOps.length && generationOps.every((op) => !nodeIds.has(op.nodeId))) return t("domain:no-node-found-to-trigger-generation-on");
    if (ops.every((op) => op.type === "set_viewport")) return t("domain:the-view-is-already-in-the-target-state");
    if (selectOps.length && selectOps.every((op) => JSON.stringify(op.ids || []) === JSON.stringify(snapshot.selectedNodeIds))) return t("domain:the-selection-is-already-in-the-target-state");
    return t("domain:tool-executed-but-canvas-state-did-not-change-check-the-log-tab-for-argu");
}

function nodeToReference(node: CanvasNodeData): CanvasAssistantReference | null {
    if (node.type === CanvasNodeType.Image && node.metadata?.content) {
        return { id: node.id, type: node.type, title: node.title, dataUrl: node.metadata.content, storageKey: node.metadata.storageKey };
    }
    if (node.type === CanvasNodeType.Text && node.metadata?.content) {
        return { id: node.id, type: node.type, title: node.title, text: node.metadata.content };
    }
    if (node.type === CanvasNodeType.Skill && node.metadata?.skillSnapshot) {
        return { id: node.id, type: node.type, title: node.title, text: [node.metadata.skillSnapshot.name, node.metadata.skillSnapshot.template, node.metadata.skillSnapshot.outputContract].filter(Boolean).join("\n\n") };
    }
    return null;
}

function buildAssistantReferences(nodes: CanvasNodeData[], selectedNodeIds: Set<string>) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    return Array.from(selectedNodeIds)
        .map((id) => nodeById.get(id))
        .filter((node): node is CanvasNodeData => Boolean(node))
        .map(nodeToReference)
        .filter((item): item is CanvasAssistantReference => Boolean(item));
}

async function buildToolAgentMessages(snapshot: CanvasAgentSnapshot, history: CanvasAssistantMessage[], userMessage: CanvasAssistantMessage): Promise<ResponseInputMessage[]> {
    const refs = userMessage.references || [];
    return [
        { role: "system", content: ONLINE_AGENT_PROMPT },
        ...history
            .filter((message) => message.role === "user" || message.role === "assistant" || message.role === "system")
            .slice(-8)
            .map((message): ResponseInputMessage => ({ role: message.role as "system" | "user" | "assistant", content: message.text })),
        {
            role: "user",
            content: [
                ...refs.flatMap((item) => (item.text ? [{ type: "text" as const, text: t("domain:selected-node-param-param", { title: item.title, text: item.text }) }] : [])),
                { type: "text", text: `当前画布：${JSON.stringify(compactSnapshot(snapshot))}\n\n用户需求：${userMessage.text}` },
                ...(await Promise.all(refs.filter((item) => item.dataUrl).map(async (item) => ({ type: "image_url" as const, image_url: { url: await imageToDataUrl(item) } })))),
            ],
        },
    ];
}

function compactSnapshot(snapshot: CanvasAgentSnapshot) {
    return {
        title: snapshot.title,
        viewport: snapshot.viewport,
        selectedNodeIds: snapshot.selectedNodeIds,
        nodes: snapshot.nodes.map((node) => ({
            id: node.id,
            type: node.type,
            title: node.title,
            position: node.position,
            width: node.width,
            height: node.height,
            metadata: compactMetadata(node.metadata || {}),
        })),
        connections: snapshot.connections,
    };
}

function compactMetadata(metadata: CanvasNodeData["metadata"]) {
    return {
        content: String(metadata?.content || "").slice(0, 500),
        prompt: String(metadata?.prompt || metadata?.composerContent || "").slice(0, 500),
        status: metadata?.status,
        skillName: metadata?.skillSnapshot?.name,
        skillVersion: metadata?.skillSnapshot?.version,
        generationMode: metadata?.generationMode,
        model: metadata?.model,
        size: metadata?.size,
        assetTags: metadata?.assetTags,
        workflowKind: metadata?.workflowKind,
        workflowTitle: metadata?.workflowTitle,
        workflowDescription: metadata?.workflowDescription,
        characterName: metadata?.characterName,
        characterAssetId: metadata?.characterAssetId,
        characterVersionId: metadata?.characterVersionId,
        chapterId: metadata?.chapterId,
        chapterTitle: metadata?.chapterTitle,
        shotIndex: metadata?.shotIndex,
    };
}

function backendAgentProviderConfig(config: ReturnType<typeof resolveModelRequestConfig>) {
    return {
        channelId: config.channelId,
        apiFormat: config.apiFormat,
        interfaceType: config.interfaceType,
        baseUrl: config.baseUrl,
        allowLocalChannel: config.allowLocalChannel === true,
        apiKey: config.apiKey,
        secretKey: config.secretKey,
        model: config.model,
        size: config.size,
        quality: config.quality,
        transparentBackground: config.transparentBackground,
        count: config.count,
        videoSeconds: config.videoSeconds,
        vquality: config.vquality,
        videoGenerateAudio: config.videoGenerateAudio,
        videoWatermark: config.videoWatermark,
        audioVoice: config.audioVoice,
        audioFormat: config.audioFormat,
        audioSpeed: config.audioSpeed,
        audioInstructions: config.audioInstructions,
        systemPrompt: config.systemPrompt,
    };
}

function cinematicSessionMessageId(backendSessionId: string) {
    return `cinematic-session:${backendSessionId}`;
}

function upsertAssistantMessage(messages: CanvasAssistantMessage[], message: CanvasAssistantMessage) {
    const exists = messages.some((item) => item.id === message.id);
    return exists ? messages.map((item) => (item.id === message.id ? { ...item, ...message } : item)) : [...messages, message];
}

function createSession(title: string): CanvasAssistantSession {
    const now = new Date().toISOString();
    return { id: nanoid(), title, messages: [], createdAt: now, updatedAt: now };
}
