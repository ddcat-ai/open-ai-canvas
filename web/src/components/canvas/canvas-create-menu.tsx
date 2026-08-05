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
    section: "node" | "project" | "resource";
    onClick: () => void;
};

export function CanvasCreateMenu({ commands }: { commands: CanvasCreateCommand[] }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const projectCommands = commands.filter((command) => command.section === "project");
    const nodeCommands = commands.filter((command) => command.section === "node");
    const resourceCommands = commands.filter((command) => command.section === "resource");

    return (
        <div>
            <header className="flex min-h-7 items-center justify-between gap-2 border-b pb-2" style={{ borderColor: theme.toolbar.border }}>
                <h2 className="font-semibold leading-none" style={{ fontSize: "var(--fs-caption)" }}>添加节点</h2>
                {projectCommands.map((command) => (
                    <button
                        key={command.id}
                        type="button"
                        className="inline-flex h-6 min-w-0 items-center gap-1 rounded-[var(--dock-item-radius)] px-1.5 font-medium outline-none transition-colors hover:bg-black/5 focus-visible:ring-2 dark:hover:bg-white/8 [&_svg]:size-3"
                        style={{ color: theme.node.muted, fontSize: "var(--fs-tiny)", "--tw-ring-color": theme.node.muted } as CSSProperties}
                        title={command.label}
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={command.onClick}
                    >
                        {command.icon}
                        <span className="whitespace-nowrap">{command.label}</span>
                    </button>
                ))}
            </header>

            <MenuSection title="创作节点" color={theme.node.muted} />
            <CanvasCreateCommandGrid commands={nodeCommands} variant="node" />

            <MenuSection title="导入资源" color={theme.node.muted} spaced />
            <CanvasCreateCommandGrid commands={resourceCommands} variant="resource" />
        </div>
    );
}

function CanvasCreateCommandGrid({ commands, variant }: { commands: CanvasCreateCommand[]; variant: "node" | "resource" }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const reducedMotion = useReducedMotion();

    return (
        <div className={cn("grid gap-1", variant === "node" ? "grid-cols-4" : "grid-cols-2")}>
            {commands.map((command) => (
                <motion.button
                    key={command.id}
                    type="button"
                    whileHover={reducedMotion ? undefined : { y: -1 }}
                    whileTap={reducedMotion ? undefined : { scale: 0.98 }}
                    transition={aceternityMotion.spring.dock}
                    className={cn(
                        "group min-w-0 overflow-hidden border border-black/10 bg-white/70 outline-none transition-colors hover:border-black/20 hover:bg-black/5 focus-visible:ring-2 dark:border-white/10 dark:bg-white/[.04] dark:hover:border-white/20 dark:hover:bg-white/8",
                        variant === "node"
                            ? "flex h-[var(--canvas-create-node-height)] flex-col items-start justify-between rounded-[var(--dock-item-radius)] px-1 py-1.5 text-left"
                            : "flex h-[var(--canvas-create-resource-height)] items-center justify-center gap-1.5 rounded-[var(--dock-item-radius)] px-2 text-center",
                    )}
                    style={{ color: theme.node.text, "--tw-ring-color": theme.node.muted } as CSSProperties}
                    title={command.label}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={command.onClick}
                >
                    {variant === "node" ? (
                        <>
                            <span className="flex w-full min-w-0 items-center justify-between gap-1">
                                <span className="grid size-4 shrink-0 place-items-center opacity-65 transition-opacity group-hover:opacity-100 [&_svg]:size-4">{command.icon}</span>
                                {command.badge ? <span className="shrink-0 font-medium leading-none" style={{ color: theme.node.muted, fontSize: "var(--fs-tiny)" }}>{command.badge}</span> : null}
                            </span>
                            <span className="block w-full overflow-hidden text-ellipsis whitespace-nowrap font-medium leading-none" style={{ fontSize: "var(--fs-label)" }}>{command.label}</span>
                        </>
                    ) : (
                        <>
                            <span className="grid size-4 shrink-0 place-items-center opacity-65 transition-opacity group-hover:opacity-100 [&_svg]:size-3.5">{command.icon}</span>
                            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-medium leading-none" style={{ fontSize: "var(--fs-label)" }}>{command.label}</span>
                        </>
                    )}
                </motion.button>
            ))}
        </div>
    );
}

function MenuSection({ title, color, spaced = false }: { title: string; color: string; spaced?: boolean }) {
    return <h3 className="mb-1 mt-2 px-1 font-medium leading-none" style={{ color, fontSize: "var(--fs-tiny)", marginTop: spaced ? "var(--space-4)" : "var(--space-2)" }}>{title}</h3>;
}
