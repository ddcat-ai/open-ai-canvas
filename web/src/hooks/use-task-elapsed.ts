import { useSyncExternalStore } from "react";

import { formatTaskElapsed, idleTaskTickerSubscribe, subscribeTaskTicker, taskTickerSnapshot } from "@/lib/canvas/task-ticker";

/** 生成任务已用时：共用一个每秒时钟；终态时不再订阅，耗时冻结在完成时刻。 */
export function useTaskElapsed(createdAt?: string, completedAt?: string) {
    const live = Boolean(createdAt) && !completedAt;
    const now = useSyncExternalStore(live ? subscribeTaskTicker : idleTaskTickerSubscribe, taskTickerSnapshot, taskTickerSnapshot);
    return formatTaskElapsed(createdAt, now, completedAt);
}
