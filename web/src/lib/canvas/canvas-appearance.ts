import { canvasThemes, type CanvasBackgroundMode, type CanvasColorTheme } from "@/lib/canvas-theme";
import { scopedLocalStorage } from "@/lib/user-scope";

export type CanvasAppearanceMode = CanvasColorTheme | "custom" | "preset";
export type CanvasAppearancePresetId = "light" | "pink" | "sand" | "mint" | "dark" | "slate";

export type CanvasCustomAppearance = {
    baseTheme: CanvasColorTheme;
    backgroundColor: string;
    backgroundBrightness: number;
    gridColor: string;
    gridOpacity: number;
};

type CanvasAppearanceSelection = {
    mode: "preset" | "custom";
    preset?: { id: CanvasAppearancePresetId; values: CanvasCustomAppearance };
    custom?: CanvasCustomAppearance;
};

export type CanvasAppearance = Omit<CanvasAppearanceSelection, "mode"> & {
    mode: CanvasAppearanceMode;
    // Snapshots keep each tone's chosen preset and last fine tuning across switches and reloads.
    themeMemory?: Partial<Record<CanvasColorTheme, CanvasAppearanceSelection>>;
};

export const CANVAS_APPEARANCE_PRESETS: ReadonlyArray<{ id: CanvasAppearancePresetId; label: string; values: CanvasCustomAppearance }> = [
    { id: "light", label: "经典浅色", values: { baseTheme: "light", backgroundColor: "#F0F0F0", backgroundBrightness: 0, gridColor: "#000000", gridOpacity: 23 } },
    { id: "pink", label: "粉色", values: { baseTheme: "light", backgroundColor: "#F3DCE5", backgroundBrightness: 0, gridColor: "#000000", gridOpacity: 23 } },
    { id: "sand", label: "米色", values: { baseTheme: "light", backgroundColor: "#EEE5D8", backgroundBrightness: 0, gridColor: "#000000", gridOpacity: 23 } },
    { id: "mint", label: "浅绿", values: { baseTheme: "light", backgroundColor: "#DFE9E6", backgroundBrightness: 0, gridColor: "#000000", gridOpacity: 23 } },
    { id: "dark", label: "经典深色", values: { baseTheme: "dark", backgroundColor: "#000000", backgroundBrightness: 0, gridColor: "#FFFFFF", gridOpacity: 32 } },
    { id: "slate", label: "柔和深灰", values: { baseTheme: "dark", backgroundColor: "#101418", backgroundBrightness: 0, gridColor: "#CFD8E3", gridOpacity: 30 } },
];

export type CanvasAppearanceDefault = {
    appearance: CanvasAppearance;
    backgroundMode: CanvasBackgroundMode;
};

export type ResolvedCanvasAppearance = {
    baseTheme: CanvasColorTheme;
    background: string;
    grid: string;
};

export const DEFAULT_CANVAS_BACKGROUND_MODE: CanvasBackgroundMode = "dots";
export const NEW_CANVAS_BACKGROUND_MODE: CanvasBackgroundMode = "lines";

const CANVAS_APPEARANCE_DEFAULT_KEY = "yingce:canvas-appearance-default";
const HEX_COLOR_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
const CUSTOM_GRID_COLOR: Record<CanvasColorTheme, string> = { light: "#000000", dark: "#FFFFFF" };
const CUSTOM_GRID_OPACITY: Record<CanvasColorTheme, number> = { light: 80, dark: 32 };

export function canvasAppearanceForTheme(theme: CanvasColorTheme, previous?: CanvasAppearance): CanvasAppearance {
    return withThemeMemory({ ...previous, mode: theme }, previous);
}

export function canvasAppearanceForPreset(id: CanvasAppearancePresetId, previous?: CanvasAppearance): CanvasAppearance {
    const preset = CANVAS_APPEARANCE_PRESETS.find((item) => item.id === id)!;
    const saved = rememberAppearance(previous);
    const custom = saved[preset.values.baseTheme]?.custom;
    return withThemeMemory({
        mode: "preset",
        preset: { id, values: { ...preset.values } },
        ...(custom ? { custom: { ...custom } } : {}),
    }, previous);
}

