// AI 助手（editor-shell 预设插件贡献 ai-assistant 插槽，M3.8 注册占位，M6 补实现）。
// M6 将接入 ai-command-schema + timeline-summary 提示词与 ai.text 权限域（ADR-0007：
// AI 编辑交互=预设插件且命令受约束）。当前只提供占位贡献，保证 8 种插槽静态注册齐全。

import { Sparkles } from "lucide-react";

export function EditorAiAssistant() {
    return (
        <div className="flex h-full flex-col bg-[var(--workspace-surface)]">
            <div className="flex h-9 shrink-0 items-center justify-between border-b border-border/60 px-3">
                <span className="text-xs font-medium text-foreground/75">AI 助手</span>
                <span className="rounded-full bg-foreground/8 px-1.5 py-0.5 text-[10px] text-foreground/50">M6</span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
                <Sparkles className="size-5 text-foreground/30" />
                <p className="text-xs text-foreground/45">AI 编辑助手</p>
                <p className="max-w-[220px] text-[11px] leading-relaxed text-foreground/35">
                    M6 接入：基于时间线摘要的自然语言编辑指令，命令受 ai-command-schema 约束。
                </p>
            </div>
        </div>
    );
}
