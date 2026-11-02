import type { EcommerceDraft, EcommercePlan } from "@/services/api/ecommerce";
import { commerceInputSignature } from "./planner";
import { imageTypes, labelOf } from "./catalog";
import { selectedCreationRequirements, typeValidation } from "./type-config";
import { commerceSeriesDirection, commerceShotDirection } from "./art-direction";
import { commerceAllowsText, commerceCreativeDirection, normalizeCreativeOptions } from "./creative-controls";
import { marketingPlanSlots } from "./marketing-materials";
import { commerceDisplaySlots } from "./display-slots";

/** User-authored execution specification. No text model or invented analysis. */
export function directCommercePlan(draft: EcommerceDraft): EcommercePlan {
    if (draft.referenceMode === "style" || draft.referenceMode === "detail") throw new Error("参考风格与长图逐屏创作需要先进行 AI 分析，请切换到 AI 策划");
    if (draft.imageType === "detail") throw new Error("详情页必须先由 Agent 完成性能、场景与逐张文案策划");
    const invalid = typeValidation(draft);
    if (invalid) throw new Error(invalid);
    if (!draft.productName.trim() || !draft.references.some((ref) => ref.role === "primary")) throw new Error("请填写商品名称并上传商品主图");
    if (draft.imageType === "sku" && draft.skus.some((sku) => !sku.name.trim() || !Number.isInteger(sku.count) || sku.count < 0)) throw new Error("请填写真实 SKU 名称及整数数量");
    const slots = draft.imageType === "sku" ? draft.skus.flatMap((sku) => Array.from({ length: sku.count }, () => sku)) : Array.from({ length: draft.count }, () => undefined);
    const materials = draft.imageType === "marketing" ? marketingPlanSlots(draft) : [];
    const displayAssignments = commerceDisplaySlots(draft);
    if (!slots.length || slots.length > 30 || slots.length !== draft.count) throw new Error("生成数量须为 1–30 张，并与 SKU 数量一致");
    const facts = {
        name: draft.productName,
        category: draft.category,
        brand: draft.brand,
        description: draft.description,
        claims: draft.claims,
        materials: draft.materials,
        colors: draft.colors,
        specifications: draft.specifications,
        packaging: draft.packaging,
        dimensions: draft.dimensions,
        audience: draft.audience,
        scene: draft.scene,
        pricePosition: draft.pricePosition,
        lockedDetails: draft.lockedDetails,
    };
    return {
        productSummary: "直接生成 · 使用用户资料与参考图片，未调用 AI 策划。",
        confirmedFacts: Object.values(facts).filter(Boolean),
        uncertainFacts: [],
        visualStrategy: commerceSeriesDirection(draft),
        qualityChecks: ["请核对商品外观、颜色、Logo 与真实规格", "整套配色、字体、图标与光线一致，各张构图和信息各有侧重"],
        inputSignature: commerceInputSignature(draft),
        images: slots.map((sku, index) => ({
            id: `direct-${index + 1}`,
            imageType: draft.imageType,
            platform: draft.platform,
            language: draft.language,
            displayAssignment: displayAssignments[index],
            goal: materials[index] ? `${materials[index].category} · ${materials[index].name}` : labelOf(imageTypes, draft.imageType),
            theme: `${sku?.name || draft.productName} · ${index + 1}`,
            composition: `${draft.instruction ? `用户指定构图：${draft.instruction}\n` : ""}${commerceShotDirection(draft, index)}`,
            mainVisual: draft.productName,
            verifiedClaims: [draft.claims, sku?.claims].filter(Boolean).join("；"),
            copy: commerceAllowsText(draft) ? [draft.brand || draft.productName, draft.claims || draft.description].filter(Boolean).join("\n") : "",
            lighting: draft.stylePrompt || "",
            fidelity: draft.lockedDetails || "保持参考图中商品的外观与结构",
            prompt: `直接生成第 ${index + 1}/${slots.length} 张${materials[index] ? `${materials[index].category}${materials[index].name}` : labelOf(imageTypes, draft.imageType)}。严格参考上传商品图。\n本张内容与版式：${commerceShotDirection(draft, index)}\n用户真实资料：${JSON.stringify(facts)}\n类型要求：${JSON.stringify(selectedCreationRequirements(draft))}\n创作参数：${JSON.stringify(normalizeCreativeOptions(draft))}\n${commerceCreativeDirection(draft)}\n用户生成要求：${draft.instruction || "按已选创作类型展示真实商品"}${sku ? `\n本张仅使用此 SKU：${JSON.stringify(sku)}` : ""}${draft.modelEnabled && !["white", "sku", "size", "three-view", "material", "package"].includes(draft.imageType) && index % 2 === 0 ? "\n本张安排适合目标市场和商品使用方式的模特与商品互动，并在提示词中具体描述外形、妆发、姿态和商品使用动作。" : "\n本张仅展示商品和场景。"}`,
            negativePrompt: "不编造材质、功能、认证或商业承诺，不改变商品结构、Logo和SKU颜色",
            imageModel: draft.imageModel,
            ratio: materials[index]?.ratio || draft.ratio,
            resolution: draft.resolution,
            ...(sku ? { skuId: sku.id } : {}),
        })),
    };
}
