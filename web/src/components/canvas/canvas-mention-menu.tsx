// @ 引用候选菜单：分组列表或画廊网格、侧边大图预览、方向键导航与定位。

import { type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { Fragment, type MouseEvent, type PointerEvent, type RefObject, useLayoutEffect, useRef, useState } from "react";
import { type AssetCategory } from "@/stores/use-asset-store";
import { ASSET_CATEGORY_LABELS } from "@/lib/asset-category";
import { moveMentionMenuIndex, type MentionMenuDirection } from "@/lib/canvas/canvas-mention-menu-navigation";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ChevronRight, FileText, Folder, Image as ImageIcon, Music2, Pencil, Search, UserRound, Video, Workflow } from "lucide-react";
import { CanvasNodeType } from "@/types/canvas";
import { primeVideoPreviewFrame } from "./canvas-mention-chips";
import { pointForOffset } from "./canvas-mention-editable";
import { reportResourcePreviewFailure } from "./use-resolved-canvas-resource-references";
import { observeMovablePopupAnchor } from "@/lib/movable-popup-anchor";

// 菜单实际宽度放得下多列卡片和侧边大图时用画廊布局；Agent、批量表等窄菜单保持单列列表。
const GALLERY_MIN_WIDTH = 520;
const LIST_MAX_HEIGHT = 320;
const GALLERY_MAX_HEIGHT = 480;
// 光标下方剩余高度不足该值、且上方更宽裕时，菜单翻到光标上方。
const LIST_COMFORT_HEIGHT = 220;
const GALLERY_COMFORT_HEIGHT = 360;

export type MentionMenuKeyEvent = { key: string; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean };

/** 编辑器先把按键交给菜单；返回 true 表示菜单已处理，调用方应阻止默认行为。 */
export type MentionMenuKeyboard = { handleKeyDown: (event: MentionMenuKeyEvent) => boolean };

type MentionMenuEntry = { type: "reference"; key: string; reference: CanvasResourceReference } | { type: "folder"; key: string; category: AssetCategory; label: string; count: number };

type MentionMenuSection = { key: string; heading?: { label: string; count: number }; layout: "grid" | "list"; entries: MentionMenuEntry[] };

// 高亮记在当时的查询词和分类下，两者任一变化后自动失效，Enter 回到选第一项。
type MentionMenuActive = { query: string; category: AssetCategory | null; key: string; source: "keyboard" | "pointer" };

function referenceEntry(reference: CanvasResourceReference): MentionMenuEntry {
    return { type: "reference", key: `reference:${reference.id}`, reference };
}

function folderKey(category: AssetCategory) {
    return `folder:${category}`;
}

function folderEntry(category: AssetCategory, label: string, count: number): MentionMenuEntry {
    return { type: "folder", key: folderKey(category), category, label, count };
}

