/**
 * 通知标题富文本编辑与通知条渲染之间的桥接层。
 *
 * 编辑器用 Tiptap 提供选区能力，但存储与渲染都只认 `BannerTitleRun[]`：
 * - 只保留一个 paragraph 与行内 `textStyle` 标记，标题永远是单段、单行语义。
 * - 字号 / 字体只接受白名单档位（其余值在转换时丢弃），因此不会把任意 CSS 写进通知条。
 */

import { Extension, type Editor, type JSONContent } from "@tiptap/core";
import CharacterCount from "@tiptap/extension-character-count";
import { Color } from "@tiptap/extension-color";
import Placeholder from "@tiptap/extension-placeholder";
import { FontFamily, FontSize, TextStyle } from "@tiptap/extension-text-style";
import { StarterKit } from "@tiptap/starter-kit";

import {
    BANNER_TITLE_FONT_FAMILIES,
    BANNER_TITLE_FONT_SIZES,
    BANNER_TITLE_FONT_WEIGHTS,
    bannerTitleFontFamilyCSS,
    bannerTitleFontFamilyKey,
    normalizeBannerTitleHex,
    normalizeBannerTitleRuns,
    type BannerTitleFontFamilyKey,
    type BannerTitleRun,
} from "./banner-title";

export const BANNER_TITLE_TEXT_STYLE = "textStyle";

/**
 * 字重没有官方扩展，按 FontSize 的写法把 fontWeight 挂到 textStyle 标记上。
 * 只声明属性，不下发命令：样式统一走 applyBannerTitleStyle，保证每个文本节点只留一个标记。
 */
export const BannerTitleFontWeight = Extension.create<{ types: string[] }>({
    name: "bannerTitleFontWeight",
    addOptions() {
        return { types: [BANNER_TITLE_TEXT_STYLE] };
    },
    addGlobalAttributes() {
        return [
            {
                types: this.options.types,
                attributes: {
                    fontWeight: {
                        default: null,
                        parseHTML: (element) => element.style.fontWeight || null,
                        renderHTML: (attributes) => (attributes.fontWeight ? { style: `font-weight: ${attributes.fontWeight}` } : {}),
                    },
                },
            },
        ];
    },
});

export function createBannerTitleExtensions(placeholder?: string) {
    return [
        StarterKit.configure({
            bold: false,
            blockquote: false,
            bulletList: false,
            code: false,
            codeBlock: false,
            dropcursor: false,
            gapcursor: false,
            hardBreak: false,
            heading: false,
            horizontalRule: false,
            italic: false,
            link: false,
            listItem: false,
            listKeymap: false,
            orderedList: false,
            strike: false,
            trailingNode: false,
            underline: false,
        }),
        TextStyle,
        FontSize,
        FontFamily,
        Color,
        BannerTitleFontWeight,
        CharacterCount,
        ...(placeholder ? [Placeholder.configure({ placeholder })] : []),
    ];
}

export type BannerTitleStylePatch = {
    fontSize?: number | null;
    fontWeight?: number | null;
    fontFamily?: BannerTitleFontFamilyKey | null;
    color?: string | null;
};

export type BannerTitleSelectionStyle = {
    fontSize?: number;
    fontWeight?: number;
    fontFamily?: BannerTitleFontFamilyKey;
    color?: string;
};

export function bannerTitleRunsToDoc(runs: BannerTitleRun[]): JSONContent {
    const content = [];
    for (const run of normalizeBannerTitleRuns(runs)) {
        const attrs = bannerTitleMarkAttrs(run);
        const node: JSONContent = { type: "text", text: run.text };
        if (Object.values(attrs).some((value) => value)) {
            node.marks = [{ type: BANNER_TITLE_TEXT_STYLE, attrs }];
        }
        content.push(node);
    }
    return { type: "doc", content: [{ type: "paragraph", content }] };
}

export function bannerDocToRuns(doc?: JSONContent | null): BannerTitleRun[] {
    const paragraph = (doc?.content || []).find((node) => node.type === "paragraph");
    const runs: BannerTitleRun[] = [];
    for (const node of paragraph?.content || []) {
        if (node.type !== "text" || !node.text) continue;
        const attrs = textStyleAttributes(node);
        const run: BannerTitleRun = { text: node.text };
        const size = Number(attrs.fontSize ? String(attrs.fontSize).replace(/[^\d]/g, "") : "");
        if (BANNER_TITLE_FONT_SIZES.includes(size)) run.fontSize = size;
        const weight = Number(String(attrs.fontWeight || "").replace(/[^\d]/g, ""));
        if (BANNER_TITLE_FONT_WEIGHTS.some((item) => item.value === weight)) run.fontWeight = weight;
        const family = bannerTitleFontFamilyKey(typeof attrs.fontFamily === "string" ? attrs.fontFamily : "");
        if (family && family !== "sans") run.fontFamily = family;
        const color = normalizeBannerTitleHex(typeof attrs.color === "string" ? attrs.color : "");
        if (color) run.color = color;
        runs.push(run);
    }
    return normalizeBannerTitleRuns(runs);
}

