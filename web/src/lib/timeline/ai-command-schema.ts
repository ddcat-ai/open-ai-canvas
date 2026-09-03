// AI 编辑命令契约（ADR-0007 / Runbook M6.1）：宿主校验 + LLM 提示词约束的双契约。
// 本文件不复制 handler 约束——命令合法性硬守门在 M2.1 命令注册表（fail-closed），
// 这里只做：(1) LLM 输出 JSON 的结构解析与批级预检（dry-run 走同一注册表，零重复），
// (2) 生成喂给 LLM 的 op 契约（op 集合与注册表黄金同步，见测试）。

import { getEditorCommandRegistry, type EditCommand } from "@/lib/timeline/editor-commands";
import type { TimelineProject } from "@/types/timeline";

/** LLM 输出 JSON 结构：reasoning 可选，commands 至少一条。 */
export type AiCommandPlan = {
    reasoning?: string;
    commands: EditCommand[];
};

export type AiCommandBatchVerdict =
    | { ok: true }
    | { ok: false; index: number; op: string; error: string };

export class AiCommandPlanError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "AiCommandPlanError";
    }
}

/** 从 LLM 回复中提取首个 JSON 对象（容忍 markdown fence / 前后缀杂讯）。 */
function extractFirstJsonObject(text: string): string {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fenced ? fenced[1] : text;
    const start = candidate.indexOf("{");
    if (start < 0) throw new AiCommandPlanError("输出中未找到 JSON 对象（需要 { commands: [...] }）");
    // 从首个 { 起逐字符数括号，找配对的收尾 }（字符串内括号不计）。
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < candidate.length; i += 1) {
        const ch = candidate[i];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (ch === "\\") {
                escaped = true;
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }
        if (ch === '"') {
            inString = true;
        } else if (ch === "{") {
            depth += 1;
        } else if (ch === "}") {
            depth -= 1;
            if (depth === 0) return candidate.slice(start, i + 1);
        }
    }
    throw new AiCommandPlanError("JSON 对象未闭合（缺少收尾 }）");
}

function assertPlanShape(raw: unknown): asserts raw is AiCommandPlan {
    if (typeof raw !== "object" || raw === null) throw new AiCommandPlanError("输出必须是 JSON 对象");
    const plan = raw as Record<string, unknown>;
    if (plan.reasoning !== undefined && typeof plan.reasoning !== "string") {
        throw new AiCommandPlanError("reasoning 必须是字符串");
    }
    if (!Array.isArray(plan.commands)) throw new AiCommandPlanError("缺少 commands 数组");
    if (plan.commands.length === 0) throw new AiCommandPlanError("commands 不能为空");
    plan.commands.forEach((cmd, i) => {
        if (typeof cmd !== "object" || cmd === null) throw new AiCommandPlanError(`commands[${i}] 必须是对象`);
        const c = cmd as Record<string, unknown>;
        if (typeof c.op !== "string" || c.op.length === 0) throw new AiCommandPlanError(`commands[${i}].op 必须是非空字符串`);
        if (typeof c.payload !== "object" || c.payload === null || Array.isArray(c.payload)) {
            throw new AiCommandPlanError(`commands[${i}].op=${c.op} 缺少对象 payload`);
        }
    });
}

/** 解析 LLM 文本输出为 AiCommandPlan；结构非法时抛 AiCommandPlanError（供 UI 展示并回填模型）。 */
export function parseAiCommandPlan(text: string): AiCommandPlan {
    let raw: unknown;
    try {
        raw = JSON.parse(extractFirstJsonObject(text));
    } catch (error) {
        if (error instanceof AiCommandPlanError) throw error;
        throw new AiCommandPlanError(`JSON 解析失败：${(error as Error).message}`);
    }
    assertPlanShape(raw);
    return raw;
}

/**
 * 批级预检：把整批命令按序 dry-run 到当前时间线（immutable 纯函数，无副作用）。
 * 任何一条触发注册表 fail-closed（未知 op / 非法 payload / 引用不存在）即整批拒绝，
 * 返回首个出错命令的下标与消息——ADR-0007「任一非法→整批拒绝，错误回填 LLM 修正」。
 */
export function validateAiCommandBatch(project: TimelineProject, plan: AiCommandPlan): AiCommandBatchVerdict {
    const registry = getEditorCommandRegistry();
    let state = project;
    for (let i = 0; i < plan.commands.length; i += 1) {
        const cmd = plan.commands[i];
        try {
            state = registry.apply(state, cmd);
        } catch (error) {
            return { ok: false, index: i, op: cmd.op, error: (error as Error).message };
        }
    }
    return { ok: true };
}

// ---------------------------------------------------------------------------
// LLM 提示词契约（ADR-0007：schema 同时用于宿主校验与模型输出约束）
// ---------------------------------------------------------------------------

