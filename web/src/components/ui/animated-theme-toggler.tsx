import { useCallback, useEffect, useRef, useState, type ComponentPropsWithoutRef } from "react";
import { flushSync } from "react-dom";
import { Moon, Sun } from "lucide-react";

import { cn } from "@/lib/utils";

export type TransitionVariant = "circle" | "square" | "triangle" | "diamond" | "hexagon" | "rectangle" | "star";

type ThemeName = "light" | "dark";
type Point = { x: number; y: number };
type ThemeButtonProps = ComponentPropsWithoutRef<"button">;

interface AnimatedThemeTogglerProps extends ThemeButtonProps {
    duration?: number;
    variant?: TransitionVariant;
    fromCenter?: boolean;
    theme?: ThemeName;
    targetTheme?: ThemeName;
    onThemeChange?: (theme: ThemeName) => void;
}

let revealLocked = false;
let revealAnimation: Animation | null = null;

function readTheme(): ThemeName {
    return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function oppositeTheme(theme: ThemeName): ThemeName {
    return theme === "dark" ? "light" : "dark";
}

function originPoint(button: HTMLButtonElement, fromCenter: boolean): Point {
    const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    if (fromCenter) return { x: viewportWidth / 2, y: viewportHeight / 2 };
    const bounds = button.getBoundingClientRect();
    return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
}

function reach(point: Point): number {
    const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    return Math.hypot(Math.max(point.x, viewportWidth - point.x), Math.max(point.y, viewportHeight - point.y));
}

function collapsed(point: Point, count: number): string {
    const vertex = `${point.x}px ${point.y}px`;
    return `polygon(${Array.from({ length: count }, () => vertex).join(", ")})`;
}

function polygonAt(point: Point, vertices: Point[]): string {
    return `polygon(${vertices.map((vertex) => `${vertex.x}px ${vertex.y}px`).join(", ")})`;
}

function regularVertices(point: Point, radius: number, count: number, rotation = -Math.PI / 2): Point[] {
    return Array.from({ length: count }, (_, index) => {
        const angle = rotation + (index * Math.PI * 2) / count;
        return { x: point.x + radius * Math.cos(angle), y: point.y + radius * Math.sin(angle) };
    });
}

function starVertices(point: Point, radius: number): Point[] {
    const inner = radius * 0.42;
    return Array.from({ length: 5 }, (_, index) => {
        const outerAngle = -Math.PI / 2 + (index * Math.PI * 2) / 5;
        const innerAngle = outerAngle + Math.PI / 5;
        return [
            { x: point.x + radius * Math.cos(outerAngle), y: point.y + radius * Math.sin(outerAngle) },
            { x: point.x + inner * Math.cos(innerAngle), y: point.y + inner * Math.sin(innerAngle) },
        ];
    }).flat();
}

function revealFrames(variant: TransitionVariant, point: Point, radius: number): [string, string] {
    const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    if (variant === "circle") {
        return [`circle(0px at ${point.x}px ${point.y}px)`, `circle(${radius}px at ${point.x}px ${point.y}px)`];
    }
    if (variant === "square" || variant === "rectangle") {
        const halfWidth = Math.max(point.x, viewportWidth - point.x);
        const halfHeight = Math.max(point.y, viewportHeight - point.y);
        const side = variant === "square" ? Math.max(halfWidth, halfHeight) * 1.05 : 0;
        const spanX = variant === "square" ? side : halfWidth;
        const spanY = variant === "square" ? side : halfHeight;
        const end = [
            { x: point.x - spanX, y: point.y - spanY },
            { x: point.x + spanX, y: point.y - spanY },
            { x: point.x + spanX, y: point.y + spanY },
            { x: point.x - spanX, y: point.y + spanY },
        ];
        return [collapsed(point, 4), polygonAt(point, end)];
    }
    if (variant === "triangle") {
        const scale = radius * 2.2;
        const dx = (Math.sqrt(3) / 2) * scale;
        const end = [
            { x: point.x, y: point.y - scale },
            { x: point.x + dx, y: point.y + scale / 2 },
            { x: point.x - dx, y: point.y + scale / 2 },
        ];
        return [collapsed(point, 3), polygonAt(point, end)];
    }
    if (variant === "diamond") {
        const side = radius * Math.SQRT2;
        return [collapsed(point, 4), polygonAt(point, regularVertices(point, side, 4))];
    }
    if (variant === "hexagon") {
        const side = radius * Math.SQRT2;
        return [collapsed(point, 6), polygonAt(point, regularVertices(point, side, 6))];
    }
    const outer = radius * Math.SQRT2 * 1.03;
    return [polygonAt(point, starVertices(point, Math.max(2, outer * 0.025))), polygonAt(point, starVertices(point, outer))];
}

function paintTheme(next: ThemeName, onThemeChange?: (theme: ThemeName) => void) {
    document.documentElement.classList.toggle("dark", next === "dark");
    document.documentElement.style.colorScheme = next;
    onThemeChange?.(next);
}

function revealImmediately(next: ThemeName, onThemeChange?: (theme: ThemeName) => void) {
    const root = document.documentElement;
    root.dataset.themeSwitching = "true";
    flushSync(() => paintTheme(next, onThemeChange));
    requestAnimationFrame(() => {
        delete root.dataset.themeSwitching;
    });
}

export const AnimatedThemeToggler = ({ children, className, duration = 400, variant = "circle", fromCenter = false, theme, targetTheme, onThemeChange, ...buttonProps }: AnimatedThemeTogglerProps) => {
    const [dark, setDark] = useState(false);
    const buttonRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (theme) {
            setDark(theme === "dark");
            return;
        }
        const sync = () => setDark(readTheme() === "dark");
        sync();
        const observer = new MutationObserver(sync);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
        return () => observer.disconnect();
    }, [theme]);

    const changeTheme = useCallback(() => {
        const button = buttonRef.current;
        if (!button) return;
        const current = readTheme();
        const next = targetTheme ?? oppositeTheme(current);
        if (next === current) return;

        const point = originPoint(button, fromCenter);
        const root = document.documentElement;
        const canvasOpen = root.querySelector("[data-canvas-world-layer]") !== null;
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const canReveal = typeof document.startViewTransition === "function";
        if (canvasOpen || reducedMotion || !canReveal) {
            setDark(next === "dark");
            revealImmediately(next, onThemeChange);
            return;
        }
        if (revealLocked) return;

        revealLocked = true;
        const frames = revealFrames(variant, point, reach(point));
        root.dataset.magicuiThemeVt = "active";
        root.style.setProperty("--magicui-theme-toggle-vt-duration", `${duration}ms`);
        root.style.setProperty("--magicui-theme-vt-clip-from", frames[0]);
        let closed = false;
        const finish = () => {
            if (closed) return;
            closed = true;
            revealAnimation?.cancel();
            revealAnimation = null;
            revealLocked = false;
            delete root.dataset.magicuiThemeVt;
            root.style.removeProperty("--magicui-theme-toggle-vt-duration");
            root.style.removeProperty("--magicui-theme-vt-clip-from");
        };

        let transition: ViewTransition;
        try {
            transition = document.startViewTransition(() => {
                flushSync(() => {
                    setDark(next === "dark");
                    paintTheme(next, onThemeChange);
                });
            });
        } catch {
            finish();
            setDark(next === "dark");
            revealImmediately(next, onThemeChange);
            return;
        }

        void transition.finished.then(finish, finish);
        void transition.ready
            .then(() => {
                if (closed) return;
                revealAnimation = root.animate(
                    { clipPath: frames },
                    {
                        duration,
                        easing: variant === "star" ? "linear" : "ease-in-out",
                        fill: "forwards",
                        pseudoElement: "::view-transition-new(root)",
                    },
                );
            })
            .catch(() => undefined);
    }, [duration, fromCenter, onThemeChange, targetTheme, variant]);

    return (
        <button type="button" ref={buttonRef} onClick={changeTheme} className={cn(className)} {...buttonProps}>
            {children ?? (dark ? <Sun /> : <Moon />)}
            <span className="sr-only">{buttonProps["aria-label"] || "切换主题"}</span>
        </button>
    );
};
