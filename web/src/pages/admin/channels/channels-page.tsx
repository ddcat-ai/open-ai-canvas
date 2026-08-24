import { App, Button, Form, Input, InputNumber, Modal, Select, Switch } from "antd";
import type { FormInstance } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Pencil, Plus, Power, Search, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import { ChannelHeadersEditor, validateChannelHeaders } from "@/components/channel-headers-editor";
import { PaginationBar } from "@/components/layout/workspace-page";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { desktopLocalChannelFormState, desktopLocalChannelPayloadValue, DESKTOP_LOCAL_CHANNEL_EXAMPLE_BASE_URL } from "@/lib/desktop-local-channel";
import { refreshSystemChannels } from "@/lib/user-session";
import { createAdminChannel, deleteAdminChannel, listAdminChannels, updateAdminChannel } from "@/services/api/auth";
import { type ChannelHeader, type ModelChannel } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { useAdminContext } from "../admin-context";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminDataTable, AdminFilterChip, AdminRowActions, AdminStatusBadge, AdminTableEmpty, configuredSecretText } from "../components/admin-ui";
import { ChannelModelManager } from "../components/channel-model-manager";
import { useTranslation } from "react-i18next";
import { t } from "@/i18n";

type ChannelFormValues = { name: string; baseUrl: string; allowLocalChannel?: boolean; apiKey?: string; secretKey?: string; headers?: ChannelHeader[]; useGlobalConcurrency?: boolean; concurrencyLimit?: number; enabled?: boolean };

export function adminLocalChannelFormOwner(desktopLocalChannelsEnabled: boolean, hostname: string, requestedAllowLocalChannel?: boolean) {
    const state = desktopLocalChannelFormState(desktopLocalChannelsEnabled, hostname, requestedAllowLocalChannel);
    return { ...state, payloadValue: desktopLocalChannelPayloadValue(desktopLocalChannelsEnabled, hostname, requestedAllowLocalChannel) };
}

export function AdminLocalChannelSwitch({ visible, checked, onChange }: { visible: boolean; checked: boolean; onChange: (checked: boolean) => void }) {
    const { t } = useTranslation("canvas");
    if (!visible) return null;
    return (
        <Form.Item
            name="allowLocalChannel"
            label={t("admin:allow-local-channels")}
            valuePropName="checked"
            extra={t("admin:only-exact-localhost-or-127-0-0-1-is-allowed-example-param", { DESKTOP_LOCAL_CHANNEL_EXAMPLE_BASE_URL: DESKTOP_LOCAL_CHANNEL_EXAMPLE_BASE_URL })}
        >
            <Switch checked={checked} onChange={onChange} />
        </Form.Item>
    );
}

export function AdminLocalChannelFields({ visible, checked, form }: { visible: boolean; checked: boolean; form: Pick<FormInstance<ChannelFormValues>, "setFieldValue"> }) {
    const { t } = useTranslation("canvas");
    return (
        <>
            <Form.Item name="baseUrl" label="Base URL" rules={[{ required: true, message: t("admin:enter-a-base-url") }]}>
                <Input placeholder={checked ? DESKTOP_LOCAL_CHANNEL_EXAMPLE_BASE_URL : t("admin:enter-the-channel-base-url")} />
            </Form.Item>
            <AdminLocalChannelSwitch visible={visible} checked={checked} onChange={(value) => form.setFieldValue("allowLocalChannel", value)} />
        </>
    );
}

export function adminChannelSavePayload(values: ChannelFormValues, desktopLocalChannelsEnabled: boolean, hostname: string) {
    return {
        name: values.name.trim(),
        baseUrl: values.baseUrl.trim(),
        allowLocalChannel: adminLocalChannelFormOwner(desktopLocalChannelsEnabled, hostname, values.allowLocalChannel).payloadValue,
        apiKey: values.apiKey?.trim() || "",
        secretKey: values.secretKey?.trim() || "",
        headers: values.headers || [],
        useGlobalConcurrency: values.useGlobalConcurrency !== false,
        concurrencyLimit: values.useGlobalConcurrency === false ? values.concurrencyLimit : undefined,
        enabled: values.enabled !== false,
    };
}

