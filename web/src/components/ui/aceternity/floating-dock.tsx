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
    wide?: boolean;
    quiet?: boolean;
    onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
    active?: boolean;
    disabled?: boolean;
    danger?: boolean;
    /** 面板展开型工具——使用 aria-expanded 而非 aria-pressed */
    expands?: boolean;
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
    default: { base: 29, magnified: 43, icon: 14, iconMagnified: 19, distance: 108 },
    compact: { base: 25, magnified: 35, icon: 13, iconMagnified: 17, distance: 88 },
};

const TOUCH_DOCK_METRICS: Record<NonNullable<FloatingDockProps["size"]>, DockMetrics> = {
    default: { base: 40, magnified: 40, icon: 18, iconMagnified: 18, distance: 0 },
    compact: { base: 36, magnified: 36, icon: 16, iconMagnified: 16, distance: 0 },
};

export const FloatingDock = forwardRef<HTMLDivElement, FloatingDockProps>(function FloatingDock({ items, size = "default", embedded = false, className, style, ariaLabel = "画布工具", showLabels = false }, forwardedRef) {
    const mouseX = useMotionValue(Number.POSITIVE_INFINITY);
    const reducedMotion = useReducedMotion();
    const [coarsePointer, setCoarsePointer] = useState(() => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches);
    // 窄屏下 dock 按钮总宽易超出可用宽度：此时允许横向滚动并禁用放大（放大依赖 overflow-visible，与滚动互斥）
    const [narrow, setNarrow] = useState(() => (typeof window !== "undefined" ? window.innerWidth < 768 : false));

    useEffect(() => {
        const media = window.matchMedia("(pointer: coarse)");
        const update = () => setCoarsePointer(media.matches);
        update();
        media.addEventListener("change", update);
        return () => media.removeEventListener("change", update);
    }, []);

    useEffect(() => {
        const update = () => setNarrow(window.innerWidth < 768);
        window.addEventListener("resize", update);
        return () => window.removeEventListener("resize", update);
    }, []);

    // scrollable 场景（触屏或窄屏）禁用放大并允许横向滚动，保证按钮始终可达
    const scrollable = coarsePointer || narrow;
    const motionEnabled = !reducedMotion && !scrollable;
    const metrics = coarsePointer ? TOUCH_DOCK_METRICS[size] : DOCK_METRICS[size];

    return (
        <motion.div
            ref={forwardedRef}
            role="toolbar"
            aria-label={ariaLabel}
            className={cn(
                "aceternity-floating-dock flex",
                scrollable ? "overflow-x-auto" : "overflow-visible",
                showLabels ? "items-center" : "items-end",
                embedded ? "shadow-none" : "border backdrop-blur-2xl",
                showLabels
                    ? embedded
                        ? size === "compact"
                            ? "h-9 gap-0.5 px-0.5"
                            : "h-10 gap-0.5 px-0.5"
                        : size === "compact"
                          ? "h-10 gap-0.5 rounded-[var(--dock-radius-compact)] px-1.5"
                          : "h-11 gap-0.5 rounded-[var(--dock-radius-tight)] px-2"
                    : coarsePointer
                      ? embedded
                          ? size === "compact"
                              ? "h-10 gap-1 px-0.5"
                              : "h-11 gap-1 px-0.5"
                          : size === "compact"
                            ? "h-11 gap-1 rounded-[var(--dock-radius-tight)] px-1.5 pb-1"
                            : "h-12 gap-1 rounded-[var(--panel-radius)] px-2 pb-1"
                      : embedded
                        ? size === "compact"
                            ? "h-8 gap-0.5 px-0.5 pb-0.5"
                            : "h-9 gap-0.5 px-0.5 pb-0.5"
                        : size === "compact"
                          ? "h-8 gap-0.5 rounded-[var(--r-lg)] px-1 pb-1"
                          : "h-10 gap-0.5 rounded-[var(--dock-radius)] px-1.5 pb-1",
                className,
            )}
            style={style}
            onPointerMove={(event) => {
                if (motionEnabled) mouseX.set(event.clientX);
            }}
            onPointerLeave={() => mouseX.set(Number.POSITIVE_INFINITY)}
        >
            {renderDockItems(items, { mouseX, metrics, motionEnabled: motionEnabled && !showLabels, compact: size === "compact", showLabel: showLabels })}
        </motion.div>
    );
});

type DockItemRenderProps = {
    mouseX: MotionValue<number>;
    metrics: DockMetrics;
    motionEnabled: boolean;
    compact: boolean;
    showLabel: boolean;
};

/**
 * 渲染 Dock 条目，将连续的 danger 命令包裹在 is-danger-group 容器中实现视觉隔离。
 * 满足"危险操作必须与常规按钮隔离"的硬约束。
 */
