import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setActiveUserScope } from "../src/lib/user-scope";
import {
    CANVAS_APPEARANCE_PRESETS,
    canvasAppearanceForPreset,
    canvasAppearanceForTheme,
    canvasAppearanceValues,
    customCanvasAppearanceFromTheme,
    enterCustomCanvasAppearance,
    normalizeCanvasAppearance,
    normalizeHexColor,
    readCanvasAppearanceDefault,
    resolveCanvasAppearance,
    resolveCanvasGridColor,
    switchCanvasAppearanceTheme,
    updateCustomCanvasAppearance,
    writeCanvasAppearanceDefault,
} from "../src/lib/canvas/canvas-appearance";

const storage = new Map<string, string>();
let originalWindow: PropertyDescriptor | undefined;
beforeEach(() => {
    originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    storage.clear();
    Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
    } } });
});
afterEach(() => {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
});

describe("canvas appearance persistence and presets", () => {
    const custom = {
        mode: "custom" as const,
        custom: { baseTheme: "light" as const, backgroundColor: "#DFE9E6", backgroundBrightness: -3, gridColor: "#345678", gridOpacity: 27 },
    };

    test("retains every custom value across both fixed themes and a JSON save/reopen", () => {
        const switched = canvasAppearanceForTheme("light", canvasAppearanceForTheme("dark", custom));
        const reopened = normalizeCanvasAppearance(JSON.parse(JSON.stringify(switched)), "dark");
        expect(enterCustomCanvasAppearance(reopened, "dark").custom).toEqual(custom.custom);
        expect(custom.custom.backgroundBrightness).toBe(-3);
    });

    test("visiting presets retains fine tuning in its own tone and restores that tone's selection", () => {
        let appearance = custom as ReturnType<typeof normalizeCanvasAppearance>;
        for (const preset of CANVAS_APPEARANCE_PRESETS) {
            appearance = canvasAppearanceForPreset(preset.id, appearance);
            expect(resolveCanvasAppearance(appearance, "light").baseTheme).toBe(preset.values.baseTheme);
        }
        const reopened = normalizeCanvasAppearance(JSON.parse(JSON.stringify(appearance)), "light");
        expect(reopened.mode).toBe("preset");
        expect(reopened.preset?.id).toBe("slate");
        expect(reopened.themeMemory?.light?.custom).toEqual(custom.custom);
        expect(reopened.custom).toBeUndefined();
        const light = switchCanvasAppearanceTheme(reopened, "light");
        expect(light.preset?.id).toBe("mint");
        expect(light.custom).toEqual(custom.custom);
    });

    test("fine tuning starts from the visible preset, not the remembered custom colors", () => {
        const preset = canvasAppearanceForPreset("dark", custom);
        const edited = updateCustomCanvasAppearance(preset, { gridOpacity: 19 }, "light");
        expect(edited.mode).toBe("custom");
        expect(edited.custom).toEqual({ ...preset.preset!.values, gridOpacity: 19 });
        expect(preset.themeMemory?.light?.custom).toEqual(custom.custom);
        expect(preset.preset!.values.gridOpacity).not.toBe(19);
    });

    test("preset colors are stored as a snapshot and survive normalization unchanged", () => {
        const appearance = canvasAppearanceForPreset("mint");
        appearance.preset!.values.backgroundColor = "#DDEEDD";
        const saved = normalizeCanvasAppearance(JSON.parse(JSON.stringify(appearance)), "dark");
        expect(resolveCanvasAppearance(saved, "dark").background).toBe("#DDEEDD");
        expect(canvasAppearanceForPreset("mint").preset!.values.backgroundColor).toBe("#DFE9E6");
    });

    test("preserves existing custom colors including explicitly black grids", () => {
        const legacy = { mode: "custom", custom: { baseTheme: "dark", backgroundColor: "#111111", backgroundBrightness: -4, gridColor: "#000000", gridOpacity: 100 } };
        expect(normalizeCanvasAppearance(legacy, "light")).toEqual(legacy);
        expect(resolveCanvasGridColor(normalizeCanvasAppearance(legacy, "light"), "light", "lines")).toBe("rgba(0,0,0,1)");
    });

    test("new preset line colors remain distinguishable after the viewport opacity is applied", () => {
        for (const preset of CANVAS_APPEARANCE_PRESETS) {
            const appearance = canvasAppearanceForPreset(preset.id);
            const background = resolveCanvasAppearance(appearance, "light").background;
            const rgba = resolveCanvasGridColor(appearance, "light", "lines").match(/^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/)!;
            expect(rgba).not.toBeNull();
            const difference = [1, 3, 5].map((offset, i) => Math.abs(Number(rgba[i + 1]) - parseInt(background.slice(offset, offset + 2), 16)) * Number(rgba[4]) * 0.46);
            expect(Math.max(...difference)).toBeGreaterThan(15);
        }
        expect(resolveCanvasGridColor(canvasAppearanceForTheme("dark"), "light", "lines")).not.toBe("#000000");
    });

    test("rejects malformed presets and retains a valid custom fallback", () => {
        const broken = normalizeCanvasAppearance({ mode: "preset", preset: { id: "missing", values: custom.custom }, custom: custom.custom }, "dark");
        expect(broken.mode).toBe("custom");
        expect(broken.preset).toBeUndefined();
        expect(broken.custom).toEqual(custom.custom);
        expect(normalizeCanvasAppearance({ mode: "preset", preset: { id: "light", values: { ...custom.custom, backgroundColor: "bad-color" } } }, "dark")).toEqual({ mode: "dark" });
    });

    test("normalizes supported hex formats and rejects non-colors", () => {
        expect(normalizeHexColor(" F3DCE5 ")).toBe("#F3DCE5");
        expect(normalizeHexColor("#f3d")).toBe("#FF33DD");
        for (const value of ["#", "#12345", "#GGGGGG", "url(example)", "#12345678"]) expect(normalizeHexColor(value)).toBeNull();
    });

    test("bounds numeric inputs and handles non-finite values without corrupting colors", () => {
        const bounded = normalizeCanvasAppearance({ ...custom, custom: { ...custom.custom, backgroundBrightness: 80, gridOpacity: -5 } }, "dark");
        expect(bounded.custom).toMatchObject({ backgroundBrightness: 30, gridOpacity: 0 });
        const invalid = normalizeCanvasAppearance({ ...custom, custom: { ...custom.custom, backgroundBrightness: NaN, gridOpacity: Infinity } }, "dark");
        expect(Number.isFinite(invalid.custom!.gridOpacity)).toBe(true);
        expect(invalid.custom!.backgroundBrightness).toBe(0);
    });

    test("changing tone switches background, grid and interface together and preserves the other tone", () => {
        const switched = updateCustomCanvasAppearance(custom, { baseTheme: "dark" }, "light");
        expect(switched.custom).toEqual({ baseTheme: "dark", backgroundColor: "#000000", backgroundBrightness: 0, gridColor: "#FFFFFF", gridOpacity: 32 });
        expect(switchCanvasAppearanceTheme(switched, "light").custom).toEqual(custom.custom);
    });

    test("brightness changes lightness while preserving chroma and hue", () => {
        const appearance = customCanvasAppearanceFromTheme("light");
        appearance.custom!.backgroundColor = "#F3DCE5";
        const brighter = resolveCanvasAppearance(updateCustomCanvasAppearance(appearance, { backgroundBrightness: 10 }, "light"), "light").background;
        const darker = resolveCanvasAppearance(updateCustomCanvasAppearance(appearance, { backgroundBrightness: -10 }, "light"), "light").background;
        const parts = (color: string) => color.match(/^oklch\(([\d.]+)% ([\d.]+) ([\d.]+)\)$/)!;
        expect(Number(parts(brighter)[1])).toBeGreaterThan(Number(parts(darker)[1]));
        expect(parts(brighter).slice(2)).toEqual(parts(darker).slice(2));
    });

    test("account defaults retain preset snapshots, custom memory and the chosen grid style", () => {
        setActiveUserScope("account-A");
        const value = { appearance: canvasAppearanceForPreset("slate", custom), backgroundMode: "blank" as const };
        writeCanvasAppearanceDefault(value);
        expect(readCanvasAppearanceDefault()).toEqual(value);
        setActiveUserScope("account-B");
        expect(readCanvasAppearanceDefault()).toBeNull();
        setActiveUserScope("account-A");
        expect(enterCustomCanvasAppearance(canvasAppearanceForTheme("light", readCanvasAppearanceDefault()!.appearance), "dark").custom).toEqual(custom.custom);
    });

    test("editing a fixed legacy appearance starts from what is visible", () => {
        const legacy = canvasAppearanceForTheme("light", custom);
        const values = canvasAppearanceValues(legacy, "dark");
        expect(values.backgroundColor).toBe("#F0F0F0");
        expect(values.gridOpacity).toBe(80);
        expect(updateCustomCanvasAppearance(legacy, { gridOpacity: 22 }, "dark").custom).toEqual({ ...values, gridOpacity: 22 });
    });

    test("restores original light swatches exactly without dropping the current dark presets", () => {
        const light = CANVAS_APPEARANCE_PRESETS.filter((preset) => preset.values.baseTheme === "light");
        expect(light.map((preset) => preset.values.backgroundColor)).toEqual(["#F0F0F0", "#F3DCE5", "#EEE5D8", "#DFE9E6"]);
        expect(light.every((preset) => preset.values.gridColor === "#000000" && preset.values.gridOpacity === 23)).toBe(true);
        expect(CANVAS_APPEARANCE_PRESETS.filter((preset) => preset.values.baseTheme === "dark").map((preset) => preset.id)).toEqual(["dark", "slate"]);
    });

    test("separate light and dark fine tuning survive fixed modes, JSON reopen and repeated tone switches", () => {
        const pink = updateCustomCanvasAppearance(canvasAppearanceForPreset("pink"), { backgroundBrightness: -2, gridOpacity: 21 }, "dark");
        const slate = updateCustomCanvasAppearance(canvasAppearanceForPreset("slate", pink), { backgroundBrightness: 3, gridOpacity: 35 }, "light");
        const fixed = canvasAppearanceForTheme("light", slate);
        const reopened = normalizeCanvasAppearance(JSON.parse(JSON.stringify(fixed)), "dark");
        const light = enterCustomCanvasAppearance(reopened, "dark");
        expect(light.custom).toEqual(pink.custom);
        const dark = switchCanvasAppearanceTheme(light, "dark");
        expect(dark.custom).toEqual(slate.custom);
        expect(switchCanvasAppearanceTheme(dark, "light").custom).toEqual(pink.custom);
        expect(enterCustomCanvasAppearance(dark, "light")).toBe(dark);
    });

    test("a chosen preset survives fixed mode and reopen without silently restoring older fine tuning", () => {
        const selected = canvasAppearanceForPreset("pink", custom);
        const fixed = canvasAppearanceForTheme("dark", selected);
        const reopened = normalizeCanvasAppearance(JSON.parse(JSON.stringify(fixed)), "dark");
        const light = enterCustomCanvasAppearance(canvasAppearanceForTheme("light", reopened), "dark");
        expect(light.mode).toBe("preset");
        expect(light.preset).toEqual(selected.preset);
        expect(light.custom).toEqual(custom.custom);
        expect(resolveCanvasAppearance(light, "dark").background).toBe("#F3DCE5");
    });

    test("legacy opposite-tone custom memory is retained but never applied to the current tone", () => {
        const legacy = { mode: "preset" as const, preset: canvasAppearanceForPreset("dark").preset, custom: custom.custom };
        const normalized = normalizeCanvasAppearance(legacy, "dark");
        expect(normalized).toEqual(legacy);
        const dark = enterCustomCanvasAppearance(canvasAppearanceForTheme("dark", normalized), "light");
        expect(resolveCanvasAppearance(dark, "light").baseTheme).toBe("dark");
        expect(switchCanvasAppearanceTheme(dark, "light").custom).toEqual(custom.custom);
    });

    test("selecting the current tone is a no-op for fixed, preset and custom appearances", () => {
        const fixed = canvasAppearanceForTheme("light", custom);
        const preset = canvasAppearanceForPreset("pink", custom);
        for (const appearance of [fixed, preset, custom]) {
            expect(switchCanvasAppearanceTheme(appearance, "light")).toBe(appearance);
        }
        const dark = canvasAppearanceForTheme("dark", custom);
        expect(switchCanvasAppearanceTheme(dark, "dark")).toBe(dark);
    });

    test("a legacy fixed tone keeps its visible values and older tuning after a round trip and reopen", () => {
        for (const theme of ["light", "dark"] as const) {
            const savedCustom = updateCustomCanvasAppearance(canvasAppearanceForPreset(theme), { gridOpacity: 17 }, theme);
            const fixed = canvasAppearanceForTheme(theme, savedCustom);
            const visible = canvasAppearanceValues(fixed, theme);
            const opposite = theme === "light" ? "dark" : "light";
            const away = switchCanvasAppearanceTheme(fixed, opposite);
            const reopened = normalizeCanvasAppearance(JSON.parse(JSON.stringify(away)), opposite);
            const restored = switchCanvasAppearanceTheme(reopened, theme);
            expect(canvasAppearanceValues(restored, opposite)).toEqual(visible);
            expect(restored.custom).toEqual(savedCustom.custom);
            expect(restored.preset?.values.gridOpacity).toBe(theme === "light" ? 80 : 32);
            expect(canvasAppearanceValues(switchCanvasAppearanceTheme(restored, opposite), theme)).toEqual(canvasAppearanceValues(away, theme));
        }
    });

    test("rejects invalid and opposite-tone saved entries while retaining valid saved snapshots", () => {
        const value = { ...custom, themeMemory: { light: { mode: "preset", preset: { id: "pink", values: { ...custom.custom, backgroundColor: "#F3DCE5" } } }, dark: custom } };
        const normalized = normalizeCanvasAppearance(value, "light");
        expect(normalized.themeMemory?.dark).toBeUndefined();
        expect(normalized.themeMemory?.light?.preset?.values.backgroundColor).toBe("#F3DCE5");
        const invalid = normalizeCanvasAppearance({ ...value, themeMemory: { dark: { mode: "preset", preset: { id: "missing", values: custom.custom } } } }, "light");
        expect(invalid.themeMemory).toBeUndefined();
        expect(invalid.custom).toEqual(custom.custom);
    });
});
