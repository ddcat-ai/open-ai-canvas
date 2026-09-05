import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Empty, Tag } from "antd";
import { AlertTriangle, Link2, RefreshCcw, RotateCcw } from "lucide-react";

import {
    getTaskChain,
    regenerateShot,
    retryShotTask,
    type ComfyJobSummary,
    type ShotArtifactSummary,
} from "@/services/api/generation-task";
import { resourceFileUrl } from "@/services/api/resources";
import { type GenerationTask } from "@/services/api/task-center";
import { type ProjectDetail, type ProjectShot } from "@/services/api/projects";
import { customShotTitle } from "@/lib/shot-label";
import { formatDuration } from "./workflow-shared";

/* ------------------------------------------------------------------ *
 * W1-02 F-28：任务链面板（Task → ComfyJob → Artifact 可视化）
 * 只消费 W1-01 #53 已有 API（getTaskChain / retryShotTask / regenerateShot），
 * 不新增第二套 API（D-042 工单第 1 件事）。
 * ------------------------------------------------------------------ */

type TaskChainPanelProps = {
    projectId: string;
    shotId: string;
    /** 当前镜头对应的生成任务（workbench 已派生），为空表示该镜头还没提交过任务 */
    taskId?: string;
    /** 任务运行态由 workbench 传入，用于驱动轮询 */
    taskStatus?: string;
    onRefresh: () => Promise<void>;
};

const TASK_STATUS_META: Record<string, { label: string; color: string }> = {
    queued: { label: "排队中", color: "default" },
    running: { label: "生成中", color: "processing" },
    succeeded: { label: "成功", color: "success" },
    failed: { label: "失败", color: "error" },
    cancelled: { label: "已取消", color: "warning" },
};

const ARTIFACT_STATUS_META: Record<string, { label: string; color: string }> = {
    ready: { label: "就绪", color: "success" },
    pending_resource: { label: "资源待落盘", color: "processing" },
    resource_failed: { label: "资源落盘失败", color: "error" },
    stale: { label: "已过期", color: "default" },
};

const JOB_STATUS_LABEL: Record<string, string> = {
    pending: "待认领",
    claimed: "已认领",
    submitted: "已提交",
    succeeded: "成功",
    failed: "失败",
    expired: "已过期",
};

function statusMeta(map: Record<string, { label: string; color: string }>, status?: string) {
    return (status && map[status]) || { label: status || "未知", color: "default" };
}

