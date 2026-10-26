import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import axios from "axios";
import localforage from "localforage";
import { useUserStore } from "../src/stores/use-user-store";
import * as userScope from "../src/lib/user-scope";
import * as imageStorage from "../src/services/image-storage";
import { channelRequest } from "../src/services/api/custom-channel-relay";
import { fetchChannelModels } from "../src/services/api/image-models";
import { createModelChannel, defaultConfig, encodeChannelModel, resolveModelRequestConfig, useConfigStore } from "../src/stores/use-config-store";
import { listBrowserGenerations, readBrowserGeneration, writeBrowserGeneration } from "../src/services/browser-generation-store";
import { queryBrowserGeneration, submitBrowserGeneration } from "../src/services/browser-generation-runner";
import { listGenerationTasks } from "../src/services/api/task-center";
import { backendProviderConfig, prepareBackendGenerationTask } from "../src/services/api/generation-task";

const originalFetch = globalThis.fetch;
const originalUser = useUserStore.getState();
const originalConfig = useConfigStore.getState().config;
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
let records = new Map<string, unknown>();
let restores: Array<{ mockRestore(): void }> = [];
const channel = createModelChannel({ id: "personal", scope: "user", apiFormat: "openai", baseUrl: "https://personal.example/v1", apiKey: "synthetic-private-key", models: ["shared"], interfaceType: "chat-completion" });
const config = { ...defaultConfig, channels: [channel], model: encodeChannelModel(channel.id, "shared") };

beforeEach(() => {
    records = new Map();
    restores = [
        spyOn(localforage, "getItem").mockImplementation(async (key) => structuredClone(records.get(key) ?? null)),
        spyOn(localforage, "setItem").mockImplementation(async (key, value) => { records.set(key, structuredClone(value)); return value; }),
        spyOn(localforage, "iterate").mockImplementation(async (callback) => { for (const [key, value] of records) callback(structuredClone(value), key, 0); }),
    ];
    const held = new Set<string>();
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: {
        request: async (name: string, run: () => unknown) => { held.add(name); try { return await run(); } finally { held.delete(name); } },
        query: async () => ({ held: [...held].map((name) => ({ name })), pending: [] }),
    } } });
    useUserStore.setState({ user: null, hydrated: true });
    useConfigStore.setState({ config });
});
afterEach(() => {
    for (const restore of [...restores].reverse()) restore.mockRestore();
    useUserStore.setState(originalUser);
    useConfigStore.setState({ config: originalConfig });
    globalThis.fetch = originalFetch;
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator); else Reflect.deleteProperty(globalThis, "navigator");
});

async function settled(id: string) {
    for (let attempt = 0; attempt < 50; attempt++) {
        const { task } = await readBrowserGeneration(id);
        if (task.status === "succeeded" || task.status === "failed") return task;
        await new Promise((resolve) => setTimeout(resolve, 1));
    }
    throw new Error("Browser execution did not settle");
}

test("personal transport omits session credentials and proxy headers; system transport keeps its route", () => {
    const personal = resolveModelRequestConfig(config, config.model);
    const request = channelRequest(personal, "https://personal.example/v1/chat/completions", { "X-Canvas-Scene": "text", Cookie: "session=private" });
    expect(request.url).toBe("https://personal.example/v1/chat/completions");
    expect(request.credentials).toBe("omit");
    expect(request.headers.authorization).toBe("Bearer synthetic-private-key");
    expect(request.headers).not.toHaveProperty("x-canvas-scene");
    expect(request.headers).not.toHaveProperty("cookie");
    const system = channelRequest({ ...personal, channelScope: "system" }, request.url);
    expect(system.url).toEndWith("/ai/custom");
    expect(system.credentials).toBe("include");
    expect(() => channelRequest(personal, "https://other.example/v1/chat/completions")).toThrow("超出");
    expect(() => channelRequest({ ...personal, headers: [{ name: "Authorization", value: "override" }] }, request.url)).toThrow("系统管理");
    expect(() => channelRequest({ ...personal, baseUrl: "https://name:pass@personal.example/v1" }, request.url)).toThrow("userinfo");
    expect(() => channelRequest({ ...personal, interfaceType: "gemini-image" }, request.url)).toThrow("仅支持");
});

