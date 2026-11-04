import i18next from "i18next";
import { initReactI18next } from "react-i18next";

import { useLocaleStore } from "@/stores/use-locale-store";
import { DEFAULT_LOCALE, type AppLocale } from "./locales";
import { deDE } from "./messages/de-DE";
import { enUS } from "./messages/en-US";
import { frFR } from "./messages/fr-FR";
import { jaJP } from "./messages/ja-JP";
import { koKR } from "./messages/ko-KR";
import { zhCN } from "./messages/zh-CN";

/**
 * 应用唯一的 i18next 实例。语言来自 useLocaleStore（本设备偏好，首次按浏览器语言），
 * 缺失的键回退到简体中文，保证未翻译的页面仍可用。资源随包内联，初始化同步完成。
 */
export const i18n = i18next.createInstance();

void i18n.use(initReactI18next).init({
    resources: {
        "zh-CN": { translation: zhCN },
        "en-US": { translation: enUS },
        "fr-FR": { translation: frFR },
        "de-DE": { translation: deDE },
        "ja-JP": { translation: jaJP },
        "ko-KR": { translation: koKR },
    },
    lng: useLocaleStore.getState().locale,
    fallbackLng: DEFAULT_LOCALE,
    initAsync: false,
    returnNull: false,
    interpolation: { escapeValue: false },
});

useLocaleStore.subscribe((state, previous) => {
    if (state.locale !== previous.locale) void i18n.changeLanguage(state.locale);
});

/** 当前界面语言；用于 Intl 日期与数字格式化。 */
export function currentLocale(): AppLocale {
    return useLocaleStore.getState().locale;
}

/** 非组件代码（服务层、工具函数）使用的翻译函数。 */
export function translate(key: string, options?: Record<string, unknown>): string {
    return i18n.t(key, options) as string;
}
