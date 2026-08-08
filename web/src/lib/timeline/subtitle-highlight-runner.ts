import { runBackendCanvasGenerationTask } from "@/lib/canvas/canvas-project-generation";
import type { AiConfig } from "@/stores/use-config-store";
import type { SrtEntry, SubtitleHighlight } from "@/types/timeline";
import { buildSubtitleHighlightSystemPrompt, buildSubtitleHighlightUserMessage } from "./subtitle-highlight-ai";
import { parseSubtitleHighlightResponse } from "./subtitle-highlight-service";

export interface SubtitleHighlightProgress {
    batchIndex: number;
    batchTotal: number;
    processedEntries: number;
    totalEntries: number;
    percent: number;
}

export type SubtitleHighlightRunnerOptions = {
    projectId: string;
    /** 画布节点 id，用于任务元数据标记来源 */
    nodeId: string;
    config: AiConfig;
    /** 每个 batch 的字幕条数。默认 30 */
    batchSize?: number;
    /** 同时进行的 batch 数。默认 3；LLM 请求是 I/O 密集型，3-4 并行通常稳定低于 provider 限速 */
    concurrency?: number;
    signal?: AbortSignal;
    onProgress?: (progress: SubtitleHighlightProgress) => void;
};

export async function generateSubtitleHighlights(entries: SrtEntry[], options: SubtitleHighlightRunnerOptions): Promise<SubtitleHighlight[]> {
    if (entries.length === 0) {
        return [];
    }

    const batchSize = Math.max(1, options.batchSize ?? 30);
    const concurrency = Math.max(1, Math.floor(options.concurrency ?? 3));
    const systemPrompt = buildSubtitleHighlightSystemPrompt();

    // 切批：保留原顺序，每个 batch 独立可并行
    const batches: { index: number; entries: SrtEntry[] }[] = [];
    for (let i = 0; i < entries.length; i += batchSize) {
        batches.push({ index: batches.length, entries: entries.slice(i, i + batchSize) });
    }
    const batchTotal = batches.length;
    const results: SubtitleHighlight[][] = new Array(batchTotal).fill(null).map(() => []);
    let processedEntries = 0;

    options.onProgress?.({
        batchIndex: 0,
        batchTotal,
        processedEntries: 0,
        totalEntries: entries.length,
        percent: 0,
    });

    // worker 池模式：从共享游标里抢任务，保证 concurrency 个 batch 同时跑
    let cursor = 0;
    const firstError: { current: unknown } = { current: null };

    const runOne = async (): Promise<void> => {
        while (true) {
            if (firstError.current || options.signal?.aborted) return;
            const myIndex = cursor;
            cursor += 1;
            if (myIndex >= batches.length) return;
            const batch = batches[myIndex];
            try {
                const result = await runBackendCanvasGenerationTask({
                    projectId: options.projectId,
                    nodeId: `${options.nodeId}:subtitle-highlight:${myIndex + 1}/${batchTotal}`,
                    mode: "text",
                    prompt: `${systemPrompt}\n\n${buildSubtitleHighlightUserMessage(batch.entries)}`,
                    config: options.config,
                    signal: options.signal,
                    metadata: { operation: "subtitle_highlight", batchIndex: myIndex, batchTotal },
                });
                results[myIndex] = parseSubtitleHighlightResponse(parseJsonObject(result.text || ""), batch.entries);
                processedEntries += batch.entries.length;
                options.onProgress?.({
                    batchIndex: myIndex + 1,
                    batchTotal,
                    processedEntries,
                    totalEntries: entries.length,
                    percent: Math.round((processedEntries / entries.length) * 100),
                });
            } catch (err) {
                if (!firstError.current) firstError.current = err;
                return;
            }
        }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, batchTotal) }, () => runOne()));

    if (options.signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
    }
    if (firstError.current) {
        const message = firstError.current instanceof Error ? firstError.current.message : "未知错误";
        throw new Error(`字幕关键词高亮生成失败：${message}`);
    }

    return results.flat();
}

function parseJsonObject(text: string): unknown {
    if (!text?.trim()) {
        return null;
    }
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}
