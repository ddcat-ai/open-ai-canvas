import { App, Button, Form, Input, Popconfirm, Segmented, Select, Switch, Tooltip } from "antd";
import { ChevronDown, ChevronUp, MonitorUp, Plus, RefreshCw, Trash2, Workflow } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { ChannelHeadersEditor, validateChannelHeaders } from "@/components/channel-headers-editor";
import { WorkspaceState } from "@/components/layout/workspace-state";
import { mergeFetchedChannelModelCosts } from "@/lib/channel-model-catalog";
import { desktopLocalChannelFormState, desktopLocalChannelPayloadValue, DESKTOP_LOCAL_CHANNEL_EXAMPLE_BASE_URL } from "@/lib/desktop-local-channel";
import { fetchChannelModels } from "@/services/api/image";
import { fetchPluginProviderCatalog } from "@/services/api/plugin-catalog";
import { pluginWorkflowCapabilityConfig } from "@/lib/model-capabilities";
import type { ModelProtocolDefinition } from "@/lib/model-protocols";
import {
    createModelChannel,
    defaultBaseUrlForApiFormat,
    filterModelsByCapability,
    modelOptionsFromChannels,
    useConfigStore,
    type AiConfig,
    type ModelChannel,
} from "@/stores/use-config-store";
import { ChannelModelSettings } from "./channel-video-pricing";
import { useUserStore } from "@/stores/use-user-store";

type UserChannelConnection = "openai" | "gemini";
type ChannelSettingsPaneProps = {
    onOpenModels: () => void;
    onOpenRunningHub?: () => void;
    onOpenComfyUI?: () => void;
};

