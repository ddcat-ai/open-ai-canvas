import { useEffect, useState, type ReactNode } from "react";
import { Button } from "antd";
import { useNavigate } from "react-router";

import { WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceErrorState, WorkspaceLoadingState, WorkspaceState } from "@/components/layout/workspace-state";
import { refreshFeatureAvailability } from "@/lib/user-session";
import { useUserStore } from "@/stores/use-user-store";
import { useTranslation } from "react-i18next";

type FeatureKey = "shortDramaEnabled" | "taskCenterEnabled" | "creditsEnabled" | "frontendModelsEnabled" | "pluginCenterEnabled";

const featureNameKeys: Record<FeatureKey, string> = {
    shortDramaEnabled: "domain:short-drama-creation",
    taskCenterEnabled: "domain:task-center",
    creditsEnabled: "domain:credits-center",
    frontendModelsEnabled: "domain:frontend-models",
    pluginCenterEnabled: "domain:plugins-center",
};

let featureAvailabilityCheckedOnce = false;

export function RequireFeature({ feature, children }: { feature: FeatureKey; children: ReactNode }) {
    const { t } = useTranslation(["canvas", "domain"]);
    const navigate = useNavigate();
    const user = useUserStore((state) => state.user);
    const features = useUserStore((state) => state.features);
    const adminBypass = feature === "pluginCenterEnabled" && user?.role === "admin";
    const [checking, setChecking] = useState(() => !adminBypass && !useUserStore.getState().features[feature]);
    const [error, setError] = useState("");
    const featureName = t(featureNameKeys[feature]);

    useEffect(() => {
        if (featureAvailabilityCheckedOnce) return;
        featureAvailabilityCheckedOnce = true;
        let cancelled = false;
        setError("");
        refreshFeatureAvailability()
            .catch((reason) => {
                if (!cancelled) setError(reason instanceof Error ? reason.message : t("domain:failed-to-load-feature-availability"));
            })
            .finally(() => {
                if (!cancelled) setChecking(false);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    if (checking)
        return (
            <WorkspacePage>
                <WorkspaceLoadingState label={t("domain:confirming-feature-status")} detail={featureName} rows={3} />
            </WorkspacePage>
        );
    if (error)
        return (
            <WorkspacePage>
                <WorkspaceErrorState title={t("domain:unable-to-confirm-feature-status")} description={error} actionLabel={t("domain:back-to-studio")} onRetry={() => navigate("/create", { replace: true })} />
            </WorkspacePage>
        );
    if (!adminBypass && !features[feature]) {
        // 管理员页面返回到管理后台首页，用户页面返回到创作台
        const isAdminFeature = feature === "frontendModelsEnabled" || (feature === "pluginCenterEnabled" && user?.role === "admin");
        const backPath = isAdminFeature ? "/admin" : "/create";
        const backLabel = isAdminFeature ? t("domain:back-to-admin-console") : t("domain:back-to-studio");

        return (
            <WorkspacePage>
                <WorkspaceState
                    icon="empty"
                    title={t("domain:feature-name-not-yet-open", { name: featureName })}
                    description={t("domain:this-feature-has-been-disabled-by-platform-administrators")}
                    action={
                        <Button type="primary" onClick={() => navigate(backPath, { replace: true })}>
                            {backLabel}
                        </Button>
                    }
                />
            </WorkspacePage>
        );
    }
    return children;
}
