// 轻量 Agent 执行通道：本地 Codex 不可用时，复用后端文本模型（canvas_text 任务）单轮处理简单任务。
// 与完整 online Agent 的区别：不挂载任何画布写工具、不做多步工具循环，因此响应更快、行为可预期；
// 只携带只读画布概况帮助模型理解上下文，不创建/修改节点，也不生成媒体。

import { runBackendToolGenerationTask } from "@/services/api/generation-task";
import type { ResponseInputMessage } from "@/services/api/image";
import type { AiConfig } from "@/stores/use-config-store";
import type { CanvasAgentSnapshot } from "./canvas-agent-ops";

export type LightweightAgentInput = {
    prompt: string;
    config: AiConfig;
    snapshot?: CanvasAgentSnapshot | null;
    signal?: AbortSignal;
    onDelta?: (delta: string) => void;
};

export type LightweightAgentResult = {
    content: string;
    degraded: true;
};

function buildReadOnlySystemPrompt(snapshot?: CanvasAgentSnapshot | null): string {
    const nodeCount = snapshot?.nodes?.length ?? 0;
    const connectionCount = snapshot?.connections?.length ?? 0;
    const title = snapshot?.title ? `，当前画布「${snapshot.title}」` : "";
    return [
        "你是影策画布的轻量助手，运行在云端文本通道，是本地 Codex Agent 不可用时的降级模式。",
        "你只处理对话、问答、解释、文案撰写/润色、翻译、总结、创意发散这类简单任务。",
        "你无法直接创建、修改、删除画布节点或连线，也不能生成图片/视频/音频；当用户提出这类需求时，用一句话说明：该操作需要连接本地 Agent（本机 Codex runtime）后再执行，并可给出简短的手动建议。",
        `当前只读画布概况${title}：${nodeCount} 个节点、${connectionCount} 条连线。回答简洁、具体、可执行，不要声称自己已经改动了画布。`,
    ].join("\n");
}

export async function runLightweightAgentTurn(input: LightweightAgentInput): Promise<LightweightAgentResult> {
    const prompt = input.prompt.trim();
    if (!prompt) throw new Error("轻量助手收到空请求");
    const messages: ResponseInputMessage[] = [
        { role: "system", content: buildReadOnlySystemPrompt(input.snapshot) },
        { role: "user", content: prompt },
    ];
    const result = await runBackendToolGenerationTask({
        prompt,
        config: input.config,
        messages,
        // 不提供任何工具：保证单轮纯文本，不触发画布写操作或媒体生成。
        tools: [],
        toolChoice: "auto",
        signal: input.signal,
        onDelta: input.onDelta,
    });
    return { content: result.content || "", degraded: true };
}
