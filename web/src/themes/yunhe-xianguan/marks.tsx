import { motion } from "motion/react";

import { cn } from "@/lib/utils";

import type { ThemeAgentOrbProps, ThemeSignalArtProps } from "../types";

import "./crane-orb.css";

/**
 * 助手形象：圆窗里一只鹤首。待命时轻轻呼吸；工作中外圈云纹转动、鹤顶红闪烁；
 * 完成时右下角盖一枚「成」字圆印。颜色全部读皮肤变量，月白 / 夜观自动切换。
 */
export function CraneOrb({ size, state, className }: ThemeAgentOrbProps) {
    return (
        <span className={cn("crane-orb", `is-${state}`, className)} style={{ width: size, height: size }} aria-hidden="true">
            <svg viewBox="0 0 64 64">
                <circle className="crane-orb-bg" cx="32" cy="32" r="29" />
                <circle className="crane-orb-ring" cx="32" cy="32" r="29" />
                <path className="crane-orb-mist" d="M10 42c6-4 12-4 18 0s12 4 18 0 8-3 10-2" />
                <path className="crane-orb-neck" d="M25 52c-3-9 1-16 8-20 5-3 6-8 3-12" />
                <circle className="crane-orb-head" cx="36" cy="18.5" r="3.6" />
                <path className="crane-orb-beak" d="M38.8 19.4l9 3" />
                <circle className="crane-orb-eye" cx="37.3" cy="18" r=".8" />
                <circle className="crane-orb-crown" cx="35.6" cy="15" r="2.2" />
                <g className="crane-orb-seal">
                    <circle cx="50" cy="50" r="9" />
                    <text x="50" y="53.6" textAnchor="middle">
                        成
                    </text>
                </g>
            </svg>
        </span>
    );
}

/** 空状态图标：方框换成一团天青云气，下面一缕云纹，线条天青，强调点换成鹤顶红圆点（错误仍用危险色）。 */
export function CloudSignalArt({ path, dot, error, reducedMotion }: ThemeSignalArtProps) {
    const [dotX, dotY] = dot;
    return (
        <>
            <circle className="yx-signal-mist" cx="24" cy="24" r="21" />
            <path className="yx-signal-wave" d="M9 37c3-2.4 6.4-2.4 9.4 0s6.4 2.4 9.4 0 6.4-2.4 9.4 0" strokeWidth="1.4" strokeLinecap="round" fill="none" />
            <motion.path
                className="yx-signal-line"
                d={path}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={reducedMotion ? false : { pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: 0.25, delay: 0.04, ease: [0.22, 1, 0.36, 1] }}
            />
            <motion.circle
                className={error ? "yx-signal-dot is-error" : "yx-signal-dot"}
                cx={dotX}
                cy={dotY}
                r="2.8"
                initial={reducedMotion ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.15, delay: 0.15, ease: "easeOut" }}
            />
        </>
    );
}

/** 顶栏积分图标：鎏金小葫芦，腰上系一点鹤顶红。 */
export function GourdCreditMark({ className }: { className?: string }) {
    return (
        <span className={cn("app-workspace-credit-gift is-yx-gourd", className)} aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="8" r="3.6" fill="currentColor" />
                <circle cx="12" cy="16.4" r="5.6" fill="currentColor" />
                <rect x="9.3" y="10.5" width="5.4" height="1.9" rx=".95" style={{ fill: "var(--yx-crown, #c3352a)" }} />
                <path d="M12 4.4V2.6M12 3.2c1.4-1 3-.8 3.8 0" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                <circle cx="10.2" cy="15" r="1.3" fill="#fff" fillOpacity=".35" />
            </svg>
        </span>
    );
}

/** 404：云海里一座山门牌坊，右上角一只鹤正飞远。 */
export function GateNotFoundEmblem() {
    return (
        <svg className="not-found-gate" viewBox="0 0 220 120" aria-hidden="true">
            <path style={{ fill: "var(--yx-sheet)" }} d="M0 96 C20 86 40 88 56 94 C76 84 100 86 116 96 C136 86 160 86 176 96 C192 88 210 88 220 92 L220 120 L0 120Z" />
            <g fill="currentColor" opacity=".85">
                <rect x="62" y="44" width="7" height="58" />
                <rect x="151" y="44" width="7" height="58" />
                <rect x="54" y="52" width="112" height="6" />
                <path d="M38 46 Q110 38 182 46 L188 38 Q110 30 32 38 Z" />
            </g>
            <rect x="95" y="59" width="30" height="14" rx="1" style={{ fill: "var(--yx-sheet)", stroke: "currentColor", strokeOpacity: 0.85 }} />
            <path d="M101 66h18" stroke="currentColor" strokeOpacity=".5" strokeWidth="1.4" strokeLinecap="round" />
            <path style={{ fill: "var(--yx-cloud)" }} opacity=".92" d="M0 106 C24 98 48 100 66 106 C90 98 116 98 134 108 C156 100 184 100 220 104 L220 120 L0 120Z" />
            <g transform="translate(192 22) scale(.42)">
                <path fill="currentColor" d="M2 0 C-6 -14 -22 -20 -40 -15 C-26 -10 -12 -4 -2 3 Z" />
                <path fill="currentColor" d="M2 0 C8 -15 20 -22 36 -21 C24 -12 12 -4 2 4 Z" />
                <ellipse fill="currentColor" cx="-2" cy="3" rx="13" ry="3.4" />
                <path fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" d="M9 2 C15 0 19 -2 25 -2" />
                <circle fill="currentColor" cx="26" cy="-2.4" r="2.2" />
                <circle cx="26" cy="-4.1" r="1.4" style={{ fill: "var(--yx-crown)" }} />
            </g>
        </svg>
    );
}
