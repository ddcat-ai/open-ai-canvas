import { canvasThemes, type CanvasBackgroundMode, type CanvasColorTheme } from "@/lib/canvas-theme";
import { scopedLocalStorage } from "@/lib/user-scope";

export type CanvasAppearanceMode = CanvasColorTheme | "custom";

export type CanvasCustomAppearance = {
    baseTheme: CanvasColorTheme;
    backgroundColor: string;
    backgroundBrightness: number;
    gridColor: string;
    gridOpacity: number;
};

export type CanvasAppearance = {
    mode: CanvasAppearanceMode;
    custom?: CanvasCustomAppearance;
};

export type CanvasAppearanceDefault = {
    appearance: CanvasAppearance;
    backgroundMode: CanvasBackgroundMode;
};

export type ResolvedCanvasAppearance = {
    baseTheme: CanvasColorTheme;
    background: string;
    grid: string;
};

const CANVAS_APPEARANCE_DEFAULT_KEY = "infinite-canvas:canvas-appearance-default";
const HEX_COLOR_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
const CUSTOM_GRID_COLOR = "#B6B3B3";
const CUSTOM_GRID_OPACITY = 70;

export function canvasAppearanceForTheme(theme: CanvasColorTheme, previous?: CanvasAppearance): CanvasAppearance {
    return previous?.custom?.baseTheme === theme ? { mode: theme, custom: previous.custom } : { mode: theme };
}

export function customCanvasAppearanceFromTheme(theme: CanvasColorTheme): CanvasAppearance {
    return {
        mode: "custom",
        custom: {
            baseTheme: theme,
            backgroundColor: canvasThemes[theme].canvas.background.toUpperCase(),
            backgroundBrightness: 0,
            gridColor: CUSTOM_GRID_COLOR,
            gridOpacity: CUSTOM_GRID_OPACITY,
        },
    };
}

export function enterCustomCanvasAppearance(current: CanvasAppearance, currentTheme: CanvasColorTheme) {
    if (current.custom) return { ...current, mode: "custom" } as CanvasAppearance;
    return customCanvasAppearanceFromTheme(currentTheme);
}

export function canvasAppearanceBaseTheme(appearance: CanvasAppearance | undefined, fallback: CanvasColorTheme): CanvasColorTheme {
    if (appearance?.mode === "light" || appearance?.mode === "dark") return appearance.mode;
    return appearance?.custom?.baseTheme === "light" || appearance?.custom?.baseTheme === "dark"
        ? appearance.custom.baseTheme
        : fallback;
}

export function normalizeCanvasAppearance(value: unknown, fallback: CanvasColorTheme): CanvasAppearance {
    if (!value || typeof value !== "object") return canvasAppearanceForTheme(fallback);
    const candidate = value as Partial<CanvasAppearance>;
    const mode = candidate.mode === "light" || candidate.mode === "dark" || candidate.mode === "custom" ? candidate.mode : fallback;
    const custom = normalizeCustomAppearance(candidate.custom);
    if (mode === "custom" && !custom) return customCanvasAppearanceFromTheme(fallback);
    return custom ? { mode, custom } : { mode };
}

export function resolveCanvasAppearance(appearance: CanvasAppearance | undefined, fallback: CanvasColorTheme): ResolvedCanvasAppearance {
    const normalized = normalizeCanvasAppearance(appearance, fallback);
    const baseTheme = canvasAppearanceBaseTheme(normalized, fallback);
    const base = canvasThemes[baseTheme];
    if (normalized.mode !== "custom" || !normalized.custom) {
        return {
            baseTheme,
            background: base.canvas.background,
            grid: base.canvas.line,
        };
    }

    const custom = normalized.custom;
    return {
        baseTheme,
        background: adjustHexLightnessOklch(custom.backgroundColor, custom.backgroundBrightness),
        grid: rgbaFromHex(custom.gridColor, custom.gridOpacity / 100),
    };
}

