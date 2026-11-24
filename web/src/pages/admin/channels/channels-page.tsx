import { App, Button, Form, Input, InputNumber, Segmented, Spin, Switch } from "antd";
import { AdminModal } from "@/pages/admin/ui/overlays";
import { ChevronRight, Copy, Download, GripVertical, ListOrdered, Pencil, Plus, Power, Search, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { AdminSearchInput } from "../components/admin-search-input";

import { ChannelHeadersEditor, validateChannelHeaders } from "@/components/channel-headers-editor";
import { refreshSystemChannels } from "@/lib/user-session";
import { createAdminChannel, deleteAdminChannel, duplicateAdminChannel, exportAdminChannels, importAdminChannels, listAdminChannels, updateAdminChannel, type SystemChannelExport } from "@/services/api/auth";
import { type ChannelHeader, type ModelChannel } from "@/stores/use-config-store";
import { useAdminContext } from "../admin-context";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminRowActions, AdminStatusBadge, AdminTableEmpty, configuredSecretText } from "../components/admin-ui";
import { MediaTransportFields } from "../components/media-transport-fields";
import { ChannelModelManager, type ChannelModelFilters } from "../components/channel-model-manager";
import { formatRate, healthTone, useChannelModelHealth } from "../components/channel-model-health";
import { AllChannelModelsPanel } from "./all-channel-models-panel";
import { ChannelOrderDialog } from "../components/channel-order-dialog";
import { channelCategories, normalizeChannelCategory, openChannelWorkspace, selectChannelWorkspace } from "./channel-workspace-state";
import { ProviderCatalogWizard } from "./provider-catalog-wizard";
import "./channels-page.css";
import { Select } from "@/components/ui/base/select";
import { listAdminChannelWebsites, deleteAdminChannelWebsite, type ChannelWebsite } from "@/services/api/channel-websites";
import { ChannelWebsiteDialog } from "./channel-website-dialog";
import { useChannelKeySort } from "./use-channel-key-sort";

type ChannelFormValues = {
    apiFormat?: ModelChannel["apiFormat"];
    mediaTransport?: ModelChannel["mediaTransport"];
    name: string;
    baseUrl: string;
    apiKey?: string;
    secretKey?: string;
    headers?: ChannelHeader[];
    useGlobalConcurrency?: boolean;
    concurrencyLimit?: number;
    enabled?: boolean;
    proxyUrl?: string;
};

export function adminChannelSavePayload(values: ChannelFormValues) {
    return {
        name: values.name.trim(),
        apiFormat: values.apiFormat,
        mediaTransport: values.mediaTransport || {},
        baseUrl: values.baseUrl.trim(),
        apiKey: values.apiKey?.trim() || "",
        secretKey: values.secretKey?.trim() || "",
        headers: values.headers || [],
        useGlobalConcurrency: values.useGlobalConcurrency !== false,
        concurrencyLimit: values.useGlobalConcurrency === false ? values.concurrencyLimit : undefined,
        enabled: values.enabled !== false,
        proxyUrl: values.proxyUrl?.trim() || "",
    };
}

