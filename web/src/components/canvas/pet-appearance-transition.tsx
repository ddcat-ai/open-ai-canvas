import type { ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { CanvasAppearance } from "@/lib/canvas/agent-appearance";

/** Crossfade model changes without moving a card's copy or interrupting sprite frames. */
export function PetAppearanceTransition({ appearance, resolved = true, reducedMotion, children }: { appearance: CanvasAppearance; resolved?: boolean; reducedMotion: boolean; children: ReactNode }) {
    const identity = resolved ? `${appearance.avatarType}:${appearance.spriteResourceId || ""}:${appearance.live2dResourceId || ""}:${appearance.live2dEntry || ""}:${appearance.avatarBundleResourceId || ""}` : "loading";
    return (
        <span data-pet-presentation style={{ display: "inline-grid", placeItems: "center", verticalAlign: "middle" }}>
            <AnimatePresence initial={!reducedMotion}>
                <motion.span
                    key={identity}
                    style={{ gridArea: "1 / 1", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                    initial={reducedMotion ? false : { opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: reducedMotion ? 0 : -2 }}
                    transition={{ duration: reducedMotion ? 0 : 0.18, ease: "easeOut" }}
                >
                    {children}
                </motion.span>
            </AnimatePresence>
        </span>
    );
}