export function ChannelSettingsPane({ onOpenModels, onOpenRunningHub, onOpenComfyUI }: ChannelSettingsPaneProps) {
    const { message } = App.useApp();
    const config = useConfigStore((state) => state.config);
    const replaceConfig = useConfigStore((state) => state.replaceConfig);
    const [loadingChannelIds, setLoadingChannelIds] = useState<string[]>([]);
    const [collapsedChannelIds, setCollapsedChannelIds] = useState<Set<string>>(new Set());
    const [providerCatalog, setProviderCatalog] = useState<ModelProtocolDefinition[]>([]);
    const desktopLocalChannelsEnabled = useUserStore((state) => state.features.desktopLocalChannelsEnabled);
    const desktopLocalChannelHostname = typeof window === "undefined" ? "" : window.location.hostname;
    const userChannels = config.channels.filter((channel) => channel.scope !== "system");
    const runningHubReady = Boolean(config.runningHub.enabled && config.runningHub.baseUrl.trim() && config.runningHub.apiKey.trim() && config.runningHub.workflowId.trim());
    const comfyBridgeReady = Boolean(config.comfyBridge.enabled && config.comfyBridge.bridgeId.trim() && config.comfyBridge.workflowId.trim());

    useEffect(() => {
        void fetchPluginProviderCatalog("user.custom-channel").then(setProviderCatalog).catch(() => setProviderCatalog([]));
    }, []);

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

    const updateChannelConnection = (channel: ModelChannel, connection: UserChannelConnection) => {
        const apiFormat = connection;
        const defaultBaseUrl = defaultBaseUrlForApiFormat(apiFormat);
        const baseUrl = isKnownDefaultBaseUrl(channel.baseUrl) ? defaultBaseUrl : channel.baseUrl;
        // 渠道只负责连接类型；具体模型能力和请求协议由下方共享能力卡片维护。
        updateChannel(channel.id, { apiFormat, interfaceType: undefined, baseUrl });
    };

    const updateChannelProvider = (channel: ModelChannel, providerId: string) => {
        const provider = providerCatalog.find((item) => item.value === providerId);
        if (!provider) return;
        const workflows = provider.workflows || [];
        const models = workflows.length ? workflows.map((workflow) => workflow.id) : channel.models;
        const modelCosts = workflows.length
            ? workflows.map((workflow) => ({
                  model: workflow.id,
                  displayName: workflow.label,
                  capability: workflow.capability,
                  protocol: provider.value,
                  billingMode: "fixed_request" as const,
                  unitPriceMicrocredits: 0,
                  capabilityConfig: pluginWorkflowCapabilityConfig(provider.value, workflow),
                  defaultOptions: workflow.defaults,
              }))
            : channel.modelCosts;
        updateChannel(channel.id, {
            interfaceType: provider.value,
            apiFormat: provider.value.startsWith("gemini") ? "gemini" : "openai",
            baseUrl: provider.baseUrl || channel.baseUrl,
            models,
            modelCosts,
        });
        message.success(workflows.length ? `已载入 ${workflows.length} 个工作流` : `${provider.label} 已应用到当前渠道`);
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
            const projectedChannel = { ...channel, allowLocalChannel: userLocalChannelFormOwner(desktopLocalChannelsEnabled, desktopLocalChannelHostname, channel.allowLocalChannel).payloadValue };
            const result = await fetchChannelModels(projectedChannel, true);
            if (!result.models.length) {
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
                latestConfig.channels.map((item) => (item.id === channel.id ? { ...item, models: result.models, modelCosts: mergeFetchedChannelModelCosts(item, result.catalog) } : item)),
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
            message.error(detail || "没有可拉取的个人模型渠道，请先填写有效 Base URL 和 API Key");
            return;
        }
        setChannelLoading("all", true);
        try {
            const results = await Promise.all(
                runnable.map(async (channel) => {
                    try {
                        const projectedChannel = { ...channel, allowLocalChannel: userLocalChannelFormOwner(desktopLocalChannelsEnabled, desktopLocalChannelHostname, channel.allowLocalChannel).payloadValue };
                        const result = await fetchChannelModels(projectedChannel, true);
                        return { channel, result, error: "" };
                    } catch (error) {
                        return { channel, result: { models: [], catalog: [] }, error: error instanceof Error ? error.message : "读取失败" };
                    }
                }),
            );
            const latestConfig = useConfigStore.getState().config;
            const successful = results.filter((item) => {
                const latestChannel = latestConfig.channels.find((channel) => channel.id === item.channel.id);
                return Boolean(item.result.models.length && latestChannel && channelConnectionSignature(latestChannel) === channelConnectionSignature(item.channel));
            });
            const stale = results.filter((item) => {
                const latestChannel = latestConfig.channels.find((channel) => channel.id === item.channel.id);
                return Boolean(item.result.models.length && (!latestChannel || channelConnectionSignature(latestChannel) !== channelConnectionSignature(item.channel)));
            });
            const failed = results.filter((item) => !item.result.models.length);
            if (successful.length) {
                const resultMap = new Map(successful.map((item) => [item.channel.id, item.result] as const));
                updateChannels(
                    latestConfig.channels.map((channel) => {
                        const fetched = resultMap.get(channel.id);
                        return fetched ? { ...channel, models: fetched.models, modelCosts: mergeFetchedChannelModelCosts(channel, fetched.catalog) } : channel;
                    }),
                    latestConfig,
                );
                message.success(`已更新 ${successful.length} 个渠道的模型`);
            }
            const warnings = [
                ...failed.map((item) => `${item.channel.name || "未命名渠道"}：${item.error || "未返回模型"}`),
                ...stale.map((item) => `${item.channel.name || "未命名渠道"}：连接配置已改变，已忽略旧结果`),
                ...skipped.map((channel) => `${channel.name || "未命名渠道"}：${channelConnectionError(channel)}`),
            ];
            if (warnings.length) message.warning(`${warnings.join("；")}。未更新的渠道已保留原有模型列表`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "批量读取模型失败，原有模型列表未改动");
        } finally {
            setChannelLoading("all", false);
        }
    };

    return (
        <Form layout="vertical" requiredMark={false}>
            <div className="settings-pane-header">
                <div className="min-w-0">
                    <h2>个人渠道</h2>
                    <p>管理个人模型服务和工作流渠道。普通渠道只保存连接类型；模型能力在“模型与能力”中配置。<Button type="link" size="small" className="h-auto p-0 text-xs font-semibold" onClick={onOpenModels}>打开模型选择</Button></p>
                </div>
                <div className="flex w-full gap-2 sm:w-auto sm:shrink-0">
                    <Button className="h-10 flex-1 sm:h-8 sm:flex-none" icon={<RefreshCw className="size-4" />} loading={loadingChannelIds.includes("all")} disabled={loadingChannelIds.some((id) => id !== "all")} onClick={() => void refreshAllModels()}>拉取全部</Button>
                    <Button className="h-10 flex-1 sm:h-8 sm:flex-none" type="primary" icon={<Plus className="size-4" />} onClick={addChannel}>新增渠道</Button>
                </div>
            </div>
            {onOpenRunningHub || onOpenComfyUI ? <section className="settings-section mb-3">
                <div className="mb-3">
                    <h3 className="text-sm font-semibold">个人工作流渠道</h3>
                    <p className="mt-1 text-xs text-foreground/55">RunningHub 和 ComfyUI 使用各自的工作流参数与执行通道，配置入口统一放在个人渠道中。</p>
                </div>
                <div className="grid gap-2 lg:grid-cols-2">
                    {onOpenRunningHub ? (
                        <WorkflowChannelEntry
                            icon={<Workflow className="size-4" />}
                            title="RunningHub"
                            description="云端工作流和 RunningHub App"
                            status={runningHubReady ? `${config.runningHub.workflows.length} 个工作流已配置` : config.runningHub.enabled ? "待完成连接和工作流配置" : "未启用"}
                            ready={runningHubReady}
                            onOpen={onOpenRunningHub}
                        />
                    ) : null}
                    {onOpenComfyUI ? (
                        <WorkflowChannelEntry
                            icon={<MonitorUp className="size-4" />}
                            title="ComfyUI"
                            description="通过 Bridge 连接本机或远程 ComfyUI"
                            status={comfyBridgeReady ? `${config.comfyBridge.workflows.length} 个工作流已配置` : config.comfyBridge.enabled ? "待选择 Bridge 和工作流" : "未启用"}
                            ready={comfyBridgeReady}
                            onOpen={onOpenComfyUI}
                        />
                    ) : null}
                </div>
            </section> : null}
            {userChannels.length ? (
                <div className="settings-channel-list space-y-2">
                    {userChannels.map((channel) => {
                        const collapsed = collapsedChannelIds.has(channel.id);
                        return (
                            <section key={channel.id} aria-labelledby={`channel-${channel.id}-title`} className="settings-channel p-2.5 sm:p-3">
                                <div className="mb-2.5 flex flex-wrap items-start justify-between gap-2.5">
                                    <div className="min-w-0 flex-1 basis-52">
                                        <h3 id={`channel-${channel.id}-title`} className="truncate text-sm font-semibold">{channel.name || "未命名渠道"}</h3>
                                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-foreground/55">
                                            {channelProtocolLabel(channel)} · 已保存 {channel.models.length} 个模型
                                            <ChannelStatus channel={channel} />
                                        </div>
                                    </div>
                                    <div className="flex w-full justify-end gap-2 sm:w-auto sm:shrink-0">
                                        <Button className="h-10 sm:h-8" size="small" icon={<RefreshCw className="size-3.5" />} loading={loadingChannelIds.includes(channel.id)} disabled={loadingChannelIds.includes("all")} onClick={() => void refreshChannelModels(channel)}>拉取模型</Button>
                                        <Tooltip title={collapsed ? "展开渠道配置" : "收起渠道配置"}>
                                            <Button className="size-10 p-0 sm:size-8" size="small" type="text" aria-label={`${collapsed ? "展开" : "收起"}渠道配置 ${channel.name || "未命名渠道"}`} aria-expanded={!collapsed} aria-controls={`channel-${channel.id}-details`} icon={collapsed ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />} onClick={() => toggleChannelCollapsed(channel.id)} />
                                        </Tooltip>
                                        <Popconfirm title="删除个人模型渠道？" description="该渠道关联的模型选择会同时移除。" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => deleteChannel(channel.id)}>
                                            <Tooltip title="删除渠道"><Button className="size-10 p-0 sm:size-8" aria-label={`删除渠道 ${channel.name || "未命名渠道"}`} size="small" type="text" danger disabled={loadingChannelIds.includes(channel.id) || loadingChannelIds.includes("all")} icon={<Trash2 className="size-3.5" />} /></Tooltip>
                                        </Popconfirm>
                                    </div>
                                </div>
                                <div id={`channel-${channel.id}-details`} hidden={collapsed}>
                                    <div className="grid gap-x-3 gap-y-2 lg:grid-cols-12">
                                        <div className="settings-field-group-label lg:col-span-12">连接信息</div>
                                        <Form.Item label="渠道名称" htmlFor={`channel-${channel.id}-name`} className="mb-0 lg:col-span-3"><Input id={`channel-${channel.id}-name`} value={channel.name} placeholder="例如：我的 NewAPI" onChange={(event) => updateChannel(channel.id, { name: event.target.value })} onBlur={(event) => updateChannel(channel.id, { name: event.target.value.trim() || "未命名渠道" })} /></Form.Item>
                                        <Form.Item label="插件 Provider" className="mb-0 lg:col-span-4" extra="Provider 会带入 Base URL、鉴权和工作流；无需手工选择请求协议。">
                                            <Select showSearch optionFilterProp="label" value={channel.interfaceType || undefined} placeholder="选择已安装插件 Provider" options={providerCatalog.map((provider) => ({ value: provider.value, label: `${provider.label} · ${provider.capability}` }))} onChange={(value) => updateChannelProvider(channel, value)} />
                                        </Form.Item>
                                        <Form.Item label="目录连接类型" className="mb-0 lg:col-span-2" extra="仅影响模型目录拉取。"><Segmented<UserChannelConnection> block value={channelConnectionMode(channel)} options={[{ label: "OpenAI", value: "openai" }, { label: "Gemini", value: "gemini" }]} onChange={(value) => updateChannelConnection(channel, value)} /></Form.Item>
                                        <UserLocalChannelFields
                                            channel={channel}
                                            visible={userLocalChannelFormOwner(desktopLocalChannelsEnabled, desktopLocalChannelHostname, channel.allowLocalChannel).visible}
                                            checked={userLocalChannelFormOwner(desktopLocalChannelsEnabled, desktopLocalChannelHostname, channel.allowLocalChannel).checked}
                                            desktopLocalChannelsEnabled={desktopLocalChannelsEnabled}
                                            hostname={desktopLocalChannelHostname}
                                            updateChannel={updateChannel}
                                        />
                                        <Form.Item label="API Key" htmlFor={`channel-${channel.id}-api-key`} className="mb-0 lg:col-span-5"><Input.Password id={`channel-${channel.id}-api-key`} autoComplete="new-password" value={channel.apiKey} placeholder={channel.apiFormat === "gemini" ? "填写 Gemini API Key" : "填写当前渠道 API Key"} onChange={(event) => updateChannel(channel.id, { apiKey: event.target.value })} onBlur={(event) => updateChannel(channel.id, { apiKey: event.target.value.trim() })} /></Form.Item>
                                        <Form.Item label="Secret Key（可选）" htmlFor={`channel-${channel.id}-secret-key`} className="mb-0 lg:col-span-5" extra="即梦等 AK/SK 协议需要；其他协议留空。"><Input.Password id={`channel-${channel.id}-secret-key`} autoComplete="new-password" value={channel.secretKey || ""} placeholder="填写 Secret Key" onChange={(event) => updateChannel(channel.id, { secretKey: event.target.value })} onBlur={(event) => updateChannel(channel.id, { secretKey: event.target.value.trim() })} /></Form.Item>
                                        <div className="settings-field-group-label lg:col-span-12">模型与能力</div>
                                        <Form.Item label="模型列表" htmlFor={`channel-${channel.id}-models`} className="mb-0 lg:col-span-7"><Select id={`channel-${channel.id}-models`} mode="tags" showSearch allowClear maxTagCount="responsive" tokenSeparators={[",", "\n"]} placeholder="输入模型名，或点击拉取模型" value={channel.models} onChange={(models) => updateChannel(channel.id, { models: uniqueModels(models) })} /></Form.Item>
                                        <div className="lg:col-span-12"><ChannelHeadersEditor value={channel.headers} onChange={(headers) => updateChannel(channel.id, { headers })} /></div>
                                    </div>
                                    <ChannelModelSettings channel={channel} onChange={(modelCosts) => updateChannel(channel.id, { modelCosts })} />
                                </div>
                            </section>
                        );
                    })}
                </div>
            ) : <WorkspaceState icon="settings" compact title="当前没有个人模型渠道" description="管理员配置的系统渠道会出现在模型选择中；也可以添加自己的模型服务。" action={<Button icon={<Plus className="size-4" />} onClick={addChannel}>新增个人模型渠道</Button>} />}
        </Form>
    );
}

