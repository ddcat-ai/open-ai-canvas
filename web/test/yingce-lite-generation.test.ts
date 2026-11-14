import { describe, expect, test } from "bun:test";
import { runYingceAudioGeneration, runYingceImageGeneration, runYingceTextGeneration } from "../src/services/api/yingce-lite-generation";
import { YingceLiteError } from "../src/services/api/yingce-lite-ipc";
import { defaultConfig, type ModelChannel } from "../src/stores/use-config-store";

const channel: ModelChannel = {
    id: "selected",
    name: "selected",
    baseUrl: "/api",
    apiKey: "system",
    apiFormat: "openai",
    scope: "system",
    yingceChannelId: "selected",
    models: ["model"],
    modelCosts: [{ model: "model", capability: "text", textWire: "chat-completion", billingMode: "fixed_request", unitPriceMicrocredits: 0, available: true }],
};
const config = { ...defaultConfig, channels: [channel], model: "selected::model" };
const options = { config, prompt: "hello", messages: [{ role: "user" as const, content: "hello" }], metadata: { nodeId: "node-a" } };

describe("Lite image generation", () => {
    const imageConfig = { ...config, channels: [{ ...channel, modelCosts: [{ model: "model", capability: "image" as const, protocol: "openai-image", billingMode: "fixed_request" as const, unitPriceMicrocredits: 0, available: true }] }] };
    test("uses the selected protocol and saves images under the original account", async () => {
        let scope = "alice";
        const saved = new Map<string, Blob>();
        let receipt = "";
        await expect(
            runYingceImageGeneration(
                { config: imageConfig, prompt: "hello", metadata: { nodeId: "a", sourceNodeId: "source", domainProjectId: "domain", edit: "mask", layerDecomposition: true, ignored: "secret" } },
                {
                    scope: () => scope,
                    createId: () => "id",
                    request: async (input, opts) => {
                        expect(input).toMatchObject({ channelId: "selected", capability: "image", providerPath: "/images/generations", body: { model: "model", prompt: "hello" } });
                        expect(input.recovery).toMatchObject({ nodeId: "a", sourceNodeId: "source", domainProjectId: "domain", edit: "mask", layerDecomposition: true });
                        expect(input.recovery).not.toHaveProperty("ignored");
                        expect(opts?.retainForOriginalScope).toBe(true);
                        scope = "bob";
                        return { data: [{ b64_json: "AQID" }] };
                    },
                    fetch: async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } }),
                    lock: async (_scope, operation) => operation(),
                    write: async (key, blob) => {
                        saved.set(key, blob);
                        return "";
                    },
                    read: async (key) => saved.get(key) || null,
                    save: async (task, owner) => {
                        expect(owner).toBe("alice");
                        receipt = task.resultJson!;
                    },
                },
            ),
        ).rejects.toThrow("账号已切换");
        const result = JSON.parse(receipt);
        expect(result.images[0]).toMatchObject({ dataUrl: "", bytes: 3, mimeType: "image/png" });
        expect(result.images[0].storageKey).toContain(":alice:");
        expect(receipt).not.toContain("AQID");
    });

    test("rejects unknown protocols before sending and preserves conflict without retry", async () => {
        let calls = 0;
        const dependencies = {
            scope: () => "alice",
            createId: () => "id",
            request: async () => {
                calls++;
                throw new YingceLiteError("冲突", { status: 409 });
            },
            fetch: globalThis.fetch,
            lock: async <T>(_scope: string, operation: () => Promise<T>) => operation(),
            write: async () => "",
            read: async () => null,
            save: async () => {},
        };
        const unsupported = { ...imageConfig, channels: [{ ...imageConfig.channels[0], modelCosts: [{ ...imageConfig.channels[0].modelCosts[0], protocol: "unknown" }] }] };
        await expect(runYingceImageGeneration({ config: unsupported, prompt: "hello" }, dependencies)).rejects.toThrow("协议");
        expect(calls).toBe(0);
        await expect(runYingceImageGeneration({ config: imageConfig, prompt: "hello" }, dependencies)).rejects.toMatchObject({ status: 409 });
        expect(calls).toBe(1);
    });

    test("selects the image protocol when the same model key also has a text entry", async () => {
        const geminiConfig = {
            ...config,
            channels: [{ ...channel, modelCosts: [channel.modelCosts![0], { ...imageConfig.channels[0].modelCosts[0], protocol: "gemini-image" as const }] }],
        };
        let stored: Blob | null = null;
        const result = await runYingceImageGeneration(
            { config: geminiConfig, prompt: "hello", metadata: { source: "workbench", workbench: { kind: "image", batch: { id: "batch-a", index: 1, count: 2 } } } },
            {
                scope: () => "alice",
                createId: () => "id",
                request: async (input) => {
                    expect(input).toMatchObject({ channelId: "selected", providerPath: "/models/model:generateContent", capability: "image" });
                    return { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "AQID" } }] } }] };
                },
                fetch: async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } }),
                lock: async (_scope, operation) => operation(),
                write: async (_key, blob) => {
                    stored = blob;
                    return "";
                },
                read: async () => stored,
                save: async (task) => {
                    expect(task.clientContext).toEqual({ batchId: "batch-a", batchIndex: 1, batchCount: 2 });
                },
            },
        );
        expect(JSON.parse(result.task.resultJson!).images).toHaveLength(1);
        expect(result.task.clientContext).toEqual({ batchId: "batch-a", batchIndex: 1, batchCount: 2 });
    });

    test("does not save a receipt if the generated image cannot be downloaded or persisted", async () => {
        let saves = 0;
        let writes = 0;
        const dependencies = {
            scope: () => "alice",
            createId: () => "id",
            request: async () => ({ data: [{ url: "https://example.test/image.png" }] }),
            fetch: async () => new Response(null, { status: 503 }),
            lock: async <T>(_scope: string, operation: () => Promise<T>) => operation(),
            write: async () => {
                writes++;
                return "";
            },
            read: async () => null,
            save: async () => {
                saves++;
            },
        };
        await expect(runYingceImageGeneration({ config: imageConfig, prompt: "hello" }, dependencies)).rejects.toThrow("下载失败");
        expect(writes).toBe(0);
        await expect(
            runYingceImageGeneration(
                { config: imageConfig, prompt: "hello" },
                {
                    ...dependencies,
                    fetch: async () => new Response(new Uint8Array([1]), { headers: { "content-type": "image/png" } }),
                },
            ),
        ).rejects.toThrow("本地保存失败");
        expect(writes).toBe(1);
        expect(saves).toBe(0);
    });
});

