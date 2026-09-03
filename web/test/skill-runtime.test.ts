import { describe, expect, test } from "bun:test";

import type { Skill, SkillPackageFile, SkillPackageFileContent } from "../src/services/api/skills";
import { createSkillRuntime, resolveSkillMentions, composeSkillsForTurn, isFirstPartyDefaultSkill, firstPartyDefaultSkillIdsForProfile, isStoryboardDirectorIntent, getBenchmarkSkillMode } from "../src/services/skill-runtime";

function skill(overrides: Partial<Skill> = {}): Skill {
    return {
        skill_id: "director",
        skill_name: "AI导演",
        description: "导演工作流",
        version_id: "version-2",
        version: "2.0.0",
        content_hash: "hash",
        file_count: 5,
        total_bytes: 1024,
        source_type: "zip",
        source_url: "",
        source_ref: "",
        source_subdir: "",
        source_commit: "",
        sync_status: "synced",
        auto_update: false,
        last_checked_at: 0,
        last_synced_at: 0,
        status: 1,
        markdown_url: "",
        create_time: 0,
        update_time: 0,
        source: 0,
        tag: "影视",
        sort_weight: 0,
        is_private: true,
        like_count: 0,
        is_like: false,
        owner_uid: "user",
        effective_user: { name: "用户", avatar_url: "", uid: "user" },
        original_skill_id: null,
        showcase_media: [],
        added_count: 1,
        is_test: false,
        extra_info: "",
        is_added: true,
        is_owner: true,
        ...overrides,
    };
}

function file(path: string, content: string, kind: SkillPackageFile["kind"] = "markdown"): SkillPackageFileContent {
    return {
        file: { path, kind, mime_type: "text/markdown", size: content.length, sha256: `sha-${path}` },
        content,
        binary: false,
    };
}

describe("skill runtime", () => {
    test("技能引用解析由统一规则同时支持稳定 token 和自然提及", () => {
        const director = skill();
        const storyboard = skill({ skill_id: "storyboard", skill_name: "小说转分镜" });

        expect(resolveSkillMentions("用 @[skill:director] 处理", [director, storyboard]).map((item) => item.skill_id)).toEqual(["director"]);
        expect(resolveSkillMentions("请用 @小说转分镜。", [director, storyboard]).map((item) => item.skill_id)).toEqual(["storyboard"]);
        expect(resolveSkillMentions("@AI导演增强版", [director])).toEqual([]);
    });

    test("普通生成只加载入口和与当前任务最相关的直接引用文本", async () => {
        const entry = [
            "# AI导演",
            "视频提示词读取 `references/prompt_templates.md`。",
            "角色资产读取 [角色规则](references/character_assets.md)。",
            "维护脚本见 `scripts/audit_skill.py`。",
            "项目模板见 `assets/project-ledger-template.md`。",
        ].join("\n");
        const files: SkillPackageFile[] = [
            file("SKILL.md", entry).file,
            file("references/prompt_templates.md", "视频提示词模板正文").file,
            file("references/character_assets.md", "角色资产正文").file,
            file("scripts/audit_skill.py", "print('audit')", "code").file,
            file("assets/project-ledger-template.md", "台账模板").file,
        ];
        const readPaths: string[] = [];
        const runtime = createSkillRuntime({
            getFile: async (_id, path) => {
                readPaths.push(path);
                if (path === "SKILL.md") return { file: file(path, entry) };
                return { file: file(path, path.includes("prompt_templates") ? "视频提示词模板正文" : "角色资产正文") };
            },
            listFiles: async () => ({ files }),
            searchFiles: async () => ({ results: [] }),
            getBundle: async () => { throw new Error("不应读取完整包"); },
        });

        const result = await runtime.prepare({ profile: "canvas", prompt: "@[skill:director] 帮我生成视频提示词", skills: [skill()] });

        expect(result.prompt).toContain('<skill-file path="SKILL.md">');
        expect(result.prompt).toContain('<skill-file path="references/prompt_templates.md">');
        expect(readPaths).not.toContain("references/character_assets.md");
        expect(readPaths).not.toContain("scripts/audit_skill.py");
        expect(readPaths).not.toContain("assets/project-ledger-template.md");
        expect(result.prompt).toContain("【用户任务】\n@AI导演 帮我生成视频提示词");
        expect(result.metadata.skillIds).toEqual(["director"]);
    });

    test("本地 Agent 通过同一 Runtime 投递完整原生技能包", async () => {
        const runtime = createSkillRuntime({
            getFile: async () => { throw new Error("不应读取单文件"); },
            listFiles: async () => ({ files: [] }),
            searchFiles: async () => ({ results: [] }),
            getBundle: async () => ({
                bundle: {
                    skill_id: "director",
                    name: "AI导演",
                    description: "导演工作流",
                    version_id: "version-2",
                    version: "2.0.0",
                    content_hash: "hash",
                    files: [{ path: "SKILL.md", mime_type: "text/markdown", content_base64: "IyBBSuWvv+a8lA==" }],
                },
            }),
        });

        const result = await runtime.prepare({ profile: "localAgent", prompt: "@[skill:director] 开始", skills: [skill()] });

        expect(result.prompt).toBe("@AI导演 开始");
        expect(result.skills).toEqual([{ skillId: "director", name: "AI导演", description: "导演工作流", version: "2.0.0", files: [{ path: "SKILL.md", mimeType: "text/markdown", contentBase64: "IyBBSuWvv+a8lA==" }] }]);
    });

    test("在线 Agent 的技能工具由 Runtime 注册表统一执行", async () => {
        const runtime = createSkillRuntime({
            getFile: async () => ({ file: file("SKILL.md", "# AI导演") }),
            listFiles: async () => ({ files: [] }),
            searchFiles: async () => ({ results: [] }),
            getBundle: async () => { throw new Error("不应读取完整包"); },
        });

        expect(runtime.agentToolNames("onlineAgent").has("canvas_get_skill")).toBe(true);
        const result = await runtime.executeAgentTool("onlineAgent", "canvas_get_skill", { skillId: "director" }, [skill()]);
        expect(result?.ok).toBe(true);
        expect(result && "data" in result ? result.data : null).toMatchObject({ skillId: "director", version: "2.0.0" });
    });
});

