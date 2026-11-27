import { App, Button, Grid, Space } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ListOrdered, Pencil, Power, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";

import { ModelIcon } from "@/components/model-picker";
import { Select } from "@/components/ui/base/select";
import { type ModelProtocolDefinition } from "@/lib/model-protocols";
import { fetchPluginProviderCatalog } from "@/services/api/plugin-catalog";
import { listAdminAllChannelModels, setAdminChannelModelEnabled, updateAdminAllChannelModels, type AdminChannelModelHealth, type AdminChannelModelListItem, type BatchChannelModelUpdate } from "@/services/api/wallet";
import { cn } from "@/lib/utils";
import { useAdminContext } from "../admin-context";
import type { ModelChannel } from "@/stores/use-config-store";
import { AdminBatchBar, AdminDataTable, AdminStatusBadge, AdminTableEmpty, PaginationBar } from "../components/admin-ui";
import { AdminSearchInput } from "../components/admin-search-input";
import { ChannelModelCostSummary } from "../components/channel-model-cost-summary";
import { ChannelModelDetailsCell } from "../components/channel-model-details-cell";
import { ChannelModelEditor } from "../components/channel-model-editor";
import { opensModelParameters } from "../components/channel-model-editor-form";
import { ChannelModelHealthCell, channelModelHealthKey } from "../components/channel-model-health";
import { ChannelModelRepriceDialog } from "../components/channel-model-reprice-dialog";
import { ChannelModelBatchEditDialog } from "../components/channel-model-batch-edit-dialog";
import { ModelGroupOrderDialog } from "./model-group-order-dialog";
import { GroupModelOrderDialog } from "./group-model-order-dialog";
import { useConfigStore } from "@/stores/use-config-store";
import { saveModelGroupOrder } from "@/services/api/model-group-order";

type StatusFilter = "all" | "enabled" | "disabled" | "unhealthy";

const capabilityOptions = [
    { label: "全部能力", value: "all" },
    { label: "文本", value: "text" },
    { label: "图片", value: "image" },
    { label: "视频", value: "video" },
    { label: "音频", value: "audio" },
];

/**
 * 跨渠道模型视图：按模型名称一次查遍全部系统渠道。
 * 同一模型在不同渠道的行相邻排列，便于直接比较价格、稳定性和启停状态。
 */
