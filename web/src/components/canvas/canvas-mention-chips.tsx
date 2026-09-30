// @ 引用在可编辑区域里的行内胶囊（chip）与预览缩略图。
//
// 胶囊是 contentEditable 内的 DOM 节点，序列化时还原成 @[kind:id] 令牌；这里只负责渲染。

import { Brush, Camera, Clapperboard, Clock, Contrast, FastForward, Globe2, Grid2x2, Grid3x3, Package, Palette, PersonStanding, Rewind, ScanFace, SlidersHorizontal, Sparkles, Sun } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { createPortal } from "react-dom";
import { CanvasNodeType } from "@/types/canvas";

export const TOOL_ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
    Brush,
    Camera,
    Clapperboard,
    Clock,
    Contrast,
    FastForward,
    Globe2,
    Grid2x2,
    Grid3x3,
    Package,
    Palette,
    PersonStanding,
    Rewind,
    ScanFace,
    SlidersHorizontal,
    Sparkles,
    Sun,
};

export function toolIconSvg(iconName: string): string {
    const Icon = TOOL_ICON_MAP[iconName];
    if (!Icon) return "🔧";
    return renderToStaticMarkup(<Icon className="size-3" />);
}

export function createInlineMentionChip(reference: CanvasResourceReference, token: string) {
    const chip = document.createElement("span");
    chip.contentEditable = "false";
    chip.dataset.mentionToken = token;
    chip.dataset.mentionReferenceId = reference.id;
    const isDecorated = reference.kind === "skill" || reference.kind === "tool";
    chip.className = `canvas-resource-inline-mention ${isDecorated ? `is-${reference.kind}` : ""}`;
    chip.title = "双击放大预览";
    if (reference.kind === "skill") chip.style.setProperty("--canvas-skill-mention-color", skillMentionColor(reference));
    if (reference.kind === "tool") chip.style.setProperty("--canvas-skill-mention-color", skillMentionColor(reference));

    const prefix = document.createElement("span");
    prefix.className = isDecorated ? "canvas-resource-inline-skill-icon" : "canvas-resource-inline-at";
    if (reference.kind === "skill") {
        prefix.textContent = "✦";
    } else if (reference.kind === "tool") {
        prefix.innerHTML = toolIconSvg(reference.toolIcon ?? "Grid3x3");
    } else {
        prefix.textContent = "@";
    }
    chip.appendChild(prefix);

    // Skill/tool chip 的前缀已经承担图标职责，不再追加 fallback preview，避免出现两个图标。
    if (!isDecorated) chip.appendChild(createInlinePreview(reference));

    const label = document.createElement("span");
    label.className = "canvas-resource-inline-label";
    label.textContent = reference.label;
    chip.appendChild(label);

    return chip;
}

export const SKILL_MENTION_COLORS = ["#8b5cf6", "#0ea5e9", "#14b8a6", "#f59e0b", "#ec4899", "#84cc16", "#f97316", "#06b6d4"];

export function skillMentionColor(reference: CanvasResourceReference) {
    const key = reference.skill?.skillId || reference.id;
    let hash = 0;
    for (const character of key) hash = (hash * 31 + character.charCodeAt(0)) | 0;
    return SKILL_MENTION_COLORS[Math.abs(hash) % SKILL_MENTION_COLORS.length];
}

export function referencePreviewUrl(reference: CanvasResourceReference) {
    return reference.previewUrl || (reference.kind === "video" ? reference.mediaUrl : "") || "";
}

export function InlineReferencePreview({ reference, onClose }: { reference: CanvasResourceReference; onClose: () => void }) {
    const url = referencePreviewUrl(reference);
    if (!url) return null;
    return createPortal(
        <div className="fixed inset-0 z-[var(--z-dialog-popover)] grid place-items-center bg-black/80 p-6" role="dialog" aria-label={`预览${reference.label}`} onClick={onClose}>
            <div className="relative max-h-[92vh] max-w-[92vw]" onClick={(event) => event.stopPropagation()}>
                <img src={url} alt={reference.label} className="max-h-[88vh] max-w-[88vw] rounded-xl object-contain shadow-2xl" />
                <button type="button" className="absolute -right-3 -top-3 rounded-full bg-black/75 p-2 text-white shadow-lg" onClick={onClose} aria-label="关闭图片预览">
                    ×
                </button>
            </div>
        </div>,
        document.body,
    );
}

export function createInlinePreview(reference: CanvasResourceReference) {
    if ((reference.kind === "image" || reference.kind === "video" || reference.kind === "character") && reference.previewUrl) {
        const media = document.createElement("img");
        media.className = `canvas-resource-inline-preview is-${reference.kind}`;
        media.setAttribute("src", reference.previewUrl);
        media.setAttribute("alt", "");
        return media;
    }
    if (reference.kind === "video" && reference.mediaUrl) {
        const media = document.createElement("video");
        media.className = "canvas-resource-inline-preview is-video";
        media.setAttribute("src", reference.mediaUrl);
        media.setAttribute("aria-hidden", "true");
        media.muted = true;
        media.playsInline = true;
        media.preload = "metadata";
        media.onloadedmetadata = () => primeVideoPreviewFrame(media);
        return media;
    }
    const fallback = document.createElement("span");
    fallback.className = "canvas-resource-inline-preview is-fallback";
    fallback.textContent = reference.sourceType === CanvasNodeType.Drawing ? "✎" : reference.kind === "audio" ? "♪" : reference.kind === "video" ? "▶" : reference.kind === "image" ? "□" : reference.kind === "skill" ? "✦" : "";
    return fallback;
}

/** Resource URLs resolve independently of prompt text; keep chips fresh without replacing the editable selection. */
export function syncInlineMentionPreviews(editor: HTMLElement, references: CanvasResourceReference[]) {
    const byId = new Map(references.map((reference) => [reference.id, reference]));
    editor.querySelectorAll<HTMLElement>("[data-mention-reference-id]").forEach((chip) => {
        const reference = byId.get(chip.dataset.mentionReferenceId || "");
        if (!reference) return;
        const preview = chip.querySelector(".canvas-resource-inline-preview");
        const hasImage = ["image", "video", "character"].includes(reference.kind) && Boolean(reference.previewUrl);
        const hasVideo = !hasImage && reference.kind === "video" && Boolean(reference.mediaUrl);
        const tag = hasImage ? "IMG" : hasVideo ? "VIDEO" : "SPAN";
        const className = `canvas-resource-inline-preview is-${hasImage || hasVideo ? reference.kind : "fallback"}`;
        const src = hasImage ? reference.previewUrl : hasVideo ? reference.mediaUrl : null;
        if (preview && (preview.tagName !== tag || preview.className !== className || preview.getAttribute("src") !== src)) {
            preview.replaceWith(createInlinePreview(reference));
        }
        const label = chip.querySelector(".canvas-resource-inline-label");
        if (label && label.textContent !== reference.label) label.textContent = reference.label;
    });
}

export function primeVideoPreviewFrame(video: HTMLVideoElement) {
    if (video.currentTime !== 0 || !Number.isFinite(video.duration) || video.duration <= 0) return;
    try {
        // Metadata-only loading does not paint a frame consistently across browsers.
        // Seeking a tiny amount keeps this preview passive while forcing first-frame decode.
        video.currentTime = Math.min(0.001, video.duration);
    } catch {
        // A transient media error should leave the fallback element usable.
    }
}
