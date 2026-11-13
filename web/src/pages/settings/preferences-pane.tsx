import { Button, InputNumber, Select } from "antd";
import { lazy, Suspense, useState } from "react";
import { Moon, Sun, Volume2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { LanguageOptionGrid } from "@/components/layout/language-menu";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { Switch } from "@/components/ui/base/switch";
import { SettingsRow } from "@/components/ui/product/settings-row";
import { playGenerationSuccessSound } from "@/services/notification-sound";
import { defaultConfig, useConfigStore } from "@/stores/use-config-store";
import { useNotificationPreferencesStore } from "@/stores/use-notification-preferences-store";
import { useThemeStore, type ThemeName } from "@/stores/use-theme-store";
import { useAppearancePreferencesStore, usePersonalAppearancePreferences, type PersonalAppearancePreferences } from "@/stores/use-appearance-preferences-store";
import { useUserStore } from "@/stores/use-user-store";
import { registeredThemePacks } from "@/themes/registry";

const PersonalAvatarDialog = lazy(() => import("./personal-avatar-dialog").then((module) => ({ default: module.PersonalAvatarDialog })));

/** 偏好设置：外观与语言、通知、画布生成默认值。前两组只保存在本设备，生成默认值随账号保存。 */
export function PreferencesPane() {
    const { t } = useTranslation();
    const config = useConfigStore((state) => state.config);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const generationNotice = useNotificationPreferencesStore((state) => state.generationNotice);
    const generationSound = useNotificationPreferencesStore((state) => state.generationSound);
    const setGenerationNotice = useNotificationPreferencesStore((state) => state.setGenerationNotice);
    const setGenerationSound = useNotificationPreferencesStore((state) => state.setGenerationSound);
    const userId = useUserStore((state) => state.user?.id);
    const preferences = usePersonalAppearancePreferences();
    const [avatarDialogOpen, setAvatarDialogOpen] = useState(false);
    const updateAppearance = (patch: Partial<PersonalAppearancePreferences>) => {
        if (userId) useAppearancePreferencesStore.getState().update(userId, patch);
    };

    return (
        <>
            <div className="settings-pane-header">
                <div className="min-w-0">
                    <h2>{t("settings.preferences.title")}</h2>
                    <p>{t("settings.preferences.description")}</p>
                </div>
            </div>
            <div className="settings-section">
                <section className="settings-preference-block">
                    <div className="settings-preference-heading">
                        <h3>{t("settings.preferences.interface")}</h3>
                        <p>{t("settings.preferences.interfaceDescription")}</p>
                    </div>
                    <SettingsRow
                        label={t("settings.preferences.theme")}
                        control={
                            <SegmentedControl<ThemeName>
                                size="sm"
                                ariaLabel={t("settings.preferences.theme")}
                                value={theme}
                                onChange={setTheme}
                                options={[
                                    { value: "light", label: t("settings.preferences.themeLight"), icon: <Sun className="size-3.5" aria-hidden /> },
                                    { value: "dark", label: t("settings.preferences.themeDark"), icon: <Moon className="size-3.5" aria-hidden /> },
                                ]}
                            />
                        }
                    />
                    <SettingsRow
                        label={t("personalAppearance.skin")}
                        control={
                            <Select
                                aria-label={t("personalAppearance.skin")}
                                className="w-full"
                                disabled={!userId}
                                value={preferences.skinId}
                                onChange={(skinId: string) => updateAppearance({ skinId })}
                                options={[{ value: "", label: t("personalAppearance.site") }, { value: "classic", label: t("personalAppearance.classic") }, ...registeredThemePacks().map((pack) => ({ value: pack.id, label: pack.name }))]}
                            />
                        }
                        controlClassName="w-[200px]"
                    />
                    <SettingsRow
                        label={t("personalAppearance.avatar")}
                        control={
                            <div className="flex flex-wrap items-center gap-2">
                                <Select
                                    aria-label={t("personalAppearance.avatar")}
                                    className="min-w-[160px] flex-1"
                                    disabled={!userId}
                                    value={preferences.avatar}
                                    onChange={(avatar: PersonalAppearancePreferences["avatar"]) => updateAppearance({ avatar })}
                                    options={[
                                        { value: "site", label: t("personalAppearance.site") },
                                        { value: "classic", label: t("personalAppearance.whale") },
                                        { value: "orb", label: t("personalAppearance.orb") },
                                        ...(preferences.customAvatar ? [{ value: "custom", label: t("personalAvatar.custom") }] : []),
                                    ]}
                                />
                                <Button disabled={!userId} onClick={() => setAvatarDialogOpen(true)}>
                                    {t("personalAvatar.upload")}
                                </Button>
                            </div>
                        }
                        controlClassName="w-full sm:w-[340px]"
                    />
                    {avatarDialogOpen && userId ? (
                        <Suspense fallback={null}>
                            <PersonalAvatarDialog key={userId} userId={userId} onClose={() => setAvatarDialogOpen(false)} />
                        </Suspense>
                    ) : null}
                    <SettingsRow label={t("language.label")} description={t("language.description")} align="top" control={null} className="border-b-0 pb-3" />
                    <LanguageOptionGrid />
                </section>
                <section className="settings-preference-block">
                    <div className="settings-preference-heading">
                        <h3>{t("settings.preferences.notifications")}</h3>
                        <p>{t("settings.preferences.notificationsDescription")}</p>
                    </div>
                    <SettingsRow
                        label={t("settings.preferences.generationNotice")}
                        description={t("settings.preferences.generationNoticeDescription")}
                        control={<Switch checked={generationNotice} onChange={setGenerationNotice} aria-label={t("settings.preferences.generationNotice")} />}
                    />
                    <SettingsRow
                        label={t("settings.preferences.generationSound")}
                        description={t("settings.preferences.generationSoundDescription")}
                        control={
                            <span className="flex items-center gap-3">
                                <Button size="small" icon={<Volume2 className="size-3.5" />} onClick={() => playGenerationSuccessSound()}>
                                    {t("settings.preferences.previewSound")}
                                </Button>
                                <Switch checked={generationNotice && generationSound} disabled={!generationNotice} onChange={setGenerationSound} aria-label={t("settings.preferences.generationSound")} />
                            </span>
                        }
                    />
                </section>
                <section className="settings-preference-block">
                    <div className="settings-preference-heading">
                        <h3>{t("settings.preferences.canvas")}</h3>
                        <p>{t("settings.preferences.canvasDescription")}</p>
                    </div>
                    <SettingsRow
                        label={t("settings.preferences.imageCount")}
                        control={
                            <InputNumber
                                min={1}
                                max={15}
                                precision={0}
                                className="w-full"
                                value={Number(config.canvasImageCount)}
                                onChange={(value) => updateConfig("canvasImageCount", normalizeImageCount(String(value ?? defaultConfig.canvasImageCount)))}
                            />
                        }
                        controlClassName="w-[200px]"
                    />
                </section>
            </div>
        </>
    );
}

function normalizeImageCount(value: string) {
    return String(Math.max(1, Math.min(15, Math.floor(Math.abs(Number(value)) || Number(defaultConfig.canvasImageCount)))));
}
