import { t } from "@/i18n";
import { appendTaskTextDelta, completeTextReplayTask, createGenerationTask } from "@/services/api/task-center";
import type { AiConfig } from "@/stores/use-config-store";

/**
 * text-replay 前端发布器：为前端直连模型生成的文本，在后端维护一个
 * text_replay 任务作持久化存档 + 回放。
 *
 * - start()：创建后端 text_replay 任务（不排队、不计费），拿到 taskId；
 * - publish(fullText)：按阈值节流地把新增片段通过 appendTaskTextDelta 上报
 *   （生成中途刷新页面也能读到已生成部分）；
 * - finish(finalText)：把最终正文写入任务并置为 succeeded，queryTaskTextReplay
 *   即可读到 finalText。
 *
 * 全部失败静默降级：文本直连生成是主流程，后端持久化只是增强，失败不阻塞生成。
 */
export function createTextReplayPublisher(config: AiConfig, prompt: string) {
    let taskId: string | null = null;
    let lastLen = 0;
    let buffered = "";
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    // 增量累积到该阈值才落一次库，避免逐 token 高频写。
    const FLUSH_THRESHOLD = 2048;
    const flush = (force = false) => {
        if (flushTimer) {
            clearTimeout(flushTimer);
            flushTimer = null;
        }
        if (closed || !taskId) return;
        if (buffered.length >= FLUSH_THRESHOLD || force) {
            const chunk = buffered;
            buffered = "";
            if (chunk.trim()) void appendTaskTextDelta(taskId, chunk).catch(() => {});
        } else if (buffered) {
            flushTimer = setTimeout(() => flush(true), 1000);
        }
    };

    const start = async () => {
        try {
            const task = await createGenerationTask({
                type: "text",
                prompt: prompt.trim() || t("lib:text-creation"),
                model: config.model,
                input: {
                    mode: "text",
                    replay: true,
                    prompt: prompt.trim() || t("lib:text-creation"),
                    config: {
                        model: config.model,
                        baseUrl: config.baseUrl,
                        apiKey: config.apiKey,
                        apiFormat: config.apiFormat,
                    },
                },
            });
            taskId = task?.id || null;
        } catch {
            taskId = null; // 降级：无持久化，不影响主流程
        }
    };

    const publish = (fullText: string) => {
        if (!taskId) return;
        if (fullText.length <= lastLen) return;
        buffered += fullText.slice(lastLen);
        lastLen = fullText.length;
        flush();
    };

    const finish = (finalText: string) => {
        closed = true;
        if (flushTimer) {
            clearTimeout(flushTimer);
            flushTimer = null;
        }
        if (!taskId) return;
        void appendTaskTextDelta(taskId, buffered).catch(() => {});
        if (finalText && finalText.trim()) {
            void completeTextReplayTask(taskId, finalText).catch(() => {});
        }
    };

    return { start, publish, finish };
}
