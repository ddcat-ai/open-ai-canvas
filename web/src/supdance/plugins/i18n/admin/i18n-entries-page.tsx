import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Input } from "antd";
import type { ColumnsType } from "antd/es/table";
import { saveAs } from "file-saver";
import { Download, Edit3, Plus, Radar, RotateCcw, Search, Settings2, Trash2, Upload } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router";

import { Select } from "@/components/ui/base/select";
import { AdminPageFrame } from "@/pages/admin/components/admin-shell";
import { AdminDataTable, AdminFilterChip, AdminStatTile, AdminStatusBadge, AdminTableEmpty, PaginationBar } from "@/pages/admin/components/admin-ui";
import { AdminDrawer, AdminModal } from "@/pages/admin/ui/overlays";
import { deleteAdminSupDanceI18nEntry, exportAdminSupDanceI18n, importAdminSupDanceI18n, listAdminSupDanceI18nEntries, upsertAdminSupDanceI18nEntries } from "../api";
import { DEFAULT_SUPDANCE_LANGUAGES, NAMESPACE_LABELS, SUPPORTED_LOCALE_CODES } from "../locales";
import { useSupDanceI18nStore } from "../store";
import { SUPDANCE_I18N_PLUGIN_ID, type SupDanceDiscoveredTextItem, type SupDanceI18nEntry, type SupDanceLocaleCode } from "../types";

const EMPTY_TRANSLATIONS: Record<SupDanceLocaleCode, string> = {
    "zh-CN": "",
    "en-US": "",
    "zh-TW": "",
    "ja-JP": "",
    "ko-KR": "",
    "es-ES": "",
};

function createEmptyEntryDraft(): SupDanceI18nEntry {
    return {
        key: "",
        namespace: "custom",
        sourceText: "",
        description: "",
        translations: { ...EMPTY_TRANSLATIONS },
        origin: "custom",
    };
}

function inferNamespaceFromRoute(route: string): string {
    const clean = route.toLowerCase();
    if (clean.startsWith("/canvas")) return "canvas";
    if (clean.startsWith("/projects")) return "projects";
    if (clean.startsWith("/create")) return "create";
    if (clean.startsWith("/assets")) return "assets";
    if (clean.startsWith("/skills")) return "skills";
    if (clean.startsWith("/plugins")) return "plugins";
    if (clean.startsWith("/settings")) return "settings";
    if (clean.startsWith("/login") || clean.startsWith("/register") || clean.startsWith("/auth")) return "auth";
    if (clean.startsWith("/admin")) return "admin";
    return "custom";
}

function buildSuggestedKeyFromText(namespace: string, sourceText: string): string {
    let hash = 0;
    for (let i = 0; i < sourceText.length; i++) {
        hash = (hash * 31 + sourceText.charCodeAt(i)) >>> 0;
    }
    return `${namespace}.auto_${hash.toString(36).slice(0, 8)}`;
}

