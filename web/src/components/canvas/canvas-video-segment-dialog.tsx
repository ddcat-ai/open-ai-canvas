import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Input, InputNumber } from "antd";
import { nanoid } from "nanoid";
import { AppModal } from "@/components/ui/product/app-modal";
import { Select } from "@/components/ui/base/select";
import { ModelPicker } from "@/components/model-picker";
import { listVideoReferenceModels } from "@/lib/canvas/canvas-video-regeneration";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { modelRequestOptions, resolveCompatibleModel, type ModelRequirements } from "@/lib/model-selection";
import { resolveVideoMediaUrl } from "@/services/file-storage";
import type { AiConfig } from "@/stores/use-config-store";
import type { CanvasNodeData, CanvasVideoEditOperation } from "@/types/canvas";

export type CanvasVideoSegmentItem = { id: string; startMs: number; endMs: number; sourceNodeId?: string; sourceStorageKey?: string; sourceUrl?: string };
export type CanvasVideoSegmentParams = {
    mode: "audio" | "video";
    startMs: number;
    endMs: number;
    prompt?: string;
    segments?: CanvasVideoSegmentItem[];
    model?: string;
    operation?: CanvasVideoEditOperation;
};

type Props = { node: CanvasNodeData; open: boolean; mode: "audio" | "video"; config: AiConfig; onClose: () => void; onConfirm: (params: CanvasVideoSegmentParams) => void };
const operationLabels: Partial<Record<CanvasVideoEditOperation, string>> = {
    extend: "视频续写",
    inpaint: "局部修改",
    replace_element: "元素替换",
    camera_motion: "运镜调整",
    style_transfer: "风格迁移",
    reference_to_video: "参考视频生成",
    enhance: "画质增强",
};

