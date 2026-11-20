import { describe, expect, test } from "bun:test";
import { emptyEcommerceDraft, type EcommerceProject } from "../src/services/api/ecommerce";
import { ecommerceHistoryCovers } from "../src/pages/ecommerce/project-history";
import type { GenerationTask } from "../src/services/api/task-center";

const project: EcommerceProject = {
    id: "project",
    name: "头戴式耳机",
    status: "completed",
    revision: 1,
    createdAt: "2026-10-25",
    updatedAt: "2026-10-25",
    draftJson: JSON.stringify({
        ...emptyEcommerceDraft(),
        references: [
            { resourceId: "style-template", role: "style" },
            { resourceId: "product-photo", role: "primary" },
        ],
    }),
    planJson: JSON.stringify({
        images: [
            { id: "failed-image", taskId: "failed" },
            { id: "success-image", taskId: "success" },
        ],
    }),
};
const task = (id: string, status: GenerationTask["status"]): GenerationTask => ({
    id,
    type: "image",
    status,
    prompt: "",
    attempts: 1,
    createdAt: "2026-10-25",
    updatedAt: "2026-10-25",
    previewUrl: `/preview-${id}.png`,
    resultJson: JSON.stringify({ images: [{ storageKey: `resource:${id}` }] }),
});

describe("电商历史项目封面", () => {
    test("成功成图优先，失败任务预览不能冒充完成图片，商品照片作为回退", () => {
        const covers = ecommerceHistoryCovers(project, { failed: task("failed", "failed"), success: task("success", "succeeded") });
        expect(covers).toHaveLength(2);
        expect(covers[0]).toContain("/resources/success/file");
        expect(covers[1]).toContain("/resources/product-photo/file");
        expect(covers.join(" ")).not.toContain("failed");
        expect(covers.join(" ")).not.toContain("style-template");
    });
    test("未加载任务的旧项目显示真实商品图片，不请求历史任务或使用风格模板", () => {
        expect(ecommerceHistoryCovers(project, {})).toEqual([expect.stringContaining("/resources/product-photo/file")]);
        const onlyStyle = { ...project, draftJson: JSON.stringify({ ...emptyEcommerceDraft(), references: [{ role: "style", resourceId: "template" }] }) };
        expect(ecommerceHistoryCovers(onlyStyle, {})).toEqual([]);
    });
    test("历史方案损坏仍可显示商品封面，缺失资料提供空封面", () => {
        expect(ecommerceHistoryCovers({ ...project, planJson: "broken" }, {})).toHaveLength(1);
        expect(ecommerceHistoryCovers({ ...project, draftJson: "broken", planJson: "broken" }, {})).toEqual([]);
    });
});
