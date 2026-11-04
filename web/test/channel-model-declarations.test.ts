import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ModelCapabilityEditor } from "../src/components/model-capability-editor";
import { declaredCapabilityConfig, declaredChannelDefaults, declaredProtocolForCapability, mergeFetchedChannelModelCosts } from "../src/lib/channel-model-catalog";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import type { ModelProtocolDefinition, ModelProtocolWorkflow } from "../src/lib/model-protocols";
import { initialChannelModelValues } from "../src/pages/admin/components/channel-model-editor-form";
import { channelValidationError } from "../src/pages/settings/channel-settings-pane";
import { defaultProtocolForModel, resolveDeclaredCapability } from "../src/pages/settings/channel-video-pricing";
import { apiClient } from "../src/services/api/request";
import { fetchPluginProviderCatalog } from "../src/services/api/plugin-catalog";
import { createModelChannel } from "../src/stores/use-config-store";

const originalApiClientRequest = apiClient.request;

afterEach(() => {
    apiClient.request = originalApiClientRequest;
});

// 插件声明（GET /plugins/catalog 的 provider 投影）：capabilities → capability，baseUrl → 默认地址。
const VENDOR_BASE_URL = "https://vendor.example.com";

function declaration(value: string, capability: ModelProtocolDefinition["capability"], baseUrl?: string): ModelProtocolDefinition {
    return {
        value,
        label: value,
        capability,
        create: "POST /v1/test",
        contentType: "application/json",
        media: "plugin · test",
        enabled: true,
        ...(baseUrl ? { baseUrl } : {}),
    };
}

const vendorImagePlugins = [declaration("vendor-image-banana", "image", VENDOR_BASE_URL), declaration("vendor-image-gpt-2", "image", VENDOR_BASE_URL)];
const vendorPlugins = [declaration("vendor-chat", "text", VENDOR_BASE_URL), declaration("vendor-image-banana", "image", VENDOR_BASE_URL), declaration("vendor-video", "video", VENDOR_BASE_URL)];
const officialPlugins = [declaration("chat-completion", "text", "https://api.openai.com"), declaration("openai-image", "image", "https://api.openai.com")];

function catalogChannel(input: { baseUrl: string; models: string[]; protocol?: string; capability?: "text" | "image" | "video" | "audio" }) {
    return createModelChannel({
        id: "declared-catalog",
        name: "声明式渠道",
        baseUrl: input.baseUrl,
        apiKey: "synthetic-test-key",
        apiFormat: "openai",
        models: input.models,
    });
}

describe("installed plugin declarations feed admin model defaults", () => {
    test("vendor plugins supply capability, protocol and declared address for a new model", () => {
        expect(declaredChannelDefaults(vendorImagePlugins, VENDOR_BASE_URL)).toEqual({
            capability: "image",
            protocol: "vendor-image-banana",
            baseUrl: VENDOR_BASE_URL,
        });

        // 运营后台「新增模型」：能力 / 协议来自插件声明，而不是按模型名或写死协议表猜。
        const draft = initialChannelModelValues(null, vendorImagePlugins, `${VENDOR_BASE_URL}/`);
        expect(draft.capability).toBe("image");
        expect(draft.protocol).toBe("vendor-image-banana");

        // 设置页「模型能力与请求协议」：未配置的模型按声明落到插件声明的协议。
        expect(resolveDeclaredCapability("gpt-image-2-5-flare-deal", vendorImagePlugins, VENDOR_BASE_URL)).toBe("image");
        expect(defaultProtocolForModel("gpt-image-2-5-flare-deal", vendorImagePlugins, VENDOR_BASE_URL)).toBe("vendor-image-banana");
    });

    test("pulled catalog models pick the declared plugin protocol instead of the hardcoded template", () => {
        const channel = catalogChannel({ baseUrl: VENDOR_BASE_URL, models: ["nano-banana-pro-unified"] });

        const costs = mergeFetchedChannelModelCosts(channel, [{ id: "nano-banana-pro-unified", modelType: "image" }], vendorImagePlugins);

        expect(costs).toHaveLength(1);
        expect(costs[0]!.capability).toBe("image");
        expect(costs[0]!.protocol).toBe("vendor-image-banana");
    });

    test("several declared capabilities behind one address fall back to the author heuristic only for the capability", () => {
        expect(declaredChannelDefaults(vendorPlugins, VENDOR_BASE_URL)).toEqual({});
        // 能力不唯一 → 保留作者原来的模型名启发式；协议仍然读插件声明。
        expect(resolveDeclaredCapability("kling-video-v4-tencent", vendorPlugins, VENDOR_BASE_URL)).toBe("video");
        expect(defaultProtocolForModel("kling-video-v4-tencent", vendorPlugins, VENDOR_BASE_URL)).toBe("vendor-video");
        expect(declaredProtocolForCapability(vendorPlugins, "text", VENDOR_BASE_URL)).toBe("vendor-chat");
    });
});

