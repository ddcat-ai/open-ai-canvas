import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState, type ComponentPropsWithoutRef, type ElementType, type MouseEvent, type ReactNode } from "react";

import { cn } from "@/lib/utils";

type Direction = "TOP" | "LEFT" | "BOTTOM" | "RIGHT";

type HoverBorderGradientProps<T extends ElementType = "button"> = {
    as?: T;
    containerClassName?: string;
    className?: string;
    duration?: number;
    clockwise?: boolean;
    children?: ReactNode;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "children">;

const movingMap: Record<Direction, string> = {
    TOP: "radial-gradient(20.7% 50% at 50% 0%, color-mix(in srgb, var(--user-ink) 38%, transparent) 0%, transparent 100%)",
    LEFT: "radial-gradient(16.6% 43.1% at 0% 50%, color-mix(in srgb, var(--user-ink) 38%, transparent) 0%, transparent 100%)",
    BOTTOM: "radial-gradient(20.7% 50% at 50% 100%, color-mix(in srgb, var(--user-ink) 38%, transparent) 0%, transparent 100%)",
    RIGHT: "radial-gradient(16.2% 41.2% at 100% 50%, color-mix(in srgb, var(--user-ink) 38%, transparent) 0%, transparent 100%)",
};

const highlight = "radial-gradient(75% 181% at 50% 50%, color-mix(in srgb, var(--user-ink) 22%, transparent) 0%, transparent 100%)";

function rotateDirection(current: Direction, clockwise: boolean): Direction {
    const directions: Direction[] = clockwise
        ? ["TOP", "LEFT", "BOTTOM", "RIGHT"]
        : ["TOP", "RIGHT", "BOTTOM", "LEFT"];
    const index = directions.indexOf(current);
    return directions[(index - 1 + directions.length) % directions.length];
}

// Aceternity Hover Border Gradient：中性墨色描边，不用彩色高光。
export function HoverBorderGradient<T extends ElementType = "button">({
    children,
    containerClassName,
    className,
    as,
    duration = 1,
    clockwise = true,
    onMouseEnter,
    onMouseLeave,
    ...props
}: HoverBorderGradientProps<T>) {
    const Tag = (as || "button") as any;
    const reducedMotion = useReducedMotion();
    const [hovered, setHovered] = useState(false);
    const [direction, setDirection] = useState<Direction>("TOP");

    useEffect(() => {
        if (reducedMotion || hovered) return;
        const interval = window.setInterval(() => {
            setDirection((current) => rotateDirection(current, clockwise));
        }, duration * 1000);
        return () => window.clearInterval(interval);
    }, [clockwise, duration, hovered, reducedMotion]);

    return (
        <Tag
            {...(props as any)}
            className={cn("relative flex h-min w-full content-center items-center overflow-hidden bg-[var(--user-surface)] p-px transition-colors duration-500", containerClassName)}
            onMouseEnter={(event: MouseEvent<HTMLElement>) => {
                setHovered(true);
                (onMouseEnter as any)?.(event);
            }}
            onMouseLeave={(event: MouseEvent<HTMLElement>) => {
                setHovered(false);
                (onMouseLeave as any)?.(event);
            }}
        >
            <div className={cn("relative z-10 w-full rounded-[inherit]", className)}>{children}</div>
            {reducedMotion ? null : (
                <motion.div
                    aria-hidden
                    className="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-[inherit]"
                    style={{ filter: "blur(1px)" }}
                    initial={{ background: movingMap[direction] }}
                    animate={{ background: hovered ? [movingMap[direction], highlight] : movingMap[direction] }}
                    transition={{ ease: "linear", duration }}
                />
            )}
            <div aria-hidden className="pointer-events-none absolute inset-px z-[1] rounded-[inherit] bg-[var(--user-surface)]" />
        </Tag>
    );
}
