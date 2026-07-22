import { App, Button, Drawer, Form, Input, Select, Switch, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Pencil, Plus, Power, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import { ListToolbar, TableSurface } from "@/components/layout/workspace-page";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { refreshSystemChannels } from "@/lib/user-session";
import { createAdminChannel, deleteAdminChannel, listAdminChannels, updateAdminChannel } from "@/services/api/auth";
import { defaultBaseUrlForChannelInterface, type ChannelInterfaceType, type ModelChannel } from "@/stores/use-config-store";
import { useAdminContext } from "../admin-context";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminRowActions, AdminTableEmpty, AdminTableSkeleton, configuredSecretText } from "../components/admin-ui";
import { ChannelModelManager } from "../components/channel-model-manager";

type ChannelFormValues = { name: string; baseUrl: string; apiKey?: string; interfaceType: ChannelInterfaceType; enabled?: boolean };

const interfaceTypeOptions = [
    { label: "文本", options: [{ label: "Chat Completions", value: "chat-completion" }, { label: "OpenAI Responses", value: "openai-response" }] },
    { label: "图片", options: [{ label: "OpenAI Images", value: "openai-image" }] },
    { label: "视频", options: [{ label: "NewAPI 视频", value: "newapi" }, { label: "NewAPI 渠道 1", value: "newapi-channel-1" }, { label: "NewAPI 渠道 2", value: "newapi-channel-2" }, { label: "xAI / Sub2API 视频", value: "xai-video" }] },
];

