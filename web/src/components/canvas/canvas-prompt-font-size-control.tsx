import { Type } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCanvasPromptPreferencesStore } from "@/stores/canvas/use-canvas-prompt-preferences-store";

export function CanvasPromptFontSizeControl() {
    const { t } = useTranslation();
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
            title={t("canvasB.promptFontSize.title")}
        >
            <Type className="size-4" aria-hidden="true" />
            <input
                type="range"
                min={10}
                max={20}
                step={1}
                value={fontSize}
                onChange={(event) => setFontSize(Number(event.currentTarget.value))}
                aria-label={t("canvasB.promptFontSize.label")}
                aria-valuetext={t("canvasB.promptFontSize.valueText", { size: fontSize })}
                className="w-20 cursor-ew-resize"
            />
            <span className="w-8 tabular-nums">{fontSize}px</span>
        </label>
    );
}
