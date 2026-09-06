import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

/**
 * WorkingDots: diagonal wave dot-matrix "busy" indicator.
 *
 * Form absorbed from boardui agent-thinking (wave variant) — no UI assets or
 * extra dependencies; reduced-motion renders a static frame. The grid is drawn
 * with `bg-current`, so it inherits whatever text color the caller provides
 * (canvas theme accents, CSS vars, etc.).
 */
export function WorkingDots({
    cols = 3,
    rows = 3,
    dotSize = 4,
    gap = 2,
    tickMs = 90,
    minOpacity = 0.14,
    trail = 0.32,
    className,
}: {
    cols?: number;
    rows?: number;
    dotSize?: number;
    gap?: number;
    tickMs?: number;
    minOpacity?: number;
    trail?: number;
    className?: string;
}) {
    const reducedMotion = useReducedMotion();
    const [phase, setPhase] = useState(0);
    useEffect(() => {
        if (reducedMotion) return;
        const timer = window.setInterval(() => setPhase((value) => (value + 1 / 8) % 1), tickMs);
        return () => window.clearInterval(timer);
    }, [reducedMotion, tickMs]);
    const count = cols * rows;
    return (
        <span aria-hidden className={`grid shrink-0 ${className ?? ""}`} style={{ gridTemplateColumns: `repeat(${cols}, ${dotSize}px)`, gap }}>
            {Array.from({ length: count }, (_, index) => {
                const col = index % cols;
                const row = Math.floor(index / cols);
                // Normalized diagonal position, scaled so the wave front turns
                // back before reaching the far corner (3/4 for a 3x3 grid,
                // matching the original canvas indicator pixel-for-pixel).
                const n = Math.max(cols, rows);
                const normalized = (col / Math.max(1, cols - 1) + row / Math.max(1, rows - 1)) / 2;
                const scalar = normalized * (n / (n + 1));
                const behind = (phase - scalar + 1) % 1;
                const lit = Math.max(0, 1 - behind / trail) ** 1.5;
                const opacity = minOpacity + (1 - minOpacity) * lit;
                return <span key={index} className="rounded-[1px] bg-current" style={{ width: dotSize, height: dotSize, opacity }} />;
            })}
        </span>
    );
}

/**
 * WorkingGlow: soft breathing halo rendered over a "busy" control (send
 * button, composer capsule). Color accepts a hex value or a CSS variable
 * (e.g. `var(--creation-text)`); the blurred layer uses color-mix so both
 * work. Disabled under prefers-reduced-motion. Caller positions it: wrap the
 * control in a `relative` container and pass the matching border radius.
 */
export function WorkingGlow({
    active,
    color,
    radius = 0,
    className,
}: {
    active: boolean;
    color: string;
    radius?: number | string;
    className?: string;
}) {
    const reducedMotion = useReducedMotion();
    if (!active || reducedMotion) return null;
    const soft = `color-mix(in srgb, ${color} 55%, transparent)`;
    return (
        <motion.div
            aria-hidden
            className={className}
            style={{ position: "absolute", inset: 0, borderRadius: radius, pointerEvents: "none", boxShadow: `0 0 0 1px ${color}` }}
            animate={{
                opacity: [0.35, 1, 0.35],
                boxShadow: [`0 0 0 1px ${color}`, `0 0 16px 1px ${soft}, 0 0 0 1px ${color}`, `0 0 0 1px ${color}`],
            }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        />
    );
}
