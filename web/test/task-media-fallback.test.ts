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
    test("offers cancellation only while a task is queued", () => {
        const shared = source("../src/pages/tasks/task-shared.tsx");
        const list = source("../src/pages/tasks/task-list-row.tsx");
        const grid = source("../src/pages/tasks/task-grid-card.tsx");
        const page = source("../src/pages/tasks/index.tsx");

        expect(shared).toContain('return task.status === "queued";');
        expect(list).toContain("const isCancellable = isTaskCancellable(task);");
        expect(list).toContain("{isCancellable ? (");
        expect(grid).toContain("const isCancellable = isTaskCancellable(task);");
        expect(grid).toContain("{isCancellable ? (");
        expect(page).toContain('if (action === "cancel" && currentTask && !isTaskCancellable(currentTask))');
        expect(page).toContain('message.warning("任务已开始生成，无法取消")');
        expect(page).toContain('detailTask.provider === "dreamina-cli" && isTaskCancellable(detailTask)');
        expect(page).not.toContain('detailTask.status === "queued" || detailTask.status === "running"');
    });
});
