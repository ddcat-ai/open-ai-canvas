import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { setActiveUserScope } from "@/lib/user-scope";
import { apiClient } from "@/services/api/request";
import { emptyEcommerceDraft, projectDraft, projectPlan, saveEcommerceProject, type EcommerceDraft, type EcommercePlan, type EcommercePlanImage, type EcommerceProject } from "@/services/api/ecommerce";
import { clearResourceAccessCache } from "@/services/api/resources";
import { commerceLayoutReference, commerceReferenceViewRanges, normalizeReferenceDraft, validateCommerceReferencePlan } from "@/pages/ecommerce/reference-plan";
import { commerceReferenceCropBounds, prepareCommerceReferencePlan, prepareCommerceReferenceViews } from "@/pages/ecommerce/long-reference-media";
import { commerceImagePrompt, commerceImageReferences, commerceRequiredImageReferenceCount, prepareCommercePlanningPayload } from "@/pages/ecommerce/workflow";
import { activeCommerceReferences, commercePlanningReferenceCount } from "@/pages/ecommerce/model-context";

const dom = new Window({ url: "https://commerce.example.com/ecommerce" });
const globals = new Map<string, PropertyDescriptor | undefined>();
const adapter = apiClient.defaults.adapter;
beforeAll(() => {
    for (const [key, value] of Object.entries({ location: dom.location, window: dom })) {
        globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
        Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    }
});
beforeEach(() => {
    clearResourceAccessCache();
    setActiveUserScope("long-reference-owner");
});
afterEach(() => {
    apiClient.defaults.adapter = adapter;
    clearResourceAccessCache();
    setActiveUserScope(null);
});
afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of globals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

function referenceDraft(): EcommerceDraft {
    return {
        ...emptyEcommerceDraft(),
        productName: "参考耳机",
        imageType: "detail",
        count: 3,
        referenceMode: "detail",
        layoutReferenceId: "long-reference",
        agentModel: "vision",
        imageModel: "image",
        references: [{ resourceId: "product-photo", role: "primary", name: "自己的商品图" }],
        layoutReferences: [{ resourceId: "long-reference", role: "style", name: "耳机详情长图", width: 800, height: 3600 }],
    };
}

function screenImage(index: number, top: number, bottom: number, resourceId?: string): EcommercePlanImage {
    return {
        id: `screen-${index}`,
        imageType: "detail",
        platform: "taobao",
        language: "zh-CN",
        goal: "展示参考图中的商品",
        theme: `第${index}屏`,
        composition: "左文右图",
        mainVisual: "黑色头戴耳机",
        verifiedClaims: "黑色外观",
        copy: "听见日常的层次",
        lighting: "柔和侧光",
        fidelity: "保留商品外观",
        prompt: "以用户参考商品重新设计本屏画面",
        negativePrompt: "不添加未核实规格",
        imageModel: "image",
        ratio: "3:4",
        resolution: "1k",
        referenceScreen: { sourceResourceId: "long-reference", screenIndex: index, top, bottom, content: "场景与商品细节", layout: "左文右图", visual: "浅色背景", sourceCopy: "参考图上的文字", ...(resourceId ? { resourceId } : {}) },
    };
}

function referencePlan(images = [screenImage(1, 0, 1 / 3), screenImage(2, 1 / 3, 2 / 3), screenImage(3, 2 / 3, 1)]): EcommercePlan {
    return { productSummary: "参考图中的黑色头戴耳机", confirmedFacts: ["黑色外观"], uncertainFacts: [], visualStrategy: "从场景到细节逐屏展开", qualityChecks: [], referenceSummary: "原长图包含场景、细节、收束三屏", images };
}

const project: EcommerceProject = { id: "long-project", name: "长图项目", status: "draft", revision: 4, draftJson: "{}", planJson: "null", createdAt: "2026-10-25T08:00:00Z", updatedAt: "2026-10-25T08:00:00Z" };

