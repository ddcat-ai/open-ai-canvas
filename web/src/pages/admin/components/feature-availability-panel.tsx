import { useEffect, useState, type ReactNode } from "react";
import { App, Switch } from "antd";
import { Clapperboard, Coins, ListChecks, PlugZap, RadioTower, ToggleLeft, Sparkles, Settings } from "lucide-react";

import { getAdminFeatureAvailability, updateAdminFeatureAvailability } from "@/services/api/auth";
import { useUserStore, type FeatureAvailability } from "@/stores/use-user-store";
import { SettingsSectionCard } from "./admin-ui";
import { useTranslation } from "react-i18next";
import { t } from "@/i18n";

type FeatureKey = "shortDramaEnabled" | "taskCenterEnabled" | "creditsEnabled" | "customChannelsEnabled" | "frontendModelsEnabled" | "pluginCenterEnabled" | "systemPluginsVisibleToUsers";

const userFeatureRows: Array<{ key: FeatureKey; title: string; menu: string; description: string; icon: ReactNode }> = [
    { key: "shortDramaEnabled", title: t("admin:short-drama-creation"), menu: "/projects", description: t("admin:when-off-hides-the-drama-entry-and-blocks-the-project-list-details-and-p"), icon: <Clapperboard className="size-4" /> },
    { key: "taskCenterEnabled", title: t("admin:tasks"), menu: "/tasks", description: t("admin:when-off-only-hides-and-blocks-the-task-center-page-generation-tasks-are"), icon: <ListChecks className="size-4" /> },
    { key: "creditsEnabled", title: t("admin:credits-center"), menu: "/wallet", description: t("admin:when-off-hides-the-user-credits-entry-new-tasks-and-system-channel-reque"), icon: <Coins className="size-4" /> },
    { key: "customChannelsEnabled", title: t("admin:custom-channels"), menu: "/settings?section=channels", description: t("admin:when-off-hides-custom-channel-entries-and-blocks-model-catalog-fetches-c"), icon: <RadioTower className="size-4" /> },
    { key: "pluginCenterEnabled", title: t("admin:plugin-center"), menu: "/plugins", description: t("admin:plugin-center-row-description"), icon: <PlugZap className="size-4" /> },
    { key: "systemPluginsVisibleToUsers", title: t("admin:system-plugins-visible-to-users"), menu: "/plugins", description: t("admin:system-plugins-visible-description"), icon: <PlugZap className="size-4" /> },
];

const adminFeatureRows: Array<{ key: FeatureKey; title: string; menu: string; description: string; icon: ReactNode }> = [
    { key: "frontendModelsEnabled", title: t("admin:frontend-models"), menu: "/admin/models", description: t("admin:when-off-users-use-models-from-system-channels-directly-the-frontend-mod"), icon: <Sparkles className="size-4" /> },
];

