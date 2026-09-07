import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";

import { WorkspaceRouteLoader } from "@/components/layout/workspace-route-loader";
import { useUserStore } from "@/stores/use-user-store";

export function RequireAuth({ children, loading }: { children: ReactNode; loading?: ReactNode }) {
    const location = useLocation();
    const hydrated = useUserStore((state) => state.hydrated);
    const user = useUserStore((state) => state.user);

    // AuthSessionHydrator owns session hydration. Routes that have a dedicated
    // loading surface may provide it here; other routes remain renderless until
    // hydration completes so they do not add another global loading mask.
    if (!hydrated) return loading ?? <WorkspaceRouteLoader />;
    if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
    return children;
}
