import { compileCreativeStylePrompt } from "@/lib/creation/creative-style-plan";
import type { SmartCreationAgentPlan, SmartCreationTaskSettings } from "@/lib/plugins/plugin-types";
import type { SmartCreationExecutionOptions } from "@/lib/plugins/smart-creation-agent";

/** 计划展开后的单张图片任务；variant 已拆成独立任务，count 固定为 1。 */
export type SmartCreationGenerationTask = {
    itemId: string;
    title: string;
    prompt: string;
    settings: SmartCreationTaskSettings;
    position: number;
};

export type SmartCreationExpansion = {
    tasks: SmartCreationGenerationTask[];
    /** 超出插件声明的 maxTasks 而未提交的图片数。 */
    truncated: number;
};

/**
 * 把计划展开成逐张任务，并编译统一风格：有 styleBible 时编译风格锁，
 * 否则退回套图级 visualDirection，保证同一批次每张图共享同一套视觉约束。
 */
export function expandSmartCreationPlan(plan: SmartCreationAgentPlan, options: Pick<SmartCreationExecutionOptions, "maxTasks">): SmartCreationExpansion {
    const expanded = plan.tasks.flatMap((task) => Array.from({ length: Math.max(1, task.settings.count) }, (_, variantIndex) => ({
        itemId: task.settings.count > 1 ? `${task.itemId}:variant-${variantIndex + 1}` : task.itemId,
        title: task.settings.count > 1 ? `${task.title}（变体 ${variantIndex + 1}/${task.settings.count}）` : task.title,
        prompt: compileSmartCreationTaskPrompt(plan, task.prompt),
        settings: { ...task.settings, count: 1 },
    })));
    const tasks = expanded.slice(0, options.maxTasks).map((task, index) => ({ ...task, position: index + 1 }));
    return { tasks, truncated: expanded.length - tasks.length };
}

export function compileSmartCreationTaskPrompt(plan: Pick<SmartCreationAgentPlan, "styleBible" | "visualDirection">, taskPrompt: string) {
    if (plan.styleBible) return compileCreativeStylePrompt(plan.styleBible, `本张任务：${taskPrompt}`);
    return plan.visualDirection ? `${plan.visualDirection}\n\n本张任务：${taskPrompt}` : taskPrompt;
}

export type SmartCreationScheduleOptions = {
    concurrency: number;
    capacityWaitMs: number;
    signal?: AbortSignal;
    /** 账号任务数已满的错误判定；满额时等待空位重试，而不是把整张图记为失败。 */
    isCapacityError: (error: unknown) => boolean;
    /** 首张先提交，其余任务在首张提交后再并发；统一风格由 styleBible 负责。 */
    anchorFirst?: boolean;
    retryDelayMs?: number;
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

export type SmartCreationTaskOutcome<T> = { status: "fulfilled"; value: T } | { status: "rejected"; reason: unknown };

function abortError() {
    return new DOMException("Aborted", "AbortError");
}

function defaultSleep(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(abortError());
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(abortError());
        };
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

/**
 * 在并发窗口内逐张执行任务；账号活动任务已满时按间隔等待空位，超过 capacityWaitMs 才判失败。
 * 返回值与 tasks 下标一一对应，调用方据此统一收敛批次状态。
 */
export async function runSmartCreationSchedule<T, R>(tasks: readonly T[], run: (task: T, index: number) => Promise<R>, options: SmartCreationScheduleOptions): Promise<SmartCreationTaskOutcome<R>[]> {
    const outcomes: SmartCreationTaskOutcome<R>[] = new Array(tasks.length);
    const sleep = options.sleep ?? defaultSleep;
    const retryDelayMs = Math.max(0, options.retryDelayMs ?? 3000);
    const execute = async (index: number) => {
        const startedAt = Date.now();
        while (true) {
            if (options.signal?.aborted) {
                outcomes[index] = { status: "rejected", reason: abortError() };
                return;
            }
            try {
                outcomes[index] = { status: "fulfilled", value: await run(tasks[index], index) };
                return;
            } catch (error) {
                const canWait = options.isCapacityError(error) && Date.now() - startedAt < options.capacityWaitMs;
                if (!canWait) {
                    outcomes[index] = { status: "rejected", reason: error };
                    return;
                }
            }
            try {
                await sleep(retryDelayMs, options.signal);
            } catch (error) {
                outcomes[index] = { status: "rejected", reason: error };
                return;
            }
        }
    };
    const worker = async () => {
        while (nextIndex < tasks.length) {
            const index = nextIndex++;
            await execute(index);
        }
    };
    let start = 0;
    if (options.anchorFirst && tasks.length > 1) {
        await execute(0);
        start = 1;
    }
    let nextIndex = start;
    const width = Math.max(1, Math.min(options.concurrency, tasks.length - start));
    await Promise.all(Array.from({ length: width }, () => worker()));
    return outcomes;
}

export type SmartCreationBatchState = {
    total: number;
    resultUrls: string[];
    resultStorageKeys?: string[];
    failedCount: number;
};

export type SmartCreationBatchProjection = {
    status: "pending" | "done" | "error";
    content: string;
    batchCompletedCount: number;
    batchFailedCount: number;
    resultUrls: string[];
    resultStorageKeys?: string[];
};

/**
 * 批次消息的唯一收敛口径：完成数只按去重后的结果图计，只有“完成 + 失败 ≥ 总数”才结束。
 * 页面内逐张回写和刷新后恢复都走这里，避免两套计数把批次提前落成 done。
 */
export function projectSmartCreationBatch(state: SmartCreationBatchState): SmartCreationBatchProjection {
    const resultUrls = Array.from(new Set(state.resultUrls.filter(Boolean)));
    const resultStorageKeys = Array.from(new Set((state.resultStorageKeys || []).filter(Boolean)));
    const total = Math.max(0, Math.floor(state.total));
    const completedCount = Math.max(resultUrls.length, resultStorageKeys.length);
    const failedCount = Math.max(0, Math.floor(state.failedCount));
    const finished = total > 0 && completedCount + failedCount >= total;
    const status = !finished ? "pending" : completedCount ? "done" : "error";
    const content = finished
        ? completedCount
            ? `${completedCount} 张图片已生成${failedCount ? `，${failedCount} 张失败` : ""}`
            : "生成失败"
        : failedCount
            ? `正在生成图片（${completedCount}/${total}，失败 ${failedCount}）`
            : `正在生成图片（${completedCount}/${total}）`;
    return { status, content, batchCompletedCount: completedCount, batchFailedCount: failedCount, resultUrls, ...(resultStorageKeys.length ? { resultStorageKeys } : {}) };
}
