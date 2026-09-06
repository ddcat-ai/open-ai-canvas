import { useEffect, useRef, useState } from "react";

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Rolls the displayed number from `from` (defaults to the previous target)
 * to `target` with an ease-out curve, so headline figures animate when data
 * refreshes or a chart selection changes.
 *
 * Absorbed from boardui hooks/use-count-up.ts; adapted to this project:
 * - `prefers-reduced-motion` is respected: the value snaps to target at once.
 * - `from` is exposed so counters can start at 0 on first mount (default
 *   keeps boardui semantics: start at the previous value, no initial jump).
 * - `round` is applied per-frame so integer counters never show fractions.
 */
export function useCountUp(target: number, duration = 320, from?: number) {
    const reduced = useRef(false);
    if (typeof window !== "undefined" && !reduced.current) {
        reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }

    const [display, setDisplay] = useState(from ?? target);
    const fromRef = useRef(from ?? target);

    useEffect(() => {
        if (reduced.current) {
            fromRef.current = target;
            setDisplay(target);
            return;
        }
        const from = fromRef.current;
        if (from === target) return;
        const start = performance.now();
        let raf = 0;
        const tick = (now: number) => {
            const t = Math.min(1, (now - start) / duration);
            const value = Math.round(from + (target - from) * easeOutCubic(t));
            fromRef.current = value;
            setDisplay(value);
            if (t < 1) raf = requestAnimationFrame(tick);
            else fromRef.current = target;
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [target, duration]);

    return display;
}
