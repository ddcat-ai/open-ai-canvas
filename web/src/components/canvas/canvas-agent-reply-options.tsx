import { ArrowRight } from "lucide-react";
import type { SyntheticEvent } from "react";

import type { AgentReplyOption } from "@/lib/canvas/agent-reply-options";

type AgentReplyOptionCardsProps = {
    options: readonly AgentReplyOption[];
    onSelect: (option: AgentReplyOption) => void;
    disabled?: boolean;
    /** 选项组的可读名称，读屏时作为分组标题。 */
    label?: string;
};

// 选项可能出现在可拖拽的面板里，按下时不要把事件交给面板或画布的拖拽逻辑。
const stop = (event: SyntheticEvent) => event.stopPropagation();

/**
 * 可点击的回复选项卡片。Agent 回复末尾的编号选项与 ask_user 的单选提问共用这一套样式；
 * 点一下就把该选项作为用户回复发出，不用再手动输入编号。
 */
export function AgentReplyOptionCards({ options, onSelect, disabled = false, label = "可选的下一步" }: AgentReplyOptionCardsProps) {
    return (
        <div className="agent-reply-options" role="group" aria-label={label}>
            {options.map((option) => (
                <button
                    key={`${option.marker}-${option.text}`}
                    type="button"
                    className="agent-reply-option"
                    disabled={disabled}
                    title={option.text}
                    onMouseDown={stop}
                    onPointerDown={stop}
                    onClick={(event) => {
                        stop(event);
                        onSelect(option);
                    }}
                >
                    <span className="agent-reply-option-marker" aria-hidden="true">
                        {option.marker}
                    </span>
                    <span className="agent-reply-option-copy">
                        <span className="agent-reply-option-title">{option.title}</span>
                        {option.detail ? <span className="agent-reply-option-detail">{option.detail}</span> : null}
                    </span>
                    <ArrowRight className="agent-reply-option-arrow" aria-hidden="true" />
                </button>
            ))}
        </div>
    );
}
