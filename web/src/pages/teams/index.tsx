import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Input, Select, Tag } from "antd";
import { ArrowRight, Building2, Plus, UserPlus, Users } from "lucide-react";
import { Link, Outlet, useNavigate, useParams, useSearchParams } from "react-router";
import { WorkspacePage, PageHeader } from "@/components/layout/workspace-page";
import { openTeamInvitations } from "@/components/layout/team-invitation-center";
import { AppModal } from "@/components/ui/product/app-modal";
import { teamKeys } from "@/lib/team-query-keys";
import { createTeam, createTeamGroup, getTeam, listTeams } from "@/services/api/teams";
import { ApiError } from "@/services/api/request";
import { useUserStore } from "@/stores/use-user-store";

export function TeamQueryError({ error, retry }: { error: Error; retry: () => unknown }) {
    return <Alert type="error" showIcon title="读取失败" description={error.message} action={<Button onClick={() => void retry()}>重试</Button>} />;
}

export default function TeamsPage() {
    const userId = useUserStore((state) => state.user?.id) || "";
    const teams = useQuery({ queryKey: teamKeys.list(userId), queryFn: ({ signal }) => listTeams(signal) });
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const { message } = App.useApp();
    const [params, setParams] = useSearchParams();
    const creating = params.has("create");
    const parentId = params.get("parent") || "";
    const roots = teams.data?.filter((team) => !team.parentId) || [];
    const owned = roots.filter((team) => team.role === "owner");
    const canCreateHere = !parentId || owned.some((team) => team.id === parentId);
    const [name, setName] = useState("");
    const openCreate = (parent?: string) => {
        setName("");
        setParams(parent ? { create: "1", parent } : { create: "1" });
    };
    const create = useMutation({
        mutationFn: () => (parentId ? createTeamGroup(parentId, name.trim()) : createTeam(name.trim())),
        onSuccess: async (team) => {
            await queryClient.invalidateQueries({ queryKey: teamKeys.all(userId) });
            navigate(`/teams/${encodeURIComponent(team.id)}`, { replace: true });
        },
        onError: (error) => message.error(error.message),
    });
    return (
        <WorkspacePage>
            <PageHeader
                title="公司与团队"
                description="进入已加入的公司和小组，管理成员与共享素材。"
                actions={
                    <>
                        <Button icon={<UserPlus className="size-4" />} onClick={openTeamInvitations}>
                            团队邀请
                        </Button>
                        <Button type="primary" icon={<Plus className="size-4" />} onClick={() => openCreate()}>
                            创建空间
                        </Button>
                    </>
                }
            />
            <div className="mt-6">
                {teams.isError ? <TeamQueryError error={teams.error} retry={teams.refetch} /> : null}
                {teams.isPending ? <p role="status">正在读取团队…</p> : null}
                {teams.data?.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border p-12 text-center">
                        <Users className="mx-auto mb-3 size-8 text-foreground/40" />
                        <h2 className="font-semibold">还没有加入团队</h2>
                        <p className="mt-2 text-sm text-foreground/60">创建自己的团队，或在「团队邀请」中接受他人的邀请。</p>
                    </div>
                ) : null}
                <div className="grid items-start gap-4 md:grid-cols-2">
                    {!teams.isError &&
                        roots.map((team) => (
                            <section key={team.id} className="rounded-xl border border-border bg-background p-4">
                                <Link to={`/teams/${encodeURIComponent(team.id)}`} className="flex items-center gap-3 rounded-lg p-2 hover:bg-surface-hover">
                                    <span className="space-directory-icon">
                                        <Building2 aria-hidden />
                                    </span>
                                    <h2 className="min-w-0 flex-1 truncate font-semibold">{team.name}</h2>
                                    <Tag>{team.role === "owner" ? "所有者" : "成员"}</Tag>
                                    <ArrowRight className="size-4" aria-hidden />
                                </Link>
                                <ul className="ml-4 border-l border-border pl-3">
                                    {teams.data
                                        ?.filter((group) => group.parentId === team.id)
                                        .map((group) => (
                                            <li key={group.id}>
                                                <Link className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-surface-hover" to={`/teams/${encodeURIComponent(group.id)}`}>
                                                    <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                                                    <span className="truncate">{group.name}</span>
                                                </Link>
                                            </li>
                                        ))}
                                </ul>
                                {team.role === "owner" ? (
                                    <Button type="text" size="small" className="mt-2" icon={<Plus className="size-3.5" />} onClick={() => openCreate(team.id)}>
                                        创建小组
                                    </Button>
                                ) : null}
                            </section>
                        ))}
                </div>
            </div>
            <AppModal
                centered
                title={parentId ? "创建小组" : "创建空间"}
                open={creating}
                onCancel={() => {
                    if (!create.isPending) setParams({}, { replace: true });
                }}
                onOk={() => create.mutate()}
                confirmLoading={create.isPending}
                okText="创建"
                okButtonProps={{ disabled: !name.trim() || !canCreateHere }}
            >
                <label className="mb-4 block space-y-2">
                    <span>所属空间</span>
                    <Select
                        aria-label="所属空间"
                        className="w-full"
                        value={parentId}
                        disabled={create.isPending}
                        onChange={(parent: string) => setParams(parent ? { create: "1", parent } : { create: "1" }, { replace: true })}
                        options={[{ value: "", label: "无上级 · 新建公司或独立团队" }, ...owned.map((company) => ({ value: company.id, label: company.name }))]}
                    />
                </label>
                <label className="block space-y-2">
                    <span>{parentId ? "小组名称" : "公司或团队名称"}</span>
                    <Input
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        maxLength={80}
                        disabled={create.isPending}
                        placeholder={parentId ? "例如：剪辑组" : "例如：星河工作室"}
                        onPressEnter={() => {
                            if (name.trim() && canCreateHere && !create.isPending) create.mutate();
                        }}
                    />
                </label>
                <p className="mt-3 text-sm text-foreground/60">{parentId ? "从所属公司邀请成员加入小组。小组有独立的额度和素材库。" : "创建后可邀请平台用户加入，也可在公司下建立多个小组。"}</p>
            </AppModal>
        </WorkspacePage>
    );
}

