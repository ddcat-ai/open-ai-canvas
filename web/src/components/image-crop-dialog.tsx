import { useRef, useState, type PointerEvent } from "react";
import { Button } from "antd";
import { AppModal } from "@/components/ui/product/app-modal";
import { resolveCropPixels, type ImageCropRect } from "@/lib/canvas/image-operation-plan";
import { centeredAspectSelection, resizeSelection, selectAspect, translateSelection, type CropGrip } from "@/lib/canvas/image-crop-selection";
import { useImageToolSource } from "@/hooks/use-image-tool-source";

export type { ImageCropRect } from "@/lib/canvas/image-operation-plan";
export type ImageCropDialogProps = { dataUrl: string; open: boolean; onClose: () => void; onConfirm: (crop: ImageCropRect) => void; fixedAspect?: number; title?: string; confirmLoading?: boolean };
const initialSelection: ImageCropRect = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 };
const grips: { name: string; vector: CropGrip }[] = [
    { name: "nw", vector: [-1, -1] },
    { name: "n", vector: [0, -1] },
    { name: "ne", vector: [1, -1] },
    { name: "w", vector: [-1, 0] },
    { name: "e", vector: [1, 0] },
    { name: "sw", vector: [-1, 1] },
    { name: "s", vector: [0, 1] },
    { name: "se", vector: [1, 1] },
];
type Gesture = { pointer: number; origin: [number, number]; display: [number, number]; selection: ImageCropRect; grip: CropGrip | null };

export function ImageCropDialog(props: ImageCropDialogProps) {
    return props.open && props.dataUrl ? <CropEditor key={`${props.dataUrl}:${props.fixedAspect ?? "free"}`} {...props} /> : null;
}

