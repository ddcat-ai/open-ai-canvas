import { describe, expect, test } from "bun:test";
import { emptyEcommerceDraft } from "../src/services/api/ecommerce";
import { marketingPlanSlots, parseMarketingSelections, recommendMarketingSelections } from "../src/pages/ecommerce/marketing-materials";

describe("marketing material plan", () => {
    test("expands selected counts in order and keeps per-item ratios", () => {
        const draft = {
            ...emptyEcommerceDraft(),
            imageType: "marketing",
            typeOptions: {
                materialPlan: JSON.stringify([
                    { id: "market-poster", count: 2, ratio: "3:4" },
                    { id: "market-long", count: 1, ratio: "9:16" },
                ]),
            },
        };
        expect(marketingPlanSlots(draft).map((slot) => [slot.name, slot.ratio])).toEqual([
            ["海报", "3:4"],
            ["海报", "3:4"],
            ["长图", "9:16"],
        ]);
    });
    test("rejects duplicates and entries beyond the fifteen-image cap", () => {
        const draft = {
            ...emptyEcommerceDraft(),
            typeOptions: {
                materialPlan: JSON.stringify([
                    { id: "market-poster", count: 15, ratio: "3:4" },
                    { id: "market-poster", count: 1, ratio: "3:4" },
                    { id: "market-long", count: 1, ratio: "9:16" },
                ]),
            },
        };
        expect(parseMarketingSelections(draft)).toHaveLength(1);
        expect(marketingPlanSlots(draft)).toHaveLength(15);
    });
    test("recommends a material mentioned by the prompt", () => {
        const result = recommendMarketingSelections("做一张小红书封面种草", "小红书", ["3:4", "1:1"]);
        expect(result[0]?.id).toBe("red-cover");
        expect(result[0]?.ratio).toBe("3:4");
    });
});
