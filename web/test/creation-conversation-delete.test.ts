import { afterAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Keep the production persistence logic; isolate only the browser storage driver
// and active account, without leaking module mocks into other Bun suites.
const dir = mkdtempSync(join(fileURLToPath(new URL(".", import.meta.url)), ".creation-delete-"));
const storagePath = join(dir, "storage.ts");
writeFileSync(storagePath, `
export const data = new Map();
export let scope = "owner";
export const setScope = (next) => { scope = next; };
export const getActiveUserScope = () => scope;
export const localForageStorageForScope = (owner) => ({
    getItem: async (key) => data.get(owner + ":" + key) ?? null,
    setItem: async (key, value) => { data.set(owner + ":" + key, value); },
    removeItem: async (key) => { data.delete(owner + ":" + key); },
});
`);
writeFileSync(join(dir, "conversations.ts"), readFileSync(new URL("../src/services/creation-conversation-store.ts", import.meta.url), "utf8")
    .replace('"@/lib/localforage-storage"', JSON.stringify(storagePath))
    .replace('"@/lib/user-scope"', JSON.stringify(storagePath)));
const store: typeof import("../src/services/creation-conversation-store") = await import(join(dir, "conversations.ts"));
const storage = await import(storagePath);
beforeEach(() => { storage.data.clear(); storage.setScope("owner"); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("successful remote deletion removes only the original account's persisted history after account switching", async () => {
    const original = [{ id: "deleted", messages: [] }, { id: "keep", messages: [{ id: "result", role: "assistant" as const, resultStorageKeys: ["resource:keep"] }] }];
    const other = [{ id: "deleted", messages: [] }];
    await store.saveCreationConversations(original, "owner");
    await store.saveCreationConversations(other, "other");
    storage.data.set(`owner:${store.CREATION_AGENT_PENDING_KEY}:deleted`, "original pending");
    storage.data.set(`other:${store.CREATION_AGENT_PENDING_KEY}:deleted`, "other pending");
    storage.setScope("other");

    expect(typeof store.removeStoredCreationConversation).toBe("function");
    await store.removeStoredCreationConversation("deleted", "owner");

    expect(JSON.parse(storage.data.get(`owner:${store.CREATION_CONVERSATIONS_KEY}`))).toEqual([original[1]]);
    expect(await store.loadCreationConversations()).toEqual(other);
    expect(storage.data.has(`owner:${store.CREATION_AGENT_PENDING_KEY}:deleted`)).toBe(false);
    expect(storage.data.get(`other:${store.CREATION_AGENT_PENDING_KEY}:deleted`)).toBe("other pending");
});

test("repeated scoped cache cleanup is harmless and clears a pending-only draft", async () => {
    storage.data.set(`owner:${store.CREATION_AGENT_PENDING_KEY}:deleted`, "original pending");
    expect(typeof store.removeStoredCreationConversation).toBe("function");
    await store.removeStoredCreationConversation("deleted", "owner");
    await store.removeStoredCreationConversation("deleted", "owner");
    expect(storage.data.size).toBe(0);
});
