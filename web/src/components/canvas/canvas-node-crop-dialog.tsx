import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button, Modal } from "antd";
import { Check, Lock, LockOpen, X } from "lucide-react";

import { readImageMeta } from "@/lib/image-utils";

export type CanvasImageCropRect = {
    x: number;
    y: number;
    width: number;
    height: number;
};

type DragMode = "move" | "resize";
type ResizeHandle = "n" | "e" | "s" | "w" | "ne" | "nw" | "se" | "sw";
type CropAspectPreset = "original" | "1:1" | "3:2" | "2:3" | "4:3" | "3:4" | "16:9" | "9:16";

const handles: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const minSize = 0.06;
const defaultCrop = { x: 0.12, y: 0.12, width: 0.76, height: 0.76 };
const cropAspectPresets: Array<{ value: CropAspectPreset; label: string; ratio?: number }> = [
    { value: "original", label: "原图" },
    { value: "1:1", label: "1:1", ratio: 1 },
    { value: "3:2", label: "3:2", ratio: 3 / 2 },
    { value: "2:3", label: "2:3", ratio: 2 / 3 },
    { value: "4:3", label: "4:3", ratio: 4 / 3 },
    { value: "3:4", label: "3:4", ratio: 3 / 4 },
    { value: "16:9", label: "16:9", ratio: 16 / 9 },
    { value: "9:16", label: "9:16", ratio: 9 / 16 },
];

export function CanvasNodeCropDialog({ dataUrl, open, onClose, onConfirm }: { dataUrl: string; open: boolean; onClose: () => void; onConfirm: (crop: CanvasImageCropRect) => void }) {
    const boxRef = useRef<HTMLDivElement>(null);
    const [crop, setCrop] = useState<CanvasImageCropRect>(defaultCrop);
    const [lockedRatio, setLockedRatio] = useState<number | null>(null);
    const [activePreset, setActivePreset] = useState<CropAspectPreset | "custom" | null>(null);
    const [image, setImage] = useState<{ width: number; height: number } | null>(null);
    const cropSize = image ? { width: Math.max(1, Math.round(crop.width * image.width)), height: Math.max(1, Math.round(crop.height * image.height)) } : null;

    useEffect(() => {
        if (!open) return;
        setCrop(defaultCrop);
        setLockedRatio(null);
        setActivePreset(null);
    }, [dataUrl, open]);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        setImage(null);
        void readImageMeta(dataUrl).then((meta) => {
            if (!cancelled) setImage(meta);
        });
        return () => {
            cancelled = true;
        };
    }, [dataUrl, open]);

    const startDrag = (mode: DragMode, event: ReactPointerEvent, handle?: ResizeHandle) => {
        const box = boxRef.current?.getBoundingClientRect();
        if (!box) return;
        event.preventDefault();
        event.stopPropagation();
        const start = { x: event.clientX, y: event.clientY, crop };
        const move = (event: PointerEvent) => {
            const dx = (event.clientX - start.x) / box.width;
            const dy = (event.clientY - start.y) / box.height;
            setCrop(mode === "move" ? moveCrop(start.crop, dx, dy) : resizeCrop(start.crop, dx, dy, handle || "se", lockedRatio, box));
        };
        const up = () => {
            document.removeEventListener("pointermove", move);
            document.removeEventListener("pointerup", up);
        };
        document.addEventListener("pointermove", move);
        document.addEventListener("pointerup", up);
    };

    const selectAspectPreset = (preset: (typeof cropAspectPresets)[number]) => {
        if (!image) return;
        const ratio = preset.ratio || image.width / image.height;
        setCrop((current) => fitCropToAspect(current, ratio, image));
        setLockedRatio(ratio);
        setActivePreset(preset.value);
    };

    const toggleAspectLock = () => {
        if (lockedRatio !== null) {
            setLockedRatio(null);
            setActivePreset(null);
            return;
        }
        if (!image) return;
        setLockedRatio((crop.width * image.width) / (crop.height * image.height));
        setActivePreset("custom");
    };

    const resetCrop = () => {
        setCrop(defaultCrop);
        setLockedRatio(null);
        setActivePreset(null);
    };

    return (
        <Modal title="裁剪图片" open={open && Boolean(dataUrl)} onCancel={onClose} footer={null} width={780} centered destroyOnHidden>
            <div className="space-y-4">
                <div className="flex justify-center">
                    <div ref={boxRef} className="relative inline-block max-w-full overflow-hidden rounded-lg bg-black select-none">
                        <img src={dataUrl} alt="" className="block max-h-[62vh] max-w-full opacity-90" draggable={false} />
                        <CropMask crop={crop} />
                        <div className="absolute cursor-move border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,.3),0_0_28px_rgba(0,0,0,.28)]" style={cropStyle(crop)} onPointerDown={(event) => startDrag("move", event)}>
                            <div className="pointer-events-none absolute inset-x-0 top-1/3 border-t border-white/50" />
                            <div className="pointer-events-none absolute inset-x-0 top-2/3 border-t border-white/50" />
                            <div className="pointer-events-none absolute inset-y-0 left-1/3 border-l border-white/50" />
                            <div className="pointer-events-none absolute inset-y-0 left-2/3 border-l border-white/50" />
                            {handles.map((handle) => (
                                <button key={handle} type="button" className="absolute size-3 rounded-full border border-black bg-white" style={handleStyle(handle)} onPointerDown={(event) => startDrag("resize", event, handle)} aria-label="调整裁剪框" />
                            ))}
                        </div>
                    </div>
                </div>

                <div>
                    <div className="mb-2 text-sm font-medium">常用比例</div>
                    <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
                        {cropAspectPresets.map((preset) => (
                            <Button key={preset.value} size="small" type={activePreset === preset.value ? "primary" : "default"} disabled={!image} aria-pressed={activePreset === preset.value} onClick={() => selectAspectPreset(preset)}>
                                {preset.label}
                            </Button>
                        ))}
                    </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2">
                    <div className="flex flex-wrap items-center gap-3 text-sm opacity-80">
                        <span>裁剪尺寸 {cropSize ? `${cropSize.width} x ${cropSize.height}` : "未知"}</span>
                        <span>比例 {cropSize ? formatRatio(cropSize.width, cropSize.height) : "未知"}</span>
                        {image ? (
                            <span>
                                原图 {image.width} x {image.height}
                            </span>
                        ) : null}
                    </div>
                    <Button disabled={!image} icon={lockedRatio !== null ? <Lock className="size-4" /> : <LockOpen className="size-4" />} onClick={toggleAspectLock}>
                        {lockedRatio !== null ? "解除比例锁定" : "锁定当前比例"}
                    </Button>
                </div>

                <div className="flex items-center justify-end gap-2">
                    <Button onClick={resetCrop}>重置</Button>
                    <Button icon={<X className="size-4" />} onClick={onClose}>
                        取消
                    </Button>
                    <Button type="primary" icon={<Check className="size-4" />} onClick={() => onConfirm(crop)}>
                        确认裁剪
                    </Button>
                </div>
            </div>
        </Modal>
    );
}

