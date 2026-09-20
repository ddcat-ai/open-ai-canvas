import { useLayoutEffect, type ReactNode } from "react";
import { useLocation } from "react-router";
import { ConfigProvider } from "antd";

import { AppWorkspaceShell } from "@/components/layout/app-top-nav";
import { cn } from "@/lib/utils";
import { isSpatialWorkbenchPath } from "@/lib/workspace-routes";
import { getWorkspaceAntThemeConfig } from "@/lib/app-theme";
import { useWorkspaceButtonFeedback } from "@/hooks/use-workspace-button-feedback";
import "@/styles/workspace-product.css";
import "@/styles/workspace-menus.css";

const workspaceTheme = getWorkspaceAntThemeConfig();

export default function UserLayout({ children }: { children: ReactNode }) {
    const { pathname } = useLocation();
    const adminWorkspace = pathname === "/admin" || pathname.startsWith("/admin/");
    const spatialWorkbench = isSpatialWorkbenchPath(pathname);
    const productWorkspace = !adminWorkspace && !/^\/canvas\/[^/]+(?:\/|$)/.test(pathname);
    useWorkspaceButtonFeedback(productWorkspace);

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

    if (adminWorkspace) return children;

    return (
        <ConfigProvider
            theme={productWorkspace ? workspaceTheme : undefined}
            select={productWorkspace ? { classNames: { popup: { root: "workspace-quiet-popup" } } } : undefined}
            dropdown={productWorkspace ? { classNames: { root: "workspace-quiet-popup" } } : undefined}
            popover={productWorkspace ? { classNames: { root: "workspace-quiet-popup" } } : undefined}
        >
            <div className={cn("app-user-workspace h-dvh overflow-hidden text-foreground", spatialWorkbench && "app-spatial-workspace", productWorkspace && "app-product-workspace")}>
                <AppWorkspaceShell>{children}</AppWorkspaceShell>
            </div>
        </ConfigProvider>
    );
}