export function SupDanceI18nEntriesPage() {
    const { message, modal } = App.useApp();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();

    const storeEntries = useSupDanceI18nStore((s) => s.entries);
    const storeSettings = useSupDanceI18nStore((s) => s.settings);
    const discoveredUntranslated = useSupDanceI18nStore((s) => s.discoveredUntranslated);
    const upsertLocalEntries = useSupDanceI18nStore((s) => s.upsertLocalEntries);
    const removeLocalEntry = useSupDanceI18nStore((s) => s.removeLocalEntry);
    const clearDiscoveredUntranslated = useSupDanceI18nStore((s) => s.clearDiscoveredUntranslated);

    const [keyword, setKeyword] = useState(() => searchParams.get("keyword") ?? "");
    const [namespace, setNamespace] = useState(() => searchParams.get("namespace") ?? "all");
    const [origin, setOrigin] = useState(() => searchParams.get("origin") ?? "all");
    const [missingLocale, setMissingLocale] = useState(() => searchParams.get("missingLocale") ?? "all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);

    const [loading, setLoading] = useState(false);
    const [serverConnected, setServerConnected] = useState<boolean | null>(null);
    const [remoteItems, setRemoteItems] = useState<SupDanceI18nEntry[] | null>(null);
    const [remoteTotal, setRemoteTotal] = useState<number | null>(null);

    const [drawerOpen, setDrawerOpen] = useState(false);
    const [isCreateMode, setIsCreateMode] = useState(false);
    const [editingEntry, setEditingEntry] = useState<SupDanceI18nEntry>(createEmptyEntryDraft);
    const [savingEntry, setSavingEntry] = useState(false);

    const [discoveredDrawerOpen, setDiscoveredDrawerOpen] = useState(false);

    const [importModalOpen, setImportModalOpen] = useState(false);
    const [importJsonText, setImportJsonText] = useState("");
    const [importing, setImporting] = useState(false);

    const fetchRemoteEntries = useCallback(async () => {
        setLoading(true);
        try {
            const res = await listAdminSupDanceI18nEntries({
                keyword: keyword.trim() || undefined,
                namespace: namespace !== "all" ? namespace : undefined,
                origin: origin !== "all" ? origin : undefined,
                missingLocale: missingLocale !== "all" ? missingLocale : undefined,
                page,
                pageSize,
            });
            setServerConnected(true);
            setRemoteItems(res.items);
            setRemoteTotal(res.total);
        } catch {
            setServerConnected(false);
            setRemoteItems(null);
            setRemoteTotal(null);
        } finally {
            setLoading(false);
        }
    }, [keyword, missingLocale, namespace, origin, page, pageSize]);

    useEffect(() => {
        void fetchRemoteEntries();
    }, [fetchRemoteEntries]);

    const filteredLocalEntries = useMemo(() => {
        const kw = keyword.trim().toLowerCase();
        return storeEntries.filter((entry) => {
            if (namespace !== "all" && entry.namespace !== namespace) return false;
            if (origin !== "all" && entry.origin !== origin) return false;
            if (missingLocale !== "all") {
                const targetVal = entry.translations[missingLocale as SupDanceLocaleCode];
                if (targetVal && targetVal.trim() !== "") return false;
            }
            if (kw) {
                const hitKey = entry.key.toLowerCase().includes(kw);
                const hitSource = entry.sourceText.toLowerCase().includes(kw);
                const hitDesc = (entry.description ?? "").toLowerCase().includes(kw);
                const hitTrans = SUPPORTED_LOCALE_CODES.some((code) => (entry.translations[code] ?? "").toLowerCase().includes(kw));
                if (!hitKey && !hitSource && !hitDesc && !hitTrans) return false;
            }
            return true;
        });
    }, [keyword, missingLocale, namespace, origin, storeEntries]);

    const displayItems = useMemo(() => {
        if (remoteItems !== null) return remoteItems;
        const start = (page - 1) * pageSize;
        return filteredLocalEntries.slice(start, start + pageSize);
    }, [filteredLocalEntries, page, pageSize, remoteItems]);

    const displayTotal = remoteTotal ?? filteredLocalEntries.length;

    const summaryStats = useMemo(() => {
        const total = storeEntries.length;
        let builtin = 0;
        let modified = 0;
        let custom = 0;
        for (const item of storeEntries) {
            if (item.origin === "modified") modified += 1;
            else if (item.origin === "custom") custom += 1;
            else builtin += 1;
        }
        return { total, builtin, modified, custom };
    }, [storeEntries]);

    const namespaceOptions = useMemo(() => {
        const counts = new Map<string, number>();
        for (const item of storeEntries) {
            counts.set(item.namespace, (counts.get(item.namespace) ?? 0) + 1);
        }
        return [
            { value: "all", label: `全部模块 (${storeEntries.length})` },
            ...Object.entries(NAMESPACE_LABELS).map(([ns, label]) => ({
                value: ns,
                label: `${label} (${counts.get(ns) ?? 0})`,
            })),
        ];
    }, [storeEntries]);

    const openCreateDrawer = () => {
        setIsCreateMode(true);
        setEditingEntry(createEmptyEntryDraft());
        setDrawerOpen(true);
    };

    const openCreateFromDiscovered = (item: SupDanceDiscoveredTextItem) => {
        const inferredNamespace = inferNamespaceFromRoute(item.route);
        const suggestedKey = buildSuggestedKeyFromText(inferredNamespace, item.sourceText);
        setIsCreateMode(true);
        setEditingEntry({
            key: suggestedKey,
            namespace: inferredNamespace,
            sourceText: item.sourceText,
            description: `自动嗅探自页面 ${item.route}`,
            translations: {
                ...EMPTY_TRANSLATIONS,
                "zh-CN": item.sourceText,
            },
            origin: "custom",
        });
        setDiscoveredDrawerOpen(false);
        setDrawerOpen(true);
    };

    const openEditDrawer = (record: SupDanceI18nEntry) => {
        setIsCreateMode(false);
        setEditingEntry({
            ...record,
            translations: {
                "zh-CN": record.translations["zh-CN"] ?? record.sourceText ?? "",
                "en-US": record.translations["en-US"] ?? "",
                "zh-TW": record.translations["zh-TW"] ?? "",
                "ja-JP": record.translations["ja-JP"] ?? "",
                "ko-KR": record.translations["ko-KR"] ?? "",
                "es-ES": record.translations["es-ES"] ?? "",
            },
        });
        setDrawerOpen(true);
    };

    const handleSaveEntry = async () => {
        const cleanKey = editingEntry.key.trim();
        const zhText = editingEntry.translations["zh-CN"]?.trim() || editingEntry.sourceText.trim();
        if (!cleanKey) {
            message.warning("请填写词条 Key（例如：custom.heroTitle 或 nav.myFeature）");
            return;
        }
        if (!zhText) {
            message.warning("请填写简体中文（zh-CN）基准词条内容");
            return;
        }

        const normalizedEntry: SupDanceI18nEntry = {
            ...editingEntry,
            key: cleanKey,
            namespace: editingEntry.namespace || cleanKey.split(".")[0] || "custom",
            sourceText: editingEntry.sourceText.trim() || zhText,
            translations: {
                "zh-CN": zhText,
                "en-US": editingEntry.translations["en-US"]?.trim() ?? "",
                "zh-TW": editingEntry.translations["zh-TW"]?.trim() ?? "",
                "ja-JP": editingEntry.translations["ja-JP"]?.trim() ?? "",
                "ko-KR": editingEntry.translations["ko-KR"]?.trim() ?? "",
                "es-ES": editingEntry.translations["es-ES"]?.trim() ?? "",
            },
        };

        setSavingEntry(true);
        try {
            let persistedOnServer = false;
            let serverErrReason = "";
            try {
                await upsertAdminSupDanceI18nEntries([normalizedEntry]);
                persistedOnServer = true;
                setServerConnected(true);
            } catch (err) {
                setServerConnected(false);
                serverErrReason = err instanceof Error ? err.message : "服务端未响应";
            }
            upsertLocalEntries([normalizedEntry]);
            setDrawerOpen(false);
            void fetchRemoteEntries();
            if (persistedOnServer) {
                message.success(isCreateMode ? "新翻译词条已持久化到服务端并全站实时生效" : "词条六语翻译已持久化到服务端并实时生效");
            } else {
                message.warning(`服务端持久化未完成（${serverErrReason}），当前词条仅保存在本机浏览器缓存中`);
            }
        } finally {
            setSavingEntry(false);
        }
    };

    const handleResetOrDelete = (record: SupDanceI18nEntry) => {
        const isCustom = record.origin === "custom";
        modal.confirm({
            title: isCustom ? "删除自定义词条" : "恢复内置默认翻译",
            content: isCustom ? `确定要删除自定义词条「${record.key}」吗？删除后页面将不再自动翻译该自定义词条。` : `确定要将词条「${record.key}」恢复为出厂内置六语翻译吗？`,
            okText: isCustom ? "确认删除" : "恢复默认",
            cancelText: "取消",
            okButtonProps: { danger: isCustom },
            onOk: async () => {
                let persistedOnServer = false;
                let serverErrReason = "";
                try {
                    await deleteAdminSupDanceI18nEntry(record.key);
                    persistedOnServer = true;
                    setServerConnected(true);
                } catch (err) {
                    setServerConnected(false);
                    serverErrReason = err instanceof Error ? err.message : "服务端未响应";
                }
                removeLocalEntry(record.key);
                void fetchRemoteEntries();
                if (persistedOnServer) {
                    message.success(isCustom ? "已在服务端删除自定义词条" : "已在服务端恢复内置默认词条");
                } else {
                    message.warning(`服务端操作未完成（${serverErrReason}），当前仅更新本机浏览器缓存`);
                }
            },
        });
    };

    const handleExportJson = async () => {
        try {
            let payload;
            try {
                payload = await exportAdminSupDanceI18n();
            } catch {
                payload = {
                    pluginId: SUPDANCE_I18N_PLUGIN_ID,
                    version: "1.0.0",
                    exportedAt: new Date().toISOString(),
                    settings: storeSettings,
                    entries: storeEntries,
                };
            }
            const blob = new Blob([JSON.stringify(payload, null, 2)], {
                type: "application/json;charset=utf-8",
            });
            saveAs(blob, `supdance-i18n-dictionary-${new Date().toISOString().slice(0, 10)}.json`);
            message.success("多语言词库 JSON 已导出");
        } catch (err) {
            message.error(err instanceof Error ? err.message : "导出失败");
        }
    };

    const handleImportJson = async () => {
        const raw = importJsonText.trim();
        if (!raw) {
            message.warning("请粘贴或上传有效的 JSON 词库内容");
            return;
        }
        setImporting(true);
        try {
            const parsed = JSON.parse(raw) as {
                entries?: SupDanceI18nEntry[];
                overrides?: Record<string, SupDanceI18nEntry>;
            };
            const list: SupDanceI18nEntry[] = Array.isArray(parsed.entries) ? parsed.entries : parsed.overrides ? Object.values(parsed.overrides) : [];

            if (list.length === 0) {
                message.warning("未在 JSON 中识别到有效的 entries 词条数组");
                return;
            }

            let persistedOnServer = false;
            let serverErrReason = "";
            try {
                await importAdminSupDanceI18n({ entries: list });
                persistedOnServer = true;
                setServerConnected(true);
            } catch (err) {
                setServerConnected(false);
                serverErrReason = err instanceof Error ? err.message : "服务端未响应";
            }
            upsertLocalEntries(list);
            setImportModalOpen(false);
            setImportJsonText("");
            void fetchRemoteEntries();
            if (persistedOnServer) {
                message.success(`成功导入并持久化 ${list.length} 条多语言词条至服务端`);
            } else {
                message.warning(`服务端导入未完成（${serverErrReason}），${list.length} 条词条当前仅保存在本机浏览器缓存中`);
            }
        } catch (err) {
            message.error(err instanceof Error ? `JSON 解析失败: ${err.message}` : "导入失败");
        } finally {
            setImporting(false);
        }
    };

    const hasActiveFilters = Boolean(keyword.trim()) || namespace !== "all" || origin !== "all" || missingLocale !== "all";

    const resetFilters = () => {
        setKeyword("");
        setNamespace("all");
        setOrigin("all");
        setMissingLocale("all");
        setPage(1);
        setSearchParams({});
    };

    const columns: ColumnsType<SupDanceI18nEntry> = [
        {
            title: "词条 Key / 模块",
            dataIndex: "key",
            key: "key",
            width: 220,
            render: (_val, record) => (
                <div className="space-y-1">
                    <div className="font-mono text-xs font-medium text-[var(--admin-text-primary)]">{record.key}</div>
                    <div className="flex flex-wrap items-center gap-1.5">
                        <AdminStatusBadge label={NAMESPACE_LABELS[record.namespace] || record.namespace} tone="neutral" />
                        {record.origin === "modified" ? <AdminStatusBadge label="已修订" tone="info" /> : record.origin === "custom" ? <AdminStatusBadge label="自定义新增" tone="success" /> : <AdminStatusBadge label="内置" tone="neutral" />}
                    </div>
                </div>
            ),
        },
        {
            title: "简体中文 (zh-CN / 原文)",
            dataIndex: "sourceText",
            key: "zh-CN",
            width: 190,
            render: (_val, record) => (
                <button type="button" className="group flex w-full items-start justify-between gap-1.5 rounded px-1.5 py-1 text-left transition-colors hover:bg-[var(--admin-row-hover)]" onClick={() => openEditDrawer(record)} title="点击修改词条翻译">
                    <span className="text-xs font-medium text-[var(--admin-text-primary)]">{record.translations["zh-CN"] || record.sourceText}</span>
                    <Edit3 className="mt-0.5 size-3 shrink-0 text-[var(--admin-text-secondary)] opacity-60 group-hover:opacity-100" />
                </button>
            ),
        },
        {
            title: "English (en-US)",
            key: "en-US",
            width: 190,
            render: (_val, record) => {
                const text = record.translations["en-US"];
                return (
                    <button type="button" className="group flex w-full items-start justify-between gap-1.5 rounded px-1.5 py-1 text-left transition-colors hover:bg-[var(--admin-row-hover)]" onClick={() => openEditDrawer(record)}>
                        {text ? <span className="text-xs text-[var(--admin-text-primary)]">{text}</span> : <span className="text-xs italic text-[var(--admin-status-warning)]">待翻译 (点击补充)</span>}
                        <Edit3 className="mt-0.5 size-3 shrink-0 text-[var(--admin-text-secondary)] opacity-0 group-hover:opacity-100" />
                    </button>
                );
            },
        },
        {
            title: "繁體中文 (zh-TW)",
            key: "zh-TW",
            width: 160,
            render: (_val, record) => {
                const text = record.translations["zh-TW"];
                return (
                    <button type="button" className="group flex w-full items-start justify-between gap-1.5 rounded px-1.5 py-1 text-left transition-colors hover:bg-[var(--admin-row-hover)]" onClick={() => openEditDrawer(record)}>
                        {text ? <span className="text-xs text-[var(--admin-text-primary)]">{text}</span> : <span className="text-xs italic text-[var(--admin-status-warning)]">待翻译</span>}
                        <Edit3 className="mt-0.5 size-3 shrink-0 text-[var(--admin-text-secondary)] opacity-0 group-hover:opacity-100" />
                    </button>
                );
            },
        },
        {
            title: "日本語 / 한국어 / Español",
            key: "other-locales",
            width: 280,
            render: (_val, record) => (
                <div className="cursor-pointer space-y-1 rounded px-1.5 py-1 transition-colors hover:bg-[var(--admin-row-hover)]" onClick={() => openEditDrawer(record)}>
                    {(["ja-JP", "ko-KR", "es-ES"] as const).map((code) => {
                        const val = record.translations[code];
                        const badge = code === "ja-JP" ? "日" : code === "ko-KR" ? "韓" : "ES";
                        return (
                            <div key={code} className="flex items-center gap-1.5 text-xs">
                                <span className="inline-flex h-4 min-w-[20px] shrink-0 items-center justify-center rounded bg-[var(--admin-surface-2)] px-1 text-xs font-semibold text-[var(--admin-text-secondary)]">{badge}</span>
                                {val ? <span className="truncate text-[var(--admin-text-primary)]">{val}</span> : <span className="italic text-[var(--admin-status-warning)]">未翻译</span>}
                            </div>
                        );
                    })}
                </div>
            ),
        },
        {
            title: "操作",
            key: "actions",
            width: 150,
            align: "right",
            render: (_val, record) => (
                <div className="inline-flex items-center justify-end gap-1">
                    <Button type="text" size="small" icon={<Edit3 className="size-3.5" />} onClick={() => openEditDrawer(record)}>
                        修改翻译
                    </Button>
                    {record.origin === "modified" || record.origin === "custom" ? (
                        <Button type="text" size="small" danger={record.origin === "custom"} icon={record.origin === "custom" ? <Trash2 className="size-3.5" /> : <RotateCcw className="size-3.5" />} onClick={() => handleResetOrDelete(record)}>
                            {record.origin === "custom" ? "删除" : "还原"}
                        </Button>
                    ) : null}
                </div>
            ),
        },
    ];

    return (
        <AdminPageFrame
            scroll
            title="多语言词条与字段修改"
            description="随时在线搜索、编辑或新增站点任意字段的六国语言（简中、英语、繁中、日文、韩语、西班牙语）翻译词条，保存后全站免编译即时热生效。"
            actions={
                <div className="flex flex-wrap items-center gap-2">
                    {serverConnected !== null ? <AdminStatusBadge label={serverConnected ? "服务端已同步" : "本地缓存降级"} tone={serverConnected ? "info" : "warning"} /> : null}
                    <Button icon={<Radar className="size-4" />} onClick={() => setDiscoveredDrawerOpen(true)}>
                        未收录词条嗅探 ({discoveredUntranslated.length})
                    </Button>
                    <Button icon={<Settings2 className="size-4" />} onClick={() => navigate("/admin/i18n/settings")}>
                        语言管理设置
                    </Button>
                    <Button icon={<Upload className="size-4" />} onClick={() => setImportModalOpen(true)}>
                        导入词库
                    </Button>
                    <Button icon={<Download className="size-4" />} onClick={() => void handleExportJson()}>
                        导出词库
                    </Button>
                    <Button type="primary" icon={<Plus className="size-4" />} onClick={openCreateDrawer}>
                        新增翻译字段
                    </Button>
                </div>
            }
        >
            <div className="admin-i18n-entries space-y-4" data-i18n-ignore="true" data-plugin-scope="i18n">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <AdminStatTile label="全站词条总数" value={summaryStats.total} detail="支持 Key 绑定与 DOM 原文自动映射" />
                    <AdminStatTile label="内置基础词条" value={summaryStats.builtin} detail="出厂预设六大语种完整词库" />
                    <AdminStatTile label="已修订内置词条" value={summaryStats.modified} detail="可随时一键还原为出厂默认翻译" />
                    <AdminStatTile label="自定义新增字段" value={summaryStats.custom} detail={`页面自动嗅探待收录 ${discoveredUntranslated.length} 条`} />
                </div>

                <AdminDataTable<SupDanceI18nEntry>
                    toolbar={
                        <div className="w-full max-w-xs">
                            <Input
                                allowClear
                                value={keyword}
                                prefix={<Search className="size-3.5 text-muted-foreground" />}
                                placeholder="搜索 Key、中文原文或任意语种译文..."
                                onChange={(e) => {
                                    setKeyword(e.target.value);
                                    setPage(1);
                                }}
                            />
                        </div>
                    }
                    toolbarFilters={
                        <div className="flex flex-wrap items-center gap-2">
                            <Select
                                value={namespace}
                                className="w-44"
                                options={namespaceOptions}
                                onChange={(val) => {
                                    setNamespace(String(val));
                                    setPage(1);
                                }}
                                aria-label="按模块筛选"
                            />
                            <Select
                                value={origin}
                                className="w-36"
                                options={[
                                    { value: "all", label: "全部来源" },
                                    { value: "builtin", label: "内置未改" },
                                    { value: "modified", label: "已修订覆写" },
                                    { value: "custom", label: "自定义新增" },
                                ]}
                                onChange={(val) => {
                                    setOrigin(String(val));
                                    setPage(1);
                                }}
                                aria-label="按词条来源筛选"
                            />
                            <Select
                                value={missingLocale}
                                className="w-44"
                                options={[
                                    { value: "all", label: "全部翻译状态" },
                                    ...DEFAULT_SUPDANCE_LANGUAGES.map((lang) => ({
                                        value: lang.code,
                                        label: `缺失 ${lang.name} (${lang.code})`,
                                    })),
                                ]}
                                onChange={(val) => {
                                    setMissingLocale(String(val));
                                    setPage(1);
                                }}
                                aria-label="按缺失语种筛选"
                            />
                        </div>
                    }
                    toolbarActive={hasActiveFilters}
                    onReset={resetFilters}
                    toolbarActiveFilters={
                        hasActiveFilters ? (
                            <>
                                {namespace !== "all" ? <AdminFilterChip label={`模块: ${NAMESPACE_LABELS[namespace] || namespace}`} onRemove={() => setNamespace("all")} /> : null}
                                {origin !== "all" ? <AdminFilterChip label={`来源: ${origin}`} onRemove={() => setOrigin("all")} /> : null}
                                {missingLocale !== "all" ? <AdminFilterChip label={`缺失语种: ${missingLocale}`} onRemove={() => setMissingLocale("all")} /> : null}
                            </>
                        ) : undefined
                    }
                    table={{
                        rowKey: "key",
                        loading,
                        columns,
                        dataSource: displayItems,
                        pagination: false,
                        size: "middle",
                    }}
                    empty={<AdminTableEmpty filtered={hasActiveFilters} title={hasActiveFilters ? "未找到匹配的翻译词条" : "暂无词条数据"} description="您可以尝试更换搜索关键词，或直接点击右上角「新增翻译字段」添加任意页面文案的六语翻译。" />}
                    footer={
                        <PaginationBar
                            current={page}
                            pageSize={pageSize}
                            total={displayTotal}
                            alwaysShow
                            itemLabel="条词条"
                            onChange={(nextPage, nextSize) => {
                                setPage(nextPage);
                                setPageSize(nextSize);
                            }}
                        />
                    }
                />
            </div>

            <AdminDrawer
                open={discoveredDrawerOpen}
                width={560}
                title={`页面未收录中文词条嗅探 (${discoveredUntranslated.length})`}
                onClose={() => setDiscoveredDrawerOpen(false)}
                extra={
                    discoveredUntranslated.length > 0 ? (
                        <Button
                            size="small"
                            onClick={() => {
                                clearDiscoveredUntranslated();
                                message.success("已清空待收录嗅探列表");
                            }}
                        >
                            清空列表
                        </Button>
                    ) : null
                }
            >
                <div className="space-y-3" data-i18n-ignore="true" data-plugin-scope="i18n">
                    <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)]/50 p-3 text-xs text-[var(--admin-text-secondary)]">当您在前台页面浏览或切换语言时，DOM 翻译引擎会自动嗅探尚未收录进词库的中文文案并汇总在此。点击「一键收录并翻译」即可快速补全六语翻译。</div>
                    {discoveredUntranslated.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-[var(--admin-border)] p-8 text-center text-xs text-[var(--admin-text-secondary)]">当前暂未发现未收录的页面中文词条。您可前往前台工作区、画布或弹窗浏览页面，未命中词库的中文文案会自动出现在此处。</div>
                    ) : (
                        <div className="divide-y divide-[var(--admin-row-border)] rounded-lg border border-[var(--admin-border)]">
                            {discoveredUntranslated.map((item) => (
                                <div key={item.sourceText} className="flex items-center justify-between gap-3 p-3">
                                    <div className="min-w-0 flex-1 space-y-1">
                                        <div className="break-words text-xs font-medium text-[var(--admin-text-primary)]">{item.sourceText}</div>
                                        <div className="flex items-center gap-2 text-xs text-[var(--admin-text-secondary)]">
                                            <span>发现路由：{item.route}</span>
                                            <span>·</span>
                                            <span>出现 {item.count} 次</span>
                                        </div>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1.5">
                                        <Button type="primary" size="small" icon={<Plus className="size-3.5" />} onClick={() => openCreateFromDiscovered(item)}>
                                            一键收录并翻译
                                        </Button>
                                        <Button type="text" size="small" onClick={() => clearDiscoveredUntranslated(item.sourceText)}>
                                            忽略
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </AdminDrawer>

            <AdminDrawer
                open={drawerOpen}
                width={560}
                title={isCreateMode ? "新增多语言字段词条" : `编辑词条翻译 · ${editingEntry.key}`}
                onClose={() => setDrawerOpen(false)}
                extra={
                    <div className="flex items-center gap-2">
                        <Button onClick={() => setDrawerOpen(false)}>取消</Button>
                        <Button type="primary" loading={savingEntry} onClick={() => void handleSaveEntry()}>
                            保存并热生效
                        </Button>
                    </div>
                }
            >
                <div className="space-y-4" data-i18n-ignore="true" data-plugin-scope="i18n">
                    <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)]/50 p-3 text-xs text-[var(--admin-text-secondary)]">
                        提示：支持 ICU 动态占位变量（如 <code>{"{count}"}</code>、<code>{"{name}"}</code>）。只要「简体中文 (zh-CN)」与页面上的中文文案或动态格式一致，切换语言时全站对应文本与按钮会自动匹配并替换为目标语种译文。
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-[var(--admin-text-primary)]">词条唯一标识 (Key)</label>
                            <Input
                                disabled={!isCreateMode}
                                value={editingEntry.key}
                                placeholder="如：custom.myButton 或 nav.discover"
                                onChange={(e) =>
                                    setEditingEntry((prev) => ({
                                        ...prev,
                                        key: e.target.value,
                                    }))
                                }
                            />
                        </div>

                        <div className="space-y-1">
                            <label className="text-xs font-medium text-[var(--admin-text-primary)]">所属业务模块 (Namespace)</label>
                            <Select
                                value={editingEntry.namespace}
                                className="w-full"
                                options={Object.entries(NAMESPACE_LABELS).map(([ns, label]) => ({
                                    value: ns,
                                    label: `${label} (${ns})`,
                                }))}
                                onChange={(val) =>
                                    setEditingEntry((prev) => ({
                                        ...prev,
                                        namespace: String(val),
                                    }))
                                }
                            />
                        </div>
                    </div>

                    <div className="space-y-1">
                        <label className="text-xs font-medium text-[var(--admin-text-primary)]">备注说明（可选，供管理员查阅）</label>
                        <Input
                            value={editingEntry.description ?? ""}
                            placeholder="说明该词条在页面中的位置或语境..."
                            onChange={(e) =>
                                setEditingEntry((prev) => ({
                                    ...prev,
                                    description: e.target.value,
                                }))
                            }
                        />
                    </div>

                    <div className="space-y-3 border-t border-[var(--admin-row-border)] pt-3">
                        <div className="text-xs font-semibold text-[var(--admin-text-primary)]">六大语种对应译文配置</div>

                        {DEFAULT_SUPDANCE_LANGUAGES.map((lang) => {
                            const val = editingEntry.translations[lang.code] ?? "";
                            return (
                                <div key={lang.code} className="space-y-1">
                                    <div className="flex items-center justify-between">
                                        <label className="flex items-center gap-1.5 text-xs font-medium text-[var(--admin-text-primary)]">
                                            <span className="inline-flex h-4 min-w-[22px] items-center justify-center rounded bg-[var(--admin-surface-2)] px-1 text-xs font-semibold text-[var(--admin-text-secondary)]">{lang.badge}</span>
                                            <span>
                                                {lang.nativeName} ({lang.name})
                                            </span>
                                            <span className="font-mono text-xs text-[var(--admin-text-secondary)]">{lang.code}</span>
                                        </label>
                                        {lang.code === "zh-CN" ? <span className="text-xs text-[var(--admin-accent)]">基准匹配原文（必填）</span> : null}
                                    </div>
                                    <Input.TextArea
                                        autoSize={{ minRows: 1, maxRows: 4 }}
                                        value={val}
                                        placeholder={`请输入 ${lang.nativeName} (${lang.code}) 译文...`}
                                        onChange={(e) => {
                                             const nextVal = e.target.value;
                                            setEditingEntry((prev) => ({
                                                ...prev,
                                                sourceText: lang.code === "zh-CN" ? nextVal : prev.sourceText,
                                                translations: {
                                                    ...prev.translations,
                                                    [lang.code]: nextVal,
                                                },
                                            }));
                                        }}
                                    />
                                </div>
                            );
                        })}
                    </div>
                </div>
            </AdminDrawer>

            <AdminModal open={importModalOpen} title="导入多语言词库 (JSON)" okText="确认导入并热生效" cancelText="取消" confirmLoading={importing} onCancel={() => setImportModalOpen(false)} onOk={() => void handleImportJson()}>
                <div className="space-y-3 pt-2" data-i18n-ignore="true" data-plugin-scope="i18n">
                    <p className="text-xs text-[var(--admin-text-secondary)]">
                        支持粘贴由「导出词库」生成的 JSON 内容，或包含 <code>entries</code> 数组的词条文件，同 Key 词条将自动覆盖更新。
                    </p>
                    <Input.TextArea
                        rows={10}
                        className="font-mono text-xs"
                        value={importJsonText}
                        placeholder={
                            '{\n  "entries": [\n    {\n      "key": "custom.hello",\n      "namespace": "custom",\n      "sourceText": "你好",\n      "translations": {\n        "zh-CN": "你好",\n        "en-US": "Hello",\n        "zh-TW": "你好",\n        "ja-JP": "こんにちは",\n        "ko-KR": "안녕하세요",\n        "es-ES": "Hola"\n      }\n    }\n  ]\n}'
                        }
                        onChange={(e) => setImportJsonText(e.target.value)}
                    />
                </div>
            </AdminModal>
        </AdminPageFrame>
    );
}
export default SupDanceI18nEntriesPage;
