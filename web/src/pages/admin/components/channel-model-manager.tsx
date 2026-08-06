import { useEffect, useState, type ReactNode } from "react";
import { App, Button, Drawer, Form, Input, InputNumber, Popconfirm, Segmented, Select, Space, Switch, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { AudioLines, Check, Film, Flame, FlaskConical, Image, MessageSquareText, Network, Plus, RefreshCw, Search, Sparkles, Trash2 } from "lucide-react";

import { ListToolbar, TableSurface } from "@/components/layout/workspace-page";
import { ModelIcon } from "@/components/model-picker";
import { cn } from "@/lib/utils";
import { MODEL_PROTOCOLS, modelProtocolCapability, modelProtocolDefinition, modelProtocolLabel, type ModelProtocol, type ModelProtocolDefinition } from "@/lib/model-protocols";
import { createAdminChannelModel, deleteAdminChannelModel, fetchAdminChannelModels, listAdminChannelModels, testAdminChannelModel, updateAdminChannelModel, type ChannelModel } from "@/services/api/wallet";
import type { ModelChannel } from "@/stores/use-config-store";
import { AdminPageFrame } from "./admin-shell";

type EditableCapability = Exclude<ChannelModel["capability"], "">;

type FormValues = {
    modelKey: string;
    displayName?: string;
    capability: EditableCapability;
    protocol: ModelProtocol;
    billingMode: ChannelModel["billingMode"];
    unitPrice: number;
    inputTokenPrice: number;
    outputTokenPrice: number;
    cachedTokenPrice: number;
    enabled: boolean;
};

export function ChannelModelManager({ channel, onClose, onChanged }: { channel: ModelChannel; onClose: () => void; onChanged: () => void | Promise<void> }) {
    const { message } = App.useApp();
    const [items, setItems] = useState<ChannelModel[]>([]);
    const [editing, setEditing] = useState<ChannelModel | null>(null);
    const [loading, setLoading] = useState(false);
    const [fetching, setFetching] = useState(false);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [editorOpen, setEditorOpen] = useState(false);
    const [keyword, setKeyword] = useState("");
    const [capability, setCapability] = useState<ChannelModel["capability"] | "all">("all");
    const [status, setStatus] = useState<"all" | "enabled" | "disabled">("all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [form] = Form.useForm<FormValues>();
    const billingMode = Form.useWatch("billingMode", form) || "fixed_request";
    const modelCapability = Form.useWatch("capability", form);
    const modelKey = Form.useWatch("modelKey", form) || "";

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
        form.setFieldsValue({ modelKey: "", displayName: "", capability: "text", protocol: "chat-completion", billingMode: "fixed_request", unitPrice: 0, inputTokenPrice: 0, outputTokenPrice: 0, cachedTokenPrice: 0, enabled: true });
        setEditorOpen(true);
    };

    const startEdit = (item: ChannelModel) => {
        setEditing(item);
        form.setFieldsValue({ modelKey: item.modelKey, displayName: item.displayName, capability: item.capability || undefined, protocol: item.protocol, billingMode: item.billingMode, unitPrice: item.unitPriceMicrocredits / 1_000_000, inputTokenPrice: item.inputTokenPriceMicrocredits / 1_000_000, outputTokenPrice: item.outputTokenPriceMicrocredits / 1_000_000, cachedTokenPrice: item.cachedTokenPriceMicrocredits / 1_000_000, enabled: item.enabled });
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
                protocol: values.protocol,
                billingMode: values.billingMode,
                unitPriceMicrocredits: Math.round(values.unitPrice * 1_000_000),
                inputTokenPriceMicrocredits: Math.round((values.inputTokenPrice || 0) * 1_000_000),
                outputTokenPriceMicrocredits: Math.round((values.outputTokenPrice || 0) * 1_000_000),
                cachedTokenPriceMicrocredits: Math.round((values.cachedTokenPrice || 0) * 1_000_000),
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

    const testModel = async () => {
        const values = await form.validateFields(["modelKey", "capability", "protocol"]);
        setTesting(true);
        try {
            const result = await testAdminChannelModel(channel.id, {
                modelKey: values.modelKey.trim(),
                capability: values.capability,
                protocol: values.protocol,
            });
            message.success(`模型测试通过，耗时 ${(result.durationMs / 1000).toFixed(2)} 秒`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "模型测试失败");
        } finally {
            setTesting(false);
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

    const handleFormValuesChange = (changed: Partial<FormValues>) => {
        if (!changed.capability) return;
        const currentBillingMode = form.getFieldValue("billingMode") as ChannelModel["billingMode"] | undefined;
        if ((currentBillingMode === "per_second" && changed.capability !== "video") || (currentBillingMode === "token" && changed.capability !== "text")) {
            form.setFieldValue("billingMode", "fixed_request");
        }
        const current = form.getFieldValue("protocol") as ModelProtocol | undefined;
        if (modelProtocolCapability(current) !== changed.capability) {
            form.setFieldValue("protocol", MODEL_PROTOCOLS.find((item) => item.capability === changed.capability)?.value);
        }
    };

    const columns: ColumnsType<ChannelModel> = [
        {
            title: "模型",
            render: (_, item) => (
                <div className="flex min-w-0 items-center gap-2.5">
                    <span className="grid size-8 shrink-0 place-items-center rounded-md border border-border/70 bg-muted/35"><ModelIcon model={item.modelKey} /></span>
                    <div className="min-w-0">
                        <div className="truncate font-medium">{item.displayName || item.modelKey}</div>
                        <div className="truncate text-xs text-foreground/45">{item.modelKey}</div>
                    </div>
                </div>
            ),
        },
        { title: "能力", dataIndex: "capability", width: 90, render: capabilityLabel },
        { title: "请求协议", dataIndex: "protocol", width: 230, render: (value: ModelProtocol) => value ? <div><div className="text-xs font-medium">{modelProtocolLabel(value)}</div><div className="truncate text-[var(--fs-tiny)] text-foreground/45">{modelProtocolDefinition(value)?.create}</div></div> : <Tag color="orange">待配置</Tag> },
        { title: "计费", width: 220, render: (_, item) => (item.priceConfigured ? billingSummary(item) : <Tag color="orange">未配置价格</Tag>) },
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
        <AdminPageFrame
            title={`${channel.name} / 模型管理`}
            description="维护模型能力、请求协议、计费与启用状态"
            back={{ label: "返回系统渠道", onClick: onClose }}
            actions={<Space wrap><Button loading={fetching} icon={<RefreshCw className="size-4" />} onClick={() => void fetchModels()}>拉取模型</Button><Button type="primary" icon={<Plus className="size-4" />} onClick={startCreate}>新增模型</Button></Space>}
        >
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
                    scroll={{ x: 990 }}
                />
            </TableSurface>
            <Drawer title={editing ? "编辑模型" : "新增模型"} open={editorOpen} size="min(720px, 100vw)" onClose={() => setEditorOpen(false)} styles={{ body: { paddingBottom: 88 } }} extra={editing ? <Button size="small" icon={<Plus className="size-3.5" />} onClick={startCreate}>新增</Button> : null}>
                <Form form={form} layout="vertical" requiredMark={false} onValuesChange={handleFormValuesChange}>
                    <Form.Item name="modelKey" label="模型标识" rules={[{ required: true, message: "请输入模型标识" }]}>
                        <Input prefix={<span className="grid size-6 place-items-center"><ModelIcon model={modelKey} /></span>} placeholder="例如：deepseek-chat、gpt-5、glm-4.5" />
                    </Form.Item>
                    <Form.Item name="displayName" label="显示名称">
                        <Input placeholder="不填则使用模型标识" />
                    </Form.Item>
                    <Form.Item name="capability" label="能力" rules={[{ required: true }]}>
                        <CapabilityCardPicker />
                    </Form.Item>
                    <Form.Item name="protocol" label="请求协议" rules={[{ required: true, message: "请选择模型请求协议" }]}>
                        <ProtocolCardPicker capability={modelCapability} />
                    </Form.Item>
                    <Form.Item name="billingMode" label="计费方式" rules={[{ required: true }]}>
                        <Segmented block options={[{ label: "按次计费", value: "fixed_request" }, { label: "按秒计费", value: "per_second", disabled: modelCapability !== "video" }, { label: "Token 计费", value: "token", disabled: modelCapability !== "text" }]} />
                    </Form.Item>
                    {billingMode === "token" ? (
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                            <Form.Item name="inputTokenPrice" label="输入 / 百万 Token" rules={[{ required: true, message: "请输入输入价格" }]}>
                                <InputNumber style={{ width: "100%" }} min={0} max={1_000_000} precision={6} step={0.1} />
                            </Form.Item>
                            <Form.Item name="outputTokenPrice" label="输出 / 百万 Token" rules={[{ required: true, message: "请输入输出价格" }]}>
                                <InputNumber style={{ width: "100%" }} min={0} max={1_000_000} precision={6} step={0.1} />
                            </Form.Item>
                            <Form.Item name="cachedTokenPrice" label="缓存 / 百万 Token" rules={[{ required: true, message: "请输入缓存价格" }]}>
                                <InputNumber style={{ width: "100%" }} min={0} max={1_000_000} precision={6} step={0.1} />
                            </Form.Item>
                        </div>
                    ) : (
                        <Form.Item name="unitPrice" label={billingMode === "per_second" ? "每秒消耗积分" : "每次消耗积分"} rules={[{ required: true, message: "请输入积分价格" }]}>
                            <InputNumber style={{ width: "100%" }} min={0} max={1_000_000} precision={6} step={0.1} />
                        </Form.Item>
                    )}
                    <Form.Item name="enabled" label="启用" valuePropName="checked">
                        <Switch />
                    </Form.Item>
                    <div className="mb-2 text-xs text-foreground/45">
                        测试会向上游发起真实请求并可能产生供应商费用{modelCapability === "video" ? "，视频测试可能需要数分钟" : ""}。
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <Button icon={<FlaskConical className="size-4" />} loading={testing} disabled={saving} onClick={() => void testModel()}>测试模型</Button>
                        <Button type="primary" loading={saving} disabled={testing} onClick={() => void save()}>{editing ? "保存修改" : "添加模型"}</Button>
                    </div>
                </Form>
            </Drawer>
        </AdminPageFrame>
    );
}

const capabilityChoices: Array<{
    value: EditableCapability;
    label: string;
    description: string;
    icon: ReactNode;
    brands: string[];
}> = [
    { value: "text", label: "文本", description: "对话与推理", icon: <MessageSquareText className="size-4" />, brands: ["openai", "deepseek", "glm"] },
    { value: "image", label: "图片", description: "生成与编辑", icon: <Image className="size-4" />, brands: ["openai", "gemini"] },
    { value: "video", label: "视频", description: "生成与续写", icon: <Film className="size-4" />, brands: ["grok", "gemini"] },
    { value: "audio", label: "音频", description: "语音与音效", icon: <AudioLines className="size-4" />, brands: ["openai"] },
];

function CapabilityCardPicker({ value, onChange }: { value?: EditableCapability; onChange?: (value: EditableCapability) => void }) {
    return (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="模型能力">
            {capabilityChoices.map((item) => {
                const selected = value === item.value;
                return (
                    <button
                        key={item.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        className={cn(
                            "relative flex min-h-28 min-w-0 flex-col rounded-md border p-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                            selected ? "border-primary/70 bg-primary/5" : "border-border/75 bg-background hover:border-foreground/25 hover:bg-muted/30",
                        )}
                        onClick={() => onChange?.(item.value)}
                    >
                        <span className={cn("grid size-8 place-items-center rounded-md", selected ? "bg-primary text-primary-foreground" : "bg-muted text-foreground/65")}>{item.icon}</span>
                        {selected ? <span className="absolute right-2.5 top-2.5 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground"><Check className="size-3" /></span> : null}
                        <span className="mt-2 block text-sm font-semibold">{item.label}</span>
                        <span className="block text-xs text-foreground/48">{item.description}</span>
                        <BrandIconRow models={item.brands} className="mt-auto pt-2" />
                    </button>
                );
            })}
        </div>
    );
}

function ProtocolCardPicker({ capability, value, onChange }: { capability?: EditableCapability; value?: ModelProtocol; onChange?: (value: ModelProtocol) => void }) {
    const protocols = MODEL_PROTOCOLS.filter((item) => item.capability === capability);
    return (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="模型请求协议">
            {protocols.map((protocol) => {
                const selected = value === protocol.value;
                return (
                    <button
                        key={protocol.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        className={cn(
                            "relative flex min-h-28 min-w-0 flex-col rounded-md border p-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                            selected ? "border-primary/70 bg-primary/5" : "border-border/75 bg-background hover:border-foreground/25 hover:bg-muted/30",
                        )}
                        onClick={() => onChange?.(protocol.value)}
                    >
                        <div className="flex min-w-0 items-start gap-2.5 pr-6">
                            <ProtocolBrandMark protocol={protocol} />
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-semibold">{protocol.label}</div>
                                <div className="mt-0.5 truncate font-mono text-[var(--fs-tiny)] text-foreground/48">{protocol.create}</div>
                            </div>
                        </div>
                        {selected ? <span className="absolute right-2.5 top-2.5 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground"><Check className="size-3" /></span> : null}
                        <div className="mt-2 line-clamp-2 text-xs leading-5 text-foreground/58">{protocol.media}</div>
                        <div className="mt-auto flex items-center justify-between gap-2 pt-2 text-[var(--fs-tiny)] text-foreground/42">
                            <span className="truncate">{protocol.contentType}</span>
                            {protocol.poll ? <span className="shrink-0">异步轮询</span> : <span className="shrink-0">同步响应</span>}
                        </div>
                    </button>
                );
            })}
        </div>
    );
}

function ProtocolBrandMark({ protocol }: { protocol: ModelProtocolDefinition }) {
    if (protocol.value === "chat-completion") return <BrandIconRow models={["openai", "deepseek", "glm"]} compact />;
    if (protocol.value.startsWith("volcengine-jimeng-")) return <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-foreground/65"><Sparkles className="size-4" /></span>;
    if (protocol.value.startsWith("volcengine-")) return <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-foreground/65"><Flame className="size-4" /></span>;
    if (protocol.value.startsWith("newapi-channel-")) return <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-foreground/65"><Network className="size-4" /></span>;
    const brand = protocol.value === "gemini-veo" ? "gemini" : protocol.value === "xai-video" ? "grok" : "openai";
    return <BrandIconRow models={[brand]} compact />;
}

function BrandIconRow({ models, compact = false, className }: { models: string[]; compact?: boolean; className?: string }) {
    return (
        <span className={cn("flex items-center", compact ? "shrink-0 -space-x-1" : "-space-x-1", className)} aria-hidden="true">
            {models.map((model) => (
                <span key={model} className={cn("grid shrink-0 place-items-center rounded-md border border-border/70 bg-background", compact ? "size-8" : "size-6")} title={modelBrandLabel(model)}>
                    <ModelIcon model={model} />
                </span>
            ))}
        </span>
    );
}

function modelBrandLabel(model: string) {
    const labels: Record<string, string> = {
        openai: "OpenAI",
        deepseek: "DeepSeek",
        glm: "智谱 GLM",
        gemini: "Google Gemini",
        grok: "xAI Grok",
    };
    return labels[model] || model;
}

function capabilityLabel(value: ChannelModel["capability"]) {
    return { text: "文本", image: "图片", video: "视频", audio: "音频", "": "待配置" }[value];
}

function billingSummary(item: ChannelModel) {
    if (item.billingMode !== "token") {
        return `${formatCredits(item.unitPriceMicrocredits)} 积分 / ${item.billingMode === "per_second" ? "秒" : "次"}`;
    }
    return (
        <div className="text-xs leading-5">
            <div>输入 {formatCredits(item.inputTokenPriceMicrocredits)} / 百万</div>
            <div>输出 {formatCredits(item.outputTokenPriceMicrocredits)} / 百万</div>
            <div>缓存 {formatCredits(item.cachedTokenPriceMicrocredits)} / 百万</div>
        </div>
    );
}

function formatCredits(value: number) {
    return (value / 1_000_000).toLocaleString("zh-CN", { maximumFractionDigits: 6 });
}
