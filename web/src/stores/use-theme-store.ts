import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeName = "light" | "dark";
/** 用户真正选的三档：跟随系统 / 一直浅色 / 一直黑夜。 */
export type ThemePreference = ThemeName | "system";

type ThemeStore = {
    /** 实际生效的主题。首屏脚本、Ant 浮层、画布主题作用域都读它。 */
    theme: ThemeName;
    /** 只存用户的选择；system 下 theme 会随操作系统变化。 */
    preference: ThemePreference;
    setTheme: (theme: ThemeName) => void;
    setPreference: (preference: ThemePreference) => void;
    /** 系统配色变化时调用：只更新生效主题，不把偏好改成 light/dark。 */
    applySystemTheme: () => void;
};

const VALID_THEMES: ThemeName[] = ["light", "dark"];
const VALID_PREFERENCES: ThemePreference[] = ["system", "light", "dark"];
export const THEME_MEDIA_QUERY = "(prefers-color-scheme: dark)";

export function readSystemTheme(): ThemeName {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "light";
    return window.matchMedia(THEME_MEDIA_QUERY).matches ? "dark" : "light";
}

function resolve(preference: ThemePreference): ThemeName {
    return preference === "system" ? readSystemTheme() : preference;
}

export const useThemeStore = create<ThemeStore>()(
    persist(
        (set) => ({
            theme: readSystemTheme(),
            preference: "system",
            // 老账户菜单里的 Switch 走 setTheme：把偏好一起写死，刷新后不会跳回跟随系统。
            setTheme: (next) => set((state) => (VALID_THEMES.includes(next) ? { theme: next, preference: next } : state)),
            setPreference: (next) => set((state) => (VALID_PREFERENCES.includes(next) ? { preference: next, theme: resolve(next) } : state)),
            applySystemTheme: () => set((state) => (state.preference === "system" ? { theme: readSystemTheme() } : state)),
        }),
        {
            name: "yingce:theme_store",
            merge: (persisted, current) => {
                const stored = (persisted || {}) as Partial<ThemeStore>;
                // 写入前 / 恢复时都校验：非法 theme 会造成 canvasThemes[非法值] 为 undefined 而崩。
                const hasTheme = VALID_THEMES.includes(stored.theme as ThemeName);
                const hasPreference = VALID_PREFERENCES.includes(stored.preference as ThemePreference);
                // 全新安装（persist 会拿空值调 merge）或坏数据：保留默认 system，别悄悄改成 light，
                // 否则首屏脚本按系统色上深色、React 接管后又翻回浅色，第一帧会闪一下。
                if (!hasTheme && !hasPreference) return current;
                const theme = hasTheme ? (stored.theme as ThemeName) : "light";
                // 老版本只存 theme：视为用户当时的明确选择，升级后不会突然跟着系统变黑。
                const preference = hasPreference ? (stored.preference as ThemePreference) : theme;
                return { ...current, theme, preference };
            },
        },
    ),
);
