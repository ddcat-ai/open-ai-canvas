import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Input } from "antd";
import { ExternalLink, Pencil, PlugZap, Plus, RefreshCw, Search, ShieldCheck, Trash2 } from "lucide-react";

import { WorkspaceErrorState, WorkspaceNoResultsState, WorkspaceState } from "@/components/layout/workspace-state";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { useUserStore } from "@/stores/use-user-store";
import { deleteMCPConnection, deleteMCPTemplate, listMCPConnections, listMCPTemplates, testMCPConnection, type MCPConnection, type MCPManagementScope, type MCPServerTemplate } from "@/services/api/agent-mcp";
import { MCPConnectionEditor } from "./mcp-connection-editor";
import { MCPTemplateEditor } from "./mcp-template-editor";
import { safeMCPHomepage } from "./mcp-form";
import "./mcp-manager.css";

type ConnectionEditorState = { connection?: MCPConnection; template?: MCPServerTemplate };

function ConnectionCard({ connection, editable, busy, disabled, onEdit, onTest, onRemove }: { connection: MCPConnection; editable: boolean; busy: boolean; disabled: boolean; onEdit: () => void; onTest: () => void; onRemove: () => void }) {
    const status = connection.enabled ? "已启用" : connection.lastTestAt ? "待授权" : "待检测";
    const statusClass = connection.enabled ? "is-ready" : connection.lastTestAt ? "is-pending" : "is-idle";
    return (
        <article className="mcp-card mcp-connection-card">
            <header className="mcp-card-header">
                <span className="mcp-card-icon" aria-hidden="true">
                    <PlugZap className="size-5" />
                </span>
                <div className="mcp-card-heading">
                    <div className="mcp-card-title-row">
                        <h3 className="mcp-card-title">{connection.name}</h3>
                        <span className={`mcp-status ${statusClass}`}>
                            <span className="mcp-status-dot" aria-hidden="true" />
                            {status}
                        </span>
                    </div>
                    <p className="mcp-card-subtitle">{connection.scope === "platform" ? "平台提供" : "个人连接"}</p>
                </div>
                {connection.enabled ? <ShieldCheck className="mcp-card-status-icon" aria-label="已启用" /> : null}
            </header>
            <div className="mcp-card-endpoint" title={connection.serverUrl}>
                <span className="mcp-endpoint-label">ENDPOINT</span>
                <code>{connection.serverUrl}</code>
            </div>
            <div className="mcp-card-metrics" aria-label="连接状态">
                <span>
                    <strong>{connection.tools.length}</strong> 个工具
                </span>
                <span>
                    <strong>{connection.allowedTools.length}</strong> 个已授权
                </span>
                <span>版本 {connection.revision}</span>
            </div>
            {connection.tools.length ? (
                <details className="mcp-tools-details">
                    <summary>
                        <span>查看工具清单</span>
                        <span>
                            {connection.allowedTools.length}/{connection.tools.length}
                        </span>
                    </summary>
                    <ul className="mcp-tools-list thin-scrollbar">
                        {connection.tools.map((tool) => (
                            <li key={tool.name} className="mcp-tool-item">
                                <div className="mcp-tool-name">
                                    <span className="mcp-tool-dot" aria-hidden="true" />
                                    <span className="break-all">{tool.name}</span>
                                    {connection.allowedTools.includes(tool.name) ? <span className="mcp-tool-authorized">已授权</span> : null}
                                </div>
                                {tool.description ? <p>{tool.description}</p> : null}
                            </li>
                        ))}
                    </ul>
                </details>
            ) : null}
            <footer className="mcp-card-actions">
                {editable ? (
                    <>
                        <Button size="small" icon={<Pencil className="size-3.5" />} onClick={onEdit} disabled={disabled}>
                            配置
                        </Button>
                        <Button size="small" icon={<RefreshCw className="size-3.5" />} onClick={onTest} loading={busy} disabled={disabled}>
                            检测连接
                        </Button>
                        <Button size="small" type="text" danger icon={<Trash2 className="size-3.5" />} onClick={onRemove} disabled={disabled}>
                            移除
                        </Button>
                    </>
                ) : (
                    <span className="mcp-card-note">
                        <ShieldCheck className="size-3.5" />
                        平台管理员维护，执行前仍需确认
                    </span>
                )}
            </footer>
        </article>
    );
}

