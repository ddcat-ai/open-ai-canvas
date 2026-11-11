import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { useThemePack } from "@/themes/use-theme-pack";

export type WorkspaceSignalIconVariant = "home" | "canvas" | "projects" | "assets" | "skills" | "tasks" | "wallet" | "settings" | "empty" | "error" | "loading";

/**
 * 页面空态、加载与错误的统一图标：单色低饱和线条 + 一个强调点（主色；错误为危险色）。
 * 不使用多色渐变，不在悬停时缩放；入场总时长不超过 300ms，减少动态效果时直接显示。
 * 当前皮肤的主题包提供了 signalArt 时，48×48 画布里的内容改由主题包绘制。
 */
export function WorkspaceSignalIcon({ variant, size = "md", className }: { variant: WorkspaceSignalIconVariant; size?: "sm" | "md" | "lg"; className?: string }) {
    const reducedMotion = Boolean(useReducedMotion());
    const dimension = size === "sm" ? 32 : size === "lg" ? 64 : 44;
    const dotColor = variant === "error" ? "var(--status-error)" : "var(--workspace-accent)";
    const ThemeArt = useThemePack()?.signalArt;
    const [dotX, dotY] = signalDot(variant);

    return (
        <motion.span
            initial={reducedMotion ? false : { opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className={cn("workspace-signal-icon relative grid shrink-0 place-items-center", className)}
            style={{ width: dimension, height: dimension }}
            aria-hidden="true"
        >
            <svg viewBox="0 0 48 48" className="h-full w-full overflow-visible" fill="none">
                {ThemeArt ? (
                    <ThemeArt path={signalPath(variant)} dot={[dotX, dotY]} error={variant === "error"} reducedMotion={reducedMotion} />
                ) : (
                    <>
                        <rect x="3.5" y="3.5" width="41" height="41" rx="12" className="fill-[var(--library-icon-surface,var(--background))] stroke-border" />
                        <motion.path
                            d={signalPath(variant)}
                            stroke="var(--text-tertiary)"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            initial={reducedMotion ? false : { pathLength: 0, opacity: 0 }}
                            animate={{ pathLength: 1, opacity: 1 }}
                            transition={{ duration: 0.25, delay: 0.04, ease: [0.22, 1, 0.36, 1] }}
                        />
                        <motion.circle cx={dotX} cy={dotY} r="2.5" fill={dotColor} initial={reducedMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15, delay: 0.15, ease: "easeOut" }} />
                    </>
                )}
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
