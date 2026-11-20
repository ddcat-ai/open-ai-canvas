import { getActiveUserScope } from "@/lib/user-scope";
import type { GenerationTask } from "@/services/api/task-center";

type ActiveEntry = { scope: string; seenAt: number; firstSeenAt: number };

const activeTasks = new Map<string, ActiveEntry>();
const announcedTaskIds = new Set<string>();
const listeners = new Set<(task: GenerationTask) => void>();
const MAX_ANNOUNCED = 500;

/**
 * 所有读到任务状态的地方（创建、详情、列表、订阅）都汇到这里。只有本标签页见过排队/运行中的任务
 * 变成成功才算「刚完成」，每个任务只通知一次；打开历史列表时已经结束的任务不会补发提醒。
 */
export function observeGenerationTaskStatus(task: GenerationTask | undefined | null) {
    if (!task?.id) return;
    const now = Date.now();
    const scope = getActiveUserScope();
    if (task.status === "queued" || task.status === "running") {
        const previous = activeTasks.get(task.id);
        activeTasks.set(task.id, { scope, seenAt: now, firstSeenAt: previous?.scope === scope ? previous.firstSeenAt : now });
        return;
    }
    const entry = activeTasks.get(task.id);
    activeTasks.delete(task.id);
    if (task.status !== "succeeded" || !entry || entry.scope !== scope || announcedTaskIds.has(task.id)) return;
    announcedTaskIds.add(task.id);
    if (announcedTaskIds.size > MAX_ANNOUNCED) announcedTaskIds.delete(announcedTaskIds.values().next().value as string);
    for (const listener of listeners) listener(task);
}

export function observeGenerationTaskStatuses(tasks: readonly GenerationTask[]) {
    for (const task of tasks) observeGenerationTaskStatus(task);
}

export function subscribeGenerationTaskSuccess(listener: (task: GenerationTask) => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * 离开画布等页面后，页面自己的轮询会停止，但任务仍在后端运行。返回一段时间没人刷新过的运行中任务，
 * 由全局提醒继续低频查询；超过最长等待时间的任务不再跟踪。
 */
export function staleActiveGenerationTaskIds(staleMs: number, maxAgeMs: number, limit: number) {
    const now = Date.now();
    const scope = getActiveUserScope();
    const ids: string[] = [];
    for (const [id, entry] of activeTasks) {
        if (entry.scope !== scope || now - entry.firstSeenAt > maxAgeMs) {
            activeTasks.delete(id);
            continue;
        }
        if (now - entry.seenAt >= staleMs) ids.push(id);
        if (ids.length >= limit) break;
    }
    return ids;
}

export function forgetGenerationTask(id: string) {
    activeTasks.delete(id);
}
