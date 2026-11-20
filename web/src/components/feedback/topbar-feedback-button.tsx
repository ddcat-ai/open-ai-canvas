import { useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useUserFeedbackEnabled } from "@/lib/plugins/builtin/user-feedback";
import { FeedbackModal } from "./feedback-modal";

export function TopbarFeedbackButton() {
    const { t } = useTranslation();
    const enabled = useUserFeedbackEnabled();
    const [open, setOpen] = useState(false);

    if (!enabled) return null;

    return (
        <>
            <button type="button" className="app-workspace-topbar-icon-button" aria-label={t("account.feedback.buttonLabel")} title={t("account.feedback.buttonTitle")} onClick={() => setOpen(true)}>
                <MessageSquarePlus aria-hidden="true" />
            </button>
            <FeedbackModal open={open} onClose={() => setOpen(false)} />
        </>
    );
}