describe("Lite text generation", () => {
    test("waits for intent persistence and refuses dispatch after failure, cancellation or account change", async () => {
        let calls = 0;
        let scope = "alice";
        const controller = new AbortController();
        const dependencies = {
            scope: () => scope,
            createId: () => "intent",
            request: async () => {
                calls++;
                return {};
            },
            save: async () => {},
        };
        await expect(
            runYingceTextGeneration(
                {
                    ...options,
                    onIntentPrepared: async (id) => {
                        expect(id).toBe("yingce-local:intent");
                        throw new Error("保存失败");
                    },
                },
                dependencies,
            ),
        ).rejects.toThrow("保存失败");
        await expect(
            runYingceTextGeneration(
                {
                    ...options,
                    signal: controller.signal,
                    onIntentPrepared: async () => {
                        controller.abort();
                    },
                },
                dependencies,
            ),
        ).rejects.toMatchObject({ name: "AbortError" });
        await expect(
            runYingceTextGeneration(
                {
                    ...options,
                    onIntentPrepared: async () => {
                        scope = "bob";
                    },
                },
                dependencies,
            ),
        ).rejects.toThrow("账号已切换");
        expect(calls).toBe(0);
    });
    test("does not dispatch prepared images after the account changes", async () => {
        let calls = 0;
        await expect(
            runYingceTextGeneration(
                { ...options, expectedScope: "alice" },
                {
                    scope: () => "bob",
                    createId: () => "id",
                    request: async () => {
                        calls++;
                        return {};
                    },
                    save: async () => {},
                },
            ),
        ).rejects.toThrow("账号已切换");
        expect(calls).toBe(0);
    });

    test("saves the selected model result before exposing the task", async () => {
        const events: string[] = [];
        const result = await runYingceTextGeneration(options, {
            scope: () => "alice",
            createId: () => "id",
            request: async (input, requestOptions) => {
                events.push("request");
                expect(input).toMatchObject({ channelId: "selected", providerPath: "/chat/completions", body: { model: "model" } });
                expect(requestOptions?.retainForOriginalScope).toBe(true);
                return { choices: [{ message: { content: "result" } }] };
            },
            save: async (task, scope) => {
                events.push("save");
                expect(scope).toBe("alice");
                expect(task.inputJson).toContain("node-a");
            },
        });
        expect(events).toEqual(["request", "save"]);
        expect(result.result.content).toBe("result");
    });

    test("persists for the original account after cancellation or account switch", async () => {
        let scope = "alice";
        const controller = new AbortController();
        let savedScope = "";
        await expect(
            runYingceTextGeneration(
                { ...options, signal: controller.signal },
                {
                    scope: () => scope,
                    createId: () => "id",
                    request: async () => {
                        scope = "bob";
                        controller.abort();
                        return { choices: [{ message: { content: "result" } }] };
                    },
                    save: async (_task, owner) => {
                        savedScope = owner;
                    },
                },
            ),
        ).rejects.toThrow("账号已切换");
        expect(savedScope).toBe("alice");
    });

    test("does not save an unsuccessful request or retry it", async () => {
        let calls = 0;
        let saves = 0;
        await expect(
            runYingceTextGeneration(options, {
                scope: () => "alice",
                createId: () => "id",
                request: async () => {
                    calls++;
                    throw new Error("409");
                },
                save: async () => {
                    saves++;
                },
            }),
        ).rejects.toThrow("409");
        expect(calls).toBe(1);
        expect(saves).toBe(0);
    });
});

