import { describe, expect, test } from "bun:test";
import { emptyEcommerceDraft, projectDraft, type EcommerceProject } from "../src/services/api/ecommerce";
import { assertSuppliedCopy, defaultTextLayout, photoCopyPlan, suppliedCopyPages, validateCopyBrief } from "../src/pages/ecommerce/copy-first";
import { commerceInputSignature, parsePlannerOutput, plannerPrompt } from "../src/pages/ecommerce/planner";
import { commerceImagePrompt } from "../src/pages/ecommerce/workflow";
import { archiveCommercePlan } from "../src/pages/ecommerce/continuation";
import { layoutCommerceText, sameCommerceTextLayout } from "../src/pages/ecommerce/text-layout";
import { startEcommerceDownload } from "../src/pages/ecommerce/export";

const draft = () => ({
    ...emptyEcommerceDraft(),
    productName: "棉拖鞋",
    imageType: "single",
    count: 2,
    copyBrief: { text: "温暖包裹\n毛绒鞋口\n---\n细节之美\n蝴蝶结与蕾丝", mode: "verbatim" as const },
    references: [{ resourceId: "product-photo", role: "primary" as const }],
});

describe("文案先行及独立文字排版", () => {
    test("排版冲突比较忽略服务端 JSON 字段顺序，但保留实际变更检测", () => {
        const layout = photoCopyPlan(draft()).images[0].textLayout!;
        const reordered = { fontFamily: layout.fontFamily, ...layout };
        expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(layout));
        expect(sameCommerceTextLayout(layout, reordered)).toBe(true);
        expect(sameCommerceTextLayout(layout, { ...reordered, fontFamily: undefined })).toBe(true);
        expect(sameCommerceTextLayout(layout, { ...reordered, x: layout.x + 1 })).toBe(false);
    });
    test("保留原文不允许丢失英文词间空格", () => {
        const source = { ...draft(), count: 1, copyBrief: { text: "Soft and warm", mode: "verbatim" as const } };
        const plan = photoCopyPlan(source);
        plan.images[0].copy = "Softandwarm";
        expect(() => assertSuppliedCopy(plan, source)).toThrow();
    });
    test("原文分页、重复品牌词及换行保留，改字、遗漏或调换页面不能通过", () => {
        const source = draft();
        const plan = photoCopyPlan(source);
        expect(() => assertSuppliedCopy(plan, source)).not.toThrow();
        plan.images[0].copy = "温暖\n包裹\n毛绒鞋口";
        expect(() => assertSuppliedCopy(plan, source)).not.toThrow();
        plan.images[0].copy += "防水";
        expect(() => assertSuppliedCopy(plan, source)).toThrow("改动或遗漏");
        expect(() => assertSuppliedCopy({ images: photoCopyPlan(source).images.reverse() }, source)).toThrow();
        expect(suppliedCopyPages("第一张\r\n---\r\n第二张")).toEqual(["第一张", "第二张"]);
    });
    test("整段文案可顺序分到多张，允许润色模式不要求逐字相同", () => {
        const source = { ...draft(), copyBrief: { text: "温暖包裹毛绒鞋口细节之美蝴蝶结与蕾丝", mode: "verbatim" as const } };
        expect(() => assertSuppliedCopy(photoCopyPlan(draft()), source)).not.toThrow();
        expect(() => assertSuppliedCopy({ images: [] }, { ...source, copyBrief: { ...source.copyBrief, mode: "polish" } })).not.toThrow();
    });
    test("无文字平台、空文案与分页不匹配在调用模型前拦截", () => {
        expect(() => validateCopyBrief({ ...draft(), noText: true })).toThrow("无文字");
        expect(() => validateCopyBrief({ ...draft(), copyBrief: { text: " ", mode: "verbatim" } })).toThrow("填写");
        expect(() => validateCopyBrief({ ...draft(), count: 3 })).toThrow("2 页");
        expect(() => photoCopyPlan({ ...draft(), references: [] })).toThrow("实拍图");
    });
    test("旧草稿不变；文案更改使旧方案失效；保存后可恢复文案", () => {
        const source = draft();
        const signature = commerceInputSignature(source);
        expect(commerceInputSignature({ ...source, copyBrief: { ...source.copyBrief, text: "新文案" } })).not.toBe(signature);
        expect(projectDraft({ draftJson: JSON.stringify(source) } as EcommerceProject).copyBrief).toEqual(source.copyBrief);
        expect(() => validateCopyBrief(emptyEcommerceDraft())).not.toThrow();
    });
    test("实拍布局可进入历史；AI 配图只生成底图；下载不能绕过文字合成", () => {
        const source = draft();
        const plan = photoCopyPlan(source);
        expect(archiveCommercePlan(plan)?.previousImages).toHaveLength(2);
        expect(plan.images.map((image) => image.sourcePhotoResourceId)).toEqual(["product-photo", "product-photo"]);
        const prompt = commerceImagePrompt(source, plan.images[0]);
        expect(prompt).toContain("不渲染任何新文字");
        expect(prompt).not.toContain("把以下已审阅文案作为成品排版");
        expect(startEcommerceDownload([{ image: plan.images[0], assetId: "", resourceId: "product-photo", index: 0 }])).toBe(false);
        expect(plannerPrompt(source)).toContain("逐字保留原文");
    });
    test("策划结果不能伪造实拍来源或文字位置，受控文字层由程序创建", () => {
        const source = { ...draft(), count: 1, copyBrief: { text: "温暖包裹", mode: "verbatim" as const } };
        const plan = photoCopyPlan(source);
        plan.images[0].sourcePhotoResourceId = "foreign-photo";
        plan.images[0].textLayout = { ...defaultTextLayout(), x: 1000 };
        const parsed = parsePlannerOutput(JSON.stringify(plan), source);
        expect(parsed.images[0].sourcePhotoResourceId).toBeUndefined();
        expect(parsed.images[0].textLayout).toEqual(defaultTextLayout());
    });
    test("排版完整保留中文、标点和英文；超出画幅拒绝，不截字", () => {
        const text = "温暖包裹\nSoft & warm，100%";
        const layout = defaultTextLayout();
        const measured = (text: string, size: number) => Array.from(text).length * size;
        const result = layoutCommerceText(text, layout, 1000, 1000, measured);
        expect(result.lines.map((line) => line.text).join("")).toBe(text.replace(/\n/g, ""));
        expect(() => layoutCommerceText("长文案".repeat(200), layout, 1000, 1000, measured)).toThrow("超出画幅");
        expect(() => layoutCommerceText(text, { ...layout, y: 90 }, 1000, 1000, measured)).toThrow();
    });
});
