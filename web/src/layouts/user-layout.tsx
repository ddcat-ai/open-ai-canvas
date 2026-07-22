import type { ReactNode } from "react";

import { AppTopNav } from "@/components/layout/app-top-nav";

export default function UserLayout({ children }: { children: ReactNode }) {
    return (
        <div className="app-user-workspace flex h-dvh flex-col overflow-hidden text-foreground">
            <AppTopNav />
            <div className="relative min-h-0 flex-1 overflow-hidden">{children}</div>
        </div>
    );
}
