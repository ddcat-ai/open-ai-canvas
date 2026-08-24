import { create } from "zustand";
import { persist } from "zustand/middleware";

export type LocaleName = "zh-CN" | "en";

type LocaleStore = {
    /** null = 用户尚未选择，由 detectLocale 按环境猜一次后写回；之后永远以该值为准 */
    locale: LocaleName | null;
    setLocale: (next: LocaleName) => void;
};

const VALID_LOCALES: LocaleName[] = ["zh-CN", "en"];

export const useLocaleStore = create<LocaleStore>()(
    persist(
        (set) => ({
            locale: null,
            // 写入前校验：非法 locale 直接忽略，防止绕过 UI 的路径写入坏值
            setLocale: (next) => set((state) => (VALID_LOCALES.includes(next) ? { locale: next } : state)),
        }),
        {
            name: "infinite-canvas:locale_store",
            // 持久化恢复校验：坏值回落到 null（重新走一次环境猜测），与 use-theme-store 同一模式
            merge: (persisted, current) => {
                const stored = (persisted || {}) as Partial<LocaleStore>;
                const locale = VALID_LOCALES.includes(stored.locale as LocaleName) ? (stored.locale as LocaleName) : null;
                return { ...current, locale };
            },
        },
    ),
);
