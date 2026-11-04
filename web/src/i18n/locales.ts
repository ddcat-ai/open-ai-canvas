/** 界面支持的语言。code 同时用作 i18next 语言、<html lang> 和 Intl 区域设置。 */
export const SUPPORTED_LOCALES = [
    { code: "zh-CN", label: "简体中文" },
    { code: "en-US", label: "English" },
    { code: "fr-FR", label: "Français" },
    { code: "de-DE", label: "Deutsch" },
    { code: "ja-JP", label: "日本語" },
    { code: "ko-KR", label: "한국어" },
] as const;

export type AppLocale = (typeof SUPPORTED_LOCALES)[number]["code"];

export const DEFAULT_LOCALE: AppLocale = "zh-CN";

export function isAppLocale(value: unknown): value is AppLocale {
    return SUPPORTED_LOCALES.some((locale) => locale.code === value);
}

/** 把浏览器语言（如 en、ja-JP、zh-TW）映射到支持的语言；按语言主标签匹配，匹配不到返回 undefined。 */
export function matchAppLocale(value: string | undefined | null): AppLocale | undefined {
    const normalized = (value || "").trim().toLowerCase();
    if (!normalized) return undefined;
    const exact = SUPPORTED_LOCALES.find((locale) => locale.code.toLowerCase() === normalized);
    if (exact) return exact.code;
    const primary = normalized.split(/[-_]/)[0];
    return SUPPORTED_LOCALES.find((locale) => locale.code.toLowerCase().split("-")[0] === primary)?.code;
}

/** 首次访问时按浏览器语言偏好选择界面语言，都不支持时回退简体中文。 */
export function detectBrowserLocale(languages: readonly string[] | undefined = typeof navigator === "undefined" ? undefined : navigator.languages): AppLocale {
    for (const language of languages || []) {
        const matched = matchAppLocale(language);
        if (matched) return matched;
    }
    return DEFAULT_LOCALE;
}