export function MentionMenu({
    anchor,
    connectedReferences,
    assetReferences,
    filteredReferences,
    query,
    cursorOffset,
    preferredWidth,
    keyboardRef,
    onQueryChange,
    onClose,
    onSelect,
    labels,
}: {
    /** 非画布场景（如图片区域）复用菜单时替换分组名和搜索提示。 */
    labels?: { connected?: string; search?: string };
    anchor: HTMLElement;
    connectedReferences: CanvasResourceReference[];
    assetReferences: CanvasResourceReference[];
    filteredReferences: CanvasResourceReference[];
    query: string;
    cursorOffset: number;
    preferredWidth: number;
    /** 编辑器按键入口：方向键、Enter/Tab、Esc 按菜单当前显示的候选处理。 */
    keyboardRef?: { current: MentionMenuKeyboard | null };
    onQueryChange: (query: string) => void;
    onClose: () => void;
    onSelect: (reference: CanvasResourceReference) => void;
}) {
    const { t } = useTranslation();
    const menuRef = useRef<HTMLDivElement | null>(null);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const activeElementRef = useRef<HTMLButtonElement | null>(null);
    const gridElementsRef = useRef(new Map<string, HTMLElement>());
    const selectedRef = useRef(false);
    const [category, setCategory] = useState<AssetCategory | null>(null);
    const [active, setActive] = useState<MentionMenuActive | null>(null);
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
        const stopMovingAnchor = observeMovablePopupAnchor(anchor, updatePosition);
        window.addEventListener("resize", updatePosition);
        window.addEventListener("scroll", updatePosition, true);
        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
            stopMovingAnchor();
            window.removeEventListener("resize", updatePosition);
            window.removeEventListener("scroll", updatePosition, true);
        };
    }, [anchor, cursorOffset, preferredWidth]);

    const searching = Boolean(query.trim());
    const gallery = position.gallery;
    const browsingCategory = category && !searching ? category : null;
    const connectedLabel = labels?.connected ?? t("canvasB.mention.canvasNodes");
    const mediaLayout = gallery ? "grid" : "list";
    const sections: MentionMenuSection[] = [];
    if (searching && gallery) {
        const media = filteredReferences.filter((item) => item.kind !== "skill");
        const skills = filteredReferences.filter((item) => item.kind === "skill");
        sections.push({ key: "results", layout: "grid", entries: media.map(referenceEntry) });
        sections.push({ key: "skills", heading: media.length ? { label: t("canvasB.mention.skillLibrary"), count: skills.length } : undefined, layout: "list", entries: skills.map(referenceEntry) });
    } else if (searching) {
        sections.push({ key: "results", layout: "list", entries: filteredReferences.map(referenceEntry) });
    } else if (category) {
        sections.push({ key: `category:${category}`, layout: mediaLayout, entries: assetReferences.filter((item) => item.category === category).map(referenceEntry) });
    } else {
        const connectedNodes = connectedReferences.filter((item) => item.kind !== "skill");
        const skills = connectedReferences.filter((item) => item.kind === "skill");
        const folders = Object.entries(ASSET_CATEGORY_LABELS).flatMap(([value, label]) => {
            const count = assetReferences.filter((item) => item.category === value).length;
            return count ? [folderEntry(value as AssetCategory, label, count)] : [];
        });
        sections.push({ key: "connected", heading: { label: connectedLabel, count: connectedNodes.length }, layout: mediaLayout, entries: connectedNodes.map(referenceEntry) });
        sections.push({ key: "skills", heading: { label: t("canvasB.mention.skillLibrary"), count: skills.length }, layout: "list", entries: skills.map(referenceEntry) });
        sections.push({ key: "assets", heading: { label: t("canvasB.mention.assetLibrary"), count: assetReferences.length }, layout: "list", entries: folders });
    }
    const visibleSections = sections.filter((section) => section.entries.length);
    const entries = visibleSections.flatMap((section) => section.entries);
    const activeKey = active && active.query === query && active.category === category ? active.key : null;
    const activeIndex = activeKey ? entries.findIndex((entry) => entry.key === activeKey) : -1;
    const activeEntry = activeIndex >= 0 ? entries[activeIndex] : undefined;

    // 换分类或查询词后从顶部看起；键盘高亮再按需滚进视野。
    useLayoutEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
    }, [category, query]);

    useLayoutEffect(() => {
        if (active?.source !== "keyboard") return;
        activeElementRef.current?.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    }, [active]);

    useLayoutEffect(() => {
        const closeOnOutsidePointer = (event: globalThis.PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node) || menuRef.current?.contains(target) || anchor.contains(target)) return;
            onClose();
        };
        window.addEventListener("pointerdown", closeOnOutsidePointer, true);
        return () => window.removeEventListener("pointerdown", closeOnOutsidePointer, true);
    }, [anchor, onClose]);

    const stopCanvasInteraction = (event: PointerEvent | MouseEvent) => {
        event.stopPropagation();
    };
    // 分类和返回按钮不抢编辑器焦点，点开分类后方向键仍然有效。
    const keepEditorFocus = (event: MouseEvent) => event.preventDefault();
    const selectReference = (reference: CanvasResourceReference) => {
        if (selectedRef.current) return;
        selectedRef.current = true;
        onSelect(reference);
    };
    const openCategory = (next: AssetCategory, source: MentionMenuActive["source"]) => {
        const first = assetReferences.find((item) => item.category === next);
        setCategory(next);
        setActive(source === "keyboard" && first ? { query, category: next, key: referenceEntry(first).key, source } : null);
    };
    const closeCategory = (source: MentionMenuActive["source"]) => {
        if (!category) return;
        setActive(source === "keyboard" ? { query, category: null, key: folderKey(category), source } : null);
        setCategory(null);
    };
    const activate = (entry: MentionMenuEntry | undefined) => {
        if (!entry) return false;
        if (entry.type === "folder") openCategory(entry.category, "keyboard");
        else selectReference(entry.reference);
        return true;
    };
    const moveActive = (direction: MentionMenuDirection) => {
        const layout = visibleSections.map((section) => ({ count: section.entries.length, columns: section.layout === "grid" ? gridColumnCount(gridElementsRef.current.get(section.key)) : 1 }));
        const next = entries[moveMentionMenuIndex(layout, activeIndex, direction)];
        if (next) setActive({ query, category, key: next.key, source: "keyboard" });
    };
    const handleKeyDown = (event: MentionMenuKeyEvent) => {
        const modified = event.shiftKey || event.altKey || event.ctrlKey || event.metaKey;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            if (modified || !entries.length) return false;
            moveActive(event.key === "ArrowDown" ? "down" : "up");
            return true;
        }
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            // 画廊里已经用方向键选中候选后才接管左右键，否则左右键照常移动光标、修改查询词。
            if (modified || !gallery || activeIndex < 0) return false;
            moveActive(event.key === "ArrowRight" ? "right" : "left");
            return true;
        }
        if (event.key === "Enter" || (event.key === "Tab" && !event.shiftKey)) return activate(activeEntry ?? entries[0]);
        if (event.key === "Escape") {
            if (browsingCategory) closeCategory("keyboard");
            else onClose();
            return true;
        }
        return false;
    };

    useLayoutEffect(() => {
        if (!keyboardRef) return;
        const keyboard = { handleKeyDown };
        keyboardRef.current = keyboard;
        return () => {
            if (keyboardRef.current === keyboard) keyboardRef.current = null;
        };
    });

    // 只认真实移动：键盘滚动列表时停在原处的指针不能把高亮抢走。
    const hoverEntry = (entry: MentionMenuEntry) => (event: PointerEvent<HTMLButtonElement>) => {
        if (event.pointerType === "touch" || (!event.movementX && !event.movementY) || entry.key === activeKey) return;
        setActive({ query, category, key: entry.key, source: "pointer" });
    };
    const gridRef = (key: string) => (element: HTMLDivElement | null) => {
        if (element) gridElementsRef.current.set(key, element);
        else gridElementsRef.current.delete(key);
    };
    const renderEntry = (entry: MentionMenuEntry, layout: MentionMenuSection["layout"]) => {
        const entryProps = { active: entry.key === activeKey, activeRef: activeElementRef, onPointerMove: hoverEntry(entry) };
        if (entry.type === "folder") return <MentionFolderRow key={entry.key} entry={entry} onOpen={(next) => openCategory(next, "pointer")} {...entryProps} />;
        if (layout === "grid") return <MentionReferenceCard key={entry.key} reference={entry.reference} onSelect={selectReference} {...entryProps} />;
        return <MentionReferenceRow key={entry.key} reference={entry.reference} onSelect={selectReference} {...entryProps} />;
    };
    const renderSection = (section: MentionMenuSection) => {
        const content =
            section.layout === "grid" ? (
                <div ref={gridRef(section.key)} className="canvas-resource-mention-grid">
                    {section.entries.map((entry) => renderEntry(entry, "grid"))}
                </div>
            ) : (
                section.entries.map((entry) => renderEntry(entry, "list"))
            );
        if (!section.heading) return <Fragment key={section.key}>{content}</Fragment>;
        return (
            <section key={section.key} className="canvas-resource-mention-section">
                <h4>
                    <span>{section.heading.label}</span>
                    <small>{section.heading.count}</small>
                </h4>
                {content}
            </section>
        );
    };

    const list = (
        <div ref={scrollRef} className="canvas-resource-mention-scroll thin-scrollbar">
            {browsingCategory ? (
                <button type="button" className="canvas-resource-mention-back" onMouseDown={keepEditorFocus} onClick={() => closeCategory("pointer")}>
                    <ArrowLeft aria-hidden />
                    <span>{ASSET_CATEGORY_LABELS[browsingCategory]}</span>
                    <small>{entries.length}</small>
                </button>
            ) : null}
            {entries.length ? visibleSections.map(renderSection) : <div className="canvas-resource-mention-empty">{t("canvasB.mention.noMatches")}</div>}
        </div>
    );

    return createPortal(
        <div
            ref={menuRef}
            data-canvas-resource-mention-menu="true"
            className={`canvas-resource-mention-menu pointer-events-auto fixed z-[var(--z-tooltip)] ${gallery ? "is-gallery" : ""}`}
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
                    placeholder={labels?.search ?? t("canvasB.mention.searchPlaceholder")}
                    aria-label={t("canvasB.mention.searchLabel")}
                    onChange={(event) => onQueryChange(event.target.value)}
                    onPointerDown={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                        if (event.nativeEvent.isComposing) return;
                        const closing = event.key === "Escape" && !browsingCategory;
                        if (!handleKeyDown(event)) return;
                        event.preventDefault();
                        event.stopPropagation();
                        if (closing) anchor.focus();
                    }}
                />
            </div>
            {gallery ? (
                <div className="canvas-resource-mention-body">
                    {list}
                    <MentionMenuDetail entry={activeEntry} connectedLabel={connectedLabel} keyHint={browsingCategory ? t("canvasB.mention.keyHintBack") : t("canvasB.mention.keyHint")} />
                </div>
            ) : (
                list
            )}
        </div>,
        // Keep the popup inside the dialog's focus and pointer-event boundary.
        anchor.closest(".ant-modal") || document.body,
    );
}

