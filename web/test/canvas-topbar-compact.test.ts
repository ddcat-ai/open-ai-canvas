import { describe, expect, test } from "bun:test";

async function readSource(path: string) {
    return Bun.file(new URL(path, import.meta.url)).text();
}

describe("canvas top bar compact actions", () => {
    test("keeps the right-side actions icon-only", async () => {
        const source = await readSource("../src/pages/canvas/canvas-project-top-bar.tsx");

        expect(source).not.toContain('<span className="hidden lg:inline">导入第三方画布</span>');
        expect(source).not.toContain('<span className="tabular-nums">{shortDramaGuide.progress.completedCount}/5</span>');
        expect(source).not.toMatch(/canvas-topbar-version-button[\s\S]*>\s*版本\s*<\/Button>/);
        expect(source).toContain("canvas-topbar-credits-button");
        expect(source).not.toContain("min-w-[5.5rem]");
    });

    test("sizes the right-side card from its compact actions", async () => {
        const styles = await readSource("../src/styles/globals.css");

        expect(styles).toMatch(/\.canvas-topbar > \.canvas-topbar-cluster:last-child \{\s*flex: 0 0 auto;\s*width: max-content;/);
    });
});
