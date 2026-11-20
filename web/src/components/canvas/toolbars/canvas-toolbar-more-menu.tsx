import { useLayoutEffect, useRef, type MouseEvent } from "react";
import type { FloatingDockCommand } from "@/components/ui/aceternity/floating-dock";

type Props = {
    id: string;
    label: string;
    x: string;
    commands: FloatingDockCommand[];
    destructive: FloatingDockCommand[];
    onChoose: (command: FloatingDockCommand, event: MouseEvent<HTMLButtonElement>) => void;
    onDismiss: () => void;
};

export function CanvasToolbarMoreMenu({ id, label, x, commands, destructive, onChoose, onDismiss }: Props) {
    const menuRef = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
    }, []);
    const item = (command: FloatingDockCommand) => (
        <button key={command.id} type="button" role="menuitem" tabIndex={-1} disabled={command.disabled} data-danger={command.danger || undefined} onClick={(event) => onChoose(command, event)}>
            {command.icon}
            <span>{command.displayLabel ?? command.label}</span>
        </button>
    );
    return (
        <div
            ref={menuRef}
            role="menu"
            id={id}
            aria-label={label}
            className="canvas-toolbar-more-menu"
            style={{ left: x }}
            data-canvas-no-zoom
            data-canvas-wheel-scroll
            onWheel={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onBlur={(event) => {
                if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget) && !(event.relatedTarget instanceof Element && event.relatedTarget.getAttribute("aria-controls") === id)) onDismiss();
            }}
            onKeyDown={(event) => {
                event.stopPropagation();
                if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
                const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
                const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
                buttons[next]?.focus();
            }}
        >
            {commands.map(item)}
            {destructive.length > 0 && (
                <>
                    <div role="separator" />
                    {destructive.map(item)}
                </>
            )}
        </div>
    );
}
