import { agentToolRetry, type AgentToolRetry } from "./agent-tool-retry";

/**
 * 前端工具清单，口径与后端 `CloudAgentSupportedToolNames()`
 * （`backend/internal/app/cloud_agent_tools.go`，从 `compileCloudAgentTools` 派生）逐一对齐。
 *
 * 作用只有一个：让"哪些工具该有类别与文案"这件事可断言。上游合并后工具表若变了，
 * 这份清单与下面的类别集合要一起复核 —— 未登记的工具一律走"其他操作"的中性兜底，
 * 绝不能落进"修改画布"（那会把一次读取读成写操作）。
 */
export const AGENT_TOOL_NAMES = [
    "agent_profile_read",
    "ask_user",
    "canvas_apply_ops",
    "canvas_arrange_nodes",
    "canvas_create_character",
    "canvas_create_storyboard",
    "canvas_edit_batch_table",
    "canvas_edit_storyboard",
    "canvas_get_state",
    "canvas_inspect_image",
    "canvas_list_node_types",
    "canvas_read_batch_table",
    "canvas_read_storyboard",
    "drama_adopt_canvas_media",
    "drama_get_context",
    "finish_run",
    "generate_media",
    "image_annotation_render",
    "image_layer_split",
    "image_text_detect",
    "memory_update",
    "model_list",
    "plan_update",
    "skill_market_search",
    "skill_read_file",
    "skill_recommend",
    "skill_search",
    "task_get",
] as const;

export type AgentToolSummaryContext = { pending: boolean; detail?: unknown; text: string };

export type AgentToolMetadataEntry = {
    summary: string | ((context: AgentToolSummaryContext) => string);
    /** 失败文案也支持函数形态：识图要按回执/错误细分（额度、读循环、批量上限、能力缺失）。 */
    failureMessage: string | ((context: AgentToolSummaryContext) => string);
};

