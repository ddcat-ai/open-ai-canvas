import { runBackendCanvasGenerationTask } from "@/lib/canvas/canvas-project-generation";
import { parseCharacterBreakdown, type CharacterBreakdown } from "@/lib/canvas/canvas-character-reference";
import type { AiConfig } from "@/stores/use-config-store";

export type ChapterStoryboardDraft = {
    title: string;
    description: string;
    durationMs: number;
};

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
    const prompt = [
        `请从短剧项目《${input.projectName}》的章节“${input.chapterTitle}”中提取需要建立可复用视觉资产的角色。`,
        "提取本章实际出场、发言或对剧情产生明确作用，并且后续制作中需要保持视觉或声音一致的角色；忽略系统播报、纯物件、无身份群众、不影响剧情的一次性路人，以及只在单个镜头出现且没有持续角色价值的匿名录像或历史影像人物。合并同一角色的姓名、专属称谓和别名。",
        "每个角色必须填写剧情定位，以及至少三项可执行的稳定设定；正文未明确的信息要明确写“正文未明确”，不得留空，也不能改变人物关系和时代背景。角色名称必须来自正文中的姓名、昵称或稳定称谓，不得自行编造编号式名称。",
        `【项目画风】\n${input.projectStyle || "项目尚未指定画风，保持视觉描述中性、可执行。"}`,
        "只返回 JSON，不要 Markdown 或解释。JSON 结构必须严格为：",
        '{"characters":[{"name":"角色名","aliases":["唯一别名"],"role":"剧情定位与人物关系","appearance":"年龄、脸型、五官、肤色、发型等稳定外貌","clothing":"固定服装版型、颜色、纹样和材质","physique":"身高、头身、体型和体态","personality":"稳定气质与表演基线","props":"固定道具及佩戴位置，没有则为空字符串","consistencyPrompt":"跨图片和镜头必须保持不变的角色约束","multiViewPrompt":"正面、侧面、背面转面展示需要强调的结构细节","voiceLanguage":"语言、口音和表达习惯","voiceAge":"适合选角的声音年龄感","voiceTimbre":"音色、语速、力度和声音气质"}]}',
        "【章节正文】",
        input.sourceText,
    ].join("\n\n");
    const result = await runProjectTextTask(input, "chapter_character_breakdown", prompt);
    return parseCharacterBreakdown(result);
}

export async function generateChapterStoryboard(input: ChapterAnalysisInput): Promise<ChapterStoryboardDraft[]> {
    const prompt = [
        `请把短剧项目《${input.projectName}》的章节“${input.chapterTitle}”拆成可直接制作的分镜镜头。`,
        "镜头顺序必须忠于正文事件顺序；每个镜头只承担一个清楚的叙事动作。描述必须包含主体、动作、场景、景别、机位、镜头运动、光线和必要对白，不要写抽象评价。单镜头建议 3 至 8 秒。",
        `【项目画风】\n${input.projectStyle || "项目尚未指定画风，保持镜头描述中性、可执行。"}`,
        "只返回 JSON，不要 Markdown 或解释。JSON 结构必须严格为：",
        '{"shots":[{"title":"镜头名称","description":"可直接用于分镜制作的完整镜头描述","durationSeconds":5}]}',
        "【章节正文】",
        input.sourceText,
    ].join("\n\n");
    const result = await runProjectTextTask(input, "chapter_storyboard", prompt);
    return parseChapterStoryboard(result);
}

async function runProjectTextTask(input: ChapterAnalysisInput, operation: string, prompt: string) {
    const model = input.config.textModel || input.config.model;
    const result = await runBackendCanvasGenerationTask({
        projectId: input.projectId,
        nodeId: `${operation}:${input.chapterId}`,
        mode: "text",
        prompt,
        config: { ...input.config, model },
        metadata: { domainProjectId: input.projectId, chapterId: input.chapterId, operation },
    });
    if (!result.text?.trim()) throw new Error("模型没有返回可用结果");
    return result.text;
}

function parseChapterStoryboard(raw: string): ChapterStoryboardDraft[] {
    const unfenced = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start < 0 || end < start) throw new Error("分镜生成没有返回可识别的 JSON");
    let parsed: unknown;
    try {
        parsed = JSON.parse(unfenced.slice(start, end + 1));
    } catch (error) {
        throw new Error(`分镜结果格式不正确：${error instanceof Error ? error.message : "无法解析 JSON"}`);
    }
    const shots = parsed && typeof parsed === "object" ? (parsed as { shots?: unknown }).shots : undefined;
    if (!Array.isArray(shots)) throw new Error("分镜结果缺少 shots 数组");
    const result = shots.flatMap((item, index) => {
        if (!item || typeof item !== "object") return [];
        const value = item as Record<string, unknown>;
        const description = String(value.description || "").trim();
        if (!description) return [];
        const durationSeconds = Math.min(30, Math.max(1, Number(value.durationSeconds) || 5));
        return [{ title: String(value.title || `镜头 ${index + 1}`).trim(), description, durationMs: Math.round(durationSeconds * 1000) }];
    });
    if (!result.length) throw new Error("分镜结果中没有可用镜头");
    return result;
}
