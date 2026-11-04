import { useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useUserFeedbackEnabled } from "@/lib/plugins/builtin/user-feedback";
import { FeedbackModal } from "./feedback-modal";

/** 顶栏固定反馈入口：与积分胶囊同一行，不再悬浮遮挡页面内容。 */
export function TopbarFeedbackButton() {
    const { t } = useTranslation();
    const enabled = useUserFeedbackEnabled();
    const [open, setOpen] = useState(false);

    if (!enabled) return null;

    return (
        <>
            <button type="button" className="app-workspace-topbar-feedback-pill" aria-label={t("account.feedback.buttonLabel")} title={t("account.feedback.buttonTitle")} onClick={() => setOpen(true)}>
                <MessageSquarePlus aria-hidden="true" />
                <span>{t("account.feedback.button")}</span>
            </button>
            <FeedbackModal open={open} onClose={() => setOpen(false)} />
        </>
    );
}
