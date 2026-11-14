import { expect, test } from "bun:test";
import { createCanvasLiteIntentRegistry } from "@/lib/canvas/canvas-lite-intent";

test("并发意图在保存后分别保持节点归属，旧意图不能覆盖新意图", async () => {
    const registry = createCanvasLiteIntentRegistry(() => "alice");
    const nodes = new Map([
        ["a", ""],
        ["b", ""],
    ]);
    const pending: Array<() => void> = [];
    const unregister = registry.register("alice", "project", {
        bind: (nodeId, id) => {
            if (nodes.has(nodeId)) nodes.set(nodeId, id);
        },
        owns: (nodeId, id) => nodes.get(nodeId) === id,
        persist: () => new Promise<void>((resolve) => pending.push(resolve)),
    });
    const first = registry.persist({ projectId: "project", nodeId: "a", intentId: "old" });
    const second = registry.persist({ projectId: "project", nodeId: "b", intentId: "other" });
    const third = registry.persist({ projectId: "project", nodeId: "a", intentId: "new" });
    pending.forEach((resolve) => resolve());
    await expect(first).rejects.toThrow("节点已变更");
    await Promise.all([second, third]);
    expect([...nodes]).toEqual([
        ["a", "new"],
        ["b", "other"],
    ]);
    unregister();
});

test("保存失败、取消、切换账号、离开画布或删除节点时拒绝派发", async () => {
    let scope = "alice";
    const registry = createCanvasLiteIntentRegistry(() => scope);
    let nodeId = "";
    let finish!: () => void;
    const unregister = registry.register("alice", "project", {
        bind: (_node, id) => {
            nodeId = id;
        },
        owns: (_node, id) => nodeId === id,
        persist: () =>
            new Promise<void>((resolve) => {
                finish = resolve;
            }),
    });
    const run = (signal?: AbortSignal) => registry.persist({ projectId: "project", nodeId: "node", intentId: "id", signal });
    const canceled = new AbortController();
    const first = run(canceled.signal);
    canceled.abort();
    finish();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    const second = run();
    scope = "bob";
    finish();
    await expect(second).rejects.toThrow("账号已切换");
    scope = "alice";
    const third = run();
    nodeId = "";
    finish();
    await expect(third).rejects.toThrow("节点已变更");
    const fourth = run();
    unregister();
    finish();
    await expect(fourth).rejects.toThrow("画布或账号已切换");
    registry.register("alice", "project", {
        bind: () => {},
        owns: () => true,
        persist: async () => {
            throw new Error("保存失败");
        },
    });
    await expect(run()).rejects.toThrow("保存失败");
});
