import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type LL2SelectOption = { value: string; label: string };

type Props = {
    value: string;
    options: LL2SelectOption[];
    onChange: (value: string) => void;
    ariaLabel: string;
    disabled?: boolean;
    title?: string;
    /** chip：自己带浅底胶囊；plain：交给外层容器（首页参数 chip）出底。 */
    variant?: "chip" | "plain";
};

/**
 * C 端统一的小下拉：替代原生 <select>，弹出层可以做出圆角、浅底、选中勾，
 * 原生 select 的弹层是系统绘制的，没法跟整体风格统一（2026-11-19 用户反馈）。
 */
export function LL2Select({ value, options, onChange, ariaLabel, disabled, title, variant = "chip" }: Props) {
    const [open, setOpen] = useState(false);
    const [placement, setPlacement] = useState<"down" | "up">("down");
    const rootRef = useRef<HTMLDivElement | null>(null);
    const triggerRef = useRef<HTMLButtonElement | null>(null);

    useEffect(() => {
        if (!open) return;
        const onPointerDown = (event: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") setOpen(false);
        };
        document.addEventListener("mousedown", onPointerDown);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("mousedown", onPointerDown);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [open]);

    const current = options.find((option) => option.value === value);

    /** 弹层默认向下；靠近视口底部（比如右侧聊天改稿的输入条）就向上翻，避免被裁掉。 */
    const toggle = () => {
        if (open) {
            setOpen(false);
            return;
        }
        const rect = triggerRef.current?.getBoundingClientRect();
        const estimated = Math.min(280, options.length * 32 + 12);
        const spaceBelow = rect ? window.innerHeight - rect.bottom : estimated + 24;
        const spaceAbove = rect ? rect.top : estimated + 24;
        setPlacement(spaceBelow < estimated + 16 && spaceAbove > spaceBelow ? "up" : "down");
        setOpen(true);
    };

    return (
        <div className={`ll2-select is-${variant}${open ? " is-open" : ""}${placement === "up" ? " is-up" : ""}`} ref={rootRef}>
            <button
                ref={triggerRef}
                type="button"
                className="ll2-select-trigger"
                aria-label={ariaLabel}
                aria-haspopup="listbox"
                aria-expanded={open}
                disabled={disabled}
                title={title}
                onClick={toggle}
            >
                <span className="ll2-select-value">{current?.label || "请选择"}</span>
                <ChevronDown className="ll2-select-arrow" aria-hidden />
            </button>
            {open ? (
                <span className="ll2-select-menu" role="listbox" aria-label={ariaLabel}>
                    {options.map((option) => {
                        const selected = option.value === value;
                        return (
                            <button
                                key={option.value}
                                type="button"
                                role="option"
                                aria-selected={selected}
                                className={`ll2-select-item${selected ? " is-selected" : ""}`}
                                onClick={() => {
                                    onChange(option.value);
                                    setOpen(false);
                                }}
                            >
                                <span>{option.label}</span>
                                {selected ? <Check className="size-3.5" aria-hidden /> : null}
                            </button>
                        );
                    })}
                </span>
            ) : null}
        </div>
    );
}