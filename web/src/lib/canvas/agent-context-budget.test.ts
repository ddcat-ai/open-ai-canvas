import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error -- Node 原生 TypeScript 测试运行器需要保留扩展名。
import { assertAgentExchangeBudget, budgetAgentHistory } from "./agent-context-budget.ts";

const largeExchange = [{ role: "user" as const, content: "x".repeat(800_000) }];

test("1M context capability accepts an exchange larger than legacy byte thresholds", () => {
    assert.doesNotThrow(() => assertAgentExchangeBudget(
        largeExchange,
        [],
        "",
        { contextWindowTokens: 1_000_000, maxOutputTokens: 64_000 },
    ));
});

test("the same exchange is rejected when the selected model only exposes the default window", () => {
    assert.throws(() => assertAgentExchangeBudget(largeExchange, [], ""));
});

test("history budgeting uses the selected model capability", () => {
    const history = [{ role: "user" as const, content: "x".repeat(500_000) }];
    const current = { role: "user" as const, content: "继续" };
    assert.equal(budgetAgentHistory({ role: "system", content: "system" }, history, current, { contextWindowTokens: 1_000_000, maxOutputTokens: 64_000 }).length, 3);
    const compacted = budgetAgentHistory({ role: "system", content: "system" }, history, current);
    assert.equal(compacted.length, 3);
    assert.match(String(compacted[1]?.content), /上下文整理说明/);
});
