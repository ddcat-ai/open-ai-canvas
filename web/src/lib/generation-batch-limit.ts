// 画布与创作页每张图都拆成独立任务提交，一次可选张数按账号同时任务数取上限。
import { useUserStore } from "@/stores/use-user-store";

/** 一次最多能提交的任务数，至少 1；与图片工作台的批量上限口径一致。 */
export function generationBatchLimit(activeTaskLimit: number): number {
    return Math.max(1, Math.floor(activeTaskLimit) || 1);
}

/** 非组件代码（生成链路、批次规划）读取当前账号的一次批量上限。 */
export function currentGenerationBatchLimit(): number {
    return generationBatchLimit(useUserStore.getState().runtimeLimits.activeTaskLimit);
}

/** 组件里订阅当前账号的一次批量上限。 */
export function useGenerationBatchLimit(): number {
    return generationBatchLimit(useUserStore((state) => state.runtimeLimits.activeTaskLimit));
}

/**
 * 服务端按单任务报价，一次提交多单时按「单单价格 × 实际单数」显示。
 * @param perTaskMicrocredits 单单报价（微积分）
 * @param taskCount 实际提交单数
 */
export function batchQuoteTotal(perTaskMicrocredits: number, taskCount: number): number {
    return (perTaskMicrocredits * Math.max(1, Math.floor(taskCount) || 1)) / 1_000_000;
}
