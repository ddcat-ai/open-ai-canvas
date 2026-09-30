import { App, Button, Form, Input, InputNumber, Modal, Spin, Switch } from "antd";
import { ChevronRight, Copy, Pencil, Plus, Power, Search, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import { ChannelHeadersEditor, validateChannelHeaders } from "@/components/channel-headers-editor";
import { refreshSystemChannels } from "@/lib/user-session";
import { createAdminChannel, deleteAdminChannel, duplicateAdminChannel, listAdminChannels, updateAdminChannel } from "@/services/api/auth";
import { type ChannelHeader, type ModelChannel } from "@/stores/use-config-store";
import { useAdminContext } from "../admin-context";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminRowActions, AdminStatusBadge, AdminTableEmpty, configuredSecretText } from "../components/admin-ui";
import { ChannelModelManager } from "../components/channel-model-manager";
import { ChannelOrderDialog } from "../components/channel-order-dialog";
import { selectChannelWorkspace } from "./channel-workspace-state";
import "./channels-page.css";
import { Select } from "@/components/ui/base/select";

type ChannelFormValues = {
    name: string;
    baseUrl: string;
    apiKey?: string;
    secretKey?: string;
    headers?: ChannelHeader[];
    useGlobalConcurrency?: boolean;
    concurrencyLimit?: number;
    enabled?: boolean;
};

export function adminChannelSavePayload(values: ChannelFormValues) {
    return {
        name: values.name.trim(),
        baseUrl: values.baseUrl.trim(),
        apiKey: values.apiKey?.trim() || "",
        secretKey: values.secretKey?.trim() || "",
        headers: values.headers || [],
        useGlobalConcurrency: values.useGlobalConcurrency !== false,
        concurrencyLimit: values.useGlobalConcurrency === false ? values.concurrencyLimit : undefined,
        enabled: values.enabled !== false,
    };
}

