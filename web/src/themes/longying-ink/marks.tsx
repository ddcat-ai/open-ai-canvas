import { useId } from "react";
import { motion } from "motion/react";

import { cn } from "@/lib/utils";

import type { ThemeSignalArtProps } from "../types";

/** 空状态图标：方框换成一团淡墨晕，线条带毛笔毛边，强调点换成朱砂小印。 */
export function InkSignalArt({ path, dot, reducedMotion }: ThemeSignalArtProps) {
    const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
    const [dotX, dotY] = dot;
    return (
        <g className="text-foreground">
            <defs>
                <filter id={`${uid}-rough`} x="-10%" y="-10%" width="120%" height="120%">
                    <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="3" />
                    <feDisplacementMap in="SourceGraphic" scale="1.3" />
                </filter>
                <filter id={`${uid}-wash`} x="-20%" y="-20%" width="140%" height="140%">
                    <feTurbulence type="fractalNoise" baseFrequency="0.07" numOctaves="2" seed="7" />
                    <feDisplacementMap in="SourceGraphic" scale="6" />
                    <feGaussianBlur stdDeviation="0.7" />
                </filter>
            </defs>
            <circle cx="24" cy="25" r="19" fill="currentColor" opacity="0.07" filter={`url(#${uid}-wash)`} />
            <circle cx="22" cy="23" r="12" fill="currentColor" opacity="0.04" filter={`url(#${uid}-wash)`} />
            <motion.path
                d={path}
                stroke="currentColor"
                strokeOpacity={0.78}
                strokeWidth={2.4}
                strokeLinecap="round"
                strokeLinejoin="round"
                filter={`url(#${uid}-rough)`}
                initial={reducedMotion ? false : { pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: 0.25, delay: 0.04, ease: [0.22, 1, 0.36, 1] }}
            />
            <motion.rect
                x={dotX - 2.6}
                y={dotY - 2.6}
                width="5.2"
                height="5.2"
                rx="1"
                fill="var(--ink-seal, #b0402d)"
                transform={`rotate(-8 ${dotX} ${dotY})`}
                initial={reducedMotion ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.15, delay: 0.15, ease: "easeOut" }}
            />
        </g>
    );
}

/** 顶栏积分图标：一方朱印「积」。 */
export function InkCreditMark({ className }: { className?: string }) {
    return (
        <span className={cn("app-workspace-credit-gift is-ink-seal", className)} aria-hidden="true">
            <svg viewBox="0 0 18 18" fill="none">
                <g transform="rotate(-5 9 9)">
                    <rect x="1.5" y="1.5" width="15" height="15" rx="2.6" style={{ fill: "var(--ink-seal, #b0402d)" }} />
                    <text x="9" y="12.9" textAnchor="middle" fontSize="11" fontWeight="700" style={{ fill: "var(--ink-sheet, #fbf8f2)", fontFamily: "var(--ink-heading-font, serif)" }}>
                        积
                    </text>
                </g>
            </svg>
        </span>
    );
}

/** 404 页面底部两层淡墨远山。 */
export function InkNotFoundHills() {
    return (
        <svg className="not-found-hills" viewBox="0 0 400 130" preserveAspectRatio="none" aria-hidden="true">
            <defs>
                <filter id="not-found-hill" x="-5%" y="-30%" width="110%" height="160%">
                    <feTurbulence type="fractalNoise" baseFrequency="0.012 0.06" numOctaves="3" seed="11" />
                    <feDisplacementMap in="SourceGraphic" scale="14" />
                    <feGaussianBlur stdDeviation="1.6" />
                </filter>
            </defs>
            <path d="M0 92 C40 70 70 58 104 74 C130 86 150 60 182 52 C214 44 236 70 262 76 C292 82 318 56 350 62 C372 66 388 76 400 82 V130 H0Z" fill="currentColor" opacity="0.07" filter="url(#not-found-hill)" />
            <path d="M0 110 C50 96 84 100 120 92 C160 84 190 104 236 100 C280 96 320 86 360 94 C380 98 392 104 400 106 V130 H0Z" fill="currentColor" opacity="0.11" filter="url(#not-found-hill)" />
        </svg>
    );
}
