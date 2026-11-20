import { Button, Spin } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Square, X } from "lucide-react";

import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { canvasThemes } from "@/lib/canvas-theme";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";

type VoiceRecordingInlineProps = { onTranscribed: (text: string) => void; onCancel: () => void };

/** 语音文字输入只启用 Web Speech；角色样本录制独立使用 MediaRecorder。 */
export function VoiceRecordingInline({ onTranscribed, onCancel }: VoiceRecordingInlineProps) {
    const theme = canvasThemes[useActiveTheme()];
    const { supported, listening, error, start, stop, cancel } = useSpeechRecognition();
    const [duration, setDuration] = useState(0);
    const [transcribing, setTranscribing] = useState(false);
    const [emptyError, setEmptyError] = useState("");
    const callbacks = useRef({ onTranscribed, onCancel });
    callbacks.current = { onTranscribed, onCancel };
    const generation = useRef(0);
    const stopping = useRef(false);
    const wasListening = useRef(false);

    const finish = useCallback(async () => {
        if (stopping.current) return;
        stopping.current = true;
        const token = generation.current;
        setTranscribing(true);
        const text = (await stop()).trim();
        if (token !== generation.current) return;
        setTranscribing(false);
        wasListening.current = false;
        if (text) callbacks.current.onTranscribed(text);
        else {
            setEmptyError("未识别到语音内容，请重试");
            stopping.current = false;
        }
    }, [stop]);

    useEffect(() => {
        generation.current++;
        if (supported) start();
        return () => {
            generation.current++;
            cancel();
        };
    }, [supported, start, cancel]);
    useEffect(() => {
        if (!listening) return;
        wasListening.current = true;
        const startedAt = Date.now();
        const timer = window.setInterval(() => setDuration(Math.min(60, Math.floor((Date.now() - startedAt) / 1000))), 1000);
        const deadline = window.setTimeout(() => void finish(), 60_000);
        return () => {
            window.clearInterval(timer);
            window.clearTimeout(deadline);
        };
    }, [listening, finish]);
    useEffect(() => {
        if (!listening && wasListening.current && !error && !stopping.current) void finish();
    }, [listening, error, finish]);
    const close = () => {
        generation.current++;
        cancel();
        callbacks.current.onCancel();
    };
    const retry = () => {
        generation.current++;
        stopping.current = false;
        wasListening.current = false;
        setDuration(0);
        setEmptyError("");
        setTranscribing(false);
        start();
    };
    const displayError = !supported ? "当前浏览器不支持语音识别，请使用 Chrome 或 Edge" : error?.message || emptyError;
    return (
        <div className="voice-recording-inline flex min-w-0 flex-1 items-center gap-2 rounded-lg border px-2 py-2" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }}>
            {displayError ? (
                <>
                    <span className="min-w-0 flex-1 truncate text-xs" role="alert" style={{ color: "var(--status-error)" }}>
                        {displayError}
                    </span>
                    {supported ? <Button type="text" size="small" icon={<Mic className="size-3.5" />} aria-label="重试语音识别" onClick={retry} /> : null}
                </>
            ) : transcribing ? (
                <span role="status" className="flex items-center gap-2 text-xs">
                    <Spin size="small" />
                    正在整理语音…
                </span>
            ) : (
                <>
                    <Mic className="size-4 shrink-0" aria-hidden="true" />
                    <span className="flex-1 text-xs">{listening ? "正在聆听" : "正在启动"}</span>
                    <span className="font-mono text-xs tabular-nums">
                        {Math.floor(duration / 60)}:{String(duration % 60).padStart(2, "0")}
                    </span>
                    <Button type="text" size="small" icon={<Square className="size-3.5" />} aria-label="停止并转写" disabled={!listening} onClick={() => void finish()} />
                </>
            )}
            <Button type="text" size="small" icon={<X className="size-3.5" />} aria-label="取消语音输入" onClick={close} />
        </div>
    );
}
