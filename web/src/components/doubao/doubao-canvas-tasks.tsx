import { useEffect, useMemo, useRef, useState } from "react";
import { BridgeHttpError, desktopBridgeApi, pollSequentially, readConversation, sendConversation, subscribeBridgeTasks, type BridgeInfo, type BridgeStatus, type BridgeTask, type ConvMessage } from "@/services/doubao-bridge";

export function canvasTasksByNode(tasks: BridgeTask[]): Map<string, BridgeTask> {
    const result = new Map<string, BridgeTask>();
    for (const task of tasks) {
        if (!task.nodeId || (task.kind !== "image" && task.kind !== "video") || (task.status !== "queued" && task.status !== "processing")) continue;
        const current = result.get(task.nodeId);
        if (!current || (current.status === "queued" && task.status === "processing")) result.set(task.nodeId, task);
    }
    return result;
}

export function useDoubaoCanvasTasks() {
    const [bridge, setBridge] = useState<BridgeInfo | null>(null);
    const [tasks, setTasks] = useState<BridgeTask[]>([]);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        if (!desktopBridgeApi) return;
        const api = desktopBridgeApi;
        let closed = false;
        let revision = 0;
        const update = (status: BridgeStatus) => {
            const current = ++revision;
            if (status.phase === "preparing" || status.phase === "unavailable") {
                setBridge(null);
                setTasks([]);
                return;
            }
            void api
                .doubaoBridgeInfo()
                .then((info) => {
                    if (!closed && current === revision) setBridge(info);
                })
                .catch(() => {
                    if (!closed && current === revision) setBridge(null);
                });
        };
        const stop = api.onDoubaoBridgeStatus(update);
        void api
            .doubaoBridgeStatus()
            .then((status) => {
                if (!closed && revision === 0) update(status);
            })
            .catch(() => {});
        return () => {
            closed = true;
            revision += 1;
            stop();
        };
    }, []);
    useEffect(() => {
        if (!bridge) return;
        return subscribeBridgeTasks(
            bridge,
            (list) => {
                setTasks(list);
                setError(null);
            },
            () => setError("连接暂时中断，正在重连；任务仍在运行"),
        );
    }, [bridge]);
    const tasksByNode = useMemo(() => canvasTasksByNode(tasks), [tasks]);
    return { bridge, tasksByNode, error };
}

export function DoubaoCanvasPanel({ bridge, task, connectionError }: { bridge: BridgeInfo; task: BridgeTask; connectionError: string | null }) {
    const [hidden, setHidden] = useState(false);
    const [messages, setMessages] = useState<ConvMessage[]>([]);
    const [draft, setDraft] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [sending, setSending] = useState(false);
    const mutation = useRef<AbortController | null>(null);
    const { id, accountId, attempt, status } = task;
    useEffect(() => {
        setMessages([]);
        setError(null);
        if (hidden || status !== "processing" || !accountId) return;
        return pollSequentially(
            (signal) => readConversation(bridge, { id, accountId, attempt }, signal),
            (body) => {
                setMessages(body.messages || []);
                setError(null);
            },
            (reason) => setError(reason instanceof BridgeHttpError && reason.status === 409 ? "等待当前任务的会话就绪" : "会话暂时不可读，正在重试"),
            2000,
        );
    }, [bridge, id, accountId, attempt, status, hidden]);
    useEffect(
        () => () => {
            mutation.current?.abort();
        },
        [id, accountId, attempt],
    );
    if (hidden)
        return (
            <button type="button" aria-pressed="false" className="rounded-[var(--r-md)] border border-border bg-surface px-3 py-2 text-[var(--fs-tiny)]" onClick={() => setHidden(false)}>
                显示豆包对话
            </button>
        );
    const send = async () => {
        const text = draft.trim();
        if (!text || sending || !accountId) return;
        const controller = new AbortController();
        mutation.current = controller;
        setSending(true);
        setError(null);
        try {
            await sendConversation(bridge, task, text, controller.signal);
            if (!controller.signal.aborted) setDraft("");
        } catch (reason) {
            if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "发送失败");
        } finally {
            if (mutation.current === controller) {
                mutation.current = null;
                setSending(false);
            }
        }
    };
    return (
        <div className="flex flex-col overflow-hidden rounded-[var(--r-lg)] border border-border bg-surface text-foreground shadow-[var(--shadow-lg)]">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-[var(--fs-tiny)]">
                <strong className="flex-1">
                    豆包{task.kind === "image" ? "生图" : "视频"} · {status === "queued" ? "排队中" : "生成中"}
                </strong>
                <button type="button" aria-pressed="true" onClick={() => setHidden(true)}>
                    隐藏
                </button>
            </div>
            {task.note ? <p className="px-3 py-1 text-[var(--fs-tiny)]">{task.note}</p> : null}
            {connectionError || error ? (
                <p role="status" className="px-3 py-1 text-[var(--fs-tiny)]">
                    {connectionError || error}
                </p>
            ) : null}
            {messages.length ? (
                <div className="thin-scrollbar max-h-40 overflow-y-auto px-3 py-2 text-[var(--fs-tiny)]">
                    {messages.map((message) => (
                        <p key={message.id} className="whitespace-pre-wrap break-words py-1">
                            <strong>{message.role === "user" ? "你" : "豆包"}：</strong>
                            {message.text}
                        </p>
                    ))}
                </div>
            ) : null}
            <form
                className="flex gap-2 border-t border-border p-2"
                onSubmit={(event) => {
                    event.preventDefault();
                    void send();
                }}
            >
                <input
                    className="min-w-0 flex-1 rounded-[var(--r-sm)] border border-border bg-surface px-2 text-[var(--fs-tiny)]"
                    aria-label="回复豆包"
                    placeholder="回复豆包"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    disabled={sending || !accountId}
                />
                <button type="submit" disabled={!draft.trim() || sending || !accountId} className="rounded-[var(--r-sm)] bg-primary px-3 py-1 text-[var(--fs-tiny)] text-primary-foreground disabled:opacity-50">
                    {sending ? "发送中" : "发送"}
                </button>
            </form>
        </div>
    );
}
