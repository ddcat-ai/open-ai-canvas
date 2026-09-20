import { useState } from "react";
import { ChevronRight } from "lucide-react";

import { CANVAS_GRID_SPLIT_MAX, CANVAS_GRID_SPLIT_PRESETS, clampGridSplitSize, isValidGridSplit } from "@/lib/canvas/canvas-grid-split";
import type { ImageSplitParams } from "@/lib/canvas/canvas-image-data";

import "./canvas-grid-split-picker.css";

function MiniGridIcon({ n }: { n: number }) {
    return (
        <span className="canvas-grid-split-mini" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }} aria-hidden>
            {Array.from({ length: n * n }, (_, index) => <span key={index} />)}
        </span>
    );
}

export function CanvasGridSplitPicker({ onPick }: { onPick: (params: ImageSplitParams) => void }) {
    const [customOpen, setCustomOpen] = useState(false);
    const [hoverRows, setHoverRows] = useState(2);
    const [hoverCols, setHoverCols] = useState(2);

    const pick = (rows: number, columns: number) => {
        const params = { rows: clampGridSplitSize(rows), columns: clampGridSplitSize(columns) };
        if (!isValidGridSplit(params)) return;
        onPick(params);
    };

    return (
        <div
            className="canvas-grid-split-picker"
            data-canvas-no-zoom
            role="dialog"
            aria-label="宫格切分"
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
        >
            <div className="canvas-grid-split-presets">
                {CANVAS_GRID_SPLIT_PRESETS.map((preset) => (
                    <button key={preset.label} type="button" className="canvas-grid-split-item" onMouseDown={(event) => event.preventDefault()} onClick={() => pick(preset.rows, preset.columns)}>
                        <span className="canvas-grid-split-icon"><MiniGridIcon n={preset.rows} /></span>
                        <span className="canvas-grid-split-item-label">{preset.label}</span>
                    </button>
                ))}
                <button
                    type="button"
                    className={`canvas-grid-split-item${customOpen ? " is-active" : ""}`}
                    aria-expanded={customOpen}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setCustomOpen((current) => !current);
                    }}
                >
                    <span className="canvas-grid-split-icon"><MiniGridIcon n={3} /></span>
                    <span className="canvas-grid-split-item-label">自定义</span>
                    <ChevronRight className="canvas-grid-split-chevron" strokeWidth={2} />
                </button>
            </div>
            {customOpen ? (
                <div className="canvas-grid-split-custom">
                    <div className="canvas-grid-split-custom-head">
                        <span>自定义宫格</span>
                        <span className="canvas-grid-split-custom-size">{hoverCols} × {hoverRows}</span>
                    </div>
                    <div
                        className="canvas-grid-split-board"
                        style={{ gridTemplateColumns: `repeat(${CANVAS_GRID_SPLIT_MAX}, minmax(0, 1fr))` }}
                        onPointerLeave={() => {
                            setHoverRows(2);
                            setHoverCols(2);
                        }}
                    >
                        {Array.from({ length: CANVAS_GRID_SPLIT_MAX * CANVAS_GRID_SPLIT_MAX }, (_, index) => {
                            const row = Math.floor(index / CANVAS_GRID_SPLIT_MAX) + 1;
                            const col = (index % CANVAS_GRID_SPLIT_MAX) + 1;
                            const active = row <= hoverRows && col <= hoverCols;
                            return (
                                <button
                                    key={`${row}-${col}`}
                                    type="button"
                                    className={`canvas-grid-split-cell${active ? " is-active" : ""}`}
                                    aria-label={`${col} × ${row}`}
                                    onMouseDown={(event) => event.preventDefault()}
                                    onPointerEnter={() => {
                                        setHoverRows(row);
                                        setHoverCols(col);
                                    }}
                                    onClick={() => pick(row, col)}
                                />
                            );
                        })}
                    </div>
                </div>
            ) : null}
        </div>
    );
}