export default function FeatureAvailabilityPanel() {
    const { t } = useTranslation("canvas");
    const { message, modal } = App.useApp();
    const setGlobalFeatures = useUserStore((state) => state.setFeatures);
    const [features, setFeatures] = useState<FeatureAvailability | null>(null);
    const [saving, setSaving] = useState<FeatureKey | null>(null);

    useEffect(() => {
        let active = true;
        getAdminFeatureAvailability()
            .then(({ features: value }) => {
                if (active) setFeatures(value);
            })
            .catch((error) => message.error(error instanceof Error ? error.message : t("admin:failed-to-read-feature-availability-settings")));
        return () => {
            active = false;
        };
    }, [message]);

    const save = async (key: FeatureKey, enabled: boolean) => {
        if (!features) return;
        setSaving(key);
        try {
            const next = { ...features, [key]: enabled };
            const result = await updateAdminFeatureAvailability({
                shortDramaEnabled: next.shortDramaEnabled,
                taskCenterEnabled: next.taskCenterEnabled,
                creditsEnabled: next.creditsEnabled,
                customChannelsEnabled: next.customChannelsEnabled,
                frontendModelsEnabled: next.frontendModelsEnabled,
                pluginCenterEnabled: next.pluginCenterEnabled,
                systemPluginsVisibleToUsers: next.systemPluginsVisibleToUsers,
            });
            setFeatures(result.features);
            setGlobalFeatures(result.features);
            message.success(`${allFeatureRows.find((item) => item.key === key)?.title || t("admin:features")}已${enabled ? t("admin:available") : t("admin:close-4")}`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin:failed-to-save-feature-availability-settings"));
        } finally {
            setSaving(null);
        }
    };

    const toggle = (key: FeatureKey, enabled: boolean) => {
        // 积分关闭需要二次确认
        if (key === "creditsEnabled" && !enabled) {
            modal.confirm({
                title: t("admin:disable-user-credits"),
                content: t("admin:after-saving-new-tasks-and-system-channel-requests-no-longer-deduct-cred"),
                okText: t("admin:confirm-disable-2"),
                cancelText: t("admin:cancel-4"),
                okButtonProps: { danger: true },
                onOk: () => save(key, false),
            });
            return;
        }
        // 前台模型关闭需要二次确认
        if (key === "frontendModelsEnabled" && !enabled) {
            modal.confirm({
                title: t("admin:disable-frontend-models"),
                content: t("admin:users-will-use-models-configured-in-system-channels-directly-the-config"),
                okText: t("admin:confirm-disable-2"),
                cancelText: t("admin:cancel-4"),
                okButtonProps: { danger: true },
                onOk: () => save(key, false),
            });
            return;
        }
        void save(key, enabled);
    };

    const allFeatureRows = [...userFeatureRows, ...adminFeatureRows];
    const userEnabledCount = features ? userFeatureRows.filter((item) => features[item.key]).length : 0;
    const adminEnabledCount = features ? adminFeatureRows.filter((item) => features[item.key]).length : 0;

    return (
        <div className="space-y-6 pt-4">
            <SettingsSectionCard
                icon={<ToggleLeft className="size-4" />}
                title={t("admin:user-feature-availability")}
                status={{ label: features ? t("admin:param-param-available", { userEnabledCount: userEnabledCount, length: userFeatureRows.length }) : t("admin:loading-2"), color: userEnabledCount === userFeatureRows.length ? "success" : "default" }}
            >
                <div className="divide-y divide-border/75">
                    {userFeatureRows.map((item) => (
                        <div key={item.key} className="flex min-h-16 items-center gap-3 px-4 py-3">
                            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted/35 text-foreground/65">{item.icon}</span>
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <h3 className="text-sm font-medium">{item.title}</h3>
                                    <span className="rounded border border-border/70 px-1.5 py-0.5 text-[var(--fs-micro)] text-foreground/45">{item.menu}</span>
                                </div>
                            </div>
                            <Switch
                                checked={features?.[item.key] === true}
                                loading={!features || saving === item.key}
                                disabled={Boolean(saving && saving !== item.key) || (item.key === "systemPluginsVisibleToUsers" && features?.pluginCenterEnabled !== true)}
                                onChange={(checked) => toggle(item.key, checked)}
                                aria-label={t("admin:enable-param", { title: item.title })}
                            />
                        </div>
                    ))}
                </div>
            </SettingsSectionCard>

            <SettingsSectionCard
                icon={<Settings className="size-4" />}
                title={t("admin:admin-console-features")}
                status={{
                    label: features ? t("admin:param-param-available-2", { adminEnabledCount: adminEnabledCount, length: adminFeatureRows.length }) : t("admin:loading-2"),
                    color: adminEnabledCount === adminFeatureRows.length ? "success" : "default",
                }}
            >
                <div className="divide-y divide-border/75">
                    {adminFeatureRows.map((item) => (
                        <div key={item.key} className="flex min-h-16 items-center gap-3 px-4 py-3">
                            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted/35 text-foreground/65">{item.icon}</span>
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <h3 className="text-sm font-medium">{item.title}</h3>
                                    <span className="rounded border border-border/70 px-1.5 py-0.5 text-[var(--fs-micro)] text-foreground/45">{item.menu}</span>
                                </div>
                            </div>
                            <Switch
                                checked={features?.[item.key] === true}
                                loading={!features || saving === item.key}
                                disabled={Boolean(saving && saving !== item.key)}
                                onChange={(checked) => toggle(item.key, checked)}
                                aria-label={t("admin:enable-param", { title: item.title })}
                            />
                        </div>
                    ))}
                </div>
            </SettingsSectionCard>
        </div>
    );
}