export default function ChannelsPage() {
    const { message, modal } = App.useApp();
    const { reloadReferences } = useAdminContext();
    const [searchParams, setSearchParams] = useSearchParams();
    const keyword = searchParams.get("filter") || "";
    const status = normalizeStatus(searchParams.get("status"));
    const selectedChannelId = searchParams.get("channel");
    const [channels, setChannels] = useState<ModelChannel[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [editingChannel, setEditingChannel] = useState<ModelChannel | null>(null);
    const [saving, setSaving] = useState(false);
    const [duplicatingChannelId, setDuplicatingChannelId] = useState<string | null>(null);
    const requestSequence = useRef(0);
    const [form] = Form.useForm<ChannelFormValues>();
    const useGlobalConcurrency = Form.useWatch("useGlobalConcurrency", form) !== false;
    const hasFilters = Boolean(keyword || status !== "all");
    const { visibleChannels, selectedChannel } = selectChannelWorkspace(channels, keyword, status, selectedChannelId);

    const updateUrl = (patch: Record<string, string | number>, replace = false) => {
        setSearchParams(
            (current) => {
                const next = new URLSearchParams(current);
                next.delete("page");
                next.delete("pageSize");
                Object.entries(patch).forEach(([key, value]) => {
                    if (value === "" || (key === "status" && value === "all")) next.delete(key);
                    else next.set(key, String(value));
                });
                return next;
            },
            { replace },
        );
    };

    const reload = async () => {
        const sequence = ++requestSequence.current;
        setLoading(true);
        setLoadError("");
        try {
            // The navigation needs every channel, not just the API's default first 20.
            const result = await listAdminChannels({ page: 1, pageSize: 100 });
            const nextChannels = [...result.channels];
            for (let page = 2; nextChannels.length < result.total; page += 1) {
                if (sequence !== requestSequence.current) return;
                const next = await listAdminChannels({ page, pageSize: 100 });
                if (!next.channels.length) throw new Error("渠道列表发生变化，请重新加载");
                nextChannels.push(...next.channels);
            }
            if (sequence !== requestSequence.current) return;
            setChannels(Array.from(new Map(nextChannels.map((channel) => [channel.id, channel])).values()));
        } catch (error) {
            if (sequence === requestSequence.current) setLoadError(error instanceof Error ? error.message : "读取渠道列表失败");
        } finally {
            if (sequence === requestSequence.current) setLoading(false);
        }
    };

    useEffect(() => {
        void reload();
        return () => {
            requestSequence.current += 1;
        };
    }, []);

    const syncChannels = async () => {
        await reloadReferences();
        try {
            await refreshSystemChannels();
        } catch (error) {
            message.warning(error instanceof Error ? `后台已保存，但配置同步失败：${error.message}` : "后台已保存，但配置同步失败，请稍后重新打开配置");
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
                      apiKey: "",
                      secretKey: "",
                      headers: channel.headers || [],
                      useGlobalConcurrency: !channel.concurrencyLimit,
                      concurrencyLimit: channel.concurrencyLimit || undefined,
                      enabled: channel.enabled !== false,
                  }
                : { name: "", baseUrl: "", apiKey: "", secretKey: "", headers: [], useGlobalConcurrency: true, concurrencyLimit: undefined, enabled: true },
        );
        setDrawerOpen(true);
    };

    const closeDrawer = () => {
        if (saving) return;
        if (!form.isFieldsTouched()) {
            setDrawerOpen(false);
            return;
        }
        modal.confirm({ title: "放弃渠道修改？", content: "尚未保存的连接信息将丢失。", okText: "放弃修改", cancelText: "继续编辑", okButtonProps: { danger: true }, onOk: () => setDrawerOpen(false) });
    };

    const save = async () => {
        const values = await form.validateFields();
        const headerError = validateChannelHeaders(values.headers);
        if (headerError) {
            message.error(headerError);
            return;
        }
        if (!editingChannel && !values.apiKey?.trim()) {
            message.error("请填写 API Key 或 Access Key");
            return;
        }
        setSaving(true);
        try {
            const payload = adminChannelSavePayload(values);
            const { channel } = await (editingChannel ? updateAdminChannel(editingChannel.id, payload) : createAdminChannel(payload));
            setChannels((current) => (editingChannel ? current.map((item) => (item.id === channel.id ? channel : item)) : [...current, channel]));
            updateUrl({ channel: channel.id, filter: "", status: "all" }, true);
            await syncChannels();
            setDrawerOpen(false);
            form.resetFields();
            await reload();
            message.success(editingChannel ? "系统渠道已更新" : "系统渠道已创建");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存系统渠道失败");
        } finally {
            setSaving(false);
        }
    };

    const toggleChannel = async (channel: ModelChannel) => {
        try {
            await updateAdminChannel(channel.id, { enabled: channel.enabled === false });
            await syncChannels();
            await reload();
            message.success(channel.enabled === false ? "系统渠道已启用" : "系统渠道已停用");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "更新系统渠道失败");
        }
    };

    const duplicateChannel = async (channel: ModelChannel) => {
        setDuplicatingChannelId(channel.id);
        try {
            const { channel: duplicated } = await duplicateAdminChannel(channel.id);
            setChannels((current) => [...current, duplicated]);
            updateUrl({ channel: duplicated.id, filter: "", status: "all" }, true);
            await syncChannels();
            await reload();
            message.success("系统渠道已复制");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "复制系统渠道失败");
        } finally {
            setDuplicatingChannelId(null);
        }
    };

    const removeChannel = async (channel: ModelChannel) => {
        try {
            await deleteAdminChannel(channel.id);
            await syncChannels();
            await reload();
            message.success("系统渠道已删除");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "删除系统渠道失败");
        }
    };

    const channelActions = (channel: ModelChannel) => (
        <AdminRowActions
            primary={{ label: "编辑渠道", icon: <Pencil className="size-3.5" />, onClick: () => openDrawer(channel) }}
            actions={[
                { key: "duplicate", label: "复制渠道", icon: <Copy className="size-3.5" />, disabled: Boolean(duplicatingChannelId), onClick: () => duplicateChannel(channel) },
                {
                    key: "toggle",
                    label: channel.enabled !== false ? "停用渠道" : "启用渠道",
                    icon: <Power className="size-3.5" />,
                    danger: channel.enabled !== false,
                    confirm: {
                        title: channel.enabled !== false ? "停用这个系统渠道？" : "启用这个系统渠道？",
                        description: channel.enabled !== false ? "停用后新任务不会再使用该渠道，但仍会保留在列表中，可随时重新启用。" : "启用后，配置完整的模型会重新进入系统可用模型集合。",
                        okText: channel.enabled !== false ? "确认停用" : "确认启用",
                    },
                    onClick: () => toggleChannel(channel),
                },
                {
                    key: "delete",
                    label: "删除渠道",
                    icon: <Trash2 className="size-3.5" />,
                    danger: true,
                    confirm: { title: "删除这个系统渠道？", description: "删除后渠道及所属模型将不再显示，API Key 会被清除，历史账单和调用记录继续保留。该操作不能在页面恢复。", okText: "确认删除" },
                    onClick: () => removeChannel(channel),
                },
            ]}
        />
    );

    return (
        <AdminPageFrame title="系统模型" description="左侧选择渠道，右侧直接管理模型、协议与售价。">
            <div className="admin-channel-workspace">
                <aside className="admin-channel-sidebar" aria-label="系统渠道">
                    <div className="admin-channel-sidebar-header">
                        <div className="flex items-center justify-between gap-2">
                            <h2 className="font-semibold">渠道</h2>
                            <span className="admin-channel-count">{hasFilters ? `${visibleChannels.length} / ${channels.length}` : channels.length}</span>
                        </div>
                        <Button block type="primary" icon={<Plus className="size-4" />} onClick={() => openDrawer()}>
                            新增渠道
                        </Button>
                        <Input
                            id="admin-channel-search"
                            aria-label="搜索系统渠道"
                            autoComplete="off"
                            allowClear
                            prefix={<Search className="size-4 text-foreground/40" />}
                            value={keyword}
                            placeholder="搜索渠道名称或地址"
                            onChange={(event) => updateUrl({ filter: event.target.value }, true)}
                        />
                        <Select
                            aria-label="筛选渠道状态"
                            value={status}
                            onChange={(value) => updateUrl({ status: value })}
                            options={[
                                { label: "全部状态", value: "all" },
                                { label: "已启用", value: "enabled" },
                                { label: "已停用", value: "disabled" },
                            ]}
                        />
                    </div>
                    <div className="admin-channel-list" aria-busy={loading}>
                        {loadError ? (
                            <div className="admin-channel-load-error" role="alert">
                                <p>{loadError}</p>
                                <Button size="small" onClick={() => void reload()}>
                                    重新加载渠道
                                </Button>
                            </div>
                        ) : null}
                        {loading ? (
                            <div className="admin-channel-loading" role="status" aria-label="正在加载渠道">
                                <Spin size="small" />
                            </div>
                        ) : null}
                        {visibleChannels.map((channel) => (
                            <button type="button" key={channel.id} className="admin-channel-item" aria-pressed={selectedChannel?.id === channel.id} aria-controls="admin-channel-models" onClick={() => updateUrl({ channel: channel.id })}>
                                <span className="admin-channel-item-topline">
                                    <span className="admin-channel-item-name" title={channel.name}>
                                        {channel.name}
                                    </span>
                                    <ChevronRight className="admin-channel-item-arrow size-3.5" aria-hidden="true" />
                                </span>
                                <span className="admin-channel-item-meta">
                                    <span>{channel.models?.length || 0} 个模型</span>
                                    <span className="admin-channel-item-status" data-enabled={channel.enabled !== false}>
                                        {channel.enabled !== false ? "已启用" : "已停用"}
                                    </span>
                                </span>
                            </button>
                        ))}
                        {!loading && !loadError && !visibleChannels.length ? (
                            <AdminTableEmpty filtered={hasFilters} title={hasFilters ? undefined : "还没有系统渠道"} action={hasFilters ? <Button onClick={() => updateUrl({ filter: "", status: "all" })}>清除筛选</Button> : undefined} />
                        ) : null}
                    </div>
                    <div className="admin-channel-sidebar-footer">
                        <ChannelOrderDialog
                            onSaved={async () => {
                                await syncChannels();
                                await reload();
                            }}
                        />
                    </div>
                </aside>
                <section id="admin-channel-models" className="admin-channel-detail" aria-label={selectedChannel ? `${selectedChannel.name}的模型管理` : "渠道模型管理"}>
                    {selectedChannel ? (
                        <>
                            <header className="admin-channel-detail-header">
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <h2 className="admin-channel-detail-title">{selectedChannel.name}</h2>
                                        <AdminStatusBadge label={selectedChannel.enabled !== false ? "已启用" : "已停用"} tone={selectedChannel.enabled !== false ? "success" : "neutral"} />
                                    </div>
                                    <p className="admin-channel-detail-url" title={selectedChannel.baseUrl}>
                                        {selectedChannel.baseUrl}
                                    </p>
                                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground/50">
                                        <span>{selectedChannel.hasApiKey ? (selectedChannel.hasSecretKey ? "AK/SK 已配置" : "API Key 已配置") : "凭证未配置"}</span>
                                        <span>最大并发：{selectedChannel.concurrencyLimit || "跟随系统"}</span>
                                    </div>
                                </div>
                                {channelActions(selectedChannel)}
                            </header>
                            <ChannelModelManager
                                key={selectedChannel.id}
                                channel={selectedChannel}
                                onChanged={async () => {
                                    await syncChannels();
                                    await reload();
                                }}
                            />
                        </>
                    ) : (
                        <AdminTableEmpty
                            title={loading ? "正在加载渠道" : loadError ? "暂时无法读取渠道" : hasFilters ? "没有匹配的渠道" : "添加渠道，开始管理模型"}
                            description={loading ? "加载完成后将在此显示渠道模型。" : loadError ? "请在左侧重试加载。" : hasFilters ? "调整左侧搜索或状态筛选。" : "在左侧新增渠道，配置连接信息后即可拉取或新增模型。"}
                        />
                    )}
                </section>
            </div>
            <Modal
                className="workspace-modal workspace-modal-wide admin-channel-modal"
                rootClassName="admin-channel-modal-root"
                title={editingChannel ? "编辑系统渠道" : "新增系统渠道"}
                open={drawerOpen}
                width={760}
                onCancel={closeDrawer}
                mask={{ closable: !saving }}
                destroyOnHidden
                footer={
                    <div className="flex justify-end gap-2">
                        <Button onClick={closeDrawer}>取消</Button>
                        <Button type="primary" loading={saving} onClick={() => void save()}>
                            保存
                        </Button>
                    </div>
                }
            >
                <Form form={form} layout="vertical" requiredMark={false}>
                    <Form.Item name="name" label="渠道名称" rules={[{ required: true, message: "请填写渠道名称" }]}>
                        <Input placeholder="例如：OpenAI 官方渠道" />
                    </Form.Item>
                    <Form.Item name="baseUrl" label="Base URL" rules={[{ required: true, message: "请填写 Base URL" }]}>
                        <Input placeholder="填写云端渠道 Base URL" />
                    </Form.Item>
                    <Form.Item
                        name="apiKey"
                        label={editingChannel ? `API Key / Access Key（${configuredSecretText}）` : "API Key / Access Key"}
                        rules={editingChannel ? [] : [{ required: true, message: "请填写 API Key 或 Access Key" }]}
                        extra="OpenAI 兼容协议填写 API Key；即梦官方协议填写 IAM Access Key。"
                    >
                        <Input.Password autoComplete="new-password" placeholder={editingChannel ? "留空保留原凭证" : "API Key 或 Access Key"} />
                    </Form.Item>
                    <Form.Item name="secretKey" label={editingChannel ? `Secret Key（${channelSecretText(editingChannel)}）` : "Secret Key（可选）"} extra="仅即梦官方等 AK/SK 签名协议需要；其他渠道留空。">
                        <Input.Password autoComplete="new-password" placeholder={editingChannel ? "留空保留原 Secret Key" : "IAM Secret Key"} />
                    </Form.Item>
                    <div className="mb-6">
                        <Form.Item name="headers" noStyle>
                            <ChannelHeadersEditor />
                        </Form.Item>
                    </div>
                    <Form.Item name="useGlobalConcurrency" label="跟随系统并发配置" valuePropName="checked">
                        <Switch />
                    </Form.Item>
                    <Form.Item
                        name="concurrencyLimit"
                        label="渠道最大并发数"
                        extra="后台任务和系统代理请求共享该渠道上限；槽位暂满时请求会等待。"
                        rules={
                            useGlobalConcurrency
                                ? []
                                : [
                                      { required: true, message: "请填写渠道最大并发数" },
                                      { type: "number", min: 1, max: 999, message: "请输入 1-999 的整数" },
                                  ]
                        }
                    >
                        <InputNumber className="w-full" min={1} max={999} precision={0} disabled={useGlobalConcurrency} placeholder={useGlobalConcurrency ? "使用系统默认值" : "1-999"} />
                    </Form.Item>
                    <Form.Item name="enabled" label="启用" valuePropName="checked">
                        <Switch />
                    </Form.Item>
                </Form>
            </Modal>
        </AdminPageFrame>
    );
}

function normalizeStatus(value: string | null): "all" | "enabled" | "disabled" {
    return value === "enabled" || value === "disabled" ? value : "all";
}
function channelSecretText(channel: ModelChannel) {
    return channel.hasSecretKey ? "已配置，留空不修改" : "未配置";
}
