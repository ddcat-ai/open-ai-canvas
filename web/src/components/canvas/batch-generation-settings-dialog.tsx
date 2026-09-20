import { useEffect, useState } from "react";
import { Button } from "antd";
import { AppModal } from "@/components/ui/product/app-modal";
import { WandSparkles, X } from "lucide-react";

import { ImageSettingsPanel } from "@/components/image-settings-panel";
import { ModelPicker } from "@/components/model-picker";
import { canvasThemes } from "@/lib/canvas-theme";
import { defaultImageParamsForModel } from "@/lib/model-selection";
import { CanvasCameraControlPopover } from "./canvas-camera-control-popover";
import type { CameraControlOptions } from "@/lib/canvas/camera-prompt-library";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import type { AiConfig } from "@/stores/use-config-store";

export type BatchGenerationSettings = Pick<AiConfig, "model" | "imageModel" | "quality" | "size" | "transparentBackground" | "count"> & { cameraControl?: CameraControlOptions };

type BatchGenerationSettingsDialogProps = {
    open: boolean;
    config: AiConfig;
    rowCount: number;
    concurrency: number;
    onClose: () => void;
    onConfirm: (settings: BatchGenerationSettings) => void;
};

export function BatchGenerationSettingsDialog({ open, config, rowCount, concurrency, onClose, onConfirm }: BatchGenerationSettingsDialogProps) {
    const theme = canvasThemes[useActiveTheme()];
    const [generationConfig, setGenerationConfig] = useState<AiConfig>(config);
    const [cameraControl, setCameraControl] = useState<CameraControlOptions | undefined>(undefined);

    useEffect(() => {
        if (open) {
            setGenerationConfig(config);
            setCameraControl(undefined);
        }
    }, [config, open]);

    const handleConfigChange = (key: "quality" | "size" | "transparentBackground" | "count", value: string) => {
        setGenerationConfig((current) => ({ ...current, [key]: value }));
    };

    const handleModelChange = (model: string) => {
        setGenerationConfig((current) => ({ ...current, model, imageModel: model, ...defaultImageParamsForModel(current, model) }));
    };

    const imageModel = generationConfig.imageModel || generationConfig.model;

    return (
        <AppModal
            open={open}
            onCancel={onClose}
            footer={null}
            centered
            destroyOnHidden
            width={480}
            title="批量生成设置"
        >
            <div className="flex flex-col gap-4 py-2">
                <div className="rounded-lg bg-black/5 px-3 py-2 text-sm dark:bg-white/[0.04]">
                    共 <span className="font-semibold">{rowCount}</span> 个任务（每行 1 张） · 并发上限 <span className="font-semibold">{concurrency}</span>
                    <div className="mt-1 text-xs opacity-75">确认后将提交生成任务，可能消耗积分或产生外部模型费用。</div>
                </div>

                <div className="space-y-2">
                    <div className="text-sm font-medium opacity-75">生成模型</div>
                    <ModelPicker
                        config={generationConfig}
                        value={imageModel}
                        capability="image"
                        fullWidth
                        showSelectedPrice={false}
                        onChange={handleModelChange}
                    />
                </div>

                <div className="border-t pt-3" style={{ borderColor: theme.node.stroke }}>
                    <ImageSettingsPanel
                        config={generationConfig}
                        onConfigChange={handleConfigChange}
                        theme={theme}
                        showTitle={false}
                        showCount={false}
                        quickCount={4}
                        maxCount={10}
                        className="w-full space-y-3"
                    />
                </div>

                <div className="flex items-center justify-between border-t pt-3" style={{ borderColor: theme.node.stroke }}>
                    <div>
                        <div className="text-sm font-medium">摄像机控制</div>
                        <div className="mt-1 text-xs opacity-60">为本批次统一应用镜头、焦段和光圈设置</div>
                    </div>
                    <CanvasCameraControlPopover cameraControl={cameraControl} onCameraControlChange={setCameraControl} theme={theme} compact />
                </div>

                <div className="mt-2 flex justify-end gap-2">
                    <Button icon={<X className="size-4" />} onClick={onClose}>取消</Button>
                    <Button
                        type="primary"
                        icon={<WandSparkles className="size-4" />}
                        onClick={() => onConfirm({
                            model: generationConfig.model,
                            imageModel: generationConfig.imageModel,
                            quality: generationConfig.quality,
                            size: generationConfig.size,
                            transparentBackground: generationConfig.transparentBackground,
                            count: "1",
                            cameraControl,
                        })}
                    >
                        开始生成 {rowCount} 个任务
                    </Button>
                </div>
            </div>
        </AppModal>
    );
}