describe("ecommerce long reference persistence", () => {
    test("old projects without a reference mode reopen in product mode", () => {
        const legacy = { ...referenceDraft(), referenceMode: undefined, layoutReferenceId: undefined };
        const restored = projectDraft({ ...project, draftJson: JSON.stringify(legacy) });
        expect(restored.referenceMode).toBe("product");
        expect(restored.layoutReferenceId).toBeUndefined();
        expect(restored.references).toEqual(legacy.references);
    });

    test("the save request and reopened project retain source identity, dimensions and all screen metadata", async () => {
        const draft = { ...referenceDraft(), count: 2 };
        const plan = referencePlan([screenImage(1, 0, 0.4, "crop-1"), screenImage(2, 0.4, 1, "crop-2")]);
        let submitted: { draft: EcommerceDraft; plan: EcommercePlan; revision: number } | undefined;
        apiClient.defaults.adapter = async (config) => {
            expect(config.url).toBe("/ecommerce/projects/long-project");
            expect(config.method).toBe("put");
            submitted = JSON.parse(config.data as string);
            return { data: { code: 0, data: { ...project, revision: 5, draftJson: JSON.stringify(submitted!.draft), planJson: JSON.stringify(submitted!.plan) } }, status: 200, statusText: "OK", headers: {}, config };
        };
        const saved = await saveEcommerceProject(project, draft, plan);
        expect(submitted?.revision).toBe(4);
        expect(projectDraft(saved)).toEqual(draft);
        expect(projectPlan(saved)?.referenceSummary).toBe(plan.referenceSummary);
        expect(projectPlan(saved)?.images.map((image) => image.referenceScreen)).toEqual(plan.images.map((image) => image.referenceScreen));
    });
});

