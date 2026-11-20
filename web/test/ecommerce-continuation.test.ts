import { expect, test } from "bun:test";
import { archiveCommercePlan, commerceCanvasImages, continueCommercePlan } from "../src/pages/ecommerce/continuation";
import type { EcommercePlan } from "../src/services/api/ecommerce";

test("nine-image rounds append without duplicating or resubmitting previous images", () => {
    const first = { productSummary: "product", images: Array.from({ length: 9 }, (_, i) => ({ id: `first-${i}`, taskId: `task-${i}`, ratio: "9:16" })) } as EcommercePlan;
    const archive = archiveCommercePlan(first)!;
    const second = { ...first, images: Array.from({ length: 9 }, (_, i) => ({ ...first.images[i], id: `second-${i}`, taskId: undefined })) };
    const continued = continueCommercePlan(second, archive);
    expect(continued.images).toHaveLength(9);
    expect(commerceCanvasImages(continued)).toHaveLength(18);
    expect(continued.previousImages).toEqual(first.images);
    expect(archiveCommercePlan(archive)).toEqual(archive);
    expect(JSON.parse(JSON.stringify(continued)).previousImages[0].taskId).toBe("task-0");
    expect(first.images).toHaveLength(9);
    const repeatedIds = continueCommercePlan({ ...second, images: first.images.map((image) => ({ ...image, taskId: undefined })) }, archive);
    expect(new Set(commerceCanvasImages(repeatedIds).map((image) => image.id)).size).toBe(18);
});
