import { expandSkillMentions, renderSkillPrompt } from "@/lib/canvas/canvas-skill-mentions";
import { requestImageQuestion, type AiTextMessage } from "@/services/api/image";
import type { UpdreamSkill } from "@/services/api/skills";
import type { AiConfig } from "@/stores/use-config-store";

export type ChapterAiMode = "rewrite" | "polish" | "expand" | "shorten" | "custom";

export type ChapterAiProposal = {
    mode: ChapterAiMode;
    instruction: string;
    skillId?: string;
    skillName?: string;
    beforePlain: string;
    afterPlain: string;
    afterHtml: string;
    model?: string;
    createdAt: string;
};

const MODE_LABEL: Record<ChapterAiMode, string> = {
    rewrite: "按指令改写",
    polish: "润色通顺",
    expand: "扩写细节",
    shorten: "压缩精炼",
    custom: "自定义",
};

export function chapterAiModeLabel(mode: ChapterAiMode) {
    return MODE_LABEL[mode];
}

export async function proposeChapterRewrite(input: {
    projectId: string;
    chapterId: string;
    chapterTitle: string;
    projectName: string;
    mode: ChapterAiMode;
    instruction: string;
    sourcePlain: string;
    sourceHtml: string;
    skill?: UpdreamSkill | null;
    skills?: UpdreamSkill[];
    config: AiConfig;
    /** 面板选中的文本模型；缺省 textModel || model */
    model?: string;
}): Promise<ChapterAiProposal> {
    const sourcePlain = input.sourcePlain.trim();
    if (!sourcePlain) throw new Error("当前章节没有可改写的正文");
    const model = (input.model || input.config.textModel || input.config.model || "").trim();
    if (!model) throw new Error("请先选择文本模型");

    const skillBlock = input.skill ? renderSkillPrompt(input.skill) : "";
    const userInstruction = expandSkillMentions(input.instruction.trim(), input.skills || (input.skill ? [input.skill] : []));
    const modeHint =
        input.mode === "polish"
            ? "在不改变剧情事实与人物关系的前提下润色语句，使其更通顺、更有画面感。"
            : input.mode === "expand"
              ? "在保持原剧情走向的前提下扩写场景细节、动作与情绪，不要另起新剧情线。"
              : input.mode === "shorten"
                ? "压缩冗余，保留关键剧情节点、人物关系与关键对白，不要删掉推动剧情的信息。"
                : input.mode === "rewrite"
                  ? "按用户指令改写整章正文；未说明要改的部分保持原意。"
                  : "严格按用户指令处理正文。";

    const prompt = [
        `你是短剧项目《${input.projectName}》的章节编剧助手，正在处理章节「${input.chapterTitle}」。`,
        modeHint,
        skillBlock,
        userInstruction ? `【用户指令】\n${userInstruction}` : "",
        "【输出要求】",
        "1. 只输出改写后的完整章节正文纯文本。",
        "2. 不要 Markdown 标题壳、不要解释、不要前后缀说明。",
        "3. 保留必要的空行分段；对白可用「角色：内容」或引号，与原风格一致优先。",
        "4. 不得编造与原文冲突的人物关系或结局。",
        "【原文章节正文】",
        sourcePlain,
    ]
        .filter(Boolean)
        .join("\n\n");

    // 与章节对话同一路径：直连文本模型，不走 canvas_text 任务队列（避免画布任务/积分/结果解析差异）。
    const messages: AiTextMessage[] = [{ role: "user", content: prompt }];
    let afterPlain = "";
    try {
        afterPlain = (await requestImageQuestion({ ...input.config, model, textModel: model, systemPrompt: "" }, messages, () => undefined)).trim();
    } catch (error) {
        const detail = error instanceof Error ? error.message : "改写请求失败";
        throw new Error(`生成改写提案失败：${detail}`);
    }
    afterPlain = stripRewriteWrappers(afterPlain);
    if (!afterPlain) throw new Error("模型没有返回可用正文");

    return {
        mode: input.mode,
        instruction: input.instruction.trim(),
        skillId: input.skill?.dir,
        skillName: input.skill?.name,
        beforePlain: sourcePlain,
        afterPlain,
        afterHtml: plainTextToChapterHtml(afterPlain),
        model,
        createdAt: new Date().toISOString(),
    };
}

export function plainTextToChapterHtml(plain: string) {
    const paragraphs = plain
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .split(/\n{2,}/)
        .map((block) => block.trim())
        .filter(Boolean);
    if (!paragraphs.length) return "<p></p>";
    return paragraphs
        .map((block) => {
            const lines = block.split("\n").map((line) => escapeHtml(line));
            return `<p>${lines.join("<br>")}</p>`;
        })
        .join("");
}

function stripRewriteWrappers(value: string) {
    let next = value.trim();
    if (next.startsWith("```")) {
        next = next.replace(/^```(?:text|markdown|md)?\s*/i, "").replace(/\s*```$/, "").trim();
    }
    return next;
}

function escapeHtml(value: string) {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