export function canvasAppearanceValues(appearance: CanvasAppearance, fallback: CanvasColorTheme): CanvasCustomAppearance {
    const normalized = normalizeCanvasAppearance(appearance, fallback);
    if (normalized.mode === "preset" && normalized.preset) return normalized.preset.values;
    if (normalized.mode === "custom" && normalized.custom) return normalized.custom;
    return customCanvasAppearanceFromTheme(canvasAppearanceBaseTheme(normalized, fallback)).custom!;
}

export function updateCustomCanvasAppearance(appearance: CanvasAppearance, patch: Partial<CanvasCustomAppearance>, fallback: CanvasColorTheme): CanvasAppearance {
    const current = patch.baseTheme && patch.baseTheme !== canvasAppearanceBaseTheme(appearance, fallback)
        ? switchCanvasAppearanceTheme(appearance, patch.baseTheme)
        : appearance;
    return withThemeMemory(normalizeCanvasAppearance({
        mode: "custom",
        preset: current.preset,
        custom: { ...canvasAppearanceValues(current, fallback), ...patch },
    }, fallback), current);
}

export function customCanvasAppearanceFromTheme(theme: CanvasColorTheme): CanvasAppearance {
    return {
        mode: "custom",
        custom: {
            baseTheme: theme,
            backgroundColor: canvasThemes[theme].canvas.background.toUpperCase(),
            backgroundBrightness: 0,
            gridColor: CUSTOM_GRID_COLOR[theme],
            gridOpacity: CUSTOM_GRID_OPACITY[theme],
        },
    };
}

export function enterCustomCanvasAppearance(current: CanvasAppearance, currentTheme: CanvasColorTheme): CanvasAppearance {
    if (current.mode === "custom" || current.mode === "preset") return current;
    const theme = canvasAppearanceBaseTheme(current, currentTheme);
    const saved = rememberAppearance(current)[theme];
    return withThemeMemory(saved ?? customCanvasAppearanceFromTheme(theme), current);
}

export function switchCanvasAppearanceTheme(current: CanvasAppearance, theme: CanvasColorTheme): CanvasAppearance {
    const currentTheme = canvasAppearanceBaseTheme(current, theme);
    if (currentTheme === theme) return current;
    let previous = current;
    if (current.mode === "light" || current.mode === "dark") {
        const memory = rememberAppearance(current);
        // Preserve the visible legacy theme, including its original grid strength.
        previous = withThemeMemory({
            mode: "preset",
            preset: { id: currentTheme, values: canvasAppearanceValues(current, currentTheme) },
            custom: memory[currentTheme]?.custom,
        }, current);
    }
    const saved = rememberAppearance(previous)[theme];
    return saved ? withThemeMemory(saved, previous) : canvasAppearanceForPreset(theme, previous);
}

function rememberAppearance(appearance?: CanvasAppearance): NonNullable<CanvasAppearance["themeMemory"]> {
    const memory = { ...appearance?.themeMemory };
    // Older canvases kept only one custom entry, sometimes beside a preset of the other tone.
    if (appearance?.custom && !memory[appearance.custom.baseTheme]) {
        memory[appearance.custom.baseTheme] = { mode: "custom", custom: { ...appearance.custom } };
    }
    if (appearance?.mode === "preset" || appearance?.mode === "custom") {
        const theme = canvasAppearanceBaseTheme(appearance, "light");
        memory[theme] = {
            mode: appearance.mode,
            ...(appearance.preset?.values.baseTheme === theme ? { preset: { ...appearance.preset, values: { ...appearance.preset.values } } } : {}),
            ...(appearance.custom?.baseTheme === theme ? { custom: { ...appearance.custom } } : {}),
        };
    }
    return memory;
}

