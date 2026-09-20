import { Button, Checkbox as AntCheckbox, Segmented, Select as AntSelect, Switch as AntSwitch, Tooltip as AntTooltip } from "antd";
import type { CheckboxChangeEvent } from "antd/es/checkbox";
import type { ButtonProps } from "antd";
import type { LucideIcon } from "lucide-react";
import type { CSSProperties, InputHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

export function AdminSwitch({
    size = "md",
    className,
    ...props
}: {
    checked?: boolean;
    defaultChecked?: boolean;
    disabled?: boolean;
    loading?: boolean;
    size?: "sm" | "md";
    checkedChildren?: ReactNode;
    unCheckedChildren?: ReactNode;
    onChange?: (checked: boolean) => void;
    className?: string;
    "aria-label"?: string;
}) {
    return (
        <AntSwitch
            {...props}
            size={size === "sm" ? "small" : "default"}
            className={cn("admin-switch", className)}
            onChange={(checked) => props.onChange?.(checked)}
        />
    );
}

export function Switch(props: Parameters<typeof AdminSwitch>[0]) {
    return <AdminSwitch {...props} />;
}

export function AdminSelect<V extends string = string>({
    size = "md",
    ariaLabel,
    className,
    onChange,
    ...props
}: {
    value?: V;
    onChange?: (value: V) => void;
    options?: Array<{ value: V; label: ReactNode; disabled?: boolean; title?: string }>;
    placeholder?: string;
    disabled?: boolean;
    allowClear?: boolean;
    size?: "sm" | "md";
    ariaLabel?: string;
    className?: string;
}) {
    return (
        <AntSelect
            {...props}
            size={size === "sm" ? "small" : "middle"}
            className={cn("admin-select", className)}
            aria-label={ariaLabel}
            onChange={(value) => onChange?.(value as V)}
        />
    );
}

export function Select<V extends string = string>(props: Parameters<typeof AdminSelect<V>>[0]) {
    return <AdminSelect<V> {...props} />;
}

export function AdminCheckbox({
    bare,
    size,
    children,
    className,
    onChange,
    ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "onChange"> & {
    size?: "sm" | "md";
    indeterminate?: boolean;
    bare?: boolean;
    children?: ReactNode;
    onChange?: (event: CheckboxChangeEvent) => void;
}) {
    return (
        <AntCheckbox className={cn("admin-checkbox", size === "sm" && "is-sm", className)} onChange={onChange} {...props}>
            {bare ? null : children}
        </AntCheckbox>
    );
}

export function Checkbox(props: Parameters<typeof AdminCheckbox>[0]) {
    return <AdminCheckbox {...props} />;
}

export function AdminTooltip({ title, placement = "top", delay = 80, children }: { title?: ReactNode; placement?: "top" | "right" | "bottom" | "left"; delay?: number; children: ReactNode }) {
    if (!title) return <>{children}</>;
    return (
        <AntTooltip title={title} placement={placement} mouseEnterDelay={delay / 1000}>
            <span className="inline-flex">{children}</span>
        </AntTooltip>
    );
}

export function Tooltip(props: Parameters<typeof AdminTooltip>[0]) {
    return <AdminTooltip {...props} />;
}

export function AdminIconButton({
    icon: Icon,
    size = "sm",
    className,
    variant: _variant,
    ...props
}: {
    icon: LucideIcon;
    size?: "sm" | "md";
    variant?: "ghost" | "default";
    className?: string;
    disabled?: boolean;
    loading?: boolean;
    title?: string;
    "aria-label"?: string;
    onClick?: ButtonProps["onClick"];
}) {
    return <Button type="text" size="small" className={cn("admin-icon-button", className)} icon={<Icon className={size === "sm" ? "size-3.5" : "size-4"} />} {...props} />;
}

export function IconButton(props: Parameters<typeof AdminIconButton>[0]) {
    return <AdminIconButton {...props} />;
}

export function AdminSegmented<V extends string = string>({
    value,
    onChange,
    options,
    ariaLabel,
    className,
}: {
    value?: V;
    onChange?: (value: V) => void;
    options: Array<{ value: V; label?: ReactNode; icon?: ReactNode; disabled?: boolean }>;
    ariaLabel?: string;
    className?: string;
}) {
    return (
        <Segmented
            className={cn("admin-segmented", className)}
            value={value}
            options={options.map((option) => ({ ...option, label: option.label ?? option.value }))}
            onChange={(next) => onChange?.(String(next) as V)}
            aria-label={ariaLabel}
        />
    );
}

export function SegmentedControl<V extends string = string>(props: Parameters<typeof AdminSegmented<V>>[0]) {
    return <AdminSegmented<V> {...props} />;
}

export function AdminCallout({
    tone = "info",
    title,
    action,
    className,
    children,
    style,
}: {
    tone?: "info" | "success" | "warning" | "error" | "default";
    title?: ReactNode;
    action?: ReactNode;
    className?: string;
    children?: ReactNode;
    style?: CSSProperties;
}) {
    const resolvedTone = tone === "default" ? "info" : tone;
    return (
        <div className={cn("admin-callout", `is-${resolvedTone}`, className)} style={style} role="status">
            <div className="min-w-0 flex-1">
                {title ? <div className="admin-callout-title">{title}</div> : null}
                {children ? <div className="admin-callout-body">{children}</div> : null}
            </div>
            {action}
        </div>
    );
}

export function Callout(props: Parameters<typeof AdminCallout>[0]) {
    return <AdminCallout {...props} />;
}