function WorkflowChannelEntry({ icon, title, description, status, ready, onOpen }: { icon: ReactNode; title: string; description: string; status: string; ready: boolean; onOpen?: () => void }) {
    return (
        <div className="settings-channel flex min-w-0 items-center justify-between gap-3 p-3">
            <div className="flex min-w-0 items-start gap-2.5">
                <span className="mt-0.5 shrink-0 text-[var(--workspace-accent)]" aria-hidden="true">{icon}</span>
                <div className="min-w-0">
                    <h4 className="text-sm font-semibold">{title}</h4>
                    <p className="mt-0.5 truncate text-xs text-foreground/55">{description}</p>
                    <span className={`settings-channel-status mt-1.5 ${ready ? "is-ready" : "is-warning"}`}><i aria-hidden="true" />{status}</span>
                </div>
            </div>
            <Button size="small" onClick={onOpen} disabled={!onOpen}>配置</Button>
        </div>
    );
}

export function userLocalChannelFormOwner(desktopLocalChannelsEnabled: boolean, hostname: string, requestedAllowLocalChannel?: boolean) {
    const state = desktopLocalChannelFormState(desktopLocalChannelsEnabled, hostname, requestedAllowLocalChannel);
    return { ...state, payloadValue: desktopLocalChannelPayloadValue(desktopLocalChannelsEnabled, hostname, requestedAllowLocalChannel) };
}

