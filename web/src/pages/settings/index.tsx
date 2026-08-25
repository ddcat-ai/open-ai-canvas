import { App, Button, Form, Input, InputNumber, Select } from "antd";
import { ArrowLeft, Boxes, Bug, Cloud, MessageSquareText, RadioTower, SlidersHorizontal, SquareTerminal } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";

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
import DiagnosticsPanel from "./diagnostics-panel";

type ConfigSectionKey = "local-cli" | "channels" | "models" | "preferences" | "prompts" | "storage" | "diagnostics";

const configSections: Array<{ key: ConfigSectionKey; label: string; description: string; icon: ReactNode }> = [
    { key: "local-cli", label: "本机工具", description: "连接 Runtime 与官方 CLI", icon: <SquareTerminal className="size-4" /> },
    { key: "channels", label: "自定义渠道", description: "连接你自己的模型服务", icon: <RadioTower className="size-4" /> },
    { key: "models", label: "模型选择", description: "按领域选择默认模型", icon: <Boxes className="size-4" /> },
    { key: "preferences", label: "生成偏好", description: "画布、视频与音频默认值", icon: <SlidersHorizontal className="size-4" /> },
    { key: "prompts", label: "提示词偏好", description: "按任务定制平台模板", icon: <MessageSquareText className="size-4" /> },
    { key: "storage", label: "我的对象存储", description: "管理个人媒体存储", icon: <Cloud className="size-4" /> },
    { key: "diagnostics", label: "问题诊断", description: "导出日志协助排查", icon: <Bug className="size-4" /> },
];

export function isConfigSection(value: string | null): value is ConfigSectionKey {
    return configSections.some((section) => section.key === value);
}

export default function SettingsPage() {
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
            if (!cancelled) message.warning(error instanceof Error ? `系统模型刷新失败：${error.message}` : "系统模型刷新失败，继续使用本地缓存");
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
            message.warning(`${invalidChannel.name || "未命名渠道"}：${channelValidationError(invalidChannel)}`);
            focusInvalidChannelField(invalidChannel);
            return;
        }
        const hasReadyLocalRuntime = effectiveConfig.channels.some((channel) => channel.transport === "local-runtime" && channel.enabled !== false && Boolean(channel.localModels?.length));
        if (!effectiveConfig.channels.some(isChannelReady) && !hasReadyLocalRuntime) {
            selectSection(customChannelsEnabled ? "channels" : "models");
            message.error(customChannelsEnabled ? (shouldPromptContinue ? "请先完成至少一个渠道的 Base URL、API Key 和模型配置" : "当前没有可用渠道，请先完成连接信息和模型配置") : "当前没有可用的系统模型，请联系管理员配置系统渠道");
            return;
        }
        message.success("配置已保存，正在返回创作页面");
        navigate(-1);
    };

    const panes: Record<ConfigSectionKey, ReactNode> = {
        "local-cli": <SettingsPane><LocalCliSettings /></SettingsPane>,
        channels: <SettingsPane><ChannelSettingsPane onOpenModels={() => selectSection("models")} /></SettingsPane>,
        models: (
            <SettingsPane>
                <div className="settings-pane-header">
                    <div className="min-w-0">
                        <h2>模型选择</h2>
                        <p>按领域选择默认模型；模型能力与请求协议在渠道“模型与能力”中配置。</p>
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
                        <h2>生成偏好</h2>
                        <p>画布、视频与音频默认值，节点内仍可单独覆盖。</p>
                    </div>
                </div>
                <div className="settings-section">
                    <Form layout="vertical" requiredMark={false}>
                        <section className="settings-preference-block pb-6">
                            <div className="mb-4">
                                <h3 className="text-sm font-semibold">画布生成</h3>
                                <p className="mt-1 text-xs text-foreground/55">设置新建生成任务时使用的初始值，节点内仍可单独覆盖。</p>
                            </div>
                            <Form.Item label="默认生图张数" className="mb-0 max-w-xs">
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
                                <h3 className="text-sm font-semibold">音频默认值</h3>
                                <p className="mt-1 text-xs text-foreground/55">用于新建音频节点和未单独设置参数的生成任务。</p>
                            </div>
                            <div className="grid gap-4 md:grid-cols-3">
                                <Form.Item label="默认声音" className="mb-0">
                                    <Select value={config.audioVoice} options={audioVoiceOptions} onChange={(value) => updateConfig("audioVoice", value)} />
                                </Form.Item>
                                <Form.Item label="文件格式" className="mb-0">
                                    <Select value={config.audioFormat} options={audioFormatOptions} onChange={(value) => updateConfig("audioFormat", value)} />
                                </Form.Item>
                                <Form.Item label="语速" className="mb-0">
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
                                <h3 className="text-sm font-semibold">音频指令</h3>
                                <p className="mt-1 text-xs text-foreground/55">在音频节点没有单独填写时使用。</p>
                            </div>
                            <div className="max-w-2xl">
                                <Form.Item label="默认音频指令" className="mb-0">
                                    <Input.TextArea rows={5} value={config.audioInstructions} placeholder="例如：自然、温暖、适合旁白。" onChange={(event) => updateConfig("audioInstructions", event.target.value)} />
                                </Form.Item>
                            </div>
                        </section>
                    </Form>
                </div>
            </SettingsPane>
        ),
        prompts: <SettingsPane fill><PromptPreferencesPane /></SettingsPane>,
        diagnostics: <SettingsPane><DiagnosticsPanel taskId={searchParams.get("taskId") || undefined} projectId={searchParams.get("projectId") || undefined} /></SettingsPane>,
        storage: (
            <SettingsPane>
                <div className="settings-section">
                    <UserOSSSettingsForm />
                </div>
            </SettingsPane>
        ),
    };

    return (
        <main className="settings-page app-workspace-page flex h-full min-h-0 flex-col text-foreground">
            <header className="settings-topbar shrink-0">
                <div className="flex min-w-0 items-center gap-2.5">
                    {shouldPromptContinue ? (
                        <button type="button" className="app-workspace-icon-button shrink-0" onClick={() => navigate(-1)} aria-label="返回创作页面" title="返回创作页面">
                            <ArrowLeft className="size-4" />
                        </button>
                    ) : null}
                    <h1 className="truncate text-sm font-semibold">设置</h1>
                </div>
                {shouldPromptContinue ? <Button type="primary" size="small" onClick={finishConfig}>保存并返回</Button> : null}
            </header>
            <div className="settings-library-frame flex min-h-0 flex-1 flex-col md:flex-row">
                <aside className="settings-nav-panel w-full shrink-0 md:w-[200px]">
                    <nav className="thin-scrollbar flex gap-1 overflow-x-auto p-2 md:block md:space-y-1 md:p-2.5" aria-label="配置分类">
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