function CropEditor({ dataUrl, onClose, onConfirm, fixedAspect, title = "裁剪图片", confirmLoading = false }: ImageCropDialogProps) {
    const { size, error } = useImageToolSource(dataUrl);
    const [selected, setSelection] = useState<ImageCropRect | null>(null);
    const selection = selected ?? (size && fixedAspect !== undefined ? centeredAspectSelection(size, fixedAspect) : initialSelection);
    const [locked, setLocked] = useState(false);
    const aspectLocked = fixedAspect !== undefined || locked;
    const [preset, setPreset] = useState("");
    const stage = useRef<HTMLDivElement>(null);
    const gesture = useRef<Gesture | null>(null);
    const output = size ? resolveCropPixels(size, selection) : null;
    const outputLabel = output && fixedAspect === 1 ? `输出 ${Math.min(output.width, output.height)} × ${Math.min(output.width, output.height)} px` : output ? `输出 ${output.width} × ${output.height} px` : error || "正在读取图片…";
    const begin = (event: PointerEvent<HTMLElement>, grip: CropGrip | null) => {
        if (confirmLoading || event.button !== 0 || gesture.current || !stage.current || !size) return;
        const bounds = stage.current.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        gesture.current = { pointer: event.pointerId, origin: [event.clientX, event.clientY], display: [bounds.width, bounds.height], selection, grip };
    };
    const finish = (event: PointerEvent<HTMLElement>) => {
        if (event.pointerId !== gesture.current?.pointer) return;
        gesture.current = null;
        if (event.target instanceof HTMLElement && event.target.hasPointerCapture(event.pointerId)) event.target.releasePointerCapture(event.pointerId);
    };
    const choose = (value: string) => {
        if (!size) return;
        const ratio =
            value === "原图"
                ? 1
                : (() => {
                      const [w, h] = value.split(":").map(Number);
                      return (w * size.height) / (h * size.width);
                  })();
        setSelection((box) => selectAspect(box ?? selection, ratio));
        setPreset(value);
        setLocked(true);
    };
    return (
        <AppModal
            open
            centered
            width={780}
            title={title}
            onCancel={() => {
                if (!confirmLoading) onClose();
            }}
            onOk={() => {
                if (size && !confirmLoading) onConfirm(selection);
            }}
            okText="确认裁剪"
            confirmLoading={confirmLoading}
            okButtonProps={{ disabled: !size || !!error || confirmLoading }}
            cancelButtonProps={{ disabled: confirmLoading }}
            closable={!confirmLoading}
            keyboard={!confirmLoading}
            mask={{ closable: !confirmLoading }}
        >
            <div className="space-y-4">
                <div className="flex justify-center">
                    <div
                        ref={stage}
                        className="relative inline-block max-w-full touch-none select-none overflow-hidden rounded-lg"
                        onPointerMove={(event) => {
                            const drag = gesture.current;
                            if (confirmLoading || !drag || drag.pointer !== event.pointerId) return;
                            const dx = (event.clientX - drag.origin[0]) / drag.display[0];
                            const dy = (event.clientY - drag.origin[1]) / drag.display[1];
                            setSelection(drag.grip ? resizeSelection(drag.selection, drag.grip, dx, dy, aspectLocked) : translateSelection(drag.selection, dx, dy));
                        }}
                        onPointerUp={finish}
                        onPointerCancel={finish}
                        onLostPointerCapture={finish}
                    >
                        <img src={dataUrl} alt="待裁剪图片" draggable={false} className="block max-h-[60vh] max-w-full" />
                        {size ? (
                            <div
                                role="group"
                                aria-label="裁剪区域"
                                tabIndex={0}
                                className="absolute cursor-move border border-white outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                style={{ left: `${selection.x * 100}%`, top: `${selection.y * 100}%`, width: `${selection.width * 100}%`, height: `${selection.height * 100}%`, boxShadow: "0 0 0 100vmax rgb(0 0 0 / 55%)" }}
                                onPointerDown={(event) => begin(event, null)}
                                onKeyDown={(event) => {
                                    const vectors: Record<string, readonly [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
                                    const direction = vectors[event.key];
                                    if (!direction || confirmLoading) return;
                                    event.preventDefault();
                                    event.stopPropagation();
                                    const step = event.shiftKey ? 10 : 1;
                                    setSelection((box) => translateSelection(box ?? selection, (direction[0] * step) / size.width, (direction[1] * step) / size.height));
                                }}
                            >
                                <svg viewBox="0 0 3 3" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
                                    <path d="M1 0V3M2 0V3M0 1H3M0 2H3" stroke="white" strokeOpacity={0.5} strokeWidth={1} vectorEffect="non-scaling-stroke" />
                                </svg>
                                {grips.map(({ name, vector }) => (
                                    <button
                                        type="button"
                                        key={name}
                                        aria-label={`调整裁剪框 ${name}`}
                                        className="absolute size-3 rounded-full border border-black bg-white"
                                        style={{ left: `${(vector[0] + 1) * 50}%`, top: `${(vector[1] + 1) * 50}%`, transform: "translate(-50%, -50%)", cursor: `${name}-resize` }}
                                        onPointerDown={(event) => begin(event, vector)}
                                        onKeyDown={(event) => {
                                            if (confirmLoading || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
                                            event.preventDefault();
                                            event.stopPropagation();
                                            const step = event.shiftKey ? 10 : 1;
                                            const dx = (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0) / size.width;
                                            const dy = (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0) / size.height;
                                            setSelection((box) => resizeSelection(box ?? selection, vector, dx, dy, aspectLocked));
                                        }}
                                    />
                                ))}
                            </div>
                        ) : null}
                    </div>
                </div>
                {fixedAspect === undefined ? (
                    <div className="flex flex-wrap gap-2" role="group" aria-label="常用裁剪比例">
                        {["原图", "1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"].map((value) => (
                            <Button key={value} size="small" disabled={!size || confirmLoading} aria-pressed={preset === value} onClick={() => choose(value)}>
                                {value}
                            </Button>
                        ))}
                    </div>
                ) : null}
                <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                    <output>{outputLabel}</output>
                    <div className="flex gap-2">
                        {fixedAspect === undefined ? (
                            <Button
                                disabled={!size || confirmLoading}
                                aria-pressed={locked}
                                onClick={() => {
                                    setLocked(!locked);
                                    setPreset("");
                                }}
                            >
                                {locked ? "解除比例锁定" : "锁定当前比例"}
                            </Button>
                        ) : null}
                        <Button
                            disabled={!size || confirmLoading}
                            onClick={() => {
                                setSelection(null);
                                setLocked(false);
                                setPreset("");
                            }}
                        >
                            重置
                        </Button>
                    </div>
                </div>
                {error ? (
                    <p role="alert" className="text-sm text-destructive">
                        {error}
                    </p>
                ) : null}
            </div>
        </AppModal>
    );
}
