import { Languages } from "lucide-react";
import { Select } from "antd";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import { useLocaleStore, type LocaleName } from "@/stores/use-locale-store";

/**
 * 独立语言切换按钮：点击在中英文之间循环，图标固定、样式由调用方注入。
 * 登录页、工作区顶栏（含画布全屏顶栏）、后台侧栏共用这一个组件；
 * 选项标签刻意不做翻译——每种语言用自己的文字显示自己的名字。
 */
export function LocaleToggle({ className, style }: { className?: string; style?: CSSProperties }) {
    const { t } = useTranslation("layout");
    const locale = useLocaleStore((state) => state.locale);
    const setLocale = useLocaleStore((state) => state.setLocale);
    const next: LocaleName = locale === "en" ? "zh-CN" : "en";
    const label = t("language.toggle-to", { language: t(next === "en" ? "language.en" : "language.zh-cn") });

    return (
        <button type="button" className={className} style={style} onClick={() => setLocale(next)} aria-label={label} title={label}>
            <Languages className="size-4 shrink-0" aria-hidden />
        </button>
    );
}
export function LocaleSwitcher({ className }: { className?: string }) {
    const { t } = useTranslation("layout");
    const locale = useLocaleStore((state) => state.locale);
    const setLocale = useLocaleStore((state) => state.setLocale);

    return (
        <Select
            size="small"
            className={className}
            style={{ minWidth: 116 }}
            aria-label={t("language.label")}
            value={locale ?? "zh-CN"}
            onChange={(next) => setLocale(next)}
            options={[
                { value: "zh-CN", label: t("language.zh-cn") },
                { value: "en", label: t("language.en") },
            ]}
        />
    );
}
