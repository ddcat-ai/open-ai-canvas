import { expect, spyOn, test } from "bun:test";
import localforage from "localforage";
import { getActiveUserScope, setActiveUserScope } from "../src/lib/user-scope";
import * as conversations from "../src/services/creation-conversation-store";

test("排队历史保存固定入队账号，Alice 慢保存期间切 Bob 不交叉写入", async () => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const local = new Map<string, string>();
    Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem: (key: string) => local.get(key) || null, setItem: (key: string, value: string) => local.set(key, value), removeItem: (key: string) => local.delete(key) } } });
    const writes: Array<{ key: string; value: string }> = [];
    const write = spyOn(localforage, "setItem").mockImplementation(async (key, value) => { writes.push({ key, value: String(value) }); return value; });
    try {
        setActiveUserScope("alice");
        let release!: () => void;
        const previous = new Promise<void>((resolve) => { release = resolve; });
        const queued = (conversations as any).queueCreationConversationsSave?.(previous, [{ id: "alice-private", messages: [{ id: "a", role: "user", content: "Alice private" }] }], getActiveUserScope());
        expect(queued).toBeInstanceOf(Promise);
        setActiveUserScope("bob");
        await conversations.saveCreationConversations([{ id: "bob-private", messages: [{ id: "b", role: "user" }] }]);
        release();
        await queued;
        expect(writes.map((item) => item.key)).toEqual([`${conversations.CREATION_CONVERSATIONS_KEY}:user:bob`, `${conversations.CREATION_CONVERSATIONS_KEY}:user:alice`]);
        expect(writes[0].value).not.toContain("alice-private");
        expect(writes[1].value).not.toContain("bob-private");
    } finally {
        write.mockRestore();
        if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
        else delete (globalThis as { window?: unknown }).window;
    }
});

test("已捕获 scope 的直接保存不读取后来激活的账号", async () => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem: () => "bob" } } });
    const keys: string[] = [];
    const write = spyOn(localforage, "setItem").mockImplementation(async (key, value) => { keys.push(key); return value; });
    try {
        await (conversations.saveCreationConversations as any)([{ id: "alice-private", messages: [] }], "alice");
        expect(keys).toEqual([`${conversations.CREATION_CONVERSATIONS_KEY}:user:alice`]);
    } finally {
        write.mockRestore();
        if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
        else delete (globalThis as { window?: unknown }).window;
    }
});