/** AI 命令 schema 版本（Runbook M6.1）：提示词契约/解析规则变更时递增，供 golden 与缓存失效对齐。 */
export const AI_COMMAND_SCHEMA_VERSION = 1;

/** 12 个黄金 op 的 LLM 可读 payload 契约；op 集合与注册表黄金同步（见测试）。 */
export const AI_EDITING_OP_CATALOG: ReadonlyArray<{
    op: string;
    desc: string;
    payload: string;
}> = [
    {
        op: "addClip",
        desc: "新增媒体/文本片段到已存在轨道",
        payload: "{ clip: { id(新唯一), kind: video|audio|image|text, trackId(必须存在), nodeId(源素材), startMs≥0, durationMs>0, title?, volume?, fadeInMs?, fadeOutMs? } }",
    },
    {
        op: "moveClip",
        desc: "移动片段（时间点/跨轨）",
        payload: "{ id, startMs≥0, trackId?(可选, 必须存在) }",
    },
    {
        op: "trimClip",
        desc: "裁剪片段（时间线位置/时长/源内起点）",
        payload: "{ id, startMs?(≥0), durationMs?(>0 且≤sourceDurationMs), sourceStartMs?(≥0, 与 durationMs 之和≤sourceDurationMs) }",
    },
    {
        op: "splitClip",
        desc: "在片段内部切一刀成两段",
        payload: "{ id, splitAtMs(严格大于 startMs 且小于 startMs+durationMs) }",
    },
    {
        op: "removeClip",
        desc: "删除片段",
        payload: "{ id }",
    },
    {
        op: "setClipProperty",
        desc: "修改片段属性（白名单）",
        payload: "{ id, patch: { title? | text? | volume? | fadeInMs? | fadeOutMs? | subtitleEntryIndex? }（至少一项） }",
    },
    {
        op: "addSubtitle",
        desc: "新增字幕片段",
        payload: "{ clip: { kind: subtitle, trackId(字幕轨), id/nodeId/startMs/durationMs/text } }",
    },
    {
        op: "removeSubtitle",
        desc: "删除字幕片段",
        payload: "{ id }",
    },
    {
        op: "rebuildSubtitleClips",
        desc: "按节点字幕条目重建字幕片段",
        payload: "{ nodeId, entries: [{ index≥0(唯一), startMs≥0, endMs>startMs, text }], trackId?(字幕轨) }",
    },
    {
        op: "addTrack",
        desc: "新增轨道（id/label 由系统生成，勿传）",
        payload: "{ kind: video|image|text|audio|subtitle }",
    },
    {
        op: "removeTrack",
        desc: "删除整条轨道及片段（每种轨道至少保留一条）",
        payload: "{ trackId }",
    },
    {
        op: "setTrackFlag",
        desc: "轨道开关",
        payload: "{ trackId, flag: visible|muted, value: boolean }",
    },
];

/** LLM 输出结构说明（追加到系统提示词，约束其为纯 JSON）。 */
export const AI_EDITING_OUTPUT_FORMAT = `输出要求：
- 只输出一个 JSON 对象，不要任何解释文字或 markdown。
- 结构：{ "reasoning": "一句话说明意图", "commands": [ { "op": "命令名", "payload": { ... } } ] }
- commands 至少 1 条、至多 8 条；payload 字段严格按命令契约；时间一律毫秒；文本用简体中文。
- 所有 id（clip/track/nodeId）必须来自上面时间线摘要，禁止编造。`;

/** 示例（示意完整 JSON 输出，加入 system prompt）。 */
const AI_EDITING_OUTPUT_EXAMPLE = `示例：
{ "reasoning": "把第一个视频片段移到第 5 秒", "commands": [ { "op": "moveClip", "payload": { "id": "clip-a", "startMs": 5000 } } ] }`;

/** 组装 AI 编辑系统提示词：时间线摘要 + op 契约 + 输出约束（M6.3 面板喂给模型）。 */
export function buildAiEditingSystemPrompt(timelineSummary: string): string {
    const catalogLines = AI_EDITING_OP_CATALOG.map(
        (entry) => `- ${entry.op}：${entry.desc}。payload：${entry.payload}`,
    ).join("\n");
    return [
        "你是影策视频剪辑工作台的 AI 剪辑助手。根据用户指令对时间线输出受约束的编辑命令 JSON。",
        "时间线当前状态：",
        timelineSummary,
        "可用命令契约（与编辑器同源，非法命令会被整批拒绝）：",
        catalogLines,
        AI_EDITING_OUTPUT_FORMAT,
        AI_EDITING_OUTPUT_EXAMPLE,
        "若用户指令无法用现有命令完成（如要转场、滤镜、模板），输出 commands: [] 并在 reasoning 说明缺什么能力。",
    ].join("\n");
}
