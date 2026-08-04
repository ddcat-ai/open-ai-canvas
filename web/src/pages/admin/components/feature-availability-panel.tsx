import { useEffect, useState, type ReactNode } from "react";
import { App, Switch } from "antd";
import { Clapperboard, Coins, ListChecks, ToggleLeft } from "lucide-react";

import { getAdminFeatureAvailability, updateAdminFeatureAvailability } from "@/services/api/auth";
import { useUserStore, type FeatureAvailability } from "@/stores/use-user-store";
import { SettingsSectionCard } from "./admin-ui";

type FeatureKey = "shortDramaEnabled" | "taskCenterEnabled" | "creditsEnabled";

const featureRows: Array<{ key: FeatureKey; title: string; menu: string; description: string; icon: ReactNode }> = [
    { key: "shortDramaEnabled", title: "短剧创作", menu: "/projects", description: "关闭后隐藏短剧入口，并拦截项目列表、详情和项目 API。已有项目数据不会删除。", icon: <Clapperboard className="size-4" /> },
    { key: "taskCenterEnabled", title: "任务", menu: "/tasks", description: "关闭后仅隐藏并拦截任务中心页面；生成任务仍会创建、执行、记录和恢复。", icon: <ListChecks className="size-4" /> },
    { key: "creditsEnabled", title: "积分中心", menu: "/wallet", description: "关闭后隐藏用户积分入口，新创建的任务和系统渠道请求不再冻结或消费积分。", icon: <Coins className="size-4" /> },
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
            });
            setFeatures(result.features);
            setGlobalFeatures(result.features);
            message.success(`${featureRows.find((item) => item.key === key)?.title || "功能"}已${enabled ? "开放" : "关闭"}`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存功能开放配置失败");
        } finally {
            setSaving(null);
        }
    };

    const toggle = (key: FeatureKey, enabled: boolean) => {
        if (key !== "creditsEnabled" || enabled) {
            void save(key, enabled);
            return;
        }
        modal.confirm({
            title: "关闭用户积分功能？",
            content: "保存后新创建的任务和系统渠道请求将不再扣减积分；已经冻结的计费订单仍按原规则结算，已有余额和流水继续保留。",
            okText: "确认关闭",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: () => save(key, false),
        });
    };

    const enabledCount = features ? featureRows.filter((item) => features[item.key]).length : 0;
    return (
        <div className="pt-4">
            <SettingsSectionCard
                icon={<ToggleLeft className="size-4" />}
                title="用户功能开放"
                description="统一控制用户工作台入口、页面访问和积分消费策略。"
                status={{ label: features ? `${enabledCount}/${featureRows.length} 已开放` : "读取中", color: enabledCount === featureRows.length ? "success" : "default" }}
            >
                <div className="divide-y divide-border/75">
                    {featureRows.map((item) => (
                        <div key={item.key} className="flex min-h-16 items-center gap-3 px-4 py-3">
                            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted/35 text-foreground/65">{item.icon}</span>
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <h3 className="text-sm font-medium">{item.title}</h3>
                                    <span className="rounded border border-border/70 px-1.5 py-0.5 text-[var(--fs-micro)] text-foreground/45">{item.menu}</span>
                                </div>
                                <p className="mt-1 text-xs leading-5 text-foreground/55">{item.description}</p>
                            </div>
                            <Switch checked={features?.[item.key] === true} loading={!features || saving === item.key} disabled={Boolean(saving && saving !== item.key)} onChange={(checked) => toggle(item.key, checked)} aria-label={`开放${item.title}`} />
                        </div>
                    ))}
                </div>
            </SettingsSectionCard>
        </div>
    );
}