describe("author built-in behaviour is unchanged", () => {
    test("official plugins keep the same capability and protocol defaults", () => {
        // 地址一致但能力不唯一：默认能力仍是作者原来的 text，协议仍是作者的第一顺位协议。
        expect(declaredChannelDefaults(officialPlugins, "https://api.openai.com")).toEqual({});
        const draft = initialChannelModelValues(null, officialPlugins, "https://api.openai.com");
        expect(draft.capability).toBe("text");
        expect(draft.protocol).toBe("chat-completion");

        // 拉取模型：图片模型的默认协议仍是作者的 openai-image 模板（插件声明与模板一致）。
        const channel = catalogChannel({ baseUrl: "https://api.openai.com", models: ["gpt-image-1"] });
        const costs = mergeFetchedChannelModelCosts(channel, [{ id: "gpt-image-1", modelType: "image" }], officialPlugins);
        expect(costs[0]!.protocol).toBe("openai-image");
    });

    test("a relay address that matches no declaration keeps the author preferred protocol table", () => {
        const officialVideo = [declaration("newapi", "video", "https://api.newapi.pro")];

        expect(resolveDeclaredCapability("some-video-model", officialVideo, "https://relay.example")).toBe("video");
        expect(defaultProtocolForModel("some-video-model", officialVideo, "https://relay.example")).toBe("newapi");
    });

    test("without any installed plugin the author templates are used as before", () => {
        const channel = catalogChannel({ baseUrl: "https://relay.example", models: ["nano-banana-pro", "gpt-image-1"] });

        const image = mergeFetchedChannelModelCosts(channel, [{ id: "nano-banana-pro", modelType: "image" }]);
        const text = mergeFetchedChannelModelCosts(channel, [{ id: "gpt-image-1", modelType: "text" }]);
        const video = mergeFetchedChannelModelCosts(channel, [{ id: "sd-video", modelType: "video" }]);
        const audio = mergeFetchedChannelModelCosts(channel, [{ id: "tts-1", modelType: "audio" }]);

        expect(image[0]!.protocol).toBe("openai-image");
        expect(text[0]!.protocol).toBe("chat-completion");
        expect(video[0]!.protocol).toBe("newapi");
        expect(audio[0]!.protocol).toBe("openai-audio");
        expect(declaredChannelDefaults([], "https://relay.example")).toEqual({});
        // 没有插件声明时，设置页仍用作者原来的模型名启发式。
        expect(defaultProtocolForModel("veo-lite-flow", [], "https://relay.example")).toBe("newapi-channel-2");
    });
});

describe("declared capability profiles and workflow screen specs", () => {
    const workflow: ModelProtocolWorkflow = {
        id: "wf-turbo",
        label: "Turbo 视频",
        providerId: "vendor-video",
        capability: "video",
        parameters: [
            { name: "prompt", type: "string", mapping: "prompt" },
            { name: "resolution", type: "string", mapping: "resolution", values: ["720p", "1080p"] },
        ],
        defaults: { resolution: "1080p" },
    };

    test("video defaults read the declared workflow parameters", () => {
        const config = declaredCapabilityConfig(defaultModelCapabilityConfig("vendor-video", "wf-turbo"), {
            capability: "video",
            model: "wf-turbo",
            protocol: "vendor-video",
            protocols: [declaration("vendor-video", "video", VENDOR_BASE_URL)].map((item) => ({ ...item, workflows: [workflow] })),
        });

        expect(config.video!.fixedScreenSpec?.resolutions).toEqual(["720p", "1080p"]);
        expect(config.video!.resolutions).toEqual(["720p", "1080p"]);
        // 默认档位取工作流声明的值（保留已有配置里兼容的那一档）。
        expect(["720p", "1080p"]).toContain(config.video!.defaultResolution);
    });

    test("image defaults read the declared image parameters", () => {
        const protocols = [
            {
                ...declaration("vendor-image-banana", "image", VENDOR_BASE_URL),
                imageParameters: [{ name: "size" as const, type: "string" as const, mapping: "size", values: ["1K", "2K"] }],
            },
        ];

        const config = declaredCapabilityConfig(defaultModelCapabilityConfig("vendor-image-banana", "nano-banana-pro-unified"), {
            capability: "image",
            model: "nano-banana-pro-unified",
            protocol: "vendor-image-banana",
            protocols,
        });

        expect(config.image!.parameters?.map((parameter) => parameter.name)).toContain("size");
    });

    test("the capability editor renders workflow-declared resolutions for any protocol that declares them", () => {
        const html = renderToStaticMarkup(
            React.createElement(ModelCapabilityEditor, {
                capability: "video",
                protocol: "vendor-video",
                model: "wf-turbo",
                workflows: [workflow],
                value: defaultModelCapabilityConfig("vendor-video", "wf-turbo"),
            }),
        );

        expect(html).toContain("720p");
        expect(html).toContain("1080p");
        expect(html).not.toContain("未读取到 AutoDL 插件的分辨率预设");
    });

    test("the editor no longer special-cases the autodl protocol name when no workflow is declared", () => {
        const html = renderToStaticMarkup(
            React.createElement(ModelCapabilityEditor, {
                capability: "video",
                protocol: "autodl-comfyui",
                model: "workflow-model",
                workflows: [],
                value: defaultModelCapabilityConfig("autodl-comfyui", "workflow-model"),
            }),
        );

        expect(html).not.toContain("未读取到 AutoDL 插件的分辨率预设");
    });
});

