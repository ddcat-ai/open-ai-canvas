import { describe, expect, test } from "bun:test";
import { applySkinTheme, DEFAULT_CLASSIC_SKIN, duplicateSkinDefinition, getSkinButtonAppearance, isSkinButtonFill, normalizeSkinDefinition } from "../src/lib/skin-themes";

describe("theme primary button fills", () => {
    test("classic primary is a solid ink fill in both modes without changing selection colors", () => {
        expect(getSkinButtonAppearance(DEFAULT_CLASSIC_SKIN, "light")).toEqual({ background: "#171717", hover: "#303030", active: "#404040", foreground: "#ffffff" });
        expect(getSkinButtonAppearance(DEFAULT_CLASSIC_SKIN, "dark")).toEqual({ background: "#f5f5f5", hover: "#ffffff", active: "#e5e5e5", foreground: "#171717" });
        for (const mode of ["light", "dark"] as const) {
            expect(DEFAULT_CLASSIC_SKIN.tokens.buttons[mode].mode).toBe("solid");
            expect(JSON.stringify(DEFAULT_CLASSIC_SKIN.tokens.buttons[mode])).not.toMatch(/#6554df|#386fbc/i);
        }
        expect(DEFAULT_CLASSIC_SKIN.tokens.light.selected).toBe("#e8e8e8");
    });

    test("classic leaves primary button variables to globals.css", () => {
        const values = new Map<string, string>();
        const doc = { documentElement: { dataset: {}, style: {
            removeProperty: (key: string) => values.delete(key), setProperty: (key: string, value: string) => values.set(key, value),
        } } } as unknown as Document;
        values.set("--button-primary-bg", "stale");
        applySkinTheme(DEFAULT_CLASSIC_SKIN, "dark", doc);
        expect(values.size).toBe(0);
    });

    test("copies have independent fills and switching to solid clears every gradient state", () => {
        const skin = duplicateSkinDefinition(DEFAULT_CLASSIC_SKIN, ["classic"]);
        skin.tokens.buttons.light.mode = "gradient";
        skin.tokens.buttons.light.angle = 45;
        skin.tokens.buttons.light.start = "#123456";
        expect(DEFAULT_CLASSIC_SKIN.tokens.buttons.light.angle).toBe(180);
        expect(DEFAULT_CLASSIC_SKIN.tokens.buttons.light.mode).toBe("solid");
        expect(skin.tokens.buttons.dark.angle).toBe(180);
        expect(getSkinButtonAppearance(skin, "light").background).toBe("linear-gradient(45deg, #123456, #18181b)");
        const values = new Map<string, string>();
        const doc = { documentElement: { dataset: {}, style: {
            removeProperty: (key: string) => values.delete(key), setProperty: (key: string, value: string) => values.set(key, value),
        } } } as unknown as Document;
        applySkinTheme(skin, "light", doc);
        expect(values.get("--button-primary-bg")).toBe("linear-gradient(45deg, #123456, #18181b)");
        skin.tokens.buttons.light.mode = "solid";
        Object.assign(skin.tokens.light, { primary: "#123456", primaryHover: "#234567", primaryActive: "#345678", primaryForeground: "#ffffff" });
        applySkinTheme(skin, "light", doc);
        expect(values.get("--button-primary-bg")).toBe("#123456");
        expect(values.get("--button-primary-hover-bg")).toBe("#234567");
        expect(values.get("--button-primary-active-bg")).toBe("#345678");
        applySkinTheme(DEFAULT_CLASSIC_SKIN, "dark", doc);
        expect(values.has("--background")).toBe(false);
        expect(values.has("--button-primary-fg")).toBe(false);
    });

    test("legacy themes without fills fall back to solid primary actions", () => {
        for (const original of [DEFAULT_CLASSIC_SKIN, duplicateSkinDefinition(DEFAULT_CLASSIC_SKIN, ["classic"])]) {
            const legacy = JSON.parse(JSON.stringify(original));
            delete legacy.tokens.buttons;
            const normalized = normalizeSkinDefinition(legacy);
            expect(normalized.tokens.buttons.light.mode).toBe("solid");
            expect(normalized.tokens.buttons.dark.mode).toBe("solid");
        }
    });

    test("invalid modes, angles and CSS injection cannot become runtime gradients", () => {
        for (const patch of [{ mode: "url(x)" }, { angle: 361 }, { angle: -1 }, { angle: 1.5 }, { angle: NaN }, { start: "red; background:url(x)" }, { foreground: "white" }]) {
            const skin = duplicateSkinDefinition(DEFAULT_CLASSIC_SKIN, ["classic"]);
            Object.assign(skin.tokens.buttons.light, { mode: "gradient" }, patch);
            expect(isSkinButtonFill(skin.tokens.buttons.light)).toBe(false);
            expect(getSkinButtonAppearance(normalizeSkinDefinition(skin), "light").background).toBe(skin.tokens.light.primary);
        }
    });
});
