import { describe, expect, test } from "bun:test";

import { agentPlanVisible, latestAgentPlanItems, pendingAgentQuestion } from "@/lib/canvas/cloud-agent-plan";

const items = (...statuses: Array<"pending" | "doing" | "done">) => statuses.map((status, index) => ({ id: `${index + 1}`, title: `第 ${index + 1} 项`, status }));

/**
 * 回归（2026-09-16）：一个对话会跨多轮运行，每轮各有一条 `plan-${runId}` 清单消息，
 * 都在同一个 messages 数组里。原来取的是**第一条**，于是清单永远钉在第 1 轮的初始状态 ——
 * 后面怎么推进都不刷新、全部做完也不消失（实测反馈：plan 完成了不更新、全完成也不关闭）。
 */
describe("latestAgentPlanItems", () => {
    test("跨轮取最新那份，而不是第一条", () => {
        const messages = [
            { id: "plan-run-1", planItems: items("pending", "pending") },
            { id: "user-1", text: "..." },
            { id: "plan-run-2", planItems: items("done", "doing") },
        ];
        expect(latestAgentPlanItems(messages).map((entry) => entry.status)).toEqual(["done", "doing"]);
    });

    test("最新那份全部完成 → 清单收起", () => {
        const messages = [
            { id: "plan-run-1", planItems: items("pending") },
            { id: "plan-run-2", planItems: items("done", "done") },
        ];
        const plan = latestAgentPlanItems(messages);
        expect(plan.every((entry) => entry.status === "done")).toBe(true);
        expect(agentPlanVisible(plan)).toBe(false);
    });

    test("最新那份还没做完 → 继续显示", () => {
        expect(agentPlanVisible(latestAgentPlanItems([{ id: "plan-run-1", planItems: items("done", "doing") }]))).toBe(true);
    });

    test("没有任何清单（包括带空数组的）→ 空且不显示", () => {
        expect(latestAgentPlanItems([])).toEqual([]);
        expect(latestAgentPlanItems([{ id: "user-1" }, { id: "plan-run-1", planItems: [] }])).toEqual([]);
        expect(agentPlanVisible([])).toBe(false);
    });
});

/**
 * 回归（2026-09-16）：运行中输入框是禁用的，模型在正文里提问用户根本答不了
 * （生产实测它连问 4 轮、白烧十几步）。`ask_user` 让本轮收尾并把问题结构化，
 * 这个选择器决定「现在该不该把选项面板亮给用户」。
 */
describe("pendingAgentQuestion", () => {
    const question = { question: "选哪个模型？", options: [{ label: "H3文生视频" }, { label: "Seedance 2.5" }] };

    test("有未作答的提问 → 亮面板", () => {
        const messages = [
            { role: "user" },
            { role: "assistant", question },
        ];
        expect(pendingAgentQuestion(messages)?.question).toBe("选哪个模型？");
    });

    test("提问之后用户已回复 → 收起面板", () => {
        const messages = [
            { role: "assistant", question },
            { role: "user" },
        ];
        expect(pendingAgentQuestion(messages)).toBeUndefined();
    });

    test("多轮提问取最新那道；旧的那道不算数", () => {
        const later = { question: "确认开始吗？", options: [{ label: "开始" }, { label: "再改改" }] };
        const messages = [
            { role: "assistant", question },
            { role: "user" },
            { role: "assistant", question },
            { role: "assistant", question: later },
        ];
        expect(pendingAgentQuestion(messages)?.question).toBe("确认开始吗？");
    });

    test("没有提问 → 不亮面板", () => {
        expect(pendingAgentQuestion([])).toBeUndefined();
        expect(pendingAgentQuestion([{ role: "assistant" }, { role: "user" }])).toBeUndefined();
    });
});
