import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { App, Button, Segmented, Tooltip } from "antd";
import copyToClipboard from "copy-to-clipboard";
import { Copy, FolderOpen, History, LoaderCircle, MessageSquareText, PlugZap, Plus, RefreshCw, RotateCcw, Terminal, Trash2 } from "lucide-react";
import { motion } from "motion/react";

import { canvasThemes } from "@/lib/canvas-theme";
import { consumeLocalRuntimeEventStream, postCanvasRuntimeState, prepareCanvasRuntimeConnection, waitForCanvasRuntimeReconnect, type LocalRuntimeEvent } from "@/lib/canvas/local-runtime-connection";
import { createClientId } from "@/lib/client-id";
import { getLocalRuntimeSessionClient, useLocalRuntimeStore } from "@/stores/use-local-runtime-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import {
    canvasAgentConnectionStatusText,
    canvasAgentConnectionStartingPatch,
    canvasAgentTransientDisconnectPatch,
    useCanvasAgentStore,
    type AgentAttachment,
    type AgentChatItem,
    type AgentEventLog,
    type AgentPanelTab,
    type AgentPendingToolCall,
    type AgentThreadSummary,
} from "@/stores/canvas/use-canvas-agent-store";
import { previewCanvasAgentOps, summarizeCanvasAgentOps, type CanvasAgentOp, type CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { buildCanvasAgentContext, findCanvasAgentNodes, getCanvasAgentResources, validateCanvasAgentOps } from "@/lib/canvas/canvas-agent-context";
import { buildCanvasResourceReferences } from "@/lib/canvas/canvas-resource-references";
import { listAddedSkills, type Skill } from "@/services/api/skills";
import { isProjectAgentReadTool, isProjectAgentToolName, runProjectAgentTool } from "@/services/api/project-agent-tools";
import { AgentChatComposer, AgentChatMessage, AgentPanelTabs, AgentPendingToolCard, AgentWorkingMessage, type CanvasAgentChatAttachment } from "./canvas-agent-chat-ui";
import { VoiceRecordingButton } from "@/components/conversation/voice-recording-button";
import { AgentChatEmptyState } from "./canvas-agent-panel-chrome";
import { useTranslation } from "react-i18next";
import { t } from "@/i18n";

const PANEL_MOTION_SECONDS = 0.5;
const MAX_ATTACHMENTS = 6;
const MAX_ATTACHMENT_PAYLOAD_BYTES = 28 * 1024 * 1024;
const AGENT_CONNECT_STEPS = [
    { titleKey: "canvas:install-plugin-from-repository", textKey: "canvas:the-plugin-is-not-in-a-public-catalog-yet-add-the-repository-marketplace" },
    { titleKey: "canvas:auto-connect-local-runtime", textKey: "canvas:on-first-use-trusted-framefield-pages-automatically-establish-a-local-se" },
    { titleKey: "canvas:open-canvas-connection", textKey: "canvas:come-back-here-and-click-connect-the-canvas-reuses-the-same-local-runtim" },
];

type AgentEventPayload = {
    agent?: string;
    type?: string;
    thread_id?: string;
    item?: AgentEventItem;
    error?: { message?: string };
    message?: string;
    usage?: Record<string, unknown>;
};
type AgentEventItem = { id?: string; type?: string; text?: unknown; message?: unknown; server?: string; tool?: string; status?: string; arguments?: unknown; result?: unknown; error?: { message?: string } };

type AgentLogContext = { connected: boolean; enabled: boolean; activity: string; waiting: boolean; sending: boolean; messages: number; pendingTool?: string };
type AgentWorkspace = { canvasId: string; workspacePath: string; activeThreadId?: string };
type AgentThreadsResponse = { ok?: boolean; workspace?: AgentWorkspace; data?: AgentThreadSummary[] };
type AgentThreadResponse = { ok?: boolean; workspace?: AgentWorkspace; thread?: AgentThreadSummary; messages?: AgentChatItem[] };

export const CanvasLocalAgentPanel = memo(function CanvasLocalAgentPanel({
    snapshot,
    canUndoOps,
    undoOpsCount = 0,
    collapsed,
    embedded,
    headless,
    autoConnect,
    onApplyOps,
    onUndoOps,
}: {
    snapshot: CanvasAgentSnapshot;
    canUndoOps: boolean;
    undoOpsCount?: number;
    collapsed?: boolean;
    embedded?: boolean;
    headless?: boolean;
    autoConnect?: boolean;
    onApplyOps: (ops: CanvasAgentOp[], context?: { conversationId?: string; messageId?: string; source?: "online" | "local" }) => Promise<CanvasAgentSnapshot>;
    onUndoOps: () => CanvasAgentSnapshot | null;
}) {
    const { t } = useTranslation("canvas");
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const user = useUserStore((state) => state.user);
    const { message, modal } = App.useApp();
    const {
        width,
        connected,
        enabled,
        prompt,
        attachments,
        sending,
        waiting,
        messages,
        eventLogs,
        threads,
        activeThreadId,
        workspacePath,
        loadingThreads,
        activeTab,
        confirmTools,
        activity,
        connectError,
        pendingTool,
        setAgentState,
        addMessage: pushMessage,
        addEventLog: pushEventLog,
        clearEventLogs,
    } = useCanvasAgentStore();
    const [resizing, setResizing] = useState(false);
    const listRef = useRef<HTMLDivElement>(null);
    // 供 Agent 输入框「@」插入的画布节点引用候选（active 标记为可用，供「@」菜单列出），与「/」弹出的已加入技能候选
    const composerReferences = useMemo(() => buildCanvasResourceReferences(snapshot.nodes, snapshot.connections).map((item) => ({ ...item, active: true })), [snapshot]);
    const [composerSkills, setComposerSkills] = useState<Skill[]>([]);
    useEffect(() => {
        let cancelled = false;
        listAddedSkills()
            .then((result) => {
                if (!cancelled) setComposerSkills(result?.skills ?? []);
            })
            .catch(() => {
                // 技能列表加载失败只影响「/」菜单，不影响输入主功能
            });
        return () => {
            cancelled = true;
        };
    }, []);
    const snapshotRef = useRef(snapshot);
    const confirmToolsRef = useRef(confirmTools);
    const pendingToolRef = useRef<AgentPendingToolCall | null>(null);
    const onApplyOpsRef = useRef(onApplyOps);
    const autoConnectRef = useRef(false);
    const connectedRef = useRef(false);
    const errorLoggedRef = useRef(false);
    const attachmentUrlsRef = useRef(new Set<string>());
    const clientIdRef = useRef(createClientId());
    const connectionControllerRef = useRef<AbortController | null>(null);
    const activeToolRequestIdsRef = useRef(new Set<string>());
    const recoveredToolResultIdsRef = useRef(new Set<string>());
    const syncState = useCallback(
        (clientId: string, nextSnapshot: CanvasAgentSnapshot) => {
            void postCanvasRuntimeState(getLocalRuntimeSessionClient(), clientId, nextSnapshot).catch(() => {
                pushEventLog({
                    id: `${Date.now()}-${Math.random()}`,
                    time: new Date().toLocaleTimeString(),
                    title: t("canvas:status-sync-failed"),
                    text: t("canvas:local-runtime-has-not-received-canvas-state-yet"),
                });
            });
        },
        [pushEventLog],
    );
    const loadThreads = useCallback(async () => {
        const projectId = snapshotRef.current.projectId;
        if ((!connectedRef.current && !useCanvasAgentStore.getState().connected) || !projectId) return;
        setAgentState({ loadingThreads: true });
        try {
            const data = await fetchAgentJson<AgentThreadsResponse>(`/agent/codex/threads?canvasId=${encodeURIComponent(projectId)}`);
            const current = useCanvasAgentStore.getState();
            setAgentState({
                threads: data.data || [],
                workspacePath: data.workspace?.workspacePath || current.workspacePath,
                activeThreadId: data.workspace?.activeThreadId || current.activeThreadId,
            });
            const nextThreadId = data.workspace?.activeThreadId || current.activeThreadId;
            if (nextThreadId && !current.messages.length) {
                const thread = await fetchAgentJson<AgentThreadResponse>(`/agent/codex/threads/${encodeURIComponent(nextThreadId)}?canvasId=${encodeURIComponent(projectId)}`);
                setAgentState({ messages: normalizeHistoryMessages(thread.messages || []) });
            }
        } catch (error) {
            addEventLog(t("canvas:failed-to-read-history"), error);
        } finally {
            setAgentState({ loadingThreads: false });
        }
    }, [setAgentState]);

    useEffect(() => {
        snapshotRef.current = snapshot;
    }, [snapshot]);
    useEffect(() => {
        if (!connected) return;
        const clientId = clientIdRef.current;
        snapshot.nodes.forEach((node) => {
            const continuation = node.metadata?.agentGenerationContinuation;
            const requestId = continuation?.source === "local" && continuation.status === "completed" ? continuation.messageId : undefined;
            if (!requestId || activeToolRequestIdsRef.current.has(requestId) || recoveredToolResultIdsRef.current.has(requestId)) return;
            recoveredToolResultIdsRef.current.add(requestId);
            void postToolResult(clientId, { requestId, result: snapshot })
                .then(() => {
                    syncState(clientId, snapshot);
                })
                .catch(() => {
                    recoveredToolResultIdsRef.current.delete(requestId);
                });
        });
    }, [connected, snapshot, syncState]);
    useEffect(() => {
        confirmToolsRef.current = confirmTools;
    }, [confirmTools]);
    useEffect(() => {
        pendingToolRef.current = pendingTool;
    }, [pendingTool]);
    useEffect(() => {
        onApplyOpsRef.current = onApplyOps;
    }, [onApplyOps]);
    useEffect(() => {
        if (activeTab !== "chat") return;
        const frame = requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }));
        return () => cancelAnimationFrame(frame);
    }, [activeTab, activeThreadId, messages, pendingTool, waiting]);
    useEffect(() => () => attachmentUrlsRef.current.forEach((url) => URL.revokeObjectURL(url)), []);

    useEffect(() => {
        if (!enabled) return;
        const controller = new AbortController();
        connectionControllerRef.current = controller;
        const clientId = clientIdRef.current;
        let lastEventId = "";
        const receive = (event: LocalRuntimeEvent) => {
            if (event.id) lastEventId = event.id;
            if (event.type === "hello") {
                errorLoggedRef.current = false;
                connectedRef.current = true;
                setAgentState({ connected: true, activity: t("canvas:connected"), connectError: "", messages: useCanvasAgentStore.getState().messages.filter((item) => !isConnectionErrorMessage(item)) });
                if (!headless) message.success(t("canvas:local-agent-connected"));
                syncState(clientId, snapshotRef.current);
                return;
            }
            if (event.type === "tool_call") {
                const data = parseEventJson<AgentPendingToolCall>(event.data);
                if (data) void handleToolCall(data);
                return;
            }
            if (event.type === "agent_event") {
                const data = parseEventJson<AgentEventPayload>(event.data);
                if (data) handleAgentEvent(data);
                return;
            }
            if (event.type === "agent_log") {
                const text = parseEventJson<{ text?: unknown }>(event.data)?.text;
                addEventLog(t("canvas:logs"), text, text);
                return;
            }
            if (event.type === "agent_error") {
                const errorMessage = parseEventJson<{ message?: unknown }>(event.data)?.message;
                setAgentState({ activity: t("canvas:error"), waiting: false });
                addMessage({ role: "error", title: t("canvas:error-2"), text: normalizeText(errorMessage) });
                addEventLog(t("canvas:error-2"), errorMessage, errorMessage);
                return;
            }
            if (event.type === "agent_done") {
                setAgentState({ activity: t("canvas:done-3"), waiting: false, sending: false });
                void loadThreads();
            }
        };
        void (async () => {
            while (!controller.signal.aborted) {
                try {
                    await prepareCanvasRuntimeConnection(useLocalRuntimeStore, controller.signal);
                    await consumeLocalRuntimeEventStream(getLocalRuntimeSessionClient(), `/events?clientId=${encodeURIComponent(clientId)}`, { signal: controller.signal, lastEventId, onEvent: receive });
                    if (!controller.signal.aborted) throw new Error("Canvas stream closed");
                } catch (error) {
                    if (controller.signal.aborted) return;
                    const wasConnected = connectedRef.current;
                    const text = wasConnected ? t("canvas:local-agent-disconnected-reconnecting") : t("canvas:local-agent-connection-failed-check-your-local-runtime");
                    if (!errorLoggedRef.current || wasConnected) {
                        addEventLog(wasConnected ? t("canvas:disconnected") : t("canvas:connection-failed"), text);
                        if (!headless) message.error(text);
                    }
                    errorLoggedRef.current = true;
                    connectedRef.current = false;
                    setAgentState(canvasAgentTransientDisconnectPatch(wasConnected ? t("canvas:reconnecting") : t("canvas:connection-failed"), text));
                    await waitForCanvasRuntimeReconnect(controller.signal);
                }
            }
        })();
        return () => {
            controller.abort();
            if (connectionControllerRef.current === controller) connectionControllerRef.current = null;
            connectedRef.current = false;
            setAgentState({ connected: false });
        };
    }, [enabled, loadThreads, message, setAgentState, syncState]);

    useEffect(() => {
        if (connected) void loadThreads();
    }, [connected, loadThreads, snapshot.projectId]);

    useEffect(() => {
        if (!connected) return;
        const timer = setTimeout(() => syncState(clientIdRef.current, snapshot), 300);
        return () => clearTimeout(timer);
    }, [connected, snapshot, syncState]);

    const sendPrompt = async (overrideText?: string) => {
        const text = (overrideText ?? prompt).trim();
        const files = attachments;
        const requestPrompt = promptWithAttachments(text, files);
        if (!connected || !requestPrompt || sending || waiting) return;
        if (attachmentPayloadBytes(files) > MAX_ATTACHMENT_PAYLOAD_BYTES) {
            addMessage({ role: "error", title: t("canvas:image-too-large"), text: t("canvas:image-attachments-exceed-30mb-remove-some-before-sending") });
            return;
        }
        setAgentState({ activity: t("canvas:sending"), sending: true, waiting: true });
        addMessage({ role: "user", text: text || t("canvas:sent-images"), attachments: files });
        addEventLog(t("canvas:user-sent"), { text, attachments: files.map(({ name, type, size }) => ({ name, type, size })) });
        try {
            const data = await fetchAgentJson<{ threadId?: string }>("/agent/codex/turn", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ prompt: requestPrompt, canvasId: snapshotRef.current.projectId, threadId: useCanvasAgentStore.getState().activeThreadId || undefined, attachments: files.map(({ name, type, dataUrl }) => ({ name, type, dataUrl })) }),
            });
            if (data.threadId) setAgentState({ activeThreadId: data.threadId });
            addEventLog(t("canvas:local-agent-received"), { accepted: true });
            files.forEach((item) => {
                URL.revokeObjectURL(item.url);
                attachmentUrlsRef.current.delete(item.url);
            });
            setAgentState({ prompt: "", attachments: [] });
        } catch (error) {
            setAgentState({ activity: t("canvas:send-failed"), waiting: false });
            addMessage({ role: "error", title: t("canvas:send-failed"), text: error instanceof Error ? error.message : t("canvas:send-failed") });
            addEventLog(t("canvas:send-failed"), error);
        } finally {
            setAgentState({ sending: false });
        }
    };

    const addAttachments = async (files: FileList | File[] | null) => {
        if (!files) return;
        const images = Array.from(files).filter((file) => file.type.startsWith("image/"));
        const prev = useCanvasAgentStore.getState().attachments;
        try {
            const next = await Promise.all(
                images.slice(0, Math.max(0, MAX_ATTACHMENTS - prev.length)).map(async (file) => {
                    const dataUrl = await readDataUrl(file);
                    const url = URL.createObjectURL(file);
                    attachmentUrlsRef.current.add(url);
                    return { id: createId(), name: file.name, type: file.type, size: file.size, url, dataUrl };
                }),
            );
            const merged = [...prev, ...next];
            if (attachmentPayloadBytes(merged) > MAX_ATTACHMENT_PAYLOAD_BYTES) {
                next.forEach((item) => {
                    URL.revokeObjectURL(item.url);
                    attachmentUrlsRef.current.delete(item.url);
                });
                addMessage({ role: "error", title: t("canvas:image-too-large"), text: t("canvas:image-attachments-are-limited-to-about-30mb") });
                return;
            }
            if (next.length) setAgentState({ attachments: merged });
        } catch (error) {
            addMessage({ role: "error", title: t("canvas:failed-to-read-image"), text: error instanceof Error ? error.message : t("canvas:failed-to-read-image") });
        }
    };

    const removeAttachment = (id: string) => {
        const removed = attachments.find((item) => item.id === id);
        if (removed) {
            URL.revokeObjectURL(removed.url);
            attachmentUrlsRef.current.delete(removed.url);
        }
        setAgentState({ attachments: attachments.filter((item) => item.id !== id) });
    };

    const handleToolCall = async (payload: AgentPendingToolCall) => {
        if (confirmToolsRef.current && (payload.name === "canvas_apply_ops" || (isProjectAgentToolName(payload.name) && !isProjectAgentReadTool(payload.name)))) {
            if (pendingToolRef.current) {
                await postToolResult(clientIdRef.current, { requestId: payload.requestId, error: t("canvas:canvas-tool-calls-still-awaiting-confirmation") });
                return;
            }
            pendingToolRef.current = payload;
            setAgentState({ pendingTool: payload, activity: t("canvas:awaiting-confirmation-2"), waiting: false });
            addEventLog(t("canvas:awaiting-confirmation-2"), payload, payload);
            return;
        }
        await runToolCall(payload);
    };

    const runToolCall = async (payload: AgentPendingToolCall) => {
        activeToolRequestIdsRef.current.add(payload.requestId);
        try {
            const input = (payload.input || {}) as Record<string, unknown>;
            const projectToolName = isProjectAgentToolName(payload.name) ? payload.name : null;
            setAgentState({ activity: payload.name === "canvas_apply_ops" ? t("canvas:running-canvas-operation") : projectToolName ? t("canvas:running-project-tool") : t("canvas:read-canvas-2"), waiting: true });
            addEventLog(toolName(payload.name), payload, payload);
            const result =
                payload.name === "canvas_apply_ops"
                    ? await onApplyOpsRef.current((input.ops || []) as CanvasAgentOp[], { source: "local", conversationId: activeThreadId || clientIdRef.current, messageId: payload.requestId })
                    : payload.name === "canvas_get_context"
                      ? buildCanvasAgentContext(snapshotRef.current)
                      : payload.name === "canvas_find_nodes"
                        ? findCanvasAgentNodes(snapshotRef.current, input as Parameters<typeof findCanvasAgentNodes>[1])
                        : payload.name === "canvas_get_resources"
                          ? getCanvasAgentResources(snapshotRef.current, input as Parameters<typeof getCanvasAgentResources>[1])
                          : payload.name === "canvas_validate_ops"
                            ? validateCanvasAgentOps(snapshotRef.current, (input.ops || []) as CanvasAgentOp[])
                            : projectToolName
                              ? await runProjectAgentTool(projectToolName, input, snapshotRef.current.domainProjectId)
                              : snapshotRef.current;
            await postToolResult(clientIdRef.current, { requestId: payload.requestId, result });
            if (payload.name === "canvas_apply_ops") syncState(clientIdRef.current, result as CanvasAgentSnapshot);
            setAgentState({ activity: t("canvas:tool-finished"), waiting: true });
            addEventLog(t("canvas:tool-call-finished-name", { name: toolName(payload.name) }), result, result);
            addMessage({
                role: "tool",
                title: t("canvas:tool-call-finished-name", { name: toolName(payload.name) }),
                text: payload.name === "canvas_apply_ops" ? summarizeCanvasAgentOps((input.ops || []) as CanvasAgentOp[]) || t("canvas:canvas-operation") : t("canvas:done-2"),
                detail: { requestId: payload.requestId, name: payload.name, input, result },
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : t("canvas:canvas-operation-failed");
            setAgentState({ activity: t("canvas:tool-failed"), waiting: false });
            addMessage({ role: "tool", title: t("canvas:tool-failed"), text: message, detail: payload });
            await postToolResult(clientIdRef.current, { requestId: payload.requestId, error: message });
        } finally {
            activeToolRequestIdsRef.current.delete(payload.requestId);
        }
    };

    const rejectPendingTool = async () => {
        if (!pendingTool) return;
        await postToolResult(clientIdRef.current, { requestId: pendingTool.requestId, error: t("canvas:user-cancelled-the-canvas-tool-call") });
        setAgentState({ activity: t("canvas:cancelled"), waiting: false });
        addMessage({ role: "tool", title: t("canvas:declined-2"), text: toolName(pendingTool.name), detail: { requestId: pendingTool.requestId, name: pendingTool.name, input: pendingTool.input } });
        pendingToolRef.current = null;
        setAgentState({ pendingTool: null });
    };

    const approvePendingTool = async () => {
        if (!pendingTool) return;
        const tool = pendingTool;
        pendingToolRef.current = null;
        setAgentState({ pendingTool: null });
        await runToolCall(tool);
    };

    const undoLastTool = () => {
        const restored = onUndoOps();
        if (!restored) return;
        setAgentState({ activity: t("canvas:undone") });
        addMessage({ role: "tool", title: t("canvas:agent-batch-undone"), text: t("canvas:canvas-restored-to-its-state-before-this-write-back"), detail: restored });
        if (connected) syncState(clientIdRef.current, restored);
    };

    const toggleAgentConnection = () => {
        if (enabled) {
            connectionControllerRef.current?.abort();
            pendingToolRef.current = null;
            setAgentState({ enabled: false, connected: false, activity: t("canvas:offline"), connectError: "", waiting: false, sending: false, pendingTool: null });
            return;
        }
        errorLoggedRef.current = false;
        setAgentState(canvasAgentConnectionStartingPatch());
    };

    useEffect(() => {
        if (!autoConnect || autoConnectRef.current || enabled || connected) return;
        autoConnectRef.current = true;
        void toggleAgentConnection();
    }, [autoConnect, connected, enabled]);

    const startNewThread = async () => {
        const projectId = snapshotRef.current.projectId;
        if (!connected || !projectId) return;
        setAgentState({ loadingThreads: true });
        try {
            const data = await fetchAgentJson<AgentThreadResponse>("/agent/codex/threads/new", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ canvasId: projectId }) });
            setAgentState({ activeThreadId: data.thread?.id || data.workspace?.activeThreadId || "", messages: [], activeTab: "chat", activity: t("canvas:new-conversation-2") });
            await loadThreads();
        } catch (error) {
            addEventLog(t("canvas:failed-to-start-conversation"), error);
            message.error(error instanceof Error ? error.message : t("canvas:failed-to-start-conversation"));
        } finally {
            setAgentState({ loadingThreads: false });
        }
    };

    const resumeThread = async (threadId: string) => {
        const projectId = snapshotRef.current.projectId;
        if (!connected || !projectId || !threadId) return;
        setAgentState({ loadingThreads: true });
        try {
            const data = await fetchAgentJson<AgentThreadResponse>(`/agent/codex/threads/${encodeURIComponent(threadId)}/resume`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ canvasId: projectId }) });
            setAgentState({ activeThreadId: data.thread?.id || threadId, messages: normalizeHistoryMessages(data.messages || []), activeTab: "chat", activity: t("canvas:session-restored") });
            await loadThreads();
        } catch (error) {
            addEventLog(t("canvas:failed-to-restore-conversation"), error);
            message.error(error instanceof Error ? error.message : t("canvas:failed-to-restore-conversation"));
        } finally {
            setAgentState({ loadingThreads: false });
        }
    };

    const deleteThread = async (threadId: string) => {
        const projectId = snapshotRef.current.projectId;
        if (!connected || !projectId || !threadId) return;
        setAgentState({ loadingThreads: true });
        try {
            await fetchAgentJson(`/agent/codex/threads/${encodeURIComponent(threadId)}/delete`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ canvasId: projectId }) });
            const current = useCanvasAgentStore.getState();
            setAgentState({
                threads: current.threads.filter((thread) => thread.id !== threadId),
                activeThreadId: current.activeThreadId === threadId ? "" : current.activeThreadId,
                messages: current.activeThreadId === threadId ? [] : current.messages,
            });
            message.success(t("canvas:record-deleted"));
        } catch (error) {
            addEventLog(t("canvas:failed-to-delete-conversation"), error);
            message.error(error instanceof Error ? error.message : t("canvas:failed-to-delete-conversation"));
        } finally {
            setAgentState({ loadingThreads: false });
        }
    };

    const confirmDeleteThread = (thread: AgentThreadSummary) => {
        const label = thread.name || thread.preview || t("canvas:untitled-conversation");
        modal.confirm({
            title: t("canvas:delete-conversation-record"),
            content: t("canvas:confirm-delete-conversation-label", { label: label.length > 48 ? `${label.slice(0, 48)}...` : label }),
            okText: t("canvas:delete-5"),
            okType: "danger",
            cancelText: t("canvas:cancel-11"),
            onOk: () => deleteThread(thread.id),
        });
    };

    const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = width;
        let nextWidth = startWidth;
        const onMove = (moveEvent: PointerEvent) => {
            nextWidth = clamp(startWidth + startX - moveEvent.clientX, 360, 760);
            setAgentState({ width: nextWidth });
        };
        const onUp = () => {
            localStorage.setItem("canvas-agent-panel-width", String(nextWidth));
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            setResizing(false);
        };
        setResizing(true);
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    };

    const addMessage = (item: Omit<AgentChatItem, "id">) => {
        const text = normalizeText(item.text);
        if (!text && !item.attachments?.length) return;
        const next = { ...item, id: `${Date.now()}-${Math.random()}`, text };
        const currentMessages = useCanvasAgentStore.getState().messages;
        if (next.streamId) {
            const index = currentMessages.findIndex((message) => message.streamId === next.streamId);
            if (index >= 0) {
                setAgentState({ messages: currentMessages.map((message, i) => (i === index ? { ...message, ...next, id: message.id, text: next.text || message.text } : message)) });
                return;
            }
        }
        const last = currentMessages.at(-1);
        if (last?.role === "assistant" && next.role === "assistant" && last.title === next.title) {
            const merged = mergeAgentText(last.text, next.text);
            if (merged === last.text) return;
            setAgentState({ messages: [...useCanvasAgentStore.getState().messages.slice(0, -1), { ...last, text: merged, meta: next.meta || last.meta }] });
            return;
        }
        pushMessage(next);
    };

    const addEventLog = (title: string, text: unknown, raw?: unknown) => {
        pushEventLog({ id: `${Date.now()}-${Math.random()}`, time: new Date().toLocaleTimeString(), title, text: normalizeText(text) || title, raw });
    };

    const handleAgentEvent = (event: AgentEventPayload) => {
        if (shouldLogAgentEvent(event)) addEventLog(eventTitle(event), event, event);
        if (event.type === "thread.started" && event.thread_id) setAgentState({ activeThreadId: event.thread_id });
        const nextActivity = activityText(event);
        if (nextActivity) setAgentState({ activity: nextActivity });
        if (event.type === "turn.started") setAgentState({ waiting: true });
        if (event.type === "turn.completed" || event.type === "turn.failed" || event.type === "error") setAgentState({ waiting: false, sending: false });
        const item = formatAgentEvent(event);
        if (item) {
            if (item.role === "error") setAgentState({ waiting: false, sending: false });
            addMessage(item);
        }
    };

    const content = (
        <>
            <AgentPanelTabs
                value={activeTab}
                theme={theme}
                items={[
                    { value: "setup", label: t("canvas:connect-2"), icon: <PlugZap className="size-3.5" /> },
                    { value: "chat", label: t("canvas:conversations-2"), icon: <MessageSquareText className="size-3.5" /> },
                    { value: "history", label: t("canvas:history-2"), icon: <History className="size-3.5" />, count: threads.length },
                    { value: "log", label: t("canvas:logs"), icon: <Terminal className="size-3.5" />, count: eventLogs.length },
                ]}
                onChange={(activeTab) => {
                    setAgentState({ activeTab });
                    if (activeTab === "history") void loadThreads();
                }}
                right={
                    <>
                        <Tooltip title={undoOpsCount ? t("canvas:undo-the-latest-agent-write-back-param-batches-undoable", { undoOpsCount: undoOpsCount }) : t("canvas:no-agent-write-back-to-undo")}>
                            <Button size="small" type="text" className="!h-8 !w-8 !min-w-8" disabled={!canUndoOps} icon={<RotateCcw className="size-3.5" />} onClick={undoLastTool} aria-label={t("canvas:undo-the-latest-agent-write-back")} />
                        </Tooltip>
                    </>
                }
            />

            {activeTab === "setup" ? (
                <AgentConnectView theme={theme} enabled={enabled} connected={connected} activity={activity} connectError={connectError} onToggleEnabled={toggleAgentConnection} />
            ) : activeTab === "history" ? (
                <AgentHistoryView
                    theme={theme}
                    threads={threads}
                    activeThreadId={activeThreadId}
                    workspacePath={workspacePath}
                    loading={loadingThreads}
                    connected={connected}
                    onRefresh={() => void loadThreads()}
                    onNewThread={() => void startNewThread()}
                    onResumeThread={(threadId) => void resumeThread(threadId)}
                    onDeleteThread={confirmDeleteThread}
                />
            ) : activeTab === "log" ? (
                <AgentLogView
                    logs={eventLogs}
                    theme={theme}
                    context={{ connected, enabled, activity, waiting, sending, messages: messages.length, pendingTool: pendingTool?.name }}
                    onClear={clearEventLogs}
                    onCopied={(text) => message.success(text)}
                    onCopyBlocked={(text) => message.warning(text)}
                />
            ) : (
                <>
                    <div ref={listRef} className="thin-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                        {!messages.length && !pendingTool && !waiting ? (
                            <AgentChatEmptyState
                                theme={theme}
                                nodeCount={snapshot.nodes.length}
                                onSelect={(text) => {
                                    setAgentState({ prompt: text });
                                    void sendPrompt(text);
                                }}
                            />
                        ) : null}
                        {messages.map((item) => (
                            <AgentChatMessage key={item.id} item={agentMessageToChatMessage(item)} theme={theme} user={user} isStreaming={(sending || waiting) && item.id === messages.at(-1)?.id && item.role === "assistant"} />
                        ))}
                        {pendingTool ? (
                            <AgentPendingToolCard
                                summary={summarizeCanvasAgentOps(pendingTool.input?.ops || []) || toolName(pendingTool.name)}
                                detail={{ requestId: pendingTool.requestId, name: pendingTool.name, input: pendingTool.input, impact: previewCanvasAgentOps(pendingTool.input?.ops || [], snapshot) }}
                                theme={theme}
                                onReject={rejectPendingTool}
                                onApprove={approvePendingTool}
                            />
                        ) : null}
                        {waiting && !pendingTool ? <AgentWorkingMessage theme={theme} /> : null}
                    </div>
                    <AgentChatComposer
                        prompt={prompt}
                        attachments={attachments.map(agentAttachmentToChatAttachment)}
                        disabled={!connected}
                        sending={sending || waiting}
                        placeholder={t("canvas:ask-codex-or-let-it-operate-the-canvas")}
                        theme={theme}
                        references={composerReferences}
                        slashSkills={composerSkills}
                        includeAssetLibrary
                        onPromptChange={(prompt) => setAgentState({ prompt })}
                        onSubmit={sendPrompt}
                        onAddFiles={addAttachments}
                        onRemoveAttachment={removeAttachment}
                        left={
                            <>
                                <VoiceRecordingButton disabled={!connected || sending || waiting} onTranscribed={(text) => setAgentState({ prompt: prompt.trim() ? `${prompt} ${text}` : text })} />
                                {attachments.length ? (
                                    <span className="text-[var(--fs-label)]" style={{ color: theme.node.muted }}>
                                        {formatBytes(attachmentPayloadBytes(attachments))} / 30MB
                                    </span>
                                ) : null}
                            </>
                        }
                    />
                </>
            )}
        </>
    );

    if (headless) return null;
    if (embedded) return content;

    return (
        <motion.div
            className="relative z-[var(--z-panel-floating)] flex h-full shrink-0"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: collapsed ? 0 : width + 1, opacity: collapsed ? 0 : 1 }}
            transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: "clip", pointerEvents: collapsed ? "none" : undefined }}
        >
            <motion.aside
                className="relative flex h-full shrink-0 flex-col border-l"
                initial={{ x: 48 }}
                animate={{ x: collapsed ? 28 : 0 }}
                transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: [0.22, 1, 0.36, 1] }}
                style={{ width, background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            >
                <div className="absolute left-0 top-0 h-full w-1 cursor-col-resize transition hover:bg-current/20" onPointerDown={startResize} />
                {content}
            </motion.aside>
        </motion.div>
    );
});