export function UserLocalChannelSwitch({ visible, checked, onChange }: { visible: boolean; checked: boolean; onChange: (checked: boolean) => void }) {
    if (!visible) return null;
    return (
        <Form.Item label="允许本机渠道" className="mb-0 lg:col-span-12" extra={`仅放行精确 localhost 或 127.0.0.1；示例：${DESKTOP_LOCAL_CHANNEL_EXAMPLE_BASE_URL}`}>
            <Switch checked={checked} onChange={onChange} />
        </Form.Item>
    );
}

export function UserLocalChannelFields({ channel, visible, checked, desktopLocalChannelsEnabled, hostname, updateChannel }: { channel: ModelChannel; visible: boolean; checked: boolean; desktopLocalChannelsEnabled: boolean; hostname: string; updateChannel: (id: string, patch: Partial<ModelChannel>) => void }) {
    return (
        <>
            <Form.Item label="Base URL" htmlFor={`channel-${channel.id}-base-url`} className="mb-0 lg:col-span-6">
                <Input id={`channel-${channel.id}-base-url`} inputMode="url" value={channel.baseUrl} placeholder={checked ? DESKTOP_LOCAL_CHANNEL_EXAMPLE_BASE_URL : "填写渠道 Base URL"} onChange={(event) => updateChannel(channel.id, { baseUrl: event.target.value })} onBlur={(event) => updateChannel(channel.id, { baseUrl: event.target.value.trim().replace(/\/+$/, "") })} />
            </Form.Item>
            <UserLocalChannelSwitch visible={visible} checked={checked} onChange={(value) => updateChannel(channel.id, userLocalChannelChangePatch(desktopLocalChannelsEnabled, hostname, value))} />
        </>
    );
}