function renderDockItems(items: FloatingDockEntry[], props: DockItemRenderProps) {
    const result: ReactNode[] = [];
    let dangerGroup: FloatingDockCommand[] = [];
    let index = 0;

    const flushDangerGroup = () => {
        if (!dangerGroup.length) return;
        const groupKey = `danger-group-${index}`;
        result.push(
            <span key={groupKey} className="aceternity-dock-danger-group flex shrink-0 items-end gap-0.5 rounded-[calc(var(--dock-item-radius)+2px)] px-0.5">
                {dangerGroup.map((command) => (
                    <DockCommandButton key={command.id} command={command} mouseX={props.mouseX} metrics={props.metrics} motionEnabled={props.motionEnabled} compact={props.compact} showLabel={props.showLabel} />
                ))}
            </span>,
        );
        dangerGroup = [];
    };

    for (const item of items) {
        if (item.kind === "separator") {
            flushDangerGroup();
            result.push(<DockSeparator key={item.id} compact={props.compact} labeled={props.showLabel} />);
            continue;
        }
        if (item.danger) {
            dangerGroup.push(item);
            index += 1;
            continue;
        }
        flushDangerGroup();
        result.push(<DockCommandButton key={item.id} command={item} mouseX={props.mouseX} metrics={props.metrics} motionEnabled={props.motionEnabled} compact={props.compact} showLabel={props.showLabel} />);
        index += 1;
    }
    flushDangerGroup();
    return result;
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
    // 鼠标点击产生的 focus 不能阻塞提示收起，只有键盘可见焦点才持续显示提示。
    const showTooltip = !showLabel && (hovered || focused) && !command.disabled;
    // scrollable 场景自定义 tooltip 会被 overflow 裁剪，用原生 title 兜底
    const nativeTitle = !motionEnabled ? command.label : undefined;

    if (showLabel) {
        return (
            <motion.span ref={ref} className="relative block h-8 shrink-0">
                <motion.button
                    type="button"
                    aria-label={command.label}
                    aria-expanded={command.expands ? command.active || undefined : undefined}
                    aria-pressed={command.expands ? undefined : command.active || undefined}
                    disabled={command.disabled}
                    className={cn(
                        "aceternity-dock-command is-labeled group inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--dock-item-radius)] border-0 px-2.5 outline-none",
                        command.active && "is-active",
                        command.danger && "is-danger",
                    )}
                    whileTap={!command.disabled ? { scale: 0.96 } : undefined}
                    transition={aceternityMotion.spring.dock}
                    onMouseEnter={() => setHovered(true)}
                    onMouseLeave={() => setHovered(false)}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    onClick={command.onClick}
                >
                    <span className="grid size-3.5 shrink-0 place-items-center">{command.icon}</span>
                    <span className="inline-flex h-4 items-center text-[var(--fs-label)] font-medium leading-none">{command.displayLabel || command.label}</span>
                </motion.button>
            </motion.span>
        );
    }

    return (
        <motion.span ref={ref} className={cn("relative block shrink-0", command.wide && "min-w-[var(--dock-precision-width)]")} style={{ width: itemSize, height: itemSize }}>
            {/* 放大项留在 Flex 流内，由布局推开邻项，保持 Aceternity Floating Dock 的空间关系。 */}
            <motion.button
                type="button"
                aria-label={command.label}
                title={nativeTitle}
                aria-expanded={command.expands ? command.active || undefined : undefined}
                aria-pressed={command.expands ? undefined : command.active || undefined}
                disabled={command.disabled}
                className={cn("aceternity-dock-command group relative grid size-full place-items-center rounded-full border outline-none", command.quiet && "is-quiet", command.active && "is-active", command.danger && "is-danger")}
                whileTap={motionEnabled && !command.disabled ? { scale: 0.92 } : undefined}
                transition={aceternityMotion.spring.dock}
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
                onFocus={(event) => setFocused(event.currentTarget.matches(":focus-visible"))}
                onBlur={() => setFocused(false)}
                onMouseDown={() => setFocused(false)}
                onClick={command.onClick}
            >
                <motion.span className={cn("grid place-items-center", command.wide && "w-full")} style={command.wide ? { height: iconSize } : { width: iconSize, height: iconSize }}>
                    {command.icon}
                </motion.span>
                <AnimatePresence>
                    {showTooltip ? (
                        <motion.span
                            initial={{ opacity: 0, y: 7, scale: 0.94 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 4, scale: 0.96, transition: { duration: 0 } }}
                            transition={{ duration: aceternityMotion.duration.instant, ease: aceternityMotion.easing.enter }}
                            className={cn(
                                "aceternity-dock-tooltip pointer-events-none absolute left-1/2 z-[var(--dock-tooltip-z)] -translate-x-1/2 whitespace-nowrap border font-medium shadow-xl backdrop-blur-xl",
                                compact ? "-top-7 rounded-md px-1.5 py-0.5 text-[var(--fs-micro)]" : "-top-8 rounded-md px-2 py-1 text-[var(--fs-tiny)]",
                            )}
                        >
                            {command.label}
                        </motion.span>
                    ) : null}
                </AnimatePresence>
            </motion.button>
        </motion.span>
    );
}

function DockSeparator({ compact, labeled }: { compact: boolean; labeled: boolean }) {
    return <span aria-hidden className={cn("aceternity-dock-separator shrink-0 self-center", labeled ? "mx-1.5 h-6 w-px" : compact ? "mx-0.5 mb-0.5 h-3.5 w-px" : "mx-0.5 mb-0.5 h-4 w-px")} />;
}

function proximitySize(distance: number, base: number, magnified: number, range: number, enabled: boolean) {
    if (!enabled || !Number.isFinite(distance)) return base;
    const proximity = 1 - Math.min(Math.abs(distance) / range, 1);
    return base + (magnified - base) * proximity * proximity;
}
