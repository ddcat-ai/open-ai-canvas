import { Coins } from "lucide-react";

import { formatCredits } from "@/constant/credits";
import { CONTENT_MODERATION_ERROR_CODE, generationErrorMessage, isContentModerationError } from "@/lib/generation-error";
import type { GenerationTask, TaskStatus } from "@/services/api/task-center";
import { modelDisplayName, type AiConfig } from "@/stores/use-config-store";

export function getTaskCanvasContext(task: GenerationTask, canvasById: Map<string, { title: string; projectId?: string }>, projectNameById: Map<string, string>) {
    if (!task.projectId) return { canvasName: "未绑定画布", projectName: "" };
    const canvas = canvasById.get(task.projectId);
    if (canvas) return { canvasName: canvas.title || "未命名画布", projectName: canvas.projectId ? projectNameById.get(canvas.projectId) || "" : "" };
    const projectName = projectNameById.get(task.projectId);
    return projectName ? { canvasName: "项目级任务", projectName } : { canvasName: "画布已移除", projectName: "" };
}

export function isTaskFailed(task: GenerationTask) {
    return task.status === "failed" || task.status === "cancelled";
}

export function taskAttentionReason(task: GenerationTask) {
    if (task.status === "cancelled") return providerCancelStatusLabel(task);
    if (task.errorCode === CONTENT_MODERATION_ERROR_CODE || isContentModerationError(task.error)) return "内容审核未通过，请修改输入后新建任务";
    if (task.error) return generationErrorMessage(task.error);
    return task.stage || "生成失败，打开详情查看原因";
}

export function providerCancelStatusLabel(task: GenerationTask) {
    if (task.providerCancelStatus === "requested") return "已请求上游取消，正在等待确认";
    if (task.providerCancelStatus === "confirmed") return "上游已确认取消，积分已退回";
    if (task.providerCancelStatus === "uncertain") {
        if (task.billing?.status === "settled") return "上游未能取消，费用已结算";
        if (task.billing?.status === "refunded") return "上游取消结果未确认，积分已退回";
        return task.providerCancelError || "上游无法确认取消，费用待核对";
    }
    return task.billing?.status === "refunded" ? "任务在调用上游前取消，积分已退回" : "任务已取消，可按原输入重新提交";
}

export function statusDotClassName(status: TaskStatus) {
    if (status === "succeeded") return "task-record-dot is-success";
    if (status === "running") return "task-record-dot is-active is-pulsing";
    if (status === "queued") return "task-record-dot is-queued";
    if (status === "failed") return "task-record-dot is-failed";
    return "task-record-dot is-idle";
}

export function taskMediaKind(task: GenerationTask): "text" | "image" | "video" {
    const value = `${task.type} ${task.operation || ""}`.toLowerCase();
    if (value.includes("video") || value.includes("视频")) return "video";
    if (value.includes("image") || value.includes("图片") || value.includes("画面")) return "image";
    return "text";
}

export function TaskDate({ value }: { value?: string }) {
    if (!value) return <span className="text-xs text-foreground/38">-</span>;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return <span className="text-xs text-foreground/38">-</span>;
    const compact = `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
    return (
        <time className="task-record-date-value" dateTime={date.toISOString()} title={date.toLocaleString()}>
            {compact}
        </time>
    );
}

export function TaskBilling({ billing }: { billing?: GenerationTask["billing"] }) {
    if (!billing) return <span className="task-record-billing-empty text-xs text-foreground/30">-</span>;
    const amount = formatCredits(billing.amountMicrocredits);
    const note = billing.status === "settled" ? "已结算" : billing.status === "refunded" ? "已退回" : billing.status === "uncertain" ? "待核对" : "预计";
    return (
        <div className={`task-record-billing ${billing.status === "uncertain" ? "is-uncertain" : ""}`} title={`积分${note}`}>
            <Coins className="size-4" />
            <span>
                <strong>{amount}</strong>
                <small>{note}</small>
            </span>
        </div>
    );
}

export function formatModelName(config: AiConfig, task: GenerationTask) {
    const raw = (task.model || task.provider || "").trim();
    const model = raw.includes("::") ? raw.split("::").pop()?.trim() || raw : raw;

    // 工作流名称是任务快照，不属于模型渠道，不能交给模型展示名解析器再次映射成“系统模型”。
    if (task.provider === "runninghub" || task.provider === "comfyui-bridge") return raw || "工作流";
    if (!model) return "工作流";
    if (model === "version-router") return "版本对比工作流";
    if (model === "workflow-router") return "工作流路由";
    if (model === "internal-agent") return "内置工作流";
    if (model === "openai-compatible") return "OpenAI 兼容接口";
    return modelDisplayName(config, raw);
}
