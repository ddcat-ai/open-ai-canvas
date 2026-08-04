import { App, Button, Form, Input, InputNumber, Popconfirm, Select, Tag, Tooltip } from "antd";
import { ArrowLeft, Boxes, ChevronDown, ChevronUp, CircleCheck, Cloud, Info, MessageSquareText, Plus, RadioTower, RefreshCw, SlidersHorizontal, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { UserOSSSettingsForm } from "@/components/layout/user-oss-settings-form";
import { WorkspaceState } from "@/components/layout/workspace-state";
import { WorkspaceSignalIcon } from "@/components/ui/aceternity/workspace-signal-icon";
import { ChannelHeadersEditor, validateChannelHeaders } from "@/components/channel-headers-editor";
import { refreshSystemChannels } from "@/lib/user-session";
import { MODEL_PROTOCOL_OPTIONS, modelProtocolLabel } from "@/lib/model-protocols";
import { fetchChannelModels } from "@/services/api/image";
import { audioFormatOptions, audioVoiceOptions, normalizeAudioSpeedValue } from "@/lib/audio-generation";
import {
    createModelChannel,
    defaultBaseUrlForApiFormat,
    defaultBaseUrlForChannelInterface,
    defaultConfig,
    filterModelsByCapability,
    modelOptionsFromChannels,
    useConfigStore,
    type AiConfig,
    type ChannelInterfaceType,
    type ModelChannel,
} from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { ChannelModelSettings } from "./channel-video-pricing";
import { ModelDefaultGrid } from "./model-default-grid";
import { PromptPreferencesPane } from "./prompt-preferences-pane";

type ConfigSectionKey = "channels" | "models" | "preferences" | "prompts" | "storage";

const configSections: Array<{ key: ConfigSectionKey; label: string; description: string; icon: ReactNode }> = [
    { key: "channels", label: "自定义渠道", description: "连接你自己的模型服务", icon: <RadioTower className="size-4" /> },
    { key: "models", label: "模型选择", description: "按领域选择默认模型", icon: <Boxes className="size-4" /> },
    { key: "preferences", label: "生成偏好", description: "画布、视频与音频默认值", icon: <SlidersHorizontal className="size-4" /> },
    { key: "prompts", label: "提示词偏好", description: "按任务定制平台模板", icon: <MessageSquareText className="size-4" /> },
    { key: "storage", label: "我的 OSS", description: "管理个人媒体存储", icon: <Cloud className="size-4" /> },
];

type UserChannelProtocol = ChannelInterfaceType | "auto" | "gemini";

const channelProtocolOptions = [
    { label: "OpenAI 自动兼容", value: "auto" },
    { label: "Google Gemini（模型级选择）", value: "gemini" },
    ...MODEL_PROTOCOL_OPTIONS,
];

function isConfigSection(value: string | null): value is ConfigSectionKey {
    return configSections.some((section) => section.key === value);
}

function channelModelFetchErrorMessage(error: unknown) {
    const detail = error instanceof Error ? error.message : "读取模型失败";
    // 私网地址会在实际生成时继续被 SSRF 防护拦截，不能提示用户靠手填模型绕过。
    if (detail.includes("不允许访问本机") || detail.includes("不允许访问保留地址")) {
        return `${detail}；可信私网服务需由部署管理员配置 CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS`;
    }
    return `${detail}；也可以直接在模型列表中手动输入模型名`;
}

export default function SettingsPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const requestedSection = searchParams.get("section");
    const [activeTab, setActiveTab] = useState<ConfigSectionKey>(isConfigSection(requestedSection) ? requestedSection : "channels");
    const [loadingChannelIds, setLoadingChannelIds] = useState<string[]>([]);
    const [collapsedChannelIds, setCollapsedChannelIds] = useState<Set<string>>(new Set());
    const config = useConfigStore((state) => state.config);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const replaceConfig = useConfigStore((state) => state.replaceConfig);
    const shouldPromptContinue = searchParams.get("continue") === "1";
    const userId = useUserStore((state) => state.user?.id);
    const userChannels = config.channels.filter((channel) => channel.scope !== "system");

    useEffect(() => {
        if (isConfigSection(requestedSection)) setActiveTab(requestedSection);
    }, [requestedSection]);

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
        const invalidChannel = userChannels.find((channel) => channelValidationError(channel));
        if (invalidChannel) {
            selectSection("channels");
            message.warning(`${invalidChannel.name || "未命名渠道"}：${channelValidationError(invalidChannel)}`);
            focusInvalidChannelField(invalidChannel);
            return;
        }
        const ready = config.channels.some(isChannelReady);
        if (!ready) {
            selectSection("channels");
            message.error(shouldPromptContinue ? "请先完成至少一个渠道的 Base URL、API Key 和模型配置" : "当前没有可用渠道，请先完成连接信息和模型配置");
            return;
        }
        message.success("配置已保存，正在返回创作页面");
        navigate(-1);
    };

    const updateChannels = (channels: ModelChannel[], baseConfig = config) => {
        replaceConfig(withChannels(baseConfig, channels));
    };

    const updateChannel = (id: string, patch: Partial<ModelChannel>) => {
        updateChannels(config.channels.map((channel) => {
            if (channel.id !== id) return channel;
            const models = patch.models ? uniqueModels(patch.models) : channel.models;
            return {
                ...channel,
                ...patch,
                models,
                modelCosts: patch.modelCosts !== undefined ? patch.modelCosts : (patch.models ? channel.modelCosts?.filter((item) => models.includes(item.model)) : channel.modelCosts),
            };
        }));
    };

    const updateChannelProtocol = (channel: ModelChannel, protocol: UserChannelProtocol) => {
        const apiFormat = protocol === "gemini" || protocol === "gemini-veo" ? "gemini" : "openai";
        const interfaceType = protocol === "auto" || protocol === "gemini" ? undefined : protocol;
        const defaultBaseUrl = protocol === "gemini" ? defaultBaseUrlForApiFormat("gemini") : defaultBaseUrlForChannelInterface(interfaceType);
        const baseUrl = isKnownDefaultBaseUrl(channel.baseUrl) ? defaultBaseUrl : channel.baseUrl;
        updateChannel(channel.id, { apiFormat, interfaceType, baseUrl });
    };

    const addChannel = () => {
        const channel = createModelChannel({ name: `渠道 ${userChannels.length + 1}` });
        updateChannels([...config.channels, channel]);
        requestAnimationFrame(() => document.getElementById(`channel-${channel.id}-name`)?.focus());
    };

    const deleteChannel = (id: string) => {
        const channel = config.channels.find((item) => item.id === id);
        if (channel?.scope === "system") {
            message.warning("系统渠道由管理员维护");
            return;
        }
        updateChannels(config.channels.filter((item) => item.id !== id));
    };

    const setChannelLoading = (id: string, loading: boolean) => {
        setLoadingChannelIds((items) => (loading ? Array.from(new Set([...items, id])) : items.filter((item) => item !== id)));
    };

    const toggleChannelCollapsed = (id: string) => {
        setCollapsedChannelIds((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const refreshChannelModels = async (channel: ModelChannel) => {
        const connectionError = channelConnectionError(channel);
        if (connectionError) {
            message.error(`${channel.name || "当前渠道"}：${connectionError}`);
            return;
        }
        setChannelLoading(channel.id, true);
        try {
            const models = await fetchChannelModels(channel, true);
            if (!models.length) {
                message.warning(`${channel.name || "当前渠道"}未返回模型，已保留现有手工模型`);
                return;
            }
            const latestConfig = useConfigStore.getState().config;
            const latestChannel = latestConfig.channels.find((item) => item.id === channel.id);
            if (!latestChannel) return;
            if (channelConnectionSignature(latestChannel) !== channelConnectionSignature(channel)) {
                message.warning(`${latestChannel.name || "当前渠道"}的连接配置已改变，已忽略旧的拉取结果`);
                return;
            }
            updateChannels(
                latestConfig.channels.map((item) => (item.id === channel.id ? { ...item, models } : item)),
                latestConfig,
            );
            message.success(`${latestChannel.name || "当前渠道"}模型列表已更新`);
        } catch (error) {
            message.error(channelModelFetchErrorMessage(error));
        } finally {
            setChannelLoading(channel.id, false);
        }
    };

    const refreshAllModels = async () => {
        const runnable = userChannels.filter((channel) => !channelConnectionError(channel));
        const skipped = userChannels.filter((channel) => channelConnectionError(channel));
        if (!runnable.length) {
            const detail = skipped.map((channel) => `${channel.name || "未命名渠道"}：${channelConnectionError(channel)}`).join("；");
            message.error(detail || "没有可拉取的自定义渠道，请先填写有效 Base URL 和 API Key");
            return;
        }
        setChannelLoading("all", true);
        try {
            const results = await Promise.all(
                runnable.map(async (channel) => {
                    try {
                        const models = await fetchChannelModels(channel, true);
                        return { channel, models, error: "" };
                    } catch (error) {
                        return { channel, models: [] as string[], error: error instanceof Error ? error.message : "读取失败" };
                    }
                }),
            );
            const latestConfig = useConfigStore.getState().config;
            const successful = results.filter((item) => {
                const latestChannel = latestConfig.channels.find((channel) => channel.id === item.channel.id);
                return Boolean(item.models.length && latestChannel && channelConnectionSignature(latestChannel) === channelConnectionSignature(item.channel));
            });
            const stale = results.filter((item) => {
                const latestChannel = latestConfig.channels.find((channel) => channel.id === item.channel.id);
                return Boolean(item.models.length && (!latestChannel || channelConnectionSignature(latestChannel) !== channelConnectionSignature(item.channel)));
            });
            const failed = results.filter((item) => !item.models.length);
            if (successful.length) {
                const modelMap = new Map(successful.map((item) => [item.channel.id, item.models] as const));
                updateChannels(
                    latestConfig.channels.map((channel) => (modelMap.has(channel.id) ? { ...channel, models: modelMap.get(channel.id) || channel.models } : channel)),
                    latestConfig,
                );
                message.success(`已更新 ${successful.length} 个渠道的模型`);
            }
            const warnings = [
                ...failed.map((item) => `${item.channel.name || "未命名渠道"}：${item.error || "未返回模型"}`),
                ...stale.map((item) => `${item.channel.name || "未命名渠道"}：连接配置已改变，已忽略旧结果`),
                ...skipped.map((channel) => `${channel.name || "未命名渠道"}：${channelConnectionError(channel)}`),
            ];
            if (warnings.length) {
                message.warning(`${warnings.join("；")}。未更新的渠道已保留原有模型列表`);
            }
        } catch (error) {
            message.error(error instanceof Error ? error.message : "批量读取模型失败，原有模型列表未改动");
        } finally {
            setChannelLoading("all", false);
        }
    };

    return (
        <main className="flex h-full min-h-0 flex-col bg-[var(--workspace-canvas)] text-foreground">
            <header className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-b border-border/70 px-4 py-3 sm:px-5">
                <div className="flex min-w-0 items-center gap-3">
                    {shouldPromptContinue ? (
                        <button type="button" className="app-workspace-icon-button shrink-0" onClick={() => navigate(-1)} aria-label="返回创作页面" title="返回创作页面"><ArrowLeft className="size-4" /></button>
                    ) : null}
                    <WorkspaceSignalIcon variant="settings" />
                    <div className="min-w-0">
                        <h1 className="truncate text-base font-semibold">配置与用户偏好</h1>
                        <p className="mt-0.5 truncate text-xs text-foreground/50">模型连接、生成默认值与个人媒体存储</p>
                    </div>
                </div>
                {shouldPromptContinue ? <Button type="primary" onClick={finishConfig}>保存并返回创作</Button> : null}
            </header>
            <div className="flex min-h-0 flex-1 flex-col md:flex-row">
                <aside className="w-full shrink-0 border-b border-border/70 bg-transparent p-2 md:w-[224px] md:border-b-0 md:border-r md:p-3">
                    <nav className="thin-scrollbar flex gap-1 overflow-x-auto md:block md:space-y-1" aria-label="配置分类">
                        {configSections.map((item) => {
                            const selected = item.key === activeTab;
                            return (
                                <button
                                    key={item.key}
                                    type="button"
                                    className={`flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-auto md:w-full md:items-start md:gap-3 md:py-2.5 ${selected ? "bg-[var(--workspace-accent-soft)] text-foreground" : "text-foreground/58 hover:bg-muted/55 hover:text-foreground"}`}
                                    onClick={() => selectSection(item.key)}
                                    aria-current={selected ? "page" : undefined}
                                >
                                    <span className={`shrink-0 md:mt-0.5 ${selected ? "text-[var(--workspace-accent)]" : ""}`}>{item.icon}</span>
                                    <span className="min-w-0"><span className="block whitespace-nowrap text-sm font-medium">{item.label}</span><span className="mt-1 hidden text-[var(--fs-label)] leading-4 text-current opacity-65 md:block">{item.description}</span></span>
                                </button>
                            );
                        })}
                    </nav>
                </aside>

                <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-transparent">
                    <div className="app-workspace-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 md:px-6 md:py-5">
                        <div className={activeTab === "prompts" ? "h-full w-full" : "mx-auto w-full max-w-[1180px]"}>
                    {([
                    {
                        key: "channels",
                        label: "渠道",
                        children: (
                            <SettingsPane>
                                <Form layout="vertical" requiredMark={false}>
                                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
                                        <div className="min-w-0 flex-1">
                                            <div className="flex w-fit max-w-full flex-wrap items-center gap-1.5 text-xs text-foreground/65">
                                                <Info className="size-3.5 shrink-0" />
                                                <span>渠道保存连接和默认协议；拉取模型后，请为需要特殊路径的模型单独选择请求协议。</span>
                                                <Button type="link" size="small" className="h-auto p-0 text-xs font-semibold" onClick={() => selectSection("models")}>
                                                    打开模型选择
                                                </Button>
                                            </div>
                                        </div>
                                        <div className="flex w-full gap-2 sm:w-auto sm:shrink-0">
                                            <Button
                                                className="h-10 flex-1 sm:h-8 sm:flex-none"
                                                icon={<RefreshCw className="size-4" />}
                                                loading={loadingChannelIds.includes("all")}
                                                disabled={loadingChannelIds.some((id) => id !== "all")}
                                                onClick={() => void refreshAllModels()}
                                            >
                                                拉取全部
                                            </Button>
                                            <Button className="h-10 flex-1 sm:h-8 sm:flex-none" type="primary" icon={<Plus className="size-4" />} onClick={addChannel}>
                                                新增渠道
                                            </Button>
                                        </div>
                                    </div>
                                    {userChannels.length ? (
                                        <div className="space-y-3">
                                            {userChannels.map((channel) => (
                                                <section key={channel.id} aria-labelledby={`channel-${channel.id}-title`} className="rounded-md border border-border bg-background p-3">
                                                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                                                        <div className="min-w-0 flex-1 basis-52">
                                                            <h3 id={`channel-${channel.id}-title`} className="truncate text-sm font-semibold">
                                                                {channel.name || "未命名渠道"}
                                                            </h3>
                                                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-foreground/55">
                                                                {channelProtocolLabel(channel)} · 已保存 {channel.models.length} 个模型
                                                                <ChannelStatus channel={channel} />
                                                            </div>
                                                        </div>
                                                        <div className="flex w-full justify-end gap-2 sm:w-auto sm:shrink-0">
                                                            <Button
                                                                className="h-10 sm:h-8"
                                                                size="small"
                                                                icon={<RefreshCw className="size-3.5" />}
                                                                loading={loadingChannelIds.includes(channel.id)}
                                                                disabled={loadingChannelIds.includes("all")}
                                                                onClick={() => void refreshChannelModels(channel)}
                                                            >
                                                                拉取模型
                                                            </Button>
                                                            <Tooltip title={collapsedChannelIds.has(channel.id) ? "\u5c55\u5f00\u6e20\u9053\u914d\u7f6e" : "\u6536\u8d77\u6e20\u9053\u914d\u7f6e"}>
                                                                <Button
                                                                    className="size-10 p-0 sm:size-8"
                                                                    size="small"
                                                                    aria-label={`${collapsedChannelIds.has(channel.id) ? "\u5c55\u5f00" : "\u6536\u8d77"}\u6e20\u9053\u914d\u7f6e ${channel.name || "\u672a\u547d\u540d\u6e20\u9053"}`}
                                                                    aria-expanded={!collapsedChannelIds.has(channel.id)}
                                                                    aria-controls={`channel-${channel.id}-details`}
                                                                    icon={collapsedChannelIds.has(channel.id) ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
                                                                    onClick={() => toggleChannelCollapsed(channel.id)}
                                                                />
                                                            </Tooltip>
                                                            <Popconfirm title="删除自定义渠道？" description="该渠道关联的模型选择会同时移除。" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => deleteChannel(channel.id)}>
                                                                <Tooltip title="删除渠道">
                                                                    <Button
                                                                        className="size-10 p-0 sm:size-8"
                                                                        aria-label={`删除渠道 ${channel.name || "未命名渠道"}`}
                                                                        size="small"
                                                                        danger
                                                                        disabled={loadingChannelIds.includes(channel.id) || loadingChannelIds.includes("all")}
                                                                        icon={<Trash2 className="size-3.5" />}
                                                                    />
                                                                </Tooltip>
                                                            </Popconfirm>
                                                        </div>
                                                    </div>
                                                    <div id={`channel-${channel.id}-details`} hidden={collapsedChannelIds.has(channel.id)}>
                                                    <div className="grid gap-x-3 gap-y-2 lg:grid-cols-12">
                                                        <Form.Item label="渠道名称" htmlFor={`channel-${channel.id}-name`} className="mb-0 lg:col-span-3">
                                                            <Input
                                                                id={`channel-${channel.id}-name`}
                                                                value={channel.name}
                                                                placeholder="例如：我的 NewAPI"
                                                                onChange={(event) => updateChannel(channel.id, { name: event.target.value })}
                                                                onBlur={(event) => updateChannel(channel.id, { name: event.target.value.trim() || "未命名渠道" })}
                                                            />
                                                        </Form.Item>
                                                        <Form.Item label="默认模型协议" htmlFor={`channel-${channel.id}-protocol`} className="mb-0 lg:col-span-3" extra="用于新模型预填，单个模型可在下方覆盖。">
                                                            <Select<UserChannelProtocol>
                                                                id={`channel-${channel.id}-protocol`}
                                                                value={channelProtocolValue(channel)}
                                                                options={channelProtocolOptions}
                                                                onChange={(value) => updateChannelProtocol(channel, value)}
                                                            />
                                                        </Form.Item>
                                                        <Form.Item label="Base URL" htmlFor={`channel-${channel.id}-base-url`} className="mb-0 lg:col-span-6">
                                                            <Input
                                                                id={`channel-${channel.id}-base-url`}
                                                                inputMode="url"
                                                                value={channel.baseUrl}
                                                                placeholder="填写渠道 Base URL"
                                                                onChange={(event) => updateChannel(channel.id, { baseUrl: event.target.value })}
                                                                onBlur={(event) => updateChannel(channel.id, { baseUrl: event.target.value.trim().replace(/\/+$/, "") })}
                                                            />
                                                        </Form.Item>
                                                        <Form.Item label="API Key" htmlFor={`channel-${channel.id}-api-key`} className="mb-0 lg:col-span-5">
                                                            <Input.Password
                                                                id={`channel-${channel.id}-api-key`}
                                                                autoComplete="new-password"
                                                                value={channel.apiKey}
                                                                placeholder={channel.apiFormat === "gemini" ? "填写 Gemini API Key" : "填写当前渠道 API Key"}
                                                                onChange={(event) => updateChannel(channel.id, { apiKey: event.target.value })}
                                                                onBlur={(event) => updateChannel(channel.id, { apiKey: event.target.value.trim() })}
                                                            />
                                                        </Form.Item>
                                                        <Form.Item label="模型列表" htmlFor={`channel-${channel.id}-models`} className="mb-0 lg:col-span-7">
                                                            <Select
                                                                id={`channel-${channel.id}-models`}
                                                                mode="tags"
                                                                showSearch
                                                                allowClear
                                                                maxTagCount="responsive"
                                                                tokenSeparators={[",", "\n"]}
                                                                placeholder="输入模型名，或点击拉取模型"
                                                                value={channel.models}
                                                                onChange={(models) => updateChannel(channel.id, { models: uniqueModels(models) })}
                                                            />
                                                        </Form.Item>
                                                        <div className="lg:col-span-12">
                                                            <ChannelHeadersEditor value={channel.headers} onChange={(headers) => updateChannel(channel.id, { headers })} />
                                                        </div>
                                                    </div>
                                                    <ChannelModelSettings channel={channel} onChange={(modelCosts) => updateChannel(channel.id, { modelCosts })} />
                                                    </div>
                                                </section>
                                            ))}
                                        </div>
                                    ) : (
                                        <WorkspaceState
                                            icon="settings"
                                            compact
                                            title="当前没有自定义渠道"
                                            description="管理员配置的系统渠道会出现在模型选择中；也可以添加自己的模型服务。"
                                            action={<Button icon={<Plus className="size-4" />} onClick={addChannel}>新增自定义渠道</Button>}
                                        />
                                    )}
                                </Form>
                            </SettingsPane>
                        ),
                    },
                    {
                        key: "models",
                        label: "模型",
                        children: (
                            <SettingsPane>
                                <ModelDefaultGrid config={config} onChange={(key, model) => updateConfig(key, model)} />
                            </SettingsPane>
                        ),
                    },
                    {
                        key: "preferences",
                        label: "生成偏好",
                        children: (
                            <SettingsPane>
                                <Form layout="vertical" requiredMark={false}>
                                    <section className="border-b border-border pb-6">
                                        <div className="mb-4"><h3 className="text-sm font-semibold">画布生成</h3><p className="mt-1 text-xs text-foreground/55">设置新建生成任务时使用的初始值，节点内仍可单独覆盖。</p></div>
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

                                    <section className="border-b border-border py-6">
                                        <div className="mb-4"><h3 className="text-sm font-semibold">音频默认值</h3><p className="mt-1 text-xs text-foreground/55">用于新建音频节点和未单独设置参数的生成任务。</p></div>
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

                                    <section className="pt-6">
                                        <div className="mb-4"><h3 className="text-sm font-semibold">音频指令</h3><p className="mt-1 text-xs text-foreground/55">在音频节点没有单独填写时使用。</p></div>
                                        <div className="max-w-2xl">
                                            <Form.Item label="默认音频指令" className="mb-0">
                                                <Input.TextArea rows={5} value={config.audioInstructions} placeholder="例如：自然、温暖、适合旁白。" onChange={(event) => updateConfig("audioInstructions", event.target.value)} />
                                            </Form.Item>
                                        </div>
                                    </section>
                                </Form>
                            </SettingsPane>
                        ),
                    },
                    {
                        key: "prompts",
                        label: "提示词偏好",
                        children: <SettingsPane fill><PromptPreferencesPane /></SettingsPane>,
                    },
                    {
                        key: "storage",
                        label: (
                            <span className="inline-flex items-center gap-2">
                                <Cloud className="size-4" />
                                我的 OSS
                            </span>
                        ),
                        children: (
                            <SettingsPane>
                                <UserOSSSettingsForm />
                            </SettingsPane>
                        ),
                    },
                        ] as Array<{ key: ConfigSectionKey; label: ReactNode; children: ReactNode }>).find((item) => item.key === activeTab)?.children}
                        </div>
                    </div>
                </section>
            </div>
        </main>
    );
}

function SettingsPane({ children, fill = false }: { children: ReactNode; fill?: boolean }) {
    return <div className={fill ? "h-full" : undefined}>{children}</div>;
}

function ChannelStatus({ channel }: { channel: ModelChannel }) {
    const error = channelValidationError(channel);
    return error ? (
        <Tag variant="filled" color="warning" className="m-0">
            {error}
        </Tag>
    ) : (
        <Tag variant="filled" color="success" icon={<CircleCheck className="size-3" />} className="m-0">
            可用
        </Tag>
    );
}

function withChannels(config: AiConfig, channels: ModelChannel[]): AiConfig {
    const models = modelOptionsFromChannels(channels);
    const imageModels = filterModelsByCapability(models, "image", channels);
    const videoModels = filterModelsByCapability(models, "video", channels);
    const textModels = filterModelsByCapability(models, "text", channels);
    const audioModels = filterModelsByCapability(models, "audio", channels);
    return {
        ...config,
        channels,
        models,
        baseUrl: channels[0]?.baseUrl || config.baseUrl,
        apiKey: channels[0]?.apiKey || config.apiKey,
        apiFormat: channels[0]?.apiFormat || config.apiFormat,
        imageModels,
        videoModels,
        textModels,
        audioModels,
        imageModel: normalizeDefaultModel(config.imageModel, imageModels),
        videoModel: normalizeDefaultModel(config.videoModel, videoModels),
        textModel: normalizeDefaultModel(config.textModel, textModels),
        audioModel: normalizeDefaultModel(config.audioModel, audioModels),
    };
}

function normalizeDefaultModel(value: string, options: string[]) {
    if (options.includes(value)) return value;
    return options[0] || "";
}

function normalizeImageCount(value: string) {
    return String(Math.max(1, Math.min(15, Math.floor(Math.abs(Number(value)) || Number(defaultConfig.canvasImageCount)))));
}

function uniqueModels(models: string[]) {
    return Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)));
}