describe("第一方默认技能组合（canvas-core始终注入 + storyboard-director意图驱动）", () => {
    const canvasCore = skill({ skill_id: "canvas-core", skill_name: "画布执行手册", is_added: true });
    const storyboardDirector = skill({ skill_id: "storyboard-director", skill_name: "分镜导演", is_added: true });
    const firstParty = [canvasCore, storyboardDirector];
    const userSkill1 = skill({ skill_id: "user-skill-1", skill_name: "用户技能1", is_added: true });
    const userSkill2 = skill({ skill_id: "user-skill-2", skill_name: "用户技能2", is_added: true });
    const userSkill3 = skill({ skill_id: "user-skill-3", skill_name: "用户技能3", is_added: true });
    const userSkill4 = skill({ skill_id: "user-skill-4", skill_name: "用户技能4", is_added: true });
    const userSkill5 = skill({ skill_id: "user-skill-5", skill_name: "用户技能5", is_added: true });
    const notAdded = skill({ skill_id: "not-added", skill_name: "未添加技能", is_added: false });

    const allProfiles = ["canvas", "creation", "shortDrama", "director", "onlineAgent", "localAgent"] as const;
    const eligibleProfiles = ["localAgent"] as const;
    const nonEligibleProfiles = ["canvas", "creation", "shortDrama", "director", "onlineAgent"] as const;

    const STORYBOARD_PROMPT = "把当前这段剧情拆成8个专业分镜，只做分镜不生成图片";
    const PLAIN_PROMPT = "随便说点什么";
    const EDIT_PROMPT = "把当前选中的节点往左移动一点";

    test("isStoryboardDirectorIntent 正确识别分镜意图", () => {
        expect(isStoryboardDirectorIntent("把剧本拆成分镜")).toBe(true);
        expect(isStoryboardDirectorIntent("给这一幕设计镜头")).toBe(true);
        expect(isStoryboardDirectorIntent("重新设计这段戏的镜头语言")).toBe(true);
        expect(isStoryboardDirectorIntent("做8个电影感分镜")).toBe(true);
        expect(isStoryboardDirectorIntent("把这一段做成专业storyboard")).toBe(true);
        expect(isStoryboardDirectorIntent("这段戏怎么拍")).toBe(true);
        // 负例：普通画布编辑 / 单次媒体生成 / 延长
        expect(isStoryboardDirectorIntent(EDIT_PROMPT)).toBe(false);
        expect(isStoryboardDirectorIntent("生成一张图片")).toBe(false);
        expect(isStoryboardDirectorIntent("把这个视频延长到10秒")).toBe(false);
        expect(isStoryboardDirectorIntent("删除这个节点")).toBe(false);
        expect(isStoryboardDirectorIntent("")).toBe(false);
    });

    test("isFirstPartyDefaultSkill 按profile正确识别两个第一方技能", () => {
        for (const id of ["canvas-core", "storyboard-director"]) {
            expect(isFirstPartyDefaultSkill(id, "localAgent")).toBe(true);
            for (const profile of nonEligibleProfiles) {
                expect(isFirstPartyDefaultSkill(id, profile)).toBe(false);
            }
            expect(isFirstPartyDefaultSkill(id)).toBe(true);
        }
        expect(isFirstPartyDefaultSkill("user-skill-1", "localAgent")).toBe(false);
    });

    test("firstPartyDefaultSkillIdsForProfile 返回确定顺序：canvas-core 在前", () => {
        expect(firstPartyDefaultSkillIdsForProfile("localAgent")).toEqual(["canvas-core", "storyboard-director"]);
        for (const profile of nonEligibleProfiles) {
            expect(firstPartyDefaultSkillIdsForProfile(profile)).toEqual([]);
        }
    });

    test.each(eligibleProfiles)("eligible profile %s: 普通对话只注入canvas-core，不注入分镜导演", (profile) => {
        const result = composeSkillsForTurn({ profile, prompt: PLAIN_PROMPT, skills: firstParty, maxSkills: 4 });
        expect(result).toHaveLength(1);
        expect(result[0].skill_id).toBe("canvas-core");
        expect(result.map((s) => s.skill_id)).not.toContain("storyboard-director");
    });

    test.each(eligibleProfiles)("eligible profile %s: 分镜意图同时注入canvas-core与分镜导演", (profile) => {
        const result = composeSkillsForTurn({ profile, prompt: STORYBOARD_PROMPT, skills: firstParty, maxSkills: 4 });
        const ids = result.map((s) => s.skill_id);
        expect(ids).toEqual(["canvas-core", "storyboard-director"]);
    });

    test.each(eligibleProfiles)("eligible profile %s: 1用户技能 + canvas-core，普通意图不激活分镜导演", (profile) => {
        const result = composeSkillsForTurn({ profile, prompt: "@用户技能1 帮我整理一下", skills: [...firstParty, userSkill1], maxSkills: 4 });
        const ids = result.map((s) => s.skill_id);
        expect(ids).toContain("user-skill-1");
        expect(ids).toContain("canvas-core");
        expect(ids).not.toContain("storyboard-director");
    });

    test.each(eligibleProfiles)("eligible profile %s: maxSkills用户技能时canvas-core仍可用（不占容量）", (profile) => {
        const allSkills = [...firstParty, userSkill1, userSkill2, userSkill3, userSkill4, userSkill5];
        const prompt = "@用户技能1 @用户技能2 @用户技能3 @用户技能4 @用户技能5 " + STORYBOARD_PROMPT;
        const result = composeSkillsForTurn({ profile, prompt, skills: allSkills, maxSkills: 4 });
        // 4个用户技能 + canvas-core + storyboard-director
        expect(result).toHaveLength(6);
        const userSkillsInResult = result.filter((s) => s.skill_id.startsWith("user-skill-"));
        expect(userSkillsInResult).toHaveLength(4);
        expect(result.map((s) => s.skill_id)).toContain("canvas-core");
        expect(result.map((s) => s.skill_id)).toContain("storyboard-director");
    });

    test.each(eligibleProfiles)("eligible profile %s: 用户已显式@分镜导演时不重复注入", (profile) => {
        const result = composeSkillsForTurn({ profile, prompt: "@分镜导演 测试", skills: firstParty, maxSkills: 4 });
        // @分镜导演 进入用户技能；canvas-core默认注入；分镜导演不重复
        expect(result).toHaveLength(2);
        const ids = result.map((s) => s.skill_id);
        expect(ids.filter((id) => id === "storyboard-director")).toHaveLength(1);
        expect(ids).toContain("canvas-core");
    });

    test.each(nonEligibleProfiles)("non-eligible profile %s: 无用户提及时两个第一方技能都不注入", (profile) => {
        const result = composeSkillsForTurn({ profile, prompt: STORYBOARD_PROMPT, skills: firstParty, maxSkills: 4 });
        expect(result).toHaveLength(0);
        expect(result.map((s) => s.skill_id)).not.toContain("canvas-core");
        expect(result.map((s) => s.skill_id)).not.toContain("storyboard-director");
    });

    test.each(nonEligibleProfiles)("non-eligible profile %s: 用户技能行为不变（提及则包含）", (profile) => {
        const result = composeSkillsForTurn({ profile, prompt: "@用户技能1 测试", skills: [...firstParty, userSkill1], maxSkills: 4 });
        expect(result).toHaveLength(1);
        expect(result[0].skill_id).toBe("user-skill-1");
    });

    test.each(nonEligibleProfiles)("non-eligible profile %s: 用户显式选择第一方技能时保留", (profile) => {
        const result = composeSkillsForTurn({ profile, prompt: "测试", skills: [...firstParty, userSkill1], maxSkills: 4, selectedSkillIds: ["storyboard-director"] });
        expect(result.map((s) => s.skill_id)).toContain("storyboard-director");
        expect(result.map((s) => s.skill_id)).not.toContain("canvas-core");
    });

    test("所有profile覆盖完整性", () => {
        expect(allProfiles).toHaveLength(6);
        expect(eligibleProfiles).toHaveLength(1);
        expect(nonEligibleProfiles).toHaveLength(5);
        const allSet = new Set([...eligibleProfiles, ...nonEligibleProfiles]);
        expect(allSet.size).toBe(allProfiles.length);
    });

    test("eligible profile: 未添加（is_added=false）的技能不出现在结果中", () => {
        const result = composeSkillsForTurn({ profile: "localAgent", prompt: STORYBOARD_PROMPT, skills: [...firstParty, notAdded], maxSkills: 4 });
        expect(result).toHaveLength(2);
        expect(result.map((s) => s.skill_id)).not.toContain("not-added");
    });

    test("eligible profile: 显式选择用户技能优先级最高，第一方技能追加不覆盖", () => {
        const result = composeSkillsForTurn({ profile: "localAgent", prompt: "测试", skills: [...firstParty, userSkill1, userSkill2], maxSkills: 4, selectedSkillIds: ["user-skill-1"] });
        expect(result[0].skill_id).toBe("user-skill-1");
        expect(result[1].skill_id).toBe("canvas-core");
    });

    test("eligible profile: 顺序确定——用户技能在前，canvas-core、分镜导演在末尾", () => {
        const result = composeSkillsForTurn({ profile: "localAgent", prompt: "@用户技能2 @用户技能1 " + STORYBOARD_PROMPT, skills: [...firstParty, userSkill1, userSkill2], maxSkills: 4 });
        const ids = result.map((s) => s.skill_id);
        expect(ids.slice(-2)).toEqual(["canvas-core", "storyboard-director"]);
    });

    test("eligible profile: 空prompt时仅canvas-core可用（分镜导演不被空意图激活）", () => {
        const result = composeSkillsForTurn({ profile: "localAgent", prompt: "   ", skills: [...firstParty, userSkill1], maxSkills: 4 });
        expect(result).toHaveLength(1);
        expect(result[0].skill_id).toBe("canvas-core");
    });

    test("负例：普通画布编辑命令只带canvas-core，不激活分镜导演（AVAILABLE != FORCED）", () => {
        const result = composeSkillsForTurn({ profile: "localAgent", prompt: EDIT_PROMPT, skills: firstParty, maxSkills: 4 });
        const ids = result.map((s) => s.skill_id);
        expect(ids).toEqual(["canvas-core"]);
        expect(ids).not.toContain("storyboard-director");
    });
});

