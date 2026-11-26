import { useEffect, useMemo, useState } from "react";

import { AppModal } from "@/components/ui/product/app-modal";
import { Select } from "@/components/ui/base/select";
import { listVideoProcessingModels, videoProcessingQuoteRequest, videoProcessingSourceError, VIDEO_PROCESSING_LABELS, type InputOnlyVideoProcessingOperation, type VideoProcessingParams } from "@/lib/canvas/canvas-video-processing";
import { DEFAULT_VIDEO_PROCESSING_MAX_SOURCE_SECONDS, VOLCENGINE_MEDIAKIT_VIDEO_DEPTH_PROTOCOL, modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { modelQuoteDescription } from "@/lib/model-pricing";
import { quoteModel, type LogicalModelQuote } from "@/services/api/logical-models";
import { modelDisplayName, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import type { CanvasNodeData } from "@/types/canvas";

type Props = { node: CanvasNodeData; open: boolean; config: AiConfig; operation: InputOnlyVideoProcessingOperation; onClose: () => void; onConfirm: (params: VideoProcessingParams) => void };

export function CanvasVideoProcessingDialog(props: Props) {
    return props.open ? <ProcessingEditor key={`${props.node.id}:${props.operation}`} {...props} /> : null;
}

function ProcessingEditor({ node, config, operation, onClose, onConfirm }: Props) {
    const label = VIDEO_PROCESSING_LABELS[operation];
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const models = useMemo(() => listVideoProcessingModels(config, operation), [config, operation]);
    const [model, setModel] = useState(models[0] || "");
    const [quote, setQuote] = useState<LogicalModelQuote | null>(null);
    const [quoteError, setQuoteError] = useState("");
    const profile = modelCapabilityConfigFor(config, model).video;
    const maxSeconds = profile?.processing?.maxSourceSeconds || DEFAULT_VIDEO_PROCESSING_MAX_SOURCE_SECONDS;
    const isMediaKit = resolveModelRequestConfig(config, model).interfaceType === VOLCENGINE_MEDIAKIT_VIDEO_DEPTH_PROTOCOL;
    const sourceError = videoProcessingSourceError(node, maxSeconds, operation, profile?.references.maxVideoBytes);
    const ready = Boolean(models.includes(model) && !sourceError);
    const canConfirm = ready && (!creditsEnabled || Boolean(quote && !quoteError));
    const quoteRequest = useMemo(() => (ready ? videoProcessingQuoteRequest(config, { model }, operation, node.metadata?.durationMs) : undefined), [ready, config, model, operation, node.metadata?.durationMs]);

    useEffect(() => {
        setQuote(null);
        setQuoteError("");
        if (!creditsEnabled || !quoteRequest) return;
        const controller = new AbortController();
        quoteModel(quoteRequest, controller.signal)
            .then(({ quote: next }) => {
                if (!controller.signal.aborted) setQuote(next);
            })
            .catch((error: unknown) => {
                if (!controller.signal.aborted) setQuoteError(error instanceof Error ? error.message : "无法获取积分报价");
            });
        return () => controller.abort();
    }, [creditsEnabled, quoteRequest]);

    return (
        <AppModal
            open
            centered
            title={operation === "depth" ? "相对深度视频" : label}
            width={520}
            onCancel={onClose}
            okText="开始处理"
            okButtonProps={{ disabled: !canConfirm }}
            onOk={() => canConfirm && onConfirm({ model })}
            footer={(_, { OkBtn, CancelBtn }) => (
                <div className="flex items-center justify-between gap-3">
                    <span className="text-left text-xs text-muted-foreground">{creditsEnabled ? (quote ? modelQuoteDescription(quote) : quoteError || (quoteRequest ? "正在计算积分…" : "源视频时长未知，无法报价")) : ""}</span>
                    <div className="flex shrink-0 gap-2">
                        <CancelBtn />
                        <OkBtn />
                    </div>
                </div>
            )}
        >
            <p className="mb-4 text-sm text-muted-foreground">
                {operation === "depth" ? "生成相对深度视频，用于动作与运镜参考。" : operation === "upscale" ? "提升视频清晰度，具体输出规格由所选模型决定。" : "处理视频画面中的字幕，效果由所选模型决定。"}确认后创建连接原视频的结果节点，原视频保留。
            </p>
            <p className="mb-4 text-sm text-muted-foreground">
                源视频最长 {maxSeconds} 秒。{isMediaKit ? "分辨率不超过 2K。输出为 HEVC 视频，部分浏览器可能无法直接播放，可下载使用。" : "处理规格由所选工作流决定，不支持指定输出分辨率或帧率。"}
            </p>
            {node.metadata?.durationMs ? <p className="mb-4 text-sm">源视频：{(node.metadata.durationMs / 1000).toFixed(1)} 秒</p> : null}
            {models.length ? <Select aria-label={`${label}模型`} className="mb-4 w-full" value={model} onChange={setModel} options={models.map((value) => ({ value, label: modelDisplayName(config, value) }))} /> : null}
            {!models.length ? (
                <p role="alert" className="text-sm text-destructive">
                    管理员尚未配置可用的{label}模型。
                </p>
            ) : null}
            {sourceError ? (
                <p role="alert" className="text-sm text-destructive">
                    {sourceError}
                </p>
            ) : null}
            {quoteError ? (
                <p role="alert" className="mt-3 text-sm text-destructive">
                    {quoteError}
                </p>
            ) : null}
            {creditsEnabled ? <p className="mt-4 text-xs text-muted-foreground">按秒计费时按源视频时长预扣，完成后按实际输出时长结算，多退少补。</p> : null}
        </AppModal>
    );
}
