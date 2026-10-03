import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as review from "../src/pages/create/creation-agent-review";

test("整套方案展示共享字体与颜色，并提供备注修改和稍后恢复提示", () => {
    const html = renderToStaticMarkup(createElement(review.CreationAgentReview, {
        plan: { planVersion: "2", planId: "locked-set", version: 2, intent: "法国站五图", platform: "amazon", site: "FR", language: "fr-FR", productFacts: [], items: [],
            styleLock: { fontFamily: "Inter", typography: "标题 700 / 正文 400", headingColor: "#182332", bodyColor: "#465263", accentColor: "#1976D2", backgroundColor: "#F7F3ED", iconStyle: "统一线条图标" } },
        approval: { approvalId: "approval-1", call: { id: "call-1", function: { name: "commerce_plan_submit", arguments: "{}" } } },
        onApprove: () => {}, onReject: () => {}, onModify: async () => true, onDefer: () => {}, submitting: false,
    }));
    expect(html).toContain("整套风格锁定");
    expect(html).toContain("Inter");
    expect(html).toContain("#1976D2");
    expect(html).toContain("修改备注");
    expect(html).toContain("按备注修改方案");
    expect(html).toContain("稍后处理");
    expect(html).toContain("确认整套生成");
});

test("待审批计划在当前页展示服务端条目、费用说明和审批按钮", () => {
    expect(typeof (review as any).CreationAgentReview).toBe("function");
    const html = renderToStaticMarkup(createElement((review as any).CreationAgentReview, {
        items: [{ id: "hero", title: "主图", status: "pending" }],
        approval: { approvalId: "approval-1", call: { id: "call-1", function: { name: "generate_media", arguments: "{}" } }, preview: { kind: "media", title: "图片计划", description: "预计 8–12 积分", items: [] } },
        onApprove: () => {}, onReject: () => {}, submitting: false,
    }));
    expect(html).toContain("主图");
    expect(html).toContain("预计 8–12 积分");
    expect(html).toContain("批准执行");
    expect(html).toContain("拒绝计划");
});

test("电商计划沿用当前计划块展示目标文案、中文审核和规格", () => {
    const html = renderToStaticMarkup(createElement(review.CreationAgentReview, {
        items: [{ id: "hero", title: "商品主图", status: "pending", type: "image", targetCopy: "An elegant product hero", zhReviewCopy: "优雅的商品主图", specs: { aspectRatio: "1:1" } }],
        onApprove: () => {}, onReject: () => {}, submitting: false,
    }));
    expect(html).toContain("An elegant product hero");
    expect(html).toContain("优雅的商品主图");
    expect(html).toContain("aspectRatio 1:1");
});

test("审核卡显示完整重要信息与逐图固定顺序，且无字图明示不放文字", () => {
    const html = renderToStaticMarkup(createElement(review.CreationAgentReview, {
        plan: { planVersion: "2", planId: "p-1", version: 2, planHash: "hash", intent: "做一套商品图", platform: "amazon", site: "JP", language: "ja-JP", styleBible: "保留原商品轮廓", assumptions: ["尺寸未知，改做外观细节"],
            skills: [{ id: "igo-visual-design", name: "电商视觉设计" }], references: [{ resourceId: "p", name: "产品正面", role: "product", kind: "image", index: 1, usage: "保持商品身份和细节" }, { resourceId: "scene", name: "竞品场景", role: "competitor", kind: "image", index: 2, usage: "只参考构图，替换场景中的商品" }],
            productFacts: [{ id: "blue", claim: "蓝色瓶身", sourceIds: ["p"], status: "supported" }],
            items: [{ id: "hero", type: "image", purpose: "主视觉", title: "主视觉", prompt: "Bottle on neutral stage", targetCopy: "", zhReviewCopy: "", factIds: ["blue"], attachmentResourceIds: ["p"], specs: { size: "1:1" } }, { id: "detail", type: "image", purpose: "细节图", title: "细节", prompt: "Close-up bottle texture", targetCopy: "青いボトル", zhReviewCopy: "蓝色瓶身", factIds: ["blue"], attachmentResourceIds: ["p"], specs: { size: "1:1" } }] },
        onApprove: () => {}, onReject: () => {}, submitting: false,
    }));
    expect(html).toContain("重要信息");
    expect(html).toContain("电商视觉设计");
    expect(html).toContain("产品正面");
    expect(html).toContain("图1");
    expect(html).toContain("图2");
    expect(html).toContain("保持商品身份和细节");
    expect(html).toContain("只参考构图，替换场景中的商品");
    expect(html).toContain("尺寸未知，改做外观细节");
    expect(html).toContain("本图不放文字");
    const item = html.indexOf("细节图");
    expect(html.indexOf("画面设计", item)).toBeLessThan(html.indexOf("实际上图文案", item));
    expect(html.indexOf("实际上图文案", item)).toBeLessThan(html.indexOf("中文对照", item));
    expect(html.indexOf("中文对照", item)).toBeLessThan(html.indexOf("规格", item));
    expect(html.indexOf("规格", item)).toBeLessThan(html.indexOf("依据事实/素材", item));
});

test("推断与未知事实列为未确认且不用，跨境版本注明逐项语言", () => {
    const html = renderToStaticMarkup(createElement(review.CreationAgentReview, {
        plan: { planVersion: "2", planId: "p-2", version: 1, intent: "双语套图", platform: "shopify", site: "EU", language: "mul", languageVariants: ["en-GB", "de-DE"],
            productFacts: [{ id: "verified", claim: "蓝色外观", sourceIds: ["p"], status: "supported" }, { id: "guess", claim: "可能防水", sourceIds: [], status: "inferred" }, { id: "unknown", claim: "容量未知", sourceIds: [], status: "unknown" }],
            references: [{ resourceId: "p", name: "商品", role: "product" }],
            items: [{ id: "en", type: "image", language: "en-GB", purpose: "主图", title: "英文主图", prompt: "Blue object", targetCopy: "Blue", zhReviewCopy: "蓝色", attachmentResourceIds: ["p"], factIds: ["verified"] }, { id: "de", type: "image", language: "de-DE", purpose: "细节", title: "德文细节", prompt: "Close view", targetCopy: "Blau", zhReviewCopy: "蓝色", attachmentResourceIds: ["p"], factIds: [] }] },
        onApprove: () => {}, onReject: () => {}, submitting: false,
    }));
    const adopted = html.slice(html.indexOf("采用的产品事实"), html.indexOf("未确认且不用的事实"));
    expect(adopted).toContain("蓝色外观");
    expect(adopted).not.toContain("可能防水");
    expect(html).toContain("可能防水");
    expect(html).toContain("容量未知");
    expect(html).toContain("目标语言：de-DE");
    expect(html).toContain("2 项交付");
});
