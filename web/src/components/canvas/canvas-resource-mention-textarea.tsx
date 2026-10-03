import { forwardRef, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ClipboardEvent, DragEvent, KeyboardEvent, TextareaHTMLAttributes } from "react";
import { createPortal } from "react-dom";

import { canvasThemes } from "@/lib/canvas-theme";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { buildAssetMentionReferences, canvasResourceMentionToken, findCanvasResourceAutoLinkMatch, type CanvasResourceAutoLinkMatch, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { useAssetStore } from "@/stores/use-asset-store";
import { useResolvedCanvasResourceReferences } from "./use-resolved-canvas-resource-references";
import { InlineReferencePreview, referencePreviewUrl, syncInlineMentionPreviews } from "./canvas-mention-chips";
import { MentionMenu, clamp, mentionCaretRect } from "./canvas-mention-menu";
import { getEditableSelection, renderEditableContent, serializeEditableValue, setEditableSelection } from "./canvas-mention-editable";

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

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value"> & {
    value: string;
    references: CanvasResourceReference[];
    onSelectReference?: (reference: CanvasResourceReference) => CanvasResourceReference | undefined;
    onChange: (value: string) => void;
    onSubmit?: () => void;
    containerClassName?: string;
    highlightLabels?: boolean;
    mentionMenuWidth?: number;
    sendOnEnter?: boolean | "both";
    onContentSizeChange?: (height: number) => void;
    includeAssetLibrary?: boolean;
    activeDropReferenceId?: string | null;
    onReferenceFilesDrop?: (reference: CanvasResourceReference, files: File[]) => void;
    onPasteFiles?: (files: File[]) => void;
    autoLinkEnabled?: boolean;
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
    { value, references, onSelectReference, onChange, onSubmit, onKeyDown, className, containerClassName, style, highlightLabels = true, mentionMenuWidth = 320, sendOnEnter = true, onContentSizeChange, includeAssetLibrary = false, activeDropReferenceId, onReferenceFilesDrop, onPasteFiles, autoLinkEnabled = false, ...props },
    forwardedRef,
) {
    const rawTheme = useActiveTheme();
    const assets = useAssetStore((state) => state.assets);
    const theme = canvasThemes[rawTheme as keyof typeof canvasThemes] ?? canvasThemes.dark;
    const containerRef = useRef<HTMLDivElement | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const editorRef = useRef<HTMLDivElement | null>(null);
    const composingRef = useRef(false);
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
    const rawAssetReferences = useMemo(() => includeAssetLibrary ? buildAssetMentionReferences(assets) : [], [assets, includeAssetLibrary]);
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
    const autoLinkMatch = useMemo<CanvasResourceAutoLinkMatch | null>(() => autoLinkEnabled && autoLinkCursor !== null ? findCanvasResourceAutoLinkMatch(value, autoLinkCursor, activeCanvasReferences) : null, [activeCanvasReferences, autoLinkCursor, autoLinkEnabled, value]);
    const reportContentSize = useCallback((element: HTMLElement | null) => {
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
    }, [onContentSizeChange]);

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
            syncInlineMentionPreviews(editor, activeReferences);
            pendingSelectionRef.current = null;
            return;
        }
        const selection = pendingSelectionRef.current ?? (isFocused ? getEditableSelection(editor)?.start ?? null : null);
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
        window.addEventListener("resize", updatePosition);
        window.addEventListener("scroll", updatePosition, true);
        return () => {
            observer.disconnect();
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
    }, [onContentSizeChange, reportContentSize, useRichEditor, value]);

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
        if (typeof selectionStart === "number") pendingSelectionRef.current = selectionStart;
        const editor = editorRef.current ?? textareaRef.current;
        pendingScrollTopRef.current = editor?.scrollTop ?? null;
        onChange(next);
        if (typeof selectionStart === "number") focusEditor(selectionStart);
    };

    const closeMention = () => {
        setMention(null);
        setActiveIndex(-1);
    };

    const syncMention = (nextValue: string, cursor: number) => {
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
        if (!mention) return;
        const selected = onSelectReference ? onSelectReference(reference) : reference;
        if (!selected) return;
        const insertText = `${canvasResourceMentionToken(selected)} `;
        const next = `${value.slice(0, mention.start)}${insertText}${value.slice(mention.end)}`;
        closeMention();
        updateValue(next, mention.start + insertText.length);
    };

    const replaceEditableSelection = (insertText: string) => {
        const currentValue = editorRef.current ? serializeEditableValue(editorRef.current) : value;
        const textarea = textareaRef.current;
        const selection = getEditableSelection(editorRef.current)
            || (textarea ? { start: textarea.selectionStart, end: textarea.selectionEnd } : null)
            || { start: currentValue.length, end: currentValue.length };
        const next = `${currentValue.slice(0, selection.start)}${insertText}${currentValue.slice(selection.end)}`;
        const cursor = selection.start + insertText.length;
        updateValue(next, cursor);
        syncMention(next, cursor);
    };

    const insertAutoLink = (match: CanvasResourceAutoLinkMatch) => {
        const currentValue = editorRef.current ? serializeEditableValue(editorRef.current) : value;
        const insertText = `${canvasResourceMentionToken(match.reference)} `;
        const next = `${currentValue.slice(0, match.start)}${insertText}${currentValue.slice(match.end)}`;
        updateValue(next, match.start + insertText.length);
        setAutoLinkCursor(match.start + insertText.length);
    };

    const autoLinkSuggestion = autoLinkMatch ? createPortal(
        <button
            ref={autoLinkSuggestionRef}
            type="button"
            data-canvas-no-zoom
            className="fixed z-[var(--z-tooltip)] inline-flex max-w-[min(360px,calc(100vw-24px))] items-center gap-1.5 rounded-md border border-current/15 px-2 py-1 text-[var(--fs-micro)] shadow-sm"
            style={{ ...autoLinkPosition, visibility: autoLinkPosition ? "visible" : "hidden", background: theme.node.panel, color: theme.node.text }}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
            onClick={(event) => { event.stopPropagation(); insertAutoLink(autoLinkMatch); }}
            aria-label={`引用${autoLinkMatch.reference.label}`}
        >
            <span className="truncate">引用「{autoLinkMatch.query}」→ @{autoLinkMatch.reference.label}</span>
            <kbd className="shrink-0 rounded border border-current/20 px-1 font-mono text-[var(--fs-micro)]">Tab</kbd>
        </button>,
        document.body,
    ) : null;

    const syncEditableValue = () => {
        if (composingRef.current) return;
        const editor = editorRef.current;
        if (!editor) return;
        const next = serializeEditableValue(editor);
        const cursor = getEditableSelection(editor)?.start ?? next.length;
        pendingSelectionRef.current = cursor;
        lastRenderedValueRef.current = next;
        onChange(next);
        syncMention(next, cursor);
        reportContentSize(editor);
    };

    const syncEditableMentionFromSelection = () => {
        const editor = editorRef.current;
        if (!editor) return;
        const selection = getEditableSelection(editor);
        if (!selection || selection.start !== selection.end) {
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
    const menu = mention && availableReferences.length && menuAnchor ? (
        <MentionMenu
            anchor={menuAnchor}
            connectedReferences={activeMentionCanvasReferences}
            assetReferences={assetReferences}
            filteredReferences={candidates}
            query={mention.query}
            cursorOffset={mention.end}
            activeReferenceId={activeIndex >= 0 ? candidates[Math.min(activeIndex, candidates.length - 1)]?.id : undefined}
            preferredWidth={mentionMenuWidth}
            onQueryChange={(query) => setMention((current) => current ? { ...current, query } : current)}
            onClose={closeMention}
            onSelect={insertReference}
        />
    ) : null;

    if (useRichEditor) {
        return (
            <div ref={containerRef} data-canvas-no-zoom className={`relative w-full min-h-0 overflow-hidden ${containerClassName || "h-full"}`}>
                {!value && props.placeholder ? (
                    <div aria-hidden className={`${className || ""} pointer-events-none absolute inset-0 z-0`} style={{ ...style, color: style?.color || theme.node.text, opacity: 0.4 }}>
                        {props.placeholder}
                    </div>
                ) : null}
                <div
                    ref={editorRef}
                    role="textbox"
                    aria-multiline="true"
                    aria-label={props["aria-label"]}
                    aria-disabled={props.disabled}
                    contentEditable={!props.disabled && !props.readOnly}
                    suppressContentEditableWarning
                    spellCheck={props.spellCheck}
                    tabIndex={props.tabIndex}
                    className={`${className || ""} relative z-10 cursor-text select-text whitespace-pre-wrap break-words`}
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
                        props.onCompositionStart?.(event as unknown as React.CompositionEvent<HTMLTextAreaElement>);
                    }}
                    onCompositionEnd={(event) => {
                        composingRef.current = false;
                        syncEditableValue();
                        props.onCompositionEnd?.(event as unknown as React.CompositionEvent<HTMLTextAreaElement>);
                    }}
                    onPaste={(event: ClipboardEvent<HTMLDivElement>) => {
                        const clipboardImages = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
                        if (clipboardImages.length && onPasteFiles) {
                            event.preventDefault();
                            onPasteFiles(clipboardImages);
                            return;
                        }
                        event.preventDefault();
                        replaceEditableSelection(event.clipboardData.getData("text/plain"));
                    }}
                    onDragOver={(event: DragEvent<HTMLDivElement>) => {
                        const reference = referenceForDropTarget(event.target);
                        const hasImageFile = Array.from(event.dataTransfer.items).some((item) => item.kind === "file" && (!item.type || item.type.startsWith("image/")))
                            || Array.from(event.dataTransfer.files).some((file) => file.type.startsWith("image/"));
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
if (event.key === "Enter" && (event.nativeEvent.isComposing || composingRef.current || event.keyCode === 229)) return;
                        if (autoLinkMatch && event.key === "Tab" && !event.shiftKey && !event.nativeEvent.isComposing && !composingRef.current) {
                            event.preventDefault();
                            insertAutoLink(autoLinkMatch);
                            return;
                        }
                        if (mention && candidates.length) {
                            if (event.key === "ArrowDown") {
                                event.preventDefault();
                                setActiveIndex((index) => index < 0 ? 0 : (index + 1) % candidates.length);
                                return;
                            }
                            if (event.key === "ArrowUp") {
                                event.preventDefault();
                                setActiveIndex((index) => index < 0 ? candidates.length - 1 : (index - 1 + candidates.length) % candidates.length);
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
                                onSubmit();
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
                    onPointerDown={(event) => props.onPointerDown?.(event as unknown as React.PointerEvent<HTMLTextAreaElement>)}
                    onDoubleClick={(event) => {
                        const chip = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-mention-reference-id]") : null;
                        const reference = chip ? availableReferences.find((item) => item.id === chip.dataset.mentionReferenceId) : undefined;
                        if (!reference || !referencePreviewUrl(reference)) return;
                        event.preventDefault();
                        event.stopPropagation();
                        setPreviewReference(reference);
                    }}
                    onPointerUp={(event) => {
                        syncEditableMentionFromSelection();
                        props.onPointerUp?.(event as unknown as React.PointerEvent<HTMLTextAreaElement>);
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
                >
                </div>
                {autoLinkSuggestion}
                {menu}
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
                value={value}
                className={`${className || ""} relative z-10`}
                style={{ ...mergedStyle, height: "100%", minHeight: 0, maxHeight: "100%", overflowY: "auto", overflowX: "hidden" }}
                onChange={(event) => {
                    const next = event.target.value;
                    onChange(next);
                    syncMention(next, event.target.selectionStart);
                    reportContentSize(event.currentTarget);
                }}
                onCompositionStart={(event) => {
                    composingRef.current = true;
                    props.onCompositionStart?.(event);
                }}
                onCompositionEnd={(event) => {
                    composingRef.current = false;
                    syncMention(event.currentTarget.value, event.currentTarget.selectionStart);
                    props.onCompositionEnd?.(event);
                }}
                onPaste={(event) => {
                    const clipboardImages = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
                    if (!clipboardImages.length || !onPasteFiles) return;
                    event.preventDefault();
                    onPasteFiles(clipboardImages);
                }}
                onSelect={(event) => {
                    const textarea = event.currentTarget;
                    setAutoLinkCursor(textarea.selectionStart === textarea.selectionEnd ? textarea.selectionStart : null);
                    props.onSelect?.(event);
                }}
                onKeyDown={(event) => {
if (event.key === "Enter" && (event.nativeEvent.isComposing || composingRef.current || event.keyCode === 229)) return;
                        if (autoLinkMatch && event.key === "Tab" && !event.shiftKey && !event.nativeEvent.isComposing && !composingRef.current) {
                            event.preventDefault();
                            insertAutoLink(autoLinkMatch);
                            return;
                        }
                    if (mention && candidates.length) {
                        if (event.key === "ArrowDown") {
                            event.preventDefault();
                            setActiveIndex((index) => index < 0 ? 0 : (index + 1) % candidates.length);
                            return;
                        }
                        if (event.key === "ArrowUp") {
                            event.preventDefault();
                            setActiveIndex((index) => index < 0 ? candidates.length - 1 : (index - 1 + candidates.length) % candidates.length);
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
                        onSubmit();
                        return;
                    }
                    onKeyDown?.(event);
                }}
                onWheel={(event) => {
                    event.stopPropagation();
                    const textarea = event.currentTarget;
                    const deltaY = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * textarea.clientHeight : event.deltaY;
                    if (deltaY) {
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
