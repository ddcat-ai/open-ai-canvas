import { useLayoutEffect, type ReactNode } from "react";
import { useLocation } from "react-router";

import { CanvasDeleteProjectsDialog } from "@/components/canvas/canvas-delete-projects-dialog";
import { AppWorkspaceShell } from "@/components/layout/app-top-nav";
import { cn } from "@/lib/utils";
import { isSpatialWorkbenchPath } from "@/lib/workspace-routes";

export default function UserLayout({ children }: { children: ReactNode }) {
    const { pathname } = useLocation();
    const spatialWorkbench = isSpatialWorkbenchPath(pathname);

    useLayoutEffect(() => {
        // Ant Design 浮层挂载在 body，必须用路由级标记隔离用户工作台与画布编辑器、运营后台。
        document.body.classList.toggle("app-spatial-overlays", spatialWorkbench);
        return () => document.body.classList.remove("app-spatial-overlays");
    }, [spatialWorkbench]);

    return (
        <div className={cn("app-user-workspace h-dvh overflow-hidden text-foreground", spatialWorkbench && "app-spatial-workspace")}>
            <AppWorkspaceShell>{children}</AppWorkspaceShell>
            <CanvasDeleteProjectsDialog />
        </div>
    );
}
