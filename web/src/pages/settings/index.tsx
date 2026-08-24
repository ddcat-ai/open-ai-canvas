import { App, Button, Form, Input, InputNumber, Select } from "antd";
import { ArrowLeft, Boxes, Cloud, Globe, MessageSquareText, RadioTower, SlidersHorizontal, SquareTerminal } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";

import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { UserOSSSettingsForm } from "@/components/layout/user-oss-settings-form";
import { audioFormatOptions, audioVoiceOptions, normalizeAudioSpeedValue } from "@/lib/audio-generation";
import { refreshSystemChannels } from "@/lib/user-session";
import { defaultConfig, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { ChannelSettingsPane, channelValidationError, focusInvalidChannelField, isChannelReady } from "./channel-settings-pane";
export { UserLocalChannelFields, UserLocalChannelSwitch, userLocalChannelChangePatch, userLocalChannelFormOwner } from "./channel-settings-pane";
import { ModelDefaultGrid } from "./model-default-grid";
import { LocalCliSettings } from "./local-cli-settings";
import { PromptPreferencesPane } from "./prompt-preferences-pane";

type ConfigSectionKey = "local-cli" | "channels" | "models" | "preferences" | "prompts" | "storage" | "language";

// 文案必须在组件内经 t() 现取（模块求值时 catalog 未加载），这里只保留 key 清单供 isConfigSection 用
const CONFIG_SECTION_KEYS: ConfigSectionKey[] = ["local-cli", "channels", "models", "preferences", "prompts", "storage", "language"];

export function isConfigSection(value: string | null): value is ConfigSectionKey {
    return CONFIG_SECTION_KEYS.includes(value as ConfigSectionKey);
}

export default function SettingsPage() {
    const { t } = useTranslation("settings");
    const { message } = App.useApp();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const requestedSection = searchParams.get("section");
    const customChannelsEnabled = useUserStore((state) => state.features.customChannelsEnabled);
    const initialSection = isConfigSection(requestedSection) ? requestedSection : customChannelsEnabled ? "channels" : "models";
    const [activeTab, setActiveTab] = useState<ConfigSectionKey>(initialSection === "channels" && !customChannelsEnabled ? "models" : initialSection);
    const config = useConfigStore((state) => state.config);
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const shouldPromptContinue = searchParams.get("continue") === "1";
    const userId = useUserStore((state) => state.user?.id);
    const userChannels = config.channels.filter((channel) => channel.scope !== "system");
    // 文案随语言切换实时重算，所以放在组件体内而不是模块常量里
    const configSections: Array<{ key: ConfigSectionKey; label: string; description: string; icon: ReactNode }> = [
        { key: "local-cli", label: t("sections.local-cli.label"), description: t("sections.local-cli.description"), icon: <SquareTerminal className="size-4" /> },
        { key: "channels", label: t("sections.channels.label"), description: t("sections.channels.description"), icon: <RadioTower className="size-4" /> },
        { key: "models", label: t("sections.models.label"), description: t("sections.models.description"), icon: <Boxes className="size-4" /> },
        { key: "preferences", label: t("sections.preferences.label"), description: t("sections.preferences.description"), icon: <SlidersHorizontal className="size-4" /> },
        { key: "prompts", label: t("sections.prompts.label"), description: t("sections.prompts.description"), icon: <MessageSquareText className="size-4" /> },
        { key: "storage", label: t("sections.storage.label"), description: t("sections.storage.description"), icon: <Cloud className="size-4" /> },
        { key: "language", label: t("sections.language.label"), description: t("sections.language.description"), icon: <Globe className="size-4" /> },
    ];
    const visibleConfigSections = customChannelsEnabled ? configSections : configSections.filter((section) => section.key !== "channels");

    useEffect(() => {
        if (isConfigSection(requestedSection) && (requestedSection !== "channels" || customChannelsEnabled)) {
            setActiveTab(requestedSection);
            return;
        }
        if (!customChannelsEnabled) setActiveTab((current) => (current === "channels" ? "models" : current));
    }, [customChannelsEnabled, requestedSection]);

    useEffect(() => {
        if (!userId) return;
        let cancelled = false;
        void refreshSystemChannels().catch((error) => {
            if (!cancelled) message.warning(error instanceof Error ? t("settings:system-model-refresh-failed-param", { message: error.message }) : t("settings:system-model-refresh-failed-using-local-cache"));
        });
        return () => {
            cancelled = true;
        };
    }, [message, userId]);

    const selectSection = (section: ConfigSectionKey) => {
        setActiveTab(section);
        const next = new URLSearchParams(searchParams);
        next.set("section", section);
        setSearchParams(next, { replace: true });
    };

    const finishConfig = () => {
        const invalidChannel = customChannelsEnabled ? userChannels.find((channel) => channelValidationError(channel)) : undefined;
        if (invalidChannel) {
            selectSection("channels");
            message.warning(`${invalidChannel.name || t("settings:untitled-channel")}：${channelValidationError(invalidChannel)}`);
            focusInvalidChannelField(invalidChannel);
            return;
        }
        const hasReadyLocalRuntime = effectiveConfig.channels.some((channel) => channel.transport === "local-runtime" && channel.enabled !== false && Boolean(channel.localModels?.length));
        if (!effectiveConfig.channels.some(isChannelReady) && !hasReadyLocalRuntime) {
            selectSection(customChannelsEnabled ? "channels" : "models");
            message.error(
                customChannelsEnabled
                    ? shouldPromptContinue
                        ? t("settings:finish-the-base-url-api-key-and-model-setup-for-at-least-one-channel-fir")
                        : t("settings:no-usable-channels-yet-complete-connection-details-and-model-setup-first")
                    : t("settings:no-system-models-available-ask-an-admin-to-set-up-system-channels"),
            );
            return;
        }
        message.success(t("settings:settings-saved-returning-to-the-creation-page"));
        navigate(-1);
    };

    const panes: Record<ConfigSectionKey, ReactNode> = {
        "local-cli": (
            <SettingsPane>
                <LocalCliSettings />
            </SettingsPane>
        ),
        channels: (
            <SettingsPane>
                <ChannelSettingsPane onOpenModels={() => selectSection("models")} />
            </SettingsPane>
        ),
        models: (
            <SettingsPane>
                <div className="settings-pane-header">
                    <div className="min-w-0">
                        <h2>{t("settings:models-3")}</h2>
                        <p>{t("settings:pick-default-models-per-domain-capabilities-and-protocols-are-configured")}</p>
                    </div>
                </div>
                <div className="settings-section">
                    <ModelDefaultGrid config={effectiveConfig} onChange={(key, model) => updateConfig(key, model)} />
                </div>
            </SettingsPane>
        ),
        preferences: (
            <SettingsPane>
                <div className="settings-pane-header">
                    <div className="min-w-0">
                        <h2>{t("settings:generation-preferences")}</h2>
                        <p>{t("settings:defaults-for-canvas-video-and-audio-each-node-can-still-override-them")}</p>
                    </div>
                </div>
                <div className="settings-section">
                    <Form layout="vertical" requiredMark={false}>
                        <section className="settings-preference-block pb-6">
                            <div className="mb-4">
                                <h3 className="text-sm font-semibold">{t("settings:canvas-generation")}</h3>
                                <p className="mt-1 text-xs text-foreground/55">{t("settings:initial-values-for-new-generation-tasks-each-node-can-still-override-the")}</p>
                            </div>
                            <Form.Item label={t("settings:default-image-count")} className="mb-0 max-w-xs">
                                <InputNumber
                                    min={1}
                                    max={15}
                                    precision={0}
                                    className="w-full"
                                    value={Number(config.canvasImageCount)}
                                    onChange={(value) => updateConfig("canvasImageCount", normalizeImageCount(String(value ?? defaultConfig.canvasImageCount)))}
                                />
                            </Form.Item>
                        </section>
                        <section className="settings-preference-block py-6">
                            <div className="mb-4">
                                <h3 className="text-sm font-semibold">{t("settings:audio-defaults")}</h3>
                                <p className="mt-1 text-xs text-foreground/55">{t("settings:used-for-new-audio-nodes-and-tasks-without-explicit-parameters")}</p>
                            </div>
                            <div className="grid gap-4 md:grid-cols-3">
                                <Form.Item label={t("settings:default-voice")} className="mb-0">
                                    <Select value={config.audioVoice} options={audioVoiceOptions} onChange={(value) => updateConfig("audioVoice", value)} />
                                </Form.Item>
                                <Form.Item label={t("settings:file-format")} className="mb-0">
                                    <Select value={config.audioFormat} options={audioFormatOptions} onChange={(value) => updateConfig("audioFormat", value)} />
                                </Form.Item>
                                <Form.Item label={t("settings:speech-rate")} className="mb-0">
                                    <InputNumber
                                        min={0.25}
                                        max={4}
                                        step={0.05}
                                        precision={2}
                                        className="w-full"
                                        value={Number(config.audioSpeed)}
                                        onChange={(value) => updateConfig("audioSpeed", normalizeAudioSpeedValue(String(value ?? defaultConfig.audioSpeed)))}
                                    />
                                </Form.Item>
                            </div>
                        </section>
                        <section className="settings-preference-block pt-6">
                            <div className="mb-4">
                                <h3 className="text-sm font-semibold">{t("settings:audio-instructions")}</h3>
                                <p className="mt-1 text-xs text-foreground/55">{t("settings:used-when-an-audio-node-has-no-instructions-of-its-own")}</p>
                            </div>
                            <div className="max-w-2xl">
                                <Form.Item label={t("settings:default-audio-instructions")} className="mb-0">
                                    <Input.TextArea rows={5} value={config.audioInstructions} placeholder={t("settings:e-g-natural-warm-suited-to-voice-over")} onChange={(event) => updateConfig("audioInstructions", event.target.value)} />
                                </Form.Item>
                            </div>
                        </section>
                    </Form>
                </div>
            </SettingsPane>
        ),
        prompts: (
            <SettingsPane fill>
                <PromptPreferencesPane />
            </SettingsPane>
        ),
        storage: (
            <SettingsPane>
                <div className="settings-section">
                    <UserOSSSettingsForm />
                </div>
            </SettingsPane>
        ),
        language: (
            <SettingsPane>
                <div className="settings-pane-header">
                    <div className="min-w-0">
                        <h2>{t("language.title")}</h2>
                        <p>{t("language.description")}</p>
                    </div>
                </div>
                <div className="settings-section max-w-md">
                    <LocaleSwitcher className="w-44" />
                </div>
            </SettingsPane>
        ),
    };

    return (
        <main className="settings-page app-workspace-page flex h-full min-h-0 flex-col text-foreground">
            <header className="settings-topbar shrink-0">
                <div className="flex min-w-0 items-center gap-2.5">
                    {shouldPromptContinue ? (
                        <button type="button" className="app-workspace-icon-button shrink-0" onClick={() => navigate(-1)} aria-label={t("back-to-create")} title={t("back-to-create")}>
                            <ArrowLeft className="size-4" />
                        </button>
                    ) : null}
                    <h1 className="truncate text-sm font-semibold">{t("title")}</h1>
                </div>
                {shouldPromptContinue ? (
                    <Button type="primary" size="small" onClick={finishConfig}>
                        {t("save-and-return")}
                    </Button>
                ) : null}
            </header>
            <div className="settings-library-frame flex min-h-0 flex-1 flex-col md:flex-row">
                <aside className="settings-nav-panel w-full shrink-0 md:w-[200px]">
                    <nav className="thin-scrollbar flex gap-1 overflow-x-auto p-2 md:block md:space-y-1 md:p-2.5" aria-label={t("nav-aria")}>
                        {visibleConfigSections.map((item) => {
                            const selected = item.key === activeTab;
                            return (
                                <button
                                    key={item.key}
                                    type="button"
                                    className={`settings-nav-item flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-auto md:w-full md:items-start md:gap-3 md:py-2.5 ${selected ? "is-active" : "text-foreground/58 hover:bg-muted/55 hover:text-foreground"}`}
                                    onClick={() => selectSection(item.key)}
                                    aria-current={selected ? "page" : undefined}
                                >
                                    <span className={`shrink-0 md:mt-0.5 ${selected ? "text-[var(--workspace-accent)]" : ""}`}>{item.icon}</span>
                                    <span className="min-w-0">
                                        <span className="block whitespace-nowrap text-sm font-medium">{item.label}</span>
                                        <span className="mt-1 hidden text-[var(--fs-label)] leading-4 text-current opacity-65 md:block">{item.description}</span>
                                    </span>
                                </button>
                            );
                        })}
                    </nav>
                </aside>
                <section className="settings-content flex min-h-0 min-w-0 flex-1 flex-col">
                    <div className="app-workspace-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 md:px-6 md:py-5">
                        <div className={`settings-pane-root ${activeTab === "prompts" ? "h-full w-full" : "mx-auto w-full max-w-none"}`}>{panes[activeTab]}</div>
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
