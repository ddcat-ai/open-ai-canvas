import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { AIMessageMarkdown } from "./ai-message-markdown";

type Props = {
    reasoning: string;
    isStreaming: boolean;
};

// 推理思维链折叠：流式中自动展开，结束后 1s 自动收起，显示思考时长。
// 设计：内容区不做 max-height / overflow，依靠折叠按钮控制显隐 —— 避免滚动条导致外层消息卡片左右滚动。
export function MessageReasoning({ reasoning, isStreaming }: Props) {
    const [isOpen, setIsOpen] = useState(false);
    const [duration, setDuration] = useState<number | undefined>(undefined);
    const [hasAutoClosed, setHasAutoClosed] = useState(false);
    const startTimeRef = useRef<number | null>(null);

    // 流式开始时记录起始时间并展开
    useEffect(() => {
        if (isStreaming) {
            if (startTimeRef.current === null) startTimeRef.current = Date.now();
            if (!isOpen) setIsOpen(true);
        }
    }, [isStreaming, isOpen]);

    // 流式结束时计算耗时
    useEffect(() => {
        if (!isStreaming && startTimeRef.current !== null) {
            setDuration(Math.ceil((Date.now() - startTimeRef.current) / 1000));
            startTimeRef.current = null;
        }
    }, [isStreaming]);

    // 结束后 1s 自动收起（仅一次）
    useEffect(() => {
        if (!isStreaming && isOpen && !hasAutoClosed && duration !== undefined) {
            const timer = setTimeout(() => {
                setIsOpen(false);
                setHasAutoClosed(true);
            }, 1000);
            return () => clearTimeout(timer);
        }
    }, [isStreaming, isOpen, hasAutoClosed, duration]);

    const label = isStreaming || duration === undefined
        ? <span className="creation-shimmer" aria-live="polite">思考中…</span>
        : <span>已思考 {duration} 秒</span>;

    return (
        <div className="message-reasoning">
            <button
                type="button"
                className="message-reasoning-trigger"
                onClick={() => setIsOpen(!isOpen)}
                aria-expanded={isOpen}
            >
                {label}
                <ChevronDown size={14} className={`message-reasoning-chevron${isOpen ? " is-open" : ""}`} />
            </button>
            {isOpen ? (
                <div className="message-reasoning-content">
                    <AIMessageMarkdown isStreaming={isStreaming}>{reasoning}</AIMessageMarkdown>
                </div>
            ) : null}
        </div>
    );
}
