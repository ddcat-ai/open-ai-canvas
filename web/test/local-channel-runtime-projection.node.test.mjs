import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import os from "node:os";
import path from "node:path";
import axios from "axios";
import { createServer } from "vite";

const webRoot = process.cwd();
const originalWindow = globalThis.window;
const viteRuntime = createServer({
    root: webRoot,
    configFile: false,
    cacheDir: path.join(os.tmpdir(), `framefield-local-channel-runtime-${process.pid}`),
    resolve: { alias: { "@": path.join(webRoot, "src") } },
    define: { __APP_VERSION__: JSON.stringify("test"), __APP_CHANGELOG__: JSON.stringify("") },
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
});

const runtime = await viteRuntime;
const configStore = await runtime.ssrLoadModule("/src/stores/use-config-store.ts");
const userStore = await runtime.ssrLoadModule("/src/stores/use-user-store.ts");
const generationTask = await runtime.ssrLoadModule("/src/services/api/generation-task.ts");
const relay = await runtime.ssrLoadModule("/src/services/api/custom-channel-relay.ts");
const imageApi = await runtime.ssrLoadModule("/src/services/api/image.ts");
const originalAxiosPost = axios.post;

after(async () => {
    await runtime.close();
});

afterEach(() => {
    axios.post = originalAxiosPost;
    userStore.useUserStore.setState({ features: userStore.defaultFeatureAvailability });
    if (originalWindow === undefined) delete globalThis.window;
    else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
});

function setRuntime(desktopLocalChannelsEnabled, hostname) {
    userStore.useUserStore.setState({ features: { ...userStore.defaultFeatureAvailability, desktopLocalChannelsEnabled } });
    Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { hostname } } });
}

function forgedConfig() {
    const channel = configStore.createModelChannel({
        id: "local",
        name: "Local",
        baseUrl: "http://127.0.0.1:8000",
        apiKey: "test-key",
        apiFormat: "openai",
        models: ["local-model"],
        allowLocalChannel: true,
    });
    return configStore.normalizeConfigSnapshot({
        config: {
            ...configStore.defaultConfig,
            channels: [channel],
            model: "local::local-model",
            textModel: "local::local-model",
        },
    }).config;
}

function requestFlag(config) {
    const request = relay.channelRequest(config, "http://127.0.0.1:8000/v1/responses", { "Content-Type": "application/json" });
    return request.headers["x-canvas-allow-local-channel"];
}

test("actual generation request config reprojects forged persisted local permission at runtime", () => {
    const config = forgedConfig();
    assert.equal(config.channels[0]?.allowLocalChannel, true, "persisted channel intentionally remains true before runtime projection");

    setRuntime(false, "127.0.0.1");
    const capabilityClosed = generationTask.backendProviderConfig(config);
    assert.equal(capabilityClosed.allowLocalChannel, false);
    assert.equal(requestFlag(capabilityClosed), undefined);

    setRuntime(true, "canvas.example.com");
    const remotePage = generationTask.backendProviderConfig(config);
    assert.equal(remotePage.allowLocalChannel, false);
    assert.equal(requestFlag(remotePage), undefined);

    setRuntime(true, "localhost");
    const desktop = generationTask.backendProviderConfig(config);
    assert.equal(desktop.allowLocalChannel, true);
    assert.equal(requestFlag(desktop), "1");
});

test("authenticated model fetch reprojects forged persisted local permission before backend request", async () => {
    const bodies = [];
    axios.post = async (_url, body) => {
        bodies.push(body);
        return { data: { code: 0, data: { models: [{ id: "local-model" }] }, msg: "ok" } };
    };
    const channel = forgedConfig().channels[0];

    setRuntime(false, "127.0.0.1");
    await imageApi.fetchChannelModels(channel, true);
    assert.equal(bodies.at(-1)?.allowLocalChannel, false);

    setRuntime(true, "canvas.example.com");
    await imageApi.fetchChannelModels(channel, true);
    assert.equal(bodies.at(-1)?.allowLocalChannel, false);

    setRuntime(true, "localhost");
    await imageApi.fetchChannelModels(channel, true);
    assert.equal(bodies.at(-1)?.allowLocalChannel, true);
});

test("custom relay final boundary independently reprojects a directly forged local permission", () => {
    const forged = { baseUrl: "http://127.0.0.1:8000", apiKey: "test-key", apiFormat: "openai", allowLocalChannel: true };

    setRuntime(false, "127.0.0.1");
    assert.equal(requestFlag(forged), undefined);

    setRuntime(true, "canvas.example.com");
    assert.equal(requestFlag(forged), undefined);

    setRuntime(true, "127.0.0.1");
    assert.equal(requestFlag(forged), "1");
});
