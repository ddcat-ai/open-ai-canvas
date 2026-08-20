import { buildGenerationConfig } from "@/lib/canvas/canvas-project-generation";
import { runBackendGenerationTask } from "@/services/api/generation-task";
import type { AiConfig } from "@/stores/use-config-store";

export type SkillDraft = {
    skill_name: string;
    description: string;
    instruction: string;
    tag?: string;
};

const SKILL_DRAFT_PROMPT = `你是一位技能编写助手。根据用户的想法，为一个「可复用的创作技能」生成一份草稿。
只输出一个 JSON 对象，不要输出任何其他文字、解释或 Markdown 代码块。JSON 字段：
- "skill_name": 技能名称，简短（不超过 20 个字）
- "tag": 分类，从以下值中选一个字符串：drama（短剧影视）、ecommerce（电商营销）、creative（创意设计）、social（社媒内容）、others（其他）
- "description": 技能简介（不超过 120 字），说明适用场景、输入条件和最终产出
- "instruction": 技能指令（Markdown 格式，至少 300 字），写给后续在画布中使用该技能的 AI 模型阅读，必须包含：角色设定、输入与约束、分步执行流程、检查清单、输出格式

用户的想法：
{{{IDEA}}}`;

export function buildSkillDraftPrompt(idea: string): string {
    return SKILL_DRAFT_PROMPT.replace("{{{IDEA}}}", idea.trim());
}

const MAX_NAME_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 500;

export function parseSkillDraft(text: string): Partial<SkillDraft> {
    const trimmed = (text || "").trim();
    if (!trimmed) return {};
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
        try {
            const raw = JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
            if (raw && typeof raw === "object") {
                return {
                    skill_name: String(raw.skill_name ?? "").trim().slice(0, MAX_NAME_LENGTH),
                    description: String(raw.description ?? "").trim().slice(0, MAX_DESCRIPTION_LENGTH),
                    instruction: String(raw.instruction ?? raw.instructions ?? "").trim(),
                    tag: typeof raw.tag === "string" && raw.tag.trim() ? raw.tag.trim() : undefined,
                };
            }
        } catch {
            // JSON 解析失败时回退到文本整体方案
        }
    }
    // 回退：首行作为名称，正文作为简介与指令，用户随后可自由编辑
    const firstLine = trimmed.split(/\r?\n/)[0]?.trim().slice(0, 30) || "未命名技能";
    return {
        skill_name: firstLine,
        description: trimmed.slice(0, MAX_DESCRIPTION_LENGTH),
        instruction: trimmed,
    };
}

export async function generateSkillDraft(idea: string, config: AiConfig, signal?: AbortSignal): Promise<Partial<SkillDraft>> {
    const generationConfig = buildGenerationConfig(config, undefined, "text");
    const result = await runBackendGenerationTask({
        mode: "text",
        prompt: buildSkillDraftPrompt(idea),
        config: generationConfig,
        signal,
    });
    return parseSkillDraft(result.text || "");
}