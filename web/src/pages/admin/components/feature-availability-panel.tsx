import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { App, Button, Skeleton } from "antd";
import { Switch } from "@/pages/admin/ui/controls";
import { AlertTriangle, ArrowUpRight, Boxes, Clapperboard, Coins, CornerDownRight, History, ImageIcon, MessageCircleMore, MonitorCog, PlugZap, Quote, RadioTower, RefreshCw, ShieldCheck, ShoppingBag, SlidersHorizontal, Video, Wallet } from "lucide-react";

import { Link } from "react-router";

import { cn } from "@/lib/utils";
import { getAdminFeatureAvailability, updateAdminFeatureAvailability } from "@/services/api/auth";
import { useUserStore, type FeatureAvailability } from "@/stores/use-user-store";
import { AdminStatusBadge } from "./admin-ui";
import "./feature-availability-panel.css";

type FeatureKey =
    | "shortDramaEnabled"
    | "taskCenterEnabled"
    | "creditsEnabled"
    | "customChannelsEnabled"
    | "inspirationSourcesVisible"
    | "frontendModelsEnabled"
    | "pluginCenterEnabled"
    | "systemPluginsVisibleToUsers"
    | "imageWorkbenchEnabled"
    | "videoWorkbenchEnabled"
    | "ecommerceEnabled"
    | "ecommerceVideoEnabled"
    | "siteAssistantEnabled";

/** 跨分组的依赖：开关本身可以打开，但缺少这一项时功能只部分可用。 */
type FeatureRequirement = { key: FeatureKey; effect: string };

type FeatureRow = {
    key: FeatureKey;
    title: string;
    /** 前台用户在哪里看到它，让管理员把开关和真实入口对上。 */
    location: string;
    description: string;
    icon: ReactNode;
    requires?: FeatureRequirement[];
    /** 只在上级开启时才有意义的子开关，渲染在上级下方。 */
    children?: FeatureRow[];
    link?: { to: string; label: string };
};

type FeatureGroup = {
    id: string;
    title: string;
    description: string;
    icon: ReactNode;
    rows: FeatureRow[];
};

const editableFeatureKeys: FeatureKey[] = [
    "shortDramaEnabled",
    "taskCenterEnabled",
    "creditsEnabled",
    "customChannelsEnabled",
    "inspirationSourcesVisible",
    "imageWorkbenchEnabled",
    "videoWorkbenchEnabled",
    "ecommerceEnabled",
    "ecommerceVideoEnabled",
    "siteAssistantEnabled",
    "frontendModelsEnabled",
    "pluginCenterEnabled",
    "systemPluginsVisibleToUsers",
];