export const AGENT_TOOL_METADATA: Record<string, AgentToolMetadataEntry> = {
    canvas_list_node_types: { summary: "已读取可用节点类型", failureMessage: "获取可用节点类型失败" },
    // 清单 ≠ 画面：这个工具只读到节点存在/类型/标题/规模。说成"已读取当前画布"会被读成看过图。
    canvas_get_state: { summary: "已读取画布清单（未查看画面）", failureMessage: "获取画布清单失败" },
    task_get: { summary: "已查询任务状态", failureMessage: "查询任务状态失败" },
    canvas_apply_ops: { summary: ({ pending }) => (pending ? "准备更新画布内容" : "画布内容已保存至服务端"), failureMessage: "更新画布内容失败" },
    model_list: { summary: "已获取可用模型", failureMessage: "获取可用模型失败" },
    canvas_create_character: { summary: ({ pending }) => (pending ? "准备创建角色卡" : "角色卡已创建并放到画布"), failureMessage: "创建角色卡失败" },
    // 短剧工具只在关联短剧的精修画布上出现：读取作品上下文，或把画布媒体采用为短剧的新版本（总要审批）。
    drama_get_context: { summary: "已读取短剧设定与分集", failureMessage: "读取短剧信息失败" },
    drama_adopt_canvas_media: { summary: ({ pending }) => (pending ? "准备采用到短剧" : "已采用到短剧，成为新的当前版本"), failureMessage: "采用到短剧失败" },
    generate_media: { summary: ({ pending, detail }) => (pending ? "准备创建媒体节点并生成" : field(detail, "eventType") === "tool_completed" ? "生成结果已回写画布节点" : "媒体节点已创建，生成任务已提交"), failureMessage: "媒体生成未完成" },
    // 看图：只有这个工具会把图片字节真的交给模型，所以只有它可以说"画面/看图"。
    // 回执字段来源：`backend/internal/app/cloud_agent_runtime.go`（payload["result"] = 回执）。
    canvas_inspect_image: {
        summary: ({ pending, detail }) => {
            const result = record(field(detail, "result"));
            const title = typeof result.title === "string" && result.title ? `《${result.title}》` : "该图片";
            if (result.reuseObservation === true) return "复用已记录的观察，未重复看图";
            const batch = Array.isArray(result.batchImages) ? result.batchImages : [];
            if (result.repeat === true && batch.length === 0) return "本轮重复查看，只回执文字、未附图";
            if (batch.length > 1) return `已附上 ${batch.length} 张画面`;
            return pending ? `准备查看画面${title}` : `已附上${title}的画面`;
        },
        failureMessage: ({ text, detail }) => agentVisionFailureSummary(text, detail),
    },
    // 收尾闸门（工作项 A）：被拦下时卡片要说清"这次没结束"，而不是千篇一律的"操作已完成"。
    finish_run: {
        summary: ({ pending, detail }) => (pending ? "准备收尾并给出最终答复" : field(field(detail, "result"), "completionBlocked") === true ? "收尾被拦下，继续处理未完成项" : "已收尾并给出最终答复"),
        failureMessage: "收尾未完成",
    },
    // 长期记忆只属于当前用户，不是画布写入；结果状态来自 memory_update 回执（applied / pending_review / unchanged）。
    memory_update: {
        summary: ({ pending, detail }) => {
            if (pending) return "准备整理长期记忆";
            const status = field(field(detail, "result"), "status");
            if (status === "pending_review") return "记忆修改已提交，等你确认";
            if (status === "unchanged") return "记忆里已有这些内容，未改动";
            return "长期记忆已更新";
        },
        failureMessage: "长期记忆未更新",
    },
    // 市场检索只返回候选元数据，不读正文、不安装。
    skill_market_search: {
        summary: ({ pending, detail }) => {
            if (pending) return "准备在技能市场查找";
            const matches = field(field(detail, "result"), "matches");
            if (!Array.isArray(matches)) return "已在技能市场查找";
            return matches.length ? `技能市场找到 ${matches.length} 个候选` : "技能市场没有匹配的技能";
        },
        failureMessage: "技能市场查找失败",
    },
    skill_recommend: { summary: ({ pending }) => (pending ? "准备推荐安装技能" : "已推荐安装技能，由你决定是否安装"), failureMessage: "技能推荐未显示" },
};

/** 画布上"读到清单"的只读工具：无像素，chip 必须是存在式。 */
const AGENT_CANVAS_READ_TOOLS = new Set(["canvas_get_state", "canvas_list_node_types", "canvas_read_storyboard", "canvas_read_batch_table"]);
/** 非画布信息的只读工具（模型、任务、技能、偏好）。`skills_load` 是历史事件名，保留兼容。 */
const AGENT_INFO_READ_TOOLS = new Set(["model_list", "task_get", "skill_search", "skill_market_search", "skill_read_file", "skills_load", "agent_profile_read", "drama_get_context"]);
const AGENT_VISION_TOOLS = new Set(["canvas_inspect_image"]);
const AGENT_CREATE_TOOLS = new Set(["generate_media", "canvas_create_storyboard", "canvas_create_character", "image_annotation_render"]);
const AGENT_OPERATE_TOOLS = new Set(["canvas_apply_ops", "canvas_arrange_nodes", "canvas_edit_storyboard", "canvas_edit_batch_table", "image_layer_split", "image_text_detect"]);

export type AgentToolCategory = "read" | "vision" | "create" | "operate" | "other";

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function toolArguments(detail?: unknown) {
    const value = record(detail).arguments;
    if (typeof value !== "string") return record(value);
    try {
        return record(JSON.parse(value));
    } catch {
        return {};
    }
}

/**
 * Keeps the activity feed semantic instead of presenting every tool call as
 * the same check-mark row. This is intentionally based on the tool contract,
 * not on translated copy, so the visual grouping remains stable as messages
 * change or get localized.
 *
 * 未登记的工具落 `other`（"其他操作"）：兜底不能让任何工具看起来像在写画布。
 */
