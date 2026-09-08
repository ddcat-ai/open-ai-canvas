import { useEffect, useRef } from "react";

import { useAppearanceStore } from "@/stores/use-appearance-store";

// 赛博霓虹皮肤（neon）专用背景：粒子连线 + 径向辉光 + 扫描线。
// 参考 neon-fit.html 案例；仅当 skinId === "neon" 时挂载，其余皮肤渲染 null。
// 遵循 prefers-reduced-motion：减动效用户只画一帧静态粒子，不做动画。

const DOT_COLORS = ["0,240,255", "255,43,214", "139,92,255", "57,255,136"];
const LINK_COLOR = "0,240,255";
const LINK_DISTANCE = 132;
const MOUSE_RADIUS = 150;

type Particle = {
    x: number;
    y: number;
    vx: number;
    vy: number;
    radius: number;
    color: string;
};

export function NeonBackdrop() {
    const skinId = useAppearanceStore((state) => state.appearance.skinId);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const active = skinId === "neon";

    useEffect(() => {
        if (!active) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const context = canvas.getContext("2d");
        if (!context) return;
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        let raf = 0;
        let width = 0;
        let height = 0;
        let particles: Particle[] = [];
        const mouse = { x: -9999, y: -9999 };

        const spawn = (): Particle => ({
            x: Math.random() * width,
            y: Math.random() * height,
            vx: (Math.random() - 0.5) * 0.42,
            vy: (Math.random() - 0.5) * 0.42,
            radius: 1 + Math.random() * 1.9,
            color: DOT_COLORS[Math.floor(Math.random() * DOT_COLORS.length)],
        });

        const resize = () => {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            width = canvas.clientWidth;
            height = canvas.clientHeight;
            canvas.width = Math.max(1, Math.round(width * dpr));
            canvas.height = Math.max(1, Math.round(height * dpr));
            context.setTransform(dpr, 0, 0, dpr, 0, 0);
            const target = Math.min(92, Math.max(36, Math.round((width * height) / 26000)));
            particles = Array.from({ length: target }, spawn);
        };

        const drawFrame = () => {
            context.clearRect(0, 0, width, height);

            for (const particle of particles) {
                particle.x += particle.vx;
                particle.y += particle.vy;
                if (particle.x < 0 || particle.x > width) particle.vx *= -1;
                if (particle.y < 0 || particle.y > height) particle.vy *= -1;

                // 鼠标轻微排斥，让背景对指针有一点点"回应感"
                const dx = particle.x - mouse.x;
                const dy = particle.y - mouse.y;
                const mouseDistance = Math.hypot(dx, dy);
                if (mouseDistance < MOUSE_RADIUS && mouseDistance > 0.01) {
                    const push = ((MOUSE_RADIUS - mouseDistance) / MOUSE_RADIUS) * 0.045;
                    particle.x += (dx / mouseDistance) * push * 3;
                    particle.y += (dy / mouseDistance) * push * 3;
                }
            }

            // 粒子连线（青色为主，随距离衰减）
            context.lineWidth = 1;
            for (let i = 0; i < particles.length; i++) {
                for (let j = i + 1; j < particles.length; j++) {
                    const a = particles[i];
                    const b = particles[j];
                    const distance = Math.hypot(a.x - b.x, a.y - b.y);
                    if (distance >= LINK_DISTANCE) continue;
                    const alpha = (1 - distance / LINK_DISTANCE) * 0.34;
                    context.strokeStyle = `rgba(${LINK_COLOR},${alpha.toFixed(3)})`;
                    context.beginPath();
                    context.moveTo(a.x, a.y);
                    context.lineTo(b.x, b.y);
                    context.stroke();
                }
            }

            // 发光粒子
            for (const particle of particles) {
                context.shadowBlur = 9;
                context.shadowColor = `rgba(${particle.color},0.9)`;
                context.fillStyle = `rgba(${particle.color},0.85)`;
                context.beginPath();
                context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
                context.fill();
                context.shadowBlur = 0;
            }
        };

        const loop = () => {
            drawFrame();
            raf = window.requestAnimationFrame(loop);
        };

        const handlePointer = (event: PointerEvent) => {
            mouse.x = event.clientX;
            mouse.y = event.clientY;
        };
        const handlePointerLeave = () => {
            mouse.x = -9999;
            mouse.y = -9999;
        };
        const handleVisibility = () => {
            if (reducedMotion) return;
            window.cancelAnimationFrame(raf);
            if (!document.hidden) raf = window.requestAnimationFrame(loop);
        };

        window.addEventListener("resize", resize);
        window.addEventListener("pointermove", handlePointer, { passive: true });
        window.addEventListener("pointerleave", handlePointerLeave);
        document.addEventListener("visibilitychange", handleVisibility);
        resize();
        if (reducedMotion) {
            drawFrame();
        } else {
            raf = window.requestAnimationFrame(loop);
        }

        return () => {
            window.cancelAnimationFrame(raf);
            window.removeEventListener("resize", resize);
            window.removeEventListener("pointermove", handlePointer);
            window.removeEventListener("pointerleave", handlePointerLeave);
            document.removeEventListener("visibilitychange", handleVisibility);
        };
    }, [active]);

    if (!active) return null;

    return (
        <div className="neon-backdrop" aria-hidden="true">
            <div className="neon-glow" />
            <canvas ref={canvasRef} className="neon-fx" />
            <div className="neon-scanlines" />
        </div>
    );
}