describe("Benchmark Skill Mode", () => {
    const canvasCore = skill({ skill_id: "canvas-core", skill_name: "画布执行手册", is_added: true });
    const storyboardDirector = skill({ skill_id: "storyboard-director", skill_name: "分镜导演", is_added: true });
    const firstParty = [canvasCore, storyboardDirector];
    const userSkill1 = skill({ skill_id: "user-skill-1", skill_name: "用户技能1", is_added: true });
    const STORYBOARD_PROMPT = "把当前这段剧情拆成8个专业分镜，只做分镜不生成图片";

    test("1. normal模式 + 分镜意图：canvas-core与storyboard-director都注入", () => {
        const result = composeSkillsForTurn({ profile: "localAgent", prompt: STORYBOARD_PROMPT, skills: firstParty, maxSkills: 4, benchmarkMode: "normal" });
        expect(result.map((s) => s.skill_id)).toEqual(["canvas-core", "storyboard-director"]);
    });

    test("1b. normal模式 + 普通对话：只注入canvas-core", () => {
        const result = composeSkillsForTurn({ profile: "localAgent", prompt: "测试", skills: firstParty, maxSkills: 4, benchmarkMode: "normal" });
        expect(result.map((s) => s.skill_id)).toEqual(["canvas-core"]);
    });

    test("2. baseline模式：保留canvas-core公共基线，不注入storyboard-director", () => {
        const result = composeSkillsForTurn({ profile: "localAgent", prompt: STORYBOARD_PROMPT, skills: firstParty, maxSkills: 4, benchmarkMode: "baseline" });
        const ids = result.map((s) => s.skill_id);
        expect(ids).toEqual(["canvas-core"]);
        expect(ids).not.toContain("storyboard-director");
    });

    test("3. director模式：canvas-core + storyboard-director，分镜导演恰好一次", () => {
        const result = composeSkillsForTurn({ profile: "localAgent", prompt: "测试", skills: firstParty, maxSkills: 4, benchmarkMode: "director" });
        const ids = result.map((s) => s.skill_id);
        expect(ids).toEqual(["canvas-core", "storyboard-director"]);
        expect(ids.filter((id) => id === "storyboard-director")).toHaveLength(1);
        expect(ids.filter((id) => id === "canvas-core")).toHaveLength(1);
    });

    test("4. 普通用户技能在所有模式下正常工作", () => {
        for (const mode of ["normal", "baseline", "director"] as const) {
            const result = composeSkillsForTurn({ profile: "localAgent", prompt: "@用户技能1 测试", skills: [...firstParty, userSkill1], maxSkills: 4, benchmarkMode: mode });
            expect(result.map((s) => s.skill_id)).toContain("user-skill-1");
            // canvas-core 作为公共基线在所有模式都存在
            expect(result.map((s) => s.skill_id)).toContain("canvas-core");
        }
    });

    test("5. 非localAgent profile行为不变（benchmarkMode不注入第一方技能）", () => {
        for (const profile of ["canvas", "creation", "shortDrama", "director", "onlineAgent"] as const) {
            const result = composeSkillsForTurn({ profile, prompt: STORYBOARD_PROMPT, skills: firstParty, maxSkills: 4, benchmarkMode: "director" });
            expect(result.map((s) => s.skill_id)).not.toContain("storyboard-director");
            expect(result.map((s) => s.skill_id)).not.toContain("canvas-core");
        }
    });

    test("默认benchmarkMode为normal（普通意图只带canvas-core）", () => {
        const result = composeSkillsForTurn({ profile: "localAgent", prompt: "测试", skills: firstParty, maxSkills: 4 });
        expect(result.map((s) => s.skill_id)).toEqual(["canvas-core"]);
    });

    test("baseline模式下用户显式@分镜导演仍可包含（用户行为优先），canvas-core保留", () => {
        const result = composeSkillsForTurn({ profile: "localAgent", prompt: "@分镜导演 测试", skills: firstParty, maxSkills: 4, benchmarkMode: "baseline" });
        const ids = result.map((s) => s.skill_id);
        // @分镜导演 走用户技能路径保留；自动注入层不重复添加
        expect(ids.filter((id) => id === "storyboard-director")).toHaveLength(1);
        expect(ids).toContain("canvas-core");
    });
});
