import { forwardRef, useState, type ReactElement, type ReactNode, type RefAttributes } from "react";
import AntSelect, { type BaseOptionType, type DefaultOptionType, type RefSelectProps, type SelectProps as AntSelectProps } from "antd/es/select";

import { cn } from "@/lib/utils";

/**
 * 影策唯一下拉选择组件。
 *
 * 所有单选、多选、可搜索选择都复用 Ant Design 的同一实现；本文件只负责
 * 统一项目内的入口、尺寸别名、ariaLabel 兼容和公共 class，避免页面各自维护
 * 一套浮层和焦点样式。视觉规则集中在 app-theme.ts 与 globals.css。
 */

export type SelectSize = "sm" | "md";
export type SelectAppearance = "soft" | "pill" | "field";

export type SelectOption<V extends string | number = string> = DefaultOptionType & {
    value: V;
    label: ReactNode;
};

export type SelectProps<ValueType = any, OptionType extends BaseOptionType | DefaultOptionType = DefaultOptionType> = Omit<AntSelectProps<ValueType, OptionType>, "size"> & {
    /** 兼容旧的基础 Select API；完整 AntD 尺寸仍可使用 small/middle/large。 */
    size?: SelectSize | "small" | "middle" | "large";
    /** 兼容基础 Select 的显式无障碍标签。 */
    ariaLabel?: string;
    /** 统一触发器外观；所有外观都无描边，差异只体现在圆角与内边距。 */
    appearance?: SelectAppearance;
};

type UnifiedSelect = (<ValueType = any, OptionType extends BaseOptionType | DefaultOptionType = DefaultOptionType>(props: SelectProps<ValueType, OptionType> & RefAttributes<RefSelectProps>) => ReactElement) & { displayName?: string };

const sizeMap: Record<SelectSize, "small" | "middle"> = {
    sm: "small",
    md: "middle",
};

export const Select = forwardRef<RefSelectProps, SelectProps>(function Select({ size, ariaLabel, appearance = "pill", className, variant, onMouseDown, onKeyDown, onFocus, onBlur, ...props }, ref) {
    const [inputModality, setInputModality] = useState<"unknown" | "pointer" | "keyboard">("unknown");
    const normalizedSize = size && size in sizeMap ? sizeMap[size as SelectSize] : size;
    return (
        <AntSelect
            ref={ref}
            {...props}
            variant={variant ?? "filled"}
            size={normalizedSize as AntSelectProps["size"]}
            aria-label={ariaLabel}
            className={cn("app-unified-select", `app-unified-select--${appearance}`, className)}
            data-input-modality={inputModality}
            onMouseDown={(event) => {
                setInputModality("pointer");
                onMouseDown?.(event);
            }}
            onKeyDown={(event) => {
                setInputModality("keyboard");
                onKeyDown?.(event);
            }}
            onFocus={(event) => {
                setInputModality((current) => (current === "unknown" ? "keyboard" : current));
                onFocus?.(event);
            }}
            onBlur={(event) => {
                setInputModality("unknown");
                onBlur?.(event);
            }}
        />
    );
}) as UnifiedSelect;

Select.displayName = "UnifiedSelect";
