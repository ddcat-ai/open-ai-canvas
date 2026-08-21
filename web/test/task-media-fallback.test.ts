import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string) {
    return readFileSync(resolve(import.meta.dir, path), "utf8");
}

describe("task media fallback", () => {
    test("replaces failed image and video elements with an unavailable state", () => {
        const preview = source("../src/pages/tasks/task-media-preview.tsx");

        expect(preview).toContain("failedSrc === src");
        expect(preview).toContain("onError={handleUnavailable}");
        expect(preview).toContain("预览不可用，素材可能已删除");
        expect(preview).toContain("<ImageOff");
    });

    test("uses the fallback in list, grid, detail and enlarged previews", () => {
        const list = source("../src/pages/tasks/task-list-row.tsx");
        const grid = source("../src/pages/tasks/task-grid-card.tsx");
        const page = source("../src/pages/tasks/index.tsx");

        expect(list).toContain("<TaskMediaPreview");
        expect(list).toContain("disabled={previewUnavailable}");
        expect(grid).toContain("<TaskMediaPreview");
        expect(page.match(/<TaskMediaPreview/g)).toHaveLength(2);
    });
});
