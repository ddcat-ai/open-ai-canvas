import { motion, useReducedMotion } from "motion/react";
import type { CSSProperties, ReactNode } from "react";

import { aceternityMotion } from "@/lib/aceternity-motion";
import { canvasThemes } from "@/lib/canvas-theme";
import { cn } from "@/lib/utils";
import { useThemeStore } from "@/stores/use-theme-store";

export type CanvasCreateCommand = {
    id: string;
    label: string;
    icon: ReactNode;
    badge?: string;
    onClick: () => void;
};

export function CanvasCreateCommandGrid({ commands, variant = "node" }: { commands: CanvasCreateCommand[]; variant?: "node" | "resource" }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const reducedMotion = useReducedMotion();
    return (
        <div className={cn("grid gap-1", variant === "node" ? "grid-cols-4" : "grid-cols-2")}>
            {commands.map((command) => (
                <motion.button
                    key={command.id}
                    type="button"
                    whileHover={reducedMotion ? undefined : { y: -2, scale: 1.02 }}
                    whileTap={reducedMotion ? undefined : { scale: 0.96 }}
                    transition={aceternityMotion.spring.dock}
                    className={cn(
                        "group relative min-w-0 overflow-hidden border border-black/10 bg-white/70 text-center outline-none transition-colors hover:border-black/20 hover:bg-black/5 focus-visible:ring-2 dark:border-white/10 dark:bg-white/[.04] dark:hover:border-white/20 dark:hover:bg-white/8",
                        variant === "node" ? "flex h-[var(--dock-create-node-height)] flex-col items-center rounded-[var(--dock-item-radius)]" : "flex h-9 items-center justify-center gap-1.5 rounded-[var(--dock-item-radius)] px-2",
                    )}
                    style={{ color: theme.node.text, "--tw-ring-color": theme.node.muted } as CSSProperties}
                    title={command.label}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={command.onClick}
                >
                    {variant === "node" ? <span className="flex h-4 w-full shrink-0 items-start justify-end px-1 pt-1">
                        {command.badge ? <span className="inline-flex max-w-full items-center rounded-full border px-1 py-0.5 text-[var(--fs-nano)] font-bold leading-none" style={{ background: theme.toolbar.activeBg, borderColor: theme.toolbar.border, color: theme.node.muted }}>{command.badge}</span> : null}
                    </span> : null}
                    <span className="flex min-h-0 w-full min-w-0 flex-1 flex-col items-center justify-center gap-1 overflow-hidden px-1">
                        <span className="grid size-5 shrink-0 place-items-center opacity-65 transition-opacity group-hover:opacity-100 [&_svg]:size-3.5">{command.icon}</span>
                        <span className="block max-w-full truncate whitespace-nowrap text-[var(--fs-micro)] font-semibold leading-none" title={command.label}>{command.label}</span>
                    </span>
                </motion.button>
            ))}
        </div>
    );
}
