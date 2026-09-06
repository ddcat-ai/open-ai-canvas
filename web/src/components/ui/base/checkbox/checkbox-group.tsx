import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { Checkbox } from "./checkbox";

/**
 * CheckboxGroup — 复选框组（自研，原生 input，无依赖）。
 *
 * - 容器不预设布局：调用方用 className 决定排列（垂直传 `flex flex-col gap-1.5`，
 *   网格传 `grid grid-cols-2 gap-2`），与 AntD Checkbox.Group 行为一致。
 * - 受控 value: V[] + onChange(values)，泛型覆盖枚举/字符串场景；
 *   可直接替换 AntD Checkbox.Group（options/value/onChange/disabled）。
 * - 对标：AntD Checkbox.Group。
 */

export interface CheckboxGroupOption<V extends string = string> {
    value: V;
    label: ReactNode;
    disabled?: boolean;
}

export interface CheckboxGroupProps<V extends string = string> {
    value?: V[];
    onChange?: (values: V[]) => void;
    options: Array<CheckboxGroupOption<V>>;
    /** 组整体禁用 */
    disabled?: boolean;
    ariaLabel?: string;
    className?: string;
}

export function CheckboxGroup<V extends string = string>({
    value = [],
    onChange,
    options,
    disabled = false,
    ariaLabel,
    className,
}: CheckboxGroupProps<V>) {
    const toggle = (optionValue: V, checked: boolean) => {
        if (disabled) return;
        const next = checked ? [...value, optionValue] : value.filter((item) => item !== optionValue);
        onChange?.(next);
    };

    return (
        <div data-slot="checkbox-group" role="group" aria-label={ariaLabel} className={className}>
            {options.map((option) => (
                <Checkbox
                    key={option.value}
                    checked={value.includes(option.value)}
                    disabled={disabled || option.disabled}
                    onChange={(event) => toggle(option.value, event.target.checked)}
                >
                    {option.label}
                </Checkbox>
            ))}
        </div>
    );
}
