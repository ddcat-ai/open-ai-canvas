import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string) {
    return readFileSync(resolve(import.meta.dir, path), "utf8");
}

describe("media fallback", () => {
    test("replaces failed image and video elements with an unavailable state", () => {
        const preview = source("../src/components/media-preview.tsx");

        expect(preview).toContain("failedSrc === src");
        expect(preview).toContain("onError={handleUnavailable}");
        expect(preview).toContain("预览不可用，素材可能已删除");
        expect(preview).toContain("<ImageOff");
    });

    test("uses the fallback in list, grid, detail and enlarged previews", () => {
        const list = source("../src/pages/tasks/task-list-row.tsx");
        const grid = source("../src/pages/tasks/task-grid-card.tsx");
        const page = source("../src/pages/tasks/index.tsx");

        expect(list).toContain("<MediaPreview");
        expect(list).toContain("disabled={previewUnavailable}");
        expect(grid).toContain("<MediaPreview");
        expect(page.match(/<MediaPreview/g)).toHaveLength(2);
    });

    test("uses the fallback in admin log thumbnails and enlarged previews", () => {
        const page = source("../src/pages/admin/logs/logs-page.tsx");

        expect(page.match(/<MediaPreview/g)).toHaveLength(2);
        expect(page).toContain("disabled={previewUnavailable}");
        expect(page).toContain("onUnavailable={() => setUnavailableUrl(url)}");
    });
});

describe("task cancellation policy", () => {
    test("does not expose cancellation after a task is created", () => {
        const list = source("../src/pages/tasks/task-list-row.tsx");
        const grid = source("../src/pages/tasks/task-grid-card.tsx");
        const page = source("../src/pages/tasks/index.tsx");

        expect(list).not.toContain("isTaskCancellable");
        expect(list).not.toContain("取消任务");
        expect(grid).not.toContain("isTaskCancellable");
        expect(grid).not.toContain("取消任务");
        expect(page).not.toContain("cancelGenerationTask");
        expect(page).not.toContain('runAction(detailTask.id, "cancel")');
        expect(page).toContain('if (task.status === "queued" || task.status === "running")');
        expect(page).toContain("任务正在执行，不能删除本机记录");
    });

    test("batch stop only applies to items still waiting locally", () => {
        const batches = source("../src/pages/canvas/use-canvas-generation-batches.ts");

        expect(batches).toContain('item.status === "waiting" && !nodeById.get(item.nodeId)?.metadata?.taskId');
        expect(batches).toContain('item.status === "waiting" && stoppableItems.some((candidate) => candidate.id === item.id)');
        expect(batches).not.toContain('item.status === "waiting" || item.status === "submitting"');
    });
});
