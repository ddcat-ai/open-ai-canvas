import { App, Button, InputNumber } from "antd";
import { SettingsRow } from "@/components/ui/product/settings-row";
import { ArrowLeft, Boxes, Bug, Cloud, Inbox, MessageSquareText, RadioTower, SlidersHorizontal, UserRound, Workflow, BookMarked } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { LanguageOptionGrid } from "@/components/layout/language-menu";

import { UserOSSSettingsForm } from "@/components/layout/user-oss-settings-form";
import { refreshSystemChannels } from "@/lib/user-session";
import { defaultConfig, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { ChannelSettingsPane, channelValidationError, focusInvalidChannelField, isChannelReady } from "./channel-settings-pane";
import { ModelDefaultGrid } from "./model-default-grid";
import { PromptPreferencesPane } from "./prompt-preferences-pane";
import DiagnosticsPanel from "./diagnostics-panel";
import AgentMemoryPane from "./agent-memory-pane";
import { RunningHubSettingsPane } from "./runninghub-settings-pane";
import { RUNNINGHUB_PLUGIN_ID } from "@/lib/plugins/builtin/workflows";
import { usePluginStore } from "@/stores/use-plugin-store";
import { ProfilePane } from "./profile-pane";
import { FeedbackInboxPane } from "./feedback-inbox-pane";

type ConfigSectionKey = "profile" | "channels" | "models" | "runninghub" | "preferences" | "prompts" | "agent-memory" | "storage" | "diagnostics" | "feedbacks";

/** 分类名称与说明在公共目录 settings.sections.<key> 中。 */
const configSections: Array<{ key: ConfigSectionKey; icon: ReactNode }> = [
    { key: "profile", icon: <UserRound className="size-4" /> },
    { key: "channels", icon: <RadioTower className="size-4" /> },
    { key: "runninghub", icon: <Workflow className="size-4" /> },
    { key: "models", icon: <Boxes className="size-4" /> },
    { key: "preferences", icon: <SlidersHorizontal className="size-4" /> },
    { key: "prompts", icon: <MessageSquareText className="size-4" /> },
    { key: "agent-memory", icon: <BookMarked className="size-4" /> },
    { key: "storage", icon: <Cloud className="size-4" /> },
    { key: "diagnostics", icon: <Bug className="size-4" /> },
    { key: "feedbacks", icon: <Inbox className="size-4" /> },
];

export function isConfigSection(value: string | null): value is ConfigSectionKey {
    return configSections.some((section) => section.key === value);
}

export default function SettingsPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const requestedSection = searchParams.get("section");
    const customChannelsEnabled = useUserStore((state) => state.features.customChannelsEnabled);
    const runtimeStatuses = usePluginStore((state) => state.runtimeStatuses);
    const runningHubPluginEnabled = runtimeStatuses[RUNNINGHUB_PLUGIN_ID] === "enabled";
    const requestedSectionEnabled = requestedSection !== "runninghub" || runningHubPluginEnabled;
    const initialSection = isConfigSection(requestedSection) && requestedSectionEnabled ? requestedSection : "profile";
    const [activeTab, setActiveTab] = useState<ConfigSectionKey>(initialSection === "channels" && !customChannelsEnabled ? "models" : initialSection);
    const config = useConfigStore((state) => state.config);
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const shouldPromptContinue = searchParams.get("continue") === "1";
    const userId = useUserStore((state) => state.user?.id);
    const userChannels = config.channels.filter((channel) => channel.scope !== "system");
    const visibleConfigSections = useMemo(() => (customChannelsEnabled ? configSections : configSections.filter((section) => section.key !== "channels"))
        .filter((section) => section.key !== "runninghub" || runningHubPluginEnabled), [customChannelsEnabled, runningHubPluginEnabled]);

    const isVisibleConfigSection = (value: string | null): value is ConfigSectionKey => isConfigSection(value) && visibleConfigSections.some((section) => section.key === value);

    useEffect(() => {
        if (isVisibleConfigSection(requestedSection)) {
            setActiveTab(requestedSection);
            return;
        }
        setActiveTab(requestedSection === "channels" && !customChannelsEnabled ? "models" : "profile");
    }, [customChannelsEnabled, requestedSection, visibleConfigSections]);

    useEffect(() => {
        if (!userId) return;
        let cancelled = false;
        void refreshSystemChannels().catch((error) => {
            if (!cancelled) message.warning(error instanceof Error ? t("account.settings.systemRefreshFailedWith", { error: error.message }) : t("account.settings.systemRefreshFailed"));
        });
        return () => {
            cancelled = true;
        };
    }, [message, t, userId]);

    const selectSection = (section: ConfigSectionKey) => {
        if (section === "runninghub" && !runningHubPluginEnabled) return;
        setActiveTab(section);
        const next = new URLSearchParams(searchParams);
        next.set("section", section);
        setSearchParams(next, { replace: true });
    };

    const finishConfig = () => {
        const invalidChannel = customChannelsEnabled ? userChannels.find((channel) => channelValidationError(channel)) : undefined;
        if (invalidChannel) {
            selectSection("channels");
            message.warning(t("account.settings.channelError", { name: invalidChannel.name || t("account.settings.channels.unnamed"), error: channelValidationError(invalidChannel) }));
            focusInvalidChannelField(invalidChannel);
            return;
        }
        const workflowReady = Boolean(runningHubPluginEnabled && config.runningHub.enabled && config.runningHub.workflowId.trim() && config.runningHub.baseUrl.trim() && config.runningHub.apiKey.trim());
        if (!effectiveConfig.channels.some(isChannelReady) && !workflowReady) {
            selectSection(customChannelsEnabled ? "channels" : "models");
            message.error(customChannelsEnabled ? (shouldPromptContinue ? t("account.settings.needChannel") : t("account.settings.noChannel")) : t("account.settings.noSystemModel"));
            return;
        }
        message.success(t("account.settings.saved"));
        navigate(-1);
    };

    const panes: Record<ConfigSectionKey, ReactNode> = {
        profile: <SettingsPane><ProfilePane key={userId} /></SettingsPane>,
        channels: <SettingsPane><ChannelSettingsPane onOpenModels={() => selectSection("models")} onOpenRunningHub={runningHubPluginEnabled ? () => selectSection("runninghub") : undefined} /></SettingsPane>,
        models: (
            <SettingsPane>
                <div className="settings-pane-header">
                    <div className="min-w-0">
                        <h2>{t("settings.sections.models.label")}</h2>
                        <p>{t("account.settings.modelsDescription")}</p>
                    </div>
                </div>
                <div className="settings-section">
                    <ModelDefaultGrid config={effectiveConfig} onChange={(key, model) => updateConfig(key, model)} />
                </div>
            </SettingsPane>
        ),
        runninghub: <SettingsPane><RunningHubSettingsPane /></SettingsPane>,
        preferences: (
            <SettingsPane>
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
                        <SettingsRow label={t("language.label")} description={t("language.description")} align="top" control={null} />
                        <LanguageOptionGrid />
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
            </SettingsPane>
        ),
        prompts: <SettingsPane fill><PromptPreferencesPane /></SettingsPane>,
        "agent-memory": (
            <SettingsPane>
                <div className="settings-pane-header">
                    <div className="min-w-0">
                        <h2>{t("settings.sections.agent-memory.label")}</h2>
                        <p>{t("account.settings.agentMemoryDescription")}</p>
                    </div>
                </div>
                <div className="settings-section">
                    <AgentMemoryPane />
                </div>
            </SettingsPane>
        ),
        diagnostics: <SettingsPane><DiagnosticsPanel taskId={searchParams.get("taskId") || undefined} projectId={searchParams.get("projectId") || undefined} /></SettingsPane>,
        storage: (
            <SettingsPane>
                <div className="settings-section">
                    <UserOSSSettingsForm />
                </div>
            </SettingsPane>
        ),
        feedbacks: <SettingsPane><FeedbackInboxPane /></SettingsPane>,
    };

    return (
        <main className="settings-page app-workspace-page app-user-workspace flex h-full min-h-0 flex-col text-foreground">
            {shouldPromptContinue ? (
                <div className="settings-topbar shrink-0">
                    <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                        <Button icon={<ArrowLeft className="size-4" />} onClick={() => navigate(-1)}>{t("settings.back")}</Button>
                        <Button type="primary" onClick={finishConfig}>{t("settings.saveAndBack")}</Button>
                    </div>
                </div>
            ) : null}
            <div className="settings-library-frame flex min-h-0 flex-1 flex-col md:flex-row">
                <aside className="settings-nav-panel w-full shrink-0 md:w-[200px]">
                    <nav className="thin-scrollbar flex gap-1 overflow-x-auto p-2 md:block md:space-y-1 md:p-2" aria-label={t("settings.nav")}>
                        {visibleConfigSections.map((item) => {
                            const selected = item.key === activeTab;
                            return (
                                <button
                                    key={item.key}
                                    type="button"
                                    className={`settings-nav-item flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-auto md:w-full md:items-start md:gap-3 md:py-2 ${selected ? "is-active" : "text-foreground/58 hover:bg-muted/55 hover:text-foreground"}`}
                                    onClick={() => selectSection(item.key)}
                                    aria-current={selected ? "page" : undefined}
                                >
                                    <span className={`shrink-0 md:mt-0.5 ${selected ? "text-[var(--workspace-accent)]" : ""}`}>{item.icon}</span>
                                    <span className="min-w-0">
                                        <span className="block whitespace-nowrap text-sm font-medium">{t(`settings.sections.${item.key}.label`)}</span>
                                        <span className="mt-1 hidden text-[var(--fs-label)] leading-4 text-current opacity-65 md:block">{t(`settings.sections.${item.key}.description`)}</span>
                                    </span>
                                </button>
                            );
                        })}
                    </nav>
                </aside>
                <section className="settings-content flex min-h-0 min-w-0 flex-1 flex-col">
                    <div className="app-workspace-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 md:px-6 md:py-5">
                        <div className={`settings-pane-root ${activeTab === "prompts" ? "h-full w-full" : "mx-auto w-full max-w-none"}`}>
                            {panes[activeTab]}
                        </div>
                    </div>
                </section>
            </div>
        </main>
    );
}

function SettingsPane({ children, fill = false }: { children: ReactNode; fill?: boolean }) {
    return <div className={fill ? "settings-pane h-full" : "settings-pane"}>{children}</div>;
}

function normalizeImageCount(value: string) {
    return String(Math.max(1, Math.min(15, Math.floor(Math.abs(Number(value)) || Number(defaultConfig.canvasImageCount)))));
}