export default function ChannelsPage() {
    const { message, modal } = App.useApp();
    const { reloadReferences } = useAdminContext();
    const [searchParams, setSearchParams] = useSearchParams();
    const keyword = searchParams.get("filter") || "";
    const status = normalizeStatus(searchParams.get("status"));
    const category = normalizeChannelCategory(searchParams.get("category"));
    const selectedChannelId = searchParams.get("channel");
    const view = searchParams.get("view") === "models" ? "models" : "channels";
    const { health, loading: healthLoading, reload: reloadHealth } = useChannelModelHealth();
    // 渠道级 24 小时成功率：按渠道汇总各模型的生成请求，用于左侧列表快速发现异常渠道。
    const channelHealth = new Map<string, { requests: number; succeeded: number }>();
    health.forEach((item) => {
        const current = channelHealth.get(item.channelId) || { requests: 0, succeeded: 0 };
        channelHealth.set(item.channelId, { requests: current.requests + item.requests24h, succeeded: current.succeeded + item.succeeded24h });
    });
    const [channels, setChannels] = useState<ModelChannel[]>([]);
    const [websites, setWebsites] = useState<ChannelWebsite[]>([]);
    const [websiteDialog, setWebsiteDialog] = useState<ChannelWebsite | "new" | null>(null);
    const [addingToWebsite, setAddingToWebsite] = useState<ChannelWebsite | null>(null);
    const [autoFetchChannelId, setAutoFetchChannelId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [editingChannel, setEditingChannel] = useState<ModelChannel | null>(null);
    const [saving, setSaving] = useState(false);
    const [duplicatingChannelId, setDuplicatingChannelId] = useState<string | null>(null);
    const [wizardOpen, setWizardOpen] = useState(false);
    const [importVersion, setImportVersion] = useState(0);
    const [transferring, setTransferring] = useState(false);
    const importInputRef = useRef<HTMLInputElement>(null);
    const [modelFilters, setModelFilters] = useState<ChannelModelFilters>({ keyword: "", capability: "all", status: "all" });
    const requestSequence = useRef(0);
    const [form] = Form.useForm<ChannelFormValues>();
    const useGlobalConcurrency = Form.useWatch("useGlobalConcurrency", form) !== false;
    const hasFilters = Boolean(keyword || status !== "all" || category !== "all");
    const { visibleChannels, selectedChannel: fallbackChannel } = selectChannelWorkspace(channels, keyword, status, selectedChannelId, category);
    const visibleWebsites = websites.filter(
        (site) => !hasFilters || visibleChannels.some((channel) => channel.websiteId === site.id) || (status === "all" && category === "all" && `${site.name} ${site.baseUrl}`.toLowerCase().includes(keyword.toLowerCase())),
    );
    const selectedWebsiteId = searchParams.get("website") || fallbackChannel?.websiteId;
    const selectedWebsite = visibleWebsites.find((site) => site.id === selectedWebsiteId) || visibleWebsites[0];
    useEffect(() => {
        setModelFilters({ keyword: "", capability: "all", status: "all" });
    }, [selectedWebsite?.id]);
    const siteNameMatches = Boolean(keyword && selectedWebsite?.name.toLowerCase().includes(keyword.trim().toLowerCase()));
    const websiteChannels = (siteNameMatches ? selectChannelWorkspace(channels, "", status, selectedChannelId, category).visibleChannels : visibleChannels).filter((channel) => channel.websiteId === selectedWebsite?.id);
    const groupsRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!selectedChannelId) return;
        const group = Array.from(groupsRef.current?.querySelectorAll<HTMLElement>("[data-channel-id]") || []).find((element) => element.dataset.channelId === selectedChannelId);
        group?.scrollIntoView({ block: "nearest" });
    }, [selectedChannelId, selectedWebsite?.id, loading]);

    const updateUrl = (patch: Record<string, string | number>, replace = false) => {
        setSearchParams(
            (current) => {
                const next = new URLSearchParams(current);
                next.delete("page");
                next.delete("pageSize");
                Object.entries(patch).forEach(([key, value]) => {
                    if (value === "" || ((key === "status" || key === "category") && value === "all")) next.delete(key);
                    else next.set(key, String(value));
                });
                return next;
            },
            { replace },
        );
    };

    const reload = async (propagateError = false) => {
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
            const siteResult = await listAdminChannelWebsites();
            if (sequence === requestSequence.current) setWebsites(siteResult.websites);
        } catch (error) {
            if (sequence === requestSequence.current) setLoadError(error instanceof Error ? error.message : "读取渠道列表失败");
            if (propagateError) throw error;
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

    const syncChannels = async (propagateError = false) => {
        void reloadHealth();
        await reloadReferences(propagateError);
        try {
            await refreshSystemChannels();
        } catch (error) {
            if (propagateError) throw error;
            message.warning(error instanceof Error ? `后台已保存，但配置同步失败：${error.message}` : "后台已保存，但配置同步失败，请稍后重新打开配置");
        }
    };

    const keySort = useChannelKeySort({
        scopeId: selectedWebsite?.id,
        groupIds: websiteChannels.map((channel) => channel.id),
        onSaved: async () => {
            await syncChannels();
            await reload();
        },
    });

    const openDrawer = (channel?: ModelChannel, website?: ChannelWebsite) => {
        setAddingToWebsite(website || null);
        setEditingChannel(channel || null);
        form.resetFields();
        form.setFieldsValue(
            channel
                ? {
                      name: channel.name,
                      apiFormat: channel.apiFormat,
                      mediaTransport: channel.mediaTransport || {},
                      baseUrl: channel.baseUrl,
                      apiKey: "",
                      secretKey: "",
                      headers: channel.headers || [],
                      useGlobalConcurrency: !channel.concurrencyLimit,
                      concurrencyLimit: channel.concurrencyLimit || undefined,
                      enabled: channel.enabled !== false,
                      proxyUrl: channel.proxyUrl || "",
                  }
                : {
                      name: "",
                      baseUrl: website?.baseUrl || "",
                      apiFormat: website?.apiFormat || "openai",
                      apiKey: "",
                      secretKey: "",
                      headers: website?.headers || [],
                      useGlobalConcurrency: true,
                      concurrencyLimit: undefined,
                      enabled: false,
                      proxyUrl: website?.proxyUrl || "",
                  },
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
            const { channel } = await (editingChannel ? updateAdminChannel(editingChannel.id, { ...payload, expectedUpdatedAt: editingChannel.updatedAt }) : createAdminChannel({ ...payload, websiteId: addingToWebsite?.id }));
            setChannels((current) => (editingChannel ? current.map((item) => (item.id === channel.id ? channel : item)) : [...current, channel]));
            updateUrl({ channel: channel.id, website: channel.websiteId || "", filter: "", status: "all", category: "all" }, true);
            await syncChannels();
            setDrawerOpen(false);
            form.resetFields();
            await reload();
            if (!editingChannel) setAutoFetchChannelId(channel.id);
            message.success(editingChannel ? (editingChannel.websiteId !== channel.websiteId ? "Key 分组已保存；公共连接变化后已归入独立网站" : "Key 分组已更新") : "Key 已保存，正在读取模型目录");
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
            updateUrl({ channel: duplicated.id, website: duplicated.websiteId || "", filter: "", status: "all", category: "all" }, true);
            await syncChannels();
            await reload();
            message.success("系统渠道已复制");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "复制系统渠道失败");
        } finally {
            setDuplicatingChannelId(null);
        }
    };

    // 导出文件不含任何密钥；ids 为空时导出全部系统渠道。
    const exportChannels = async (target?: ModelChannel) => {
        setTransferring(true);
        try {
            const exported = await exportAdminChannels(target ? [target.id] : []);
            const blob = new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            const stamp = new Date().toISOString().slice(0, 10);
            link.href = url;
            link.download = target ? `system-channel-${target.name}-${stamp}.json` : `system-channels-${stamp}.json`;
            link.click();
            URL.revokeObjectURL(url);
            message.success(`已导出 ${exported.channels.length} 个渠道（不含密钥）`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "导出系统渠道失败");
        } finally {
            setTransferring(false);
        }
    };

    const importChannels = async (file: File) => {
        let payload: SystemChannelExport;
        try {
            payload = JSON.parse(await file.text()) as SystemChannelExport;
        } catch {
            message.error("导入文件不是有效的 JSON");
            return;
        }
        if (payload?.format !== "yingce.system-channels" || !Array.isArray(payload.channels)) {
            message.error("不是系统渠道导出文件");
            return;
        }
        const names = payload.channels.map((item) => item.name).filter(Boolean);
        modal.confirm({
            title: `导入 ${names.length} 个系统渠道？`,
            content: (
                <div className="space-y-2 text-sm">
                    <p>
                        {names.slice(0, 8).join("、")}
                        {names.length > 8 ? ` 等 ${names.length} 个` : ""}
                    </p>
                    <p className="text-foreground/60">按渠道名称合并：同名渠道保留现有密钥和启停状态，只更新地址、并发和文件中的模型；新渠道创建为停用状态，填写 API Key 后再启用。文件中没有的模型保持不变，渠道按公共连接信息归入 API 网站。</p>
                </div>
            ),
            okText: "开始导入",
            onOk: async () => {
                setTransferring(true);
                try {
                    const result = await importAdminChannels(payload);
                    updateUrl({ filter: "", status: "all", category: "all" }, true);
                    setImportVersion((value) => value + 1);
                    await syncChannels();
                    await reload();
                    const summary = `新建 ${result.createdChannels.length} 个、更新 ${result.updatedChannels.length} 个渠道，保存 ${result.savedModels} 个模型`;
                    if (result.errors.length) {
                        modal.warning({
                            title: "导入完成，部分内容失败",
                            width: 640,
                            content: (
                                <div className="space-y-2 text-sm">
                                    <p>{summary}</p>
                                    <ul className="max-h-64 list-disc space-y-1 overflow-auto pl-5 text-destructive">
                                        {result.errors.map((item) => (
                                            <li key={item}>{item}</li>
                                        ))}
                                    </ul>
                                </div>
                            ),
                        });
                    } else {
                        message.success(result.createdChannels.length ? `${summary}；新渠道需填写 API Key 后启用` : summary);
                    }
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "导入系统渠道失败");
                } finally {
                    setTransferring(false);
                }
            },
        });
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

    // 启停保留一级入口，其余分组操作集中到菜单；危险操作沿用确认流程。
    const channelActions = (channel: ModelChannel, openSort: () => void) => (
        <AdminRowActions
            visibleActionCount={1}
            actions={[
                {
                    key: "toggle",
                    label: channel.enabled !== false ? "停用" : "启用",
                    icon: <Power className="size-3.5" />,
                    danger: channel.enabled !== false,
                    confirm: {
                        title: channel.enabled !== false ? "停用这个系统渠道？" : "启用这个系统渠道？",
                        description: channel.enabled !== false ? "停用后新任务不会再使用该渠道，但仍会保留在列表中，可随时重新启用。" : "启用后，配置完整的模型会重新进入系统可用模型集合。",
                        okText: channel.enabled !== false ? "确认停用" : "确认启用",
                    },
                    onClick: () => toggleChannel(channel),
                },
                { key: "edit", label: "编辑 Key", icon: <Pencil className="size-3.5" />, onClick: () => openDrawer(channel) },
                { key: "sort", label: "模型排序", icon: <ListOrdered className="size-3.5" />, onClick: openSort },
                { key: "duplicate", label: "复制", icon: <Copy className="size-3.5" />, disabled: Boolean(duplicatingChannelId), onClick: () => duplicateChannel(channel) },
                { key: "export", label: "导出", icon: <Download className="size-3.5" />, disabled: transferring, onClick: () => exportChannels(channel) },
                {
                    key: "delete",
                    label: "删除",
                    icon: <Trash2 className="size-3.5" />,
                    danger: true,
                    confirm: { title: "删除这个系统渠道？", description: "删除后渠道及所属模型将不再显示，API Key 会被清除，历史账单和调用记录继续保留。该操作不能在页面恢复。", okText: "确认删除" },
                    onClick: () => removeChannel(channel),
                },
            ]}
        />
    );

    return (
        <AdminPageFrame title="渠道与模型" description="按 API 网站管理多个 Key 分组；每个 Key 的模型、协议、能力和价格独立。">
            <Segmented
                className="admin-channel-view-switch"
                aria-label="渠道与模型视图"
                value={view}
                onChange={(value) => updateUrl({ view: value === "models" ? "models" : "" })}
                options={[
                    { label: "按网站", value: "channels" },
                    { label: "全部模型", value: "models" },
                ]}
            />
            {view === "models" ? (
                <AllChannelModelsPanel channels={channels} health={health} healthLoading={healthLoading} onChanged={syncChannels} onOpenChannel={(channelId) => updateUrl(openChannelWorkspace(channelId))} />
            ) : (
                <div className="admin-channel-workspace">
                    <aside className="admin-channel-sidebar" aria-label="系统渠道">
                        <div className="admin-channel-sidebar-header">
                            <div className="flex items-center justify-between gap-2">
                                <h2 className="font-semibold">API 网站</h2>
                                <span className="admin-channel-count">{visibleWebsites.length}</span>
                            </div>
                            <Button block type="primary" icon={<Plus className="size-4" />} onClick={() => setWebsiteDialog("new")}>
                                新增网站
                            </Button>
                            <Button block onClick={() => setWizardOpen(true)}>
                                从服务商目录接入
                            </Button>
                            <div className="flex gap-2">
                                <input
                                    ref={importInputRef}
                                    type="file"
                                    accept="application/json,.json"
                                    className="hidden"
                                    onChange={(event) => {
                                        const file = event.target.files?.[0];
                                        event.target.value = "";
                                        if (file) void importChannels(file);
                                    }}
                                />
                                <Button size="small" icon={<Upload className="size-3.5" />} disabled={transferring} onClick={() => importInputRef.current?.click()}>
                                    导入 JSON
                                </Button>
                                <Button size="small" icon={<Download className="size-3.5" />} disabled={transferring || !channels.length} onClick={() => void exportChannels()} title="导出全部系统渠道，不含 API Key 等密钥">
                                    导出全部
                                </Button>
                            </div>
                            <AdminSearchInput
                                id="admin-channel-search"
                                aria-label="搜索系统渠道"
                                autoComplete="off"
                                allowClear
                                prefix={<Search className="size-4 text-foreground/40" />}
                                value={keyword}
                                placeholder="搜索渠道名称或地址"
                                onValueChange={(value) => updateUrl({ filter: value }, true)}
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
                            <div className="admin-channel-categories" role="group" aria-label="渠道分类">
                                {channelCategories.map(({ value, label }) => (
                                    <button key={value} type="button" aria-pressed={category === value} onClick={() => updateUrl({ category: value })}>
                                        {label}
                                    </button>
                                ))}
                            </div>
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
                            {visibleWebsites.map((website) => (
                                <button type="button" key={website.id} className="admin-channel-item" aria-pressed={selectedWebsite?.id === website.id} aria-controls="admin-channel-models" onClick={() => updateUrl({ website: website.id, channel: "" })}>
                                    <span className="admin-channel-item-topline">
                                        <span className="admin-channel-item-name" title={website.name}>
                                            {website.name}
                                        </span>
                                        <ChevronRight className="admin-channel-item-arrow size-3.5" aria-hidden="true" />
                                    </span>
                                    <span className="admin-channel-item-meta">
                                        <span>{website.keyCount} 个 Key 分组</span>
                                    </span>
                                    <span className="block truncate text-xs text-foreground/50" title={website.baseUrl}>
                                        {website.baseUrl}
                                    </span>
                                </button>
                            ))}
                            {!loading && !loadError && !visibleWebsites.length ? (
                                <AdminTableEmpty
                                    filtered={hasFilters}
                                    title={hasFilters ? undefined : "还没有系统渠道"}
                                    action={hasFilters ? <Button onClick={() => updateUrl({ filter: "", status: "all", category: "all" })}>清除筛选</Button> : undefined}
                                />
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
                    <section id="admin-channel-models" className="admin-channel-detail" aria-label={selectedWebsite ? `${selectedWebsite.name}的 Key 分组` : "渠道模型管理"}>
                        {selectedWebsite && (
                            <div className="admin-channel-website-header">
                                <div className="flex flex-wrap items-center gap-2">
                                    <div className="admin-channel-website-identity">
                                        <h2 className="font-semibold">{selectedWebsite.name}</h2>
                                        <p className="truncate text-xs text-foreground/50">{selectedWebsite.baseUrl}</p>
                                    </div>
                                    <Button onClick={() => setWebsiteDialog(selectedWebsite)}>编辑网站</Button>
                                    {selectedWebsite.keyCount === 0 && (
                                        <Button
                                            danger
                                            onClick={() =>
                                                modal.confirm({
                                                    title: "删除空网站？",
                                                    content: selectedWebsite.name,
                                                    okText: "删除",
                                                    cancelText: "取消",
                                                    onOk: async () => {
                                                        try {
                                                            await deleteAdminChannelWebsite(selectedWebsite.id);
                                                            updateUrl({ website: "" });
                                                            await reload();
                                                        } catch (error) {
                                                            message.error(error instanceof Error ? error.message : "删除网站失败");
                                                        }
                                                    },
                                                })
                                            }
                                        >
                                            删除网站
                                        </Button>
                                    )}
                                    <Button type="primary" icon={<Plus className="size-4" />} onClick={() => openDrawer(undefined, selectedWebsite)}>
                                        新增 Key
                                    </Button>
                                </div>
                            </div>
                        )}
                        {selectedWebsite && websiteChannels.length > 0 && (
                            <div className="admin-channel-model-filters" aria-label="网站模型筛选">
                                <Input
                                    allowClear
                                    prefix={<Search className="size-4 text-foreground/40" />}
                                    aria-label="搜索此网站的模型"
                                    placeholder="搜索此网站的模型"
                                    value={modelFilters.keyword}
                                    onChange={(event) => setModelFilters((current) => ({ ...current, keyword: event.target.value }))}
                                />
                                <Select
                                    aria-label="筛选模型能力"
                                    value={modelFilters.capability}
                                    onChange={(capability) => setModelFilters((current) => ({ ...current, capability }))}
                                    options={[
                                        { label: "全部能力", value: "all" },
                                        { label: "文本", value: "text" },
                                        { label: "图片", value: "image" },
                                        { label: "视频", value: "video" },
                                        { label: "音频", value: "audio" },
                                    ]}
                                />
                                <Select
                                    aria-label="筛选模型状态"
                                    value={modelFilters.status}
                                    onChange={(status) => setModelFilters((current) => ({ ...current, status }))}
                                    options={[
                                        { label: "全部状态", value: "all" },
                                        { label: "已启用", value: "enabled" },
                                        { label: "已停用", value: "disabled" },
                                        { label: "24h 成功率低于 80%", value: "unhealthy" },
                                    ]}
                                />
                                {(modelFilters.keyword || modelFilters.capability !== "all" || modelFilters.status !== "all") && (
                                    <Button type="text" onClick={() => setModelFilters({ keyword: "", capability: "all", status: "all" })}>
                                        重置
                                    </Button>
                                )}
                            </div>
                        )}
                        {websiteChannels.length ? (
                            <div ref={groupsRef} className="admin-channel-key-groups" aria-label="Key 分组" aria-busy={keySort.sorting}>
                                {websiteChannels.map((channel, index) => (
                                    <section
                                        key={channel.id}
                                        data-channel-id={channel.id}
                                        data-dragging={keySort.draggedId === channel.id || undefined}
                                        data-drop-position={keySort.dropTarget === channel.id ? keySort.dropPosition : undefined}
                                        className="admin-channel-key-group"
                                        aria-label={`Key 分组：${channel.name}`}
                                        {...keySort.targetProps(channel.id)}
                                    >
                                        <ChannelModelManager
                                            channel={channel}
                                            filters={modelFilters}
                                            groupHeading={
                                                <>
                                                    <button
                                                        type="button"
                                                        className="admin-channel-key-drag"
                                                        aria-label={`调整 Key ${index + 1} ${channel.name} 顺序`}
                                                        title={keySort.sorting ? "正在保存顺序" : "拖动排序（Alt + ↑ / ↓）"}
                                                        {...keySort.handleProps(channel.id)}
                                                    >
                                                        <GripVertical className="size-4" aria-hidden />
                                                    </button>
                                                    <h3 className="admin-channel-detail-title">
                                                        <span className="admin-channel-key-index">Key {index + 1}</span>
                                                        {channel.name}
                                                    </h3>
                                                    <AdminStatusBadge label={channel.enabled !== false ? "启用" : "停用"} tone={channel.enabled !== false ? "success" : "neutral"} />
                                                    {!channel.hasApiKey && <AdminStatusBadge label="未配置凭证" tone="warning" />}
                                                </>
                                            }
                                            groupActions={(openSort) => channelActions(channel, openSort)}
                                            autoFetch={autoFetchChannelId === channel.id}
                                            onAutoFetchConsumed={() => setAutoFetchChannelId((current) => (current === channel.id ? null : current))}
                                            refreshVersion={importVersion}
                                            health={health}
                                            healthLoading={healthLoading}
                                            onChanged={async (propagateError) => {
                                                await syncChannels(propagateError);
                                                await reload(propagateError);
                                            }}
                                        />
                                    </section>
                                ))}
                            </div>
                        ) : (
                            <AdminTableEmpty
                                title={loading ? "正在加载渠道" : loadError ? "暂时无法读取渠道" : hasFilters ? "没有匹配的渠道" : "添加渠道，开始管理模型"}
                                description={loading ? "加载完成后将在此显示渠道模型。" : loadError ? "请在左侧重试加载。" : hasFilters ? "调整左侧搜索或状态筛选。" : "在左侧新增渠道，配置连接信息后即可拉取或新增模型。"}
                            />
                        )}
                    </section>
                </div>
            )}
            <AdminModal
                className="workspace-modal workspace-modal-wide admin-channel-modal"
                rootClassName="admin-channel-modal-root"
                title={editingChannel ? "编辑 Key 分组" : addingToWebsite ? `新增 Key · ${addingToWebsite.name}` : "新增独立 Key 分组"}
                open={drawerOpen}
                width={760}
                centered
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
                    <Form.Item name="name" label="Key 分组名称" rules={[{ required: true, message: "请填写 Key 分组名称" }]}>
                        <Input placeholder="例如：OpenAI 官方渠道" />
                    </Form.Item>
                    <Form.Item name="baseUrl" label="Base URL" rules={[{ required: true, message: "请填写 Base URL" }]}>
                        <Input disabled={Boolean(addingToWebsite)} placeholder="填写云端渠道 Base URL" />
                    </Form.Item>
                    {editingChannel?.websiteId && <p className="mb-4 text-xs text-foreground/55">修改地址、目录格式、代理或公共请求头会将当前 Key 分组移到独立网站。批量修改请使用“编辑网站”。</p>}
                    <Form.Item name="apiFormat" label="模型目录格式">
                        <Select
                            disabled={Boolean(addingToWebsite)}
                            options={[
                                { value: "openai", label: "OpenAI /models" },
                                { value: "gemini", label: "Gemini models" },
                            ]}
                        />
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
                    <Form.Item name="proxyUrl" label="代理地址" extra="为该渠道单独配置出站代理，支持 socks5://、socks5h://、http://、https://。留空则使用全局环境变量代理。">
                        <Input disabled={Boolean(addingToWebsite)} placeholder="例如：socks5://127.0.0.1:1080 或 http://127.0.0.1:7890" />
                    </Form.Item>
                    <Form.Item name="mediaTransport" label="参考素材发送方式" extra="作为本渠道默认值；渠道内模型可单独覆盖。未设置时保持现有协议行为。">
                        <MediaTransportFields />
                    </Form.Item>
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
            </AdminModal>
            {websiteDialog && (
                <ChannelWebsiteDialog
                    website={websiteDialog === "new" ? undefined : websiteDialog}
                    onClose={() => setWebsiteDialog(null)}
                    onSaved={async (website) => {
                        updateUrl({ website: website.id, channel: "" });
                        await reload();
                    }}
                />
            )}
            <ProviderCatalogWizard
                open={wizardOpen}
                onClose={() => setWizardOpen(false)}
                onCustom={() => {
                    setWizardOpen(false);
                    openDrawer();
                }}
                onInstalled={async (channel) => {
                    setWizardOpen(false);
                    updateUrl({ channel: channel.id, website: channel.websiteId || "", filter: "", status: "all", category: "all" }, true);
                    await syncChannels();
                    await reload();
                }}
            />
        </AdminPageFrame>
    );
}

function ChannelHealthBadge({ stats }: { stats?: { requests: number; succeeded: number } }) {
    if (!stats || stats.requests === 0) return null;
    const rate = stats.succeeded / stats.requests;
    return (
        <span className="admin-channel-item-health" data-tone={healthTone(rate, stats.requests)} title={`近 24 小时 ${stats.requests} 次生成请求，成功 ${stats.succeeded} 次`}>
            {formatRate(rate)}
        </span>
    );
}

function normalizeStatus(value: string | null): "all" | "enabled" | "disabled" {
    return value === "enabled" || value === "disabled" ? value : "all";
}
function channelSecretText(channel: ModelChannel) {
    return channel.hasSecretKey ? "已配置，留空不修改" : "未配置";
}
