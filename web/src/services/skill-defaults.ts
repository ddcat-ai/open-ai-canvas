import { addSkill, getSkill, listAddedSkills, type Skill } from "@/services/api/skills";
import { captureSkillLibraryAccess, isSkillLibraryAccessCurrent } from "@/lib/skill-access";

/** 新画布 Agent 的单一默认技能；已有画布的会话选择不由此常量覆盖。 */
export const DEFAULT_CANVAS_AGENT_SKILL_ID = "yingce-short-drama-workflow";

export type AddedSkillsResult = { skills: Skill[] };

/**
 * 确保默认技能既存在于用户技能库，也能作为本轮 Agent 的已选技能使用。
 * 先读已安装列表，只有首次需要时才写入用户技能状态。
 */
export async function ensureDefaultCanvasAgentSkill(
    dependencies: {
        listAdded?: typeof listAddedSkills;
        get?: typeof getSkill;
        add?: typeof addSkill;
    } = {},
): Promise<AddedSkillsResult> {
    const access = captureSkillLibraryAccess();
    if (!access) return { skills: [] };
    const list = dependencies.listAdded || listAddedSkills;
    const get = dependencies.get || getSkill;
    const add = dependencies.add || addSkill;
    const added = await list();
    if (!isSkillLibraryAccessCurrent(access)) return { skills: [] };
    if (added.skills.some((skill) => skill.skillId === DEFAULT_CANVAS_AGENT_SKILL_ID && skill.isAdded)) return added;

    const detail = await get(DEFAULT_CANVAS_AGENT_SKILL_ID);
    if (!isSkillLibraryAccessCurrent(access)) return { skills: [] };
    if (!detail.skill.isAdded) await add(DEFAULT_CANVAS_AGENT_SKILL_ID);
    if (!isSkillLibraryAccessCurrent(access)) return { skills: [] };
    return list();
}
