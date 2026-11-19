import { type ReactNode } from "react";

type FeatureKey = "shortDramaEnabled" | "taskCenterEnabled" | "creditsEnabled" | "frontendModelsEnabled" | "pluginCenterEnabled" | "imageWorkbenchEnabled" | "videoWorkbenchEnabled";

/**
 * DMC C 端免登录：功能开放状态由产品本身决定，不再向后端管理员开关查询。
 *
 * 原实现会调 refreshFeatureAvailability()，未登录时返回 401，
 * 把「我的片子 / 生图 / 视频工作台」变成错误页。这里直接放行，
 * 保留 FeatureKey 类型以兼容现有路由调用。
 */
export function RequireFeature({ feature, children }: { feature: FeatureKey; children: ReactNode }) {
    void feature;
    return <>{children}</>;
}
