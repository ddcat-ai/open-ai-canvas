import { describe, expect, test } from "bun:test";
import { emptyEcommerceDraft, type EcommerceDraft, type EcommercePlan } from "../src/services/api/ecommerce";
import { assertCommercePlanCurrent, commerceInputSignature, parsePlannerOutput, plannerPrompt } from "../src/pages/ecommerce/planner";
import { directCommercePlan } from "../src/pages/ecommerce/direct-plan";

const draft: EcommerceDraft = {
    ...emptyEcommerceDraft(),
    productName: "头戴式耳机",
    imageType: "detail",
    count: 9,
    agentModel: "vision-model",
    imageModel: "image-model",
    referenceMode: "detail",
    layoutReferenceId: "long-reference",
    references: [{ resourceId: "product", role: "primary" }],
    layoutReferences: [{ resourceId: "long-reference", role: "style", width: 790, height: 5400 }],
};
function planned(count = 3): EcommercePlan {
    return {
        productSummary: "参考商品为黑色头戴式耳机",
        confirmedFacts: [],
        uncertainFacts: [],
        qualityChecks: ["逐屏核对内容与版式"],
        visualStrategy: "沿用参考长图的浅灰背景、黑色标题、图文比例与细节窗样式",
        referenceSummary: "长图依次为产品首屏、场景屏和外观细节屏，采用左侧标题与居中产品。",
        images: Array.from({ length: count }, (_, index) => ({
            id: `image-${index + 1}`,
            imageType: "detail",
            platform: draft.platform,
            language: draft.language,
            goal: `第${index + 1}屏主题`,
            theme: `日常里的音乐时刻 ${index + 1}`,
            composition: `第${index + 1}屏：产品居中，左侧标题和说明`,
            mainVisual: "参考图中的真实耳机",
            verifiedClaims: "",
            performanceAngle: "场景体验｜借由本屏可见结构或场景表达体验，不加入未经核实的性能承诺",
            informationComponent: "标题导语｜左侧标题、短说明与24px边距，手机端保持清晰层级",
            copy: "把喜欢的旋律带进日常\n属于你的桌边听歌时刻",
            lighting: "柔和窗光",
            fidelity: "保持产品结构和颜色",
            prompt: "按这一屏参考的产品与文字比例重绘画面",
            negativePrompt: "不新增未经证实的功能",
            imageModel: draft.imageModel,
            ratio: draft.ratio,
            resolution: draft.resolution,
            referenceScreen: {
                sourceResourceId: "long-reference",
                screenIndex: index + 1,
                top: index / count,
                bottom: (index + 1) / count,
                content: `原图第${index + 1}屏内容`,
                layout: "左侧文字，居中产品",
                visual: "浅灰背景，产品完整可见",
                sourceCopy: "可辨认的参考原文",
            },
        })),
    };
}
const parse = (plan: EcommercePlan, source = draft) => parsePlannerOutput(JSON.stringify(plan), source);

