import { describe, expect, test } from "bun:test";
import { applySkinTheme, DEFAULT_CLASSIC_SKIN, duplicateSkinDefinition, getSkinButtonAppearance, isSkinButtonFill, normalizeSkinDefinition } from "../src/lib/skin-themes";

describe("theme primary button fills", () => {
    test("classic uses the reference gradient in both modes without changing selection colors", () => {
        for (const mode of ["light", "dark"] as const) {
            expect(getSkinButtonAppearance(DEFAULT_CLASSIC_SKIN, mode)).toEqual({
                background: "linear-gradient(115deg, #6554df, #386fbc)",
                hover: "linear-gradient(115deg, #5744cf, #356bbb)",
                active: "linear-gradient(115deg, #4938b8, #2c5da5)", foreground: "#ffffff",
            });
        }
        expect(DEFAULT_CLASSIC_SKIN.tokens.light.selected).toBe("#e8e8e8");
    });

    test("copies have independent fills and switching to solid clears every gradient state", () => {
        const skin = duplicateSkinDefinition(DEFAULT_CLASSIC_SKIN, ["classic"]);
        skin.tokens.buttons.light.angle = 45;
        skin.tokens.buttons.light.start = "#123456";
        expect(DEFAULT_CLASSIC_SKIN.tokens.buttons.light.angle).toBe(115);
        expect(skin.tokens.buttons.dark.angle).toBe(115);
        expect(getSkinButtonAppearance(skin, "light").background).toBe("linear-gradient(45deg, #123456, #386fbc)");
        const values = new Map<string, string>();
        const doc = { documentElement: { dataset: {}, style: {
            removeProperty: (key: string) => values.delete(key), setProperty: (key: string, value: string) => values.set(key, value),
        } } } as unknown as Document;
        applySkinTheme(skin, "light", doc);
        skin.tokens.buttons.light.mode = "solid";
        Object.assign(skin.tokens.light, { primary: "#123456", primaryHover: "#234567", primaryActive: "#345678", primaryForeground: "#ffffff" });
        applySkinTheme(skin, "light", doc);
        expect(values.get("--button-primary-bg")).toBe("#123456");
        expect(values.get("--button-primary-hover-bg")).toBe("#234567");
        expect(values.get("--button-primary-active-bg")).toBe("#345678");
        applySkinTheme(DEFAULT_CLASSIC_SKIN, "dark", doc);
        expect(values.has("--background")).toBe(false);
        expect(values.get("--button-primary-fg")).toBe("#ffffff");
    });

    test("legacy custom themes retain solid actions; legacy classic gains its default gradient", () => {
        for (const original of [DEFAULT_CLASSIC_SKIN, duplicateSkinDefinition(DEFAULT_CLASSIC_SKIN, ["classic"])]) {
            const legacy = JSON.parse(JSON.stringify(original));
            delete legacy.tokens.buttons;
            expect(normalizeSkinDefinition(legacy).tokens.buttons.light.mode).toBe(original.id === "classic" ? "gradient" : "solid");
        }
    });

    test("invalid modes, angles and CSS injection cannot become runtime gradients", () => {
        for (const patch of [{ mode: "url(x)" }, { angle: 361 }, { angle: -1 }, { angle: 1.5 }, { angle: NaN }, { start: "red; background:url(x)" }, { foreground: "white" }]) {
            const skin = duplicateSkinDefinition(DEFAULT_CLASSIC_SKIN, ["classic"]);
            Object.assign(skin.tokens.buttons.light, patch);
            expect(isSkinButtonFill(skin.tokens.buttons.light)).toBe(false);
            expect(getSkinButtonAppearance(normalizeSkinDefinition(skin), "light").background).toBe(skin.tokens.light.primary);
        }
    });
});
