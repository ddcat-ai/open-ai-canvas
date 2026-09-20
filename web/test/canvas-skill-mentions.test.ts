import { describe, expect, it } from "bun:test";

import { buildSkillMentionReferences, resolveSkillMentions } from "@/lib/canvas/canvas-skill-mentions";
import type { Skill } from "@/services/api/skills";

function skill(overrides: Partial<Skill> = {}): Skill {
    return {
        skillId: "skill-1",
        skillName: "镜头拆解",
        description: "把文本拆成可执行镜头",
        instruction: "先读取当前画布，再按镜头顺序创建节点。",
        versionId: "v1",
        version: "1",
        contentHash: "",
        fileCount: 1,
        totalBytes: 0,
        sourceType: "markdown",
        sourceUrl: "",
        sourceRef: "",
        sourceSubdir: "",
        sourceCommit: "",
        syncStatus: "synced",
        autoUpdate: false,
        status: 1,
        markdownUrl: "",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        source: 0,
        tag: "canvas",
        sortWeight: 0,
        isPrivate: false,
        likeCount: 0,
        isLike: false,
        ownerUid: "user-1",
        effectiveUser: { name: "测试用户", avatarUrl: "", uid: "user-1" },
        originalSkillId: null,
        showcaseMedia: [],
        addedCount: 1,
        isTest: false,
        extraInfo: "",
        isAdded: true,
        isOwner: true,
        ...overrides,
    };
}

describe("canvas skill mentions", () => {
    it("only exposes added skills as composer references", () => {
        const references = buildSkillMentionReferences([skill(), skill({ skillId: "skill-2", skillName: "未加入", isAdded: false })]);
        expect(references.map((item) => item.id)).toEqual(["skill:skill-1"]);
        expect(references[0]?.kind).toBe("skill");
    });

    it("resolves mentioned skills without expanding their instruction into the prompt", () => {
        const active = skill();
        const inactive = skill({ skillId: "skill-2", skillName: "未加入", isAdded: false });
        expect(resolveSkillMentions("请使用 @镜头拆解，但不要使用 @未加入。", [active, inactive]).map((item) => item.skillId)).toEqual(["skill-1"]);
        expect(resolveSkillMentions("请使用 /镜头拆解 完成任务。", [active, inactive]).map((item) => item.skillId)).toEqual(["skill-1"]);
    });
});
