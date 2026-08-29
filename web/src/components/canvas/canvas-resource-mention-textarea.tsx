import { forwardRef, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ClipboardEvent, DragEvent, KeyboardEvent, MouseEvent, PointerEvent, TextareaHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ChevronRight, FileText, Folder, Image as ImageIcon, Music2, Pencil, Search, UserRound, Video, Workflow } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { buildAssetMentionReferences, canvasResourceMentionToken, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { useAssetStore, type AssetCategory } from "@/stores/use-asset-store";
import { CanvasNodeType } from "@/types/canvas";
import { useResolvedCanvasResourceReferences } from "./use-resolved-canvas-resource-references";

type MentionState = {
    start: number;
    end: number;
    query: string;
};

type EditableSelection = {
    start: number;
    end: number;
};

type MentionTextPart =
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
    onChange: (value: string) => void;
    onSubmit?: () => void;
    containerClassName?: string;
    highlightLabels?: boolean;
    mentionMenuWidth?: number;
    sendOnEnter?: boolean;
    onContentSizeChange?: (height: number) => void;
    includeAssetLibrary?: boolean;
    activeDropReferenceId?: string | null;
    onReferenceFilesDrop?: (reference: CanvasResourceReference, files: File[]) => void;
};

export const CanvasResourceMentionTextarea = forwardRef<HTMLTextAreaElement, Props>(function CanvasResourceMentionTextarea(
    { value, references, onChange, onSubmit, onKeyDown, className, containerClassName, style, highlightLabels = true, mentionMenuWidth = 320, sendOnEnter = true, onContentSizeChange, includeAssetLibrary = false, activeDropReferenceId, onReferenceFilesDrop, ...props },
    forwardedRef,
) {
    const rawTheme = useThemeStore((state) => state.theme);
    const assets = useAssetStore((state) => state.assets);
    const theme = canvasThemes[rawTheme as keyof typeof canvasThemes] ?? canvasThemes.dark;
    const containerRef = useRef<HTMLDivElement | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const editorRef = useRef<HTMLDivElement | null>(null);
    const composingRef = useRef(false);
    const pendingSelectionRef = useRef<number | null>(null);
    const lastRenderedValueRef = useRef("");
    const [mention, setMention] = useState<MentionState | null>(null);
    const [activeIndex, setActiveIndex] = useState(-1);
    const [nativeDropReferenceId, setNativeDropReferenceId] = useState<string | null>(null);
    const canvasReferences = useResolvedCanvasResourceReferences(references);
    const rawAssetReferences = useMemo(() => includeAssetLibrary ? buildAssetMentionReferences(assets) : [], [assets, includeAssetLibrary]);
    const assetReferences = useResolvedCanvasResourceReferences(rawAssetReferences);
    const activeCanvasReferences = useMemo(() => canvasReferences.filter((item) => item.active), [canvasReferences]);
    const availableReferences = useMemo(() => [...activeCanvasReferences, ...assetReferences], [activeCanvasReferences, assetReferences]);
    const candidates = useMemo(() => {
        if (!mention) return [];
        const query = mention.query.trim().toLowerCase();
        if (!query) return activeCanvasReferences;
        return availableReferences.filter((item) => `${item.label} ${item.title} ${item.kind} ${item.category || ""} ${item.text || ""}`.toLowerCase().includes(query));
    }, [activeCanvasReferences, availableReferences, mention]);
    const activeReferences = useMemo(() => {
        if (!highlightLabels) return [];
        return [...activeCanvasReferences, ...assetReferences.filter((item) => value.includes(canvasResourceMentionToken(item)))];
    }, [activeCanvasReferences, assetReferences, highlightLabels, value]);
    const useRichEditor = Boolean(activeReferences.length);
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
        if (!useRichEditor) return;
        const editor = editorRef.current;
        if (!editor || composingRef.current) return;
        const isFocused = document.activeElement === editor;
        const currentValue = serializeEditableValue(editor);
        if (currentValue === value && lastRenderedValueRef.current === value) {
            pendingSelectionRef.current = null;
            return;
        }
        const selection = pendingSelectionRef.current ?? (isFocused ? getEditableSelection(editor)?.start ?? null : null);
        renderEditableContent(editor, value, activeReferences);
        lastRenderedValueRef.current = value;
        if (isFocused && selection !== null) setEditableSelection(editor, selection);
        pendingSelectionRef.current = null;
        reportContentSize(editor);
    }, [activeReferences, reportContentSize, useRichEditor, value]);

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
            if (useRichEditor) {
                const editor = editorRef.current;
                if (!editor) return;
                editor.focus();
                if (typeof selectionStart === "number") setEditableSelection(editor, selectionStart);
                return;
            }
            textareaRef.current?.focus();
            if (typeof selectionStart === "number") textareaRef.current?.setSelectionRange(selectionStart, selectionStart);
        });
    };

    const updateValue = (next: string, selectionStart?: number) => {
        if (typeof selectionStart === "number") pendingSelectionRef.current = selectionStart;
        onChange(next);
        if (typeof selectionStart === "number") focusEditor(selectionStart);
    };

    const closeMention = () => {
        setMention(null);
        setActiveIndex(-1);
    };

    const syncMention = (nextValue: string, cursor: number) => {
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
        const insertText = `${canvasResourceMentionToken(reference)} `;
        const next = `${value.slice(0, mention.start)}${insertText}${value.slice(mention.end)}`;
        closeMention();
        updateValue(next, mention.start + insertText.length);
    };

    const replaceEditableSelection = (insertText: string) => {
        const currentValue = editorRef.current ? serializeEditableValue(editorRef.current) : value;
        const selection = getEditableSelection(editorRef.current) || { start: currentValue.length, end: currentValue.length };
        const next = `${currentValue.slice(0, selection.start)}${insertText}${currentValue.slice(selection.end)}`;
        const cursor = selection.start + insertText.length;
        updateValue(next, cursor);
        syncMention(next, cursor);
    };

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
        const cursor = getEditableSelection(editor)?.start;
        if (typeof cursor === "number") syncMention(serializeEditableValue(editor), cursor);
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
            connectedReferences={activeCanvasReferences}
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
                    style={{ ...mergedStyle, color: style?.color || theme.node.text }}
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
                        if (event.key === "Enter" && (event.nativeEvent.isComposing || composingRef.current)) return;
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
                            const shouldSubmit = sendOnEnter ? !event.ctrlKey && !event.metaKey && !event.shiftKey : (event.ctrlKey || event.metaKey) && !event.shiftKey;
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
                        if (event.relatedTarget instanceof Element && event.relatedTarget.closest("[data-canvas-resource-mention-menu]")) return;
                        window.setTimeout(() => {
                            if (document.activeElement?.closest("[data-canvas-resource-mention-menu]")) return;
                            closeMention();
                        }, 120);
                        props.onBlur?.(event as unknown as React.FocusEvent<HTMLTextAreaElement>);
                    }}
                >
                </div>
                {menu}
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
                style={mergedStyle}
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
                    props.onCompositionEnd?.(event);
                }}
                onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.nativeEvent.isComposing || composingRef.current)) return;
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
                    const shouldSubmit = event.key === "Enter" && (sendOnEnter ? !event.ctrlKey && !event.metaKey && !event.shiftKey : (event.ctrlKey || event.metaKey) && !event.shiftKey);
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
                    if (event.relatedTarget instanceof Element && event.relatedTarget.closest("[data-canvas-resource-mention-menu]")) return;
                    window.setTimeout(() => {
                        if (document.activeElement?.closest("[data-canvas-resource-mention-menu]")) return;
                        closeMention();
                    }, 120);
                    props.onBlur?.(event);
                }}
            />
            {menu}
        </div>
    );
});

