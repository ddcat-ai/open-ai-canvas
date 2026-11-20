import { motion, useReducedMotion } from "motion/react";
import { ScrollText } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { useTranslation } from "react-i18next";

import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { aceternityMotion } from "@/lib/aceternity-motion";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { updateAnnouncementVersion } from "@/lib/update-announcement";
import { UpdateAnnouncementContent } from "./update-announcement-content";

export function AppChangelogDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { t } = useTranslation();
    const reducedMotion = useReducedMotion();
    const updates = useAppearanceStore((state) => state.appearance.updates);
    const custom = Boolean(updates?.enabled);
    const version = updateAnnouncementVersion(updates, __APP_VERSION__);

    return (
        <AppModal
            rootClassName="app-spatial-modal app-changelog-modal"
            title={
                <div className="app-changelog-heading">
                    <span className="app-changelog-heading-icon">
                        <ScrollText className="size-4" />
                    </span>
                    <div className="app-changelog-heading-copy">
                        <div className="app-changelog-heading-title">{custom ? t("account.layout.changelog.announcements") : t("account.layout.changelog.log")}</div>
                        <div className="app-changelog-heading-description">{custom ? t("account.layout.changelog.announcementsDescription") : t("account.layout.changelog.logDescription")}</div>
                    </div>
                    <span className="app-changelog-current-version">{t("account.layout.changelog.currentVersion", { version })}</span>
                </div>
            }
            open={open}
            width={820}
            footer={null}
            centered
            onCancel={onClose}
            modalRender={(node) => (
                <motion.div initial={reducedMotion ? false : { opacity: 0, y: 14, scale: 0.975 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: aceternityMotion.duration.panel, ease: aceternityMotion.easing.enter }}>
                    {node}
                </motion.div>
            )}
        >
            <div className="app-changelog-scroll thin-scrollbar">
                {custom && updates ? (
                    <UpdateAnnouncementContent value={updates} />
                ) : (
                    <ReactMarkdown
                        components={{
                            h1: () => null,
                            h2: ({ children }) => {
                                const label = String(children);
                                const latest = label === "Unreleased";

                                return (
                                    <h3 className={`app-changelog-section-heading${latest ? " is-latest" : ""}`}>
                                        <span className="app-changelog-section-marker" aria-hidden="true" />
                                        <span>{latest ? t("account.layout.changelog.unreleased") : label}</span>
                                        {latest ? <span className="app-changelog-latest-badge">{t("account.layout.changelog.latest")}</span> : null}
                                    </h3>
                                );
                            },
                            ul: ({ children }) => <ul className="app-changelog-list">{children}</ul>,
                            li: ({ children }) => <li>{children}</li>,
                            p: ({ children }) => <p className="app-changelog-paragraph">{children}</p>,
                            code: ({ children }) => <code className="app-changelog-code">{children}</code>,
                        }}
                    >
                        {__APP_CHANGELOG__}
                    </ReactMarkdown>
                )}
            </div>
        </AppModal>
    );
}