export function agentToolCategory(toolName: string, detail?: unknown): AgentToolCategory {
    if (AGENT_VISION_TOOLS.has(toolName)) return "vision";
    if (AGENT_CANVAS_READ_TOOLS.has(toolName) || AGENT_INFO_READ_TOOLS.has(toolName)) return "read";
    if (AGENT_CREATE_TOOLS.has(toolName)) return "create";
    if (toolName === "canvas_apply_ops") {
        const actions = record(detail).actions;
        if (Array.isArray(actions) && actions.some((item) => record(item).action === "created" || record(item).action === "generating")) return "create";
        const ops = toolArguments(detail).ops;
        if (Array.isArray(ops) && ops.some((item) => record(item).type === "add_node")) return "create";
        return "operate";
    }
    if (AGENT_OPERATE_TOOLS.has(toolName)) return "operate";
    return "other";
}

/** 读的是画布清单（节点存在与规模），而不是模型、任务、技能等外部信息。 */
export function isAgentCanvasReadTool(toolName: string): boolean {
    return AGENT_CANVAS_READ_TOOLS.has(toolName);
}

export function agentToolCategoryLabel(toolName: string, category: AgentToolCategory): string {
    if (category === "vision") return "查看画面";
    if (category === "read") return AGENT_CANVAS_READ_TOOLS.has(toolName) ? "读取清单" : "读取信息";
    if (category === "create") return "创建节点";
    if (category === "operate") return "修改画布";
    return "其他操作";
}

type ToolStatus = "completed" | "failed" | "noop" | "rejected" | "pending" | "retrying";

