import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Button, Modal, Slider, Tooltip } from "antd";
import { Brush, Eraser, Redo2, RotateCcw, Save, Undo2 } from "lucide-react";

import { imageToDataUrl } from "@/services/image-storage";

type Point = { x: number; y: number };
type Stroke = { color: string; size: number; erase: boolean; points: Point[] };

const colors = ["#ef4444", "#f59e0b", "#22c55e", "#14b8a6", "#3b82f6", "#a855f7", "#ffffff", "#111827"];

export function CanvasNodeAnnotationDialog({ image, open, onClose, onConfirm }: {
    image: { url: string; storageKey?: string };
    open: boolean;
    onClose: () => void;
    onConfirm: (dataUrl: string) => void;
}) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const sourceImageRef = useRef<HTMLImageElement | null>(null);
    const drawingRef = useRef<Stroke | null>(null);
    const [source, setSource] = useState("");
    const [size, setSize] = useState({ width: 0, height: 0 });
    const [mode, setMode] = useState<"brush" | "erase">("brush");
    const [color, setColor] = useState(colors[0]);
    const [brushSize, setBrushSize] = useState(18);
    const [strokes, setStrokes] = useState<Stroke[]>([]);
    const [redoStrokes, setRedoStrokes] = useState<Stroke[]>([]);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        void imageToDataUrl({ url: image.url, storageKey: image.storageKey }).then((dataUrl) => {
            if (cancelled || !dataUrl) return;
            const element = new Image();
            element.onload = () => {
                if (cancelled) return;
                sourceImageRef.current = element;
                setSource(dataUrl);
                setSize({ width: element.naturalWidth, height: element.naturalHeight });
                setStrokes([]);
                setRedoStrokes([]);
            };
            element.src = dataUrl;
        });
        return () => { cancelled = true; };
    }, [image.storageKey, image.url, open]);

    useEffect(() => redraw(canvasRef.current, strokes), [size, strokes]);

    const startDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        const stroke: Stroke = { color, size: brushSize, erase: mode === "erase", points: [canvasPoint(event.currentTarget, event.clientX, event.clientY)] };
        drawingRef.current = stroke;
        drawStroke(canvasRef.current, stroke);
    };

    const moveDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        const stroke = drawingRef.current;
        if (!stroke) return;
        event.preventDefault();
        stroke.points.push(canvasPoint(event.currentTarget, event.clientX, event.clientY));
        redraw(canvasRef.current, [...strokes, stroke]);
    };

    const stopDraw = () => {
        const stroke = drawingRef.current;
        if (!stroke) return;
        drawingRef.current = null;
        setStrokes((current) => [...current, stroke]);
        setRedoStrokes([]);
    };

    const undo = () => setStrokes((current) => {
        const last = current.at(-1);
        if (!last) return current;
        setRedoStrokes((redo) => [...redo, last]);
        return current.slice(0, -1);
    });

    const redo = () => setRedoStrokes((current) => {
        const last = current.at(-1);
        if (!last) return current;
        setStrokes((items) => [...items, last]);
        return current.slice(0, -1);
    });

    const save = () => {
        const sourceImage = sourceImageRef.current;
        const annotation = canvasRef.current;
        if (!sourceImage || !annotation || !strokes.length) return;
        const output = document.createElement("canvas");
        output.width = size.width;
        output.height = size.height;
        const context = output.getContext("2d");
        if (!context) return;
        context.drawImage(sourceImage, 0, 0, output.width, output.height);
        context.drawImage(annotation, 0, 0);
        onConfirm(output.toDataURL("image/png"));
    };

    return (
        <Modal title={null} open={open} onCancel={onClose} footer={null} width="min(1120px, calc(100vw - 32px))" centered destroyOnHidden>
            <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2 rounded-lg border p-2" style={{ borderColor: "rgba(127,127,127,.22)" }}>
                    <span className="px-1 text-sm font-semibold">标注</span>
                    <span className="mx-1 h-6 w-px bg-current opacity-15" />
                    <ToolButton title="画笔" active={mode === "brush"} onClick={() => setMode("brush")}><Brush className="size-4" /></ToolButton>
                    <ToolButton title="橡皮" active={mode === "erase"} onClick={() => setMode("erase")}><Eraser className="size-4" /></ToolButton>
                    <div className="flex items-center gap-1 px-1">
                        {colors.map((item) => <button key={item} type="button" aria-label={`颜色 ${item}`} className="size-5 rounded-full border-2 transition" style={{ background: item, borderColor: color === item ? "currentColor" : "transparent", boxShadow: item === "#ffffff" ? "inset 0 0 0 1px rgba(0,0,0,.18)" : undefined }} onClick={() => { setColor(item); setMode("brush"); }} />)}
                    </div>
                    <div className="flex w-40 items-center gap-2 px-2"><Brush className="size-3.5 opacity-55" /><Slider className="m-0 flex-1" min={3} max={80} value={brushSize} onChange={setBrushSize} /></div>
                    <span className="mx-1 h-6 w-px bg-current opacity-15" />
                    <ToolButton title="撤销" disabled={!strokes.length} onClick={undo}><Undo2 className="size-4" /></ToolButton>
                    <ToolButton title="重做" disabled={!redoStrokes.length} onClick={redo}><Redo2 className="size-4" /></ToolButton>
                    <ToolButton title="清空" disabled={!strokes.length} onClick={() => { setStrokes([]); setRedoStrokes([]); }}><RotateCcw className="size-4" /></ToolButton>
                    <span className="min-w-0 flex-1" />
                    <Button type="primary" icon={<Save className="size-4" />} disabled={!strokes.length} onClick={save}>保存为新节点</Button>
                </div>
                <div className="flex min-h-[360px] items-center justify-center overflow-hidden rounded-lg bg-black/5 dark:bg-white/[0.03]">
                    {source && size.width ? (
                        <div className="relative inline-block max-h-[72vh] max-w-full overflow-hidden">
                            <img src={source} alt="待标注图片" className="block max-h-[72vh] max-w-full select-none object-contain" draggable={false} />
                            <canvas ref={canvasRef} width={size.width} height={size.height} className="absolute inset-0 h-full w-full cursor-crosshair touch-none" onPointerDown={startDraw} onPointerMove={moveDraw} onPointerUp={stopDraw} onPointerCancel={stopDraw} />
                        </div>
                    ) : <span className="text-sm opacity-50">正在读取图片...</span>}
                </div>
            </div>
        </Modal>
    );
}

