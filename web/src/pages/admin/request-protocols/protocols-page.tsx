import { useEffect, useState } from "react";
import { Alert, App, Button, Input, Select, Tabs } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Copy, History, Link2, PlugZap, Plus, RefreshCw, Search } from "lucide-react";
import { useNavigate } from "react-router";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminDataTable, AdminEmpty, AdminStatusBadge } from "../components/admin-ui";
import { AdminModal } from "../ui/overlays";
import { listRequestProtocols, type RequestProtocol, type RequestProtocolRelease } from "@/services/api/request-protocols";
import { listAdminAllChannelModels, updateAdminAllChannelModels, type AdminChannelModelListItem } from "@/services/api/wallet";
import { assertBatchModelSelectionCurrent } from "../components/channel-model-batch-edit";
import { getActiveUserScope } from "@/lib/user-scope";
import { useUserStore } from "@/stores/use-user-store";
import { ProtocolEditor } from "./protocol-editor";
import { protocolCapabilities, shortReleaseDigest } from "./protocol-form";
import "./protocols.css";

function currentReleaseFor(item: RequestProtocol): RequestProtocolRelease {
    return item.releases.find((release) => release.current) || item.releases[0] || { version: item.version, sha256: item.sha256, current: true, manifest: item.manifest, bindings: item.bindings };
}

