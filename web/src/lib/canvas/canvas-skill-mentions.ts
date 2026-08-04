import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import type { Skill } from "@/services/api/skills";

const SKILL_REF_PATTERN = /@\[skill:([^\]]+)\]/g;

export function buildSkillMentionReferences(skills: Skill[]): CanvasResourceReference[] {
    return skills
        .filter((skill) => skill.is_added)
        .map((skill) => ({
            id: `skill:${skill.skill_id}`,
            nodeId: `skill:${skill.skill_id}`,
            kind: "skill" as const,
            label: skill.skill_name,
            title: skill.skill_name,
            text: skill.instruction || skill.description,
            active: true,
            skill,
        }));
}

export function expandSkillMentions(prompt: string, skills: Skill[]) {
    if (!prompt.trim()) return prompt;
    const activeSkills = skills.filter((skill) => skill.is_added);
    if (!activeSkills.length) return prompt;

    const byId = new Map(activeSkills.map((skill) => [skill.skill_id, skill]));
    let next = prompt.replace(SKILL_REF_PATTERN, (token, id) => {
        const skill = byId.get(id);
        return skill ? renderSkillPrompt(skill) : token;
    });

    activeSkills
        .slice()
        .sort((a, b) => b.skill_name.length - a.skill_name.length)
        .forEach((skill) => {
            next = replaceNaturalSkillMention(next, skill);
        });

    return next;
}

export function renderSkillPrompt(skill: Pick<Skill, "skill_name" | "description" | "instruction">) {
    return [
        `【技能：${skill.skill_name}】`,
        skill.description ? `用途：${skill.description}` : "",
        skill.instruction ? `执行指令：\n${skill.instruction}` : "",
        "请严格执行该技能，只输出结果，不要输出解释性套话。",
    ]
        .filter(Boolean)
        .join("\n\n");
}

function replaceNaturalSkillMention(value: string, skill: Skill) {
    const token = `@${skill.skill_name}`;
    let result = "";
    let index = 0;

    while (index < value.length) {
        const found = value.indexOf(token, index);
        if (found < 0) {
            result += value.slice(index);
            break;
        }
        const after = found + token.length;
        if (!hasMentionBoundary(value, after)) {
            result += value.slice(index, after);
            index = after;
            continue;
        }
        result += value.slice(index, found);
        result += renderSkillPrompt(skill);
        index = after;
    }

    return result;
}

function hasMentionBoundary(value: string, index: number) {
    const char = value[index];
    return !char || /\s|[,.!?;:，。！？；：、)\]}】）]/.test(char);
}