/** 只选择一个模型参考或声音样本范围，专业剪辑交给外部工具。 */
export function CanvasVideoSegmentDialog({ node, open, mode, config, onClose, onConfirm }: Props) {
    const { message } = App.useApp();
    const player = useRef<HTMLVideoElement>(null);
    const [url, setUrl] = useState("");
    const [error, setError] = useState("");
    const [duration, setDuration] = useState(0);
    const [start, setStart] = useState(0);
    const [end, setEnd] = useState(0);
    const [prompt, setPrompt] = useState("");
    const models = useMemo(() => listVideoReferenceModels(config), [config]);
    const [model, setModel] = useState("");
    const [operation, setOperation] = useState<CanvasVideoEditOperation>("reference_to_video");
    const submitted = useRef(false);
    useEffect(() => {
        if (!open) return;
        let active = true;
        submitted.current = false;
        setUrl("");
        setError("");
        setStart(0);
        setEnd(0);
        setDuration(0);
        setPrompt("");
        setModel(models.includes(config.videoModel || config.model) ? config.videoModel || config.model : models[0] || "");
        void resolveVideoMediaUrl(node.metadata?.storageKey, node.metadata?.content || "")
            .then((source) => {
                if (active) {
                    setUrl(source);
                    if (!source) setError("视频不可用，请重新选择素材");
                }
            })
            .catch((cause) => {
                if (active) setError(cause instanceof Error ? cause.message : "读取视频失败");
            });
        return () => {
            active = false;
        };
    }, [open, node.id, node.metadata?.storageKey, node.metadata?.content]);
    const requirements = useMemo<ModelRequirements>(
        () => ({
            capability: "video",
            input: { textCount: prompt.trim() ? 1 : 0, imageCount: 0, videoCount: 1, audioCount: 0, characterCount: 0 },
            videoOperation: operation,
            videoSeconds: config.videoSeconds,
            options: modelRequestOptions(config, "video"),
        }),
        [config, prompt, operation],
    );
    const resolvedModel = resolveCompatibleModel(config, model, requirements) || model;
    const operations = useMemo(() => (resolvedModel ? modelCapabilityConfigFor(config, resolvedModel).video?.operations || [] : []).filter((value) => value in operationLabels) as CanvasVideoEditOperation[], [config, resolvedModel]);
    useEffect(() => {
        if (operations.length && !operations.includes(operation)) setOperation(operations[0]);
    }, [operations, operation]);
    const validRange = Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end <= duration && end - start >= 0.1;
    const confirm = () => {
        if (submitted.current || !validRange) return;
        if (mode === "video" && (!models.includes(resolvedModel) || !operations.includes(operation))) {
            message.warning("请选择支持参考视频的模型与模式");
            return;
        }
        const range = { startMs: Math.round(start * 1000), endMs: Math.round(end * 1000) };
        submitted.current = true;
        onConfirm(mode === "audio" ? { mode, ...range } : { mode, ...range, segments: [{ id: nanoid(), ...range, sourceNodeId: node.id }], model: resolvedModel, operation, prompt: prompt.trim() });
    };
    return (
        <AppModal open={open} onCancel={onClose} title={mode === "video" ? "选择参考片段" : "提取声音样本"} footer={null} width={640} centered destroyOnHidden>
            <div className="space-y-4">
                {url && !error ? (
                    <video
                        ref={player}
                        src={url}
                        controls
                        playsInline
                        preload="metadata"
                        className="max-h-[40vh] w-full rounded-[var(--r-lg)] bg-[var(--media-surface)]"
                        onLoadedMetadata={(event) => {
                            const value = event.currentTarget.duration;
                            if (Number.isFinite(value) && value > 0) {
                                setDuration(value);
                                setEnd(value);
                            } else setError("无法读取视频时长");
                        }}
                        onError={() => setError("视频预览失败，请检查素材")}
                    />
                ) : (
                    <p role={error ? "alert" : "status"}>{error || "正在读取视频…"}</p>
                )}
                <div className="flex flex-wrap items-end gap-3">
                    <label>
                        起点（秒）
                        <InputNumber aria-label="参考片段起点（秒）" min={0} max={duration} step={0.1} value={start} onChange={(value) => setStart(value ?? 0)} />
                    </label>
                    <label>
                        终点（秒）
                        <InputNumber aria-label="参考片段终点（秒）" min={0} max={duration} step={0.1} value={end} onChange={(value) => setEnd(value ?? 0)} />
                    </label>
                    <Button
                        disabled={!duration}
                        onClick={() => {
                            if (player.current) {
                                player.current.currentTime = start;
                                void player.current.play().catch(() => undefined);
                            }
                        }}
                    >
                        预览起点
                    </Button>
                    <Button
                        disabled={!duration}
                        onClick={() => {
                            setStart(0);
                            setEnd(duration);
                        }}
                    >
                        使用全部
                    </Button>
                </div>
                {mode === "video" ? (
                    <>
                        <div className="grid grid-cols-2 gap-3">
                            <ModelPicker config={config} value={resolvedModel} onChange={setModel} capability="video" requirements={requirements} fullWidth />
                            <Select value={operation} options={operations.map((value) => ({ value, label: operationLabels[value]! }))} onChange={(value) => setOperation(value as CanvasVideoEditOperation)} />
                        </div>
                        <Input.TextArea aria-label="参考片段生成提示词" value={prompt} onChange={(event) => setPrompt(event.target.value)} autoSize={{ minRows: 2, maxRows: 4 }} placeholder="描述希望生成的内容…" />
                        <p className="text-xs text-muted-foreground">保存参考片段并连接一个待生成视频节点，确认后仍由你手动提交生成。</p>
                    </>
                ) : (
                    <p className="text-xs text-muted-foreground">选定范围会保存为 MP3 素材，可用于角色声音参考。</p>
                )}
                <div className="flex justify-end gap-2">
                    <Button onClick={onClose}>取消</Button>
                    <Button type="primary" disabled={!validRange || Boolean(error) || (mode === "video" && !models.length)} onClick={confirm}>
                        {mode === "video" ? "创建参考与生成节点" : "保存声音样本"}
                    </Button>
                </div>
            </div>
        </AppModal>
    );
}
