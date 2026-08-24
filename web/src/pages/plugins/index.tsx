import { App, Button, Input, Modal, Select, Switch, Typography } from "antd";
import { AudioLines, CalendarDays, CheckCircle2, Clock3, CloudUpload, ExternalLink, Film, FolderOpen, Image as ImageIcon, MessageSquareText, PlugZap, RefreshCw, Search, Settings2, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";

import { t } from "@/i18n";
import { formatLocale } from "@/lib/format-locale";
import { listRegisteredPlugins } from "@/lib/plugins/plugin-registry";
import "@/lib/plugins/builtin";
import { EAGLE_PLUGIN_ID } from "@/lib/plugins/builtin/eagle";
import type { PluginManifest, RegisteredPlugin } from "@/lib/plugins/plugin-types";
import { getEagleLibrary, type EagleFolder } from "@/services/api/eagle";
import { fetchPlugins, setPluginEnabled, uploadPlugin, type BackendPlugin } from "@/services/api/plugins";
import { usePluginStore } from "@/stores/use-plugin-store";
import { useUserStore } from "@/stores/use-user-store";

import { PluginDetailsModal, UploadPluginModal } from "./plugin-documentation-modals";
import "./plugins.css";

const categoryLabels: Record<string, string> = {
    "asset-source": t("plugins:asset-sources"),
    "canvas-node": t("plugins:canvas-nodes"),
    workflow: t("plugins:workflows"),
    "ai-capability": t("plugins:ai-capabilities"),
    "import-export": t("plugins:import-export"),
    agent: t("plugins:agent"),
    protocol: t("plugins:request-protocol"),
};

const surfaceLabels: Record<string, string> = {
    node: t("plugins:canvas-nodes"),
    fullscreen: t("plugins:fullscreen-studio"),
    hybrid: t("plugins:hybrid-access"),
    "asset-source": t("plugins:asset-library"),
};

const permissionLabels: Record<string, string> = {
    "canvas.read": t("plugins:read-canvas"),
    "canvas.write": t("plugins:modify-canvas"),
    "asset.read": t("plugins:reading-assets"),
    "asset.search": t("plugins:search-assets"),
    "asset.import": t("plugins:import-assets"),
    "asset.upload": t("plugins:upload-assets"),
    "generation.run": t("plugins:invoke-generation"),
    "external.open": t("plugins:open-external-details"),
};

// 语言切换后模块级 formatter 不会重建：按 locale 惰性缓存
const pluginDateFormatters = new Map<string, Intl.DateTimeFormat>();
function pluginDateFormatter() {
    const locale = formatLocale();
    let formatter = pluginDateFormatters.get(locale);
    if (!formatter) pluginDateFormatters.set(locale, (formatter = new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" })));
    return formatter;
}

const protocolSectionMeta = [
    { key: "text", label: t("plugins:text-protocol"), description: t("plugins:text-protocol-description"), icon: MessageSquareText },
    { key: "image", label: t("plugins:image-protocol"), description: t("plugins:image-protocol-description"), icon: ImageIcon },
    { key: "video", label: t("plugins:video-protocol"), description: t("plugins:video-protocol-description"), icon: Film },
    { key: "audio", label: t("plugins:audio-protocol"), description: t("plugins:audio-protocol-description"), icon: AudioLines },
] as const;

export default function PluginsPage() {
    const { message } = App.useApp();
    const { t } = useTranslation("plugins");
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
            message.error(error instanceof Error ? error.message : t("plugins:failed-to-load-plugin-center"));
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
            { key: "other", label: t("plugins:app-plugins"), description: t("plugins:canvas-assets-and-workflow-extensions"), icon: PlugZap, plugins: filteredPlugins.filter((plugin) => plugin.manifest.kind !== "protocol") },
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
            message.success(t("plugins:param-enabled", { name: plugin.manifest.name }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("plugins:failed-to-update-plugin-status"));
        }
    };

    const handleUpload = async (file: File) => {
        try {
            const plugin = await uploadPlugin(file);
            setBackendPlugins((items) => [...items.filter((item) => item.manifest.id !== plugin.manifest.id), plugin]);
            setUploadModalOpen(false);
            message.success(t("plugins:plugin-installed-and-effective"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("plugins:failed-to-install-plugin"));
        }
    };

    const loadEagleFolders = async (url = eagleBaseUrl) => {
        setEagleFoldersLoading(true);
        setEagleFoldersError("");
        try {
            const result = await getEagleLibrary(url.trim().replace(/\/$/, ""));
            setEagleFolders(result.library.folders || []);
        } catch (reason) {
            setEagleFoldersError(reason instanceof Error ? reason.message : t("plugins:failed-to-read-eagle-folders"));
            setEagleFolders([]);
        } finally {
            setEagleFoldersLoading(false);
        }
    };

    const saveEagleConfig = () => {
        const baseUrl = eagleBaseUrl.trim().replace(/\/$/, "");
        if (!/^https?:\/\//i.test(baseUrl)) {
            message.error(t("plugins:the-eagle-address-must-start-with-http-or-https"));
            return;
        }
        updateConfig(EAGLE_PLUGIN_ID, { baseUrl, autoUploadGenerated: eagleAutoUploadGenerated, generatedFolderId: eagleGeneratedFolderId });
        message.success(t("plugins:eagle-plugin-settings-saved"));
    };

    return (
        <main className="app-workspace-page plugins-page flex h-full min-h-0 flex-col text-foreground">
            <div className="app-workspace-scroll min-h-0 flex-1 overflow-y-auto">
                <div className="plugins-page-layout">
                    <aside className="plugins-sidebar" aria-label={t("plugins:filter-by-category")}>
                        <div className="plugins-sidebar-heading">
                            <span className="plugins-sidebar-kicker">PLUGIN CENTER</span>
                            <h1>{t("plugins:plugin-center")}</h1>
                            <p>{t("plugins:manage-plugins-and-protocols-intro")}</p>
                        </div>
                        <nav className="plugins-sidebar-nav">
                            <button type="button" className={`plugins-sidebar-item${categoryFilter === "all" ? " is-active" : ""}`} aria-current={categoryFilter === "all" ? "page" : undefined} onClick={() => setCategoryFilter("all")}>
                                <span className="plugins-sidebar-item-label">
                                    <PlugZap className="size-4" />
                                    {t("plugins:all-plugins")}
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
                                    {t("plugins:app-plugins")}
                                </span>
                                <span>{categoryCounts.other}</span>
                            </button>
                        </nav>
                    </aside>
                    <div className="plugins-page-content">
                        <div className="plugins-toolbar" aria-label={t("plugins:filter-plugins")}>
                            <Input
                                className="plugins-search"
                                prefix={<Search className="size-4 text-foreground/38" aria-hidden="true" />}
                                value={search}
                                allowClear
                                placeholder={t("plugins:search-plugin-names-descriptions-or-authors")}
                                onChange={(event) => setSearch(event.target.value)}
                            />
                            <Select
                                className="plugins-filter"
                                value={statusFilter}
                                options={[
                                    { value: "all", label: t("plugins:all-statuses") },
                                    { value: "enabled", label: t("plugins:enabled-2") },
                                    { value: "disabled", label: t("plugins:disabled") },
                                ]}
                                onChange={(value) => setStatusFilter(value as "all" | "enabled" | "disabled")}
                                aria-label={t("plugins:filter-by-status")}
                            />
                            <Select
                                className="plugins-filter"
                                value={trustFilter}
                                options={[
                                    { value: "all", label: t("plugins:all-sources") },
                                    { value: "trusted", label: t("plugins:trusted-plugins-3") },
                                ]}
                                onChange={(value) => setTrustFilter(value as "all" | "trusted")}
                                aria-label={t("plugins:filter-by-source")}
                            />
                            <span className="plugins-filter-icon" aria-hidden="true">
                                <SlidersHorizontal className="size-4" />
                            </span>
                            {user?.role === "admin" ? (
                                <div className="plugins-toolbar-actions">
                                    <Button icon={<RefreshCw className="size-4" />} loading={backendPluginsLoading} onClick={() => void reloadBackendPlugins()}>
                                        {t("plugins:refresh")}
                                    </Button>
                                    <Button type="primary" icon={<CloudUpload className="size-4" />} onClick={() => setUploadModalOpen(true)}>
                                        {t("plugins:upload-plugin")}
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
                                                                aria-label={t("plugins:view-doc-param", { name: plugin.manifest.name })}
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
                                                                                {isSystemPlugin ? t("plugins:system-plugins") : t("plugins:user-plugins")}
                                                                            </span>
                                                                            {trusted ? (
                                                                                <span className="plugin-trust-label">
                                                                                    <ShieldCheck className="size-3.5" />
                                                                                    {t("plugins:trusted-plugins-3")}
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
                                                                        {t("plugins:published-param", { date: formatPluginDate(plugin.manifest.publishedAt) })}
                                                                    </span>
                                                                    <span>
                                                                        <Clock3 className="size-3.5" />
                                                                        {t("plugins:updated-param", { date: formatPluginDate(plugin.manifest.updatedAt) })}
                                                                    </span>
                                                                </div>

                                                                <div className="plugin-card-tags">
                                                                    {plugin.manifest.surfaces.map((surface) => (
                                                                        <span key={surface}>{surfaceLabels[surface] ?? surface}</span>
                                                                    ))}
                                                                    {plugin.manifest.protocol?.categories.map((capability) => (
                                                                        <span key={capability}>{capabilityLabel(capability)}</span>
                                                                    ))}
                                                                    {plugin.manifest.protocol?.poll ? <span>{t("plugins:async-polling")}</span> : null}
                                                                    <span>{t("plugins:capabilities-count-param", { count: plugin.manifest.permissions.length })}</span>
                                                                </div>
                                                            </button>

                                                            <div className="plugin-card-actions">
                                                                <span role="status" className={`settings-channel-status ${enabled ? "is-ready" : ""}`}>
                                                                    <i aria-hidden="true" />
                                                                    {enabled ? t("plugins:enabled-2") : t("plugins:not-enabled")}
                                                                </span>
                                                                <Switch disabled={user?.role !== "admin"} checked={enabled} aria-label={enabled ? t("plugins:disable-param", { name: plugin.manifest.name }) : t("plugins:enable-param", { name: plugin.manifest.name })} onChange={(checked) => void togglePlugin(plugin, checked)} />
                                                                {canConfigure ? (
                                                                    <Button
                                                                        className="plugin-settings-button"
                                                                        icon={<Settings2 className="size-4" />}
                                                                        aria-expanded={settingsPluginId === plugin.manifest.id}
                                                                        aria-haspopup="dialog"
                                                                        onClick={() => setSettingsPluginId(plugin.manifest.id)}
                                                                    >
                                                                        {t("plugins:settings")}
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
                                <h3>{t("plugins:no-matching-plugins")}</h3>
                                <p>{t("plugins:try-clearing-the-search-term-or-loosening-the-filters")}</p>
                                <Button
                                    onClick={() => {
                                        setSearch("");
                                        setCategoryFilter("all");
                                        setStatusFilter("all");
                                        setTrustFilter("all");
                                    }}
                                >
                                    {t("plugins:clear-filters")}
                                </Button>
                            </div>
                        )}

                        <UploadPluginModal open={uploadModalOpen} onClose={() => setUploadModalOpen(false)} onUpload={(file) => void handleUpload(file)} />
                        <Modal
                            className="workspace-modal workspace-modal-wide plugin-settings-modal"
                            title={settingsPlugin ? t("plugins:param-settings", { name: settingsPlugin.manifest.name }) : null}
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
                                            <p>{t("plugins:only-shows-settings-this-plugin-actually-supports")}</p>
                                        </div>
                                        {settingsPlugin.manifest.trusted ? (
                                            <span className="plugin-trust-label">
                                                <ShieldCheck className="size-3.5" />
                                                {t("plugins:trusted-plugins-3")}
                                            </span>
                                        ) : (
                                            <span className="plugin-category-label">{t("plugins:third-party-plugins")}</span>
                                        )}
                                    </div>

                                    {settingsPlugin.manifest.id === EAGLE_PLUGIN_ID ? (
                                        <>
                                            <div className="plugin-settings-fields">
                                                <div className="min-w-0">
                                                    <label htmlFor="eagle-base-url">{t("plugins:eagle-local-api-url-2")}</label>
                                                    <Input id="eagle-base-url" aria-label={t("plugins:eagle-local-api-url-2")} value={eagleBaseUrl} onChange={(event) => setEagleBaseUrl(event.target.value)} placeholder="http://localhost:41595" />
                                                    <p>{t("plugins:eagle-must-run-locally-yingce-reads-and-writes-eagle-s-original-files-di")}</p>
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="plugin-setting-label-row">
                                                        <label htmlFor="eagle-auto-upload-generated">{t("plugins:auto-archive-generated-results-to-eagle")}</label>
                                                        <Switch id="eagle-auto-upload-generated" checked={eagleAutoUploadGenerated} onChange={setEagleAutoUploadGenerated} aria-label={t("plugins:auto-archive-generated-results-to-eagle")} />
                                                    </div>
                                                    <p>{t("plugins:automatically-write-images-videos-and-audio-to-eagle-on-success-yingce-k")}</p>
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="plugin-setting-label-row">
                                                        <label htmlFor="eagle-generated-folder">{t("plugins:destination-folder-for-results-2")}</label>
                                                        <Button type="link" size="small" loading={eagleFoldersLoading} onClick={() => void loadEagleFolders()}>
                                                            {t("plugins:read-folders")}
                                                        </Button>
                                                    </div>
                                                    <Select
                                                        id="eagle-generated-folder"
                                                        aria-label={t("plugins:destination-folder-for-results-2")}
                                                        showSearch
                                                        allowClear
                                                        value={eagleGeneratedFolderId || undefined}
                                                        placeholder={t("plugins:eagle-root")}
                                                        optionFilterProp="label"
                                                        options={[{ value: "__root__", label: t("plugins:eagle-root") }, ...eagleFolderOptions(eagleFolders)]}
                                                        onChange={(value) => setEagleGeneratedFolderId(value === "__root__" || !value ? "" : value)}
                                                    />
                                                    <p>{eagleFoldersError || t("plugins:defaults-to-the-eagle-root-folder-pick-a-folder-to-archive-into-that-eag")}</p>
                                                </div>
                                            </div>
                                            <div className="plugin-settings-actions">
                                                <Button type="primary" icon={<CheckCircle2 className="size-4" />} onClick={saveEagleConfig}>
                                                    {t("plugins:save-config")}
                                                </Button>
                                                <Button icon={<FolderOpen className="size-4" />} disabled={!settingsEnabled} onClick={() => navigate("/plugins/eagle")}>
                                                    {t("plugins:open-eagle-library")}
                                                </Button>
                                                <Button icon={<ExternalLink className="size-4" />} href="https://api.eagle.cool/" target="_blank">
                                                    {t("plugins:view-api")}
                                                </Button>
                                            </div>
                                        </>
                                    ) : (
                                        <div className="plugin-settings-empty">
                                            {settingsPlugin.manifest.kind === "protocol"
                                                ? t("plugins:protocol-capabilities-scopes-param", {
                                                      categories: settingsPlugin.manifest.protocol?.categories.map(capabilityLabel).join("、") || t("plugins:not-declared"),
                                                      scopes: settingsPlugin.manifest.protocol?.scopes.join("、") || t("plugins:not-declared"),
                                                  })
                                                : t("plugins:no-editable-settings-for-this-plugin-yet-its-integration-points-and-perm")}
                                        </div>
                                    )}

                                    <div className="plugin-permissions">
                                        <div>
                                            <span>{t("plugins:integration-points")}</span>
                                            {settingsPlugin.manifest.surfaces.map((surface) => surfaceLabels[surface] ?? surface).join("、")}
                                        </div>
                                        <div>
                                            <span>{t("plugins:plugin-capabilities")}</span>
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
    if (!value) return t("plugins:not-recorded");
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? pluginDateFormatter().format(timestamp) : t("plugins:not-recorded");
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
        description: plugin.manifest.description || t("plugins:model-protocol-adapter-plugin"),
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
    return ({ text: t("lib:text"), image: t("lib:image"), video: t("lib:video"), audio: t("lib:audio") } as Record<string, string>)[value] || value;
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
    return folders.map((folder) => ({ value: folder.id, label: pathFor(folder) })).sort((left, right) => left.label.localeCompare(right.label, formatLocale()));
}
