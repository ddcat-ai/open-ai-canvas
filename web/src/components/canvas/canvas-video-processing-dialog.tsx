import { useEffect, useMemo, useState } from "react";
import { InputNumber } from "antd";

import { AppModal } from "@/components/ui/product/app-modal";
import { Select } from "@/components/ui/base/select";
import { listVideoProcessingModels, videoProcessingFields, videoProcessingQuoteRequest, videoProcessingSourceError, type VideoProcessingOperation, type VideoProcessingParams } from "@/lib/canvas/canvas-video-processing";
import { mediaToolForOperation, type MediaToolParameter } from "@/lib/canvas/media-tool-contract";
import { DEFAULT_VIDEO_PROCESSING_MAX_SOURCE_SECONDS, VOLCENGINE_MEDIAKIT_VIDEO_DEPTH_PROTOCOL, modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { modelQuoteDescription } from "@/lib/model-pricing";
import { quoteModel, type LogicalModelQuote } from "@/services/api/logical-models";
import { modelDisplayName, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import type { CanvasNodeData } from "@/types/canvas";
import { videoEnhanceSourceError } from "@/lib/canvas/canvas-video-enhance";

type Props = { node: CanvasNodeData; open: boolean; config: AiConfig; operation: VideoProcessingOperation; onClose: () => void; onConfirm: (params: VideoProcessingParams) => void };

export function CanvasVideoProcessingDialog(props: Props) {
    return props.open ? <ProcessingEditor key={`${props.node.id}:${props.operation}`} {...props} /> : null;
}

export function MediaToolParameterFields({
    fields,
    values,
    disabled,
    onChange,
}: {
    fields: Record<string, MediaToolParameter>;
    values: Record<string, string | number | undefined>;
    disabled?: boolean;
    onChange: (key: string, value: string | number | undefined) => void;
}) {
    return (
        <div className="space-y-4">
            {Object.entries(fields).map(([key, field]) => {
                const label = field.title || field.label || key;
                return (
                    <label key={key} className="flex flex-col gap-2 text-sm">
                        <span>{label}</span>
                        {field.enum ? (
                            <Select
                                ariaLabel={label}
                                disabled={disabled}
                                value={values[key] === undefined ? undefined : String(values[key])}
                                allowClear
                                options={field.enum.map((value) => ({ value: String(value), label: String(value) }))}
                                onChange={(value) => onChange(key, value === undefined ? undefined : field.type !== "string" ? Number(value) : value)}
                            />
                        ) : field.type !== "string" ? (
                            <InputNumber
                                aria-label={label}
                                disabled={disabled}
                                className="w-full"
                                min={field.minimum}
                                max={field.maximum}
                                precision={0}
                                value={typeof values[key] === "number" ? values[key] : undefined}
                                onChange={(value) => onChange(key, value ?? undefined)}
                            />
                        ) : null}
                    </label>
                );
            })}
        </div>
    );
}

function ProcessingEditor({ node, config, operation, onClose, onConfirm }: Props) {
    const tool = mediaToolForOperation(operation);
    const label = tool?.label || "视频处理";
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const models = useMemo(() => listVideoProcessingModels(config, operation), [config, operation]);
    const [model, setModel] = useState(models[0] || "");
    const fields = useMemo(() => videoProcessingFields(config, model, operation), [config, model, operation]);
    const defaults = useMemo(
        () =>
            Object.fromEntries(
                Object.entries(fields)
                    .filter(([, field]) => field.default !== undefined)
                    .map(([key, field]) => [key, field.default]),
            ),
        [fields],
    );
    const [selection, setSelection] = useState<{ model: string; values: Record<string, string | number | undefined> }>({ model, values: defaults });
    const values = selection.model === model ? selection.values : defaults;
    const [quote, setQuote] = useState<LogicalModelQuote | null>(null);
    const [quoteError, setQuoteError] = useState("");
    const profile = modelCapabilityConfigFor(config, model).video;
    const maxSeconds = profile?.processing?.maxSourceSeconds || DEFAULT_VIDEO_PROCESSING_MAX_SOURCE_SECONDS;
    const sourceError = videoProcessingSourceError(node, maxSeconds, operation, profile?.references.maxVideoBytes) || (fields.resolution ? videoEnhanceSourceError(node, maxSeconds) : "");
    const missingParameter = Object.entries(fields).some(([key, field]) => (field.enum && field.enum.length === 0) || (field.capability && values[key] === undefined));
    const invalidParameter = Object.entries(values).some(([key, value]) => {
        if (value === undefined) return false;
        const field = fields[key];
        if (!field || (field.enum && !field.enum.includes(value))) return true;
        return typeof value === "number" && (!Number.isSafeInteger(value) || (field.minimum !== undefined && value < field.minimum) || (field.maximum !== undefined && value > field.maximum));
    });
    const params = { model, ...Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) } as VideoProcessingParams;
    // 明确码率优先于档位，报价和提交不同时携带冲突选项。
    if (params.bitrate !== undefined) delete params.bitrateLevel;
    const ready = Boolean(tool && models.includes(model) && !sourceError && !missingParameter && !invalidParameter);
    const quoteRequest = ready ? videoProcessingQuoteRequest(config, params, operation, node.metadata?.durationMs) : undefined;
    const quoteKey = JSON.stringify(quoteRequest);
    const [quotedKey, setQuotedKey] = useState<string | undefined>();
    const canConfirm = ready && (!creditsEnabled || Boolean(quote && !quoteError && quotedKey === quoteKey));

    useEffect(() => {
        setQuote(null);
        setQuoteError("");
        setQuotedKey(undefined);
        if (!creditsEnabled || !quoteRequest) return;
        const controller = new AbortController();
        quoteModel(quoteRequest, controller.signal)
            .then(({ quote: next }) => {
                if (!controller.signal.aborted) {
                    setQuote(next);
                    setQuotedKey(quoteKey);
                }
            })
            .catch((error: unknown) => {
                if (!controller.signal.aborted) setQuoteError(error instanceof Error ? error.message : "无法获取积分报价");
            });
        return () => controller.abort();
        // 序列化键覆盖完整报价意图，避免每次渲染重复报价。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [creditsEnabled, quoteKey]);

    return (
        <AppModal
            open
            centered
            title={label}
            width={520}
            onCancel={onClose}
            okText="开始处理"
            okButtonProps={{ disabled: !canConfirm }}
            onOk={() => canConfirm && onConfirm(params)}
            footer={(_, { OkBtn, CancelBtn }) => (
                <div className="flex items-center justify-between gap-3">
                    <span className="text-left text-xs text-muted-foreground">{creditsEnabled ? (quote && quotedKey === quoteKey ? modelQuoteDescription(quote) : quoteError || (quoteRequest ? "正在计算积分…" : "源视频时长未知，无法报价")) : ""}</span>
                    <div className="flex shrink-0 gap-2">
                        <CancelBtn />
                        <OkBtn />
                    </div>
                </div>
            )}
        >
            <p className="mb-4 text-sm text-muted-foreground">{tool?.description}确认后创建连接原视频的结果节点，原视频保留。</p>
            <p className="mb-4 text-sm text-muted-foreground">源视频最长 {maxSeconds} 秒。具体输入限制与输出规格由所选模型决定。</p>
            {resolveModelRequestConfig(config, model).interfaceType === VOLCENGINE_MEDIAKIT_VIDEO_DEPTH_PROTOCOL ? <p className="mb-4 text-sm text-muted-foreground">分辨率不超过 2K。输出为 HEVC 视频，部分浏览器可能无法直接播放，可下载使用。</p> : null}
            {node.metadata?.durationMs ? <p className="mb-4 text-sm">源视频：{(node.metadata.durationMs / 1000).toFixed(1)} 秒</p> : null}
            {models.length ? (
                <Select ariaLabel={`${label}模型`} className="mb-4 w-full" value={model} onChange={setModel} options={models.map((value) => ({ value, label: modelDisplayName(config, value) }))} />
            ) : (
                <p role="alert" className="text-sm text-destructive">
                    管理员尚未配置可用的{label}模型。
                </p>
            )}
            <MediaToolParameterFields fields={fields} values={values} onChange={(key, value) => setSelection({ model, values: { ...values, [key]: value } })} />
            {sourceError ? (
                <p role="alert" className="mt-3 text-sm text-destructive">
                    {sourceError}
                </p>
            ) : null}
            {invalidParameter ? (
                <p role="alert" className="mt-3 text-sm text-destructive">
                    处理参数超出当前模型允许的范围，请重新选择。
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
