import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button, Input, Modal, Tag } from "antd";
import { Layers3, Plus, RotateCcw, X } from "lucide-react";

import { ModelPicker } from "@/components/model-picker";
import type { AiConfig } from "@/stores/use-config-store";
import { defaultImageParamsForModel } from "@/lib/model-selection";

export type CanvasImageLayerDecompositionPayload = {
    prompt: string;
    regions?: Array<[number, number, number, number]>;
    generationConfig?: Partial<Pick<AiConfig, "model" | "imageModel" | "size" | "quality">>;
};

const DEFAULT_PROMPT = "将图片拆分为可独立编辑的图层：识别主要主体、前景、背景和重要物体，每个图层单独输出，保持原图外观和边缘细节，使用透明背景，不要合并不同图层。";

export function CanvasNodeLayerDecompositionDialog({
    dataUrl,
    open,
    config,
    onClose,
    onConfirm,
}: {
    dataUrl: string;
    open: boolean;
    config: AiConfig;
    onClose: () => void;
    onConfirm: (payload: CanvasImageLayerDecompositionPayload) => void;
}) {
    const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
    const [generationConfig, setGenerationConfig] = useState<AiConfig>(config);
    const [regions, setRegions] = useState<Array<[number, number, number, number]>>([]);
    const [drawing, setDrawing] = useState<{ x: number; y: number } | null>(null);
    const [draft, setDraft] = useState<[number, number, number, number] | null>(null);
    const imageFrameRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        setPrompt(DEFAULT_PROMPT);
        setGenerationConfig(config);
        setRegions([]);
        setDrawing(null);
        setDraft(null);
    }, [config, dataUrl, open]);

    const point = (event: ReactPointerEvent<HTMLDivElement>) => {
        const rect = imageFrameRef.current?.getBoundingClientRect();
        if (!rect) return null;
        return {
            x: Math.max(0, Math.min(1000, ((event.clientX - rect.left) / Math.max(1, rect.width)) * 1000)),
            y: Math.max(0, Math.min(1000, ((event.clientY - rect.top) / Math.max(1, rect.height)) * 1000)),
        };
    };

    const startBox = (event: ReactPointerEvent<HTMLDivElement>) => {
        const next = point(event);
        if (!next) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        setDrawing(next);
        setDraft([next.x, next.y, next.x, next.y]);
    };

    const moveBox = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (!drawing) return;
        const next = point(event);
        if (!next) return;
        setDraft([Math.min(drawing.x, next.x), Math.min(drawing.y, next.y), Math.max(drawing.x, next.x), Math.max(drawing.y, next.y)]);
    };

    const finishBox = () => {
        if (!draft) return;
        const [x1, y1, x2, y2] = draft;
        if (x2 - x1 >= 2 && y2 - y1 >= 2) setRegions((current) => [...current, [Math.round(x1), Math.round(y1), Math.round(x2), Math.round(y2)]]);
        setDrawing(null);
        setDraft(null);
    };

    const selectedPrompt = regions.length
        ? `${prompt.trim()}\n\n重点处理用户框选的区域，并分别输出这些区域中的主体为独立透明 PNG 图层。选区坐标（图像 0-1000 坐标系）：${regions.map((region, index) => `区域${index + 1} <bbox>${region.join(" ")}</bbox>`).join("；")}`
        : prompt.trim();

    return (
        <Modal open={open && Boolean(dataUrl)} onCancel={onClose} footer={null} centered destroyOnHidden width={900} title="AI 图层拆分">
            <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_320px]">
                <div className="grid min-h-[340px] place-items-center overflow-hidden rounded-xl bg-black/5 p-3 dark:bg-white/[0.04]">
                    <div ref={imageFrameRef} className="relative inline-block max-h-[60vh] max-w-full select-none" onPointerDown={startBox} onPointerMove={moveBox} onPointerUp={finishBox} onPointerCancel={finishBox}>
                        <img src={dataUrl} alt="待拆分图片" className="block max-h-[60vh] max-w-full object-contain" draggable={false} />
                        <div className="pointer-events-none absolute inset-0">
                            {regions.map((region, index) => <RegionBox key={`${region.join("-")}-${index}`} region={region} label={index + 1} />)}
                            {draft ? <RegionBox region={draft} label={regions.length + 1} draft /> : null}
                        </div>
                    </div>
                </div>
                <div className="flex flex-col gap-4">
                    <div>
                        <h3 className="text-lg font-semibold">拆分图片图层</h3>
                        <p className="mt-1 text-sm opacity-60">可在图片上拖拽框选对象，AI 会返回多个透明背景图层，并在画布中自动排列为独立节点。</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <Tag color={regions.length ? "blue" : "default"}>{regions.length ? `已框选 ${regions.length} 个区域` : "未框选，按描述拆分"}</Tag>
                        {regions.length ? <Button size="small" icon={<RotateCcw className="size-3.5" />} onClick={() => setRegions([])}>清除选区</Button> : <span className="text-xs opacity-55"><Plus className="mr-1 inline size-3" />在左侧图片上拖动添加选区</span>}
                    </div>
                    <Input.TextArea rows={7} value={prompt} placeholder="例如：分别提取人物、产品、前景装饰和背景" onChange={(event) => setPrompt(event.target.value)} />
                    <div className="space-y-2">
                        <div className="text-sm font-medium opacity-75">图层拆分模型</div>
                        <ModelPicker
                            config={generationConfig}
                            value={generationConfig.imageModel || generationConfig.model}
                            capability="image"
                            fullWidth
                            showSelectedPrice={false}
                            onChange={(model) => setGenerationConfig((current) => ({ ...current, model, imageModel: model, ...defaultImageParamsForModel(current, model) }))}
                        />
                    </div>
                    <div className="mt-auto flex justify-end gap-2">
                        <Button icon={<X className="size-4" />} onClick={onClose}>取消</Button>
                        <Button type="primary" icon={<Layers3 className="size-4" />} disabled={!selectedPrompt} onClick={() => onConfirm({ prompt: selectedPrompt, regions, generationConfig: { model: generationConfig.model, imageModel: generationConfig.imageModel, size: generationConfig.size, quality: generationConfig.quality } })}>
                            开始拆分
                        </Button>
                    </div>
                </div>
            </div>
        </Modal>
    );
}

function RegionBox({ region, label, draft = false }: { region: [number, number, number, number]; label: number; draft?: boolean }) {
    const [x1, y1, x2, y2] = region;
    return <div className={`absolute rounded-sm border-2 ${draft ? "border-dashed border-blue-500 bg-blue-500/10" : "border-solid border-amber-400 bg-amber-400/10"}`} style={{ left: `${x1 / 10}%`, top: `${y1 / 10}%`, width: `${(x2 - x1) / 10}%`, height: `${(y2 - y1) / 10}%` }}><span className="absolute -left-0.5 -top-0.5 grid size-5 -translate-y-1/2 -translate-x-1/2 place-items-center rounded-full bg-amber-400 text-[11px] font-semibold text-black shadow">{label}</span></div>;
}
