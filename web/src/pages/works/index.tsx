import { useEffect, useState } from "react";
import { App, Button, Input, Pagination, Popconfirm, Select, Tag } from "antd";
import { ArrowLeft, Plus } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { AppModal } from "@/components/ui/product/app-modal";
import { CommunityWorkPreview } from "@/components/community-works/community-work-preview";
import { communityWorksQueryKey, getAdminWorks, getMyWorks, reviewWork, withdrawWork, type CommunityWork, type WorkReviewAction, type WorkStatus } from "@/services/api/community-works";
import { useUserStore } from "@/stores/use-user-store";
import { workReturnTarget } from "@/lib/community-works";
import { WorkPublishDialog } from "./work-publish-dialog";
import "./works.css";

const statuses: WorkStatus[] = ["pending", "published", "rejected", "withdrawn", "unlisted"];

export default function MyWorksPage() {
    return <WorksList />;
}

export function WorksList({ admin = false }: { admin?: boolean }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const userId = useUserStore((state) => state.user?.id);
    const location = useLocation();
    const navigate = useNavigate();
    const [search, setSearch] = useSearchParams();
    const [status, setStatus] = useState<WorkStatus | undefined>(admin ? "pending" : undefined);
    const [page, setPage] = useState(1);
    const pageSize = 24;
    const [dialog, setDialog] = useState<{ work?: CommunityWork } | null>(() => (!admin && search.has("projectId") ? {} : null));
    const [preview, setPreview] = useState<CommunityWork>();
    const [busy, setBusy] = useState<string>();
    const [reasonDialog, setReasonDialog] = useState<{ work: CommunityWork; action: "reject" | "unlist" }>();
    const [reason, setReason] = useState("");
    const [reasonError, setReasonError] = useState(false);
    const client = useQueryClient();
    const works = useQuery({ queryKey: [...communityWorksQueryKey, admin ? "admin" : "mine", userId, status, page, pageSize], queryFn: ({ signal }) => (admin ? getAdminWorks : getMyWorks)({ status, page, pageSize }, signal), refetchInterval: 30000 });
    useEffect(() => {
        if (works.data && page > Math.max(1, Math.ceil(works.data.total / pageSize))) setPage(Math.max(1, Math.ceil(works.data.total / pageSize)));
    }, [page, works.data]);
    const refresh = async () => {
        await client.invalidateQueries({ queryKey: communityWorksQueryKey });
    };
    const closeDialog = () => {
        setDialog(null);
        if (search.has("projectId")) {
            const next = new URLSearchParams(search);
            next.delete("projectId");
            setSearch(next, { replace: true });
        }
    };
    const action = async (work: CommunityWork, review?: WorkReviewAction, reviewReason?: string) => {
        setBusy(work.id);
        try {
            if (review) await reviewWork(work.id, review, reviewReason);
            else await withdrawWork(work.id);
            if (useUserStore.getState().user?.id !== userId) return;
            await refresh();
            setReasonDialog(undefined);
            void message.success(t(review ? "communityWorks.updated" : "communityWorks.withdrawn"));
        } catch (error) {
            void message.error(error instanceof Error ? error.message : t("communityWorks.failed"));
        } finally {
            setBusy(undefined);
        }
    };
    const filtered = works.data?.items || [];
    const headerActions = !admin ? (
        <Button type="primary" icon={<Plus size={16} />} onClick={() => setDialog({})}>
            {t("communityWorks.create")}
        </Button>
    ) : undefined;
    const content = (
        <>
            <div className="community-works-toolbar">
                <Select
                    aria-label={t("communityWorks.status.pending")}
                    value={status || "all"}
                    onChange={(value) => {
                        setStatus(value === "all" ? undefined : (value as WorkStatus));
                        setPage(1);
                    }}
                    options={[{ value: "all", label: t("communityWorks.all") }, ...statuses.map((value) => ({ value, label: t(`communityWorks.status.${value}`) }))]}
                />
            </div>
            {works.isPending ? (
                <div className="community-works-state" role="status">
                    {t("communityWorks.loading")}
                </div>
            ) : works.isError ? (
                <div className="community-works-state" role="alert">
                    <p>{works.error.message}</p>
                    <Button onClick={() => void works.refetch()}>{t("communityWorks.retry")}</Button>
                </div>
            ) : !filtered.length ? (
                <div className="community-works-state">{t("communityWorks.empty")}</div>
            ) : (
                <div className="community-works-grid">
                    {filtered.map((work) => (
                        <article className="community-work-card" key={work.id}>
                            <button type="button" className="community-work-cover" onClick={() => setPreview(work)} aria-label={`${t("communityWorks.preview")} · ${work.title}`}>
                                <img src={work.coverUrl} alt={work.title} loading="lazy" decoding="async" />
                            </button>
                            <div className="community-work-content">
                                <div className="community-work-title">
                                    <strong>{work.title}</strong>
                                    <Tag>{t(`communityWorks.status.${work.status}`)}</Tag>
                                    {work.featured && <Tag color="blue">{t("communityWorks.featured")}</Tag>}
                                </div>
                                {admin && <p>{work.author}</p>}
                                {work.reviewReason && <p className="community-work-reason">{work.reviewReason}</p>}
                                <div className="community-work-actions">
                                    <Button size="small" onClick={() => setPreview(work)}>
                                        {t("communityWorks.preview")}
                                    </Button>
                                    {admin ? (
                                        <>
                                            {work.status === "pending" && (
                                                <>
                                                    <Button type="primary" size="small" loading={busy === work.id} onClick={() => void action(work, "approve")}>
                                                        {t("communityWorks.approve")}
                                                    </Button>
                                                    <Button
                                                        danger
                                                        size="small"
                                                        disabled={Boolean(busy)}
                                                        onClick={() => {
                                                            setReason("");
                                                            setReasonError(false);
                                                            setReasonDialog({ work, action: "reject" });
                                                        }}
                                                    >
                                                        {t("communityWorks.reject")}
                                                    </Button>
                                                </>
                                            )}
                                            {work.status === "published" && (
                                                <>
                                                    <Button size="small" loading={busy === work.id} onClick={() => void action(work, work.featured ? "unfeature" : "feature")}>
                                                        {t(work.featured ? "communityWorks.unfeature" : "communityWorks.feature")}
                                                    </Button>
                                                    <Button
                                                        danger
                                                        size="small"
                                                        disabled={Boolean(busy)}
                                                        onClick={() => {
                                                            setReason("");
                                                            setReasonError(false);
                                                            setReasonDialog({ work, action: "unlist" });
                                                        }}
                                                    >
                                                        {t("communityWorks.unlist")}
                                                    </Button>
                                                </>
                                            )}
                                        </>
                                    ) : (
                                        <>
                                            <Button size="small" disabled={Boolean(busy)} onClick={() => setDialog({ work })}>
                                                {t("communityWorks.edit")}
                                            </Button>
                                            {work.status !== "withdrawn" && (
                                                <Popconfirm title={t("communityWorks.withdrawConfirm")} onConfirm={() => action(work)} okText={t("communityWorks.confirm")} cancelText={t("communityWorks.cancel")}>
                                                    <Button size="small" danger loading={busy === work.id}>
                                                        {t("communityWorks.withdraw")}
                                                    </Button>
                                                </Popconfirm>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                        </article>
                    ))}
                </div>
            )}
            {works.data && works.data.total > pageSize && <Pagination className="community-works-pagination" current={page} pageSize={pageSize} total={works.data.total} showSizeChanger={false} onChange={setPage} />}
            {dialog && (
                <WorkPublishDialog
                    work={dialog.work}
                    projectId={search.get("projectId") || undefined}
                    onClose={closeDialog}
                    onSaved={() => {
                        closeDialog();
                        void refresh();
                    }}
                />
            )}
            {preview && <CommunityWorkPreview key={preview.id} work={preview} privatePreview onClose={() => setPreview(undefined)} />}
            {reasonDialog && (
                <AppModal
                    open
                    title={t("communityWorks.reasonTitle")}
                    onCancel={() => !busy && setReasonDialog(undefined)}
                    onOk={() => {
                        if (!reason.trim()) {
                            setReasonError(true);
                            return;
                        }
                        void action(reasonDialog.work, reasonDialog.action, reason.trim());
                    }}
                    confirmLoading={Boolean(busy)}
                    okText={t("communityWorks.confirm")}
                    cancelText={t("communityWorks.cancel")}
                >
                    <label className="community-work-reason-label">
                        {t("communityWorks.reason")}
                        <Input.TextArea
                            value={reason}
                            maxLength={500}
                            rows={4}
                            status={reasonError ? "error" : undefined}
                            onChange={(event) => {
                                setReason(event.target.value);
                                setReasonError(false);
                            }}
                        />
                    </label>
                    {reasonError && <p role="alert">{t("communityWorks.reasonRequired")}</p>}
                </AppModal>
            )}
        </>
    );
    if (admin) return content;
    const back = workReturnTarget(location.state);
    return (
        <main className="community-works-page">
            <header className="community-works-heading">
                <div>
                    <Button type="text" icon={<ArrowLeft size={16} />} onClick={() => navigate(back.to, { state: back.state })}>
                        {t("communityWorks.back")}
                    </Button>
                    <h1>{t("communityWorks.mine")}</h1>
                </div>
                {headerActions}
            </header>
            {content}
        </main>
    );
}
