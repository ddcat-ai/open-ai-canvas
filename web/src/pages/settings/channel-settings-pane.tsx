import { App, Button, Form, Input, Popconfirm, Segmented, Select, Switch, Tooltip } from "antd";
import { ChevronDown, ChevronUp, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";

import { ChannelHeadersEditor, validateChannelHeaders } from "@/components/channel-headers-editor";
import { WorkspaceState } from "@/components/layout/workspace-state";
import { mergeFetchedChannelModelCosts } from "@/lib/channel-model-catalog";
import { desktopLocalChannelFormState, desktopLocalChannelPayloadValue, DESKTOP_LOCAL_CHANNEL_EXAMPLE_BASE_URL } from "@/lib/desktop-local-channel";
import { fetchChannelModels } from "@/services/api/image";
import { createModelChannel, defaultBaseUrlForApiFormat, filterModelsByCapability, modelOptionsFromChannels, useConfigStore, type AiConfig, type ModelChannel } from "@/stores/use-config-store";
import { ChannelModelSettings } from "./channel-video-pricing";
import { useUserStore } from "@/stores/use-user-store";
import { useTranslation } from "react-i18next";
import { t as translate } from "@/i18n";

type UserChannelConnection = "openai" | "gemini";
export function ChannelSettingsPane({ onOpenModels }: { onOpenModels: () => void }) {
    const { t } = useTranslation("canvas");
    const { message } = App.useApp();
    const config = useConfigStore((state) => state.config);
    const replaceConfig = useConfigStore((state) => state.replaceConfig);
    const [loadingChannelIds, setLoadingChannelIds] = useState<string[]>([]);
    const [collapsedChannelIds, setCollapsedChannelIds] = useState<Set<string>>(new Set());
    const desktopLocalChannelsEnabled = useUserStore((state) => state.features.desktopLocalChannelsEnabled);
    const desktopLocalChannelHostname = typeof window === "undefined" ? "" : window.location.hostname;
    const userChannels = config.channels.filter((channel) => channel.scope !== "system");

    const updateChannels = (channels: ModelChannel[], baseConfig = config) => {
        replaceConfig(withChannels(baseConfig, channels));
    };

    const updateChannel = (id: string, patch: Partial<ModelChannel>) => {
        updateChannels(
            config.channels.map((channel) => {
                if (channel.id !== id) return channel;
                const models = patch.models ? uniqueModels(patch.models) : channel.models;
                return {
                    ...channel,
                    ...patch,
                    models,
                    modelCosts: patch.modelCosts !== undefined ? patch.modelCosts : patch.models ? channel.modelCosts?.filter((item) => models.includes(item.model)) : channel.modelCosts,
                };
            }),
        );
    };

    const updateChannelConnection = (channel: ModelChannel, connection: UserChannelConnection) => {
        const apiFormat = connection;
        const defaultBaseUrl = defaultBaseUrlForApiFormat(apiFormat);
        const baseUrl = isKnownDefaultBaseUrl(channel.baseUrl) ? defaultBaseUrl : channel.baseUrl;
        // 渠道只负责连接类型；具体模型能力和请求协议由下方共享能力卡片维护。
        updateChannel(channel.id, { apiFormat, interfaceType: undefined, baseUrl });
    };

    const addChannel = () => {
        const channel = createModelChannel({ name: `渠道 ${userChannels.length + 1}` });
        updateChannels([...config.channels, channel]);
        requestAnimationFrame(() => document.getElementById(`channel-${channel.id}-name`)?.focus());
    };

    const deleteChannel = (id: string) => {
        const channel = config.channels.find((item) => item.id === id);
        if (channel?.scope === "system") {
            message.warning(t("settings:system-channels-are-maintained-by-admins"));
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
            message.error(`${channel.name || t("settings:current-channel")}：${connectionError}`);
            return;
        }
        setChannelLoading(channel.id, true);
        try {
            const projectedChannel = { ...channel, allowLocalChannel: userLocalChannelFormOwner(desktopLocalChannelsEnabled, desktopLocalChannelHostname, channel.allowLocalChannel).payloadValue };
            const result = await fetchChannelModels(projectedChannel, true);
            if (!result.models.length) {
                message.warning(`${channel.name || t("settings:current-channel")}未返回模型，已保留现有手工模型`);
                return;
            }
            const latestConfig = useConfigStore.getState().config;
            const latestChannel = latestConfig.channels.find((item) => item.id === channel.id);
            if (!latestChannel) return;
            if (channelConnectionSignature(latestChannel) !== channelConnectionSignature(channel)) {
                message.warning(`${latestChannel.name || t("settings:current-channel")}的连接配置已改变，已忽略旧的拉取结果`);
                return;
            }
            updateChannels(
                latestConfig.channels.map((item) => (item.id === channel.id ? { ...item, models: result.models, modelCosts: mergeFetchedChannelModelCosts(item, result.catalog) } : item)),
                latestConfig,
            );
            message.success(`${latestChannel.name || t("settings:current-channel")}模型列表已更新`);
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
            const detail = skipped.map((channel) => `${channel.name || t("settings:untitled-channel")}：${channelConnectionError(channel)}`).join("；");
            message.error(detail || t("settings:no-custom-channels-to-fetch-from-fill-in-a-valid-base-url-and-api-key-fi"));
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
                        return { channel, result: { models: [], catalog: [] }, error: error instanceof Error ? error.message : t("settings:failed-to-read") };
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
                message.success(t("settings:updated-models-for-param-channels", { length: successful.length }));
            }
            const warnings = [
                ...failed.map((item) => `${item.channel.name || t("settings:untitled-channel")}：${item.error || t("settings:no-models-returned")}`),
                ...stale.map((item) => `${item.channel.name || t("settings:untitled-channel")}：连接配置已改变，已忽略旧结果`),
                ...skipped.map((channel) => `${channel.name || t("settings:untitled-channel")}：${channelConnectionError(channel)}`),
            ];
            if (warnings.length) message.warning(`${warnings.join("；")}。未更新的渠道已保留原有模型列表`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("settings:batch-model-fetch-failed-the-existing-model-list-is-unchanged"));
        } finally {
            setChannelLoading("all", false);
        }
    };

    return (
        <Form layout="vertical" requiredMark={false}>
            <div className="settings-pane-header">
                <div className="min-w-0">
                    <h2>{t("settings:custom-channels")}</h2>
                    <p>
                        {t("settings:channels-only-store-the-connection-type-after-fetching-models-configure")}
                        <Button type="link" size="small" className="h-auto p-0 text-xs font-semibold" onClick={onOpenModels}>
                            {t("settings:open-model-selection")}
                        </Button>
                    </p>
                </div>
                <div className="flex w-full gap-2 sm:w-auto sm:shrink-0">
                    <Button className="h-10 flex-1 sm:h-8 sm:flex-none" icon={<RefreshCw className="size-4" />} loading={loadingChannelIds.includes("all")} disabled={loadingChannelIds.some((id) => id !== "all")} onClick={() => void refreshAllModels()}>
                        {t("settings:fetch-all")}
                    </Button>
                    <Button className="h-10 flex-1 sm:h-8 sm:flex-none" type="primary" icon={<Plus className="size-4" />} onClick={addChannel}>
                        {t("settings:add-channel")}
                    </Button>
                </div>
            </div>
            {userChannels.length ? (
                <div className="settings-channel-list space-y-2">
                    {userChannels.map((channel) => {
                        const collapsed = collapsedChannelIds.has(channel.id);
                        return (
                            <section key={channel.id} aria-labelledby={`channel-${channel.id}-title`} className="settings-channel p-2.5 sm:p-3">
                                <div className="mb-2.5 flex flex-wrap items-start justify-between gap-2.5">
                                    <div className="min-w-0 flex-1 basis-52">
                                        <h3 id={`channel-${channel.id}-title`} className="truncate text-sm font-semibold">
                                            {channel.name || t("settings:untitled-channel")}
                                        </h3>
                                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-foreground/55">
                                            {channelProtocolLabel(channel)} {t("settings:saved")} {channel.models.length} {t("settings:models-2")}
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
                                            {t("settings:fetch-models")}
                                        </Button>
                                        <Tooltip title={collapsed ? t("settings:expand-channel-config") : t("settings:collapse-channel-config")}>
                                            <Button
                                                className="size-10 p-0 sm:size-8"
                                                size="small"
                                                type="text"
                                                aria-label={`${collapsed ? t("settings:expand") : t("settings:collapse")}渠道配置 ${channel.name || t("settings:untitled-channel")}`}
                                                aria-expanded={!collapsed}
                                                aria-controls={`channel-${channel.id}-details`}
                                                icon={collapsed ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
                                                onClick={() => toggleChannelCollapsed(channel.id)}
                                            />
                                        </Tooltip>
                                        <Popconfirm
                                            title={t("settings:delete-this-custom-channel")}
                                            description={t("settings:model-selections-linked-to-this-channel-will-be-removed-too")}
                                            okText={t("settings:delete")}
                                            cancelText={t("settings:cancel")}
                                            okButtonProps={{ danger: true }}
                                            onConfirm={() => deleteChannel(channel.id)}
                                        >
                                            <Tooltip title={t("settings:delete-channel")}>
                                                <Button
                                                    className="size-10 p-0 sm:size-8"
                                                    aria-label={`删除渠道 ${channel.name || t("settings:untitled-channel")}`}
                                                    size="small"
                                                    type="text"
                                                    danger
                                                    disabled={loadingChannelIds.includes(channel.id) || loadingChannelIds.includes("all")}
                                                    icon={<Trash2 className="size-3.5" />}
                                                />
                                            </Tooltip>
                                        </Popconfirm>
                                    </div>
                                </div>
                                <div id={`channel-${channel.id}-details`} hidden={collapsed}>
                                    <div className="grid gap-x-3 gap-y-2 lg:grid-cols-12">
                                        <div className="settings-field-group-label lg:col-span-12">{t("settings:connection-details")}</div>
                                        <Form.Item label={t("settings:channel-name")} htmlFor={`channel-${channel.id}-name`} className="mb-0 lg:col-span-3">
                                            <Input
                                                id={`channel-${channel.id}-name`}
                                                value={channel.name}
                                                placeholder={t("settings:e-g-my-newapi")}
                                                onChange={(event) => updateChannel(channel.id, { name: event.target.value })}
                                                onBlur={(event) => updateChannel(channel.id, { name: event.target.value.trim() || t("settings:untitled-channel") })}
                                            />
                                        </Form.Item>
                                        <Form.Item label={t("settings:channel-connection-type")} className="mb-0 lg:col-span-3" extra={t("settings:only-used-to-fetch-the-model-catalog-model-capabilities-and-request-prot")}>
                                            <Segmented<UserChannelConnection>
                                                block
                                                value={channelConnectionMode(channel)}
                                                options={[
                                                    { label: t("settings:openai-compatible"), value: "openai" },
                                                    { label: t("settings:gemini-native"), value: "gemini" },
                                                ]}
                                                onChange={(value) => updateChannelConnection(channel, value)}
                                            />
                                        </Form.Item>
                                        <UserLocalChannelFields
                                            channel={channel}
                                            visible={userLocalChannelFormOwner(desktopLocalChannelsEnabled, desktopLocalChannelHostname, channel.allowLocalChannel).visible}
                                            checked={userLocalChannelFormOwner(desktopLocalChannelsEnabled, desktopLocalChannelHostname, channel.allowLocalChannel).checked}
                                            desktopLocalChannelsEnabled={desktopLocalChannelsEnabled}
                                            hostname={desktopLocalChannelHostname}
                                            updateChannel={updateChannel}
                                        />
                                        <Form.Item label="API Key" htmlFor={`channel-${channel.id}-api-key`} className="mb-0 lg:col-span-5">
                                            <Input.Password
                                                id={`channel-${channel.id}-api-key`}
                                                autoComplete="new-password"
                                                value={channel.apiKey}
                                                placeholder={channel.apiFormat === "gemini" ? t("settings:enter-your-gemini-api-key") : t("settings:enter-the-api-key-for-this-channel")}
                                                onChange={(event) => updateChannel(channel.id, { apiKey: event.target.value })}
                                                onBlur={(event) => updateChannel(channel.id, { apiKey: event.target.value.trim() })}
                                            />
                                        </Form.Item>
                                        <Form.Item
                                            label={t("settings:secret-key-optional")}
                                            htmlFor={`channel-${channel.id}-secret-key`}
                                            className="mb-0 lg:col-span-5"
                                            extra={t("settings:required-for-ak-sk-protocols-like-dreamina-leave-empty-for-others")}
                                        >
                                            <Input.Password
                                                id={`channel-${channel.id}-secret-key`}
                                                autoComplete="new-password"
                                                value={channel.secretKey || ""}
                                                placeholder={t("settings:enter-your-secret-key")}
                                                onChange={(event) => updateChannel(channel.id, { secretKey: event.target.value })}
                                                onBlur={(event) => updateChannel(channel.id, { secretKey: event.target.value.trim() })}
                                            />
                                        </Form.Item>
                                        <div className="settings-field-group-label lg:col-span-12">{t("settings:models-and-capabilities")}</div>
                                        <Form.Item label={t("settings:model-list")} htmlFor={`channel-${channel.id}-models`} className="mb-0 lg:col-span-7">
                                            <Select
                                                id={`channel-${channel.id}-models`}
                                                mode="tags"
                                                showSearch
                                                allowClear
                                                maxTagCount="responsive"
                                                tokenSeparators={[",", "\n"]}
                                                placeholder={t("settings:type-a-model-name-or-fetch-models")}
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
                        );
                    })}
                </div>
            ) : (
                <WorkspaceState
                    icon="settings"
                    compact
                    title={t("settings:no-custom-channels-yet")}
                    description={t("settings:admin-configured-system-channels-appear-in-model-selection-you-can-also")}
                    action={
                        <Button icon={<Plus className="size-4" />} onClick={addChannel}>
                            {t("settings:add-custom-channel")}
                        </Button>
                    }
                />
            )}
        </Form>
    );
}

export function userLocalChannelFormOwner(desktopLocalChannelsEnabled: boolean, hostname: string, requestedAllowLocalChannel?: boolean) {
    const state = desktopLocalChannelFormState(desktopLocalChannelsEnabled, hostname, requestedAllowLocalChannel);
    return { ...state, payloadValue: desktopLocalChannelPayloadValue(desktopLocalChannelsEnabled, hostname, requestedAllowLocalChannel) };
}

export function UserLocalChannelSwitch({ visible, checked, onChange }: { visible: boolean; checked: boolean; onChange: (checked: boolean) => void }) {
    const { t } = useTranslation("canvas");
    if (!visible) return null;
    return (
        <Form.Item
            label={t("settings:allow-local-channels")}
            className="mb-0 lg:col-span-12"
            extra={t("settings:only-exact-localhost-or-127-0-0-1-is-allowed-example-param", { DESKTOP_LOCAL_CHANNEL_EXAMPLE_BASE_URL: DESKTOP_LOCAL_CHANNEL_EXAMPLE_BASE_URL })}
        >
            <Switch checked={checked} onChange={onChange} />
        </Form.Item>
    );
}

export function UserLocalChannelFields({
    channel,
    visible,
    checked,
    desktopLocalChannelsEnabled,
    hostname,
    updateChannel,
}: {
    channel: ModelChannel;
    visible: boolean;
    checked: boolean;
    desktopLocalChannelsEnabled: boolean;
    hostname: string;
    updateChannel: (id: string, patch: Partial<ModelChannel>) => void;
}) {
    const { t } = useTranslation("canvas");
    return (
        <>
            <Form.Item label="Base URL" htmlFor={`channel-${channel.id}-base-url`} className="mb-0 lg:col-span-6">
                <Input
                    id={`channel-${channel.id}-base-url`}
                    inputMode="url"
                    value={channel.baseUrl}
                    placeholder={checked ? DESKTOP_LOCAL_CHANNEL_EXAMPLE_BASE_URL : t("settings:enter-the-channel-base-url")}
                    onChange={(event) => updateChannel(channel.id, { baseUrl: event.target.value })}
                    onBlur={(event) => updateChannel(channel.id, { baseUrl: event.target.value.trim().replace(/\/+$/, "") })}
                />
            </Form.Item>
            <UserLocalChannelSwitch visible={visible} checked={checked} onChange={(value) => updateChannel(channel.id, userLocalChannelChangePatch(desktopLocalChannelsEnabled, hostname, value))} />
        </>
    );
}

export function userLocalChannelChangePatch(desktopLocalChannelsEnabled: boolean, hostname: string, checked: boolean) {
    return { allowLocalChannel: userLocalChannelFormOwner(desktopLocalChannelsEnabled, hostname, checked).payloadValue };
}

export function channelValidationError(channel: ModelChannel) {
    return channelConnectionError(channel) || validateChannelHeaders(channel.headers) || (!channel.models.length ? translate("settings:add-at-least-one-model") : "");
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
    const { t } = useTranslation("canvas");
    const error = channelValidationError(channel);
    return (
        <span className={`settings-channel-status ${error ? "is-warning" : "is-ready"}`}>
            <i aria-hidden="true" />
            {error || t("settings:available")}
        </span>
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
    return options.includes(value) ? value : options[0] || "";
}

function uniqueModels(models: string[]) {
    return Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)));
}

