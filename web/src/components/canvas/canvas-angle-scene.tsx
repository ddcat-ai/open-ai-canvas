import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";

import { cn } from "@/lib/utils";

import "./canvas-angle-scene.css";

/** 预览交互范围对齐 recombyn：俯仰 ±60；水平保留 ±180 以便「背面」绕到主体后方。 */
const rotateMin = -180;
const rotateMax = 180;
const tiltMin = -60;
const tiltMax = 60;
const rotateStep = 5;
const tiltStep = 5;
const orbitRingY = [0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165] as const;
const orbitRingX = [0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165] as const;
const cameraOrbitRadius = 75;
const cameraSightLine = 67;
const subjectMaxBox = 64;
const cubeSize = 100;

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function snapInt(value: number, min: number, max: number) {
    return Math.round(clamp(value, min, max));
}

function visualScale(distance: number) {
    if (distance <= 3) return 0.78;
    if (distance >= 7) return 1;
    return 0.88;
}

function subjectBoxSize(naturalW: number, naturalH: number) {
    const scale = Math.min(subjectMaxBox / Math.max(1, naturalW), subjectMaxBox / Math.max(1, naturalH));
    return { width: Math.max(20, Math.round(naturalW * scale)), height: Math.max(20, Math.round(naturalH * scale)) };
}

