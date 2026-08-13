import type {
    GenerationTask,
    GenerationTaskOutput,
} from "@/services/api/task-center";

export type GenerationTaskEffectResult = {
    materializedAssetId?: string;
};

export type GenerationTaskEffectClaim =
    | { status: "claimed"; fence: number; binding?: string }
    | { status: "busy"; retryAt?: string }
    | { status: "completed"; result: GenerationTaskEffectResult };

export type GenerationTaskEffectStore = {
    claim(effectKey: string, taskId: string): Promise<GenerationTaskEffectClaim>;
    renew(effectKey: string, taskId: string, binding?: string): Promise<{ fence: number }>;
    complete(effectKey: string, taskId: string, result: GenerationTaskEffectResult, binding?: string): Promise<void>;
    release(effectKey: string, taskId: string, binding?: string): Promise<void>;
};

export type MaterializeGenerationTaskOutput = (input: {
    task: GenerationTask;
    output: GenerationTaskOutput;
    effectKey: string;
    signal?: AbortSignal;
}) => Promise<GenerationTaskEffectResult>;

export type GenerationTaskEffectConsumer = (input: {
    task: GenerationTask;
    output?: GenerationTaskOutput;
    effectKey: string;
    signal?: AbortSignal;
}) => Promise<void>;

function abortError(): DOMException {
    return new DOMException("The operation was aborted", "AbortError");
}

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw abortError();
}

async function waitForAbortableDelay(delayMs: number, signal?: AbortSignal) {
    throwIfAborted(signal);
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(done, delayMs);
        function done() {
            signal?.removeEventListener("abort", aborted);
            resolve();
        }
        function aborted() {
            clearTimeout(timer);
            signal?.removeEventListener("abort", aborted);
            reject(abortError());
        }
        signal?.addEventListener("abort", aborted, { once: true });
    });
}

export function createIdempotentMaterializeOutput(dependencies: {
    insertOrReturnAsset(input: {
        task: GenerationTask;
        output: GenerationTaskOutput;
        effectKey: string;
        signal?: AbortSignal;
    }): Promise<string>;
}): MaterializeGenerationTaskOutput {
    return async (input) => ({
        materializedAssetId: await dependencies.insertOrReturnAsset(input),
    });
}

export function materializeEffectKey(taskId: string, outputIndex: number): string {
    return `materialize:${taskId}:${outputIndex}`;
}

export function attachNodeEffectKey(taskId: string, nodeId: string, outputIndex: number): string {
    return `attach-node:${taskId}:${nodeId}:${outputIndex}`;
}

export function attachMessageEffectKey(taskId: string, messageId: string, outputIndex: number): string {
    return `attach-message:${taskId}:${messageId}:${outputIndex}`;
}

export function agentResumeEffectKey(taskId: string, continuationId: string): string {
    return `agent-resume:${taskId}:${continuationId}`;
}

