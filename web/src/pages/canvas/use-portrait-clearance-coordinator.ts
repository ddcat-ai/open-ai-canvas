import { useEffect, useRef } from "react";

import { readPortraitTask, readPortraitTaskImage, readPortraitTaskResult, claimPortraitModelJob, completePortraitModelJob, failPortraitModelJob, type PortraitRuntimeTask } from "@/services/portrait-clearance-runtime";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { PORTRAIT_CLEARANCE_NODE_TYPE, type PortraitClearanceNodeState, type PortraitRiskLevel } from "@/lib/portrait-clearance/contracts";
import { portraitVisionMessages, portraitVisionModelError, resolvePortraitVisionModel, parsePortraitVisionToolResponse, portraitVisionTool } from "@/lib/portrait-clearance/vision";
import { requestToolResponse } from "@/services/api/image";
import { resolveModelChannel, useEffectiveConfig } from "@/stores/use-config-store";

type PortraitClearanceCoordinatorOptions = {
    nodes: CanvasNodeData[];
    onUpdateState: (nodeId: string, state: PortraitClearanceNodeState) => void;
};

const PORTRAIT_MODEL_JOB_TIMEOUT_MS = 75_000;

export function usePortraitClearanceCoordinator({ nodes, onUpdateState }: PortraitClearanceCoordinatorOptions) {
    const runningRef = useRef(false);
    const abortRef = useRef<Set<AbortController>>(new Set());
    const nodesRef = useRef(nodes);
    nodesRef.current = nodes;
    const effectiveConfig = useEffectiveConfig();

    useEffect(() => {
        let disposed = false;
        const poll = async () => {
            if (disposed || runningRef.current) return;
            const active = nodesRef.current.filter((node) => {
                if (node.type !== PORTRAIT_CLEARANCE_NODE_TYPE) return false;
                const task = node.metadata?.portraitClearance;
                return Boolean(task?.activeTaskId && task.task?.status !== "completed" && task.task?.status !== "partial" && task.task?.status !== "failed" && task.task?.status !== "cancelled");
            });
            if (!active.length) return;
            runningRef.current = true;
            try {
                for (const node of active) {
                    if (disposed) break;
                    const state = node.metadata?.portraitClearance;
                    const taskId = state?.activeTaskId;
                    if (!state || !taskId) continue;
                    try {
                        const task = await readPortraitTask(taskId);
                        let next = mergeTaskState(state, task);
                        if (task.status === "waiting_model" && state.analysisMode === "local-plus-vision") {
                            const modelError = portraitVisionModelError(effectiveConfig, state.modelPolicy);
                            if (!modelError) {
                                await runPortraitModelJobs(taskId, state, effectiveConfig, abortRef, task.modelRef);
                                const refreshed = await readPortraitTask(taskId);
                                next = mergeTaskState(state, refreshed);
                            } else {
                                next = { ...next, task: { ...next.task!, errorCode: state.modelPolicy.mode === "pinned" ? "portrait_vision_model_removed" : "portrait_vision_model_unavailable", errorMessage: modelError } };
                            }
                        }
                        const effectiveTask = task.status === "waiting_model" && state.analysisMode === "local-plus-vision" ? await readPortraitTask(taskId).catch(() => task) : task;
                        if ((effectiveTask.status === "completed" || effectiveTask.status === "partial") && effectiveTask.detailsAvailable) {
                            try {
                                const result = await readPortraitTaskResult(taskId);
                                if (isResult(result)) next = { ...next, lastResult: { taskId, highestRisk: result.highestRisk, riskCounts: result.riskCounts, candidateCount: result.candidateCount, comparedCount: result.comparedCount, ...(effectiveTask.modelRef ? { modelRef: effectiveTask.modelRef } : {}), completedAt: effectiveTask.completedAt || effectiveTask.updatedAt, detailsAvailable: true } };
                            } catch {
                                // The task summary remains useful if the large result is temporarily unavailable.
                            }
                        }
                        if (effectiveTask.status === "completed" || effectiveTask.status === "partial") next = { ...next, activeTaskId: undefined };
                        onUpdateState(node.id, next);
                    } catch {
                        // Runtime reconnects are expected; the next poll resumes from the durable task id.
                    }
                }
            } finally {
                runningRef.current = false;
            }
        };
        void poll();
        const timer = window.setInterval(() => void poll(), 1_500);
        return () => {
            disposed = true;
            window.clearInterval(timer);
            for (const controller of abortRef.current) controller.abort();
            abortRef.current.clear();
        };
    }, [effectiveConfig, onUpdateState]);
}

