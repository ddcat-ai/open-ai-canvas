import { dramaChoiceToModel } from "@/lib/drama/model-choice";
import type { DramaModelChoice, DramaSegment } from "@/services/api/drama";
import { runBackendGenerationTask } from "@/services/api/generation-task";
import type { AiConfig } from "@/stores/use-config-store";

export async function rewriteDramaVideoPrompt(input: { projectId: string; episodeId: string; segment: DramaSegment; prompt: string; instruction: string; model: DramaModelChoice; config: AiConfig; signal: AbortSignal }) {
    const prompt = input.prompt.trim();
    const instruction = input.instruction.trim();
    if (!prompt || !instruction) throw new Error("请填写原提示词和修改要求");
    if (Array.from(prompt).length > 12000 || Array.from(instruction).length > 2000) throw new Error("原提示词最多 12000 字，修改要求最多 2000 字");
    const model = dramaChoiceToModel(input.config, "text", input.model);
    if (!model) throw new Error("视频提示词文本模型不可用，请在制作设置中重新选择");
    const { request } = input.segment;
    const maxChars = Math.min(12000, request.promptMaxChars ? request.promptMaxChars - Array.from(request.header || "").length - (request.header ? 2 : 0) : 12000);
    if (maxChars <= 0) throw new Error("参考说明已超出模型提示词上限，请先减少本段参考素材");
    const result = await runBackendGenerationTask({
        projectId: input.projectId,
        mode: "text",
        config: {
            ...input.config,
            model,
            taskWorkflowProvider: "model",
            systemPrompt:
                "你是短剧视频提示词编辑。按用户修改要求改写当前提示词，只输出修改后的完整正文。保留未要求改变的剧情、人物身份、镜头顺序、时长、台词和参考图编号，不添加不存在的参考图。用户要求弱化暴力或敏感描写时，改成非血腥、含蓄、适合公开呈现的镜头表达，不用谐音、编码或暗语规避审核。不输出解释、Markdown 代码围栏或系统自动附加的参考图说明。",
        },
        prompt: JSON.stringify({ currentPrompt: prompt, instruction, seconds: request.seconds, maxChars, references: request.references.map(({ label, name }) => ({ label, name })) }),
        metadata: { source: "drama-prompt-rewrite", domainProjectId: input.projectId, episodeId: input.episodeId, segmentId: input.segment.id },
        signal: input.signal,
    });
    const rewritten = (result.text || "")
        .trim()
        .replace(/^```[^\n]*\n([\s\S]*?)\n```$/, "$1")
        .trim();
    if (!rewritten) throw new Error("AI 未返回提示词，请重新修改");
    if (Array.from(rewritten).length > maxChars) throw new Error(`AI 返回的提示词超过本段 ${maxChars} 字上限，请要求精简后重试`);
    const labels = new Set(request.references.map((reference) => reference.label.replace(/\s/g, "")));
    for (const match of rewritten.matchAll(/参考图\s*(\d+)/g)) {
        if (!labels.has(`参考图${Number(match[1])}`)) throw new Error(`AI 返回了本段不存在的参考图${match[1]}，请重新修改`);
    }
    return rewritten;
}
