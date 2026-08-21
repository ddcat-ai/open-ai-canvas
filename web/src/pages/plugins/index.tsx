import { App, Button, Input, Switch, Tag, Typography } from "antd";
import { CheckCircle2, ChevronDown, ExternalLink, PlugZap, Settings2, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { listRegisteredPlugins } from "@/lib/plugins/plugin-registry";
import "@/lib/plugins/builtin";
import { EAGLE_PLUGIN_ID } from "@/lib/plugins/builtin/eagle";
import { usePluginStore } from "@/stores/use-plugin-store";

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

export default function PluginsPage() {
    const { message } = App.useApp();
    const installations = usePluginStore((state) => state.installations);
    const ensurePlugin = usePluginStore((state) => state.ensurePlugin);
    const setEnabled = usePluginStore((state) => state.setEnabled);
    const updateConfig = usePluginStore((state) => state.updateConfig);
    const registeredPlugins = useMemo(() => listRegisteredPlugins(), []);
    const [expandedPluginId, setExpandedPluginId] = useState<string | null>(null);
    const [eagleBaseUrl, setEagleBaseUrl] = useState("http://localhost:41595");

    useEffect(() => {
        for (const plugin of registeredPlugins) ensurePlugin(plugin.manifest);
    }, [ensurePlugin, registeredPlugins]);

    const eagle = installations.find((item) => item.manifest.id === EAGLE_PLUGIN_ID);

    useEffect(() => {
        const configured = eagle?.config.baseUrl;
        if (typeof configured === "string" && configured.trim()) setEagleBaseUrl(configured);
    }, [eagle?.config.baseUrl]);

    const saveEagleConfig = () => {
        const baseUrl = eagleBaseUrl.trim().replace(/\/$/, "");
        if (!/^https?:\/\//i.test(baseUrl)) {
            message.error("Eagle 地址必须以 http:// 或 https:// 开头");
            return;
        }
        updateConfig(EAGLE_PLUGIN_ID, { baseUrl });
        message.success("Eagle 插件配置已保存");
    };

    return (
        <main className="app-workspace-page flex h-full min-h-0 flex-col text-foreground">
            <header className="shrink-0 border-b border-[var(--workspace-border)] px-5 py-4 md:px-7">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                        <div className="mb-2 flex items-center gap-2 text-[var(--fs-label)] text-foreground/45">
                            <PlugZap className="size-3.5" aria-hidden="true" />
                            <span>工作台管理</span>
                            <span>/</span>
                            <span>插件中心</span>
                        </div>
                        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">插件中心</h1>
                        <p className="mt-1 text-sm text-foreground/55">管理可连接到影策的素材来源、画布能力和创作工作流。</p>
                    </div>
                    <Tag icon={<ShieldCheck className="size-3.5" />} color="gold">可信插件模式</Tag>
                </div>
            </header>

            <div className="app-workspace-scroll min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-7 md:py-6">
                <div className="mx-auto w-full max-w-5xl">
                    <div className="mb-4 flex items-center justify-between gap-3">
                        <div>
                            <h2 className="text-base font-semibold">已接入插件</h2>
                            <p className="mt-1 text-xs text-foreground/48">插件状态和配置按当前账号隔离保存。</p>
                        </div>
                        <Tag className="m-0">{registeredPlugins.length} 个插件</Tag>
                    </div>

                    <div className="flex flex-col gap-3">
                        {registeredPlugins.map((plugin) => {
                            const installation = installations.find((item) => item.manifest.id === plugin.manifest.id);
                            const enabled = Boolean(installation?.enabled);
                            const expanded = expandedPluginId === plugin.manifest.id;
                            const settingsId = `plugin-settings-${plugin.manifest.id}`;
                            return (
                                <section key={plugin.manifest.id} className="library-card-surface rounded-[var(--r-xl)] p-4 transition-colors duration-200 md:p-5">
                                    <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                                        <div className="flex min-w-0 flex-1 items-start gap-3">
                                            <span className="grid size-11 shrink-0 place-items-center rounded-[var(--r-lg)] bg-[var(--workspace-accent-soft)] text-[var(--workspace-accent)]">
                                                <PlugZap className="size-5" aria-hidden="true" />
                                            </span>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <h3 className="min-w-0 truncate text-base font-semibold">{plugin.manifest.name}</h3>
                                                    <span className="whitespace-nowrap text-[var(--fs-tiny)] text-foreground/42">v{plugin.manifest.version}</span>
                                                    <span className="whitespace-nowrap rounded-full bg-foreground/[.06] px-2 py-1 text-[var(--fs-tiny)] text-foreground/58">{categoryLabels[plugin.manifest.category] ?? plugin.manifest.category}</span>
                                                </div>
                                                <p className="mt-1 max-w-3xl text-sm leading-6 text-foreground/55">{plugin.manifest.description}</p>
                                                <div className="mt-3 flex flex-wrap gap-2">
                                                    {plugin.manifest.surfaces.map((surface) => <span key={surface} className="rounded-full bg-foreground/[.06] px-2.5 py-1 text-[var(--fs-tiny)] text-foreground/62">{surfaceLabels[surface] ?? surface}</span>)}
                                                    <span className="rounded-full bg-[var(--library-icon-surface)] px-2.5 py-1 text-[var(--fs-tiny)] text-foreground/52">{plugin.manifest.permissions.length} 项能力</span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex shrink-0 flex-wrap items-center gap-3 lg:justify-end">
                                            <span role="status" className={`settings-channel-status ${enabled ? "is-ready" : ""}`}>
                                                <i aria-hidden="true" />
                                                {enabled ? "已启用" : "未启用"}
                                            </span>
                                            <Switch checked={enabled} aria-label={`${plugin.manifest.name}${enabled ? "停用" : "启用"}`} onChange={(checked) => setEnabled(plugin.manifest.id, checked)} />
                                            <Button
                                                className="min-h-9"
                                                icon={<Settings2 className="size-4" />}
                                                aria-expanded={expanded}
                                                aria-controls={settingsId}
                                                onClick={() => setExpandedPluginId((current) => current === plugin.manifest.id ? null : plugin.manifest.id)}
                                            >
                                                {expanded ? "收起设置" : "设置"}
                                                <ChevronDown className={`ml-1 size-3.5 transition-transform duration-200${expanded ? " rotate-180" : ""}`} aria-hidden="true" />
                                            </Button>
                                        </div>
                                    </div>

                                    {expanded ? (
                                        <div id={settingsId} className="mt-4 border-t border-[var(--workspace-border)] pt-4">
                                            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                                                <div>
                                                    <h4 className="text-sm font-semibold">{plugin.manifest.name} 设置</h4>
                                                    <p className="mt-1 text-xs leading-5 text-foreground/48">只展示这个插件实际支持的配置项。</p>
                                                </div>
                                                <span className="whitespace-nowrap rounded-full bg-foreground/[.06] px-2.5 py-1 text-[var(--fs-tiny)] text-foreground/52">{plugin.manifest.trusted ? "可信插件" : "第三方插件"}</span>
                                            </div>

                                            {plugin.manifest.id === EAGLE_PLUGIN_ID ? (
                                                <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-end">
                                                    <div className="min-w-0 flex-1">
                                                        <label htmlFor="eagle-base-url" className="block text-xs font-medium text-foreground/58">Eagle 本地 API 地址</label>
                                                        <Input id="eagle-base-url" aria-label="Eagle 本地 API 地址" value={eagleBaseUrl} onChange={(event) => setEagleBaseUrl(event.target.value)} placeholder="http://localhost:41595" className="mt-2 w-full" />
                                                        <p className="mt-2 text-xs leading-5 text-foreground/45">Eagle 必须在本机运行；网页直连可能受跨域限制，后续搜索和导入将通过本地桥接适配器完成。</p>
                                                    </div>
                                                    <div className="flex shrink-0 flex-wrap gap-2">
                                                        <Button type="primary" className="min-h-9" icon={<CheckCircle2 className="size-4" />} onClick={saveEagleConfig}>保存配置</Button>
                                                        <Button className="min-h-9" icon={<ExternalLink className="size-4" />} href="https://api.eagle.cool/" target="_blank">查看 API</Button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="rounded-[var(--r-lg)] bg-foreground/[.035] p-4 text-sm text-foreground/55">该插件暂无可编辑设置项。当前接入位置和权限会根据插件清单自动生效。</div>
                                            )}

                                            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-3 text-xs text-foreground/52">
                                                <div><span className="mr-2 text-foreground/38">接入位置</span>{plugin.manifest.surfaces.map((surface) => surfaceLabels[surface] ?? surface).join("、")}</div>
                                                <div><span className="mr-2 text-foreground/38">插件能力</span>{plugin.manifest.permissions.map((permission) => permissionLabels[permission] ?? permission).join("、")}</div>
                                            </div>
                                        </div>
                                    ) : null}

                                    {installation?.lastError ? <Typography.Text type="danger" className="mt-3 block text-xs" role="alert">{installation.lastError}</Typography.Text> : null}
                                </section>
                            );
                        })}
                    </div>
                </div>
            </div>
        </main>
    );
}
