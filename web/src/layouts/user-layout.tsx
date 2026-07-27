import type { ReactNode } from "react";

import { CanvasDeleteProjectsDialog } from "@/components/canvas/canvas-delete-projects-dialog";
import { AppWorkspaceShell } from "@/components/layout/app-top-nav";

export default function UserLayout({ children }: { children: ReactNode }) {
    return (
        <div className="app-user-workspace h-dvh overflow-hidden text-foreground">
            <AppWorkspaceShell>{children}</AppWorkspaceShell>
            <CanvasDeleteProjectsDialog />
        </div>
    );
}