function AgentLogView({
    logs,
    theme,
    context,
    onClear,
    onCopied,
    onCopyBlocked,
}: {
    logs: AgentEventLog[];
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    context: AgentLogContext;
    onClear: () => void;
    onCopied: (text: string) => void;
    onCopyBlocked: (text: string) => void;
}) {
    const { t } = useTranslation("canvas");
    const [mode, setMode] = useState<"text" | "json">("text");
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const content = mode === "text" ? formatLogText(logs, context) : formatLogJson(logs, context);
    const lastError = [...logs].reverse().find((item) => /error|failed/i.test(`${item.title}\n${item.text}`));
    const copy = async (value = content, tip = t("canvas:log-copied")) => {
        if (await copyToClipboard(value)) {
            onCopied(tip);
            return;
        }
        textareaRef.current?.focus();
        textareaRef.current?.select();
        onCopyBlocked(t("canvas:log-selected-copy-it-manually"));
    };
    return (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
            <div className="flex min-h-full flex-col gap-3">
                <div>
                    <div className="text-base font-semibold leading-6">{t("canvas:run-log")}</div>
                </div>
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
                        <Button size="small" icon={<Copy className="size-3.5" />} onClick={() => void copy()}>
                            {t("canvas:copy-4")}
                        </Button>
                        <Button size="small" disabled={!lastError} onClick={() => lastError && void copy(formatLogText([lastError], context), t("canvas:latest-error-copied"))}>
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
        </div>
    );
}

