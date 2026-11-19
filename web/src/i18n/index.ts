import i18next from "i18next";
import { initReactI18next } from "react-i18next";

import { useLocaleStore } from "@/stores/use-locale-store";
import { DEFAULT_LOCALE, type AppLocale } from "./locales";
import { pack as zhCNPack } from "./messages/packs/zh-CN";
import type { LocalePack } from "./messages/packs/types";
import { personalAppearanceMessages } from "./personal-appearance-messages";
import { personalAvatarMessages } from "./personal-avatar-messages";

/**
 * 非中文文案包按需加载。
 *
 * 2026-11-19 真实构建取证：原来 6 种语言的 core + 9 个区域目录全部静态内联，
 * 单个 i18n chunk 1.05MB，且被 modulepreload 塞进首屏（首屏 preload 合计 1.75MB）。
 * C 端界面已撤掉语言切换入口，默认与兜底都是简体中文，所以只把中文同步打进首屏；
 * 其余 5 种语言拆成独立 chunk，检测到非中文偏好时再异步补，失败就继续用中文，不白屏。
 */
const LAZY_PACKS: Partial<Record<AppLocale, () => Promise<{ pack: LocalePack }>>> = {
    "en-US": () => import("./messages/packs/en-US"),
    "fr-FR": () => import("./messages/packs/fr-FR"),
    "de-DE": () => import("./messages/packs/de-DE"),
    "ja-JP": () => import("./messages/packs/ja-JP"),
    "ko-KR": () => import("./messages/packs/ko-KR"),
};

/** 一种语言 = 公共目录 + 个人外观/形象 + 各页面区域目录（区域名作为顶级命名空间）。 */
function translationFor(locale: AppLocale, pack: LocalePack) {
    return {
        ...pack.core,
        personalAppearance: personalAppearanceMessages[locale],
        personalAvatar: personalAvatarMessages[locale],
        ...pack.areas,
    };
}

/**
 * 应用唯一的 i18next 实例。初始化保持同步（initAsync: false），
 * 中文资源随包内联，首屏不会出现「先闪 key 再出文案」。
 */
export const i18n = i18next.createInstance();

void i18n.use(initReactI18next).init({
    resources: { [DEFAULT_LOCALE]: { translation: translationFor(DEFAULT_LOCALE, zhCNPack) } },
    lng: useLocaleStore.getState().locale,
    fallbackLng: DEFAULT_LOCALE,
    initAsync: false,
    returnNull: false,
    interpolation: { escapeValue: false },
});

async function ensureLocale(locale: AppLocale) {
    if (locale === DEFAULT_LOCALE || i18n.hasResourceBundle(locale, "translation")) return;
    const loader = LAZY_PACKS[locale];
    if (!loader) return;
    try {
        const { pack } = await loader();
        i18n.addResourceBundle(locale, "translation", translationFor(locale, pack), true, true);
        await i18n.changeLanguage(locale);
    } catch {
        // 语言包加载失败时保持中文兜底，不让整页白屏。
    }
}

void ensureLocale(useLocaleStore.getState().locale);

useLocaleStore.subscribe((state, previous) => {
    if (state.locale !== previous.locale) void ensureLocale(state.locale);
});

/** 当前界面语言；用于 Intl 日期与数字格式化。 */
export function currentLocale(): AppLocale {
    return useLocaleStore.getState().locale;
}

/** 非组件代码（服务层、工具函数）使用的翻译函数。 */
export function translate(key: string, options?: Record<string, unknown>): string {
    return i18n.t(key, options) as string;
}

/**
 * 用户切换界面语言：保存偏好后整页刷新。部分文案在模块加载或缓存数据里生成，
 * 只靠组件重渲染会出现新旧语言混排；刷新保证整页使用同一种语言。
 */
export function switchLocale(next: AppLocale) {
    if (next === currentLocale()) return;
    useLocaleStore.getState().setLocale(next);
    if (typeof window !== "undefined") window.location.reload();
}