function channelModelFetchErrorMessage(error: unknown) {
    const detail = error instanceof Error ? error.message : translate("settings:failed-to-load-models");
    if (detail.includes(translate("settings:local-access-blocked")) || detail.includes(translate("settings:reserved-addresses-blocked")))
        return translate("settings:param-trusted-private-network-services-must-be-allowlisted-by-your-admin", { detail: detail });
    return translate("settings:param-you-can-also-type-model-names-directly-into-the-model-list", { detail: detail });
}

function channelConnectionMode(channel: ModelChannel): UserChannelConnection {
    return channel.apiFormat === "gemini" ? "gemini" : "openai";
}

function channelConnectionError(channel: ModelChannel) {
    const baseUrl = channel.baseUrl.trim();
    if (!baseUrl) return translate("settings:enter-a-base-url");
    try {
        const parsed = new URL(baseUrl);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return translate("settings:base-url-supports-http-or-https-only");
    } catch {
        return translate("settings:base-url-format-is-invalid");
    }
    if (!channel.apiKey.trim()) return translate("settings:enter-an-api-key-access-key");
    if (requiresSecretKey(channel) && !channel.secretKey?.trim()) return translate("settings:this-protocol-requires-a-secret-key");
    return "";
}

function channelConnectionSignature(channel: ModelChannel) {
    return [channel.baseUrl.trim(), channel.apiKey.trim(), channel.secretKey?.trim() || "", channel.apiFormat, channel.interfaceType || "auto", channel.allowLocalChannel === true ? "local" : "remote", JSON.stringify(channel.headers || [])].join("\n");
}

function channelProtocolLabel(channel: ModelChannel) {
    return channelConnectionMode(channel) === "gemini" ? translate("settings:gemini-native") : translate("settings:openai-compatible");
}

function isKnownDefaultBaseUrl(value: string) {
    const normalized = value.trim().replace(/\/+$/, "");
    if (!normalized) return true;
    return [defaultBaseUrlForApiFormat("openai"), defaultBaseUrlForApiFormat("gemini")].some((candidate) => candidate.replace(/\/+$/, "") === normalized);
}

function requiresSecretKey(channel: ModelChannel) {
    return channel.interfaceType?.startsWith("volcengine-jimeng-") === true || channel.modelCosts?.some((item) => item.protocol?.startsWith("volcengine-jimeng-")) === true;
}