function AgentConnectView({
    theme,
    enabled,
    connected,
    activity,
    connectError,
    onToggleEnabled,
}: {
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    enabled: boolean;
    connected: boolean;
    activity: string;
    connectError: string;
    onToggleEnabled: () => void;
}) {
    const { t } = useTranslation("canvas");
    const statusText = canvasAgentConnectionStatusText({ enabled, connected, activity, connectError });
    // statusText 可能携带历史渲染文案，保留原文比对
    const statusColor = statusText === t("domain:connection-failed") || statusText === t("canvas:local-agent-connection-failed") ? "#dc2626" : connected ? "#16a34a" : enabled ? "#d97706" : theme.node.muted;
    return (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
            <div className="space-y-4">
                <div>
                    <div className="text-base font-semibold leading-6">{t("canvas:connect-local-agent")}</div>
                    <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                        {t("canvas:after-installing-the-bundled-codex-plugin-the-canvas-auto-connects-to-th")}
                    </div>
                </div>
                <div className="space-y-2">
                    {AGENT_CONNECT_STEPS.map((step) => (
                        <div key={step.titleKey} className="rounded-lg px-3 py-2.5">
                            <div className="text-sm font-medium leading-5">{t(step.titleKey)}</div>
                            <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                                {t(step.textKey)}
                            </div>
                        </div>
                    ))}
                </div>
                <div className="rounded-md p-3" style={{ background: theme.spatial.surface }}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-2">
                                <span className="shrink-0 text-sm font-medium leading-5">{t("canvas:web-connection")}</span>
                                <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[var(--fs-label)] leading-4" style={{ background: theme.node.fill, color: statusColor }}>
                                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: statusColor }} />
                                    <span className="truncate">{statusText}</span>
                                </span>
                            </div>
                            <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                                {t("canvas:reuses-the-short-lived-secure-session-created-under-settings-local-tools")}
                            </div>
                        </div>
                        <Button className="!h-8 !px-3" type={enabled ? "default" : "primary"} icon={<PlugZap className="size-4" />} onClick={onToggleEnabled}>
                            {enabled ? t("canvas:disconnect") : t("canvas:connect-2")}
                        </Button>
                    </div>
                    <div className="mt-3 grid gap-2.5">
                        {connectError ? (
                            <div className="rounded-md px-2.5 py-2 text-xs leading-5" style={{ background: "rgba(220,38,38,.08)", color: "#dc2626" }}>
                                {connectError}
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>
        </div>
    );
}

