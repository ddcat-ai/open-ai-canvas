import { afterAll, afterEach, expect, mock, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { emptyEcommerceDraft, type EcommerceDraft, type EcommercePlan, type EcommerceProject } from "../src/services/api/ecommerce";
import * as ecommerceApi from "../src/services/api/ecommerce";
import * as workbenchApi from "../src/services/api/workbench";
import * as capabilities from "../src/lib/model-capabilities";
import * as configStore from "../src/stores/use-config-store";
import { assertCommerceClaimsGrounded, assertCommerceDetailRhythm, commerceDefaultPerformanceAngle, parsePlannerOutput, repairCommercePerformanceAngle } from "../src/pages/ecommerce/planner";
import { commerceImageSubmissionConcurrency, commercePlanningPayload, submitCommerceImages } from "../src/pages/ecommerce/workflow";

const dom = new Window({ url: "http://localhost" });
const priorStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: dom.sessionStorage });
afterEach(() => {
    mock.restore();
    dom.sessionStorage.clear();
});

function imageOnlyFixture(count = 9): { draft: EcommerceDraft; plan: EcommercePlan; project: EcommerceProject } {
    const draft = { ...emptyEcommerceDraft(), imageType: "detail", count, agentModel: "test::vision", imageModel: "test::image", ratio: "3:4", resolution: "2k", references: [{ resourceId: "reference-product", role: "primary" as const }] };
    const raw = {
        productSummary: "商品的可见颜色与轮廓",
        confirmedFacts: [],
        uncertainFacts: [],
        qualityChecks: [],
        visualStrategy: "暖白色、窗光、人文黑体",
        images: Array.from({ length: count }, (_, i) => ({
            id: `image-${i + 1}`,
            imageType: "detail",
            platform: draft.platform,
            language: draft.language,
            goal: `购买问题${i + 1}`,
            theme: `主题${i + 1}`,
            composition: i < 2 ? `可见局部微距特写${i + 1}` : `不同机位构图${i + 1}`,
            mainVisual: `商品可见外观${i + 1}`,
            verifiedClaims: "",
            performanceAngle: i % 2 === 0 ? "可见设计｜围绕可见结构说明实际使用动作，不推断性能结果" : "场景体验｜以真实场景与商品搭配回应日常选择，不承诺未证实效果",
            informationComponent: [
                "标题导语｜左上标题、两级字号、24px边距，手机端保持高对比",
                "场景注释｜右侧短说明、细线引导与16px内边距，移动端不遮挡商品",
                "细节放大窗｜左下圆形特写、短标签贴近真实细节，手机端留足商品边距",
                "双栏对照｜上下两区分别展示不同视角，短标题与说明保持清晰易读",
            ][i % 4],
            copy: `原创主题${i + 1}\n日常时刻`,
            lighting: `柔光${i + 1}`,
            fidelity: "保留可见结构和颜色",
            prompt: `第${i + 1}页摄影任务`,
            negativePrompt: "不添加未经证实的功能",
            imageModel: draft.imageModel,
            ratio: draft.ratio,
            resolution: draft.resolution,
        })),
    };
    return { draft, plan: parsePlannerOutput(JSON.stringify(raw), draft), project: { id: "test-project", revision: 1 } as EcommerceProject };
}

function installImageOnlyModelMocks() {
    const profile = capabilities.defaultModelCapabilityConfig();
    profile.image!.references.maxImages = 1;
    profile.image!.size.values = ["3:4"];
    profile.image!.size.default = "3:4";
    profile.image!.resolution.supported = true;
    profile.image!.resolution.values = ["2k"];
    profile.image!.resolution.default = "2k";
    spyOn(capabilities, "modelCapabilityConfigFor").mockReturnValue(profile);
    spyOn(configStore, "resolveModelChannel").mockReturnValue({ id: "test" } as ReturnType<typeof configStore.resolveModelChannel>);
    spyOn(configStore, "logicalModelIDForConfig").mockReturnValue("");
}

