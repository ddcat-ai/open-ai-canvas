import { useEffect, useState, type ReactNode } from "react";
import { App, Switch } from "antd";
import { Clapperboard, Coins, ListChecks, PlugZap, RadioTower, ToggleLeft, Sparkles, Settings } from "lucide-react";

import { getAdminFeatureAvailability, updateAdminFeatureAvailability } from "@/services/api/auth";
import { useUserStore, type FeatureAvailability } from "@/stores/use-user-store";
import { SettingsSectionCard } from "./admin-ui";

type FeatureKey = "shortDramaEnabled" | "taskCenterEnabled" | "creditsEnabled" | "customChannelsEnabled" | "frontendModelsEnabled" | "pluginCenterEnabled" | "systemPluginsVisibleToUsers";

const userFeatureRows: Array<{ key: FeatureKey; title: string; menu: string; description: string; icon: ReactNode }> = [
    { key: "shortDramaEnabled", title: "短剧创作", menu: "/projects", description: "关闭后隐藏短剧入口，并拦截项目列表、详情和项目 API。已有项目数据不会删除。", icon: <Clapperboard className="size-4" /> },
    { key: "taskCenterEnabled", title: "任务", menu: "/tasks", description: "关闭后仅隐藏并拦截任务中心页面；生成任务仍会创建、执行、记录和恢复。", icon: <ListChecks className="size-4" /> },
    { key: "creditsEnabled", title: "积分中心", menu: "/wallet", description: "关闭后隐藏用户积分入口，新创建的任务和系统渠道请求不再冻结或消费积分。", icon: <Coins className="size-4" /> },
    { key: "customChannelsEnabled", title: "自定义渠道", menu: "/settings?section=channels", description: "关闭后隐藏用户自定义渠道入口，并拦截模型目录拉取、渠道中转和新的生成任务。已有渠道配置不会删除。", icon: <RadioTower className="size-4" /> },
    { key: "pluginCenterEnabled", title: "插件中心", menu: "/plugins", description: "关闭后普通用户无法进入插件中心或调用插件中心相关接口；管理员仍可进入后台恢复开关。已有插件不会删除。", icon: <PlugZap className="size-4" /> },
    { key: "systemPluginsVisibleToUsers", title: "向普通用户显示系统插件（不可编辑）", menu: "/plugins", description: "仅在插件中心开启时生效。关闭后普通用户看不到系统插件，用户插件不受影响。", icon: <PlugZap className="size-4" /> },
];

const adminFeatureRows: Array<{ key: FeatureKey; title: string; menu: string; description: string; icon: ReactNode }> = [
    { key: "frontendModelsEnabled", title: "前台模型", menu: "/admin/models", description: "关闭后用户直接使用系统渠道中的模型；后台仍保留前台模型配置入口，方便重新开启。已有配置不会删除。", icon: <Sparkles className="size-4" /> },
];