type MentionEntryProps = {
    active: boolean;
    activeRef: RefObject<HTMLButtonElement | null>;
    onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
};

function selectOnPress(reference: CanvasResourceReference, onSelect: (reference: CanvasResourceReference) => void) {
    // 按下即选中并阻止默认行为，焦点留在编辑器里，插入后光标位置不丢。
    return (event: PointerEvent | MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        onSelect(reference);
    };
}

function MentionReferenceRow({ reference, active, activeRef, onPointerMove, onSelect }: MentionEntryProps & { reference: CanvasResourceReference; onSelect: (reference: CanvasResourceReference) => void }) {
    const { t } = useTranslation();
    const select = selectOnPress(reference, onSelect);
    return (
        <button
            ref={active ? activeRef : null}
            type="button"
            className={`canvas-resource-mention-item ${reference.kind === "skill" ? "is-skill" : ""} ${active ? "is-active" : ""}`}
            data-asset-kind={reference.assetKind}
            aria-selected={active}
            onPointerDown={select}
            onClick={select}
            onPointerMove={onPointerMove}
        >
            <ReferencePreview reference={reference} />
            <span className="canvas-resource-mention-copy">
                <span className="canvas-resource-mention-title-row">
                    <strong title={reference.title}>{reference.displayLabel || reference.label}</strong>
                    {reference.assetKindLabel ? (
                        <span className="canvas-resource-mention-kind" data-asset-kind={reference.assetKind}>
                            {reference.assetKindLabel}
                        </span>
                    ) : null}
                    {reference.kind === "skill" ? <em>{t("canvasB.mention.skill")}</em> : null}
                </span>
                {reference.kind === "skill" ? (
                    <span className="canvas-resource-mention-meta">
                        <span>{reference.skill?.description || reference.text || t("canvasB.mention.workflowSkill")}</span>
                        <small>
                            {reference.skill?.version ? `v${reference.skill.version}` : ""}
                            {reference.skill?.fileCount ? t("canvasB.mention.fileCount", { count: reference.skill.fileCount }) : ""}
                        </small>
                    </span>
                ) : reference.text && reference.text !== reference.title ? (
                    <span className="canvas-resource-mention-meta">
                        <span>{reference.text}</span>
                    </span>
                ) : null}
            </span>
        </button>
    );
}