test("image-only simulated plans reach nine distinct image requests with original reference", async () => {
    const profile = capabilities.defaultModelCapabilityConfig();
    profile.image!.references.maxImages = 1;
    profile.image!.size.values = ["3:4"];
    profile.image!.size.default = "3:4";
    profile.image!.resolution.supported = true;
    profile.image!.resolution.values = ["2k"];
    profile.image!.resolution.default = "2k";
    spyOn(capabilities, "modelCapabilityConfigFor").mockReturnValue(profile);
    spyOn(configStore, "resolveModelChannel").mockReturnValue({ id: "test" } as ReturnType<typeof configStore.resolveModelChannel>);
    spyOn(configStore, "logicalModelIDForConfig").mockReturnValue("");
    spyOn(ecommerceApi, "saveEcommerceProject").mockImplementation(async (project) => project);
    const requests: Parameters<typeof workbenchApi.createWorkbenchTask>[0][] = [];
    spyOn(workbenchApi, "createWorkbenchTask").mockImplementation(async (request) => {
        requests.push(request);
        return { id: `task-${requests.length}` } as Awaited<ReturnType<typeof workbenchApi.createWorkbenchTask>>;
    });
    const project = { id: "test-project", revision: 1 } as EcommerceProject;
    for (const product of ["奶瓶", "耳机", "未知商品"]) {
        const draft = { ...emptyEcommerceDraft(), imageType: "detail", count: 9, agentModel: "test::vision", imageModel: "test::image", ratio: "3:4", resolution: "2k", references: [{ resourceId: `reference-${product}`, role: "primary" as const }] };
        expect(draft.productName).toBe("");
        expect(commercePlanningPayload(draft, 1).referenceImages[0].id).toBe(`reference-${product}`);
        const strategy = `${product}系列：暖白色、窗光、人文黑体`;
        const fixture: EcommercePlan = {
            productSummary: `${product}的可见颜色与轮廓`,
            confirmedFacts: [],
            uncertainFacts: [],
            qualityChecks: [],
            visualStrategy: strategy,
            images: Array.from({ length: 9 }, (_, i) => ({
                id: `image-${i + 1}`,
                imageType: "detail",
                platform: draft.platform,
                language: draft.language,
                goal: `购买问题${i + 1}`,
                theme: `主题${i + 1}`,
                composition: i < 2 ? `可见局部微距特写${i + 1}` : `不同机位构图${i + 1}`,
                mainVisual: `${product}可见外观${i + 1}`,
                verifiedClaims: "",
                performanceAngle: i % 2 === 0 ? "可见设计｜围绕可见结构说明实际使用动作，不推断性能结果" : "场景体验｜以真实场景与商品搭配回应日常选择，不承诺未证实效果",
                informationComponent: [
                    "标题导语｜左上标题、两级字号、24px边距，手机端保持高对比",
                    "场景注释｜右侧短说明、细线引导与16px内边距，移动端不遮挡商品",
                    "细节放大窗｜左下圆形特写、短标签贴近真实细节，手机端留足商品边距",
                    "双栏对照｜上下两区分别展示不同视角，短标题与说明保持清晰易读",
                ][i % 4],
                copy: `原创主题${i + 1}\n日常时刻`,
                lighting: `柔光${i + 1}`,
                fidelity: "保留可见结构和颜色",
                prompt: `${product}第${i + 1}页摄影任务`,
                negativePrompt: "不添加未经证实的功能",
                imageModel: draft.imageModel,
                ratio: draft.ratio,
                resolution: draft.resolution,
            })),
        };
        const plan = parsePlannerOutput(JSON.stringify(fixture), draft);
        expect(() => assertCommerceClaimsGrounded(plan, draft)).not.toThrow();
        const start = requests.length;
        await submitCommerceImages(configStore.defaultConfig, draft, plan, project, () => {});
        const batch = requests.slice(start);
        expect(batch).toHaveLength(9);
        for (const [i, request] of batch.entries()) {
            expect(request.prompt).toContain(fixture.images[i].prompt);
            expect(request.prompt).toContain(fixture.images[i].copy);
            expect(request.prompt).toContain(strategy);
            expect(request.references).toEqual([{ resourceId: `reference-${product}`, kind: "image", role: "reference" }]);
        }
        expect(new Set(batch.map((request) => request.prompt)).size).toBe(9);
    }
});

test("an unsupported specific claim is rejected for an image-only product", () => {
    const draft = { ...emptyEcommerceDraft(), imageType: "detail", references: [{ resourceId: "product", role: "primary" as const }] };
    const plan = { images: [{ prompt: "主动降噪", copy: "音乐时刻" }] } as EcommercePlan;
    expect(() => assertCommerceClaimsGrounded(plan, draft)).toThrow("未经真实资料支持");
});

test("nine-page detail plans reject repeated performance angles and missing closeups", () => {
    const { draft, plan } = imageOnlyFixture();
    expect(() => assertCommerceDetailRhythm(plan, draft)).not.toThrow();
    const repetitive = structuredClone(plan);
    repetitive.images.forEach((image) => {
        image.performanceAngle = "同一体验角度";
    });
    expect(() => assertCommerceDetailRhythm(repetitive, draft)).toThrow("两种不同的性能/体验");
    const noCloseups = structuredClone(plan);
    noCloseups.images.forEach((image) => {
        image.composition = "完整商品居中展示";
    });
    expect(() => assertCommerceDetailRhythm(noCloseups, draft)).toThrow("两张局部近景");
});