describe("Lite speech generation", () => {
    const audioConfig = { ...config, channels: [{ ...channel, modelCosts: [{ model: "model", capability: "audio" as const, protocol: "openai-audio", billingMode: "fixed_request" as const, unitPriceMicrocredits: 0, available: true }] }] };
    test("stores audio and its receipt under the original account before delivery", async () => {
        const events: string[] = [];
        let stored: Blob | null = null;
        const result = await runYingceAudioGeneration(
            { config: audioConfig, prompt: "hello" },
            {
                scope: () => "alice",
                createId: () => "id",
                request: async (input, opts) => {
                    events.push("request");
                    expect(input).toMatchObject({ channelId: "selected", capability: "audio", providerPath: "/audio/speech", body: { model: "model", input: "hello", voice: "alloy", response_format: "mp3", speed: 1 } });
                    expect(opts?.retainForOriginalScope).toBe(true);
                    return { contentType: "audio/mpeg", bytes: new Uint8Array([1, 2, 3]) };
                },
                lock: async (_scope, operation) => operation(),
                write: async (key, blob) => {
                    events.push("write");
                    expect(key).toContain(":alice:");
                    stored = blob;
                    return "blob:test";
                },
                read: async () => {
                    events.push("read");
                    return stored;
                },
                save: async (task, scope) => {
                    events.push("save");
                    expect(scope).toBe("alice");
                    expect(JSON.parse(task.resultJson!).audio.storageKey).toContain(":alice:");
                },
            },
        );
        expect(events).toEqual(["request", "write", "read", "save"]);
        expect(JSON.parse(result.task.resultJson!).audio).toMatchObject({ dataUrl: "", bytes: 3, mimeType: "audio/mpeg" });
    });

    test("rejects unsupported protocols before dispatch and never retries a failed request", async () => {
        let calls = 0;
        const dependencies = {
            scope: () => "alice",
            createId: () => "id",
            request: async () => {
                calls++;
                throw new Error("409");
            },
            lock: async <T>(_scope: string, operation: () => Promise<T>) => operation(),
            write: async () => "",
            read: async () => null,
            save: async () => {},
        };
        const unsupported = { ...audioConfig, channels: [{ ...audioConfig.channels[0], modelCosts: [{ ...audioConfig.channels[0].modelCosts[0], protocol: "async-audio" }] }] };
        await expect(runYingceAudioGeneration({ config: unsupported, prompt: "hello" }, dependencies)).rejects.toThrow("协议");
        expect(calls).toBe(0);
        await expect(runYingceAudioGeneration({ config: audioConfig, prompt: "hello" }, dependencies)).rejects.toThrow("409");
        expect(calls).toBe(1);
    });
    test("saves for the original account after cancellation and account change", async () => {
        let scope = "alice";
        let stored: Blob | null = null;
        let saved = "";
        const controller = new AbortController();
        await expect(
            runYingceAudioGeneration(
                { config: audioConfig, prompt: "hello", signal: controller.signal },
                {
                    scope: () => scope,
                    createId: () => "id",
                    request: async () => {
                        scope = "bob";
                        controller.abort();
                        return { contentType: "audio/mpeg", bytes: new Uint8Array([1]) };
                    },
                    lock: async (_scope, operation) => operation(),
                    write: async (_key, blob) => {
                        stored = blob;
                        return "";
                    },
                    read: async () => stored,
                    save: async (_task, owner) => {
                        saved = owner;
                    },
                },
            ),
        ).rejects.toThrow("账号已切换");
        expect(saved).toBe("alice");
    });
});
