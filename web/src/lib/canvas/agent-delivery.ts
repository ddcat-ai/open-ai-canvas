import type { AgentRun } from "@/services/api/agent";

export function agentRunStatusLabel(run: AgentRun | null): string {
    if (!run) return "待命";
    if (run.cleanupPending) return "正在收尾";
    if (run.status === "running" || run.status === "queued") return "运行中";
    if (run.status === "waiting_approval") return "等待审批";
    if (run.status === "cancelled") return "已停止";
    if (run.status === "rejected") return "已拒绝";
    if (run.delivery?.status === "awaiting_input") return "待你补充";
    if (run.delivery?.status === "partial") return "部分交付";
    if (run.status === "failed") return "需要处理";
    if (run.delivery?.status === "needs_attention") return "尚未完成";
    if (run.delivery?.status === "has_failures") return "已有交付，有失败记录";
    if (run.delivery?.status === "delivered") return "已交付到画布";
    return "本轮已结束";
}