const featureGroups: FeatureGroup[] = [
    {
        id: "creation",
        title: "创作功能",
        description: "决定前台侧栏出现哪些创作入口",
        icon: <MonitorCog className="size-4" aria-hidden="true" />,
        rows: [
            {
                key: "shortDramaEnabled",
                title: "短剧创作",
                location: "侧栏 · 短剧制作",
                description: "关闭后隐藏入口，已有项目保留。",
                icon: <Clapperboard className="size-4" aria-hidden="true" />,
            },
            {
                key: "imageWorkbenchEnabled",
                title: "图片生成",
                location: "侧栏 · 图片生成",
                description: "电商 Agent 生成商品图也需要开启。关闭后历史作品保留。",
                icon: <ImageIcon className="size-4" aria-hidden="true" />,
            },
            {
                key: "videoWorkbenchEnabled",
                title: "视频生成",
                location: "侧栏 · 视频生成",
                description: "商品视频也需要开启。关闭后历史作品保留。",
                icon: <Video className="size-4" aria-hidden="true" />,
            },
            {
                key: "ecommerceEnabled",
                title: "电商 Agent",
                location: "侧栏 · 电商 Agent",
                description: "关闭后隐藏入口且不能新建商品创作，已有项目和作品保留。",
                icon: <ShoppingBag className="size-4" aria-hidden="true" />,
                requires: [{ key: "imageWorkbenchEnabled", effect: "用户不能生成商品图" }],
                link: { to: "/admin/ecommerce/agent", label: "电商 Agent 配置" },
                children: [
                    {
                        key: "ecommerceVideoEnabled",
                        title: "商品视频",
                        location: "电商 Agent 内",
                        description: "从商品图片制作视频。",
                        icon: <Clapperboard className="size-4" aria-hidden="true" />,
                        requires: [{ key: "videoWorkbenchEnabled", effect: "商品视频不能生成" }],
                    },
                ],
            },
        ],
    },
    {
        id: "tools",
        title: "插件与记录",
        description: "插件调用和创作历史页",
        icon: <PlugZap className="size-4" aria-hidden="true" />,
        rows: [
            {
                key: "pluginCenterEnabled",
                title: "插件中心",
                location: "侧栏 · 插件",
                description: "关闭后隐藏入口，用户不能调用插件。",
                icon: <PlugZap className="size-4" aria-hidden="true" />,
                children: [
                    {
                        key: "systemPluginsVisibleToUsers",
                        title: "系统插件可见",
                        location: "插件中心内",
                        description: "向普通用户展示系统协议插件和管理员上传的插件。",
                        icon: <ShieldCheck className="size-4" aria-hidden="true" />,
                    },
                ],
            },
            {
                key: "taskCenterEnabled",
                title: "任务中心",
                location: "侧栏 · 创作历史",
                description: "关闭只隐藏记录页，不会停止生成任务。",
                icon: <History className="size-4" aria-hidden="true" />,
            },
        ],
    },
    {
        id: "models",
        title: "模型与计费",
        description: "用户选模型的来源，以及生成是否扣积分",
        icon: <Wallet className="size-4" aria-hidden="true" />,
        rows: [
            {
                key: "customChannelsEnabled",
                title: "自定义渠道",
                location: "设置 · 渠道",
                description: "允许用户添加自己的模型渠道和 API Key。",
                icon: <RadioTower className="size-4" aria-hidden="true" />,
            },
            {
                key: "creditsEnabled",
                title: "积分计费",
                location: "账户菜单 · 积分",
                description: "关闭后新任务不再扣积分，已有余额和流水保留。",
                icon: <Coins className="size-4" aria-hidden="true" />,
            },
        ],
    },
    {
        id: "assist",
        title: "页面辅助",
        description: "不影响生成能力的页面元素",
        icon: <SlidersHorizontal className="size-4" aria-hidden="true" />,
        rows: [
            {
                key: "siteAssistantEnabled",
                title: "创作助手",
                location: "页面右下角",
                description: "还需在电商 Agent 配置中启用助手并选择模型。",
                icon: <MessageCircleMore className="size-4" aria-hidden="true" />,
                link: { to: "/admin/ecommerce/agent", label: "配置创作助手" },
            },
            {
                key: "inspirationSourcesVisible",
                title: "素材来源署名",
                location: "创作首页 · 灵感",
                description: "显示灵感素材的来源说明和来源筛选。",
                icon: <Quote className="size-4" aria-hidden="true" />,
            },
        ],
    },
];

const allFeatureRows = featureGroups.flatMap((group) => group.rows.flatMap((row) => [row, ...(row.children || [])]));
const featureByKey = new Map(allFeatureRows.map((item) => [item.key, item]));
const parentByKey = new Map(allFeatureRows.flatMap((row) => (row.children || []).map((child) => [child.key, row.key] as const)));

type RowState = "on" | "off" | "partial" | "blocked";

function rowState(features: FeatureAvailability, row: FeatureRow): RowState {
    const parent = parentByKey.get(row.key);
    if (parent && !features[parent]) return "blocked";
    if (!features[row.key]) return "off";
    return unmetRequirements(features, row).length ? "partial" : "on";
}

