import { lazy, Suspense } from "react";

import { AdminPageFrame } from "../components/admin-shell";
import { useTranslation } from "react-i18next";

const RedemptionCodesPanel = lazy(() => import("../components/redemption-codes-panel"));

export default function RedemptionCodesPage() {
    const { t } = useTranslation("canvas");
    return (
        <AdminPageFrame title={t("admin:redemption-codes")} description={t("admin:generate-and-view-redemption-code-batches")}>
            <Suspense fallback={<div className="py-16 text-center text-sm text-foreground/50">{t("admin:loading-redemption-code-batches")}</div>}>
                <RedemptionCodesPanel />
            </Suspense>
        </AdminPageFrame>
    );
}
