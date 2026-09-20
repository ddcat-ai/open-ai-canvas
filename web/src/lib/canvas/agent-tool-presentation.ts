export const AGENT_TOOL_METADATA: Record<string, { summary: string | ((context: { pending: boolean; detail?: unknown }) => string); failureMessage: string }> = {
    canvas_list_node_types: { summary: "已读取可用节点类型", failureMessage: "获取可用节点类型失败" },
    canvas_get_state: { summary: "已读取当前画布", failureMessage: "获取画布内容失败" },
    task_get: { summary: "已查询任务状态", failureMessage: "查询任务状态失败" },
    canvas_apply_ops: { summary: ({ pending }) => pending ? "准备更新画布内容" : "画布内容已保存至服务端", failureMessage: "更新画布内容失败" },
    model_list: { summary: "已获取可用模型", failureMessage: "获取可用模型失败" },
    generate_media: { summary: ({ pending, detail }) => pending ? "准备创建媒体节点并生成" : field(detail, "eventType") === "tool_completed" ? "生成结果已回写画布节点" : "媒体节点已创建，生成任务已提交", failureMessage: "媒体生成未完成" },
};

export type AgentToolCategory = "read" | "create" | "operate";

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function toolArguments(detail?: unknown) {
    const value = record(detail).arguments;
    if (typeof value !== "string") return record(value);
    try { return record(JSON.parse(value)); } catch { return {}; }
}

/**
 * Keeps the activity feed semantic instead of presenting every tool call as
 * the same check-mark row. This is intentionally based on the tool contract,
 * not on translated copy, so the visual grouping remains stable as messages
 * change or get localized.
 */
export function agentToolCategory(toolName: string, detail?: unknown): AgentToolCategory {
    if (["canvas_get_state", "canvas_list_node_types", "model_list", "task_get", "skills_load", "skill_read_file"].includes(toolName)) return "read";
    if (toolName === "generate_media") return "create";
    if (toolName === "canvas_apply_ops") {
        const actions = record(detail).actions;
        if (Array.isArray(actions) && actions.some((item) => record(item).action === "created" || record(item).action === "generating")) return "create";
        const ops = toolArguments(detail).ops;
        if (Array.isArray(ops) && ops.some((item) => record(item).type === "add_node")) return "create";
    }
    return "operate";
}

export function agentToolCategoryLabel(toolName: string, category: AgentToolCategory): string {
    if (category === "read") return toolName === "canvas_get_state" ? "读取节点" : "读取信息";
    if (category === "create") return "创建节点";
    return "操作画布";
}

type ToolStatus = "completed" | "failed" | "noop" | "rejected" | "pending";

function field(value: unknown, key: string): unknown {
    return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

export function agentToolStatus(title: string, text: string, detail?: unknown): ToolStatus {
    const event = field(detail, "eventType");
    if (event === "tool_completed" || event === "generation_task_created" || event === "canvas_updated") return "completed";
    if (event === "tool_failed") return "failed";
    const raw = `${title} ${text} ${field(detail, "error") || ""}`;
    if (field(detail, "status") === "noop" || /未生效|无需|没有找到|没有.*可|已存在/.test(raw)) return "noop";
    if (/拒绝|取消|rejected/i.test(raw)) return "rejected";
    if (/失败|错误|failed|error/i.test(raw)) return "failed";
    if (/完成|成功|completed|succeeded/i.test(raw)) return "completed";
    return "pending";
}

export function friendlyAgentToolSummary(toolName: string, text: string, detail?: unknown, pending = false) {
    const status = agentToolStatus(toolName, text, detail);
    const failed = status === "failed" || status === "rejected";
    if (toolName === "generate_media" && failed && field(field(detail, "result"), "phase") === "admission") return "生成请求未提交";
    if (toolName === "generate_media" && failed && field(field(detail, "result"), "status") === "succeeded") return "生成成功，画布回写未完成";
    if (toolName === "skills_load") {
        const count = /(?:加载|启用)\s*(\d+)\s*个/u.exec(text)?.[1];
        return failed ? "Skills 技能加载失败" : count ? `已加载 ${count} 个 Skills 技能` : "已加载 Skills 技能";
    }
    if (toolName === "skill_read_file") {
        const name = String(field(detail, "skillName") || field(detail, "skillId") || "Skills");
        const path = field(detail, "path");
        const files = field(field(detail, "result"), "files");
        const listing = path === "" || (path === undefined && Array.isArray(files));
        const target = typeof path === "string" && path ? `${name} · ${path}` : name;
        if (failed) return `${listing ? "列出参考文件失败" : "读取参考资料失败"} · ${target}`;
        if (listing && Array.isArray(files)) return files.length ? `${name} · 可读参考文件 ${files.length} 个` : `${name} · 无可读参考文件，使用已加载正文`;
        return `${pending ? "准备读取参考资料" : "已读取参考资料"} · ${target}`;
    }
    const metadata = AGENT_TOOL_METADATA[toolName];
    const summary = typeof metadata?.summary === "function" ? metadata.summary({ pending, detail }) : metadata?.summary;
    const failure = metadata?.failureMessage;
    return failed ? failure || "操作未完成" : summary || (pending ? "准备执行操作" : "操作已完成");
}
