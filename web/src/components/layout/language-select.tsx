import { Languages } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Select } from "@/components/ui/base/select";
import { SUPPORTED_LOCALES, type AppLocale } from "@/i18n/locales";
import { cn } from "@/lib/utils";
import { useLocaleStore } from "@/stores/use-locale-store";

/** 界面语言选择器；选项用各语言的自称，保证看不懂当前语言的人也能切回来。 */
export function LanguageSelect({ className, size = "sm" }: { className?: string; size?: "sm" | "md" }) {
    const { t } = useTranslation();
    const locale = useLocaleStore((state) => state.locale);
    const setLocale = useLocaleStore((state) => state.setLocale);
    return (
        <Select
            size={size}
            className={cn("min-w-[132px]", className)}
            aria-label={t("language.selectLabel")}
            prefix={<Languages aria-hidden className="size-3.5" />}
            value={locale}
            options={SUPPORTED_LOCALES.map((item) => ({ value: item.code, label: item.label }))}
            onChange={(value) => setLocale(value as AppLocale)}
        />
    );
}
