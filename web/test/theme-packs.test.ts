import { afterEach, describe, expect, test } from "bun:test";

import { canvasThemes } from "@/lib/canvas-theme";
import { CANVAS_APPEARANCE_PRESETS, canvasAppearanceForPreset, resolveCanvasAppearance } from "@/lib/canvas/canvas-appearance";
import { applyThemeBrandVariables, applyThemePackCanvas } from "@/themes/apply";
import { themePackFor } from "@/themes/registry";
import "@/themes/longying-ink";
import { LONGYING_INK_SKIN_ID } from "@/themes/longying-ink/skin";

const preset = (id: string) => CANVAS_APPEARANCE_PRESETS.find((item) => item.id === id)!;

describe("龙影水墨主题包", () => {
    afterEach(() => applyThemePackCanvas("classic"));

    test("主题包已登记，皮肤数据 id 与主题包一致", () => {
        const pack = themePackFor(LONGYING_INK_SKIN_ID);
        expect(pack?.name).toBe("龙影水墨");
        expect(pack?.skin.id).toBe(LONGYING_INK_SKIN_ID);
        expect(themePackFor("classic")).toBeUndefined();
    });

    test("启用水墨皮肤后画布与新建画布预设换成宣纸/夜墨", () => {
        applyThemePackCanvas(LONGYING_INK_SKIN_ID);
        expect(canvasThemes.light.canvas.background).toBe("#efe9dd");
        expect(canvasThemes.dark.node.fill).toBe("#1b1915");
        expect(preset("light").label).toBe("宣纸");
        expect(preset("dark").label).toBe("夜墨");
        expect(resolveCanvasAppearance(canvasAppearanceForPreset("light"), "light").background.toUpperCase()).toBe("#EFE9DD");
        expect(preset("pink").label).toBe("粉色");
    });

    test("切回其他皮肤时还原上游原值，重复启用不叠加", () => {
        applyThemePackCanvas(LONGYING_INK_SKIN_ID);
        applyThemePackCanvas(LONGYING_INK_SKIN_ID);
        applyThemePackCanvas("classic");
        expect(canvasThemes.light.canvas.background).toBe("#FFFFFF");
        expect(canvasThemes.dark.accent.primary).toBe("#f5f5f5");
        expect(preset("light").label).toBe("经典浅色");
        expect(preset("light").values.backgroundColor).toBe("#FFFFFF");
    });

    test("品牌名写进样式变量，印章取前两个字", () => {
        const values = new Map<string, string>();
        const fakeDocument = { documentElement: { style: { setProperty: (key: string, value: string) => values.set(key, value) } } } as unknown as Document;
        applyThemeBrandVariables(" 龙影 ", fakeDocument);
        expect(values.get("--theme-brand-name")).toBe('"龙影"');
        expect(values.get("--theme-brand-seal")).toBe('"龙影"');
        applyThemeBrandVariables("云鹤仙观", fakeDocument);
        expect(values.get("--theme-brand-seal")).toBe('"云鹤"');
    });
});

describe("云鹤仙观主题包", () => {
    afterEach(() => applyThemePackCanvas("classic"));

    test("与龙影水墨同时登记，互不覆盖；切换时先还原再套用", async () => {
        await import("@/themes/yunhe-xianguan");
        const yunhe = themePackFor("yunhe-xianguan");
        expect(yunhe?.name).toBe("云鹤仙观");
        expect(yunhe?.copy?.loginTitle).toBe("欢迎回观");
        expect(themePackFor(LONGYING_INK_SKIN_ID)?.name).toBe("龙影水墨");
        applyThemePackCanvas(LONGYING_INK_SKIN_ID);
        applyThemePackCanvas("yunhe-xianguan");
        expect(canvasThemes.light.canvas.background).toBe("#eaf0ee");
        expect(preset("light").label).toBe("月白");
        expect(preset("dark").label).toBe("夜观");
        applyThemePackCanvas("classic");
        expect(canvasThemes.light.canvas.background).toBe("#FFFFFF");
        expect(preset("light").label).toBe("经典浅色");
    });
});
