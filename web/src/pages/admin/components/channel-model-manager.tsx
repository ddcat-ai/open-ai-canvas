import { useEffect, useState } from "react";
import { App, Button, Checkbox, Input, Modal, Popconfirm, Select, Space } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";

import { PaginationBar } from "@/pages/admin/components/admin-ui";
import { ModelIcon } from "@/components/model-picker";
import { modelProtocolDefinition, modelProtocolLabel, type ModelProtocol } from "@/lib/model-protocols";
import { fetchPluginProviderCatalog } from "@/services/api/plugin-catalog";
import { deleteAdminChannelModel, deleteAdminChannelModels, fetchAdminChannelModels, importAdminChannelModels, listAdminChannelModels, type ChannelModel } from "@/services/api/wallet";
import type { ModelChannel } from "@/stores/use-config-store";
import { ChannelModelEditor } from "./channel-model-editor";
import { AdminBatchBar, AdminDataTable, AdminFilterChip, AdminStatusBadge, AdminTableEmpty } from "./admin-ui";
import { ChannelOrderDialog } from "./channel-order-dialog";
import { ChannelModelCostSummary } from "./channel-model-cost-summary";
import { ChannelModelRepriceDialog } from "./channel-model-reprice-dialog";

export function ChannelModelManager({ channel, onChanged }: { channel: ModelChannel; onChanged: () => void | Promise<void> }) {
    const { message, modal } = App.useApp();
    const [items, setItems] = useState<ChannelModel[]>([]);
    const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
    const [deletingSelected, setDeletingSelected] = useState(false);
    const [repriceItems, setRepriceItems] = useState<ChannelModel[]>([]);
    const [editing, setEditing] = useState<ChannelModel | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
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
        setLoadError("");
        try {
            const models = (await listAdminChannelModels(channel.id)).models;
            const availableIDs = new Set(models.map((item) => item.id));
            setItems(models);
            setSelectedModelIds((current) => current.filter((id) => availableIDs.has(id)));
        } catch (error) {
            setLoadError(error instanceof Error ? error.message : "读取渠道模型失败");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void reload();
        void loadProtocols();
        setEditing(null);
        setEditorOpen(false);
        setSelectedModelIds([]);
        setRepriceItems([]);
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

    const confirmBatchRemove = () => {
        if (!selectedModelIds.length) return;
        const count = selectedModelIds.length;
        modal.confirm({
            title: `删除已选的 ${count} 个模型？`,
            content: "删除后模型不再显示，且不能在页面恢复。只要其中任一模型仍被前台供应线路或进行中任务使用，本次就不会删除任何模型。",
            okText: "批量删除",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: async () => {
                setDeletingSelected(true);
                try {
                    const result = await deleteAdminChannelModels(channel.id, selectedModelIds);
                    setSelectedModelIds([]);
                    setPage(1);
                    await reload();
                    await onChanged();
                    message.success(`已删除 ${result.deleted} 个模型`);
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "批量删除模型失败");
                } finally {
                    setDeletingSelected(false);
                }
            },
        });
    };
    const columns: ColumnsType<ChannelModel> = [
        {
            title: "模型",
            width: 240,
            render: (_, item) => (
                <div className="flex min-w-0 items-center gap-2.5">
                    <span className="admin-channel-model-icon">
                        <ModelIcon model={item.modelKey} icon={item.icon} />
                    </span>
                    <div className="min-w-0">
                        <div className="truncate font-medium" title={item.displayName || item.modelKey}>
                            {item.displayName || item.modelKey}
                        </div>
                        <div className="admin-monospace truncate text-xs text-foreground/45">{item.modelKey}</div>
                        {item.channelLabel ? <div className="truncate text-xs text-foreground/60">渠道展示名：{item.channelLabel}</div> : null}
                        {item.providerModelKey && item.providerModelKey !== item.modelKey ? <div className="admin-monospace truncate text-xs text-foreground/35">上游：{item.providerModelKey}</div> : null}
                    </div>
                </div>
            ),
        },
        { title: "能力", dataIndex: "capability", width: 90, render: capabilityLabel },
        {
            title: "请求协议",
            dataIndex: "protocol",
            width: 190,
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
        { title: "规格成本价 / 销售价 / 利润率", width: 310, render: (_, item) => <ChannelModelCostSummary item={item} /> },
        { title: "版本", dataIndex: "priceVersion", width: 75, render: (value) => `v${value}` },
        { title: "状态", dataIndex: "enabled", width: 85, render: (enabled) => <AdminStatusBadge label={enabled ? "启用" : "停用"} tone={enabled ? "success" : "neutral"} /> },
        {
            title: "操作",
            width: 120,
            fixed: "right",
            render: (_, item) => (
                <Space>
                    <Button size="small" icon={<Pencil className="size-3.5" />} disabled={deletingSelected} onClick={() => startEdit(item)}>
                        编辑
                    </Button>
                    <Popconfirm title="删除模型" description="已被前台供应线路或进行中任务使用的模型不能删除；删除后模型不再显示，且不能在页面恢复。" okText="删除" cancelText="取消" onConfirm={() => void remove(item)}>
                        <Button size="small" danger disabled={deletingSelected} title="删除模型" aria-label="删除模型" icon={<Trash2 className="size-3.5" />} />
                    </Popconfirm>
                </Space>
            ),
        },
    ];

    const filteredItems = items.filter((item) => {
        const query = keyword.trim().toLowerCase();
        if (query && !`${item.modelKey} ${item.providerModelKey} ${item.displayName} ${item.channelLabel || ""}`.toLowerCase().includes(query)) return false;
        if (capability !== "all" && item.capability !== capability) return false;
        if (status === "enabled" && !item.enabled) return false;
        if (status === "disabled" && item.enabled) return false;
        return true;
    });
    const pagedItems = filteredItems.slice((page - 1) * pageSize, page * pageSize);
    const existingFetchModelKeys = new Set(items.flatMap((item) => [item.modelKey, item.providerModelKey].filter(Boolean).map(normalizeFetchModelKey)));
    const selectedNewFetchModels = selectedFetchModels.filter((name) => !existingFetchModelKeys.has(normalizeFetchModelKey(name)));
    const selectedExistingFetchCount = selectedFetchModels.length - selectedNewFetchModels.length;
    const allFetchModelsSelected = fetchPreviewModels.length > 0 && fetchPreviewModels.every((name) => selectedFetchModels.includes(name));
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
        <div className="admin-channel-model-manager">
            <div className="admin-channel-model-toolbar">
                <div>
                    <h3 className="admin-channel-model-heading">
                        模型管理 <span className="admin-channel-count">{items.length}</span>
                    </h3>
                    <p className="admin-channel-model-hint">点击“自定义排序”调整模型展示顺序；规格展示成本价 / 销售价及利润率，勾选模型可统一调价</p>
                </div>
                <Space wrap>
                    <ChannelOrderDialog
                        channelId={channel.id}
                        onSaved={async () => {
                            await reload();
                            await onChanged();
                        }}
                    />
                    <Button loading={fetching} icon={<RefreshCw className="size-4" />} onClick={() => void fetchModels()}>
                        拉取模型
                    </Button>
                    <Button type="primary" icon={<Plus className="size-4" />} onClick={startCreate}>
                        新增模型
                    </Button>
                </Space>
            </div>
            {loadError ? (
                <div className="admin-channel-load-error" role="alert">
                    <span>{loadError}</span>
                    <Button size="small" onClick={() => void reload()}>
                        重新加载模型
                    </Button>
                </div>
            ) : null}
            <AdminDataTable
                empty={
                    <AdminTableEmpty
                        title={loadError ? "模型列表加载失败" : items.length ? "没有匹配的模型" : "这个渠道还没有模型"}
                        description={loadError ? "请重试加载，暂时无法确认模型列表。" : items.length ? "调整搜索或筛选条件后重试。" : "点击上方“拉取模型”从上游导入，或手动新增模型。"}
                    />
                }
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
                batchActions={
                    <AdminBatchBar count={selectedModelIds.length} onClear={() => setSelectedModelIds([])}>
                        <Button size="small" disabled={deletingSelected || loading || Boolean(loadError)} onClick={() => setRepriceItems(items.filter((item) => selectedModelIds.includes(item.id)))}>
                            统一调价
                        </Button>
                        <Button danger size="small" icon={<Trash2 className="size-3.5" />} loading={deletingSelected} onClick={confirmBatchRemove}>
                            批量删除
                        </Button>
                    </AdminBatchBar>
                }
                table={{
                    className: "app-data-table",
                    rowKey: "id",
                    size: "small",
                    loading,
                    rowSelection: {
                        selectedRowKeys: selectedModelIds,
                        preserveSelectedRowKeys: true,
                        onChange: (keys) => {
                            const next = keys.map(String);
                            if (next.length > 100) message.warning("单次最多选择 100 个模型");
                            setSelectedModelIds(next.slice(0, 100));
                        },
                    },
                    columns,
                    dataSource: pagedItems,
                    pagination: false,
                    scroll: { x: 1090 },
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
            {repriceItems.length > 0 && <ChannelModelRepriceDialog channelId={channel.id} channelName={channel.name} items={repriceItems} onClose={() => setRepriceItems([])} onSaved={async () => {
                setSelectedModelIds([]);
                await reload();
                await onChanged();
            }} />}
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
                    <p className="m-0 text-sm text-foreground/65">上游共返回 {fetchPreviewModels.length} 个模型。默认已全选，可批量全选或取消全选；已存在的模型不会重复导入。</p>
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/70 bg-muted/25 px-3 py-2">
                        <span className="text-sm font-medium text-foreground/70" aria-live="polite">
                            已选择 {selectedFetchModels.length} / {fetchPreviewModels.length} 个模型
                        </span>
                        <Space size={4}>
                            <Button size="small" disabled={importing || allFetchModelsSelected} onClick={() => setSelectedFetchModels(fetchPreviewModels)}>
                                全选
                            </Button>
                            <Button size="small" disabled={importing || selectedFetchModels.length === 0} onClick={() => setSelectedFetchModels([])}>
                                取消全选
                            </Button>
                        </Space>
                    </div>
                    <div className="max-h-[min(60vh,520px)] overflow-y-auto rounded-md border border-border/70 p-3">
                        <Checkbox.Group
                            className="channel-model-import-picker grid w-full grid-cols-1 gap-2 sm:grid-cols-2"
                            value={selectedFetchModels}
                            options={fetchModelOptions}
                            disabled={importing}
                            onChange={(values) => setSelectedFetchModels(values as string[])}
                        />
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
        </div>
    );
}

function capabilityLabel(value: ChannelModel["capability"]) {
    return { text: "文本", image: "图片", video: "视频", audio: "音频", "": "待配置" }[value];
}

function normalizeFetchModelKey(value: string) {
    return value
        .trim()
        .replace(/^models\//, "")
        .toLowerCase();
}