function createInlineMentionChip(reference: CanvasResourceReference, token: string) {
    const chip = document.createElement("span");
    chip.contentEditable = "false";
    chip.dataset.mentionToken = token;
    chip.dataset.mentionReferenceId = reference.id;
    chip.className = "canvas-resource-inline-mention";

    const at = document.createElement("span");
    at.className = "canvas-resource-inline-at";
    at.textContent = "@";
    chip.appendChild(at);

    chip.appendChild(createInlinePreview(reference));

    const label = document.createElement("span");
    label.className = "canvas-resource-inline-label";
    label.textContent = reference.label;
    chip.appendChild(label);

    return chip;
}

function createInlinePreview(reference: CanvasResourceReference) {
    if ((reference.kind === "image" || reference.kind === "video" || reference.kind === "character") && reference.previewUrl) {
        const media = document.createElement(reference.kind === "video" ? "video" : "img");
        media.className = `canvas-resource-inline-preview is-${reference.kind}`;
        media.setAttribute("src", reference.previewUrl);
        media.setAttribute("alt", "");
        if (media instanceof HTMLVideoElement) {
            media.muted = true;
            media.preload = "metadata";
        }
        return media;
    }
    const fallback = document.createElement("span");
    fallback.className = "canvas-resource-inline-preview is-fallback";
    fallback.textContent = reference.sourceType === CanvasNodeType.Drawing ? "✎" : reference.kind === "audio" ? "♪" : reference.kind === "video" ? "▶" : reference.kind === "image" ? "□" : reference.kind === "skill" ? "✦" : "";
    return fallback;
}

