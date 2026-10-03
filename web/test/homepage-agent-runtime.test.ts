import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error -- Node 原生 TypeScript 测试运行器需要保留扩展名。
import { executeHomepageGenerationPlan } from "../src/pages/create/homepage-agent-runtime.ts";

test("首页 Agent 运行时执行完整计划，不把计划降级成单个通用输入框任务", async () => {
    const executed: string[] = [];
    const requests = [
        { itemId: "hero", prompt: "主图", styleFingerprint: "style-a", queuePosition: 1, queueSize: 2 },
        { itemId: "bullet", prompt: "卖点图", styleFingerprint: "style-a", queuePosition: 2, queueSize: 2 },
    ];

    await executeHomepageGenerationPlan(requests, async (request) => {
        executed.push(request.itemId);
    });

    assert.deepEqual(executed, ["hero", "bullet"]);
});
