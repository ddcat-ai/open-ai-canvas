// 节点提示词编辑器的高度拖拽与展开弹窗尺寸控制。

import { type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, useRef } from "react";
import { clampPromptEditorModalSize } from "@/lib/canvas/canvas-prompt-editor-size";
import {
    PROMPT_EDITOR_EXPANDED_LINE_HEIGHT,
    PROMPT_EDITOR_EXPANDED_MAX_LINES,
    PROMPT_EDITOR_EXPANDED_MIN_HEIGHT,
    PROMPT_EDITOR_EXPANDED_VERTICAL_PADDING,
    PROMPT_EDITOR_LINE_HEIGHT,
    PROMPT_EDITOR_MAX_LINES,
    PROMPT_EDITOR_MIN_HEIGHT,
    PROMPT_EDITOR_VERTICAL_PADDING,
    PROMPT_REFERENCE_SHELF_HEIGHT,
} from "./canvas-node-prompt-panel";

export function PromptResizeHandle({ height, min, max, onResize }: { height: number; min: number; max: number; onResize: (height: number) => void }) {
    const dragRef = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null);

    const finishResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
        if (dragRef.current?.pointerId !== event.pointerId) return;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        dragRef.current = null;
    };

    const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
        if (event.key === "ArrowUp") {
            event.preventDefault();
            onResize(Math.max(min, height - 8));
        } else if (event.key === "ArrowDown") {
            event.preventDefault();
            onResize(Math.min(max, height + 8));
        } else if (event.key === "Home") {
            event.preventDefault();
            onResize(min);
        } else if (event.key === "End") {
            event.preventDefault();
            onResize(max);
        }
    };

    return (
        <button
            type="button"
            className="canvas-node-composer-resize-handle"
            role="separator"
            aria-label="调整提示词输入高度"
            aria-orientation="horizontal"
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={Math.round(height)}
            onKeyDown={handleKeyDown}
            onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.stopPropagation();
                dragRef.current = { pointerId: event.pointerId, startY: event.clientY, startHeight: height };
                event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
                const drag = dragRef.current;
                if (!drag || drag.pointerId !== event.pointerId) return;
                if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
                    dragRef.current = null;
                    return;
                }
                if ((event.buttons & 1) === 0) {
                    finishResize(event);
                    return;
                }
                onResize(Math.min(max, Math.max(min, drag.startHeight + event.clientY - drag.startY)));
            }}
            onPointerUp={finishResize}
            onPointerCancel={finishResize}
            onLostPointerCapture={(event) => {
                if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
            }}
        >
            <span aria-hidden />
        </button>
    );
}

export function clampExpandedModalSize(size: { width: number; height: number }) {
    return clampPromptEditorModalSize(size, { width: window.innerWidth, height: window.innerHeight });
}