export function bannerTitleSelectionStyle(editor: Editor): BannerTitleSelectionStyle {
    const attrs = editor.getAttributes(BANNER_TITLE_TEXT_STYLE) as Record<string, unknown>;
    const selection: BannerTitleSelectionStyle = {};
    const size = Number(attrs.fontSize ? String(attrs.fontSize).replace(/[^\d]/g, "") : "");
    if (BANNER_TITLE_FONT_SIZES.includes(size)) selection.fontSize = size;
    const weight = Number(String(attrs.fontWeight || "").replace(/[^\d]/g, ""));
    if (BANNER_TITLE_FONT_WEIGHTS.some((item) => item.value === weight)) selection.fontWeight = weight;
    const family = bannerTitleFontFamilyKey(typeof attrs.fontFamily === "string" ? attrs.fontFamily : "");
    if (family && family !== "sans") selection.fontFamily = family;
    const color = normalizeBannerTitleHex(typeof attrs.color === "string" ? attrs.color : "");
    if (color) selection.color = color;
    return selection;
}

/**
 * 把样式片段应用到当前选区。
 *
 * 没有用 Tiptap 的 `setMark`：同一文本节点上它会叠加多个 textStyle 标记（属性不合并），
 * 反复调整会留下旧值。这里按节点先移除旧标记再写入合并后的属性，保证每个节点只有一个标记。
 */
export function applyBannerTitleStyle(editor: Editor, patch: BannerTitleStylePatch) {
    const textStyle = editor.state.schema.marks[BANNER_TITLE_TEXT_STYLE];
    if (!textStyle) return;
    const markPatch: Record<string, string | null> = {};
    if (patch.fontSize !== undefined) markPatch.fontSize = patch.fontSize ? `${patch.fontSize}px` : null;
    if (patch.fontWeight !== undefined) markPatch.fontWeight = patch.fontWeight ? String(patch.fontWeight) : null;
    if (patch.fontFamily !== undefined) markPatch.fontFamily = patch.fontFamily ? bannerTitleFontFamilyCSS(patch.fontFamily) || null : null;
    if (patch.color !== undefined) markPatch.color = patch.color ? normalizeBannerTitleHex(patch.color) || null : null;

    const { from, to, empty } = editor.state.selection;
    const transaction = editor.state.tr;
    if (empty) {
        transaction.addStoredMark(textStyle.create({ ...(editor.getAttributes(BANNER_TITLE_TEXT_STYLE) as Record<string, unknown>), ...markPatch }));
    } else {
        editor.state.doc.nodesBetween(from, to, (node, pos) => {
            if (!node.isText) return;
            const start = Math.max(pos, from);
            const end = Math.min(pos + node.nodeSize, to);
            if (start >= end) return;
            const attrs = textStyleAttributes(node);
            transaction.removeMark(start, end, textStyle);
            transaction.addMark(start, end, textStyle.create({ ...attrs, ...markPatch }));
        });
    }
    editor.view.dispatch(transaction);
}

export function clearBannerTitleStyle(editor: Editor) {
    const textStyle = editor.state.schema.marks[BANNER_TITLE_TEXT_STYLE];
    if (!textStyle) return;
    const { from, to, empty } = editor.state.selection;
    const transaction = editor.state.tr;
    if (empty) {
        transaction.removeStoredMark(textStyle);
    } else {
        transaction.removeMark(from, to, textStyle);
    }
    editor.view.dispatch(transaction);
}

function bannerTitleMarkAttrs(run: BannerTitleRun) {
    return {
        fontSize: run.fontSize ? `${run.fontSize}px` : null,
        fontWeight: run.fontWeight ? String(run.fontWeight) : null,
        fontFamily: bannerTitleFontFamilyCSS(run.fontFamily) || null,
        color: run.color || null,
    };
}

/**
 * 同一文本节点可能带有多个 textStyle 标记，按出现顺序合并，后写入的取最终值。
 * 标记来自两处：编辑器里的 ProseMirror 节点（`mark.type` 是 MarkType 对象）与 JSON 文档（`mark.type` 是字符串）。
 */
function textStyleAttributes(node: { marks?: readonly { type?: string | { name?: string }; attrs?: Record<string, unknown> }[] }) {
    const attrs: Record<string, unknown> = {};
    for (const mark of node.marks || []) {
        const name = typeof mark.type === "string" ? mark.type : mark.type?.name;
        if (name !== BANNER_TITLE_TEXT_STYLE) continue;
        Object.assign(attrs, mark.attrs || {});
    }
    return attrs;
}

export { BANNER_TITLE_FONT_FAMILIES };
