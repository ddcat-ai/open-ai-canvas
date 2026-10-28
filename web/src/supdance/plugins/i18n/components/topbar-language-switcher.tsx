import { Dropdown } from "antd";
import { Check, Languages } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "../store";
import type { SupDanceLocaleCode } from "../types";

export type LanguageSwitcherSurface = "workspace" | "auth" | "canvas" | "admin";

export function TopbarLanguageSwitcher({ surface = "workspace", className }: { surface?: LanguageSwitcherSurface; className?: string }) {
    const { enabled, locale, currentLanguage, enabledLanguages, settings, setLocale, t } = useI18n();

    if (!enabled) return null;

    if (surface === "workspace" && !settings.showInWorkspaceTopBar) return null;
    if (surface === "auth" && !settings.showInAuthPage) return null;
    if (surface === "canvas" && !settings.showInCanvasTopBar) return null;
    if (surface === "admin" && !settings.showInAdminTopBar) return null;

    if (enabledLanguages.length === 0) return null;

    const menuItems = enabledLanguages.map((lang) => {
        const active = lang.code === locale;
        return {
            key: lang.code,
            label: (
                <div data-i18n-ignore="true" className="flex min-w-[172px] items-center justify-between gap-3 py-1">
                    <div className="flex items-center gap-2">
                        <span className="inline-flex h-5 min-w-[24px] items-center justify-center rounded bg-muted/70 px-1 text-xs font-semibold text-foreground/85">{lang.badge}</span>
                        <div className="flex flex-col leading-tight">
                            <span className={cn("text-xs", active ? "font-semibold text-foreground" : "text-foreground/90")}>{lang.nativeName}</span>
                            {lang.name !== lang.nativeName ? <span className="text-xs text-muted-foreground">{lang.name}</span> : null}
                        </div>
                    </div>
                    {active ? <Check className="size-3.5 text-primary" aria-hidden="true" /> : null}
                </div>
            ),
            onClick: () => setLocale(lang.code as SupDanceLocaleCode),
        };
    });

    const styleMode = settings.switcherStyle || "icon_code";
    const showBadge = styleMode === "icon_code";
    const showName = styleMode === "icon_name";

    return (
        <div data-plugin-scope="i18n" className="inline-flex items-center">
            <Dropdown
                menu={{
                    items: menuItems,
                    selectedKeys: [locale],
                }}
                trigger={["click"]}
                placement="bottomRight"
            >
                <button
                    type="button"
                    data-i18n-ignore="true"
                    data-canvas-no-zoom="true"
                    aria-haspopup="menu"
                    aria-label={t("nav.switch_language", undefined, "切换语言")}
                    title={`${t("nav.switch_language", undefined, "切换语言")} (${currentLanguage.nativeName})`}
                    className={cn(
                        "app-workspace-topbar-icon-button inline-flex min-h-[32px] items-center justify-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 active:scale-95",
                        (showBadge || showName) && "!w-auto px-2.5",
                        className
                    )}
                >
                    <Languages className="size-4 shrink-0" aria-hidden="true" />
                    {showBadge ? <span className="text-xs font-semibold tracking-tight text-foreground/85">{currentLanguage.badge}</span> : null}
                    {showName ? <span className="max-w-[88px] truncate text-xs font-medium text-foreground/85">{currentLanguage.nativeName}</span> : null}
                </button>
            </Dropdown>
        </div>
    );
}
