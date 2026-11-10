import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { forwardRef, useEffect, useState, type CSSProperties, type FocusEvent, type MouseEvent, type ReactNode } from "react";

import { Tooltip } from "@/components/ui/base/tooltip/tooltip";
import { translate } from "@/i18n";
import { cn } from "@/lib/utils";
import { aceternityMotion } from "@/lib/aceternity-motion";

export type FloatingDockCommand = {
    kind?: "command";
    id: string;
    label: string;
    displayLabel?: string;
    badge?: ReactNode;
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

export type FloatingDockSwitchOption = {
    id: string;
    label: string;
    icon: ReactNode;
    value: string;
    displayLabel?: string;
};

export type FloatingDockSwitch = {
    kind: "switch";
    id: string;
    label: string;
    value: string;
    options: FloatingDockSwitchOption[];
    onChange: (value: string) => void;
};

export type FloatingDockEntry = FloatingDockCommand | FloatingDockSwitch | { kind: "separator"; id: string };

type FloatingDockProps = {
    items: FloatingDockEntry[];
    size?: "default" | "compact";
    /** Bottom canvas bars scroll within the available workspace and use portaled tooltips. */
    variant?: "floating" | "toolbar";
    embedded?: boolean;
    className?: string;
    style?: CSSProperties;
    ariaLabel?: string;
    showLabels?: boolean;
};

// `window` 存在不代表 `matchMedia` 存在：测试与 renderToString 下它可能是 undefined。
function coarsePointerQuery(): MediaQueryList | undefined {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    return window.matchMedia("(pointer: coarse)");
}

/**
 * 固定尺寸 Dock。旧版的 macOS 式放大会在每次 pointermove 时对每个按钮读取
 * getBoundingClientRect 并改变宽高，导致整条 dock 重排、相邻按钮抖动；这里改为
 * 固定格子 + 纯色 hover，只保留按压反馈与提示气泡。
 */
export const FloatingDock = forwardRef<HTMLDivElement, FloatingDockProps>(function FloatingDock(
    { items, size = "default", variant = "floating", embedded = false, className, style, ariaLabel = translate("account.ui.canvasTools"), showLabels = false },
    forwardedRef,
) {
    const reducedMotion = useReducedMotion();
    const [coarsePointer, setCoarsePointer] = useState(() => coarsePointerQuery()?.matches ?? false);
    // 窄屏下允许横向滚动，保证按钮始终可达；此时自定义提示会被裁剪，改用原生 title。
    const [narrow, setNarrow] = useState(() => (typeof window !== "undefined" ? window.innerWidth < 768 : false));

    useEffect(() => {
        const media = coarsePointerQuery();
        if (!media) return;
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

    const toolbar = variant === "toolbar";
    const scrollable = toolbar || coarsePointer || narrow;
    const compact = size === "compact";
    const itemSize = coarsePointer ? (compact ? 36 : 40) : compact ? 28 : 32;

    return (
        <div
            ref={forwardedRef}
            role="toolbar"
            aria-label={ariaLabel}
            data-dock-size={size}
            data-dock-variant={variant}
            data-canvas-wheel-scroll={toolbar || undefined}
            className={cn(
                "aceternity-floating-dock flex items-center",
                scrollable ? "overflow-x-auto" : "overflow-visible",
                embedded ? "gap-0.5 px-0.5 shadow-none" : "gap-0.5 border backdrop-blur-2xl",
                !embedded && (compact ? "rounded-[var(--r-lg)] p-1" : "rounded-[var(--r-xl)] p-2"),
                className,
            )}
            style={{ ...style, "--dock-item-size": toolbar ? `var(--button-height${coarsePointer ? "-lg" : compact ? "-sm" : ""})` : `${itemSize}px` } as CSSProperties}
        >
            {renderDockItems(items, { compact, showLabel: showLabels, nativeTitle: scrollable && !toolbar, motionEnabled: !reducedMotion && !toolbar, portalTooltip: toolbar })}
        </div>
    );
});

type DockItemRenderProps = {
    compact: boolean;
    showLabel: boolean;
    nativeTitle: boolean;
    motionEnabled: boolean;
    portalTooltip: boolean;
};

/** 连续的 danger 命令包裹在 is-danger-group 中，与常规按钮视觉隔离。 */
function renderDockItems(items: FloatingDockEntry[], props: DockItemRenderProps) {
    const result: ReactNode[] = [];
    let dangerGroup: FloatingDockCommand[] = [];
    let index = 0;

    const flushDangerGroup = () => {
        if (!dangerGroup.length) return;
        result.push(
            <span key={`danger-group-${index}`} className="aceternity-dock-danger-group flex shrink-0 items-center gap-0.5">
                {dangerGroup.map((command) => (
                    <DockCommandButton key={command.id} command={command} {...props} />
                ))}
            </span>,
        );
        dangerGroup = [];
    };

    for (const item of items) {
        if (item.kind === "separator") {
            flushDangerGroup();
            result.push(<span key={item.id} aria-hidden className={cn("aceternity-dock-separator mx-1 w-px shrink-0", props.compact ? "h-3.5" : "h-4")} />);
            continue;
        }
        if (item.kind === "switch") {
            flushDangerGroup();
            result.push(<DockSwitch key={item.id} entry={item} {...props} />);
            index += 1;
            continue;
        }
        if (item.danger) {
            dangerGroup.push(item);
            index += 1;
            continue;
        }
        flushDangerGroup();
        result.push(<DockCommandButton key={item.id} command={item} {...props} />);
        index += 1;
    }
    flushDangerGroup();
    return result;
}

function DockTooltip({ show, label, compact }: { show: boolean; label: string; compact: boolean }) {
    return (
        <AnimatePresence>
            {show ? (
                <motion.span
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, transition: { duration: 0 } }}
                    transition={{ duration: aceternityMotion.duration.instant, ease: aceternityMotion.easing.enter }}
                    className={cn(
                        "aceternity-dock-tooltip pointer-events-none absolute bottom-full left-1/2 z-[var(--dock-tooltip-z)] mb-2 -translate-x-1/2 whitespace-nowrap rounded-md border font-medium shadow-lg",
                        compact ? "px-2 py-0.5 text-[var(--fs-micro)]" : "px-2 py-1 text-[var(--fs-tiny)]",
                    )}
                >
                    {label}
                </motion.span>
            ) : null}
        </AnimatePresence>
    );
}

/** 鼠标点击产生的 focus 不保持提示，只有键盘可见焦点才持续显示。 */
function useDockTooltip() {
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    return {
        visible: hovered || focused,
        handlers: {
            onMouseEnter: () => setHovered(true),
            onMouseLeave: () => setHovered(false),
            onFocus: (event: FocusEvent<HTMLElement>) => setFocused(event.currentTarget.matches(":focus-visible")),
            onBlur: () => setFocused(false),
            onMouseDown: () => setFocused(false),
        },
    };
}

function DockCommandButton({ command, compact, showLabel, nativeTitle, motionEnabled, portalTooltip }: { command: FloatingDockCommand } & DockItemRenderProps) {
    const tooltip = useDockTooltip();
    const pressed = command.expands ? undefined : command.active;
    const expanded = command.expands ? Boolean(command.active) : undefined;
    const tap = motionEnabled && !command.disabled ? { scale: 0.92 } : undefined;

    if (showLabel) {
        return (
            <motion.button
                type="button"
                aria-label={command.label}
                aria-expanded={expanded}
                aria-pressed={pressed}
                disabled={command.disabled}
                className={cn(
                    "aceternity-dock-command is-labeled inline-flex h-[var(--dock-item-size)] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[var(--dock-item-radius)] border-0 px-2 outline-none",
                    command.active && "is-active",
                    command.danger && "is-danger",
                )}
                whileTap={motionEnabled && !command.disabled ? { scale: 0.96 } : undefined}
                transition={aceternityMotion.spring.dock}
                onClick={command.onClick}
            >
                <span className="grid size-3.5 shrink-0 place-items-center">{command.icon}</span>
                <span className="inline-flex h-4 items-center text-[var(--fs-label)] font-medium leading-none">{command.displayLabel || command.label}</span>
                {command.badge !== undefined ? <span className="aceternity-dock-command-badge inline-flex min-w-4 items-center justify-center rounded-full px-1 text-[var(--fs-micro)] font-semibold leading-4">{command.badge}</span> : null}
            </motion.button>
        );
    }

    return (
        <span className="relative inline-flex shrink-0">
            <Tooltip title={portalTooltip ? command.label : undefined}>
                <motion.button
                    type="button"
                    aria-label={command.label}
                    title={nativeTitle ? command.label : undefined}
                    data-icon-only
                    aria-expanded={expanded}
                    aria-pressed={pressed}
                    disabled={command.disabled}
                    className={cn(
                        "aceternity-dock-command relative grid h-[var(--dock-item-size)] place-items-center rounded-[var(--dock-item-radius)] border-0 outline-none",
                        command.wide ? "min-w-[var(--dock-precision-width)] px-2" : "w-[var(--dock-item-size)]",
                        command.quiet && "is-quiet",
                        command.active && "is-active",
                        command.danger && "is-danger",
                    )}
                    whileTap={tap}
                    transition={aceternityMotion.spring.dock}
                    onClick={command.onClick}
                    {...(portalTooltip ? {} : tooltip.handlers)}
                >
                    <span className={cn("grid place-items-center", command.wide ? "h-4 w-full" : compact ? "size-[15px]" : "size-4")}>{command.icon}</span>
                </motion.button>
            </Tooltip>
            {!nativeTitle && !portalTooltip ? <DockTooltip show={tooltip.visible && !command.disabled} label={command.label} compact={compact} /> : null}
        </span>
    );
}

function DockSwitch({ entry, compact, showLabel, nativeTitle, motionEnabled, portalTooltip }: { entry: FloatingDockSwitch } & DockItemRenderProps) {
    const [hoveredId, setHoveredId] = useState<string | null>(null);
    const [focusedId, setFocusedId] = useState<string | null>(null);
    const labeled = showLabel || entry.options.some((option) => option.displayLabel);

    return (
        <span
            role="radiogroup"
            aria-label={entry.label}
            className={cn("aceternity-dock-switch relative inline-flex shrink-0 items-center gap-0.5 rounded-[calc(var(--dock-item-radius)+2px)] p-0.5", labeled && "is-labeled")}
            onKeyDown={(event) => {
                if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
                event.preventDefault();
                const selectedIndex = Math.max(
                    0,
                    entry.options.findIndex((option) => option.value === entry.value),
                );
                const direction = event.key === "ArrowRight" ? 1 : -1;
                const next = entry.options[(selectedIndex + direction + entry.options.length) % entry.options.length];
                if (next) {
                    entry.onChange(next.value);
                    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[(selectedIndex + direction + entry.options.length) % entry.options.length]?.focus();
                }
            }}
        >
            {entry.options.map((option) => {
                const checked = option.value === entry.value;
                const showTooltip = !portalTooltip && !labeled && !nativeTitle && (hoveredId === option.id || focusedId === option.id);
                return (
                    <span key={option.id} className="relative inline-flex shrink-0">
                        <Tooltip title={portalTooltip ? option.label : undefined}>
                            <button
                                type="button"
                                role="radio"
                                data-icon-only={!labeled || undefined}
                                aria-checked={checked}
                                aria-label={option.label}
                                tabIndex={checked ? 0 : -1}
                                title={nativeTitle ? option.label : undefined}
                                className={cn(
                                    "aceternity-dock-switch-option relative inline-flex h-[calc(var(--dock-item-size)-4px)] items-center justify-center border-0 outline-none",
                                    labeled ? "gap-1 rounded-[var(--dock-item-radius)] px-2" : "w-[calc(var(--dock-item-size)-4px)] rounded-[var(--dock-item-radius)]",
                                )}
                                onMouseEnter={() => setHoveredId(option.id)}
                                onMouseLeave={() => setHoveredId((current) => (current === option.id ? null : current))}
                                onFocus={(event) => {
                                    if (event.currentTarget.matches(":focus-visible")) setFocusedId(option.id);
                                }}
                                onBlur={() => setFocusedId((current) => (current === option.id ? null : current))}
                                onMouseDown={() => setFocusedId(null)}
                                onClick={() => {
                                    if (!checked) entry.onChange(option.value);
                                }}
                            >
                                {checked ? (
                                    <motion.span
                                        aria-hidden
                                        layoutId={`dock-switch-thumb-${entry.id}`}
                                        className="aceternity-dock-switch-thumb pointer-events-none absolute inset-0 rounded-[var(--dock-item-radius)]"
                                        transition={motionEnabled ? aceternityMotion.spring.dock : { duration: 0 }}
                                    />
                                ) : null}
                                <span className={cn("relative z-[1] grid shrink-0 place-items-center", compact ? "size-[15px]" : "size-4")}>{option.icon}</span>
                                {labeled ? <span className="relative z-[1] shrink-0 whitespace-nowrap text-[length:var(--fs-micro)] font-semibold leading-none">{option.displayLabel || option.label}</span> : null}
                            </button>
                        </Tooltip>
                        <DockTooltip show={showTooltip} label={option.label} compact={compact} />
                    </span>
                );
            })}
        </span>
    );
}
