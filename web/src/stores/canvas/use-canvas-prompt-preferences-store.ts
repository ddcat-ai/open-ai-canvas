import { create } from "zustand";
import { persist } from "zustand/middleware";

export const CANVAS_PROMPT_FONT_SIZES = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20] as const;
export const DEFAULT_CANVAS_PROMPT_FONT_SIZE = 16;

export function normalizeCanvasPromptFontSize(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? Math.min(20, Math.max(10, Math.round(value))) : DEFAULT_CANVAS_PROMPT_FONT_SIZE;
}

type CanvasPromptPreferences = {
    fontSize: number;
    setFontSize: (fontSize: number) => void;
};

export const useCanvasPromptPreferencesStore = create<CanvasPromptPreferences>()(
    persist(
        (set) => ({
            fontSize: DEFAULT_CANVAS_PROMPT_FONT_SIZE,
            setFontSize: (fontSize) => set({ fontSize: normalizeCanvasPromptFontSize(fontSize) }),
        }),
        {
            name: "yingce:canvas-prompt-preferences",
            partialize: ({ fontSize }) => ({ fontSize }),
            merge: (persisted, current) => ({
                ...current,
                fontSize: normalizeCanvasPromptFontSize((persisted as Partial<CanvasPromptPreferences> | null)?.fontSize),
            }),
        },
    ),
);
