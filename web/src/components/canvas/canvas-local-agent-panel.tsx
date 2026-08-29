import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { App, Button, Segmented, Tooltip } from "antd";
import copyToClipboard from "copy-to-clipboard";
import { CheckCircle2, Copy, ExternalLink, FolderOpen, History, LoaderCircle, PlugZap, Plus, RefreshCw, Terminal, Trash2 } from "lucide-react";
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
import { canvasAgentPostconditionMessage, hashCanvasAgentSnapshot, previewCanvasAgentOps, summarizeCanvasAgentOps, verifyCanvasAgentOps, type CanvasAgentOp, type CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { buildCanvasAgentContext, findCanvasAgentNodes, getCanvasAgentConnection, getCanvasAgentGenerationTasks, getCanvasAgentNode, getCanvasAgentResources, validateCanvasAgentOps } from "@/lib/canvas/canvas-agent-context";
import { buildCanvasResourceReferences } from "@/lib/canvas/canvas-resource-references";
import { buildLocalAgentSetupCommands, detectLocalAgentSetupPlatform, type LocalAgentSetupPlatform } from "@/lib/canvas/local-agent-setup";
import { listAddedSkills, type Skill } from "@/services/api/skills";
import { skillRuntime } from "@/services/skill-runtime";
import { isProjectAgentReadTool, isProjectAgentToolName, runProjectAgentTool } from "@/services/api/project-agent-tools";
import { AgentChatComposer, AgentChatMessage, AgentPendingToolCard, AgentWorkingMessage, type CanvasAgentChatAttachment } from "./canvas-agent-chat-ui";
import { VoiceRecordingButton } from "@/components/conversation/voice-recording-button";
import { AgentChatEmptyState } from "./canvas-agent-panel-chrome";

const PANEL_MOTION_SECONDS = 0.5;
const MAX_ATTACHMENTS = 6;
const MAX_ATTACHMENT_PAYLOAD_BYTES = 28 * 1024 * 1024;
const MAX_AGENT_TURN_PAYLOAD_BYTES = 56 * 1024 * 1024;
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
type AgentTurnPayload = {
    text: string;
    prompt: string;
    canvasId: string;
    threadId?: string;
    attachments: Array<Pick<AgentAttachment, "name" | "type" | "dataUrl">>;
    skills: Array<{ skillId: string; name: string; description: string; version: string; files: Array<{ path: string; mimeType: string; contentBase64: string }> }>;
};

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
    const [retryTurn, setRetryTurn] = useState<AgentTurnPayload | null>(null);
    const [retryMessageId, setRetryMessageId] = useState<string | null>(null);
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
    const runtimeRevisionRef = useRef(0);
    const runtimeStateHashRef = useRef("");
    const runtimeCanonicalStateHashRef = useRef("");
    const runtimeSyncQueueRef = useRef<Promise<void>>(Promise.resolve());
    const connectionControllerRef = useRef<AbortController | null>(null);
    const activeToolRequestIdsRef = useRef(new Set<string>());
    const recoveredToolResultIdsRef = useRef(new Set<string>());
    const activeTurnRef = useRef<AgentTurnPayload | null>(null);
    const syncState = useCallback(
        (clientId: string, nextSnapshot: CanvasAgentSnapshot) => {
            const stateHash = hashCanvasAgentSnapshot(nextSnapshot);
            if (runtimeStateHashRef.current !== stateHash) {
                runtimeRevisionRef.current = runtimeStateHashRef.current ? runtimeRevisionRef.current + 1 : nextSnapshot.revision ?? 0;
                runtimeStateHashRef.current = stateHash;
            }
            // Canvas Agent 的 canonical hash 是服务端 SHA-256；浏览器本地校验使用轻量 FNV hash。
            // 不把浏览器 hash 当作服务端 hash 上送，避免跨运行时误判；服务端会根据完整快照重新计算。
            const envelope = { ...nextSnapshot, revision: runtimeRevisionRef.current };
            const queued = runtimeSyncQueueRef.current
                .catch(() => undefined)
                .then(async () => {
                    const result = await postCanvasRuntimeState(getLocalRuntimeSessionClient(), clientId, envelope);
                    runtimeRevisionRef.current = result.revision;
                    runtimeCanonicalStateHashRef.current = result.stateHash;
                    return result;
                })
                .catch(() => {
                    pushEventLog({
                        id: `${Date.now()}-${Math.random()}`,
                        time: new Date().toLocaleTimeString(),
                        title: "状态同步失败",
                        text: "本机 Runtime 暂未接收画布状态",
                    });
                    return undefined;
                });
            runtimeSyncQueueRef.current = queued.then(() => undefined);
            return queued;
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
            addEventLog("读取历史失败", error);
        } finally {
            setAgentState({ loadingThreads: false });
        }
    }, [setAgentState]);

    useEffect(() => {
        snapshotRef.current = snapshot;
    }, [snapshot]);
    useEffect(() => {
        runtimeRevisionRef.current = 0;
        runtimeStateHashRef.current = "";
        runtimeCanonicalStateHashRef.current = "";
        activeTurnRef.current = null;
        setRetryTurn(null);
        setRetryMessageId(null);
    }, [snapshot.projectId]);
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
                setAgentState({ connected: true, activity: "已连接", connectError: "", messages: useCanvasAgentStore.getState().messages.filter((item) => !isConnectionErrorMessage(item)) });
                if (!headless) message.success("本地 Agent 已连接");
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
                addEventLog("日志", text, text);
                return;
            }
            if (event.type === "agent_error") {
                const errorMessage = parseEventJson<{ message?: unknown }>(event.data)?.message;
                setAgentState({ activity: "出错", waiting: false, sending: false });
                const messageId = addMessage({ role: "error", title: "错误", text: normalizeText(errorMessage) || "本地 Agent 执行失败，请重试本轮。" });
                if (activeTurnRef.current) {
                    setRetryTurn(activeTurnRef.current);
                    setRetryMessageId(messageId || null);
                }
                addEventLog("错误", errorMessage, errorMessage);
                return;
            }
            if (event.type === "agent_done") {
                setAgentState({ activity: "完成", waiting: false, sending: false });
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
                    const text = wasConnected ? "本地 Agent 连接已断开，正在重连" : "本地 Agent 连接失败，请检查本机 Runtime";
                    if (!errorLoggedRef.current || wasConnected) {
                        addEventLog(wasConnected ? "连接断开" : "连接失败", text);
                        if (!headless) message.error(text);
                    }
                    errorLoggedRef.current = true;
                    connectedRef.current = false;
                    setAgentState(canvasAgentTransientDisconnectPatch(wasConnected ? "正在重连" : "连接失败", text));
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
        if (activeTab === "history" && connected) void loadThreads();
    }, [activeTab, connected, loadThreads]);

    useEffect(() => {
        if (!connected) return;
        const timer = setTimeout(() => syncState(clientIdRef.current, snapshot), 300);
        return () => clearTimeout(timer);
    }, [connected, snapshot, syncState]);

    const submitTurn = async (payload: AgentTurnPayload, appendUserMessage: boolean) => {
        const state = useCanvasAgentStore.getState();
        if (!state.connected || state.sending || state.waiting) return;
        activeTurnRef.current = payload;
        if (appendUserMessage) {
            setRetryTurn(null);
            setRetryMessageId(null);
        }
        setAgentState({ activity: appendUserMessage ? "发送中" : "重试中", sending: true, waiting: true });
        if (appendUserMessage) {
            const files = state.attachments;
            addMessage({ role: "user", text: payload.text || "发送了图片", attachments: files });
            addEventLog("用户发送", { text: payload.text, attachments: files.map(({ name, type, size }) => ({ name, type, size })) });
            files.forEach((item) => {
                URL.revokeObjectURL(item.url);
                attachmentUrlsRef.current.delete(item.url);
            });
            setAgentState({ prompt: "", attachments: [] });
        } else {
            addEventLog("重试本轮", { threadId: payload.threadId, attachments: payload.attachments.map(({ name, type }) => ({ name, type })) });
        }
        try {
            const data = await fetchAgentJson<{ threadId?: string }>("/agent/codex/turn", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    prompt: payload.prompt,
                    canvasId: payload.canvasId,
                    threadId: payload.threadId,
                    attachments: payload.attachments,
                    skills: payload.skills,
                }),
            });
            const acceptedPayload = data.threadId ? { ...payload, threadId: data.threadId } : payload;
            activeTurnRef.current = acceptedPayload;
            if (data.threadId) setAgentState({ activeThreadId: data.threadId });
            addEventLog(appendUserMessage ? "本地 Agent 已接收" : "本地 Agent 已接收重试", { accepted: true });
        } catch (error) {
            setRetryTurn(activeTurnRef.current);
            setAgentState({ activity: "发送失败", waiting: false });
            const messageId = addMessage({ role: "error", title: appendUserMessage ? "发送失败" : "重试失败", text: error instanceof Error ? error.message : "发送失败" });
            setRetryMessageId(messageId || null);
            addEventLog(appendUserMessage ? "发送失败" : "重试失败", error);
        } finally {
            setAgentState({ sending: false });
        }
    };

    const sendPrompt = async (overrideText?: string) => {
        const text = (overrideText ?? prompt).trim();
        const files = attachments;
        if (!connected || !promptWithAttachments(text, files) || sending || waiting) return;
        if (attachmentPayloadBytes(files) > MAX_ATTACHMENT_PAYLOAD_BYTES) {
            addMessage({ role: "error", title: "图片过大", text: "图片附件超过 30MB，请删减后再发送。" });
            return;
        }
        let skillExecution: Awaited<ReturnType<typeof skillRuntime.prepare<"localAgent">>>;
        try {
            skillExecution = await skillRuntime.prepare({ profile: "localAgent", prompt: text, skills: composerSkills });
        } catch (error) {
            addMessage({ role: "error", title: "技能加载失败", text: error instanceof Error ? error.message : "无法读取技能包" });
            return;
        }
        const requestPrompt = promptWithAttachments(skillExecution.prompt, files);
        const skillBundles: AgentTurnPayload["skills"] = skillExecution.skills;
        if (attachmentPayloadBytes(files) + skillBundlePayloadBytes(skillBundles) > MAX_AGENT_TURN_PAYLOAD_BYTES) {
            addMessage({ role: "error", title: "本轮内容过大", text: "图片与技能包合计超过本地 Agent 单轮限制，请减少附件或只选择一个技能。" });
            return;
        }
        await submitTurn({
            text,
            prompt: requestPrompt,
            canvasId: snapshotRef.current.projectId,
            threadId: useCanvasAgentStore.getState().activeThreadId || undefined,
            attachments: files.map(({ name, type, dataUrl }) => ({ name, type, dataUrl })),
            skills: skillBundles,
        }, true);
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
                addMessage({ role: "error", title: "图片过大", text: "图片附件最多约 30MB。" });
                return;
            }
            if (next.length) setAgentState({ attachments: merged });
        } catch (error) {
            addMessage({ role: "error", title: "图片读取失败", text: error instanceof Error ? error.message : "图片读取失败" });
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
                await postToolResult(clientIdRef.current, { requestId: payload.requestId, error: "仍有待确认的画布工具调用" });
                return;
            }
            pendingToolRef.current = payload;
            setAgentState({ pendingTool: payload, activity: "等待确认", waiting: false });
            addEventLog("等待确认", payload, payload);
            return;
        }
        await runToolCall(payload);
    };

    const runToolCall = async (payload: AgentPendingToolCall) => {
        activeToolRequestIdsRef.current.add(payload.requestId);
        try {
            const input = (payload.input || {}) as Record<string, unknown>;
            const projectToolName = isProjectAgentToolName(payload.name) ? payload.name : null;
            setAgentState({ activity: payload.name === "canvas_apply_ops" ? "执行画布操作" : projectToolName ? "执行项目工具" : "读取画布", waiting: true });
            addEventLog(toolName(payload.name), payload, payload);
            if (payload.name === "canvas_apply_ops") {
                const currentSnapshot = snapshotRef.current;
                if (typeof input.expectedRevision === "number" && input.expectedRevision !== runtimeRevisionRef.current) throw new Error(`画布 revision 已从 ${input.expectedRevision} 变为 ${runtimeRevisionRef.current}，请重新读取 canvas_get_context 后再执行写操作`);
                // expectedStateHash is the Canvas Agent Runtime's canonical
                // SHA-256 hash. The browser intentionally uses a different,
                // synchronous fingerprint for local bookkeeping, so the
                // Runtime has already performed the authoritative check before
                // emitting this tool call. Comparing the two algorithms here
                // would reject every valid local write.
                const validation = validateCanvasAgentOps(currentSnapshot, (input.ops || []) as CanvasAgentOp[]);
                if (!validation.ok) throw new Error(`画布操作校验失败：${validation.issues.filter((item) => item.severity === "error").map((item) => item.message).join("；")}`);
            }
            const result =
                payload.name === "canvas_apply_ops"
                    ? await (async () => {
                          const before = snapshotRef.current;
                          const next = await onApplyOpsRef.current((input.ops || []) as CanvasAgentOp[], { source: "local", conversationId: activeThreadId || clientIdRef.current, messageId: payload.requestId });
                          const verification = verifyCanvasAgentOps(before, next, (input.ops || []) as CanvasAgentOp[]);
                          return {
                              ok: verification.ok,
                              message: canvasAgentPostconditionMessage(verification),
                              data: { verification, snapshot: next },
                              snapshot: next,
                          };
                      })()
                    : payload.name === "canvas_get_state" || payload.name === "canvas_export_snapshot"
                      ? snapshotRef.current
                    : payload.name === "canvas_get_context"
                      ? await readLocalCanvasContext()
                      : payload.name === "canvas_find_nodes"
                        ? findCanvasAgentNodes(snapshotRef.current, input as Parameters<typeof findCanvasAgentNodes>[1])
                        : payload.name === "canvas_get_node"
                          ? getCanvasAgentNode(snapshotRef.current, { id: requireString(input.id, "id") })
                        : payload.name === "canvas_get_connection"
                            ? getCanvasAgentConnection(snapshotRef.current, { id: requireString(input.id, "id") })
                        : payload.name === "canvas_get_generation_tasks"
                          ? getCanvasAgentGenerationTasks(snapshotRef.current, input as Parameters<typeof getCanvasAgentGenerationTasks>[1])
                        : payload.name === "canvas_get_resources"
                          ? getCanvasAgentResources(snapshotRef.current, input as Parameters<typeof getCanvasAgentResources>[1])
                        : payload.name === "canvas_validate_ops"
                            ? validateCanvasAgentOps(snapshotRef.current, (input.ops || []) as CanvasAgentOp[])
                            : payload.name === "canvas_get_selection"
                              ? (() => {
                                    const ids = new Set(snapshotRef.current.selectedNodeIds || []);
                                    return { nodes: snapshotRef.current.nodes.filter((node) => ids.has(node.id)) };
                                })()
                            : projectToolName
                              ? await runProjectAgentTool(projectToolName, input, snapshotRef.current.domainProjectId)
                              : snapshotRef.current;
            await postToolResult(clientIdRef.current, { requestId: payload.requestId, result });
            if (payload.name === "canvas_apply_ops") syncState(clientIdRef.current, (result as { snapshot?: CanvasAgentSnapshot }).snapshot || snapshotRef.current);
            setAgentState({ activity: "工具完成", waiting: true });
            addEventLog(`${toolName(payload.name)}完成`, result, result);
            addMessage({
                role: "tool",
                title: `${toolName(payload.name)}完成`,
                text: payload.name === "canvas_apply_ops" ? (result as { message?: string }).message || summarizeCanvasAgentOps((input.ops || []) as CanvasAgentOp[]) || "画布操作" : "已完成",
                detail: { requestId: payload.requestId, name: payload.name, input, result },
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : "画布操作失败";
            setAgentState({ activity: "工具失败", waiting: false });
            addMessage({ role: "tool", title: "工具失败", text: message, detail: payload });
            await postToolResult(clientIdRef.current, { requestId: payload.requestId, error: message });
        } finally {
            activeToolRequestIdsRef.current.delete(payload.requestId);
        }
    };

    const readLocalCanvasContext = async () => {
        // Flush the latest browser snapshot first, then expose the Runtime's
        // canonical state hash to Codex. This keeps the local MCP path's
        // read→write precondition compatible with the server-side path.
        const synced = await syncState(clientIdRef.current, snapshotRef.current);
        const stateHash = synced?.stateHash || runtimeCanonicalStateHashRef.current;
        return buildCanvasAgentContext(snapshotRef.current, {
            ...(stateHash ? { stateHash, hashSource: "canvas-agent-server" as const } : {}),
        });
    };

    const rejectPendingTool = async () => {
        if (!pendingTool) return;
        await postToolResult(clientIdRef.current, { requestId: pendingTool.requestId, error: "用户取消了画布工具调用" });
        setAgentState({ activity: "已取消", waiting: false });
        addMessage({ role: "tool", title: "拒绝执行", text: toolName(pendingTool.name), detail: { requestId: pendingTool.requestId, name: pendingTool.name, input: pendingTool.input } });
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
        setAgentState({ activity: "已撤销" });
        addMessage({ role: "tool", title: "已撤销 Agent 批次", text: "已恢复到本次写回前的画布状态", detail: restored });
        if (connected) syncState(clientIdRef.current, restored);
    };

    const toggleAgentConnection = () => {
        if (enabled) {
            connectionControllerRef.current?.abort();
            pendingToolRef.current = null;
            setAgentState({ enabled: false, connected: false, activity: "离线", connectError: "", waiting: false, sending: false, pendingTool: null });
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
            activeTurnRef.current = null;
            setRetryTurn(null);
            setRetryMessageId(null);
            setAgentState({ activeThreadId: data.thread?.id || data.workspace?.activeThreadId || "", messages: [], activeTab: "chat", activity: "新对话" });
            await loadThreads();
        } catch (error) {
            addEventLog("新建对话失败", error);
            message.error(error instanceof Error ? error.message : "新建对话失败");
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
            activeTurnRef.current = null;
            setRetryTurn(null);
            setRetryMessageId(null);
            setAgentState({ activeThreadId: data.thread?.id || threadId, messages: normalizeHistoryMessages(data.messages || []), activeTab: "chat", activity: "已恢复会话" });
            await loadThreads();
        } catch (error) {
            addEventLog("恢复对话失败", error);
            message.error(error instanceof Error ? error.message : "恢复对话失败");
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
            if (current.activeThreadId === threadId) {
                activeTurnRef.current = null;
                setRetryTurn(null);
                setRetryMessageId(null);
            }
            setAgentState({
                threads: current.threads.filter((thread) => thread.id !== threadId),
                activeThreadId: current.activeThreadId === threadId ? "" : current.activeThreadId,
                messages: current.activeThreadId === threadId ? [] : current.messages,
            });
            message.success("记录已删除");
        } catch (error) {
            addEventLog("删除对话失败", error);
            message.error(error instanceof Error ? error.message : "删除对话失败");
        } finally {
            setAgentState({ loadingThreads: false });
        }
    };

    const confirmDeleteThread = (thread: AgentThreadSummary) => {
        const label = thread.name || thread.preview || "未命名对话";
        modal.confirm({
            title: "删除对话记录",
            content: `确定删除「${label.length > 48 ? `${label.slice(0, 48)}...` : label}」吗？`,
            okText: "删除",
            okType: "danger",
            cancelText: "取消",
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
        if (!text && !item.attachments?.length) return undefined;
        const next = { ...item, id: `${Date.now()}-${Math.random()}`, text };
        const currentMessages = useCanvasAgentStore.getState().messages;
        if (next.streamId) {
            const index = currentMessages.findIndex((message) => message.streamId === next.streamId);
            if (index >= 0) {
                setAgentState({ messages: currentMessages.map((message, i) => (i === index ? { ...message, ...next, id: message.id, text: next.text || message.text } : message)) });
                return currentMessages[index].id;
            }
        }
        const last = currentMessages.at(-1);
        if (last?.role === "assistant" && next.role === "assistant" && last.title === next.title) {
            const merged = mergeAgentText(last.text, next.text);
            if (merged === last.text) return last.id;
            setAgentState({ messages: [...useCanvasAgentStore.getState().messages.slice(0, -1), { ...last, text: merged, meta: next.meta || last.meta }] });
            return last.id;
        }
        pushMessage(next);
        return next.id;
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
        if (event.type === "turn.completed") {
            activeTurnRef.current = null;
            setRetryTurn(null);
            setRetryMessageId(null);
            setAgentState({ waiting: false, sending: false });
        } else if (event.type === "turn.failed" || event.type === "error") {
            if (activeTurnRef.current) setRetryTurn(activeTurnRef.current);
            setAgentState({ waiting: false, sending: false });
        }
        const item = formatAgentEvent(event);
        if (item) {
            if (item.role === "error") setAgentState({ waiting: false, sending: false });
            const messageId = addMessage(item);
            if ((event.type === "turn.failed" || event.type === "error") && activeTurnRef.current && item.role === "error") setRetryMessageId(messageId || null);
        }
    };

    const content = (
        <>
            <div className="flex min-h-8 shrink-0 items-center justify-end gap-1 px-3 pb-1">
                <div className="mr-auto min-w-0 truncate px-1 text-[var(--fs-tiny)]" style={{ color: connected ? "#16a34a" : theme.node.muted }}>
                    {connected ? "本机 Agent 已连接" : canvasAgentConnectionStatusText({ enabled, connected, activity, connectError })}
                </div>
                {!connected ? (
                    <Button size="small" type={enabled ? "default" : "primary"} className="!h-7 !px-2.5" icon={<PlugZap className="size-3.5" />} onClick={toggleAgentConnection}>
                        {enabled ? "连接中" : "连接"}
                    </Button>
                ) : null}
                <Tooltip title={threads.length ? `历史会话 · ${threads.length}` : "历史会话"}>
                    <Button type="text" className={`!h-7 !min-w-7 !px-1.5 ${activeTab === "history" ? "font-medium" : ""}`} style={{ color: activeTab === "history" ? theme.node.text : theme.node.muted, background: activeTab === "history" ? theme.spatial.surface : "transparent" }} icon={<History className="size-3.5" />} onClick={() => setAgentState({ activeTab: activeTab === "history" ? "chat" : "history" })} aria-label="打开历史会话">
                        {threads.length ? <span className="text-[var(--fs-tiny)] tabular-nums">{threads.length}</span> : null}
                    </Button>
                </Tooltip>
                <Tooltip title="新对话">
                    <Button type="text" shape="circle" className="!h-7 !w-7 !min-w-7" disabled={!connected || loadingThreads} style={{ color: theme.node.muted }} icon={<Plus className="size-3.5" />} onClick={() => void startNewThread()} aria-label="新建对话" />
                </Tooltip>
            </div>

            {!connected ? (
                <AgentConnectView
                    theme={theme}
                    enabled={enabled}
                    activity={activity}
                    connectError={connectError}
                    onToggleEnabled={toggleAgentConnection}
                />
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
                            <AgentChatMessage key={item.id} item={agentMessageToChatMessage(item)} theme={theme} user={user} isStreaming={(sending || waiting) && item.id === messages.at(-1)?.id && item.role === "assistant"} retrying={sending && item.id === retryMessageId} onRetry={item.id === retryMessageId && retryTurn ? () => void submitTurn(retryTurn, false) : undefined} onQuickAction={(text) => void sendPrompt(text)} />
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
                        placeholder="询问 Codex，或让它操作画布"
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
    const [mode, setMode] = useState<"text" | "json">("text");
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const content = mode === "text" ? formatLogText(logs, context) : formatLogJson(logs, context);
    const lastError = [...logs].reverse().find((item) => /错误|失败|error/i.test(`${item.title}\n${item.text}`));
    const copy = async (value = content, tip = "日志已复制") => {
        if (await copyToClipboard(value)) {
            onCopied(tip);
            return;
        }
        textareaRef.current?.focus();
        textareaRef.current?.select();
        onCopyBlocked("已选中日志，请手动复制");
    };
    return (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
            <div className="flex min-h-full flex-col gap-3">
                <div>
                    <div className="text-base font-semibold leading-6">运行日志</div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <Segmented
                        size="small"
                        value={mode}
                        onChange={(value) => setMode(value as "text" | "json")}
                        options={[
                            { label: "排查日志", value: "text" },
                            { label: "原始 JSON", value: "json" },
                        ]}
                    />
                    <div className="flex items-center gap-2">
                        <span className="text-xs" style={{ color: theme.node.muted }}>
                            {logs.length} 条
                        </span>
                        <Button size="small" icon={<Copy className="size-3.5" />} onClick={() => void copy()}>
                            复制
                        </Button>
                        <Button size="small" disabled={!lastError} onClick={() => lastError && void copy(formatLogText([lastError], context), "最近错误已复制")}>
                            最近错误
                        </Button>
                        <Button size="small" danger type="text" icon={<Trash2 className="size-3.5" />} disabled={!logs.length} onClick={onClear}>
                            清空
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
    activity,
    connectError,
    onToggleEnabled,
}: {
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    enabled: boolean;
    activity: string;
    connectError: string;
    onToggleEnabled: () => void;
}) {
    const { message } = App.useApp();
    const [platform, setPlatform] = useState<LocalAgentSetupPlatform>(() => detectLocalAgentSetupPlatform());
    const origin = typeof window === "undefined" ? "http://localhost:3000" : window.location.origin;
    const commands = buildLocalAgentSetupCommands(origin, platform);
    const statusText = canvasAgentConnectionStatusText({ enabled, connected: false, activity, connectError });
    const statusColor = connectError ? "#dc2626" : enabled ? "#d97706" : theme.node.muted;
    const copyCommand = async (value: string, label: string) => {
        if (await copyToClipboard(value)) {
            message.success(`${label}已复制`);
            return;
        }
        message.warning("复制失败，请手动复制");
    };
    return (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
            <div className="mx-auto w-full max-w-[620px] space-y-5 pb-4">
                <div>
                    <div className="text-base font-semibold leading-6">连接本地 Agent</div>
                    <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                        在这台电脑启动 Canvas Agent 后，网页会通过 127.0.0.1 建立本机安全连接。连接成功后，这里会自动恢复原对话。
                    </div>
                </div>
                <div className="rounded-md p-3" style={{ background: theme.spatial.surface }}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-2">
                                <span className="shrink-0 text-sm font-medium leading-5">网页连接</span>
                                <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[var(--fs-label)] leading-4" style={{ background: theme.node.fill, color: statusColor }}>
                                    {enabled ? <LoaderCircle className="size-3 shrink-0 animate-spin" /> : <span className="size-1.5 shrink-0 rounded-full" style={{ background: statusColor }} />}
                                    <span className="truncate">{statusText}</span>
                                </span>
                            </div>
                            <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                                {enabled ? "正在检测本机 127.0.0.1:17371；服务启动后会自动连接。" : "先完成下面两步，再点击连接。"}
                            </div>
                        </div>
                        <Button className="!h-8 !px-3" type={enabled ? "default" : "primary"} icon={<PlugZap className="size-4" />} onClick={onToggleEnabled}>
                            {enabled ? "停止重试" : connectError ? "重新连接" : "开始连接"}
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

                <div>
                    <section className="border-b pb-4" style={{ borderColor: theme.node.stroke }}>
                        <div className="flex items-start gap-3">
                            <span className="grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold" style={{ background: theme.node.fill, color: theme.node.text }}>1</span>
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div>
                                        <div className="text-sm font-medium leading-5">安装本机 Runtime</div>
                                        <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>需要 Git、Node.js 18+。当前版本从 GitHub 源码安装。</div>
                                    </div>
                                    <Segmented
                                        size="small"
                                        value={platform}
                                        options={[
                                            { label: "macOS / Linux", value: "unix" },
                                            { label: "Windows", value: "windows" },
                                        ]}
                                        onChange={(value) => setPlatform(value as LocalAgentSetupPlatform)}
                                    />
                                </div>
                                <CommandBlock value={commands.install} theme={theme} onCopy={() => copyCommand(commands.install, "安装命令")} />
                            </div>
                        </div>
                    </section>

                    <section className="border-b py-4" style={{ borderColor: theme.node.stroke }}>
                        <div className="flex items-start gap-3">
                            <span className="grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold" style={{ background: theme.node.fill, color: theme.node.text }}>2</span>
                            <div className="min-w-0 flex-1">
                                <div className="text-sm font-medium leading-5">启动并授权当前站点</div>
                                <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                                    命令已绑定 <span className="font-mono">{origin}</span>。保持终端运行，再回到上方开始连接。
                                </div>
                                <CommandBlock value={commands.start} theme={theme} onCopy={() => copyCommand(commands.start, "启动命令")} />
                            </div>
                        </div>
                    </section>

                    <section className="pt-4">
                        <div className="flex items-start gap-3">
                            <span className="grid size-6 shrink-0 place-items-center rounded-full" style={{ background: theme.node.fill, color: theme.node.text }}><CheckCircle2 className="size-3.5" /></span>
                            <div className="min-w-0 flex-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                                <div className="text-sm font-medium" style={{ color: theme.node.text }}>当前支持范围</div>
                                <div className="mt-1">网页侧边栏使用 Codex；外部 MCP 已提供 Codex 与 Claude Code 接入。Hermes、WorkBuddy 尚未验证。Codex 需要已登录或配置可用凭据。</div>
                                <Button type="link" size="small" className="mt-1 !h-7 !px-0" href="https://github.com/ddcat-ai/open-ai-canvas/tree/main/canvas-agent" target="_blank" rel="noreferrer" icon={<ExternalLink className="size-3.5" />}>
                                    查看完整说明
                                </Button>
                            </div>
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
}

function CommandBlock({
    value,
    theme,
    onCopy,
}: {
    value: string;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    onCopy: () => void | Promise<void>;
}) {
    return (
        <div className="mt-3 overflow-hidden rounded-md" style={{ background: "rgba(0,0,0,.22)" }}>
            <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5" style={{ borderColor: theme.node.stroke }}>
                <span className="inline-flex items-center gap-1.5 text-[var(--fs-label)]" style={{ color: theme.node.muted }}>
                    <Terminal className="size-3.5" />
                    终端命令
                </span>
                <Button type="text" size="small" className="!h-6 !px-1.5" icon={<Copy className="size-3.5" />} onClick={() => void onCopy()} aria-label="复制终端命令">
                    复制
                </Button>
            </div>
            <pre className="thin-scrollbar overflow-x-auto whitespace-pre p-3 font-mono text-[11px] leading-5" style={{ color: theme.node.text }}>{value}</pre>
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
    return (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
            <div className="space-y-3">
                <div className="flex min-w-0 items-center gap-2 text-xs" style={{ color: theme.node.muted }}>
                    <FolderOpen className="size-3.5 shrink-0" />
                    <span className="shrink-0">工作空间</span>
                    <span className="min-w-0 truncate" title={workspacePath}>
                        {workspacePath || "默认画布目录"}
                    </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm" style={{ color: theme.node.muted }}>
                        {threads.length ? `${threads.length} 条历史` : connected ? "暂无历史" : "未连接"}
                    </div>
                    <div className="flex items-center gap-2">
                        <Button size="small" icon={<RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />} disabled={!connected || loading} onClick={onRefresh}>
                            刷新
                        </Button>
                        <Button size="small" type="primary" icon={<Plus className="size-3.5" />} disabled={!connected || loading} onClick={onNewThread}>
                            新对话
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
                                                    当前
                                                </span>
                                            ) : null}
                                            <div className="truncate text-sm font-medium leading-5">{thread.name || thread.preview || "未命名对话"}</div>
                                        </div>
                                        <div className="truncate text-[var(--fs-label)] leading-4 opacity-65">{thread.preview || thread.id}</div>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1">
                                        <span className="text-[var(--fs-tiny)] opacity-55">{formatThreadTime(thread.updatedAt || thread.createdAt)}</span>
                                        <Button size="small" className="!h-6 !px-2" disabled={loading} onClick={() => onResumeThread(thread.id)}>
                                            进入
                                        </Button>
                                        <Tooltip title="删除记录">
                                            <Button size="small" danger type="text" className="!h-6 !w-6 !min-w-6" disabled={loading} icon={<Trash2 className="size-3.5" />} onClick={() => onDeleteThread(thread)} />
                                        </Tooltip>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                    {!threads.length ? (
                        <div className="px-3 py-8 text-center text-sm" style={{ color: theme.node.muted }}>
                            {connected ? "当前工作空间还没有对话记录" : "连接本地 Agent 后显示历史记录"}
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

async function postToolResult(clientId: string, body: { requestId: string; result?: unknown; error?: string }) {
    const response = await getLocalRuntimeSessionClient().request(`/canvas/result?clientId=${encodeURIComponent(clientId)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error("Canvas Agent 工具结果写回失败");
}

function agentMessageToChatMessage(item: AgentChatItem) {
    return { ...item, attachments: item.attachments?.map(agentAttachmentToChatAttachment) };
}

function agentAttachmentToChatAttachment(item: AgentAttachment): CanvasAgentChatAttachment {
    return { id: item.id, name: item.name, url: item.dataUrl || item.url };
}

function formatAgentEvent(event: AgentEventPayload): Omit<AgentChatItem, "id"> | null {
    const item = event.item;
    if (event.type === "turn.failed" || event.type === "error") return { role: "error", title: "模型调用失败", text: normalizeText(event.error?.message || event.message) || "模型调用失败，请重试本轮。", detail: event };
    if (event.type === "item.completed" && item?.type === "error") return { role: "error", title: "错误", text: normalizeText(item.message), detail: item };
    if ((event.type === "item.updated" || event.type === "item.completed") && item?.type === "agent_message") return { role: "assistant", title: "Codex", text: stringText(item.text), meta: usageText(event), streamId: item.id };
    if (event.type === "item.completed" && isMcpToolItem(item) && isReadTool(String(item?.tool || ""))) return { role: "tool", title: `${toolName(String(item?.tool || ""))}完成`, text: item?.error?.message || toolSummary(item), detail: toolDetail(item) };
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
    const head = [
        "影策 Canvas Agent 诊断日志",
        `连接: ${context.connected ? "在线" : context.enabled ? "连接中" : "未启用"}`,
        `状态: ${context.activity}`,
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
    return [head, body || "暂无事件日志"].join("\n\n");
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
    const name = event.type || "";
    if (name === "thread.started") return "已创建会话";
    if (name === "turn.started") return "思考中";
    if (name === "turn.completed") return "完成";
    if (name === "turn.failed" || name === "error") return "出错";
    if (name === "item.started") return isMcpToolItem(event.item) ? `调用${toolName(String(event.item?.tool || ""))}` : "执行步骤";
    if (name === "item.completed") return isMcpToolItem(event.item) ? "工具完成" : "更新消息";
    return "";
}

function eventTitle(event: AgentEventPayload) {
    const item = event.item;
    if (event.type === "thread.started") return "已创建 Codex 会话";
    if (event.type === "turn.started") return "开始处理";
    if (event.type === "turn.completed") return "本轮完成";
    if (event.type === "stream.summary") return "流式摘要";
    if (event.type === "turn.failed" || event.type === "error") return "本轮失败";
    if (event.type === "item.started" && isMcpToolItem(item)) return `调用工具：${toolName(String(item?.tool || ""))}`;
    if (event.type === "item.completed" && isMcpToolItem(item)) return `工具完成：${toolName(String(item?.tool || ""))}`;
    if (event.type === "item.completed" && item?.type === "agent_message") return "Codex 回复";
    return event.type || "Codex 事件";
}

function shouldLogAgentEvent(event: AgentEventPayload) {
    const itemType = event.item?.type || "";
    return !["item.updated"].includes(event.type || "") && !["reasoning"].includes(itemType) && !(event.type === "item.started" && itemType === "agent_message");
}

function isConnectionErrorMessage(item: AgentChatItem) {
    return item.role === "error" && /连接失败|无法连接本地 Agent|本地 Agent 连接失败/.test(item.text);
}

function toolName(name: string) {
    if (name === "canvas_apply_ops") return "画布操作";
    if (name === "canvas_get_state") return "读取画布";
    if (name === "canvas_get_context") return "读取上下文";
    if (name === "canvas_find_nodes") return "检索节点";
    if (name === "canvas_get_node") return "读取节点";
    if (name === "canvas_get_connection") return "读取连线";
    if (name === "canvas_get_generation_tasks") return "读取生成任务";
    if (name === "canvas_get_resources") return "读取资源";
    if (name === "canvas_validate_ops") return "校验操作";
    if (name === "canvas_get_selection") return "读取选区";
    if (name === "canvas_export_snapshot") return "导出快照";
    if (name === "canvas_create_node") return "创建节点";
    if (name === "canvas_create_text_node") return "创建文本";
    if (name === "canvas_create_text_nodes") return "批量创建文本";
    if (name === "canvas_create_image_prompt_flow") return "创建生图流程";
    if (name === "canvas_create_generation_flow") return "创建生成流程";
    if (name === "canvas_generate_text") return "生成文本";
    if (name === "canvas_generate_image") return "生成图片";
    if (name === "canvas_generate_video") return "生成视频";
    if (name === "canvas_generate_audio") return "生成音频";
    if (name === "canvas_update_node") return "更新节点";
    if (name === "canvas_update_node_text") return "更新文本";
    if (name === "canvas_move_nodes") return "移动节点";
    if (name === "canvas_resize_node") return "调整节点尺寸";
    if (name === "canvas_delete_nodes") return "删除节点";
    if (name === "canvas_connect_nodes") return "连接节点";
    if (name === "canvas_select_nodes") return "选择节点";
    if (name === "canvas_set_viewport") return "调整视口";
    if (name === "canvas_run_generation") return "触发生成";
    if (name === "project_get_context") return "读取项目上下文";
    if (name === "project_list_units") return "读取项目章节";
    if (name === "project_extract_asset_candidates") return "登记资产候选";
    if (name === "project_confirm_asset_candidate") return "确认资产候选";
    if (name === "project_create_or_update_shots") return "保存项目镜头";
    if (name === "project_link_shot_asset") return "关联镜头素材";
    if (name === "project_start_workflow_step") return "启动流程步骤";
    if (name === "project_link_asset") return "引用项目资产";
    if (name === "project_upsert_asset_version") return "创建资产版本";
    if (name === "project_register_task_output") return "登记任务产物";
    return name;
}

function isReadTool(name: string) {
    return name === "canvas_get_state" || name === "canvas_get_context" || name === "canvas_find_nodes" || name === "canvas_get_node" || name === "canvas_get_connection" || name === "canvas_get_generation_tasks" || name === "canvas_get_resources" || name === "canvas_validate_ops" || name === "canvas_get_selection" || name === "canvas_export_snapshot" || isProjectAgentReadTool(name);
}

function isMcpToolItem(item?: AgentEventItem) {
    return item?.type === "mcp_tool_call";
}

function toolDetail(item?: AgentEventItem) {
    return { server: item?.server, tool: item?.tool, status: item?.status, arguments: item?.arguments, result: parseToolResult(item?.result), error: item?.error };
}

function toolSummary(item?: AgentEventItem) {
    const result = parseToolResult(item?.result);
    const nodeField = objectField(result, "nodes");
    const connectionField = objectField(result, "connections");
    const nodes = Array.isArray(nodeField) ? nodeField : [];
    const connections = Array.isArray(connectionField) ? connectionField : [];
    if (Array.isArray(nodeField) || Array.isArray(connectionField)) return `读取到 ${nodes.length} 个节点，${connections.length} 条连线`;
    return "工具调用完成";
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

function requireString(value: unknown, field: string) {
    if (typeof value !== "string" || !value.trim()) throw new Error(`${field} 必须是非空字符串`);
    return value;
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
    if (!attachments.length) return text;
    const names = attachments.map((item) => item.name).join("、");
    return [text, `用户上传了 ${attachments.length} 张图片附件：${names}。`].filter(Boolean).join("\n\n");
}

function attachmentPayloadBytes(attachments: AgentAttachment[]) {
    return attachments.reduce((total, item) => total + item.dataUrl.length, 0);
}

function skillBundlePayloadBytes(skills: AgentTurnPayload["skills"]) {
    return skills.reduce((total, skill) => total + skill.files.reduce((fileTotal, file) => fileTotal + file.contentBase64.length, 0), 0);
}

function formatBytes(bytes: number) {
    return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.ceil(bytes / 1024)}KB`;
}

async function fetchAgentJson<T>(path: string, init?: RequestInit) {
    const res = await getLocalRuntimeSessionClient().request(path, init);
    const data = (await res.json().catch(() => ({}))) as T;
    if (!res.ok) throw new Error("本地 Agent 请求失败");
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
        reader.onerror = () => reject(reader.error || new Error("读取图片失败"));
        reader.readAsDataURL(file);
    });
}
