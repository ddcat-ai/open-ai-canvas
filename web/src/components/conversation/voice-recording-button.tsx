import { Button } from "antd";
import { Tooltip } from "@/components/ui/base/tooltip";
import { useState } from "react";

import { Mic } from "lucide-react";

import { cn } from "@/lib/utils";
import { VoiceRecordingInline } from "./voice-recording-inline";
import { canvasThemes } from "@/lib/canvas-theme";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";

type VoiceRecordingButtonProps = {
    /** 转写完成回调，返回转写文本 */
    onTranscribed: (text: string) => void;
    /** 是否禁用（如发送中或未连接） */
    disabled?: boolean;
    className?: string;
};

/**
 * 语音输入按钮：点击后在输入行内展开波形录制条，录制完成自动 STT 转写
 * 使用局部状态，多个输入行可独立使用
 */
export function VoiceRecordingButton({ onTranscribed, disabled, className }: VoiceRecordingButtonProps) {
    const theme = canvasThemes[useActiveTheme()];
    const [open, setOpen] = useState(false);

    return (
        <>
            <Tooltip title="实时对话">
                <Button
                    type="text"
                    shape="circle"
                    className={cn("!h-8 !w-8 !min-w-8", className)}
                    disabled={disabled}
                    style={className ? undefined : { color: theme.node.muted }}
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
