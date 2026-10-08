import { useId, useState, type ReactNode } from "react";
import { Button, Popover } from "antd";
import { Settings2 } from "lucide-react";
import { canvasThemes } from "@/lib/canvas-theme";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";

export type CanvasSettingsPlacement = "topLeft" | "top" | "topRight" | "bottomLeft" | "bottom" | "bottomRight";
type SettingsPopoverProps = {
    label: string;
    summary: string;
    children: ReactNode;
    placement?: CanvasSettingsPlacement;
    buttonClassName?: string;
    width?: number;
    onOpenChange?: (open: boolean) => void;
    getPopupContainer?: (trigger: HTMLElement) => HTMLElement;
    autoAdjustOverflow?: boolean;
};

export function CanvasSettingsPopover({ label, summary, children, placement = "topLeft", buttonClassName, width = 356, onOpenChange, getPopupContainer, autoAdjustOverflow = true }: SettingsPopoverProps) {
    const [open, setOpen] = useState(false);
    const id = useId();
    const theme = canvasThemes[useActiveTheme()];
    const change = (next: boolean) => {
        setOpen(next);
        onOpenChange?.(next);
    };
    return (
        <Popover
            open={open}
            onOpenChange={change}
            trigger="click"
            placement={placement}
            getPopupContainer={getPopupContainer}
            autoAdjustOverflow={autoAdjustOverflow}
            arrow={false}
            destroyOnHidden
            styles={{ root: { zIndex: "var(--z-dialog-popover)" }, container: { background: theme.canvas.background, color: theme.node.text, padding: 12 } }}
            content={
                <section
                    id={id}
                    aria-label={label}
                    data-canvas-no-zoom
                    data-canvas-wheel-scroll
                    className="canvas-image-settings-popover overflow-y-auto overscroll-contain"
                    style={{ width: `min(${width}px, calc(100vw - 48px))`, maxHeight: "min(560px, calc(100dvh - 100px))" }}
                    onPointerDown={(event) => event.stopPropagation()}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === "Escape") change(false);
                    }}
                >
                    {children}
                </section>
            }
        >
            <Button
                type="text"
                size="small"
                aria-expanded={open}
                aria-controls={open ? id : undefined}
                aria-label={`${label}：${summary}`}
                title={`${label} · ${summary}`}
                className={`canvas-generation-settings-trigger ${buttonClassName || "!h-8 !max-w-[180px] !justify-start !rounded-full !px-2.5"}`}
                style={{ background: theme.node.fill, color: theme.node.text }}
                icon={<Settings2 className="size-3.5" />}
            >
                <span className="truncate">{summary}</span>
            </Button>
        </Popover>
    );
}