test("near-miss performance labels are repaired like the server, and a set's detail pages never fail the plan", () => {
    // Same table as the server's TestRepairEcommercePerformanceAngleFilesNearMisses.
    const parity: Array<[string, string]> = [
        ["可见设计｜围绕可见杯柄展开", "可见设计｜围绕可见杯柄展开"],
        ["选购决策：适合新手家长", "选购决策：适合新手家长"],
        ["选购决策角度：说明为什么适合新手", "选购决策｜说明为什么适合新手"],
        ["已证实性能/可见设计角度：刻度清楚", "已证实性能｜已证实性能/可见设计角度：刻度清楚"],
        ["【场景体验】周末出门", "场景体验｜周末出门"],
        ["场景体验 在户外野餐时使用", "场景体验｜在户外野餐时使用"],
        ["可见设计|宽口径方便冲调", "可见设计｜宽口径方便冲调"],
        ["使用情境：通勤路上", "场景体验｜使用情境：通勤路上"],
        ["场景：夜间喂养", "场景体验｜场景：夜间喂养"],
        ["可见结构：宽口径", "可见设计｜可见结构：宽口径"],
        ["外观：圆润瓶身", "可见设计｜外观：圆润瓶身"],
        ["操作步骤：三步冲调", "实际操作｜操作步骤：三步冲调"],
        ["信任背书：家长关心的细节", "选购决策｜信任背书：家长关心的细节"],
        ["购买疑问解答：如何清洗", "选购决策｜购买疑问解答：如何清洗"],
        ["性能/体验利益：刻度清晰", "已证实性能｜性能/体验利益：刻度清晰"],
    ];
    for (const [angle, want] of parity) for (const fallback of [false, true]) expect(repairCommercePerformanceAngle(angle, fallback)).toBe(want);
    const loose = "围绕可见结构说明实际使用动作，不推断性能结果";
    expect(repairCommercePerformanceAngle(loose, false)).toBe(loose);
    expect(repairCommercePerformanceAngle(loose, true)).toBe(`可见设计｜${loose}`);
    expect(repairCommercePerformanceAngle("", true)).toBe(commerceDefaultPerformanceAngle);

    // A detail draft accepts near misses but still rejects an angle without any category.
    const { draft, plan } = imageOnlyFixture();
    const nearMiss = structuredClone(plan);
    nearMiss.images[0].performanceAngle = "选购决策角度：说明为什么适合新手";
    nearMiss.images[1].performanceAngle = "已证实性能/可见设计角度：刻度清楚";
    const parsed = parsePlannerOutput(JSON.stringify(nearMiss), draft);
    expect(parsed.images[0].performanceAngle).toBe("选购决策｜说明为什么适合新手");
    expect(parsed.images[1].performanceAngle?.startsWith("已证实性能｜")).toBe(true);
    const unlabelled = structuredClone(plan);
    unlabelled.images[0].performanceAngle = loose;
    expect(() => parsePlannerOutput(JSON.stringify(unlabelled), draft)).toThrow("缺少策划分类");
    const rhythm = structuredClone(plan);
    rhythm.images.forEach((image, i) => {
        image.performanceAngle = i % 2 ? "选购决策角度：怎么选" : "使用情境：通勤路上";
    });
    expect(() => assertCommerceDetailRhythm(rhythm, draft)).not.toThrow();

    // A product set with detail-type pages files them under a category instead of failing.
    const set = { ...draft, imageType: "set", count: 3 };
    const mixed = {
        ...structuredClone(plan),
        images: [
            { ...plan.images[0], imageType: "main", performanceAngle: "" },
            { ...plan.images[1], imageType: "detail", performanceAngle: loose, informationComponent: "左侧标题" },
            { ...plan.images[2], imageType: "detail", performanceAngle: "" },
        ],
    };
    expect(parsePlannerOutput(JSON.stringify(mixed), set).images.map((image) => image.performanceAngle)).toEqual(["", `可见设计｜${loose}`, commerceDefaultPerformanceAngle]);
});

