// 节点提示词编辑器的高度拖拽与展开弹窗尺寸控制。

import { type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, useRef } from "react";
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
    const dragRef = useRef<{ pointerId: number; startX: number; startY: number; width: number; height: number } | null>(null);

    const finishResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
        if (dragRef.current?.pointerId !== event.pointerId) return;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        dragRef.current = null;
    };

    const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
        const step = event.shiftKey ? 40 : 12;
        const widthDelta = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
        const heightDelta = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
        if (!widthDelta && !heightDelta) return;
        event.preventDefault();
        event.stopPropagation();
        const base = size ?? measure();
        onResize(clampExpandedModalSize({ width: base.width + widthDelta, height: base.height + heightDelta }));
    };

    return (
        <button
            type="button"
            className="absolute bottom-1.5 right-1.5 z-10 grid size-5 cursor-nwse-resize touch-none place-items-center opacity-60 transition-opacity hover:opacity-100 focus-visible:outline focus-visible:outline-2"
            aria-label="拖动调整窗口大小"
            title="拖动调整窗口宽高，也可用方向键调整"
            onKeyDown={handleKeyDown}
            onPointerDown={(event) => {
                if (event.button !== 0 || !event.isPrimary) return;
                event.preventDefault();
                event.stopPropagation();
                const base = measure();
                dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, ...base };
                onResize(clampExpandedModalSize(base));
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
                event.stopPropagation();
                // The modal stays centered, so each edge moves by half the size change.
                onResize(clampExpandedModalSize({ width: drag.width + 2 * (event.clientX - drag.startX), height: drag.height + 2 * (event.clientY - drag.startY) }));
            }}
            onPointerUp={finishResize}
            onPointerCancel={finishResize}
            onLostPointerCapture={(event) => {
                if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
            }}
        >
            <span aria-hidden className="absolute bottom-1 right-1 size-2 rounded-br border-b-2 border-r-2" style={{ borderColor: accent }} />
        </button>
    );
}

export function promptEditorBounds(expanded: boolean, hasReferences: boolean) {
    const shelfHeight = hasReferences ? PROMPT_REFERENCE_SHELF_HEIGHT : 0;
    const min = (expanded ? PROMPT_EDITOR_EXPANDED_MIN_HEIGHT : PROMPT_EDITOR_MIN_HEIGHT) + shelfHeight;
    const max = (expanded ? PROMPT_EDITOR_EXPANDED_LINE_HEIGHT * PROMPT_EDITOR_EXPANDED_MAX_LINES + PROMPT_EDITOR_EXPANDED_VERTICAL_PADDING : PROMPT_EDITOR_LINE_HEIGHT * PROMPT_EDITOR_MAX_LINES + PROMPT_EDITOR_VERTICAL_PADDING) + shelfHeight;
    return { min, max };
}

export function estimatePromptContentHeight(value: string, expanded: boolean) {
    if (!value.trim()) return expanded ? PROMPT_EDITOR_EXPANDED_MIN_HEIGHT : PROMPT_EDITOR_MIN_HEIGHT;
    const charsPerLine = expanded ? 34 : 38;
    const lineCount = value.split("\n").reduce((total, line) => total + Math.max(1, Math.ceil(Array.from(line).length / charsPerLine)), 0);
    const lineHeight = expanded ? PROMPT_EDITOR_EXPANDED_LINE_HEIGHT : PROMPT_EDITOR_LINE_HEIGHT;
    const verticalPadding = expanded ? PROMPT_EDITOR_EXPANDED_VERTICAL_PADDING : PROMPT_EDITOR_VERTICAL_PADDING;
    return Math.max(expanded ? PROMPT_EDITOR_EXPANDED_MIN_HEIGHT : PROMPT_EDITOR_MIN_HEIGHT, lineCount * lineHeight + verticalPadding);
}

export function clampPromptHeight(height: number, bounds: { min: number; max: number }) {
    return Math.min(bounds.max, Math.max(bounds.min, height));
}
