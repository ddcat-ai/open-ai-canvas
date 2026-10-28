import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button } from "antd";
import { ArrowDown, ArrowUp, BookOpenText, CheckCircle2, Globe2, Languages, Save } from "lucide-react";
import { useNavigate } from "react-router";

import { Select } from "@/components/ui/base/select";
import { AdminPageFrame } from "@/pages/admin/components/admin-shell";
import { AdminStatTile, AdminStatusBadge, SettingsSectionCard } from "@/pages/admin/components/admin-ui";
import { Switch } from "@/pages/admin/ui/controls";
import { setPluginPlatformAvailability } from "@/services/api/plugins";
import { usePluginStore } from "@/stores/use-plugin-store";
import { getAdminSupDanceI18nOverview, updateAdminSupDanceI18nSettings } from "../api";
import { SUPPORTED_LOCALE_CODES } from "../locales";
import { useI18n, useSupDanceI18nEnabled, useSupDanceI18nStore } from "../store";
import { SUPDANCE_I18N_PLUGIN_ID, type SupDanceI18nSettings, type SupDanceLanguageItem, type SupDanceLanguageStats, type SupDanceLocaleCode, type SupDanceSwitcherStyle } from "../types";

function computeLocalLanguageStats(languages: SupDanceLanguageItem[], entries: ReturnType<typeof useSupDanceI18nStore.getState>["entries"]): SupDanceLanguageStats[] {
    const totalCount = entries.length;
    return languages.map((lang) => {
        let translatedCount = 0;
        for (const entry of entries) {
            if (entry.translations[lang.code]?.trim()) {
                translatedCount += 1;
            }
        }
        const missingCount = Math.max(0, totalCount - translatedCount);
        const coveragePercent = totalCount > 0 ? Math.round((translatedCount / totalCount) * 1000) / 10 : 100;
        return {
            ...lang,
            translatedCount,
            totalCount,
            missingCount,
            coveragePercent,
        };
    });
}

