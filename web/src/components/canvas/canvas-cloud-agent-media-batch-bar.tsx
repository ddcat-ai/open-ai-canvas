import { useState } from "react";
import { ChevronDown, ChevronUp, Layers, X } from "lucide-react";

import type { canvasThemes } from "@/lib/canvas-theme";
import { agentMediaBatchCounts, agentMediaBatchPhaseLabel, type CloudAgentMediaBatchItemStatus, type CloudAgentMediaBatchProgress } from "@/lib/canvas/cloud-agent-media-batch";

const STATUS_LABEL: Record<CloudAgentMediaBatchItemStatus, string> = { pending: "排队", submitted: "生成中", succeeded: "完成", failed: "失败", cancelled: "已取消" };

/**
 * 批量生成进度条：一格对应一个条目，颜色表示状态；点格子定位到画布节点。
 * 与"本轮待办"条放在同一位置，运行结束后保留最终结果，方便回看失败原因。
 */
export function AgentMediaBatchBar({ batch, theme, onFocusNode, onDismiss }: { batch: CloudAgentMediaBatchProgress; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onFocusNode?: (nodeId: string) => void; onDismiss?: () => void }) {
    const [expanded, setExpanded] = useState(false);
    const counts = agentMediaBatchCounts(batch);
    const total = Math.max(batch.total, batch.items.length);
    const finished = counts.succeeded + counts.failed + counts.cancelled;
    const failures = batch.items.filter((item) => item.status === "failed");
    const color = (status: CloudAgentMediaBatchItemStatus) =>
        status === "succeeded" ? "var(--color-success, #429477)" : status === "failed" ? theme.accent.danger : status === "submitted" ? theme.accent.primary : status === "cancelled" ? theme.node.muted : theme.toolbar.itemHover;
    return (
        <section className="agent-media-batch-bar mx-3 mb-2 overflow-hidden rounded-xl" style={{ color: theme.node.text }} aria-label="批量生成进度">
            <button
                type="button"
                className={`flex w-full items-center gap-2 px-3 py-2 text-left focus-visible:outline focus-visible:outline-2${batch.phase === "done" && onDismiss ? " pr-10" : ""}`}
                aria-expanded={expanded}
                onClick={() => setExpanded((value) => !value)}
            >
                <Layers className="size-3.5 shrink-0" style={{ color: theme.accent.primary }} aria-hidden="true" />
                <span className="text-xs font-semibold">批量生成</span>
                <span className="text-[var(--fs-label)] tabular-nums opacity-60" aria-live="polite">
                    {counts.succeeded}/{total} 完成
                    {counts.submitted ? ` · ${counts.submitted} 生成中` : ""}
                    {counts.failed ? ` · ${counts.failed} 失败` : ""}
                </span>
                <span className="min-w-0 flex-1" />
                <span className="shrink-0 text-[var(--fs-label)] opacity-55">{agentMediaBatchPhaseLabel(batch.phase)}</span>
                {expanded ? <ChevronUp className="size-3.5 shrink-0 opacity-50" aria-hidden="true" /> : <ChevronDown className="size-3.5 shrink-0 opacity-50" aria-hidden="true" />}
            </button>
            {batch.phase === "done" && onDismiss ? (
                <button
                    type="button"
                    className="absolute right-2 top-2 grid size-6 place-items-center rounded-md opacity-60 hover:bg-foreground/10 hover:opacity-100 focus-visible:outline focus-visible:outline-2"
                    onClick={onDismiss}
                    aria-label="关闭批量生成结果"
                    title="关闭"
                >
                    <X className="size-3.5" aria-hidden="true" />
                </button>
            ) : null}
            <div className="px-3 pb-2">
                <div className="h-1 overflow-hidden rounded-full" style={{ background: theme.toolbar.itemHover }} role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={finished} aria-label="已结束条目">
                    <div className="agent-media-batch-progress h-full rounded-full" style={{ width: `${total ? Math.round((finished / total) * 100) : 0}%`, background: theme.accent.primary }} />
                </div>
                <div className="agent-media-batch-grid mt-2" role="list">
                    {batch.items.map((item) => (
                        <button
                            key={item.index}
                            type="button"
                            role="listitem"
                            className="agent-media-batch-cell"
                            data-status={item.status}
                            style={{ background: color(item.status) }}
                            title={`#${item.index + 1} ${item.title || ""} · ${STATUS_LABEL[item.status]}${item.error ? `：${item.error}` : ""}`}
                            aria-label={`第 ${item.index + 1} 条 ${item.title || ""}，${STATUS_LABEL[item.status]}`}
                            onClick={() => onFocusNode?.(item.nodeId)}
                            disabled={!onFocusNode}
                        />
                    ))}
                </div>
                {expanded && failures.length ? (
                    <ul className="mt-2 space-y-1 text-[var(--fs-label)]" style={{ color: theme.node.muted }}>
                        {failures.map((item) => (
                            <li key={item.index} className="flex min-w-0 gap-1">
                                <span className="shrink-0 tabular-nums">#{item.index + 1}</span>
                                <span className="min-w-0 truncate" title={item.error}>
                                    {item.title || "未命名"}：{item.error || "未成功"}
                                </span>
                            </li>
                        ))}
                    </ul>
                ) : null}
            </div>
        </section>
    );
}
