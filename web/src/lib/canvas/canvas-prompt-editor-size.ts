type Size = { width: number; height: number };

export const PROMPT_EDITOR_VIEWPORT_MARGIN = 24;

export function clampPromptEditorModalSize(size: Size, viewport: Size): Size {
    const maxWidth = Math.max(1, viewport.width - PROMPT_EDITOR_VIEWPORT_MARGIN);
    const maxHeight = Math.max(1, viewport.height - PROMPT_EDITOR_VIEWPORT_MARGIN);
    return {
        width: Math.min(maxWidth, Math.max(560, Math.round(size.width))),
        height: Math.min(maxHeight, Math.max(320, Math.round(size.height))),
    };
}
