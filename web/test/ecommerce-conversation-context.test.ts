import { expect, test } from "bun:test";
import { emptyEcommerceDraft } from "../src/services/api/ecommerce";
import { commerceFollowupDraft, commerceQuoteSignature } from "../src/pages/ecommerce/conversation-context";
import { commerceInputSignature } from "../src/pages/ecommerce/planner";
import { commerceDisplayDirective, commerceDisplaySlots } from "../src/pages/ecommerce/display-slots";
import type { EcommercePlan } from "../src/services/api/ecommerce";

test("follow-ups inherit references and verified product data and parse explicit 1–20 page requests", () => {
    const draft = { ...emptyEcommerceDraft(), imageType: "set", count: 5, description: "已核实资料", references: ["a", "b", "c"].map((resourceId) => ({ resourceId, role: "primary" as const })) };
    for (const [instruction, count] of [
        ["继续生成九张详情页", 9],
        ["继续做20张详情图", 20],
        ["制作一张详情页", 1],
        ["再来十二张主副图", 12],
    ] as const) {
        const next = commerceFollowupDraft(draft, instruction);
        expect(next.count).toBe(count);
        expect(next.references).toEqual(draft.references);
        expect(next.description).toBe("已核实资料");
    }
    expect(commerceFollowupDraft(draft, "商品4cm，11cm，继续做详情页").count).toBe(5);
});

test("typing leaves quote inputs and historical regeneration prices stable", () => {
    const draft = { ...emptyEcommerceDraft(), count: 5, imageType: "set" };
    const plan = { inputSignature: commerceInputSignature(draft), images: Array.from({ length: 5 }, () => ({ imageModel: draft.imageModel, ratio: draft.ratio, resolution: draft.resolution })) } as EcommercePlan;
    const original = commerceQuoteSignature(draft, plan, 5);
    for (const instruction of ["继", "继续", "继续生成", "继续生成一套新画面"]) expect(commerceQuoteSignature({ ...draft, instruction }, plan, 5)).toBe(original);
    expect(commerceQuoteSignature({ ...draft, ratio: "9:16" }, plan, 5)).not.toBe(original);
});

test("20-page local fallback and persisted assignments survive non-sequential image IDs", () => {
    for (let count = 1; count <= 20; count++) {
        const slots = commerceDisplaySlots({ ...emptyEcommerceDraft(), count, imageType: "detail" }, () => 0.5);
        expect(slots.length).toBe(count);
        expect(new Set(slots).size).toBe(count);
    }
    const directive = commerceDisplayDirective(emptyEcommerceDraft(), { id: "continued-uuid", displayAssignment: "右前30°，低机位近景" });
    expect(directive).toContain("右前30°");
});
