import { expect, test } from "bun:test";

import { confirmSubscriptionCall } from "../src/services/local-subscription-cli";
import { effectiveConfigWithSubscriptionCli, resolveLocalSubscriptionModel, type AiConfig } from "../src/stores/use-config-store";

const models = [
    { provider: "chatgpt" as const, id: "gpt-5.5", displayName: "Codex 订阅文本", modality: "text" as const, adapterSupported: true as const, currentlyObservedAvailable: "yes" as const, source: "cli-proxy-api-models" as const },
    { provider: "chatgpt" as const, id: "gpt-image-2", displayName: "GPT Image 2", modality: "image" as const, adapterSupported: true as const, currentlyObservedAvailable: "yes" as const, source: "cli-proxy-api-models" as const },
    { provider: "antigravity" as const, id: "gemini-3.1-flash-lite", displayName: "Antigravity 文本", modality: "text" as const, adapterSupported: true as const, currentlyObservedAvailable: "yes" as const, source: "cli-proxy-api-models" as const },
    { provider: "antigravity" as const, id: "gemini-3.1-flash-image", displayName: "Nano Banana 2", modality: "image" as const, adapterSupported: true as const, currentlyObservedAvailable: "yes" as const, source: "cli-proxy-api-models" as const },
];

test("subscription catalog projects two local personal channels without API keys", async () => {
    const { defaultConfig } = await import("../src/stores/use-config-store");
    const config = effectiveConfigWithSubscriptionCli(defaultConfig, "ready", models);
    const channels = config.channels.filter((channel) => channel.id.startsWith("local:subscription:"));
    expect(channels.map((channel) => channel.name)).toEqual(["ChatGPT/Codex 订阅", "Google Antigravity 订阅"]);
    expect(channels.every((channel) => channel.transport === "local-runtime" && channel.apiKey === "")).toBe(true);
    expect(config.textModels).toContain("local:subscription:chatgpt::gpt-5.5");
    expect(config.imageModels).toContain("local:subscription:chatgpt::gpt-image-2");
    expect(config.textModels).toContain("local:subscription:antigravity::gemini-3.1-flash-lite");
    expect(config.imageModels).toContain("local:subscription:antigravity::gemini-3.1-flash-image");
    expect(resolveLocalSubscriptionModel({ ...config, model: "local:subscription:chatgpt::gpt-image-2" } as AiConfig)).toEqual({ provider: "chatgpt", model: "gpt-image-2", modality: "image" });
});

test("subscription confirmation names the provider and guarantees no paid API fallback", () => {
    let message = "";
    confirmSubscriptionCall({ provider: "antigravity", model: "gemini-3.1-flash-image", capability: "image", count: 2 }, (value) => {
        message = value;
        return true;
    });
    expect(message).toContain("Google Antigravity");
    expect(message).toContain("gemini-3.1-flash-image");
    expect(message).toContain("不会自动切换到 API Key 或其他付费渠道");
    expect(() => confirmSubscriptionCall({ provider: "chatgpt", model: "gpt-5.5", capability: "text" }, () => false)).toThrow();
});

test("settings keeps existing section names and places subscription accounts under personal channels", async () => {
    const settings = await Bun.file(new URL("../src/pages/settings/index.tsx", import.meta.url)).text();
    const localTools = await Bun.file(new URL("../src/pages/settings/local-cli-settings.tsx", import.meta.url)).text();
    const channels = await Bun.file(new URL("../src/pages/settings/channel-settings-pane.tsx", import.meta.url)).text();
    expect(settings).toContain('label: "本机工具"');
    expect(settings).toContain('label: "个人渠道"');
    expect(localTools).toContain("CLI 安装与环境检测");
    expect(channels).toContain("个人订阅渠道");
    expect(channels).toContain("GPT Image 2 订阅生图");
    expect(channels).toContain("Nano Banana 2 生图");
});
