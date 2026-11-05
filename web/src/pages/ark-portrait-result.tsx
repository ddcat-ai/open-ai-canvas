import { Button } from "antd";
import { ArrowLeft, CheckCircle2, CircleSlash, Clock3, LoaderCircle, XCircle, type LucideIcon } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";

const RESULT_STATUSES = ["verified", "failed", "expired", "cancelled", "pending", "invalid"] as const;
type ResultStatus = (typeof RESULT_STATUSES)[number];

const STATUS_ICON: Record<ResultStatus, { icon: LucideIcon; className: string }> = {
    verified: { icon: CheckCircle2, className: "text-status-success" },
    failed: { icon: XCircle, className: "text-status-error" },
    invalid: { icon: XCircle, className: "text-status-error" },
    expired: { icon: Clock3, className: "text-status-warning" },
    cancelled: { icon: CircleSlash, className: "text-muted-foreground" },
    pending: { icon: LoaderCircle, className: "text-status-loading motion-safe:animate-spin" },
};

/**
 * H5 真人认证完成后的回跳页。多在手机上打开、没有登录态，只根据回调结果展示文案，不读取账号数据；
 * 实际结果以服务端会话为准，电脑端会自动刷新。
 */
export default function ArkPortraitResultPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const raw = searchParams.get("status") || "";
    const status: ResultStatus = (RESULT_STATUSES as readonly string[]).includes(raw) ? (raw as ResultStatus) : "invalid";
    const backTo = searchParams.get("scope") === "platform" ? "/admin/settings/ark-private-assets" : "/settings?section=ark-assets";
    const { icon: Icon, className } = STATUS_ICON[status];
    return (
        <div className="app-workspace-page flex h-dvh flex-col overflow-hidden text-foreground">
            <main className="flex h-full min-h-0 items-center justify-center overflow-y-auto px-6 py-10">
                <section className="w-full max-w-sm text-center" aria-live="polite">
                    <Icon aria-hidden strokeWidth={1.5} className={cn("mx-auto mb-5 size-12", className)} />
                    <h1 className="text-[var(--fs-heading)] font-semibold">{t(`library.ark.result.title.${status}`)}</h1>
                    <p className="mt-3 text-[var(--fs-body)] leading-6 text-muted-foreground">{t(`library.ark.result.description.${status}`)}</p>
                    <div className="mt-8 flex justify-center">
                        <Button type="primary" icon={<ArrowLeft className="size-4" />} onClick={() => navigate(backTo, { replace: true })}>
                            {t("library.ark.result.back")}
                        </Button>
                    </div>
                    <p className="mt-4 text-[var(--fs-caption)] text-muted-foreground">{t("library.ark.result.close")}</p>
                </section>
            </main>
        </div>
    );
}