export function PromptModalResizeHandle({
    size,
    measure,
    onResize,
    accent,
}: {
    size: { width: number; height: number } | null;
    measure: () => { width: number; height: number };
    onResize: (size: { width: number; height: number }) => void;
    accent: string;
}) {
    const dragRef = useRef<{ pointerId: number; axis: "width" | "height"; start: number; size: { width: number; height: number } } | null>(null);

    const finishResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
        if (dragRef.current?.pointerId !== event.pointerId) return;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        dragRef.current = null;
    };

    const resizeKey = (axis: "width" | "height", event: ReactKeyboardEvent<HTMLButtonElement>) => {
        const negative = axis === "width" ? event.key === "ArrowLeft" : event.key === "ArrowUp";
        const positive = axis === "width" ? event.key === "ArrowRight" : event.key === "ArrowDown";
        if (!negative && !positive) return;
        event.preventDefault();
        event.stopPropagation();
        const base = size ?? measure();
        const step = event.shiftKey ? 80 : 24;
        onResize(clampExpandedModalSize({ ...base, [axis]: base[axis] + (positive ? step : -step) }));
    };

    const startResize = (axis: "width" | "height", event: ReactPointerEvent<HTMLButtonElement>) => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault();
        event.stopPropagation();
        const base = size ?? measure();
        dragRef.current = { pointerId: event.pointerId, axis, start: axis === "width" ? event.clientX : event.clientY, size: base };
        onResize(clampExpandedModalSize(base));
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const moveResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
            dragRef.current = null;
            return;
        }
        if ((event.buttons & 1) === 0) {
            finishResize(event);
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const pointer = drag.axis === "width" ? event.clientX : event.clientY;
        const dimension = drag.axis === "width" ? "width" : "height";
        onResize(clampExpandedModalSize({ ...drag.size, [dimension]: drag.size[dimension] + 2 * (pointer - drag.start) }));
    };

    const trackPointer = {
        onPointerMove: moveResize,
        onPointerUp: finishResize,
        onPointerCancel: finishResize,
        onLostPointerCapture: (event: ReactPointerEvent<HTMLButtonElement>) => {
            if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
        },
    };

    return (
        <>
            <button
                type="button"
                className="canvas-prompt-modal-resize-width"
                role="separator"
                aria-orientation="vertical"
                aria-label="拖动调整提示词窗口宽度"
                title="拖动调整窗口宽度，也可用左右方向键调整"
                style={{ "--prompt-resize-accent": accent } as CSSProperties}
                onKeyDown={(event) => resizeKey("width", event)}
                onPointerDown={(event) => startResize("width", event)}
                {...trackPointer}
            >
                <span aria-hidden />
            </button>
            <button
                type="button"
                className="canvas-prompt-modal-resize-height"
                role="separator"
                aria-orientation="horizontal"
                aria-label="拖动调整提示词窗口高度"
                title="拖动调整窗口高度，也可用上下方向键调整"
                style={{ "--prompt-resize-accent": accent } as CSSProperties}
                onKeyDown={(event) => resizeKey("height", event)}
                onPointerDown={(event) => startResize("height", event)}
                {...trackPointer}
            >
                <span aria-hidden />
            </button>
        </>
    );
}

export function promptEditorBounds(expanded: boolean, hasReferences: boolean, fontSize = 16) {
    const shelfHeight = hasReferences ? PROMPT_REFERENCE_SHELF_HEIGHT : 0;
    const min = (expanded ? PROMPT_EDITOR_EXPANDED_MIN_HEIGHT : PROMPT_EDITOR_MIN_HEIGHT) + shelfHeight;
    const lineHeight = Math.ceil(fontSize * 1.6);
    const max = Math.max(min, (expanded ? lineHeight * PROMPT_EDITOR_EXPANDED_MAX_LINES + PROMPT_EDITOR_EXPANDED_VERTICAL_PADDING : lineHeight * PROMPT_EDITOR_MAX_LINES + PROMPT_EDITOR_VERTICAL_PADDING) + shelfHeight);
    return { min, max };
}

export function estimatePromptContentHeight(value: string, expanded: boolean, fontSize = 16) {
    if (!value.trim()) return expanded ? PROMPT_EDITOR_EXPANDED_MIN_HEIGHT : PROMPT_EDITOR_MIN_HEIGHT;
    const charsPerLine = Math.max(1, Math.floor(((expanded ? 34 : 38) * 16) / fontSize));
    const lineCount = value.split("\n").reduce((total, line) => total + Math.max(1, Math.ceil(Array.from(line).length / charsPerLine)), 0);
    const lineHeight = fontSize === 16 ? (expanded ? PROMPT_EDITOR_EXPANDED_LINE_HEIGHT : PROMPT_EDITOR_LINE_HEIGHT) : Math.ceil(fontSize * 1.6);
    const verticalPadding = expanded ? PROMPT_EDITOR_EXPANDED_VERTICAL_PADDING : PROMPT_EDITOR_VERTICAL_PADDING;
    return Math.max(expanded ? PROMPT_EDITOR_EXPANDED_MIN_HEIGHT : PROMPT_EDITOR_MIN_HEIGHT, lineCount * lineHeight + verticalPadding);
}

export function clampPromptHeight(height: number, bounds: { min: number; max: number }) {
    return Math.min(bounds.max, Math.max(bounds.min, height));
}
