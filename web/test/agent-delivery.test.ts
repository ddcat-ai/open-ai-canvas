import { expect, test } from "bun:test";
import { agentRunStatusLabel } from "../src/lib/canvas/agent-delivery";
import type { AgentRun } from "../src/services/api/agent";

const run: AgentRun = { id: "r", canvasId: "c", status: "completed", permissionMode: "auto", createdAt: "", updatedAt: "" };
test("finished turn is not a delivery claim", () => {
    expect(agentRunStatusLabel(run)).toBe("本轮已结束");
    expect(agentRunStatusLabel({ ...run, delivery: { status: "awaiting_input", pendingTitles: [], items: [] } })).toBe("待你补充");
    expect(agentRunStatusLabel({ ...run, delivery: { status: "needs_attention", pendingTitles: ["镜头2"], items: [] } })).toBe("尚未完成");
    expect(agentRunStatusLabel({ ...run, delivery: { status: "delivered", pendingTitles: [], items: [] } })).toBe("已交付到画布");
});
test("cleanup and cancellation retain lifecycle meaning", () => {
    const delivered = { ...run, delivery: { status: "delivered" as const, pendingTitles: [], items: [] } };
    expect(agentRunStatusLabel({ ...delivered, cleanupPending: true })).toBe("正在收尾");
    expect(agentRunStatusLabel({ ...delivered, status: "cancelled" })).toBe("已停止");
});

test("a failed attempt followed by a delivered result does not imply an unfinished goal", () => {
    const recovered: AgentRun = {
        ...run,
        delivery: {
            status: "has_failures",
            pendingTitles: [],
            items: [
                { taskId: "first-attempt", kind: "image", status: "failed" },
                { taskId: "retry", nodeId: "image", kind: "image", status: "delivered" },
            ],
        },
    };
    expect(agentRunStatusLabel(recovered)).toBe("已有交付，有失败记录");
    expect(agentRunStatusLabel({ ...recovered, status: "running" })).toBe("运行中");
    expect(agentRunStatusLabel({ ...recovered, cleanupPending: true })).toBe("正在收尾");
});
