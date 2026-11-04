import { Alert } from "antd";
import dayjs from "dayjs";
import { BadgeCheck, Boxes, KeyRound, Package, ShieldAlert, SlidersHorizontal } from "lucide-react";
import type { ReactNode } from "react";

import type { PluginManifest, PluginManifestV2 } from "@/lib/plugins/plugin-types";
import type { AdminPluginState, PluginManagement } from "@/services/api/plugins";
import { getPluginDocumentation, pluginPermissionLabel } from "@/pages/plugins/plugin-documentation";
import { PluginMarkdown } from "@/pages/plugins/plugin-markdown";

import { AdminStatusBadge } from "../components/admin-ui";
import { AdminModal } from "../ui/overlays";

export type AdminPluginDetail = {
    manifest: PluginManifest | PluginManifestV2;
    source: string;
    management: PluginManagement;
    status?: string;
    error?: string;
    /** 以下只有后端登记过的插件（上传或后端内置）才有。 */
    fileName?: string;
    sha256?: string;
    installedAt?: string;
    updatedAt?: string;
};

type Props = {
    plugin: AdminPluginDetail | null;
    state?: AdminPluginState;
    typeLabel: string;
    icon?: ReactNode;
    onClose: () => void;
};

/**
 * 插件管理的只读详情：固定尺寸的大弹窗，顶部是插件身份，左栏分组列出管理与清单信息，
 * 右栏整栏阅读说明文档；两栏各自滚动。开关和卸载仍在列表行内操作。
 */
export function AdminPluginDetailModal({ plugin, state, typeLabel, icon, onClose }: Props) {
    return (
        <AdminModal flush open={Boolean(plugin)} centered title={null} footer={null} width="min(1240px, calc(100vw - 48px))" rootClassName="admin-plugin-detail-modal" onCancel={onClose}>
            {plugin ? <PluginDetail plugin={plugin} state={state} typeLabel={typeLabel} icon={icon} /> : null}
        </AdminModal>
    );
}

function PluginDetail({ plugin, state, typeLabel, icon }: { plugin: AdminPluginDetail; state?: AdminPluginState; typeLabel: string; icon?: ReactNode }) {
    const { manifest, management } = plugin;
    const available = state?.platformAvailable ?? plugin.status === "enabled";
    const contributions = contributionSummary(manifest);
    const hasPackage = Boolean(plugin.fileName || plugin.sha256 || plugin.installedAt);
    return (
        <div className="admin-plugin-detail">
            <header className="admin-plugin-detail-header">
                <div className="admin-plugin-detail-icon">{icon}</div>
                <div className="min-w-0 flex-1">
                    <div className="admin-plugin-detail-heading">
                        <h2>{manifest.name}</h2>
                        <span className="admin-plugin-detail-version">v{manifest.version}</span>
                    </div>
                    <p className="admin-plugin-detail-description">{manifest.description || "未提供插件说明"}</p>
                    <div className="admin-plugin-detail-badges">
                        <AdminStatusBadge label={typeLabel} tone={management.origin === "uploaded" ? "warning" : management.kind === "application" ? "info" : "neutral"} />
                        <AdminStatusBadge label={available ? "平台已开放" : "平台已停用"} tone={available ? "success" : "neutral"} />
                        {manifest.trusted ? <AdminStatusBadge label="来源已验证" tone="success" /> : <AdminStatusBadge label="来源未验证" tone="warning" />}
                        {plugin.status === "invalid" ? <AdminStatusBadge label="插件包无效" tone="error" /> : null}
                        <span className="admin-plugin-detail-id" title={manifest.id}>
                            {manifest.id}
                        </span>
                    </div>
                </div>
            </header>
            <div className="admin-plugin-detail-body">
                <aside className="admin-plugin-detail-aside" aria-label="插件信息">
                    {plugin.error ? <Alert type="error" showIcon title="插件加载失败" description={plugin.error} /> : null}
                    <FactGroup icon={<SlidersHorizontal />} title="管理">
                        <Fact label="来源">{originLabel(management.origin)}</Fact>
                        <Fact label="作用范围">{management.activationScope === "user" ? "用户自主启用" : "全局生效，管理员统一控制"}</Fact>
                        {management.activationScope === "user" ? <Fact label="已启用用户">{`${state?.enabledUserCount || 0} 位`}</Fact> : null}
                        <Fact label="配置方式">{configurationLabel(management.configurationScope)}</Fact>
                    </FactGroup>
                    <FactGroup icon={<KeyRound />} title="权限">
                        {manifest.permissions.length ? (
                            <div className="admin-plugin-detail-chips">
                                {manifest.permissions.map((permission) => (
                                    <span key={permission} title={permission}>
                                        {pluginPermissionLabel(permission)}
                                    </span>
                                ))}
                            </div>
                        ) : (
                            <p className="admin-plugin-detail-empty">未声明权限</p>
                        )}
                    </FactGroup>
                    <FactGroup icon={<Boxes />} title="提供能力">
                        {contributions.length ? (
                            contributions.map(([label, value]) => (
                                <Fact key={label} label={label}>
                                    {value}
                                </Fact>
                            ))
                        ) : (
                            <p className="admin-plugin-detail-empty">未声明</p>
                        )}
                        <Fact label="运行方式">{runtimeLabel(manifest)}</Fact>
                    </FactGroup>
                    <FactGroup icon={hasPackage ? <Package /> : manifest.trusted ? <BadgeCheck /> : <ShieldAlert />} title="版本与安装">
                        <Fact label="作者">{manifest.author || "未声明"}</Fact>
                        <Fact label="发布时间">{formatTime(manifest.publishedAt)}</Fact>
                        <Fact label="清单更新">{formatTime(manifest.updatedAt)}</Fact>
                        {hasPackage ? (
                            <>
                                <Fact label="安装包">{plugin.fileName || "未记录"}</Fact>
                                <Fact label="安装时间">{formatTime(plugin.installedAt)}</Fact>
                                <Fact label="最近更新">{formatTime(plugin.updatedAt)}</Fact>
                                <Fact label="SHA-256">
                                    <span className="admin-plugin-detail-mono">{plugin.sha256 || "未记录"}</span>
                                </Fact>
                            </>
                        ) : (
                            <Fact label="安装包">随平台内置</Fact>
                        )}
                    </FactGroup>
                </aside>
                <section className="admin-plugin-detail-doc" aria-label="说明文档">
                    <div className="admin-plugin-detail-doc-inner">
                        <PluginMarkdown source={getPluginDocumentation(manifest)} />
                    </div>
                </section>
            </div>
        </div>
    );
}

