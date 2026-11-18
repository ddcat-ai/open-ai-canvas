import { useEffect, useMemo, useState, type ReactNode } from "react";
import { InputNumber } from "antd";
import { ChevronDown } from "lucide-react";

import { AppModal } from "@/components/ui/product/app-modal";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { videoEnhanceProfile, videoEnhanceQuoteRequest, videoEnhanceResolutionShortEdge, videoEnhanceSourceError, type VideoEnhanceBitrateLevel, type VideoEnhanceParams } from "@/lib/canvas/canvas-video-enhance";
import { listVideoProcessingModels } from "@/lib/canvas/canvas-video-processing";
import { modelQuoteDescription } from "@/lib/model-pricing";
import { quoteModel, type LogicalModelQuote } from "@/services/api/logical-models";
import { modelDisplayName, type AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import type { CanvasNodeData } from "@/types/canvas";

type Props = {
    node: CanvasNodeData;
    open: boolean;
    config: AiConfig;
    onClose: () => void;
    onConfirm: (params: VideoEnhanceParams) => void;
};

const bitrateLevelOptions: Array<{ label: string; value: VideoEnhanceBitrateLevel }> = [
    { label: "低", value: "low" },
    { label: "中", value: "medium" },
    { label: "高", value: "high" },
];

export function CanvasVideoEnhanceDialog(props: Props) {
    // 以节点为 key 重新挂载，避免沿用上一个视频的选项。
    return props.open ? <EnhanceEditor key={props.node.id} {...props} /> : null;
}

function EnhanceEditor({ node, config, onClose, onConfirm }: Props) {
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const models = useMemo(() => listVideoProcessingModels(config, "enhance"), [config]);
    const [model, setModel] = useState(models[0] || "");
    const profile = useMemo(() => videoEnhanceProfile(config, model), [config, model]);
    const sourceShortEdge = Math.min(node.metadata?.naturalWidth || 0, node.metadata?.naturalHeight || 0);
    const resolutionOptions = profile.resolutions.map((value) => {
        const edge = videoEnhanceResolutionShortEdge(value);
        // 低于源视频短边的档位不会提升画质，直接禁用。
        const disabled = sourceShortEdge > 0 && edge > 0 && edge < sourceShortEdge;
        return { value, label: value.toUpperCase(), disabled, title: disabled ? "低于源视频分辨率" : undefined };
    });
    const defaultResolution = resolutionOptions.find((item) => item.value === profile.defaultResolution && !item.disabled)?.value || resolutionOptions.find((item) => !item.disabled)?.value || "";
    const [resolution, setResolution] = useState(defaultResolution);
    const userSelectFps = profile.processing.fpsPolicy === "user_select";
    const fpsOptions = profile.processing.fpsOptions || [];
    const [fps, setFps] = useState<number | undefined>(fpsOptions[0]);
    const [bitrateLevel, setBitrateLevel] = useState<VideoEnhanceBitrateLevel>("medium");
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [bitrate, setBitrate] = useState<number | null>(null);
    const [quote, setQuote] = useState<LogicalModelQuote | null>(null);

    useEffect(() => {
        setResolution(defaultResolution);
        setFps(fpsOptions[0]);
        // 切换模型时重置依赖模型配置的选项。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [model]);

    const sourceError = videoEnhanceSourceError(node, profile.maxSourceSeconds);
    const params: VideoEnhanceParams = {
        model,
        resolution,
        ...(userSelectFps && fps ? { fps } : {}),
        ...(bitrate ? { bitrate } : { bitrateLevel }),
    };
    const ready = Boolean(model && resolution && !sourceError && (!userSelectFps || fps));
    const quoteRequest = ready ? videoEnhanceQuoteRequest(config, params, node.metadata?.durationMs) : undefined;
    const quoteKey = JSON.stringify(quoteRequest || null);

    useEffect(() => {
        if (!creditsEnabled || !quoteRequest) {
            setQuote(null);
            return;
        }
        const controller = new AbortController();
        setQuote(null);
        quoteModel(quoteRequest, controller.signal)
            .then(({ quote: next }) => setQuote(next))
            .catch(() => {
                if (!controller.signal.aborted) setQuote(null);
            });
        return () => controller.abort();
        // quoteKey 是请求的完整序列化，避免对象引用变化重复报价。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [creditsEnabled, quoteKey]);

    const seconds = node.metadata?.durationMs ? Math.ceil(node.metadata.durationMs / 1000) : 0;
    const width = node.metadata?.naturalWidth;
    const height = node.metadata?.naturalHeight;
    const quoteText = creditsEnabled && quote ? modelQuoteDescription(quote) : "";

    return (
        <AppModal
            open
            centered
            title="视频画质增强"
            width={520}
            onCancel={onClose}
            okText="开始增强"
            okButtonProps={{ disabled: !ready }}
            onOk={() => ready && onConfirm(params)}
            footer={(_, { OkBtn, CancelBtn }) => (
                <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 text-left text-xs text-muted-foreground" title={quote?.billingMode === "per_second" ? "按源视频时长预扣，完成后按实际输出时长结算，多退少补" : undefined}>
                        {quoteText || (creditsEnabled && ready ? "正在计算积分…" : "")}
                    </span>
                    <div className="flex shrink-0 gap-2">
                        <CancelBtn />
                        <OkBtn />
                    </div>
                </div>
            )}
        >
            <p className="mb-4 text-sm text-muted-foreground">生成式画质增强，结果另存为新视频节点，原视频保留。处理耗时约为视频时长的 15–20 倍。</p>

            <div className="mb-5 flex flex-wrap gap-2 text-xs">
                <InfoChip>{width && height ? `${width} × ${height}` : "尺寸未知"}</InfoChip>
                {seconds ? <InfoChip>{seconds} 秒</InfoChip> : null}
                <InfoChip>上限 {profile.maxSourceSeconds} 秒</InfoChip>
            </div>

            {!models.length ? (
                <p role="alert" className="text-sm text-destructive">
                    管理员尚未配置可用的画质增强模型。
                </p>
            ) : (
                <div className="flex flex-col gap-4">
                    {models.length > 1 ? (
                        <OptionRow label="增强模型">
                            <SegmentedControl ariaLabel="增强模型" value={model} onChange={setModel} options={models.map((value) => ({ value, label: modelDisplayName(config, value) }))} />
                        </OptionRow>
                    ) : null}
                    <OptionRow label="目标分辨率">
                        <SegmentedControl ariaLabel="目标分辨率" block value={resolution} onChange={setResolution} options={resolutionOptions} />
                    </OptionRow>
                    <OptionRow label="输出帧率">
                        {userSelectFps ? (
                            <SegmentedControl ariaLabel="输出帧率" block value={fps ? String(fps) : undefined} onChange={(value) => setFps(Number(value))} options={fpsOptions.map((value) => ({ value: String(value), label: `${value} fps` }))} />
                        ) : (
                            <span className="text-sm text-muted-foreground">保持原视频帧率</span>
                        )}
                    </OptionRow>
                    <OptionRow label="码率">
                        <SegmentedControl ariaLabel="码率档位" block disabled={Boolean(bitrate)} value={bitrateLevel} onChange={setBitrateLevel} options={bitrateLevelOptions} />
                    </OptionRow>

                    <div>
                        <button type="button" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen((value) => !value)}>
                            <ChevronDown className={`size-3.5 transition-transform motion-reduce:transition-none ${advancedOpen ? "rotate-180" : ""}`} />
                            高级：精确码率
                        </button>
                        {advancedOpen ? (
                            <div className="mt-2 flex items-center gap-3">
                                <InputNumber
                                    aria-label="精确码率（kbps）"
                                    style={{ width: 200 }}
                                    min={10}
                                    max={150000}
                                    step={500}
                                    precision={0}
                                    value={bitrate}
                                    suffix="kbps"
                                    placeholder="留空使用码率档位"
                                    onChange={(value) => setBitrate(typeof value === "number" ? value : null)}
                                />
                                <span className="text-xs text-muted-foreground">填写后优先于码率档位</span>
                            </div>
                        ) : null}
                    </div>
                </div>
            )}

            {sourceError ? (
                <p role="alert" className="mt-4 text-sm text-destructive">
                    {sourceError}
                </p>
            ) : null}
        </AppModal>
    );
}

function OptionRow({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="grid grid-cols-[80px_minmax(0,1fr)] items-center gap-3">
            <span className="whitespace-nowrap text-sm text-foreground/70">{label}</span>
            <div className="min-w-0">{children}</div>
        </div>
    );
}

function InfoChip({ children }: { children: ReactNode }) {
    return <span className="rounded-full bg-surface-tertiary px-2 py-1 text-foreground/70">{children}</span>;
}