function withThemeMemory(next: CanvasAppearance, previous?: CanvasAppearance): CanvasAppearance {
    const themeMemory = rememberAppearance({ ...next, themeMemory: rememberAppearance(previous) });
    return Object.keys(themeMemory).length ? { ...next, themeMemory } : next;
}

export function canvasAppearanceBaseTheme(appearance: CanvasAppearance | undefined, fallback: CanvasColorTheme): CanvasColorTheme {
    if (appearance?.mode === "light" || appearance?.mode === "dark") return appearance.mode;
    if (appearance?.mode === "preset" && appearance.preset) return appearance.preset.values.baseTheme;
    return appearance?.custom?.baseTheme === "light" || appearance?.custom?.baseTheme === "dark"
        ? appearance.custom.baseTheme
        : fallback;
}

export function normalizeCanvasAppearance(value: unknown, fallback: CanvasColorTheme): CanvasAppearance {
    if (!value || typeof value !== "object") return { mode: fallback };
    const candidate = value as Partial<CanvasAppearance>;
    let mode = candidate.mode === "light" || candidate.mode === "dark" || candidate.mode === "custom" || candidate.mode === "preset" ? candidate.mode : fallback;
    const custom = normalizeCustomAppearance(candidate.custom);
    const preset = normalizePreset(candidate.preset);
    const themeMemory: NonNullable<CanvasAppearance["themeMemory"]> = {};
    for (const theme of ["light", "dark"] as const) {
        const saved = candidate.themeMemory?.[theme];
        if (!saved || typeof saved !== "object") continue;
        const savedCustom = normalizeCustomAppearance(saved.custom);
        const savedPreset = normalizePreset(saved.preset);
        const selection = {
            mode: saved.mode,
            ...(savedCustom?.baseTheme === theme ? { custom: savedCustom } : {}),
            ...(savedPreset?.values.baseTheme === theme ? { preset: savedPreset } : {}),
        };
        if ((selection.mode === "custom" && selection.custom) || (selection.mode === "preset" && selection.preset)) themeMemory[theme] = selection;
    }
    if (mode === "preset" && !preset) mode = custom ? "custom" : fallback;
    const normalized = mode === "custom" && !custom ? customCanvasAppearanceFromTheme(fallback)
        : { mode, ...(custom ? { custom } : {}), ...(preset ? { preset } : {}) };
    return { ...normalized, ...(Object.keys(themeMemory).length ? { themeMemory } : {}) };
}

function normalizePreset(value: CanvasAppearance["preset"]) {
    const values = normalizeCustomAppearance(value?.values);
    return values && CANVAS_APPEARANCE_PRESETS.some((item) => item.id === value?.id)
        ? { id: value!.id, values } : undefined;
}

export function resolveCanvasAppearance(appearance: CanvasAppearance | undefined, fallback: CanvasColorTheme): ResolvedCanvasAppearance {
    const normalized = normalizeCanvasAppearance(appearance, fallback);
    const baseTheme = canvasAppearanceBaseTheme(normalized, fallback);
    const base = canvasThemes[baseTheme];
    if (normalized.mode !== "custom" && normalized.mode !== "preset") {
        return {
            baseTheme,
            background: base.canvas.background,
            grid: base.canvas.line,
        };
    }

    const custom = normalized.mode === "preset" ? normalized.preset!.values : normalized.custom!;
    return {
        baseTheme,
        background: adjustHexLightnessOklch(custom.backgroundColor, custom.backgroundBrightness),
        grid: rgbaFromHex(custom.gridColor, custom.gridOpacity / 100),
    };
}

export function resolveCanvasGridColor(appearance: CanvasAppearance | undefined, fallback: CanvasColorTheme, mode: CanvasBackgroundMode) {
    const normalized = normalizeCanvasAppearance(appearance, fallback);
    if (normalized.mode === "preset" && normalized.preset) return rgbaFromHex(normalized.preset.values.gridColor, normalized.preset.values.gridOpacity / 100);
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
        gridOpacity: clampNumber(candidate.gridOpacity, 0, 100, CUSTOM_GRID_OPACITY[candidate.baseTheme]),
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