function AgentHistoryView({
    theme,
    threads,
    activeThreadId,
    workspacePath,
    loading,
    connected,
    onRefresh,
    onNewThread,
    onResumeThread,
    onDeleteThread,
}: {
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    threads: AgentThreadSummary[];
    activeThreadId: string;
    workspacePath: string;
    loading: boolean;
    connected: boolean;
    onRefresh: () => void;
    onNewThread: () => void;
    onResumeThread: (threadId: string) => void;
    onDeleteThread: (thread: AgentThreadSummary) => void;
}) {
    const { t } = useTranslation("canvas");
    return (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
            <div className="space-y-3">
                <div className="flex min-w-0 items-center gap-2 text-xs" style={{ color: theme.node.muted }}>
                    <FolderOpen className="size-3.5 shrink-0" />
                    <span className="shrink-0">{t("canvas:workspace")}</span>
                    <span className="min-w-0 truncate" title={workspacePath}>
                        {workspacePath || t("canvas:default-canvas-directory")}
                    </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm" style={{ color: theme.node.muted }}>
                        {threads.length ? t("canvas:param-entries", { length: threads.length }) : connected ? t("canvas:no-history-yet-2") : t("canvas:not-connected")}
                    </div>
                    <div className="flex items-center gap-2">
                        <Button size="small" icon={<RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />} disabled={!connected || loading} onClick={onRefresh}>
                            {t("canvas:refresh")}
                        </Button>
                        <Button size="small" type="primary" icon={<Plus className="size-3.5" />} disabled={!connected || loading} onClick={onNewThread}>
                            {t("canvas:new-conversation-2")}
                        </Button>
                    </div>
                </div>
                <div className="space-y-2">
                    {threads.map((thread) => {
                        const active = thread.id === activeThreadId;
                        return (
                            <div key={thread.id} className="rounded-md px-2.5 py-2 transition-colors" style={{ background: active ? theme.accent.primarySoft : "transparent", color: theme.node.text }}>
                                <div className="flex items-center gap-2">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex min-w-0 items-center gap-1.5">
                                            {active ? (
                                                <span className="shrink-0 text-[var(--fs-tiny)] font-medium" style={{ color: theme.node.text }}>
                                                    {t("canvas:current-4")}
                                                </span>
                                            ) : null}
                                            <div className="truncate text-sm font-medium leading-5">{thread.name || thread.preview || t("canvas:untitled-conversation")}</div>
                                        </div>
                                        <div className="truncate text-[var(--fs-label)] leading-4 opacity-65">{thread.preview || thread.id}</div>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1">
                                        <span className="text-[var(--fs-tiny)] opacity-55">{formatThreadTime(thread.updatedAt || thread.createdAt)}</span>
                                        <Button size="small" className="!h-6 !px-2" disabled={loading} onClick={() => onResumeThread(thread.id)}>
                                            {t("canvas:enter-2")}
                                        </Button>
                                        <Tooltip title={t("canvas:delete-record")}>
                                            <Button size="small" danger type="text" className="!h-6 !w-6 !min-w-6" disabled={loading} icon={<Trash2 className="size-3.5" />} onClick={() => onDeleteThread(thread)} />
                                        </Tooltip>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                    {!threads.length ? (
                        <div className="px-3 py-8 text-center text-sm" style={{ color: theme.node.muted }}>
                            {connected ? t("canvas:no-conversations-in-this-workspace-yet") : t("canvas:history-appears-after-connecting-the-local-agent")}
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

async function postToolResult(clientId: string, body: { requestId: string; result?: unknown; error?: string }) {
    const response = await getLocalRuntimeSessionClient().request(`/canvas/result?clientId=${encodeURIComponent(clientId)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(t("canvas:tool-result-write-back-failed"));
}

function agentMessageToChatMessage(item: AgentChatItem) {
    return { ...item, attachments: item.attachments?.map(agentAttachmentToChatAttachment) };
}

function agentAttachmentToChatAttachment(item: AgentAttachment): CanvasAgentChatAttachment {
    return { id: item.id, name: item.name, url: item.dataUrl || item.url };
}

function formatAgentEvent(event: AgentEventPayload): Omit<AgentChatItem, "id"> | null {
    const { t } = useTranslation("canvas");
    const item = event.item;
    if (event.type === "item.completed" && item?.type === "error") return { role: "error", title: t("canvas:error-2"), text: normalizeText(item.message), detail: item };
    if ((event.type === "item.updated" || event.type === "item.completed") && item?.type === "agent_message") return { role: "assistant", title: "Codex", text: stringText(item.text), meta: usageText(event), streamId: item.id };
    if (event.type === "item.completed" && isMcpToolItem(item) && isReadTool(String(item?.tool || "")))
        return { role: "tool", title: t("canvas:tool-call-finished-name", { name: toolName(String(item?.tool || "")) }), text: item?.error?.message || toolSummary(item), detail: toolDetail(item) };
    const text = eventText(event);
    if (text) return { role: "assistant", title: "Codex", text, meta: usageText(event) };
    return null;
}

function parseEventJson<T>(data: string) {
    try {
        return JSON.parse(data) as T;
    } catch {
        return null;
    }
}

function formatLogText(logs: AgentEventLog[], context: AgentLogContext) {
    const { t } = useTranslation("canvas");
    const head = [
        t("canvas:yingce-canvas-agent-diagnostics-log"),
        t("canvas:connection-status-activity", { activity: context.connected ? t("canvas:online") : context.enabled ? t("canvas:connecting") : t("canvas:not-enabled") }),
        t("canvas:status-param", { activity: context.activity }),
        `waiting: ${context.waiting}`,
        `sending: ${context.sending}`,
        `messages: ${context.messages}`,
        `pendingTool: ${context.pendingTool ? toolName(context.pendingTool) : "none"}`,
        `logs: ${logs.length}`,
    ].join("\n");
    const body = logs
        .map((item, index) => {
            const detail = item.raw == null ? item.text : JSON.stringify(item.raw, null, 2);
            return [`#${index + 1} ${item.time} ${item.title}`, detail].filter(Boolean).join("\n");
        })
        .join("\n\n---\n\n");
    return [head, body || t("canvas:no-event-logs-yet")].join("\n\n");
}

function formatLogJson(logs: AgentEventLog[], context: AgentLogContext) {
    return JSON.stringify({ context, logs: logs.map(({ time, title, text, raw }) => ({ time, title, text, raw })) }, null, 2);
}

function eventText(event: AgentEventPayload) {
    return event.type === "item.completed" && event.item?.type === "agent_message" ? stringText(event.item.text) : "";
}

function usageText(event: AgentEventPayload) {
    const usage = event.usage;
    if (!usage || typeof usage !== "object") return undefined;
    const total = numberField(usage, "total_tokens");
    const input = numberField(usage, "input_tokens");
    const output = numberField(usage, "output_tokens");
    if (total) return `${total} tok`;
    if (input || output) return `${input || 0}/${output || 0} tok`;
    return undefined;
}

function activityText(event: AgentEventPayload) {
    const { t } = useTranslation("canvas");
    const name = event.type || "";
    if (name === "thread.started") return t("canvas:session-created");
    if (name === "turn.started") return t("canvas:thinking");
    if (name === "turn.completed") return t("canvas:done-3");
    if (name === "turn.failed" || name === "error") return t("canvas:error");
    if (name === "item.started") return isMcpToolItem(event.item) ? t("canvas:calling-tool-name", { name: toolName(String(event.item?.tool || "")) }) : t("canvas:execution-steps");
    if (name === "item.completed") return isMcpToolItem(event.item) ? t("canvas:tool-finished") : t("canvas:message-updated");
    return "";
}

function eventTitle(event: AgentEventPayload) {
    const { t } = useTranslation("canvas");
    const item = event.item;
    if (event.type === "thread.started") return t("canvas:codex-session-created");
    if (event.type === "turn.started") return t("canvas:started-processing");
    if (event.type === "turn.completed") return t("canvas:turn-finished");
    if (event.type === "stream.summary") return t("canvas:streaming-summary");
    if (event.type === "turn.failed" || event.type === "error") return t("canvas:turn-failed");
    if (event.type === "item.started" && isMcpToolItem(item)) return t("canvas:calling-tool-name", { name: toolName(String(item?.tool || "")) });
    if (event.type === "item.completed" && isMcpToolItem(item)) return t("canvas:tool-finished-name", { name: toolName(String(item?.tool || "")) });
    if (event.type === "item.completed" && item?.type === "agent_message") return t("canvas:codex-reply");
    return event.type || t("canvas:codex-event");
}

function shouldLogAgentEvent(event: AgentEventPayload) {
    const itemType = event.item?.type || "";
    return !["item.updated"].includes(event.type || "") && !["reasoning"].includes(itemType) && !(event.type === "item.started" && itemType === "agent_message");
}

function isConnectionErrorMessage(item: AgentChatItem) {
    const phrases = [t("domain:connection-failed"), t("canvas:local-agent-connection-failed"), t("canvas:local-agent-connection-failed-check-your-local-runtime")];
    return item.role === "error" && phrases.some((phrase) => item.text.includes(phrase));
}

function toolName(name: string) {
    const { t } = useTranslation("canvas");
    if (name === "canvas_apply_ops") return t("canvas:canvas-operation");
    if (name === "canvas_get_state") return t("canvas:read-canvas-2");
    if (name === "canvas_get_selection") return t("canvas:read-selection");
    if (name === "canvas_export_snapshot") return t("canvas:export-snapshot");
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
    if (name === "project_get_context") return t("canvas:read-project-context");
    if (name === "project_list_units") return t("canvas:read-project-chapters");
    if (name === "project_extract_asset_candidates") return t("canvas:register-asset-candidates");
    if (name === "project_confirm_asset_candidate") return t("canvas:confirm-asset-candidates");
    if (name === "project_create_or_update_shots") return t("canvas:save-project-shots");
    if (name === "project_link_shot_asset") return t("canvas:link-shot-assets");
    if (name === "project_start_workflow_step") return t("canvas:start-pipeline-step");
    if (name === "project_link_asset") return t("canvas:reference-project-assets-2");
    if (name === "project_upsert_asset_version") return t("canvas:create-asset-version");
    if (name === "project_register_task_output") return t("canvas:register-task-artifacts");
    return name;
}

function isReadTool(name: string) {
    return name === "canvas_get_state" || name === "canvas_get_selection" || name === "canvas_export_snapshot" || isProjectAgentReadTool(name);
}

function isMcpToolItem(item?: AgentEventItem) {
    return item?.type === "mcp_tool_call";
}

function toolDetail(item?: AgentEventItem) {
    return { server: item?.server, tool: item?.tool, status: item?.status, arguments: item?.arguments, result: parseToolResult(item?.result), error: item?.error };
}

function toolSummary(item?: AgentEventItem) {
    const { t } = useTranslation("canvas");
    const result = parseToolResult(item?.result);
    const nodeField = objectField(result, "nodes");
    const connectionField = objectField(result, "connections");
    const nodes = Array.isArray(nodeField) ? nodeField : [];
    const connections = Array.isArray(connectionField) ? connectionField : [];
    if (Array.isArray(nodeField) || Array.isArray(connectionField)) return t("canvas:read-param-nodes-and-param-connections", { length: nodes.length, length_1: connections.length });
    return t("canvas:tool-call-finished");
}

function parseToolResult(result: unknown) {
    const content = objectField(result, "content");
    const text = Array.isArray(content)
        ? content
              .map((item) => objectField(item, "text"))
              .filter((item): item is string => typeof item === "string")
              .join("\n")
        : "";
    try {
        return text ? JSON.parse(text) : result;
    } catch {
        return text || result;
    }
}

function normalizeText(value: unknown) {
    if (typeof value === "string") return value.trim();
    if (value instanceof Error) return value.message;
    if (value == null) return "";
    return JSON.stringify(value, null, 2);
}

function stringText(value: unknown) {
    return typeof value === "string" ? value : "";
}

function objectField(value: unknown, key: string) {
    return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

function numberField(value: unknown, key: string) {
    const field = objectField(value, key);
    return typeof field === "number" ? field : 0;
}

function mergeAgentText(prev: string, next: string) {
    if (!next || prev === next || prev.endsWith(next)) return prev;
    if (next.startsWith(prev)) return next;
    for (let size = Math.min(prev.length, next.length); size > 0; size--) {
        if (prev.endsWith(next.slice(0, size))) return `${prev}${next.slice(size)}`;
    }
    const half = Math.floor(prev.length / 2);
    if (prev.length > 12 && next.length > 12 && prev.slice(half) === next.slice(0, prev.length - half)) return prev;
    return `${prev}${next}`;
}

function promptWithAttachments(text: string, attachments: AgentAttachment[]) {
    const { t } = useTranslation("canvas");
    if (!attachments.length) return text;
    const names = attachments.map((item) => item.name).join("、");
    return [text, t("canvas:user-uploaded-param-image-attachments-param", { length: attachments.length, names: names })].filter(Boolean).join("\n\n");
}

function attachmentPayloadBytes(attachments: AgentAttachment[]) {
    return attachments.reduce((total, item) => total + item.dataUrl.length, 0);
}

function formatBytes(bytes: number) {
    return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.ceil(bytes / 1024)}KB`;
}

async function fetchAgentJson<T>(path: string, init?: RequestInit) {
    const res = await getLocalRuntimeSessionClient().request(path, init);
    const data = (await res.json().catch(() => ({}))) as T;
    if (!res.ok) throw new Error(t("canvas:local-agent-request-failed"));
    return data;
}

function normalizeHistoryMessages(messages: AgentChatItem[]) {
    return messages
        .map((item, index) => ({
            ...item,
            id: item.id || `history-${index}`,
            text: normalizeText(item.text),
        }))
        .filter((item) => item.text);
}

function formatThreadTime(value?: number) {
    if (!value) return "";
    return new Date(value * 1000).toLocaleString();
}

function createId() {
    return createClientId();
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function readDataUrl(file: File) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error || new Error(t("canvas:image-read-failed")));
        reader.readAsDataURL(file);
    });
}
