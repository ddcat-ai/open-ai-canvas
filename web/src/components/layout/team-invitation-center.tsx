import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Tag } from "antd";
import { Link } from "react-router";
import { UserPlus } from "lucide-react";
import { AppModal } from "@/components/ui/product/app-modal";
import { teamKeys } from "@/lib/team-query-keys";
import { ApiError } from "@/services/api/request";
import { listMyTeamInvitations, respondTeamInvitation } from "@/services/api/teams";
import { useUserStore } from "@/stores/use-user-store";

const OPEN_INVITATIONS_EVENT = "teams:open-invitations";
export function openTeamInvitations() {
    window.dispatchEvent(new Event(OPEN_INVITATIONS_EVENT));
}

export function TeamInvitationCenter() {
    const userId = useUserStore((state) => state.user?.id) || "";
    const [open, setOpen] = useState(false);
    const [acceptedTeam, setAcceptedTeam] = useState<string>();
    const queryClient = useQueryClient();
    const { message } = App.useApp();
    const invitations = useQuery({
        queryKey: teamKeys.invitations(userId),
        queryFn: ({ signal }) => listMyTeamInvitations(signal),
        enabled: Boolean(userId),
        staleTime: 15_000,
        refetchOnWindowFocus: true,
        retry: false,
        refetchInterval: () => (document.visibilityState === "visible" ? 60_000 : false),
    });
    useEffect(() => {
        if (!(invitations.error instanceof ApiError) || invitations.error.reason !== "team_feature_disabled") return;
        const session = useUserStore.getState();
        if (session.user?.id === userId) session.setFeatures({ ...session.features, teamsEnabled: false });
    }, [invitations.error, userId]);
    useEffect(() => {
        const show = () => setOpen(true);
        window.addEventListener(OPEN_INVITATIONS_EVENT, show);
        return () => window.removeEventListener(OPEN_INVITATIONS_EVENT, show);
    }, []);
    const respond = useMutation({
        mutationFn: ({ id, action }: { id: string; action: "accept" | "reject" }) => respondTeamInvitation(id, action),
        onSuccess: async (invitation) => {
            if (invitation.status === "accepted") setAcceptedTeam(invitation.teamId);
            await queryClient.invalidateQueries({ queryKey: teamKeys.all(userId) });
            message.success(invitation.status === "accepted" ? "已加入团队" : "邀请已处理");
        },
        onError: (error) => message.error(error.message),
    });
    if (!userId) return null;
    return (
        <>
            {!invitations.isError && invitations.data?.length && !open ? (
                <div className="fixed bottom-5 right-5 z-40 rounded-xl border border-border bg-background p-3 shadow-lg">
                    <Button icon={<UserPlus className="size-4" />} onClick={() => setOpen(true)}>
                        你有 {invitations.data.length} 个团队邀请
                    </Button>
                </div>
            ) : null}
            <AppModal centered title="团队邀请" open={open} onCancel={() => setOpen(false)} width={520} footer={null}>
                <div className="max-h-[62dvh] space-y-4 overflow-y-auto overscroll-contain">
                    <p className="text-sm text-foreground/60">接受后可进入相应的公司或小组，与成员共享素材。</p>
                    {acceptedTeam ? (
                        <Alert
                            type="success"
                            title="已加入团队"
                            action={
                                <Link to={`/teams/${encodeURIComponent(acceptedTeam)}`} onClick={() => setOpen(false)}>
                                    进入团队
                                </Link>
                            }
                        />
                    ) : null}
                    {invitations.isError ? <Alert type="error" title="邀请读取失败" description={invitations.error.message} action={<Button onClick={() => void invitations.refetch()}>重试</Button>} /> : null}
                    {invitations.isPending ? <p role="status">正在读取邀请…</p> : null}
                    {invitations.data?.length === 0 ? <p className="rounded-xl border border-dashed border-border p-8 text-center text-foreground/60">暂无待处理邀请</p> : null}
                    {!invitations.isError &&
                        invitations.data?.map((invitation) => (
                            <article key={invitation.id} className="space-y-3 rounded-xl border border-border p-4">
                                <div className="flex items-center justify-between gap-2">
                                    <strong>
                                        {invitation.parentName ? `${invitation.parentName} / ` : ""}
                                        {invitation.teamName}
                                    </strong>
                                    <Tag>成员</Tag>
                                </div>
                                <p className="text-sm">{invitation.inviterName} 邀请你加入团队</p>
                                <p className="text-xs text-foreground/60">有效期至 {new Date(invitation.expiresAt).toLocaleString()}</p>
                                <div className="flex justify-end gap-2">
                                    <Button disabled={respond.isPending} onClick={() => respond.mutate({ id: invitation.id, action: "reject" })}>
                                        拒绝
                                    </Button>
                                    <Button
                                        type="primary"
                                        loading={respond.isPending && respond.variables?.id === invitation.id && respond.variables.action === "accept"}
                                        disabled={respond.isPending}
                                        onClick={() => respond.mutate({ id: invitation.id, action: "accept" })}
                                    >
                                        接受邀请
                                    </Button>
                                </div>
                            </article>
                        ))}
                </div>
            </AppModal>
        </>
    );
}