function ToolButton({ title, active, disabled, children, onClick }: { title: string; active?: boolean; disabled?: boolean; children: ReactNode; onClick: () => void }) {
    return <Tooltip title={title}><button type="button" disabled={disabled} className={`grid size-9 place-items-center rounded-md transition disabled:cursor-not-allowed disabled:opacity-25 ${active ? "bg-black/10 dark:bg-white/15" : "hover:bg-black/5 dark:hover:bg-white/10"}`} onClick={onClick}>{children}</button></Tooltip>;
}

function canvasPoint(canvas: HTMLCanvasElement, clientX: number, clientY: number): Point {
    const rect = canvas.getBoundingClientRect();
    return { x: ((clientX - rect.left) / Math.max(1, rect.width)) * canvas.width, y: ((clientY - rect.top) / Math.max(1, rect.height)) * canvas.height };
}

function redraw(canvas: HTMLCanvasElement | null, strokes: Stroke[]) {
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    strokes.forEach((stroke) => drawStroke(canvas, stroke));
}

function drawStroke(canvas: HTMLCanvasElement | null, stroke: Stroke) {
    const context = canvas?.getContext("2d");
    if (!context || !stroke.points.length) return;
    context.save();
    context.globalCompositeOperation = stroke.erase ? "destination-out" : "source-over";
    context.strokeStyle = stroke.color;
    context.fillStyle = stroke.color;
    context.lineWidth = stroke.size;
    context.lineCap = "round";
    context.lineJoin = "round";
    const first = stroke.points[0];
    if (stroke.points.length === 1) {
        context.beginPath();
        context.arc(first.x, first.y, stroke.size / 2, 0, Math.PI * 2);
        context.fill();
    } else {
        context.beginPath();
        context.moveTo(first.x, first.y);
        stroke.points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
        context.stroke();
    }
    context.restore();
}
