import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";

const space = process.env.TEST_WORKSPACE || "";
const dom = new Window({ url: `http://localhost${space ? `/teams/${space}` : ""}/create` });
Object.assign(globalThis, { window: dom, document: dom.document, CustomEvent: dom.CustomEvent });
const { getActiveUserScope, setActiveUserScope, scopedStorageKey } = await import("@/lib/user-scope");
const { createGenerationTask } = await import("@/services/api/task-center");
const { apiClient, http } = await import("@/services/api/request");
afterAll(() => dom.happyDOM.abort());

test("content stays in its workspace; charging confirmation and replay use the authenticated account", async () => {
    setActiveUserScope("member");
    const scope = space ? `member:team:${space}` : "member";
    expect(getActiveUserScope()).toBe(scope);
    expect(scopedStorageKey("canvas")).toBe(`canvas:user:${scope}`);
    const prefix = space ? `/teams/${space}/workspace` : "";
    const paths: string[] = [];
    const submitted: { idempotencyKey: string; maxChargeMicrocredits: number }[] = [];
    apiClient.defaults.adapter = async (config) => {
        expect(config.headers.get("X-Canvas-Expected-User")).toBe("member");
        const path = config.url!;
        paths.push(path);
        let data: unknown = [];
        if (path === `${prefix}/tasks/quote`) data = { maxChargeMicrocredits: 500 };
        if (path === `${prefix}/tasks`) {
            submitted.push(JSON.parse(String(config.data)));
            if (submitted.length === 1) throw Object.assign(new Error("No response"), { isAxiosError: true, code: "ERR_NETWORK" });
            data = { id: "same-task", type: "canvas_text", status: "queued" };
        }
        return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data } };
    };
    await http.get("/assets");
    expect(paths).toEqual([`${prefix}/assets`]);
    if (!space) return;
    await expect(http.post("/projects", {})).rejects.toThrow();
    const input = { type: "canvas_text", operation: "text", prompt: "第一幕", input: { mode: "text", metadata: { messageId: "message-a" } } };
    dom.confirm = () => false;
    await expect(createGenerationTask(input)).rejects.toMatchObject({ name: "AbortError" });
    expect(paths).toEqual([`${prefix}/assets`, `${prefix}/tasks/quote`]);
    dom.confirm = () => true;
    await expect(createGenerationTask(input)).rejects.toThrow();
    expect((await createGenerationTask(input)).id).toBe("same-task");
    expect(submitted.map((body) => [body.idempotencyKey, body.maxChargeMicrocredits])).toEqual([
        ["message-a", 500],
        ["message-a", 500],
    ]);
    expect(paths.filter((path) => !path.startsWith(`${prefix}/`))).toBeEmpty();
});
