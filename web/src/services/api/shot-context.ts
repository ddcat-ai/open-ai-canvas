import type { ProjectDetail } from "./projects";
import type { GenerationTask } from "./task-center";

/* ------------------------------------------------------------------ *
 * W1-B-01（D-046）：镜头域蒸馏函数——纯函数、零运行时依赖（仅 type import），
 * 可在 bun:test / node(tsx) 双环境直接单测。
 * getShot 的返回 =「Shot 本体 + 当前 Revision + 产物版本列表 + 最新任务」，
 * 与 getProjectContext（全项目蒸馏）分层：一个是单镜详情，一个是全局概览。
 * ------------------------------------------------------------------ */

/** 定位镜头最新的生成任务（updatedAt 最新者优先）；没有返回 undefined。 */
export function latestShotTask(detail: ProjectDetail, shotId: string): GenerationTask | undefined {
    return (detail.tasks || [])
        .filter((task) => task.clientContext?.shotId === shotId)
        .slice()
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

export type ShotContextSummary = {
    shot: ProjectDetail["shots"][number];
    revision?: { id: string; version: number; durationMs: number };
    artifacts: Array<{ id: string; type: string; version: number; status: string; selected: boolean; durationMs?: number; provider?: string; createdAt: string }>;
    latestTask?: { id: string; status: string; completedAt?: string; updatedAt: string };
};

/** 单镜生产上下文摘要：供 Agent 在 review / retry / regenerate 决策前读取。 */
export function distillShotContext(detail: ProjectDetail, shotId: string): ShotContextSummary | null {
    const shot = (detail.shots || []).find((item) => item.id === shotId);
    if (!shot) return null;
    const revision = (detail.shotRevisions || [])
        .filter((item) => item.shotId === shotId)
        .slice()
        .sort((left, right) => right.version - left.version)[0];
    const artifacts = (detail.shotArtifacts || [])
        .filter((item) => item.shotId === shotId)
        .slice()
        .sort((left, right) => right.version - left.version)
        .map((item) => ({ id: item.id, type: item.type, version: item.version, status: item.status, selected: item.selected, durationMs: item.durationMs, ...(item.provider ? { provider: item.provider } : {}), createdAt: item.createdAt }));
    const latestTask = latestShotTask(detail, shotId);
    return {
        shot,
        revision: revision ? { id: revision.id, version: revision.version, durationMs: revision.durationMs } : undefined,
        artifacts,
        latestTask: latestTask ? { id: latestTask.id, status: latestTask.status, ...(latestTask.completedAt ? { completedAt: latestTask.completedAt } : {}), updatedAt: latestTask.updatedAt } : undefined,
    };
}
