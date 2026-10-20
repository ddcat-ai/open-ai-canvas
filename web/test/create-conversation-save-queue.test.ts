import { expect, spyOn, test } from "bun:test";
import localforage from "localforage";
import { flushCreationConversationsSave, queueCreationConversationsSave, updateCreationConversationSnapshot } from "../src/services/creation-conversation-store";

function withStorage(run: (writes: Array<{ key: string; value: string }>) => Promise<void>) {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem: () => "current-user" } } });
    const writes: Array<{ key: string; value: string }> = [];
    const write = spyOn(localforage, "setItem").mockImplementation(async (key, value) => {
        writes.push({ key, value: String(value) });
        return value;
    });
    return run(writes).finally(() => {
        write.mockRestore();
        if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
        else delete (globalThis as { window?: unknown }).window;
    });
}

const snapshot = (content: string) => [{ id: "session", messages: [{ id: "answer", role: "assistant" as const, content }] }];

test("流式缓存合并尚未写入的快照，在有限间隔内只写最新值", () =>
    withStorage(async (writes) => {
        let pending = Promise.resolve();
        for (let index = 0; index < 100; index++) pending = queueCreationConversationsSave(pending, snapshot(String(index)), "alice", { defer: true });
        await pending;
        expect(writes).toHaveLength(1);
        expect(JSON.parse(writes[0].value)[0].messages[0].content).toBe("99");
        expect(writes[0].key).toEndWith(":user:alice");
    }));

test("关键提交立即提升待写快照，await 等待实际保存并去重页面重复保存", () =>
    withStorage(async (writes) => {
        const delayed = queueCreationConversationsSave(Promise.resolve(), snapshot("旧流式"), "alice", { defer: true });
        const bound = snapshot("已绑定原任务");
        const immediate = queueCreationConversationsSave(delayed, bound, "alice");
        await immediate;
        expect(writes).toHaveLength(1);
        expect(JSON.parse(writes[0].value)[0].messages[0].content).toBe("已绑定原任务");
        await queueCreationConversationsSave(immediate, bound, "alice", { defer: true });
        expect(writes).toHaveLength(1);
    }));

test("待写期间换账号不合并不同账号的快照", () =>
    withStorage(async (writes) => {
        const alice = queueCreationConversationsSave(Promise.resolve(), snapshot("Alice"), "alice", { defer: true });
        const bob = queueCreationConversationsSave(alice, snapshot("Bob"), "bob");
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(writes).toHaveLength(2);
        await bob;
        expect(writes.map((item) => item.key.split(":user:")[1])).toEqual(["alice", "bob"]);
        expect(writes.map((item) => JSON.parse(item.value)[0].messages[0].content)).toEqual(["Alice", "Bob"]);
    }));

test("保存失败不会被去重为成功，相同快照仍可重试落盘", () =>
    withStorage(async (writes) => {
        const same = snapshot("重试");
        const write = spyOn(localforage, "setItem").mockRejectedValueOnce(new Error("storage unavailable"));
        const failed = queueCreationConversationsSave(Promise.resolve(), same, "alice");
        await expect(failed).rejects.toThrow("storage unavailable");
        write.mockImplementation(async (key, value) => {
            writes.push({ key, value: String(value) });
            return value;
        });
        await queueCreationConversationsSave(failed, same, "alice");
        expect(writes).toHaveLength(1);
    }));

test("重复事件没有改变会话时不新建数组触发缓存写入", () => {
    const current = snapshot("保持");
    expect(updateCreationConversationSnapshot(current, "session", (item) => item)).toBe(current);
});

test("持续流式不会无限延长缓存写入间隔，离页可以立即刷新最后快照", () =>
    withStorage(async (writes) => {
        let pending = Promise.resolve();
        for (let index = 0; index < 25; index++) {
            pending = queueCreationConversationsSave(pending, snapshot(String(index)), "alice", { defer: true });
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(writes.length).toBeGreaterThan(0);
        await flushCreationConversationsSave(pending);
        expect(writes.length).toBeLessThan(5);
        expect(JSON.parse(writes.at(-1)!.value)[0].messages[0].content).toBe("24");
    }));

test("慢存储写入中只保留一份最新后续快照，关键 await 不提前完成", () =>
    withStorage(async (writes) => {
        let release!: () => void;
        const blocked = new Promise<void>((resolve) => {
            release = resolve;
        });
        let started!: () => void;
        const writing = new Promise<void>((resolve) => {
            started = resolve;
        });
        const write = spyOn(localforage, "setItem").mockImplementation(async (key, value) => {
            writes.push({ key, value: String(value) });
            if (writes.length === 1) {
                started();
                await blocked;
            }
            return value;
        });
        const first = queueCreationConversationsSave(Promise.resolve(), snapshot("首条"), "alice");
        await writing;
        let latest = first;
        for (let index = 0; index < 50; index++) latest = queueCreationConversationsSave(latest, snapshot(String(index)), "alice", { defer: true });
        const critical = queueCreationConversationsSave(latest, snapshot("已确认成品"), "alice");
        let finished = false;
        void critical.then(() => {
            finished = true;
        });
        await Promise.resolve();
        expect(finished).toBe(false);
        release();
        await critical;
        expect(writes).toHaveLength(2);
        expect(JSON.parse(writes[1].value)[0].messages[0].content).toBe("已确认成品");
        write.mockRestore();
    }));
