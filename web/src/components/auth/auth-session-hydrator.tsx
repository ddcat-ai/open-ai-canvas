import type { ReactNode } from "react";
import { useEffect } from "react";

import { applyUserSession } from "@/lib/user-session";
import { getAuthSession } from "@/services/api/auth";
import { FullScreenLoader } from "@/components/ui/aceternity/full-screen-loader";
import { useUserStore } from "@/stores/use-user-store";

export function AuthSessionHydrator({ children }: { children: ReactNode }) {
    const hydrated = useUserStore((state) => state.hydrated);

    useEffect(() => {
        let cancelled = false;
        getAuthSession()
            .then(async (payload) => {
                if (!cancelled) await applyUserSession(payload);
            })
            .catch(async () => {
                if (!cancelled) await applyUserSession({ user: null, systemChannels: [] });
            });
        return () => {
            cancelled = true;
        };
    }, []);

    return hydrated ? children : <FullScreenLoader />;
}