const ASSET_CATEGORY_LABELS: Record<AssetCategory, string> = {
    character: "角色",
    environment: "场景",
    wardrobe: "服饰",
    prop: "道具",
    weapon: "武器",
    style: "画风",
    other: "其他",
};

function MentionMenu({ anchor, connectedReferences, assetReferences, filteredReferences, query, cursorOffset, activeReferenceId, preferredWidth, onQueryChange, onClose, onSelect }: {
    anchor: HTMLElement;
    connectedReferences: CanvasResourceReference[];
    assetReferences: CanvasResourceReference[];
    filteredReferences: CanvasResourceReference[];
    query: string;
    cursorOffset: number;
    activeReferenceId?: string;
    preferredWidth: number;
    onQueryChange: (query: string) => void;
    onClose: () => void;
    onSelect: (reference: CanvasResourceReference) => void;
}) {
    const menuRef = useRef<HTMLDivElement | null>(null);
    const selectedRef = useRef(false);
    const [category, setCategory] = useState<AssetCategory | null>(null);
    const [position, setPosition] = useState(() => mentionMenuPosition(anchor, cursorOffset, preferredWidth));

    useLayoutEffect(() => {
        let frame = 0;
        const updatePosition = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => setPosition(mentionMenuPosition(anchor, cursorOffset, preferredWidth)));
        };
        updatePosition();
        const observer = new ResizeObserver(updatePosition);
        observer.observe(anchor);
        window.addEventListener("resize", updatePosition);
        window.addEventListener("scroll", updatePosition, true);
        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
            window.removeEventListener("resize", updatePosition);
            window.removeEventListener("scroll", updatePosition, true);
        };
    }, [anchor, cursorOffset, preferredWidth]);

    const stopCanvasInteraction = (event: PointerEvent | MouseEvent) => {
        event.stopPropagation();
    };
    const selectReference = (reference: CanvasResourceReference) => {
        if (selectedRef.current) return;
        selectedRef.current = true;
        onSelect(reference);
    };
    const categoryItems = Object.entries(ASSET_CATEGORY_LABELS)
        .map(([value, label]) => ({ value: value as AssetCategory, label, count: assetReferences.filter((item) => item.category === value).length }))
        .filter((item) => item.count > 0);
    const connectedNodes = connectedReferences.filter((item) => item.kind !== "skill");
    const skillReferences = connectedReferences.filter((item) => item.kind === "skill");
    const visibleReferences = query
        ? filteredReferences
        : category
          ? assetReferences.filter((item) => item.category === category)
          : [];

    useLayoutEffect(() => {
        const closeOnOutsidePointer = (event: globalThis.PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node) || menuRef.current?.contains(target) || anchor.contains(target)) return;
            onClose();
        };
        window.addEventListener("pointerdown", closeOnOutsidePointer, true);
        return () => window.removeEventListener("pointerdown", closeOnOutsidePointer, true);
    }, [anchor, onClose]);

    return createPortal(
        <div
            ref={menuRef}
            data-canvas-resource-mention-menu="true"
            className="canvas-resource-mention-menu fixed z-[var(--z-tooltip)]"
            data-placement={position.showAbove ? "top" : "bottom"}
            style={{ left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight, transform: position.showAbove ? "translateY(-100%)" : undefined }}
            onPointerDown={stopCanvasInteraction}
            onMouseDown={stopCanvasInteraction}
            onClick={(event) => event.stopPropagation()}
        >
            <div className="canvas-resource-mention-search">
                <Search aria-hidden />
                <input
                    value={query}
                    placeholder="搜索节点、素材或技能"
                    aria-label="搜索引用素材"
                    onChange={(event) => onQueryChange(event.target.value)}
                    onPointerDown={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                        if (event.key === "Escape") {
                            event.preventDefault();
                            onClose();
                            anchor.focus();
                            return;
                        }
                        if (event.key === "Enter" && filteredReferences.length) {
                            event.preventDefault();
                            selectReference(filteredReferences[0]);
                        }
                    }}
                />
            </div>
            <div className="canvas-resource-mention-scroll thin-scrollbar">
                {query ? (
                    <MentionReferenceList references={visibleReferences} activeReferenceId={activeReferenceId} onSelect={selectReference} />
                ) : category ? (
                    <>
                        <button type="button" className="canvas-resource-mention-back" onClick={() => setCategory(null)}>
                            <ArrowLeft aria-hidden />
                            <span>{ASSET_CATEGORY_LABELS[category]}</span>
                            <small>{visibleReferences.length}</small>
                        </button>
                        <MentionReferenceList references={visibleReferences} activeReferenceId={activeReferenceId} onSelect={selectReference} />
                    </>
                ) : (
                    <>
                        {connectedNodes.length ? (
                            <section className="canvas-resource-mention-section">
                                <h4><span>已连接节点</span><small>{connectedNodes.length}</small></h4>
                                <MentionReferenceList references={connectedNodes} activeReferenceId={activeReferenceId} onSelect={selectReference} />
                            </section>
                        ) : null}
                        {skillReferences.length ? (
                            <section className="canvas-resource-mention-section">
                                <h4><span>技能库</span><small>{skillReferences.length}</small></h4>
                                <MentionReferenceList references={skillReferences} activeReferenceId={activeReferenceId} onSelect={selectReference} />
                            </section>
                        ) : null}
                        {categoryItems.length ? (
                            <section className="canvas-resource-mention-section">
                                <h4><span>素材库</span><small>{assetReferences.length}</small></h4>
                                {categoryItems.map((item) => (
                                    <button key={item.value} type="button" className="canvas-resource-mention-folder" onClick={() => setCategory(item.value)}>
                                        <Folder aria-hidden />
                                        <span>{item.label}</span>
                                        <small>{item.count}</small>
                                        <ChevronRight aria-hidden />
                                    </button>
                                ))}
                            </section>
                        ) : null}
                    </>
                )}
            </div>
        </div>,
        document.body,
    );
}

