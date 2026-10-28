import { useEffect, useMemo, useState } from "react";
import { App, Button, Input, Skeleton } from "antd";
import { Switch } from "@/pages/admin/ui/controls";
import {
    AlertTriangle,
    BadgeCheck,
    Check,
    Copy,
    Globe,
    Globe2,
    Lock,
    Play,
    RefreshCw,
    RotateCcw,
    Save,
    ShieldCheck,
    Sparkles,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Select } from "@/components/ui/base/select";
import { AdminPageFrame } from "@/pages/admin/components/admin-shell";
import {
    AdminStatTile,
    AdminStatusBadge,
    configuredSecretText,
    SettingsSectionCard,
} from "@/pages/admin/components/admin-ui";
import { useI18n } from "@/supdance/plugins/i18n";
import {
    getAdminSocialAuthSettings,
    testSocialAuthProvider,
    updateAdminSocialAuthSettings,
} from "../api";
import { SocialProviderIcon } from "../components/social-provider-icons";
import type {
    AdminSettingsView,
    ProviderTestResult,
    SocialAuthProviderAdmin,
    SocialAuthRegion,
    SocialAuthStatus,
} from "../types";

interface ProviderDraftState {
    enabled: boolean;
    clientId: string;
    clientSecret: string;
    sandboxMockEnabled: boolean;
}