function field(value: unknown, key: string): unknown {
    return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

export function agentToolStatus(title: string, text: string, detail?: unknown): ToolStatus {
    const event = field(detail, "eventType");
    const retry = agentToolRetry(detail);
    if (retry?.status === "retrying") return "retrying";
    if (retry?.status === "recovered") return "completed";
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
    const mediaTool = toolName === "generate_media" || toolName === "image_layer_split";
    const result = record(field(detail, "result"));
    const phase = result.phase;
    if (mediaTool && failed && phase === "admission") return "参数未通过校验，未提交生成任务";
    if (mediaTool && failed && phase === "completion" && result.taskSubmitted === true) {
        if (result.writebackReason || result.status === "succeeded") return "生成成功，画布回写未完成";
        return "任务已提交，但生成结果未完成";
    }
    if (toolName === "skills_load") {
        if (failed) return "Skills 技能加载失败";
        // 新事件：availableCount 是本轮可自动发现的已安装技能数，skillIds 只列用户固定的技能。
        const available = Number(field(detail, "availableCount") ?? /发现\s*(\d+)\s*个/u.exec(text)?.[1]);
        if (Number.isFinite(available) && available > 0) {
            const pinned = field(detail, "skillIds");
            const pinnedCount = Array.isArray(pinned) ? pinned.length : Number(/固定\s*(\d+)\s*个/u.exec(text)?.[1] || 0);
            return pinnedCount ? `可自动发现 ${available} 个已安装技能 · 固定 ${pinnedCount} 个` : `可自动发现 ${available} 个已安装技能`;
        }
        // 历史事件文案：“已启用 3 个技能”“固定加载 3 个技能”。
        const count = /(?:加载|启用)\s*(\d+)\s*个/u.exec(text)?.[1];
        return count ? `已加载 ${count} 个 Skills 技能` : "已加载 Skills 技能";
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
    const context: AgentToolSummaryContext = { pending, detail, text };
    const summary = typeof metadata?.summary === "function" ? metadata.summary(context) : metadata?.summary;
    const failure = typeof metadata?.failureMessage === "function" ? metadata.failureMessage(context) : metadata?.failureMessage;
    if (failed) return failure || "操作未完成";
    if (summary) return summary;
    // 未登记工具的中性兜底：点名工具，别让任何工具都读成"操作画布/已完成"（不变量 ③）。
    const name = toolName || "工具";
    return pending ? `准备执行 ${name}` : `已完成：${name}`;
}

const VISION_QUOTA_PATTERN = /已用\s*(\d+)\s*次、本轮额度\s*(\d+)\s*次/u;
const VISION_BATCH_PATTERN = /本批已附\s*(\d+)\s*张、单次上限\s*(\d+)\s*张/u;

/**
 * 识图失败的细分文案。
 *
 * 这四条只给文案、不给结构化字段：额度那条在 `prepareCloudAgentImageInspection` 里带
 * "已用 X 次、本轮额度 Y 次"，批量上限那条带"本批已附 X 张、单次上限 Y 张"，读循环走
 * `cloudAgentReadLoopError`，能力缺失是 `BadAuthRequest("当前模型未声明图片输入能力")`。
 * 所以这里按文案特征分类，拿到数字就把数字带上（不给数字时模型只能靠试探）。
 */
export function agentVisionFailureSummary(text: string, detail?: unknown): string {
    const payload = record(detail);
    const nested = record(payload.result);
    const raw = [text, payload.error, nested.error, payload.message, nested.note].filter((value): value is string => typeof value === "string").join(" ");
    const quota = VISION_QUOTA_PATTERN.exec(raw);
    if (quota) return `本轮识图额度已用完（已用 ${quota[1]} / 额度 ${quota[2]}）`;
    const batch = VISION_BATCH_PATTERN.exec(raw);
    if (batch) return `本批图片数已达模型上限（已附 ${batch[1]} / 上限 ${batch[2]}），下一步继续`;
    if (/重复读取|护栏/.test(raw)) return "同一张图同版本重复读取，已拦下";
    if (/未声明图片输入能力|支持图片输入的渠道模型/.test(raw)) return "当前渠道模型未声明图片输入能力";
    // 兜底也认后端的哨兵文案（"cloud agent image inspection budget exhausted"）：包一层时才有数字，
    // 单独出现时只给到"额度已用完"，不能让用户看到一句英文原样。
    if (/(识图|看图|image inspection budget)/i.test(raw) && /(额度|预算|budget)/i.test(raw)) return "本轮识图额度已用完";
    return "查看画面未完成";
}

/** 工具事件的调用名：detail.toolName/name/tool 优先，退化到消息标题。 */
export function agentToolName(title: string, detail?: unknown): string {
    return String(field(detail, "toolName") || field(detail, "name") || field(detail, "tool") || title);
}

/** 自动纠正分组的固定文案（卡片与折叠行共用，避免两处各写一套）。 */
export function agentToolRetryLabel(retry: AgentToolRetry): string {
    if (retry.status === "recovered") return "自动纠正后已恢复";
    if (retry.status === "exhausted") return "自动纠正未完成";
    return "自动纠正记录";
}

/**
 * 工具失败的稳定归类标签（后端 `errorClass`，见 handoff 工作项 B 的第一步）。
 * 界面上把"模型自己出的错"和"真实的权限/状态/上游问题"分开显示，用户与排查都不用猜。
 */
export const AGENT_TOOL_ERROR_CLASS_LABELS: Record<string, string> = {
    invalid_model_output: "模型输出问题",
    schema_error: "参数不符合契约",
    state_conflict: "画布状态已变化",
    permission_violation: "超出本轮权限",
    upstream_failure: "上游故障",
    admission_failure: "媒体生成准入失败",
    tool_error: "工具执行失败",
};

/** 从工具事件载荷里取归类标签：优先用后端给的 label，其次查本地映射。 */
export function agentToolErrorClassLabel(detail?: unknown): string | undefined {
    const payload = record(detail);
    const nested = record(payload.result);
    const label = payload.errorClassLabel ?? nested.errorClassLabel;
    if (typeof label === "string" && label) return label;
    const errorClass = payload.errorClass ?? nested.errorClass;
    if (typeof errorClass !== "string" || !errorClass) return undefined;
    return AGENT_TOOL_ERROR_CLASS_LABELS[errorClass] ?? "工具执行失败";
}