function channelProtocolValue(channel: ModelChannel): UserChannelProtocol {
    if (channel.apiFormat === "gemini") return "gemini";
    return channel.interfaceType || "auto";
}

function channelConnectionError(channel: ModelChannel) {
    const baseUrl = channel.baseUrl.trim();
    if (!baseUrl) return "请填写 Base URL";
    try {
        const parsed = new URL(baseUrl);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "Base URL 只支持 HTTP 或 HTTPS";
    } catch {
        return "Base URL 格式不正确";
    }
    if (!channel.apiKey.trim()) return "请填写 API Key";
    return "";
}

function channelConnectionSignature(channel: ModelChannel) {
    return [channel.baseUrl.trim(), channel.apiKey.trim(), channel.apiFormat, channel.interfaceType || "auto", JSON.stringify(channel.headers || [])].join("\n");
}

function channelValidationError(channel: ModelChannel) {
    return channelConnectionError(channel) || validateChannelHeaders(channel.headers) || (!channel.models.length ? "请添加至少一个模型" : "");
}

function isChannelReady(channel: ModelChannel) {
    return !channelValidationError(channel);
}

function focusInvalidChannelField(channel: ModelChannel) {
    const baseUrlError = channelConnectionError({ ...channel, apiKey: "valid" });
    const field = baseUrlError ? "base-url" : !channel.apiKey.trim() ? "api-key" : "models";
    requestAnimationFrame(() => {
        const element = document.getElementById(`channel-${channel.id}-${field}`);
        element?.scrollIntoView({ behavior: "smooth", block: "center" });
        element?.focus({ preventScroll: true });
    });
}

function channelProtocolLabel(channel: ModelChannel) {
    const protocol = channelProtocolValue(channel);
    switch (protocol) {
        case "gemini":
            return "Gemini 原生";
        case "chat-completion":
            return "Chat Completions";
        case "openai-response":
            return "OpenAI Responses";
        case "openai-image":
            return "OpenAI Images";
        default:
            return protocol === "auto" ? "OpenAI 自动兼容" : modelProtocolLabel(protocol);
    }
}

function isKnownDefaultBaseUrl(value: string) {
    const normalized = value.trim().replace(/\/+$/, "");
    if (!normalized) return true;
    return [defaultBaseUrlForApiFormat("openai"), defaultBaseUrlForApiFormat("gemini")].some((candidate) => candidate.replace(/\/+$/, "") === normalized);
}
