import { describe, expect, test } from "bun:test";
import { emptyEcommerceDraft, type EcommercePlanImage } from "../src/services/api/ecommerce";
import { directCommercePlan } from "../src/pages/ecommerce/direct-plan";
import { commerceNarrativeDirection, commerceSeriesDirection, commerceShotDirection } from "../src/pages/ecommerce/art-direction";
import { commerceImagePrompt, commerceImageReferences, commercePlanningPayload } from "../src/pages/ecommerce/workflow";

const draft = {
    ...emptyEcommerceDraft(),
    productName: "陶瓷杯",
    imageType: "detail",
    count: 9,
    imageModel: "selected-image-model",
    agentModel: "selected-vision-model",
    ratio: "3:4",
    resolution: "2k",
    references: [{ resourceId: "cup-reference", role: "primary" as const }],
};
const image: EcommercePlanImage = {
    id: "image-1",
    imageType: "detail",
    platform: "taobao",
    language: "zh-CN",
    goal: "展示可见杯柄",
    theme: "弧线有度",
    composition: "偏轴中景，左侧文案",
    mainVisual: "参考图中的杯子",
    verifiedClaims: "",
    performanceAngle: "可见设计｜从可见杯柄轮廓展开日常拿取体验，不推断材质或承重能力",
    copy: "弧线有度\n从可见轮廓发现设计细节",
    lighting: "左上方柔光",
    fidelity: "保持杯柄形状和釉面颜色",
    prompt: "完整呈现参考杯，左侧排版",
    negativePrompt: "不添加内部夹层",
    imageModel: draft.imageModel,
    ratio: draft.ratio,
    resolution: draft.resolution,
};

describe("ecommerce series art direction", () => {
    test("a single product reference supports a nine-page, fact-aware narrative", () => {
        const payload = commercePlanningPayload({ ...draft, productName: "" }, 1);
        expect(payload.referenceImages.map((ref) => ref.id)).toEqual(["cup-reference"]);
        expect(payload.prompt).toContain("图9：收束海报");
        // Middle modules are reshuffled on every plan; the detail module still lands on a middle page.
        expect(payload.prompt).toMatch(/图[2-8]：细节解说/);
        expect(payload.prompt).toContain("不编造数值、包装或配件");
        expect(payload.prompt).toContain("主色/辅助色/强调色");
        expect(payload.prompt).toContain("未填品牌、颜色、卖点、材质或风格参考");
        expect(payload.prompt).toContain(`imageModel 固定为 ${draft.imageModel}`);
    });

    test("approved art direction actually reaches the image model together with exact copy", () => {
        const strategy = "奶油白与陶土橙，暖白纸感背景，深棕衬线标题，单线图标，左上方窗光。";
        const prompt = commerceImagePrompt(draft, image, "米白杯身，弧形杯柄", strategy);
        expect(prompt).toContain(strategy);
        expect(prompt).toContain(image.copy);
        expect(prompt).toContain(image.composition);
        expect(prompt).toContain("本次只输出当前这一张完整成品");
        expect(prompt).toContain("full bleed edge-to-edge");
        expect(prompt).toContain("禁止上下黑条");
        expect(prompt).toContain("接触阴影");
        expect(prompt).toContain("8%–92%");
        expect(prompt).toContain("20%–30%");
        expect(prompt).toContain("生成阶段保留已审阅文案全文");
        expect(prompt).toContain("没有内部结构资料时，不绘制写实爆炸图");
        // 多张套图先写程序分配的本张展示，紧接着才是策划给出的本张提示词。
        expect(prompt.startsWith("【本张展示·强制】本套共 9 张，这是第 1 张。")).toBe(true);
        expect(prompt.split("\n\n")[1]).toBe(image.prompt);
    });

    test("manual prompt override does not reintroduce the old series style or old copy", () => {
        const prompt = commerceImagePrompt(draft, { ...image, manualPrompt: true, prompt: "改为冷灰背景和右侧标题" }, "真实杯柄", "旧金色背景与红色字体");
        expect(prompt).toContain("改为冷灰背景和右侧标题");
        expect(prompt).not.toContain("旧金色背景");
        expect(prompt).not.toContain(image.copy);
        expect(prompt).toContain("8%–92%");
    });

    test("no-text mode preserves the shared palette while suppressing marketing copy", () => {
        const prompt = commerceImagePrompt({ ...draft, noText: true }, image, "米白杯身", "米白与陶土橙，左侧柔光");
        expect(prompt).toContain("米白与陶土橙，左侧柔光");
        expect(prompt).toContain("无文字模式：不添加标题、说明、图标标签或装饰字");
        expect(prompt).not.toContain(image.copy);
        expect(commerceSeriesDirection({ ...draft, imageType: "white" })).toContain("白底图保持纯白");
    });

    test("direct generation retains options and gains distinct content without claiming analysis", () => {
        const plan = directCommercePlan({ ...draft, imageType: "scene", instruction: "第九张只展示商品，不添加优惠", noText: true });
        expect(plan.productSummary).toContain("未调用 AI 策划");
        expect(new Set(plan.images.map((entry) => entry.composition)).size).toBe(9);
        expect(plan.images.every((entry) => entry.copy === "" && entry.imageModel === draft.imageModel && entry.ratio === "3:4" && entry.resolution === "2k")).toBe(true);
        expect(plan.images[8].prompt).toContain("本张仅展示商品和场景");
        expect(plan.images[8].prompt).toContain("第九张只展示商品，不添加优惠");
        expect(plan.visualStrategy).toContain("真实商品图");
    });

    test("product-only direct shots do not accidentally attach the model reference", () => {
        const withModel = { ...draft, imageType: "scene", count: 4, modelEnabled: true, references: [...draft.references, { resourceId: "model-reference", role: "model" as const }] };
        const plan = directCommercePlan(withModel);
        expect(commerceImageReferences(withModel, plan.images[0], 0, false).map((ref) => ref.resourceId)).toEqual(["cup-reference", "model-reference"]);
        expect(commerceImageReferences(withModel, plan.images[1], 1, false).map((ref) => ref.resourceId)).toEqual(["cup-reference"]);
    });

    test("narrative adapts to selected counts and fixed-layout types retain their contracts", () => {
        expect(commerceNarrativeDirection({ ...draft, count: 3 }).match(/图\d+：/g)).toHaveLength(3);
        expect(commerceShotDirection({ ...draft, count: 1 }, 0)).toContain("品牌视觉首屏");
        expect(commerceShotDirection({ ...draft, imageType: "sku" }, 0)).toBe(commerceShotDirection({ ...draft, imageType: "sku" }, 1));
        expect(commerceNarrativeDirection({ ...draft, imageType: "white" })).toBe("");
    });

    test("a closed toilet reference can yield an open-lid concept without invented internals", () => {
        const toilet = { ...draft, productName: "白色马桶", count: 5 };
        const payload = commercePlanningPayload(toilet, 1);
        expect(payload.prompt).toContain("只上传闭合马桶");
        expect(payload.prompt).toContain("盖板打开");
        expect(payload.prompt).toContain("视觉探索");
        expect(payload.prompt).toContain("不能画出未经提供的机芯、管道");
        expect(commerceSeriesDirection(toilet)).toContain("概念式分层悬浮");
        expect(commerceSeriesDirection({ ...toilet, imageType: "white" })).toContain("白底图保持纯白");
    });
});
