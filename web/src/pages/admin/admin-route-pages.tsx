import { lazy, Suspense } from "react";

import { useAdminContext } from "./admin-context";
import { AdminPageFrame } from "./components/admin-shell";
import { useTranslation } from "react-i18next";

const AnalyticsPanel = lazy(() => import("./components/analytics-panel"));
const AdminAnnouncementsPanel = lazy(() => import("./components/admin-announcements-panel"));
const CreditOperationsPanel = lazy(() => import("./components/credit-operations-panel"));
const AccessSettingsPanel = lazy(() => import("./components/access-settings-panel"));
const EmailSettingsPanel = lazy(() => import("./components/email-settings-panel"));
const FeatureAvailabilityPanel = lazy(() => import("./components/feature-availability-panel"));

function PageFallback({ label }: { label: string }) {
    const { t } = useTranslation("canvas");
    return (
        <div className="py-16 text-center text-sm text-foreground/50">
            {t("admin:loading")}
            {label}...
        </div>
    );
}

export function AnalyticsPage() {
    const { t } = useTranslation("canvas");
    const { references } = useAdminContext();
    return (
        <AdminPageFrame title={t("admin:data-overview")} description={t("admin:active-users-usage-and-cost-trends")}>
            <Suspense fallback={<PageFallback label={t("admin:statistics")} />}>
                <AnalyticsPanel users={references.users} channels={references.channels} />
            </Suspense>
        </AdminPageFrame>
    );
}

export function AnnouncementsPage() {
    const { t } = useTranslation("canvas");
    return (
        <AdminPageFrame title={t("admin:system-announcements")} description={t("admin:publish-close-and-browse-announcements")}>
            <Suspense fallback={<PageFallback label={t("admin:system-announcements")} />}>
                <AdminAnnouncementsPanel />
            </Suspense>
        </AdminPageFrame>
    );
}

export function CreditOperationsPage() {
    const { t } = useTranslation("canvas");
    const { references } = useAdminContext();
    return (
        <AdminPageFrame title={t("admin:credit-operations")} description={t("admin:manual-credit-adjustments-and-abnormal-billing")}>
            <Suspense fallback={<PageFallback label={t("admin:credit-operations-data")} />}>
                <CreditOperationsPanel users={references.users} />
            </Suspense>
        </AdminPageFrame>
    );
}

export function AccessSettingsPage() {
    const { t } = useTranslation("canvas");
    return (
        <AdminPageFrame title={t("admin:sign-in-and-registration")} description={t("admin:registration-policy-and-linux-do")} scroll>
            <Suspense fallback={<PageFallback label={t("admin:sign-in-and-registration-settings")} />}>
                <AccessSettingsPanel />
            </Suspense>
        </AdminPageFrame>
    );
}

export function EmailSettingsPage() {
    const { t } = useTranslation("canvas");
    return (
        <AdminPageFrame title={t("admin:email-service")} description={t("admin:registration-verification-smtp")} scroll>
            <div className="pt-4">
                <Suspense fallback={<PageFallback label={t("admin:email-settings")} />}>
                    <EmailSettingsPanel />
                </Suspense>
            </div>
        </AdminPageFrame>
    );
}

export function FeatureAvailabilityPage() {
    const { t } = useTranslation("canvas");
    return (
        <AdminPageFrame title={t("admin:feature-access")} description={t("admin:control-workspace-entry-channels-and-billing-modes")} scroll>
            <Suspense fallback={<PageFallback label={t("admin:feature-access-settings")} />}>
                <FeatureAvailabilityPanel />
            </Suspense>
        </AdminPageFrame>
    );
}
