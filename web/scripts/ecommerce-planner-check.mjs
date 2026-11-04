import assert from "node:assert/strict";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const vite = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), server: { middlewareMode: true } });
try {
    const { parsePlannerOutput, plannerPrompt, assertCommercePlanCurrent, assertCommerceClaimsGrounded, commerceInputSignature, reviseCommerceFacts, excludeCommerceFacts } = await vite.ssrLoadModule("/src/pages/ecommerce/planner.ts");
    const { ecommerceTypeConfig, typeValidation, creationOptions } = await vite.ssrLoadModule("/src/pages/ecommerce/type-config.ts");
    const { imageTypes, labelOf, imageSizeLabel } = await vite.ssrLoadModule("/src/pages/ecommerce/catalog.ts");
    const { commercePlanningPayload, commerceImageReferences, commerceImagePrompt, commercePlanningSource, commerceRequiredImageReferenceCount, manuallyEditedCommerceImage } = await vite.ssrLoadModule("/src/pages/ecommerce/workflow.ts");
    const { ecommerceOutputSize } = await vite.ssrLoadModule("/src/pages/ecommerce/output-size.ts");
    const { directCommercePlan } = await vite.ssrLoadModule("/src/pages/ecommerce/direct-plan.ts");
    const { commerceCopyLayout } = await vite.ssrLoadModule("/src/pages/ecommerce/copy-layout.ts");
    const { commercePlanningReferenceCount } = await vite.ssrLoadModule("/src/pages/ecommerce/model-context.ts");
    const { suggestCommerceModel } = await vite.ssrLoadModule("/src/pages/ecommerce/model-catalog.ts");
    const draft = {
        productName: "测试商品",
        platform: "taobao",
        imageType: "sku",
        count: 2,
        language: "zh-CN",
        imageModel: "test-image",
        ratio: "1:1",
        resolution: "1k",
        style: "commercial",
        fidelity: "strict",
        skus: [{ id: "sku-a", name: "米白色", color: "米白色", spec: "标准款", count: 2, resourceId: "own-reference" }],
        references: [
            { role: "primary", resourceId: "product" },
            { role: "sku", resourceId: "own-reference" },
        ],
    };
    const image = (id, skuId) => ({
        id,
        skuId,
        imageType: "sku",
        platform: "taobao",
        language: "zh-CN",
        goal: "展示SKU",
        theme: "统一版式",
        composition: "居中",
        mainVisual: "商品",
        fidelity: "严格",
        prompt: "商品摄影",
        imageModel: "test-image",
        ratio: "1:1",
        resolution: "1k",
    });
    const plan = { productSummary: "真实商品", confirmedFacts: [], uncertainFacts: [], qualityChecks: [], visualStrategy: "统一品牌视觉", images: [image("one", "sku-a"), image("two", "sku-a")] };
    assert.equal(parsePlannerOutput(JSON.stringify(plan), draft).images.length, 2);
    assert.match(plannerPrompt(draft), /对应 skuId/);
    assert.match(plannerPrompt(draft), /米白色/);
    assert.throws(() => parsePlannerOutput(JSON.stringify({ ...plan, images: [image("one", "sku-a")] }), draft), /数量不匹配/);
    assert.throws(() => parsePlannerOutput(JSON.stringify({ ...plan, images: [image("one", "sku-a"), image("two", "sku-b")] }), draft), /未关联真实 SKU/);
    assert.throws(() => parsePlannerOutput(JSON.stringify({ ...plan, images: [{ ...image("one", "sku-a"), imageType: "detail" }, image("two", "sku-a")] }), draft), /创作类型不一致/);
    assert.equal(parsePlannerOutput(JSON.stringify({ ...plan, images: [{ ...image("one", "sku-a"), imageType: "商品 SKU 图" }, image("two", "sku-a")] }), draft).images[0].imageType, "sku");
    assert.throws(() => parsePlannerOutput(JSON.stringify({ ...plan, images: [{ ...image("one", "sku-a"), imageType: "主图" }, image("two", "sku-a")] }), draft), /创作类型不一致/);
    const detailedDraft = {
        ...draft,
        imageType: "detail",
        count: 2,
        category: "家用香氛",
        brand: "真实品牌",
        description: "便携香薰机",
        claims: "已确认的三档定时",
        materials: "已确认的 ABS 外壳",
        colors: "米白色",
        specifications: "额定电压 5V",
        packaging: "主机一台",
        dimensions: "12×8×15cm",
        audience: "居家用户",
        scene: "卧室床头",
        pricePosition: "199元",
        lockedDetails: "保持按钮与Logo",
        instruction: "强调实拍风格",
        references: [
            { role: "primary", resourceId: "product-photo", name: "正面图" },
            { role: "style", resourceId: "style-photo", name: "风格图" },
        ],
        skus: [],
    };
    const prompt = plannerPrompt(detailedDraft);
    for (const fact of ["便携香薰机", "已确认的三档定时", "米白色", "额定电压 5V", "主机一台", "12×8×15cm", "卧室床头", "保持按钮与Logo", "强调实拍风格", "product-photo", "style-photo"]) assert.ok(prompt.includes(fact), `策划遗漏参数: ${fact}`);
    const input = commercePlanningPayload(detailedDraft, 2);
    assert.equal(input.referenceImages.length, 2);
    assert.deepEqual(
        input.referenceImages.map((ref) => ref.id),
        ["product-photo", "style-photo"],
    );
    assert.ok(
        input.referenceImages.every((ref) => ref.storageKey),
        "上传图片没有进入模型参考图参数",
    );
    assert.match(prompt, /每张都必须写英文枚举值 detail/);
    assert.throws(() => commercePlanningPayload(detailedDraft, 1), /最多读取 1 张/);
    assert.deepEqual(
        commerceImageReferences(detailedDraft, plan.images[0], 0, true).map((ref) => ref.resourceId),
        ["product-photo", "style-photo"],
    );
    assert.throws(() => commerceImageReferences({ ...detailedDraft, references: detailedDraft.references.filter((ref) => ref.role !== "style") }, plan.images[0], 0, true), /缺少版式模板/);
    for (const [type, settings] of Object.entries(ecommerceTypeConfig)) {
        const typeOptions = Object.fromEntries(creationOptions[type].map((item) => [item.key, item.choices?.[0] || `用户已确认的${item.label}`]));
        const configured = { ...detailedDraft, imageType: type, typeOptions };
        assert.ok(plannerPrompt(configured).includes(`"imageType":"${labelOf(imageTypes, type)}"`), `策划未收到 ${type} 类型`);
        for (const [key, value] of Object.entries(typeOptions)) assert.ok(plannerPrompt(configured).includes(value), `${type} 遗漏 ${key}`);
        assert.equal(typeValidation(configured), null);
        assert.match(typeValidation({ ...configured, typeOptions: { unsupported: "假参数" } }), /参数无效/);
        for (const field of settings.required || []) {
            assert.match(typeValidation({ ...configured, [field]: "" }), /真实资料/);
            assert.equal(typeValidation(configured), null);
        }
        for (let count = 1; count <= 30; count++) {
            const selected = { ...configured, count, skus: type === "sku" ? [{ ...draft.skus[0], count }] : [] };
            const images = Array.from({ length: count }, (_, i) => ({ ...image(`image-${i + 1}`, type === "sku" ? "sku-a" : undefined), imageType: type === "set" ? "main" : type, composition: `镜头${i + 1}` }));
            const parsed = parsePlannerOutput(JSON.stringify({ ...plan, images }), selected);
            const direct = directCommercePlan({ ...selected, agentModel: "" });
            assert.equal(direct.images.length, count);
            assert.ok(direct.images.every((entry) => entry.ratio === selected.ratio && entry.resolution === selected.resolution && entry.imageModel === selected.imageModel));
            assertCommercePlanCurrent(direct, { ...selected, agentModel: "" });
            assert.ok(direct.images.every((entry) => entry.prompt.includes(selected.description) && entry.prompt.includes(selected.lockedDetails)));
            assert.equal(parsed.images.length, count);
            assertCommercePlanCurrent(parsed, selected);
            assert.throws(() => parsePlannerOutput(JSON.stringify({ ...plan, images: images.slice(1) }), selected), /数量不匹配/);
        }
    }
    const parsed = parsePlannerOutput(JSON.stringify(plan), draft);
    assert.throws(
        () =>
            parsePlannerOutput(
                JSON.stringify({
                    ...plan,
                    images: [
                        { ...image("image-1"), imageType: "detail" },
                        { ...image("image-2"), imageType: "detail" },
                    ],
                }),
                { ...detailedDraft, count: 2, references: [detailedDraft.references[0]] },
            ),
        /同一构图/,
    );
    for (const key of [
        "productName",
        "category",
        "brand",
        "description",
        "claims",
        "materials",
        "colors",
        "specifications",
        "packaging",
        "dimensions",
        "audience",
        "scene",
        "pricePosition",
        "lockedDetails",
        "platform",
        "imageType",
        "language",
        "agentModel",
        "imageModel",
        "ratio",
        "resolution",
        "style",
        "stylePrompt",
        "fidelity",
        "instruction",
    ]) {
        assert.throws(() => assertCommercePlanCurrent(parsed, { ...draft, [key]: "变更后的参数" }), /已变更/, `${key} 更改后仍可使用旧策划`);
    }
    assert.throws(() => assertCommercePlanCurrent(parsed, { ...draft, references: [{ role: "primary", resourceId: "other-product" }] }), /已变更/);
    assert.equal(commerceInputSignature(draft), commerceInputSignature({ ...draft, planningTaskId: "task-1", references: draft.references.map((r) => ({ ...r, name: "持久化前的显示名" })) }));
    const task = { inputJson: JSON.stringify({ metadata: { ecommerceDraft: detailedDraft } }) };
    assert.deepEqual(commercePlanningSource(task), detailedDraft);
    assert.throws(() => commercePlanningSource({ inputJson: "{}" }), /快照/);
    assert.throws(() => parsePlannerOutput(JSON.stringify({ ...plan, images: [{ ...plan.images[0], prompt: { fake: true } }, plan.images[1]] }), draft), /字段不完整/);
    assert.throws(() => parsePlannerOutput(JSON.stringify({ ...plan, confirmedFacts: [{ fake: true }] }), draft), /格式错误/);
    assert.throws(() => assertCommercePlanCurrent(parsed, { ...draft, typeOptions: { background: "纯白" } }), /已变更/);
    assert.throws(() => assertCommercePlanCurrent(parsed, { ...draft, cloneOptions: { copyMode: "none", ratioMode: "template" } }), /已变更/);
    const revised = reviseCommerceFacts(detailedDraft, ["材质未知"], "");
    assert.match(revised.instruction, /不采用.*材质未知/);
    assert.equal(revised.materials, detailedDraft.materials);
    assert.throws(() => assertCommercePlanCurrent(parsed, revised), /已变更/);
    const reviewed = excludeCommerceFacts({ ...parsed, uncertainFacts: ["材质未知", "机芯型号未知"] });
    assert.deepEqual(reviewed.confirmedFacts, parsed.confirmedFacts);
    assert.deepEqual(reviewed.uncertainFacts, []);
    assert.equal(reviewed.images.length, parsed.images.length);
    assert.ok(reviewed.images.every((item) => item.prompt.includes("材质未知") && item.negativePrompt.includes("机芯型号未知")));
    assertCommercePlanCurrent(reviewed, draft);
    const multipleSkus = { ...draft, skus: [...draft.skus, { ...draft.skus[0], id: "sku-b", resourceId: "sku-b-photo" }], references: [...draft.references, { role: "sku", resourceId: "sku-b-photo" }] };
    assert.equal(commerceRequiredImageReferenceCount(multipleSkus), 2);
    assert.deepEqual(
        commerceImageReferences(multipleSkus, { ...plan.images[0], skuId: "sku-b" }, 0, false).map((ref) => ref.resourceId),
        ["product", "sku-b-photo"],
    );
    assert.throws(() => assertCommerceClaimsGrounded({ ...parsed, images: [{ ...parsed.images[0], prompt: "Dark brown leather strap" }] }, draft), /皮革材质/);
    assert.throws(() => assertCommerceClaimsGrounded({ ...parsed, images: [{ ...parsed.images[0], prompt: "synthetic ruby bearings" }] }, draft), /红宝石材质/);
    assertCommerceClaimsGrounded({ ...parsed, images: [{ ...parsed.images[0], prompt: "Brown textured strap, visible red accents" }] }, draft);
    assertCommerceClaimsGrounded({ ...parsed, images: [{ ...parsed.images[0], prompt: "Dark brown leather strap" }] }, { ...draft, materials: "真皮表带" });
    assert.throws(() => assertCommerceClaimsGrounded({ ...parsed, images: [{ ...parsed.images[0], prompt: "48小时长续航" }] }, draft), /续航时长/);
    assertCommerceClaimsGrounded({ ...parsed, images: [{ ...parsed.images[0], prompt: "48小时长续航" }] }, { ...draft, claims: "48小时长续航" });
    assert.throws(() => assertCommerceClaimsGrounded({ ...parsed, images: [{ ...parsed.images[0], prompt: "主动降噪" }] }, draft), /降噪功能/);
    const grounded = parsePlannerOutput(JSON.stringify({ ...plan, confirmedFacts: ["AI编造的认证"], images: plan.images.map((item) => ({ ...item, verifiedClaims: "AI编造的功能" })) }), draft);
    assert.ok(!grounded.confirmedFacts.includes("AI编造的认证"));
    assert.ok(grounded.images.every((item) => !item.verifiedClaims.includes("AI编造")));
    assert.deepEqual(ecommerceOutputSize("1024x1024", 1254, 1254), { width: 1024, height: 1024 });
    assert.deepEqual(ecommerceOutputSize("auto", 1254, 1254), { width: 1254, height: 1254 });
    assert.deepEqual(ecommerceOutputSize("16:9", 1824, 1024), { width: 1824, height: 1024 });
    assert.throws(() => ecommerceOutputSize("99999x99999", 1254, 1254), /可靠范围/);
    const outputPrompt = commerceImagePrompt({ ...detailedDraft, imageType: "sku", skus: draft.skus, noText: true }, { ...plan.images[0], lighting: "侧面柔光", composition: "右侧留白" });
    for (const expected of ["侧面柔光", "右侧留白", "米白色", "标准款", "不添加新文字", "保持按钮与Logo"]) assert.ok(outputPrompt.includes(expected), `生图遗漏 ${expected}`);
    const observedPrompt = commerceImagePrompt({ ...detailedDraft, references: [detailedDraft.references[0]] }, { ...plan.images[0], copy: "让细节成为主角\n保留可见蓝色耳罩" }, "浅蓝色耳机，耳罩外侧有可见 Logo");
    for (const expected of ["浅蓝色耳机", "可见 Logo", "让细节成为主角", "完整落在画幅内", "不裁切文字"]) assert.ok(observedPrompt.includes(expected), `生图没有保留商品观察或完整文案约束: ${expected}`);
    assert.match(imageSizeLabel("1824x1024"), /^16:9/);
    assert.match(imageSizeLabel("1024x1824"), /^9:16/);
    assert.match(imageSizeLabel("1024x1024"), /^1:1/);
    const richCopy = "看见真实细节\n" + "以用户确认的商品信息展示结构、颜色与使用场景。".repeat(6);
    const layout = commerceCopyLayout(richCopy, 1024, 1024, (text, size) => Array.from(text).length * size);
    assert.equal(layout.lines.map((line) => line.text).join(""), richCopy.replace(/\n/g, ""), "丰富文案在导出时被截断");
    assert.ok(layout.lines.length > 3, "排版仍被限制为三行");
    assert.ok(layout.barHeight <= 1024 * 0.42);
    assert.throws(() => commerceCopyLayout("无法容纳的长文案".repeat(300), 1024, 1024, (text, size) => Array.from(text).length * size), /未被截断/);
    const supplemented = { ...detailedDraft, instruction: "最后一张展示尺寸，正面视角；原文案：让细节成为主角。" };
    assert.ok(plannerPrompt(supplemented).includes(supplemented.instruction));
    assert.match(plannerPrompt(supplemented), /主标题、解释文案/);
    const photography = commerceImagePrompt(supplemented, {
        ...plan.images[0],
        copy: "让细节成为主角\n可见外观的真实说明",
        prompt: "正面摄影，完整保留右侧表冠。后期以文字图层排版，文案逐字使用：让细节成为主角。可见外观的真实说明。",
        negativePrompt: "禁止尺寸数字",
        fidelity: "保持商品结构",
    });
    assert.ok(photography.includes("让细节成为主角"), "已审阅文案未提交给图片模型");
    assert.ok(photography.startsWith("正面摄影，完整保留右侧表冠。后期以文字图层排版，文案逐字使用：让细节成为主角。可见外观的真实说明。"), "逐张提示词被静默改写或截断");
    assert.match(photography, /最终成品文字与版式/);
    assert.match(plannerPrompt(supplemented), /primary 商品图就是视觉分析输入/);
    const primaryOnly = commercePlanningPayload({ ...supplemented, references: [supplemented.references[0]], materials: "", colors: "", brand: "", claims: "" }, 1);
    assert.equal(primaryOnly.referenceImages.length, 1, "仅上传商品主图时，图片未进入视觉模型");
    assert.equal(primaryOnly.referenceImages[0].id, "product-photo");
    const variedMains = plannerPrompt({ ...supplemented, imageType: "main", count: 5, references: [supplemented.references[0]] });
    for (const direction of ["图1：完整商品", "图2：左前方", "图3：右侧", "图4：局部可见细节", "图5：实际使用场景"]) assert.ok(variedMains.includes(direction), `主图候选缺少视角: ${direction}`);
    const imageOnly = {
        ...detailedDraft,
        productName: "",
        category: "",
        description: "",
        claims: "",
        materials: "",
        colors: "",
        specifications: "",
        packaging: "",
        dimensions: "",
        audience: "",
        scene: "",
        references: [detailedDraft.references[0]],
        imageType: "detail",
        modelEnabled: true,
        skillIds: [],
    };
    assert.equal(commercePlanningPayload(imageOnly, 1).referenceImages.length, 1);
    assert.equal(commercePlanningReferenceCount(imageOnly), 1);
    assert.match(plannerPrompt(imageOnly), /本轮未选 Skills：自行完成商品图观察/);
    assert.equal(typeValidation({ ...imageOnly, imageType: "selling" }), null);
    assert.match(typeValidation({ ...imageOnly, imageType: "scene", typeOptions: { people: "不出现人物" } }), /已开启模特/);
    assert.equal(suggestCommerceModel({ ...imageOnly, description: "图中是男士佩戴的头戴式耳机" }).id, "cn-man");
    const withMatchedModel = { ...imageOnly, references: [...imageOnly.references, { role: "model", resourceId: "matched-model", name: "中国男模" }], primaryModelResourceId: "matched-model" };
    const modeledDetail = { ...plan.images[0], imageType: "detail", prompt: "模特佩戴商品，侧面中景", composition: "模特与商品同框", mainVisual: "人物佩戴商品" };
    assert.deepEqual(
        commerceImageReferences(withMatchedModel, modeledDetail, 0, false).map((ref) => ref.resourceId),
        ["product-photo", "matched-model"],
    );
    assert.match(commerceImagePrompt(withMatchedModel, modeledDetail, "蓝色头戴耳机"), /保持已选主模特形象/);
    assert.deepEqual(
        commerceImageReferences(withMatchedModel, { ...plan.images[0], imageType: "detail" }, 0, false).map((ref) => ref.resourceId),
        ["product-photo"],
    );
    assert.match(variedMains, /未见过的背面或侧面只能作为合理的视觉探索/);
    assert.match(commerceImagePrompt({ ...supplemented, imageType: "main", count: 5 }, { ...plan.images[0], imageType: "main" }), /不要求复制参考图的拍摄角度/);
    const manual = manuallyEditedCommerceImage({ ...plan.images[0], composition: "旧黑色背景居中", mainVisual: "黑色背景", lighting: "旧暗光" }, { ...plan.images[0], prompt: "新米白背景，右侧构图", copy: "新标题" });
    const manualPrompt = commerceImagePrompt(supplemented, manual);
    assert.ok(manualPrompt.includes("新米白背景，右侧构图"));
    for (const stale of ["旧黑色背景居中", "黑色背景", "旧暗光"]) assert.ok(!manualPrompt.includes(stale), `旧策划 ${stale} 覆盖手动修改`);
    const manualWithCopy = commerceImagePrompt({ ...supplemented, noText: true }, { ...manual, manualPrompt: true, prompt: "米白背景，右上角排版新标题", copy: "" });
    assert.match(manualWithCopy, /右上角排版新标题/);
    assert.ok(!manualWithCopy.includes("不添加新文字"), "手动提示词中的文字要求被旧的无文字开关覆盖");
    for (const constraint of ["正面摄影", "右侧表冠", "禁止尺寸数字", "保持商品结构"]) assert.ok(photography.includes(constraint));
    console.log("ecommerce planner checks passed");
} finally {
    await vite.close();
}