async function runPortraitModelJobs(taskId: string, state: PortraitClearanceNodeState, config: ReturnType<typeof useEffectiveConfig>, abortRef: { current: Set<AbortController> }, frozenModelRef?: string) {
    const model = frozenModelRef || resolvePortraitVisionModel(config, state.modelPolicy);
    const channel = resolveModelChannel(config, model);
    const channelLimit = Number.isInteger(channel.concurrencyLimit) && (channel.concurrencyLimit || 0) > 0 ? channel.concurrencyLimit! : 10;
    const limit = Math.min(10, Math.max(1, state.settings.modelConcurrency), channelLimit);
    const jobs = [];
    for (let index = 0; index < limit; index += 1) {
        const job = await claimPortraitModelJob(taskId);
        if (!job?.leaseToken) break;
        jobs.push(job);
    }
    await Promise.all(jobs.map((job) => runPortraitModelJob(taskId, state, config, abortRef, job, model)));
}

async function runPortraitModelJob(taskId: string, state: PortraitClearanceNodeState, config: ReturnType<typeof useEffectiveConfig>, abortRef: { current: Set<AbortController> }, job: Awaited<ReturnType<typeof claimPortraitModelJob>>, model: string) {
    if (!job?.leaseToken) return;
    const controller = new AbortController();
    let timedOut = false;
    let timeoutId: number | undefined;
    abortRef.current.add(controller);
    try {
        const timeout = new Promise<never>((_, reject) => {
            timeoutId = window.setTimeout(() => {
                timedOut = true;
                controller.abort();
                reject(new Error("portrait_model_timeout"));
            }, PORTRAIT_MODEL_JOB_TIMEOUT_MS);
        });
        const work = (async () => {
            const result = await readPortraitTaskResult(taskId, controller.signal);
            const pair = isResult(result) ? result.pairs.find((candidate) => candidate.id === job.pairId) : undefined;
            if (!pair) {
                await failPortraitModelJob(taskId, job, "portrait_model_job_conflict", "模型作业对应的比对结果不存在", false, controller.signal);
                return;
            }
            const [query, comparison] = await Promise.all([readPortraitTaskImage(taskId, job.queryImageId, controller.signal), readPortraitTaskImage(taskId, job.comparisonImageId, controller.signal)]);
            const response = await requestToolResponse({ ...config, model }, portraitVisionMessages({ queryDataUrl: query.dataUrl, comparisonDataUrl: comparison.dataUrl, queryName: job.queryImageId, comparisonName: job.comparisonImageId, localPrecheck: pair.localPrecheck }), [portraitVisionTool], { type: "function", name: "submit_portrait_comparison" }, undefined, { signal: controller.signal });
            if (timedOut) throw new Error("portrait_model_timeout");
            const vision = parsePortraitVisionToolResponse(response);
            await completePortraitModelJob(taskId, job, vision as unknown as Record<string, unknown>, controller.signal);
        })();
        await Promise.race([work, timeout]);
    } catch (error) {
        if (controller.signal.aborted && !timedOut) return;
        const rawMessage = error instanceof Error ? error.message : "视觉模型分析失败";
        const message = timedOut ? "视觉模型请求超过 75 秒，已跳过该候选" : rawMessage;
        const errorCode = timedOut ? "portrait_model_timeout" : rawMessage === "portrait_vision_result_invalid" || rawMessage === "portrait_vision_tool_missing" ? "portrait_vision_result_invalid" : "portrait_model_rate_limited";
        const retryable = !timedOut && rawMessage !== "portrait_vision_result_invalid" && rawMessage !== "portrait_vision_tool_missing";
        try {
            await failPortraitModelJob(taskId, job, errorCode, message, retryable);
        } catch {
            // The lease may have expired or the task may have been stopped; the next poll can reclaim it safely.
        }
    } finally {
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
        abortRef.current.delete(controller);
    }
}

function mergeTaskState(state: PortraitClearanceNodeState, task: PortraitRuntimeTask): PortraitClearanceNodeState {
    return {
        ...state,
        activeTaskId: task.taskId,
        task: {
            status: task.status,
            stage: task.stage,
            progress: task.progress,
            processedCandidates: task.processedCandidates,
            ...(task.totalCandidates === undefined ? {} : { totalCandidates: task.totalCandidates }),
            ...(task.errorCode ? { errorCode: task.errorCode } : {}),
            ...(task.errorMessage ? { errorMessage: task.errorMessage } : {}),
            updatedAt: task.updatedAt,
        },
    };
}

function isResult(value: unknown): value is { highestRisk: PortraitRiskLevel; riskCounts: Partial<Record<PortraitRiskLevel, number>>; candidateCount: number; comparedCount: number; pairs: Array<{ id: string; queryImageId: string; comparisonImageId: string; localPrecheck: unknown }> } {
    return Boolean(value && typeof value === "object" && "highestRisk" in value && typeof (value as { highestRisk?: unknown }).highestRisk === "string" && "riskCounts" in value && typeof (value as { riskCounts?: unknown }).riskCounts === "object" && "candidateCount" in value && typeof (value as { candidateCount?: unknown }).candidateCount === "number" && "comparedCount" in value && typeof (value as { comparedCount?: unknown }).comparedCount === "number" && Array.isArray((value as { pairs?: unknown }).pairs));
}
