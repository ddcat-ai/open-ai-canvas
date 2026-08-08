import { useState } from "react";
import { Button, Tooltip } from "antd";
import { Mic } from "lucide-react";

import { VoiceRecordingInline } from "./voice-recording-inline";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

type VoiceRecordingButtonProps = {
    /** 转写完成回调，返回转写文本 */
    onTranscribed: (text: string) => void;
    /** 是否禁用（如发送中或未连接） */
    disabled?: boolean;
};

/**
 * 语音输入按钮：点击后在输入行内展开波形录制条，录制完成自动 STT 转写
 * 使用局部状态，多个输入行可独立使用
 */
export function VoiceRecordingButton({ onTranscribed, disabled }: VoiceRecordingButtonProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [open, setOpen] = useState(false);

    return (
        <>
            <Tooltip title="实时对话">
                <Button
                    type="text"
                    shape="circle"
                    className="!h-8 !w-8 !min-w-8"
                    disabled={disabled}
                    style={{ color: theme.node.muted }}
                    icon={<Mic className="size-4" />}
                    onClick={() => setOpen(true)}
                    aria-label="实时对话"
                />
            </Tooltip>
            {open ? (
                <VoiceRecordingInline
                    onTranscribed={(text) => {
                        setOpen(false);
                        onTranscribed(text);
                    }}
                    onCancel={() => setOpen(false)}
                />
            ) : null}
        </>
    );
}