export function resolveCanvasGridColor(appearance: CanvasAppearance | undefined, fallback: CanvasColorTheme, mode: CanvasBackgroundMode) {
    const normalized = normalizeCanvasAppearance(appearance, fallback);
    if (normalized.mode === "custom" && normalized.custom) return rgbaFromHex(normalized.custom.gridColor, normalized.custom.gridOpacity / 100);
    const theme = canvasThemes[canvasAppearanceBaseTheme(normalized, fallback)];
    return mode === "dots" ? theme.canvas.dot : theme.canvas.line;
}

export function normalizeHexColor(value: string) {
    const match = value.trim().match(HEX_COLOR_PATTERN);
    if (!match) return null;
    const hex = match[1].length === 3
        ? match[1].split("").map((channel) => channel.repeat(2)).join("")
        : match[1];
    return `#${hex.toUpperCase()}`;
}

export function readCanvasAppearanceDefault(): CanvasAppearanceDefault | null {
    const value = scopedLocalStorage.getItem(CANVAS_APPEARANCE_DEFAULT_KEY);
    if (!value) return null;
    try {
        const parsed = JSON.parse(value) as Partial<CanvasAppearanceDefault>;
        if (parsed.backgroundMode !== "dots" && parsed.backgroundMode !== "lines" && parsed.backgroundMode !== "blank") return null;
        const fallback = canvasAppearanceBaseTheme(parsed.appearance, "dark");
        return {
            appearance: normalizeCanvasAppearance(parsed.appearance, fallback),
            backgroundMode: parsed.backgroundMode,
        };
    } catch {
        return null;
    }
}

export function writeCanvasAppearanceDefault(value: CanvasAppearanceDefault) {
    const fallback = canvasAppearanceBaseTheme(value.appearance, "dark");
    scopedLocalStorage.setItem(CANVAS_APPEARANCE_DEFAULT_KEY, JSON.stringify({
        appearance: normalizeCanvasAppearance(value.appearance, fallback),
        backgroundMode: value.backgroundMode,
    }));
}

function normalizeCustomAppearance(value: unknown): CanvasCustomAppearance | undefined {
    if (!value || typeof value !== "object") return undefined;
    const candidate = value as Partial<CanvasCustomAppearance>;
    const backgroundColor = typeof candidate.backgroundColor === "string" ? normalizeHexColor(candidate.backgroundColor) : null;
    const gridColor = typeof candidate.gridColor === "string" ? normalizeHexColor(candidate.gridColor) : null;
    if (!backgroundColor || !gridColor || (candidate.baseTheme !== "light" && candidate.baseTheme !== "dark")) return undefined;
    return {
        baseTheme: candidate.baseTheme,
        backgroundColor,
        backgroundBrightness: clampNumber(candidate.backgroundBrightness, -30, 30, 0),
        gridColor,
        gridOpacity: clampNumber(candidate.gridOpacity, 0, 100, CUSTOM_GRID_OPACITY),
    };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
    return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function rgbaFromHex(value: string, opacity: number) {
    const normalized = normalizeHexColor(value) || "#808080";
    const [red, green, blue] = [1, 3, 5].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16));
    return `rgba(${red},${green},${blue},${clampNumber(opacity, 0, 1, 1).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")})`;
}

function adjustHexLightnessOklch(value: string, amount: number) {
    const normalized = normalizeHexColor(value) || "#808080";
    if (!amount) return normalized;
    const [red, green, blue] = [1, 3, 5]
        .map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255)
        .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
    const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
    const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
    const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    const b = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    const chroma = Math.sqrt(a * a + b * b);
    const hue = chroma < 0.0001 ? 0 : (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
    const adjustedLightness = Math.min(1, Math.max(0, lightness + amount / 100));
    return `oklch(${(adjustedLightness * 100).toFixed(2)}% ${chroma.toFixed(4)} ${hue.toFixed(2)})`;
}