describe("ecommerce long reference boundaries", () => {
    test("product identity and layout source stay separate", () => {
        const draft = { ...referenceDraft(), layoutReferenceId: undefined, imageType: "main" };
        expect(commerceLayoutReference(draft)?.resourceId).toBe("long-reference");
        expect(normalizeReferenceDraft(draft)).toMatchObject({ layoutReferenceId: "long-reference", imageType: "detail" });
        expect(draft.layoutReferenceId).toBeUndefined();
        expect(commerceLayoutReference({ ...draft, referenceMode: "product" })).toBeUndefined();
        expect(() => normalizeReferenceDraft({ ...draft, layoutReferences: [] })).toThrow("有效的借鉴图片");
        expect(commerceLayoutReference({ ...draft, layoutReferences: [], layoutReferenceId: "product-photo" })).toBeUndefined();
    });

    test("reading windows cover a long source with overlapping edges and do not segment ordinary images", () => {
        expect(commerceReferenceViewRanges(800, 2000)).toEqual([]);
        const windows = commerceReferenceViewRanges(800, 3600);
        expect(windows[0].top).toBe(0);
        expect(windows.at(-1)?.bottom).toBe(1);
        for (let index = 1; index < windows.length; index++) expect(windows[index].top).toBeLessThan(windows[index - 1].bottom);
        for (const [width, height] of [
            [0, 3600],
            [800, Number.NaN],
            [800, 80_000],
        ]) {
            expect(() => commerceReferenceViewRanges(width, height)).toThrow();
        }
    });

    test("pixel crops cover fractional edges and constrain output canvas size", () => {
        expect(commerceReferenceCropBounds(800, 1001, 0.2, 0.5)).toEqual({ y: 200, cropHeight: 301, width: 800, height: 301 });
        const wide = commerceReferenceCropBounds(4000, 12_000, 0, 1);
        expect(wide.width).toBeLessThanOrEqual(1600);
        expect(wide.height).toBeLessThanOrEqual(4096);
        expect(wide.width / wide.height).toBeCloseTo(1 / 3, 3);
        for (const [width, height, top, bottom] of [
            [800, 1000, -0.1, 0.5],
            [800, 1000, 0.5, 0.5],
            [800, 1000, 0.1, 1.1],
            [800, 1000, 0, Number.NaN],
            [0, 1000, 0, 1],
        ]) {
            expect(() => commerceReferenceCropBounds(width, height, top, bottom)).toThrow("范围无效");
        }
    });

    test("screen validation follows observed page count and rejects incomplete or foreign boundaries", () => {
        const twoScreens = referencePlan([screenImage(1, 0, 0.4), screenImage(2, 0.4, 1)]);
        expect(() => validateCommerceReferencePlan(twoScreens, referenceDraft())).not.toThrow();
        const variants = [
            referencePlan([screenImage(1, 0.03, 1)]),
            referencePlan([screenImage(1, 0, 0.97)]),
            referencePlan([screenImage(1, 0, 0.4), screenImage(2, 0.43, 1)]),
            referencePlan([screenImage(2, 0, 1)]),
            referencePlan([{ ...screenImage(1, 0, 1), referenceScreen: { ...screenImage(1, 0, 1).referenceScreen!, sourceResourceId: "foreign-source" } }]),
            referencePlan(Array.from({ length: 31 }, (_, i) => screenImage(i + 1, i / 31, (i + 1) / 31))),
        ];
        for (const invalid of variants) expect(() => validateCommerceReferencePlan(invalid, referenceDraft())).toThrow();
        expect(() => validateCommerceReferencePlan({ ...twoScreens, referenceSummary: "" }, referenceDraft())).toThrow("分析不完整");
    });

    test("every image request includes its own crop and preserves the sole product source", () => {
        const draft = referenceDraft();
        expect(commerceImageReferences(draft, screenImage(2, 0.3, 0.6, "screen-two-crop"), 1, false).map((ref) => ref.resourceId)).toEqual(["product-photo", "screen-two-crop"]);
        expect(commerceRequiredImageReferenceCount(draft)).toBe(2);
        expect(() => commerceImageReferences(draft, screenImage(2, 0.3, 0.6), 1, false)).toThrow("参考裁片");
        const separateProduct = { ...draft, layoutReferences: [...draft.layoutReferences!, { resourceId: "other-reference", role: "style" as const }] };
        expect(commerceImageReferences(separateProduct, screenImage(2, 0.3, 0.6, "screen-two-crop"), 1, false).map((ref) => ref.resourceId)).toEqual(["product-photo", "screen-two-crop"]);
        expect(commerceRequiredImageReferenceCount(separateProduct)).toBe(2);
    });

    test("screen guidance does not force unrelated camera or layout changes over the source", () => {
        const prompt = commerceImagePrompt(referenceDraft(), screenImage(2, 0.3, 0.6, "screen-two-crop"));
        expect(prompt).toContain("第2屏");
        expect(prompt).toContain("左文右图");
        expect(prompt).not.toContain("相邻图不能只换背景而沿用同一机位");
        expect(prompt).not.toContain("逐图改变叙事、景别、构图和信息布局");
    });

    test("style uses every inspiration while product mode ignores the retained inspiration group", () => {
        const draft = { ...referenceDraft(), referenceMode: "style" as const, layoutReferences: [...referenceDraft().layoutReferences!, { resourceId: "second-reference", role: "style" as const, width: 800, height: 3600 }] };
        expect(activeCommerceReferences(draft).map((ref) => ref.resourceId)).toEqual(["product-photo", "long-reference", "second-reference"]);
        expect(commercePlanningReferenceCount(draft)).toBe(9);
        expect(commerceRequiredImageReferenceCount(draft)).toBe(3);
        expect(commerceImageReferences(draft, screenImage(1, 0, 1), 0, false).map((ref) => ref.resourceId)).toEqual(["product-photo", "long-reference", "second-reference"]);
        const product = { ...draft, referenceMode: "product" as const };
        expect(activeCommerceReferences(product).map((ref) => ref.resourceId)).toEqual(["product-photo"]);
        expect(commercePlanningReferenceCount(product)).toBe(1);
        expect(product.layoutReferences).toHaveLength(2);
    });
});

type TestBitmap = { width: number; height: number; closed: boolean; close: () => void };
type TestCanvas = { width: number; height: number; drawCalls: unknown[][]; getContext: () => { drawImage: (...args: unknown[]) => void }; toBlob: (callback: BlobCallback) => void };

