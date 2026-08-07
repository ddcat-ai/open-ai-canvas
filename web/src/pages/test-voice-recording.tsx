import { useState } from "react";
import { Button, Card, message } from "antd";
import { Mic, Send } from "lucide-react";

import { VoiceRecordingButton } from "@/components/conversation/voice-recording-button";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

/**
 * 语音录制功能测试页面
 * 验证输入行内联波形录制和 STT 转写闭环
 */
export default function TestVoiceRecording() {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [prompt, setPrompt] = useState("");
    const [sending, setSending] = useState(false);

    const handleTranscribed = (text: string) => {
        // 转写结果填入输入框，供用户确认或直接发送
        setPrompt((current) => (current.trim() ? `${current} ${text}` : text));
        message.success("语音已转写为文字");
    };

    const handleSubmit = async () => {
        if (!prompt.trim()) return;
        setSending(true);
        try {
            // 原型阶段：发送到对话入口由调用方接入；此处仅输出
            console.log("发送文本:", prompt);
            message.success("发送成功（原型阶段，仅控制台输出）");
            setPrompt("");
        } finally {
            setSending(false);
        }
    };


    return (
        <div className="min-h-screen p-8" style={{ background: theme.spatial.surface }}>
            <div className="mx-auto max-w-2xl">
                <Card
                    title={
                        <div className="flex items-center gap-2">
                            <Mic className="size-5" style={{ color: theme.accent.primary }} />
                            <span>实时对话功能测试（MVP）</span>
                        </div>
                    }
                    style={{ background: theme.spatial.elevated, borderColor: theme.toolbar.border }}
                >
                    <div className="space-y-4">
                        {/* 文本输入 */}
                        <div>
                            <label className="mb-2 block text-sm font-medium" style={{ color: theme.node.text }}>
                                文本输入（语音转写结果会自动填入）
                            </label>
                            <textarea
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                placeholder="输入消息，或点击实时对话按钮用语音输入..."
                                className="w-full rounded-lg border px-3 py-2 text-sm outline-none transition focus:border-current"
                                style={{
                                    background: theme.node.fill,
                                    borderColor: theme.toolbar.border,
                                    color: theme.node.text,
                                    minHeight: 80,
                                }}
                            />
                        </div>

                        {/* 音频预览 */}

                        {/* 控制栏：实时对话按钮（点击后在输入行展开波形录制条） */}
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex flex-1 items-center gap-2">
                                <VoiceRecordingButton onTranscribed={handleTranscribed} />
                            </div>
                            <Button
                                type="primary"
                                icon={<Send className="size-4" />}
                                disabled={!prompt.trim()}
                                loading={sending}
                                onClick={handleSubmit}
                                style={{ background: theme.accent.primary, borderColor: theme.accent.primary }}
                            >
                                发送
                            </Button>
                        </div>

                        {/* 说明 */}
                        <div className="rounded-lg border p-3 text-xs" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.muted }}>
                            <div className="font-semibold" style={{ color: theme.node.text }}>
                                使用说明：
                            </div>
                            <ul className="mt-1 list-inside list-disc space-y-1">
                                <li>点击麦克风按钮，输入行内展开波形录制条并自动开始录音</li>
                                <li>波形动画实时显示音量变化</li>
                                <li>点击停止按钮完成录制，自动上传并转写</li>
                                <li>转写结果自动填入输入框，可编辑后发送</li>
                                <li>转写失败时在录制条内提示，可点击麦克风重试</li>
                            </ul>
                        </div>
                    </div>
                </Card>
            </div>
        </div>
    );
}