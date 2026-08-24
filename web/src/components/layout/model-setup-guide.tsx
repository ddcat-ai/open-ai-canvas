import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, Sparkles, X } from "lucide-react";
import { useState } from "react";

import { aceternityMotion } from "@/lib/aceternity-motion";
import { navigateToSettings } from "@/lib/settings-navigation";
import { useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { useTranslation } from "react-i18next";

export function ModelSetupGuide({ hidden = false }: { hidden?: boolean }) {
    const { t } = useTranslation("canvas");
    const reducedMotion = useReducedMotion();
    const [dismissed, setDismissed] = useState(false);
    const registrationGuide = typeof window !== "undefined" && window.sessionStorage.getItem("infinite-canvas:model-setup-guide") === "1";
    const hydrated = useUserStore((state) => state.hydrated);
    const user = useUserStore((state) => state.user);
    const models = useConfigStore((state) => state.config.models);
    if (hidden || dismissed || !hydrated || !user || user.role === "admin" || (!registrationGuide && models.length > 0)) return null;

    const close = () => {
        window.sessionStorage.removeItem("infinite-canvas:model-setup-guide");
        setDismissed(true);
    };

    const openModels = () => {
        close();
        navigateToSettings({ section: "models" });
    };

    return (
        <motion.aside
            initial={reducedMotion ? false : { opacity: 0, y: 14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: aceternityMotion.duration.panel, ease: aceternityMotion.easing.enter }}
            className="fixed bottom-5 right-5 z-[var(--z-toast)] w-[min(360px,calc(100vw-32px))] overflow-hidden rounded-2xl border border-border/70 bg-background/92 shadow-[0_24px_70px_rgba(15,23,42,.20)] backdrop-blur-2xl dark:shadow-[0_28px_80px_rgba(0,0,0,.48)]"
        >
            <div className="flex items-start gap-3 p-4">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-amber-400/25 bg-amber-400/10 text-amber-600 dark:text-amber-300">
                    <Sparkles className="size-4" />
                </span>
                <button type="button" className="min-w-0 flex-1 text-left" onClick={openModels}>
                    <span className="block text-sm font-semibold">{t("domain:choose-your-creation-models-first")}</span>
                    <span className="mt-1 block text-xs leading-5 text-foreground/55">{t("domain:set-default-models-for-image-video-and-text-pricing-shows-as-you-choose")}</span>
                    <span className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
                        {t("domain:open-model-selection")} <ArrowRight className="size-3.5" />
                    </span>
                </button>
                <button type="button" className="grid size-7 shrink-0 place-items-center rounded-full text-foreground/40 transition hover:bg-muted hover:text-foreground" onClick={close} aria-label={t("domain:close-model-setup-guide")}>
                    <X className="size-3.5" />
                </button>
            </div>
        </motion.aside>
    );
}
