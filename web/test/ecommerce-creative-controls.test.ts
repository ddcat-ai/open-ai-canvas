import { describe, expect, test } from "bun:test";
import { emptyEcommerceDraft, projectDraft, type EcommerceProject, type EcommercePlan } from "../src/services/api/ecommerce";
import { commerceAllowsText, creativeControlFields, defaultCreativeOptions, normalizeCreativeOptions } from "../src/pages/ecommerce/creative-controls";
import { assertCommerceClaimsGrounded, assertCommercePlanCurrent, commerceInputSignature, parsePlannerOutput, reviseCommerceFacts } from "../src/pages/ecommerce/planner";
import { commerceImagePrompt, commercePlanningPayload, commercePlanningSource } from "../src/pages/ecommerce/workflow";
import { directCommercePlan } from "../src/pages/ecommerce/direct-plan";
import { typeValidation } from "../src/pages/ecommerce/type-config";
import type { GenerationTask } from "../src/services/api/task-center";

const draft = { ...emptyEcommerceDraft(), productName: "头戴式耳机", imageType: "detail", count: 1, imageModel: "image-model", agentModel: "vision-model", references: [{ resourceId: "headphones", role: "primary" as const }] };
const creativeOptions = { textMode: "rich", copyTone: "lifestyle", fontStyle: "editorial-serif", colorRhythm: "alternating", informationDensity: "detailed", layoutStyle: "feature-cards" } as const;
const planned = (): EcommercePlan => ({
    productSummary: "黑色头戴式耳机，可见弧形头梁与圆形耳罩",
    confirmedFacts: [],
    uncertainFacts: [],
    visualStrategy: "暖灰与炭黑深浅交替，宋体标题，黑体说明，局部细节模块",
    qualityChecks: ["核对可见轮廓"],
    images: [
        {
            id: "image-1",
            imageType: "detail",
            platform: "taobao",
            language: "zh-CN",
            goal: "居家听歌情境",
            theme: "给日常配一首喜欢的歌",
            composition: "偏轴耳机主体与右侧三项说明",
            mainVisual: "黑色头戴式耳机",
            verifiedClaims: "",
            performanceAngle: "场景体验｜围绕可见佩戴结构说明日常使用情境，不推断性能结果",
            informationComponent: "标题导语｜左上标题、两级字号、24px边距，手机端保持高对比",
            copy: "给日常配一首喜欢的歌\n把桌边片刻，留给音乐\n头戴轮廓 · 黑色外观 · 圆形耳罩",
            lighting: "柔和窗光",
            fidelity: "保持可见轮廓",
            prompt: "以耳机为主体，背景为家中书桌",
            negativePrompt: "不改变产品颜色",
            imageModel: draft.imageModel,
            ratio: "1:1",
            resolution: "1k",
        },
    ],
});

