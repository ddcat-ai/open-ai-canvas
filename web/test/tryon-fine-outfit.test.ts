import { describe, expect, test } from "bun:test";
import { TRYON_FUNCTIONS } from "@/pages/ecommerce/tryon/tryon-kinds";
import { buildTryOnJobs, defaultTryOnDraft, missingInput, needsAgentPlan, type TryOnDraft, type TryOnImage } from "@/pages/ecommerce/tryon/tryon-plan";
import { newTryOnBatchId } from "@/pages/ecommerce/tryon/tryon-store";

const image = (slot: TryOnImage["slot"], id: string): TryOnImage => ({ id, resourceId: id, slot, name: id, previewUrl: `/api/resources/${id}/file`, width: 1024, height: 1824 });
const source = (count = 1): TryOnDraft => ({
    ...defaultTryOnDraft(),
    fn: "fine-outfit",
    count,
    images: { "fine-outfit": [image("model", "person"), image("garment", "front"), image("garment", "back"), image("garment", "detail")] },
    notes: "保持金色刺绣",
});

describe("精细化换装提交", () => {
    test("任一已选参考上传失败或仍在上传时阻止生成", () => {
        const draft = source();
        draft.images["fine-outfit"]!.push({ ...image("garment", "failed"), resourceId: "", error: "上传失败" });
        expect(missingInput(draft)).toContain("上传失败");
        draft.images["fine-outfit"]![draft.images["fine-outfit"]!.length - 1] = { ...image("garment", "pending"), resourceId: "" };
        expect(missingInput(draft)).toContain("还在上传");
    });
    test.each([1, 3, 20])("生成 %i 张任务，完整传递人物及全部服装参考", (count) => {
        const draft = source(count);
        expect(missingInput(draft)).toBe("");
        expect(needsAgentPlan(draft)).toBe(false);
        const jobs = buildTryOnJobs(draft);
        expect(jobs).toHaveLength(count);
        expect(new Set(jobs.map((job) => job.key)).size).toBe(count);
        for (const job of jobs) {
            expect(job.references.map((ref) => ref.resourceId)).toEqual(["person", "front", "back", "detail"]);
            expect(job.references.map((ref) => ref.role)).toEqual(["model", "garment", "garment", "garment"]);
            expect(job.sizeSource).toMatchObject({ width: 1024, height: 1824 });
            expect(job.prompt).toContain("精细化换装");
            expect(job.prompt).toContain("保持金色刺绣");
            expect(job.prompt).toContain("第 2–4 张");
            expect(job.prompt).toContain("姿势、机位、背景和光线全部沿用图一");
        }
    });

    test("所有已注册入口都能从合法素材构建非空任务", () => {
        for (const config of TRYON_FUNCTIONS) {
            const images = config.slots.filter((slot) => slot.min > 0).map((slot) => image(slot.key, slot.key));
            const draft: TryOnDraft = { ...defaultTryOnDraft(), fn: config.id, images: { [config.id]: images }, consent: true, poses: ["自然站立"] };
            expect(missingInput(draft)).toBe("");
            expect(buildTryOnJobs(draft)).toHaveLength(1);
        }
    });

    test.each(["background", "scene", "enhance"] as const)("%s 保留素材职责与原图尺寸", (fn) => {
        const images = [image("subject", "subject"), ...(fn === "enhance" ? [] : [image("background", "environment")])];
        const draft: TryOnDraft = { ...defaultTryOnDraft(), fn, images: { [fn]: images }, count: 2, notes: "保留标签" };
        const jobs = buildTryOnJobs(draft);
        expect(jobs).toHaveLength(2);
        for (const job of jobs) {
            expect(job.references.map((ref) => ref.resourceId)).toEqual(images.map((image) => image.resourceId));
            expect(job.references.map((ref) => ref.role)).toEqual(images.map((image) => image.slot));
            expect(job.sizeSource).toMatchObject({ width: 1024, height: 1824 });
            expect(job.prompt).toContain("保留标签");
            expect(job.prompt).toContain(fn === "enhance" ? "不换脸" : "不复制其中的人物或商品");
        }
    });
});
