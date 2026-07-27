import type { JSONContent } from "@tiptap/core";
import { generateHTML } from "@tiptap/core";
import CharacterCount from "@tiptap/extension-character-count";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import StarterKit from "@tiptap/starter-kit";

export function createCanvasRichTextExtensions(placeholder?: string) {
    return [
        StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false, autolink: true } }),
        TextAlign.configure({ types: ["heading", "paragraph"] }),
        TextStyle,
        Color.configure({ types: ["textStyle"] }),
        Highlight.configure({ multicolor: true }),
        CharacterCount,
        ...(placeholder ? [Placeholder.configure({ placeholder })] : []),
    ];
}

export function canvasRichTextHTML(document?: Record<string, unknown>) {
    if (!document) return "";
    try {
        // 仅接受 Tiptap 结构化 JSON，不启用原始 HTML；输出链接再按协议收口。
        const template = window.document.createElement("template");
        template.innerHTML = generateHTML(document as JSONContent, createCanvasRichTextExtensions());
        template.content.querySelectorAll("a[href]").forEach((link) => {
            if (!isSafeCanvasRichTextLink(link.getAttribute("href") || "")) link.removeAttribute("href");
        });
        return template.innerHTML;
    } catch {
        return "";
    }
}

export function isSafeCanvasRichTextLink(href: string) {
    const value = href.trim();
    if (!value) return false;
    try {
        const url = new URL(value, window.location.origin);
        return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol);
    } catch {
        return false;
    }
}
