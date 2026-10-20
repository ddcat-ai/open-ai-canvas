import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CanvasAppearanceControls } from "../src/components/canvas/canvas-appearance-controls";
import { canvasThemes } from "../src/lib/canvas-theme";
import { CANVAS_APPEARANCE_PRESETS, canvasAppearanceBaseTheme, canvasAppearanceForPreset, canvasAppearanceForTheme, updateCustomCanvasAppearance, type CanvasAppearance } from "../src/lib/canvas/canvas-appearance";

function render(appearance: CanvasAppearance) {
    const theme = canvasAppearanceBaseTheme(appearance, "light");
    return renderToStaticMarkup(<CanvasAppearanceControls appearance={appearance} backgroundMode="lines" colorTheme={theme} theme={canvasThemes[theme]} onAppearanceChange={() => {}} onSaveAppearanceDefault={() => {}} onBackgroundModeChange={() => {}} />);
}

describe("canvas appearance hierarchy", () => {
    test("opening the panel keeps tuning collapsed regardless of the saved appearance", () => {
        const appearances = [
            canvasAppearanceForTheme("light"),
            canvasAppearanceForTheme("dark"),
            ...CANVAS_APPEARANCE_PRESETS.map((preset) => canvasAppearanceForPreset(preset.id)),
            updateCustomCanvasAppearance(canvasAppearanceForPreset("pink"), { gridOpacity: 21 }, "light"),
        ];
        for (const appearance of appearances) {
            const markup = render(appearance);
            for (const label of ["浅色", "深色"]) expect(markup).toContain(`aria-label="切换到${label}主题"`);
            expect(markup).toContain('aria-label="自定义配色" aria-expanded="false"');
            expect(markup).not.toContain('role="region" aria-label="自定义配色"');
            expect(markup).not.toContain("配色基调");
            expect(markup).not.toContain("使用粉色预设");
            expect(markup).not.toContain("明亮度");
            expect(markup).toContain("网格样式");
        }
    });

    test("a saved pink preset selects the light tone without making disclosure a theme", () => {
        const markup = render(canvasAppearanceForPreset("pink"));
        expect(markup).toContain('aria-label="切换到浅色主题" aria-pressed="true"');
        expect(markup).toContain('aria-label="切换到深色主题" aria-pressed="false"');
        expect(markup).not.toContain("切换到自定义主题");
    });

    test("saved dark fine tuning selects the dark tone and keeps manual colors collapsed", () => {
        const markup = render(updateCustomCanvasAppearance(canvasAppearanceForPreset("slate"), { backgroundBrightness: 2 }, "dark"));
        expect(markup).toContain('aria-label="切换到浅色主题" aria-pressed="false"');
        expect(markup).toContain('aria-label="切换到深色主题" aria-pressed="true"');
        expect(markup).not.toContain("背景颜色色码");
        expect(markup).not.toContain("更多颜色");
    });
});