export function createGenerationTaskMaterializer(dependencies: {
    effects: GenerationTaskEffectStore;
    materializeOutput: MaterializeGenerationTaskOutput;
    leaseHeartbeatMs?: number;
    waitUntil?: (retryAt: string, signal?: AbortSignal) => Promise<void>;
}) {
    const leaseHeartbeatMs = dependencies.leaseHeartbeatMs ?? 10_000;
    if (!Number.isSafeInteger(leaseHeartbeatMs) || leaseHeartbeatMs < 1) throw new Error("Invalid generation effect heartbeat interval");
    const waitUntil = dependencies.waitUntil ?? (async (retryAt: string, signal?: AbortSignal) => {
        const delayMs = Math.max(0, Date.parse(retryAt) - Date.now());
        await waitForAbortableDelay(delayMs, signal);
    });

    async function claimWhenAvailable(effectKey: string, taskId: string, signal?: AbortSignal): Promise<Exclude<GenerationTaskEffectClaim, { status: "busy" }>> {
        while (true) {
            throwIfAborted(signal);
            const claim = await dependencies.effects.claim(effectKey, taskId);
            throwIfAborted(signal);
            if (claim.status !== "busy") return claim;
            const leaseRetryAt = claim.retryAt && Number.isFinite(Date.parse(claim.retryAt))
                ? Date.parse(claim.retryAt)
                : Date.now() + leaseHeartbeatMs;
            // 同一 effect 可能已由当前 owner 提前完成；短周期复核 completed，同时仍以租约到期为接管边界。
            const nextCheckAt = Math.min(leaseRetryAt, Date.now() + 250);
            await waitUntil(new Date(nextCheckAt).toISOString(), signal);
        }
    }

    function startLeaseHeartbeat(effectKey: string, taskId: string, binding?: string) {
        let stopped = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let wake: (() => void) | undefined;
        let failure: unknown;
        const done = (async () => {
            while (!stopped) {
                await new Promise<void>((resolve) => {
                    wake = resolve;
                    timer = setTimeout(resolve, leaseHeartbeatMs);
                });
                timer = undefined;
                wake = undefined;
                if (stopped) break;
                await dependencies.effects.renew(effectKey, taskId, binding);
            }
        })().catch((error) => { failure = error; });
        return async () => {
            if (!stopped) {
                stopped = true;
                if (timer) clearTimeout(timer);
                wake?.();
            }
            await done;
            if (failure) throw failure;
        };
    }

    async function releaseClaim(effectKey: string, taskId: string, binding: string | undefined, stopHeartbeat: () => Promise<void>, original: unknown): Promise<never> {
        let failure = original;
        try {
            await stopHeartbeat();
        } catch (error) {
            failure = error;
        }
        try {
            await dependencies.effects.release(effectKey, taskId, binding);
        } catch (error) {
            failure = error;
        }
        throw failure;
    }
    async function consumeEffect(
        effectKey: string,
        task: GenerationTask,
        consumer: GenerationTaskEffectConsumer,
        output?: GenerationTaskOutput,
        signal?: AbortSignal,
    ): Promise<"applied" | "completed" | "busy"> {
        const claim = await claimWhenAvailable(effectKey, task.id, signal);
        if (claim.status === "completed") return "completed";
        const stopHeartbeat = startLeaseHeartbeat(effectKey, task.id, claim.binding);
        try {
            throwIfAborted(signal);
            await consumer({ task, output, effectKey, signal });
            throwIfAborted(signal);
            await stopHeartbeat();
            await dependencies.effects.complete(effectKey, task.id, {}, claim.binding);
            return "applied";
        } catch (error) {
            return releaseClaim(effectKey, task.id, claim.binding, stopHeartbeat, error);
        }
    }

    function requireMaterializedOutput(task: GenerationTask, outputIndex: number): GenerationTaskOutput {
        const output = task.outputs?.find((candidate) => candidate.outputIndex === outputIndex);
        if (!output?.materializedAssetId) {
            throw new Error(`Task output ${outputIndex} is not materialized`);
        }
        return output;
    }

    return {
        async materialize(task: GenerationTask, signal?: AbortSignal): Promise<GenerationTask> {
            throwIfAborted(signal);
            if (task.status !== "succeeded" || !task.outputs?.length) return task;

            const outputs: GenerationTaskOutput[] = [];
            for (const originalOutput of task.outputs) {
                const output = { ...originalOutput };
                if (!output.materializedAssetId) {
                    const effectKey = materializeEffectKey(task.id, output.outputIndex);
                    const claim = await claimWhenAvailable(effectKey, task.id, signal);
                    if (claim.status === "completed") {
                        output.materializedAssetId = claim.result.materializedAssetId;
                    } else if (claim.status === "claimed") {
                        const stopHeartbeat = startLeaseHeartbeat(effectKey, task.id, claim.binding);
                        try {
                            throwIfAborted(signal);
                            const result = await dependencies.materializeOutput({
                                task,
                                output,
                                effectKey,
                                signal,
                            });
                            throwIfAborted(signal);
                            await stopHeartbeat();
                            await dependencies.effects.complete(effectKey, task.id, result, claim.binding);
                            output.materializedAssetId = result.materializedAssetId;
                        } catch (error) {
                            return releaseClaim(effectKey, task.id, claim.binding, stopHeartbeat, error);
                        }
                    }
                }
                outputs.push(output);
            }

            return {
                ...task,
                outputs,
                resultState: outputs.every((output) => Boolean(output.materializedAssetId))
                    ? "READY"
                    : "MATERIALIZING",
            };
        },

        attachNode(
            task: GenerationTask,
            nodeId: string,
            outputIndex: number,
            consumer: GenerationTaskEffectConsumer,
            signal?: AbortSignal,
        ) {
            const output = requireMaterializedOutput(task, outputIndex);
            return consumeEffect(attachNodeEffectKey(task.id, nodeId, outputIndex), task, consumer, output, signal);
        },

        attachMessage(
            task: GenerationTask,
            messageId: string,
            outputIndex: number,
            consumer: GenerationTaskEffectConsumer,
            signal?: AbortSignal,
        ) {
            const output = requireMaterializedOutput(task, outputIndex);
            return consumeEffect(attachMessageEffectKey(task.id, messageId, outputIndex), task, consumer, output, signal);
        },

        resumeAgent(
            task: GenerationTask,
            continuationId: string,
            consumer: GenerationTaskEffectConsumer,
            signal?: AbortSignal,
        ) {
            return consumeEffect(agentResumeEffectKey(task.id, continuationId), task, consumer, undefined, signal);
        },
    };
}
