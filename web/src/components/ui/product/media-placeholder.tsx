import { ImageOff, Layers3 } from "lucide-react";
import { useTranslation } from "react-i18next";

export function MediaPlaceholder({ failed = false, label }: { failed?: boolean; label?: string }) {
    const { t } = useTranslation();
    const Icon = failed ? ImageOff : Layers3;
    return <span className="product-media-placeholder" role={failed ? "img" : undefined} aria-label={failed ? t("account.ui.media.failed") : undefined}>
        <span className="product-media-placeholder-icon"><Icon aria-hidden="true" /></span>
        <span>{label || (failed ? t("account.ui.media.unavailable") : t("account.ui.media.empty"))}</span>
    </span>;
}
