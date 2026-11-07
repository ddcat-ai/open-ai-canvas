import { useEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { useThemeStore } from "@/stores/use-theme-store";

import type { ThemeAgentOrbState } from "../types";

import "./ink-orb.css";

/**
 * 龙影水墨的助手形象：墨珠。
 * 宣纸上的一滴墨：待命时边缘慢慢晕开、墨在里面缓缓流动；工作中流得快，一圈圈墨晕向外散；
 * 完成时右下角落一方朱印。夜墨下是淡墨，不发白。作为「龙影水墨」主题包的助手形象，
 * 只在启用该皮肤时替换上游流光球。
 */
export type InkOrbState = ThemeAgentOrbState;

type Rgb = readonly [number, number, number];
type InkPalette = { ink: Rgb; paper: Rgb; seal: Rgb };

const LIGHT: InkPalette = { ink: [31, 28, 24], paper: [251, 248, 242], seal: [176, 64, 45] };
const DARK: InkPalette = { ink: [182, 172, 156], paper: [27, 25, 21], seal: [226, 118, 91] };

const rgba = (color: Rgb, alpha: number) => `rgba(${color[0]},${color[1]},${color[2]},${alpha})`;
const easeOut = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

/** 画布比墨珠本身大一圈，留给晕边和工作中的墨晕；小尺寸（收起 / 手机）放得更开一点，墨滴才不显得太小。 */
export function inkOrbCanvasSize(size: number) {
    return Math.round(size * (size <= 32 ? 1.6 : 1.27));
}

function blobPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, amp: number, time: number, seed: number) {
    ctx.beginPath();
    const steps = 72;
    for (let index = 0; index <= steps; index++) {
        const angle = (index / steps) * Math.PI * 2;
        const wobble = 1 + amp * (0.55 * Math.sin(3 * angle + time * 0.8 + seed) + 0.3 * Math.sin(5 * angle - time * 1.1 + seed * 2) + 0.18 * Math.sin(8 * angle + time * 1.7 + seed * 3));
        const x = cx + Math.cos(angle) * radius * wobble;
        const y = cy + Math.sin(angle) * radius * wobble;
        if (index) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
    }
    ctx.closePath();
}

function drawSeal(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: Rgb, progress: number) {
    if (progress <= 0) return;
    const side = size * (1 + (1 - easeOut(progress)) * 0.7);
    const radius = side * 0.18;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.14);
    ctx.globalAlpha = Math.min(1, progress * 1.6);
    ctx.fillStyle = rgba(color, 0.95);
    ctx.beginPath();
    ctx.roundRect(-side / 2, -side / 2, side, side, radius);
    ctx.fill();
    // 印边：一圈细白边，像盖在纸上的方印；这么小写不清字，所以不写字。
    ctx.strokeStyle = "rgba(251,248,242,0.7)";
    ctx.lineWidth = Math.max(0.7, side * 0.07);
    ctx.beginPath();
    ctx.roundRect(-side * 0.3, -side * 0.3, side * 0.6, side * 0.6, radius * 0.6);
    ctx.stroke();
    ctx.restore();
}

/** 画一帧。box 是画布边长（CSS 像素），time 秒，since 是进入当前状态的时间（秒）。 */
export function drawInkDrop(ctx: CanvasRenderingContext2D, box: number, time: number, state: InkOrbState, since: number, palette: InkPalette) {
    const cx = box / 2;
    const cy = box / 2;
    const radius = box * 0.27;
    const working = state === "work";
    const speed = working ? 2.6 : 0.7;
    const amp = working ? 0.08 : 0.045;
    const flow = time * speed;
    for (let ring = 3; ring >= 1; ring--) {
        blobPath(ctx, cx, cy, radius * (1 + 0.1 * ring), amp * 1.7, flow * 0.7, ring * 1.7);
        ctx.fillStyle = rgba(palette.ink, 0.05);
        ctx.fill();
    }
    if (working) {
        for (let wave = 0; wave < 2; wave++) {
            const phase = (time * 0.62 + wave * 0.5) % 1;
            ctx.beginPath();
            ctx.arc(cx, cy, radius * (1.05 + phase * 0.5), 0, Math.PI * 2);
            ctx.strokeStyle = rgba(palette.ink, (1 - phase) * 0.2);
            ctx.lineWidth = box * 0.02 * (1 - phase * 0.5);
            ctx.stroke();
        }
    }
    blobPath(ctx, cx, cy, radius, amp, flow, 0);
    const body = ctx.createRadialGradient(cx - radius * 0.3, cy - radius * 0.32, radius * 0.08, cx, cy, radius * 1.12);
    body.addColorStop(0, rgba(palette.ink, 0.74));
    body.addColorStop(0.6, rgba(palette.ink, 0.9));
    body.addColorStop(1, rgba(palette.ink, 0.97));
    ctx.fillStyle = body;
    ctx.fill();
    ctx.save();
    blobPath(ctx, cx, cy, radius, amp, flow, 0);
    ctx.clip();
    for (let current = 0; current < 3; current++) {
        const x = cx + radius * 0.45 * Math.cos(flow * 0.55 + current * 2.1);
        const y = cy + radius * 0.4 * Math.sin(flow * 0.7 + current * 1.7 + 0.6);
        const swirl = ctx.createRadialGradient(x, y, 0, x, y, radius * 0.66);
        swirl.addColorStop(0, rgba(palette.paper, 0.17));
        swirl.addColorStop(1, rgba(palette.paper, 0));
        ctx.fillStyle = swirl;
        ctx.fillRect(0, 0, box, box);
    }
    ctx.restore();
    if (state === "done") drawSeal(ctx, cx + radius * 0.86, cy + radius * 0.86, box * 0.17, palette.seal, (time - since) / 0.4);
}

export function InkOrb({ size = 60, state = "idle", className }: { size?: number; state?: InkOrbState; className?: string }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const dark = useThemeStore((store) => store.theme === "dark");
    const reducedMotion = useReducedMotion();
    const box = inkOrbCanvasSize(size);
    const stateRef = useRef({ state, since: 0 });

    useEffect(() => {
        if (stateRef.current.state !== state) stateRef.current = { state, since: performance.now() / 1000 };
    }, [state]);

    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) return;
        const dpr = Math.min(3, window.devicePixelRatio || 1);
        canvas.width = canvas.height = Math.round(box * dpr);
        const palette = dark ? DARK : LIGHT;
        const paint = (seconds: number) => {
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, box, box);
            drawInkDrop(ctx, box, seconds, stateRef.current.state, stateRef.current.since, palette);
        };
        // 减少动态效果：只画一帧静止的墨滴（完成时朱印直接盖好）。
        if (reducedMotion) {
            paint(stateRef.current.since + 1.2);
            return;
        }
        let frame = 0;
        const loop = (now: number) => {
            if (!document.hidden) paint(now / 1000);
            frame = requestAnimationFrame(loop);
        };
        frame = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(frame);
    }, [box, dark, reducedMotion, state]);

    return (
        <span className={cn("ink-orb", className)} style={{ width: size, height: size }} aria-hidden="true">
            <canvas ref={canvasRef} style={{ width: box, height: box }} />
        </span>
    );
}
