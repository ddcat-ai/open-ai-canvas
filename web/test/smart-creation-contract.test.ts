import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error -- Node 原生 TypeScript 测试运行器需要保留扩展名。
import { createSmartCreationPlan, parseSmartCreationPlan, DEFAULT_SMART_CREATION_PLAN_DEFAULTS, type SmartCreationPlan } from "../src/lib/plugins/smart-creation-contract.ts";
import { createSmartCreationPlanner } from "../src/lib/plugins/smart-creation-agent";
import type { PluginHostContext, PluginTextRequest } from "../src/lib/plugins/plugin-types";
// @ts-expect-error -- Node 原生 TypeScript 测试运行器需要保留扩展名。
import { isSmartCreationPluginEnabled } from "../src/lib/plugins/plugin-registry.ts";

test("智能创作计划保留平台、语言和每张图的生成规格", () => {
    const plan = createSmartCreationPlan({
        intent: "制作美国站亚马逊产品套图，两张，一张主图一张卖点图",
        targetModel: "gpt-image-2.5-sunburst",
    });

    assert.equal(plan.targetPlatform, "amazon");
    assert.equal(plan.targetMarket, "US");
    assert.equal(plan.targetLanguage, "en-US");
    assert.equal(plan.tasks.length, 2);
    assert.equal(plan.tasks[0].settings.count, 1);
    assert.ok(plan.tasks[0].settings.size);
    assert.ok(plan.tasks[0].settings.aspectRatio);
    assert.ok(plan.tasks[0].settings.quality);
});

test("插件解析器拒绝不可执行的空计划和空提示词，讨论由首页 Agent 回复", () => {
    const plan = createSmartCreationPlan({ intent: "生成主图" });
    assert.throws(() => parseSmartCreationPlan(JSON.stringify({ ...plan, tasks: [] })), /计划不完整/);
    assert.throws(() => parseSmartCreationPlan(JSON.stringify({ ...plan, tasks: [{ ...plan.tasks[0], prompt: " " }] })), /提示词/);
});

test("Amazon 英国站使用英国英语，避免把站点规则和语言混在一起", () => {
    const plan = createSmartCreationPlan({ intent: "制作 Amazon UK 英国站产品套图", targetModel: "gpt-image-2.5" });

    assert.equal(plan.targetMarket, "UK");
    assert.equal(plan.targetLanguage, "en-GB");
});

test("解析器不按平台强制改写模型计划的语言和明确画幅", () => {
    const parsed = parseSmartCreationPlan(
        JSON.stringify({
            planVersion: "1",
            intent: "Amazon 英国站附图使用 3:2 横向画幅，美国英语文案",
            targetPlatform: "amazon",
            targetMarket: "UK",
            targetLanguage: "en-US",
            tasks: [{ itemId: "hero", purpose: "hero", title: "主图", prompt: "landscape product image", settings: { size: "3:2", aspectRatio: "3:2", count: 1 } }],
        }),
    );

    assert.equal(parsed.targetMarket, "UK");
    assert.equal(parsed.targetLanguage, "en-US");
    assert.equal(parsed.tasks[0].settings.size, "3:2");
    assert.equal(parsed.tasks[0].settings.aspectRatio, "3:2");
});

test("明确的方图和竖图规格不会被插件缺省值覆盖", () => {
    for (const ratio of ["1:1", "4:5"]) {
        const parsed = parseSmartCreationPlan(
            JSON.stringify({
                planVersion: "1",
                intent: `Amazon 英国站附图使用 ${ratio}`,
                tasks: [{ itemId: "scene", purpose: "scene", title: "场景图", prompt: "premium scene", settings: { size: ratio, aspectRatio: ratio, quality: "high", count: 1 } }],
            }),
            { ...DEFAULT_SMART_CREATION_PLAN_DEFAULTS, taskSettings: { size: "auto", aspectRatio: "3:2", quality: "low" } },
        );

        assert.equal(parsed.tasks[0].settings.size, ratio);
        assert.equal(parsed.tasks[0].settings.aspectRatio, ratio);
        assert.equal(parsed.tasks[0].settings.quality, "high");
    }
});

