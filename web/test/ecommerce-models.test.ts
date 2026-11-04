import { describe, expect, test } from "bun:test";
import { emptyEcommerceDraft } from "@/services/api/ecommerce";
import { suggestCommerceModel } from "@/pages/ecommerce/model-catalog";
import { activeCommerceReferences, commerceModelInstruction } from "@/pages/ecommerce/model-context";
import { commerceImageReferences, commerceImagePrompt, commerceRequiredImageReferenceCount, commercePlanningPayload, commerceRegenerationVariation } from "@/pages/ecommerce/workflow";
import { commerceInputSignature, plannerPrompt } from "@/pages/ecommerce/planner";

describe("ecommerce model references", () => {
    const product = { resourceId: "product-1", role: "primary" as const, name: "商品主图" };
    const model = { resourceId: "model-1", role: "model" as const, name: "中国 · 成熟女模", catalogId: "cn-woman" };
    const image = {
        id: "image-1",
        imageType: "main",
        platform: "taobao",
        language: "zh-CN",
        goal: "展示商品",
        theme: "主图",
        composition: "模特正面佩戴商品",
        mainVisual: "模特与商品",
        verifiedClaims: "",
        copy: "",
        lighting: "柔光",
        fidelity: "保真",
        prompt: "模特佩戴商品摄影",
        negativePrompt: "",
        imageModel: "image-test",
        ratio: "1:1",
        resolution: "1k",
    };

    test("automatic choice uses product and language context", () => {
        expect(suggestCommerceModel({ ...emptyEcommerceDraft(), productName: "男士外套", language: "en-US" }).id).toBe("us-man");
        expect(suggestCommerceModel({ ...emptyEcommerceDraft(), productName: "女童连衣裙" }).id).toBe("cn-girl");
        expect(suggestCommerceModel({ ...emptyEcommerceDraft(), productName: "男童假人服装陈列" }).id).toBe("mannequin-boy");
    });

    test("switch controls reference delivery and main model enters both prompts", () => {
        const draft = { ...emptyEcommerceDraft(), productName: "女装外套", modelEnabled: true, primaryModelResourceId: model.resourceId, references: [product, model] };
        expect(activeCommerceReferences(draft)).toHaveLength(2);
        expect(commerceRequiredImageReferenceCount(draft)).toBe(2);
        expect(commerceImageReferences(draft, image, 0, false).map((ref) => ref.resourceId)).toEqual(["product-1", "model-1"]);
        expect(commercePlanningPayload(draft, 2).referenceImages).toHaveLength(2);
        expect(plannerPrompt(draft, "服装摄影技能方法")).toContain("主模特是模特参考图");
        expect(plannerPrompt(draft, "服装摄影技能方法")).toContain("服装摄影技能方法");
        expect(commerceImagePrompt(draft, image)).toContain("已选主模特");
        expect(commerceModelInstruction(draft)).toContain("主模特必须在场");
        const disabled = { ...draft, modelEnabled: false };
        expect(activeCommerceReferences(disabled)).toEqual([product]);
        expect(commerceImageReferences(disabled, image, 0, false)).toEqual([product]);
        expect(commerceInputSignature(disabled)).not.toBe(commerceInputSignature(draft));
    });

    test("an enabled model without a reference is described in the prompt", () => {
        const draft = { ...emptyEcommerceDraft(), productName: "女士连衣裙", modelEnabled: true, references: [product] };
        expect(commerceRequiredImageReferenceCount(draft)).toBe(1);
        expect(commerceImageReferences(draft, image, 0, false)).toEqual([product]);
        expect(commerceModelInstruction(draft)).toContain("自行在需要人物的每张图提示词中写出");
        expect(commerceImagePrompt(draft, image)).toContain("具体描述适合的模特形象");
    });

    test("product-only shots exclude the selected model reference", () => {
        const draft = { ...emptyEcommerceDraft(), modelEnabled: true, references: [product, model] };
        const white = { ...image, imageType: "white", prompt: "纯白背景商品", composition: "完整商品居中", mainVisual: "商品" };
        expect(commerceImageReferences(draft, white, 0, false)).toEqual([product]);
        expect(commerceImagePrompt(draft, white)).toContain("不添加模特或路人");
    });

    test("market and real skin direction reach automatic, selected and edited image prompts", () => {
        for (const settings of [
            { modelEnabled: false, references: [product] },
            { modelEnabled: true, references: [product, model] },
        ]) {
            const draft = { ...emptyEcommerceDraft(), ...settings, platform: "amazon", region: "日本", language: "ja-JP" };
            for (const manualPrompt of [false, true]) {
                const prompt = commerceImagePrompt(draft, { ...image, manualPrompt });
                expect(prompt).toContain('"region":"日本"');
                expect(prompt).toContain("毛孔、细小肤纹");
                expect(prompt).toContain("禁止美容滤镜");
                expect(prompt).toContain("每轮重新策划要换面貌识别点");
            }
            const white = commerceImagePrompt(draft, { ...image, imageType: "white" });
            expect(white).not.toContain("【人物实拍质感】");
            expect(white).toContain("不添加模特或路人");
        }
    });

    test("single automatic retries recast while references and series keep identity", () => {
        const draft = { ...emptyEcommerceDraft(), count: 1, references: [product] };
        expect(commerceRegenerationVariation(draft, image, () => 0)).toContain("单张自动选角重新选人");
        expect(commerceRegenerationVariation(draft, image, () => 0)).not.toBe(commerceRegenerationVariation(draft, image, () => 0.9));
        expect(commerceRegenerationVariation({ ...draft, count: 9 }, image, () => 0)).toContain("人物设定（同一人物）");
        expect(commerceRegenerationVariation({ ...draft, modelEnabled: true, references: [product, model] }, image, () => 0)).toContain("人物设定（同一人物）");
    });

    test("a chosen creative direction may place an original model without a model reference", () => {
        const draft = { ...emptyEcommerceDraft(), creativeDirectionId: "street-style", references: [product] };
        expect(commerceImageReferences(draft, image, 0, false)).toEqual([product]);
        expect(commerceImagePrompt(draft, image)).toContain("本张画面安排模特");
        expect(commerceImagePrompt(draft, image)).toContain("根据目标市场");
        const white = { ...image, imageType: "white", prompt: "纯白背景商品", composition: "完整商品居中", mainVisual: "商品" };
        expect(commerceImagePrompt(draft, white)).toContain("不添加模特或路人");
        expect(plannerPrompt(draft)).toContain("清新治愈");
    });
});
