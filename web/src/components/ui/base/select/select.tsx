import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Button as AriaButton, ListBox as AriaListBox, ListBoxItem as AriaListBoxItem, Popover as AriaPopover, Select as AriaSelect } from "react-aria-components";
import { Check, ChevronDown, X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Select — 下拉选择（自研，react-aria-components 单选壳，无远程/多选）。
 *
 * - API 对齐 AntD Select 的单选子集：value/onChange(options 值)/options/placeholder/
 *   disabled/allowClear/size/className，可直接替换纯单选场景；可直接置于 antd Form.Item。
 * - 浮层定位、进出场、焦点与类型选择由 RAC 承担（ADR-0008：复杂控件以 RAC 为无障碍地基）。
 * - Popover isNonModal：避免 RAC modal 滚动锁把页面滚动条锁死（同 boardui 注释）；
 *   isDismissable 与 isNonModal 互斥，故外部 dismiss 手动处理（全局 pointerdown capture）。
 * - 样式只吃语义 token：trigger border-border/bg-background/hover:border-foreground/40、
 *   popover bg-surface-strong + hairline、item hover:bg-surface-hover、选中 Check 前景色，无裸色。
 * - 范围外（本批不做，后续补）：mode="multiple"/"tags"、showSearch（需 ComboBox）、
 *   loading、labelInValue、maxCount、suffixIcon。
 * 对标：AntD Select（单选）；boardui base/select。
 */

export type SelectSize = "sm" | "md";

export interface SelectOption<V extends string = string> {
    value: V;
    label: ReactNode;
    disabled?: boolean;
    /** 原生 title */
    title?: string;
}

export interface SelectProps<V extends string = string> {
    value?: V;
    onChange?: (value: V) => void;
    options?: Array<SelectOption<V>>;
    placeholder?: string;
    disabled?: boolean;
    allowClear?: boolean;
    size?: SelectSize;
    ariaLabel?: string;
    className?: string;
}

const TRIGGER_CLASS: Record<SelectSize, string> = {
    sm: "h-7 text-xs",
    md: "h-8 text-sm",
};

export function Select<V extends string = string>({ value, onChange, options = [], placeholder, disabled = false, allowClear = false, size = "md", ariaLabel, className }: SelectProps<V>) {
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const popoverRef = useRef<HTMLDivElement | null>(null);
    const [open, setOpen] = useState(false);
    const [popoverWidth, setPopoverWidth] = useState<number | null>(null);

    useLayoutEffect(() => {
        const measure = () => {
            const width = triggerRef.current?.offsetWidth;
            if (width) setPopoverWidth(width + 2);
        };
        measure();
        const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
        if (observer && triggerRef.current) observer.observe(triggerRef.current);
        return () => observer?.disconnect();
    }, [open]);

    useLayoutEffect(() => {
        if (!open) return;
        const onPointerDown = (event: PointerEvent) => {
            const target = event.target as Node;
            const insideTrigger = triggerRef.current?.contains(target);
            const insidePopover = popoverRef.current?.contains(target);
            if (!insideTrigger && !insidePopover) setOpen(false);
        };
        window.addEventListener("pointerdown", onPointerDown, true);
        return () => window.removeEventListener("pointerdown", onPointerDown, true);
    }, [open]);

    const selected = options.find((option) => option.value === value);
    const displayLabel = selected?.label ?? value;

    const clear = () => {
        setOpen(false);
        onChange?.(undefined as unknown as V);
    };

    return (
        <AriaSelect
            isDisabled={disabled}
            isOpen={open}
            onOpenChange={setOpen}
            selectedKey={value ?? undefined}
            onSelectionChange={(key) => {
                setOpen(false);
                if (key != null) onChange?.(key as V);
            }}
            aria-label={ariaLabel}
            className={cn("inline-flex w-full", className)}
        >
            <AriaButton
                ref={triggerRef}
                className={cn(
                    "flex w-full cursor-pointer items-center justify-between gap-1.5 rounded-md border border-border bg-background px-2.5 font-normal text-foreground outline-none transition-colors motion-reduce:transition-none",
                    "hover:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                    "disabled:cursor-not-allowed disabled:opacity-55",
                    open && "border-foreground/60",
                    TRIGGER_CLASS[size],
                )}
            >
                <span className={cn("min-w-0 flex-1 truncate text-left", displayLabel === undefined && "text-muted-foreground")}>{displayLabel === undefined ? placeholder : displayLabel}</span>
                {allowClear && value !== undefined && !disabled && (
                    <span
                        role="button"
                        tabIndex={-1}
                        aria-label="清空选择"
                        className="shrink-0 cursor-pointer rounded p-0.5 text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                            event.stopPropagation();
                            clear();
                        }}
                    >
                        <X className="size-3.5" />
                    </span>
                )}
                <ChevronDown aria-hidden="true" className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none", open && "rotate-180")} />
            </AriaButton>
            <AriaPopover ref={popoverRef} isNonModal placement="bottom" offset={4} style={popoverWidth ? { width: popoverWidth } : undefined} className={cn("z-50 rounded-lg border border-border bg-surface-strong p-1 shadow-lg", "ra-pop-in")}>
                <AriaListBox aria-label={ariaLabel ?? placeholder ?? "选项"} className="max-h-60 overflow-auto outline-none">
                    {options.map((option) => (
                        <AriaListBoxItem
                            key={option.value}
                            id={option.value}
                            textValue={typeof option.label === "string" ? option.label : option.value}
                            isDisabled={option.disabled}
                            className={({ isFocused, isSelected, isDisabled: itemDisabled }) =>
                                cn(
                                    "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none transition-colors motion-reduce:transition-none",
                                    "focus-visible:bg-surface-hover",
                                    (isFocused || isSelected) && "bg-surface-hover",
                                    isSelected ? "font-medium text-foreground" : "text-muted-foreground",
                                    itemDisabled && "cursor-not-allowed opacity-50",
                                )
                            }
                        >
                            {({ isSelected }) => (
                                <>
                                    <span className={cn("min-w-0 flex-1 truncate")} title={option.title}>
                                        {option.label}
                                    </span>
                                    {isSelected && <Check className="size-3.5 shrink-0 text-foreground" />}
                                </>
                            )}
                        </AriaListBoxItem>
                    ))}
                </AriaListBox>
            </AriaPopover>
        </AriaSelect>
    );
}
