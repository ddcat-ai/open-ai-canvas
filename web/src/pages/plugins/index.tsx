import { App, Button, Input, Modal, Select, Switch, Typography } from "antd";
import { AudioLines, CalendarDays, CheckCircle2, Clock3, CloudUpload, ExternalLink, Film, FolderOpen, Image as ImageIcon, MessageSquareText, PlugZap, RefreshCw, Search, Settings2, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";

import { listRegisteredPlugins } from "@/lib/plugins/plugin-registry";
import "@/lib/plugins/builtin";
import { EAGLE_PLUGIN_ID } from "@/lib/plugins/builtin/eagle";
import { PROMPT_OPTIMIZER_PLUGIN_ID } from "@/lib/plugins/builtin/prompt-optimizer";
import type { PluginManifest, RegisteredPlugin } from "@/lib/plugins/plugin-types";
import { getEagleLibrary, type EagleFolder } from "@/services/api/eagle";
import { fetchPlugins, setPluginEnabled, uploadPlugin, type BackendPlugin } from "@/services/api/plugins";
import { usePluginStore } from "@/stores/use-plugin-store";
import { useUserStore } from "@/stores/use-user-store";

import { PluginDetailsModal, UploadPluginModal } from "./plugin-documentation-modals";
import "./plugins.css";

const categoryLabels: Record<string, string> = {
    "asset-source": "素材来源",
    "canvas-node": "画布节点",
    workflow: "工作流",
    "ai-capability": "AI 能力",
    "import-export": "导入导出",
    agent: "智能体",
    protocol: "请求协议",
};

const surfaceLabels: Record<string, string> = {
    node: "画布节点",
    fullscreen: "全屏工作台",
    hybrid: "混合接入",
    "asset-source": "素材库",
};

const permissionLabels: Record<string, string> = {
    "canvas.read": "读取画布",
    "canvas.write": "修改画布",
    "asset.read": "读取素材",
    "asset.search": "搜索素材",
    "asset.import": "导入素材",
    "asset.upload": "上传素材",
    "generation.run": "调用生成",
    "external.open": "打开外部详情",
};

const pluginDateFormatter = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" });

const protocolSectionMeta = [
    { key: "text", label: "文本协议", description: "对话、推理与流式响应", icon: MessageSquareText },
    { key: "image", label: "图片协议", description: "生成、编辑与参考图", icon: ImageIcon },
    { key: "video", label: "视频协议", description: "创建任务、轮询与媒体结果", icon: Film },
    { key: "audio", label: "音频协议", description: "语音与异步音频任务", icon: AudioLines },
] as const;

export default function PluginsPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const user = useUserStore((state) => state.user);
    const features = useUserStore((state) => state.features);
    const installations = usePluginStore((state) => state.installations);
    const ensurePlugin = usePluginStore((state) => state.ensurePlugin);
    const setEnabled = usePluginStore((state) => state.setEnabled);
    const updateConfig = usePluginStore((state) => state.updateConfig);
    const builtinPlugins = useMemo(() => listRegisteredPlugins(), []);
    const [backendPlugins, setBackendPlugins] = useState<BackendPlugin[]>([]);
    const [backendPluginsLoading, setBackendPluginsLoading] = useState(false);
    const [settingsPluginId, setSettingsPluginId] = useState<string | null>(null);
    const [detailsPluginId, setDetailsPluginId] = useState<string | null>(null);
    const [detailsRestoreFocus, setDetailsRestoreFocus] = useState(false);
    const [uploadModalOpen, setUploadModalOpen] = useState(false);
    const [search, setSearch] = useState("");
    const [categoryFilter, setCategoryFilter] = useState("all");
    const [statusFilter, setStatusFilter] = useState<"all" | "enabled" | "disabled">("all");
    const [trustFilter, setTrustFilter] = useState<"all" | "trusted">("all");
    const [eagleBaseUrl, setEagleBaseUrl] = useState("http://localhost:41595");
    const [eagleAutoUploadGenerated, setEagleAutoUploadGenerated] = useState(true);
    const [eagleGeneratedFolderId, setEagleGeneratedFolderId] = useState("");
    const [eagleFolders, setEagleFolders] = useState<EagleFolder[]>([]);
    const [eagleFoldersLoading, setEagleFoldersLoading] = useState(false);
    const [eagleFoldersError, setEagleFoldersError] = useState("");

    useEffect(() => {
        for (const plugin of builtinPlugins) ensurePlugin(plugin.manifest);
    }, [builtinPlugins, ensurePlugin]);

    const reloadBackendPlugins = async () => {
        setBackendPluginsLoading(true);
        try {
            setBackendPlugins(await fetchPlugins());
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取插件中心失败");
            setBackendPlugins([]);
        } finally {
            setBackendPluginsLoading(false);
        }
    };

    useEffect(() => {
        void reloadBackendPlugins();
    }, []);

    const remotePlugins = useMemo(() => backendPlugins.map(toRegisteredPlugin), [backendPlugins]);
    const registeredPlugins = useMemo(() => [...builtinPlugins, ...remotePlugins], [builtinPlugins, remotePlugins]);
    const backendPluginById = useMemo(() => new Map(backendPlugins.map((plugin) => [plugin.manifest.id, plugin])), [backendPlugins]);

    const eagle = installations.find((item) => item.manifest.id === EAGLE_PLUGIN_ID);

    useEffect(() => {
        const configured = eagle?.config.baseUrl;
        if (typeof configured === "string" && configured.trim()) setEagleBaseUrl(configured);
        const autoUpload = eagle?.config.autoUploadGenerated;
        setEagleAutoUploadGenerated(autoUpload !== false && autoUpload !== "false");
        const folderId = eagle?.config.generatedFolderId;
        setEagleGeneratedFolderId(typeof folderId === "string" ? folderId : "");
    }, [eagle?.config.baseUrl, eagle?.config.autoUploadGenerated, eagle?.config.generatedFolderId]);

    const filteredPlugins = useMemo(() => {
        const normalizedSearch = search.trim().toLocaleLowerCase();
        return registeredPlugins.filter((plugin) => {
            const isSystemPlugin = plugin.source !== "uploaded";
            if (user?.role !== "admin" && !features.systemPluginsVisibleToUsers && isSystemPlugin) return false;
            const installation = installations.find((item) => item.manifest.id === plugin.manifest.id);
            const enabled = plugin.manifest.kind === "protocol" ? backendPluginById.get(plugin.manifest.id)?.status === "enabled" : Boolean(installation?.enabled);
            const manifest = plugin.manifest;
            const searchableText = [manifest.name, manifest.description, manifest.author, manifest.id, categoryLabels[manifest.category]].filter(Boolean).join(" ").toLocaleLowerCase();
            if (normalizedSearch && !searchableText.includes(normalizedSearch)) return false;
            if (categoryFilter !== "all") {
                const matchesCapability = manifest.kind === "protocol" && manifest.protocol?.categories.includes(categoryFilter as "text" | "image" | "video" | "audio");
                const matchesApp = categoryFilter === "other" && manifest.kind !== "protocol";
                if (!matchesCapability && !matchesApp) return false;
            }
            if (trustFilter === "trusted" && !manifest.trusted) return false;
            if (statusFilter === "enabled" && !enabled) return false;
            if (statusFilter === "disabled" && enabled) return false;
            return true;
        });
    }, [backendPluginById, categoryFilter, features.systemPluginsVisibleToUsers, installations, registeredPlugins, search, statusFilter, trustFilter, user?.role]);

    const pluginSections = useMemo(
        () => [
            ...protocolSectionMeta.map((section) => ({ ...section, plugins: filteredPlugins.filter((plugin) => plugin.manifest.kind === "protocol" && plugin.manifest.protocol?.categories.includes(section.key)) })),
            { key: "other", label: "应用插件", description: "画布、素材与工作流扩展", icon: PlugZap, plugins: filteredPlugins.filter((plugin) => plugin.manifest.kind !== "protocol") },
        ],
        [filteredPlugins],
    );

    const categoryCounts = useMemo(() => {
        const visiblePlugins = registeredPlugins.filter((plugin) => user?.role === "admin" || features.systemPluginsVisibleToUsers || plugin.source === "uploaded");
        const counts: Record<string, number> = { all: visiblePlugins.length, text: 0, image: 0, video: 0, audio: 0, other: 0 };
        for (const plugin of visiblePlugins) {
            if (plugin.manifest.kind !== "protocol") {
                counts.other += 1;
                continue;
            }
            for (const capability of plugin.manifest.protocol?.categories || []) {
                counts[capability] = (counts[capability] || 0) + 1;
            }
        }
        return counts;
    }, [features.systemPluginsVisibleToUsers, registeredPlugins, user?.role]);

    const settingsPlugin = settingsPluginId ? registeredPlugins.find((plugin) => plugin.manifest.id === settingsPluginId) : undefined;
    const settingsInstallation = settingsPlugin ? installations.find((item) => item.manifest.id === settingsPlugin.manifest.id) : undefined;
    const settingsEnabled = settingsPlugin?.manifest.kind === "protocol" ? backendPluginById.get(settingsPlugin.manifest.id)?.status === "enabled" : Boolean(settingsInstallation?.enabled);
    const detailsPlugin = detailsPluginId ? registeredPlugins.find((plugin) => plugin.manifest.id === detailsPluginId) : undefined;

    const hasPluginConfiguration = (plugin: RegisteredPlugin) => Boolean(plugin.manifest.configuration?.fields.length);
    const canConfigurePlugin = (plugin: RegisteredPlugin) => hasPluginConfiguration(plugin) && user?.role === "admin";

    const isPluginEnabled = (plugin: RegisteredPlugin, installation = installations.find((item) => item.manifest.id === plugin.manifest.id)) =>
        plugin.manifest.kind === "protocol" ? backendPluginById.get(plugin.manifest.id)?.status === "enabled" : Boolean(installation?.enabled);

    const togglePlugin = async (plugin: RegisteredPlugin, enabled: boolean) => {
        if (plugin.manifest.kind !== "protocol") {
            setEnabled(plugin.manifest.id, enabled);
            return;
        }
        try {
            const next = await setPluginEnabled(plugin.manifest.id, enabled);
            setBackendPlugins((items) => items.map((item) => (item.manifest.id === next.manifest.id ? next : item)));
            message.success(`${plugin.manifest.name}${enabled ? "已启用" : "已停用"}`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "更新插件状态失败");
        }
    };

    const handleUpload = async (file: File) => {
        try {
            const plugin = await uploadPlugin(file);
            setBackendPlugins((items) => [...items.filter((item) => item.manifest.id !== plugin.manifest.id), plugin]);
            setUploadModalOpen(false);
            message.success("插件已安装并立即生效");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "安装插件失败");
        }
    };

    const loadEagleFolders = async (url = eagleBaseUrl) => {
        setEagleFoldersLoading(true);
        setEagleFoldersError("");
        try {
            const result = await getEagleLibrary(url.trim().replace(/\/$/, ""));
            setEagleFolders(result.library.folders || []);
        } catch (reason) {
            setEagleFoldersError(reason instanceof Error ? reason.message : "读取 Eagle 文件夹失败");
            setEagleFolders([]);
        } finally {
            setEagleFoldersLoading(false);
        }
    };

    const saveEagleConfig = () => {
        const baseUrl = eagleBaseUrl.trim().replace(/\/$/, "");
        if (!/^https?:\/\//i.test(baseUrl)) {
            message.error("Eagle 地址必须以 http:// 或 https:// 开头");
            return;
        }
        updateConfig(EAGLE_PLUGIN_ID, { baseUrl, autoUploadGenerated: eagleAutoUploadGenerated, generatedFolderId: eagleGeneratedFolderId });
        message.success("Eagle 插件配置已保存");
    };

    return (
        <main className="app-workspace-page plugins-page flex h-full min-h-0 flex-col text-foreground">
            <div className="app-workspace-scroll min-h-0 flex-1 overflow-y-auto">
                <div className="plugins-page-layout">
                    <aside className="plugins-sidebar" aria-label="插件分类">
                        <div className="plugins-sidebar-heading">
                            <span className="plugins-sidebar-kicker">PLUGIN CENTER</span>
                            <h1>插件中心</h1>
                            <p>统一管理能力插件与模型请求协议。</p>
                        </div>
                        <nav className="plugins-sidebar-nav">
                            <button type="button" className={`plugins-sidebar-item${categoryFilter === "all" ? " is-active" : ""}`} aria-current={categoryFilter === "all" ? "page" : undefined} onClick={() => setCategoryFilter("all")}>
                                <span className="plugins-sidebar-item-label">
                                    <PlugZap className="size-4" />
                                    全部插件
                                </span>
                                <span>{categoryCounts.all}</span>
                            </button>
                            {protocolSectionMeta.map((section) => {
                                const SectionIcon = section.icon;
                                return (
                                    <button
                                        key={section.key}
                                        type="button"
                                        className={`plugins-sidebar-item${categoryFilter === section.key ? " is-active" : ""}`}
                                        aria-current={categoryFilter === section.key ? "page" : undefined}
                                        onClick={() => setCategoryFilter(section.key)}
                                    >
                                        <span className="plugins-sidebar-item-label">
                                            <SectionIcon className="size-4" />
                                            {section.label}
                                        </span>
                                        <span>{categoryCounts[section.key] || 0}</span>
                                    </button>
                                );
                            })}
                            <button type="button" className={`plugins-sidebar-item${categoryFilter === "other" ? " is-active" : ""}`} aria-current={categoryFilter === "other" ? "page" : undefined} onClick={() => setCategoryFilter("other")}>
                                <span className="plugins-sidebar-item-label">
                                    <PlugZap className="size-4" />
                                    应用插件
                                </span>
                                <span>{categoryCounts.other}</span>
                            </button>
                        </nav>
                    </aside>
                    <div className="plugins-page-content">
                        <div className="plugins-toolbar" aria-label="插件筛选">
                            <Input
                                className="plugins-search"
                                prefix={<Search className="size-4 text-foreground/38" aria-hidden="true" />}
                                value={search}
                                allowClear
                                placeholder="搜索插件名称、描述或作者"
                                onChange={(event) => setSearch(event.target.value)}
                            />
                            <Select
                                className="plugins-filter"
                                value={statusFilter}
                                options={[
                                    { value: "all", label: "全部状态" },
                                    { value: "enabled", label: "已启用" },
                                    { value: "disabled", label: "未启用" },
                                ]}
                                onChange={(value) => setStatusFilter(value as "all" | "enabled" | "disabled")}
                                aria-label="按状态筛选"
                            />
                            <Select
                                className="plugins-filter"
                                value={trustFilter}
                                options={[
                                    { value: "all", label: "全部来源" },
                                    { value: "trusted", label: "可信插件" },
                                ]}
                                onChange={(value) => setTrustFilter(value as "all" | "trusted")}
                                aria-label="按来源筛选"
                            />
                            <span className="plugins-filter-icon" aria-hidden="true">
                                <SlidersHorizontal className="size-4" />
                            </span>
                            {user?.role === "admin" ? (
                                <div className="plugins-toolbar-actions">
                                    <Button icon={<RefreshCw className="size-4" />} loading={backendPluginsLoading} onClick={() => void reloadBackendPlugins()}>
                                        刷新插件
                                    </Button>
                                    <Button type="primary" icon={<CloudUpload className="size-4" />} onClick={() => setUploadModalOpen(true)}>
                                        上传插件
                                    </Button>
                                </div>
                            ) : null}
                        </div>

                        {filteredPlugins.length ? (
                            <div className="plugins-sections">
                                {pluginSections.map((section) => {
                                    if (!section.plugins.length) return null;
                                    const SectionIcon = section.icon;
                                    return (
                                        <section key={section.key} className="plugin-section">
                                            <header className="plugin-section-heading">
                                                <span className="plugin-section-icon">
                                                    <SectionIcon className="size-4" />
                                                </span>
                                                <div>
                                                    <h2>{section.label}</h2>
                                                    <p>{section.description}</p>
                                                </div>
                                                <span className="plugin-section-count">{section.plugins.length}</span>
                                            </header>
                                            <div className="plugins-grid">
                                                {section.plugins.map((plugin) => {
                                                    const installation = installations.find((item) => item.manifest.id === plugin.manifest.id);
                                                    const remote = backendPluginById.get(plugin.manifest.id);
                                                    const enabled = isPluginEnabled(plugin, installation);
                                                    const trusted = Boolean(plugin.manifest.trusted);
                                                    const isSystemPlugin = plugin.source !== "uploaded";
                                                    const canConfigure = canConfigurePlugin(plugin);
                                                    return (
                                                        <section key={plugin.manifest.id} className={`plugin-card library-card-surface${trusted ? " is-trusted" : ""}`}>
                                                            <button
                                                                type="button"
                                                                className="plugin-card-main"
                                                                aria-label={`查看${plugin.manifest.name}文档`}
                                                                onClick={(event) => {
                                                                    const openedByKeyboard = event.detail === 0;
                                                                    setDetailsRestoreFocus(openedByKeyboard);
                                                                    setDetailsPluginId(plugin.manifest.id);
                                                                    if (!openedByKeyboard) event.currentTarget.blur();
                                                                }}
                                                            >
                                                                <div className="plugin-card-heading">
                                                                    <span className={`plugin-icon-tile${trusted ? " is-trusted" : ""}`} aria-hidden="true">
                                                                        <PlugZap className="size-5" />
                                                                    </span>
                                                                    <div className="min-w-0 flex-1">
                                                                        <div className="plugin-card-title-row">
                                                                            <h3>{plugin.manifest.name}</h3>
                                                                            <span className="plugin-version">v{plugin.manifest.version}</span>
                                                                        </div>
                                                                        <div className="plugin-card-labels">
                                                                            <span className={`plugin-source-label${isSystemPlugin ? " is-system" : ""}`}>
                                                                                {isSystemPlugin ? "系统插件" : "用户插件"}
                                                                            </span>
                                                                            {trusted ? (
                                                                                <span className="plugin-trust-label">
                                                                                    <ShieldCheck className="size-3.5" />
                                                                                    可信插件
                                                                                </span>
                                                                            ) : null}
                                                                            <span className="plugin-category-label">{categoryLabels[plugin.manifest.category] ?? plugin.manifest.category}</span>
                                                                        </div>
                                                                    </div>
                                                                </div>

                                                                <p className="plugin-card-description">{plugin.manifest.description}</p>

                                                                <div className="plugin-card-meta">
                                                                    <span>
                                                                        <CalendarDays className="size-3.5" />
                                                                        发布 {formatPluginDate(plugin.manifest.publishedAt)}
                                                                    </span>
                                                                    <span>
                                                                        <Clock3 className="size-3.5" />
                                                                        更新 {formatPluginDate(plugin.manifest.updatedAt)}
                                                                    </span>
                                                                </div>

                                                                <div className="plugin-card-tags">
                                                                    {plugin.manifest.surfaces.map((surface) => (
                                                                        <span key={surface}>{surfaceLabels[surface] ?? surface}</span>
                                                                    ))}
                                                                    {plugin.manifest.protocol?.categories.map((capability) => (
                                                                        <span key={capability}>{capabilityLabel(capability)}</span>
                                                                    ))}
                                                                    {plugin.manifest.protocol?.poll ? <span>异步轮询</span> : null}
                                                                    <span>{plugin.manifest.permissions.length} 项能力</span>
                                                                </div>
                                                            </button>

                                                            <div className="plugin-card-actions">
                                                                <span role="status" className={`settings-channel-status ${enabled ? "is-ready" : ""}`}>
                                                                    <i aria-hidden="true" />
                                                                    {enabled ? "已启用" : "未启用"}
                                                                </span>
                                                                <Switch disabled={user?.role !== "admin"} checked={enabled} aria-label={`${plugin.manifest.name}${enabled ? "停用" : "启用"}`} onChange={(checked) => void togglePlugin(plugin, checked)} />
                                                                {canConfigure ? (
                                                                    <Button
                                                                        className="plugin-settings-button"
                                                                        icon={<Settings2 className="size-4" />}
                                                                        aria-expanded={settingsPluginId === plugin.manifest.id}
                                                                        aria-haspopup="dialog"
                                                                        onClick={() => setSettingsPluginId(plugin.manifest.id)}
                                                                    >
                                                                        设置
                                                                    </Button>
                                                                ) : null}
                                                            </div>

                                                            {installation?.lastError || remote?.error ? (
                                                                <Typography.Text type="danger" className="plugin-error" role="alert">
                                                                    {installation?.lastError || remote?.error}
                                                                </Typography.Text>
                                                            ) : null}
                                                        </section>
                                                    );
                                                })}
                                            </div>
                                        </section>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="plugins-empty-state">
                                <SlidersHorizontal className="size-7" aria-hidden="true" />
                                <h3>没有匹配的插件</h3>
                                <p>试试清空搜索词，或放宽筛选条件。</p>
                                <Button
                                    onClick={() => {
                                        setSearch("");
                                        setCategoryFilter("all");
                                        setStatusFilter("all");
                                        setTrustFilter("all");
                                    }}
                                >
                                    清除筛选
                                </Button>
                            </div>
                        )}

                        <UploadPluginModal open={uploadModalOpen} onClose={() => setUploadModalOpen(false)} onUpload={(file) => void handleUpload(file)} />
                        <Modal
                            className="workspace-modal workspace-modal-wide plugin-settings-modal"
                            title={settingsPlugin ? `${settingsPlugin.manifest.name} 设置` : null}
                            open={Boolean(settingsPlugin)}
                            centered
                            footer={null}
                            destroyOnHidden
                            onCancel={() => setSettingsPluginId(null)}
                            styles={{ body: { maxHeight: "min(72vh, 760px)", overflowY: "auto", overscrollBehavior: "contain" } }}
                        >
                            {settingsPlugin ? (
                                <div className="plugin-settings-panel plugin-settings-modal-panel">
                                    <div className="plugin-settings-heading">
                                        <div>
                                            <p>只展示这个插件实际支持的配置项。</p>
                                        </div>
                                        {settingsPlugin.manifest.trusted ? (
                                            <span className="plugin-trust-label">
                                                <ShieldCheck className="size-3.5" />
                                                可信插件
                                            </span>
                                        ) : (
                                            <span className="plugin-category-label">第三方插件</span>
                                        )}
                                    </div>

                                    {settingsPlugin.manifest.id === EAGLE_PLUGIN_ID ? (
                                        <>
                                            <div className="plugin-settings-fields">
                                                <div className="min-w-0">
                                                    <label htmlFor="eagle-base-url">Eagle 本地 API 地址</label>
                                                    <Input id="eagle-base-url" aria-label="Eagle 本地 API 地址" value={eagleBaseUrl} onChange={(event) => setEagleBaseUrl(event.target.value)} placeholder="http://localhost:41595" />
                                                    <p>Eagle 必须在本机运行；影策通过插件直接读取和写入 Eagle 原始文件。</p>
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="plugin-setting-label-row">
                                                        <label htmlFor="eagle-auto-upload-generated">自动归档生成结果</label>
                                                        <Switch id="eagle-auto-upload-generated" checked={eagleAutoUploadGenerated} onChange={setEagleAutoUploadGenerated} aria-label="自动归档生成结果到 Eagle" />
                                                    </div>
                                                    <p>图片、视频和音频生成成功后，自动写入 Eagle；影策本地素材仍会保留。</p>
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="plugin-setting-label-row">
                                                        <label htmlFor="eagle-generated-folder">生成结果写入文件夹</label>
                                                        <Button type="link" size="small" loading={eagleFoldersLoading} onClick={() => void loadEagleFolders()}>
                                                            读取文件夹
                                                        </Button>
                                                    </div>
                                                    <Select
                                                        id="eagle-generated-folder"
                                                        aria-label="生成结果写入文件夹"
                                                        showSearch
                                                        allowClear
                                                        value={eagleGeneratedFolderId || undefined}
                                                        placeholder="Eagle 根目录"
                                                        optionFilterProp="label"
                                                        options={[{ value: "__root__", label: "Eagle 根目录" }, ...eagleFolderOptions(eagleFolders)]}
                                                        onChange={(value) => setEagleGeneratedFolderId(value === "__root__" || !value ? "" : value)}
                                                    />
                                                    <p>{eagleFoldersError || "默认写入 Eagle 根目录；选择文件夹后按 Eagle 原始目录归档。"}</p>
                                                </div>
                                            </div>
                                            <div className="plugin-settings-actions">
                                                <Button type="primary" icon={<CheckCircle2 className="size-4" />} onClick={saveEagleConfig}>
                                                    保存配置
                                                </Button>
                                                <Button icon={<FolderOpen className="size-4" />} disabled={!settingsEnabled} onClick={() => navigate("/plugins/eagle")}>
                                                    打开 Eagle 素材库
                                                </Button>
                                                <Button icon={<ExternalLink className="size-4" />} href="https://api.eagle.cool/" target="_blank">
                                                    查看 API
                                                </Button>
                                            </div>
                                        </>
                                    ) : settingsPlugin.manifest.id === PROMPT_OPTIMIZER_PLUGIN_ID ? (
                                        <div className="rounded-[var(--r-md)] border border-border/60 bg-muted/25 px-3 py-3 text-[var(--fs-body)] leading-6 text-foreground/70">
                                            <p>在创作页或图片、视频节点的提示词编辑器中使用“优化”按钮，即可让当前文本模型整理提示词。</p>
                                            <p className="mt-2 text-[var(--fs-micro)] text-foreground/50">插件不会自动覆盖原提示词，只有点击“采用”后才会回填到当前输入框。</p>
                                        </div>
                                    ) : (
                                        <div className="plugin-settings-empty">
                                            {settingsPlugin.manifest.kind === "protocol"
                                                ? `协议能力：${settingsPlugin.manifest.protocol?.categories.map(capabilityLabel).join("、") || "未声明"}；可用场景：${settingsPlugin.manifest.protocol?.scopes.join("、") || "未声明"}。`
                                                : "该插件暂无可编辑设置项。当前接入位置和权限会根据插件清单自动生效。"}
                                        </div>
                                    )}

                                    <div className="plugin-permissions">
                                        <div>
                                            <span>接入位置</span>
                                            {settingsPlugin.manifest.surfaces.map((surface) => surfaceLabels[surface] ?? surface).join("、")}
                                        </div>
                                        <div>
                                            <span>插件能力</span>
                                            {settingsPlugin.manifest.permissions.map((permission) => permissionLabels[permission] ?? permission).join("、")}
                                        </div>
                                    </div>
                                </div>
                            ) : null}
                        </Modal>
                        <PluginDetailsModal plugin={detailsPlugin} restoreFocus={detailsRestoreFocus} onClose={() => setDetailsPluginId(null)} />
                    </div>
                </div>
            </div>
        </main>
    );
}

function formatPluginDate(value?: string) {
    if (!value) return "未记录";
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? pluginDateFormatter.format(timestamp) : "未记录";
}

function toRegisteredPlugin(plugin: BackendPlugin): RegisteredPlugin {
    const manifest: PluginManifest = {
        id: plugin.manifest.id,
        name: plugin.manifest.name,
        version: plugin.manifest.version,
        publishedAt: plugin.installedAt,
        updatedAt: plugin.updatedAt,
        apiVersion: plugin.manifest.apiVersion,
        category: "protocol",
        description: plugin.manifest.description || "模型请求协议适配插件",
        author: plugin.manifest.author,
        surfaces: ["hybrid"],
        permissions: ["generation.run"],
        trusted: plugin.manifest.trusted,
        kind: "protocol",
        protocol: plugin.manifest.protocol,
    };
    return { manifest, source: plugin.source };
}

function capabilityLabel(value: string) {
    return ({ text: "文本", image: "图片", video: "视频", audio: "音频" } as Record<string, string>)[value] || value;
}

function eagleFolderOptions(folders: EagleFolder[]) {
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const pathFor = (folder: EagleFolder) => {
        const path: string[] = [];
        const seen = new Set<string>();
        let current: EagleFolder | undefined = folder;
        while (current && !seen.has(current.id)) {
            seen.add(current.id);
            path.unshift(current.name);
            current = current.parentId ? byId.get(current.parentId) : undefined;
        }
        return path.join(" / ");
    };
    return folders.map((folder) => ({ value: folder.id, label: pathFor(folder) })).sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));
}
