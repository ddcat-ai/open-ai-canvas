// 排队消息条：放在输入区外壳顶部，逐条可插话、编辑、移出；整条队列可暂停、继续、清空。
// 只负责展示与交互，队列数据、发送和插话由面板处理（见 lib/canvas/agent-outbox.ts）。

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ListOrdered, LoaderCircle, Pause, Pencil, Play, RotateCcw, Send, X, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
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
    const { t } = useTranslation();
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
    const pendingPreview = pendingRetry ? agentOutboxPreview(pendingRetry.text, references) || t("canvasA.outbox.emptyMessage") : "";
    const stop = (event: { stopPropagation(): void }) => event.stopPropagation();
    return (
        <section className={`agent-outbox${paused ? " is-paused" : ""}`} aria-label={t("canvasA.outbox.label")} onPointerDown={stop} onMouseDown={stop}>
            <div className="agent-outbox-head">
                {paused ? <Pause className="size-3.5 shrink-0" aria-hidden="true" /> : <ListOrdered className="size-3.5 shrink-0" aria-hidden="true" />}
                <span className="agent-outbox-title" role="status">
                    {paused ? agentOutboxPauseLabel(paused, items.length) : items.length ? t("canvasA.outbox.queued", { count: items.length }) : t("canvasA.outbox.pendingConfirm")}
                    {!paused && items.length && subtitle ? <span className="agent-outbox-subtitle"> · {subtitle}</span> : null}
                </span>
                {items.length ? (
                    paused ? (
                        <button type="button" className="agent-outbox-head-action is-primary" onClick={onResume} title={t("canvasA.outbox.resumeHint")}>
                            <Play className="size-3" aria-hidden="true" />
                            {t("canvasA.outbox.resume")}
                        </button>
                    ) : (
                        <button type="button" className="agent-outbox-head-action" onClick={onPause} title={t("canvasA.outbox.pauseHint")}>
                            <Pause className="size-3" aria-hidden="true" />
                            {t("canvasA.outbox.pause")}
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
                        title={confirmingClear ? t("canvasA.outbox.clearConfirmHint") : t("canvasA.outbox.clearHint")}
                    >
                        {confirmingClear ? t("canvasA.outbox.clearConfirm") : t("canvasA.outbox.clear")}
                    </button>
                ) : null}
            </div>
            <ol className="agent-outbox-list thin-scrollbar" data-canvas-wheel-scroll>
                {pendingRetry ? (
                    <li className="agent-outbox-row is-failed" aria-label={t("canvasA.outbox.pendingRow", { preview: pendingPreview })}>
                        <span className="agent-outbox-index" aria-hidden="true">
                            !
                        </span>
                        <span className="agent-outbox-copy">
                            <span className="agent-outbox-text" title={pendingPreview}>
                                {pendingPreview}
                            </span>
                            <span className="agent-outbox-meta">{t("canvasA.outbox.pendingMeta")}</span>
                        </span>
                        <span className="agent-outbox-actions">
                            <button type="button" className="agent-outbox-action" disabled={pendingRetry.disabled} onClick={pendingRetry.onRetry} title={t("canvasA.outbox.retryHint")}>
                                <RotateCcw className="size-3" aria-hidden="true" />
                                {t("common.retry")}
                            </button>
                        </span>
                    </li>
                ) : null}
                <AnimatePresence initial={false}>
                    {items.map((item, index) => {
                        const preview = agentOutboxPreview(item.displayText || item.text, references) || t("canvasA.outbox.emptyMessage");
                        const action = primaryAction(item);
                        const busy = item.status === "interjecting" || item.status === "dispatching";
                        const meta =
                            item.status === "interjecting" ? t("canvasA.outbox.interjecting") : item.status === "dispatching" ? t("canvasA.outbox.dispatching") : item.status === "editing" ? t("canvasA.outbox.editing") : item.error || itemMeta(item);
                        const editable = agentOutboxItemEditable(item);
                        const ActionIcon = action.kind === "interject" ? Zap : Send;
                        return (
                            <motion.li
                                key={item.id}
                                className={`agent-outbox-row${item.status === "failed" ? " is-failed" : ""}`}
                                aria-label={t("canvasA.outbox.row", { index: index + 1, preview })}
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
                                        title={action.disabledReason || (action.kind === "interject" ? t("canvasA.outbox.interjectHint") : action.kind === "answer" ? t("canvasA.outbox.answerHint") : t("canvasA.outbox.sendHint"))}
                                    >
                                        {busy ? <LoaderCircle className="size-3 animate-spin" aria-hidden="true" /> : <ActionIcon className="size-3" aria-hidden="true" />}
                                        {action.label}
                                    </button>
                                    <button
                                        type="button"
                                        className="agent-outbox-icon-action"
                                        disabled={!editable}
                                        onClick={() => onEdit(item)}
                                        aria-label={t("canvasA.outbox.editLabel")}
                                        title={editable ? t("canvasA.outbox.editHint") : item.displayText && item.displayText !== item.text ? t("canvasA.outbox.editGenerated") : t("canvasA.outbox.editBusy")}
                                    >
                                        <Pencil className="size-3.5" aria-hidden="true" />
                                    </button>
                                    <button type="button" className="agent-outbox-icon-action" disabled={busy} onClick={() => onRemove(item)} aria-label={t("canvasA.outbox.remove")} title={t("canvasA.outbox.remove")}>
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
