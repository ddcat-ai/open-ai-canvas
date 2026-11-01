import assert from "node:assert/strict";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const vite = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), server: { middlewareMode: true }, ssr: { noExternal: ["@lobehub/icons"] } });
try {
    const { EcommerceResultGallery } = await vite.ssrLoadModule("/src/pages/ecommerce/result-gallery.tsx");
    const { emptyEcommerceDraft } = await vite.ssrLoadModule("/src/services/api/ecommerce.ts");
    const image = { id: "one", imageType: "main", prompt: "正面商品摄影", copy: "真实外观", taskId: "task-one" };
    const props = { config: {}, draft: emptyEcommerceDraft(), plan: { images: [image] }, tasks: {}, selected: new Set(), imageModels: [], onSelect() {}, onDownload() {}, onCanvas() {}, async onRemove() {}, async onRegenerate() {}, onRetry() {} };
    const render = (task, selected = new Set()) => renderToStaticMarkup(React.createElement(EcommerceResultGallery, { ...props, tasks: { "task-one": task }, selected }));
    const running = render({ status: "running" });
    assert.match(running, /commerce-planning-spin/);
    assert.match(running, /正在创作这张图片/);
    assert.match(running, /01 · 电商主图/);
    const queued = render({ status: "queued" });
    assert.match(queued, /等待队列调度/);
    assert.match(queued, /commerce-planning-spin/);
    const failed = render({ status: "failed", error: "上游模型不可用" });
    assert.match(failed, /上游模型不可用/);
    assert.match(failed, /重试这张图片/);
    assert.ok(!failed.includes("commerce-planning-spin"), "失败任务仍显示运行动画");
    const completed = render({ status: "succeeded", previewUrl: "https://example.invalid/test-only.png", outputs: [{ materializedAssetId: "asset-one" }] }, new Set(["one"]));
    for (const control of ["放大查看第 1 张图片", "选择第 1 张图片", "重新编辑第 1 张图片", "下载第 1 张图片", "将第 1 张图片导入画布", "删除第 1 张图片"]) assert.ok(completed.includes(control), `缺少操作: ${control}`);
    assert.match(completed, /is-selected/);
    assert.ok(!completed.includes("ecommerce-result-info") && !completed.includes("ecommerce-result-copy"), "完成后仍展示图片下方的信息区");
    console.log("ecommerce gallery checks passed (queued/running/failed/completed and selection controls)");
} finally {
    await vite.close();
}
