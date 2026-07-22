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
                        "group relative min-w-0 border border-black/10 bg-white/70 text-center outline-none transition-colors hover:border-black/20 hover:bg-black/5 focus-visible:ring-2 dark:border-white/10 dark:bg-white/[.04] dark:hover:border-white/20 dark:hover:bg-white/8",
                        variant === "node" ? "flex h-12 flex-col items-center justify-center gap-1 rounded-[10px]" : "flex h-9 items-center justify-center gap-1.5 rounded-[9px] px-2",
                    )}
                    style={{ color: theme.node.text, "--tw-ring-color": theme.node.muted } as CSSProperties}
                    title={command.label}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={command.onClick}
                >
                    <span className="grid size-5 shrink-0 place-items-center opacity-65 transition-opacity group-hover:opacity-100 [&_svg]:size-3.5">{command.icon}</span>
                    <span className="max-w-full truncate text-[9px] font-semibold leading-none">{command.label}</span>
                    {command.badge ? <span className="absolute right-1 top-1 rounded-full border px-1 py-0.5 text-[6px] font-bold leading-none" style={{ background: theme.toolbar.activeBg, borderColor: theme.toolbar.border, color: theme.node.muted }}>{command.badge}</span> : null}
                </motion.button>
            ))}
        </div>
    );
}
