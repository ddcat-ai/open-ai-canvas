import { describe, expect, test } from "bun:test";

async function readSource(path: string) {
    return Bun.file(new URL(path, import.meta.url)).text();
}

describe("canvas top bar theme toggle", () => {
    test("exposes a direct day and night switch", async () => {
        const source = await readSource("../src/pages/canvas/canvas-project-top-bar.tsx");

        expect(source).toContain("onToggleTheme");
        expect(source).toContain("canvas-topbar-theme-button");
        expect(source).toContain('aria-label={colorTheme === "dark" ? "切换到浅色主题" : "切换到深色主题"}');
    });

    test("keeps the top bar switch connected to the canvas appearance", async () => {
        const source = await readSource("../src/pages/canvas/project.tsx");

        expect(source).toContain("const toggleCanvasTheme = useCallback");
        expect(source).toContain("canvasAppearanceForTheme(next, canvasAppearance)");
        expect(source).toContain("setBackgroundMode(DEFAULT_CANVAS_BACKGROUND_MODE)");
        expect(source).toContain("onToggleTheme={toggleCanvasTheme}");
    });
});
