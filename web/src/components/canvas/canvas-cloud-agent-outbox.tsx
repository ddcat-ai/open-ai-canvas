// 排队消息条：放在输入区外壳顶部，逐条可插话、编辑、移出；整条队列可暂停、继续、清空。
// 只负责展示与交互，队列数据、发送和插话由面板处理（见 lib/canvas/agent-outbox.ts）。

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ListOrdered, LoaderCircle, Pause, Pencil, Play, RotateCcw, Send, X, Zap } from "lucide-react";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { agentOutboxItemEditable, agentOutboxPauseLabel, agentOutboxPreview, type AgentOutbox, type AgentOutboxItem } from "@/lib/canvas/agent-outbox";

export type AgentOutboxPrimaryAction = {
    kind: "interject" | "send" | "answer";
    label: string;
    /** 不能执行时的原因；null 表示可以执行。 */
    disabledReason: string | null;
};

export function AgentOutboxTray({
    outbox,
    references,
    subtitle,
    primaryAction,
    itemMeta,
    pendingRetry,
    onPrimary,
    onEdit,
    onRemove,
    onPause,
    onResume,
    onClear,
}: {
    outbox: AgentOutbox;
    references: readonly CanvasResourceReference[];
    /** 未暂停时标题后的一句说明，例如「本轮结束后依次发送」。 */
    subtitle: string;
    primaryAction: (item: AgentOutboxItem) => AgentOutboxPrimaryAction;
    /** 行内第二行：与当前设置不同的地方等补充说明。 */
    itemMeta: (item: AgentOutboxItem) => string;
    /** 上一条新一轮提交结果未确认：原样重试，不会重复建轮。 */
    pendingRetry?: { text: string; disabled: boolean; onRetry: () => void } | null;
    onPrimary: (item: AgentOutboxItem, action: AgentOutboxPrimaryAction) => void;
    onEdit: (item: AgentOutboxItem) => void;
    onRemove: (item: AgentOutboxItem) => void;
    onPause: () => void;
    onResume: () => void;
    onClear: () => void;
}) {
    const [confirmingClear, setConfirmingClear] = useState(false);
    const reducedMotion = useReducedMotion();
    const rowTransition = { duration: reducedMotion ? 0 : 0.2, ease: "easeOut" as const };
    useEffect(() => {
        if (!confirmingClear) return;
        const timer = window.setTimeout(() => setConfirmingClear(false), 3000);
        return () => window.clearTimeout(timer);
    }, [confirmingClear]);
    const items = outbox.items;
    if (!items.length && !pendingRetry) return null;
    const paused = outbox.paused;
    const pendingPreview = pendingRetry ? agentOutboxPreview(pendingRetry.text, references) || "（空消息）" : "";
    const stop = (event: { stopPropagation(): void }) => event.stopPropagation();
    return (
        <section className={`agent-outbox${paused ? " is-paused" : ""}`} aria-label="排队消息" onPointerDown={stop} onMouseDown={stop}>
            <div className="agent-outbox-head">
                {paused ? <Pause className="size-3.5 shrink-0" aria-hidden="true" /> : <ListOrdered className="size-3.5 shrink-0" aria-hidden="true" />}
                <span className="agent-outbox-title" role="status">
                    {paused ? agentOutboxPauseLabel(paused, items.length) : items.length ? `排队 ${items.length} 条` : "上一条消息结果待确认"}
                    {!paused && items.length && subtitle ? <span className="agent-outbox-subtitle"> · {subtitle}</span> : null}
                </span>
                {items.length ? (
                    paused ? (
                        <button type="button" className="agent-outbox-head-action is-primary" onClick={onResume} title="恢复自动发送：从第 1 条开始，每条作为新一轮依次发出">
                            <Play className="size-3" aria-hidden="true" />
                            继续发送
                        </button>
                    ) : (
                        <button type="button" className="agent-outbox-head-action" onClick={onPause} title="暂停自动发送，排队消息保留">
                            <Pause className="size-3" aria-hidden="true" />
                            暂停
                        </button>
                    )
                ) : null}
                {items.length ? (
                    <button
                        type="button"
                        className={`agent-outbox-head-action${confirmingClear ? " is-danger" : ""}`}
                        onClick={() => {
                            if (!confirmingClear) {
                                setConfirmingClear(true);
                                return;
                            }
                            setConfirmingClear(false);
                            onClear();
                        }}
                        onKeyDown={(event) => {
                            if (event.key === "Escape" && confirmingClear) {
                                event.preventDefault();
                                event.stopPropagation();
                                setConfirmingClear(false);
                            }
                        }}
                        title={confirmingClear ? "再点一次清空全部排队消息" : "清空全部排队消息"}
                    >
                        {confirmingClear ? "确认清空" : "清空"}
                    </button>
                ) : null}
            </div>
            <ol className="agent-outbox-list thin-scrollbar" data-canvas-wheel-scroll>
                {pendingRetry ? (
                    <li className="agent-outbox-row is-failed" aria-label={`结果待确认：${pendingPreview}`}>
                        <span className="agent-outbox-index" aria-hidden="true">
                            !
                        </span>
                        <span className="agent-outbox-copy">
                            <span className="agent-outbox-text" title={pendingPreview}>
                                {pendingPreview}
                            </span>
                            <span className="agent-outbox-meta">没有收到服务端确认；重试会核对原请求，不会重复创建</span>
                        </span>
                        <span className="agent-outbox-actions">
                            <button type="button" className="agent-outbox-action" disabled={pendingRetry.disabled} onClick={pendingRetry.onRetry} title="用原来的请求重试">
                                <RotateCcw className="size-3" aria-hidden="true" />
                                重试
                            </button>
                        </span>
                    </li>
                ) : null}
                <AnimatePresence initial={false}>
                    {items.map((item, index) => {
                        const preview = agentOutboxPreview(item.displayText || item.text, references) || "（空消息）";
                        const action = primaryAction(item);
                        const busy = item.status === "interjecting" || item.status === "dispatching";
                        const meta = item.status === "interjecting" ? "正在插话…" : item.status === "dispatching" ? "正在发送…" : item.status === "editing" ? "正在编辑：Enter 保存，Esc 取消" : item.error || itemMeta(item);
                        const editable = agentOutboxItemEditable(item);
                        const ActionIcon = action.kind === "interject" ? Zap : Send;
                        return (
                            <motion.li
                                key={item.id}
                                className={`agent-outbox-row${item.status === "failed" ? " is-failed" : ""}`}
                                aria-label={`排队第 ${index + 1} 条：${preview}`}
                                initial={{ height: 0, opacity: 0, paddingBlock: 0, minHeight: 0 }}
                                animate={{ height: "auto", opacity: 1, paddingBlock: 4, minHeight: 34 }}
                                exit={{ height: 0, opacity: 0, paddingBlock: 0, minHeight: 0 }}
                                transition={rowTransition}
                            >
                                <span className="agent-outbox-index" aria-hidden="true">
                                    {index + 1}
                                </span>
                                <span className="agent-outbox-copy">
                                    <span className="agent-outbox-text" title={preview}>
                                        {preview}
                                    </span>
                                    <span className="agent-outbox-meta">{meta}</span>
                                </span>
                                <span className="agent-outbox-actions">
                                    <button
                                        type="button"
                                        className="agent-outbox-action"
                                        disabled={busy || Boolean(action.disabledReason)}
                                        onClick={() => onPrimary(item, action)}
                                        title={action.disabledReason || (action.kind === "interject" ? "插进当前轮：Agent 下一步就会看到，不新开一轮" : action.kind === "answer" ? "作为对 Agent 提问的回答发送" : "现在作为新一轮发送")}
                                    >
                                        {busy ? <LoaderCircle className="size-3 animate-spin" aria-hidden="true" /> : <ActionIcon className="size-3" aria-hidden="true" />}
                                        {action.label}
                                    </button>
                                    <button
                                        type="button"
                                        className="agent-outbox-icon-action"
                                        disabled={!editable}
                                        onClick={() => onEdit(item)}
                                        aria-label="编辑这条排队消息"
                                        title={editable ? "编辑：载入输入框，Enter 保存，Esc 取消" : item.displayText && item.displayText !== item.text ? "这条由画布操作生成，不能编辑；可以移出后重新发送" : "正在处理，暂时不能编辑"}
                                    >
                                        <Pencil className="size-3.5" aria-hidden="true" />
                                    </button>
                                    <button type="button" className="agent-outbox-icon-action" disabled={busy} onClick={() => onRemove(item)} aria-label="移出队列" title="移出队列">
                                        <X className="size-3.5" aria-hidden="true" />
                                    </button>
                                </span>
                            </motion.li>
                        );
                    })}
                </AnimatePresence>
            </ol>
        </section>
    );
}