export default function FeatureAvailabilityPanel() {
    const { message, modal } = App.useApp();
    const setGlobalFeatures = useUserStore((state) => state.setFeatures);
    const [features, setFeatures] = useState<FeatureAvailability | null>(null);
    const [saving, setSaving] = useState<FeatureKey | null>(null);

    useEffect(() => {
        let active = true;
        getAdminFeatureAvailability()
            .then(({ features: value }) => {
                if (active) setFeatures(value);
            })
            .catch((error) => message.error(error instanceof Error ? error.message : "读取功能开放配置失败"));
        return () => {
            active = false;
        };
    }, [message]);

    const save = async (key: FeatureKey, enabled: boolean) => {
        if (!features) return;
        setSaving(key);
        try {
            const next = { ...features, [key]: enabled };
            const result = await updateAdminFeatureAvailability({
                shortDramaEnabled: next.shortDramaEnabled,
                taskCenterEnabled: next.taskCenterEnabled,
                creditsEnabled: next.creditsEnabled,
                customChannelsEnabled: next.customChannelsEnabled,
                frontendModelsEnabled: next.frontendModelsEnabled,
                pluginCenterEnabled: next.pluginCenterEnabled,
                systemPluginsVisibleToUsers: next.systemPluginsVisibleToUsers,
            });
            setFeatures(result.features);
            setGlobalFeatures(result.features);
            message.success(`${allFeatureRows.find((item) => item.key === key)?.title || "功能"}已${enabled ? "开放" : "关闭"}`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存功能开放配置失败");
        } finally {
            setSaving(null);
        }
    };

    const toggle = (key: FeatureKey, enabled: boolean) => {
        // 积分关闭需要二次确认
        if (key === "creditsEnabled" && !enabled) {
            modal.confirm({
                title: "关闭用户积分功能？",
                content: "保存后新创建的任务和系统渠道请求将不再扣减积分；已经冻结的计费订单仍按原规则结算，已有余额和流水继续保留。",
                okText: "确认关闭",
                cancelText: "取消",
                okButtonProps: { danger: true },
                onOk: () => save(key, false),
            });
            return;
        }
        // 前台模型关闭需要二次确认
        if (key === "frontendModelsEnabled" && !enabled) {
            modal.confirm({
                title: "关闭前台模型功能？",
                content: "关闭后用户将直接使用系统渠道中配置的模型；管理后台仍保留前台模型配置入口，重新开启后即可继续使用。",
                okText: "确认关闭",
                cancelText: "取消",
                okButtonProps: { danger: true },
                onOk: () => save(key, false),
            });
            return;
        }
        void save(key, enabled);
    };

    const allFeatureRows = [...userFeatureRows, ...adminFeatureRows];
    const userEnabledCount = features ? userFeatureRows.filter((item) => features[item.key]).length : 0;
    const adminEnabledCount = features ? adminFeatureRows.filter((item) => features[item.key]).length : 0;

    return (
        <div className="space-y-6 pt-4">
            <SettingsSectionCard
                icon={<ToggleLeft className="size-4" />}
                title="用户功能开放"
                status={{ label: features ? `${userEnabledCount}/${userFeatureRows.length} 已开放` : "读取中", color: userEnabledCount === userFeatureRows.length ? "success" : "default" }}
            >
                <div className="divide-y divide-border/75">
                    {userFeatureRows.map((item) => (
                        <div key={item.key} className="flex min-h-16 items-center gap-3 px-4 py-3">
                            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted/35 text-foreground/65">{item.icon}</span>
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <h3 className="text-sm font-medium">{item.title}</h3>
                                    <span className="rounded border border-border/70 px-1.5 py-0.5 text-[var(--fs-micro)] text-foreground/45">{item.menu}</span>
                                </div>
                            </div>
                            <Switch checked={features?.[item.key] === true} loading={!features || saving === item.key} disabled={Boolean(saving && saving !== item.key) || (item.key === "systemPluginsVisibleToUsers" && features?.pluginCenterEnabled !== true)} onChange={(checked) => toggle(item.key, checked)} aria-label={`开放${item.title}`} />
                        </div>
                    ))}
                </div>
            </SettingsSectionCard>

            <SettingsSectionCard
                icon={<Settings className="size-4" />}
                title="管理后台功能"
                status={{ label: features ? `${adminEnabledCount}/${adminFeatureRows.length} 已开放` : "读取中", color: adminEnabledCount === adminFeatureRows.length ? "success" : "default" }}
            >
                <div className="divide-y divide-border/75">
                    {adminFeatureRows.map((item) => (
                        <div key={item.key} className="flex min-h-16 items-center gap-3 px-4 py-3">
                            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted/35 text-foreground/65">{item.icon}</span>
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <h3 className="text-sm font-medium">{item.title}</h3>
                                    <span className="rounded border border-border/70 px-1.5 py-0.5 text-[var(--fs-micro)] text-foreground/45">{item.menu}</span>
                                </div>
                            </div>
                            <Switch checked={features?.[item.key] === true} loading={!features || saving === item.key} disabled={Boolean(saving && saving !== item.key)} onChange={(checked) => toggle(item.key, checked)} aria-label={`开放${item.title}`} />
                        </div>
                    ))}
                </div>
            </SettingsSectionCard>
        </div>
    );
}