function TemplateCard({ template, installed, admin, busy, onInstall, onEdit, onRemove }: { template: MCPServerTemplate; installed: boolean; admin: boolean; busy: boolean; onInstall: () => void; onEdit: () => void; onRemove: () => void }) {
    const homepage = safeMCPHomepage(template.homepage);
    return (
        <article className="mcp-card mcp-template-card">
            <header className="mcp-card-header">
                <span className="mcp-card-icon is-market" aria-hidden="true">
                    <PlugZap className="size-5" />
                </span>
                <div className="mcp-card-heading">
                    <div className="mcp-card-title-row">
                        <h3 className="mcp-card-title">{template.name}</h3>
                        <span className={`mcp-status ${template.published ? "is-ready" : "is-idle"}`}>
                            <span className="mcp-status-dot" aria-hidden="true" />
                            {template.published ? "已发布" : "草稿"}
                        </span>
                    </div>
                    <p className="mcp-card-subtitle">{template.transport === "sse" ? "SSE 连接" : "Streamable HTTP"}</p>
                </div>
                {homepage ? (
                    <a href={homepage} target="_blank" rel="noopener noreferrer" className="mcp-card-external" aria-label={`${template.name} 使用文档`}>
                        <ExternalLink className="size-4" />
                    </a>
                ) : null}
            </header>
            <p className="mcp-template-description">{template.description || "连接后可向 Agent 提供外部工具。"}</p>
            <div className="mcp-template-meta">
                <span>{template.parameters.length} 个配置项</span>
                {installed ? <span className="mcp-template-installed">已安装</span> : <span>可安装</span>}
            </div>
            <footer className="mcp-card-actions">
                <Button size="small" type="primary" icon={<Plus className="size-3.5" />} disabled={busy} onClick={onInstall}>
                    {admin ? "添加平台连接" : installed ? "再安装一个" : "安装"}
                </Button>
                {admin ? (
                    <>
                        <Button size="small" icon={<Pencil className="size-3.5" />} disabled={busy} onClick={onEdit}>
                            编辑
                        </Button>
                        <Button size="small" type="text" danger icon={<Trash2 className="size-3.5" />} disabled={busy} onClick={onRemove}>
                            移除条目
                        </Button>
                    </>
                ) : null}
            </footer>
        </article>
    );
}