export default function SocialAuthSettingsPage() {
    const { t } = useI18n();
    const { message } = App.useApp();
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [data, setData] = useState<AdminSettingsView | null>(null);
    const [loadError, setLoadError] = useState("");

    // Draft state for full-page editing and dirty tracking
    const [draftFallbackRegion, setDraftFallbackRegion] = useState<SocialAuthRegion>("cn");
    const [providerDrafts, setProviderDrafts] = useState<Record<string, ProviderDraftState>>({});
    
    // Testing state per provider
    const [testingProvider, setTestingProvider] = useState<string | null>(null);
    const [testResults, setTestResults] = useState<Record<string, ProviderTestResult>>({});

    const initDraftsFromData = (settings: AdminSettingsView) => {
        setDraftFallbackRegion(settings.defaultFallbackRegion || "cn");
        const drafts: Record<string, ProviderDraftState> = {};
        const all = [
            ...(settings.mainlandProviders || []),
            ...(settings.intlProviders || []),
            ...(settings.providers ? Object.values(settings.providers) : []),
        ];
        for (const p of all) {
            drafts[p.id] = {
                enabled: p.enabled,
                clientId: p.clientIdMasked && !p.clientIdMasked.includes("*") ? p.clientIdMasked : "",
                clientSecret: "",
                sandboxMockEnabled: Boolean(p.sandboxMockEnabled),
            };
        }
        setProviderDrafts(drafts);
    };

    const loadSettings = async (isInitial = false) => {
        if (isInitial) setLoading(true);
        else setRefreshing(true);
        setLoadError("");
        try {
            const res = await getAdminSocialAuthSettings();
            setData(res);
            initDraftsFromData(res);
        } catch (err) {
            const msg = err instanceof Error ? err.message : "读取社交登录配置失败";
            setLoadError(msg);
            message.error(msg);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        void loadSettings(true);
    }, []);

    // Check dirty state
    const isDirty = useMemo(() => {
        if (!data) return false;
        if (draftFallbackRegion !== (data.defaultFallbackRegion || "cn")) return true;
        const all = [
            ...(data.mainlandProviders || []),
            ...(data.intlProviders || []),
        ];
        for (const p of all) {
            const draft = providerDrafts[p.id];
            if (!draft) continue;
            if (draft.enabled !== p.enabled) return true;
            if (draft.sandboxMockEnabled !== Boolean(p.sandboxMockEnabled)) return true;
            if (draft.clientId && draft.clientId !== p.clientIdMasked) return true;
            if (draft.clientSecret.trim().length > 0) return true;
        }
        return false;
    }, [data, draftFallbackRegion, providerDrafts]);

    const handleResetDraft = () => {
        if (!data) return;
        initDraftsFromData(data);
        message.info(t("admin.social_auth.reset_reverted", undefined, "已撤销当前未保存的调整"));
    };

    const handleCopy = (text: string, label = "内容") => {
        navigator.clipboard.writeText(text);
        message.success(t("admin.social_auth.copy_success", { label }, `已复制${label}到剪贴板`));
    };

    const handlePing = async (provider: SocialAuthProviderAdmin) => {
        setTestingProvider(provider.id);
        try {
            const res = await testSocialAuthProvider(provider.id);
            setTestResults((prev) => ({ ...prev, [provider.id]: res }));
            if (res.status === "ok") {
                message.success(`${provider.name} 连通性测试通过 (${res.pingLatencyMs}ms)`);
            } else if (res.status === "degraded") {
                message.warning(`${provider.name}: ${res.message}`);
            } else {
                message.error(`${provider.name}: ${res.message}`);
            }
        } catch (err) {
            message.error(err instanceof Error ? err.message : "测试失败");
        } finally {
            setTestingProvider(null);
        }
    };

    const handleSubmitSave = async () => {
        if (!data) return;
        setSaving(true);
        try {
            const providersPayload: Record<string, any> = {};
            const all = [
                ...(data.mainlandProviders || []),
                ...(data.intlProviders || []),
            ];
            for (const p of all) {
                const draft = providerDrafts[p.id];
                if (!draft) continue;
                const update: Record<string, any> = {
                    enabled: draft.enabled,
                    sandboxMockEnabled: draft.sandboxMockEnabled,
                };
                if (draft.clientId.trim()) {
                    update.clientId = draft.clientId.trim();
                }
                if (draft.clientSecret.trim()) {
                    update.clientSecret = draft.clientSecret.trim();
                }
                providersPayload[p.id] = update;
            }

            const res = await updateAdminSocialAuthSettings({
                defaultFallbackRegion: draftFallbackRegion,
                providers: providersPayload,
            });

            setData(res);
            initDraftsFromData(res);
            message.success(t("admin.social_auth.save_success", undefined, "社交登录配置已保存并即时生效"));
        } catch (err) {
            message.error(err instanceof Error ? err.message : "保存配置失败");
        } finally {
            setSaving(false);
        }
    };

    if (loading && !data) {
        return (
            <AdminPageFrame
                title="第三方登录配置"
                description="全站统一 8 大主流平台登录、IP 智能分区策略与沙盒联调测试"
                scroll
            >
                <div data-plugin-scope="social-auth" className="admin-settings-stack admin-social-auth-settings" role="status">
                    <div className="admin-social-auth-command-bar">
                        <Skeleton active title={{ width: 220 }} paragraph={false} />
                    </div>
                    <div className="admin-social-auth-overview">
                        {Array.from({ length: 4 }).map((_, index) => (
                            <div key={index} className="admin-stat-tile">
                                <Skeleton active title={{ width: 100 }} paragraph={{ rows: 1 }} />
                            </div>
                        ))}
                    </div>
                    <div className="admin-settings-section p-6">
                        <Skeleton active paragraph={{ rows: 8 }} />
                    </div>
                </div>
            </AdminPageFrame>
        );
    }

    if (!data) {
        return (
            <AdminPageFrame
                title="第三方登录配置"
                description="全站统一 8 大主流平台登录、IP 智能分区策略与沙盒联调测试"
                scroll
            >
                <div data-plugin-scope="social-auth" className="admin-settings-stack admin-social-auth-settings">
                    <div className="admin-access-load-error" role="alert">
                        <span className="admin-access-load-error-icon">
                            <AlertTriangle className="size-5" aria-hidden="true" />
                        </span>
                        <div>
                            <h2>无法读取社交登录配置</h2>
                            <p>{loadError || "当前没有可显示的配置，请稍后重试。"}</p>
                        </div>
                        <Button icon={<RefreshCw className="size-4" />} onClick={() => void loadSettings(true)}>
                            重新读取
                        </Button>
                    </div>
                </div>
            </AdminPageFrame>
        );
    }

    const cnProviders = data.mainlandProviders || (data.providers ? Object.values(data.providers).filter((p) => p.region === "cn") : []);
    const intlProviders = data.intlProviders || (data.providers ? Object.values(data.providers).filter((p) => p.region === "intl") : []);

    const cnActiveCount = cnProviders.filter((p) => providerDrafts[p.id]?.enabled ?? p.enabled).length;
    const intlActiveCount = intlProviders.filter((p) => providerDrafts[p.id]?.enabled ?? p.enabled).length;
    const onlineCount = cnActiveCount + intlActiveCount;

    const renderProviderItem = (provider: SocialAuthProviderAdmin) => {
        const draft = providerDrafts[provider.id] || {
            enabled: provider.enabled,
            clientId: "",
            clientSecret: "",
            sandboxMockEnabled: Boolean(provider.sandboxMockEnabled),
        };
        const hasSecret = Boolean(provider.maskedSecret || provider.clientSecretMasked);
        const testRes = testResults[provider.id];

        const statusTone = (status: SocialAuthStatus) => {
            switch (status) {
                case "online":
                    return "success";
                case "ready":
                    return "info";
                case "credentials_required":
                    return "warning";
                default:
                    return "neutral";
            }
        };

        const statusLabel = (status: SocialAuthStatus) => {
            switch (status) {
                case "online":
                    return "运行中";
                case "ready":
                    return "就绪待上线";
                case "credentials_required":
                    return "凭证待填写";
                default:
                    return "未配置";
            }
        };

        return (
            <div
                key={provider.id}
                className={cn("admin-social-provider-item", !draft.enabled && "is-disabled")}
            >
                {/* Provider Header */}
                <div className="admin-social-provider-header">
                    <div className="admin-social-provider-title">
                        <span className="admin-social-provider-icon">
                            <SocialProviderIcon provider={provider.id} className="size-5" />
                        </span>
                        <div>
                            <div className="flex flex-wrap items-center gap-2">
                                <strong className="text-sm font-semibold text-[var(--admin-text-primary)]">
                                    {provider.name}
                                </strong>
                                <span className="font-mono text-xs text-[var(--admin-text-muted)]">
                                    ({provider.id})
                                </span>
                                <AdminStatusBadge
                                    label={provider.region === "cn" ? "国内渠道" : "国际渠道"}
                                    tone="neutral"
                                />
                                <AdminStatusBadge
                                    label={statusLabel(provider.status)}
                                    tone={statusTone(provider.status)}
                                />
                                {draft.sandboxMockEnabled && (
                                    <AdminStatusBadge label="沙盒 Mock 联调" tone="info" />
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="text-xs text-[var(--admin-text-secondary)]">
                            {draft.enabled ? "已启用" : "已停用"}
                        </span>
                        <Switch
                            checked={draft.enabled}
                            onChange={(val) =>
                                setProviderDrafts((prev) => ({
                                    ...prev,
                                    [provider.id]: { ...prev[provider.id], enabled: val },
                                }))
                            }
                            aria-label={`启用 ${provider.name}`}
                        />
                    </div>
                </div>

                {/* Provider Form Inputs */}
                <div className="admin-social-provider-grid">
                    <div>
                        <label className="mb-1.5 block text-xs font-medium text-[var(--admin-text-secondary)]">
                            App ID / Client ID
                        </label>
                        <Input
                            placeholder={provider.clientIdMasked || "输入 App ID / Client ID"}
                            value={draft.clientId}
                            onChange={(e) => {
                                const val = e.target.value;
                                setProviderDrafts((prev) => ({
                                    ...prev,
                                    [provider.id]: { ...prev[provider.id], clientId: val },
                                }));
                            }}
                        />
                    </div>
                    <div>
                        <label className="mb-1.5 block text-xs font-medium text-[var(--admin-text-secondary)]">
                            App Secret / Client Secret
                        </label>
                        <Input.Password
                            placeholder={hasSecret ? configuredSecretText : "输入 App Secret / Client Secret"}
                            value={draft.clientSecret}
                            onChange={(e) => {
                                const val = e.target.value;
                                setProviderDrafts((prev) => ({
                                    ...prev,
                                    [provider.id]: { ...prev[provider.id], clientSecret: val },
                                }));
                            }}
                        />
                    </div>
                    <div>
                        <label className="mb-1.5 block text-xs font-medium text-[var(--admin-text-secondary)]">
                            回调重定向地址 (Redirect URI)
                        </label>
                        <Input
                            readOnly
                            value={provider.callbackUrl}
                            addonAfter={
                                <Button
                                    type="text"
                                    size="small"
                                    icon={<Copy className="size-3.5" />}
                                    aria-label={`复制 ${provider.name} 回调地址`}
                                    onClick={() => handleCopy(provider.callbackUrl, `${provider.name} 回调地址`)}
                                >
                                    复制
                                </Button>
                            }
                        />
                    </div>
                </div>

                {/* Provider Footer Actions */}
                <div className="admin-social-provider-footer">
                    <div className="flex items-center gap-2">
                        <Switch
                            size="sm"
                            checked={draft.sandboxMockEnabled}
                            onChange={(val) =>
                                setProviderDrafts((prev) => ({
                                    ...prev,
                                    [provider.id]: { ...prev[provider.id], sandboxMockEnabled: val },
                                }))
                            }
                            aria-label={`${provider.name} 沙盒联调模式`}
                        />
                        <span className="text-xs text-[var(--admin-text-secondary)]">沙盒 Mock 联调模式</span>
                        <AdminStatusBadge label="免审核模拟授权" tone="neutral" />
                    </div>

                    <div className="flex items-center gap-2">
                        {testRes && (
                            <AdminStatusBadge
                                label={`${testRes.pingLatencyMs}ms · ${testRes.status === "ok" ? "连接畅通" : "异常"}`}
                                tone={testRes.status === "ok" ? "success" : "error"}
                            />
                        )}
                        <Button
                            size="small"
                            icon={<Play className="size-3" />}
                            loading={testingProvider === provider.id}
                            onClick={() => handlePing(provider)}
                        >
                            连通性测试
                        </Button>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <AdminPageFrame
            title="第三方登录配置"
            description="全站统一 8 大主流平台登录、IP 智能分区策略与沙盒联调测试"
            scroll
        >
            <div data-plugin-scope="social-auth" className="admin-settings-stack admin-social-auth-settings">
                {/* Command Bar */}
                <div className={cn("admin-social-auth-command-bar", isDirty && "is-dirty")}>
                    <div className="admin-social-auth-command-copy" aria-live="polite">
                        <span className="admin-social-auth-command-icon">
                            <ShieldCheck className="size-4" aria-hidden="true" />
                        </span>
                        <div>
                            <strong>
                                {isDirty ? "配置有未保存的调整" : "第三方登录服务运行正常"}
                            </strong>
                            <p>
                                {isDirty
                                    ? "调整已在本页暂存；请在核对后点击“保存修改”。"
                                    : `已启用 ${onlineCount} 个在线渠道 · 访客智能分区识别生效中`}
                            </p>
                        </div>
                    </div>
                    <div className="admin-social-auth-command-actions">
                        {isDirty && (
                            <Button
                                icon={<RotateCcw className="size-4" />}
                                disabled={saving}
                                onClick={handleResetDraft}
                            >
                                撤销改动
                            </Button>
                        )}
                        <Button
                            icon={<RefreshCw className="size-4" />}
                            loading={refreshing}
                            disabled={saving}
                            onClick={() => void loadSettings(false)}
                        >
                            刷新状态
                        </Button>
                        <Button
                            type="primary"
                            icon={<Save className="size-4" />}
                            loading={saving}
                            disabled={!isDirty || loading || refreshing}
                            onClick={handleSubmitSave}
                        >
                            保存修改
                        </Button>
                    </div>
                </div>

                {/* 4 Overview Stat Tiles */}
                <div className="admin-social-auth-overview">
                    <AdminStatTile
                        label="当前识别访客 IP"
                        value={data.clientIp || "—"}
                        detail={data.detectedRegion === "cn" ? "归属：中国大陆 (CN)" : "归属：海外及港澳台 (Intl)"}
                        trend={{
                            value: data.detectedRegion === "cn" ? "CN IP" : "Intl IP",
                            tone: "info",
                        }}
                    />
                    <AdminStatTile
                        label="服务商就绪总计"
                        value={`${onlineCount} / 8`}
                        detail="8 大主流登录渠道已集成"
                        trend={{
                            value: onlineCount > 0 ? "服务在线" : "未上线",
                            tone: onlineCount > 0 ? "success" : "neutral",
                        }}
                    />
                    <AdminStatTile
                        label="中国大陆渠道"
                        value={`${cnActiveCount} / ${cnProviders.length}`}
                        detail="QQ · 微信 · 抖音 · 哔哩哔哩"
                        trend={{
                            value: cnActiveCount > 0 ? "已开放" : "未开启",
                            tone: cnActiveCount > 0 ? "success" : "neutral",
                        }}
                    />
                    <AdminStatTile
                        label="海外国际渠道"
                        value={`${intlActiveCount} / ${intlProviders.length}`}
                        detail="Google · X · Instagram · TikTok"
                        trend={{
                            value: intlActiveCount > 0 ? "已开放" : "未开启",
                            tone: intlActiveCount > 0 ? "success" : "neutral",
                        }}
                    />
                </div>

                {/* Section 1: GeoIP Partition Policy */}
                <SettingsSectionCard
                    icon={<Globe className="size-4" aria-hidden="true" />}
                    title="1. 访客 IP 智能分区与回退规则"
                    description="服务端根据真实公网 IP（穿透 Cloudflare 与 Nginx 反代链路）权威决策展示渠道。中国大陆显示国内渠道，非大陆显示国际渠道，港澳台默认归入国际渠道。"
                    status={
                        <AdminStatusBadge
                            label={`默认回退: ${draftFallbackRegion === "cn" ? "中国大陆" : "海外国际"}`}
                            tone="info"
                        />
                    }
                >
                    <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="space-y-1">
                            <strong className="text-sm font-medium text-[var(--admin-text-primary)]">
                                未知/异常 IP 默认回退分区
                            </strong>
                            <p className="text-xs text-[var(--admin-text-muted)]">
                                当访客 IP 无法解析或 GeoIP 服务离线时，系统权威回退展示的登录渠道集。
                            </p>
                        </div>
                        <div className="shrink-0">
                            <Select
                                value={draftFallbackRegion}
                                onChange={(val) => setDraftFallbackRegion(val as SocialAuthRegion)}
                                className="w-52"
                                options={[
                                    { value: "cn", label: "中国大陆渠道 (CN)" },
                                    { value: "intl", label: "海外国际渠道 (Intl)" },
                                ]}
                            />
                        </div>
                    </div>
                </SettingsSectionCard>

                {/* Section 2: Mainland CN Providers */}
                <SettingsSectionCard
                    icon={<ShieldCheck className="size-4" aria-hidden="true" />}
                    title="2. 中国大陆渠道接入配置"
                    description="面向中国大陆 IP 访客展示的快捷登录渠道。AppID 与 AppSecret 经 AES-256-GCM 安全加密存储。"
                    status={
                        <AdminStatusBadge
                            label={`${cnActiveCount} 个已启用`}
                            tone={cnActiveCount > 0 ? "success" : "neutral"}
                        />
                    }
                >
                    <div className="p-4">
                        <div className="admin-social-provider-list">
                            {cnProviders.map(renderProviderItem)}
                        </div>
                    </div>
                </SettingsSectionCard>

                {/* Section 3: International Providers */}
                <SettingsSectionCard
                    icon={<Globe2 className="size-4" aria-hidden="true" />}
                    title="3. 海外与国际渠道接入配置"
                    description="面向海外及港澳台 IP 访客展示的快捷登录渠道。支持 OAuth2 / OIDC 标准协议与沙盒 Mock 联调。"
                    status={
                        <AdminStatusBadge
                            label={`${intlActiveCount} 个已启用`}
                            tone={intlActiveCount > 0 ? "success" : "neutral"}
                        />
                    }
                >
                    <div className="p-4">
                        <div className="admin-social-provider-list">
                            {intlProviders.map(renderProviderItem)}
                        </div>
                    </div>
                </SettingsSectionCard>
            </div>
        </AdminPageFrame>
    );
}
