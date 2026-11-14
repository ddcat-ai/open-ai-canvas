import { expect, test } from "bun:test";
import { loadSystemChannels } from "../src/lib/user-session";
import type { ModelCatalogResponse, PublicChannelModel } from "../src/services/api/logical-models";
import { defaultConfig, normalizeConfigSnapshot } from "../src/stores/use-config-store";
import { requestYingceCatalog, resolveYingceSystemModel } from "../src/services/api/yingce-lite-ipc";

const model: PublicChannelModel = { id: "model", modelKey: "model", displayName: "Model", capability: "text", protocol: "openai", textWire: "chat-completion", available: true, priceTiers: [], pricingMode: "fixed", displayPrice: 0, priceLabel: "" };
const catalog = (id: string): ModelCatalogResponse => ({ source: "system", channels: [{ id, name: id, displayName: id, models: [model] }] });
const mirrorCatalog = (remoteId: string, localId: string): ModelCatalogResponse => ({ source: "system", channels: [{ id: localId, remoteChannelId: remoteId, name: localId, displayName: localId, models: [model] }] });

test("Lite maps the remote model directory onto its local mirrored channel ID", async () => {
    const channels = await loadSystemChannels([], { lite: true, local: async () => ({ source: "system", channels: [...catalog("same").channels, ...mirrorCatalog("same", "local-mirror").channels] }), remote: async () => catalog("same") });
    expect(channels.map((channel) => [channel.id, channel.yingceChannelId])).toEqual([
        ["same", undefined],
        ["local-mirror", "same"],
    ]);
    expect(channels[1].baseUrl).toBe("/api/ai/system/same");
    const config = normalizeConfigSnapshot({ config: { ...defaultConfig, channels, model: "local-mirror::model" } }).config;
    expect(resolveYingceSystemModel(config, "text").channelId).toBe("same");
    expect(() => resolveYingceSystemModel({ ...config, model: "same::model" }, "text")).toThrow();
});

test("a failed remote refresh keeps local channels and hides upstream channels while offline", async () => {
    const previous = await loadSystemChannels([], { lite: true, local: async () => ({ source: "system", channels: [...catalog("local").channels, ...mirrorCatalog("remote", "local-remote").channels] }), remote: async () => catalog("remote") });
    const channels = await loadSystemChannels(previous, {
        lite: true,
        local: async () => catalog("new-local"),
        remote: async () => {
            throw new Error("offline");
        },
    });
    expect(channels.map((channel) => channel.id)).toEqual(["new-local"]);
});

test("Lite accepts the contracted channel catalog without optional source and availability fields", async () => {
    const data = {
        channels: [
            {
                id: "remote",
                models: [
                    { modelKey: "visible", capability: "text", protocol: "openai", textWire: "chat-completion" },
                    { modelKey: "disabled", capability: "text", protocol: "openai", textWire: "chat-completion", available: false },
                ],
            },
        ],
    };
    const remote = await requestYingceCatalog({ request: async () => ({ ok: true, data }), getScope: () => "account" });
    const channels = await loadSystemChannels([], { lite: true, local: async () => mirrorCatalog("remote", "local-remote"), remote: async () => remote });
    const channel = channels.find((item) => item.yingceChannelId === "remote")!;
    expect(channel.id).toBe("local-remote");
    expect(channel.models).toEqual(["visible"]);
    const config = normalizeConfigSnapshot({ config: { ...defaultConfig, channels, model: "local-remote::visible" } }).config;
    expect(resolveYingceSystemModel(config, "text").model.textWire).toBe("chat-completion");
});

test("Lite rejects a catalog with an invalid availability or explicit non-system source", async () => {
    const request = (data: unknown) => requestYingceCatalog({ request: async () => ({ ok: true, data }), getScope: () => "account" });
    await expect(request({ source: "custom", channels: [] })).rejects.toThrow("影策模型目录响应无效");
    await expect(request({ channels: [{ id: "x", models: [{ modelKey: "x", capability: "text", available: "yes" }] }] })).rejects.toThrow("影策模型目录响应无效");
});
