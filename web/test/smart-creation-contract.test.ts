import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error -- Node 原生 TypeScript 测试运行器需要保留扩展名。
import { createSmartCreationPlan, parseSmartCreationPlan, type SmartCreationPlan } from "../src/lib/plugins/smart-creation-contract.ts";
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

test("Amazon 英国站使用英国英语，避免把站点规则和语言混在一起", () => {
    const plan = createSmartCreationPlan({ intent: "制作 Amazon UK 英国站产品套图", targetModel: "gpt-image-2.5" });

    assert.equal(plan.targetMarket, "UK");
    assert.equal(plan.targetLanguage, "en-GB");
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
    assert.equal(plan.tasks.every((task) => task.settings.count === 1), true);
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
    const parsed = parseSmartCreationPlan(JSON.stringify({
        ...plan,
        assumptions: ["未指定站点时采用美国站"],
        questions: [],
    }));

    assert.deepEqual(parsed.questions, []);
    assert.deepEqual(parsed.assumptions, ["未指定站点时采用美国站"]);
});

test("Amazon 套图计划保留可复用的高级橱窗视觉指导", () => {
    const plan = createSmartCreationPlan({ intent: "制作美国站亚马逊产品套图", targetModel: "gpt-image-2.5" });
    const parsed = parseSmartCreationPlan(JSON.stringify({
        ...plan,
        visualDirection: "高级商业产品摄影，统一产品身份、材质、光线和品牌色，避免普通生活方式快照",
    }));

    assert.match(parsed.visualDirection || "", /高级商业产品摄影/);
});

test("结构化风格锁会被规范化并生成稳定指纹", () => {
    const parsed = parseSmartCreationPlan(JSON.stringify({
        planVersion: "1",
        intent: "制作两张 Amazon 产品套图",
        tasks: [{ itemId: "hero", purpose: "hero", title: "主图", prompt: "产品主图" }],
        styleBible: {
            globalPrompt: "高级商业产品摄影，保持产品外观一致",
            palette: ["暖白", "深灰"],
            preserve: ["杯身比例", "金属把手"],
            negativePrompt: "不要塑料感",
        },
    }));

    assert.equal(parsed.styleBible?.globalPrompt, "高级商业产品摄影，保持产品外观一致");
    assert.equal(parsed.styleBible?.fingerprint.startsWith("style-"), true);
    assert.deepEqual(parsed.styleBible?.palette, ["暖白", "深灰"]);
});

test("非 Amazon 平台及未知站点不会回落到 Amazon US", () => {
    assert.equal(createSmartCreationPlan({ intent: "制作拼多多商品主图" }).targetPlatform, "pinduoduo");
    assert.equal(createSmartCreationPlan({ intent: "TikTok Shop 英国站短视频" }).targetPlatform, "tiktok_shop");
    assert.equal(createSmartCreationPlan({ intent: "Shopify 法国站商品图" }).targetPlatform, "shopify");
    const unknown = parseSmartCreationPlan(JSON.stringify({ planVersion: "1", intent: "制作 Amazon 产品主图", tasks: [{ itemId: "hero", purpose: "hero", title: "主图", prompt: "商品" }] }));
    assert.equal(unknown.targetMarket, "UNKNOWN");
    assert.equal(unknown.targetLanguage, "und");
    assert.equal(parseSmartCreationPlan(JSON.stringify({ ...unknown, targetMarket: "JP" })).targetMarket, "JP");
    assert.equal(createSmartCreationPlan({ intent: "Amazon UK 英文卖点图，并附中文审核对照" }).targetLanguage, "en-GB");
    assert.equal(createSmartCreationPlan({ intent: "Shopify 法国站商品图" }).targetLanguage, "fr-FR");
});

test("第二版计划校验素材来源、逐项双语文案与依赖", () => {
    const plan = {
        planVersion: "2", planId: "plan-1", version: 1, intent: "商品套图", targetPlatform: "amazon", targetMarket: "UK", targetLanguage: "en-GB",
        attachments: [{ resourceId: "product-1", role: "product" }, { resourceId: "competitor-1", role: "competitor" }],
        productFacts: [{ id: "fact-1", claim: "不锈钢杯身", sourceIds: ["product-1"] }],
        tasks: [{ itemId: "hero", kind: "image", purpose: "hero", title: "主图", prompt: "Product photo", referenceIds: ["product-1"], targetCopy: "Steel body", zhReviewCopy: "不锈钢杯身", dependencies: [], settings: { size: "auto", aspectRatio: "1:1", quality: "auto", count: 1 }, compliance: [] }],
    };
    assert.equal(parseSmartCreationPlan(JSON.stringify(plan)).tasks[0].zhReviewCopy, "不锈钢杯身");
    assert.throws(() => parseSmartCreationPlan(JSON.stringify({ ...plan, productFacts: [{ ...plan.productFacts[0], sourceIds: ["competitor-1"] }] })), /竞品|事实来源/);
    assert.equal(parseSmartCreationPlan(JSON.stringify({ ...plan, intent: "商品是不锈钢杯身，制作套图", productFacts: [{ ...plan.productFacts[0], sourceIds: ["user:prompt"] }] })).productFacts?.[0].sourceIds[0], "user:prompt");
    assert.throws(() => parseSmartCreationPlan(JSON.stringify({ ...plan, tasks: [{ ...plan.tasks[0], dependencies: ["missing"] }] })), /依赖/);
    assert.throws(() => parseSmartCreationPlan(JSON.stringify({ ...plan, tasks: [{ ...plan.tasks[0], zhReviewCopy: undefined }] })), /中文|对照/);
});
