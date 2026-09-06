import { useEffect, useState } from "react";
import { App, Button, Checkbox, Input, Modal, Popconfirm, Select, Space } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Plus, RefreshCw, Search, Trash2 } from "lucide-react";

import { PaginationBar } from "@/components/layout/workspace-page";
import { ModelIcon } from "@/components/model-picker";
import { modelProtocolDefinition, modelProtocolLabel, type ModelProtocol } from "@/lib/model-protocols";
import { fetchPluginProviderCatalog } from "@/services/api/plugin-catalog";
import { deleteAdminChannelModel, fetchAdminChannelModels, importAdminChannelModels, listAdminChannelModels, type ChannelModel, type ChannelModelPriceTier } from "@/services/api/wallet";
import type { ModelChannel } from "@/stores/use-config-store";
import { ChannelModelEditor } from "./channel-model-editor";
import { AdminPageFrame } from "./admin-shell";
import { AdminDataTable, AdminFilterChip, AdminStatusBadge } from "./admin-ui";

export function ChannelModelManager({ channel, onClose, onChanged }: { channel: ModelChannel; onClose: () => void; onChanged: () => void | Promise<void> }) {
    const { message } = App.useApp();
    const [items, setItems] = useState<ChannelModel[]>([]);
    const [editing, setEditing] = useState<ChannelModel | null>(null);
    const [loading, setLoading] = useState(false);
    const [fetching, setFetching] = useState(false);
    const [fetchPreviewOpen, setFetchPreviewOpen] = useState(false);
    const [fetchPreviewModels, setFetchPreviewModels] = useState<string[]>([]);
    const [selectedFetchModels, setSelectedFetchModels] = useState<string[]>([]);
    const [importing, setImporting] = useState(false);
    const [editorOpen, setEditorOpen] = useState(false);
    const [keyword, setKeyword] = useState("");
    const [capability, setCapability] = useState<ChannelModel["capability"] | "all">("all");
    const [status, setStatus] = useState<"all" | "enabled" | "disabled">("all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [availableProtocols, setAvailableProtocols] = useState<import("@/lib/model-protocols").ModelProtocolDefinition[]>([]);
    const [protocolLoading, setProtocolLoading] = useState(true);
    const [protocolError, setProtocolError] = useState("");
    const loadProtocols = async () => {
        setProtocolLoading(true);
        setProtocolError("");
        try {
            setAvailableProtocols(await fetchPluginProviderCatalog("admin.system-channel"));
        } catch (error) {
            setAvailableProtocols([]);
            setProtocolError(error instanceof Error ? error.message : "无法读取协议目录");
        } finally {
            setProtocolLoading(false);
        }
    };
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
        void loadProtocols();
        setEditing(null);
        setEditorOpen(false);
        resetFetchPreview();
        setKeyword("");
        setCapability("all");
        setStatus("all");
        setPage(1);
    }, [channel.id]);

    const fetchModels = async () => {
        setFetching(true);
        try {
            const result = await fetchAdminChannelModels(channel.id);
            if (result.models.length === 0) {
                message.warning("上游没有返回可用模型");
                return;
            }
            setFetchPreviewModels(result.models);
            setSelectedFetchModels(result.models);
            setFetchPreviewOpen(true);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "拉取模型失败");
        } finally {
            setFetching(false);
        }
    };

    const closeFetchPreview = () => {
        if (importing) return;
        resetFetchPreview();
    };

    const resetFetchPreview = () => {
        setFetchPreviewOpen(false);
        setFetchPreviewModels([]);
        setSelectedFetchModels([]);
    };

    const importSelectedModels = async () => {
        if (!selectedFetchModels.length) return;
        if (!selectedNewFetchModels.length) {
            message.info("当前勾选的模型均已存在，没有需要新增的模型");
            resetFetchPreview();
            return;
        }
        setImporting(true);
        try {
            const result = await importAdminChannelModels(channel.id, selectedFetchModels);
            await reload();
            await onChanged();
            resetFetchPreview();
            if (result.added > 0) message.success(`已导入 ${result.added} 个模型，新增模型仍需配置价格后启用`);
            else message.info("所选模型均已存在，没有新增模型");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "导入模型失败");
        } finally {
            setImporting(false);
        }
    };

    const startCreate = () => {
        setEditing(null);
        setEditorOpen(true);
    };
    const startEdit = (item: ChannelModel) => {
        setEditing(item);
        setEditorOpen(true);
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
                <div className="flex min-w-0 items-center gap-2.5">
                    <span className="grid size-8 shrink-0 place-items-center rounded-md border border-border/70 bg-muted/35">
                        <ModelIcon model={item.modelKey} icon={item.icon} />
                    </span>
                    <div className="min-w-0">
                        <div className="truncate font-medium">{item.displayName || item.modelKey}</div>
                        <div className="admin-monospace truncate text-xs text-foreground/45">{item.modelKey}</div>
                        {item.providerModelKey && item.providerModelKey !== item.modelKey ? <div className="admin-monospace truncate text-xs text-foreground/35">上游：{item.providerModelKey}</div> : null}
                    </div>
                </div>
            ),
        },
        { title: "能力", dataIndex: "capability", width: 90, render: capabilityLabel },
        {
            title: "请求协议",
            dataIndex: "protocol",
            width: 230,
            render: (value: ModelProtocol) =>
                value ? (
                    <div>
                        <div className="text-xs font-medium">{modelProtocolLabel(value, availableProtocols)}</div>
                        <div className="truncate text-[var(--fs-tiny)] text-foreground/45">{modelProtocolDefinition(value, availableProtocols)?.create}</div>
                    </div>
                ) : (
                    <AdminStatusBadge label="待配置" tone="warning" />
                ),
        },
        { title: "规格价格", width: 280, render: (_, item) => (item.priceConfigured ? billingSummary(item) : <AdminStatusBadge label="未配置价格" tone="warning" />) },
        { title: "版本", dataIndex: "priceVersion", width: 75, render: (value) => `v${value}` },
        { title: "状态", dataIndex: "enabled", width: 85, render: (enabled) => <AdminStatusBadge label={enabled ? "启用" : "停用"} tone={enabled ? "success" : "neutral"} /> },
        {
            title: "操作",
            width: 180,
            render: (_, item) => (
                <Space>
                    <Button size="small" onClick={() => startEdit(item)}>
                        编辑
                    </Button>
                    <Popconfirm title="删除模型" description="已被前台供应线路或进行中任务使用的模型不能删除；删除后模型不再显示，且不能在页面恢复。" okText="删除" cancelText="取消" onConfirm={() => void remove(item)}>
                        <Button size="small" danger title="删除模型" aria-label="删除模型" icon={<Trash2 className="size-3.5" />} />
                    </Popconfirm>
                </Space>
            ),
        },
    ];

    const filteredItems = items.filter((item) => {
        const query = keyword.trim().toLowerCase();
        if (query && !`${item.modelKey} ${item.providerModelKey} ${item.displayName}`.toLowerCase().includes(query)) return false;
        if (capability !== "all" && item.capability !== capability) return false;
        if (status === "enabled" && !item.enabled) return false;
        if (status === "disabled" && item.enabled) return false;
        return true;
    });
    const pagedItems = filteredItems.slice((page - 1) * pageSize, page * pageSize);
    const existingFetchModelKeys = new Set(items.map((item) => normalizeFetchModelKey(item.modelKey)));
    const selectedNewFetchModels = selectedFetchModels.filter((name) => !existingFetchModelKeys.has(normalizeFetchModelKey(name)));
    const selectedExistingFetchCount = selectedFetchModels.length - selectedNewFetchModels.length;
    const fetchModelOptions = fetchPreviewModels.map((name) => {
        const alreadyExists = existingFetchModelKeys.has(normalizeFetchModelKey(name));
        return {
            label: alreadyExists ? (
                <span className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 break-all">{name}</span>
                    <span className="shrink-0 text-xs text-foreground/45">已存在</span>
                </span>
            ) : (
                <span className="break-all">{name}</span>
            ),
            value: name,
        };
    });

    return (
        <AdminPageFrame
            title={`${channel.name} / 模型管理`}
            back={{ label: "返回系统渠道", onClick: onClose }}
            actions={
                <Space wrap>
                    <Button loading={fetching} icon={<RefreshCw className="size-4" />} onClick={() => void fetchModels()}>
                        拉取模型
                    </Button>
                    <Button type="primary" icon={<Plus className="size-4" />} onClick={startCreate}>
                        新增模型
                    </Button>
                </Space>
            }
        >
            <AdminDataTable
                toolbar={
                    <Input
                        allowClear
                        className="app-list-search"
                        prefix={<Search className="size-4 text-foreground/40" />}
                        value={keyword}
                        placeholder="搜索模型标识或显示名称"
                        onChange={(event) => {
                            setKeyword(event.target.value);
                            setPage(1);
                        }}
                    />
                }
                toolbarActiveFilters={
                    <>
                        {keyword ? (
                            <AdminFilterChip
                                label={`搜索：${keyword}`}
                                onRemove={() => {
                                    setKeyword("");
                                    setPage(1);
                                }}
                            />
                        ) : null}
                        {capability !== "all" ? (
                            <AdminFilterChip
                                label={`能力：${capability}`}
                                onRemove={() => {
                                    setCapability("all");
                                    setPage(1);
                                }}
                            />
                        ) : null}
                        {status !== "all" ? (
                            <AdminFilterChip
                                label={`状态：${status === "enabled" ? "已启用" : "已停用"}`}
                                onRemove={() => {
                                    setStatus("all");
                                    setPage(1);
                                }}
                            />
                        ) : null}
                    </>
                }
                toolbarActive={Boolean(keyword || capability !== "all" || status !== "all")}
                toolbarFilters={
                    <>
                        <Select
                            className="w-32"
                            value={capability}
                            onChange={(value) => {
                                setCapability(value);
                                setPage(1);
                            }}
                            options={[
                                { label: "全部能力", value: "all" },
                                { label: "文本", value: "text" },
                                { label: "图片", value: "image" },
                                { label: "视频", value: "video" },
                                { label: "音频", value: "audio" },
                            ]}
                        />
                        <Select
                            className="w-32"
                            value={status}
                            onChange={(value) => {
                                setStatus(value);
                                setPage(1);
                            }}
                            options={[
                                { label: "全部状态", value: "all" },
                                { label: "已启用", value: "enabled" },
                                { label: "已停用", value: "disabled" },
                            ]}
                        />
                    </>
                }
                onReset={() => {
                    setKeyword("");
                    setCapability("all");
                    setStatus("all");
                    setPage(1);
                }}
                table={{
                    className: "app-data-table",
                    rowKey: "id",
                    size: "small",
                    loading,
                    columns,
                    dataSource: pagedItems,
                    pagination: false,
                    scroll: { x: 990 },
                }}
                footer={
                    <PaginationBar
                        alwaysShow
                        current={page}
                        pageSize={pageSize}
                        total={filteredItems.length}
                        onChange={(nextPage, nextPageSize) => {
                            setPage(nextPageSize !== pageSize ? 1 : nextPage);
                            setPageSize(nextPageSize);
                        }}
                    />
                }
            />
            <Modal
                title="选择要导入的模型"
                open={fetchPreviewOpen}
                centered
                width={720}
                rootClassName="admin-modal-root admin-model-import-modal"
                onCancel={closeFetchPreview}
                maskClosable={!importing}
                closable={!importing}
                footer={[
                    <Button key="cancel" disabled={importing} onClick={closeFetchPreview}>
                        取消
                    </Button>,
                    <Button key="confirm" type="primary" loading={importing} disabled={!selectedFetchModels.length} onClick={() => void importSelectedModels()}>
                        确认导入
                    </Button>,
                ]}
            >
                <div className="space-y-3">
                    <p className="m-0 text-sm text-foreground/65">上游共返回 {fetchPreviewModels.length} 个模型。默认已全选，请取消本次不需要拉入的模型；已存在的模型不会重复导入。</p>
                    <div className="max-h-[min(60vh,520px)] overflow-y-auto rounded-md border border-border/70 p-3">
                        <Checkbox.Group className="channel-model-import-picker grid w-full grid-cols-1 gap-2 sm:grid-cols-2" value={selectedFetchModels} options={fetchModelOptions} onChange={(values) => setSelectedFetchModels(values as string[])} />
                    </div>
                    <div className="text-xs text-foreground/50">
                        {selectedNewFetchModels.length > 0 ? `将导入 ${selectedNewFetchModels.length} 个新模型` : "当前勾选的模型均已存在"}
                        {selectedExistingFetchCount > 0 ? `，另有 ${selectedExistingFetchCount} 个已存在模型已勾选` : ""}
                    </div>
                </div>
            </Modal>
            {editorOpen && (
                <ChannelModelEditor
                    channel={channel}
                    editing={editing}
                    protocols={availableProtocols}
                    protocolLoading={protocolLoading}
                    protocolError={protocolError}
                    onRetryProtocols={() => void loadProtocols()}
                    onClose={() => setEditorOpen(false)}
                    onSaved={async () => {
                        await reload();
                        await onChanged();
                    }}
                />
            )}
        </AdminPageFrame>
    );
}