function unmetRequirements(features: FeatureAvailability, row: FeatureRow) {
    return (row.requires || []).filter((requirement) => !features[requirement.key]);
}

function groupRows(group: FeatureGroup) {
    return group.rows.flatMap((row) => [row, ...(row.children || [])]);
}

function rowDomId(key: FeatureKey) {
    return `admin-feature-${key}`;
}

/** 依赖提示里的名称可点：滚到对应开关并聚焦，修改仍只在那一行完成。 */
function focusFeatureRow(key: FeatureKey) {
    const row = document.getElementById(rowDomId(key));
    if (!row) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
    row.querySelector<HTMLButtonElement>("button[role='switch']")?.focus({ preventScroll: true });
}

export default function FeatureAvailabilityPanel() {
    const { message, modal } = App.useApp();
    const setGlobalFeatures = useUserStore((state) => state.setFeatures);
    const [savedFeatures, setSavedFeatures] = useState<FeatureAvailability | null>(null);
    const [draftFeatures, setDraftFeatures] = useState<FeatureAvailability | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [savingKey, setSavingKey] = useState<FeatureKey | null>(null);
    const [loadError, setLoadError] = useState("");
    const [saveError, setSaveError] = useState("");
    const requestVersionRef = useRef(0);
    const saving = savingKey !== null;

    const load = useCallback(
        async (initial = false, announce = false) => {
            const requestVersion = ++requestVersionRef.current;
            if (initial) setLoading(true);
            else setRefreshing(true);
            setLoadError("");
            try {
                const result = await getAdminFeatureAvailability();
                const value = parseFeatureAvailability(result.features);
                if (requestVersion !== requestVersionRef.current) return;
                setSavedFeatures(value);
                setDraftFeatures(value);
                setGlobalFeatures(value);
                setSaveError("");
                if (announce) message.success("已重新读取当前功能状态");
            } catch (error) {
                if (requestVersion !== requestVersionRef.current) return;
                const errorMessage = error instanceof Error ? error.message : "读取功能开放配置失败";
                setLoadError(errorMessage);
                if (!initial) message.error(errorMessage);
            } finally {
                if (requestVersion === requestVersionRef.current) {
                    setLoading(false);
                    setRefreshing(false);
                }
            }
        },
        [message, setGlobalFeatures],
    );

    useEffect(() => {
        void load(true);
        return () => {
            requestVersionRef.current += 1;
        };
    }, [load]);

    const setFeature = async (key: FeatureKey, enabled: boolean) => {
        if (!savedFeatures || saving || savedFeatures[key] === enabled) return;
        const previous = savedFeatures;
        const expected = { ...savedFeatures, [key]: enabled };
        setDraftFeatures(expected);
        setSavingKey(key);
        setSaveError("");
        try {
            const result = await updateAdminFeatureAvailability(toEditablePayload(expected));
            const value = parseFeatureAvailability(result.features);
            if (!sameEditableFeatures(value, expected)) throw new Error("服务端返回的功能状态与本次保存内容不一致，请重新读取后核对");
            setSavedFeatures(value);
            setDraftFeatures(value);
            setGlobalFeatures(value);
            const title = key === "frontendModelsEnabled" ? "模型来源" : featureByKey.get(key)?.title || "功能";
            message.success(key === "frontendModelsEnabled" ? `${title}已切换为${enabled ? "前台模型目录" : "系统渠道"}` : `${title}已${enabled ? "开启" : "关闭"}，前台立即生效`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "保存功能开放配置失败";
            setDraftFeatures(previous);
            setSaveError(`${errorMessage}。已恢复修改前状态。`);
            message.error(errorMessage);
        } finally {
            setSavingKey(null);
        }
    };

    const requestFeatureChange = (key: FeatureKey, enabled: boolean) => {
        if (!savedFeatures || saving || savedFeatures[key] === enabled) return;
        if (key === "creditsEnabled" && !enabled) {
            modal.confirm({
                title: "关闭用户积分功能？",
                content: "保存后新创建的任务和系统渠道请求将不再扣减积分；已经冻结的计费订单仍按原规则结算，已有余额和流水继续保留。",
                okText: "确认关闭",
                cancelText: "取消",
                okButtonProps: { danger: true },
                onOk: () => setFeature(key, false),
            });
            return;
        }
        if (key === "frontendModelsEnabled" && !enabled) {
            modal.confirm({
                title: "关闭前台模型功能？",
                content: "关闭后用户将直接使用系统渠道中配置的模型。已有前台模型配置会保留，后台侧栏不再显示该入口，仍可从本页“配置前台模型”继续编辑；重新开启后即可继续使用。",
                okText: "确认关闭",
                cancelText: "取消",
                okButtonProps: { danger: true },
                onOk: () => setFeature(key, false),
            });
            return;
        }
        void setFeature(key, enabled);
    };

    if (loading && !draftFeatures) {
        return (
            <div className="admin-settings-stack admin-feature-availability afp" aria-label="正在读取功能开放配置" role="status">
                <div className="admin-feature-command-bar">
                    <Skeleton active title={{ width: 180 }} paragraph={false} />
                </div>
                {Array.from({ length: 3 }).map((_, index) => (
                    <div key={index} className="afp-group is-loading">
                        <Skeleton active title={{ width: 120 }} paragraph={{ rows: 3 }} />
                    </div>
                ))}
            </div>
        );
    }

    if (!draftFeatures || !savedFeatures) {
        return (
            <div className="admin-settings-stack admin-feature-availability afp">
                <div className="admin-feature-load-error" role="alert">
                    <span className="admin-feature-load-error-icon">
                        <AlertTriangle className="size-5" aria-hidden="true" />
                    </span>
                    <div>
                        <h2>无法读取功能开放配置</h2>
                        <p>{loadError || "当前没有可显示的配置，请稍后重试。"}</p>
                    </div>
                    <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void load(true)}>
                        重新读取
                    </Button>
                </div>
            </div>
        );
    }

    const states = allFeatureRows.map((row) => rowState(draftFeatures, row));
    const openCount = states.filter((state) => state === "on" || state === "partial").length;
    const partialCount = states.filter((state) => state === "partial").length;

    return (
        <div className="admin-settings-stack admin-feature-availability afp">
            <div className="admin-feature-command-bar">
                <div className="afp-command-copy" aria-live="polite">
                    <strong>{saving ? "正在保存…" : "切换即保存，前台立即生效"}</strong>
                    <AdminStatusBadge label={`${openCount} / ${allFeatureRows.length} 已开放`} tone="neutral" />
                    {partialCount ? <AdminStatusBadge label={`${partialCount} 项缺少依赖`} tone="warning" /> : null}
                    {!savedFeatures.configured ? <AdminStatusBadge label="系统默认" tone="neutral" /> : null}
                </div>
                <Button icon={<RefreshCw className="size-4" />} loading={refreshing} disabled={saving} onClick={() => void load(false, true)}>
                    刷新状态
                </Button>
            </div>

            {loadError || saveError ? (
                <div className="admin-feature-inline-alert" role="alert">
                    <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                    <span>{saveError || `${loadError}。页面仍显示上一次成功读取的状态。`}</span>
                </div>
            ) : null}

            {featureGroups.map((group) => {
                const rows = groupRows(group);
                const enabled = rows.filter((row) => draftFeatures[row.key] && rowState(draftFeatures, row) !== "blocked").length;
                return (
                    <section key={group.id} className="afp-group" aria-labelledby={`afp-group-${group.id}`}>
                        <header className="afp-group-header">
                            <span className="afp-group-icon">{group.icon}</span>
                            <div className="afp-group-copy">
                                <h2 id={`afp-group-${group.id}`}>{group.title}</h2>
                                <p>{group.description}</p>
                            </div>
                            <AdminStatusBadge label={`${enabled} / ${rows.length} 已开放`} tone={enabled === rows.length ? "success" : "neutral"} />
                        </header>
                        <div className="afp-list">
                            {group.id === "models" ? <ModelSourceRow draft={draftFeatures} saving={saving} onChange={requestFeatureChange} /> : null}
                            {group.rows.map((row) => (
                                <div key={row.key} className="afp-tree">
                                    <FeatureRowView row={row} draft={draftFeatures} savingKey={savingKey} onChange={requestFeatureChange} />
                                    {row.children?.map((child) => (
                                        <FeatureRowView key={child.key} row={child} draft={draftFeatures} savingKey={savingKey} onChange={requestFeatureChange} nested />
                                    ))}
                                </div>
                            ))}
                        </div>
                    </section>
                );
            })}
        </div>
    );
}

