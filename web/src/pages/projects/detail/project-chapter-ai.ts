import { runBackendCanvasGenerationTask } from "@/lib/canvas/canvas-project-generation";
import { parseCharacterBreakdown, type CharacterBreakdown } from "@/lib/canvas/canvas-character-reference";
import type { AiConfig } from "@/stores/use-config-store";

type ChapterAnalysisInput = {
    projectId: string;
    projectName: string;
    chapterId: string;
    chapterTitle: string;
    sourceText: string;
    projectStyle: string;
    config: AiConfig;
};

export async function extractChapterCharacters(input: ChapterAnalysisInput): Promise<CharacterBreakdown[]> {
    const result = await runProjectTextTask(input, "chapter_character_breakdown", {
        项目名称: input.projectName,
        章节名称: input.chapterTitle,
        项目画风: input.projectStyle || "项目尚未指定画风，保持视觉描述中性、可执行。",
        章节正文: input.sourceText,
    });
    return parseCharacterBreakdown(result);
}

async function runProjectTextTask(input: ChapterAnalysisInput, operation: string, promptTemplateVariables: Record<string, string>) {
    const model = input.config.textModel || input.config.model;
    const result = await runBackendCanvasGenerationTask({
        projectId: input.projectId,
        nodeId: `${operation}:${input.chapterId}`,
        mode: "text",
        prompt: "使用当前启用的角色卡提取模板。",
        config: { ...input.config, model },
        metadata: { domainProjectId: input.projectId, chapterId: input.chapterId, operation, promptTemplateOperation: "character_extract", promptTemplateVariables },
    });
    if (!result.text?.trim()) throw new Error("模型没有返回可用结果");
    return result.text;
}
