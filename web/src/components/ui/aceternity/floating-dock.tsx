import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring, useTransform, type MotionValue } from "motion/react";
import { forwardRef, useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { aceternityMotion } from "@/lib/aceternity-motion";

export type FloatingDockCommand = {
    kind?: "command";
    id: string;
    label: string;
    displayLabel?: string;
    icon: ReactNode;
    onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
    active?: boolean;
    expanded?: boolean;
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
    showLabels?: boolean;
};

type DockMetrics = {
    base: number;
    magnified: number;
    icon: number;
    iconMagnified: number;
    distance: number;
};

const DOCK_METRICS: Record<NonNullable<FloatingDockProps["size"]>, DockMetrics> = {
    default: { base: 29, magnified: 34, icon: 14, iconMagnified: 16, distance: 64 },
    compact: { base: 25, magnified: 29, icon: 13, iconMagnified: 15, distance: 52 },
};

const TOUCH_DOCK_METRICS: Record<NonNullable<FloatingDockProps["size"]>, DockMetrics> = {
    default: { base: 40, magnified: 40, icon: 18, iconMagnified: 18, distance: 0 },
    compact: { base: 36, magnified: 36, icon: 16, iconMagnified: 16, distance: 0 },
};

type GroupSlice = { kind: "group"; items: FloatingDockCommand[] };

function partitionIntoGroups(items: FloatingDockEntry[]): GroupSlice[] {
    const slices: GroupSlice[] = [];
    let buffer: FloatingDockCommand[] = [];
    const flush = () => {
        if (buffer.length) {
            slices.push({ kind: "group", items: buffer });
            buffer = [];
        }
    };
    for (const item of items) {
        if (item.kind === "separator") {
            flush();
        } else {
            buffer.push(item);
        }
    }
    flush();
    return slices;
}

export const FloatingDock = forwardRef<HTMLDivElement, FloatingDockProps>(function FloatingDock(
    { items, size = "default", embedded = false, className, style, ariaLabel = "画布工具", showLabels: showLabelsProp },
    forwardedRef,
) {
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

    // P2-6: auto-enable labels on touch devices when caller didn't explicitly set the flag
    const showLabels = showLabelsProp !== undefined ? showLabelsProp : (coarsePointer ? true : false);
    const motionEnabled = !reducedMotion && !coarsePointer;
    const metrics = coarsePointer ? TOUCH_DOCK_METRICS[size] : DOCK_METRICS[size];

    const slices = partitionIntoGroups(items);

    return (
        <motion.div
            ref={forwardedRef}
            role="toolbar"
            aria-label={ariaLabel}
            className={cn(
                "aceternity-floating-dock flex overflow-visible",
                showLabels ? "items-center" : "items-end",
                embedded ? "shadow-none" : "border backdrop-blur-2xl",
                showLabels
                    ? embedded
                        ? size === "compact" ? "h-9 gap-0.5 px-0.5" : "h-10 gap-0.5 px-0.5"
                        : size === "compact" ? "h-10 gap-0.5 rounded-[13px] px-1.5" : "h-11 gap-0.5 rounded-[15px] px-2"
                    : coarsePointer
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
            {slices.map((slice) => (
                <DockGroup key={`group-${slice.items.map((i) => i.id).join("-")}`} labeled={showLabels} embedded={embedded}>
                    {slice.items.map((item) => (
                        <DockCommandButton
                            key={item.id}
                            command={item}
                            mouseX={mouseX}
                            metrics={metrics}
                            motionEnabled={motionEnabled && !showLabels}
                            compact={size === "compact"}
                            showLabel={showLabels}
                        />
                    ))}
                </DockGroup>
            ))}
        </motion.div>
    );
});

function DockGroup({ children, embedded }: { children: ReactNode; labeled: boolean; embedded: boolean }) {
    return (
        <div className={cn("aceternity-dock-group flex items-center gap-0.5", embedded && "!m-0")}>
            {children}
        </div>
    );
}

function DockCommandButton({ command, mouseX, metrics, motionEnabled, compact, showLabel }: { command: FloatingDockCommand; mouseX: MotionValue<number>; metrics: DockMetrics; motionEnabled: boolean; compact: boolean; showLabel: boolean }) {
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
    const showTooltip = !showLabel && (hovered || focused) && !command.disabled;

    // P0-2: 明确 aria 语义——expanded 用于面板展开类按钮，active 用于切换/工具模式类按钮
    const ariaExpanded = command.expanded !== undefined ? command.expanded : undefined;
    const ariaPressed = command.expanded === undefined ? command.active || undefined : undefined;

    if (showLabel) {
        return (
            <motion.span ref={ref} className="relative block h-8 shrink-0">
                <motion.button
                    type="button"
                    aria-label={command.label}
                    aria-expanded={ariaExpanded}
                    aria-pressed={ariaPressed}
                    disabled={command.disabled}
                    className={cn("aceternity-dock-command is-labeled group inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-[9px] border-0 px-2.5 outline-none", command.active && "is-active", command.danger && "is-danger")}
                    whileTap={!command.disabled ? { scale: 0.96 } : undefined}
                    transition={aceternityMotion.spring.dock}
                    onMouseEnter={() => setHovered(true)}
                    onMouseLeave={() => setHovered(false)}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    onClick={command.onClick}
                >
                    <span className="grid size-3.5 shrink-0 place-items-center">{command.icon}</span>
                    <span className="inline-flex h-4 items-center text-canvas-label font-medium leading-none">{command.displayLabel || command.label}</span>
                </motion.button>
            </motion.span>
        );
    }

    return (
        <motion.span ref={ref} className="relative block shrink-0" style={{ width: itemSize, height: itemSize }}>
            <motion.button
                type="button"
                aria-label={command.label}
                aria-expanded={ariaExpanded}
                aria-pressed={ariaPressed}
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
                            className={cn("aceternity-dock-tooltip pointer-events-none absolute left-1/2 z-[140] -translate-x-1/2 whitespace-nowrap border font-medium shadow-xl backdrop-blur-xl", compact ? "-top-7 rounded-md px-1.5 py-0.5 text-canvas-caption" : "-top-8 rounded-md px-2 py-1 text-canvas-tooltip")}
                        >
                            {command.label}
                        </motion.span>
                    ) : null}
                </AnimatePresence>
            </motion.button>
        </motion.span>
    );
}

function proximitySize(distance: number, base: number, magnified: number, range: number, enabled: boolean) {
    if (!enabled || !Number.isFinite(distance)) return base;
    const proximity = 1 - Math.min(Math.abs(distance) / range, 1);
    return base + (magnified - base) * proximity * proximity;
}