function MentionReferenceList({ references, activeReferenceId, onSelect }: { references: CanvasResourceReference[]; activeReferenceId?: string; onSelect: (reference: CanvasResourceReference) => void }) {
    if (!references.length) return <div className="canvas-resource-mention-empty">没有匹配的引用</div>;
    return references.map((reference) => (
        <button
            key={reference.id}
            type="button"
            className={`canvas-resource-mention-item ${reference.kind === "skill" ? "is-skill" : ""} ${reference.id === activeReferenceId ? "is-active" : ""}`}
            aria-selected={reference.id === activeReferenceId}
            onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onSelect(reference);
            }}
            onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onSelect(reference);
            }}
        >
            <ReferencePreview reference={reference} />
            <span className="canvas-resource-mention-copy">
                <span className="canvas-resource-mention-title-row"><strong title={reference.label}>{reference.label}</strong>{reference.kind === "skill" ? <em>技能</em> : null}</span>
                {reference.kind === "skill" ? (
                    <span className="canvas-resource-mention-meta"><span>{reference.skill?.description || reference.text || "工作流技能"}</span><small>{reference.skill?.version ? `v${reference.skill.version}` : ""}{reference.skill?.file_count ? ` · ${reference.skill.file_count} 文件` : ""}</small></span>
                ) : reference.text && reference.text !== reference.title ? <span className="canvas-resource-mention-meta"><span>{reference.text}</span></span> : null}
            </span>
        </button>
    ));
}

