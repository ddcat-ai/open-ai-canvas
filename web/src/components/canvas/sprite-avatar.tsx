import { useEffect, useRef, useState, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { spriteAction, spriteBusinessBinding, spriteFrame, spriteLookFrame, validateSpritePet, type SpritePet, type SpriteRunState } from "@/lib/canvas/sprite-pet";
import { useSpriteImage } from "./use-sprite-image";

export function SpriteAvatar({
    pet,
    url,
    height,
    state = {},
    moveDirection = 0,
    reducedMotion = false,
    paused = false,
    previewAction,
    fallback,
    onReady,
    onError,
}: {
    pet: SpritePet;
    url: string;
    height: number;
    state?: SpriteRunState;
    moveDirection?: number;
    reducedMotion?: boolean;
    paused?: boolean;
    previewAction?: string;
    fallback?: ReactNode;
    onReady?: () => void;
    onError?: (message: string) => void;
}) {
    const host = useRef<HTMLSpanElement>(null);
    const imageRef = useRef<HTMLImageElement>(null);
    const callbacks = useRef({ onReady, onError });
    callbacks.current = { onReady, onError };
    const [loaded, setLoaded] = useState("");
    const [error, setError] = useState("");
    const greeted = useRef(false);
    const spriteImage = useSpriteImage(url, "atlas", pet.atlasWidth * pet.atlasHeight * 4);
    useEffect(() => {
        if (spriteImage.error) {
            setError(spriteImage.error);
            callbacks.current.onError?.(spriteImage.error);
        }
    }, [spriteImage.error]);
    const width = Math.round((height * pet.frameWidth) / pet.frameHeight);
    useEffect(() => {
        setError("");
        const invalid = validateSpritePet(pet);
        if (invalid) {
            setError(invalid);
            callbacks.current.onError?.(invalid);
        }
    }, [pet]);
    useEffect(() => {
        const target = host.current,
            image = imageRef.current;
        if (!target || !image || loaded !== url || error) return;
        let visible = true,
            timer: ReturnType<typeof setInterval> | undefined;
        let actionId = "",
            started = performance.now(),
            transientUntil = 0,
            transientId = "",
            lastActivity = performance.now(),
            hoverInside = false,
            lastHover = 0;
        let look: number | undefined;
        const initial = performance.now();
        const completionDuration = (spriteAction(pet, "completed").frames / (spriteAction(pet, "completed").fps * pet.speed)) * 1000;
        if (state.completedAt && pet.bindings.completed && Date.now() - state.completedAt < completionDuration) {
            transientId = pet.bindings.completed;
            transientUntil = initial + completionDuration - (Date.now() - state.completedAt);
        }
        const business = spriteBusinessBinding(state);
        if (!greeted.current && !paused && business === "idle" && !state.runId && !previewAction && pet.bindings.greeting) {
            transientId = pet.bindings.greeting;
            const a = spriteAction(pet, "greeting");
            transientUntil = initial + (a.frames / (a.fps * pet.speed)) * 1000;
            greeted.current = true;
        }
        let asleep = false;
        const setFrame = (frame: number) => {
            const cols = pet.atlasWidth / pet.frameWidth;
            image.style.transform = `translate(${(-frame % cols) * width}px, ${-Math.floor(frame / cols) * height}px)`;
        };
        const draw = () => {
            if (paused || document.hidden || !visible) return;
            const now = performance.now();
            if (reducedMotion && !previewAction) {
                setFrame(pet.neutralFrame);
                return;
            }
            if (business === "idle" && pet.sleepAfterSeconds > 0 && now - lastActivity >= pet.sleepAfterSeconds * 1000) asleep = true;
            const interactive = business === "idle" && !state.cleanupPending;
            const binding = business !== "idle" ? business : moveDirection ? (moveDirection > 0 ? "moveRight" : "moveLeft") : asleep ? "sleep" : "idle";
            const nextId = previewAction || (business === "idle" && !moveDirection && transientUntil > now ? transientId : spriteAction(pet, binding).id);
            const action = pet.actions.find((a) => a.id === nextId) || spriteAction(pet, "idle");
            if (action.id !== actionId) {
                actionId = action.id;
                started = now;
            }
            if (!previewAction && interactive && !moveDirection && !asleep && transientUntil <= now && now - lastActivity < 1500 && look !== undefined) setFrame(look);
            else setFrame(spriteFrame(pet, action, now - started));
            target.dataset.action = action.id;
        };
        const interact = (event?: Event) => {
            if (paused || !visible || document.hidden) return;
            const now = performance.now();
            if (asleep && business === "idle" && pet.bindings.wake) {
                transientId = pet.bindings.wake;
                const a = spriteAction(pet, "wake");
                transientUntil = now + (a.frames / (a.fps * pet.speed)) * 1000;
            }
            asleep = false;
            lastActivity = now;
            if (event instanceof PointerEvent && event.pointerType !== "touch") {
                const rect = target.getBoundingClientRect(),
                    dx = event.clientX - (rect.left + rect.width / 2),
                    dy = event.clientY - (rect.top + rect.height / 2);
                look = pet.lookDirections ? spriteLookFrame(pet, dx, dy) : undefined;
                const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
                if (inside && !hoverInside && now - lastHover > 3000 && business === "idle" && !moveDirection && pet.bindings.hover) {
                    const a = spriteAction(pet, "hover");
                    transientId = a.id;
                    transientUntil = now + (a.frames / (a.fps * pet.speed)) * 1000;
                    lastHover = now;
                }
                hoverInside = inside;
            }
        };
        const leave = () => {
            look = undefined;
            hoverInside = false;
        };
        const sync = () => {
            clearInterval(timer);
            timer = undefined;
            if (!paused && visible && !document.hidden) {
                draw();
                if (!reducedMotion || previewAction) timer = setInterval(draw, 1000 / 30);
            }
        };
        const observer = new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
            sync();
        });
        observer.observe(target);
        document.addEventListener("visibilitychange", sync);
        if (!previewAction && !paused && !reducedMotion) {
            document.addEventListener("pointermove", interact, { passive: true });
            document.addEventListener("pointerdown", interact, { passive: true });
            document.addEventListener("keydown", interact);
            document.documentElement.addEventListener("pointerleave", leave);
        }
        setFrame(pet.neutralFrame);
        sync();
        return () => {
            clearInterval(timer);
            observer.disconnect();
            document.removeEventListener("visibilitychange", sync);
            document.removeEventListener("pointermove", interact);
            document.removeEventListener("pointerdown", interact);
            document.removeEventListener("keydown", interact);
            document.documentElement.removeEventListener("pointerleave", leave);
        };
    }, [pet, url, height, width, state.runId, state.status, state.cleanupPending, state.waitingUser, state.approvalPending, state.connected, state.completedAt, moveDirection, reducedMotion, paused, previewAction, loaded, error]);
    const ready = loaded === url && !error;
    return (
        <span
            ref={host}
            data-sprite-avatar
            data-paused={paused || undefined}
            aria-busy={!error && !ready}
            style={{ display: "inline-block", position: "relative", overflow: "hidden", width, height, maxWidth: "100%", pointerEvents: "none", flexShrink: 0 }}
        >
            {!error ? (
                <img
                    ref={imageRef}
                    src={spriteImage.src || undefined}
                    alt=""
                    aria-hidden="true"
                    draggable={false}
                    decoding="async"
                    style={{ position: "absolute", left: 0, top: 0, width: (width * pet.atlasWidth) / pet.frameWidth, height: (height * pet.atlasHeight) / pet.frameHeight, maxWidth: "none", visibility: ready ? "visible" : "hidden" }}
                    onLoad={(e) => {
                        if (e.currentTarget.naturalWidth !== pet.atlasWidth || e.currentTarget.naturalHeight !== pet.atlasHeight) {
                            const m = "精灵图片尺寸与配置不一致";
                            setError(m);
                            callbacks.current.onError?.(m);
                            return;
                        }
                        setLoaded(url);
                        setError("");
                        callbacks.current.onReady?.();
                    }}
                    onError={() => {
                        const m = "精灵图片加载失败，请检查资源后重试";
                        setError(m);
                        callbacks.current.onError?.(m);
                    }}
                />
            ) : null}
            {error ? (
                <span role="status" style={{ display: "grid", placeItems: "center", height: "100%" }}>
                    {fallback}
                    <span className="sr-only">{error}</span>
                </span>
            ) : !ready ? (
                <span role="status" style={{ display: "grid", placeItems: "center", height: "100%" }}>
                    <LoaderCircle className={reducedMotion ? "size-6" : "size-6 animate-spin"} />
                    <span className="sr-only">正在加载精灵宠物</span>
                </span>
            ) : null}
        </span>
    );
}
