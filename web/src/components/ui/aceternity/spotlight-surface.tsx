import { motion, useMotionTemplate, useMotionValue, useReducedMotion, type HTMLMotionProps } from "motion/react";
import { forwardRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import { cn } from "@/lib/utils";

type SpotlightSurfaceProps = Omit<HTMLMotionProps<"div">, "children"> & {
    children?: ReactNode;
    spotlightColor: string;
    spotlightRadius?: number;
};

// 基于 Aceternity Card Spotlight 改造：只保留中性指针高光，避免高频工具面板持续动画。
export const SpotlightSurface = forwardRef<HTMLDivElement, SpotlightSurfaceProps>(function SpotlightSurface(
    { children, className, spotlightColor, spotlightRadius = 220, onPointerEnter, onPointerLeave, onPointerMove, ...props },
    ref,
) {
    const mouseX = useMotionValue(0);
    const mouseY = useMotionValue(0);
    const reducedMotion = useReducedMotion();
    const maskImage = useMotionTemplate`radial-gradient(${spotlightRadius}px circle at ${mouseX}px ${mouseY}px, black, transparent 78%)`;

    const updatePointer = (event: ReactPointerEvent<HTMLDivElement>) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        mouseX.set(event.clientX - bounds.left);
        mouseY.set(event.clientY - bounds.top);
    };

    return (
        <motion.div
            ref={ref}
            className={cn("group/spotlight relative isolate", className)}
            onPointerEnter={(event) => {
                updatePointer(event);
                onPointerEnter?.(event);
            }}
            onPointerMove={(event) => {
                updatePointer(event);
                onPointerMove?.(event);
            }}
            onPointerLeave={(event) => onPointerLeave?.(event)}
            {...props}
        >
            <motion.span
                aria-hidden
                className="pointer-events-none absolute -inset-px z-0 rounded-[inherit] opacity-0 transition-opacity duration-150 group-hover/spotlight:opacity-100"
                style={{ backgroundColor: spotlightColor, maskImage, WebkitMaskImage: maskImage, opacity: reducedMotion ? 0 : undefined }}
            />
            <div className="relative z-[1] flex min-h-0 flex-1 flex-col">{children}</div>
        </motion.div>
    );
});
