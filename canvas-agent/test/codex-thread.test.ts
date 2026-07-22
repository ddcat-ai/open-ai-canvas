import assert from "node:assert/strict";
import test from "node:test";

import { resolveCodexThread, type CodexThreadClient } from "../src/codex-thread.js";

const cwd = "C:\\canvas-workspace";

test("当前进程刚创建的会话直接开始首轮", async () => {
    const client = fakeClient();

    const threadId = await resolveCodexThread(client.value, { threadId: "thread-new", cwd }, "thread-new");

    assert.equal(threadId, "thread-new");
    assert.deepEqual(client.calls, []);
});

test("已有会话仍校验工作空间并恢复", async () => {
    const client = fakeClient({
        readThread: async () => ({ thread: { id: "thread-old", cwd } }),
        resumeThread: async () => ({ id: "thread-old", cwd }),
    });

    const threadId = await resolveCodexThread(client.value, { threadId: "thread-old", cwd });

    assert.equal(threadId, "thread-old");
    assert.deepEqual(client.calls, ["read:thread-old", "resume:thread-old"]);
});

test("未落盘的空会话自动替换", async () => {
    const client = fakeClient({
        readThread: async () => ({ thread: { id: "thread-stale", cwd } }),
        resumeThread: async () => {
            throw new Error("no rollout found for thread id thread-stale");
        },
        startThread: async () => ({ id: "thread-replacement", cwd }),
    });

    const threadId = await resolveCodexThread(client.value, { threadId: "thread-stale", cwd });

    assert.equal(threadId, "thread-replacement");
    assert.deepEqual(client.calls, ["read:thread-stale", "resume:thread-stale", "start"]);
});

test("读取阶段发现未 materialize 的空会话也会替换", async () => {
    const client = fakeClient({
        readThread: async () => {
            throw new Error("thread thread-stale is not materialized yet");
        },
        startThread: async () => ({ id: "thread-replacement", cwd }),
    });

    const threadId = await resolveCodexThread(client.value, { threadId: "thread-stale", cwd });

    assert.equal(threadId, "thread-replacement");
    assert.deepEqual(client.calls, ["read:thread-stale", "start"]);
});

test("非空会话错误不会被静默替换", async () => {
    const client = fakeClient({
        readThread: async () => {
            throw new Error("permission denied");
        },
    });

    await assert.rejects(() => resolveCodexThread(client.value, { threadId: "thread-old", cwd }), /permission denied/);
    assert.deepEqual(client.calls, ["read:thread-old"]);
});

function fakeClient(overrides: Partial<CodexThreadClient> = {}) {
    const calls: string[] = [];
    const value: CodexThreadClient = {
        readThread: async (threadId) => {
            calls.push(`read:${threadId}`);
            return await (overrides.readThread?.(threadId, false) || Promise.resolve({ thread: { id: threadId, cwd } }));
        },
        resumeThread: async (threadId, workspace) => {
            calls.push(`resume:${threadId}`);
            return await (overrides.resumeThread?.(threadId, workspace) || Promise.resolve({ id: threadId, cwd: workspace }));
        },
        startThread: async (workspace) => {
            calls.push("start");
            return await (overrides.startThread?.(workspace) || Promise.resolve({ id: "thread-started", cwd: workspace }));
        },
    };
    return { calls, value };
}
