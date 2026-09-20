import { useEffect, useState } from "react";
import { Button, Input, Modal } from "antd";
import { WandSparkles, X } from "lucide-react";
import { ModelPicker } from "@/components/model-picker";
import type { AiConfig } from "@/stores/use-config-store";
import { defaultImageParamsForModel } from "@/lib/model-selection";

export type CanvasImageEditPayload = { prompt: string; generationConfig?: Partial<Pick<AiConfig, "model" | "imageModel" | "size" | "quality">> };

export function CanvasNodeImageEditDialog({
    dataUrl,
    open,
    config,
    preset,
    onClose,
    onConfirm,
}: {
    dataUrl: string;
    open: boolean;
    onClose: () => void;
    onConfirm: (payload: CanvasImageEditPayload) => void;
    config: AiConfig;
    preset?: "remove-background" | null;
}) {
    const [prompt, setPrompt] = useState(preset === "remove-background" ? "移除图片背景，保留主体完整轮廓、细节和边缘，输出透明背景。" : "");
    const [generationConfig, setGenerationConfig] = useState<AiConfig>(config);

    useEffect(() => {
        if (open) setPrompt(preset === "remove-background" ? "移除图片背景，保留主体完整轮廓、细节和边缘，输出透明背景。" : "");
        if (open) setGenerationConfig(config);
    }, [config, open, dataUrl]);

    return (
        <Modal open={open && Boolean(dataUrl)} onCancel={onClose} footer={null} centered destroyOnHidden width={860} title={preset === "remove-background" ? "去除背景" : "图片编辑"}>
            <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_300px]">
                <div className="grid min-h-[320px] place-items-center overflow-hidden rounded-xl bg-black/5 p-3 dark:bg-white/[0.04]">
                    <img src={dataUrl} alt="待编辑图片" className="max-h-[58vh] max-w-full object-contain" draggable={false} />
                </div>
                <div className="flex flex-col gap-4">
                    <div>
                        <h3 className="text-lg font-semibold">{preset === "remove-background" ? "去除背景" : "描述你要修改的内容"}</h3>
                        <p className="mt-1 text-sm opacity-60">保留主体和构图，只修改你描述的部分。</p>
                    </div>
                    <Input.TextArea
                        autoFocus
                        rows={7}
                        value={prompt}
                        placeholder="例如：把背景换成黄昏海边，保持人物姿势和服装不变"
                        onChange={(event) => setPrompt(event.target.value)}
                    />
                    <div className="space-y-2">
                        <div className="text-sm font-medium opacity-75">编辑模型</div>
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
                        <Button type="primary" icon={<WandSparkles className="size-4" />} disabled={!prompt.trim()} onClick={() => onConfirm({ prompt: prompt.trim(), generationConfig: { model: generationConfig.model, imageModel: generationConfig.imageModel, size: generationConfig.size, quality: generationConfig.quality } })}>
                            开始编辑
                        </Button>
                    </div>
                </div>
            </div>
        </Modal>
    );
}