function FactGroup({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
    return (
        <section className="admin-plugin-detail-group">
            <h3>
                <span aria-hidden="true">{icon}</span>
                {title}
            </h3>
            <dl>{children}</dl>
        </section>
    );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="admin-plugin-detail-fact">
            <dt>{label}</dt>
            <dd>{children}</dd>
        </div>
    );
}

function originLabel(origin: PluginManagement["origin"]) {
    if (origin === "uploaded") return "管理员上传";
    return origin === "official" ? "官方内置" : "系统内置";
}

function configurationLabel(scope: PluginManagement["configurationScope"]) {
    if (scope === "system") return "管理员统一配置";
    if (scope === "user") return "用户各自配置";
    return "无需配置";
}

function runtimeLabel(manifest: PluginManifest | PluginManifestV2) {
    const names: Record<string, string> = { declarative: "声明式", sandbox: "沙箱", worker: "Worker", "trusted-backend": "受信后端" };
    const parts = [manifest.runtime?.backend ? `后端${names[manifest.runtime.backend] || manifest.runtime.backend}` : "", manifest.runtime?.web ? `前端${names[manifest.runtime.web] || manifest.runtime.web}` : ""].filter(Boolean);
    return parts.join(" · ") || "未声明";
}

function contributionSummary(manifest: PluginManifest | PluginManifestV2): Array<[string, string]> {
    const contributes = manifest.contributes || {};
    const labels = (items?: Array<{ id: string; label?: string }>) => (items || []).map((item) => item.label || item.id).join("、");
    const rows: Array<[string, string]> = [
        ["模型接入", labels(contributes.providers)],
        ["支付", labels(contributes.paymentProviders)],
        ["工作流", labels(contributes.workflows)],
        ["画布节点", labels(contributes.canvasNodes)],
        ["命令", labels(contributes.commands)],
        ["媒体转换", contributes.transforms?.length ? `${contributes.transforms.length} 项` : ""],
        ["素材来源", (contributes.assetSources || []).join("、")],
        ["Agent", (contributes.agents || []).join("、")],
    ];
    return rows.filter(([, value]) => value);
}

function formatTime(value?: string) {
    if (!value) return "未记录";
    const time = dayjs(value);
    return time.isValid() && time.year() > 1 ? time.format("YYYY-MM-DD HH:mm") : "未记录";
}
