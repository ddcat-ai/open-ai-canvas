import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button, Segmented, Slider, Tooltip } from "antd";
import { Camera, RotateCcw, Send, X } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

export type CanvasImageAngleParams = {
    horizontalAngle: number;
    pitchAngle: number;
    cameraDistance: number;
    wideAngle: boolean;
};

const defaultParams: CanvasImageAngleParams = { horizontalAngle: 0, pitchAngle: 0, cameraDistance: 4.8, wideAngle: false };
const presets = [
    { label: "正面", horizontalAngle: 0, pitchAngle: 0 },
    { label: "左侧", horizontalAngle: -90, pitchAngle: 0 },
    { label: "右侧", horizontalAngle: 90, pitchAngle: 0 },
    { label: "背面", horizontalAngle: 180, pitchAngle: 0 },
    { label: "俯拍", horizontalAngle: 0, pitchAngle: 55 },
    { label: "仰拍", horizontalAngle: 0, pitchAngle: -45 },
];

export function CanvasNodeAnglePanel({ dataUrl, onClose, onConfirm }: { dataUrl: string; onClose: () => void; onConfirm: (params: CanvasImageAngleParams) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [params, setParams] = useState(defaultParams);
    const dragRef = useRef<{ x: number; y: number; horizontal: number; pitch: number } | null>(null);
    const update = <Key extends keyof CanvasImageAngleParams>(key: Key, value: CanvasImageAngleParams[Key]) => setParams((current) => ({ ...current, [key]: value }));

    const startCameraDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { x: event.clientX, y: event.clientY, horizontal: params.horizontalAngle, pitch: params.pitchAngle };
    };
    const moveCamera = (event: ReactPointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag) return;
        update("horizontalAngle", clamp(Math.round(drag.horizontal + (event.clientX - drag.x) * 0.8), -180, 180));
        update("pitchAngle", clamp(Math.round(drag.pitch - (event.clientY - drag.y) * 0.55), -75, 75));
    };
    const marker = cameraMarker(params.horizontalAngle, params.pitchAngle);

    return (
        <div data-canvas-no-zoom className="overflow-hidden rounded-lg border" style={{ background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text, boxShadow: "0 18px 44px rgba(0,0,0,.2)" }} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            <div className="flex h-11 items-center gap-2 border-b px-4" style={{ borderColor: theme.node.stroke }}>
                <Camera className="size-4" />
                <span className="text-sm font-semibold">多角度编辑器</span>
                <span className="min-w-0 flex-1" />
                <Tooltip title="关闭"><button type="button" className="grid size-8 place-items-center rounded-md transition hover:bg-black/5 dark:hover:bg-white/10" onClick={onClose}><X className="size-4" /></button></Tooltip>
            </div>
            <div className="flex flex-wrap gap-1.5 border-b px-4 py-2.5" style={{ borderColor: theme.node.stroke }}>
                <button type="button" className="h-8 rounded-md px-3 text-xs font-medium" style={{ background: theme.toolbar.itemHover }}>自定义</button>
                {presets.map((preset) => <button key={preset.label} type="button" className="h-8 rounded-md border px-3 text-xs transition hover:bg-black/5 dark:hover:bg-white/10" style={{ borderColor: theme.node.stroke }} onClick={() => setParams((current) => ({ ...current, horizontalAngle: preset.horizontalAngle, pitchAngle: preset.pitchAngle }))}>{preset.label}</button>)}
            </div>
            <div className="grid gap-5 p-4 md:grid-cols-[280px_1fr]">
                <div className="relative grid aspect-square cursor-grab place-items-center overflow-hidden rounded-lg border active:cursor-grabbing" style={{ borderColor: theme.node.stroke, background: theme.node.fill }} onPointerDown={startCameraDrag} onPointerMove={moveCamera} onPointerUp={() => { dragRef.current = null; }} onPointerCancel={() => { dragRef.current = null; }}>
                    <GlobeGrid color={theme.node.muted} />
                    <img src={dataUrl} alt="角度参考" className="relative z-10 size-24 rounded-md object-cover shadow-lg" draggable={false} style={{ transform: previewTransform(params) }} />
                    <div className="pointer-events-none absolute z-20 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border shadow" style={{ left: `${marker.x}%`, top: `${marker.y}%`, background: theme.toolbar.panel, borderColor: theme.node.activeStroke, color: theme.node.activeStroke }}><Camera className="size-4" /></div>
                    <span className="pointer-events-none absolute bottom-3 text-[11px]" style={{ color: theme.node.muted }}>拖动调整摄影机位置</span>
                </div>
                <div className="flex flex-col gap-4">
                    <AngleSlider label="水平环绕" value={params.horizontalAngle} min={-180} max={180} suffix="°" onChange={(value) => update("horizontalAngle", value)} />
                    <AngleSlider label="垂直俯仰" value={params.pitchAngle} min={-75} max={75} suffix="°" onChange={(value) => update("pitchAngle", value)} />
                    <AngleSlider label="景别缩放" value={params.cameraDistance} min={1} max={10} step={0.1} suffix={distanceLabel(params.cameraDistance)} onChange={(value) => update("cameraDistance", value)} />
                    <div className="grid grid-cols-[76px_1fr] items-center gap-3">
                        <span className="text-xs font-medium" style={{ color: theme.node.muted }}>镜头</span>
                        <Segmented size="small" value={params.wideAngle ? "wide" : "standard"} options={[{ label: "标准", value: "standard" }, { label: "广角", value: "wide" }]} onChange={(value) => update("wideAngle", value === "wide")} />
                    </div>
                    <div className="mt-auto flex items-center justify-between pt-2">
                        <Button type="text" icon={<RotateCcw className="size-4" />} onClick={() => setParams(defaultParams)}>重置参数</Button>
                        <Button type="primary" icon={<Send className="size-4" />} onClick={() => onConfirm(params)}>生成新角度</Button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function AngleSlider({ label, value, min, max, step = 1, suffix, onChange }: { label: string; value: number; min: number; max: number; step?: number; suffix: string; onChange: (value: number) => void }) {
    return <div className="grid grid-cols-[76px_1fr_62px] items-center gap-3"><span className="text-xs font-medium opacity-60">{label}</span><Slider min={min} max={max} step={step} value={value} onChange={onChange} /><span className="text-right text-xs font-semibold">{Number.isInteger(value) ? value : value.toFixed(1)}{suffix.startsWith("°") ? suffix : ""}{!suffix.startsWith("°") ? ` ${suffix}` : ""}</span></div>;
}

function GlobeGrid({ color }: { color: string }) {
    return <svg aria-hidden="true" className="pointer-events-none absolute inset-5 h-[calc(100%-40px)] w-[calc(100%-40px)] opacity-35" viewBox="0 0 200 200" fill="none" stroke={color} strokeWidth="1"><circle cx="100" cy="100" r="82" /><ellipse cx="100" cy="100" rx="42" ry="82" /><ellipse cx="100" cy="100" rx="68" ry="82" /><ellipse cx="100" cy="100" rx="82" ry="28" /><ellipse cx="100" cy="100" rx="82" ry="56" /><path d="M18 100h164M100 18v164" /></svg>;
}

function cameraMarker(horizontal: number, pitch: number) {
    const horizontalRad = horizontal * Math.PI / 180;
    const pitchRad = pitch * Math.PI / 180;
    return { x: 50 + Math.sin(horizontalRad) * Math.cos(pitchRad) * 40, y: 50 - Math.sin(pitchRad) * 40 };
}

function previewTransform(params: CanvasImageAngleParams) {
    const scale = clamp(1.08 - params.cameraDistance * 0.035 - (params.wideAngle ? 0.08 : 0), 0.72, 1.08);
    return `perspective(520px) rotateY(${params.horizontalAngle * -0.18}deg) rotateX(${params.pitchAngle * 0.16}deg) scale(${scale})`;
}

function distanceLabel(value: number) {
    if (value <= 3) return "近景";
    if (value >= 7) return "全景";
    return "中景";
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}
