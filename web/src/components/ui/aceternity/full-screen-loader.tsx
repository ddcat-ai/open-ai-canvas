import { motion, useReducedMotion } from "motion/react";

import { aceternityMotion } from "@/lib/aceternity-motion";
import { cn } from "@/lib/utils";

type FullScreenLoaderProps = {
    label?: string;
    detail?: string;
    className?: string;
};

export function FullScreenLoader({ label = "正在恢复创作空间", detail = "同步账号、模型和项目数据", className }: FullScreenLoaderProps) {
    const reducedMotion = useReducedMotion();

    return (
        <motion.div
            role="status"
            aria-live="polite"
            aria-label={`${label}，${detail}`}
            initial={reducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: aceternityMotion.duration.state, ease: aceternityMotion.easing.enter }}
            className={cn("fixed inset-0 z-[1200] grid min-h-dvh place-items-center overflow-hidden bg-[#f5f6f8] px-6 text-stone-950 dark:bg-[#0b0c0f] dark:text-white", className)}
        >
            <div aria-hidden className="absolute inset-0 bg-[linear-gradient(rgba(15,23,42,.045)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,.045)_1px,transparent_1px)] bg-[size:44px_44px] dark:bg-[linear-gradient(rgba(255,255,255,.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.035)_1px,transparent_1px)]" />
            <div aria-hidden className="absolute inset-0 overflow-hidden opacity-70">
                {[0, 1, 2].map((index) => (
                    <motion.span
                        key={index}
                        className="absolute left-[-20%] h-px w-[140%] origin-center bg-current opacity-[0.08] dark:opacity-[0.12]"
                        style={{ top: `${30 + index * 20}%`, rotate: index % 2 ? -7 : 7 }}
                        animate={reducedMotion ? undefined : { x: ["-8%", "8%", "-8%"] }}
                        transition={{ duration: 4.8 + index * 0.8, repeat: Infinity, ease: "easeInOut", delay: index * -1.1 }}
                    />
                ))}
            </div>

            <div className="relative flex w-full max-w-sm flex-col items-center text-center">
                <div className="relative grid size-24 place-items-center">
                    <motion.span
                        aria-hidden
                        className="absolute inset-1 rounded-[28px] border border-cyan-500/28 dark:border-cyan-300/22"
                        animate={reducedMotion ? undefined : { rotate: 360 }}
                        transition={{ duration: 3.2, repeat: Infinity, ease: "linear" }}
                        style={{ clipPath: "polygon(0 0, 68% 0, 68% 2px, 0 2px, 0 100%)" }}
                    />
                    <motion.span
                        aria-hidden
                        className="absolute inset-3 rounded-[22px] border border-amber-500/30 dark:border-amber-300/22"
                        animate={reducedMotion ? undefined : { rotate: -360 }}
                        transition={{ duration: 4.1, repeat: Infinity, ease: "linear" }}
                        style={{ clipPath: "polygon(32% 0, 100% 0, 100% 100%, 98% 100%, 98% 2px, 32% 2px)" }}
                    />
                    <motion.span
                        className="size-10 bg-current"
                        style={{ mask: "url(/logo.svg) center / contain no-repeat", WebkitMask: "url(/logo.svg) center / contain no-repeat" }}
                        animate={reducedMotion ? undefined : { opacity: [0.58, 1, 0.58], scale: [0.96, 1, 0.96] }}
                        transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
                    />
                </div>

                <p className="mt-6 text-base font-semibold tracking-normal">{label}</p>
                <p className="mt-2 text-sm text-stone-500 dark:text-white/42">{detail}</p>
                <div aria-hidden className="relative mt-6 h-px w-44 overflow-hidden bg-stone-900/10 dark:bg-white/10">
                    <motion.span
                        className="absolute inset-y-0 left-0 w-16 bg-cyan-500 dark:bg-cyan-300"
                        animate={reducedMotion ? { x: 56 } : { x: [-64, 176] }}
                        transition={reducedMotion ? undefined : { duration: 1.15, repeat: Infinity, ease: aceternityMotion.easing.enter }}
                    />
                </div>
            </div>
        </motion.div>
    );
}