function CropMask({ crop }: { crop: CanvasImageCropRect }) {
    return (
        <>
            <div className="absolute inset-x-0 top-0 bg-black/55" style={{ height: `${crop.y * 100}%` }} />
            <div className="absolute inset-x-0 bottom-0 bg-black/55" style={{ height: `${(1 - crop.y - crop.height) * 100}%` }} />
            <div className="absolute bg-black/55" style={{ left: 0, top: `${crop.y * 100}%`, width: `${crop.x * 100}%`, height: `${crop.height * 100}%` }} />
            <div className="absolute bg-black/55" style={{ right: 0, top: `${crop.y * 100}%`, width: `${(1 - crop.x - crop.width) * 100}%`, height: `${crop.height * 100}%` }} />
        </>
    );
}

function moveCrop(crop: CanvasImageCropRect, dx: number, dy: number): CanvasImageCropRect {
    return { ...crop, x: clamp(crop.x + dx, 0, 1 - crop.width), y: clamp(crop.y + dy, 0, 1 - crop.height) };
}

function resizeCrop(crop: CanvasImageCropRect, dx: number, dy: number, handle: ResizeHandle, lockedRatio: number | null, box: DOMRect): CanvasImageCropRect {
    if (lockedRatio !== null) return resizeLockedCrop(crop, dx, dy, handle, lockedRatio, box);
    let next = { ...crop };
    if (handle.includes("e")) next.width = crop.width + dx;
    if (handle.includes("s")) next.height = crop.height + dy;
    if (handle.includes("w")) {
        next.x = crop.x + dx;
        next.width = crop.width - dx;
    }
    if (handle.includes("n")) {
        next.y = crop.y + dy;
        next.height = crop.height - dy;
    }
    next.width = clamp(next.width, minSize, 1);
    next.height = clamp(next.height, minSize, 1);
    next.x = clamp(next.x, 0, 1 - next.width);
    next.y = clamp(next.y, 0, 1 - next.height);
    return next;
}

