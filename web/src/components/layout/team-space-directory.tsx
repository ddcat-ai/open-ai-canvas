import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Input, type InputRef } from "antd";
import { ArrowUpRight, Building2, Check, Layers2, Plus, Search, UserRound, UsersRound, Wallet } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router";
import { AppModal } from "@/components/ui/product/app-modal";
import { useSpaceCreditOverview } from "@/hooks/use-space-credit-overview";
import { teamCredits, teamIdFromPath, teamKeys } from "@/lib/team-query-keys";
import { openWorkspaceWallet } from "@/lib/workspace-wallet";
import { listTeams, type SpaceCreditOverview, type TeamSpaceCredit } from "@/services/api/teams";
import { useUserStore } from "@/stores/use-user-store";
import "./team-spaces.css";

const DIRECTORY_EVENT = "teams:open-space-directory";
export const openSpaceDirectory = () => window.dispatchEvent(new Event(DIRECTORY_EVENT));

type SpaceRow = { id: string; name: string; parentId?: string; parentName?: string; role?: TeamSpaceCredit["role"]; availableMicrocredits?: number; poolAvailableMicrocredits?: number };

function creditRows(overview: SpaceCreditOverview): SpaceRow[] {
    return overview.spaces.map((space) => ({ ...space, id: space.teamId }));
}

function SpaceRows({ spaces, personalBalance, filter = "", activeId, onChoose }: { spaces: SpaceRow[]; personalBalance?: number; filter?: string; activeId?: string; onChoose: (id: string) => void }) {
    const needle = filter.trim().toLocaleLowerCase();
    const children = new Map<string, SpaceRow[]>();
    for (const space of spaces) {
        if (!space.parentId) continue;
        const group = children.get(space.parentId) || [];
        group.push(space);
        children.set(space.parentId, group);
    }
    const rows: SpaceRow[] = [{ id: "", name: "个人空间", availableMicrocredits: personalBalance }, ...spaces.filter((space) => !space.parentId).flatMap((root) => [root, ...(children.get(root.id) || [])])];
    const visible = rows.filter((space) => `${space.parentName || ""} ${space.name}`.toLocaleLowerCase().includes(needle));
    if (!visible.length)
        return (
            <p className="space-directory-empty" role="status">
                没有匹配的空间，试试公司或小组名称。
            </p>
        );
    return (
        <ul className="space-directory-rows" aria-label="空间列表">
            {visible.map((space) => {
                const Icon = !space.id ? UserRound : space.parentId ? UsersRound : Building2;
                const current = activeId === space.id;
                return (
                    <li key={space.id}>
                        <button type="button" className="space-directory-row" data-group={Boolean(space.parentId) || undefined} aria-current={current ? "location" : undefined} onClick={() => onChoose(space.id)}>
                            <span className="space-directory-icon">
                                <Icon aria-hidden />
                            </span>
                            <span className="space-directory-name">
                                <strong>{space.name}</strong>
                                <small>
                                    {space.parentId ? `${space.parentName} · 小组` : space.id ? "公司 / 独立团队" : "个人钱包"}
                                    {space.role === "owner" ? " · 所有者" : ""}
                                </small>
                            </span>
                            {current ? <Check className="size-4 shrink-0" aria-label="当前空间" /> : null}
                            {space.availableMicrocredits !== undefined ? (
                                <span className="space-directory-amount">
                                    <strong>
                                        {teamCredits(space.availableMicrocredits)} <small>积分</small>
                                    </strong>
                                    {space.poolAvailableMicrocredits !== undefined ? <small>公共待分配 {teamCredits(space.poolAvailableMicrocredits)}</small> : null}
                                </span>
                            ) : null}
                        </button>
                    </li>
                );
            })}
        </ul>
    );
}