export default function RequestProtocolsPage() {
    const navigate = useNavigate();
    const { message } = App.useApp();
    const [items, setItems] = useState<RequestProtocol[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [scope, setScope] = useState<"custom" | "templates">("custom");
    const [search, setSearch] = useState("");
    const [editor, setEditor] = useState<{ item?: RequestProtocol; baseRelease?: RequestProtocolRelease; copy?: boolean }>();
    const [history, setHistory] = useState<RequestProtocol>();
    const [binding, setBinding] = useState<{ item: RequestProtocol; release: RequestProtocolRelease }>();
    const reload = async () => {
        setLoading(true);
        setError("");
        try {
            setItems(await listRequestProtocols());
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "读取请求协议失败");
            throw cause;
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => {
        void reload().catch(() => {});
    }, []);
    const customItems = items.filter((item) => !item.readOnly);
    const rows = items
        .filter((item) => item.readOnly === (scope === "templates"))
        .filter((item) => {
            const query = search.trim().toLowerCase();
            const provider = item.manifest.contributes.providers[0];
            return !query || [item.id, item.providerId, item.manifest.name, provider.create.path, provider.poll?.path].join(" ").toLowerCase().includes(query);
        });
    const columns: ColumnsType<RequestProtocol> = [
        {
            title: "请求协议",
            key: "name",
            width: 260,
            render: (_, item) => (
                <div>
                    <button className="protocol-name" onClick={() => setEditor({ item })}>
                        {item.manifest.name}
                    </button>
                    <div className="protocol-hint">{item.providerId === item.id ? item.id : `${item.providerId} · ${item.id}`}</div>
                </div>
            ),
        },
        {
            title: "能力",
            key: "capability",
            width: 80,
            render: (_, item) => protocolCapabilities.find((capability) => capability.value === item.manifest.contributes.providers[0].capabilities[0])?.label || "多模态",
        },
        {
            title: "创建 / 查询",
            key: "endpoints",
            width: 300,
            render: (_, item) => {
                const provider = item.manifest.contributes.providers[0];
                return (
                    <div className="protocol-endpoints">
                        <span>
                            {provider.create.method} {provider.create.path}
                        </span>
                        <span>{provider.poll ? provider.poll.method + " " + provider.poll.path : "同步返回结果"}</span>
                    </div>
                );
            },
        },
        {
            title: "发行版本",
            key: "version",
            width: 145,
            render: (_, item) => (
                <div>
                    <div className="flex items-center gap-1.5">
                        <span>v{item.version}</span>
                        {item.readOnly && <AdminStatusBadge tone="neutral" label={item.source === "uploaded" ? "自定义包" : "官方模板"} />}
                    </div>
                    <div className="protocol-hint">{item.releases.length > 1 ? `${item.releases.length} 个归档版` : shortReleaseDigest(item.sha256) || "内置清单"}</div>
                </div>
            ),
        },
        {
            title: "模型绑定",
            key: "bindings",
            width: 110,
            render: (_, item) => (
                <button className="protocol-name" disabled={!item.enabled} onClick={() => setBinding({ item, release: currentReleaseFor(item) })}>
                    {item.bindings.length} 个模型
                </button>
            ),
        },
        {
            title: "操作",
            key: "actions",
            width: 260,
            render: (_, item) => (
                <div className="protocol-row-actions">
                    <Button size="small" type="text" onClick={() => setEditor({ item })}>
                        {item.readOnly ? "查看" : "编辑"}
                    </Button>
                    <Button size="small" type="text" icon={<Copy size={14} />} onClick={() => setEditor({ item, copy: true })}>
                        复制
                    </Button>
                    {item.releases.length > 0 && (
                        <Button size="small" type="text" icon={<History size={14} />} onClick={() => setHistory(item)}>
                            版本
                        </Button>
                    )}
                    <Button size="small" type="text" icon={<Link2 size={14} />} disabled={!item.enabled} onClick={() => setBinding({ item, release: currentReleaseFor(item) })}>
                        绑定
                    </Button>
                </div>
            ),
        },
    ];
    return (
        <AdminPageFrame
            title="请求协议管理"
            description="基于声明式 .yingce-plugin 发行模型在线配置、离线校验、发布归档版本并按插件版本绑定渠道模型。"
            actions={
                <>
                    <Button icon={<PlugZap size={15} />} onClick={() => navigate("/admin/plugins")}>
                        插件管理
                    </Button>
                    <Button icon={<RefreshCw size={15} />} loading={loading} onClick={() => void reload().catch(() => {})}>
                        刷新
                    </Button>
                    <Button type="primary" icon={<Plus size={15} />} onClick={() => setEditor({})}>
                        新建协议
                    </Button>
                </>
            }
        >
            <div className="request-protocol-page">
                <div className="protocol-page-summary">
                    <div>
                        <strong>{customItems.length}</strong>
                        <span>自定义协议</span>
                    </div>
                    <div>
                        <strong>{customItems.reduce((total, item) => total + item.releases.length, 0)}</strong>
                        <span>归档发行版</span>
                    </div>
                    <p>先离线校验，再发布标准 .yingce-plugin 发行版，最后按插件版本摘要绑定模型；历史版本保留，在途任务沿用原摘要。</p>
                </div>
                {error && <Alert type="error" showIcon title={error} />}
                <Tabs
                    activeKey={scope}
                    onChange={(key) => setScope(key === "templates" ? "templates" : "custom")}
                    items={[
                        { key: "custom", label: "自定义协议" },
                        { key: "templates", label: "内置与插件模板 · 可复制" },
                    ]}
                />
                <AdminDataTable
                    toolbar={<Input aria-label="搜索请求协议" className="app-list-search" allowClear prefix={<Search size={15} />} placeholder="搜索名称、标识或接口路径" value={search} onChange={(event) => setSearch(event.target.value)} />}
                    table={{
                        rowKey: (item) => `${item.id}:${item.providerId}`,
                        columns,
                        dataSource: rows,
                        loading,
                        pagination: { defaultPageSize: 15, showSizeChanger: true },
                        scroll: { x: 1080 },
                    }}
                    empty={<AdminEmpty title={search ? "没有匹配的请求协议" : "从第一个请求协议开始"} description={search ? "尝试其他名称或路径。" : "新建声明式协议，或从内置模板复制后修改。"} />}
                />
            </div>
            {editor && (
                <ProtocolEditor
                    key={`${editor.item?.id || "new"}:${editor.baseRelease?.sha256 || editor.item?.sha256 || ""}:${Boolean(editor.copy)}`}
                    item={editor.item}
                    baseRelease={editor.baseRelease}
                    copy={editor.copy}
                    onClose={() => setEditor(undefined)}
                    onSaved={async () => {
                        await reload();
                        setScope("custom");
                    }}
                />
            )}
            <AdminModal open={Boolean(history)} title={history ? `插件发行版本 · ${history.manifest.name}` : "插件发行版本"} footer={<Button onClick={() => setHistory(undefined)}>关闭</Button>} onCancel={() => setHistory(undefined)} width={820}>
                <p className="protocol-hint">同一协议标识支持保留多个已归档的 .yingce-plugin 发行版；模型可显式绑定或回退到任意版本，在途任务继续按原摘要执行。</p>
                {history?.releases.map((release) => (
                    <div className="protocol-version-row" key={release.sha256 || release.version}>
                        <div>
                            <strong>v{release.version}</strong>
                            <AdminStatusBadge tone={release.current ? "success" : "neutral"} label={release.current ? "当前版" : "已归档"} />
                            {release.sha256 && <code className="protocol-release-sha">{shortReleaseDigest(release.sha256)}</code>}
                            <small>{release.bindings.length} 个模型</small>
                        </div>
                        <Button
                            onClick={() => {
                                const target = history;
                                setHistory(undefined);
                                setEditor({ item: target, baseRelease: release });
                            }}
                        >
                            {history.readOnly ? "查看" : "基于此版编辑"}
                        </Button>
                        <Button
                            disabled={!history.enabled}
                            onClick={() => {
                                const target = history;
                                setHistory(undefined);
                                setBinding({ item: target, release });
                            }}
                        >
                            绑定此版本
                        </Button>
                    </div>
                ))}
            </AdminModal>
            {binding && (
                <ProtocolBindingDialog
                    item={binding.item}
                    release={binding.release}
                    onClose={() => setBinding(undefined)}
                    onSaved={async () => {
                        await reload();
                        message.success("模型绑定已保存并回读确认");
                    }}
                />
            )}
        </AdminPageFrame>
    );
}

function ProtocolBindingDialog({ item, release, onClose, onSaved }: { item: RequestProtocol; release: RequestProtocolRelease; onClose: () => void; onSaved: () => Promise<void> }) {
    const [scope] = useState(getActiveUserScope);
    const [models, setModels] = useState<AdminChannelModelListItem[]>([]);
    const [selected, setSelected] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [saved, setSaved] = useState(false);
    const assertScope = () => {
        if (scope === "guest" || getActiveUserScope() !== scope || useUserStore.getState().user?.id !== scope) throw new Error("账号已切换，请重新打开模型绑定");
    };
    useEffect(() => {
        let active = true;
        void listAdminAllChannelModels()
            .then((result) => {
                if (active) {
                    assertScope();
                    setModels(result.models);
                }
            })
            .catch((cause) => {
                if (active) setError(cause instanceof Error ? cause.message : "读取模型失败");
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, []);
    const supported = models.filter((model) => release.manifest.contributes.providers[0].capabilities.includes(model.capability));
    const alreadyPinned = (model: AdminChannelModelListItem) => model.protocol === item.providerId && (release.sha256 ? model.protocolRelease === release.sha256 : !model.protocolRelease);
    const save = async () => {
        if (saving || saved) return;
        setSaving(true);
        setError("");
        try {
            assertScope();
            if (!selected.length || selected.length > 100) throw new Error("请选择 1–100 个模型");
            const chosen = supported.filter((model) => selected.includes(model.id));
            if (chosen.length !== selected.length) throw new Error("所选模型不完整，请刷新后重试");
            const current = (await listAdminAllChannelModels()).models;
            assertScope();
            assertBatchModelSelectionCurrent(chosen, current);
            await updateAdminAllChannelModels(
                chosen.map((model) => ({
                    modelId: model.id,
                    priceVersion: model.priceVersion,
                    capabilityVersion: model.capabilityVersion ?? 0,
                    updatedAt: model.updatedAt,
                    changes: {
                        protocol: item.providerId,
                        ...(release.sha256 ? { protocolRelease: release.sha256 } : {}),
                    },
                })),
            );
            setSaved(true);
            const readback = (await listAdminAllChannelModels()).models;
            assertScope();
            if (chosen.some((model) => !readback.some((row) => row.id === model.id && row.protocol === item.providerId && (!release.sha256 || row.protocolRelease === release.sha256)))) {
                throw new Error("写入已完成，但模型绑定回读不一致，请刷新核对");
            }
            await onSaved();
            onClose();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "模型绑定失败");
        } finally {
            setSaving(false);
        }
    };
    return (
        <AdminModal
            open
            title={`绑定请求协议 · ${item.manifest.name} v${release.version}`}
            width={650}
            onCancel={() => {
                if (!saving) onClose();
            }}
            onOk={() => void save()}
            okText="保存模型绑定"
            confirmLoading={saving}
            okButtonProps={{ disabled: loading || !selected.length || saving || saved }}
            cancelText="关闭"
            cancelButtonProps={{ disabled: saving }}
        >
            <div className="space-y-4">
                <p>选择要绑定或切换版本的渠道模型。保存时会核对能力和价格配置；不兼容时整批拒绝。</p>
                <Select
                    aria-label="要绑定的渠道模型"
                    className="w-full"
                    mode="multiple"
                    showSearch
                    optionFilterProp="label"
                    loading={loading}
                    disabled={loading || saving || saved}
                    value={selected}
                    placeholder="选择渠道模型"
                    options={supported.map((model) => ({
                        value: model.id,
                        label: `${model.channelName} · ${model.displayName || model.modelKey}${model.protocol === item.providerId ? "（同协议）" : ""}`,
                        disabled: alreadyPinned(model),
                    }))}
                    onChange={setSelected}
                />
                <p className="protocol-hint">
                    目标发行版：{item.providerId} @ v{release.version}
                    {release.sha256 ? `（${shortReleaseDigest(release.sha256)}）` : ""}。进行中的任务继续使用入队时锁定的协议摘要。
                </p>
                {error && <Alert type="error" showIcon title={error} />}
            </div>
        </AdminModal>
    );
}
