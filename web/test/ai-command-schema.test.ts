import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
    AI_COMMAND_SCHEMA_VERSION,
    AI_EDITING_OP_CATALOG,
    AiCommandPlanError,
    buildAiEditingSystemPrompt,
    parseAiCommandPlan,
    validateAiCommandBatch,
} from "@/lib/timeline/ai-command-schema";
import { EDITOR_COMMAND_OPS } from "@/lib/timeline/editor-commands";
import type { TimelineProject } from "@/types/timeline";

const commandsGolden = JSON.parse(
    readFileSync(join(import.meta.dir, "fixtures/commands.golden.json"), "utf8"),
) as { base: TimelineProject };

const aiGolden = JSON.parse(
    readFileSync(join(import.meta.dir, "fixtures/ai-commands.golden.json"), "utf8"),
) as { schemaVersion: number; ops: string[] };

describe("AI 命令 schema 黄金同步（防漂移）", () => {
    test("catalog op 集与 M2.1 命令注册表一致", () => {
        const catalogOps = AI_EDITING_OP_CATALOG.map((e) => e.op);
        expect(catalogOps).toEqual([...EDITOR_COMMAND_OPS]);
    });
    test("golden fixture op 集/版本与源码一致", () => {
        expect(aiGolden.schemaVersion).toBe(AI_COMMAND_SCHEMA_VERSION);
        expect(aiGolden.ops).toEqual([...EDITOR_COMMAND_OPS]);
        expect(aiGolden.ops.length).toBe(12);
    });
    test("catalog 每条契约含 op/desc/payload 三段", () => {
        for (const entry of AI_EDITING_OP_CATALOG) {
            expect(entry.op.length).toBeGreaterThan(0);
            expect(entry.desc.length).toBeGreaterThan(0);
            expect(entry.payload.length).toBeGreaterThan(0);
        }
    });
});

describe("parseAiCommandPlan（LLM 输出解析）", () => {
    test("解析裸 JSON", () => {
        const plan = parseAiCommandPlan('{"reasoning":"移一下","commands":[{"op":"moveClip","payload":{"id":"clip-a","startMs":2000}}]}');
        expect(plan.reasoning).toBe("移一下");
        expect(plan.commands).toHaveLength(1);
    });
    test("解析 markdown fence 包裹的 JSON", () => {
        const plan = parseAiCommandPlan('```json\n{"commands":[{"op":"moveClip","payload":{"id":"clip-a","startMs":2000}}]}\n```');
        expect(plan.commands[0].op).toBe("moveClip");
    });
    test("容忍 JSON 前后杂讯并从首个 { 起解析", () => {
        const plan = parseAiCommandPlan('好的，我来处理：\n{"commands":[{"op":"moveClip","payload":{"id":"clip-a","startMs":2000}}]}\n以上就是我的建议。');
        expect(plan.commands[0].op).toBe("moveClip");
    });
    test("reasoning 可省略", () => {
        const plan = parseAiCommandPlan('{"commands":[{"op":"moveClip","payload":{"id":"clip-a","startMs":2000}}]}');
        expect(plan.reasoning).toBeUndefined();
    });
    test("commands 空数组合法（只读问答 / 无法执行语义）", () => {
        const plan = parseAiCommandPlan('{"reasoning":"当前没有可用于增加转场效果的命令。","commands":[]}');
        expect(plan.commands).toHaveLength(0);
        expect(plan.reasoning).toContain("转场");
    });
    test("commands 超过 8 条上限 → 抛错", () => {
        const tooMany = Array.from({ length: 9 }, (_, i) => ({
            op: "moveClip",
            payload: { id: `clip-a`, startMs: i * 1000 },
        }));
        expect(() => parseAiCommandPlan(JSON.stringify({ commands: tooMany }))).toThrow(/8 条上限/);
    });
    test("无 JSON 对象 → 抛错", () => {
        expect(() => parseAiCommandPlan("抱歉，我做不到。")).toThrow(/未找到 JSON 对象/);
    });
    test("JSON 截断未闭合 → 抛错", () => {
        expect(() => parseAiCommandPlan('{"commands":[{"op":"moveClip","payload":{"id":"clip-a","startMs":2000}}]')).toThrow(/未闭合/);
    });
    test("commands 项非对象 → 抛错", () => {
        expect(() => parseAiCommandPlan('{"commands":["moveClip"]}')).toThrow(/commands\[0\]/);
    });
    test("命令缺 payload → 抛错", () => {
        expect(() => parseAiCommandPlan('{"commands":[{"op":"moveClip"}]}')).toThrow(/payload/);
    });
    test("字符串内含括号/花括号不受括号配对误判", () => {
        const plan = parseAiCommandPlan('{"commands":[{"op":"setClipProperty","payload":{"id":"sub-1","patch":{"text":"你好}世界 {"}}}]}');
        expect(plan.commands[0].payload).toEqual({ id: "sub-1", patch: { text: "你好}世界 {" } });
    });
});

describe("validateAiCommandBatch（批级 dry-run 预检）", () => {
    test("合法批通过", () => {
        const verdict = validateAiCommandBatch(commandsGolden.base, {
            commands: [
                { op: "moveClip", payload: { id: "clip-a", startMs: 2000 } },
                { op: "setTrackFlag", payload: { trackId: "video-1", flag: "muted", value: true } },
            ],
        });
        expect(verdict).toEqual({ ok: true });
    });
    test("任一条未知 op → 整批拒绝并报下标与 op", () => {
        const verdict = validateAiCommandBatch(commandsGolden.base, {
            commands: [
                { op: "moveClip", payload: { id: "clip-a", startMs: 2000 } },
                { op: "explodeEverything", payload: {} },
            ],
        });
        expect(verdict.ok).toBe(false);
        if (!verdict.ok) {
            expect(verdict.index).toBe(1);
            expect(verdict.op).toBe("explodeEverything");
            expect(verdict.error).toMatch(/unknown edit command op/);
        }
    });
    test("引用了不存在的 clip → 整批拒绝（ADR-0007 不部分执行）", () => {
        const verdict = validateAiCommandBatch(commandsGolden.base, {
            commands: [{ op: "removeClip", payload: { id: "ghost-clip" } }],
        });
        expect(verdict.ok).toBe(false);
    });
    test("非法 payload（越界时长）→ 拒绝", () => {
        const verdict = validateAiCommandBatch(commandsGolden.base, {
            commands: [{ op: "moveClip", payload: { id: "clip-a", startMs: -1 } }],
        });
        expect(verdict.ok).toBe(false);
    });
    test("dry-run 不产生副作用（原时间线未被修改）", () => {
        const before = JSON.stringify(commandsGolden.base);
        validateAiCommandBatch(commandsGolden.base, {
            commands: [{ op: "moveClip", payload: { id: "clip-a", startMs: 2000 } }],
        });
        expect(JSON.stringify(commandsGolden.base)).toBe(before);
    });
});

describe("buildAiEditingSystemPrompt（提示词契约）", () => {
    const prompt = buildAiEditingSystemPrompt("时间线：空");
    test("包含时间线摘要、全部 op 契约与输出格式说明", () => {
        expect(prompt).toContain("时间线：空");
        expect(prompt).toContain("可用命令契约");
        expect(prompt).toContain("输出要求");
        expect(prompt).toContain("示例");
        for (const op of EDITOR_COMMAND_OPS) {
            expect(prompt).toContain(`- ${op}：`);
        }
    });
    test("同摘要生成确定性提示词", () => {
        expect(buildAiEditingSystemPrompt("A")).toBe(buildAiEditingSystemPrompt("A"));
    });
});
