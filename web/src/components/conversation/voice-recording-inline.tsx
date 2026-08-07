import { useEffect, useRef, useState } from "react";
import { Button, Spin, Tooltip } from "antd";
import { Check, Mic, Square, X } from "lucide-react";

import { AudioWaveform } from "./audio-waveform";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { useVoiceRecording } from "@/hooks/use-voice-recording";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

type VoiceRecordingInlineProps = {
    /** 转写完成回调，返回转写文本 */
    onTranscribed: (text: string) => void;
    /** 取消录制回调 */
    onCancel: () => void;
};

type TranscribeState = "idle" | "transcribing" | "done" | "error";

/**
 * 内联语音录制条（输入行内展示）
 * 挂载后自动开始录音，显示波形动画；点击停止后自动转写为文字（浏览器 Web Speech API，无需后端与 API Key）
 */
export function VoiceRecordingInline({ onTranscribed, onCancel }: VoiceRecordingInlineProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const {
        state,
        waveform,
        duration,
        error: recorderError,
        start: startRecording,
        stop: stopRecording,
        cancel: cancelRecording,
    } = useVoiceRecording({
        maxDuration: 60,
    });
    const {
        supported: speechSupported,
        error: speechError,
        start: startSpeech,
        stop: stopSpeech,
        cancel: cancelSpeech,
    } = useSpeechRecognition();
    const [transcribeState, setTranscribeState] = useState<TranscribeState>("idle");
    const [transcribeError, setTranscribeError] = useState("");
    const stopRequestedRef = useRef(false);
    const wasRecordingRef = useRef(false);

    // 挂载后自动开始录音与语音识别，卸载时清理
    useEffect(() => {
        if (!speechSupported) {
            setTranscribeError("当前浏览器不支持语音识别，请使用 Chrome 或 Edge 浏览器");
            setTranscribeState("error");
            return;
        }
        void startRecording();
        startSpeech();
        return () => {
            cancelRecording();
            cancelSpeech();
        };
    }, [startRecording, cancelRecording, startSpeech, cancelSpeech, speechSupported]);

    const handleStop = async () => {
        if (stopRequestedRef.current || transcribeState !== "idle") return;
        stopRequestedRef.current = true;
        setTranscribeState("transcribing");
        setTranscribeError("");
        const text = await stopSpeech();
        void stopRecording();
        const trimmed = text.trim();
        if (!trimmed) {
            setTranscribeError("未识别到语音内容，请重试");
            setTranscribeState("error");
            stopRequestedRef.current = false;
            return;
        }
        setTranscribeState("done");
        // 短暂展示成功状态后回调
        window.setTimeout(() => onTranscribed(trimmed), 600);
    };

    // 录音达到最大时长自动停止时，自动触发转写
    useEffect(() => {
        if (state === "recording") wasRecordingRef.current = true;
        if (state === "idle" && wasRecordingRef.current && transcribeState === "idle" && !stopRequestedRef.current) {
            wasRecordingRef.current = false;
            void handleStop();
        }
    }, [state, transcribeState]);

    const handleRetry = () => {
        stopRequestedRef.current = false;
        wasRecordingRef.current = false;
        setTranscribeError("");
        setTranscribeState("idle");
        void startRecording();
        startSpeech();
    };

    const formatDuration = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, "0")}`;
    };

    const displayError = recorderError || (speechError ? speechError.message : "") || (transcribeState === "error" ? transcribeError : "");

    return (
        <div
            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border px-2 py-1.5"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }}
        >
            {displayError ? (
                <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="truncate text-xs" style={{ color: "#dc2626" }}>
                        {displayError}
                    </span>
                    {speechSupported ? (
                        <Tooltip title="重试">
                            <Button
                                type="text"
                                size="small"
                                icon={<Mic className="size-3.5" />}
                                onClick={handleRetry}
                                style={{ color: theme.node.muted }}
                            />
                        </Tooltip>
                    ) : null}
                    <Tooltip title="取消">
                        <Button
                            type="text"
                            size="small"
                            icon={<X className="size-3.5" />}
                            onClick={onCancel}
                            style={{ color: theme.node.muted }}
                        />
                    </Tooltip>
                </div>
            ) : transcribeState === "transcribing" ? (
                <div className="flex items-center gap-2 px-2" style={{ color: theme.node.muted }}>
                    <Spin size="small" />
                    <span className="text-xs">正在转写...</span>
                </div>
            ) : transcribeState === "done" ? (
                <div className="flex items-center gap-2 px-2" style={{ color: "#16a34a" }}>
                    <Check className="size-4" />
                    <span className="text-xs">转写完成</span>
                </div>
            ) : (
                <>
                    <AudioWaveform
                        waveform={waveform}
                        color={theme.accent.primary}
                        height={32}
                        width={160}
                        animated={state === "recording"}
                    />
                    {state === "recording" ? (
                        <span className="font-mono text-xs tabular-nums" style={{ color: theme.node.text }}>
                            {formatDuration(duration)}
                        </span>
                    ) : null}
                    <Tooltip title="取消">
                        <Button
                            type="text"
                            size="small"
                            icon={<X className="size-3.5" />}
                            onClick={() => {
                                cancelRecording();
                                cancelSpeech();
                                onCancel();
                            }}
                            style={{ color: theme.node.muted }}
                        />
                    </Tooltip>
                    <Tooltip title="停止并转写">
                        <Button
                            type="text"
                            size="small"
                            icon={<Square className="size-3.5" />}
                            onClick={handleStop}
                            disabled={state !== "recording" || transcribeState !== "idle"}
                            style={{ color: theme.accent.primary }}
                        />
                    </Tooltip>
                </>
            )}
        </div>
    );
}
