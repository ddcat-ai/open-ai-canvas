import { App, Button, Input, Select, Switch, Tag } from "antd";
import { CloudUpload, PlugZap, RefreshCw, Search, ShieldCheck, Trash2, UsersRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import "@/lib/plugins/builtin";
import { EAGLE_PLUGIN_ID } from "@/lib/plugins/builtin/eagle";
import { PROMPT_OPTIMIZER_PLUGIN_ID } from "@/lib/plugins/builtin/prompt-optimizer";
import { COMFYUI_PLUGIN_ID, RUNNINGHUB_PLUGIN_ID } from "@/lib/plugins/builtin/workflows";
import { listRegisteredPlugins } from "@/lib/plugins/plugin-registry";
import type { PluginManifest } from "@/lib/plugins/plugin-types";
import { fetchAdminPlugins, setPluginPlatformAvailability, uninstallPlugin, uploadPlugin, type AdminPluginState, type BackendPlugin, type PluginManagement } from "@/services/api/plugins";
import { UploadPluginModal } from "@/pages/plugins/plugin-documentation-modals";

import { AdminPageFrame } from "../components/admin-shell";

type AdminPluginItem = {
    manifest: PluginManifest;
    source: string;
    management: PluginManagement;
    status?: string;
    error?: string;
};

const officialApplicationIds = new Set([RUNNINGHUB_PLUGIN_ID, COMFYUI_PLUGIN_ID, EAGLE_PLUGIN_ID, PROMPT_OPTIMIZER_PLUGIN_ID, "portrait-clearance"]);

export default function AdminPluginsPage() {
    const { message, modal } = App.useApp();
    const [plugins, setPlugins] = useState<BackendPlugin[]>([]);
    const [states, setStates] = useState<Record<string, AdminPluginState>>({});
    const [loading, setLoading] = useState(true);
    const [savingId, setSavingId] = useState("");
    const [uploadOpen, setUploadOpen] = useState(false);
    const [search, setSearch] = useState("");
    const [kind, setKind] = useState<"all" | "application" | "protocol" | "uploaded">("all");

    const reload = async () => {
        setLoading(true);
        try {
            const result = await fetchAdminPlugins();
            setPlugins(result.plugins);
            setStates(result.states);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取插件管理数据失败");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void reload();
    }, []);

    const items = useMemo(() => mergePlugins(plugins), [plugins]);
    const filtered = useMemo(() => {
        const keyword = search.trim().toLocaleLowerCase();
        return items.filter((item) => {
            if (kind === "uploaded" && item.management.origin !== "uploaded") return false;
            if (kind !== "all" && kind !== "uploaded" && item.management.kind !== kind) return false;
            if (!keyword) return true;
            return [item.manifest.name, item.manifest.id, item.manifest.description, item.manifest.author].filter(Boolean).join(" ").toLocaleLowerCase().includes(keyword);
        });
    }, [items, kind, search]);

    const changeAvailability = async (item: AdminPluginItem, available: boolean) => {
        setSavingId(item.manifest.id);
        try {
            const state = await setPluginPlatformAvailability(item.manifest.id, available);
            setStates((current) => ({ ...current, [item.manifest.id]: state }));
            message.success(`${item.manifest.name}${available ? "已开放" : "已停用"}`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "更新插件可用状态失败");
        } finally {
            setSavingId("");
        }
    };

    const upload = async (file: File) => {
        try {
            await uploadPlugin(file);
            setUploadOpen(false);
            message.success("自定义插件已安装");
            await reload();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "安装插件失败");
        }
    };

    const remove = (item: AdminPluginItem) => {
        modal.confirm({
            title: `卸载 ${item.manifest.name}？`,
            content: "插件包、平台状态和所有用户的启用记录都会删除。此操作不可撤销。",
            okText: "确认卸载",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                try {
                    await uninstallPlugin(item.manifest.id);
                    message.success("自定义插件已卸载");
                    await reload();
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "卸载插件失败");
                    throw error;
                }
            },
        });
    };

    const applicationCount = items.filter((item) => item.management.kind === "application").length;
    const protocolCount = items.filter((item) => item.management.kind === "protocol").length;
    const unavailableCount = items.filter((item) => states[item.manifest.id] && !states[item.manifest.id].platformAvailable).length;

    return (
        <AdminPageFrame
            title="插件管理"
            description="管理平台级可用性、自定义插件安装与用户启用范围"
            scroll
            actions={
                <>
                    <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void reload()}>
                        刷新
                    </Button>
                    <Button type="primary" icon={<CloudUpload className="size-4" />} onClick={() => setUploadOpen(true)}>
                        上传插件
                    </Button>
                </>
            }
        >
            <div className="grid gap-3 py-4 sm:grid-cols-3">
                <SummaryCard label="官方应用插件" value={applicationCount} detail="用户可自行启用" />
                <SummaryCard label="协议与自定义插件" value={protocolCount} detail="管理员统一控制" />
                <SummaryCard label="平台已停用" value={unavailableCount} detail="所有用户均不可使用" />
            </div>

            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-card/60 p-3">
                <Input className="min-w-[240px] flex-1" allowClear prefix={<Search className="size-4 text-foreground/40" />} value={search} placeholder="搜索插件名称、ID 或作者" onChange={(event) => setSearch(event.target.value)} />
                <Select
                    className="w-44"
                    value={kind}
                    onChange={setKind}
                    options={[
                        { value: "all", label: "全部类型" },
                        { value: "application", label: "官方应用插件" },
                        { value: "protocol", label: "系统协议插件" },
                        { value: "uploaded", label: "上传的自定义插件" },
                    ]}
                />
            </div>

            <div className="grid gap-3 pb-6 xl:grid-cols-2">
                {filtered.map((item) => {
                    const state = states[item.manifest.id];
                    const available = state?.platformAvailable ?? item.status === "enabled";
                    return (
                        <section key={item.manifest.id} className="rounded-xl border border-border/70 bg-card p-4 shadow-sm">
                            <div className="flex items-start gap-3">
                                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-foreground/65">
                                    <PlugZap className="size-5" />
                                </span>
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <h2 className="truncate font-semibold">{item.manifest.name}</h2>
                                        <span className="text-xs text-foreground/42">v{item.manifest.version}</span>
                                    </div>
                                    <div className="mt-1 flex flex-wrap gap-1.5">
                                        <Tag color={item.management.origin === "uploaded" ? "orange" : item.management.kind === "application" ? "blue" : "default"}>{managementLabel(item.management)}</Tag>
                                        {item.manifest.trusted ? (
                                            <Tag color="green" icon={<ShieldCheck className="mr-1 inline size-3" />}>
                                                可信
                                            </Tag>
                                        ) : null}
                                    </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                    <span className={`whitespace-nowrap text-xs font-medium ${available ? "text-status-success" : "text-foreground/52"}`}>
                                        {available ? "平台开放" : "平台停用"}
                                    </span>
                                    <Switch className="plugin-state-switch" loading={savingId === item.manifest.id} checked={available} aria-label={`${item.manifest.name}，当前${available ? "平台开放，点击停用" : "平台停用，点击开放"}`} onChange={(checked) => void changeAvailability(item, checked)} />
                                </div>
                            </div>
                            <p className="mt-3 line-clamp-2 min-h-10 text-sm leading-5 text-foreground/58">{item.manifest.description || "未提供插件说明"}</p>
                            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3 text-xs text-foreground/48">
                                <span className="truncate" title={item.manifest.id}>
                                    {item.manifest.id}
                                </span>
                                <div className="flex items-center gap-2">
                                    {item.management.activationScope === "user" ? (
                                        <span className="inline-flex items-center gap-1">
                                            <UsersRound className="size-3.5" />
                                            {state?.enabledUserCount || 0} 位用户启用
                                        </span>
                                    ) : (
                                        <span>全局生效</span>
                                    )}
                                    {item.management.origin === "uploaded" ? (
                                        <Button danger type="text" size="small" icon={<Trash2 className="size-3.5" />} onClick={() => remove(item)}>
                                            卸载
                                        </Button>
                                    ) : null}
                                </div>
                            </div>
                            {item.error ? <p className="mt-2 text-xs text-red-500">{item.error}</p> : null}
                        </section>
                    );
                })}
            </div>
            {!loading && filtered.length === 0 ? <div className="py-16 text-center text-sm text-foreground/45">没有匹配的插件</div> : null}
            <UploadPluginModal open={uploadOpen} onClose={() => setUploadOpen(false)} onUpload={(file) => void upload(file)} />
        </AdminPageFrame>
    );
}

