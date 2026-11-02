type Size = { width: number; height: number };

export type PromptTextSelection = { start: number; end: number };

export function insertPromptReferenceAtSelection(value: string, selection: PromptTextSelection, token: string) {
    let start = Math.min(value.length, Math.max(0, Math.min(selection.start, selection.end)));
    let end = Math.min(value.length, Math.max(start, Math.max(selection.start, selection.end)));
    if (start === end) {
        const pendingMention = /(^|\s)@[^\s@，。！？、,.!?;:]*$/u.exec(value.slice(0, start));
        if (pendingMention) {
            start -= pendingMention[0].length - pendingMention[1].length;
        }
    }
    const before = value.slice(0, start);
    const after = value.slice(end);
    const prefix = before && !/\s$/u.test(before) ? " " : "";
    const suffix = after && !/^\s/u.test(after) ? " " : "";
    const insertText = `${prefix}${token}${suffix}`;
    const nextValue = `${before}${insertText}${after}`;
    const caret = before.length + insertText.length;
    return { value: nextValue, selection: { start: caret, end: caret } };
}

export const PROMPT_EDITOR_VIEWPORT_MARGIN = 24;

export function clampPromptEditorModalWidth(width: number, viewportWidth: number) {
    const maxWidth = Math.max(1, viewportWidth - PROMPT_EDITOR_VIEWPORT_MARGIN);
    const minWidth = Math.min(560, maxWidth);
    return Math.min(maxWidth, Math.max(minWidth, Math.round(width)));
}

export function clampPromptEditorModalSize(size: Size, viewport: Size): Size {
    const maxWidth = Math.max(1, viewport.width - PROMPT_EDITOR_VIEWPORT_MARGIN);
    const maxHeight = Math.max(1, viewport.height - PROMPT_EDITOR_VIEWPORT_MARGIN);
    const minWidth = Math.min(560, maxWidth);
    const minHeight = Math.min(320, maxHeight);
    return {
        width: Math.min(maxWidth, Math.max(minWidth, Math.round(size.width))),
        height: Math.min(maxHeight, Math.max(minHeight, Math.round(size.height))),
    };
}
