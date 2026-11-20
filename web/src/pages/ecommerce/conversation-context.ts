import type { EcommerceDraft, EcommercePlan } from "@/services/api/ecommerce";
import { commerceInputSignature } from "./planner";
import { marketingPlanSlots } from "./marketing-materials";

const chineseDigits: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** Explicit follow-up requests update the current product; they never start a new project. */
export function commerceFollowupDraft(draft: EcommerceDraft, instruction: string): EcommerceDraft {
    const match = /(?:生成|制作|做|再来|继续|需要|要)\s*([1-9]\d?|[一二两三四五六七八九十]{1,3})\s*[张屏]/.exec(instruction);
    let count = draft.count;
    if (match) {
        const value = match[1];
        const parts = value.split("十");
        const parsed = /^\d+$/.test(value) ? Number(value) : parts.length === 2 ? (chineseDigits[parts[0]] || 1) * 10 + (chineseDigits[parts[1]] || 0) : chineseDigits[value];
        if (parsed >= 1 && parsed <= 20) count = parsed;
    }
    const imageType = /详情[页图]/.test(instruction) ? "detail" : /主副图|主图[和与及、].*副图|套图/.test(instruction) ? "set" : draft.imageType;
    return { ...draft, instruction, count, imageType, ...(imageType !== draft.imageType ? { typeOptions: {}, noText: false } : {}) };
}

/** Only inputs that affect quoted quantities or model parameters belong here. */
export function commerceQuoteSignature(draft: EcommerceDraft, plan: EcommercePlan | null, count: number): string {
    const rows =
        plan?.inputSignature === commerceInputSignature(draft) && plan.images.length
            ? plan.images
            : draft.imageType === "sku"
              ? draft.skus.flatMap((sku) => Array.from({ length: sku.count }, () => ({ ...draft, skuId: sku.id })))
              : draft.imageType === "marketing"
                ? marketingPlanSlots(draft).map((slot) => ({ ...draft, ratio: slot.ratio }))
                : Array.from({ length: count }, () => draft);
    return JSON.stringify([
        draft.platform,
        draft.imageType,
        draft.typeOptions?.purpose,
        draft.referenceMode,
        draft.references,
        draft.layoutReferences,
        draft.skus,
        rows.map((row) => [row.imageModel, row.ratio, row.resolution, "skuId" in row ? row.skuId : undefined, ["自动", "auto"].includes(row.ratio) ? row.imageType : undefined]),
    ]);
}