test("自动 images are generated at the platform recommendation only when the model supports it", async () => {
    installImageOnlyModelMocks();
    const profile = capabilities.modelCapabilityConfigFor(configStore.defaultConfig, "test::image").image!;
    profile.size.values = ["auto", "1:1", "3:4"];
    profile.size.default = "auto";
    spyOn(ecommerceApi, "saveEcommerceProject").mockImplementation(async (project) => project);
    const requests: Parameters<typeof workbenchApi.createWorkbenchTask>[0][] = [];
    spyOn(workbenchApi, "createWorkbenchTask").mockImplementation(async (request) => {
        requests.push(request);
        return { id: `task-${requests.length}` } as Awaited<ReturnType<typeof workbenchApi.createWorkbenchTask>>;
    });
    const fixture = imageOnlyFixture();
    const draft = { ...fixture.draft, ratio: "auto" };
    const plan = parsePlannerOutput(JSON.stringify(fixture.plan), draft);
    expect(plan.images.every((image) => image.ratio === "auto")).toBe(true);
    // 淘宝 detail pages: 3:4.
    await submitCommerceImages(configStore.defaultConfig, draft, plan, fixture.project, () => {});
    expect(requests.map((request) => request.parameters?.size)).toEqual(Array(9).fill("3:4"));
    expect(requests[0].prompt).toContain("按 3:4 原生构图");
    // A model without that ratio keeps its own auto size, as before.
    profile.size.values = ["auto", "1:1"];
    requests.length = 0;
    sessionStorage.clear();
    await submitCommerceImages(configStore.defaultConfig, draft, plan, fixture.project, () => {});
    expect(requests.map((request) => request.parameters?.size)).toEqual(Array(9).fill("auto"));
});

test("image submissions stay at three in flight and map completed tasks back to page order", async () => {
    installImageOnlyModelMocks();
    const { draft, plan, project } = imageOnlyFixture();
    const savedPlans: EcommercePlan[] = [];
    spyOn(ecommerceApi, "saveEcommerceProject").mockImplementation(async (savedProject, _draft, savedPlan) => {
        if (savedPlan) savedPlans.push(savedPlan);
        return savedProject;
    });
    let active = 0;
    let maximum = 0;
    const requests: Parameters<typeof workbenchApi.createWorkbenchTask>[0][] = [];
    spyOn(workbenchApi, "createWorkbenchTask").mockImplementation(async (request) => {
        requests.push(request);
        active++;
        maximum = Math.max(maximum, active);
        const page = Number(request.prompt.match(/第(\d+)页摄影任务/)?.[1]);
        await new Promise((resolve) => setTimeout(resolve, page === 1 ? 20 : page % 2 ? 3 : 1));
        active--;
        return { id: `task-page-${page}` } as Awaited<ReturnType<typeof workbenchApi.createWorkbenchTask>>;
    });
    const result = await submitCommerceImages(configStore.defaultConfig, draft, plan, project, () => {});
    expect(maximum).toBe(commerceImageSubmissionConcurrency);
    expect(requests).toHaveLength(9);
    expect(result.plan.images.map((image) => image.taskId)).toEqual(Array.from({ length: 9 }, (_, i) => `task-page-${i + 1}`));
    expect(savedPlans.at(-1)?.images.map((image) => image.taskId)).toEqual(Array.from({ length: 9 }, (_, i) => `task-page-${i + 1}`));
});

test("a failed page is retained for a later retry while successful pages are saved", async () => {
    installImageOnlyModelMocks();
    const { draft, plan, project } = imageOnlyFixture();
    const savedPlans: EcommercePlan[] = [];
    spyOn(ecommerceApi, "saveEcommerceProject").mockImplementation(async (savedProject, _draft, savedPlan) => {
        if (savedPlan) savedPlans.push(savedPlan);
        return savedProject;
    });
    const attempts = new Map<number, number>();
    const requests: number[] = [];
    spyOn(workbenchApi, "createWorkbenchTask").mockImplementation(async (request) => {
        const page = Number(request.prompt.match(/第(\d+)页摄影任务/)?.[1]);
        requests.push(page);
        const attempt = (attempts.get(page) || 0) + 1;
        attempts.set(page, attempt);
        if (page === 2 && attempt === 1) throw new Error("page 2 failed");
        return { id: `task-page-${page}-attempt-${attempt}` } as Awaited<ReturnType<typeof workbenchApi.createWorkbenchTask>>;
    });
    await expect(submitCommerceImages(configStore.defaultConfig, draft, plan, project, () => {})).rejects.toThrow("page 2 failed");
    const partial = savedPlans.at(-1);
    expect(partial?.images[1].taskId).toBeUndefined();
    expect(partial?.images.filter((image) => image.taskId)).toHaveLength(8);
    const retried = await submitCommerceImages(configStore.defaultConfig, draft, partial!, project, () => {});
    expect(requests.filter((page) => page === 2)).toHaveLength(2);
    expect(retried.plan.images.every((image) => Boolean(image.taskId))).toBe(true);
});

afterAll(() => {
    if (priorStorage) Object.defineProperty(globalThis, "sessionStorage", priorStorage);
    else Reflect.deleteProperty(globalThis, "sessionStorage");
    dom.happyDOM.abort();
});