test("channel identity cannot drift to a different channel offering the same model", async () => {
    const other = createModelChannel({ ...channel, id: "other" });
    expect(() => resolveModelRequestConfig({ ...config, channels: [other] }, config.model)).toThrow("原模型渠道");
    expect(() => resolveModelRequestConfig({ ...config, channels: [channel, other] }, "shared")).toThrow("同名模型");
    expect(resolveModelRequestConfig({ ...config, channels: [channel, other] }, config.model).requestChannelId).toBe("personal");
    expect(() => backendProviderConfig(config, "text")).toThrow("密钥");
    await expect(prepareBackendGenerationTask({ config, mode: "text", prompt: "Hello" })).rejects.toThrow("浏览器执行");
});

test("even a caller requesting backend model discovery cannot upload personal credentials", async () => {
    let seen = "";
    restores.push(spyOn(axios, "request").mockImplementation(async (request) => { seen = request.url || ""; expect(request.withCredentials).toBe(false); return { data: { data: [{ id: "shared" }] } } as never; }));
    expect((await fetchChannelModels(channel, true)).models).toEqual(["shared"]);
    expect(seen).toBe("https://personal.example/v1/models");
});

test("text is submitted once after a durable record and replay only reads local state", async () => {
    let posts = 0;
    globalThis.fetch = (async (url, options) => {
        posts++;
        expect(String(url)).toBe("https://personal.example/v1/chat/completions");
        expect(options?.credentials).toBe("omit");
        expect((await listBrowserGenerations()).length).toBe(1);
        return new Response('data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n', { headers: { "Content-Type": "text/event-stream" } });
    }) as typeof fetch;
    const request = { config, mode: "text" as const, prompt: "Hello", clientOperationId: "once" };
    const first = await submitBrowserGeneration(request);
    expect((await settled(first.id)).status).toBe("succeeded");
    expect((await submitBrowserGeneration(request)).id).toBe(first.id);
    expect((await queryBrowserGeneration(first.id)).resultJson).toContain("OK");
    expect(posts).toBe(1);
    expect(JSON.stringify([...records.values()])).not.toContain("synthetic-private-key");
});

test("an uncertain submission never silently retries or falls back to server", async () => {
    let posts = 0;
    globalThis.fetch = (async () => { posts++; throw new TypeError("Failed to fetch"); }) as typeof fetch;
    const request = { config, mode: "text" as const, prompt: "Hello", clientOperationId: "unknown" };
    const task = await submitBrowserGeneration(request);
    expect((await settled(task.id)).stage).toBe("submission_unknown");
    await queryBrowserGeneration(task.id);
    await submitBrowserGeneration(request);
    expect(posts).toBe(1);
});

test("storage failure blocks provider submission", async () => {
    let posts = 0;
    globalThis.fetch = (async () => { posts++; return new Response(); }) as typeof fetch;
    restores.push(spyOn(localforage, "setItem").mockRejectedValueOnce(new Error("Quota exceeded")));
    await expect(submitBrowserGeneration({ config, mode: "text", prompt: "Hello" })).rejects.toThrow("Quota exceeded");
    expect(posts).toBe(0);
});

