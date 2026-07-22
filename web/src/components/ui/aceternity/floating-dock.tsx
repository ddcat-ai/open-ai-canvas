import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring, useTransform, type MotionValue } from "motion/react";
import { forwardRef, useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { aceternityMotion } from "@/lib/aceternity-motion";

export type FloatingDockCommand = {
    kind?: "command";
    id: string;
    label: string;
    icon: ReactNode;
    onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
    active?: boolean;
    disabled?: boolean;
    danger?: boolean;
};

export type FloatingDockEntry = FloatingDockCommand | { kind: "separator"; id: string };

type FloatingDockProps = {
    items: FloatingDockEntry[];
    size?: "default" | "compact";
    embedded?: boolean;
    className?: string;
    style?: CSSProperties;
    ariaLabel?: string;
};

type DockMetrics = {
    base: number;
    magnified: number;
    icon: number;
    iconMagnified: number;
    distance: number;
};

const DOCK_METRICS: Record<NonNullable<FloatingDockProps["size"]>, DockMetrics> = {
    default: { base: 29, magnified: 43, icon: 14, iconMagnified: 19, distance: 108 },
    compact: { base: 25, magnified: 35, icon: 13, iconMagnified: 17, distance: 88 },
};

const TOUCH_DOCK_METRICS: Record<NonNullable<FloatingDockProps["size"]>, DockMetrics> = {
    default: { base: 40, magnified: 40, icon: 18, iconMagnified: 18, distance: 0 },
    compact: { base: 36, magnified: 36, icon: 16, iconMagnified: 16, distance: 0 },
};

export const FloatingDock = forwardRef<HTMLDivElement, FloatingDockProps>(function FloatingDock({ items, size = "default", embedded = false, className, style, ariaLabel = "画布工具" }, forwardedRef) {
    const mouseX = useMotionValue(Number.POSITIVE_INFINITY);
    const reducedMotion = useReducedMotion();
    const [coarsePointer, setCoarsePointer] = useState(() => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches);

    useEffect(() => {
        const media = window.matchMedia("(pointer: coarse)");
        const update = () => setCoarsePointer(media.matches);
        update();
        media.addEventListener("change", update);
        return () => media.removeEventListener("change", update);
    }, []);

    const motionEnabled = !reducedMotion && !coarsePointer;
    const metrics = coarsePointer ? TOUCH_DOCK_METRICS[size] : DOCK_METRICS[size];

    return (
        <motion.div
            ref={forwardedRef}
            role="toolbar"
            aria-label={ariaLabel}
            className={cn(
                "aceternity-floating-dock flex items-end overflow-visible",
                embedded ? "shadow-none" : "border backdrop-blur-2xl",
                coarsePointer
                    ? embedded
                        ? size === "compact" ? "h-10 gap-1 px-0.5" : "h-11 gap-1 px-0.5"
                        : size === "compact" ? "h-11 gap-1 rounded-[15px] px-1.5 pb-1" : "h-12 gap-1 rounded-[17px] px-2 pb-1"
                    : embedded
                        ? size === "compact" ? "h-8 gap-0.5 px-0.5 pb-0.5" : "h-9 gap-0.5 px-0.5 pb-0.5"
                        : size === "compact" ? "h-8 gap-0.5 rounded-[12px] px-1 pb-1" : "h-10 gap-0.5 rounded-[14px] px-1.5 pb-1",
                className,
            )}
            style={style}
            onPointerMove={(event) => {
                if (motionEnabled) mouseX.set(event.clientX);
            }}
            onPointerLeave={() => mouseX.set(Number.POSITIVE_INFINITY)}
        >
            {items.map((item) => item.kind === "separator" ? <DockSeparator key={item.id} compact={size === "compact"} /> : <DockCommandButton key={item.id} command={item} mouseX={mouseX} metrics={metrics} motionEnabled={motionEnabled} compact={size === "compact"} />)}
        </motion.div>
    );
});

function DockCommandButton({ command, mouseX, metrics, motionEnabled, compact }: { command: FloatingDockCommand; mouseX: MotionValue<number>; metrics: DockMetrics; motionEnabled: boolean; compact: boolean }) {
    const ref = useRef<HTMLSpanElement>(null);
    const [focused, setFocused] = useState(false);
    const [hovered, setHovered] = useState(false);
    const distance = useTransform(mouseX, (value) => {
        const bounds = ref.current?.getBoundingClientRect();
        if (!bounds || !Number.isFinite(value)) return Number.POSITIVE_INFINITY;
        return value - bounds.left - bounds.width / 2;
    });
    const itemTarget = useTransform(distance, (value) => proximitySize(value, metrics.base, metrics.magnified, metrics.distance, motionEnabled));
    const iconTarget = useTransform(distance, (value) => proximitySize(value, metrics.icon, metrics.iconMagnified, metrics.distance, motionEnabled));
    const itemSize = useSpring(itemTarget, aceternityMotion.spring.dock);
    const iconSize = useSpring(iconTarget, aceternityMotion.spring.dock);
    const showTooltip = (hovered || focused) && !command.disabled;

    return (
        <motion.span ref={ref} className="relative block shrink-0" style={{ width: itemSize, height: itemSize }}>
            {/* 放大项留在 Flex 流内，由布局推开邻项，保持 Aceternity Floating Dock 的空间关系。 */}
            <motion.button
                type="button"
                aria-label={command.label}
                aria-pressed={command.active || undefined}
                disabled={command.disabled}
                className={cn("aceternity-dock-command group relative grid size-full place-items-center rounded-full border outline-none", command.active && "is-active", command.danger && "is-danger")}
                whileTap={motionEnabled && !command.disabled ? { scale: 0.92 } : undefined}
                transition={aceternityMotion.spring.dock}
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onClick={command.onClick}
            >
                <motion.span className="grid place-items-center" style={{ width: iconSize, height: iconSize }}>
                    {command.icon}
                </motion.span>
                <AnimatePresence>
                    {showTooltip ? (
                        <motion.span
                            initial={{ opacity: 0, y: 7, scale: 0.94 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 4, scale: 0.96 }}
                            transition={{ duration: aceternityMotion.duration.instant, ease: aceternityMotion.easing.enter }}
                            className={cn("aceternity-dock-tooltip pointer-events-none absolute left-1/2 z-[140] -translate-x-1/2 whitespace-nowrap border font-medium shadow-xl backdrop-blur-xl", compact ? "-top-7 rounded-md px-1.5 py-0.5 text-[9px]" : "-top-8 rounded-md px-2 py-1 text-[10px]")}
                        >
                            {command.label}
                        </motion.span>
                    ) : null}
                </AnimatePresence>
            </motion.button>
        </motion.span>
    );
}

function DockSeparator({ compact }: { compact: boolean }) {
    return <span aria-hidden className={cn("aceternity-dock-separator mb-0.5 shrink-0 self-center", compact ? "mx-0.5 h-3.5 w-px" : "mx-0.5 h-4 w-px")} />;
}

function proximitySize(distance: number, base: number, magnified: number, range: number, enabled: boolean) {
    if (!enabled || !Number.isFinite(distance)) return base;
    const proximity = 1 - Math.min(Math.abs(distance) / range, 1);
    return base + (magnified - base) * proximity * proximity;
}