function FeatureRowView({ row, draft, savingKey, onChange, nested = false }: { row: FeatureRow; draft: FeatureAvailability; savingKey: FeatureKey | null; onChange: (key: FeatureKey, enabled: boolean) => void; nested?: boolean }) {
    const state = rowState(draft, row);
    const parentKey = parentByKey.get(row.key);
    const parentTitle = parentKey ? featureByKey.get(parentKey)?.title : "";
    const missing = state === "partial" ? unmetRequirements(draft, row) : [];
    const badge =
        state === "on" ? (
            <AdminStatusBadge label="已开放" tone="success" />
        ) : state === "partial" ? (
            <AdminStatusBadge label="缺少依赖" tone="warning" />
        ) : state === "blocked" ? (
            <AdminStatusBadge label={`需先开启${parentTitle}`} tone="neutral" />
        ) : (
            <AdminStatusBadge label="已关闭" tone="neutral" />
        );

    return (
        <article id={rowDomId(row.key)} className={cn("afp-row", nested && "is-nested", state === "off" && "is-off", state === "blocked" && "is-blocked")}>
            <div className="afp-row-main">
                {nested ? <CornerDownRight className="afp-row-branch size-4" aria-hidden="true" /> : null}
                <span className="afp-row-icon">{row.icon}</span>
                <div className="afp-row-copy">
                    <div className="afp-row-title">
                        <strong>{row.title}</strong>
                        <span className="afp-location">{row.location}</span>
                    </div>
                    <p>
                        {row.description}
                        {row.link ? (
                            <Link to={row.link.to} className="afp-link">
                                {row.link.label}
                                <ArrowUpRight className="size-3" aria-hidden="true" />
                            </Link>
                        ) : null}
                    </p>
                    {missing.map((requirement) => (
                        <p key={requirement.key} className="afp-row-warning">
                            <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
                            <span>
                                <button type="button" className="afp-dep-link" onClick={() => focusFeatureRow(requirement.key)}>
                                    {featureByKey.get(requirement.key)?.title}
                                </button>
                                未开启，{requirement.effect}
                            </span>
                        </p>
                    ))}
                </div>
            </div>
            <div className="afp-row-control">
                {badge}
                <Switch
                    // 上级关闭时子开关不生效，按关闭显示；保存的值不变，上级重新开启后恢复。
                    checked={state !== "blocked" && draft[row.key]}
                    loading={savingKey === row.key}
                    disabled={savingKey !== null || state === "blocked"}
                    onChange={(checked) => onChange(row.key, checked)}
                    aria-label={`${row.title}，切换后立即保存`}
                />
            </div>
        </article>
    );
}

