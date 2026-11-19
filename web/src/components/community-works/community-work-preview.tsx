import { lazy, Suspense, useRef, useState } from "react";
import { App, Button } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Heart, Share2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router";

import { AppModal } from "@/components/ui/product/app-modal";
import { useAuthEntry } from "@/hooks/use-auth-entry";
import { communityWorkSharePath } from "@/lib/community-works";
import { communityWorksQueryKey, copyCommunityWork, getCommunityWorkReaction, getWorkProject, setCommunityWorkLiked, type CommunityWork } from "@/services/api/community-works";
import { useUserStore } from "@/stores/use-user-store";

import "./community-work-preview.css";

const SharedCanvasView = lazy(() => import("@/pages/canvas/shared").then(({ SharedCanvasView }) => ({ default: SharedCanvasView })));

export function CommunityWorkPreview({ work, onClose, privatePreview = false }: { work: CommunityWork; onClose: () => void; privatePreview?: boolean }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const { openAuth } = useAuthEntry();
    const userId = useUserStore((state) => state.user?.id);
    const { pathname, search, state } = useLocation();
    const navigate = useNavigate();
    const client = useQueryClient();
    const [showProcess, setShowProcess] = useState(false);
    const [copying, setCopying] = useState(false);
    const copyInFlight = useRef(false);
    const sharePath = communityWorkSharePath(work.id);
    const project = useQuery({
        queryKey: [...communityWorksQueryKey, "project", work.id, privatePreview ? userId : "public", work.updatedAt],
        queryFn: ({ signal }) => getWorkProject(work.id, privatePreview, signal),
        enabled: showProcess && work.hasProject,
    });
    const reactionKey = [...communityWorksQueryKey, "reaction", work.id, userId] as const;
    const reaction = useQuery({
        queryKey: reactionKey,
        queryFn: ({ signal }) => getCommunityWorkReaction(work.id, Boolean(userId), signal),
        enabled: !privatePreview,
    });
    const like = useMutation({
        mutationFn: (liked: boolean) => setCommunityWorkLiked(work.id, liked),
        onSuccess: (value) => {
            if (useUserStore.getState().user?.id === userId) client.setQueryData(reactionKey, value);
        },
        onError: (error) => void message.error(error.message),
    });

    const copy = async () => {
        if (!userId) {
            openAuth({ next: sharePath });
            return;
        }
        if (copyInFlight.current) return;
        copyInFlight.current = true;
        setCopying(true);
        try {
            const copied = await copyCommunityWork(work.id);
            if (useUserStore.getState().user?.id !== userId) return;
            void client.invalidateQueries({ queryKey: ["canvas-projects"] });
            navigate(`/canvas/${encodeURIComponent(copied.project.id)}`, { state: { returnTo: pathname + search, returnState: state } });
        } catch (error) {
            void message.error(error instanceof Error ? error.message : t("communityWorks.failed"));
        } finally {
            copyInFlight.current = false;
            setCopying(false);
        }
    };

    const share = async () => {
        try {
            const url = new URL(sharePath, window.location.origin).href;
            if (navigator.share) {
                await navigator.share({ title: work.title, url });
                return;
            }
            await navigator.clipboard.writeText(url);
            void message.success(t("communityWorks.linkCopied"));
        } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") return;
            void message.error(error instanceof Error ? error.message : t("communityWorks.failed"));
        }
    };

    return (
        <AppModal open title={work.title} width={showProcess ? 1120 : 880} centered onCancel={onClose} footer={null}>
            {showProcess ? (
                <>
                    <div className="community-preview-actions">
                        <Button onClick={() => setShowProcess(false)}>{t("communityWorks.back")}</Button>
                        {!privatePreview ? (
                            <Button type="primary" disabled={!project.data} loading={copying} onClick={() => void copy()}>
                                {t("communityWorks.copyCanvas")}
                            </Button>
                        ) : null}
                    </div>
                    {project.data ? (
                        <Suspense fallback={<div role="status">{t("communityWorks.loading")}</div>}>
                            <SharedCanvasView snapshot={project.data.project} />
                        </Suspense>
                    ) : project.isError ? (
                        <div role="alert">
                            <p>{project.error.message}</p>
                            <Button onClick={() => void project.refetch()}>{t("communityWorks.retry")}</Button>
                        </div>
                    ) : (
                        <div role="status">{t("communityWorks.loading")}</div>
                    )}
                </>
            ) : (
                <>
                    <div className="community-preview-media">{work.kind === "video" ? <video src={work.mediaUrl} poster={work.coverUrl} autoPlay muted playsInline controls aria-label={work.title} /> : <img src={work.mediaUrl} alt={work.title} />}</div>
                    <p className="community-preview-author">{work.author}</p>
                    {work.description ? <p className="community-preview-description">{work.description}</p> : null}
                    <div className="community-preview-actions">
                        {work.hasProject ? <Button onClick={() => setShowProcess(true)}>{t("communityWorks.process")}</Button> : null}
                        {!privatePreview ? (
                            <>
                                <Button
                                    icon={<Heart fill={reaction.data?.liked ? "currentColor" : "none"} />}
                                    aria-pressed={reaction.data?.liked ?? false}
                                    aria-label={t(reaction.data?.liked ? "communityWorks.unlike" : "communityWorks.like")}
                                    loading={like.isPending}
                                    disabled={Boolean(userId) && !reaction.data}
                                    onClick={() => (userId ? like.mutate(!reaction.data?.liked) : openAuth({ next: sharePath }))}
                                >
                                    {reaction.data ? reaction.data.count : t("communityWorks.like")}
                                </Button>
                                <Button icon={<Share2 />} onClick={() => void share()}>
                                    {t("communityWorks.share")}
                                </Button>
                            </>
                        ) : null}
                    </div>
                </>
            )}
        </AppModal>
    );
}
