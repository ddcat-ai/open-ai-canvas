import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { App, Button, Skeleton, Switch } from "antd";
import { AlertTriangle, Clapperboard, Coins, ListChecks, LockKeyhole, MonitorCog, PlugZap, RadioTower, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import { getAdminFeatureAvailability, updateAdminFeatureAvailability } from "@/services/api/auth";
import { useUserStore, type FeatureAvailability } from "@/stores/use-user-store";
import { useAdminContext } from "../admin-context";
import { AdminStatusBadge } from "./admin-ui";

type FeatureKey = "shortDramaEnabled" | "taskCenterEnabled" | "creditsEnabled" | "customChannelsEnabled" | "frontendModelsEnabled" | "pluginCenterEnabled" | "systemPluginsVisibleToUsers";
type FeatureSelectionKey = FeatureKey | "desktopLocalChannelsEnabled";

type FeatureRow = {
    key: FeatureKey;
    title: string;
    eyebrow: string;
    description: string;
    enabledImpact: string;
    disabledImpact: string;
    icon: ReactNode;
    dependsOn?: FeatureKey;
};

const editableFeatureKeys: FeatureKey[] = ["shortDramaEnabled", "taskCenterEnabled", "creditsEnabled", "customChannelsEnabled", "frontendModelsEnabled", "pluginCenterEnabled", "systemPluginsVisibleToUsers"];

const workspaceFeatureRows: FeatureRow[] = [
    {
        key: "shortDramaEnabled",
        title: "短剧创作",
        eyebrow: "项目与短剧入口",
        description: "控制短剧入口、项目列表、项目详情和项目接口。关闭不会删除已有项目数据。",
        enabledImpact: "普通用户可以继续进入短剧与项目工作区。",
        disabledImpact: "隐藏短剧入口并拦截项目列表、详情和项目接口，已有数据保留。",
        icon: <Clapperboard className="size-4" aria-hidden="true" />,
    },
    {
        key: "taskCenterEnabled",
        title: "任务中心",
        eyebrow: "任务记录入口",
        description: "控制任务中心页面是否可见；生成任务本身仍会创建、执行、记录和恢复。",
        enabledImpact: "普通用户可以查看任务中心和任务记录。",
        disabledImpact: "隐藏并拦截任务中心页面，但不会停止生成任务。",
        icon: <ListChecks className="size-4" aria-hidden="true" />,
    },
    {
        key: "creditsEnabled",
        title: "积分计费",
        eyebrow: "钱包与计费模式",
        description: "控制积分入口以及新任务、系统渠道请求是否冻结和消费积分。已有余额与流水保留。",
        enabledImpact: "新任务和系统渠道请求继续按积分规则预授权与结算。",
        disabledImpact: "隐藏积分入口，新任务和系统渠道请求不再冻结或消费积分；既有订单仍按原规则结算。",
        icon: <Coins className="size-4" aria-hidden="true" />,
    },
    {
        key: "customChannelsEnabled",
        title: "自定义渠道",
        eyebrow: "用户渠道能力",
        description: "控制用户自定义渠道入口、模型目录拉取、渠道中转和使用自定义渠道创建新任务。",
        enabledImpact: "普通用户可以配置并使用自己的模型渠道。",
        disabledImpact: "隐藏渠道入口并拦截自定义渠道中转与新任务，已有渠道配置保留。",
        icon: <RadioTower className="size-4" aria-hidden="true" />,
    },
];

const pluginFeatureRows: FeatureRow[] = [
    {
        key: "pluginCenterEnabled",
        title: "插件中心",
        eyebrow: "用户插件入口",
        description: "控制普通用户进入插件中心及调用插件中心接口；管理员仍可从后台恢复开关。",
        enabledImpact: "普通用户可以进入插件中心并使用允许的插件。",
        disabledImpact: "普通用户无法进入或调用插件中心，已有插件与配置不会删除。",
        icon: <PlugZap className="size-4" aria-hidden="true" />,
    },
    {
        key: "systemPluginsVisibleToUsers",
        title: "系统插件可见性",
        eyebrow: "插件内容范围",
        description: "控制协议类系统插件和管理员上传插件是否向普通用户展示；官方应用仍可由用户启用。",
        enabledImpact: "普通用户可以看到系统协议插件和管理员上传插件。",
        disabledImpact: "普通用户只看到官方应用插件，系统协议与管理员上传插件隐藏。",
        icon: <ShieldCheck className="size-4" aria-hidden="true" />,
        dependsOn: "pluginCenterEnabled",
    },
];

const modelFeatureRows: FeatureRow[] = [
    {
        key: "frontendModelsEnabled",
        title: "前台模型目录",
        eyebrow: "用户模型来源",
        description: "开启后使用前台模型目录；关闭后直接使用系统渠道中的模型。已有前台模型配置不会删除。",
        enabledImpact: "用户模型选择使用前台模型目录与对应线路。",
        disabledImpact: "用户直接使用系统渠道模型，后台前台模型配置保留但入口隐藏。",
        icon: <Sparkles className="size-4" aria-hidden="true" />,
    },
];

const allFeatureRows = [...workspaceFeatureRows, ...pluginFeatureRows, ...modelFeatureRows];
const featureByKey = new Map(allFeatureRows.map((item) => [item.key, item]));

export default function FeatureAvailabilityPanel() {
    const { message } = App.useApp();
    const { references } = useAdminContext();
    const setGlobalFeatures = useUserStore((state) => state.setFeatures);
    const [savedFeatures, setSavedFeatures] = useState<FeatureAvailability | null>(null);
    const [draftFeatures, setDraftFeatures] = useState<FeatureAvailability | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [loadError, setLoadError] = useState("");
    const [saveError, setSaveError] = useState("");
    const [selectedFeatureKey, setSelectedFeatureKey] = useState<FeatureSelectionKey>("shortDramaEnabled");
    const requestVersionRef = useRef(0);
    const userNameById = useMemo(() => new Map(references.users.map((user) => [user.id, user.displayName || user.username])), [references.users]);

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
        setSaving(true);
        setSaveError("");
        try {
            const result = await updateAdminFeatureAvailability(toEditablePayload(expected));
            const value = parseFeatureAvailability(result.features);
            if (!sameEditableFeatures(value, expected)) throw new Error("服务端返回的功能状态与本次保存内容不一致，请重新读取后核对");
            setSavedFeatures(value);
            setDraftFeatures(value);
            setGlobalFeatures(value);
            message.success(`${featureByKey.get(key)?.title || "功能"}已${enabled ? "开启" : "关闭"}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "保存功能开放配置失败";
            setDraftFeatures(previous);
            setSaveError(`${errorMessage}。已恢复修改前状态。`);
            message.error(errorMessage);
        } finally {
            setSaving(false);
        }
    };

    if (loading && !draftFeatures) {
        return (
            <div className="admin-settings-stack admin-feature-availability" aria-label="正在读取功能开放配置" role="status">
                <div className="admin-feature-command-bar">
                    <Skeleton active title={{ width: 180 }} paragraph={false} />
                </div>
                <div className="admin-feature-board is-loading">
                    {Array.from({ length: 3 }).map((_, index) => (
                        <div key={index} className="admin-feature-domain">
                            <Skeleton active title={{ width: 120 }} paragraph={{ rows: 3 }} />
                        </div>
                    ))}
                </div>
                <div className="admin-feature-loading-card">
                    <Skeleton active paragraph={{ rows: 2 }} />
                </div>
            </div>
        );
    }

    if (!draftFeatures || !savedFeatures) {
        return (
            <div className="admin-settings-stack admin-feature-availability">
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

    const enabledWorkspaceFeatures = workspaceFeatureRows.filter((row) => effectiveFeatureValue(draftFeatures, row.key)).length;
    const enabledPluginFeatures = pluginFeatureRows.filter((row) => effectiveFeatureValue(draftFeatures, row.key)).length;
    const updateActor = savedFeatures.updatedBy ? userNameById.get(savedFeatures.updatedBy) || savedFeatures.updatedBy : "";
    const updateDetail = savedFeatures.configured ? `${formatTime(savedFeatures.updatedAt)}${updateActor ? ` · ${updateActor}` : ""}` : "尚未由管理员保存，使用系统默认值";

    return (
        <div className="admin-settings-stack admin-feature-availability">
            <div className="admin-feature-command-bar">
                <div className="admin-feature-command-copy" aria-live="polite">
                    <span className="admin-feature-command-icon">
                        <ShieldCheck className="size-4" aria-hidden="true" />
                    </span>
                    <div>
                        <div className="flex flex-wrap items-center gap-2">
                            <strong>{saving ? "正在保存功能状态" : "功能状态已同步"}</strong>
                            <AdminStatusBadge label={saving ? "提交中" : savedFeatures.configured ? "已保存配置" : "系统默认"} tone={saving ? "warning" : savedFeatures.configured ? "success" : "neutral"} />
                        </div>
                        <p>{saving ? "正在写入服务端，请稍候。" : `配置记录：${updateDetail}。开关与模型来源切换后会立即保存。`}</p>
                    </div>
                </div>
                <div className="admin-feature-command-actions">
                    <Button icon={<RefreshCw className="size-4" />} loading={refreshing} disabled={saving} onClick={() => void load(false, true)}>
                        刷新状态
                    </Button>
                </div>
            </div>

            {loadError || saveError ? (
                <div className="admin-feature-inline-alert" role="alert">
                    <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                    <span>{saveError || `${loadError}。页面仍显示上一次成功读取的状态。`}</span>
                </div>
            ) : null}

            <div className="admin-feature-board" aria-label="功能开放控制台">
                <FeatureDomainPanel
                    compact
                    title="用户工作台"
                    description="入口与对应服务能力"
                    icon={<MonitorCog className="size-4" aria-hidden="true" />}
                    status={<AdminStatusBadge label={`${enabledWorkspaceFeatures}/4 开放`} tone={enabledWorkspaceFeatures === 4 ? "success" : "neutral"} />}
                >
                    {workspaceFeatureRows.map((row) => (
                        <FeatureBoardToggleRow key={row.key} row={row} saved={savedFeatures} draft={draftFeatures} saving={saving} selected={selectedFeatureKey === row.key} onSelect={setSelectedFeatureKey} onChange={setFeature} />
                    ))}
                </FeatureDomainPanel>

                <FeatureDomainPanel
                    title="插件策略"
                    description="先开放入口，再限定范围"
                    icon={<PlugZap className="size-4" aria-hidden="true" />}
                    status={<AdminStatusBadge label={`${enabledPluginFeatures}/2 生效`} tone={enabledPluginFeatures === 2 ? "success" : "neutral"} />}
                >
                    {pluginFeatureRows.map((row, index) => (
                        <FeatureBoardToggleRow key={row.key} row={row} saved={savedFeatures} draft={draftFeatures} saving={saving} selected={selectedFeatureKey === row.key} onSelect={setSelectedFeatureKey} onChange={setFeature} step={index + 1} />
                    ))}
                </FeatureDomainPanel>

                <FeatureDomainPanel
                    title="模型与环境"
                    description="模型路径与部署能力"
                    icon={<Sparkles className="size-4" aria-hidden="true" />}
                    status={<AdminStatusBadge label={draftFeatures.frontendModelsEnabled ? "前台模型目录" : "系统渠道"} tone="info" />}
                >
                    <FeatureBoardSourceRow row={modelFeatureRows[0]} saved={savedFeatures} draft={draftFeatures} saving={saving} selected={selectedFeatureKey === "frontendModelsEnabled"} onSelect={setSelectedFeatureKey} onChange={setFeature} />
                    <FeatureBoardRuntimeRow enabled={draftFeatures.desktopLocalChannelsEnabled} selected={selectedFeatureKey === "desktopLocalChannelsEnabled"} onSelect={setSelectedFeatureKey} />
                </FeatureDomainPanel>
            </div>

            <FeatureDetailPanel selection={selectedFeatureKey} saved={savedFeatures} draft={draftFeatures} />
        </div>
    );
}

function FeatureDomainPanel({ title, description, icon, status, children, compact = false }: { title: string; description: string; icon: ReactNode; status: ReactNode; children: ReactNode; compact?: boolean }) {
    return (
        <section className={cn("admin-feature-domain", compact && "is-compact")}>
            <header className="admin-feature-domain-header">
                <span className="admin-feature-domain-icon">{icon}</span>
                <div className="admin-feature-domain-copy min-w-0 flex-1">
                    <h2>{title}</h2>
                    <p>{description}</p>
                </div>
                <div className="admin-feature-domain-status">{status}</div>
            </header>
            <div className="admin-feature-domain-list">{children}</div>
        </section>
    );
}

function FeatureBoardToggleRow({
    row,
    saved,
    draft,
    saving,
    selected,
    onSelect,
    onChange,
    step,
}: {
    row: FeatureRow;
    saved: FeatureAvailability;
    draft: FeatureAvailability;
    saving: boolean;
    selected: boolean;
    onSelect: (key: FeatureSelectionKey) => void;
    onChange: (key: FeatureKey, enabled: boolean) => void;
    step?: number;
}) {
    const changed = saved[row.key] !== draft[row.key];
    const dependencyDisabled = Boolean(row.dependsOn && !draft[row.dependsOn]);
    const enabled = effectiveFeatureValue(draft, row.key);

    return (
        <article className={cn("admin-feature-board-row", selected && "is-selected", changed && "is-dirty", !enabled && "is-off", row.dependsOn && "is-dependent")}>
            <button type="button" className="admin-feature-board-row-select" aria-pressed={selected} aria-controls="admin-feature-detail" onClick={() => onSelect(row.key)}>
                <span className="admin-feature-board-row-icon">{row.icon}</span>
                <span className="admin-feature-board-row-name">
                    {step ? <small>第 {step} 步</small> : null}
                    <strong>{row.title}</strong>
                </span>
                {changed ? <span className="admin-feature-board-row-dirty">待保存</span> : null}
            </button>
            <div className="admin-feature-board-row-control" onFocusCapture={() => onSelect(row.key)}>
                {dependencyDisabled ? <span>未生效</span> : null}
                <Switch
                    checked={draft[row.key]}
                    disabled={saving || dependencyDisabled}
                    onChange={(checked) => {
                        onSelect(row.key);
                        onChange(row.key, checked);
                    }}
                    aria-label={`设置${row.title}，切换后立即保存`}
                />
            </div>
        </article>
    );
}

function FeatureBoardSourceRow({
    row,
    saved,
    draft,
    saving,
    selected,
    onSelect,
    onChange,
}: {
    row: FeatureRow;
    saved: FeatureAvailability;
    draft: FeatureAvailability;
    saving: boolean;
    selected: boolean;
    onSelect: (key: FeatureSelectionKey) => void;
    onChange: (key: FeatureKey, enabled: boolean) => void;
}) {
    const changed = saved.frontendModelsEnabled !== draft.frontendModelsEnabled;
    return (
        <article className={cn("admin-feature-board-row is-source", selected && "is-selected", changed && "is-dirty")}>
            <button type="button" className="admin-feature-board-row-select" aria-pressed={selected} aria-controls="admin-feature-detail" onClick={() => onSelect(row.key)}>
                <span className="admin-feature-board-row-icon">{row.icon}</span>
                <span className="admin-feature-board-row-name">
                    <small>模型来源</small>
                    <strong>用户模型目录</strong>
                </span>
                {changed ? <span className="admin-feature-board-row-dirty">待保存</span> : null}
            </button>
            <div className="admin-feature-board-source-selector" role="radiogroup" aria-label="选择用户模型目录来源">
                <button
                    type="button"
                    role="radio"
                    aria-checked={!draft.frontendModelsEnabled}
                    disabled={saving}
                    className={cn(!draft.frontendModelsEnabled && "is-selected")}
                    onClick={() => {
                        onSelect("frontendModelsEnabled");
                        onChange("frontendModelsEnabled", false);
                    }}
                >
                    系统渠道
                </button>
                <button
                    type="button"
                    role="radio"
                    aria-checked={draft.frontendModelsEnabled}
                    disabled={saving}
                    className={cn(draft.frontendModelsEnabled && "is-selected")}
                    onClick={() => {
                        onSelect("frontendModelsEnabled");
                        onChange("frontendModelsEnabled", true);
                    }}
                >
                    前台目录
                </button>
            </div>
        </article>
    );
}

function FeatureBoardRuntimeRow({ enabled, selected, onSelect }: { enabled: boolean; selected: boolean; onSelect: (key: FeatureSelectionKey) => void }) {
    return (
        <article className={cn("admin-feature-board-row is-readonly", selected && "is-selected")}>
            <button type="button" className="admin-feature-board-row-select" aria-pressed={selected} aria-controls="admin-feature-detail" onClick={() => onSelect("desktopLocalChannelsEnabled")}>
                <span className="admin-feature-board-row-icon">
                    <LockKeyhole className="size-4" aria-hidden="true" />
                </span>
                <span className="admin-feature-board-row-name">
                    <small>部署能力 · 只读</small>
                    <strong>桌面本地渠道</strong>
                </span>
            </button>
            <div className="admin-feature-board-runtime-status">
                <AdminStatusBadge label={enabled ? "已启用" : "未启用"} tone={enabled ? "success" : "neutral"} />
                <span>只读</span>
            </div>
        </article>
    );
}

function FeatureDetailPanel({ selection, saved, draft }: { selection: FeatureSelectionKey; saved: FeatureAvailability; draft: FeatureAvailability }) {
    if (selection === "desktopLocalChannelsEnabled") {
        const enabled = draft.desktopLocalChannelsEnabled;
        return (
            <section id="admin-feature-detail" className="admin-feature-detail" aria-live="polite">
                <FeatureDetailHeader
                    icon={<LockKeyhole className="size-4" aria-hidden="true" />}
                    eyebrow="部署环境能力 · 只读"
                    title="桌面本地渠道"
                    status={<AdminStatusBadge label={enabled ? "环境已启用" : "环境未启用"} tone={enabled ? "success" : "neutral"} />}
                />
                <div className="admin-feature-detail-grid">
                    <FeatureDetailCell label="当前状态" value={enabled ? "当前部署可以使用桌面本地渠道。" : "当前部署不能使用桌面本地渠道。"} />
                    <FeatureDetailCell label="能力来源" value="由后端运行环境决定，不能通过管理页面修改。" />
                    <FeatureDetailCell label="保存关系" value="这是只读运行状态，不包含在本次功能配置保存请求中。" />
                </div>
            </section>
        );
    }

    const row = featureByKey.get(selection)!;
    const changed = saved[row.key] !== draft[row.key];
    const dependencyDisabled = Boolean(row.dependsOn && !draft[row.dependsOn]);
    const effective = effectiveFeatureValue(draft, row.key);
    const currentImpact = dependencyDisabled ? "插件中心关闭时，此项保留偏好但当前不生效。" : draft[row.key] ? row.enabledImpact : row.disabledImpact;
    const alternateImpact = draft[row.key] ? row.disabledImpact : row.enabledImpact;
    const statusLabel = row.key === "frontendModelsEnabled" ? (draft.frontendModelsEnabled ? "前台模型目录" : "系统渠道") : dependencyDisabled ? "依赖未生效" : effective ? "开放" : "关闭";
    const alternateLabel = row.key === "frontendModelsEnabled" ? "切换来源后" : draft[row.key] ? "关闭后" : "开放后";

    return (
        <section id="admin-feature-detail" className={cn("admin-feature-detail", changed && "is-dirty")} aria-live="polite">
            <FeatureDetailHeader
                icon={row.icon}
                eyebrow={row.eyebrow}
                title={row.key === "frontendModelsEnabled" ? "用户模型目录来源" : row.title}
                status={
                    <div className="flex items-center gap-2">
                        {changed ? <AdminStatusBadge label="待保存" tone="warning" /> : null}
                        <AdminStatusBadge label={statusLabel} tone={dependencyDisabled ? "warning" : effective ? "success" : "neutral"} />
                    </div>
                }
            />
            <div className="admin-feature-detail-grid">
                <FeatureDetailCell label={dependencyDisabled ? "当前依赖" : row.key === "frontendModelsEnabled" ? "当前来源" : "当前效果"} value={currentImpact} tone={dependencyDisabled ? "warning" : undefined} />
                <FeatureDetailCell label="控制范围" value={row.description} />
                <FeatureDetailCell label={alternateLabel} value={alternateImpact} />
            </div>
        </section>
    );
}

function FeatureDetailHeader({ icon, eyebrow, title, status }: { icon: ReactNode; eyebrow: string; title: string; status: ReactNode }) {
    return (
        <header className="admin-feature-detail-header">
            <span className="admin-feature-detail-icon">{icon}</span>
            <div className="min-w-0 flex-1">
                <p>{eyebrow}</p>
                <h2>{title}</h2>
            </div>
            {status}
        </header>
    );
}

function FeatureDetailCell({ label, value, tone }: { label: string; value: string; tone?: "warning" }) {
    return (
        <div className={cn("admin-feature-detail-cell", tone && `is-${tone}`)}>
            <span>{label}</span>
            <p>{value}</p>
        </div>
    );
}

function effectiveFeatureValue(features: FeatureAvailability, key: FeatureKey) {
    if (key === "systemPluginsVisibleToUsers") return features.pluginCenterEnabled && features.systemPluginsVisibleToUsers;
    return features[key];
}

function toEditablePayload(features: FeatureAvailability) {
    return {
        shortDramaEnabled: features.shortDramaEnabled,
        taskCenterEnabled: features.taskCenterEnabled,
        creditsEnabled: features.creditsEnabled,
        customChannelsEnabled: features.customChannelsEnabled,
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
        shortDramaEnabled: record.shortDramaEnabled as boolean,
        taskCenterEnabled: record.taskCenterEnabled as boolean,
        creditsEnabled: record.creditsEnabled as boolean,
        customChannelsEnabled: record.customChannelsEnabled as boolean,
        frontendModelsEnabled: record.frontendModelsEnabled as boolean,
        pluginCenterEnabled: record.pluginCenterEnabled as boolean,
        systemPluginsVisibleToUsers: record.systemPluginsVisibleToUsers as boolean,
        desktopLocalChannelsEnabled: record.desktopLocalChannelsEnabled === true,
        configured: typeof record.configured === "boolean" ? record.configured : undefined,
        updatedBy: typeof record.updatedBy === "string" ? record.updatedBy : undefined,
        updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : undefined,
    };
}

function formatTime(value?: string) {
    if (!value) return "更新时间未知";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "更新时间未知";
    return date.toLocaleString("zh-CN", { hour12: false });
}