function ReferencePreview({ reference }: { reference: CanvasResourceReference }) {
    if (reference.kind === "image" && reference.previewUrl) return <img src={reference.previewUrl} alt="" className="canvas-resource-mention-preview is-image" />;
    if (reference.kind === "video" && reference.previewUrl) return <video src={reference.previewUrl} className="canvas-resource-mention-preview is-video" muted preload="metadata" />;
    if (reference.kind === "character" && reference.previewUrl) return <img src={reference.previewUrl} alt="" className="canvas-resource-mention-preview is-character" />;
    if (reference.kind === "skill") {
        return (
            <span className="canvas-resource-mention-preview is-skill">
                <Workflow aria-hidden />
            </span>
        );
    }
    const Icon = reference.sourceType === CanvasNodeType.Drawing ? Pencil : reference.kind === "character" ? UserRound : reference.kind === "audio" ? Music2 : reference.kind === "video" ? Video : reference.kind === "image" ? ImageIcon : FileText;
    return (
        <span className="canvas-resource-mention-preview is-fallback">
            <Icon aria-hidden />
        </span>
    );
}

function splitMentionText(value: string, references: CanvasResourceReference[]) {
    if (!references.length || !value) return value ? [{ type: "text", text: value } as MentionTextPart] : [];
    const referenceByToken = new Map<string, { reference: CanvasResourceReference; serializedToken: string }>();
    references.forEach((reference) => {
        const serializedToken = canvasResourceMentionToken(reference);
        referenceByToken.set(serializedToken, { reference, serializedToken });
        referenceByToken.set(`@${reference.label}`, { reference, serializedToken });
        if (reference.nodeId && !reference.assetId) referenceByToken.set(`@[node:${reference.nodeId}]`, { reference, serializedToken });
    });
    const tokens = [...referenceByToken.keys()].sort((a, b) => b.length - a.length);
    const parts: MentionTextPart[] = [];
    let index = 0;
    while (index < value.length) {
        const token = tokens.find((item) => value.startsWith(item, index) && hasMentionBoundary(value, index + item.length));
        if (!token) {
            const nextTokenIndex = findNextMentionIndex(value, tokens, index + 1);
            const end = nextTokenIndex < 0 ? value.length : nextTokenIndex;
            parts.push({ type: "text", text: value.slice(index, end) });
            index = end;
            continue;
        }
        const matched = referenceByToken.get(token)!;
        parts.push({ type: "mention", token: matched.serializedToken, reference: matched.reference });
        index += token.length;
    }
    return parts;
}

function renderEditableContent(editor: HTMLElement, value: string, references: CanvasResourceReference[]) {
    const parts = splitMentionText(value, references);
    const nodes = parts.map((part) => (part.type === "mention" ? createInlineMentionChip(part.reference, part.token) : document.createTextNode(part.text)));
    editor.replaceChildren(...nodes);
}

