import assert from "node:assert/strict";
import { test } from "bun:test";

function ambiguousChannels(store) {
    const shared = {
        name: "Shared",
        baseUrl: "http://127.0.0.1:8000",
        apiKey: "same-key",
        apiFormat: "openai",
        models: ["same-model"],
    };
    return [store.createModelChannel({ ...shared, id: "local-enabled", allowLocalChannel: true }), store.createModelChannel({ ...shared, id: "local-disabled", allowLocalChannel: false })];
}

test("task-center forwards explicit task/session provider config without inferring a channel from Zustand", async () => {
    const taskCenter = await import("../src/services/api/task-center");
    const generationTask = await import("../src/services/api/generation-task");
    const requestModule = await import("../src/services/api/request");
    const store = await import("../src/stores/use-config-store");
    const userStore = await import("../src/stores/use-user-store");
    const previousWindow = globalThis.window;
    const previousConfig = store.useConfigStore.getState().config;
    userStore.useUserStore.setState({ features: { ...userStore.defaultFeatureAvailability, desktopLocalChannelsEnabled: true } });
    const channels = ambiguousChannels(store);
    const explicitConfig = {
        ...store.defaultConfig,
        channels,
        models: ["local-enabled::same-model", "local-disabled::same-model"],
        model: "local-disabled::same-model",
        textModel: "local-disabled::same-model",
    };
    store.useConfigStore.setState({ config: explicitConfig });
    globalThis.window = { location: { hostname: "127.0.0.1" }, dispatchEvent() {} };
    assert.equal(generationTask.backendProviderConfig(explicitConfig).allowLocalChannel, false);
    assert.equal(generationTask.backendProviderConfig({ ...explicitConfig, model: "local-enabled::same-model" }).allowLocalChannel, true);

    const bodies = [];
    const originalPost = requestModule.apiClient.post;
    requestModule.apiClient.post = async (url, body) => {
        bodies.push({ url, body });
        if (url === "/sessions") {
            return { data: { code: 0, data: { session: { id: "session", status: "active", prompt: "p", createdAt: "now", updatedAt: "now" }, messages: [], tasks: [], results: [] }, msg: "ok" } };
        }
        return { data: { code: 0, data: { id: "task", type: "canvas_text", status: "queued", prompt: "p", attempts: 1, createdAt: "now", updatedAt: "now" }, msg: "ok" } };
    };
    try {
        const providerConfig = {
            baseUrl: "http://127.0.0.1:8000",
            apiKey: "same-key",
            apiFormat: "openai",
            model: "same-model",
            allowLocalChannel: false,
        };
        await taskCenter.createAgentSession({ prompt: "p", config: providerConfig });
        await taskCenter.createGenerationTask({
            prompt: "p",
            model: "same-model",
            input: { mode: "text", config: providerConfig },
        });
    } finally {
        requestModule.apiClient.post = originalPost;
        userStore.useUserStore.setState({ features: userStore.defaultFeatureAvailability });
        globalThis.window = previousWindow;
        store.useConfigStore.setState({ config: previousConfig });
    }

    assert.equal(bodies[0]?.url, "/sessions");
    assert.equal(bodies[0]?.body?.config?.allowLocalChannel, false);
    assert.equal(bodies[1]?.url, "/tasks");
    assert.equal(bodies[1]?.body?.input?.config?.allowLocalChannel, false);
});
