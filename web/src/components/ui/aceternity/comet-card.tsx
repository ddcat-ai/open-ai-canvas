import { motion, useMotionTemplate, useMotionValue, useReducedMotion, useSpring, useTransform, type HTMLMotionProps, type MotionStyle } from "motion/react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { aceternityMotion } from "@/lib/aceternity-motion";

type CometCardProps = Omit<HTMLMotionProps<"div">, "children"> & {
    children?: ReactNode;
    containerClassName?: string;
    rotateDepth?: number;
    translateDepth?: number;
    disabled?: boolean;
    glare?: boolean;
};

const windowBlurSubscribers = new Set<() => void>();
let windowBlurListening = false;

function subscribeWindowBlur(callback: () => void) {
    windowBlurSubscribers.add(callback);
    if (!windowBlurListening && typeof window !== "undefined") {
        window.addEventListener("blur", resetCometCardsAfterWindowBlur);
        windowBlurListening = true;
    }
    return () => {
        windowBlurSubscribers.delete(callback);
        if (windowBlurListening && windowBlurSubscribers.size === 0 && typeof window !== "undefined") {
            window.removeEventListener("blur", resetCometCardsAfterWindowBlur);
            windowBlurListening = false;
        }
    };
}

function resetCometCardsAfterWindowBlur() {
    windowBlurSubscribers.forEach((reset) => reset());
}

export function CometCard({ containerClassName, className, rotateDepth = 5.5, translateDepth = 5, disabled = false, glare = true, children, style, onMouseEnter, onMouseMove, onMouseLeave, onPointerCancel, ...props }: CometCardProps) {
    const reducedMotion = useReducedMotion();
    const motionEnabled = !disabled && !reducedMotion;
    const [motionActive, setMotionActive] = useState(false);
    const settleTimerRef = useRef<number | null>(null);
    const x = useMotionValue(0);
    const y = useMotionValue(0);
    const springX = useSpring(x, aceternityMotion.spring.surface);
    const springY = useSpring(y, aceternityMotion.spring.surface);
    const rotateX = useTransform(springY, [-0.5, 0.5], [-rotateDepth, rotateDepth]);
    const rotateY = useTransform(springX, [-0.5, 0.5], [rotateDepth, -rotateDepth]);
    const translateX = useTransform(springX, [-0.5, 0.5], [-translateDepth, translateDepth]);
    const translateY = useTransform(springY, [-0.5, 0.5], [translateDepth, -translateDepth]);
    const glareX = useTransform(springX, [-0.5, 0.5], [12, 88]);
    const glareY = useTransform(springY, [-0.5, 0.5], [8, 92]);
    const glareBackground = useMotionTemplate`radial-gradient(circle at ${glareX}% ${glareY}%, rgba(255,255,255,.78) 0%, rgba(255,255,255,.24) 22%, rgba(255,255,255,0) 66%)`;
    const motionStyle: MotionStyle = motionEnabled && motionActive ? { ...(style as MotionStyle), rotateX, rotateY, x: translateX, y: translateY } : { ...(style as MotionStyle) };

    const clearSettleTimer = useCallback(() => {
        if (settleTimerRef.current === null) return;
        window.clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
    }, []);

    const resetMotion = useCallback((immediate = false) => {
        x.set(0);
        y.set(0);
        clearSettleTimer();
        if (immediate || !motionEnabled) {
            setMotionActive(false);
            return;
        }
        // 等回弹结束后彻底移除 3D 合成层，避免缩放画布中的节点长期使用低分辨率栅格缓存。
        settleTimerRef.current = window.setTimeout(() => {
            setMotionActive(false);
            settleTimerRef.current = null;
        }, 320);
    }, [clearSettleTimer, motionEnabled, x, y]);

    useEffect(() => {
        const unsubscribe = subscribeWindowBlur(() => resetMotion(true));
        return () => {
            unsubscribe();
            clearSettleTimer();
        };
    }, [clearSettleTimer, resetMotion]);

    return (
        <div className={cn("aceternity-comet-perspective h-full w-full", containerClassName)} data-comet-active={motionEnabled && motionActive ? "true" : "false"}>
            <motion.div
                {...props}
                className={cn("aceternity-comet-card relative h-full w-full", className)}
                data-comet-active={motionEnabled && motionActive ? "true" : "false"}
                style={motionStyle}
                whileHover={motionEnabled && motionActive ? { scale: 1.022, z: 28 } : undefined}
                transition={aceternityMotion.spring.surface}
                onMouseEnter={(event) => {
                    if (motionEnabled) {
                        clearSettleTimer();
                        setMotionActive(true);
                    }
                    onMouseEnter?.(event);
                }}
                onMouseMove={(event) => {
                    if (motionEnabled) {
                        const rect = event.currentTarget.getBoundingClientRect();
                        x.set((event.clientX - rect.left) / Math.max(rect.width, 1) - 0.5);
                        y.set((event.clientY - rect.top) / Math.max(rect.height, 1) - 0.5);
                    }
                    onMouseMove?.(event);
                }}
                onMouseLeave={(event) => {
                    resetMotion();
                    onMouseLeave?.(event);
                }}
                onPointerCancel={(event) => {
                    resetMotion(true);
                    onPointerCancel?.(event);
                }}
            >
                <div className="relative z-10 h-full w-full rounded-[inherit]">{children}</div>
                {glare && motionEnabled && motionActive ? <motion.div aria-hidden className="pointer-events-none absolute inset-0 z-20 rounded-[inherit] mix-blend-soft-light" style={{ background: glareBackground, opacity: 0.72 }} /> : null}
            </motion.div>
        </div>
    );
}