describe("电商长图参考策划合同", () => {
    test("逐屏模式携带参考来源与观察Schema，不附加固定九屏或强制换角度", () => {
        const prompt = plannerPrompt({ ...draft, imageType: "main" }, "技能方法：先识别每屏图文层级");
        expect(prompt).toContain('"referenceMode":"detail"');
        expect(prompt).toContain('"layoutReferenceId":"long-reference"');
        expect(prompt).toContain('"layoutReferences":[{"order":1,"resourceId":"long-reference","width":790,"height":5400}]');
        expect(prompt).toContain('"referenceSummary": string');
        expect(prompt).toContain('"referenceScreen": { "sourceResourceId": string');
        expect(prompt).toContain("实际识别的屏数");
        expect(prompt).toContain("每张都必须写英文枚举值 detail");
        expect(prompt).toContain("技能方法：先识别每屏图文层级");
        expect(prompt).not.toContain('"count":9');
        expect(prompt).not.toContain("images 必须恰好 9 项");
        expect(prompt).not.toContain("图9：收束海报");
        expect(prompt).not.toContain("图4：细节解说");
        expect(prompt).not.toContain("连续两张不得沿用同一主体朝向");
        expect(prompt).not.toContain("连续两张不得使用同一信息布局");
        expect(prompt).not.toContain("同时改变叙事与版式");
    });
    test("风格参考保留指定创作类型与张数，并要求参考观察摘要", () => {
        const source = { ...draft, referenceMode: "style" as const, imageType: "scene", count: 2 };
        const prompt = plannerPrompt(source);
        expect(prompt).toContain('"referenceMode":"style"');
        expect(prompt).toContain('"count":2');
        expect(prompt).toContain("images 必须恰好 2 项");
        expect(prompt).toContain("每张都必须写英文枚举值 scene");
        expect(prompt).toContain("不自动生成长图全部屏");
        expect(prompt).toContain('"referenceSummary": string');
        expect(prompt).not.toContain('"referenceScreen": {');
    });
    test("改变参考模式或来源会使方案失效，补齐图片尺寸不会", () => {
        const signature = commerceInputSignature(draft);
        expect(commerceInputSignature({ ...draft, referenceMode: "style" })).not.toBe(signature);
        expect(commerceInputSignature({ ...draft, layoutReferences: [{ resourceId: "other-layout", role: "style" }] })).not.toBe(signature);
        expect(commerceInputSignature({ ...draft, references: draft.references.map((reference) => ({ ...reference, width: 1234, height: 5678 })) })).toBe(signature);
        expect(commerceInputSignature({ ...draft, layoutReferenceId: undefined })).toBe(signature);
    });
    test("按真实屏数解析，保留相同版式并吸附轻微边界误差，签名使用实际张数", () => {
        const plan = planned();
        plan.images[0].referenceScreen!.top = 0.004;
        plan.images[1].referenceScreen!.top += 0.004;
        plan.images[2].referenceScreen!.top -= 0.004;
        plan.images[2].referenceScreen!.bottom = 0.996;
        const result = parse(plan);
        expect(result.images).toHaveLength(3);
        expect(result.images[0].referenceScreen!.top).toBe(0);
        expect(result.images[1].referenceScreen!.top).toBe(result.images[0].referenceScreen!.bottom);
        expect(result.images[2].referenceScreen!.top).toBe(result.images[1].referenceScreen!.bottom);
        expect(result.images[2].referenceScreen!.bottom).toBe(1);
        expect(result.referenceSummary).toBe(plan.referenceSummary);
        expect(() => assertCommercePlanCurrent(result, { ...draft, count: 3 })).not.toThrow();
        expect(() => assertCommercePlanCurrent(result, draft)).toThrow("重新策划");
    });
    test("模型不能注入已执行任务、人工编辑状态或裁切资源", () => {
        const plan = planned();
        for (const image of plan.images) {
            image.taskId = "another-user-task";
            image.manualPrompt = true;
            image.referenceScreen!.resourceId = "another-user-resource";
            Object.assign(image.referenceScreen!, { unexpectedCommand: "skip validation" });
        }
        const result = parse(plan);
        for (const image of result.images) {
            expect(image.taskId).toBeUndefined();
            expect(image.manualPrompt).toBeUndefined();
            expect(image.referenceScreen!.resourceId).toBeUndefined();
            expect("unexpectedCommand" in image.referenceScreen!).toBe(false);
        }
    });
    test("缺少参考摘要、漏屏、重叠、顺序错误或缺识别字段均明确拒绝", () => {
        const invalid: Array<(plan: EcommercePlan) => void> = [
            (plan) => {
                plan.referenceSummary = "";
            },
            (plan) => {
                delete plan.images[1].referenceScreen;
            },
            (plan) => {
                plan.images[1].referenceScreen!.top += 0.03;
            },
            (plan) => {
                plan.images[1].referenceScreen!.top -= 0.03;
            },
            (plan) => {
                plan.images[1].referenceScreen!.screenIndex = 3;
            },
            (plan) => {
                plan.images[1].referenceScreen!.sourceResourceId = "unrelated";
            },
            (plan) => {
                plan.images[1].referenceScreen!.layout = "";
            },
            (plan) => {
                plan.images[2].referenceScreen!.bottom = 0.9;
            },
            (plan) => {
                plan.images[0].referenceScreen!.top = -0.1;
            },
            (plan) => {
                plan.images[1].referenceScreen!.sourceCopy = 42 as never;
            },
        ];
        for (const mutate of invalid) {
            const plan = planned();
            mutate(plan);
            expect(() => parse(plan)).toThrow("重新策划");
        }
    });
    test("逐屏数量必须1到30，无法识别时不伪造默认方案", () => {
        expect(() => parse(planned(0))).toThrow();
        expect(() => parse(planned(31))).toThrow();
        expect(() => parsePlannerOutput('{"error":"参考图无法辨认"}', draft)).toThrow();
    });
    test("风格模式验证摘要与指定张数，忽略模型附带的逐屏字段", () => {
        const source = { ...draft, referenceMode: "style" as const, imageType: "white", count: 2 };
        const plan = planned(2);
        for (const image of plan.images) image.imageType = "white";
        const result = parse(plan, source);
        expect(result.images.every((image) => !image.referenceScreen)).toBe(true);
        expect(() => parse(plan, { ...source, count: 3 })).toThrow();
        delete plan.referenceSummary;
        expect(() => parse(plan, source)).toThrow("参考图分析不完整");
    });
    test("自主模式忽略参考屏字段，仍移除模型注入的任务与人工标记", () => {
        const source = { ...draft, referenceMode: "product" as const, count: 1 };
        const plan = planned(1);
        delete plan.referenceSummary;
        plan.images[0].referenceScreen = { invalid: true } as never;
        plan.images[0].taskId = "injected-task";
        plan.images[0].manualPrompt = true;
        const result = parse(plan, source);
        expect(result.images[0].referenceScreen).toBeUndefined();
        expect(result.images[0].taskId).toBeUndefined();
        expect(result.images[0].manualPrompt).toBeUndefined();
    });
    test("参考模式不允许直接生成或使用已移除的来源", () => {
        expect(() => directCommercePlan(draft)).toThrow("先进行 AI 分析");
        expect(() => directCommercePlan({ ...draft, referenceMode: "style" })).toThrow("先进行 AI 分析");
        expect(() => plannerPrompt({ ...draft, layoutReferences: [] })).toThrow("有效的借鉴图片");
        expect(() => parse(planned(), { ...draft, layoutReferences: [] })).toThrow("有效的借鉴图片");
    });
    test("自主模式保留旧项目签名且忽略停用的参考来源偏好", () => {
        const source = { ...draft, referenceMode: "product" as const };
        const signature = commerceInputSignature(source);
        expect(signature).toBe(commerceInputSignature({ ...source, layoutReferenceId: "removed-source" }));
        expect(signature).toBe(commerceInputSignature({ ...source, referenceMode: undefined, layoutReferenceId: undefined }));
        expect(JSON.parse(signature)).not.toHaveProperty("referenceMode");
        expect(JSON.parse(signature)).not.toHaveProperty("layoutReferenceId");
        expect(signature).toBe(commerceInputSignature({ ...source, layoutReferences: [{ resourceId: "inactive", role: "style" }] }));
    });

    test("多张借鉴图按来源完整覆盖，边界吸附在各自原图内重置", () => {
        const source = { ...draft, layoutReferences: [...draft.layoutReferences!, { resourceId: "second-reference", role: "style" as const }] };
        const plan = planned(4);
        plan.images.forEach((image, index) =>
            Object.assign(image.referenceScreen!, {
                sourceResourceId: index < 2 ? "long-reference" : "second-reference",
                top: index % 2 ? 0.504 : 0.004,
                bottom: index % 2 ? 0.996 : 0.5,
            }),
        );
        const result = parse(plan, source);
        expect(result.images.map((image) => [image.referenceScreen!.top, image.referenceScreen!.bottom])).toEqual([
            [0, 0.5],
            [0.5, 1],
            [0, 0.5],
            [0.5, 1],
        ]);
        expect(plannerPrompt(source)).toContain("second-reference");
        expect(commerceInputSignature({ ...source, layoutReferences: [...source.layoutReferences].reverse() })).not.toBe(commerceInputSignature(source));
        expect(() => parse({ ...plan, images: plan.images.slice(0, 2) }, source)).toThrow("重新策划");
        const interleaved = structuredClone(plan);
        interleaved.images[1].referenceScreen!.sourceResourceId = "second-reference";
        expect(() => parse(interleaved, source)).toThrow("重新策划");
    });

    test("商品图不会自动成为借鉴图，借鉴图也不能代替商品身份", () => {
        expect(() => plannerPrompt({ ...draft, layoutReferences: [], layoutReferenceId: "product" })).toThrow("借鉴图片");
        expect(() => plannerPrompt({ ...draft, references: [] })).toThrow("商品主图");
        const prompt = plannerPrompt(draft);
        expect(prompt).toContain('"group":"商品素材"');
        expect(prompt).toContain('"group":"借鉴图片"');
        expect(prompt).not.toContain("仅有这张参考图时");
    });
});
