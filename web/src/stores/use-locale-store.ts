import { create } from "zustand";
import { persist } from "zustand/middleware";

import { detectBrowserLocale, isAppLocale, type AppLocale } from "@/i18n/locales";

type LocaleStore = {
    locale: AppLocale;
    setLocale: (locale: AppLocale) => void;
};

/** 界面语言是本设备的小型偏好，保存在 localStorage；首次访问按浏览器语言选择。 */
export const useLocaleStore = create<LocaleStore>()(
    persist(
        (set) => ({
            locale: detectBrowserLocale(),
            // 写入前校验，防止非法值经同步或旧数据进入 i18next。
            setLocale: (next) => set((state) => (isAppLocale(next) ? { locale: next } : state)),
        }),
        {
            name: "yingce:locale",
            merge: (persisted, current) => {
                const stored = (persisted || {}) as Partial<LocaleStore>;
                return { ...current, locale: isAppLocale(stored.locale) ? stored.locale : current.locale };
            },
        },
    ),
);