test("智能创作插件停用时不应提供入口", () => {
    const plugin = { manifest: { contributes: { smartCreation: { entry: "smart-creation" } } }, createSmartCreationAgent: () => null } as never;
    const installation = { manifest: plugin.manifest, enabled: false, config: {}, installedAt: "", updatedAt: "" } as never;
    assert.equal(isSmartCreationPluginEnabled(plugin, installation), false);
    assert.equal(isSmartCreationPluginEnabled(plugin, { ...installation, enabled: true }), true);
});

test("计划合同不把用户手动生成数量带入任务规格", () => {
    const plan: SmartCreationPlan = createSmartCreationPlan({
        intent: "做一张美国站亚马逊主图",
        targetModel: "gpt-image-2.5-sunburst",
    });
    assert.equal(plan.tasks.length, 1);
    assert.equal(
        plan.tasks.every((task) => task.settings.count === 1),
        true,
    );
});

test("模型计划必须为每个任务提供可执行规格，并保留原生多图数量", () => {
    const plan = createSmartCreationPlan({ intent: "制作美国站亚马逊主图", targetModel: "gpt-image-2.5" });
    const multiImage = { ...plan, tasks: [{ ...plan.tasks[0], settings: { ...plan.tasks[0].settings, count: 2 } }] };
    assert.equal(parseSmartCreationPlan(JSON.stringify(multiImage)).tasks[0].settings.count, 2);
    const invalid = { ...plan, tasks: [{ ...plan.tasks[0], settings: { ...plan.tasks[0].settings, count: 0 } }] };

    assert.throws(() => parseSmartCreationPlan(JSON.stringify(invalid)), /有效生成数量/);
});

test("计划允许 Agent 表达模板之外的自定义创作用途", () => {
    const plan = createSmartCreationPlan({ intent: "制作一张美国站亚马逊产品对比信息图", targetModel: "gpt-image-2.5" });
    const custom = { ...plan, tasks: [{ ...plan.tasks[0], purpose: "custom", title: "对比信息图" }] };

    assert.equal(parseSmartCreationPlan(JSON.stringify(custom)).tasks[0].purpose, "custom");
});

test("默认假设不会被宿主误显示为追问，只有 questions 会暂停生成", () => {
    const plan = createSmartCreationPlan({ intent: "制作一张 Amazon 产品主图" });
    const parsed = parseSmartCreationPlan(
        JSON.stringify({
            ...plan,
            assumptions: ["未指定站点时采用美国站"],
            questions: [],
        }),
    );

    assert.deepEqual(parsed.questions, []);
    assert.deepEqual(parsed.assumptions, ["未指定站点时采用美国站"]);
});

test("Amazon 套图计划保留可复用的高级橱窗视觉指导", () => {
    const plan = createSmartCreationPlan({ intent: "制作美国站亚马逊产品套图", targetModel: "gpt-image-2.5" });
    const parsed = parseSmartCreationPlan(
        JSON.stringify({
            ...plan,
            visualDirection: "高级商业产品摄影，统一产品身份、材质、光线和品牌色，避免普通生活方式快照",
        }),
    );

    assert.match(parsed.visualDirection || "", /高级商业产品摄影/);
});

function modelPlan(): SmartCreationPlan {
    return {
        planVersion: "1",
        intent: "为 Mercado Libre 墨西哥站制作产品对比图，西班牙语，1:1",
        targetPlatform: "generic",
        targetMarket: "MX",
        targetLanguage: "es-MX",
        platformRules: [],
        tasks: [
            {
                itemId: "comparison",
                purpose: "custom",
                title: "产品对比图",
                prompt: "Square product comparison image with Spanish copy",
                targetLanguage: "es-MX",
                settings: { model: "image-model", size: "1024x1024", aspectRatio: "1:1", quality: "high", count: 1 },
                compliance: [],
            },
        ],
        questions: [],
        assumptions: [],
    };
}