export default function TaskChainPanel({ projectId, shotId, taskId, taskStatus, onRefresh }: TaskChainPanelProps) {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const running = taskStatus === "queued" || taskStatus === "running";

    const chainQuery = useQuery({
        queryKey: ["task-chain", taskId],
        queryFn: ({ signal }) => getTaskChain(taskId as string, signal),
        enabled: Boolean(taskId),
        // 任务运行中每 3 秒轮询一次 Job/Artifact 进展
        refetchInterval: running ? 3_000 : false,
    });

    const invalidateChain = async () => {
        await queryClient.invalidateQueries({ queryKey: ["task-chain"] });
        await onRefresh();
    };

    const retryMutation = useMutation({
        mutationFn: () => retryShotTask(projectId, shotId, taskId as string),
        onSuccess: async () => {
            message.success("已按原参数重试，同一任务新增一次尝试");
            await invalidateChain();
        },
        onError: (error: unknown) => message.error(error instanceof Error ? `重试失败：${error.message}` : "重试失败"),
    });

    const regenerateMutation = useMutation({
        mutationFn: () => regenerateShot(projectId, shotId),
        onSuccess: async () => {
            message.success("已按上次参数重新生成，将产生新版本产物");
            await invalidateChain();
        },
        onError: (error: unknown) => message.error(error instanceof Error ? `重新生成失败：${error.message}` : "重新生成失败"),
    });

    if (!taskId) {
        return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前镜头还没有生成任务，提交生成后这里会展示完整任务链" className="mt-6" />;
    }

    const chain = chainQuery.data;
    const task = chain?.task;
    // R4：只看**末次尝试**是否失败。
    // 原写法 `jobs.some((job) => job.status === "failed")` 会把「中途失败过、但末次已成功」
    // 的任务也判定为失败，导致重试按钮常驻——而此时重试是多余操作（结果已经出来了）。
    // D-020：Retry = 同一 Task 新 Job，attemptNo 单调递增，故取 attemptNo 最大者即为末次。
    const lastJob = (chain?.jobs ?? []).reduce<ComfyJobSummary | undefined>(
        (latest, job) => (!latest || job.attemptNo > latest.attemptNo ? job : latest),
        undefined,
    );
    const lastJobFailed = lastJob?.status === "failed";

    return (
        <section className="flex flex-col gap-3 py-2">
            <header className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-foreground/70">
                    <Link2 className="size-3.5" />
                    <span>任务链</span>
                    {task ? statusMeta(TASK_STATUS_META, task.status).label : chainQuery.isFetching ? <span className="text-foreground/40">读取中…</span> : null}
                </div>
                <div className="flex items-center gap-1.5">
                    <Button size="small" icon={<RefreshCcw className="size-3" />} loading={chainQuery.isFetching} onClick={() => void chainQuery.refetch()}>刷新</Button>
                    {task?.status === "failed" || (!running && lastJobFailed) ? (
                        <Button size="small" danger icon={<RotateCcw className="size-3" />} loading={retryMutation.isPending} onClick={() => retryMutation.mutate()}>按原参数重试</Button>
                    ) : null}
                    <Button size="small" type="primary" ghost icon={<RefreshCcw className="size-3" />} disabled={running} loading={regenerateMutation.isPending} onClick={() => regenerateMutation.mutate()}>按上次参数重新生成</Button>
                </div>
            </header>

            {task ? (
                <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                        <Tag color={statusMeta(TASK_STATUS_META, task.status).color}>{statusMeta(TASK_STATUS_META, task.status).label}</Tag>
                        <span className="text-foreground/45">创建 {new Date(task.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-foreground/35">Task {task.id}</div>
                </div>
            ) : null}

            {chain?.jobs?.length ? (
                <div className="flex flex-col gap-1.5">
                    <div className="text-xs font-medium text-foreground/60">执行尝试（ComfyJob）</div>
                    {chain.jobs.map((job) => <ChainJobRow key={job.id} job={job} />)}
                </div>
            ) : task ? (
                <div className="text-xs text-foreground/40">该任务还没有执行尝试记录（可能仍在排队或走非 Bridge 通道）</div>
            ) : null}

            {chain?.artifacts?.length ? (
                <div className="flex flex-col gap-1.5">
                    <div className="text-xs font-medium text-foreground/60">产物版本</div>
                    {chain.artifacts.map((artifact) => <ChainArtifactRow key={artifact.id} artifact={artifact} />)}
                </div>
            ) : task?.status === "succeeded" ? (
                <div className="text-xs text-foreground/40">任务已成功但尚未登记产物（可能正在落盘）</div>
            ) : null}
        </section>
    );
}

function ChainJobRow({ job }: { job: ComfyJobSummary }) {
    const failed = job.status === "failed";
    return (
        <div className={`rounded-lg border px-3 py-2 text-xs ${failed ? "border-red-500/30 bg-red-500/5" : "border-border/60 bg-background/40"}`}>
            <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">尝试 #{job.attemptNo}</span>
                <Tag color={failed ? "error" : job.status === "succeeded" ? "success" : "default"}>{JOB_STATUS_LABEL[job.status] || job.status}</Tag>
                {job.errorCode ? <Tag color="warning">{job.errorCode}</Tag> : null}
                {job.completedAt ? <span className="text-foreground/35">{new Date(job.completedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span> : null}
            </div>
            {job.error ? (
                <div className="mt-1 flex items-start gap-1 text-foreground/55"><AlertTriangle className="mt-0.5 size-3 shrink-0 text-red-500/70" /><span className="break-all">{job.error}</span></div>
            ) : null}
            <div className="mt-1 font-mono text-[11px] text-foreground/30">Job {job.id}{job.comfyPromptId ? ` · prompt ${job.comfyPromptId}` : ""}</div>
        </div>
    );
}

function ChainArtifactRow({ artifact }: { artifact: ShotArtifactSummary }) {
    const meta = statusMeta(ARTIFACT_STATUS_META, artifact.status);
    const isImage = artifact.type === "storyboard" || artifact.type === "action_board";
    return (
        <div className="flex items-center gap-2.5 rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-xs">
            {artifact.resourceId && isImage ? <img src={resourceFileUrl(artifact.resourceId)} alt="" className="size-9 shrink-0 rounded object-cover" loading="lazy" /> : null}
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <span className="font-medium">v{artifact.version}</span>
                <Tag color={meta.color}>{meta.label}</Tag>
                {artifact.selected ? <Tag color="gold">当前选中</Tag> : null}
                {artifact.durationMs > 0 ? <span className="text-foreground/40">{formatDuration(artifact.durationMs)}</span> : null}
                {artifact.provider ? <span className="text-foreground/40">{artifact.provider}</span> : null}
            </div>
            <span className="shrink-0 font-mono text-[11px] text-foreground/30">{new Date(artifact.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
        </div>
    );
}

/* ------------------------------------------------------------------ *
 * W1-02 #3 Activity 时间线（D-031 / D-022）：
 * 事实型事件的纯前端投影——数据源只有既有 detail.tasks（Action = Task），
 * 不建 Event Store / AgentRun / AgentAction 表，不新增任何 API。
 * ------------------------------------------------------------------ */

const ACTIVITY_PAGE_SIZE = 12;

export function ActivityTimeline({ detail, shots }: { detail: ProjectDetail; shots: ProjectShot[] }) {
    const events = useMemo(() => {
        const shotTitleById = new Map(shots.map((shot, index) => [shot.id, customShotTitle(shot.title, index) || shot.title || "未命名镜头"]));
        return (detail.tasks || [])
            .slice()
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
            .slice(0, ACTIVITY_PAGE_SIZE)
            .map((task) => {
                const shotId = task.clientContext?.shotId;
                const meta = statusMeta(TASK_STATUS_META, task.status);
                const subject = shotId ? `镜头「${shotTitleById.get(shotId) || shotId}」` : "画布";
                const action = task.clientContext?.artifactType === "video" ? "视频生成" : task.clientContext?.artifactType === "action_board" ? "动作预演" : task.clientContext?.artifactType === "storyboard" ? "分镜图" : "生成";
                return { key: task.id, subject, action, statusLabel: meta.label, statusColor: meta.color, time: task.updatedAt || task.createdAt };
            });
    }, [detail.tasks, shots]);
    if (!events.length) return <div className="text-xs text-foreground/40">还没有生成任务记录</div>;
    return (
        <ol className="flex flex-col gap-1.5">
            {events.map((event) => (
                <li key={event.key} className="flex items-center gap-2 text-xs">
                    <span className="min-w-0 flex-1 truncate">{event.subject}{event.action}</span>
                    <Tag color={event.statusColor} className="mr-0">{event.statusLabel}</Tag>
                    <span className="shrink-0 text-foreground/35">{new Date(event.time).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                </li>
            ))}
            {(detail.tasks?.length || 0) > ACTIVITY_PAGE_SIZE ? <li className="text-[11px] text-foreground/30">仅显示最近 {ACTIVITY_PAGE_SIZE} 条（共 {detail.tasks?.length} 条任务）</li> : null}
        </ol>
    );
}