function capabilityLabel(value: ChannelModel["capability"]) {
    return { text: "文本", image: "图片", video: "视频", audio: "音频", "": "待配置" }[value];
}

function billingSummary(item: ChannelModel) {
    const tiers = item.priceTiers?.filter((tier) => tier.enabled && tier.priceConfigured) || [];
    if (!tiers.length) return <AdminStatusBadge label="未配置价格" tone="warning" />;
    return (
        <div className="space-y-1 text-xs leading-5">
            {tiers.slice(0, 3).map((tier) => (
                <div key={tier.id}>{priceTierLabel(tier)}</div>
            ))}
            {tiers.length > 3 ? <div className="text-foreground/45">另有 {tiers.length - 3} 个规格价格档</div> : null}
        </div>
    );
}

function priceTierLabel(tier: ChannelModelPriceTier) {
    const selector = tier.selector || {};
    const specParts = [
        selector.operation && selector.operation !== "*" ? operationLabel(selector.operation) : "任意生成方式",
        selector.quality && selector.quality !== "*" ? selector.quality.toUpperCase() : "",
        selector.size && selector.size !== "*" ? selector.size : "",
        tier.resolution === "*" ? "" : tier.resolution.toUpperCase(),
        tier.videoSeconds ? `${tier.videoSeconds} 秒` : "",
        selector.imageCount && selector.imageCount !== "*" ? `${selector.imageCount} 张参考图` : "",
    ].filter(Boolean);
    const spec = specParts.length ? specParts.join(" / ") : "默认规格";
    if (tier.billingMode === "token") return `${spec} · ${formatCredits(tier.outputTokenPriceMicrocredits)} / 百万 Token`;
    return `${spec} · ${formatCredits(tier.unitPriceMicrocredits)} 积分 / ${tier.billingMode === "per_second" ? "秒" : "次"}`;
}

function operationLabel(operation: string) {
    return ({ text_to_image: "文生图", image_to_image: "图生图", text_to_video: "文生视频", image_to_video: "图生视频", video_to_video: "视频生视频", text_generation: "文本生成" } as Record<string, string>)[operation] || operation;
}

function formatCredits(value: number) {
    return (value / 1_000_000).toLocaleString("zh-CN", { maximumFractionDigits: 6 });
}

function normalizeFetchModelKey(value: string) {
    return value
        .trim()
        .replace(/^models\//, "")
        .toLowerCase();
}