export default function ChannelsPage() {
    const { t } = useTranslation("canvas");
    const { message, modal } = App.useApp();
    const { reloadReferences } = useAdminContext();
    const [searchParams, setSearchParams] = useSearchParams();
    const keyword = searchParams.get("filter") || "";
    const status = normalizeStatus(searchParams.get("status"));
    const page = positiveInt(searchParams.get("page"), 1);
    const pageSize = normalizePageSize(searchParams.get("pageSize"));
    const debouncedKeyword = useDebouncedValue(keyword);
    const [channels, setChannels] = useState<ModelChannel[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [editingChannel, setEditingChannel] = useState<ModelChannel | null>(null);
    const [saving, setSaving] = useState(false);
    const [managingChannel, setManagingChannel] = useState<ModelChannel | null>(null);
    const requestSequence = useRef(0);
    const [form] = Form.useForm<ChannelFormValues>();
    const useGlobalConcurrency = Form.useWatch("useGlobalConcurrency", form) !== false;
    const requestedAllowLocalChannel = Form.useWatch("allowLocalChannel", form) === true;
    const desktopLocalChannelsEnabled = useUserStore((state) => state.features.desktopLocalChannelsEnabled);
    const desktopLocalChannelHostname = typeof window === "undefined" ? "" : window.location.hostname;
    const desktopLocalChannelControl = adminLocalChannelFormOwner(desktopLocalChannelsEnabled, desktopLocalChannelHostname, requestedAllowLocalChannel);
    const allowLocalChannel = desktopLocalChannelControl.checked;
    const showDesktopLocalChannelControl = desktopLocalChannelControl.visible;
    const hasFilters = Boolean(keyword || status !== "all");

    const updateUrl = (patch: Record<string, string | number>, replace = false) => {
        const next = new URLSearchParams(searchParams);
        Object.entries(patch).forEach(([key, value]) => {
            const isDefault = (key === "filter" && value === "") || (key === "status" && value === "all") || (key === "page" && value === 1) || (key === "pageSize" && value === 20);
            if (isDefault) next.delete(key);
            else next.set(key, String(value));
        });
        setSearchParams(next, { replace });
    };

    const reload = async () => {
        const sequence = ++requestSequence.current;
        setLoading(true);
        try {
            const result = await listAdminChannels({ keyword: debouncedKeyword || undefined, status: status === "all" ? undefined : status, page, limit: pageSize });
            if (sequence !== requestSequence.current) return;
            setChannels(result.channels);
            setTotal(result.total);
            if (result.total > 0 && result.channels.length === 0 && page > 1) updateUrl({ page: 1 }, true);
        } catch (error) {
            if (sequence === requestSequence.current) message.error(error instanceof Error ? error.message : t("admin:failed-to-load-channel-list"));
        } finally {
            if (sequence === requestSequence.current) setLoading(false);
        }
    };

    useEffect(() => {
        void reload();
    }, [debouncedKeyword, status, page, pageSize]);

    const syncChannels = async () => {
        await reloadReferences();
        try {
            await refreshSystemChannels();
        } catch (error) {
            message.warning(error instanceof Error ? t("admin:saved-on-the-backend-but-config-sync-failed-param", { message: error.message }) : t("admin:saved-on-the-backend-but-config-sync-failed-reopen-settings-later"));
        }
    };

    const openDrawer = (channel?: ModelChannel) => {
        setEditingChannel(channel || null);
        form.resetFields();
        form.setFieldsValue(
            channel
                ? {
                      name: channel.name,
                      baseUrl: channel.baseUrl,
                      allowLocalChannel: adminLocalChannelFormOwner(desktopLocalChannelsEnabled, desktopLocalChannelHostname, channel.allowLocalChannel).checked,
                      apiKey: "",
                      secretKey: "",
                      headers: channel.headers || [],
                      useGlobalConcurrency: !channel.concurrencyLimit,
                      concurrencyLimit: channel.concurrencyLimit || undefined,
                      enabled: channel.enabled !== false,
                  }
                : { name: "", baseUrl: "", allowLocalChannel: false, apiKey: "", secretKey: "", headers: [], useGlobalConcurrency: true, concurrencyLimit: undefined, enabled: true },
        );
        setDrawerOpen(true);
    };

    const closeDrawer = () => {
        if (saving) return;
        if (!form.isFieldsTouched()) {
            setDrawerOpen(false);
            return;
        }
        modal.confirm({
            title: t("admin:discard-channel-changes"),
            content: t("admin:unsaved-connection-details-will-be-lost"),
            okText: t("admin:discard-changes"),
            cancelText: t("admin:keep-editing-2"),
            okButtonProps: { danger: true },
            onOk: () => setDrawerOpen(false),
        });
    };

    const save = async () => {
        const values = await form.validateFields();
        const headerError = validateChannelHeaders(values.headers);
        if (headerError) {
            message.error(headerError);
            return;
        }
        if (!editingChannel && !values.apiKey?.trim()) {
            message.error(t("admin:enter-an-api-key-or-access-key"));
            return;
        }
        setSaving(true);
        try {
            const payload = adminChannelSavePayload(values, desktopLocalChannelsEnabled, desktopLocalChannelHostname);
            await (editingChannel ? updateAdminChannel(editingChannel.id, payload) : createAdminChannel(payload));
            await syncChannels();
            setDrawerOpen(false);
            form.resetFields();
            await reload();
            message.success(editingChannel ? t("admin:system-channel-updated") : t("admin:system-channel-created"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin:failed-to-save-system-channel"));
        } finally {
            setSaving(false);
        }
    };

    const toggleChannel = async (channel: ModelChannel) => {
        try {
            await updateAdminChannel(channel.id, { enabled: channel.enabled === false });
            await syncChannels();
            await reload();
            message.success(channel.enabled === false ? t("admin:system-channel-enabled") : t("admin:system-channel-disabled"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin:failed-to-update-system-channel"));
        }
    };

    const removeChannel = async (channel: ModelChannel) => {
        try {
            await deleteAdminChannel(channel.id);
            await syncChannels();
            await reload();
            message.success(t("admin:system-channel-deleted"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin:failed-to-delete-system-channel"));
        }
    };

    const columns: ColumnsType<ModelChannel> = [
        {
            title: t("admin:channels"),
            dataIndex: "name",
            render: (_, channel) => (
                <div>
                    <div className="font-medium">{channel.name}</div>
                    <div className="admin-monospace max-w-lg truncate text-foreground/45">{channel.baseUrl}</div>
                </div>
            ),
        },
        { title: t("admin:models"), dataIndex: "models", width: 100, render: (models: string[]) => `${models?.length || 0} 个` },
        { title: t("admin:max-concurrency"), dataIndex: "concurrencyLimit", width: 120, render: (value: number) => (value > 0 ? value : <span className="text-foreground/45">{t("admin:follow-system")}</span>) },
        {
            title: t("admin:credentials"),
            width: 130,
            render: (_, channel) => <AdminStatusBadge label={channel.hasApiKey ? (channel.hasSecretKey ? t("admin:ak-sk-configured") : t("admin:api-key-configured")) : t("admin:not-configured-2")} tone={channel.hasApiKey ? "success" : "neutral"} />,
        },
        { title: t("admin:status"), dataIndex: "enabled", width: 100, render: (enabled) => <AdminStatusBadge label={enabled !== false ? t("admin:enabled") : t("admin:disabled")} tone={enabled !== false ? "success" : "neutral"} /> },
        {
            title: t("admin:actions"),
            width: 250,
            align: "right",
            render: (_, channel) => (
                <AdminRowActions
                    primary={{ label: t("admin:model-management"), onClick: () => setManagingChannel(channel) }}
                    actions={[
                        { key: "edit", label: t("admin:edit-2"), icon: <Pencil className="size-3.5" />, onClick: () => openDrawer(channel) },
                        {
                            key: "toggle",
                            label: channel.enabled !== false ? t("admin:disable-channel") : t("admin:enable-channel"),
                            icon: <Power className="size-3.5" />,
                            danger: channel.enabled !== false,
                            confirm: {
                                title: channel.enabled !== false ? t("admin:disable-this-system-channel") : t("admin:enable-this-system-channel"),
                                description: channel.enabled !== false ? t("admin:new-tasks-will-no-longer-use-this-channel-after-it-is-disabled-it-stays") : t("admin:once-enabled-fully-configured-models-rejoin-the-available-system-model-p"),
                                okText: channel.enabled !== false ? t("admin:confirm-disable") : t("admin:confirm-enable"),
                            },
                            onClick: () => toggleChannel(channel),
                        },
                        {
                            key: "delete",
                            label: t("admin:delete-channel"),
                            icon: <Trash2 className="size-3.5" />,
                            danger: true,
                            confirm: { title: t("admin:delete-this-system-channel"), description: t("admin:the-channel-and-its-models-will-disappear-after-deletion-the-api-key-is"), okText: t("admin:confirm-delete") },
                            onClick: () => removeChannel(channel),
                        },
                    ]}
                />
            ),
        },
    ];

    if (managingChannel) {
        return (
            <ChannelModelManager
                channel={managingChannel}
                onClose={() => setManagingChannel(null)}
                onChanged={async () => {
                    await syncChannels();
                    await reload();
                }}
            />
        );
    }

    return (
        <AdminPageFrame
            title={t("admin:system-channels")}
            description={t("admin:channels-models-and-pricing")}
            actions={
                <Button type="primary" icon={<Plus className="size-4" />} onClick={() => openDrawer()}>
                    {t("admin:add-system-channel-3")}
                </Button>
            }
        >
            <AdminDataTable
                toolbar={
                    <Input
                        id="admin-channel-search"
                        aria-label={t("admin:search-system-channels")}
                        autoComplete="off"
                        allowClear
                        className="app-list-search"
                        prefix={<Search className="size-4 text-foreground/40" />}
                        value={keyword}
                        placeholder={t("admin:search-channel-names-or-urls")}
                        onChange={(event) => updateUrl({ filter: event.target.value, page: 1 }, true)}
                    />
                }
                toolbarActiveFilters={
                    <>
                        {keyword ? <AdminFilterChip label={t("admin:search-param", { keyword: keyword })} onRemove={() => updateUrl({ filter: "", page: 1 })} /> : null}
                        {status !== "all" ? <AdminFilterChip label={`状态：${status === "enabled" ? t("admin:enabled") : t("admin:disabled")}`} onRemove={() => updateUrl({ status: "all", page: 1 })} /> : null}
                    </>
                }
                toolbarFilters={
                    <Select
                        className="w-32"
                        value={status}
                        onChange={(value) => updateUrl({ status: value, page: 1 })}
                        options={[
                            { label: t("admin:all-statuses"), value: "all" },
                            { label: t("admin:enabled"), value: "enabled" },
                            { label: t("admin:disabled"), value: "disabled" },
                        ]}
                    />
                }
                toolbarActive={hasFilters}
                onReset={() => updateUrl({ filter: "", status: "all", page: 1 })}
                skeletonColumns={6}
                table={{
                    className: "app-data-table",
                    size: "small",
                    rowKey: "id",
                    loading,
                    columns,
                    dataSource: channels,
                    locale: {
                        emptyText: (
                            <AdminTableEmpty
                                filtered={hasFilters}
                                title={hasFilters ? undefined : t("admin:no-system-channels-yet")}
                                action={
                                    hasFilters ? undefined : (
                                        <Button type="primary" icon={<Plus className="size-4" />} onClick={() => openDrawer()}>
                                            {t("admin:add-system-channel-3")}
                                        </Button>
                                    )
                                }
                            />
                        ),
                    },
                    pagination: false,
                    scroll: { x: 820 },
                }}
                footer={<PaginationBar alwaysShow current={page} pageSize={pageSize} total={total} onChange={(nextPage, nextSize) => updateUrl({ page: nextSize !== pageSize ? 1 : nextPage, pageSize: nextSize })} />}
            />
            <Modal
                className="workspace-modal workspace-modal-wide admin-channel-modal"
                rootClassName="admin-channel-modal-root"
                title={editingChannel ? t("admin:edit-system-channel") : t("admin:add-system-channel-3")}
                open={drawerOpen}
                width={760}
                onCancel={closeDrawer}
                maskClosable={!saving}
                destroyOnHidden
                footer={
                    <div className="flex justify-end gap-2">
                        <Button onClick={closeDrawer}>{t("admin:cancel-4")}</Button>
                        <Button type="primary" loading={saving} onClick={() => void save()}>
                            {t("admin:save-4")}
                        </Button>
                    </div>
                }
            >
                <Form form={form} layout="vertical" requiredMark={false}>
                    <Form.Item name="name" label={t("admin:channel-name")} rules={[{ required: true, message: t("admin:enter-a-channel-name") }]}>
                        <Input placeholder={t("admin:e-g-openai-official-channel")} />
                    </Form.Item>
                    <AdminLocalChannelFields visible={showDesktopLocalChannelControl} checked={allowLocalChannel} form={form} />
                    <Form.Item
                        name="apiKey"
                        label={editingChannel ? `API Key / Access Key（${configuredSecretText}）` : "API Key / Access Key"}
                        rules={editingChannel ? [] : [{ required: true, message: t("admin:enter-an-api-key-or-access-key") }]}
                        extra={t("admin:enter-an-api-key-for-openai-compatible-protocols-an-iam-access-key-for-o")}
                    >
                        <Input.Password autoComplete="new-password" placeholder={editingChannel ? t("admin:leave-blank-to-keep-current-credentials") : t("admin:api-key-or-access-key")} />
                    </Form.Item>
                    <Form.Item name="secretKey" label={editingChannel ? `Secret Key（${channelSecretText(editingChannel)}）` : t("admin:secret-key-optional")} extra={t("admin:required-only-for-ak-sk-signed-protocols-like-official-jimeng-leave-blan")}>
                        <Input.Password autoComplete="new-password" placeholder={editingChannel ? t("admin:leave-blank-to-keep-the-current-secret-key") : "IAM Secret Key"} />
                    </Form.Item>
                    <div className="mb-6">
                        <Form.Item name="headers" noStyle>
                            <ChannelHeadersEditor />
                        </Form.Item>
                    </div>
                    <Form.Item name="useGlobalConcurrency" label={t("admin:follow-system-concurrency")} valuePropName="checked">
                        <Switch />
                    </Form.Item>
                    <Form.Item
                        name="concurrencyLimit"
                        label={t("admin:channel-max-concurrency")}
                        extra={t("admin:backend-tasks-and-proxied-requests-share-this-limit-requests-wait-when-s")}
                        rules={
                            useGlobalConcurrency
                                ? []
                                : [
                                      { required: true, message: t("admin:enter-the-channel-max-concurrency") },
                                      { type: "number", min: 1, max: 999, message: t("admin:enter-an-integer-between-1-and-999") },
                                  ]
                        }
                    >
                        <InputNumber className="w-full" min={1} max={999} precision={0} disabled={useGlobalConcurrency} placeholder={useGlobalConcurrency ? t("admin:use-system-default") : "1-999"} />
                    </Form.Item>
                    <Form.Item name="enabled" label={t("admin:enabled-2")} valuePropName="checked">
                        <Switch />
                    </Form.Item>
                </Form>
            </Modal>
        </AdminPageFrame>
    );
}

function positiveInt(value: string | null, fallback: number) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
function normalizePageSize(value: string | null) {
    const parsed = positiveInt(value, 20);
    return [20, 50, 100].includes(parsed) ? parsed : 20;
}
function normalizeStatus(value: string | null): "all" | "enabled" | "disabled" {
    return value === "enabled" || value === "disabled" ? value : "all";
}
function channelSecretText(channel: ModelChannel) {
    return channel.hasSecretKey ? t("admin:configured-leave-blank-to-keep") : t("admin:not-configured-2");
}