export function userLocalChannelChangePatch(desktopLocalChannelsEnabled: boolean, hostname: string, checked: boolean) {
    return { allowLocalChannel: userLocalChannelFormOwner(desktopLocalChannelsEnabled, hostname, checked).payloadValue };
}

export function channelValidationError(channel: ModelChannel) {
    return channelConnectionError(channel) || validateChannelHeaders(channel.headers) || (!channel.models.length ? "请添加至少一个模型" : "");
}

export function isChannelReady(channel: ModelChannel) {
    return !channelValidationError(channel);
}

export function focusInvalidChannelField(channel: ModelChannel) {
    const baseUrlError = channelConnectionError({ ...channel, apiKey: "valid", secretKey: "valid" });
    const field = baseUrlError ? "base-url" : !channel.apiKey.trim() ? "api-key" : requiresSecretKey(channel) && !channel.secretKey?.trim() ? "secret-key" : "models";
    requestAnimationFrame(() => {
        const element = document.getElementById(`channel-${channel.id}-${field}`);
        element?.scrollIntoView({ behavior: "smooth", block: "center" });
        element?.focus({ preventScroll: true });
    });
}

function ChannelStatus({ channel }: { channel: ModelChannel }) {
    const error = channelValidationError(channel);
    return (
        <span className={`settings-channel-status ${error ? "is-warning" : "is-ready"}`}>
            <i aria-hidden="true" />
            {error || "可用"}
        </span>
    );
}