function MentionReferenceCard({ reference, active, activeRef, onPointerMove, onSelect }: MentionEntryProps & { reference: CanvasResourceReference; onSelect: (reference: CanvasResourceReference) => void }) {
    const select = selectOnPress(reference, onSelect);
    return (
        <button
            ref={active ? activeRef : null}
            type="button"
            className={`canvas-resource-mention-card ${active ? "is-active" : ""}`}
            data-asset-kind={reference.assetKind}
            aria-selected={active}
            onPointerDown={select}
            onClick={select}
            onPointerMove={onPointerMove}
        >
            <span className="canvas-resource-mention-card-media">
                <ReferencePreview reference={reference} />
            </span>
            <span className="canvas-resource-mention-card-label">{reference.displayLabel || reference.label}</span>
            {reference.assetKindLabel ? (
                <span className="canvas-resource-mention-card-kind">
                    <span className="canvas-resource-mention-kind" data-asset-kind={reference.assetKind}>
                        {reference.assetKindLabel}
                    </span>
                    <span>{reference.label}</span>
                </span>
            ) : null}
        </button>
    );
}

function MentionFolderRow({ entry, active, activeRef, onPointerMove, onOpen }: MentionEntryProps & { entry: Extract<MentionMenuEntry, { type: "folder" }>; onOpen: (category: AssetCategory) => void }) {
    return (
        <button
            ref={active ? activeRef : null}
            type="button"
            className={`canvas-resource-mention-folder ${active ? "is-active" : ""}`}
            aria-selected={active}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onOpen(entry.category)}
            onPointerMove={onPointerMove}
        >
            <Folder aria-hidden />
            <span>{entry.label}</span>
            <small>{entry.count}</small>
            <ChevronRight aria-hidden />
        </button>
    );
}