function SummaryCard({ label, value, detail }: { label: string; value: number; detail: string }) {
    return (
        <div className="rounded-lg border border-border/70 bg-card p-4">
            <div className="text-xs text-foreground/45">{label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
            <div className="mt-1 text-xs text-foreground/40">{detail}</div>
        </div>
    );
}

function mergePlugins(remote: BackendPlugin[]): AdminPluginItem[] {
    const byId = new Map<string, AdminPluginItem>();
    for (const plugin of listRegisteredPlugins()) {
        const application = officialApplicationIds.has(plugin.manifest.id);
        byId.set(plugin.manifest.id, {
            manifest: plugin.manifest,
            source: plugin.source || "bundled",
            management: {
                origin: "official",
                kind: application ? "application" : "protocol",
                activationScope: application ? "user" : "system",
                configurationScope: application ? (plugin.manifest.id === EAGLE_PLUGIN_ID || plugin.manifest.id === RUNNINGHUB_PLUGIN_ID || plugin.manifest.id === COMFYUI_PLUGIN_ID ? "user" : "none") : "system",
            },
        });
    }
    for (const plugin of remote) byId.set(plugin.manifest.id, plugin);
    return [...byId.values()].sort((left, right) => managementOrder(left.management) - managementOrder(right.management) || left.manifest.name.localeCompare(right.manifest.name, "zh-CN"));
}

function managementOrder(value: PluginManagement) {
    if (value.kind === "application") return 0;
    if (value.origin === "official") return 1;
    return 2;
}

function managementLabel(value: PluginManagement) {
    if (value.origin === "uploaded") return "自定义插件";
    return value.kind === "application" ? "官方插件" : "系统插件";
}
