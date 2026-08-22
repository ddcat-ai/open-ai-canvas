import { App, Button, Input, Modal, Select, Switch, Typography } from "antd";
import { CalendarDays, CheckCircle2, Clock3, ExternalLink, FolderOpen, PlugZap, Search, Settings2, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";

import { listRegisteredPlugins } from "@/lib/plugins/plugin-registry";
import "@/lib/plugins/builtin";
import { EAGLE_PLUGIN_ID } from "@/lib/plugins/builtin/eagle";
import { getEagleLibrary, type EagleFolder } from "@/services/api/eagle";
import { usePluginStore } from "@/stores/use-plugin-store";

import "./plugins.css";

const categoryLabels: Record<string, string> = {
    "asset-source": "素材来源",
    "canvas-node": "画布节点",
    workflow: "工作流",
    "ai-capability": "AI 能力",
    "import-export": "导入导出",
    agent: "智能体",
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

export default function PluginsPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const installations = usePluginStore((state) => state.installations);
    const ensurePlugin = usePluginStore((state) => state.ensurePlugin);
    const setEnabled = usePluginStore((state) => state.setEnabled);
    const updateConfig = usePluginStore((state) => state.updateConfig);
    const registeredPlugins = useMemo(() => listRegisteredPlugins(), []);
    const [settingsPluginId, setSettingsPluginId] = useState<string | null>(null);
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
        for (const plugin of registeredPlugins) ensurePlugin(plugin.manifest);
    }, [ensurePlugin, registeredPlugins]);

    const eagle = installations.find((item) => item.manifest.id === EAGLE_PLUGIN_ID);

    useEffect(() => {
        const configured = eagle?.config.baseUrl;
        if (typeof configured === "string" && configured.trim()) setEagleBaseUrl(configured);
        const autoUpload = eagle?.config.autoUploadGenerated;
        setEagleAutoUploadGenerated(autoUpload !== false && autoUpload !== "false");
        const folderId = eagle?.config.generatedFolderId;
        setEagleGeneratedFolderId(typeof folderId === "string" ? folderId : "");
    }, [eagle?.config.baseUrl, eagle?.config.autoUploadGenerated, eagle?.config.generatedFolderId]);

    const categoryOptions = useMemo(() => [
        { value: "all", label: "全部分类" },
        ...Array.from(new Set(registeredPlugins.map((plugin) => plugin.manifest.category))).map((category) => ({ value: category, label: categoryLabels[category] ?? category })),
    ], [registeredPlugins]);

    const filteredPlugins = useMemo(() => {
        const normalizedSearch = search.trim().toLocaleLowerCase();
        return registeredPlugins.filter((plugin) => {
            const installation = installations.find((item) => item.manifest.id === plugin.manifest.id);
            const manifest = plugin.manifest;
            const searchableText = [manifest.name, manifest.description, manifest.author, manifest.id, categoryLabels[manifest.category]].filter(Boolean).join(" ").toLocaleLowerCase();
            if (normalizedSearch && !searchableText.includes(normalizedSearch)) return false;
            if (categoryFilter !== "all" && manifest.category !== categoryFilter) return false;
            if (trustFilter === "trusted" && !manifest.trusted) return false;
            if (statusFilter === "enabled" && !installation?.enabled) return false;
            if (statusFilter === "disabled" && installation?.enabled) return false;
            return true;
        });
    }, [categoryFilter, installations, registeredPlugins, search, statusFilter, trustFilter]);

    const settingsPlugin = settingsPluginId ? registeredPlugins.find((plugin) => plugin.manifest.id === settingsPluginId) : undefined;
    const settingsInstallation = settingsPlugin ? installations.find((item) => item.manifest.id === settingsPlugin.manifest.id) : undefined;
    const settingsEnabled = Boolean(settingsInstallation?.enabled);

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
                        <Select className="plugins-filter" value={categoryFilter} options={categoryOptions} onChange={setCategoryFilter} aria-label="按分类筛选" />
                        <Select
                            className="plugins-filter"
                            value={statusFilter}
                            options={[{ value: "all", label: "全部状态" }, { value: "enabled", label: "已启用" }, { value: "disabled", label: "未启用" }]}
                            onChange={(value) => setStatusFilter(value as "all" | "enabled" | "disabled")}
                            aria-label="按状态筛选"
                        />
                        <Select
                            className="plugins-filter"
                            value={trustFilter}
                            options={[{ value: "all", label: "全部来源" }, { value: "trusted", label: "可信插件" }]}
                            onChange={(value) => setTrustFilter(value as "all" | "trusted")}
                            aria-label="按来源筛选"
                        />
                        <span className="plugins-filter-icon" aria-hidden="true"><SlidersHorizontal className="size-4" /></span>
                    </div>

                    {filteredPlugins.length ? (
                        <div className="plugins-grid">
                            {filteredPlugins.map((plugin) => {
                                const installation = installations.find((item) => item.manifest.id === plugin.manifest.id);
                                const enabled = Boolean(installation?.enabled);
                                const trusted = Boolean(plugin.manifest.trusted);
                                return (
                                    <section key={plugin.manifest.id} className={`plugin-card library-card-surface${trusted ? " is-trusted" : ""}`}>
                                        <div className="plugin-card-main">
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
                                                        {trusted ? <span className="plugin-trust-label"><ShieldCheck className="size-3.5" />可信插件</span> : null}
                                                        <span className="plugin-category-label">{categoryLabels[plugin.manifest.category] ?? plugin.manifest.category}</span>
                                                    </div>
                                                </div>
                                            </div>

                                            <p className="plugin-card-description">{plugin.manifest.description}</p>

                                            <div className="plugin-card-meta">
                                                <span><CalendarDays className="size-3.5" />发布 {formatPluginDate(plugin.manifest.publishedAt)}</span>
                                                <span><Clock3 className="size-3.5" />更新 {formatPluginDate(plugin.manifest.updatedAt)}</span>
                                            </div>

                                            <div className="plugin-card-tags">
                                                {plugin.manifest.surfaces.map((surface) => <span key={surface}>{surfaceLabels[surface] ?? surface}</span>)}
                                                <span>{plugin.manifest.permissions.length} 项能力</span>
                                            </div>
                                        </div>

                                        <div className="plugin-card-actions">
                                            <span role="status" className={`settings-channel-status ${enabled ? "is-ready" : ""}`}>
                                                <i aria-hidden="true" />
                                                {enabled ? "已启用" : "未启用"}
                                            </span>
                                            <Switch checked={enabled} aria-label={`${plugin.manifest.name}${enabled ? "停用" : "启用"}`} onChange={(checked) => setEnabled(plugin.manifest.id, checked)} />
                                            <Button
                                                className="plugin-settings-button"
                                                icon={<Settings2 className="size-4" />}
                                                aria-expanded={settingsPluginId === plugin.manifest.id}
                                                aria-haspopup="dialog"
                                                onClick={() => setSettingsPluginId(plugin.manifest.id)}
                                            >
                                                设置
                                            </Button>
                                        </div>

                                        {installation?.lastError ? <Typography.Text type="danger" className="plugin-error" role="alert">{installation.lastError}</Typography.Text> : null}
                                    </section>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="plugins-empty-state">
                            <SlidersHorizontal className="size-7" aria-hidden="true" />
                            <h3>没有匹配的插件</h3>
                            <p>试试清空搜索词，或放宽筛选条件。</p>
                            <Button onClick={() => { setSearch(""); setCategoryFilter("all"); setStatusFilter("all"); setTrustFilter("all"); }}>清除筛选</Button>
                        </div>
                    )}

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
                                    {settingsPlugin.manifest.trusted ? <span className="plugin-trust-label"><ShieldCheck className="size-3.5" />可信插件</span> : <span className="plugin-category-label">第三方插件</span>}
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
                                                    <Button type="link" size="small" loading={eagleFoldersLoading} onClick={() => void loadEagleFolders()}>读取文件夹</Button>
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
                                            <Button type="primary" icon={<CheckCircle2 className="size-4" />} onClick={saveEagleConfig}>保存配置</Button>
                                            <Button icon={<FolderOpen className="size-4" />} disabled={!settingsEnabled} onClick={() => navigate("/plugins/eagle")}>打开 Eagle 素材库</Button>
                                            <Button icon={<ExternalLink className="size-4" />} href="https://api.eagle.cool/" target="_blank">查看 API</Button>
                                        </div>
                                    </>
                                ) : (
                                    <div className="plugin-settings-empty">该插件暂无可编辑设置项。当前接入位置和权限会根据插件清单自动生效。</div>
                                )}

                                <div className="plugin-permissions">
                                    <div><span>接入位置</span>{settingsPlugin.manifest.surfaces.map((surface) => surfaceLabels[surface] ?? surface).join("、")}</div>
                                    <div><span>插件能力</span>{settingsPlugin.manifest.permissions.map((permission) => permissionLabels[permission] ?? permission).join("、")}</div>
                                </div>
                            </div>
                        ) : null}
                    </Modal>
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
    return folders
        .map((folder) => ({ value: folder.id, label: pathFor(folder) }))
        .sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));
}
