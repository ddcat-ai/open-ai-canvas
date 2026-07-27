import { useEffect, useState } from "react";
import { App, Button, Drawer, Form, Input, InputNumber, Popconfirm, Segmented, Select, Space, Switch, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ArrowLeft, Plus, RefreshCw, Search, Trash2 } from "lucide-react";

import { ListToolbar, TableSurface } from "@/components/layout/workspace-page";
import { createAdminChannelModel, deleteAdminChannelModel, fetchAdminChannelModels, listAdminChannelModels, updateAdminChannelModel, type ChannelModel } from "@/services/api/wallet";
import type { ModelChannel } from "@/stores/use-config-store";

type FormValues = {
    modelKey: string;
    displayName?: string;
    capability: ChannelModel["capability"];
    billingMode: ChannelModel["billingMode"];
    unitPrice: number;
    enabled: boolean;
};

export function ChannelModelManager({ channel, onClose, onChanged }: { channel: ModelChannel; onClose: () => void; onChanged: () => void | Promise<void> }) {
    const { message } = App.useApp();
    const [items, setItems] = useState<ChannelModel[]>([]);
    const [editing, setEditing] = useState<ChannelModel | null>(null);
    const [loading, setLoading] = useState(false);
    const [fetching, setFetching] = useState(false);
    const [saving, setSaving] = useState(false);
    const [editorOpen, setEditorOpen] = useState(false);
    const [keyword, setKeyword] = useState("");
    const [capability, setCapability] = useState<ChannelModel["capability"] | "all">("all");
    const [status, setStatus] = useState<"all" | "enabled" | "disabled">("all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [form] = Form.useForm<FormValues>();
    const billingMode = Form.useWatch("billingMode", form) || "fixed_request";
    const modelCapability = Form.useWatch("capability", form);

    const reload = async () => {
        if (!channel) return;
        setLoading(true);
        try {
            setItems((await listAdminChannelModels(channel.id)).models);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取渠道模型失败");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void reload();
        setEditing(null);
        setEditorOpen(false);
        setKeyword("");
        setCapability("all");
        setStatus("all");
        setPage(1);
    }, [channel.id]);

    const fetchModels = async () => {
        setFetching(true);
        try {
            // 拉取只导入缺失项；新模型仍需管理员定价并手动启用。
            const result = await fetchAdminChannelModels(channel.id);
            await reload();
            await onChanged();
            if (result.models.length === 0) message.warning("上游没有返回可用模型");
            else if (result.added > 0) message.success(`已拉取 ${result.models.length} 个模型，新增 ${result.added} 个待配置模型`);
            else message.info(`已拉取 ${result.models.length} 个模型，没有需要新增的模型`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "拉取模型失败");
        } finally {
            setFetching(false);
        }
    };

    const startCreate = () => {
        setEditing(null);
        form.setFieldsValue({ modelKey: "", displayName: "", capability: capabilityFromInterface(channel?.interfaceType), billingMode: "fixed_request", unitPrice: 0, enabled: true });
        setEditorOpen(true);
    };

    const startEdit = (item: ChannelModel) => {
        setEditing(item);
        form.setFieldsValue({ modelKey: item.modelKey, displayName: item.displayName, capability: item.capability, billingMode: item.billingMode, unitPrice: item.unitPriceMicrocredits / 1_000_000, enabled: item.enabled });
        setEditorOpen(true);
    };

    const save = async () => {
        const values = await form.validateFields();
        setSaving(true);
        try {
            const payload = {
                modelKey: values.modelKey.trim(),
                displayName: values.displayName?.trim() || values.modelKey.trim(),
                capability: values.capability,
                billingMode: values.billingMode,
                unitPriceMicrocredits: Math.round(values.unitPrice * 1_000_000),
                priceConfigured: true,
                enabled: values.enabled !== false,
            };
            if (editing) await updateAdminChannelModel(channel.id, editing.id, payload);
            else await createAdminChannelModel(channel.id, payload);
            await reload();
            await onChanged();
            setEditorOpen(false);
            setEditing(null);
            message.success(editing ? "模型配置已更新" : "模型已添加");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存模型失败");
        } finally {
            setSaving(false);
        }
    };

    const remove = async (item: ChannelModel) => {
        try {
            await deleteAdminChannelModel(channel.id, item.id);
            await reload();
            await onChanged();
            message.success("模型已删除");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "删除模型失败");
        }
    };

    const columns: ColumnsType<ChannelModel> = [
        {
            title: "模型",
            render: (_, item) => (
                <div>
                    <div className="font-medium">{item.displayName || item.modelKey}</div>
                    <div className="text-xs text-foreground/45">{item.modelKey}</div>
                </div>
            ),
        },
        { title: "能力", dataIndex: "capability", width: 90, render: capabilityLabel },
        { title: "计费", width: 165, render: (_, item) => (item.priceConfigured ? `${formatCredits(item.unitPriceMicrocredits)} 积分 / ${item.billingMode === "per_second" ? "秒" : "次"}` : <Tag color="orange">未配置价格</Tag>) },
        { title: "版本", dataIndex: "priceVersion", width: 75, render: (value) => `v${value}` },
        { title: "状态", dataIndex: "enabled", width: 85, render: (enabled) => (enabled ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>) },
        {
            title: "操作",
            width: 120,
            render: (_, item) => (
                <Space>
                    <Button size="small" onClick={() => startEdit(item)}>编辑</Button>
                    <Popconfirm title="删除模型" description="删除后模型不再显示，历史账单仍会保留。该操作不能在页面恢复。" okText="删除" cancelText="取消" onConfirm={() => void remove(item)}>
                        <Button size="small" danger title="删除模型" aria-label="删除模型" icon={<Trash2 className="size-3.5" />} />
                    </Popconfirm>
                </Space>
            ),
        },
    ];

    const filteredItems = items.filter((item) => {
        const query = keyword.trim().toLowerCase();
        if (query && !`${item.modelKey} ${item.displayName}`.toLowerCase().includes(query)) return false;
        if (capability !== "all" && item.capability !== capability) return false;
        if (status === "enabled" && !item.enabled) return false;
        if (status === "disabled" && item.enabled) return false;
        return true;
    });

    return (
        <div>
            <div className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                    <Button aria-label="返回系统渠道" icon={<ArrowLeft className="size-4" />} onClick={onClose} />
                    <div className="min-w-0">
                        <h2 className="truncate text-lg font-semibold">{channel.name} / 模型管理</h2>
                        <p className="mt-1 text-xs text-foreground/50">维护模型能力、计费单位、积分单价与启用状态。</p>
                    </div>
                </div>
                <Space wrap>
                    <Button loading={fetching} icon={<RefreshCw className="size-4" />} onClick={() => void fetchModels()}>
                        拉取模型
                    </Button>
                    <Button type="primary" icon={<Plus className="size-4" />} onClick={startCreate}>
                        新增模型
                    </Button>
                </Space>
            </div>
            <ListToolbar active={Boolean(keyword || capability !== "all" || status !== "all")} onReset={() => { setKeyword(""); setCapability("all"); setStatus("all"); setPage(1); }}>
                <Input allowClear className="app-list-search" prefix={<Search className="size-4 text-foreground/40" />} value={keyword} placeholder="搜索模型标识或显示名称" onChange={(event) => { setKeyword(event.target.value); setPage(1); }} />
                <Select className="w-32" value={capability} onChange={(value) => { setCapability(value); setPage(1); }} options={[{ label: "全部能力", value: "all" }, { label: "文本", value: "text" }, { label: "图片", value: "image" }, { label: "视频", value: "video" }, { label: "音频", value: "audio" }]} />
                <Select className="w-32" value={status} onChange={(value) => { setStatus(value); setPage(1); }} options={[{ label: "全部状态", value: "all" }, { label: "已启用", value: "enabled" }, { label: "已停用", value: "disabled" }]} />
            </ListToolbar>
            <TableSurface>
                <Table
                    className="app-data-table"
                    rowKey="id"
                    size="middle"
                    loading={loading}
                    columns={columns}
                    dataSource={filteredItems}
                    pagination={{ current: page, pageSize, total: filteredItems.length, showSizeChanger: true, pageSizeOptions: [20, 50, 100], showTotal: (total, range) => `${range[0]}-${range[1]} / 共 ${total} 个模型`, onChange: (nextPage, nextPageSize) => { setPage(nextPageSize !== pageSize ? 1 : nextPage); setPageSize(nextPageSize); } }}
                    scroll={{ x: 760 }}
                />
            </TableSurface>
            <Drawer title={editing ? "编辑模型" : "新增模型"} open={editorOpen} size="min(520px, 100vw)" onClose={() => setEditorOpen(false)} styles={{ body: { paddingBottom: 88 } }} extra={editing ? <Button size="small" icon={<Plus className="size-3.5" />} onClick={startCreate}>新增</Button> : null}>
                <Form form={form} layout="vertical" requiredMark={false}>
                    <Form.Item name="modelKey" label="模型标识" rules={[{ required: true, message: "请输入模型标识" }]}>
                        <Input placeholder="gpt-image-2" />
                    </Form.Item>
                    <Form.Item name="displayName" label="显示名称">
                        <Input placeholder="不填则使用模型标识" />
                    </Form.Item>
                    <Form.Item name="capability" label="能力" rules={[{ required: true }]}>
                        <Select onChange={(value) => { if (value !== "video") form.setFieldValue("billingMode", "fixed_request"); }} options={[{ label: "文本", value: "text" }, { label: "图片", value: "image" }, { label: "视频", value: "video" }, { label: "音频", value: "audio" }]} />
                    </Form.Item>
                    <Form.Item name="billingMode" label="计费方式" rules={[{ required: true }]}>
                        <Segmented block options={[{ label: "按次计费", value: "fixed_request" }, { label: "按秒计费", value: "per_second", disabled: modelCapability !== "video" }]} />
                    </Form.Item>
                    <Form.Item name="unitPrice" label={billingMode === "per_second" ? "每秒消耗积分" : "每次消耗积分"} rules={[{ required: true, message: "请输入积分价格" }]}>
                        <InputNumber style={{ width: "100%" }} min={0} max={1_000_000} precision={6} step={0.1} />
                    </Form.Item>
                    <Form.Item name="enabled" label="启用" valuePropName="checked">
                        <Switch />
                    </Form.Item>
                    <Button type="primary" block loading={saving} onClick={() => void save()}>{editing ? "保存修改" : "添加模型"}</Button>
                </Form>
            </Drawer>
        </div>
    );
}

function capabilityFromInterface(value?: ModelChannel["interfaceType"]): ChannelModel["capability"] {
    if (value === "openai-image") return "image";
    if (value === "newapi" || value === "newapi-channel-1" || value === "newapi-channel-2" || value === "xai-video") return "video";
    return "text";
}

function capabilityLabel(value: ChannelModel["capability"]) {
    return { text: "文本", image: "图片", video: "视频", audio: "音频" }[value];
}

function formatCredits(value: number) {
    return (value / 1_000_000).toLocaleString("zh-CN", { maximumFractionDigits: 6 });
}