function findNextMentionIndex(value: string, tokens: string[], fromIndex: number) {
    let next = -1;
    tokens.forEach((token) => {
        const index = value.indexOf(token, fromIndex);
        if (index >= 0 && hasMentionBoundary(value, index + token.length) && (next < 0 || index < next)) next = index;
    });
    return next;
}

function hasMentionBoundary(value: string, index: number) {
    const char = value[index];
    return !char || /\s|[,.!?;:，。！？；：、)\]}】）]/.test(char);
}

function serializeEditableValue(root: HTMLElement) {
    return serializeNodeList(root.childNodes).replace(/\u00a0/g, " ");
}

function serializeNodeList(nodes: NodeListOf<ChildNode> | ChildNode[]) {
    let text = "";
    nodes.forEach((node) => {
        text += serializeNode(node);
    });
    return text;
}

function serializeNode(node: ChildNode): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
    if (!(node instanceof HTMLElement)) return "";
    const token = node.dataset.mentionToken;
    if (token) return token;
    if (node.tagName === "BR") return "\n";
    return serializeNodeList(node.childNodes);
}

function getEditableSelection(root: HTMLElement | null): EditableSelection | null {
    if (!root) return null;
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
    const start = offsetForPoint(root, range.startContainer, range.startOffset);
    const end = offsetForPoint(root, range.endContainer, range.endOffset);
    return start <= end ? { start, end } : { start: end, end: start };
}

function offsetForPoint(root: Node, target: Node, targetOffset: number): number {
    if (root === target) {
        if (root.nodeType === Node.TEXT_NODE) return targetOffset;
        return Array.from(root.childNodes)
            .slice(0, targetOffset)
            .reduce((offset, node) => offset + plainTextLength(node), 0);
    }
    let offset = 0;
    for (const child of Array.from(root.childNodes)) {
        if (child === target || child.contains(target)) return offset + offsetForPoint(child, target, targetOffset);
        offset += plainTextLength(child);
    }
    return offset;
}

function setEditableSelection(root: HTMLElement, offset: number) {
    const range = document.createRange();
    const point = pointForOffset(root, Math.max(0, offset));
    range.setStart(point.node, point.offset);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
}

function pointForOffset(root: Node, offset: number): { node: Node; offset: number } {
    if (root.nodeType === Node.TEXT_NODE) return { node: root, offset: Math.min(offset, root.textContent?.length || 0) };
    let remaining = offset;
    const children = Array.from(root.childNodes);
    for (let index = 0; index < children.length; index += 1) {
        const child = children[index];
        const length = plainTextLength(child);
        if (remaining > length) {
            remaining -= length;
            continue;
        }
        if (isMentionElement(child)) return { node: root, offset: remaining <= length / 2 ? index : index + 1 };
        return pointForOffset(child, remaining);
    }
    return { node: root, offset: children.length };
}

function plainTextLength(node: Node): number {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length || 0;
    if (node instanceof HTMLElement) {
        const token = node.dataset.mentionToken;
        if (token) return token.length;
        if (node.tagName === "BR") return 1;
    }
    return Array.from(node.childNodes).reduce((total, child) => total + plainTextLength(child), 0);
}

function isMentionElement(node: Node): node is HTMLElement {
    return node instanceof HTMLElement && Boolean(node.dataset.mentionToken);
}

type MentionAnchorRect = Pick<DOMRect, "left" | "right" | "top" | "bottom" | "width" | "height">;