/** 画廊右侧：放大显示当前高亮的候选；没有高亮时提示怎么选。 */
function MentionMenuDetail({ entry, connectedLabel, keyHint }: { entry?: MentionMenuEntry; connectedLabel: string; keyHint: string }) {
    const { t } = useTranslation();
    return (
        <aside className="canvas-resource-mention-detail">
            {entry?.type === "reference" ? (
                <MentionReferenceDetail key={entry.key} reference={entry.reference} connectedLabel={connectedLabel} />
            ) : entry?.type === "folder" ? (
                <>
                    <div className="canvas-resource-mention-detail-media">
                        <Folder aria-hidden />
                    </div>
                    <div className="canvas-resource-mention-detail-caption">
                        <strong>{entry.label}</strong>
                        <small>{t("canvasB.mention.folderCount", { count: entry.count })}</small>
                    </div>
                </>
            ) : (
                <>
                    <div className="canvas-resource-mention-detail-media">
                        <ImageIcon aria-hidden />
                    </div>
                    <div className="canvas-resource-mention-detail-caption">
                        <span>{t("canvasB.mention.previewHint")}</span>
                    </div>
                </>
            )}
            <small className="canvas-resource-mention-detail-keys">{keyHint}</small>
        </aside>
    );
}

function MentionReferenceDetail({ reference, connectedLabel }: { reference: CanvasResourceReference; connectedLabel: string }) {
    const { t } = useTranslation();
    const [failedUrl, setFailedUrl] = useState("");
    const imageUrl = reference.kind === "skill" || reference.kind === "text" ? "" : reference.previewUrl || "";
    const videoUrl = !imageUrl && reference.kind === "video" ? reference.mediaUrl || "" : "";
    const Icon = referenceFallbackIcon(reference);
    const source = reference.assetId ? `${t("canvasB.mention.assetLibrary")} · ${ASSET_CATEGORY_LABELS[reference.category || "other"]}` : reference.kind === "skill" ? t("canvasB.mention.skillLibrary") : connectedLabel;
    const description = reference.kind === "skill" ? reference.skill?.description || reference.text || t("canvasB.mention.workflowSkill") : reference.title && reference.title !== reference.label ? reference.title : "";
    return (
        <>
            {reference.kind === "text" && reference.text ? (
                <div className="canvas-resource-mention-detail-media is-text">
                    <p>{reference.text}</p>
                </div>
            ) : (
                <div className="canvas-resource-mention-detail-media">
                    {imageUrl && failedUrl !== imageUrl ? (
                        <img
                            src={imageUrl}
                            alt=""
                            draggable={false}
                            decoding="async"
                            onError={() => {
                                setFailedUrl(imageUrl);
                                reportResourcePreviewFailure(imageUrl);
                            }}
                        />
                    ) : videoUrl ? (
                        <video src={videoUrl} muted playsInline preload="metadata" onLoadedMetadata={(event) => primeVideoPreviewFrame(event.currentTarget)} />
                    ) : (
                        <Icon aria-hidden />
                    )}
                </div>
            )}
            <div className="canvas-resource-mention-detail-caption">
                <strong>{reference.displayLabel || reference.label}</strong>
                {description ? <span>{description}</span> : null}
                <small>
                    {source}
                    {reference.skill?.version ? ` · v${reference.skill.version}` : ""}
                    {reference.skill?.fileCount ? t("canvasB.mention.fileCount", { count: reference.skill.fileCount }) : ""}
                </small>
            </div>
        </>
    );
}

function referenceFallbackIcon(reference: CanvasResourceReference) {
    if (reference.kind === "skill") return Workflow;
    if (reference.sourceType === CanvasNodeType.Drawing) return Pencil;
    if (reference.kind === "character") return UserRound;
    if (reference.kind === "audio") return Music2;
    if (reference.kind === "video") return Video;
    if (reference.kind === "image") return ImageIcon;
    return FileText;
}

