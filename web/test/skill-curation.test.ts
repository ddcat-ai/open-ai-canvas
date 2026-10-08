import { describe, expect, test } from "bun:test";
import { curationQuery, matchesCuration, effectiveCurationRoot, groupCuratedSkills, curationIcon } from "../src/components/skills/skill-curation-browser";
import type { SkillCuration } from "../src/services/api/skill-curation";
import type { Skill } from "../src/services/api/skills";

describe("platform curation", () => {
    const data: SkillCuration = { enabled: false, revision: 0, categories: [], assignments: [{ skillId: "one", categoryId: "child" }] };
    const skill = { skillId: "one", tag: "drama" } as Skill;
    test("disabled mode preserves existing requests and visible skills", () => {
        expect(curationQuery(data, "child")).toEqual({});
        expect(matchesCuration(skill, data, "missing")).toBe(true);
    });
    test("enabled mode filters by assignment and includes unassigned skills", () => {
        const enabled = { ...data, enabled: true };
        expect(curationQuery(enabled, "child")).toEqual({ platformCategoryId: "child" });
        expect(matchesCuration(skill, enabled, "child")).toBe(true);
        expect(matchesCuration(skill, enabled, "__uncategorized__")).toBe(false);
        expect(matchesCuration({ ...skill, skillId: "two" }, enabled, "__uncategorized__")).toBe(true);
    });
    test("dynamic roots use overrides, default bucket, icons and disabled gate", () => {
        const enabled: SkillCuration = { ...data, enabled: true, roots: [{ id: "custom", name: "Custom", iconKey: "landmark", enabled: true, sortOrder: 0 }, { id: "__unassigned__", name: "未归入启用分类", iconKey: "shapes", enabled: true, sortOrder: 1 }], rootAssignments: [{ skillId: skill.skillId, rootId: "custom" }] };
        expect(effectiveCurationRoot(skill, enabled)).toBe("custom");
        expect(curationQuery(enabled, "root:custom")).toEqual({ platformRootId: "custom" });
        expect(curationQuery({ ...enabled, enabled: false }, "root:custom")).toEqual({});
        expect(matchesCuration(skill, enabled, "root:custom")).toBe(true);
        expect(effectiveCurationRoot({ ...skill, isPrivate: true }, enabled)).toBe("__unassigned__");
        expect(groupCuratedSkills([skill], enabled)[0].label).toBe("Custom");
        expect(curationIcon("unknown")).toBe(curationIcon("shapes"));
    });
});