function resizeLockedCrop(crop: CanvasImageCropRect, dx: number, dy: number, handle: ResizeHandle, ratio: number, box: DOMRect): CanvasImageCropRect {
    // 裁剪坐标按显示框归一化，像素宽高比需先换算到归一化坐标系。
    const normalizedRatio = (ratio * box.height) / box.width;
    if (!Number.isFinite(normalizedRatio) || normalizedRatio <= 0) return crop;

    const horizontal = handle.includes("e") || handle.includes("w");
    const vertical = handle.includes("n") || handle.includes("s");
    const candidateWidth = handle.includes("w") ? crop.width - dx : handle.includes("e") ? crop.width + dx : crop.width;
    const candidateHeight = handle.includes("n") ? crop.height - dy : handle.includes("s") ? crop.height + dy : crop.height;
    let width = candidateWidth;
    if (!horizontal || (vertical && Math.abs((candidateHeight - crop.height) * box.height) > Math.abs((candidateWidth - crop.width) * box.width))) {
        width = candidateHeight * normalizedRatio;
    }

    // 角点固定对角，单边固定对边并以另一轴中心为锚点，避免锁定比例时裁剪框漂移。
    const anchorX = handle.includes("w") ? crop.x + crop.width : handle.includes("e") ? crop.x : crop.x + crop.width / 2;
    const anchorY = handle.includes("n") ? crop.y + crop.height : handle.includes("s") ? crop.y : crop.y + crop.height / 2;
    const maxWidthByX = handle.includes("w") ? anchorX : handle.includes("e") ? 1 - anchorX : 2 * Math.min(anchorX, 1 - anchorX);
    const maxHeightByY = handle.includes("n") ? anchorY : handle.includes("s") ? 1 - anchorY : 2 * Math.min(anchorY, 1 - anchorY);
    const maxWidth = Math.min(maxWidthByX, maxHeightByY * normalizedRatio);
    if (maxWidth <= 0) return crop;
    const minWidth = Math.min(maxWidth, Math.max(minSize, minSize * normalizedRatio));
    width = clamp(width, minWidth, maxWidth);
    const height = width / normalizedRatio;

    const x = handle.includes("w") ? anchorX - width : handle.includes("e") ? anchorX : anchorX - width / 2;
    const y = handle.includes("n") ? anchorY - height : handle.includes("s") ? anchorY : anchorY - height / 2;
    return { x: clamp(x, 0, 1 - width), y: clamp(y, 0, 1 - height), width, height };
}

function fitCropToAspect(crop: CanvasImageCropRect, ratio: number, image: { width: number; height: number }): CanvasImageCropRect {
    const normalizedRatio = (ratio * image.height) / image.width;
    if (!Number.isFinite(normalizedRatio) || normalizedRatio <= 0) return crop;
    // 切换快捷比例时尽量保持当前裁剪面积和中心位置，超出边界时再整体缩小。
    const area = crop.width * crop.height;
    let width = Math.sqrt(area * normalizedRatio);
    let height = width / normalizedRatio;
    const minimumScale = Math.max(1, minSize / width, minSize / height);
    width *= minimumScale;
    height *= minimumScale;
    const maximumScale = Math.min(1, 1 / width, 1 / height);
    width *= maximumScale;
    height *= maximumScale;
    const centerX = crop.x + crop.width / 2;
    const centerY = crop.y + crop.height / 2;
    return {
        x: clamp(centerX - width / 2, 0, 1 - width),
        y: clamp(centerY - height / 2, 0, 1 - height),
        width,
        height,
    };
}

function cropStyle(crop: CanvasImageCropRect) {
    return { left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` };
}

function handleStyle(handle: ResizeHandle) {
    const top = handle.includes("n") ? "-6px" : handle.includes("s") ? "calc(100% - 6px)" : "calc(50% - 6px)";
    const left = handle.includes("w") ? "-6px" : handle.includes("e") ? "calc(100% - 6px)" : "calc(50% - 6px)";
    return { top, left, cursor: `${handle}-resize` };
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function formatRatio(width: number, height: number) {
    const divisor = gcd(width, height);
    return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

function gcd(a: number, b: number): number {
    return b ? gcd(b, a % b) : Math.max(1, a);
}
