import { useId, useRef, useState, type CSSProperties } from "react";
import { THINKING_LEVEL_LABELS, type ThinkingLevel, type ThinkingRequest } from "@/lib/text-thinking";
import "./thinking-level-slider.css";

type Props = {
    levels: ThinkingLevel[];
    value: ThinkingRequest | "";
    resolvedLevel?: ThinkingLevel | "";
    onChange: (value: ThinkingRequest) => void;
    disabled?: boolean;
};

export function ThinkingLevelSlider({ levels, value, resolvedLevel, onChange, disabled = false }: Props) {
    const id = useId();
    const dragging = useRef(false);
    const pending = useRef(0);
    const [draft, setDraft] = useState<number | null>(null);
    if (!levels.length) return <span className="thinking-level-unavailable">不可调节</span>;
    const options: ThinkingRequest[] = ["auto", ...levels];
    const automatic = !value || value === "auto";
    const effective = resolvedLevel || (value === "deep" ? levels.filter((level) => level !== "off" && level !== "max").at(-1) : value);
    const savedIndex = automatic ? 0 : Math.max(1, options.indexOf(effective as ThinkingRequest));
    const position = draft ?? savedIndex;
    const index = Math.max(0, Math.min(options.length - 1, Math.round(position)));
    const selected = options[index];
    const label = selected === "auto" ? "默认" : THINKING_LEVEL_LABELS[selected as ThinkingLevel];
    const tone = selected === "max" ? "max" : selected === "off" || selected === "auto" ? "off" : "on";
    const commit = () => {
        if (!dragging.current) return;
        dragging.current = false;
        if (!disabled) onChange(options[Math.max(0, Math.min(options.length - 1, Math.round(pending.current)))]);
        setDraft(null);
    };
    return (
        <div className="thinking-level-slider" data-tone={tone} data-disabled={disabled || undefined}>
            <div className="thinking-level-track" style={{ "--thinking-fraction": position / (options.length - 1) } as CSSProperties}>
                <div className="thinking-level-rail" aria-hidden="true">
                    <div className="thinking-level-fill" />
                    <div className="thinking-level-dots">
                        {options.map((level, point) => (
                            <i key={level} data-filled={point <= position || undefined} />
                        ))}
                    </div>
                </div>
                <input
                    id={id}
                    type="range"
                    min={0}
                    max={options.length - 1}
                    step="any"
                    value={position}
                    disabled={disabled}
                    aria-label="思考等级"
                    aria-valuetext={label}
                    onPointerDown={(event) => {
                        if (disabled || event.button !== 0) return;
                        event.stopPropagation();
                        dragging.current = true;
                        pending.current = savedIndex;
                        setDraft(savedIndex);
                        event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                    onChange={(event) => {
                        const next = Number(event.target.value);
                        pending.current = next;
                        // 拖动只更新这个小控件；松手才更新创作页、Agent 设置和持久化偏好。
                        if (dragging.current) setDraft(next);
                        else onChange(options[Math.round(next)]);
                    }}
                    onPointerUp={commit}
                    onLostPointerCapture={commit}
                    onPointerCancel={() => {
                        dragging.current = false;
                        setDraft(null);
                    }}
                    onBlur={commit}
                    onKeyDown={(event) => {
                        const next =
                            event.key === "Home"
                                ? 0
                                : event.key === "End"
                                  ? options.length - 1
                                  : ["ArrowRight", "ArrowUp"].includes(event.key)
                                    ? Math.min(index + 1, options.length - 1)
                                    : ["ArrowLeft", "ArrowDown"].includes(event.key)
                                      ? Math.max(index - 1, 0)
                                      : undefined;
                        if (next === undefined) return;
                        event.preventDefault();
                        event.stopPropagation();
                        onChange(options[next]);
                    }}
                />
            </div>
            <label htmlFor={id} className="thinking-level-value">
                {label}
            </label>
        </div>
    );
}
