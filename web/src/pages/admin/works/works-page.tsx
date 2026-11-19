import { useTranslation } from "react-i18next";
import { AdminPageFrame } from "@/pages/admin/components/admin-shell";
import { WorksList } from "@/pages/works";

export default function AdminWorksPage() {
    const { t } = useTranslation();
    return (
        <AdminPageFrame title={t("communityWorks.review")} scroll>
            <WorksList admin />
        </AdminPageFrame>
    );
}
