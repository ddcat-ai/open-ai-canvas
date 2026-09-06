import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Switch — 开关（自研，button role=switch，无依赖）。
 *
 * 设计约束（对齐 ui/README 与 ADR-0008）：
 * - <button type="button" role="switch" aria-checked> 承载语义与键盘（Space/Enter 原生），
 *   :focus-visible outline 落自身；无裸色、只消费三层 token。
 * - 开 = bg-foreground + 反色 thumb（bg-background 语义对齐 Checkbox 选中态），
 *   关 = bg-surface-tertiary + 发丝内描边 + surface-strong 抬升 thumb（同 SegmentedControl 选中面）。
 * - thumb 滑动用 translate-x 位移（尺寸档固定行程），motion-reduce 关闭过渡。
 * - data-state="on|off" 暴露给上下文 CSS 覆盖（admin 语义绿等保留于页面层，不侵入组件）。
 * - API 对齐 AntD Switch：checked/defaultChecked/onChange/disabled/size/checkedChildren/
 *   unCheckedChildren/loading + aria-* 透传；受控与否由 checked 是否传入决定，
 *   onChange(checked) 单参。顶层组件接收 checked/onChange → Form.Item valuePropName="checked" 注入兼容。
 * 对标：AntD Switch；boardui base/switch。
 */

export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "size" | "onChange"> {
    /** 开关尺寸。默认 md；AntD small → sm 映射。 */
    size?: "sm" | "md";
    /** 受控：是否开启 */
    checked?: boolean;
    /** 非受控初始值 */
    defaultChecked?: boolean;
    /** loading：拇指位换转圈，忽略点击（视觉保留 checked 态） */
    loading?: boolean;
    /** 开启时轨道内左侧文案（2 字宽度档） */
    checkedChildren?: ReactNode;
    /** 关闭时轨道内右侧文案 */
    unCheckedChildren?: ReactNode;
    /** 变化回调（AntD 同签名：仅布尔参） */
    onChange?: (checked: boolean) => void;
}

/** 几何档：轨道尺寸与 thumb 行程（thumb 用 left-0.5 起始 + translate-x 档位） */
const SWITCH_SIZE: Record<
    "sm" | "md",
    { root: string; thumbPlain: string; thumbText: string; hasTextRoot: string }
> = {
    sm: {
        root: "h-5 w-8 rounded-full",
        thumbPlain: "size-3.5 data-[state=on]:translate-x-3.5",
        thumbText: "size-3.5 data-[state=on]:translate-x-3.5",
        hasTextRoot: "",
    },
    md: {
        root: "h-6 w-11 rounded-full",
        thumbPlain: "size-4 data-[state=on]:translate-x-6",
        thumbText: "size-4 data-[state=on]:translate-x-9",
        hasTextRoot: "w-14",
    },
};

export function Switch({
    size = "md",
    checked: checkedProp,
    defaultChecked = false,
    loading = false,
    checkedChildren,
    unCheckedChildren,
    onChange,
    disabled,
    className,
    "aria-label": ariaLabel,
    ...props
}: SwitchProps) {
    const [innerChecked, setInnerChecked] = useState(defaultChecked);
    const controlled = checkedProp !== undefined;
    const checked = controlled ? checkedProp : innerChecked;
    const hasText = checkedChildren !== undefined || unCheckedChildren !== undefined;

    const handleClick = () => {
        if (disabled || loading) {
            return;
        }
        const next = !checked;
        if (!controlled) {
            setInnerChecked(next);
        }
        onChange?.(next);
    };

    const geometry = SWITCH_SIZE[size];
    const thumbClass = hasText ? geometry.thumbText : geometry.thumbPlain;

    return (
        <button
            type="button"
            role="switch"
            data-slot="switch"
            data-state={checked ? "on" : "off"}
            aria-checked={checked}
            aria-label={ariaLabel}
            aria-busy={loading || undefined}
            disabled={disabled}
            onClick={handleClick}
            className={cn(
                "relative inline-flex shrink-0 select-none items-center align-middle transition-colors motion-reduce:transition-none",
                "data-[state=on]:bg-foreground",
                "data-[state=off]:bg-surface-tertiary data-[state=off]:ring-1 data-[state=off]:ring-inset data-[state=off]:ring-foreground/15",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                "disabled:cursor-not-allowed disabled:opacity-45",
                geometry.root,
                hasText && size === "md" && geometry.hasTextRoot,
                className,
            )}
            {...props}
        >
            {/* 关态文案（右侧） */}
            {unCheckedChildren !== undefined ? (
                <span
                    aria-hidden="true"
                    className={cn(
                        "absolute top-1/2 right-1.5 -translate-y-1/2 text-xs leading-none font-medium transition-opacity motion-reduce:transition-none",
                        checked ? "text-foreground/55 opacity-0" : "text-foreground/55 opacity-100",
                    )}
                >
                    {unCheckedChildren}
                </span>
            ) : null}
            {/* 开态文案（左侧，反色） */}
            {checkedChildren !== undefined ? (
                <span
                    aria-hidden="true"
                    className={cn(
                        "absolute top-1/2 left-1.5 -translate-y-1/2 text-xs leading-none font-medium transition-opacity motion-reduce:transition-none",
                        checked ? "text-background opacity-100" : "text-background opacity-0",
                    )}
                >
                    {checkedChildren}
                </span>
            ) : null}
            {/* thumb / loading 转圈 */}
            {loading ? (
                <span
                    aria-hidden="true"
                    className={cn(
                        "absolute inset-0 m-auto size-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent",
                        checked ? "text-background" : "text-foreground/60",
                    )}
                />
            ) : (
                <span
                    aria-hidden="true"
                    className={cn(
                        "sc-switch-thumb absolute left-0.5 top-1/2 -translate-y-1/2 rounded-full bg-surface-strong border border-border/80 transition-transform duration-200 ease-out motion-reduce:transition-none",
                        thumbClass,
                    )}
                />
            )}
        </button>
    );
}