export function TeamSpaceDirectoryHost({ userId }: { userId: string }) {
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const overview = useSpaceCreditOverview();
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");
    const searchRef = useRef<InputRef>(null);
    const { pathname } = useLocation();
    const navigate = useNavigate();
    const client = useQueryClient();
    const list = useQuery({ queryKey: teamKeys.list(userId), queryFn: ({ signal }) => listTeams(signal), enabled: open && !creditsEnabled, staleTime: 15_000 });
    useEffect(() => {
        const show = () => {
            setSearch("");
            setOpen(true);
        };
        const refresh = () => void client.invalidateQueries({ queryKey: teamKeys.credits(userId) });
        window.addEventListener(DIRECTORY_EVENT, show);
        window.addEventListener("wallet:updated", refresh);
        return () => {
            window.removeEventListener(DIRECTORY_EVENT, show);
            window.removeEventListener("wallet:updated", refresh);
        };
    }, [client, userId]);
    useEffect(() => {
        if (open && creditsEnabled) void client.invalidateQueries({ queryKey: teamKeys.credits(userId) });
    }, [client, creditsEnabled, open, userId]);
    const goto = (path: string) => {
        setOpen(false);
        navigate(path);
    };
    const query = creditsEnabled ? overview : list;
    const spaces = creditsEnabled ? overview.data && creditRows(overview.data) : list.data;
    return (
        <AppModal
            centered
            title="切换空间"
            open={open}
            onCancel={() => setOpen(false)}
            width={560}
            afterOpenChange={(visible) => {
                if (visible) searchRef.current?.focus();
            }}
            footer={null}
        >
            <div className="space-directory">
                <Input ref={searchRef} allowClear prefix={<Search className="size-4 text-muted-foreground" aria-hidden />} aria-label="搜索空间" placeholder="搜索个人空间、公司或小组" value={search} onChange={(event) => setSearch(event.target.value)} />
                {creditsEnabled ? <p className="space-directory-caption">右侧为你在该空间的可用额度。公共积分须先分配给成员。</p> : null}
                <div className="space-directory-scroll">
                    {query.isError ? (
                        <Alert type="error" title="空间列表读取失败" description={query.error.message} action={<Button onClick={() => void query.refetch()}>重试</Button>} />
                    ) : spaces ? (
                        <SpaceRows
                            spaces={spaces}
                            personalBalance={creditsEnabled ? overview.data?.personal.availableMicrocredits : undefined}
                            filter={search}
                            activeId={teamIdFromPath(pathname) || ""}
                            onChoose={(id) => goto(id ? `/teams/${encodeURIComponent(id)}` : "/")}
                        />
                    ) : (
                        <p className="space-directory-empty" role="status">
                            正在读取空间…
                        </p>
                    )}
                </div>
                <footer className="space-directory-footer">
                    <Button type="text" icon={<Plus className="size-4" />} onClick={() => goto("/teams?create=1")}>
                        创建空间
                    </Button>
                    {creditsEnabled ? (
                        <Button
                            type="text"
                            icon={<Wallet className="size-4" />}
                            onClick={() => {
                                setOpen(false);
                                openWorkspaceWallet();
                            }}
                        >
                            个人钱包
                        </Button>
                    ) : null}
                </footer>
            </div>
        </AppModal>
    );
}

export function PersonalSpaceCreditOverview() {
    const visible = useUserStore((state) => Boolean(state.user) && state.features.teamsEnabled && state.features.creditsEnabled);
    const overview = useSpaceCreditOverview(true);
    const navigate = useNavigate();
    if (!visible) return null;
    const data = overview.isError ? undefined : overview.data;
    return (
        <section className="space-credit-home" aria-label="我的空间积分">
            <header>
                <div>
                    <h2>
                        <Layers2 className="size-4" aria-hidden />
                        我的空间积分
                    </h2>
                    <p>每个空间单独扣费，公共待分配积分由所有者划拨。</p>
                </div>
                <Link to="/teams">
                    管理空间 <ArrowUpRight className="size-3.5" aria-hidden />
                </Link>
            </header>
            {overview.isError ? (
                <Alert type="error" title="积分读取失败" description={overview.error.message} action={<Button onClick={() => void overview.refetch()}>重试</Button>} />
            ) : data ? (
                <div className="space-credit-home-list">
                    <SpaceRows spaces={creditRows(data)} personalBalance={data.personal.availableMicrocredits} onChoose={(id) => (id ? navigate(`/teams/${encodeURIComponent(id)}/wallet`) : openWorkspaceWallet())} />
                </div>
            ) : (
                <p className="space-directory-empty" role="status">
                    正在读取积分…
                </p>
            )}
        </section>
    );
}