function withChannels(config: AiConfig, channels: ModelChannel[]): AiConfig {
    const models = modelOptionsFromChannels(channels);
    const imageModels = filterModelsByCapability(models, "image", channels);
    const videoModels = filterModelsByCapability(models, "video", channels);
    const textModels = filterModelsByCapability(models, "text", channels);
    const audioModels = filterModelsByCapability(models, "audio", channels);
    return { ...config, channels, models, baseUrl: channels[0]?.baseUrl || config.baseUrl, apiKey: channels[0]?.apiKey || config.apiKey, apiFormat: channels[0]?.apiFormat || config.apiFormat, imageModels, videoModels, textModels, audioModels, imageModel: normalizeDefaultModel(config.imageModel, imageModels), videoModel: normalizeDefaultModel(config.videoModel, videoModels), textModel: normalizeDefaultModel(config.textModel, textModels), audioModel: normalizeDefaultModel(config.audioModel, audioModels) };
}

function normalizeDefaultModel(value: string, options: string[]) {
    return options.includes(value) ? value : options[0] || "";
}

function uniqueModels(models: string[]) {
    return Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)));
}

function channelModelFetchErrorMessage(error: unknown) {
    const detail = error instanceof Error ? error.message : "读取模型失败";
    if (detail.includes("不允许访问本机") || detail.includes("不允许访问保留地址")) return `${detail}；可信私网服务需由部署管理员配置 CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS`;
    return `${detail}；也可以直接在模型列表中手动输入模型名`;
}

function channelConnectionMode(channel: ModelChannel): UserChannelConnection {
    return channel.apiFormat === "gemini" ? "gemini" : "openai";
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
    if (!channel.apiKey.trim()) return "请填写 API Key / Access Key";
    if (requiresSecretKey(channel) && !channel.secretKey?.trim()) return "当前协议需要填写 Secret Key";
    return "";
}

function channelConnectionSignature(channel: ModelChannel) {
    return [channel.baseUrl.trim(), channel.apiKey.trim(), channel.secretKey?.trim() || "", channel.apiFormat, channel.interfaceType || "auto", channel.allowLocalChannel === true ? "local" : "remote", JSON.stringify(channel.headers || [])].join("\n");
}

function channelProtocolLabel(channel: ModelChannel) {
    return channelConnectionMode(channel) === "gemini" ? "Gemini 原生" : "OpenAI 兼容";
}

function isKnownDefaultBaseUrl(value: string) {
    const normalized = value.trim().replace(/\/+$/, "");
    if (!normalized) return true;
    return [defaultBaseUrlForApiFormat("openai"), defaultBaseUrlForApiFormat("gemini")].some((candidate) => candidate.replace(/\/+$/, "") === normalized);
}

function requiresSecretKey(channel: ModelChannel) {
    return channel.interfaceType?.startsWith("volcengine-jimeng-") === true || channel.modelCosts?.some((item) => item.protocol?.startsWith("volcengine-jimeng-")) === true;
}
