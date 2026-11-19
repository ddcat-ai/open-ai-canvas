import { useQuery } from "@tanstack/react-query";
import { teamKeys } from "@/lib/team-query-keys";
import { getSpaceCreditOverview } from "@/services/api/teams";
import { useUserStore } from "@/stores/use-user-store";

export function useSpaceCreditOverview(refreshVisibleList = false) {
    const userId = useUserStore((state) => state.user?.id || "");
    const enabled = useUserStore((state) => state.features.teamsEnabled && state.features.creditsEnabled);
    return useQuery({
        queryKey: teamKeys.credits(userId),
        queryFn: ({ signal }) => getSpaceCreditOverview(signal),
        enabled: Boolean(userId) && enabled,
        staleTime: 15_000,
        refetchOnWindowFocus: true,
        // 成员停在明细页时，所有者也可能在另一会话给他划拨额度。
        refetchInterval: refreshVisibleList ? 60_000 : false,
        retry: false,
    });
}
