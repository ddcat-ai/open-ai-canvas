// SupDance 主题与品牌皮肤预设扩展（独立命名空间）。
//
// 复用上游 web/src/lib/skin-themes.ts 的三层令牌体系（Primitive → Semantic → Component），
// 不在全局 CSS 中追加不受控覆盖或 !important，也不污染管理后台或破坏经典默认皮肤。

import { applySkinTheme, DEFAULT_CLASSIC_SKIN, duplicateSkinDefinition, normalizeSkinDefinition, type SkinDefinition, type SkinThemeMode } from "@/lib/skin-themes";

export const SUPDANCE_SKIN_ID = "supdance-studio" as const;

export const SUPDANCE_BRAND_DEFAULTS = {
    brandName: "SupDance Canvas",
    brandSlug: "supdance-canvas",
    skinId: SUPDANCE_SKIN_ID,
} as const;

/**
 * 构建 SupDance Studio 专属预设主题。
 * 基于上游 DEFAULT_CLASSIC_SKIN 完整克隆，保持 50×2 语义颜色令牌与 17 项组件参数完整合规。
 */
export function createSupDanceSkinDefinition(): SkinDefinition {
    const base = duplicateSkinDefinition(DEFAULT_CLASSIC_SKIN, ["classic"], "SupDance Studio");
    const draft: SkinDefinition = {
        ...base,
        id: SUPDANCE_SKIN_ID,
        name: "SupDance Studio",
        description: "SupDance 创作者工作台预设皮肤，遵循三层令牌契约并隔离管理后台默认样式。",
        locked: false,
        tokens: {
            ...base.tokens,
            light: {
                ...base.tokens.light,
                primary: "#4f46e5",
                primaryHover: "#4338ca",
                primaryActive: "#3730a3",
                primaryForeground: "#ffffff",
                selected: "#eef2ff",
                selectedHover: "#e0e7ff",
                selectedActive: "#c7d2fe",
                selectedForeground: "#312e81",
                controlFocus: "#6366f1",
                iconActive: "#4f46e5",
            },
            dark: {
                ...base.tokens.dark,
                primary: "#6366f1",
                primaryHover: "#818cf8",
                primaryActive: "#4f46e5",
                primaryForeground: "#ffffff",
                selected: "#1e1b4b",
                selectedHover: "#312e81",
                selectedActive: "#3730a3",
                selectedForeground: "#e0e7ff",
                controlFocus: "#818cf8",
                iconActive: "#818cf8",
            },
            components: {
                ...base.tokens.components,
                buttonRadius: 10,
                inputRadius: 10,
                cardRadius: 14,
                overlayRadius: 14,
                menuRadius: 8,
            },
            buttons: {
                light: {
                    mode: "gradient",
                    angle: 120,
                    start: "#4f46e5",
                    end: "#2563eb",
                    hoverStart: "#4338ca",
                    hoverEnd: "#1d4ed8",
                    activeStart: "#3730a3",
                    activeEnd: "#1e40af",
                    foreground: "#ffffff",
                },
                dark: {
                    mode: "gradient",
                    angle: 120,
                    start: "#6366f1",
                    end: "#3b82f6",
                    hoverStart: "#818cf8",
                    hoverEnd: "#60a5fa",
                    activeStart: "#4f46e5",
                    activeEnd: "#2563eb",
                    foreground: "#ffffff",
                },
            },
        },
    };
    return normalizeSkinDefinition(draft);
}

/**
 * 启用或恢复主题：
 * - enabled = true 时应用 SupDance Studio 皮肤（或传入的自定义皮肤）
 * - enabled = false 时无损恢复上游 DEFAULT_CLASSIC_SKIN
 */
export function applySupDanceTheme(mode: SkinThemeMode, options: { enabled?: boolean; customSkin?: SkinDefinition; targetDocument?: Document } = {}): SkinDefinition {
    const { enabled = true, customSkin, targetDocument } = options;
    const activeSkin = enabled ? (customSkin ?? createSupDanceSkinDefinition()) : DEFAULT_CLASSIC_SKIN;
    applySkinTheme(activeSkin, mode, targetDocument);
    return activeSkin;
}
