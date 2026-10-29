import { lazy, Suspense, useLayoutEffect, type ReactNode } from "react";
import { useLocation } from "react-router";
import { ConfigProvider } from "antd";

import { AppWorkspaceShell } from "@/components/layout/app-top-nav";
import { useAgentPanelDock } from "@/components/canvas/use-agent-panel-dock";
import { cn } from "@/lib/utils";
import { isSpatialWorkbenchPath } from "@/lib/workspace-routes";
import { getWorkspaceAntThemeConfig } from "@/lib/app-theme";
import { useUserStore } from "@/stores/use-user-store";
import "@/styles/workspace-product.css";
import "@/styles/workspace-menus.css";

const workspaceTheme = getWorkspaceAntThemeConfig();
// 平台唯一的 Agent 面板按需加载，不拖慢首屏；画布编辑器只发布画布上下文，不再自己渲染面板。
const GlobalAgentPanel = lazy(() => import("@/components/canvas/canvas-cloud-agent-panel").then((module) => ({ default: module.CanvasCloudAgentPanel })));

export default function UserLayout({ children }: { children: ReactNode }) {
    const { pathname } = useLocation();
    const adminWorkspace = pathname === "/admin" || pathname.startsWith("/admin/");
    const spatialWorkbench = isSpatialWorkbenchPath(pathname);
    const canvasEditor = /^\/canvas\/[^/]+(?:\/|$)/.test(pathname);
    const productWorkspace = !adminWorkspace && !canvasEditor;
    const userId = useUserStore((state) => state.user?.id);
    // Agent 停靠在画布右侧时，工作区让出同样的宽度，画布、顶栏和角落控件都不被遮挡。
    const agentDock = useAgentPanelDock();
    const agentDocked = Boolean(userId) && canvasEditor && agentDock.active;

    useLayoutEffect(() => {
        // Ant Design 浮层挂载在 body，必须用路由级标记隔离用户工作台与画布编辑器、运营后台。
        document.body.classList.toggle("app-user-overlays", !adminWorkspace);
        document.body.classList.toggle("app-spatial-overlays", spatialWorkbench);
        document.body.classList.toggle("app-product-overlays", productWorkspace);
        return () => {
            document.body.classList.remove("app-user-overlays");
            document.body.classList.remove("app-spatial-overlays");
            document.body.classList.remove("app-product-overlays");
        };
    }, [adminWorkspace, spatialWorkbench, productWorkspace]);

    // 所有登录页面共用同一个面板实例：跨路由不卸载，对话、运行和事件流都不中断。
    const globalAgent = userId ? (
        <Suspense fallback={null}>
            <GlobalAgentPanel key={userId} />
        </Suspense>
    ) : null;

    if (adminWorkspace)
        return (
            <>
                {children}
                {globalAgent}
            </>
        );

    return (
        <ConfigProvider
            theme={productWorkspace ? workspaceTheme : undefined}
            select={productWorkspace ? { classNames: { popup: { root: "workspace-quiet-popup" } } } : undefined}
            dropdown={productWorkspace ? { classNames: { root: "workspace-quiet-popup" } } : undefined}
            popover={productWorkspace ? { classNames: { root: "workspace-quiet-popup" } } : undefined}
        >
            <div
                className={cn("app-user-workspace h-dvh overflow-hidden text-foreground", spatialWorkbench && "app-spatial-workspace", productWorkspace && "app-product-workspace")}
                style={agentDocked ? { paddingRight: agentDock.width } : undefined}
                data-agent-docked={agentDocked || undefined}
            >
                <AppWorkspaceShell>{children}</AppWorkspaceShell>
            </div>
            {globalAgent}
        </ConfigProvider>
    );
}