export default function ChannelsPage() {
    const { message, modal } = App.useApp();
    const { reloadReferences } = useAdminContext();
    const [searchParams, setSearchParams] = useSearchParams();
    const keyword = searchParams.get("filter") || "";
    const interfaceType = normalizeInterface(searchParams.get("interfaceType"));
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
    const hasFilters = Boolean(keyword || interfaceType !== "all" || status !== "all");

    const updateUrl = (patch: Record<string, string | number>, replace = false) => {
        const next = new URLSearchParams(searchParams);
        Object.entries(patch).forEach(([key, value]) => {
            const isDefault = (key === "filter" && value === "") || (key === "interfaceType" && value === "all") || (key === "status" && value === "all") || (key === "page" && value === 1) || (key === "pageSize" && value === 20);
            if (isDefault) next.delete(key);
            else next.set(key, String(value));
        });
        setSearchParams(next, { replace });
    };

    const reload = async () => {
        const sequence = ++requestSequence.current;
        setLoading(true);
        try {
            const result = await listAdminChannels({ keyword: debouncedKeyword || undefined, interfaceType: interfaceType === "all" ? undefined : interfaceType, status: status === "all" ? undefined : status, page, limit: pageSize });
            if (sequence !== requestSequence.current) return;
            setChannels(result.channels);
            setTotal(result.total);
            if (result.total > 0 && result.channels.length === 0 && page > 1) updateUrl({ page: 1 }, true);
        } catch (error) {
            if (sequence === requestSequence.current) message.error(error instanceof Error ? error.message : "读取渠道列表失败");
        } finally {
            if (sequence === requestSequence.current) setLoading(false);
        }
    };

    useEffect(() => {
        void reload();
    }, [debouncedKeyword, interfaceType, status, page, pageSize]);

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
        form.setFieldsValue(channel ? { name: channel.name, baseUrl: channel.baseUrl, apiKey: "", interfaceType: channel.interfaceType || "newapi", enabled: channel.enabled !== false } : { name: "", baseUrl: "", apiKey: "", interfaceType: "newapi", enabled: true });
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
        if (!editingChannel && !values.apiKey?.trim()) {
            message.error("请填写 API Key");
            return;
        }
        setSaving(true);
        try {
            const payload = { name: values.name.trim(), baseUrl: values.baseUrl.trim(), apiKey: values.apiKey?.trim() || "", interfaceType: values.interfaceType, enabled: values.enabled !== false };
            await (editingChannel ? updateAdminChannel(editingChannel.id, payload) : createAdminChannel(payload));
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
            if (channel.enabled === false) await updateAdminChannel(channel.id, { enabled: true });
            else await deleteAdminChannel(channel.id);
            await syncChannels();
            await reload();
            message.success(channel.enabled === false ? "系统渠道已启用" : "系统渠道已停用");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "更新系统渠道失败");
        }
    };

    const columns: ColumnsType<ModelChannel> = [
        { title: "渠道", dataIndex: "name", render: (_, channel) => <div><div className="font-medium">{channel.name}</div><div className="max-w-lg truncate text-xs text-foreground/45">{channel.baseUrl}</div></div> },
        { title: "接口类型", dataIndex: "interfaceType", width: 160, render: (value: ChannelInterfaceType) => <Tag bordered={false} color={value === "newapi-channel-1" ? "green" : value === "newapi" ? "orange" : value === "newapi-channel-2" ? "purple" : value === "xai-video" ? "cyan" : "blue"}>{interfaceTypeLabel(value)}</Tag> },
        { title: "模型", dataIndex: "models", width: 100, render: (models: string[]) => `${models?.length || 0} 个` },
        { title: "密钥", dataIndex: "hasApiKey", width: 100, render: (configured) => <Tag bordered={false} color={configured ? "success" : "default"}>{configured ? "已配置" : "未配置"}</Tag> },
        { title: "状态", dataIndex: "enabled", width: 100, render: (enabled) => <Tag bordered={false} color={enabled !== false ? "success" : "default"}>{enabled !== false ? "已启用" : "已停用"}</Tag> },
        { title: "操作", width: 160, fixed: "right", align: "right", render: (_, channel) => <AdminRowActions primary={{ label: "模型管理", onClick: () => setManagingChannel(channel) }} actions={[{ key: "edit", label: "编辑渠道", icon: <Pencil className="size-3.5" />, onClick: () => openDrawer(channel) }, { key: "toggle", label: channel.enabled !== false ? "停用渠道" : "启用渠道", icon: <Power className="size-3.5" />, danger: channel.enabled !== false, confirm: { title: channel.enabled !== false ? "停用这个系统渠道？" : "启用这个系统渠道？", description: channel.enabled !== false ? "停用后新任务不会再使用该渠道，历史账单和调用记录继续保留。" : "启用后，配置完整的模型会重新进入系统可用模型集合。", okText: channel.enabled !== false ? "确认停用" : "确认启用" }, onClick: () => toggleChannel(channel) }]} /> },
    ];

    if (managingChannel) {
        return <AdminPageFrame title="系统渠道" description={`${managingChannel.name} · 模型与售价`}><ChannelModelManager channel={managingChannel} onClose={() => setManagingChannel(null)} onChanged={async () => { await syncChannels(); await reload(); }} /></AdminPageFrame>;
    }

    return (
        <AdminPageFrame title="系统渠道" description="渠道、模型与售价" actions={<Button type="primary" icon={<Plus className="size-4" />} onClick={() => openDrawer()}>新增系统渠道</Button>}>
            <ListToolbar active={hasFilters} onReset={() => updateUrl({ filter: "", interfaceType: "all", status: "all", page: 1 })}>
                <Input allowClear className="w-full sm:w-72" prefix={<Search className="size-4 text-foreground/40" />} value={keyword} placeholder="搜索渠道名称或地址" onChange={(event) => updateUrl({ filter: event.target.value, page: 1 }, true)} />
                <Select className="w-40" value={interfaceType} onChange={(value) => updateUrl({ interfaceType: value, page: 1 })} options={[{ label: "全部接口", value: "all" }, ...interfaceTypeOptions.flatMap((group) => group.options)]} />
                <Select className="w-32" value={status} onChange={(value) => updateUrl({ status: value, page: 1 })} options={[{ label: "全部状态", value: "all" }, { label: "已启用", value: "enabled" }, { label: "已停用", value: "disabled" }]} />
            </ListToolbar>
            <TableSurface>
                {loading && channels.length === 0 ? <AdminTableSkeleton rows={8} columns={6} /> : <Table className="app-data-table" size="middle" rowKey="id" loading={loading} columns={columns} dataSource={channels} locale={{ emptyText: <AdminTableEmpty filtered={hasFilters} title={hasFilters ? undefined : "还没有系统渠道"} description={hasFilters ? undefined : "创建渠道并配置模型后，普通用户即可使用系统模型。"} action={hasFilters ? undefined : <Button type="primary" icon={<Plus className="size-4" />} onClick={() => openDrawer()}>新增系统渠道</Button>} /> }} pagination={{ current: page, pageSize, total, showSizeChanger: true, pageSizeOptions: [20, 50, 100], showTotal: (value, range) => `${range[0]}-${range[1]} / 共 ${value} 条`, onChange: (nextPage, nextSize) => updateUrl({ page: nextSize !== pageSize ? 1 : nextPage, pageSize: nextSize }) }} scroll={{ x: 860 }} />}
            </TableSurface>
            <Drawer title={editingChannel ? "编辑系统渠道" : "新增系统渠道"} open={drawerOpen} width="min(560px, 100vw)" onClose={closeDrawer} maskClosable={!saving} destroyOnHidden extra={<Button type="primary" loading={saving} onClick={() => void save()}>保存</Button>}>
                <Form form={form} layout="vertical" requiredMark={false}>
                    <Form.Item name="name" label="渠道名称" rules={[{ required: true, message: "请填写渠道名称" }]}><Input placeholder="例如：OpenAI 官方渠道" /></Form.Item>
                    <Form.Item name="interfaceType" label="接口类型" rules={[{ required: true, message: "请选择接口类型" }]} extra="按生成能力选择实际上游协议；系统渠道统一使用 Bearer 鉴权。"><Select options={interfaceTypeOptions} onChange={(value: ChannelInterfaceType) => { const current = String(form.getFieldValue("baseUrl") || "").trim(); if (!current || current === defaultBaseUrlForChannelInterface()) form.setFieldValue("baseUrl", defaultBaseUrlForChannelInterface(value)); }} /></Form.Item>
                    <Form.Item name="baseUrl" label="Base URL" rules={[{ required: true, message: "请填写 Base URL" }]}><Input placeholder="填写渠道 Base URL" /></Form.Item>
                    <Form.Item name="apiKey" label={editingChannel ? `API Key（${configuredSecretText}）` : "API Key"} rules={editingChannel ? [] : [{ required: true, message: "请填写 API Key" }]}><Input.Password placeholder={editingChannel ? "留空保留原密钥" : "系统渠道密钥"} /></Form.Item>
                    <Form.Item name="enabled" label="启用" valuePropName="checked"><Switch /></Form.Item>
                </Form>
            </Drawer>
        </AdminPageFrame>
    );
}

function positiveInt(value: string | null, fallback: number) { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback; }
function normalizePageSize(value: string | null) { const parsed = positiveInt(value, 20); return [20, 50, 100].includes(parsed) ? parsed : 20; }
function normalizeStatus(value: string | null): "all" | "enabled" | "disabled" { return value === "enabled" || value === "disabled" ? value : "all"; }
function normalizeInterface(value: string | null): "all" | ChannelInterfaceType { return ["chat-completion", "openai-response", "openai-image", "newapi", "newapi-channel-1", "newapi-channel-2", "xai-video"].includes(value || "") ? value as ChannelInterfaceType : "all"; }
function interfaceTypeLabel(value?: ChannelInterfaceType) { return ({ "chat-completion": "Chat Completions", "openai-response": "OpenAI Responses", "openai-image": "OpenAI Images", newapi: "NewAPI 视频", "newapi-channel-1": "NewAPI 渠道 1", "newapi-channel-2": "NewAPI 渠道 2", "xai-video": "xAI / Sub2API 视频" } as Record<string, string>)[value || ""] || "未设置"; }
