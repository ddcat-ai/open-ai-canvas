import { runBackendCanvasGenerationTask } from "@/lib/canvas/canvas-project-generation";
import { storyboardRowsFromTask } from "@/lib/canvas/canvas-project-domain";
import { parseCharacterBreakdown, type CharacterBreakdown } from "@/lib/canvas/canvas-character-reference";
import { backendProviderConfig, parseBackendGenerationResult } from "@/services/api/generation-task";
import { createGenerationTask, waitForGenerationTask, type GenerationTask } from "@/services/api/task-center";
import type { Skill } from "@/services/api/skills";
import { skillRuntime } from "@/services/skill-runtime";
import { logicalModelIDForConfig, type AiConfig } from "@/stores/use-config-store";

import type { ChapterStoryboardAsset, ChapterStoryboardCharacter } from "./chapter-storyboard-production";

type ChapterAnalysisInput = {
    projectId: string;
    projectName: string;
    chapterId: string;
    chapterTitle: string;
    sourceText: string;
    projectStyle: string;
    config: AiConfig;
};

type ChapterTaskOptions = {
    onTaskUpdate?: (task: GenerationTask) => void;
};

export type ChapterTaskKind = "characters" | "storyboard";

export function chapterTaskIdentity(task: GenerationTask): { chapterId: string; kind: ChapterTaskKind } | null {
    const context = task.clientContext;
    if (context?.chapterId && (context.chapterOperation === "characters" || context.chapterOperation === "storyboard")) {
        return { chapterId: context.chapterId, kind: context.chapterOperation };
    }
    const metadata = generationTaskMetadata(task.inputJson);
    const chapterId = typeof metadata.chapterId === "string" ? metadata.chapterId : "";
    if (!chapterId) return null;
    if (metadata.operation === "chapter_character_breakdown") return { chapterId, kind: "characters" };
    if (metadata.source === "short-drama-chapter-storyboard") return { chapterId, kind: "storyboard" };
    return null;
}

export function chapterCharactersFromGenerationTask(task: GenerationTask) {
    const result = parseBackendGenerationResult(task);
    if (!result.text?.trim()) throw new Error("模型没有返回可用的角色提取结果");
    return parseCharacterBreakdown(result.text);
}

export function chapterStoryboardFromGenerationTask(task: GenerationTask) {
    return storyboardRowsFromTask(task);
}

export async function extractChapterCharacters(input: ChapterAnalysisInput, options?: ChapterTaskOptions): Promise<CharacterBreakdown[]> {
    const result = await runProjectTextTask(input, "chapter_character_breakdown", {
        项目名称: input.projectName,
        章节名称: input.chapterTitle,
        项目画风: input.projectStyle || "项目尚未指定画风，保持视觉描述中性、可执行。",
        章节正文: input.sourceText,
    }, options);
    return parseCharacterBreakdown(result);
}

type ChapterStoryboardGenerationInput = {
    projectId: string;
    chapterId: string;
    chapterTitle: string;
    sourceText: string;
    projectStyle: { presetId: string; title: string; prompt: string; profileJson?: string };
    characters: ChapterStoryboardCharacter[];
    assets: ChapterStoryboardAsset[];
    config: AiConfig;
    skills: Skill[];
    selectedSkillIds: string[];
};

export async function generateChapterStoryboard(input: ChapterStoryboardGenerationInput, options?: ChapterTaskOptions) {
    const model = input.config.textModel || input.config.model;
    const config = { ...input.config, model };
    const skillExecution = await skillRuntime.prepare({
        profile: "shortDrama",
        prompt: [
            `章节：${input.chapterTitle}`,
            input.sourceText,
            "请将本章拆解为可直接进入短剧分镜制作的镜头脚本，保持剧情因果、人物关系、关键动作与台词完整。",
        ].join("\n\n"),
        skills: input.skills,
        selectedSkillIds: input.selectedSkillIds,
    });
    const task = await createGenerationTask({
        projectId: input.projectId,
        type: "agent_storyboard_rows",
        operation: "storyboard_rows",
        prompt: skillExecution.prompt,
        model,
        ...(logicalModelIDForConfig(config) ? { logicalModelId: logicalModelIDForConfig(config) } : {}),
        input: {
            canvasAssets: input.assets,
            requirements: "输出可直接写入分镜制作并继续生成分镜图、动作预演和镜头视频的分镜表。",
            projectStyle: input.projectStyle,
            characters: input.characters,
            shotDurationSeconds: 0,
            shotCount: 0,
            config: backendProviderConfig(config, "text"),
            metadata: {
                domainProjectId: input.projectId,
                chapterId: input.chapterId,
                source: "short-drama-chapter-storyboard",
                ...skillExecution.metadata,
            },
        },
    });
    options?.onTaskUpdate?.(task);
    const completed = await waitForGenerationTask(task.id, { initialTask: task, useTextEvents: true, onTaskUpdate: options?.onTaskUpdate });
    return { ...storyboardRowsFromTask(completed), skillCount: skillExecution.selectedSkills.length };
}

async function runProjectTextTask(input: ChapterAnalysisInput, operation: string, promptTemplateVariables: Record<string, string>, options?: ChapterTaskOptions) {
    const model = input.config.textModel || input.config.model;
    const result = await runBackendCanvasGenerationTask({
        projectId: input.projectId,
        nodeId: `${operation}:${input.chapterId}`,
        mode: "text",
        prompt: "使用当前启用的角色卡提取模板。",
        config: { ...input.config, model },
        metadata: { domainProjectId: input.projectId, chapterId: input.chapterId, operation, promptTemplateOperation: "character_extract", promptTemplateVariables },
        onTaskCreated: options?.onTaskUpdate,
    });
    if (!result.text?.trim()) throw new Error("模型没有返回可用结果");
    return result.text;
}

function generationTaskMetadata(inputJson?: string): Record<string, unknown> {
    if (!inputJson) return {};
    try {
        const input = JSON.parse(inputJson) as { metadata?: unknown };
        return input.metadata && typeof input.metadata === "object" ? input.metadata as Record<string, unknown> : {};
    } catch {
        return {};
    }
}
