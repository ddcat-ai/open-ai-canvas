const test = require("node:test");
const assert = require("node:assert/strict");
const { syncYingceSystemCatalogAtBoot, remoteProviderID, channelModelRequest, localEcommerceOrchestration } = require("../src/yingce-system-catalog");

function catalog() {
    return {
        source: "system",
        channels: [{
            id: "remote-channel",
            sortOrder: 7,
            models: [{
                id: "remote-model-row",
                modelKey: "remote-image",
                displayName: "Remote Image",
                capability: "image",
                protocol: "openai-image",
                available: true,
                capabilityConfig: { version: 1, capability: "image" },
                priceTiers: [{ billingMode: "fixed_request", unitPriceMicrocredits: 500, selector: {}, resolution: "*" }],
            }],
        }],
    };
}

test("Lite mirrors remote channel models locally using only its scoped relay credential", async () => {
    const requests = [];
    const channels = [];
    const models = new Map();
    const fetchImpl = async (url, options = {}) => {
        const path = new URL(url).pathname;
        const method = options.method || "GET";
        const body = options.body ? JSON.parse(options.body) : undefined;
        requests.push({ path, method, body, headers: options.headers });
        let data;
        if (path === "/api/admin/channels" && method === "GET") data = { channels, total: channels.length, page: 1, pageSize: 100 };
        else if (path === "/api/admin/channels" && method === "POST") {
            const channel = { ...body, id: "local-channel-1" };
            channels.push(channel);
            models.set(channel.id, []);
            data = { channel };
        } else if (path === "/api/admin/channels/local-channel-1" && method === "PATCH") {
            Object.assign(channels[0], body);
            data = { channel: channels[0] };
        } else if (path === "/api/admin/channels/local-channel-1/models" && method === "GET") data = { models: models.get("local-channel-1") };
        else if (path === "/api/admin/channels/local-channel-1/models" && method === "POST") {
            const model = { ...body, id: "local-model-1" };
            models.get("local-channel-1").push(model);
            data = { model };
        } else if (path === "/api/admin/channels/local-channel-1/models/local-model-1" && method === "PATCH") {
            Object.assign(models.get("local-channel-1")[0], body);
            data = { model: models.get("local-channel-1")[0] };
        } else throw new Error(`unexpected ${method} ${path}`);
        return new Response(JSON.stringify({ code: 0, data }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const input = {
        backendBaseUrl: "http://127.0.0.1:49001",
        localOrigin: "http://127.0.0.1:17831",
        localSession: "local-session",
        relayKey: "local-relay-capability-8a94d308e15f4a34",
        catalog: catalog(),
        fetchImpl,
    };

    const first = await syncYingceSystemCatalogAtBoot(input);
    assert.equal(first.channels.get("remote-channel"), "local-channel-1");
    assert.equal(first.models.get("remote-model-row"), "local-model-1");
    assert.equal(channels[0].catalogProviderId, "peekreel-lite:remote-channel");
    assert.equal(channels[0].baseUrl, "http://127.0.0.1:17831/api/ai/system/remote-channel");
    assert.equal(channels[0].apiKey, input.relayKey);
    assert.equal(channels[0].headers[0].value, input.relayKey);
    assert.equal(models.get("local-channel-1")[0].unitPriceMicrocredits, 500);
    assert.equal(requests.every((request) => request.headers.cookie === `open_ai_canvas_session=${input.localSession}`), true);
    assert.equal(JSON.stringify(requests).includes("remote-session"), false);

    requests.length = 0;
    await syncYingceSystemCatalogAtBoot(input);
    assert.ok(requests.some((request) => request.method === "PATCH" && request.path === "/api/admin/channels/local-channel-1"));
    assert.ok(requests.some((request) => request.method === "PATCH" && request.path.endsWith("/models/local-model-1")));
    assert.equal(channels.length, 1);
    assert.equal(models.get("local-channel-1").length, 1);
});

test("Lite catalog mirroring fails closed on malformed remote identities and keeps remote credentials out of local payloads", () => {
    assert.throws(() => remoteProviderID("../evil"), /渠道标识/);
    const model = channelModelRequest(catalog().channels[0].models[0]);
    assert.equal(model.providerModelKey, "remote-image");
    assert.equal(model.priceTiers[0].costPricing.configured, false);
    assert.equal(JSON.stringify(model).includes("session"), false);
});

test("remote ecommerce settings map to read-only local mirrored channel models", () => {
    const channels = new Map([["remote-channel", "local-channel"]]);
    const models = new Map([["remote-model-row", "local-model"], ["remote-channel:remote-image", "local-model"]]);
    const setting = {
        version: 1,
        enabled: false,
        vision: { model: { channelModelId: "remote-model-row" }, fallback: {} },
        marketing: { model: { channelId: "remote-channel", modelKey: "remote-image" }, fallback: {} },
        director: { model: {}, fallback: {}, reuse: "marketing" },
    };
    assert.deepEqual(localEcommerceOrchestration(setting, channels, models), {
        version: 1,
        enabled: false,
        vision: { model: { channelModelId: "local-model" }, fallback: {} },
        marketing: { model: { channelModelId: "local-model" }, fallback: {} },
        director: { model: {}, fallback: {}, reuse: "marketing" },
    });
    assert.throws(() => localEcommerceOrchestration({ logicalModelId: "remote-logical" }, channels, models), /逻辑模型/);
});
