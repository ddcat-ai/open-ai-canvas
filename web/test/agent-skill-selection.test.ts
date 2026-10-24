import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { addAgentSkillSelection, classifyAgentSkillSelection } from "@/lib/canvas/agent-skill-selection";
import type { Skill } from "@/services/api/skills";

const skill = (skillId: string, isAdded = true, status = 1) => ({ skillId, isAdded, status }) as Skill;

test("#888 distinguishes complete catalogs from unknown catalogs without mutating stored selections", () => {
    const ids = ["valid", "deleted", "uninstalled", "disabled"];
    expect(classifyAgentSkillSelection(ids, null)).toEqual({ validIds: [], invalidIds: [], unknownIds: ids });
    expect(classifyAgentSkillSelection(ids, [skill("valid"), skill("uninstalled", false), skill("disabled", true, 0)])).toEqual({ validIds: ["valid"], invalidIds: ["deleted", "uninstalled", "disabled"], unknownIds: [] });
    expect(ids).toEqual(["valid", "deleted", "uninstalled", "disabled"]);
    expect(classifyAgentSkillSelection(ids, []).invalidIds).toEqual(ids);
});

test("#888 eight valid selections fill the limit; stale references do not consume usable slots", () => {
    const catalog = Array.from({ length: 9 }, (_, i) => skill(`skill-${i}`));
    const firstEight = catalog.slice(0, 8).map((item) => item.skillId);
    expect(addAgentSkillSelection(firstEight, "skill-8", catalog)).toEqual(firstEight);
    expect(addAgentSkillSelection(["deleted", ...firstEight.slice(0, 7)], "skill-8", catalog)).toHaveLength(9);
    expect(addAgentSkillSelection(firstEight, "missing", catalog)).toEqual(firstEight);
    expect(addAgentSkillSelection(firstEight, "skill-8", null)).toEqual(firstEight);
    expect(addAgentSkillSelection(firstEight, "skill-0", catalog)).toEqual(firstEight);
});

test("#888 real skill library displays valid counts and explicit stale removal independently of filters", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/agent-skill-library.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("0 fail");
});
