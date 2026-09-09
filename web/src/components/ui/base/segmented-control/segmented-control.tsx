import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

/**
 * SegmentedControl — 分段控制器（自研，无依赖）。
 *
 * 设计约束（对齐 ui/README 与 ADR-0008）：
 * - 只消费三层 token 工具类（surface-tertiary / surface-strong / foreground / muted-foreground / ring …），
 *   不写死任何色值；明暗自适应随主题 token。
 * - 选中项 thumb 走 bg-surface-strong（light #fff / dark #2a2a2a 抬升面）。
 * - 键盘：radio 组 roving tabindex（←/→/Home/End，自动跳过禁用项）。
 * - thumb 位置 useLayoutEffect 测量 + ResizeObserver 兜底；motion-reduce 下不播动画。
 * - API 对齐 AntD Segmented（value/onChange/options/block/size/disabled），
 *   可直接置于 antd Form.Item（Form 注入 value/onChange，props 同名兼容）。
 * - icon 节点尺寸由调用方控制（与 AntD options.icon 行为一致），用 currentColor 跟随文字色。
 */

export type SegmentedSize = "sm" | "md";

export interface SegmentedOption<V extends string = string> {
    value: V;
    /** 文本标签（icon-only 时省略） */
    label?: ReactNode;
    /** 图标节点（与 label 同给时渲染在左侧，尺寸自控） */
    icon?: ReactNode;
    disabled?: boolean;
    /** 原生 title */
    title?: string;
}

export interface SegmentedControlProps<V extends string = string> {
    value?: V;
    onChange?: (value: V) => void;
    options: Array<SegmentedOption<V>>;
    size?: SegmentedSize;
    /** 填满父容器宽度（项均分） */
    block?: boolean;
    /** 整体禁用 */
    disabled?: boolean;
    ariaLabel?: string;
    className?: string;
}

const SIZE_CLASS: Record<SegmentedSize, { track: string; thumb: string; item: string }> = {
    sm: {
        track: "h-7 rounded-md p-0.5",
        thumb: "rounded-sm",
        item: "px-2.5 text-xs",
    },
    md: {
        track: "h-8 rounded-lg p-0.5",
        thumb: "rounded-md",
        item: "px-3 text-sm",
    },
};

export function SegmentedControl<V extends string = string>({ value, onChange, options, size = "md", block = false, disabled = false, ariaLabel, className = "" }: SegmentedControlProps<V>) {
    const trackRef = useRef<HTMLDivElement | null>(null);
    const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);

    const selectedIndex = options.findIndex((option) => option.value === value);

    /** 无选中项时兜底首个可用项，保证 roving tabindex 下键盘始终可达 */
    const focusableIndex = selectedIndex >= 0 ? selectedIndex : options.findIndex((option) => !option.disabled);

    useLayoutEffect(() => {
        const track = trackRef.current;
        if (!track) return;
        const measure = () => {
            const target = itemRefs.current[selectedIndex];
            if (!target) {
                setThumb(null);
                return;
            }
            setThumb({ left: target.offsetLeft, width: target.offsetWidth });
        };
        measure();
        const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
        observer?.observe(track);
        return () => observer?.disconnect();
    }, [selectedIndex, options, value]);

    const select = (next: V, nextIndex: number) => {
        if (disabled || options[nextIndex]?.disabled) return;
        onChange?.(next);
        itemRefs.current[nextIndex]?.focus();
    };

    const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
        if (disabled || !["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        if (event.key === "Home") {
            const first = options.findIndex((option) => !option.disabled);
            if (first >= 0) select(options[first].value, first);
            return;
        }
        if (event.key === "End") {
            let last = -1;
            options.forEach((option, optionIndex) => {
                if (!option.disabled) last = optionIndex;
            });
            if (last >= 0) select(options[last].value, last);
            return;
        }
        const isPrev = event.key === "ArrowLeft";
        for (let step = 1; step <= options.length; step += 1) {
            const candidate = (index + (isPrev ? -step : step) + options.length * 2) % options.length;
            if (!options[candidate].disabled) {
                select(options[candidate].value, candidate);
                return;
            }
        }
    };

    const itemBase =
        "relative z-10 inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap font-medium outline-none transition-colors motion-reduce:transition-none " + "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ";

    return (
        <div ref={trackRef} role="radiogroup" aria-label={ariaLabel} className={["relative inline-flex bg-surface-tertiary", SIZE_CLASS[size].track, block ? "flex w-full" : "", disabled ? "opacity-60" : "", className].join(" ")}>
            {thumb !== null && !disabled && (
                <span
                    aria-hidden="true"
                    className={["pointer-events-none absolute inset-y-0.5 z-0 bg-surface-strong transition-[left,width] duration-200 ease-out motion-reduce:transition-none", SIZE_CLASS[size].thumb].join(" ")}
                    style={{ left: thumb.left, width: thumb.width }}
                />
            )}
            {options.map((option, index) => {
                const selected = index === selectedIndex && !disabled;
                return (
                    <button
                        key={option.value}
                        ref={(element) => {
                            itemRefs.current[index] = element;
                        }}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        aria-label={option.label ? undefined : (option.title ?? option.value)}
                        title={option.title}
                        disabled={disabled || option.disabled}
                        tabIndex={index === focusableIndex ? 0 : -1}
                        onClick={() => {
                            if (option.disabled) return;
                            onChange?.(option.value);
                        }}
                        onKeyDown={(event) => onKeyDown(event, index)}
                        className={[
                            itemBase,
                            SIZE_CLASS[size].item,
                            SIZE_CLASS[size].thumb,
                            block ? "flex-1" : "",
                            option.disabled ? "cursor-not-allowed text-muted-foreground/40" : selected ? "cursor-default text-foreground" : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                        ].join(" ")}
                    >
                        {option.icon}
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}
