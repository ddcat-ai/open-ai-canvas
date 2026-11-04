import { json } from "@codemirror/lang-json";
import { Annotation, Compartment, EditorState, EditorView, Prec, defaultLightThemeOption, getDefaultExtensions, oneDark, type Extension } from "@uiw/react-codemirror";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

import { fileExtension, isMarkdownPath } from "@/lib/skills/skill-workbench-model";
import { translate } from "@/i18n";

export type SkillCodeEditorHandle = {
    focus: () => void;
    /** 文件改名后保留撤销历史、光标与滚动位置。 */
    moveState: (from: string, to: string) => void;
    forget: (path: string) => void;
    forgetAll: () => void;
};

type SkillCodeEditorProps = {
    path: string;
    value: string;
    readOnly: boolean;
    theme: "light" | "dark";
    onChange: (path: string, value: string) => void;
    onCursor: (line: number, column: number) => void;
};

type SavedTab = { state: EditorState; scrollTop: number; scrollLeft: number };

// 外部写回（撤销修改、重新加载）不应再回调 onChange。
const externalChange = Annotation.define<boolean>();

// 工作台配色走产品 token；高优先级覆盖 oneDark/light 主题的底色，语法色仍沿用主题。
const tokenTheme = Prec.highest(
    EditorView.theme({
        "&": { height: "100%", backgroundColor: "var(--skill-wb-editor-bg)", color: "var(--user-ink)" },
        "&.cm-focused": { outline: "none" },
        ".cm-scroller": { fontFamily: "var(--font-mono)", fontSize: "13px", lineHeight: "1.65" },
        ".cm-gutters": { backgroundColor: "var(--skill-wb-editor-bg)", color: "var(--user-ink-soft)", border: "none" },
        ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--user-ink)" },
        ".cm-activeLine": { backgroundColor: "var(--skill-wb-active-line)" },
        ".cm-content": { paddingBlock: "10px" },
        ".cm-lineNumbers .cm-gutterElement": { paddingInline: "12px 10px", minWidth: "44px" },
    }),
);

function themeExtension(theme: "light" | "dark"): Extension {
    return theme === "dark" ? oneDark : defaultLightThemeOption;
}

function editableExtension(readOnly: boolean): Extension {
    return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];
}

function languageExtension(path: string): Extension {
    const extension = fileExtension(path);
    const wrap = isMarkdownPath(path) || extension === "txt" || extension === "";
    return [extension === "json" ? json() : [], wrap ? EditorView.lineWrapping : []];
}

/**
 * 单个 EditorView + 每个标签页一份 EditorState：切换标签保留撤销历史与光标，
 * 主题、只读通过 Compartment 在切换时统一重配，避免旧状态带着过期配置。
 */
export const SkillCodeEditor = forwardRef<SkillCodeEditorHandle, SkillCodeEditorProps>(function SkillCodeEditor({ path, value, readOnly, theme, onChange, onCursor }, ref) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    const tabsRef = useRef(new Map<string, SavedTab>());
    const currentPathRef = useRef(path);
    // 最近一次由编辑器自身发出的文本；父组件回传同一字符串时跳过整篇比较。
    const lastEmittedRef = useRef<string | null>(null);
    const themeCompartment = useRef(new Compartment()).current;
    const editableCompartment = useRef(new Compartment()).current;
    const callbacksRef = useRef({ onChange, onCursor });
    callbacksRef.current = { onChange, onCursor };
    const configRef = useRef({ theme, readOnly });
    configRef.current = { theme, readOnly };

    const reportCursor = (state: EditorState) => {
        const head = state.selection.main.head;
        const line = state.doc.lineAt(head);
        callbacksRef.current.onCursor(line.number, head - line.from + 1);
    };

    const createState = (filePath: string, doc: string) =>
        EditorState.create({
            doc,
            extensions: [
                ...getDefaultExtensions({ theme: "none", indentWithTab: true, basicSetup: { lineNumbers: true, foldGutter: true, highlightActiveLine: true, highlightActiveLineGutter: true, autocompletion: false, tabSize: 2 } }),
                themeCompartment.of(themeExtension(configRef.current.theme)),
                editableCompartment.of(editableExtension(configRef.current.readOnly)),
                languageExtension(filePath),
                tokenTheme,
                EditorView.contentAttributes.of({ "aria-label": translate("library.workbench.editor.editFile", { path: filePath }), spellcheck: "false" }),
                EditorView.updateListener.of((update) => {
                    if (update.docChanged && !update.transactions.some((transaction) => transaction.annotation(externalChange))) {
                        const text = update.state.doc.toString();
                        lastEmittedRef.current = text;
                        callbacksRef.current.onChange(currentPathRef.current, text);
                    }
                    if (update.docChanged || update.selectionSet) reportCursor(update.state);
                }),
            ],
        });

    const syncConfiguration = (view: EditorView) => {
        view.dispatch({ effects: [themeCompartment.reconfigure(themeExtension(configRef.current.theme)), editableCompartment.reconfigure(editableExtension(configRef.current.readOnly))] });
    };

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        const view = new EditorView({ parent: host, state: createState(path, value) });
        viewRef.current = view;
        currentPathRef.current = path;
        reportCursor(view.state);
        return () => {
            view.destroy();
            viewRef.current = null;
        };
        // 视图只创建一次；路径/内容切换在下方 effect 里通过 setState 完成。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const view = viewRef.current;
        if (!view) return;
        const previous = currentPathRef.current;
        if (previous !== path) {
            tabsRef.current.set(previous, { state: view.state, scrollTop: view.scrollDOM.scrollTop, scrollLeft: view.scrollDOM.scrollLeft });
            const saved = tabsRef.current.get(path);
            currentPathRef.current = path;
            lastEmittedRef.current = null;
            view.setState(saved?.state ?? createState(path, value));
            syncConfiguration(view);
            if (saved) {
                const { scrollTop, scrollLeft } = saved;
                requestAnimationFrame(() => {
                    view.scrollDOM.scrollTop = scrollTop;
                    view.scrollDOM.scrollLeft = scrollLeft;
                });
            }
            reportCursor(view.state);
        }
        // 外部改写当前文件内容（撤销修改 / 保存后重载）时替换文档但不触发 onChange。
        if (value !== lastEmittedRef.current && view.state.doc.toString() !== value) {
            view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value }, annotations: externalChange.of(true) });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [path, value]);

    useEffect(() => {
        const view = viewRef.current;
        if (view) syncConfiguration(view);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [theme, readOnly]);

    useImperativeHandle(
        ref,
        () => ({
            focus() {
                viewRef.current?.focus();
            },
            moveState(from, to) {
                if (currentPathRef.current === from) currentPathRef.current = to;
                const saved = tabsRef.current.get(from);
                if (!saved) return;
                tabsRef.current.delete(from);
                tabsRef.current.set(to, saved);
            },
            forget(filePath) {
                tabsRef.current.delete(filePath);
            },
            forgetAll() {
                tabsRef.current.clear();
            },
        }),
        [],
    );

    return <div ref={hostRef} className="skill-wb-code" />;
});
