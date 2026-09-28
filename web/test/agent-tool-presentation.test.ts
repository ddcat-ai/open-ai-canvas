import { describe, expect, it } from "bun:test";
import { AGENT_TOOL_NAMES, agentToolCategory, agentToolCategoryLabel, agentToolErrorClassLabel, agentToolStatus, agentVisionFailureSummary, friendlyAgentToolSummary } from "@/lib/canvas/agent-tool-presentation";

describe("Agent tool presentation", () => {
    it("separates read, create, and canvas operation activity", () => {
        expect(agentToolCategory("canvas_get_state", { eventType: "tool_completed" })).toBe("read");
        expect(agentToolCategoryLabel("canvas_get_state", "read")).toBe("读取清单");
        expect(agentToolCategoryLabel("model_list", "read")).toBe("读取信息");
        expect(agentToolCategory("generate_media", { eventType: "generation_task_created" })).toBe("create");
        expect(agentToolCategoryLabel("generate_media", "create")).toBe("创建节点");
        expect(agentToolCategory("canvas_apply_ops", { eventType: "canvas_updated", actions: [{ action: "updated" }] })).toBe("operate");
        expect(agentToolCategoryLabel("canvas_apply_ops", "operate")).toBe("修改画布");
        expect(agentToolCategory("canvas_apply_ops", { eventType: "canvas_updated", actions: [{ action: "created" }] })).toBe("create");
    });

    it("keeps the canvas listing distinct from actually seeing a picture", () => {
        const summary = friendlyAgentToolSummary("canvas_get_state", "工具执行成功", { eventType: "tool_completed", result: { nodes: [{ id: "n1", title: "图.png", type: "image" }] } });
        expect(summary).toBe("已读取画布清单（未查看画面）");
        expect(summary).toContain("清单");
        expect(summary).toContain("未查看画面");
        // 不变量 ①：只有"查看画面"档可以说图片/画面相关的话
        expect(summary).not.toContain("读取了");
        expect(summary).not.toContain("画面已");
    });

    it("treats the vision tool as its own tier", () => {
        expect(agentToolCategory("canvas_inspect_image", { eventType: "tool_completed" })).toBe("vision");
        expect(agentToolCategoryLabel("canvas_inspect_image", "vision")).toBe("查看画面");
    });

    it("describes the four image inspection receipts without claiming more than happened", () => {
        const normal = friendlyAgentToolSummary("canvas_inspect_image", "工具执行成功", { eventType: "tool_completed", result: { nodeId: "n1", title: "图.png" } });
        expect(normal).toBe("已附上《图.png》的画面");
        expect(normal).toContain("画面");
        expect(normal).not.toContain("操作画布");
        expect(normal).not.toContain("操作已完成");

        const pending = friendlyAgentToolSummary("canvas_inspect_image", "", { result: { nodeId: "n1", title: "图.png" } }, true);
        expect(pending).toBe("准备查看画面《图.png》");

        const reused = friendlyAgentToolSummary("canvas_inspect_image", "工具执行成功", { eventType: "tool_completed", result: { nodeId: "n1", title: "图.png", repeat: true, reuseObservation: true } });
        expect(reused).toBe("复用已记录的观察，未重复看图");

        const repeated = friendlyAgentToolSummary("canvas_inspect_image", "工具执行成功", { eventType: "tool_completed", result: { nodeId: "n1", title: "图.png", repeat: true, refreshIgnored: true } });
        expect(repeated).toBe("本轮重复查看，只回执文字、未附图");

        const batch = friendlyAgentToolSummary("canvas_inspect_image", "工具执行成功", { eventType: "tool_completed", result: { nodeId: "n3", title: "图3.png", batchImages: [{ nodeId: "n1" }, { nodeId: "n2" }, { nodeId: "n3" }] } });
        expect(batch).toBe("已附上 3 张画面");
    });

    it("splits the four image inspection failures and carries the numbers it gets", () => {
        expect(agentVisionFailureSummary("cloud agent image inspection budget exhausted: 已用 7 次、本轮额度 5 次")).toBe("本轮识图额度已用完（已用 7 / 额度 5）");
        expect(agentVisionFailureSummary("cloud agent image inspection budget exhausted")).toBe("本轮识图额度已用完");
        expect(agentVisionFailureSummary("Agent 连续重复读取同一份canvas_inspect_image结果，本轮已停止以避免继续消耗模型调用；请让 Agent 使用已有结果继续，不要再次读取")).toBe("同一张图同版本重复读取，已拦下");
        expect(agentVisionFailureSummary("本批看图数量已达到当前模型限制：本批已附 3 张、单次上限 4 张。请在本批结果返回后、下一步再继续查看剩余图片。")).toBe("本批图片数已达模型上限（已附 3 / 上限 4），下一步继续");
        expect(agentVisionFailureSummary("当前模型未声明图片输入能力")).toBe("当前渠道模型未声明图片输入能力");
        expect(agentVisionFailureSummary("指定节点不在当前画布")).toBe("查看画面未完成");
        expect(friendlyAgentToolSummary("canvas_inspect_image", "当前模型未声明图片输入能力", { eventType: "tool_failed" })).toBe("当前渠道模型未声明图片输入能力");
    });

    it("never labels an unregistered tool as a canvas write", () => {
        const name = "canvas_dance_future_tool";
        const category = agentToolCategory(name, { eventType: "tool_completed" });
        expect(category).toBe("other");
        expect(agentToolCategoryLabel(name, category)).toBe("其他操作");
        expect(agentToolCategoryLabel(name, category)).not.toContain("画布");
        expect(friendlyAgentToolSummary(name, "工具执行成功", { eventType: "tool_completed" })).toBe(`已完成：${name}`);
        expect(friendlyAgentToolSummary(name, "", undefined, true)).toBe(`准备执行 ${name}`);
        // 历史事件里的 skills_load 仍在只读档，不能落进写操作
        expect(agentToolCategory("skills_load")).toBe("read");
    });

    it("gives every backend tool name a category and copy", () => {
        for (const name of AGENT_TOOL_NAMES) {
            const category = agentToolCategory(name, { eventType: "tool_completed" });
            expect(["read", "vision", "create", "operate", "other"]).toContain(category);
            expect(agentToolCategoryLabel(name, category).length).toBeGreaterThan(0);
            const summary = friendlyAgentToolSummary(name, "工具执行成功", { eventType: "tool_completed" });
            expect(summary.length).toBeGreaterThan(0);
            // 兜底句不能再是"操作已完成"这种既不说做了什么、又暗示写操作的旧文案
            expect(["操作已完成", "准备执行操作"]).not.toContain(summary);
        }
        // 未登记的工具（上游将来新增）必须点名自己
        expect(friendlyAgentToolSummary("canvas_brand_new_tool", "工具执行成功", { eventType: "tool_completed" })).toBe("已完成：canvas_brand_new_tool");
    });

    it("distinguishes media submission from a completed canvas result", () => {
        expect(friendlyAgentToolSummary("generate_media", "", { eventType: "generation_task_created" })).toBe("媒体节点已创建，生成任务已提交");
        expect(friendlyAgentToolSummary("generate_media", "", { eventType: "tool_completed" })).toBe("生成结果已回写画布节点");
        expect(friendlyAgentToolSummary("generate_media", "", { eventType: "tool_failed" })).toBe("媒体生成未完成");
        expect(friendlyAgentToolSummary("generate_media", "", { eventType: "tool_failed", result: { phase: "admission", taskSubmitted: false } })).toBe("参数未通过校验，未提交生成任务");
        expect(friendlyAgentToolSummary("generate_media", "", { eventType: "tool_failed", result: { phase: "completion", taskSubmitted: true, status: "succeeded" } })).toBe("生成成功，画布回写未完成");
        expect(friendlyAgentToolSummary("generate_media", "", { eventType: "tool_failed", result: { phase: "completion", taskSubmitted: true, status: "failed" } })).toBe("任务已提交，但生成结果未完成");
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
        expect(friendlyAgentToolSummary("canvas_get_state", "无法访问", { eventType: "tool_failed" })).toBe("获取画布清单失败");
    });
});

describe("Agent tool error classification", () => {
    it("maps backend errorClass to a human label, with a local fallback", () => {
        expect(agentToolErrorClassLabel({ errorClass: "schema_error" })).toBe("参数不符合契约");
        expect(agentToolErrorClassLabel({ result: { errorClass: "state_conflict" } })).toBe("画布状态已变化");
        expect(agentToolErrorClassLabel({ errorClass: "permission_violation", errorClassLabel: "超出本轮权限" })).toBe("超出本轮权限");
        expect(agentToolErrorClassLabel({ result: { errorClass: "upstream_failure" } })).toBe("上游故障");
        expect(agentToolErrorClassLabel({ errorClass: "admission_failure" })).toBe("媒体生成准入失败");
        expect(agentToolErrorClassLabel({ errorClass: "invalid_model_output" })).toBe("模型输出问题");
        expect(agentToolErrorClassLabel({ errorClass: "unknown_new_class" })).toBe("工具执行失败");
        expect(agentToolErrorClassLabel({ text: "没有归类" })).toBeUndefined();
    });
});
