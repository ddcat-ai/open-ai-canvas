import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error -- Node 原生 TypeScript 测试运行器需要保留扩展名。
import { createSmartCreationAgent, igoStudioManifest, IGO_STUDIO_PLUGIN_ID } from "../src/lib/plugins/builtin/igo-studio.tsx";
// @ts-expect-error -- Node 原生 TypeScript 测试运行器需要保留扩展名。
import { isSmartCreationPluginEnabled } from "../src/lib/plugins/plugin-registry.ts";

test("电商智能创作 只贡献智能创作入口，不再注册旧首页 Agent", () => {
    assert.equal(IGO_STUDIO_PLUGIN_ID, "igo-studio-ecommerce-agent");
    assert.equal(igoStudioManifest.contributes.smartCreation?.entry, "smart-creation");
    assert.equal(igoStudioManifest.contributes.smartCreation?.label, "智能创作");
    assert.equal(igoStudioManifest.contributes.homepageCreation, undefined);
    assert.equal(igoStudioManifest.contributes.agents, undefined);
});

test("智能创作入口只在 电商智能创作 插件启用时出现", () => {
    const plugin = { manifest: igoStudioManifest, createSmartCreationAgent: () => null } as never;
    const installation = { manifest: igoStudioManifest, enabled: false, config: {}, installedAt: "", updatedAt: "" } as never;
    assert.equal(isSmartCreationPluginEnabled(plugin, installation), false);
    assert.equal(isSmartCreationPluginEnabled(plugin, { ...installation, enabled: true }), true);
});

test("智能创作通过结构化工具规划，模型失败不会静默套用本地模板", async () => {
    const requests = [];
    const context = {
        services: {
            ai: {
                text: {
                    requestToolResponse: async (request) => {
                        requests.push(request);
                        return {
                            content: "",
                            toolCalls: [{
                                name: "create_smart_creation_plan",
                                arguments: JSON.stringify({
                                    planVersion: "1",
                                    intent: "制作美国站亚马逊主图",
                                    targetPlatform: "amazon",
                                    targetMarket: "US",
                                    targetLanguage: "en-US",
                                    platformRules: ["主图白底"],
                                    assumptions: [],
                                    tasks: [{ itemId: "hero-1", purpose: "hero", title: "主图", prompt: "white background product photo", compliance: ["no logo"], settings: { size: "1600x1600", aspectRatio: "1:1", quality: "auto", count: 1 } }],
                                }),
                            }],
                        };
                    },
                },
            },
        },
    } as never;
    const provider = createSmartCreationAgent(context);
    const result = await provider.plan({ conversation: [{ role: "user", content: "做一张美国站亚马逊主图" }], generationMode: "image", targetModel: "gpt-image-2.5", references: [] });

    assert.equal(result.plan?.tasks.length, 1);
    assert.equal(requests[0].toolChoice.name, "create_smart_creation_plan");

    const failingProvider = createSmartCreationAgent({ services: { ai: { text: { requestToolResponse: async () => ({ content: "", toolCalls: [] }) } } } } as never);
    await assert.rejects(() => failingProvider.plan({ conversation: [{ role: "user", content: "继续" }], generationMode: "image", targetModel: "gpt-image-2.5", references: [] }), /JSON|计划/);
});

test("Amazon 多张附图拆成独立卖点任务，并尊重不要白底的约束", async () => {
    const requests = [];
    const context = {
        services: {
            ai: {
                text: {
                    requestToolResponse: async (request) => {
                        requests.push(request);
                        return {
                            content: "",
                            toolCalls: [{ name: "create_smart_creation_plan", arguments: JSON.stringify({ planVersion: "1", intent: "制作5张Amazon UK附图，不要白底", tasks: [{ itemId: "bullet-1", purpose: "bullet", title: "卖点图1", prompt: "生活方式卖点场景", settings: { size: "1600x1600", aspectRatio: "1:1", quality: "auto", count: 1 } }] }) }],
                        };
                    },
                },
            },
        },
    } as never;
    const provider = createSmartCreationAgent(context);
    await provider.plan({ conversation: [{ role: "user", content: "制作5张Amazon UK附图，不要白底" }], generationMode: "image", targetModel: "gpt-image-2.5", references: [] });

    const systemPrompt = requests[0].messages[0].content;
    assert.match(systemPrompt, /多张.*附图.*独立 tasks/);
    assert.match(systemPrompt, /不要.*白底/);
    assert.match(systemPrompt, /高级.*橱窗|商业产品摄影/);
    assert.match(systemPrompt, /产品身份|风格.*一致/);
});

test("参考图以带角色说明的多模态内容发送，最小计划由宿主补齐默认值", async () => {
    const requests = [];
    const context = {
        services: {
            ai: {
                text: {
                    requestToolResponse: async (request) => {
                        requests.push(request);
                        return {
                            content: "",
                            toolCalls: [{
                                name: "create_smart_creation_plan",
                                arguments: JSON.stringify({
                                    planVersion: "1",
                                    intent: "继续生成这只杯子的 Amazon 产品主图",
                                    tasks: [{ itemId: "hero-1", purpose: "hero", title: "主图", prompt: "保持参考图中的杯子外观，白色背景" }],
                                }),
                            }],
                        };
                    },
                },
            },
        },
    } as never;
    const provider = createSmartCreationAgent(context);
    const result = await provider.plan({
        conversation: [{ role: "user", content: "继续生成这只杯子的 Amazon 产品主图" }],
        generationMode: "image",
        targetModel: "gpt-image-2.5",
        references: [{ title: "杯子参考图", dataUrl: "data:image/png;base64,AA==", kind: "image" }],
    });

    const content = requests[0].messages.at(-1).content;
    assert.ok(Array.isArray(content));
    assert.ok(content.some((part) => part.type === "image_url" && part.image_url.url.startsWith("data:image/png")));
    assert.equal(result.plan?.targetMarket, "UNKNOWN");
    assert.equal(result.plan?.tasks[0].settings.aspectRatio, "1:1");
    assert.deepEqual(result.plan?.questions, []);
});

test("解析参考图时保留标题和 MIME 类型，错误可以定位到具体图片", async () => {
    const resolvedReferences = [];
    const context = {
        services: {
            ai: { text: { requestToolResponse: async () => ({ content: "", toolCalls: [{ name: "create_smart_creation_plan", arguments: JSON.stringify({ planVersion: "1", intent: "生成主图", tasks: [{ itemId: "hero-1", purpose: "hero", title: "主图", prompt: "product photo" }] }) }] }) } },
            media: { resolve: async (reference) => { resolvedReferences.push(reference); return { dataUrl: "data:image/png;base64,AA==", mimeType: "image/png" }; } },
        },
    } as never;
    const provider = createSmartCreationAgent(context);
    await provider.plan({ conversation: [{ role: "user", content: "生成主图" }], generationMode: "image", targetModel: "gpt-image-2.5", references: [{ title: "图片1", mimeType: "image/jpeg", dataUrl: "data:image/jpeg;base64,AA==", kind: "image" }] });

    assert.equal(resolvedReferences[0].title, "图片1");
    assert.equal(resolvedReferences[0].mimeType, "image/jpeg");
});