export function SupDanceI18nSettingsPage() {
    const { t } = useI18n();
    const { message } = App.useApp();
    const navigate = useNavigate();

    const pluginEnabled = useSupDanceI18nEnabled();
    const storeSettings = useSupDanceI18nStore((s) => s.settings);
    const storeEntries = useSupDanceI18nStore((s) => s.entries);
    const currentLocale = useSupDanceI18nStore((s) => s.locale);
    const setLocale = useSupDanceI18nStore((s) => s.setLocale);
    const setStorePluginEnabled = useSupDanceI18nStore((s) => s.setPluginEnabled);
    const updateLocalSettings = useSupDanceI18nStore((s) => s.updateLocalSettings);

    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [togglingPlugin, setTogglingPlugin] = useState(false);
    const [serverConnected, setServerConnected] = useState<boolean | null>(null);
    const [draftSettings, setDraftSettings] = useState<SupDanceI18nSettings>(storeSettings);
    const [remoteStats, setRemoteStats] = useState<SupDanceLanguageStats[] | null>(null);
    const [counts, setCounts] = useState<{ totalEntries: number; customCount: number; modifiedCount: number }>({
        totalEntries: storeEntries.length,
        customCount: storeEntries.filter((e) => e.origin === "custom").length,
        modifiedCount: storeEntries.filter((e) => e.origin === "modified").length,
    });

    const loadOverview = useCallback(async () => {
        setLoading(true);
        try {
            const overview = await getAdminSupDanceI18nOverview();
            setServerConnected(true);
            setDraftSettings(overview.settings);
            updateLocalSettings(overview.settings);
            setStorePluginEnabled(overview.pluginEnabled);
            setRemoteStats(overview.languageStats);
            setCounts({
                totalEntries: overview.totalEntries,
                customCount: overview.customCount,
                modifiedCount: overview.modifiedCount,
            });
        } catch {
            setServerConnected(false);
            setDraftSettings(useSupDanceI18nStore.getState().settings);
            setRemoteStats(null);
        } finally {
            setLoading(false);
        }
    }, [setStorePluginEnabled, updateLocalSettings]);

    useEffect(() => {
        void loadOverview();
    }, [loadOverview]);

    const sortedLanguages = useMemo(() => [...draftSettings.languages].sort((a, b) => a.sortOrder - b.sortOrder), [draftSettings.languages]);

    const languageStatsMap = useMemo(() => {
        const stats = remoteStats ?? computeLocalLanguageStats(sortedLanguages, storeEntries);
        return new Map(stats.map((item) => [item.code, item]));
    }, [remoteStats, sortedLanguages, storeEntries]);

    const enabledLanguageCount = useMemo(() => sortedLanguages.filter((item) => item.enabled).length, [sortedLanguages]);

    const handleTogglePluginMaster = async (checked: boolean) => {
        setTogglingPlugin(true);
        try {
            let persistedOnServer = false;
            let serverErrReason = "";
            try {
                await setPluginPlatformAvailability(SUPDANCE_I18N_PLUGIN_ID, checked);
                persistedOnServer = true;
                setServerConnected(true);
            } catch (err) {
                setServerConnected(false);
                serverErrReason = err instanceof Error ? err.message : "服务端未响应";
            }
            usePluginStore.setState((state) => ({
                pluginStates: {
                    ...state.pluginStates,
                    [SUPDANCE_I18N_PLUGIN_ID]: {
                        pluginId: SUPDANCE_I18N_PLUGIN_ID,
                        platformAvailable: checked,
                        userEnabled: checked,
                        userConfigured: true,
                        effectiveEnabled: checked,
                        canToggle: false,
                        canConfigure: false,
                    },
                },
            }));
            setStorePluginEnabled(checked);
            if (persistedOnServer) {
                message.success(checked ? "站点多语言插件已在服务端启用，右上角切换图标已挂载" : "站点多语言插件已在服务端停用，全站已恢复默认中文");
            } else {
                message.warning(`服务端持久化未完成（${serverErrReason}），插件开关当前仅在本机浏览器缓存生效`);
            }
        } finally {
            setTogglingPlugin(false);
        }
    };

    const handleLanguageToggle = (code: SupDanceLocaleCode, enabled: boolean) => {
        if (!enabled && sortedLanguages.filter((item) => item.enabled).length <= 1) {
            message.warning("至少需要保留 1 个启用状态的语言");
            return;
        }
        const nextLanguages = sortedLanguages.map((item) => (item.code === code ? { ...item, enabled } : item));
        let nextDefault = draftSettings.defaultLocale;
        if (!enabled && draftSettings.defaultLocale === code) {
            nextDefault = nextLanguages.find((item) => item.enabled)?.code ?? "zh-CN";
        }
        setDraftSettings((prev) => ({
            ...prev,
            defaultLocale: nextDefault,
            languages: nextLanguages,
        }));
    };

    const handleMoveLanguage = (index: number, direction: -1 | 1) => {
        const targetIndex = index + direction;
        if (targetIndex < 0 || targetIndex >= sortedLanguages.length) return;
        const cloned = [...sortedLanguages];
        const [moved] = cloned.splice(index, 1);
        if (!moved) return;
        cloned.splice(targetIndex, 0, moved);
        const reordered = cloned.map((item, idx) => ({
            ...item,
            sortOrder: idx + 1,
        }));
        setDraftSettings((prev) => ({
            ...prev,
            languages: reordered,
        }));
    };

    const handleSetDefaultLocale = (code: SupDanceLocaleCode) => {
        const nextLanguages = sortedLanguages.map((item) => (item.code === code ? { ...item, enabled: true } : item));
        setDraftSettings((prev) => ({
            ...prev,
            defaultLocale: code,
            languages: nextLanguages,
        }));
    };

    const handleSaveSettings = async () => {
        setSaving(true);
        try {
            try {
                const overview = await updateAdminSupDanceI18nSettings(draftSettings);
                setServerConnected(true);
                setDraftSettings(overview.settings);
                updateLocalSettings(overview.settings);
                setRemoteStats(overview.languageStats);
                message.success("多语言设置已持久化至服务端并全站实时生效");
            } catch (err) {
                setServerConnected(false);
                updateLocalSettings(draftSettings);
                const reason = err instanceof Error ? err.message : "服务端未响应";
                message.warning(`服务端持久化未完成（${reason}），当前设置仅保存在本机浏览器缓存中`);
            }
        } finally {
            setSaving(false);
        }
    };

    const languageSelectOptions = useMemo(
        () =>
            sortedLanguages
                .filter((item) => item.enabled)
                .map((item) => ({
                    value: item.code,
                    label: `${item.nativeName} (${item.name} · ${item.code})`,
                })),
        [sortedLanguages],
    );

    const allLanguageSelectOptions = useMemo(
        () =>
            sortedLanguages.map((item) => ({
                value: item.code,
                label: `${item.nativeName} (${item.name} · ${item.code})`,
            })),
        [sortedLanguages],
    );

    return (
        <AdminPageFrame
            scroll
            title="语言管理设置"
            description="管理站点六大语种（简中、英语、繁中、日文、韩语、西班牙语）的启用状态、排序、右上角语言切换图标样式与全站回退策略。"
            actions={
                <div className="flex flex-wrap items-center gap-2">
                    <AdminStatusBadge label={pluginEnabled ? "插件已启用" : "插件已关闭"} tone={pluginEnabled ? "success" : "neutral"} />
                    {serverConnected !== null ? <AdminStatusBadge label={serverConnected ? "服务端已同步" : "本地缓存降级"} tone={serverConnected ? "info" : "warning"} /> : null}
                    <AdminStatusBadge label={`支持 ${SUPPORTED_LOCALE_CODES.length} 大语种`} tone="info" />
                    <Button icon={<BookOpenText className="size-4" />} onClick={() => navigate("/admin/i18n/entries")}>
                        词条与字段修改
                    </Button>
                    <Button type="primary" icon={<Save className="size-4" />} loading={saving} onClick={() => void handleSaveSettings()}>
                        保存设置
                    </Button>
                </div>
            }
        >
            <div data-plugin-scope="i18n" className="admin-settings-stack admin-i18n-settings" data-i18n-ignore="true">
                <div className="admin-i18n-overview">
                    <AdminStatTile label="已启用语种" value={`${enabledLanguageCount} / ${sortedLanguages.length}`} detail={`默认语言：${draftSettings.defaultLocale}`} />
                    <AdminStatTile label="词库总词条" value={counts.totalEntries} detail="覆盖全站核心导航、创作、画布与设置" />
                    <AdminStatTile label="自定义与修订词条" value={counts.customCount + counts.modifiedCount} detail={`修订内置 ${counts.modifiedCount} 条 · 新增 ${counts.customCount} 条`} />
                    <div className="admin-stat-tile flex flex-col justify-between">
                        <div className="admin-stat-tile-label">当前浏览器预览语言</div>
                        <div className="mt-1 flex items-center gap-2">
                            <Select size="small" value={currentLocale} className="w-full" options={languageSelectOptions} onChange={(val) => setLocale(val as SupDanceLocaleCode)} aria-label="实时预览切换当前语言" />
                        </div>
                        <div className="admin-stat-tile-detail mt-1">
                            <span>切换后可立即在站点右上角预览效果</span>
                        </div>
                    </div>
                </div>

                {/* Section 1: Master Plugin Switch */}
                <SettingsSectionCard
                    icon={<Languages className="size-4" aria-hidden="true" />}
                    title="1. 站点多语言引擎总控"
                    description="一键启用或停用全站多语言实时切换能力。关闭后，站点各入口语言切换图标将自动卸载，页面文本无损恢复原始中文。"
                    status={
                        <AdminStatusBadge
                            label={pluginEnabled ? "运行中" : "已停用"}
                            tone={pluginEnabled ? "success" : "neutral"}
                        />
                    }
                    layout="split"
                >
                    <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <div className="text-sm font-medium text-[var(--admin-text-primary)]">
                                站点多语言实时转译引擎 (supdance-i18n)
                            </div>
                            <p className="mt-0.5 text-xs text-[var(--admin-text-muted)]">
                                状态与系统插件中心实时双向同步。关闭后全站恢复默认语言，词条数据完整保留。
                            </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <span className="text-xs text-[var(--admin-text-secondary)]">
                                {pluginEnabled ? "已启用" : "已停用"}
                            </span>
                            <Switch
                                checked={pluginEnabled}
                                loading={togglingPlugin}
                                onChange={(checked) => void handleTogglePluginMaster(checked)}
                                aria-label="启用或停用站点多语言插件"
                            />
                        </div>
                    </div>
                </SettingsSectionCard>

                {/* Section 2: Global Policies & Switcher Appearance */}
                <SettingsSectionCard
                    icon={<Globe2 className="size-4" aria-hidden="true" />}
                    title="2. 全局语言策略与切换器展示设置"
                    description="配置访客首次访问时的语言匹配规则、缺省回退语言以及全站各页面顶栏语言图标的展示形态与挂载入口。"
                    status={
                        <AdminStatusBadge
                            label={`默认: ${draftSettings.defaultLocale}`}
                            tone="info"
                        />
                    }
                    layout="stacked"
                >
                    <div className="p-4 space-y-4">
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-[var(--admin-text-secondary)]">默认站点语言</label>
                                <Select
                                    value={draftSettings.defaultLocale}
                                    className="w-full"
                                    options={languageSelectOptions}
                                    onChange={(value) =>
                                        setDraftSettings((prev) => ({
                                            ...prev,
                                            defaultLocale: value as SupDanceLocaleCode,
                                        }))
                                    }
                                    aria-label="默认站点语言"
                                />
                                <p className="text-xs text-[var(--admin-text-muted)]">新访客在未手动选择且未命中浏览器语言时使用的默认语言。</p>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-[var(--admin-text-secondary)]">缺省回退语言 (Fallback)</label>
                                <Select
                                    value={draftSettings.fallbackLocale}
                                    className="w-full"
                                    options={allLanguageSelectOptions}
                                    onChange={(value) =>
                                        setDraftSettings((prev) => ({
                                            ...prev,
                                            fallbackLocale: value as SupDanceLocaleCode,
                                        }))
                                    }
                                    aria-label="缺省回退语言"
                                />
                                <p className="text-xs text-[var(--admin-text-muted)]">当目标语言的某个词条尚未翻译时，优先回退显示的语言。</p>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-[var(--admin-text-secondary)]">右上角切换图标展示样式</label>
                                <Select
                                    value={draftSettings.switcherStyle}
                                    className="w-full"
                                    options={[
                                        { value: "icon_code", label: "语言图标 + 语言简码（如：文 EN / 中）" },
                                        { value: "icon_only", label: "仅展示语言切换图标（紧凑模式）" },
                                        { value: "icon_name", label: "语言图标 + 母语名称（如：文 English）" },
                                    ]}
                                    onChange={(value) =>
                                        setDraftSettings((prev) => ({
                                            ...prev,
                                            switcherStyle: value as SupDanceSwitcherStyle,
                                        }))
                                    }
                                    aria-label="右上角切换图标展示样式"
                                />
                                <p className="text-xs text-[var(--admin-text-muted)]">控制站点右上角语言切换按钮的外观展示形态。</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-3 border-t pt-4 sm:grid-cols-2 lg:grid-cols-3" style={{ borderColor: "var(--admin-row-border)" }}>
                            <div className="flex items-center justify-between rounded-md border px-3 py-2.5" style={{ borderColor: "var(--admin-row-border)", background: "var(--admin-surface-2)" }}>
                                <div>
                                    <div className="text-xs font-medium text-[var(--admin-text-primary)]">自动识别浏览器语言</div>
                                    <div className="text-xs text-[var(--admin-text-muted)]">根据访客 Navigator 语言自动匹配六大语种</div>
                                </div>
                                <Switch checked={draftSettings.autoDetectBrowser} onChange={(checked) => setDraftSettings((prev) => ({ ...prev, autoDetectBrowser: checked }))} aria-label="自动识别浏览器语言" />
                            </div>

                            <div className="flex items-center justify-between rounded-md border px-3 py-2.5" style={{ borderColor: "var(--admin-row-border)", background: "var(--admin-surface-2)" }}>
                                <div>
                                    <div className="text-xs font-medium text-[var(--admin-text-primary)]">工作台右上角显示切换图标</div>
                                    <div className="text-xs text-[var(--admin-text-muted)]">主工作区顶栏（通知与主题切换旁）</div>
                                </div>
                                <Switch checked={draftSettings.showInWorkspaceTopBar} onChange={(checked) => setDraftSettings((prev) => ({ ...prev, showInWorkspaceTopBar: checked }))} aria-label="工作台右上角显示切换图标" />
                            </div>

                            <div className="flex items-center justify-between rounded-md border px-3 py-2.5" style={{ borderColor: "var(--admin-row-border)", background: "var(--admin-surface-2)" }}>
                                <div>
                                    <div className="text-xs font-medium text-[var(--admin-text-primary)]">登录/注册页右上角显示图标</div>
                                    <div className="text-xs text-[var(--admin-text-muted)]">允许未登录访客在登录页切换语言</div>
                                </div>
                                <Switch checked={draftSettings.showInAuthPage} onChange={(checked) => setDraftSettings((prev) => ({ ...prev, showInAuthPage: checked }))} aria-label="登录注册页右上角显示图标" />
                            </div>

                            <div className="flex items-center justify-between rounded-md border px-3 py-2.5" style={{ borderColor: "var(--admin-row-border)", background: "var(--admin-surface-2)" }}>
                                <div>
                                    <div className="text-xs font-medium text-[var(--admin-text-primary)]">自由画布顶栏右上角显示图标</div>
                                    <div className="text-xs text-[var(--admin-text-muted)]">在独立全屏画布工具栏右上角挂载入口</div>
                                </div>
                                <Switch checked={draftSettings.showInCanvasTopBar} onChange={(checked) => setDraftSettings((prev) => ({ ...prev, showInCanvasTopBar: checked }))} aria-label="自由画布顶栏右上角显示图标" />
                            </div>

                            <div className="flex items-center justify-between rounded-md border px-3 py-2.5" style={{ borderColor: "var(--admin-row-border)", background: "var(--admin-surface-2)" }}>
                                <div>
                                    <div className="text-xs font-medium text-[var(--admin-text-primary)]">管理后台顶栏右上角显示图标</div>
                                    <div className="text-xs text-[var(--admin-text-muted)]">在后台标题栏操作区显示语言切换器</div>
                                </div>
                                <Switch checked={draftSettings.showInAdminTopBar} onChange={(checked) => setDraftSettings((prev) => ({ ...prev, showInAdminTopBar: checked }))} aria-label="管理后台顶栏右上角显示图标" />
                            </div>

                            <div className="flex items-center justify-between rounded-md border px-3 py-2.5" style={{ borderColor: "var(--admin-row-border)", background: "var(--admin-surface-2)" }}>
                                <div>
                                    <div className="text-xs font-medium text-[var(--admin-text-primary)]">管理后台页面同步翻译</div>
                                    <div className="text-xs text-[var(--admin-text-muted)]">开启后 `/admin` 后台界面也将跟随切换语言</div>
                                </div>
                                <Switch checked={draftSettings.translateAdminPages} onChange={(checked) => setDraftSettings((prev) => ({ ...prev, translateAdminPages: checked }))} aria-label="管理后台页面同步翻译" />
                            </div>
                        </div>
                    </div>
                </SettingsSectionCard>

                {/* Section 3: Supported Locales Matrix */}
                <SettingsSectionCard
                    icon={<BookOpenText className="size-4" aria-hidden="true" />}
                    title="3. 六大支持语种管理与翻译覆盖率"
                    description="支持对简体中文、英语、繁体中文、日文、韩国语、西班牙语进行独立启用/停用、下拉顺序调整及缺失词条补全。"
                    status={
                        <AdminStatusBadge
                            label={`${enabledLanguageCount} / ${sortedLanguages.length} 已开放`}
                            tone={enabledLanguageCount > 0 ? "success" : "neutral"}
                        />
                    }
                    layout="stacked"
                >
                    <div className="overflow-x-auto">
                        <table className="admin-i18n-lang-table">
                            <thead>
                                <tr>
                                    <th style={{ width: 90 }}>排序</th>
                                    <th>语种标识与名称</th>
                                    <th style={{ width: 110 }}>Locale 代码</th>
                                    <th style={{ width: 220 }}>词条翻译覆盖率</th>
                                    <th style={{ width: 160 }}>角色状态</th>
                                    <th style={{ width: 90 }}>启用状态</th>
                                    <th style={{ width: 180, textAlign: "right" }}>操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedLanguages.map((lang, index) => {
                                    const stat = languageStatsMap.get(lang.code);
                                    const translated = stat?.translatedCount ?? counts.totalEntries;
                                    const total = stat?.totalCount ?? counts.totalEntries;
                                    const coverage = stat?.coveragePercent ?? 100;
                                    const missing = stat?.missingCount ?? 0;
                                    const isDefault = draftSettings.defaultLocale === lang.code;
                                    const isFallback = draftSettings.fallbackLocale === lang.code;

                                    return (
                                        <tr key={lang.code}>
                                            <td>
                                                <div className="flex items-center gap-1">
                                                    <span className="inline-flex w-5 justify-center font-mono text-[var(--admin-text-muted)]">{index + 1}</span>
                                                    <Button type="text" size="small" disabled={index === 0 || loading} icon={<ArrowUp className="size-3.5" />} aria-label={`上移 ${lang.name}`} onClick={() => handleMoveLanguage(index, -1)} />
                                                    <Button
                                                        type="text"
                                                        size="small"
                                                        disabled={index === sortedLanguages.length - 1 || loading}
                                                        icon={<ArrowDown className="size-3.5" />}
                                                        aria-label={`下移 ${lang.name}`}
                                                        onClick={() => handleMoveLanguage(index, 1)}
                                                    />
                                                </div>
                                            </td>
                                            <td>
                                                <div className="flex items-center gap-2.5">
                                                    <span className="inline-flex h-6 min-w-[28px] items-center justify-center rounded bg-[var(--admin-layer-2)] border border-[var(--admin-border)] px-1.5 text-xs font-semibold text-[var(--admin-text-primary)]">{lang.badge}</span>
                                                    <div>
                                                        <div className="font-medium text-[var(--admin-text-primary)]">{lang.nativeName}</div>
                                                        <div className="text-xs text-[var(--admin-text-muted)]">{lang.name}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="font-mono text-xs text-[var(--admin-text-secondary)]">{lang.code}</td>
                                            <td>
                                                <div className="w-48 max-w-full space-y-1">
                                                    <div className="flex items-center justify-between text-xs">
                                                        <span className="font-medium text-[var(--admin-text-primary)]">
                                                            {translated} / {total} ({coverage}%)
                                                        </span>
                                                        {missing > 0 ? (
                                                            <AdminStatusBadge label={`待译 ${missing} 条`} tone="warning" />
                                                        ) : (
                                                            <AdminStatusBadge label="已完整" tone="success" />
                                                        )}
                                                    </div>
                                                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--admin-layer-2)]">
                                                        <div className="h-full rounded-full bg-[var(--admin-primary)] transition-all" style={{ width: `${Math.min(100, Math.max(0, coverage))}%` }} />
                                                    </div>
                                                </div>
                                            </td>
                                            <td>
                                                <div className="flex flex-wrap items-center gap-1.5">
                                                    {isDefault ? <AdminStatusBadge label="默认语言" tone="success" /> : null}
                                                    {isFallback ? <AdminStatusBadge label="回退语言" tone="info" /> : null}
                                                    {currentLocale === lang.code ? <AdminStatusBadge label="当前预览" tone="neutral" /> : null}
                                                </div>
                                            </td>
                                            <td>
                                                <Switch checked={lang.enabled} onChange={(checked) => handleLanguageToggle(lang.code, checked)} aria-label={`启用或禁用 ${lang.name}`} />
                                            </td>
                                            <td style={{ textAlign: "right" }}>
                                                <div className="inline-flex items-center justify-end gap-1">
                                                    <Button
                                                        type="text"
                                                        size="small"
                                                        icon={<Globe2 className="size-3.5" />}
                                                        disabled={!lang.enabled || currentLocale === lang.code}
                                                        onClick={() => {
                                                            setLocale(lang.code);
                                                            message.success(`已切换当前预览语言为 ${lang.nativeName}`);
                                                        }}
                                                    >
                                                        预览
                                                    </Button>
                                                    {!isDefault ? (
                                                        <Button type="text" size="small" onClick={() => handleSetDefaultLocale(lang.code)}>
                                                            设为默认
                                                        </Button>
                                                    ) : null}
                                                    <Button type="link" size="small" onClick={() => navigate(missing > 0 ? `/admin/i18n/entries?missingLocale=${encodeURIComponent(lang.code)}` : `/admin/i18n/entries`)}>
                                                        {missing > 0 ? `补全 (${missing})` : "词条修改"}
                                                    </Button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </SettingsSectionCard>
            </div>
        </AdminPageFrame>
    );
}
export default SupDanceI18nSettingsPage;