test("其他平台保留市场、语言和自定义用途，未知平台不误套亚马逊规则", () => {
    const plan = modelPlan();
    assert.deepEqual(parseSmartCreationPlan(JSON.stringify(plan)), plan);
    const unknown = parseSmartCreationPlan(JSON.stringify({ ...plan, targetPlatform: "mercado_libre" }));
    assert.equal(unknown.targetPlatform, "unknown");
    assert.equal(unknown.targetMarket, "MX");
    assert.equal(unknown.targetLanguage, "es-MX");
    assert.deepEqual(unknown.platformRules, []);
    assert.equal(unknown.visualDirection, undefined);
});

test("未指定平台和市场时不凭空设定美国站或英语", () => {
    const parsed = parseSmartCreationPlan(JSON.stringify({ ...modelPlan(), intent: "制作产品图", targetPlatform: undefined, targetMarket: undefined, targetLanguage: undefined }));
    assert.equal(parsed.targetPlatform, "generic");
    assert.equal(parsed.targetMarket, "UNKNOWN");
    assert.equal(parsed.targetLanguage, "und");
});

test("插件缺省只补缺失规格，同时保留模型标识和原生多图数量", () => {
    const plan = modelPlan();
    const parsed = parseSmartCreationPlan(JSON.stringify({ ...plan, tasks: [{ ...plan.tasks[0], settings: { model: "image-model", count: 2 } }] }), {
        taskSettings: { size: "1536x1024", aspectRatio: "3:2", quality: "medium" },
        platforms: {},
    });
    assert.deepEqual(parsed.tasks[0].settings, { model: "image-model", size: "1536x1024", aspectRatio: "3:2", quality: "medium", count: 2 });
    assert.equal(parseSmartCreationPlan(JSON.stringify({ ...plan, tasks: [{ ...plan.tasks[0], settings: {} }] })).tasks[0].settings.count, 1);
});

test("数量拒绝负数、小数和错误类型，重复任务 ID 不能执行", () => {
    const plan = modelPlan();
    for (const count of [-1, 1.5, "2", null]) {
        assert.throws(() => parseSmartCreationPlan(JSON.stringify({ ...plan, tasks: [{ ...plan.tasks[0], settings: { ...plan.tasks[0].settings, count } }] })), /有效生成数量/);
    }
    assert.throws(() => parseSmartCreationPlan(JSON.stringify({ ...plan, tasks: [plan.tasks[0], plan.tasks[0]] })), /ID 不得重复/);
});

test("v2 计划保留版本、产品证据、引用及目标文案和中文审核对照", () => {
    const plan: SmartCreationPlan = { ...modelPlan(), planVersion: "2", planId: "plan-mx", version: 3, attachments: [{ resourceId: "product-photo", role: "product" }], productFacts: [{ id: "color", claim: "蓝色外壳", sourceIds: ["product-photo"] }] };
    plan.tasks[0] = { ...plan.tasks[0], targetCopy: "Protección diaria", zhReviewCopy: "日常保护", referenceIds: ["product-photo"] };
    assert.deepEqual(parseSmartCreationPlan(`\`\`\`json\n${JSON.stringify(plan)}\n\`\`\``), plan);
    assert.throws(() => parseSmartCreationPlan(JSON.stringify({ ...plan, version: 0 })), /稳定版本标识/);
    assert.throws(() => parseSmartCreationPlan(JSON.stringify({ ...plan, tasks: [{ ...plan.tasks[0], targetCopy: undefined }] })), /目标文案和中文审核对照/);
});

test("产品事实不能引用竞品素材或没有依据的用户声明", () => {
    const fact = { id: "waterproof", claim: "防水 IP68", sourceIds: ["competitor-photo"] };
    assert.throws(() => parseSmartCreationPlan(JSON.stringify({ ...modelPlan(), attachments: [{ resourceId: "competitor-photo", role: "competitor" }], productFacts: [fact] })), /产品事实来源/);
    assert.throws(() => parseSmartCreationPlan(JSON.stringify({ ...modelPlan(), productFacts: [{ ...fact, sourceIds: ["user:prompt"] }] })), /产品事实来源/);
    assert.throws(() => parseSmartCreationPlan(JSON.stringify({ ...modelPlan(), productFacts: [{ ...fact, sourceIds: [] }] })), /证据来源/);
});