export function ReferencePreview({ reference }: { reference: CanvasResourceReference }) {
    if (reference.kind === "image" && reference.previewUrl) return <img src={reference.previewUrl} alt="" className="canvas-resource-mention-preview is-image" loading="lazy" decoding="async" />;
    if (reference.kind === "video" && reference.previewUrl) return <img src={reference.previewUrl} alt="" className="canvas-resource-mention-preview is-video" loading="lazy" decoding="async" />;
    if (reference.kind === "video" && reference.mediaUrl) {
        return <video src={reference.mediaUrl} aria-hidden="true" muted playsInline preload="metadata" className="canvas-resource-mention-preview is-video" onLoadedMetadata={(event) => primeVideoPreviewFrame(event.currentTarget)} />;
    }
    if (reference.kind === "character" && reference.previewUrl) return <img src={reference.previewUrl} alt="" className="canvas-resource-mention-preview is-character" loading="lazy" decoding="async" />;
    if (reference.kind === "skill") {
        return (
            <span className="canvas-resource-mention-preview is-skill">
                <Workflow aria-hidden />
            </span>
        );
    }
    const Icon = referenceFallbackIcon(reference);
    return (
        <span className="canvas-resource-mention-preview is-fallback">
            <Icon aria-hidden />
        </span>
    );
}

/** 画廊网格的列数由 CSS auto-fill 决定，方向键按实际列数换行。 */
function gridColumnCount(element: HTMLElement | undefined) {
    if (!element || typeof window.getComputedStyle !== "function") return 1;
    const tracks = window.getComputedStyle(element).gridTemplateColumns.trim();
    return tracks && tracks !== "none" ? tracks.split(/\s+/).length : 1;
}

function prefersReducedMotion() {
    return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export type MentionAnchorRect = Pick<DOMRect, "left" | "right" | "top" | "bottom" | "width" | "height">;

export function mentionMenuPosition(anchor: HTMLElement, cursorOffset: number, preferredWidth: number) {
    const caret = mentionCaretRect(anchor, cursorOffset);
    const boundary = anchor.closest(".ant-modal-container")?.getBoundingClientRect() || { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    const inset = 8;
    const gap = 8;
    const availableWidth = Math.max(0, boundary.right - boundary.left - inset * 2);
    const width = Math.min(preferredWidth, availableWidth);
    const gallery = width >= GALLERY_MIN_WIDTH;
    const left = clamp(caret.left, boundary.left + inset, boundary.right - width - inset);
    const spaceAbove = Math.max(0, caret.top - boundary.top - gap - inset);
    const spaceBelow = Math.max(0, boundary.bottom - caret.bottom - gap - inset);
    const showAbove = spaceBelow < (gallery ? GALLERY_COMFORT_HEIGHT : LIST_COMFORT_HEIGHT) && spaceAbove > spaceBelow;
    const maxHeight = Math.min(gallery ? GALLERY_MAX_HEIGHT : LIST_MAX_HEIGHT, showAbove ? spaceAbove : spaceBelow);
    const top = showAbove ? caret.top - gap : caret.bottom + gap;
    return { left, top, width, maxHeight, showAbove, gallery };
}

export function mentionCaretRect(anchor: HTMLElement, cursorOffset: number): MentionAnchorRect {
    if (anchor instanceof HTMLTextAreaElement) return textareaCaretRect(anchor, cursorOffset);
    const point = pointForOffset(anchor, cursorOffset);
    const range = document.createRange();
    range.setStart(point.node, point.offset);
    range.collapse(true);
    const rangeRect = range.getClientRects()[0] || range.getBoundingClientRect();
    if (rangeRect && (rangeRect.height || rangeRect.width)) return rangeRect;
    return fallbackCaretRect(anchor);
}

export function textareaCaretRect(textarea: HTMLTextAreaElement, cursorOffset: number): MentionAnchorRect {
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

export function fallbackCaretRect(anchor: HTMLElement): MentionAnchorRect {
    const rect = anchor.getBoundingClientRect();
    const computed = window.getComputedStyle(anchor);
    const lineHeight = Number.parseFloat(computed.lineHeight) || Number.parseFloat(computed.fontSize) * 1.4 || 20;
    const left = rect.left + Number.parseFloat(computed.paddingLeft || "0");
    const top = rect.top + Number.parseFloat(computed.paddingTop || "0");
    return { left, right: left, top, bottom: top + lineHeight, width: 0, height: lineHeight };
}

export function clamp(value: number, min: number, max: number) {
    if (max < min) return min;
    return Math.min(Math.max(value, min), max);
}