describe("ecommerce long reference media", () => {
    const mediaGlobals = new Map<string, PropertyDescriptor | undefined>();
    let dimensions = { width: 800, height: 3600 };
    let bitmaps: TestBitmap[] = [];
    let canvases: TestCanvas[] = [];
    let requests: string[] = [];
    let fetched: RequestInit[] = [];
    let uploadKeys: string[] = [];
    let savedResources = new Map<string, string>();
    let denied = new Set<string>();
    let resourceOverrides: Record<string, unknown> = {};
    let uploadOverrides: Record<string, unknown> = {};
    let failUploadAt = 0;
    let lostUploadAt = 0;
    let switchAt: "" | "decode" | "encode" | "upload" = "";
    let failEncoding = false;

    const resource = (id: string) => ({ id, userId: "long-reference-owner", kind: "image", status: "ready", mimeType: "image/png", size: 100, ...dimensions, ...resourceOverrides });

    beforeAll(() => {
        for (const key of ["document", "fetch", "createImageBitmap"]) mediaGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    });
    beforeEach(() => {
        dimensions = { width: 800, height: 3600 };
        bitmaps = [];
        canvases = [];
        requests = [];
        fetched = [];
        uploadKeys = [];
        savedResources = new Map();
        denied = new Set();
        resourceOverrides = {};
        uploadOverrides = {};
        failUploadAt = 0;
        lostUploadAt = 0;
        switchAt = "";
        failEncoding = false;
        Object.defineProperty(globalThis, "createImageBitmap", {
            configurable: true,
            writable: true,
            value: async (blob: Blob) => {
                const size = (await blob.text()).includes("second-reference") ? { width: 400, height: 1600 } : dimensions;
                const bitmap: TestBitmap = {
                    ...size,
                    closed: false,
                    close() {
                        this.closed = true;
                    },
                };
                bitmaps.push(bitmap);
                if (switchAt === "decode") setActiveUserScope("another-account");
                return bitmap;
            },
        });
        Object.defineProperty(globalThis, "document", {
            configurable: true,
            writable: true,
            value: {
                createElement(tag: string) {
                    if (tag !== "canvas") throw new Error("Unexpected element " + tag);
                    const canvas: TestCanvas = {
                        width: 0,
                        height: 0,
                        drawCalls: [],
                        getContext() {
                            return {
                                drawImage: (...args) => {
                                    canvas.drawCalls.push(args);
                                },
                            };
                        },
                        toBlob(callback) {
                            if (switchAt === "encode") setActiveUserScope("another-account");
                            callback(failEncoding ? null : new Blob(["cropped-pixels"], { type: "image/png" }));
                        },
                    };
                    canvases.push(canvas);
                    return canvas;
                },
            },
        });
        Object.defineProperty(globalThis, "fetch", {
            configurable: true,
            writable: true,
            value: async (_url: string, options: RequestInit) => {
                fetched.push(options);
                return new Response(new Blob([_url], { type: "image/png" }));
            },
        });
        apiClient.defaults.adapter = async (config) => {
            const url = config.url || "";
            requests.push(url);
            const respond = (data: unknown, code = 0, msg = "ok") => ({ data: { code, data, msg }, status: code || 200, statusText: "OK", headers: {}, config });
            if (config.method === "get" && url.startsWith("/resources/")) {
                const id = url.slice("/resources/".length);
                return denied.has(id) ? respond(null, 403, "无权访问参考资源") : respond({ resource: resource(id) });
            }
            if (url === "/resources/access") {
                const entries = JSON.parse(config.data as string) as Array<{ resourceId: string; purpose: string }>;
                expect(entries.every((entry) => entry.purpose === "ecommerce-export")).toBe(true);
                return respond({
                    items: entries.map(({ resourceId }) => ({
                        resourceId,
                        access: {
                            resourceId,
                            requestedVariant: "original",
                            actualVariant: "original",
                            url: `https://cdn.example.com/${resourceId}.png`,
                            delivery: "origin",
                            issuedAt: new Date().toISOString(),
                            refreshAt: new Date(Date.now() + 120_000).toISOString(),
                            revision: "v1",
                        },
                    })),
                });
            }
            if (config.method === "post" && url === "/resources") {
                const key = String(config.headers.get("X-Idempotency-Key"));
                uploadKeys.push(key);
                if (uploadKeys.length === failUploadAt) return respond(null, 503, "第2屏上传失败");
                if (!savedResources.has(key)) savedResources.set(key, `crop-${savedResources.size + 1}`);
                if (uploadKeys.length === lostUploadAt) throw new Error("上传回执丢失");
                if (switchAt === "upload") setActiveUserScope("another-account");
                return respond({ resource: { ...resource(savedResources.get(key)!), ...uploadOverrides } });
            }
            throw new Error("Unexpected request " + url);
        };
    });
    afterAll(() => {
        for (const [key, descriptor] of mediaGlobals) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
    });

    test("a single primary long image retains its overview and gets reading aids without inventing page count", async () => {
        const original = referenceDraft();
        const { draft, views } = await prepareCommerceReferenceViews(original, 5);
        expect(draft.count).toBe(original.count);
        expect(draft.references).toHaveLength(1);
        expect(draft.references[0]).toMatchObject({ resourceId: "product-photo", role: "primary" });
        expect(draft.layoutReferences![0]).toMatchObject({ resourceId: "long-reference", role: "style", width: 800, height: 3600 });
        expect(views).toHaveLength(3);
        expect(views[0].top).toBe(0);
        expect(views.at(-1)?.bottom).toBe(1);
        expect(requests[0]).toBe("/resources/long-reference");
        expect(fetched).toHaveLength(2);
        expect(fetched[0].credentials).toBe("omit");
        expect(bitmaps).toHaveLength(2);
        expect(bitmaps.every((bitmap) => bitmap.closed)).toBe(true);
        expect(canvases.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true);
    });

    test("the model input limit is checked before uploading any reading aids", async () => {
        await expect(prepareCommerceReferenceViews(referenceDraft(), 4)).rejects.toThrow("共5张输入");
        expect(uploadKeys).toEqual([]);
        expect(bitmaps[0].closed).toBe(true);
    });

    test("the actual planning payload delivers original pixels and all reading aids with source coordinates", async () => {
        const payload = await prepareCommercePlanningPayload(referenceDraft(), 5, "所选技能的文案方法");
        expect(payload.referenceImages.map((reference) => reference.id)).toEqual(["product-photo", "long-reference", "crop-1", "crop-2", "crop-3"]);
        expect(payload.referenceImages.map((reference) => reference.storageKey)).toEqual(["resource:product-photo", "resource:long-reference", "resource:crop-1", "resource:crop-2", "resource:crop-3"]);
        expect(payload.prompt).toContain('"inputImageOrder":3');
        expect(payload.prompt).toContain('"sourceResourceId":"long-reference"');
        expect(payload.prompt).toContain("所选技能的文案方法");
        expect(payload.draft.references).toHaveLength(1);
        expect(payload.draft.layoutReferenceId).toBe("long-reference");
    });

    test("multiple originals and reading windows preserve their individual source mappings", async () => {
        const draft = { ...referenceDraft(), layoutReferences: [...referenceDraft().layoutReferences!, { resourceId: "second-reference", role: "style" as const }] };
        const payload = await prepareCommercePlanningPayload(draft, 8);
        expect(payload.referenceImages.map((reference) => reference.id)).toEqual(["product-photo", "long-reference", "second-reference", "crop-1", "crop-2", "crop-3", "crop-4", "crop-5"]);
        expect(payload.prompt).toContain('"inputImageOrder":4,"sourceResourceId":"long-reference"');
        expect(payload.prompt).toContain('"inputImageOrder":7,"sourceResourceId":"second-reference"');
        expect(payload.draft.layoutReferences![1]).toMatchObject({ width: 400, height: 1600 });
        expect(bitmaps.every((bitmap) => bitmap.closed)).toBe(true);
    });

    test("all sources are counted before any reading-window upload", async () => {
        const draft = { ...referenceDraft(), layoutReferences: [...referenceDraft().layoutReferences!, { resourceId: "second-reference", role: "style" as const }] };
        await expect(prepareCommerceReferenceViews(draft, 7)).rejects.toThrow("共8张输入");
        expect(uploadKeys).toEqual([]);
        expect(bitmaps.every((bitmap) => bitmap.closed)).toBe(true);
    });

    test("screen crops switch bitmap sources instead of cropping the first image twice", async () => {
        const draft = { ...referenceDraft(), layoutReferences: [...referenceDraft().layoutReferences!, { resourceId: "second-reference", role: "style" as const }] };
        const first = screenImage(1, 0, 1);
        const second = screenImage(2, 0, 1);
        second.referenceScreen!.sourceResourceId = "second-reference";
        const result = await prepareCommerceReferencePlan(draft, referencePlan([first, second]));
        expect(result.images.map((image) => image.referenceScreen!.sourceResourceId)).toEqual(["long-reference", "second-reference"]);
        expect(canvases.map((canvas) => canvas.drawCalls[0].slice(1, 5))).toEqual([
            [0, 0, 800, 3600],
            [0, 0, 400, 1600],
        ]);
        expect(uploadKeys[0]).toContain(":long-reference:");
        expect(uploadKeys[1]).toContain(":second-reference:");
        expect(bitmaps.every((bitmap) => bitmap.closed)).toBe(true);
    });

    test("known oversized source dimensions are rejected before downloading or decoding pixels", async () => {
        resourceOverrides = { width: 10_000, height: 20_000 };
        await expect(prepareCommerceReferenceViews(referenceDraft(), 24)).rejects.toThrow("尺寸过大");
        expect(fetched).toEqual([]);
        expect(bitmaps).toEqual([]);
        expect(uploadKeys).toEqual([]);
    });

    test("source ownership failures stop before reading pixels or uploading crops", async () => {
        denied.add("long-reference");
        await expect(prepareCommerceReferenceViews(referenceDraft(), 4)).rejects.toThrow("无权访问");
        expect(fetched).toEqual([]);
        expect(bitmaps).toEqual([]);
        expect(uploadKeys).toEqual([]);
    });

    test("semantic screen crops are saved individually and do not mutate the planner result", async () => {
        const original = referencePlan([screenImage(1, 0, 0.2), screenImage(2, 0.2, 0.75), screenImage(3, 0.75, 1)]);
        const saved: EcommercePlan[] = [];
        const result = await prepareCommerceReferencePlan(referenceDraft(), original, {
            onSaved: async (plan) => {
                saved.push(plan);
            },
        });
        expect(saved.map((plan) => plan.images.filter((image) => image.referenceScreen?.resourceId).length)).toEqual([1, 2, 3]);
        expect(result.images.map((image) => image.referenceScreen?.resourceId)).toEqual(["crop-1", "crop-2", "crop-3"]);
        expect(original.images.every((image) => !image.referenceScreen?.resourceId)).toBe(true);
        expect(canvases.map((canvas) => canvas.drawCalls[0].slice(1, 5))).toEqual([
            [0, 0, 800, 720],
            [0, 720, 800, 1980],
            [0, 2700, 800, 900],
        ]);
        expect(bitmaps[0].closed).toBe(true);
    });

    test("a later failure preserves prior screen receipts and retry reuses their owned crops", async () => {
        const original = referencePlan();
        let persisted = original;
        failUploadAt = 2;
        await expect(
            prepareCommerceReferencePlan(referenceDraft(), original, {
                onSaved: async (plan) => {
                    persisted = plan;
                },
            }),
        ).rejects.toThrow("上传失败");
        expect(persisted.images.map((image) => image.referenceScreen?.resourceId)).toEqual(["crop-1", undefined, undefined]);
        const firstKey = uploadKeys[0];
        const failedKey = uploadKeys[1];
        failUploadAt = 0;
        const result = await prepareCommerceReferencePlan(referenceDraft(), persisted, {
            onSaved: async (plan) => {
                persisted = plan;
            },
        });
        expect(requests).toContain("/resources/crop-1");
        expect(uploadKeys.filter((key) => key === firstKey)).toHaveLength(1);
        expect(uploadKeys.filter((key) => key === failedKey)).toHaveLength(2);
        expect(result.images.every((image) => image.referenceScreen?.resourceId)).toBe(true);
        expect(bitmaps.every((bitmap) => bitmap.closed)).toBe(true);
    });

    test("a lost upload response is retried with the same idempotency key", async () => {
        const plan = referencePlan([screenImage(1, 0, 1)]);
        lostUploadAt = 1;
        await expect(prepareCommerceReferencePlan(referenceDraft(), plan)).rejects.toThrow("上传回执丢失");
        lostUploadAt = 0;
        const retry = await prepareCommerceReferencePlan(referenceDraft(), plan);
        expect(uploadKeys).toHaveLength(2);
        expect(uploadKeys[0]).toBe(uploadKeys[1]);
        expect(savedResources.size).toBe(1);
        expect(retry.images[0].referenceScreen?.resourceId).toBe("crop-1");
    });

    test("saving a receipt must succeed before the next screen starts", async () => {
        await expect(
            prepareCommerceReferencePlan(referenceDraft(), referencePlan(), {
                onSaved: async () => {
                    throw new Error("项目保存失败");
                },
            }),
        ).rejects.toThrow("项目保存失败");
        expect(uploadKeys).toHaveLength(1);
        expect(bitmaps[0].closed).toBe(true);
    });

    test("stored crop IDs are reauthorized and a foreign receipt cannot be reused", async () => {
        denied.add("foreign-crop");
        await expect(prepareCommerceReferencePlan(referenceDraft(), referencePlan([screenImage(1, 0, 1, "foreign-crop")]))).rejects.toThrow("无权访问");
        expect(requests).toEqual(["/resources/foreign-crop"]);
        expect(uploadKeys).toEqual([]);
        expect(bitmaps).toEqual([]);
    });

    test("a task that lost its crop receipt is rejected instead of silently creating a replacement", async () => {
        const plan = referencePlan([{ ...screenImage(1, 0, 1), taskId: "existing-image-task" }]);
        await expect(prepareCommerceReferencePlan(referenceDraft(), plan)).rejects.toThrow("已有任务但缺少参考裁片");
        expect(requests).toEqual([]);
        expect(uploadKeys).toEqual([]);
    });

    test.each(["decode", "encode", "upload"] as const)("account switch during %s discards the result and stops further uploads", async (stage) => {
        switchAt = stage;
        let saved = 0;
        await expect(
            prepareCommerceReferencePlan(referenceDraft(), referencePlan(), {
                onSaved: async () => {
                    saved++;
                },
            }),
        ).rejects.toThrow("账号已切换");
        expect(saved).toBe(0);
        expect(uploadKeys.length).toBe(stage === "upload" ? 1 : 0);
        expect(bitmaps.every((bitmap) => bitmap.closed)).toBe(true);
        expect(canvases.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true);
    });

    test("account switch after a saved receipt prevents the next screen from uploading", async () => {
        await expect(
            prepareCommerceReferencePlan(referenceDraft(), referencePlan(), {
                onSaved: async () => {
                    setActiveUserScope("another-account");
                },
            }),
        ).rejects.toThrow("账号已切换");
        expect(uploadKeys).toHaveLength(1);
    });

    test("crop encoding failure releases memory and creates no resource", async () => {
        failEncoding = true;
        await expect(prepareCommerceReferencePlan(referenceDraft(), referencePlan())).rejects.toThrow("裁切失败");
        expect(uploadKeys).toEqual([]);
        expect(bitmaps[0].closed).toBe(true);
        expect(canvases[0].width).toBe(0);
        expect(canvases[0].height).toBe(0);
    });

    test("an upload that has not become a ready image cannot be persisted as a usable crop", async () => {
        uploadOverrides = { status: "pending" };
        let saved = 0;
        await expect(
            prepareCommerceReferencePlan(referenceDraft(), referencePlan(), {
                onSaved: async () => {
                    saved++;
                },
            }),
        ).rejects.toThrow();
        expect(saved).toBe(0);
    });
});