test("任务不能使用未声明素材、自己依赖自己或依赖不存在的任务", () => {
    const plan = modelPlan();
    assert.throws(() => parseSmartCreationPlan(JSON.stringify({ ...plan, tasks: [{ ...plan.tasks[0], referenceIds: ["missing"] }] })), /未授权素材/);
    for (const id of ["missing", plan.tasks[0].itemId]) {
        assert.throws(() => parseSmartCreationPlan(JSON.stringify({ ...plan, tasks: [{ ...plan.tasks[0], dependencies: [id] }] })), /任务依赖无效/);
    }
});

test("真实规划器透传最新规格和参考素材，模型失败不会用预览计划冒充结果", async () => {
    const requests: PluginTextRequest[] = [];
    const resolved: unknown[] = [];
    const plan = modelPlan();
    const controller = new AbortController();
    const context: PluginHostContext = {
        manifest: { apiVersion: "yingce.plugin/v1", id: "test-smart-creation", name: "测试创作插件", version: "1.0.0", description: "测试规划合同", permissions: [], contributes: { smartCreation: { entry: "smart-creation" } } },
        permissions: new Set(),
        config: {},
        storage: { get: async () => null, set: async () => undefined, remove: async () => undefined },
        services: {
            ai: {
                text: {
                    requestToolResponse: async (request) => {
                        requests.push(request);
                        return {
                            content: "已完成规划",
                            toolCalls: [
                                { name: "unrelated", arguments: "{}" },
                                { name: "submit_plan", arguments: JSON.stringify(plan) },
                            ],
                        };
                    },
                },
            },
            media: {
                resolve: async (reference, signal) => {
                    resolved.push(reference);
                    assert.equal(signal, controller.signal);
                    return { dataUrl: "data:image/png;base64,reference", mimeType: "image/png" };
                },
            },
        },
    };
    const provider = createSmartCreationPlanner(context, {
        systemPrompt: "按用户的最新意图返回结构化计划",
        tool: { type: "function", function: { name: "submit_plan", parameters: { type: "object" } } },
        defaults: { taskSettings: { size: "auto", aspectRatio: "3:2", quality: "low" }, platforms: {} },
    });
    const history = [
        { role: "user" as const, content: "先讨论构图，不生成" },
        { role: "assistant" as const, content: "可以采用产品对比构图。" },
        { role: "user" as const, content: plan.intent },
    ];
    const response = await provider.plan(
        { conversation: history, generationMode: "image", targetModel: "image-model", targetProtocol: "openai", references: [{ title: "产品图", storageKey: "resource:product-photo", kind: "image" }] },
        { signal: controller.signal },
    );
    assert.deepEqual(response.plan, plan);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].messages.slice(1, 4), history);
    const requestParts = requests[0].messages.at(-1)?.content;
    assert.ok(Array.isArray(requestParts));
    assert.deepEqual(
        requestParts.filter((part) => part.type === "image_url"),
        [{ type: "image_url", image_url: { url: "data:image/png;base64,reference" } }],
    );
    const metadata = requestParts.find((part) => part.type === "text" && part.text.startsWith("{"));
    assert.ok(metadata?.type === "text");
    assert.deepEqual(JSON.parse(metadata.text), { generationMode: "image", targetModel: "image-model", targetProtocol: "openai", referenceCount: 1 });
    assert.deepEqual(requests[0].toolChoice, { type: "function", name: "submit_plan" });
    assert.equal(requests[0].signal, controller.signal);
    assert.equal(resolved.length, 1);
    assert.deepEqual(resolved[0], { title: "产品图", storageKey: "resource:product-photo", kind: "image", url: undefined, dataUrl: undefined, mimeType: undefined });
    context.services!.ai!.text!.requestToolResponse = async () => {
        throw new Error("模型服务暂时不可用");
    };
    await assert.rejects(provider.plan({ conversation: history, generationMode: "image", targetModel: "image-model", references: [] }), /模型服务暂时不可用/);
});
