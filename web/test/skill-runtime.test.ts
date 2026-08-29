import { describe, expect, test } from "bun:test";

import type { Skill, SkillPackageFile, SkillPackageFileContent } from "../src/services/api/skills";
import { createSkillRuntime, resolveSkillMentions } from "../src/services/skill-runtime";

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