test("local task enumeration is scoped; refreshing a video reads its original handle with GET only", async () => {
    const task = { id: "browser:video", model: "shared", status: "failed" as const, type: "canvas_video", createdAt: "now", updatedAt: "now" };
    const videoChannel = { ...channel, interfaceType: "newapi" };
    useConfigStore.setState({ config: { ...config, channels: [videoChannel] } });
    const record = { task, channelId: channel.id, baseUrl: channel.baseUrl, protocol: "newapi", video: { id: "upstream-123", provider: "openai" as const, model: config.model } };
    await writeBrowserGeneration(record);
    records.set(userScope.scopedStorageKey("yingce:browser-generation:browser:other", "another-user"), { ...record, task: { ...task, id: "browser:other" } });
    expect((await listBrowserGenerations()).map((item) => item.id)).toEqual([task.id]);
    let gets = 0;
    restores.push(spyOn(axios, "request").mockImplementation(async (request) => { gets++; expect(request.method).toBe("get"); expect(request.url).toBe("https://personal.example/v1/videos/upstream-123"); return { data: { id: "upstream-123", status: "in_progress" } } as never; }));
    expect((await queryBrowserGeneration(task.id)).status).toBe("running");
    expect(gets).toBe(1);
});

test("image receipt survives download failure; recovery never resubmits generation", async () => {
    const blobs = new Map<string, Blob>();
    restores.push(spyOn(imageStorage, "setImageBlob").mockImplementation(async (key, blob) => { blobs.set(key, blob); return "blob:mock"; }));
    restores.push(spyOn(imageStorage, "getImageBlob").mockImplementation(async (key) => blobs.get(key) || null));
    const imageConfig = { ...config, channels: [{ ...channel, interfaceType: "openai-image" }] };
    useConfigStore.setState({ config: imageConfig });
    let posts = 0;
    restores.push(spyOn(axios, "request").mockImplementation(async (request) => {
        posts++;
        expect(request.method).toBe("post");
        expect(request.url).toBe("https://personal.example/v1/images/generations");
        return { data: { data: [{ url: "https://media.example/generated.png" }] } } as never;
    }));
    globalThis.fetch = (async () => { throw new TypeError("download interrupted"); }) as typeof fetch;
    const task = await submitBrowserGeneration({ config: imageConfig, mode: "image", prompt: "A tree", clientOperationId: "image-receipt" });
    expect((await settled(task.id)).canRecoverMedia).toBe(true);
    expect((await readBrowserGeneration(task.id)).pendingMedia?.sources).toEqual(["https://media.example/generated.png"]);
    globalThis.fetch = (async (url, options) => {
        expect(String(url)).toBe("https://media.example/generated.png");
        expect(options?.credentials).toBe("omit");
        return new Response(new Blob(["synthetic image bytes"], { type: "image/png" }));
    }) as typeof fetch;
    const recovered = await queryBrowserGeneration(task.id);
    expect(recovered.status).toBe("succeeded");
    expect(recovered.resultJson).toContain("image:guest:browser:image-receipt:0");
    expect((await readBrowserGeneration(task.id)).pendingMedia).toBeUndefined();
    expect(posts).toBe(1);
});

test("text image references are included inline without forwarding private resource URLs", async () => {
    let content: unknown;
    globalThis.fetch = (async (_url, options) => {
        content = JSON.parse(String(options?.body)).messages.at(-1).content;
        return new Response('data: {"choices":[{"delta":{"content":"A tree"}}]}\n\ndata: [DONE]\n\n', { headers: { "Content-Type": "text/event-stream" } });
    }) as typeof fetch;
    const dataUrl = "data:image/png;base64,c3ludGhldGlj";
    const task = await submitBrowserGeneration({ config, mode: "text", prompt: "Describe", referenceImages: [{ dataUrl }], clientOperationId: "text-image" });
    expect((await settled(task.id)).status).toBe("succeeded");
    expect(content).toEqual([{ type: "text", text: "Describe" }, { type: "image_url", image_url: { url: dataUrl } }]);
});

test("missing cross-tab mutual exclusion prevents any submission", async () => {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
    let posts = 0;
    globalThis.fetch = (async () => { posts++; return new Response(); }) as typeof fetch;
    await expect(submitBrowserGeneration({ config, mode: "text", prompt: "Hello" })).rejects.toThrow("跨标签");
    expect(posts).toBe(0);
});


