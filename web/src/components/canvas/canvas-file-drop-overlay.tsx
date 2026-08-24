import { AnimatePresence, motion } from "motion/react";
import { FileImage, Film, Music2, UploadCloud } from "lucide-react";

import type { CanvasTheme } from "@/lib/canvas-theme";
import { aceternityMotion } from "@/lib/aceternity-motion";
import { useTranslation } from "react-i18next";

export function CanvasFileDropOverlay({ active, theme }: { active: boolean; theme: CanvasTheme }) {
    const { t } = useTranslation("canvas");
    return (
        <AnimatePresence>
            {active ? (
                <motion.div
                    data-canvas-no-zoom
                    aria-live="polite"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: aceternityMotion.duration.state }}
                    className="pointer-events-none absolute inset-3 z-[var(--z-modal-overlay)] grid place-items-center overflow-hidden rounded-[var(--r-5xl)] border backdrop-blur-2xl"
                    style={{ background: theme.spatial.dropzone, borderColor: theme.spatial.glowStrong, color: theme.node.text, boxShadow: `inset 0 0 0 1px ${theme.spatial.glow}, 0 30px 100px rgba(0,0,0,.22)` }}
                >
                    <div className="aceternity-drop-grid absolute inset-0 opacity-70" style={{ color: theme.spatial.glowStrong }} />
                    <motion.div
                        initial={{ y: 20, scale: 0.94 }}
                        animate={{ y: 0, scale: 1 }}
                        exit={{ y: 12, scale: 0.96 }}
                        transition={aceternityMotion.spring.panel}
                        className="relative flex w-[min(480px,calc(100vw-48px))] flex-col items-center px-8 py-10 text-center"
                    >
                        <div className="relative mb-8 h-32 w-44">
                            <motion.div animate={{ x: -22, y: 10, rotate: -8 }} className="absolute inset-0 rounded-[var(--r-3xl)] border backdrop-blur-xl" style={{ background: theme.spatial.surface, borderColor: theme.toolbar.border }} />
                            <motion.div animate={{ x: 22, y: 10, rotate: 8 }} className="absolute inset-0 rounded-[var(--r-3xl)] border backdrop-blur-xl" style={{ background: theme.spatial.surface, borderColor: theme.toolbar.border }} />
                            <motion.div
                                animate={{ y: -10, scale: 1.04 }}
                                transition={aceternityMotion.spring.panel}
                                className="absolute inset-0 grid place-items-center rounded-[var(--r-3xl)] border"
                                style={{ background: theme.node.panel, borderColor: theme.spatial.glowStrong, boxShadow: `0 24px 60px ${theme.spatial.shadow}` }}
                            >
                                <UploadCloud className="size-10" style={{ color: theme.accent.primary }} />
                            </motion.div>
                        </div>
                        <h2 className="text-2xl font-semibold tracking-normal">{t("domain:drop-files-into-your-creation-space")}</h2>
                        <p className="mt-2 text-sm leading-6" style={{ color: theme.node.muted }}>
                            {t("domain:images-videos-and-audio-become-connectable-nodes-at-the-drop-position")}
                        </p>
                        <div className="mt-6 flex items-center gap-2 text-xs font-medium" style={{ color: theme.node.muted }}>
                            <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5" style={{ borderColor: theme.toolbar.border, background: theme.spatial.surface }}>
                                <FileImage className="size-3.5" />
                                {t("canvas:images-3")}
                            </span>
                            <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5" style={{ borderColor: theme.toolbar.border, background: theme.spatial.surface }}>
                                <Film className="size-3.5" />
                                {t("canvas:videos-4")}
                            </span>
                            <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5" style={{ borderColor: theme.toolbar.border, background: theme.spatial.surface }}>
                                <Music2 className="size-3.5" />
                                {t("canvas:audio-3")}
                            </span>
                        </div>
                    </motion.div>
                </motion.div>
            ) : null}
        </AnimatePresence>
    );
}
