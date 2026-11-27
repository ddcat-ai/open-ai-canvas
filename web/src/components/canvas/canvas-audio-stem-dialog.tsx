import { useRef, useState } from "react";
import { Alert, Button } from "antd";
import { ArrowRight, AudioLines, Check, FileAudio2, Layers2, Mic2, Music2, ShieldCheck, X } from "lucide-react";
import { AppModal } from "@/components/ui/product/app-modal";
import type { AudioStemSelection } from "@/lib/audio-stem/contracts";
import "./canvas-audio-stem.css";

const OPTIONS = [
    { value: "both", label: "人声和伴奏", detail: "一次获得两条音轨", icon: Layers2 },
    { value: "vocals", label: "仅人声", detail: "提取对白与演唱", icon: Mic2 },
    { value: "instrumental", label: "仅伴奏", detail: "保留背景音乐", icon: Music2 },
] as const;

export function CanvasAudioStemDialog({ open, title, error, onClose, onRun }: { open: boolean; title: string; error: string; onClose: () => void; onRun: (selection: AudioStemSelection) => void }) {
    const [selection, setSelection] = useState<AudioStemSelection>("both");
    const selectedChoiceRef = useRef<HTMLInputElement>(null);
    return (
        <AppModal
            flush
            open={open}
            title={null}
            aria-labelledby="audio-stem-dialog-title"
            afterOpenChange={(visible) => {
                if (visible) selectedChoiceRef.current?.focus();
            }}
            onCancel={onClose}
            footer={null}
            closable={false}
            width={520}
        >
            <div data-canvas-no-zoom className="audio-stem-config" onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
                <header className="audio-stem-config-header">
                    <span className="audio-stem-feature-icon">
                        <AudioLines size={24} aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                        <h2 id="audio-stem-dialog-title">人声 / 伴奏分离</h2>
                        <p>拆出所需音轨，保留原始音频。</p>
                    </div>
                    <button type="button" className="audio-stem-icon-button" aria-label="关闭分离设置" onClick={onClose}>
                        <X size={18} aria-hidden="true" />
                    </button>
                </header>
                <div className="audio-stem-config-body">
                    <div className="audio-stem-source">
                        <FileAudio2 size={18} aria-hidden="true" />
                        <span title={title}>{title}</span>
                        <span className="audio-stem-source-badge">原音频</span>
                    </div>
                    <fieldset className="audio-stem-options">
                        <legend>选择输出音轨</legend>
                        <div className="audio-stem-option-grid">
                            {OPTIONS.map(({ value, label, detail, icon: Icon }) => (
                                <label key={value} className="audio-stem-choice">
                                    <input ref={selection === value ? selectedChoiceRef : undefined} type="radio" name="audio-stem-output" value={value} checked={selection === value} onChange={() => setSelection(value)} />
                                    <span className="audio-stem-choice-body">
                                        <span className="audio-stem-choice-top">
                                            <Icon size={20} aria-hidden="true" />
                                            <span className="audio-stem-choice-check">{selection === value ? <Check size={12} aria-hidden="true" /> : null}</span>
                                        </span>
                                        <span className="audio-stem-choice-label">{label}</span>
                                        <span className="audio-stem-choice-detail">{detail}</span>
                                    </span>
                                </label>
                            ))}
                        </div>
                    </fieldset>
                    <div className="audio-stem-promise">
                        <ShieldCheck size={16} aria-hidden="true" />
                        <span>本机处理 · 不消耗模型额度 · 结果另存为 WAV</span>
                    </div>
                    <details className="audio-stem-help">
                        <summary>首次使用与处理说明</summary>
                        <p>首次下载约 172 MiB 模型，之后优先使用本机缓存。支持 3 分钟以内、128 MiB 以下的音频。结果沿用素材上传与同步流程，复杂混音可能有残留。</p>
                    </details>
                    {error ? <Alert type="error" title={error} showIcon /> : null}
                </div>
                <footer className="audio-stem-config-footer">
                    <span>开始后可继续编辑画布</span>
                    <Button type="primary" size="large" onClick={() => onRun(selection)}>
                        开始分离
                        <ArrowRight size={16} aria-hidden="true" />
                    </Button>
                </footer>
            </div>
        </AppModal>
    );
}