export function AllChannelModelsPanel({
    channels,
    health,
    healthLoading,
    onChanged,
    onOpenChannel,
}: {
    channels: ModelChannel[];
    health: Map<string, AdminChannelModelHealth>;
    healthLoading: boolean;
    onChanged: (propagateError?: boolean) => Promise<void>;
    onOpenChannel: (channelId: string) => void;
}) {
    const { message, modal } = App.useApp();
    const screens = Grid.useBreakpoint();
    const [searchParams, setSearchParams] = useSearchParams();
    const keyword = searchParams.get("q") || "";
    const capability = searchParams.get("capability") || "all";
    const status = (searchParams.get("modelStatus") as StatusFilter) || "all";
    const channelFilter = searchParams.get("modelChannel") || "all";
    const groupFilter = searchParams.get("displayGroup") || "";
    const [items, setItems] = useState<AdminChannelModelListItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [retry, setRetry] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(50);
    const [togglingId, setTogglingId] = useState<string | null>(null);
    const [editing, setEditing] = useState<AdminChannelModelListItem | null>(null);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [repriceItems, setRepriceItems] = useState<AdminChannelModelListItem[]>([]);
    const [batchEditItems, setBatchEditItems] = useState<AdminChannelModelListItem[]>([]);
    const [protocols, setProtocols] = useState<ModelProtocolDefinition[]>([]);
    const [protocolLoading, setProtocolLoading] = useState(true);
    const [protocolError, setProtocolError] = useState("");
    // 拖动模型行时浮出已有分组，放到哪个分组就更新哪个模型的展示名（一级目录）。
    const [dragItems, setDragItems] = useState<AdminChannelModelListItem[]>([]);
    const [hoverGroup, setHoverGroup] = useState("");
    const [movingGroup, setMovingGroup] = useState("");
    const [orderOpen, setOrderOpen] = useState(false);
    const [sortingGroup, setSortingGroup] = useState("");
    const groupOrder = useConfigStore((state) => state.config.displayGroupOrder);
    const { references } = useAdminContext();
    const groupNames = useMemo(() => {
        const names = Array.from(new Set([...(groupOrder ?? []), "未分类", ...items.map((item) => item.displayName?.trim() || "未分类"), ...references.channels.flatMap((channel) => channel.modelDisplayNames ?? [])]));
        const ranks = new Map((groupOrder ?? []).map((name, index) => [name, index]));
        return names.sort((left, right) => (ranks.get(left) ?? Infinity) - (ranks.get(right) ?? Infinity) || left.localeCompare(right, "zh-CN"));
    }, [groupOrder, items, references.channels]);

    const createGroup = () => {
        let name = "";
        modal.confirm({
            title: "新建模型分组",
            content: (
                <input
                    className="ant-input w-full"
                    aria-label="分组名称"
                    maxLength={100}
                    placeholder="请输入分组名称"
                    onChange={(event) => {
                        name = event.target.value;
                    }}
                />
            ),
            okText: "创建",
            cancelText: "取消",
            onOk: async () => {
                const group = name.trim();
                if (!group || groupNames.includes(group)) {
                    message.error(group ? "该分组已存在" : "请输入分组名称");
                    throw new Error("分组名称无效");
                }
                const result = await saveModelGroupOrder([...groupNames, group]);
                useConfigStore.getState().updateConfig("displayGroupOrder", result.order);
                setSelectedIds([]);
                updateFilter({ displayGroup: group });
                message.success("分组已创建");
            },
        });
    };

    const startDrag = (event: React.DragEvent, item: AdminChannelModelListItem) => {
        const picked = selectedIds.includes(item.id) && selectedIds.length > 1 ? items.filter((entry) => selectedIds.includes(entry.id)) : [item];
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", item.id);
        setDragItems(picked);
    };

    const endDrag = () => {
        setDragItems([]);
        setHoverGroup("");
    };

    const moveItemsToGroup = async (targetItems: AdminChannelModelListItem[], group: string) => {
        if (targetItems.length === 0 || movingGroup) return;
        setMovingGroup(group);
        try {
            const updates: BatchChannelModelUpdate[] = targetItems.map((item) => ({
                modelId: item.id,
                priceVersion: item.priceVersion,
                capabilityVersion: item.capabilityVersion ?? 0,
                updatedAt: item.updatedAt,
                changes: { displayName: group },
            }));
            await updateAdminAllChannelModels(updates);
            message.success(`已把 ${targetItems.length} 个模型移到「${group}」`);
            endDrag();
            setSelectedIds([]);
            await refreshSavedModels();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "移动分组失败");
        } finally {
            setMovingGroup("");
        }
    };

    const moveToGroup = (group: string) => moveItemsToGroup(dragItems, group);

    const refreshSavedModels = async () => {
        setSelectedIds([]);
        setLoading(true);
        setLoadError("");
        try {
            setItems((await listAdminAllChannelModels()).models);
            await onChanged(true);
        } catch (error) {
            setLoadError(error instanceof Error ? error.message : "读取模型列表失败");
            throw error;
        } finally {
            setLoading(false);
        }
    };

    const updateFilter = (patch: Record<string, string>) => {
        setSearchParams(
            (current) => {
                const next = new URLSearchParams(current);
                Object.entries(patch).forEach(([key, value]) => {
                    if (!value || value === "all") next.delete(key);
                    else next.set(key, value);
                });
                return next;
            },
            { replace: true },
        );
        setPage(1);
    };

    useEffect(() => {
        let active = true;
        setLoading(true);
        setLoadError("");
        void listAdminAllChannelModels()
            .then((result) => active && setItems(result.models))
            .catch((error) => active && setLoadError(error instanceof Error ? error.message : "读取模型列表失败"))
            .finally(() => active && setLoading(false));
        return () => {
            active = false;
        };
    }, [retry]);

    const loadProtocols = async () => {
        setProtocolLoading(true);
        setProtocolError("");
        try {
            setProtocols(await fetchPluginProviderCatalog("admin.system-channel"));
        } catch (error) {
            setProtocols([]);
            setProtocolError(error instanceof Error ? error.message : "无法读取协议目录");
        } finally {
            setProtocolLoading(false);
        }
    };

    useEffect(() => {
        void loadProtocols();
    }, []);

    const filtered = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return items
            .filter((item) => {
                if (groupFilter && (item.displayName?.trim() || "未分类") !== groupFilter) return false;
                if (query && !`${item.modelKey} ${item.providerModelKey} ${item.displayName} ${item.channelLabel || ""}`.toLowerCase().includes(query)) return false;
                if (capability !== "all" && item.capability !== capability) return false;
                if (channelFilter !== "all" && item.channelId !== channelFilter) return false;
                if (status === "enabled" && !(item.enabled && item.channelEnabled)) return false;
                if (status === "disabled" && item.enabled && item.channelEnabled) return false;
                if (status === "unhealthy") {
                    const stats = health.get(channelModelHealthKey(item.channelId, item.modelKey));
                    if (!stats || stats.successRate24h === null || stats.successRate24h >= 0.8) return false;
                }
                return true;
            })
            .sort(
                (left, right) =>
                    (left.displayName?.trim() || "未分类").localeCompare(right.displayName?.trim() || "未分类", "zh-CN") ||
                    (left.sortOrder ?? 0) - (right.sortOrder ?? 0) ||
                    left.modelKey.localeCompare(right.modelKey) ||
                    left.channelName.localeCompare(right.channelName, "zh-CN"),
            );
    }, [capability, channelFilter, groupFilter, health, items, keyword, status]);

    const paged = filtered.slice((page - 1) * pageSize, page * pageSize);
    const enabledCount = filtered.filter((item) => item.enabled && item.channelEnabled).length;

    const applyEnabled = async (item: AdminChannelModelListItem, enabled: boolean) => {
        setTogglingId(item.id);
        try {
            await setAdminChannelModelEnabled(item.channelId, item.id, enabled);
            setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, enabled } : entry)));
            await onChanged();
            message.success(enabled ? "模型已启用" : "模型已停用");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "更新模型状态失败");
        } finally {
            setTogglingId(null);
        }
    };

    const toggleEnabled = (item: AdminChannelModelListItem) => {
        if (!item.enabled) {
            void applyEnabled(item, true);
            return;
        }
        modal.confirm({
            title: `停用 ${item.channelName} 的 ${item.displayName || item.modelKey}？`,
            content: "停用后新任务不再使用这个渠道的该模型，引用它的前台模型会切换到其他可用线路；配置保留，可随时重新启用。",
            okText: "确认停用",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: () => applyEnabled(item, false),
        });
    };

    const openEditor = (item: AdminChannelModelListItem) => setEditing(item);

    const editingChannel = editing ? channels.find((channel) => channel.id === editing.channelId) : undefined;

    const columns: ColumnsType<AdminChannelModelListItem> = [
        {
            title: "模型",
            width: 240,
            fixed: screens.md ? "left" : undefined,
            render: (_, item) => (
                <div className="flex min-w-0 items-center gap-2">
                    <span className="admin-channel-model-icon">
                        <ModelIcon model={item.modelKey} icon={item.icon} />
                    </span>
                    <div className="min-w-0">
                        <div className="truncate font-medium" title={item.displayName || item.modelKey}>
                            {item.displayName || item.modelKey}
                        </div>
                        <div className="admin-monospace truncate text-xs text-foreground/45">{item.modelKey}</div>
                    </div>
                </div>
            ),
        },
        { title: "描述 / 标签", key: "details", width: 220, render: (_, item) => <ChannelModelDetailsCell description={item.description} tags={item.tags} /> },
        {
            title: "渠道",
            width: 170,
            render: (_, item) => (
                <div className="min-w-0">
                    <button type="button" className="admin-table-primary-link truncate" onClick={() => onOpenChannel(item.channelId)} title="在渠道中查看">
                        {item.channelName}
                    </button>
                    {!item.channelEnabled ? <div className="text-xs text-foreground/45">渠道已停用</div> : null}
                </div>
            ),
        },
        { title: "能力", dataIndex: "capability", width: 72, render: (value: string) => capabilityOptions.find((option) => option.value === value)?.label || "待配置" },
        { title: "稳定性（24h）", key: "health", width: 150, render: (_, item) => <ChannelModelHealthCell health={health.get(channelModelHealthKey(item.channelId, item.modelKey))} loading={healthLoading} /> },
        { title: "规格成本价 / 销售价 / 加价", width: 300, render: (_, item) => <ChannelModelCostSummary item={item} /> },
        {
            title: "状态",
            width: 90,
            render: (_, item) => (item.enabled ? item.channelEnabled ? <AdminStatusBadge label="启用" tone="success" /> : <AdminStatusBadge label="渠道停用" tone="warning" /> : <AdminStatusBadge label="停用" tone="neutral" />),
        },
        {
            title: "操作",
            width: 168,
            fixed: "right",
            render: (_, item) => (
                <Space size={4} wrap>
                    <Button size="small" icon={<Pencil className="size-3.5" />} onClick={() => openEditor(item)}>
                        {opensModelParameters(item) ? "编辑参数" : "编辑"}
                    </Button>
                    <Button size="small" danger={item.enabled} icon={<Power className="size-3.5" />} loading={togglingId === item.id} disabled={togglingId !== null && togglingId !== item.id} onClick={() => toggleEnabled(item)}>
                        {item.enabled ? "停用" : "启用"}
                    </Button>
                </Space>
            ),
        },
    ];

    const hasFilters = Boolean(keyword || capability !== "all" || status !== "all" || channelFilter !== "all" || groupFilter);

    return (
        <div className="admin-all-models">
            <div className="flex flex-wrap items-center gap-2 py-3" role="group" aria-label="模型展示分组">
                <Button
                    size="small"
                    type={!groupFilter ? "primary" : "default"}
                    onClick={() => {
                        setSelectedIds([]);
                        updateFilter({ displayGroup: "" });
                    }}
                >
                    全部分组 ({items.length})
                </Button>
                {groupNames.map((group) => (
                    <Button
                        key={group}
                        size="small"
                        type={groupFilter === group ? "primary" : "default"}
                        onClick={() => {
                            setSelectedIds([]);
                            updateFilter({ displayGroup: group });
                        }}
                    >
                        {group} ({items.filter((item) => (item.displayName?.trim() || "未分类") === group).length})
                    </Button>
                ))}
                <Button size="small" onClick={createGroup}>
                    新建分组
                </Button>
            </div>
            <AdminDataTable
                toolbar={
                    <AdminSearchInput
                        allowClear
                        autoFocus
                        className="app-list-search"
                        prefix={<Search className="size-4 text-foreground/40" />}
                        value={keyword}
                        aria-label="按模型名称搜索全部渠道"
                        placeholder="按模型名称、标识或上游 ID 搜索全部渠道"
                        onValueChange={(value) => updateFilter({ q: value })}
                    />
                }
                toolbarFilters={
                    <>
                        <Select aria-label="筛选模型能力" className="w-28" value={capability} options={capabilityOptions} onChange={(value) => updateFilter({ capability: value })} />
                        <Select
                            aria-label="筛选模型状态"
                            className="w-44"
                            value={status}
                            options={[
                                { label: "全部状态", value: "all" },
                                { label: "可用（模型与渠道均启用）", value: "enabled" },
                                { label: "不可用", value: "disabled" },
                                { label: "24h 成功率低于 80%", value: "unhealthy" },
                            ]}
                            onChange={(value) => updateFilter({ modelStatus: value })}
                        />
                        <Select
                            aria-label="筛选渠道"
                            className="w-40"
                            showSearch
                            optionFilterProp="label"
                            value={channelFilter}
                            options={[{ label: "全部渠道", value: "all" }, ...channels.map((channel) => ({ label: channel.name, value: channel.id }))]}
                            onChange={(value) => updateFilter({ modelChannel: value })}
                        />
                        <Button size="small" disabled={!groupFilter} title={groupFilter ? "调整当前组的模型顺序" : "请先选择一个分组"} icon={<ListOrdered className="size-3.5" />} onClick={() => setSortingGroup(groupFilter)}>
                            组内排序
                        </Button>
                        <Button size="small" icon={<ListOrdered className="size-3.5" />} onClick={() => setOrderOpen(true)}>
                            目录排序
                        </Button>
                    </>
                }
                toolbarActive={hasFilters}
                onReset={() => updateFilter({ q: "", capability: "", modelStatus: "", modelChannel: "", displayGroup: "" })}
                trailing={<span className="text-xs text-foreground/50 tabular-nums">{loading ? "读取中…" : `${filtered.length} 个模型 · ${enabledCount} 个可用`}</span>}
                batchActions={
                    <AdminBatchBar count={selectedIds.length} onClear={() => setSelectedIds([])}>
                        <Select
                            aria-label="批量移动到一级目录"
                            className="w-44"
                            showSearch
                            optionFilterProp="label"
                            placeholder={movingGroup ? "移动中…" : "移动到分组"}
                            value={undefined}
                            disabled={loading || Boolean(loadError) || Boolean(movingGroup)}
                            options={groupNames.map((group) => ({ label: group, value: group }))}
                            onChange={(value) =>
                                void moveItemsToGroup(
                                    items.filter((item) => selectedIds.includes(item.id)),
                                    String(value),
                                )
                            }
                        />
                        <Button size="small" disabled={loading || Boolean(loadError)} onClick={() => setBatchEditItems(items.filter((item) => selectedIds.includes(item.id)))}>
                            批量修改
                        </Button>
                        <Button size="small" disabled={loading || Boolean(loadError)} onClick={() => setRepriceItems(items.filter((item) => selectedIds.includes(item.id)))}>
                            统一调价
                        </Button>
                    </AdminBatchBar>
                }
                table={{
                    className: "app-data-table",
                    rowKey: "id",
                    size: "small",
                    loading,
                    rowSelection: {
                        selectedRowKeys: selectedIds,
                        preserveSelectedRowKeys: true,
                        onChange: (keys) => {
                            const next = keys.map(String);
                            if (next.length > 100) message.warning("单次最多选择 100 个模型");
                            setSelectedIds(next.slice(0, 100));
                        },
                    },
                    columns,
                    dataSource: paged,
                    pagination: false,
                    scroll: { x: 1440 },
                    onRow: (item) => ({
                        draggable: true,
                        onDragStart: (event) => startDrag(event, item),
                        onDragEnd: endDrag,
                        title: "拖动到右下角分组即可归类",
                    }),
                }}
                empty={
                    loadError ? (
                        <div className="admin-inline-load-error" role="status">
                            <span>模型列表暂不可用：{loadError}</span>
                            <Button size="small" onClick={() => setRetry((value) => value + 1)}>
                                重试
                            </Button>
                        </div>
                    ) : (
                        <AdminTableEmpty filtered={hasFilters} title={hasFilters ? undefined : "还没有任何渠道模型"} />
                    )
                }
                footer={
                    <PaginationBar
                        alwaysShow
                        current={page}
                        pageSize={pageSize}
                        total={filtered.length}
                        onChange={(nextPage, nextPageSize) => {
                            setPage(nextPageSize !== pageSize ? 1 : nextPage);
                            setPageSize(nextPageSize);
                        }}
                    />
                }
            />
            {dragItems.length > 0 ? (
                <div className="fixed bottom-6 right-6 z-[60] flex max-h-[60vh] w-64 flex-col gap-2 overflow-auto rounded-lg border bg-background p-3 shadow-lg" role="dialog" aria-label="移动到一级目录">
                    <div className="model-group-dock-title">
                        移动到一级目录 · <strong>{dragItems.length}</strong> 个模型
                    </div>
                    <div className="flex flex-wrap gap-1.5 overflow-auto">
                        {groupNames.map((group) => (
                            <button
                                key={group}
                                type="button"
                                className={cn("rounded-full border border-dashed px-2 py-1 text-xs", hoverGroup === group && "border-solid border-primary bg-primary/10 text-primary")}
                                disabled={Boolean(movingGroup)}
                                onDragOver={(event) => {
                                    event.preventDefault();
                                    setHoverGroup(group);
                                }}
                                onDragLeave={() => setHoverGroup((current) => (current === group ? "" : current))}
                                onDrop={(event) => {
                                    event.preventDefault();
                                    void moveToGroup(group);
                                }}
                            >
                                {movingGroup === group ? "保存中…" : group}
                            </button>
                        ))}
                    </div>
                    <div className="model-group-dock-hint">拖到目录上松开；按住 Shift 可多选后一起拖</div>
                </div>
            ) : null}
            {sortingGroup && <GroupModelOrderDialog group={sortingGroup} onClose={() => setSortingGroup("")} onSaved={refreshSavedModels} />}
            <ModelGroupOrderDialog
                open={orderOpen}
                groups={groupNames}
                initialOrder={groupOrder ?? []}
                onClose={() => setOrderOpen(false)}
                onSaved={(order) => {
                    useConfigStore.getState().updateConfig("displayGroupOrder", order);
                }}
            />
            {batchEditItems.length > 0 && (
                <ChannelModelBatchEditDialog
                    items={batchEditItems}
                    currentItems={items}
                    contextKey={JSON.stringify([keyword, capability, status, channelFilter, retry])}
                    protocols={protocols}
                    protocolLoading={protocolLoading}
                    protocolError={protocolError}
                    onClose={() => setBatchEditItems([])}
                    onSaved={refreshSavedModels}
                />
            )}
            {repriceItems.length > 0 && (
                <ChannelModelRepriceDialog
                    items={repriceItems}
                    onClose={() => setRepriceItems([])}
                    onSaved={async () => {
                        setSelectedIds([]);
                        setRetry((value) => value + 1);
                        await onChanged();
                    }}
                />
            )}
            {editing && editingChannel ? (
                <ChannelModelEditor
                    channel={editingChannel}
                    editing={editing}
                    protocols={protocols}
                    protocolLoading={protocolLoading}
                    protocolError={protocolError}
                    onRetryProtocols={() => void loadProtocols()}
                    onClose={() => setEditing(null)}
                    onSaved={async () => {
                        setRetry((value) => value + 1);
                        await onChanged();
                    }}
                />
            ) : null}
        </div>
    );
}
