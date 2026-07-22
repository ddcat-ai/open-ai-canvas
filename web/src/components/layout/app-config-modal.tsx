import { App, Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Tag, Tooltip } from "antd";
import { Boxes, CircleCheck, Cloud, Info, Plus, RadioTower, RefreshCw, SlidersHorizontal, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { ModelIcon, ModelPicker } from "@/components/model-picker";
import { UserOSSSettingsForm } from "@/components/layout/user-oss-settings-form";
import { refreshSystemChannels } from "@/lib/user-session";
import { fetchChannelModels } from "@/services/api/image";
import { audioFormatOptions, audioVoiceOptions, normalizeAudioSpeedValue } from "@/lib/audio-generation";
import {
    createModelChannel,
    defaultBaseUrlForApiFormat,
    defaultBaseUrlForChannelInterface,
    defaultConfig,
    modelOptionLabel,
    modelOptionName,
    modelOptionsFromChannels,
    normalizeModelOptionValue,
    resolveModelChannel,
    useConfigStore,
    type AiConfig,
    type ChannelInterfaceType,
    type ModelCapability,
    type ModelChannel,
} from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

type ModelGroup = {
    capability: ModelCapability;
    modelKey: "imageModel" | "videoModel" | "textModel" | "audioModel";
    modelsKey: "imageModels" | "videoModels" | "textModels" | "audioModels";
    defaultLabel: string;
    optionsLabel: string;
};

type ModelSelectOption = {
    label: ReactNode;
    title: string;
    value: string;
};

type ModelSelectOptionGroup = {
    label: ReactNode;
    title: string;
    options: ModelSelectOption[];
};

type ConfigSectionKey = "channels" | "models" | "preferences" | "storage";

const configSections: Array<{ key: ConfigSectionKey; label: string; description: string; icon: ReactNode }> = [
    { key: "channels", label: "自定义渠道", description: "连接你自己的模型服务", icon: <RadioTower className="size-4" /> },
    { key: "models", label: "模型选择", description: "设置可选项和默认模型", icon: <Boxes className="size-4" /> },
    { key: "preferences", label: "生成偏好", description: "画布、音频与系统提示词", icon: <SlidersHorizontal className="size-4" /> },
    { key: "storage", label: "我的 OSS", description: "管理个人媒体存储", icon: <Cloud className="size-4" /> },
];

const modelGroups: ModelGroup[] = [
    { capability: "image", modelKey: "imageModel", modelsKey: "imageModels", defaultLabel: "默认生图模型", optionsLabel: "生图模型可选项" },
    { capability: "video", modelKey: "videoModel", modelsKey: "videoModels", defaultLabel: "默认视频模型", optionsLabel: "视频模型可选项" },
    { capability: "text", modelKey: "textModel", modelsKey: "textModels", defaultLabel: "默认文本模型", optionsLabel: "文本模型可选项" },
    { capability: "audio", modelKey: "audioModel", modelsKey: "audioModels", defaultLabel: "默认音频模型", optionsLabel: "音频模型可选项" },
];

type UserChannelProtocol = ChannelInterfaceType | "auto" | "gemini";

const channelProtocolOptions = [
    { label: "OpenAI 自动兼容", value: "auto" },
    { label: "Gemini 原生", value: "gemini" },
    {
        label: "文本",
        options: [
            { label: "Chat Completions", value: "chat-completion" },
            { label: "OpenAI Responses", value: "openai-response" },
        ],
    },
    { label: "图片", options: [{ label: "OpenAI Images", value: "openai-image" }] },
    {
        label: "视频",
        options: [
            { label: "NewAPI 视频", value: "newapi" },
            { label: "NewAPI 渠道 1", value: "newapi-channel-1" },
            { label: "NewAPI 渠道 2", value: "newapi-channel-2" },
        ],
    },
];

export function AppConfigModal() {
    const { message } = App.useApp();
    const [activeTab, setActiveTab] = useState<ConfigSectionKey>("channels");
    const [loadingChannelIds, setLoadingChannelIds] = useState<string[]>([]);
    const config = useConfigStore((state) => state.config);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const replaceConfig = useConfigStore((state) => state.replaceConfig);
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
    const shouldPromptContinue = useConfigStore((state) => state.shouldPromptContinue);
    const configDialogSection = useConfigStore((state) => state.configDialogSection);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    const clearPromptContinue = useConfigStore((state) => state.clearPromptContinue);
    const userId = useUserStore((state) => state.user?.id);
    const userChannels = config.channels.filter((channel) => channel.scope !== "system");
    const modelOptionGroups = buildModelOptionGroups(config);
    const availableModelSet = new Set(config.models);

    useEffect(() => {
        if (isConfigOpen && configDialogSection) setActiveTab(configDialogSection);
    }, [configDialogSection, isConfigOpen]);

    useEffect(() => {
        if (!isConfigOpen || !userId) return;
        let cancelled = false;
        void refreshSystemChannels().catch((error) => {
            if (!cancelled) message.warning(error instanceof Error ? `系统模型刷新失败：${error.message}` : "系统模型刷新失败，继续使用本地缓存");
        });
        return () => {
            cancelled = true;
        };
    }, [isConfigOpen, message, userId]);
    const finishConfig = () => {
        const invalidChannel = userChannels.find((channel) => channelValidationError(channel));
        if (invalidChannel) {
            setActiveTab("channels");
            message.warning(`${invalidChannel.name || "未命名渠道"}：${channelValidationError(invalidChannel)}`);
            focusInvalidChannelField(invalidChannel);
            return;
        }
        const ready = config.channels.some(isChannelReady);
        if (shouldPromptContinue && !ready) {
            setActiveTab("channels");
            message.error("请先完成至少一个渠道的 Base URL、API Key 和模型配置");
            return;
        }
        setConfigDialogOpen(false);
        if (ready) message.success(shouldPromptContinue ? "配置已保存，请继续刚才的请求" : "配置已保存");
        clearPromptContinue();
    };

    const closeConfig = () => {
        setConfigDialogOpen(false);
        clearPromptContinue();
    };

    const updateChannels = (channels: ModelChannel[], baseConfig = config) => {
        replaceConfig(withChannels(baseConfig, channels));
    };

    const updateChannel = (id: string, patch: Partial<ModelChannel>) => {
        updateChannels(config.channels.map((channel) => (channel.id === id ? { ...channel, ...patch, models: patch.models ? uniqueModels(patch.models) : channel.models } : channel)));
    };

    const updateChannelProtocol = (channel: ModelChannel, protocol: UserChannelProtocol) => {
        const apiFormat = protocol === "gemini" ? "gemini" : "openai";
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

    const refreshChannelModels = async (channel: ModelChannel) => {
        const connectionError = channelConnectionError(channel);
        if (connectionError) {
            message.error(`${channel.name || "当前渠道"}：${connectionError}`);
            return;
        }
        setChannelLoading(channel.id, true);
        try {
            const models = await fetchChannelModels(channel);
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
            message.error(error instanceof Error ? `${error.message}；也可以直接在模型列表中手动输入模型名` : "读取模型失败，可直接手动输入模型名");
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
                        const models = await fetchChannelModels(channel);
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

    const updateCapabilityModels = (group: ModelGroup, models: string[]) => {
        const available = new Set(config.models);
        const next = uniqueModels(models.map((model) => normalizeModelOptionValue(model, config.channels)).filter((model) => model && available.has(model)));
        replaceConfig({ ...config, [group.modelsKey]: next, [group.modelKey]: next.includes(config[group.modelKey]) ? config[group.modelKey] : next[0] || "" });
    };

    return (
        <Modal
            rootClassName="app-config-modal"
            title={
                <div className="flex items-center gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-md border border-border bg-muted/40"><SlidersHorizontal className="size-4" /></span>
                    <div>
                        <div className="text-lg font-semibold">配置与用户偏好</div>
                        <div className="mt-1 text-xs font-normal text-foreground/55">模型连接、默认选项和个人存储</div>
                    </div>
                </div>
            }
            open={isConfigOpen}
            width="min(1180px, calc(100vw - 32px))"
            centered
            onCancel={closeConfig}
            styles={{ container: { height: "min(760px, calc(100dvh - 64px))", display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }, header: { margin: 0, padding: "14px 18px", borderBottom: "1px solid var(--border)" }, body: { minHeight: 0, flex: 1, overflow: "hidden", padding: 0 }, footer: { margin: 0, padding: "9px 18px", borderTop: "1px solid var(--border)" } }}
            footer={
                <div className="flex items-center justify-between gap-4">
                    <span className="text-xs text-foreground/45">修改会自动保存在当前账号的浏览器配置中</span>
                    <Button type="primary" onClick={finishConfig}>保存并完成</Button>
                </div>
            }
        >
            <div className="flex h-full min-h-0 flex-col md:flex-row">
                <aside className="w-full shrink-0 border-b border-border bg-muted/20 p-2 md:w-52 md:border-b-0 md:border-r md:p-3">
                    <nav className="thin-scrollbar flex gap-1 overflow-x-auto md:block md:space-y-1" aria-label="配置分类">
                        {configSections.map((item) => {
                            const selected = item.key === activeTab;
                            return (
                                <button
                                    key={item.key}
                                    type="button"
                                    className={`relative flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-auto md:w-full md:items-start md:gap-3 md:py-2.5 ${selected ? "border border-border bg-background text-foreground shadow-sm" : "border border-transparent text-foreground/60 hover:bg-muted/60 hover:text-foreground"}`}
                                    onClick={() => setActiveTab(item.key)}
                                    aria-current={selected ? "page" : undefined}
                                >
                                    {selected ? <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-sidebar-primary md:inset-x-auto md:inset-y-3 md:left-0 md:h-auto md:w-0.5" aria-hidden="true" /> : null}
                                    <span className="shrink-0 md:mt-0.5">{item.icon}</span>
                                    <span className="min-w-0"><span className="block whitespace-nowrap text-sm font-medium">{item.label}</span><span className="mt-1 hidden text-[11px] leading-4 text-current opacity-65 md:block">{item.description}</span></span>
                                </button>
                            );
                        })}
                    </nav>
                </aside>

                <section className="flex min-w-0 flex-1 flex-col bg-background">
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
                                                <span>新增或拉取模型后，需要到“模型选择”中加入可选项才会显示。</span>
                                                <Button type="link" size="small" className="h-auto p-0 text-xs font-semibold" onClick={() => setActiveTab("models")}>
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
                                                        <Form.Item label="接口协议" htmlFor={`channel-${channel.id}-protocol`} className="mb-0 lg:col-span-3">
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
                                                    </div>
                                                </section>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-foreground/55">
                                            <div>当前没有自定义渠道。管理员配置的系统渠道会出现在“模型”页。</div>
                                            <Button className="mt-3" icon={<Plus className="size-4" />} onClick={addChannel}>
                                                新增自定义渠道
                                            </Button>
                                        </div>
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
                                <Form layout="vertical" requiredMark={false}>
                                    <div className="mb-5 border-b border-border pb-4">
                                        <div className="text-sm font-semibold">可选模型范围</div>
                                        <div className="mt-1 text-xs leading-5 text-foreground/55">先决定各类生成控件中可以选择哪些模型，再为每种能力指定默认值。</div>
                                    </div>
                                    <div className="grid gap-4 md:grid-cols-2">
                                        {modelGroups.map((group) => (
                                            <Form.Item key={group.modelsKey} label={group.optionsLabel} className="mb-0">
                                                <Select
                                                    mode="multiple"
                                                    showSearch
                                                    allowClear
                                                    maxTagCount="responsive"
                                                    optionFilterProp="title"
                                                    placeholder={config.models.length ? `请选择${group.optionsLabel}` : "先到渠道里填写或拉取模型"}
                                                    value={config[group.modelsKey].filter((model) => availableModelSet.has(model))}
                                                    options={modelOptionGroups}
                                                    tagRender={({ value, closable, onClose }) => {
                                                        const model = String(value);
                                                        const channel = resolveModelChannel(config, model);
                                                        return (
                                                            <Tag
                                                                bordered={false}
                                                                closable={closable}
                                                                className="m-0 mr-1 max-w-full bg-foreground/[.07] py-0 text-foreground"
                                                                onMouseDown={(event) => {
                                                                    event.preventDefault();
                                                                    event.stopPropagation();
                                                                }}
                                                                onClose={onClose}
                                                            >
                                                                <span className="inline-flex max-w-[260px] items-center gap-1.5 align-middle">
                                                                    <span className="truncate">{modelOptionName(model)}</span>
                                                                    <span className="shrink-0 text-[10px] text-foreground/45">· {channel.name || "未命名渠道"}</span>
                                                                </span>
                                                            </Tag>
                                                        );
                                                    }}
                                                    onChange={(models) => updateCapabilityModels(group, models)}
                                                />
                                            </Form.Item>
                                        ))}
                                    </div>
                                    <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                        {modelGroups.map((group) => (
                                            <Form.Item key={group.modelKey} label={group.defaultLabel} className="mb-0">
                                                <ModelPicker config={config} value={config[group.modelKey]} onChange={(model) => updateConfig(group.modelKey, model)} capability={group.capability} fullWidth />
                                            </Form.Item>
                                        ))}
                                    </div>
                                </Form>
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
                                        <div className="mb-4"><h3 className="text-sm font-semibold">默认指令</h3><p className="mt-1 text-xs text-foreground/55">在未单独填写时附加到对应生成请求。</p></div>
                                        <div className="grid gap-5 lg:grid-cols-2">
                                            <Form.Item label="音频指令" className="mb-0">
                                                <Input.TextArea rows={5} value={config.audioInstructions} placeholder="例如：自然、温暖、适合旁白。" onChange={(event) => updateConfig("audioInstructions", event.target.value)} />
                                            </Form.Item>
                                            <Form.Item label="系统提示词" className="mb-0">
                                                <Input.TextArea rows={5} value={config.systemPrompt} placeholder="例如：你是一位擅长电影感写实摄影的视觉导演。" onChange={(event) => updateConfig("systemPrompt", event.target.value)} />
                                            </Form.Item>
                                        </div>
                                    </section>
                                </Form>
                            </SettingsPane>
                        ),
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
                </section>
            </div>
        </Modal>
    );
}

function SettingsPane({ children }: { children: ReactNode }) {
    return <div className="thin-scrollbar h-full min-h-0 overflow-y-auto overscroll-contain p-4 md:p-5">{children}</div>;
}

function ModelOptionLabel({ model, price }: { model: string; price?: number }) {
    return (
        <span className="flex min-w-0 items-center gap-2 py-0.5">
            <span className="grid size-6 shrink-0 place-items-center rounded-md bg-foreground/[.06]">
                <ModelIcon model={model} />
            </span>
            <span className="min-w-0 truncate font-medium">{modelOptionName(model)}</span>
            {price !== undefined ? <span className="ml-auto shrink-0 rounded-full border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-amber-700 dark:text-amber-300">{price.toLocaleString("zh-CN", { maximumFractionDigits: 6 })} 积分</span> : null}
        </span>
    );
}

function ChannelStatus({ channel }: { channel: ModelChannel }) {
    const error = channelValidationError(channel);
    return error ? (
        <Tag bordered={false} color="warning" className="m-0">
            {error}
        </Tag>
    ) : (
        <Tag bordered={false} color="success" icon={<CircleCheck className="size-3" />} className="m-0">
            可用
        </Tag>
    );
}

function buildModelOptionGroups(config: AiConfig): ModelSelectOptionGroup[] {
    const orderedChannels = [...config.channels.filter((channel) => channel.scope === "system"), ...config.channels.filter((channel) => channel.scope !== "system")];
    return orderedChannels
        .map((channel) => {
            const options = modelOptionsFromChannels([channel]).map((model) => ({
                label: <ModelOptionLabel model={model} price={modelOptionPrice(channel, model)} />,
                title: modelOptionLabel(config, model),
                value: model,
            }));
            return {
                label: <ModelOptionGroupLabel channel={channel} count={options.length} />,
                title: channel.name || "未命名渠道",
                options,
            };
        })
        .filter((group) => group.options.length);
}

function modelOptionPrice(channel: ModelChannel, model: string) {
    if (channel.scope !== "system") return undefined;
    const cost = channel.modelCosts?.find((item) => item.model === modelOptionName(model));
    return cost ? cost.unitPriceMicrocredits / 1_000_000 : undefined;
}

function ModelOptionGroupLabel({ channel, count }: { channel: ModelChannel; count: number }) {
    return (
        <span className="flex min-w-0 items-center gap-2 py-0.5">
            <span className="min-w-0 truncate text-xs font-semibold text-foreground/75">{channel.name || "未命名渠道"}</span>
            <span className="shrink-0 text-[10px] font-normal text-foreground/40">{channel.scope === "system" ? "系统渠道" : "自定义渠道"}</span>
            <span className="ml-auto shrink-0 text-[10px] font-normal tabular-nums text-foreground/35">{count}</span>
        </span>
    );
}

function withChannels(config: AiConfig, channels: ModelChannel[]): AiConfig {
    const models = modelOptionsFromChannels(channels);
    const imageModels = keepAvailable(config.imageModels, models);
    const videoModels = keepAvailable(config.videoModels, models);
    const textModels = keepAvailable(config.textModels, models);
    const audioModels = keepAvailable(config.audioModels, models);
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

function keepAvailable(current: string[], allModels: string[]) {
    const available = new Set(allModels);
    return uniqueModels(current).filter((model) => available.has(model));
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
    return [channel.baseUrl.trim(), channel.apiKey.trim(), channel.apiFormat, channel.interfaceType || "auto"].join("\n");
}

function channelValidationError(channel: ModelChannel) {
    return channelConnectionError(channel) || (!channel.models.length ? "请添加至少一个模型" : "");
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
        case "newapi":
            return "NewAPI 视频";
        case "newapi-channel-1":
            return "NewAPI 渠道 1";
        case "newapi-channel-2":
            return "NewAPI 渠道 2";
        default:
            return "OpenAI 自动兼容";
    }
}

function isKnownDefaultBaseUrl(value: string) {
    const normalized = value.trim().replace(/\/+$/, "");
    if (!normalized) return true;
    return [defaultBaseUrlForApiFormat("openai"), defaultBaseUrlForApiFormat("gemini")].some((candidate) => candidate.replace(/\/+$/, "") === normalized);
}