describe("commerce creative controls reach every execution path", () => {
    test("single and marketing type choices reach generation with their own purpose", () => {
        const single = { ...draft, imageType: "single", typeOptions: { purpose: "Banner" } };
        expect(typeValidation(single)).toBeNull();
        expect(directCommercePlan(single).images[0].prompt).toContain("Banner");
        const marketing = { ...draft, imageType: "marketing", typeOptions: { materialPlan: JSON.stringify([{ id: "social-post", count: 1, ratio: "3:4" }]) } };
        expect(typeValidation(marketing)).toBeNull();
        expect(directCommercePlan(marketing).images[0].prompt).toContain("图文帖子");
        expect(directCommercePlan(marketing).images[0].ratio).toBe("3:4");
        expect(commercePlanningPayload(marketing, 1, "").prompt).toContain("活动、价格和权益只使用用户明确提供的真实资料");
    });
    test("all six user choices are part of backend planning text and task recovery", () => {
        const selected = { ...draft, imageType: "scene", creativeOptions };
        const payload = commercePlanningPayload(selected, 1, "用户上传的技能方法：标题先说场景，再用真实细节支撑。");
        expect(payload.referenceImages.map((ref) => ref.id)).toEqual(["headphones"]);
        expect(payload.prompt).toContain(JSON.stringify(creativeOptions));
        for (const field of creativeControlFields) {
            expect(payload.prompt).toContain(field.options.find((option) => option.value === creativeOptions[field.key])!.instruction);
        }
        expect(payload.prompt).toContain("用户上传的技能方法");
        expect(payload.prompt).toContain("禁止把内部镜头说明或结构点名当营销标题");
        expect(payload.prompt).toContain("没有实际提供的市场资料或检索结果");
        const task = { inputJson: JSON.stringify({ metadata: { ecommerceDraft: selected } }) } as GenerationTask;
        expect(commercePlanningSource(task).creativeOptions).toEqual(creativeOptions);
    });

    test("changing any creative control invalidates the previous plan", () => {
        const plan = { ...planned(), inputSignature: commerceInputSignature(draft) };
        for (const field of creativeControlFields) {
            const next = field.options.find((option) => option.value !== defaultCreativeOptions[field.key])!;
            expect(() => assertCommercePlanCurrent(plan, { ...draft, creativeOptions: { ...defaultCreativeOptions, [field.key]: next.value } })).toThrow("重新策划");
        }
    });

    test("direct generation and image submission carry the same selected visual controls", () => {
        const selected = { ...draft, imageType: "scene", creativeOptions };
        const direct = directCommercePlan(selected);
        const prompt = commerceImagePrompt(selected, planned().images[0]);
        expect(direct.images[0].prompt).toContain(JSON.stringify(creativeOptions));
        expect(direct.visualStrategy).toContain("浅底/深底交替");
        for (const field of creativeControlFields) expect(prompt).toContain(field.options.find((option) => option.value === creativeOptions[field.key])!.instruction);
        expect(prompt).toContain("标题采用清晰的宋体/衬线字形");
        expect(prompt).toContain(planned().images[0].copy);
        expect(prompt).not.toContain("全套固定光线方向、色温");
    });

    test("detail pages cannot bypass Agent-authored copy through direct generation", () => {
        expect(() => directCommercePlan(draft)).toThrow("详情页必须先由 Agent");
    });

    test("manual prompt remains intact while global controls and no-text choice still apply", () => {
        const selected = { ...draft, creativeOptions: { ...creativeOptions, textMode: "none" as const } };
        const edited = "用新的俯视构图，耳机置于桌面中央";
        const prompt = commerceImagePrompt(selected, { ...planned().images[0], prompt: edited, manualPrompt: true }, "可见黑色耳罩", "旧的金色背景");
        expect(prompt.startsWith(edited)).toBe(true);
        expect(prompt).toContain("宋体/衬线");
        expect(prompt).toContain("纯图规则仍优先");
        expect(prompt).not.toContain(planned().images[0].copy);
        expect(prompt).not.toContain("旧的金色背景");
    });

    test("legacy noText and fixed no-copy types win over rich text everywhere", () => {
        for (const override of [{ noText: true }, { imageType: "white" }, { imageType: "three-view" }, { creativeOptions: { ...creativeOptions, textMode: "none" as const } }]) {
            const selected = { ...draft, creativeOptions, ...override };
            expect(commerceAllowsText(selected)).toBe(false);
            const source = planned();
            source.images[0].imageType = selected.imageType;
            const plan = parsePlannerOutput(JSON.stringify(source), selected);
            expect(plan.images[0].copy).toBe("");
            expect(commerceImagePrompt(selected, source.images[0])).not.toContain(source.images[0].copy);
        }
    });

    test("old saved projects get defaults and invalid values cannot reach a model", () => {
        const saved = projectDraft({ draftJson: JSON.stringify({ ...draft, creativeOptions: undefined }) } as EcommerceProject);
        expect(saved.creativeOptions).toEqual(defaultCreativeOptions);
        expect(normalizeCreativeOptions({ creativeOptions: { ...creativeOptions, fontStyle: "invalid" as never } }).fontStyle).toBe("auto");
        expect(commerceInputSignature({ ...draft, creativeOptions: undefined })).toBe(commerceInputSignature(draft));
    });

    test("missing marketing copy never falls back to an internal image goal", () => {
        const result = planned();
        result.images[0].copy = "";
        expect(() => parsePlannerOutput(JSON.stringify(result), draft)).toThrow("缺少可直接上图的文案");
    });

    test("production instructions are rejected in new plans and saved plans before generation", () => {
        for (const copy of ["握在手里的小小日常\n手持画面呈现瓶与成人手部的相对关系，正面装饰仍清晰可见。", "标题：奶油色里的喂养日常", "主体居中，安全边距 7%", "Composition: place the bottle on the left"]) {
            const result = planned();
            result.images[0].copy = copy;
            expect(() => parsePlannerOutput(JSON.stringify(result), draft)).toThrow("画面说明");
            expect(() => commerceImagePrompt(draft, result.images[0])).toThrow("画面说明");
        }
        const result = planned();
        const parsed = parsePlannerOutput(JSON.stringify(result), draft);
        expect(parsed.images[0].copy).toBe(result.images[0].copy);
        const prompt = commerceImagePrompt(draft, parsed.images[0]);
        expect(prompt).toContain("四边各内缩至少 8%");
        expect(prompt).toContain("长标题主动分为两行");
        expect(prompt).toContain("绝不能作为可见文字");
    });

    test("the same product category does not authorize copied competitor specifications", () => {
        for (const copy of ["蓝牙5.3 稳定连接", "40mm动圈单元", "续航40小时", "40小时续航", "ANC主动降噪", "久戴不压耳"]) {
            const result = planned();
            result.images[0].copy = copy;
            expect(() => assertCommerceClaimsGrounded(result, draft)).toThrow();
        }
        const result = planned();
        result.images[0].copy = "蓝牙5.3\n40mm动圈单元\n续航40小时";
        expect(() => assertCommerceClaimsGrounded(result, { ...draft, specifications: "蓝牙5.2，30mm动圈单元，续航20小时" })).toThrow();
        expect(() => assertCommerceClaimsGrounded(result, { ...draft, specifications: "蓝牙5.3，40mm动圈单元，续航40小时" })).not.toThrow();
        expect(() => assertCommerceClaimsGrounded(result, { ...draft, specifications: "Bluetooth 5.3，40毫米动圈单元，40小时续航" })).not.toThrow();
    });

    test("negative prompt instructions are not treated as affirmative product claims", () => {
        const result = planned();
        result.images[0].prompt = "展示黑色耳机。不要写 ANC 主动降噪、蓝牙5.3、40mm动圈单元或续航40小时。不得宣称久戴不压耳。Do not add waterproof certification.";
        expect(() => assertCommerceClaimsGrounded(result, draft)).not.toThrow();
        result.images[0].prompt = "不支持 ANC 的耳机，仅展示外观。";
        expect(() => assertCommerceClaimsGrounded(result, draft)).not.toThrow();
    });

    test("a negative clause never authorizes a positive occurrence elsewhere", () => {
        for (const prompt of [
            "不要写 ANC。标题宣传 ANC 主动降噪。",
            "不要写 ANC，但标题宣传 ANC 主动降噪。",
            "不要写 ANC，同时强调蓝牙5.3。",
            "Do not add ANC but show Bluetooth 5.3.",
            "不要忘记标注蓝牙5.3。",
            "不得遗漏 ANC 主动降噪卖点。",
            "Do not forget to add Bluetooth 5.3.",
        ]) {
            const result = planned();
            result.images[0].prompt = prompt;
            expect(() => assertCommerceClaimsGrounded(result, draft)).toThrow();
        }
        const result = planned();
        result.images[0].prompt = "不要写 ANC 或续航40小时。";
        result.images[0].copy = "ANC 主动降噪";
        expect(() => assertCommerceClaimsGrounded(result, draft)).toThrow();
    });

    test("one confirmed benefit does not support another or a negated specification", () => {
        const result = planned();
        result.images[0].copy = "久戴不压耳";
        expect(() => assertCommerceClaimsGrounded(result, { ...draft, claims: "低延迟，久戴不夹头" })).toThrow();
        result.images[0].copy = "蓝牙5.3\nANC 主动降噪";
        expect(() => assertCommerceClaimsGrounded(result, { ...draft, specifications: "不支持蓝牙5.3。没有ANC主动降噪。" })).toThrow();
    });

    test("explicit fact review adds verified details without promoting instructions or unknown facts", () => {
        const source = { ...draft, description: "黑色头戴式耳机", instruction: "希望展示40小时续航", planningTaskId: "old-planning-task" };
        const result = planned();
        result.images[0].copy = "蓝牙5.3";
        expect(() => assertCommerceClaimsGrounded(result, source)).toThrow();
        const revised = reviseCommerceFacts(source, ["ANC主动降噪", "40小时续航"], " 蓝牙5.3 ");
        expect(revised.description).toBe("黑色头戴式耳机\n用户已核实的补充资料：蓝牙5.3");
        expect(revised.planningTaskId).toBeUndefined();
        expect(revised.instruction).toContain("希望展示40小时续航");
        expect(revised.instruction).toContain('本轮不采用以下尚未核实的商品主张：["ANC主动降噪","40小时续航"]');
        expect(() => assertCommerceClaimsGrounded(result, revised)).not.toThrow();
        result.images[0].copy = "40小时续航";
        expect(() => assertCommerceClaimsGrounded(result, revised)).toThrow();
        result.images[0].copy = "ANC主动降噪";
        expect(() => assertCommerceClaimsGrounded(result, revised)).toThrow();
        const excludedOnly = reviseCommerceFacts(source, ["蓝牙5.3"], " ");
        expect(excludedOnly.description).toBe(source.description);
        result.images[0].copy = "蓝牙5.3";
        expect(() => assertCommerceClaimsGrounded(result, excludedOnly)).toThrow();
    });
});
