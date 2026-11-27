import { useState } from "react";
import { Alert, Button, Progress, Radio } from "antd";
import { AppModal } from "@/components/ui/product/app-modal";
import type { AudioStemProgress, AudioStemSelection } from "@/lib/audio-stem/contracts";

const PHASE_LABELS = { reading: "读取并解码音频", model: "下载并校验分离模型", inference: "本机分离中", saving: "保存音频结果" };

export function CanvasAudioStemDialog({ open, title, progress, error, onClose, onRun }: { open: boolean; title: string; progress: AudioStemProgress | null; error: string; onClose: () => void; onRun: (selection: AudioStemSelection) => void }) {
    const [selection, setSelection] = useState<AudioStemSelection>("both");
    return (
        <AppModal open={open} title="人声 / 伴奏分离" onCancel={onClose} footer={null} width={480}>
            <div data-canvas-no-zoom className="space-y-4" onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
                <p className="truncate text-[var(--foreground-muted)]">{title}</p>
                <Radio.Group value={selection} onChange={(event) => setSelection(event.target.value)} disabled={Boolean(progress)}>
                    <Radio.Button value="both">人声和伴奏</Radio.Button>
                    <Radio.Button value="vocals">仅人声</Radio.Button>
                    <Radio.Button value="instrumental">仅伴奏</Radio.Button>
                </Radio.Group>
                <p className="text-[var(--fs-label)] leading-relaxed text-[var(--foreground-muted)]">在当前浏览器处理，不消耗模型额度。首次使用需下载约 172 MiB 模型，后续优先使用本机缓存。支持 3 分钟以内、128 MiB 以下的音频；处理时请保持页面打开。</p>
                <p className="text-[var(--fs-label)] text-[var(--foreground-muted)]">原音频保留，结果另存为 WAV 音频节点。分离后会沿用现有素材上传与同步流程；复杂混音可能有残留。</p>
                {progress ? (
                    <div role="status" aria-live="polite">
                        <p>{PHASE_LABELS[progress.phase]}</p>
                        <Progress percent={progress.percent} status="active" />
                        <p className="text-[var(--fs-label)] text-[var(--foreground-muted)]">当前百分比表示本阶段进度，首次初始化可能较慢。</p>
                    </div>
                ) : null}
                {error ? <Alert type="error" title={error} showIcon /> : null}
                <div className="flex justify-end gap-2">
                    <Button onClick={onClose}>{progress ? "取消处理" : "关闭"}</Button>
                    <Button type="primary" disabled={Boolean(progress)} onClick={() => onRun(selection)}>
                        {error ? "重新分离" : "开始分离"}
                    </Button>
                </div>
            </div>
        </AppModal>
    );
}
