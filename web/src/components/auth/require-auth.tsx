import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";

import { useUserStore } from "@/stores/use-user-store";

export function RequireAuth({ children }: { children: ReactNode }) {
    const location = useLocation();
    const hydrated = useUserStore((state) => state.hydrated);
    const user = useUserStore((state) => state.user);

    // AuthSessionHydrator is the single owner of the session loading surface.
    // Keep this guard renderless until hydration completes to avoid remounting
    // a second full-screen loader during refresh.
    if (!hydrated) return null;
    if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
    return children;
}
