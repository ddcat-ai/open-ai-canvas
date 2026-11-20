import { App, Button, Form, Input, Popconfirm, Segmented } from "antd";
import { AntTooltip as Tooltip } from "@/components/ui/base/tooltip/ant-tooltip";
import { Pencil, Plus, RefreshCw, Trash2, Workflow } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { ModelEditorModal } from "@/components/model-editor-modal";
import { ChannelHeadersEditor, validateChannelHeaders } from "@/components/channel-headers-editor";
import { WorkspaceState } from "@/components/layout/workspace-state";
import { secretKeyProtocolIds, useUserProtocolCatalog } from "@/hooks/use-user-protocol-catalog";
import { translate } from "@/i18n";
import { mergeFetchedChannelModelCosts } from "@/lib/channel-model-catalog";
import { fetchChannelModels } from "@/services/api/image";
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
import { Select } from "@/components/ui/base/select";

type UserChannelConnection = "openai" | "gemini";
type ChannelSettingsPaneProps = {
    onOpenModels: () => void;
    onOpenRunningHub?: () => void;
};

export function ChannelSettingsPane({ onOpenModels, onOpenRunningHub }: ChannelSettingsPaneProps) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const protocolCatalog = useUserProtocolCatalog();
    const secretKeyProtocols = useMemo(() => secretKeyProtocolIds(protocolCatalog), [protocolCatalog]);
    const channelConnectionError = (channel: ModelChannel) => channelConnectionErrorFor(channel, secretKeyProtocols);
    const config = useConfigStore((state) => state.config);
    const replaceConfig = useConfigStore((state) => state.replaceConfig);
    const [loadingChannelIds, setLoadingChannelIds] = useState<string[]>([]);
    const [editingChannelId, setEditingChannelId] = useState<string | null>(null);
    const [newChannelId, setNewChannelId] = useState<string | null>(null);
    const userChannels = config.channels.filter((channel) => channel.scope !== "system");
    const runningHubReady = Boolean(config.runningHub.enabled && config.runningHub.baseUrl.trim() && config.runningHub.apiKey.trim() && config.runningHub.workflowId.trim());

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

    const addChannel = () => {
        const channel = createModelChannel({ name: t("account.settings.channels.defaultName", { index: userChannels.length + 1 }) });
        updateChannels([...config.channels, channel]);
        setNewChannelId(channel.id);
        setEditingChannelId(channel.id);
    };

    const closeChannelEditor = () => {
        setEditingChannelId(null);
        setNewChannelId(null);
    };

    const deleteChannel = (id: string) => {
        const channel = config.channels.find((item) => item.id === id);
        if (channel?.scope === "system") {
            message.warning(t("account.settings.channels.systemManaged"));
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
            message.error(t("account.settings.channelError", { name: channel.name || t("account.settings.channels.current"), error: connectionError }));
            return;
        }
        setChannelLoading(channel.id, true);
        try {
            const result = await fetchChannelModels(channel, true);
            if (!result.models.length) {
                message.warning(t("account.settings.channels.noModels", { name: channel.name || t("account.settings.channels.current") }));
                return;
            }
            const latestConfig = useConfigStore.getState().config;
            const latestChannel = latestConfig.channels.find((item) => item.id === channel.id);
            if (!latestChannel) return;
            if (channelConnectionSignature(latestChannel) !== channelConnectionSignature(channel)) {
                message.warning(t("account.settings.channels.changedIgnored", { name: latestChannel.name || t("account.settings.channels.current") }));
                return;
            }
            updateChannels(
                latestConfig.channels.map((item) => (item.id === channel.id ? { ...item, models: result.models, modelCosts: mergeFetchedChannelModelCosts(item, result.catalog) } : item)),
                latestConfig,
            );
            message.success(t("account.settings.channels.modelsUpdated", { name: latestChannel.name || t("account.settings.channels.current") }));
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
            const detail = skipped.map((channel) => t("account.settings.channelError", { name: channel.name || t("account.settings.channels.unnamed"), error: channelConnectionError(channel) })).join(t("account.settings.channels.separator"));
            message.error(detail || t("account.settings.channels.nothingToFetch"));
            return;
        }
        setChannelLoading("all", true);
        try {
            const results = await Promise.all(
                runnable.map(async (channel) => {
                    try {
                        const result = await fetchChannelModels(channel, true);
                        return { channel, result, error: "" };
                    } catch (error) {
                        return { channel, result: { models: [], catalog: [] }, error: error instanceof Error ? error.message : t("account.settings.channels.readFailed") };
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
                message.success(t("account.settings.channels.bulkUpdated", { count: successful.length }));
            }
            const warnings = [
                ...failed.map((item) => t("account.settings.channelError", { name: item.channel.name || t("account.settings.channels.unnamed"), error: item.error || t("account.settings.channels.noModelsReturned") })),
                ...stale.map((item) => t("account.settings.channelError", { name: item.channel.name || t("account.settings.channels.unnamed"), error: t("account.settings.channels.staleIgnored") })),
                ...skipped.map((channel) => t("account.settings.channelError", { name: channel.name || t("account.settings.channels.unnamed"), error: channelConnectionError(channel) })),
            ];
            if (warnings.length) message.warning(t("account.settings.channels.bulkWarnings", { warnings: warnings.join(t("account.settings.channels.separator")) }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("account.settings.channels.bulkFailed"));
        } finally {
            setChannelLoading("all", false);
        }
    };

    return (
        <Form layout="vertical" requiredMark={false}>
            <div className="settings-pane-header">
                <div className="min-w-0">
                    <h2>{t("settings.sections.channels.label")}</h2>
                    <p>{t("account.settings.channels.description")}<Button type="link" size="small" className="h-auto p-0 text-xs font-semibold" onClick={onOpenModels}>{t("account.layout.modelGuide.open")}</Button></p>
                </div>
                <div className="flex w-full gap-2 sm:w-auto sm:shrink-0">
                    <Button className="h-10 flex-1 sm:h-8 sm:flex-none" icon={<RefreshCw className="size-4" />} loading={loadingChannelIds.includes("all")} disabled={loadingChannelIds.some((id) => id !== "all")} onClick={() => void refreshAllModels()}>{t("account.settings.channels.fetchAll")}</Button>
                    <Button className="h-10 flex-1 sm:h-8 sm:flex-none" type="primary" icon={<Plus className="size-4" />} onClick={addChannel}>{t("account.settings.channels.add")}</Button>
                </div>
            </div>
            {onOpenRunningHub ? <section className="settings-section mb-3">
                <div className="mb-3">
                    <h3 className="text-sm font-semibold">{t("account.settings.channels.workflowTitle")}</h3>
                    <p className="mt-1 text-xs text-foreground/55">{t("account.settings.channels.workflowDescription")}</p>
                </div>
                <div className="grid gap-2 lg:grid-cols-2">
                    {onOpenRunningHub ? (
                        <WorkflowChannelEntry
                            icon={<Workflow className="size-4" />}
                            title="RunningHub"
                            description={t("account.settings.channels.runningHubDescription")}
                            status={runningHubReady ? t("account.settings.channels.workflowsConfigured", { count: config.runningHub.workflows.length }) : config.runningHub.enabled ? t("account.settings.channels.workflowPending") : t("account.settings.channels.disabled")}
                            ready={runningHubReady}
                            onOpen={onOpenRunningHub}
                        />
                    ) : null}
                </div>
            </section> : null}
            {userChannels.length ? (
                <div className="settings-channel-list space-y-2">
                    {userChannels.map((channel) => {
                        const editing = editingChannelId === channel.id;
                        return (
                            <section key={channel.id} aria-labelledby={`channel-${channel.id}-title`} className="settings-channel p-2 sm:p-3">
                                <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                                    <div className="min-w-0 flex-1 basis-52">
                                        <h3 id={`channel-${channel.id}-title`} className="truncate text-sm font-semibold">{channel.name || t("account.settings.channels.unnamed")}</h3>
                                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-foreground/55">
                                            {t("account.settings.channels.summary", { protocol: channelProtocolLabel(channel), count: channel.models.length })}
                                            <ChannelStatus channel={channel} secretKeyProtocols={secretKeyProtocols} />
                                        </div>
                                    </div>
                                    <div className="flex w-full justify-end gap-2 sm:w-auto sm:shrink-0">
                                        <Button className="h-10 sm:h-8" size="small" icon={<RefreshCw className="size-3.5" />} loading={loadingChannelIds.includes(channel.id)} disabled={loadingChannelIds.includes("all")} onClick={() => void refreshChannelModels(channel)}>{t("account.settings.channels.fetch")}</Button>
                                        <Button size="small" icon={<Pencil className="size-3.5" />} onClick={() => { setNewChannelId(null); setEditingChannelId(channel.id); }}>{t("account.settings.channels.edit")}</Button>
                                        <Popconfirm title={t("account.settings.channels.deleteTitle")} description={t("account.settings.channels.deleteDescription")} okText={t("common.delete")} cancelText={t("common.cancel")} okButtonProps={{ danger: true }} onConfirm={() => deleteChannel(channel.id)}>
                                            <Tooltip title={t("account.settings.channels.delete")}><Button className="size-10 p-0 sm:size-8" aria-label={t("account.settings.channels.deleteNamed", { name: channel.name || t("account.settings.channels.unnamed") })} size="small" type="text" danger disabled={loadingChannelIds.includes(channel.id) || loadingChannelIds.includes("all")} icon={<Trash2 className="size-3.5" />} /></Tooltip>
                                        </Popconfirm>
                                    </div>
                                </div>
                                {editing && (
                                    <ModelEditorModal
                                        open
                                        title={channel.id === newChannelId ? t("account.settings.channels.addCustom") : t("account.settings.channels.editCustom")}
                                        subtitle={channel.name}
                                        onClose={closeChannelEditor}
                                        footer={<div className="model-editor-footer">
                                            <span className="text-xs text-foreground/50">{t("account.settings.channels.autoSave")}</span>
                                            <div className="model-editor-footer-actions">
                                                <Button loading={loadingChannelIds.includes(channel.id)} onClick={() => void refreshChannelModels(channel)}>{t("account.settings.channels.fetch")}</Button>
                                                <Button type="primary" onClick={closeChannelEditor}>{t("account.payment.done")}</Button>
                                            </div>
                                        </div>}
                                    >
                                        <div className="model-editor-panel">
                                            <section className="model-editor-section">
                                                <div>
                                                    <h2>{t("account.settings.channels.connectionTitle")}</h2>
                                                    <p className="mt-1 text-xs text-foreground/50">{t("account.settings.channels.connectionDescription")}</p>
                                                </div>
                                                <div className="model-editor-connection-fields grid gap-3 sm:grid-cols-2">
                                                    <Form.Item label={t("account.settings.channels.name")} htmlFor={`channel-${channel.id}-name`} className="mb-0 sm:col-span-1"><Input id={`channel-${channel.id}-name`} value={channel.name} placeholder={t("account.settings.channels.namePlaceholder")} onChange={(event) => updateChannel(channel.id, { name: event.target.value })} onBlur={(event) => updateChannel(channel.id, { name: event.target.value.trim() || t("account.settings.channels.unnamed") })} /></Form.Item>
                                                    <Form.Item label={t("account.settings.channels.connectionType")} className="mb-0 sm:col-span-1" extra={t("account.settings.channels.connectionTypeHint")}><Segmented<UserChannelConnection> block value={channelConnectionMode(channel)} options={[{ label: "OpenAI", value: "openai" }, { label: "Gemini", value: "gemini" }]} onChange={(value) => updateChannelConnection(channel, value)} /></Form.Item>
                                                    <Form.Item label="Base URL" htmlFor={`channel-${channel.id}-base-url`} className="mb-0 sm:col-span-1"><Input id={`channel-${channel.id}-base-url`} inputMode="url" value={channel.baseUrl} placeholder={t("account.settings.channels.baseUrlPlaceholder")} onChange={(event) => updateChannel(channel.id, { baseUrl: event.target.value })} onBlur={(event) => updateChannel(channel.id, { baseUrl: event.target.value.trim().replace(/\/+$/u, "") })} /></Form.Item>
                                                    <Form.Item label="API Key" htmlFor={`channel-${channel.id}-api-key`} className="mb-0 sm:col-span-1"><Input.Password id={`channel-${channel.id}-api-key`} autoComplete="new-password" value={channel.apiKey} placeholder={channel.apiFormat === "gemini" ? t("account.settings.channels.geminiKeyPlaceholder") : t("account.settings.channels.apiKeyPlaceholder")} onChange={(event) => updateChannel(channel.id, { apiKey: event.target.value })} onBlur={(event) => updateChannel(channel.id, { apiKey: event.target.value.trim() })} /></Form.Item>
                                                    <Form.Item label={t("account.settings.channels.secretKey")} htmlFor={`channel-${channel.id}-secret-key`} className="mb-0 sm:col-span-1" extra={t("account.settings.channels.secretKeyHint")}><Input.Password id={`channel-${channel.id}-secret-key`} autoComplete="new-password" value={channel.secretKey || ""} placeholder={t("account.settings.channels.secretKeyPlaceholder")} onChange={(event) => updateChannel(channel.id, { secretKey: event.target.value })} onBlur={(event) => updateChannel(channel.id, { secretKey: event.target.value.trim() })} /></Form.Item>
                                                    <div className="sm:col-span-2"><ChannelHeadersEditor value={channel.headers} onChange={(headers) => updateChannel(channel.id, { headers })} /></div>
                                                </div>
                                            </section>
                                            <section className="model-editor-section">
                                                <div>
                                                    <h2>{t("account.settings.channels.modelsTitle")}</h2>
                                                    <p className="mt-1 text-xs text-foreground/50">{t("account.settings.channels.modelsDescription")}</p>
                                                </div>
                                                <Form.Item label={t("account.settings.channels.modelList")} htmlFor={`channel-${channel.id}-models`} className="mb-0"><Select id={`channel-${channel.id}-models`} mode="tags" showSearch allowClear maxTagCount="responsive" tokenSeparators={[",", "\n"]} placeholder={t("account.settings.channels.modelListPlaceholder")} value={channel.models} onChange={(models) => updateChannel(channel.id, { models: uniqueModels(models) })} /></Form.Item>
                                                <ChannelModelSettings channel={channel} onChange={(modelCosts) => updateChannel(channel.id, { modelCosts })} />
                                            </section>
                                        </div>
                                    </ModelEditorModal>
                                )}
                            </section>
                        );
                    })}
                </div>
            ) : <WorkspaceState icon="settings" compact title={t("account.settings.channels.emptyTitle")} description={t("account.settings.channels.emptyDescription")} action={<Button icon={<Plus className="size-4" />} onClick={addChannel}>{t("account.settings.channels.addPersonal")}</Button>} />}
        </Form>
    );
}

function WorkflowChannelEntry({ icon, title, description, status, ready, onOpen }: { icon: ReactNode; title: string; description: string; status: string; ready: boolean; onOpen?: () => void }) {
    const { t } = useTranslation();
    return (
        <div className="settings-channel flex min-w-0 items-center justify-between gap-3 p-3">
            <div className="flex min-w-0 items-start gap-2">
                <span className="mt-0.5 shrink-0 text-[var(--workspace-accent)]" aria-hidden="true">{icon}</span>
                <div className="min-w-0">
                    <h4 className="text-sm font-semibold">{title}</h4>
                    <p className="mt-0.5 truncate text-xs text-foreground/55">{description}</p>
                    <span className={`settings-channel-status mt-2 ${ready ? "is-ready" : "is-warning"}`}><i aria-hidden="true" />{status}</span>
                </div>
            </div>
            <Button size="small" onClick={onOpen} disabled={!onOpen}>{t("account.settings.channels.configure")}</Button>
        </div>
    );
}

// secretKeyProtocols 来自插件目录（见 secretKeyProtocolIds）：是否需要 Secret Key 只看插件 auth 声明。
export function channelValidationError(channel: ModelChannel, secretKeyProtocols: ReadonlySet<string>) {
    return channelConnectionErrorFor(channel, secretKeyProtocols) || validateChannelHeaders(channel.headers) || (!channel.models.length ? translate("account.settings.channels.needModel") : "");
}

export function isChannelReady(channel: ModelChannel, secretKeyProtocols: ReadonlySet<string>) {
    return !channelValidationError(channel, secretKeyProtocols);
}

export function focusInvalidChannelField(channel: ModelChannel, secretKeyProtocols: ReadonlySet<string>) {
    const baseUrlError = channelConnectionErrorFor({ ...channel, apiKey: "valid", secretKey: "valid" }, secretKeyProtocols);
    const field = baseUrlError ? "base-url" : !channel.apiKey.trim() ? "api-key" : requiresSecretKey(channel, secretKeyProtocols) && !channel.secretKey?.trim() ? "secret-key" : "models";
    requestAnimationFrame(() => {
        const element = document.getElementById(`channel-${channel.id}-${field}`);
        element?.scrollIntoView({ behavior: "smooth", block: "center" });
        element?.focus({ preventScroll: true });
    });
}

function ChannelStatus({ channel, secretKeyProtocols }: { channel: ModelChannel; secretKeyProtocols: ReadonlySet<string> }) {
    const { t } = useTranslation();
    const error = channelValidationError(channel, secretKeyProtocols);
    return (
        <span className={`settings-channel-status ${error ? "is-warning" : "is-ready"}`}>
            <i aria-hidden="true" />
            {error || t("account.settings.channels.ready")}
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
    const detail = error instanceof Error ? error.message : translate("account.settings.channels.fetchFailed");
    // 与后端 SSRF 拦截文案匹配，不随界面语言变化。
    if (detail.includes("不允许访问本机") || detail.includes("不允许访问保留地址")) return translate("account.settings.channels.privateHostHint", { detail });
    return translate("account.settings.channels.manualModelHint", { detail });
}

function channelConnectionMode(channel: ModelChannel): UserChannelConnection {
    return channel.apiFormat === "gemini" ? "gemini" : "openai";
}

function channelConnectionErrorFor(channel: ModelChannel, secretKeyProtocols: ReadonlySet<string>) {
    const baseUrl = channel.baseUrl.trim();
    if (!baseUrl) return translate("account.settings.channels.baseUrlRequired");
    try {
        const parsed = new URL(baseUrl);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return translate("account.settings.channels.baseUrlProtocol");
    } catch {
        return translate("account.settings.channels.baseUrlInvalid");
    }
    if (!channel.apiKey.trim()) return translate("account.settings.channels.apiKeyRequired");
    if (requiresSecretKey(channel, secretKeyProtocols) && !channel.secretKey?.trim()) return translate("account.settings.channels.secretKeyRequired");
    return "";
}

function channelConnectionSignature(channel: ModelChannel) {
    return [channel.baseUrl.trim(), channel.apiKey.trim(), channel.secretKey?.trim() || "", channel.apiFormat, JSON.stringify(channel.headers || [])].join("\n");
}

function channelProtocolLabel(channel: ModelChannel) {
    return channelConnectionMode(channel) === "gemini" ? translate("account.settings.channels.protocolGemini") : translate("account.settings.channels.protocolOpenAI");
}

function isKnownDefaultBaseUrl(value: string) {
    const normalized = value.trim().replace(/\/+$/, "");
    if (!normalized) return true;
    return [defaultBaseUrlForApiFormat("openai"), defaultBaseUrlForApiFormat("gemini")].some((candidate) => candidate.replace(/\/+$/, "") === normalized);
}

function requiresSecretKey(channel: ModelChannel, secretKeyProtocols: ReadonlySet<string>) {
    return channel.modelCosts?.some((item) => Boolean(item.protocol && secretKeyProtocols.has(item.protocol))) === true;
}
