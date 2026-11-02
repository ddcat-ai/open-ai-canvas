import { Type } from "lucide-react";
import { useCanvasPromptPreferencesStore } from "@/stores/canvas/use-canvas-prompt-preferences-store";

export function CanvasPromptFontSizeControl() {
    const fontSize = useCanvasPromptPreferencesStore((state) => state.fontSize);
    const setFontSize = useCanvasPromptPreferencesStore((state) => state.setFontSize);
    return (
        <label
            className="flex h-7 shrink-0 items-center gap-2 px-2 text-xs"
            data-canvas-no-drag
            data-canvas-no-zoom
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            title="拖动调整提示词字号，自动记住本机偏好"
        >
            <Type className="size-4" aria-hidden="true" />
            <input type="range" min={10} max={20} step={1} value={fontSize} onChange={(event) => setFontSize(Number(event.currentTarget.value))} aria-label="提示词字号" aria-valuetext={`${fontSize} 像素`} className="w-20 cursor-ew-resize" />
            <span className="w-8 tabular-nums">{fontSize}px</span>
        </label>
    );
}
