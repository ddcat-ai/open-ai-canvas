import type { Skill } from "@/services/api/skills";

export type AgentSkillSelection = {
    validIds: string[];
    invalidIds: string[];
    unknownIds: string[];
};

// 只有完整的已加入目录能证明引用失效；搜索、分页和读取失败都不能作为依据。
export function classifyAgentSkillSelection(ids: string[], catalog: Skill[] | null): AgentSkillSelection {
    const unique = [...new Set(ids)];
    if (catalog === null) return { validIds: [], invalidIds: [], unknownIds: unique };
    const available = new Set(catalog.filter((skill) => skill.isAdded && skill.status === 1).map((skill) => skill.skillId));
    return { validIds: unique.filter((id) => available.has(id)), invalidIds: unique.filter((id) => !available.has(id)), unknownIds: [] };
}

export function addAgentSkillSelection(ids: string[], id: string, catalog: Skill[] | null) {
    if (ids.includes(id) || catalog === null) return ids;
    if (!classifyAgentSkillSelection([id], catalog).validIds.length || classifyAgentSkillSelection(ids, catalog).validIds.length >= 8) return ids;
    return [...ids, id];
}
