import { ApiError } from "@/services/api/request";

type ActiveTask = { status: string };

type SlotOptions = {
    checkBatch?: () => Promise<void>;
    activeLimit: () => number;
    listActive: (limit: number) => Promise<ActiveTask[]>;
    assertCurrent: () => void;
    onWaiting: (active: number, limit: number) => void;
    wait?: () => Promise<void>;
};

export async function waitForCommerceGenerationSlot(options: SlotOptions) {
    const wait = options.wait || (() => new Promise<void>((resolve) => setTimeout(resolve, 5000)));
    for (;;) {
        options.assertCurrent();
        await options.checkBatch?.();
        options.assertCurrent();
        const limit = options.activeLimit();
        if (!Number.isInteger(limit) || limit < 1) throw new Error("账号任务上限尚未就绪，请刷新后继续");
        // The task endpoint returns at most 100 records. A full page must keep
        // waiting rather than undercount a larger account limit.
        const pageLimit = Math.min(limit, 100);
        const tasks = await options.listActive(pageLimit);
        options.assertCurrent();
        const active = tasks.filter((task) => ["queued", "running", "reconciling"].includes(task.status)).length;
        if (active < pageLimit) return;
        options.onWaiting(active, limit);
        await wait();
    }
}

export class CommerceBatchPausedError extends Error {
    constructor() {
        super("本轮图片任务出现失败，已暂停提交剩余图片。请先重试失败图片，确认服务恢复后再继续生成剩余图片。");
    }
}

export function assertCommerceBatchHealthy(tasks: ActiveTask[]) {
    if (tasks.some((task) => task.status === "failed" || task.status === "cancelled")) throw new CommerceBatchPausedError();
}

export async function submitCommerceTaskWhenSlotAvailable<T>(options: SlotOptions & { submit: () => Promise<T> }): Promise<T> {
    for (;;) {
        await waitForCommerceGenerationSlot(options);
        options.assertCurrent();
        try {
            return await options.submit();
        } catch (cause) {
            if (!(cause instanceof ApiError) || cause.status !== 429 || cause.reason !== "rate_limited" || cause.details?.scope !== "active_tasks" || cause.details.taskCreated !== false) throw cause;
            options.assertCurrent();
            const limit = options.activeLimit();
            options.onWaiting(limit, limit);
            await (options.wait?.() ?? new Promise<void>((resolve) => setTimeout(resolve, 5000)));
        }
    }
}
