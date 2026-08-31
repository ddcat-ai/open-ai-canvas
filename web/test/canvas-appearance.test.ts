import { beforeEach, describe, expect, test } from "bun:test";

import {
    canvasAppearanceForTheme,
    customCanvasAppearanceFromTheme,
    enterCustomCanvasAppearance,
    normalizeCanvasAppearance,
    normalizeHexColor,
    readCanvasAppearanceDefault,
    resolveCanvasAppearance,
    resolveCanvasGridColor,
    writeCanvasAppearanceDefault,
} from "../src/lib/canvas/canvas-appearance";

const values = new Map<string, string>();

beforeEach(() => {
    values.clear();
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            localStorage: {
                getItem: (key: string) => values.get(key) || null,
                setItem: (key: string, value: string) => values.set(key, value),
                removeItem: (key: string) => values.delete(key),
            },
        },
    });
});

describe("canvas custom appearance", () => {
    test("inherits the active fixed theme the first time custom mode is selected", () => {
        const light = enterCustomCanvasAppearance(canvasAppearanceForTheme("light"), "light");
        expect(light).toEqual({
            mode: "custom",
            custom: {
                baseTheme: "light",
                backgroundColor: "#EDEEEE",
                backgroundBrightness: 0,
                gridColor: "#B6B3B3",
                gridOpacity: 70,
            },
        });

        const dark = enterCustomCanvasAppearance(canvasAppearanceForTheme("dark"), "dark");
        expect(dark.custom).toMatchObject({ baseTheme: "dark", backgroundColor: "#262626", backgroundBrightness: 0, gridColor: "#B6B3B3", gridOpacity: 70 });
    });

    test("restores a previous custom profile only under the same base theme", () => {
        const previous = customCanvasAppearanceFromTheme("light");
        previous.custom = { ...previous.custom!, backgroundColor: "#F3DCE5" };
        const fixedLight = canvasAppearanceForTheme("light", previous);
        expect(enterCustomCanvasAppearance(fixedLight, "light").custom).toEqual(previous.custom);

        const fixedDark = canvasAppearanceForTheme("dark", previous);
        expect(fixedDark.custom).toBeUndefined();
        expect(enterCustomCanvasAppearance(fixedDark, "dark").custom).toMatchObject({
            baseTheme: "dark",
            backgroundColor: "#262626",
        });
    });

    test("keeps color-picker popups inside the appearance interaction boundary", async () => {
        const toolbarSource = await Bun.file(new URL("../src/components/canvas/canvas-toolbar.tsx", import.meta.url)).text();
        const controlsSource = await Bun.file(new URL("../src/components/canvas/canvas-appearance-controls.tsx", import.meta.url)).text();
        expect(toolbarSource).toContain('closest(".ant-color-picker,.ant-popover")');
        expect(controlsSource).toContain("if (normalized) onChange(normalized)");
    });

    test("commits custom colors immediately instead of discarding them when the panel closes", async () => {
        const controlsSource = await Bun.file(new URL("../src/components/canvas/canvas-appearance-controls.tsx", import.meta.url)).text();
        const updateCustomSource = controlsSource.slice(
            controlsSource.indexOf("const updateCustom"),
            controlsSource.indexOf("const resetCustom"),
        );
        expect(updateCustomSource).toContain("onAppearanceChange(next)");
        expect(updateCustomSource).not.toContain("onAppearancePreviewChange(next)");
    });

    test("keeps hex editing live across parent updates and common hex formats", async () => {
        expect(normalizeHexColor("F3DCE5")).toBe("#F3DCE5");
        expect(normalizeHexColor("#f3d")).toBe("#FF33DD");

        const controlsSource = await Bun.file(new URL("../src/components/canvas/canvas-appearance-controls.tsx", import.meta.url)).text();
        expect(controlsSource).toContain("if (!editing) setTextValue(value)");
        expect(controlsSource).toContain("updateCustom({ backgroundColor, backgroundBrightness: 0 })");
    });

    test("adjusts only the custom canvas substrate and grid", () => {
        const appearance = normalizeCanvasAppearance({
            mode: "custom",
            custom: {
                baseTheme: "light",
                backgroundColor: "#F3DCE5",
                backgroundBrightness: 0,
                backgroundOpacity: 10,
                gridColor: "#9D7182",
                gridOpacity: 22,
            },
        }, "dark");

        const resolved = resolveCanvasAppearance(appearance, "dark");
        expect(resolved.baseTheme).toBe("light");
        expect(resolved.background).toBe("#F3DCE5");
        expect(resolveCanvasGridColor(appearance, "dark", "lines")).toBe("rgba(157,113,130,0.22)");

        appearance.custom!.backgroundBrightness = 10;
        const brighter = resolveCanvasAppearance(appearance, "dark").background;
        appearance.custom!.backgroundBrightness = -10;
        const darker = resolveCanvasAppearance(appearance, "dark").background;

        const brighterParts = brighter.match(/^oklch\(([\d.]+)% ([\d.]+) ([\d.]+)\)$/);
        const darkerParts = darker.match(/^oklch\(([\d.]+)% ([\d.]+) ([\d.]+)\)$/);
        expect(brighterParts).not.toBeNull();
        expect(darkerParts).not.toBeNull();
        expect(Number(brighterParts![1])).toBeGreaterThan(Number(darkerParts![1]));
        expect(brighterParts!.slice(2)).toEqual(darkerParts!.slice(2));
    });

    test("switches the custom interface style without changing custom canvas colors", () => {
        const appearance = customCanvasAppearanceFromTheme("dark");
        appearance.custom = {
            ...appearance.custom!,
            baseTheme: "light",
            backgroundColor: "#F3DCE5",
            gridColor: "#9D7182",
            gridOpacity: 22,
        };

        expect(resolveCanvasAppearance(appearance, "dark")).toEqual({
            baseTheme: "light",
            background: "#F3DCE5",
            grid: "rgba(157,113,130,0.22)",
        });
    });

    test("does not expose background opacity after legacy values are ignored", async () => {
        const controlsSource = await Bun.file(new URL("../src/components/canvas/canvas-appearance-controls.tsx", import.meta.url)).text();
        expect(controlsSource).not.toContain('label="背景透明度"');
        expect(controlsSource).toContain('aria-label="界面样式"');
        expect(controlsSource).toContain('label="网格强度"');
    });

    test("stores defaults locally with the active account scope", () => {
        window.localStorage.setItem("infinite-canvas:active-user-scope", "account-A");
        const value = { appearance: customCanvasAppearanceFromTheme("dark"), backgroundMode: "lines" as const };
        writeCanvasAppearanceDefault(value);

        expect(values.has("infinite-canvas:canvas-appearance-default:user:account-A")).toBe(true);
        expect(readCanvasAppearanceDefault()).toEqual(value);

        window.localStorage.setItem("infinite-canvas:active-user-scope", "account-B");
        expect(readCanvasAppearanceDefault()).toBeNull();
    });
});
