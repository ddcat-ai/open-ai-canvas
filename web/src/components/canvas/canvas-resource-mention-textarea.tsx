import { forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ClipboardEvent, DragEvent, KeyboardEvent, TextareaHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { observeMovablePopupAnchor } from "@/lib/movable-popup-anchor";

import { canvasThemes } from "@/lib/canvas-theme";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { buildAssetMentionReferences, canvasResourceMentionToken, findCanvasResourceAutoLinkMatch, type CanvasResourceAutoLinkMatch, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { useAssetStore } from "@/stores/use-asset-store";
import { useResolvedCanvasResourceReferences } from "./use-resolved-canvas-resource-references";
import { InlineReferencePreview, referencePreviewUrl, syncInlineMentionPreviews } from "./canvas-mention-chips";
import { MentionMenu, clamp, mentionCaretRect } from "./canvas-mention-menu";
import { MentionHoverPreview, useMentionHoverPreview } from "./canvas-mention-hover-preview";
import {
    editableMentionTokenEndingAt,
    getEditableSelection,
    hasMentionTokenBoundary,
    redrawEditableParts,
    renderEditableContent,
    repairEditableMentionBoundaries,
    serializeEditableSelection,
    serializeEditableValue,
    setEditableSelection,
    splitMentionText,
    staleEditableMentionParts,
} from "./canvas-mention-editable";
import { mapCanvasTextOffset, mergeCanvasText } from "@/lib/canvas/canvas-text-merge";
import { insertPromptReferenceAtSelection } from "@/lib/canvas/canvas-prompt-editor-size";
import { observeCanvasEditorWheelZoom } from "@/lib/canvas/canvas-wheel-intent";

export { TOOL_ICON_MAP } from "./canvas-mention-chips";

type MentionState = {
    start: number;
    end: number;
    query: string;
};

export type EditableSelection = {
    start: number;
    end: number;
};

export type MentionTextPart =
    | {
          type: "text";
          text: string;
      }
    | {
          type: "mention";
          token: string;
          reference: CanvasResourceReference;
      };

export type CanvasResourceMentionTextareaActions = {
    insertTextAtSelection: (text: string) => boolean;
};

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "onSubmit" | "value"> & {
    value: string;
    references: CanvasResourceReference[];
    /** 页面外部入口（如参考图货架）按当前光标/选区插入文本。 */
    actionsRef?: { current: CanvasResourceMentionTextareaActions | null };
    onSelectReference?: (reference: CanvasResourceReference) => CanvasResourceReference | undefined;
    onChange: (value: string) => boolean | void;
    /** modifier：本次是 ⌘/Ctrl+Enter 触发（调用方可据此区分主次动作，例如 Agent 运行中的排队与插话）。 */
    onSubmit?: (event: { modifier: boolean }) => void;
    containerClassName?: string;
    highlightLabels?: boolean;
    mentionMenuWidth?: number;
    sendOnEnter?: boolean | "both";
    onContentSizeChange?: (height: number) => void;
    includeAssetLibrary?: boolean;
    activeDropReferenceId?: string | null;
    onReferenceFilesDrop?: (reference: CanvasResourceReference, files: File[]) => void;
    autoLinkEnabled?: boolean;
    mentionMenuLabels?: { connected?: string; search?: string };
};

// 回车提交语义由调用方决定：false 只在 ⌘/Ctrl+Enter 提交，"both" 两种都提交；Shift+Enter 始终换行。
function shouldSubmitOnEnter(event: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }, sendOnEnter: boolean | "both") {
    if (event.key !== "Enter" || event.shiftKey) return false;
    const modifier = event.ctrlKey || event.metaKey;
    if (sendOnEnter === false) return modifier;
    if (sendOnEnter === "both") return true;
    return !modifier;
}

export const CanvasResourceMentionTextarea = forwardRef<HTMLTextAreaElement, Props>(function CanvasResourceMentionTextarea(
    {
        value,
        references,
        onSelectReference,
        onChange,
        onSubmit,
        onKeyDown,
        className,
        containerClassName,
        style,
        highlightLabels = true,
        mentionMenuWidth = 320,
        sendOnEnter = true,
        onContentSizeChange,
        includeAssetLibrary = false,
        activeDropReferenceId,
        onReferenceFilesDrop,
        autoLinkEnabled = false,
        mentionMenuLabels,
        actionsRef,
        ...props
    },
    forwardedRef,
) {
    const rawTheme = useActiveTheme();
    const assets = useAssetStore((state) => state.assets);
    const theme = canvasThemes[rawTheme as keyof typeof canvasThemes] ?? canvasThemes.dark;
    const { t } = useTranslation();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const editorRef = useRef<HTMLDivElement | null>(null);
    const readOnly = Boolean(props.disabled || props.readOnly);
    const composingRef = useRef(false);
    const compositionBaseRef = useRef("");
    const [compositionValue, setCompositionValue] = useState<string | null>(null);
    const plainSelectionRef = useRef<{ value: string; start: number; end: number } | null>(null);
    const lastSelectionRef = useRef<{ value: string; start: number; end: number } | null>(null);
    const pendingSelectionRef = useRef<number | null>(null);
    const pendingScrollTopRef = useRef<number | null>(null);
    const lastRenderedValueRef = useRef("");
    const [mention, setMention] = useState<MentionState | null>(null);
    const [activeIndex, setActiveIndex] = useState(-1);
    const [autoLinkCursor, setAutoLinkCursor] = useState<number | null>(null);
    const autoLinkSuggestionRef = useRef<HTMLButtonElement | null>(null);
    const [autoLinkPosition, setAutoLinkPosition] = useState<{ left: number; top: number } | null>(null);
    const [nativeDropReferenceId, setNativeDropReferenceId] = useState<string | null>(null);
    const [previewReference, setPreviewReference] = useState<CanvasResourceReference | null>(null);
    const canvasReferences = useResolvedCanvasResourceReferences(references);
    const rawAssetReferences = useMemo(() => (includeAssetLibrary ? buildAssetMentionReferences(assets) : []), [assets, includeAssetLibrary]);
    const assetReferences = useResolvedCanvasResourceReferences(rawAssetReferences);
    const activeCanvasReferences = useMemo(() => canvasReferences.filter((item) => item.active), [canvasReferences]);
    // 工具标签只能经九宫格等面板入口插入，@ 引用菜单不再重复展示。
    const mentionCanvasReferences = useMemo(() => canvasReferences.filter((item) => item.kind !== "tool"), [canvasReferences]);
    const activeMentionCanvasReferences = useMemo(() => mentionCanvasReferences.filter((item) => item.active), [mentionCanvasReferences]);
    const availableReferences = useMemo(() => [...(onSelectReference ? mentionCanvasReferences : activeMentionCanvasReferences), ...assetReferences], [onSelectReference, mentionCanvasReferences, activeMentionCanvasReferences, assetReferences]);
    const candidates = useMemo(() => {
        if (!mention) return [];
        const query = mention.query.trim().toLowerCase();
        if (!query) return onSelectReference ? mentionCanvasReferences : activeMentionCanvasReferences;
        return availableReferences.filter((item) => `${item.label} ${item.title} ${item.kind} ${item.category || ""} ${item.text || ""}`.toLowerCase().includes(query));
    }, [onSelectReference, mentionCanvasReferences, activeMentionCanvasReferences, availableReferences, mention]);
    const activeReferences = useMemo(() => {
        if (!highlightLabels) return [];
        return [...activeCanvasReferences, ...assetReferences.filter((item) => value.includes(canvasResourceMentionToken(item)))];
    }, [activeCanvasReferences, assetReferences, highlightLabels, value]);
    const useRichEditor = Boolean(activeReferences.length);
    const showRichPlaceholder = useRichEditor && compositionValue === null && splitMentionText(value, activeReferences).every((part) => part.type === "mention" || !part.text.trim());
    useLayoutEffect(() => {
        const container = containerRef.current;
        if (container) return observeCanvasEditorWheelZoom(container);
    }, [useRichEditor]);
    const hoverPreview = useMentionHoverPreview(activeReferences);
    const autoLinkMatch = useMemo<CanvasResourceAutoLinkMatch | null>(
        () => (autoLinkEnabled && autoLinkCursor !== null ? findCanvasResourceAutoLinkMatch(value, autoLinkCursor, activeCanvasReferences) : null),
        [activeCanvasReferences, autoLinkCursor, autoLinkEnabled, value],
    );
    const reportContentSize = useCallback(
        (element: HTMLElement | null) => {
            if (!element || !onContentSizeChange) return;
            const previous = { height: element.style.height, minHeight: element.style.minHeight, maxHeight: element.style.maxHeight, overflow: element.style.overflow };
            element.style.height = "1px";
            element.style.minHeight = "0";
            element.style.maxHeight = "none";
            element.style.overflow = "hidden";
            const height = Math.ceil(element.scrollHeight);
            element.style.height = previous.height;
            element.style.minHeight = previous.minHeight;
            element.style.maxHeight = previous.maxHeight;
            element.style.overflow = previous.overflow;
            onContentSizeChange(height);
        },
        [onContentSizeChange],
    );

    useLayoutEffect(() => {
        if (!useRichEditor) pendingScrollTopRef.current = null;
    }, [useRichEditor, value]);

    useLayoutEffect(() => {
        if (!useRichEditor) return;
        const editor = editorRef.current;
        if (!editor || composingRef.current) return;
        const isFocused = document.activeElement === editor;
        const currentValue = serializeEditableValue(editor);
        if (currentValue === value && lastRenderedValueRef.current === value) {
            pendingSelectionRef.current = null;
            // 文本没变也要核对胶囊：引用晚到、换了指向或刚输完 @图片1 时，DOM 里的文字/胶囊已经过期。
            const selection = isFocused ? getEditableSelection(editor) : null;
            const staleParts = staleEditableMentionParts(editor, value, activeReferences, selection && selection.start === selection.end ? selection.start : null);
            if (staleParts) redrawEditableParts(editor, staleParts, selection);
            else syncInlineMentionPreviews(editor, activeReferences);
            if (staleParts) reportContentSize(editor);
            return;
        }
        const currentSelection = isFocused ? (getEditableSelection(editor)?.start ?? null) : null;
        const selection = pendingSelectionRef.current ?? (currentSelection === null ? null : mapCanvasTextOffset(currentValue, value, currentSelection));
        const scrollTop = pendingScrollTopRef.current;
        renderEditableContent(editor, value, activeReferences);
        lastRenderedValueRef.current = value;
        if (isFocused && selection !== null) setEditableSelection(editor, selection);
        pendingSelectionRef.current = null;
        reportContentSize(editor);
        if (scrollTop !== null) editor.scrollTop = scrollTop;
        pendingScrollTopRef.current = null;
    }, [activeReferences, reportContentSize, useRichEditor, value]);

    useLayoutEffect(() => {
        const editor = textareaRef.current,
            selection = plainSelectionRef.current;
        if (useRichEditor || composingRef.current || !editor || !selection || document.activeElement !== editor) return;
        const start = mapCanvasTextOffset(selection.value, value, selection.start),
            end = mapCanvasTextOffset(selection.value, value, selection.end);
        editor.setSelectionRange(start, end);
        plainSelectionRef.current = { value, start, end };
    }, [useRichEditor, value]);

    useLayoutEffect(() => {
        const anchor = useRichEditor ? editorRef.current : textareaRef.current;
        const suggestion = autoLinkSuggestionRef.current;
        if (!autoLinkMatch || !anchor || !suggestion) {
            setAutoLinkPosition(null);
            return;
        }
        const updatePosition = () => {
            const caret = mentionCaretRect(anchor, autoLinkMatch.end);
            const bounds = suggestion.getBoundingClientRect();
            setAutoLinkPosition({
                left: clamp(caret.right + 8, 12, window.innerWidth - bounds.width - 12),
                top: clamp(caret.bottom + 4, 12, window.innerHeight - bounds.height - 12),
            });
        };
        updatePosition();
        const observer = new ResizeObserver(updatePosition);
        observer.observe(anchor);
        observer.observe(suggestion);
        const stopMovingAnchor = observeMovablePopupAnchor(anchor, updatePosition);
        window.addEventListener("resize", updatePosition);
        window.addEventListener("scroll", updatePosition, true);
        return () => {
            observer.disconnect();
            stopMovingAnchor();
            window.removeEventListener("resize", updatePosition);
            window.removeEventListener("scroll", updatePosition, true);
        };
    }, [autoLinkMatch, useRichEditor, value]);

    useLayoutEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;
        const dropReferenceId = nativeDropReferenceId || activeDropReferenceId || "";
        editor.querySelectorAll<HTMLElement>("[data-mention-reference-id]").forEach((chip) => {
            chip.classList.toggle("is-replace-target", Boolean(dropReferenceId) && chip.dataset.mentionReferenceId === dropReferenceId);
        });
    }, [activeDropReferenceId, nativeDropReferenceId, useRichEditor, value]);

    useLayoutEffect(() => {
        const element = useRichEditor ? editorRef.current : textareaRef.current;
        const container = containerRef.current;
        if (!element || !container || !onContentSizeChange) return;
        reportContentSize(element);
        let width = container.clientWidth;
        const observer = new ResizeObserver(() => {
            const nextWidth = container.clientWidth;
            if (nextWidth === width) return;
            width = nextWidth;
            reportContentSize(element);
        });
        observer.observe(container);
        return () => observer.disconnect();
    }, [onContentSizeChange, reportContentSize, style?.fontSize, style?.lineHeight, useRichEditor, value]);

    const focusEditor = (selectionStart?: number) => {
        requestAnimationFrame(() => {
            const editor = editorRef.current;
            if (editor) {
                const scrollTop = editor.scrollTop;
                editor.focus({ preventScroll: true });
                if (typeof selectionStart === "number") setEditableSelection(editor, selectionStart);
                editor.scrollTop = scrollTop;
                return;
            }
            const textarea = textareaRef.current;
            if (!textarea) return;
            const scrollTop = textarea.scrollTop;
            textarea.focus({ preventScroll: true });
            if (typeof selectionStart === "number") textarea.setSelectionRange(selectionStart, selectionStart);
            textarea.scrollTop = scrollTop;
        });
    };

    const updateValue = (next: string, selectionStart?: number) => {
        if (readOnly || onChange(next) === false) return false;
        if (typeof selectionStart === "number") pendingSelectionRef.current = selectionStart;
        const editor = editorRef.current ?? textareaRef.current;
        pendingScrollTopRef.current = editor?.scrollTop ?? null;
        if (typeof selectionStart === "number") focusEditor(selectionStart);
        return true;
    };

    const insertTextAtSelection = (text: string) => {
        if (readOnly) return false;
        const editor = editorRef.current;
        const textarea = textareaRef.current;
        const currentValue = editor ? serializeEditableValue(editor) : (textarea?.value ?? value);
        const liveSelection = editor ? getEditableSelection(editor) : textarea ? { start: textarea.selectionStart, end: textarea.selectionEnd } : null;
        const remembered = lastSelectionRef.current || plainSelectionRef.current;
        const selection =
            liveSelection ||
            (remembered ? { start: mapCanvasTextOffset(remembered.value, currentValue, remembered.start), end: mapCanvasTextOffset(remembered.value, currentValue, remembered.end) } : { start: currentValue.length, end: currentValue.length });
        const result = insertPromptReferenceAtSelection(currentValue, selection, text);
        if (!updateValue(result.value, result.selection.start)) return false;
        lastSelectionRef.current = { value: result.value, ...result.selection };
        syncMention(result.value, result.selection.start);
        return true;
    };

    useLayoutEffect(() => {
        if (!actionsRef) return;
        const actions = { insertTextAtSelection };
        actionsRef.current = actions;
        return () => {
            if (actionsRef.current === actions) actionsRef.current = null;
        };
    });

    const closeMention = () => {
        setMention(null);
        setActiveIndex(-1);
    };

    const syncMention = (nextValue: string, cursor: number) => {
        if (readOnly) return;
        setAutoLinkCursor(cursor);
        const prefix = nextValue.slice(0, cursor);
        const match = /@([^\s@,.;:!?，。；：！？、)\]}】）]*)$/.exec(prefix);
        if (!match || !availableReferences.length) {
            closeMention();
            return;
        }
        const nextMention = { start: match.index, end: cursor, query: match[1] };
        const isSameMention = mention?.start === nextMention.start && mention.end === nextMention.end && mention.query === nextMention.query;
        if (!isSameMention) {
            setMention(nextMention);
            setActiveIndex(-1);
        }
    };

    const insertReference = (reference: CanvasResourceReference) => {
        if (readOnly || !mention) return;
        const selected = onSelectReference ? onSelectReference(reference) : reference;
        if (!selected) return;
        const insertText = `${canvasResourceMentionToken(selected)} `;
        const next = `${value.slice(0, mention.start)}${insertText}${value.slice(mention.end)}`;
        closeMention();
        updateValue(next, mention.start + insertText.length);
    };

    const replaceEditableSelection = (rawInsertText: string) => {
        const currentValue = editorRef.current ? serializeEditableValue(editorRef.current) : value;
        const textarea = textareaRef.current;
        const selection = getEditableSelection(editorRef.current) || (textarea ? { start: textarea.selectionStart, end: textarea.selectionEnd } : null) || { start: currentValue.length, end: currentValue.length };
        // 紧贴胶囊粘贴时与键入一致：会和令牌粘连的内容前补空格，胶囊不变回文字。
        const chipToken = editorRef.current && rawInsertText ? editableMentionTokenEndingAt(editorRef.current, selection.start) : null;
        const insertText = chipToken && !hasMentionTokenBoundary(chipToken, rawInsertText, 0) ? ` ${rawInsertText}` : rawInsertText;
        const next = `${currentValue.slice(0, selection.start)}${insertText}${currentValue.slice(selection.end)}`;
        const cursor = selection.start + insertText.length;
        if (!updateValue(next, cursor)) return;
        syncMention(next, cursor);
    };

    const insertAutoLink = (match: CanvasResourceAutoLinkMatch) => {
        const currentValue = editorRef.current ? serializeEditableValue(editorRef.current) : value;
        const insertText = `${canvasResourceMentionToken(match.reference)} `;
        const next = `${currentValue.slice(0, match.start)}${insertText}${currentValue.slice(match.end)}`;
        updateValue(next, match.start + insertText.length);
        setAutoLinkCursor(match.start + insertText.length);
    };

    const autoLinkSuggestion =
        !readOnly && autoLinkMatch
            ? createPortal(
                  <button
                      ref={autoLinkSuggestionRef}
                      type="button"
                      data-canvas-no-zoom
                      className="fixed z-[var(--z-tooltip)] inline-flex max-w-[min(360px,calc(100vw-24px))] items-center gap-2 rounded-md border border-current/15 px-2 py-1 text-[var(--fs-micro)] shadow-sm"
                      style={{ ...autoLinkPosition, visibility: autoLinkPosition ? "visible" : "hidden", background: theme.node.panel, color: theme.node.text }}
                      onPointerDown={(event) => event.stopPropagation()}
                      onMouseDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                      }}
                      onClick={(event) => {
                          event.stopPropagation();
                          insertAutoLink(autoLinkMatch);
                      }}
                      aria-label={t("canvasB.mention.autoLinkLabel", { label: autoLinkMatch.reference.label })}
                  >
                      <span className="truncate">{t("canvasB.mention.autoLinkText", { query: autoLinkMatch.query, label: autoLinkMatch.reference.label })}</span>
                      <kbd className="shrink-0 rounded border border-current/20 px-1 font-mono text-[var(--fs-micro)]">Tab</kbd>
                  </button>,
                  document.body,
              )
            : null;

    const syncEditableValue = () => {
        if (readOnly || composingRef.current) return;
        const editor = editorRef.current;
        if (!editor) return;
        repairEditableMentionBoundaries(editor);
        const next = serializeEditableValue(editor);
        const cursor = getEditableSelection(editor)?.start ?? next.length;
        const selection = getEditableSelection(editor);
        if (selection) lastSelectionRef.current = { value: next, start: selection.start, end: selection.end };
        if (onChange(next) === false) {
            renderEditableContent(editor, value, activeReferences);
            lastRenderedValueRef.current = value;
            setEditableSelection(editor, Math.min(cursor, value.length));
            return;
        }
        pendingSelectionRef.current = cursor;
        lastRenderedValueRef.current = next;
        syncMention(next, cursor);
        reportContentSize(editor);
    };

    const syncEditableMentionFromSelection = () => {
        const editor = editorRef.current;
        if (!editor) return;
        const selection = getEditableSelection(editor);
        if (!selection) {
            setAutoLinkCursor(null);
            return;
        }
        lastSelectionRef.current = { value: serializeEditableValue(editor), start: selection.start, end: selection.end };
        if (selection.start !== selection.end) {
            setAutoLinkCursor(null);
            return;
        }
        syncMention(serializeEditableValue(editor), selection.start);
    };

    const referenceForDropTarget = (target: EventTarget | null) => {
        const element = target instanceof Element ? target.closest<HTMLElement>("[data-mention-reference-id]") : null;
        const referenceId = element?.dataset.mentionReferenceId;
        return referenceId ? activeReferences.find((reference) => reference.id === referenceId) : undefined;
    };

    const imageFilesFromTransfer = (event: DragEvent<HTMLDivElement>) => Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith("image/"));

    const mergedStyle = {
        ...(style || {}),
        caretColor: style?.color || theme.node.text,
    } as CSSProperties;
    const menuAnchor = useRichEditor ? editorRef.current : textareaRef.current;
    const menu =
        !readOnly && mention && availableReferences.length && menuAnchor ? (
            <MentionMenu
                anchor={menuAnchor}
                connectedReferences={activeMentionCanvasReferences}
                assetReferences={assetReferences}
                filteredReferences={candidates}
                query={mention.query}
                cursorOffset={mention.end}
                activeReferenceId={activeIndex >= 0 ? candidates[Math.min(activeIndex, candidates.length - 1)]?.id : undefined}
                preferredWidth={mentionMenuWidth}
                onQueryChange={(query) => setMention((current) => (current ? { ...current, query } : current))}
                onClose={closeMention}
                onSelect={insertReference}
                labels={mentionMenuLabels}
            />
        ) : null;

    if (useRichEditor) {
        return (
            <div ref={containerRef} data-canvas-no-zoom className={`relative w-full min-h-0 overflow-hidden ${containerClassName || "h-full"}`}>
                <div
                    ref={editorRef}
                    role="textbox"
                    aria-multiline="true"
                    aria-label={props["aria-label"]}
                    aria-placeholder={props.placeholder}
                    data-placeholder={showRichPlaceholder ? props.placeholder : undefined}
                    aria-disabled={props.disabled}
                    aria-readonly={readOnly}
                    contentEditable={!props.disabled && !props.readOnly}
                    suppressContentEditableWarning
                    spellCheck={props.spellCheck}
                    tabIndex={props.tabIndex}
                    className={`${className || ""} relative z-10 cursor-text select-text whitespace-pre-wrap break-words after:pointer-events-none after:select-none after:opacity-40 after:content-[attr(data-placeholder)]`}
                    style={{
                        ...mergedStyle,
                        color: style?.color || theme.node.text,
                        height: "100%",
                        minHeight: 0,
                        maxHeight: "100%",
                        overflowY: "auto",
                        overflowX: "hidden",
                    }}
                    onInput={syncEditableValue}
                    onCompositionStart={(event) => {
                        composingRef.current = true;
                        compositionBaseRef.current = serializeEditableValue(event.currentTarget);
                        setCompositionValue("");
                        props.onCompositionStart?.(event as unknown as React.CompositionEvent<HTMLTextAreaElement>);
                    }}
                    onCompositionEnd={(event) => {
                        repairEditableMentionBoundaries(event.currentTarget);
                        const local = serializeEditableValue(event.currentTarget);
                        const cursor = getEditableSelection(event.currentTarget)?.start ?? local.length;
                        const merged = mergeCanvasText(compositionBaseRef.current, value, local);
                        composingRef.current = false;
                        setCompositionValue(null);
                        renderEditableContent(event.currentTarget, merged, activeReferences);
                        setEditableSelection(event.currentTarget, mapCanvasTextOffset(local, merged, cursor));
                        syncEditableValue();
                        props.onCompositionEnd?.(event as unknown as React.CompositionEvent<HTMLTextAreaElement>);
                    }}
                    onPaste={(event: ClipboardEvent<HTMLDivElement>) => {
                        event.preventDefault();
                        replaceEditableSelection(event.clipboardData.getData("text/plain"));
                    }}
                    onCopy={(event: ClipboardEvent<HTMLDivElement>) => {
                        const text = serializeEditableSelection(event.currentTarget);
                        if (text === null) return;
                        event.preventDefault();
                        event.clipboardData.setData("text/plain", text);
                    }}
                    onCut={(event: ClipboardEvent<HTMLDivElement>) => {
                        const text = serializeEditableSelection(event.currentTarget);
                        if (text === null) return;
                        event.preventDefault();
                        event.clipboardData.setData("text/plain", text);
                        if (!readOnly) replaceEditableSelection("");
                    }}
                    onDragOver={(event: DragEvent<HTMLDivElement>) => {
                        const reference = referenceForDropTarget(event.target);
                        const hasImageFile =
                            Array.from(event.dataTransfer.items).some((item) => item.kind === "file" && (!item.type || item.type.startsWith("image/"))) || Array.from(event.dataTransfer.files).some((file) => file.type.startsWith("image/"));
                        if (!onReferenceFilesDrop || reference?.kind !== "image" || !hasImageFile) {
                            setNativeDropReferenceId(null);
                            props.onDragOver?.(event as unknown as React.DragEvent<HTMLTextAreaElement>);
                            return;
                        }
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "copy";
                        setNativeDropReferenceId(reference.id);
                        props.onDragOver?.(event as unknown as React.DragEvent<HTMLTextAreaElement>);
                    }}
                    onDragLeave={(event: DragEvent<HTMLDivElement>) => {
                        const bounds = event.currentTarget.getBoundingClientRect();
                        if (event.clientX <= bounds.left || event.clientX >= bounds.right || event.clientY <= bounds.top || event.clientY >= bounds.bottom) setNativeDropReferenceId(null);
                        props.onDragLeave?.(event as unknown as React.DragEvent<HTMLTextAreaElement>);
                    }}
                    onDrop={(event: DragEvent<HTMLDivElement>) => {
                        if (readOnly) {
                            event.preventDefault();
                            return;
                        }
                        const reference = referenceForDropTarget(event.target);
                        const files = imageFilesFromTransfer(event);
                        setNativeDropReferenceId(null);
                        if (onReferenceFilesDrop && reference?.kind === "image" && files.length) {
                            event.preventDefault();
                            onReferenceFilesDrop(reference, files);
                        }
                        props.onDrop?.(event as unknown as React.DragEvent<HTMLTextAreaElement>);
                    }}
                    onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                        hoverPreview.dismiss();
                        if (readOnly) {
                            onKeyDown?.(event as unknown as React.KeyboardEvent<HTMLTextAreaElement>);
                            return;
                        }
                        if (event.key === "Enter" && (event.nativeEvent.isComposing || composingRef.current || event.keyCode === 229)) return;
                        if (autoLinkMatch && event.key === "Tab" && !event.shiftKey && !event.nativeEvent.isComposing && !composingRef.current) {
                            event.preventDefault();
                            insertAutoLink(autoLinkMatch);
                            return;
                        }
                        if (mention && candidates.length) {
                            if (event.key === "ArrowDown") {
                                event.preventDefault();
                                setActiveIndex((index) => (index < 0 ? 0 : (index + 1) % candidates.length));
                                return;
                            }
                            if (event.key === "ArrowUp") {
                                event.preventDefault();
                                setActiveIndex((index) => (index < 0 ? candidates.length - 1 : (index - 1 + candidates.length) % candidates.length));
                                return;
                            }
                            if (event.key === "Enter" || event.key === "Tab") {
                                event.preventDefault();
                                insertReference(candidates[activeIndex < 0 ? 0 : Math.min(activeIndex, candidates.length - 1)]);
                                return;
                            }
                            if (event.key === "Escape") {
                                event.preventDefault();
                                closeMention();
                                return;
                            }
                        }
                        if (event.key === "Enter") {
                            event.preventDefault();
                            const shouldSubmit = shouldSubmitOnEnter(event, sendOnEnter);
                            if (onSubmit && shouldSubmit) {
                                onSubmit({ modifier: event.ctrlKey || event.metaKey });
                                return;
                            }
                            replaceEditableSelection("\n");
                            return;
                        }
                        onKeyDown?.(event as unknown as React.KeyboardEvent<HTMLTextAreaElement>);
                    }}
                    onKeyUp={(event) => {
                        syncEditableMentionFromSelection();
                        props.onKeyUp?.(event as unknown as React.KeyboardEvent<HTMLTextAreaElement>);
                    }}
                    onMouseDown={(event) => props.onMouseDown?.(event as unknown as React.MouseEvent<HTMLTextAreaElement>)}
                    onPointerDown={(event) => {
                        hoverPreview.dismiss();
                        props.onPointerDown?.(event as unknown as React.PointerEvent<HTMLTextAreaElement>);
                    }}
                    onPointerOver={hoverPreview.onPointerOver}
                    onPointerOut={hoverPreview.onPointerOut}
                    onDoubleClick={(event) => {
                        hoverPreview.dismiss();
                        const chip = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-mention-reference-id]") : null;
                        const reference = chip ? availableReferences.find((item) => item.id === chip.dataset.mentionReferenceId) : undefined;
                        if (!reference || !referencePreviewUrl(reference)) return;
                        event.preventDefault();
                        event.stopPropagation();
                        setPreviewReference(reference);
                    }}
                    onPointerUp={(event) => {
                        const selection = getEditableSelection(editorRef.current);
                        if (selection) lastSelectionRef.current = { value: serializeEditableValue(editorRef.current!), start: selection.start, end: selection.end };
                        syncEditableMentionFromSelection();
                        props.onPointerUp?.(event as unknown as React.PointerEvent<HTMLTextAreaElement>);
                    }}
                    onClick={() => {
                        const selection = getEditableSelection(editorRef.current);
                        if (selection) lastSelectionRef.current = { value: serializeEditableValue(editorRef.current!), start: selection.start, end: selection.end };
                    }}
                    onSelect={(event) => props.onSelect?.(event as unknown as React.SyntheticEvent<HTMLTextAreaElement>)}
                    onWheel={(event) => {
                        event.stopPropagation();
                        props.onWheel?.(event as unknown as React.WheelEvent<HTMLTextAreaElement>);
                    }}
                    onScroll={(event) => props.onScroll?.(event as unknown as React.UIEvent<HTMLTextAreaElement>)}
                    onFocus={(event) => props.onFocus?.(event as unknown as React.FocusEvent<HTMLTextAreaElement>)}
                    onBlur={(event) => {
                        setAutoLinkCursor(null);
                        if (event.relatedTarget instanceof Element && event.relatedTarget.closest("[data-canvas-resource-mention-menu]")) return;
                        window.setTimeout(() => {
                            if (document.activeElement?.closest("[data-canvas-resource-mention-menu]")) return;
                            closeMention();
                        }, 120);
                        props.onBlur?.(event as unknown as React.FocusEvent<HTMLTextAreaElement>);
                    }}
                ></div>
                {autoLinkSuggestion}
                {menu}
                {hoverPreview.target && !previewReference ? <MentionHoverPreview target={hoverPreview.target} /> : null}
                {previewReference ? <InlineReferencePreview reference={previewReference} onClose={() => setPreviewReference(null)} /> : null}
            </div>
        );
    }

    return (
        <div ref={containerRef} data-canvas-no-zoom className={`relative w-full min-h-0 overflow-hidden ${containerClassName || "h-full"}`}>
            <textarea
                {...props}
                ref={(node) => {
                    textareaRef.current = node;
                    if (typeof forwardedRef === "function") forwardedRef(node);
                    else if (forwardedRef) forwardedRef.current = node;
                }}
                value={compositionValue ?? value}
                className={`${className || ""} relative z-10`}
                style={{ ...mergedStyle, height: "100%", minHeight: 0, maxHeight: "100%", overflowY: "auto", overflowX: "hidden" }}
                onChange={(event) => {
                    if (readOnly) return;
                    const next = event.target.value;
                    const selection = { start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd };
                    plainSelectionRef.current = { value: next, ...selection };
                    lastSelectionRef.current = { value: next, ...selection };
                    if (composingRef.current) {
                        setCompositionValue(next);
                        return;
                    }
                    if (onChange(next) === false) {
                        event.currentTarget.value = value;
                        return;
                    }
                    syncMention(next, event.target.selectionStart);
                    reportContentSize(event.currentTarget);
                }}
                onCompositionStart={(event) => {
                    composingRef.current = true;
                    compositionBaseRef.current = event.currentTarget.value;
                    setCompositionValue(event.currentTarget.value);
                    props.onCompositionStart?.(event);
                }}
                onCompositionEnd={(event) => {
                    const local = event.currentTarget.value;
                    const merged = mergeCanvasText(compositionBaseRef.current, value, local);
                    const cursor = mapCanvasTextOffset(local, merged, event.currentTarget.selectionStart);
                    composingRef.current = false;
                    setCompositionValue(null);
                    event.currentTarget.value = merged;
                    event.currentTarget.setSelectionRange(cursor, cursor);
                    plainSelectionRef.current = { value: merged, start: cursor, end: cursor };
                    lastSelectionRef.current = { value: merged, start: cursor, end: cursor };
                    if (onChange(merged) === false) event.currentTarget.value = value;
                    syncMention(merged, cursor);
                    props.onCompositionEnd?.(event);
                }}
                onSelect={(event) => {
                    const textarea = event.currentTarget;
                    const selection = { start: textarea.selectionStart, end: textarea.selectionEnd };
                    plainSelectionRef.current = { value: textarea.value, ...selection };
                    lastSelectionRef.current = { value: textarea.value, ...selection };
                    setAutoLinkCursor(textarea.selectionStart === textarea.selectionEnd ? textarea.selectionStart : null);
                    props.onSelect?.(event);
                }}
                onKeyDown={(event) => {
                    if (readOnly) {
                        onKeyDown?.(event);
                        return;
                    }
                    if (event.key === "Enter" && (event.nativeEvent.isComposing || composingRef.current || event.keyCode === 229)) return;
                    if (autoLinkMatch && event.key === "Tab" && !event.shiftKey && !event.nativeEvent.isComposing && !composingRef.current) {
                        event.preventDefault();
                        insertAutoLink(autoLinkMatch);
                        return;
                    }
                    if (mention && candidates.length) {
                        if (event.key === "ArrowDown") {
                            event.preventDefault();
                            setActiveIndex((index) => (index < 0 ? 0 : (index + 1) % candidates.length));
                            return;
                        }
                        if (event.key === "ArrowUp") {
                            event.preventDefault();
                            setActiveIndex((index) => (index < 0 ? candidates.length - 1 : (index - 1 + candidates.length) % candidates.length));
                            return;
                        }
                        if (event.key === "Enter") {
                            event.preventDefault();
                            insertReference(candidates[activeIndex < 0 ? 0 : Math.min(activeIndex, candidates.length - 1)]);
                            return;
                        }
                        if (event.key === "Escape") {
                            event.preventDefault();
                            closeMention();
                            return;
                        }
                    }
                    const shouldSubmit = shouldSubmitOnEnter(event, sendOnEnter);
                    if (shouldSubmit && onSubmit) {
                        event.preventDefault();
                        onSubmit({ modifier: event.ctrlKey || event.metaKey });
                        return;
                    }
                    onKeyDown?.(event);
                }}
                onWheel={(event) => {
                    event.stopPropagation();
                    const textarea = event.currentTarget;
                    const deltaY = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * textarea.clientHeight : event.deltaY;
                    if (!event.defaultPrevented && !event.ctrlKey && !event.metaKey && deltaY) {
                        const previousTop = textarea.scrollTop;
                        textarea.scrollTop += deltaY;
                        if (textarea.scrollTop !== previousTop) event.preventDefault();
                    }
                    props.onWheel?.(event);
                }}
                onBlur={(event) => {
                    setAutoLinkCursor(null);
                    if (event.relatedTarget instanceof Element && event.relatedTarget.closest("[data-canvas-resource-mention-menu]")) return;
                    window.setTimeout(() => {
                        if (document.activeElement?.closest("[data-canvas-resource-mention-menu]")) return;
                        closeMention();
                    }, 120);
                    props.onBlur?.(event);
                }}
            />
            {autoLinkSuggestion}
            {menu}
        </div>
    );
});
