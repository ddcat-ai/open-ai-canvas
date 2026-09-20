import { describe, expect, it } from "bun:test";
import { agentToolCategory, agentToolCategoryLabel, agentToolStatus, friendlyAgentToolSummary } from "@/lib/canvas/agent-tool-presentation";

describe("Agent tool presentation", () => {
    it("separates read, create, and canvas operation activity", () => {
        expect(agentToolCategory("canvas_get_state", { eventType: "tool_completed" })).toBe("read");
        expect(agentToolCategoryLabel("canvas_get_state", "read")).toBe("读取节点");
        expect(agentToolCategory("generate_media", { eventType: "generation_task_created" })).toBe("create");
        expect(agentToolCategory("canvas_apply_ops", { eventType: "canvas_updated", actions: [{ action: "updated" }] })).toBe("operate");
        expect(agentToolCategory("canvas_apply_ops", { eventType: "canvas_updated", actions: [{ action: "created" }] })).toBe("create");
    });

    it("distinguishes media submission from a completed canvas result", () => {
        expect(friendlyAgentToolSummary("generate_media", "", { eventType: "generation_task_created" })).toBe("媒体节点已创建，生成任务已提交");
        expect(friendlyAgentToolSummary("generate_media", "", { eventType: "tool_completed" })).toBe("生成结果已回写画布节点");
        expect(friendlyAgentToolSummary("generate_media", "", { eventType: "tool_failed" })).toBe("媒体生成未完成");
        expect(friendlyAgentToolSummary("generate_media", "", { eventType: "tool_failed", result: { phase: "admission", taskSubmitted: false } })).toBe("生成请求未提交");
        expect(friendlyAgentToolSummary("generate_media", "", { eventType: "tool_failed", result: { phase: "completion", status: "succeeded" } })).toBe("生成成功，画布回写未完成");
    });
    it("uses the failure event even without error keywords", () => {
        const text = "技能未在本轮启用，或参考文件未包含在固定快照中";
        const detail = { eventType: "tool_failed", skillName: "剧本撰写", path: "references/workflow.md" };
        expect(agentToolStatus("skill_read_file", text, detail)).toBe("failed");
        expect(friendlyAgentToolSummary("skill_read_file", text, detail)).toBe("读取参考资料失败 · 剧本撰写 · references/workflow.md");
    });
    it("does not interpret successful content containing error words as failure", () => {
        const detail = { eventType: "tool_completed", skillName: "剧本撰写", path: "error-handling.md" };
        expect(agentToolStatus("skill_read_file", "错误处理资料", detail)).toBe("completed");
        expect(friendlyAgentToolSummary("skill_read_file", "错误处理资料", detail)).toBe("已读取参考资料 · 剧本撰写 · error-handling.md");
    });
    it("distinguishes empty directories, populated directories and file reads", () => {
        for (const path of ["", undefined]) {
            const detail = { eventType: "tool_completed", skillName: "剧本撰写", path, result: { files: [] as string[] } };
            expect(friendlyAgentToolSummary("skill_read_file", "工具执行成功", detail)).toContain("无可读参考文件");
            detail.result.files = ["a.md"];
            expect(friendlyAgentToolSummary("skill_read_file", "工具执行成功", detail)).toContain("可读参考文件 1 个");
        }
    });
    it("preserves other tools, approval summaries and legacy status fallback", () => {
        expect(friendlyAgentToolSummary("canvas_apply_ops", "", undefined, true)).toBe("准备更新画布内容");
        expect(friendlyAgentToolSummary("skills_load", "已从用户技能库固定加载 3 个技能")).toBe("已加载 3 个 Skills 技能");
        expect(agentToolStatus("canvas_get_state", "失败")).toBe("failed");
        expect(friendlyAgentToolSummary("canvas_get_state", "无法访问", { eventType: "tool_failed" })).toBe("获取画布内容失败");
    });
});
