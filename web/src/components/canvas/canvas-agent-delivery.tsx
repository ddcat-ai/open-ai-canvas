import { Button } from "antd";
import type { AgentRun } from "@/services/api/agent";
import type { CanvasTheme } from "@/lib/canvas-theme";

export function CanvasAgentDelivery({ run, theme, restoring, disabled, onRestore, onFocus, onContinue }: {
    run: AgentRun; theme: CanvasTheme; restoring: string | null; disabled?: boolean;
    onRestore: (taskId: string) => void; onFocus?: (nodeId: string) => void; onContinue: () => void;
}) {
    const delivery = run.delivery;
    if (!delivery || delivery.status === "running" || (!delivery.items.length && !delivery.pendingTitles.length)) return null;
    return <section aria-label="本轮交付结果" style={{ borderTop: `1px solid ${theme.node.stroke}`, padding: "10px 14px", color: theme.node.text, maxHeight: 220, overflowY: "auto" }} data-canvas-wheel-scroll>
        <div style={{ fontSize: 12, color: theme.node.muted, marginBottom: 6 }}>{delivery.items.length ? `本轮生成记录 · ${delivery.items.filter((item) => item.status === "delivered").length} 项已在画布，共 ${delivery.items.length} 次尝试` : "本轮仍有待完成事项"}</div>
        {delivery.items.map((item, index) => <div key={item.taskId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 12, marginTop: 4 }}>
            <span>{item.kind === "image" ? "图片" : item.kind === "video" ? "视频" : "音频"} {index + 1} · {({ delivered: "已在画布", restore_available: "已生成，待放回画布", restored_then_changed: "恢复后已修改或移除，可从素材库重新添加", failed: "生成未成功", pending: "任务尚未结束", unavailable: "结果资源暂不可用" })[item.status]}</span>
            {item.status === "restore_available" ? <Button size="small" disabled={disabled || Boolean(restoring) || Boolean(run.cleanupPending)} loading={restoring === item.taskId} onClick={() => onRestore(item.taskId)}>恢复到画布（不收费）</Button> : item.nodeId && onFocus ? <Button size="small" onClick={() => onFocus(item.nodeId!)}>定位</Button> : null}
        </div>)}
        {delivery.pendingTitles.length ? <div style={{ fontSize: 12, marginTop: 8 }}>待完成：{delivery.pendingTitles.join("、")}</div> : null}
        {(delivery.status === "partial" || delivery.status === "needs_attention") ? <Button size="small" disabled={disabled || Boolean(restoring)} style={{ marginTop: 8 }} onClick={onContinue}>继续处理剩余项</Button> : null}
    </section>;
}
