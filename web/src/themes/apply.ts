import { canvasThemes } from "@/lib/canvas-theme";
import { CANVAS_APPEARANCE_PRESETS } from "@/lib/canvas/canvas-appearance";

import { themePackFor } from "./registry";
import type { ThemeCanvasPatch } from "./types";

// 外观提交（commitPublicAppearance）时调用：按当前皮肤套用主题包的画布配色，并写入品牌名变量。

type MutablePreset = { id: string; label: string; values: (typeof CANVAS_APPEARANCE_PRESETS)[number]["values"] };

let upstream: { themes: ThemeCanvasPatch; presets: Map<string, Omit<MutablePreset, "id">> } | undefined;

function assignDeep(target: ThemeCanvasPatch, patch: ThemeCanvasPatch) {
    for (const [key, value] of Object.entries(patch)) {
        if (typeof value === "string") target[key] = value;
        else if (target[key] && typeof target[key] === "object") assignDeep(target[key] as ThemeCanvasPatch, value);
    }
}

function presets() {
    return CANVAS_APPEARANCE_PRESETS as unknown as MutablePreset[];
}

function restoreUpstream() {
    if (!upstream) return;
    assignDeep(canvasThemes as unknown as ThemeCanvasPatch, upstream.themes);
    for (const preset of presets()) {
        const original = upstream.presets.get(preset.id);
        if (original) Object.assign(preset, { label: original.label, values: original.values });
    }
}

/**
 * 画布配色和画布外观预设写死在上游代码里，皮肤数据改不到：启用带画布配色的主题包时就地替换，
 * 切到其他皮肤时还原上游原值。新建画布会把预设快照进画布数据，所以只影响之后新建的画布。
 */
export function applyThemePackCanvas(skinId: string) {
    const canvas = themePackFor(skinId)?.canvas;
    restoreUpstream();
    if (!canvas) {
        upstream = undefined;
        return;
    }
    const themes = canvasThemes as unknown as ThemeCanvasPatch;
    upstream ??= {
        themes: structuredClone(themes),
        presets: new Map(presets().map((preset) => [preset.id, { label: preset.label, values: preset.values }])),
    };
    assignDeep(themes, canvas.themes);
    for (const preset of presets()) {
        const override = canvas.presets?.[preset.id as "light" | "dark"];
        if (override) Object.assign(preset, { label: override.label, values: { ...override.values } });
    }
}

/** 主题样式里要显示品牌名的地方（例如印章）读这两个变量：完整品牌名，以及取前两个字的印章字。 */
export function applyThemeBrandVariables(brandName: string, targetDocument: Document | undefined = typeof document === "undefined" ? undefined : document) {
    if (!targetDocument) return;
    const name = brandName.trim();
    const seal = Array.from(name).slice(0, 2).join("");
    const root = targetDocument.documentElement;
    root.style.setProperty("--theme-brand-name", JSON.stringify(name));
    root.style.setProperty("--theme-brand-seal", JSON.stringify(seal));
}
