import type { JSONContent } from "@tiptap/core";
import type { CanvasDocumentChapter, CanvasRichDocument } from "@/types/canvas";

export function emptyDocument(): JSONContent {
    return { type: "doc", content: [{ type: "paragraph" }] };
}

export function textToDocument(text: string): JSONContent {
    const content = text.split(/\n{2,}/).map((paragraph) => {
        const value = paragraph.trim();
        if (!value) return { type: "paragraph" };
        const markdownHeading = /^(#{1,3})\s+(.+)$/.exec(value);
        if (markdownHeading) return { type: "heading", attrs: { level: markdownHeading[1].length }, content: [{ type: "text", text: markdownHeading[2] }] };
        return { type: "paragraph", content: [{ type: "text", text: value }] };
    });
    return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

export function createDocumentChapter(title: string, plainText = "", order = 0): CanvasDocumentChapter {
    return {
        id: `chapter-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title,
        order,
        json: textToDocument(plainText) as unknown as Record<string, unknown>,
        plainText: plainText.trim(),
        characterCount: Array.from(plainText.trim()).length,
        storyboardStatus: "idle",
        updatedAt: new Date().toISOString(),
    };
}

export function normalizeDocumentChapters(document: CanvasRichDocument | undefined, fallbackText = "") {
    if (document?.chapters?.length) {
        return document.chapters
            .map((chapter, index) => ({ ...chapter, title: chapter.title.trim() || `第 ${index + 1} 章`, order: index }))
            .sort((left, right) => left.order - right.order);
    }
    const chapter = createDocumentChapter("第 1 章", document?.plainText || fallbackText, 0);
    if (document?.json) chapter.json = document.json;
    return [chapter];
}

export function splitTextIntoChapters(text: string) {
    const normalized = text.replace(/\r\n?/g, "\n").trim();
    if (!normalized) return [createDocumentChapter("第 1 章")];
    const lines = normalized.split("\n");
    const headingPattern = /^\s*(第[零〇一二两三四五六七八九十百千万\d]+[章节卷回部篇]|chapter\s+\d+\b|序章|楔子|引子|尾声|后记)(?:[\s：:.-]+.*)?\s*$/i;
    const sections: Array<{ title: string; lines: string[] }> = [];
    let current: { title: string; lines: string[] } | null = null;
    const preface: string[] = [];

    for (const line of lines) {
        if (headingPattern.test(line.trim())) {
            if (current) sections.push(current);
            current = { title: line.trim(), lines: [] };
            continue;
        }
        if (current) current.lines.push(line);
        else preface.push(line);
    }
    if (current) sections.push(current);
    if (!sections.length) return [createDocumentChapter("第 1 章", normalized, 0)];
    if (preface.some((line) => line.trim())) sections.unshift({ title: "序章", lines: preface });
    return sections.map((section, index) => createDocumentChapter(section.title, section.lines.join("\n").trim(), index));
}

export function buildRichDocument(
    previous: CanvasRichDocument | undefined,
    chapters: CanvasDocumentChapter[],
    activeChapterId: string,
    sourceFileName?: string,
): CanvasRichDocument {
    const ordered = chapters.map((chapter, index) => ({ ...chapter, order: index }));
    const active = ordered.find((chapter) => chapter.id === activeChapterId) || ordered[0];
    const plainText = ordered.map((chapter) => `${chapter.title}\n\n${chapter.plainText}`.trim()).filter(Boolean).join("\n\n");
    return {
        kind: previous?.kind || "novel",
        format: "tiptap-json",
        json: active?.json || (emptyDocument() as unknown as Record<string, unknown>),
        plainText,
        characterCount: ordered.reduce((total, chapter) => total + chapter.characterCount, 0),
        chapters: ordered,
        activeChapterId: active?.id,
        sourceFileName,
        updatedAt: new Date().toISOString(),
    };
}