export function TeamWorkspacePage() {
    const { teamId = "" } = useParams();
    const userId = useUserStore((state) => state.user?.id) || "";
    const queryClient = useQueryClient();
    const teamQuery = useQuery({
        queryKey: [...teamKeys.space(userId, teamId), "detail"],
        queryFn: ({ signal }) => getTeam(teamId, signal),
        staleTime: 10_000,
        refetchOnWindowFocus: true,
        refetchInterval: () => (document.visibilityState === "visible" ? 30_000 : false),
        retry: false,
    });
    useEffect(() => {
        if (!(teamQuery.error instanceof ApiError) || ![401, 403, 404].includes(teamQuery.error.status || 0)) return;
        void queryClient.cancelQueries({ queryKey: teamKeys.space(userId, teamId) });
        queryClient.removeQueries({ predicate: (query) => query.queryKey[0] === "teams" && query.queryKey[1] === userId && query.queryKey[3] === teamId && query.queryKey[4] !== "detail" });
        void queryClient.invalidateQueries({ queryKey: teamKeys.list(userId) });
        void queryClient.invalidateQueries({ queryKey: teamKeys.credits(userId) });
    }, [queryClient, teamId, teamQuery.error, userId]);
    if (teamQuery.isError)
        return (
            <WorkspacePage>
                <PageHeader title="团队空间无法访问" />
                <div className="mt-5">
                    <TeamQueryError error={teamQuery.error} retry={teamQuery.refetch} />
                </div>
                <Link className="mt-4 inline-block" to="/teams">
                    返回我的团队
                </Link>
            </WorkspacePage>
        );
    if (!teamQuery.data)
        return (
            <WorkspacePage>
                <p role="status">正在验证团队身份…</p>
            </WorkspacePage>
        );
    return <Outlet key={`${userId}:${teamId}`} context={teamQuery.data} />;
}