describe("secret key requirement follows the declared plugin auth", () => {
    // 用作者真实的即梦插件 manifest（auth 里还带 service / region）做数据。
    const jimengManifest = JSON.parse(readFileSync(new URL("../../plugin-packages/volcengine-jimeng-image/manifest.json", import.meta.url), "utf8")) as {
        contributes: { providers: unknown[] };
    };
    const jimengProvider = jimengManifest.contributes.providers.find((item: { id: string }) => item.id === "volcengine-jimeng-image") as {
        id: string;
        baseUrl?: string;
        auth: { type: string; field: string; secretField?: string; service?: string; region?: string };
    };
    const jimengDeclaration: ModelProtocolDefinition = { ...declaration(jimengProvider.id, "image", jimengProvider.baseUrl), auth: jimengProvider.auth };

    function channelWith(protocol: string) {
        return createModelChannel({
            id: `secret-${protocol}`,
            name: protocol,
            baseUrl: jimengProvider.baseUrl || VENDOR_BASE_URL,
            apiKey: "synthetic-test-key",
            models: ["declared-model"],
            modelCosts: [{ model: "declared-model", capability: "image", protocol, billingMode: "fixed_request", unitPriceMicrocredits: 0 }],
        });
    }

    test("a protocol whose plugin declares auth.secretField requires a secret key", () => {
        expect(jimengProvider.auth.secretField).toBe("secretKey");
        expect(channelValidationError({ ...channelWith("volcengine-jimeng-image"), secretKey: "" }, [jimengDeclaration])).toContain("Secret Key");
        expect(channelValidationError({ ...channelWith("volcengine-jimeng-image"), secretKey: "secret" }, [jimengDeclaration])).toBe("");
        // 目录里没有该协议的声明（尚未加载完 / 请求失败 / 没装插件）时保留作者的即梦前缀兜底，与后端一致。
        expect(channelValidationError({ ...channelWith("volcengine-jimeng-image"), secretKey: "" }, [])).toContain("Secret Key");
    });

    test("an empty declaration catalog keeps the builtin JiMeng secret key requirement", () => {
        const channel = { ...channelWith("volcengine-jimeng-image"), secretKey: "" };

        // 目录为空时按作者的即梦前缀兜底（后端 protocolRequiresSecretKey 保留的内置实现）
        expect(channelValidationError(channel, [])).toContain("Secret Key");
        expect(channelValidationError({ ...channel, secretKey: "secret" }, [])).toBe("");
        // 兜底只覆盖即梦协议，其他协议仍然不要求第二把密钥
        expect(channelValidationError({ ...channelWith("vendor-image-banana"), secretKey: "" }, [])).toBe("");
        expect(channelValidationError(channel, [jimengDeclaration])).toContain("Secret Key");
        // 有声明时以声明为准：声明里没有 secretField 就不要求
        expect(channelValidationError(channel, [declaration("volcengine-jimeng-image", "image")])).toBe("");
    });

    test("a protocol declared without secretField asks for no secret key", () => {
        const declared = [declaration("vendor-image-banana", "image", VENDOR_BASE_URL), declaration("chat-completion", "text", "https://api.openai.com")];

        expect(declared.every((item) => !item.auth?.secretField)).toBe(true);
        expect(channelValidationError({ ...channelWith("vendor-image-banana"), secretKey: "" }, declared)).toBe("");
    });

    test("the plugin catalog passes only the declared auth field names through", async () => {
        apiClient.request = (async () => ({
            data: {
                code: 0,
                data: {
                    providers: [
                        {
                            id: jimengProvider.id,
                            version: "1.0.0",
                            name: "即梦图片",
                            vendor: "Test",
                            categories: ["image"],
                            scopes: ["user.custom-channel"],
                            enabled: true,
                            auth: { type: jimengProvider.auth.type, field: jimengProvider.auth.field, secretField: jimengProvider.auth.secretField },
                        },
                    ],
                },
            },
        })) as typeof apiClient.request;

        const result = await fetchPluginProviderCatalog("user.custom-channel", "image");

        expect(result).toHaveLength(1);
        expect(result[0]!.auth).toEqual({ type: "volcengine-v4", field: "apiKey", secretField: "secretKey" });
    });
});