function mentionMenuPosition(anchor: HTMLElement, cursorOffset: number, preferredWidth: number) {
    const caret = mentionCaretRect(anchor, cursorOffset);
    const boundary = anchor.closest(".ant-modal-container")?.getBoundingClientRect() || { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    const inset = 8;
    const gap = 8;
    const availableWidth = Math.max(0, boundary.right - boundary.left - inset * 2);
    const width = Math.min(preferredWidth, availableWidth);
    const left = clamp(caret.left, boundary.left + inset, boundary.right - width - inset);
    const spaceAbove = Math.max(0, caret.top - boundary.top - gap - inset);
    const spaceBelow = Math.max(0, boundary.bottom - caret.bottom - gap - inset);
    const showAbove = spaceBelow < 220 && spaceAbove > spaceBelow;
    const maxHeight = Math.min(320, showAbove ? spaceAbove : spaceBelow);
    const top = showAbove ? caret.top - gap : caret.bottom + gap;
    return { left, top, width, maxHeight, showAbove };
}

function mentionCaretRect(anchor: HTMLElement, cursorOffset: number): MentionAnchorRect {
    if (anchor instanceof HTMLTextAreaElement) return textareaCaretRect(anchor, cursorOffset);
    const point = pointForOffset(anchor, cursorOffset);
    const range = document.createRange();
    range.setStart(point.node, point.offset);
    range.collapse(true);
    const rangeRect = range.getClientRects()[0] || range.getBoundingClientRect();
    if (rangeRect && (rangeRect.height || rangeRect.width)) return rangeRect;
    return fallbackCaretRect(anchor);
}

function textareaCaretRect(textarea: HTMLTextAreaElement, cursorOffset: number): MentionAnchorRect {
    const rect = textarea.getBoundingClientRect();
    const computed = window.getComputedStyle(textarea);
    const mirror = document.createElement("div");
    const marker = document.createElement("span");
    const copiedProperties = [
        "boxSizing",
        "borderTopWidth",
        "borderRightWidth",
        "borderBottomWidth",
        "borderLeftWidth",
        "paddingTop",
        "paddingRight",
        "paddingBottom",
        "paddingLeft",
        "fontFamily",
        "fontSize",
        "fontStyle",
        "fontVariant",
        "fontWeight",
        "fontStretch",
        "lineHeight",
        "letterSpacing",
        "textAlign",
        "textIndent",
        "textTransform",
        "wordSpacing",
        "tabSize",
        "wordBreak",
        "overflowWrap",
    ] as const;
    copiedProperties.forEach((property) => {
        mirror.style[property] = computed[property];
    });
    Object.assign(mirror.style, {
        position: "fixed",
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: "auto",
        minHeight: "0",
        maxHeight: "none",
        overflow: "hidden",
        visibility: "hidden",
        pointerEvents: "none",
        whiteSpace: "pre-wrap",
        zIndex: "-1",
    });
    mirror.append(document.createTextNode(textarea.value.slice(0, Math.max(0, cursorOffset))));
    marker.textContent = "\u200b";
    mirror.append(marker);
    document.body.append(mirror);
    const markerRect = marker.getBoundingClientRect();
    mirror.remove();

    const lineHeight = Number.parseFloat(computed.lineHeight) || Number.parseFloat(computed.fontSize) * 1.4 || 20;
    const top = clamp(markerRect.top - textarea.scrollTop, rect.top, rect.bottom - lineHeight);
    const left = clamp(markerRect.left - textarea.scrollLeft, rect.left, rect.right);
    return { left, right: left, top, bottom: top + lineHeight, width: 0, height: lineHeight };
}

function fallbackCaretRect(anchor: HTMLElement): MentionAnchorRect {
    const rect = anchor.getBoundingClientRect();
    const computed = window.getComputedStyle(anchor);
    const lineHeight = Number.parseFloat(computed.lineHeight) || Number.parseFloat(computed.fontSize) * 1.4 || 20;
    const left = rect.left + Number.parseFloat(computed.paddingLeft || "0");
    const top = rect.top + Number.parseFloat(computed.paddingTop || "0");
    return { left, right: left, top, bottom: top + lineHeight, width: 0, height: lineHeight };
}

function clamp(value: number, min: number, max: number) {
    if (max < min) return min;
    return Math.min(Math.max(value, min), max);
}