function ModelSourceRow({ draft, saving, onChange }: { draft: FeatureAvailability; saving: boolean; onChange: (key: FeatureKey, enabled: boolean) => void }) {
    const options = [
        { value: false, label: "系统渠道" },
        { value: true, label: "前台模型目录" },
    ];
    return (
        <article id={rowDomId("frontendModelsEnabled")} className="afp-row">
            <div className="afp-row-main">
                <span className="afp-row-icon">
                    <Boxes className="size-4" aria-hidden="true" />
                </span>
                <div className="afp-row-copy">
                    <div className="afp-row-title">
                        <strong>模型来源</strong>
                        <span className="afp-location">所有模型选择器</span>
                    </div>
                    <p>
                        {draft.frontendModelsEnabled ? "用户只看到前台模型目录中整理过的模型。" : "用户直接选择系统渠道中启用的模型。"}
                        <Link to="/admin/models" className="afp-link">
                            配置前台模型
                            <ArrowUpRight className="size-3" aria-hidden="true" />
                        </Link>
                    </p>
                </div>
            </div>
            <div className="afp-row-control">
                <div className="afp-source" role="radiogroup" aria-label="选择用户模型来源">
                    {options.map((option) => (
                        <button
                            key={option.label}
                            type="button"
                            role="radio"
                            aria-checked={draft.frontendModelsEnabled === option.value}
                            disabled={saving}
                            className={cn(draft.frontendModelsEnabled === option.value && "is-selected")}
                            onClick={() => onChange("frontendModelsEnabled", option.value)}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
            </div>
        </article>
    );
}

function toEditablePayload(features: FeatureAvailability) {
    return {
        shortDramaEnabled: features.shortDramaEnabled,
        taskCenterEnabled: features.taskCenterEnabled,
        creditsEnabled: features.creditsEnabled,
        customChannelsEnabled: features.customChannelsEnabled,
        inspirationSourcesVisible: features.inspirationSourcesVisible,
        imageWorkbenchEnabled: features.imageWorkbenchEnabled,
        videoWorkbenchEnabled: features.videoWorkbenchEnabled,
        ecommerceEnabled: features.ecommerceEnabled,
        ecommerceVideoEnabled: features.ecommerceVideoEnabled,
        siteAssistantEnabled: features.siteAssistantEnabled,
        frontendModelsEnabled: features.frontendModelsEnabled,
        pluginCenterEnabled: features.pluginCenterEnabled,
        systemPluginsVisibleToUsers: features.systemPluginsVisibleToUsers,
    };
}

function sameEditableFeatures(left: FeatureAvailability, right: FeatureAvailability) {
    return editableFeatureKeys.every((key) => left[key] === right[key]);
}

function parseFeatureAvailability(value: unknown): FeatureAvailability {
    if (!value || typeof value !== "object") throw new Error("功能开放配置响应格式无效");
    const record = value as Record<string, unknown>;
    for (const key of editableFeatureKeys) {
        if (typeof record[key] !== "boolean") throw new Error("功能开放配置响应缺少有效开关状态");
    }
    return {
        welcomeEnabled: record.welcomeEnabled as boolean,
        shortDramaEnabled: record.shortDramaEnabled as boolean,
        taskCenterEnabled: record.taskCenterEnabled as boolean,
        creditsEnabled: record.creditsEnabled as boolean,
        customChannelsEnabled: record.customChannelsEnabled as boolean,
        inspirationSourcesVisible: record.inspirationSourcesVisible as boolean,
        imageWorkbenchEnabled: record.imageWorkbenchEnabled as boolean,
        videoWorkbenchEnabled: record.videoWorkbenchEnabled as boolean,
        ecommerceEnabled: record.ecommerceEnabled as boolean,
        ecommerceVideoEnabled: record.ecommerceVideoEnabled as boolean,
        siteAssistantEnabled: record.siteAssistantEnabled as boolean,
        frontendModelsEnabled: record.frontendModelsEnabled as boolean,
        pluginCenterEnabled: record.pluginCenterEnabled as boolean,
        systemPluginsVisibleToUsers: record.systemPluginsVisibleToUsers as boolean,
        configured: typeof record.configured === "boolean" ? record.configured : undefined,
        updatedBy: typeof record.updatedBy === "string" ? record.updatedBy : undefined,
        updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : undefined,
    };
}
