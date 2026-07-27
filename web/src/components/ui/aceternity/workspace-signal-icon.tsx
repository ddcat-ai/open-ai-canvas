import { useId } from "react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";

export type WorkspaceSignalIconVariant = "home" | "canvas" | "projects" | "assets" | "skills" | "tasks" | "wallet" | "settings" | "empty" | "error" | "loading";

const palettes: Record<WorkspaceSignalIconVariant, [string, string, string]> = {
    home: ["#2563eb", "#06b6d4", "#f59e0b"],
    canvas: ["#2563eb", "#14b8a6", "#f97316"],
    projects: ["#f59e0b", "#f97316", "#2563eb"],
    assets: ["#06b6d4", "#2563eb", "#ec4899"],
    skills: ["#ec4899", "#f97316", "#2563eb"],
    tasks: ["#2563eb", "#22c55e", "#f59e0b"],
    wallet: ["#f59e0b", "#eab308", "#14b8a6"],
    settings: ["#2563eb", "#64748b", "#14b8a6"],
    empty: ["#64748b", "#2563eb", "#06b6d4"],
    error: ["#ef4444", "#f97316", "#f59e0b"],
    loading: ["#2563eb", "#06b6d4", "#14b8a6"],
};

export function WorkspaceSignalIcon({ variant, size = "md", className }: { variant: WorkspaceSignalIconVariant; size?: "sm" | "md" | "lg"; className?: string }) {
    const instanceId = useId().replace(/:/g, "");
    const reducedMotion = useReducedMotion();
    const [primary, secondary, accent] = palettes[variant];
    const gradientId = `workspace-signal-${variant}-${instanceId}`;
    const dimension = size === "sm" ? 32 : size === "lg" ? 56 : 42;
    const initial = reducedMotion ? false : { opacity: 0, scale: 0.86, rotate: -4 };

    return (
        <motion.span
            initial={initial}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            className={cn("workspace-signal-icon group/signal relative grid shrink-0 place-items-center", className)}
            style={{ width: dimension, height: dimension }}
            aria-hidden="true"
        >
            <svg viewBox="0 0 48 48" className="h-full w-full overflow-visible" fill="none">
                <defs>
                    <linearGradient id={gradientId} x1="8" y1="7" x2="40" y2="41" gradientUnits="userSpaceOnUse">
                        <stop stopColor={primary} />
                        <stop offset="0.55" stopColor={secondary} />
                        <stop offset="1" stopColor={accent} />
                    </linearGradient>
                </defs>
                <rect x="3.5" y="3.5" width="41" height="41" rx="11.5" className="fill-background/92 stroke-border" />
                <motion.path
                    d={signalPath(variant)}
                    stroke={`url(#${gradientId})`}
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    initial={reducedMotion ? false : { pathLength: 0, opacity: 0 }}
                    animate={{ pathLength: 1, opacity: 1 }}
                    transition={{ duration: 0.48, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
                    className="origin-center transition-transform duration-200 ease-out group-hover/signal:scale-[1.04]"
                />
                <motion.circle
                    cx={signalDot(variant)[0]}
                    cy={signalDot(variant)[1]}
                    r="2.7"
                    fill={accent}
                    initial={reducedMotion ? false : { scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.24, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
                    className="origin-center transition-transform duration-150 group-hover/signal:scale-125"
                />
            </svg>
        </motion.span>
    );
}

function signalPath(variant: WorkspaceSignalIconVariant) {
    if (variant === "home") return "M13 29V20L24 12L35 20V35H28V27H20V35H15";
    if (variant === "canvas") return "M12 15H27V27H12V15ZM21 27V35H36V22H27M16 20H23";
    if (variant === "projects") return "M11 18H22L25 21H37V35H11V18ZM17 14H29";
    if (variant === "assets") return "M11 14H37V34H11V14ZM15 29L21 23L26 28L30 24L36 31";
    if (variant === "skills") return "M24 10L27 19L36 22L27 26L24 36L21 26L12 22L21 19L24 10Z";
    if (variant === "tasks") return "M12 16H30M12 24H25M12 32H22M31 29L34 32L39 25";
    if (variant === "wallet") return "M12 17H36V34H12V17ZM12 21H36M29 27H34";
    if (variant === "settings") return "M12 16H36M12 24H36M12 32H36M19 13V19M29 21V27M23 29V35";
    if (variant === "error") return "M24 11L38 36H10L24 11ZM24 19V27M24 32V32.5";
    if (variant === "loading") return "M34 17A13 13 0 1 0 36 28M34 17V10M34 17H27";
    return "M14 30C17 20 31 18 35 27M14 30H21M14 30V23";
}

function signalDot(variant: WorkspaceSignalIconVariant): [number, number] {
    if (variant === "home") return [34, 20];
    if (variant === "canvas") return [35, 22];
    if (variant === "projects") return [35, 21];
    if (variant === "assets") return [30, 20];
    if (variant === "skills") return [35, 13];
    if (variant === "tasks") return [38, 25];
    if (variant === "wallet") return [31, 27];
    if (variant === "settings") return [29, 24];
    if (variant === "error") return [24, 32];
    if (variant === "loading") return [34, 11];
    return [34, 27];
}
