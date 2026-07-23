import type { JSONContent } from "@tiptap/core";
import type { CanvasDocumentChapter, CanvasRichDocument } from "@/types/canvas";

const maxChapterHeadingLength = 120;
const chineseChapterNumber = "[零〇○一二两三四五六七八九十百千万亿壹贰叁肆伍陆柒捌玖拾佰仟\\d]+";
const englishChapterNumber = "(?:\\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)";
const chapterTitleSuffix = "(?:\\s*[-—–:：·.]\\s*.*|\\s+.*)?";
const chapterHeadingPatterns = [
    new RegExp(`^(?:正文\\s*)?第\\s*${chineseChapterNumber}\\s*[章节卷回部篇集季幕]${chapterTitleSuffix}$`, "i"),
    new RegExp(`^(?:卷|篇|部|集|季|幕)\\s*${chineseChapterNumber}${chapterTitleSuffix}$`, "i"),
    new RegExp(`^(?:序|序幕|序章|序言|前言|前记|楔子|引子|引言|开篇|终章|尾声|后记)${chapterTitleSuffix}$`, "i"),
    new RegExp(`^(?:番外(?:篇)?|附录)(?:\\s*(?:第\\s*)?${chineseChapterNumber}\\s*[章节回篇]?)?${chapterTitleSuffix}$`, "i"),
    new RegExp(`^(?:chapter|book|part|volume)\\s+${englishChapterNumber}\\b${chapterTitleSuffix}$`, "i"),
    new RegExp(`^(?:prologue|preface|introduction|epilogue|afterword|appendix)${chapterTitleSuffix}$`, "i"),
];

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

function chapterTitleFromLine(line: string) {
    const trimmed = line.trim();
    if (!trimmed || Array.from(trimmed).length > maxChapterHeadingLength) return null;

    const title = trimmed
        .replace(/^[#＃]{1,6}\s*/, "")
        .replace(/^[\s=_*~\-—–]+|[\s=_*~\-—–]+$/g, "")
        .trim();
    const candidate = title
        .normalize("NFKC")
        .replace(/[【】\[\]「」『』〈〉《》〖〗]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    // 只把较短且整行符合章节结构的文本当作标题，避免正文中提到“第一章”时误切分。
    return chapterHeadingPatterns.some((pattern) => pattern.test(candidate)) ? title : null;
}

export function decodeNovelText(buffer: ArrayBuffer) {
    const bytes = new Uint8Array(buffer);
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder("utf-8").decode(bytes.subarray(3));
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));

    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
        // 中文网文 TXT 常由旧版编辑器导出为 GBK；GB18030 兼容 GBK，并能覆盖更多汉字。
        return new TextDecoder("gb18030").decode(bytes);
    }
}

export function splitTextIntoChapters(text: string) {
    const normalized = text.replace(/\r\n?/g, "\n").trim();
    if (!normalized) return [createDocumentChapter("第 1 章")];
    const lines = normalized.split("\n");
    const sections: Array<{ title: string; lines: string[] }> = [];
    let current: { title: string; lines: string[] } | null = null;
    const preface: string[] = [];

    for (const line of lines) {
        const chapterTitle = chapterTitleFromLine(line);
        if (chapterTitle) {
            if (current) sections.push(current);
            current = { title: chapterTitle, lines: [] };
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
