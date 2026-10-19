import type { StateStorage } from "zustand/middleware";
import { localForageStorageForScope } from "@/lib/localforage-storage";
import { getActiveUserScope } from "@/lib/user-scope";
import { ApiError, http } from "@/services/api/request";
import type { GenerationTask } from "@/services/api/task-center";

type Submission = { entries: Array<{ key: string; state: "pending" | "confirmed" | "rejected"; taskId?: string }> };
type RecoveryOptions = { signal?: AbortSignal; keys?: string[]; onTaskUpdate?: (task: GenerationTask) => void };

export class GenerationSubmissionUnconfirmedError extends Error {
    constructor(public readonly operationId: string) {
        super("提交状态待确认，请查询原任务；后台可能已接收，请勿重复生成");
        this.name = "GenerationSubmissionUnconfirmedError";
    }
}

export function isGenerationSubmissionUnconfirmed(error: unknown): error is GenerationSubmissionUnconfirmedError {
    return error instanceof GenerationSubmissionUnconfirmedError;
}

// 只持久化回执索引，不保存渠道凭据、参考图地址或提示词。页面刷新后按原 key 向服务端核对。
export function createGenerationSubmissionStore(dependencies: { getScope(): string; getStorage(scope: string): StateStorage; findTask(key: string, signal?: AbortSignal): Promise<GenerationTask | null> }) {
    const records = new Map<string, Submission>();
    const writes = new Map<string, Promise<unknown>>();
    const senders = new Map<string, () => Promise<GenerationTask>>();
    const inFlight = new Map<string, Promise<GenerationTask>>();
    const recordKey = (operationId: string) => `generation-submission-v1:${operationId}`;
    const scopedKey = (scope: string, operationId: string) => `${scope}\0${operationId}`;
    const checkScope = (scope: string, signal?: AbortSignal) => {
        if (signal?.aborted || dependencies.getScope() !== scope) throw new DOMException("Aborted", "AbortError");
    };
    async function load(scope: string, operationId: string) {
        const key = scopedKey(scope, operationId);
        if (records.has(key)) return records.get(key)!;
        const value = await dependencies.getStorage(scope).getItem(recordKey(operationId));
        if (!value) return null;
        const parsed = JSON.parse(value) as Submission;
        if (!Array.isArray(parsed.entries) || parsed.entries.some((item) => !item.key || !["pending", "confirmed", "rejected"].includes(item.state))) throw new Error("任务提交记录无效，请先核对任务中心");
        records.set(key, parsed);
        return parsed;
    }
    async function update(scope: string, operationId: string, apply: (current: Submission | null) => Submission) {
        const key = scopedKey(scope, operationId);
        const next = (writes.get(key) || Promise.resolve())
            .catch(() => undefined)
            .then(async () => {
                checkScope(scope);
                const value = apply(await load(scope, operationId));
                await dependencies.getStorage(scope).setItem(recordKey(operationId), JSON.stringify(value));
                records.set(key, value);
            });
        writes.set(key, next);
        try {
            await next;
        } finally {
            if (writes.get(key) === next) writes.delete(key);
        }
    }
    async function mark(scope: string, operationId: string, key: string, state: Submission["entries"][number]["state"], taskId?: string) {
        await update(scope, operationId, (current) => {
            if (!current?.entries.some((entry) => entry.key === key)) throw new Error("缺少原任务提交记录，未发起生成");
            return { entries: current.entries.map((entry) => (entry.key === key ? { key, state, ...(taskId ? { taskId } : {}) } : entry)) };
        });
    }
    async function prepare(operationId: string, keys: string[]) {
        if (!operationId || !keys.length || keys.some((key) => !key) || new Set(keys).size !== keys.length) throw new Error("缺少有效的任务请求标识");
        await update(dependencies.getScope(), operationId, (current) => {
            if (current && JSON.stringify(current.entries.map((entry) => entry.key)) !== JSON.stringify(keys)) throw new Error("原任务批次与恢复请求不一致");
            return current || { entries: keys.map((key) => ({ key, state: "pending" })) };
        });
    }
    async function submit(operationId: string, key: string, send: () => Promise<GenerationTask>): Promise<GenerationTask> {
        const scope = dependencies.getScope();
        const lockKey = scopedKey(scope, key);
        const existing = inFlight.get(lockKey);
        if (existing) return existing;
        const running = (async () => {
            const record = await load(scope, operationId);
            const entry = record?.entries.find((entry) => entry.key === key);
            if (!entry) throw new Error("缺少原任务提交记录，未发起生成");
            checkScope(scope);
            if (entry.state === "confirmed") {
                const task = await dependencies.findTask(key);
                checkScope(scope);
                if (!task) throw new GenerationSubmissionUnconfirmedError(operationId);
                return task;
            }
            if (entry.state === "rejected") await mark(scope, operationId, key, "pending");
            checkScope(scope);
            senders.set(lockKey, send);
            let task: GenerationTask;
            try {
                task = await send();
            } catch (error) {
                checkScope(scope);
                if (error instanceof ApiError && (!error.retryable || error.reason === "rate_limited")) {
                    await mark(scope, operationId, key, "rejected");
                    senders.delete(lockKey);
                    throw error;
                }
                throw new GenerationSubmissionUnconfirmedError(operationId);
            }
            checkScope(scope);
            try {
                await mark(scope, operationId, key, "confirmed", task.id);
            } catch {
                checkScope(scope);
                throw new GenerationSubmissionUnconfirmedError(operationId);
            }
            senders.delete(lockKey);
            return task;
        })();
        inFlight.set(lockKey, running);
        try {
            return await running;
        } finally {
            if (inFlight.get(lockKey) === running) inFlight.delete(lockKey);
        }
    }
    async function recover(operationId: string, options: RecoveryOptions = {}) {
        const scope = dependencies.getScope();
        let record = await load(scope, operationId);
        // 历史会话可从原操作标识恢复查询索引；不保存请求内容，也不据此构造新的生成请求。
        if (!record && options.keys?.length) {
            checkScope(scope, options.signal);
            await prepare(operationId, options.keys);
            record = await load(scope, operationId);
        }
        if (!record) throw new Error("原任务提交记录不存在，请先核对任务中心，未重新生成");
        checkScope(scope, options.signal);
        if (record.entries.every((entry) => entry.state === "rejected")) throw new ApiError("原请求已明确拒绝，未创建生成任务，可以调整后重新生成", { reason: "generation_submission_rejected", retryable: false });
        const results = await Promise.allSettled(
            record.entries
                .filter((entry) => entry.state !== "rejected")
                .map(async (entry) => {
                    checkScope(scope, options.signal);
                    // 先查询：创建响应丢失、账号配置变化、刷新后的恢复均不需要重新提交参数。
                    let task = await dependencies.findTask(entry.key, options.signal);
                    checkScope(scope, options.signal);
                    if (!task) {
                        const send = senders.get(scopedKey(scope, entry.key));
                        if (!send || entry.state === "confirmed") throw new GenerationSubmissionUnconfirmedError(operationId);
                        task = await submit(operationId, entry.key, send);
                    } else {
                        await mark(scope, operationId, entry.key, "confirmed", task.id);
                        senders.delete(scopedKey(scope, entry.key));
                    }
                    checkScope(scope, options.signal);
                    options.onTaskUpdate?.(task);
                    return task;
                }),
        );
        const failure = results.find((result) => result.status === "rejected");
        if (failure?.status === "rejected") throw failure.reason;
        return results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
    }
    async function hasPending(operationId: string) {
        return (await load(dependencies.getScope(), operationId))?.entries.some((entry) => entry.state === "pending") || false;
    }
    return { prepare, submit, recover, hasPending };
}

const submissions = createGenerationSubmissionStore({
    getScope: getActiveUserScope,
    getStorage: localForageStorageForScope,
    findTask: (key, signal) => http.get<GenerationTask | null>("/tasks/by-idempotency-key", { params: { key }, signal, timeout: 15_000 }),
});

export const prepareGenerationSubmission = submissions.prepare;
export const submitGenerationRequest = submissions.submit;
export const recoverGenerationSubmission = submissions.recover;
export const hasPendingGenerationSubmission = submissions.hasPending;
