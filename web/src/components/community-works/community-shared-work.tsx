import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router";
import { Button } from "antd";
import { useTranslation } from "react-i18next";
import { AppModal } from "@/components/ui/product/app-modal";
import { communityWorksQueryKey, getPublicWork } from "@/services/api/community-works";
import { CommunityWorkPreview } from "./community-work-preview";

export default function CommunitySharedWork() {
    const { t } = useTranslation();
    const { id = "" } = useParams();
    const navigate = useNavigate();
    const shared = useQuery({ queryKey: [...communityWorksQueryKey, "public-detail", id], queryFn: ({ signal }) => getPublicWork(id, signal), retry: false });
    const close = () => navigate("/", { replace: true });
    if (shared.data) return <CommunityWorkPreview key={shared.data.id} work={shared.data} onClose={close} />;
    return (
        <AppModal open title={t("communityWorks.preview")} onCancel={close} footer={<Button onClick={close}>{t("communityWorks.close")}</Button>}>
            <div role={shared.isError ? "alert" : "status"}>{shared.isError ? shared.error.message : t("communityWorks.loading")}</div>
            {shared.isError && <Button onClick={() => void shared.refetch()}>{t("communityWorks.retry")}</Button>}
        </AppModal>
    );
}
