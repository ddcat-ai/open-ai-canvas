import { useEffect, useState, type ReactNode } from "react";
import { Button } from "antd";
import { useNavigate } from "react-router";

import { WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceErrorState, WorkspaceLoadingState, WorkspaceState } from "@/components/layout/workspace-state";
import { refreshFeatureAvailability } from "@/lib/user-session";
import { useUserStore } from "@/stores/use-user-store";

type FeatureKey = "shortDramaEnabled" | "taskCenterEnabled" | "creditsEnabled" | "frontendModelsEnabled" | "pluginCenterEnabled";

const featureNames: Record<FeatureKey, string> = {
    shortDramaEnabled: "短剧创作",
    taskCenterEnabled: "任务中心",
    creditsEnabled: "积分中心",
    frontendModelsEnabled: "前台模型",
    pluginCenterEnabled: "插件中心",
};

let featureAvailabilityCheckedOnce = false;

export function RequireFeature({ feature, children }: { feature: FeatureKey; children: ReactNode }) {
    const navigate = useNavigate();
    const user = useUserStore((state) => state.user);
    const features = useUserStore((state) => state.features);
    const adminBypass = feature === "pluginCenterEnabled" && user?.role === "admin";
    const [checking, setChecking] = useState(() => !adminBypass && !useUserStore.getState().features[feature]);
    const [error, setError] = useState("");

    useEffect(() => {
        if (featureAvailabilityCheckedOnce) return;
        featureAvailabilityCheckedOnce = true;
        let cancelled = false;
        setError("");
        refreshFeatureAvailability()
            .catch((reason) => {
                if (!cancelled) setError(reason instanceof Error ? reason.message : "读取功能开放状态失败");
            })
            .finally(() => {
                if (!cancelled) setChecking(false);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    if (checking) return <WorkspacePage><WorkspaceLoadingState label="正在确认功能状态" detail={featureNames[feature]} rows={3} /></WorkspacePage>;
    if (error) return <WorkspacePage><WorkspaceErrorState title="无法确认功能状态" description={error} actionLabel="返回创作台" onRetry={() => navigate("/create", { replace: true })} /></WorkspacePage>;
    if (!adminBypass && !features[feature]) {
        // 管理员页面返回到管理后台首页，用户页面返回到创作台
        const isAdminFeature = feature === "frontendModelsEnabled" || (feature === "pluginCenterEnabled" && user?.role === "admin");
        const backPath = isAdminFeature ? "/admin" : "/create";
        const backLabel = isAdminFeature ? "返回管理后台" : "返回创作台";

        return (
            <WorkspacePage>
                <WorkspaceState icon="empty" title={`${featureNames[feature]}暂未开放`} description="当前功能已由平台管理员关闭。" action={<Button type="primary" onClick={() => navigate(backPath, { replace: true })}>{backLabel}</Button>} />
            </WorkspacePage>
        );
    }
    return children;
}
