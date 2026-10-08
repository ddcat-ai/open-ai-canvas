import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Button, Collapse, Input, Segmented, Slider } from "antd";
import { AppModal } from "@/components/ui/product/app-modal";
import { ImageSettingsPanel } from "@/components/image-settings-panel";
import { ModelPicker } from "@/components/model-picker";
import { canvasThemes } from "@/lib/canvas-theme";
import { defaultImageParamsForModel } from "@/lib/model-selection";
import { exportEditMask, paintMaskStrokes, type MaskPoint, type MaskStroke } from "@/lib/canvas/image-mask-document";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import type { AiConfig } from "@/stores/use-config-store";
import { useImageToolSource } from "./use-image-tool-source";

export type CanvasImageMaskEditPayload = {
    maskDataUrl: string;
    prompt: string;
    generationConfig?: Partial<Pick<AiConfig, "model" | "imageModel" | "size" | "quality" | "count" | "transparentBackground">>;
};
type MaskEditorProps = { dataUrl: string; open: boolean; config: AiConfig; onClose: () => void; onConfirm: (payload: CanvasImageMaskEditPayload) => void };

export function CanvasNodeMaskEditDialog(props: MaskEditorProps) {
    return props.open && props.dataUrl ? <MaskEditor key={props.dataUrl} {...props} /> : null;
}

function MaskEditor({ dataUrl, config, onClose, onConfirm }: MaskEditorProps) {
    const { size, error: loadError } = useImageToolSource(dataUrl);
    const surface = useRef<HTMLCanvasElement>(null);
    const strokes = useRef<MaskStroke[]>([]);
    const activePointer = useRef<number | null>(null);
    const frame = useRef<number | null>(null);
    const [diameter, setDiameter] = useState(100);
    const [mode, setMode] = useState("paint");
    const [prompt, setPrompt] = useState("");
    const [settings, setSettings] = useState(config);
    const [error, setError] = useState("");
    const [strokeCount, setStrokeCount] = useState(0);
    const theme = canvasThemes[useActiveTheme()];

    useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
    const repaint = () => {
        if (frame.current !== null) return;
        frame.current = requestAnimationFrame(() => {
            frame.current = null;
            if (!surface.current) return;
            try { paintMaskStrokes(surface.current, strokes.current, "#2563eb"); }
            catch (failure) { setError(failure instanceof Error ? failure.message : "遮罩预览失败"); }
        });
    };
    const pointAt = (event: PointerEvent<HTMLCanvasElement>): MaskPoint => {
        const rect = event.currentTarget.getBoundingClientRect();
        return [((event.clientX - rect.left) * event.currentTarget.width) / Math.max(1, rect.width), ((event.clientY - rect.top) * event.currentTarget.height) / Math.max(1, rect.height)];
    };
    const finishStroke = (event: PointerEvent<HTMLCanvasElement>) => {
        if (activePointer.current !== event.pointerId) return;
        activePointer.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        setStrokeCount(strokes.current.length);
    };
    const submit = () => {
        if (!prompt.trim()) return setError("请填写修改要求");
        if (!size) return;
        let maskDataUrl: string;
        try { maskDataUrl = exportEditMask(size.width, size.height, strokes.current); }
        catch (failure) { setError(failure instanceof Error ? failure.message : "遮罩生成失败"); return; }
        const { model, imageModel, quality, count, transparentBackground } = settings;
        onConfirm({ prompt: prompt.trim(), maskDataUrl, generationConfig: { model, imageModel, size: settings.size, quality, count, transparentBackground } });
    };
    return (
        <AppModal open centered title="局部重绘" className="workspace-modal workspace-modal-wide" onCancel={onClose} onOk={submit} okText="AI 修改" okButtonProps={{ disabled: !size }}>
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
                <section className="flex min-w-0 flex-col items-center justify-center gap-3 rounded-lg bg-surface-active p-3">
                    <div className="relative max-w-full select-none overflow-hidden rounded-lg">
                        <img src={dataUrl} alt="局部重绘原图" draggable={false} className="block max-h-[62vh] max-w-full" />
                        {size ? <canvas ref={surface} width={size.width} height={size.height} aria-label="涂抹需要修改的图片区域" className="absolute inset-0 h-full w-full touch-none cursor-crosshair opacity-40"
                            onPointerDown={(event) => {
                                if (event.button !== 0 || activePointer.current !== null) return;
                                event.preventDefault(); event.stopPropagation();
                                event.currentTarget.setPointerCapture(event.pointerId);
                                activePointer.current = event.pointerId;
                                strokes.current.push({ diameter, erase: mode === "erase", points: [pointAt(event)] });
                                setError(""); repaint();
                            }}
                            onPointerMove={(event) => {
                                if (activePointer.current !== event.pointerId) return;
                                event.preventDefault();
                                strokes.current.at(-1)?.points.push(pointAt(event)); repaint();
                            }} onPointerUp={finishStroke} onPointerCancel={finishStroke} onLostPointerCapture={finishStroke} /> : null}
                    </div>
                    <p className="text-sm text-muted-foreground">{size ? `${size.width} × ${size.height} px · 蓝色区域将被重新生成` : loadError || "正在读取图片…"}</p>
                </section>
                <section className="flex max-h-[68vh] flex-col gap-4 overflow-y-auto pr-1">
                    <Segmented block value={mode} onChange={setMode} options={[{ label: "画笔", value: "paint" }, { label: "擦除", value: "erase" }]} />
                    <label className="text-sm">笔刷直径 · {diameter} px<Slider min={8} max={160} step={2} value={diameter} onChange={setDiameter} /></label>
                    <div className="flex gap-2">
                        <Button disabled={!strokeCount} onClick={() => { strokes.current.pop(); setStrokeCount(strokes.current.length); repaint(); }}>撤销笔画</Button>
                        <Button onClick={() => { strokes.current = []; activePointer.current = null; setStrokeCount(0); setError(""); repaint(); }}>清空遮罩</Button>
                    </div>
                    <label className="flex flex-col gap-2 text-sm">修改要求<Input.TextArea rows={4} value={prompt} placeholder="描述选中区域需要发生的变化" onChange={(event) => { setPrompt(event.target.value); setError(""); }} /></label>
                    <Collapse defaultActiveKey={["settings"]} items={[{ key: "settings", label: "生成设置", children: <div className="space-y-4">
                        <ModelPicker config={settings} value={settings.imageModel || settings.model} capability="image" fullWidth showSelectedPrice={false} onChange={(model) => setSettings((previous) => ({ ...previous, ...defaultImageParamsForModel(previous, model), imageModel: model, model }))} />
                        <ImageSettingsPanel config={settings} theme={theme} showTitle={false} showCount={false} bypassPriceGuard onConfigChange={(key, value) => setSettings((previous) => ({ ...previous, [key]: value }))} />
                    </div> }]} />
                    {error || loadError ? <p role="alert" className="text-sm text-destructive">{error || loadError}</p> : null}
                </section>
            </div>
        </AppModal>
    );
}