function MCPManagerContent({ scope, userId, initialTab, onTabChange }: { scope: MCPManagementScope; userId: string; initialTab: "connections" | "market"; onTabChange?: (tab: "connections" | "market") => void }) {
    const { message, modal } = App.useApp();
    const queryClient = useQueryClient();
    const [tab, setTab] = useState<"connections" | "market">(initialTab);
    const [search, setSearch] = useState("");
    const [editor, setEditor] = useState<ConnectionEditorState | null>(null);
    const [templateEditor, setTemplateEditor] = useState<{ template?: MCPServerTemplate } | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const admin = scope === "platform";
    const connectionKey = ["agent-mcp", userId, scope, "connections"];
    const catalogKey = ["agent-mcp", userId, scope, "catalog"];
    const connections = useQuery({ queryKey: connectionKey, queryFn: ({ signal }) => listMCPConnections(scope, signal), staleTime: 15_000, retry: false });
    const catalog = useQuery({ queryKey: catalogKey, queryFn: ({ signal }) => listMCPTemplates(scope, signal), staleTime: 15_000, retry: false });
    const query = tab === "connections" ? connections : catalog;
    const keyword = search.trim().toLocaleLowerCase();
    const visibleConnections = (connections.data?.items ?? []).filter((connection) => !keyword || `${connection.name} ${connection.serverUrl}`.toLocaleLowerCase().includes(keyword));
    const visibleTemplates = (catalog.data?.items ?? []).filter((template) => !keyword || `${template.name} ${template.description}`.toLocaleLowerCase().includes(keyword));
    const connectionCount = connections.data?.items.length ?? 0;
    const readyCount = (connections.data?.items ?? []).filter((connection) => connection.enabled).length;
    const toolCount = (connections.data?.items ?? []).reduce((total, connection) => total + connection.tools.length, 0);

    useEffect(() => {
        setTab(initialTab);
        setSearch("");
        onTabChange?.(initialTab);
    }, [initialTab, onTabChange]);

    const changeTab = (nextTab: "connections" | "market") => {
        setTab(nextTab);
        onTabChange?.(nextTab);
    };

    const refresh = () => {
        void queryClient.invalidateQueries({ queryKey: ["agent-mcp", userId, scope] });
    };

    const applyConnection = (connection: MCPConnection) => {
        queryClient.setQueryData<{ items: MCPConnection[] }>(connectionKey, (current) => ({
            items: current ? (current.items.some((item) => item.id === connection.id) ? current.items.map((item) => (item.id === connection.id ? connection : item)) : [...current.items, connection]) : [connection],
        }));
        changeTab("connections");
    };

    const testConnection = async (connection: MCPConnection) => {
        setBusyId(connection.id);
        try {
            const next = await testMCPConnection(scope, connection.id);
            applyConnection(next);
            setEditor({ connection: next, template: catalog.data?.items.find((item) => item.id === next.templateId) });
            message.success(next.tools.length ? `已发现 ${next.tools.length} 个工具，请选择允许使用的工具` : "连接成功，服务暂未提供工具");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "MCP 连接检测失败");
            void queryClient.invalidateQueries({ queryKey: connectionKey });
        } finally {
            setBusyId(null);
        }
    };

    const removeConnection = (connection: MCPConnection) => {
        modal.confirm({
            title: `移除「${connection.name}」？`,
            content: "移除后，Agent 将不能再调用此连接的工具。",
            okText: "移除",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: async () => {
                try {
                    await deleteMCPConnection(scope, connection.id);
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "移除 MCP 连接失败");
                    throw error;
                }
                queryClient.setQueryData<{ items: MCPConnection[] }>(connectionKey, (current) => (current ? { items: current.items.filter((item) => item.id !== connection.id) } : current));
                message.success("MCP 连接已移除");
            },
        });
    };

    const removeTemplate = (template: MCPServerTemplate) => {
        modal.confirm({
            title: `移除市场条目「${template.name}」？`,
            content: "如果仍有连接引用此条目，需要先处理相关连接。",
            okText: "移除",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: async () => {
                try {
                    await deleteMCPTemplate(template.id);
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "移除市场条目失败");
                    throw error;
                }
                void queryClient.invalidateQueries({ queryKey: catalogKey });
                message.success("市场条目已移除");
            },
        });
    };

    return (
        <div className="mcp-manager flex min-h-0 min-w-0 flex-1 flex-col">
            <section className="mcp-manager-intro shrink-0">
                <div className="mcp-manager-kicker">
                    <span className="mcp-manager-kicker-dot" aria-hidden="true" /> AGENT TOOLING
                </div>
                <div className="mcp-manager-intro-row">
                    <div className="min-w-0">
                        <h2 className="mcp-manager-title">工具连接</h2>
                        <p className="mcp-manager-description">把可靠的外部工具交给 Agent，连接、授权和执行边界都由你掌控。</p>
                    </div>
                    <div className="mcp-manager-stats" aria-label="MCP 概览">
                        <span>
                            <strong>{connectionCount}</strong>
                            <small>连接</small>
                        </span>
                        <span>
                            <strong>{readyCount}</strong>
                            <small>已启用</small>
                        </span>
                        <span>
                            <strong>{toolCount}</strong>
                            <small>已发现工具</small>
                        </span>
                    </div>
                </div>
            </section>
            <div className="mcp-manager-toolbar shrink-0">
                <SegmentedControl
                    size="sm"
                    value={tab}
                    onChange={(value) => {
                        changeTab(value);
                        setSearch("");
                    }}
                    ariaLabel="MCP 管理视图"
                    options={[
                        { value: "connections", label: admin ? "平台连接" : "已安装" },
                        { value: "market", label: admin ? "市场管理" : "MCP 市场" },
                    ]}
                />
                <div className="mcp-manager-actions">
                    <Button size="small" type="text" icon={<RefreshCw className="size-3.5" />} aria-label="刷新 MCP 列表" loading={query.isFetching} onClick={refresh} />
                    {admin && tab === "market" ? (
                        <Button size="small" type="primary" icon={<Plus className="size-3.5" />} disabled={busyId !== null} onClick={() => setTemplateEditor({})}>
                            添加条目
                        </Button>
                    ) : (
                        <Button size="small" type="primary" icon={<Plus className="size-3.5" />} disabled={busyId !== null} onClick={() => setEditor({})}>
                            自定义连接
                        </Button>
                    )}
                </div>
            </div>
            <div className="mcp-manager-note shrink-0">
                <ShieldCheck className="size-4" aria-hidden="true" />
                <span>{admin ? "平台连接启用后向用户开放；市场条目供用户独立安装和配置。" : "安装连接并授权工具后，Agent 可在后续会话中使用。平台连接由管理员提供。"}</span>
                <span className="mcp-manager-note-separator" aria-hidden="true" />
                <span>每次执行 MCP 工具前都会请求确认。</span>
            </div>
            <div className="mcp-manager-search shrink-0">
                <Search className="size-4" aria-hidden="true" />
                <Input
                    bordered={false}
                    value={search}
                    placeholder={tab === "connections" ? "搜索已安装连接" : "搜索 MCP 市场"}
                    aria-label={tab === "connections" ? "搜索连接" : "搜索 MCP 市场"}
                    onChange={(event) => setSearch(event.target.value)}
                    allowClear
                />
            </div>
            <div className="mcp-manager-list thin-scrollbar min-h-0 flex-1 overflow-y-auto">
                {query.isError ? (
                    <WorkspaceErrorState compact title="MCP 列表加载失败" description={query.error instanceof Error ? query.error.message : "请稍后重试"} onRetry={refresh} />
                ) : query.isPending ? (
                    <div className="mcp-skeleton-grid" role="status" aria-label="正在加载 MCP 列表">
                        {[0, 1].map((index) => (
                            <div key={index} className="mcp-skeleton-card motion-safe:animate-pulse" />
                        ))}
                    </div>
                ) : (tab === "connections" ? visibleConnections.length : visibleTemplates.length) === 0 ? (
                    keyword ? (
                        <WorkspaceNoResultsState compact query={search} onClear={() => setSearch("")} />
                    ) : (
                        <WorkspaceState
                            compact
                            icon="empty"
                            title={tab === "connections" ? "还没有 MCP 连接" : "市场暂时没有条目"}
                            description={tab === "connections" ? "从市场安装或添加远端 MCP 服务，连接后选择 Agent 可以使用的工具。" : admin ? "添加服务地址和参数说明，发布后用户就可以安装。" : "可以先添加自定义连接，或等待管理员发布市场条目。"}
                            action={
                                <Button
                                    type="primary"
                                    icon={tab === "connections" ? <PlugZap className="size-4" /> : <Plus className="size-4" />}
                                    disabled={busyId !== null}
                                    onClick={() => (tab === "connections" ? changeTab("market") : admin ? setTemplateEditor({}) : setEditor({}))}
                                >
                                    {tab === "connections" ? "浏览 MCP 市场" : admin ? "添加市场条目" : "添加自定义连接"}
                                </Button>
                            }
                        />
                    )
                ) : (
                    <div className="mcp-card-grid">
                        {tab === "connections"
                            ? visibleConnections.map((connection) => (
                                  <ConnectionCard
                                      key={connection.id}
                                      connection={connection}
                                      editable={admin || connection.scope === "user"}
                                      busy={busyId === connection.id}
                                      disabled={busyId !== null}
                                      onEdit={() => setEditor({ connection, template: catalog.data?.items.find((item) => item.id === connection.templateId) })}
                                      onTest={() => void testConnection(connection)}
                                      onRemove={() => removeConnection(connection)}
                                  />
                              ))
                            : visibleTemplates.map((template) => (
                                  <TemplateCard
                                      key={template.id}
                                      template={template}
                                      admin={admin}
                                      busy={busyId !== null}
                                      installed={Boolean(connections.data?.items.some((connection) => connection.templateId === template.id && connection.scope === scope))}
                                      onInstall={() => setEditor({ template })}
                                      onEdit={() => setTemplateEditor({ template })}
                                      onRemove={() => removeTemplate(template)}
                                  />
                              ))}
                    </div>
                )}
            </div>
            {editor ? <MCPConnectionEditor key={editor.connection?.id ?? editor.template?.id ?? "new"} scope={scope} connection={editor.connection} template={editor.template} onClose={() => setEditor(null)} onSaved={applyConnection} /> : null}
            {templateEditor ? <MCPTemplateEditor key={templateEditor.template?.id ?? "new"} template={templateEditor.template} onClose={() => setTemplateEditor(null)} onSaved={refresh} /> : null}
        </div>
    );
}

export default function MCPManager({ scope = "user", initialTab = "connections", onTabChange }: { scope?: MCPManagementScope; initialTab?: "connections" | "market"; onTabChange?: (tab: "connections" | "market") => void }) {
    const userId = useUserStore((state) => state.user?.id);
    if (!userId) return <WorkspaceState compact title="登录后配置 MCP" description="MCP 连接和参数按账号保存。" icon="empty" />;
    return <MCPManagerContent key={`${userId}:${scope}`} userId={userId} scope={scope} initialTab={initialTab} onTabChange={onTabChange} />;
}