export function CanvasAngleScene({
    mode,
    rotate,
    tilt,
    distance,
    imageSrc,
    faceLabels,
    dirLabels,
    onRotateChange,
    onTiltChange,
}: {
    mode: "camera" | "skybox";
    rotate: number;
    tilt: number;
    distance: number;
    imageSrc: string;
    faceLabels: { back: string; right: string; left: string; top: string; bottom: string };
    dirLabels: { up: string; down: string; left: string; right: string };
    onRotateChange: (value: number) => void;
    onTiltChange: (value: number) => void;
}) {
    const scale = visualScale(distance);
    const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
    const [dragging, setDragging] = useState(false);
    const sceneRef = useRef<HTMLDivElement>(null);
    const dragPointer = useRef<number | null>(null);
    const dragStart = useRef<{ x: number; y: number; rotate: number; tilt: number } | null>(null);
    const rotateRef = useRef(onRotateChange);
    const tiltRef = useRef(onTiltChange);
    const modeRef = useRef(mode);
    rotateRef.current = onRotateChange;
    tiltRef.current = onTiltChange;
    modeRef.current = mode;

    useEffect(() => {
        setNaturalSize(null);
        let cancelled = false;
        const image = new Image();
        image.onload = () => {
            if (cancelled) return;
            const w = image.naturalWidth || image.width;
            const h = image.naturalHeight || image.height;
            if (w > 0 && h > 0) setNaturalSize({ w, h });
        };
        image.src = imageSrc;
        return () => { cancelled = true; };
    }, [imageSrc]);

    const subjectSize = useMemo(() => {
        if (!naturalSize) return { width: subjectMaxBox, height: subjectMaxBox };
        return subjectBoxSize(naturalSize.w, naturalSize.h);
    }, [naturalSize]);

    const screenBg = useMemo<CSSProperties>(() => ({
        backgroundImage: `url("${imageSrc}")`,
        backgroundSize: "contain",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
    }), [imageSrc]);

    useEffect(() => {
        if (!dragging) return;
        const onMove = (event: PointerEvent) => {
            if (dragPointer.current == null || event.pointerId !== dragPointer.current || !dragStart.current) return;
            const dx = event.clientX - dragStart.current.x;
            const dy = event.clientY - dragStart.current.y;
            rotateRef.current(snapInt(dragStart.current.rotate + dx / 1.8, rotateMin, rotateMax));
            const tiltDelta = modeRef.current === "skybox" ? dy / 2.2 : -dy / 2.2;
            tiltRef.current(snapInt(dragStart.current.tilt + tiltDelta, tiltMin, tiltMax));
        };
        const onUp = (event: PointerEvent) => {
            if (dragPointer.current == null || event.pointerId !== dragPointer.current) return;
            const start = dragStart.current;
            if (start) {
                const dx = event.clientX - start.x;
                const dy = event.clientY - start.y;
                rotateRef.current(snapInt(start.rotate + dx / 1.8, rotateMin, rotateMax));
                const tiltDelta = modeRef.current === "skybox" ? dy / 2.2 : -dy / 2.2;
                tiltRef.current(snapInt(start.tilt + tiltDelta, tiltMin, tiltMax));
            }
            dragPointer.current = null;
            dragStart.current = null;
            setDragging(false);
            const el = sceneRef.current;
            if (el?.hasPointerCapture?.(event.pointerId)) {
                try { el.releasePointerCapture(event.pointerId); } catch { /* ignore */ }
            }
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
        return () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", onUp);
        };
    }, [dragging]);

    const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
        if ((event.target as HTMLElement).closest(".canvas-angle-dir")) return;
        event.preventDefault();
        event.stopPropagation();
        dragPointer.current = event.pointerId;
        dragStart.current = { x: event.clientX, y: event.clientY, rotate, tilt };
        setDragging(true);
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* ignore */ }
    };

    const bumpRotate = (delta: number) => onRotateChange(snapInt(rotate + delta, rotateMin, rotateMax));
    const bumpTilt = (delta: number) => onTiltChange(snapInt(tilt + delta, tiltMin, tiltMax));
    const cubeStyle = { width: cubeSize, height: cubeSize, ["--angle-cube-half" as string]: `${cubeSize / 2}px` } as CSSProperties;
    const dirButtons = (
        <>
            <button type="button" className="canvas-angle-dir is-up" aria-label={dirLabels.up} onClick={() => bumpTilt(tiltStep)}><ChevronUp className="size-3.5" strokeWidth={2} /></button>
            <button type="button" className="canvas-angle-dir is-down" aria-label={dirLabels.down} onClick={() => bumpTilt(-tiltStep)}><ChevronDown className="size-3.5" strokeWidth={2} /></button>
            <button type="button" className="canvas-angle-dir is-left" aria-label={dirLabels.left} onClick={() => bumpRotate(-rotateStep)}><ChevronLeft className="size-3.5" strokeWidth={2} /></button>
            <button type="button" className="canvas-angle-dir is-right" aria-label={dirLabels.right} onClick={() => bumpRotate(rotateStep)}><ChevronRight className="size-3.5" strokeWidth={2} /></button>
        </>
    );

    if (mode === "skybox") {
        return (
            <div className="canvas-angle-scene">
                <div ref={sceneRef} className={cn("canvas-angle-unified is-skybox", dragging && "is-dragging")} style={{ perspective: 900 }} onPointerDown={onPointerDown}>
                    <div className="canvas-angle-skybox-stage">
                        <div className="canvas-angle-skybox-space" style={{ perspective: 900 }}>
                            <div className="canvas-angle-cube-wrap" style={{ transition: dragging ? "none" : undefined, transform: `scale(${scale}) rotateX(${-tilt}deg) rotateY(${rotate}deg)` }}>
                                <div className="canvas-angle-cube" style={cubeStyle}>
                                    <div className="canvas-angle-cube-face is-front has-image"><img src={imageSrc} alt="" draggable={false} /></div>
                                    <div className="canvas-angle-cube-face is-back"><span>{faceLabels.back}</span></div>
                                    <div className="canvas-angle-cube-face is-right"><span>{faceLabels.right}</span></div>
                                    <div className="canvas-angle-cube-face is-left"><span>{faceLabels.left}</span></div>
                                    <div className="canvas-angle-cube-face is-top"><span>{faceLabels.top}</span></div>
                                    <div className="canvas-angle-cube-face is-bottom"><span>{faceLabels.bottom}</span></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="canvas-angle-scene">
            <div ref={sceneRef} className={cn("canvas-angle-unified is-camera", dragging && "is-dragging")} style={{ perspective: 1200 }} onPointerDown={onPointerDown}>
                <div className="canvas-angle-subject-wrap">
                    <div className="canvas-angle-subject" style={{ width: subjectSize.width, height: subjectSize.height, transition: dragging ? "none" : "transform 120ms ease-out", transform: `scale(${scale})` }}>
                        <img src={imageSrc} alt="" draggable={false} />
                    </div>
                </div>
                <div className="canvas-angle-orbit" aria-hidden>
                    <div className="canvas-angle-orbit-core" style={{ transform: `rotateY(${rotate}deg) rotateX(${tilt}deg)`, transition: dragging ? "none" : "transform 120ms ease-out" }}>
                        {orbitRingY.map((deg) => <div key={`y-${deg}`} className="canvas-angle-orbit-ring" style={{ transform: `rotateY(${deg}deg)` }} />)}
                        {orbitRingX.map((deg) => <div key={`x-${deg}`} className="canvas-angle-orbit-ring" style={{ transform: `rotateX(${deg}deg)` }} />)}
                    </div>
                    <div className="canvas-angle-orbit-axis" />
                </div>
                <div className="canvas-angle-camera-layer">
                    <div className="canvas-angle-cam-pivot" style={{ transform: `rotateX(${tilt}deg) rotateY(${rotate}deg)` }}>
                        <div className="canvas-angle-cam-pos" style={{ transform: `translateZ(${cameraOrbitRadius}px) scale(1) rotateZ(0deg)` }}>
                            <div className="canvas-angle-cam-body is-front" style={{ transform: "translate(-50%, -50%) translateZ(-8px)" }}>
                                <div className="canvas-angle-cam-lens"><span /></div>
                            </div>
                            <div className="canvas-angle-cam-body is-back" style={{ transform: "translate(-50%, -50%) translateZ(8px)" }}>
                                <div className="canvas-angle-cam-screen" style={screenBg} />
                            </div>
                            <div className="canvas-angle-cam-body is-top" style={{ transform: "translate(-50%, -50%) rotateX(90deg) translateZ(8.2px)" }}>
                                <span className="canvas-angle-cam-shutter" />
                            </div>
                            <div className="canvas-angle-cam-body is-bottom" style={{ transform: "translate(-50%, -50%) rotateX(-90deg) translateZ(8.2px)" }} />
                            <div className="canvas-angle-cam-body is-side" style={{ transform: "translate(-50%, -50%) rotateY(-90deg) translateZ(11px)" }} />
                            <div className="canvas-angle-cam-body is-side" style={{ transform: "translate(-50%, -50%) rotateY(90deg) translateZ(11px)" }} />
                            <div className="canvas-angle-cam-hotshoe" style={{ transform: "translate(-50%, -50%) translateY(-12px)" }}>
                                <div className="canvas-angle-cam-hotshoe-body" style={{ transform: "translateZ(2px)" }}><span /></div>
                            </div>
                            <div className="canvas-angle-cam-line" style={{ height: cameraSightLine, transform: "translate(-50%, 0) translateZ(-8px) rotateX(-90deg)" }} />
                        </div>
                    </div>
                    <div className="canvas-angle-orbit-nav">{dirButtons}</div>
                </div>
            </div>
        </div>
    );
}
