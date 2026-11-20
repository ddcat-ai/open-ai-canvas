import { useQuery } from "@tanstack/react-query";
import { ChevronsUpDown, UserRound, UsersRound } from "lucide-react";
import { useLocation } from "react-router";
import { useSpaceCreditOverview } from "@/hooks/use-space-credit-overview";
import { teamIdFromPath, teamKeys } from "@/lib/team-query-keys";
import { listTeams } from "@/services/api/teams";
import { useUserStore } from "@/stores/use-user-store";
import { openSpaceDirectory } from "./team-space-directory";

export function TeamSpaceSwitcher({ collapsed, onNavigate }: { collapsed: boolean; onNavigate: () => void }) {
    const userId = useUserStore((state) => state.user?.id || "");
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const { pathname } = useLocation();
    const teamId = teamIdFromPath(pathname);
    const overview = useSpaceCreditOverview();
    const list = useQuery({ queryKey: teamKeys.list(userId), queryFn: ({ signal }) => listTeams(signal), enabled: Boolean(userId && teamId) && !creditsEnabled, staleTime: 15_000 });
    const team = creditsEnabled ? !overview.isError && overview.data?.spaces.find((space) => space.teamId === teamId) : !list.isError && list.data?.find((space) => space.id === teamId);
    const label = teamId ? (team && team.name) || "团队空间" : "个人空间";
    const Icon = teamId ? UsersRound : UserRound;
    return (
        <button
            type="button"
            className="app-workspace-sidebar-brand-button min-w-0"
            aria-label={`切换空间：${label}`}
            aria-haspopup="dialog"
            title={team && team.parentName ? `${team.parentName} / ${label}` : label}
            onClick={() => {
                onNavigate();
                openSpaceDirectory();
            }}
        >
            <span className="space-directory-icon">
                <Icon aria-hidden />
            </span>
            {!collapsed ? (
                <>
                    <span className="truncate font-semibold">{label}</span>
                    <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                </>
            ) : null}
        </button>
    );
}