test("a different tab changing the shared account cannot receive this tab's private task", async () => {
    useUserStore.setState({ user: { id: "account-A", username: "A", displayName: "A", role: "user", status: "active" }, hydrated: true });
    restores.push(spyOn(userScope, "getActiveUserScope").mockReturnValue("account-B"));
    let posts = 0;
    globalThis.fetch = (async () => { posts++; return new Response(); }) as typeof fetch;
    await expect(submitBrowserGeneration({ config, mode: "text", prompt: "account-A private prompt" })).rejects.toThrow("账号状态");
    await expect(listBrowserGenerations()).rejects.toThrow("账号状态");
    await expect(queryBrowserGeneration("browser:existing")).rejects.toThrow("账号状态");
    await expect(listGenerationTasks(30, undefined, { listBackend: async () => [] })).rejects.toThrow("账号状态");
    expect(posts).toBe(0);
    expect(records.size).toBe(0);
});

test("a completed task read cannot return private output after the account changes while IndexedDB is pending", async () => {
    let sharedScope = "guest";
    restores.push(spyOn(userScope, "getActiveUserScope").mockImplementation(() => sharedScope));
    let release!: (value: unknown) => void;
    restores.push(spyOn(localforage, "getItem").mockImplementationOnce(() => new Promise((resolve) => { release = resolve; })));
    const reading = queryBrowserGeneration("browser:delayed");
    useUserStore.setState({ user: { id: "account-B", username: "B", displayName: "B", role: "user", status: "active" } });
    sharedScope = "account-B";
    release({ task: { id: "browser:delayed", status: "succeeded", prompt: "private prompt", resultJson: "private output" } });
    await expect(reading).rejects.toThrow("账号状态");
});

test("a delayed cross-tab lock query cannot return the previous account's running task", async () => {
    let sharedScope = "account-A";
    restores.push(spyOn(userScope, "getActiveUserScope").mockImplementation(() => sharedScope));
    useUserStore.setState({ user: { id: "account-A", username: "A", displayName: "A", role: "user", status: "active" } });
    const task = { id: "browser:locked", prompt: "account-A private prompt", model: "shared", status: "running" as const, type: "canvas_text", createdAt: "now", updatedAt: "now" };
    await writeBrowserGeneration({ task, channelId: channel.id, baseUrl: channel.baseUrl, protocol: "chat-completion" });
    let release!: (value: { held: Array<{ name: string }> }) => void;
    let queried!: () => void;
    const started = new Promise<void>((resolve) => { queried = resolve; });
    restores.push(spyOn(navigator.locks, "query").mockImplementation(() => { queried(); return new Promise((resolve) => { release = resolve; }); }));
    let requests = 0;
    globalThis.fetch = (async () => { requests++; throw new Error("No network allowed"); }) as typeof fetch;
    const reading = queryBrowserGeneration(task.id);
    await started;
    useUserStore.setState({ user: { id: "account-B", username: "B", displayName: "B", role: "user", status: "active" } });
    sharedScope = "account-B";
    release({ held: [{ name: userScope.scopedStorageKey("yingce:browser-generation:" + task.id, "account-A") }] });
    await expect(reading).rejects.toThrow("账号状态");
    expect(requests).toBe(0);
});

test("unloaded sessions and stale channel credentials block submission before persistence", async () => {
    let posts = 0;
    globalThis.fetch = (async () => { posts++; return new Response(); }) as typeof fetch;
    useUserStore.setState({ hydrated: false });
    await expect(submitBrowserGeneration({ config, mode: "text", prompt: "Hello" })).rejects.toThrow("账号状态");
    useUserStore.setState({ hydrated: true });
    useConfigStore.setState({ config: { ...config, channels: [{ ...channel, apiKey: "different-session-key" }] } });
    await expect(submitBrowserGeneration({ config, mode: "text", prompt: "Hello" })).rejects.toThrow("配置已变更");
    expect(posts).toBe(0);
    expect(records.size).toBe(0);
});
