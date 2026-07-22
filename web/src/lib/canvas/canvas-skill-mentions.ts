import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import type { UpdreamSkill } from "@/services/api/skills";

const SKILL_REF_PATTERN = /@\[skill:([^\]]+)\]/g;

export function buildSkillMentionReferences(skills: UpdreamSkill[]): CanvasResourceReference[] {
    return skills
        .filter((skill) => skill.activated ?? true)
        .map((skill) => ({
            id: `skill:${skill.dir}`,
            nodeId: `skill:${skill.dir}`,
            kind: "skill" as const,
            label: skill.name,
            title: skill.name,
            text: skill.description || skill.detail_text,
            active: true,
            skill,
        }));
}

export function expandSkillMentions(prompt: string, skills: UpdreamSkill[]) {
    if (!prompt.trim()) return prompt;
    const activeSkills = skills.filter((skill) => skill.activated ?? true);
    if (!activeSkills.length) return prompt;

    const byId = new Map(activeSkills.map((skill) => [skill.dir, skill]));
    let next = prompt.replace(SKILL_REF_PATTERN, (token, id) => {
        const skill = byId.get(id);
        return skill ? renderSkillPrompt(skill) : token;
    });

    activeSkills
        .slice()
        .sort((a, b) => b.name.length - a.name.length)
        .forEach((skill) => {
            next = replaceNaturalSkillMention(next, skill);
        });

    return next;
}

export function renderSkillPrompt(skill: Pick<UpdreamSkill, "name" | "description" | "detail_text">) {
    return [
        `【技能：${skill.name}】`,
        skill.description ? `用途：${skill.description}` : "",
        skill.detail_text ? `技能详情：\n${skill.detail_text}` : "",
        "请严格执行该技能，只输出结果，不要输出解释性套话。",
    ]
        .filter(Boolean)
        .join("\n\n");
}

function replaceNaturalSkillMention(value: string, skill: UpdreamSkill) {
    const token = `@${skill.name}`;
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
