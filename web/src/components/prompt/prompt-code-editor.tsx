import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { forwardRef, useImperativeHandle, useRef } from "react";

import { cn } from "@/lib/utils";
import { useThemeStore } from "@/stores/use-theme-store";

export type PromptCodeEditorHandle = {
    insertText: (text: string) => void;
    focus: () => void;
};

type PromptCodeEditorProps = {
    value: string;
    onChange?: (value: string) => void;
    readOnly?: boolean;
    ariaLabel: string;
    className?: string;
};

export const PromptCodeEditor = forwardRef<PromptCodeEditorHandle, PromptCodeEditorProps>(function PromptCodeEditor({ value, onChange, readOnly = false, ariaLabel, className }, ref) {
    const theme = useThemeStore((state) => state.theme);
    const viewRef = useRef<EditorView | null>(null);

    useImperativeHandle(ref, () => ({
        insertText(text) {
            const view = viewRef.current;
            if (!view || readOnly) return;
            const selection = view.state.selection.main;
            view.dispatch({
                changes: { from: selection.from, to: selection.to, insert: text },
                selection: { anchor: selection.from + text.length },
            });
            view.focus();
        },
        focus() {
            viewRef.current?.focus();
        },
    }), [readOnly]);

    return (
        <CodeMirror
            className={cn("prompt-code-editor h-full min-h-0", className)}
            value={value}
            height="100%"
            theme={theme}
            readOnly={readOnly}
            editable={!readOnly}
            extensions={[EditorView.lineWrapping]}
            basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: !readOnly, highlightActiveLineGutter: !readOnly }}
            aria-label={ariaLabel}
            onCreateEditor={(view) => { viewRef.current = view; }}
            onChange={onChange}
        />
    );
});
