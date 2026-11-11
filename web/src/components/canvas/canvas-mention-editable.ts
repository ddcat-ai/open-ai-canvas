// contentEditable 与纯文本之间的双向映射：拆分令牌、序列化、光标偏移换算与选区读写。
//
// 所有偏移都以序列化后的纯文本为准，保证 @ 令牌在光标移动、粘贴、撤销时不被截断。

import { canvasResourceMentionToken, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import type { EditableSelection, MentionTextPart } from "./canvas-resource-mention-textarea";
import { createInlineMentionChip } from "./canvas-mention-chips";

const NAME_MENTION_BOUNDARY = /\s|[,.!?;:，。！？；：、)\]}】）]/u;
// contentEditable 无法在首个 contentEditable=false 节点前稳定放置光标。
// 零宽锚点只存在于编辑器 DOM，序列化和偏移计算会把它们忽略。
const CARET_ANCHOR = "\u200B";

function editableText(text: string) {
    return text.split(CARET_ANCHOR).join("");
}

/**
 * 令牌在 end 处结束是否成立：
 * - @[kind:...] 自带右括号，后面紧跟任何文字都不改变它指向谁；
 * - 以数字结尾的编号引用（@图片1、@参考图2、参考图3、@区域1）只要求后面不是数字，与生成侧解析一致；
 * - 其余名称引用（@技能名、@素材名）仍要求后面是空白或标点，避免“@猫咪”被认成“@猫”。
 */
export function hasMentionTokenBoundary(token: string, value: string, end: number) {
    const next = value[end];
    if (!next || (token.startsWith("@[") && token.endsWith("]"))) return true;
    if (/\d$/u.test(token)) return !/\d/u.test(next);
    return NAME_MENTION_BOUNDARY.test(next);
}

export function splitMentionText(value: string, references: CanvasResourceReference[]): MentionTextPart[] {
    if (!value) return [];
    if (!references.length) return [{ type: "text", text: value }];
    const referenceByToken = new Map<string, { reference: CanvasResourceReference; serializedToken: string }>();
    // 别名（@名称、@[node:ID]）先登记、规范令牌后登记：同名时别的引用不能抢走已有的规范令牌。
    references.forEach((reference) => {
        const serializedToken = canvasResourceMentionToken(reference);
        if (reference.label) referenceByToken.set(`@${reference.label}`, { reference, serializedToken });
        if (reference.nodeId && !reference.assetId) referenceByToken.set(`@[node:${reference.nodeId}]`, { reference, serializedToken });
    });
    references.forEach((reference) => {
        const serializedToken = canvasResourceMentionToken(reference);
        referenceByToken.set(serializedToken, { reference, serializedToken });
    });
    const tokens = [...referenceByToken.keys()].filter((token) => token.length > 1).sort((a, b) => b.length - a.length);
    const leadingCharacters = new Set(tokens.map((token) => token[0]));
    const parts: MentionTextPart[] = [];
    let textStart = 0;
    let index = 0;
    while (index < value.length) {
        const token = leadingCharacters.has(value[index]) ? tokens.find((item) => value.startsWith(item, index) && hasMentionTokenBoundary(item, value, index + item.length)) : undefined;
        if (!token) {
            index += 1;
            continue;
        }
        if (index > textStart) parts.push({ type: "text", text: value.slice(textStart, index) });
        const matched = referenceByToken.get(token)!;
        parts.push({ type: "mention", token: matched.serializedToken, reference: matched.reference });
        index += token.length;
        textStart = index;
    }
    if (textStart < value.length) parts.push({ type: "text", text: value.slice(textStart) });
    return parts;
}

export function renderEditableParts(editor: HTMLElement, parts: MentionTextPart[]) {
    const nodes = parts.flatMap((part) => (part.type === "mention" ? [document.createTextNode(CARET_ANCHOR), createInlineMentionChip(part.reference, part.token), document.createTextNode(CARET_ANCHOR)] : [document.createTextNode(part.text)]));
    editor.replaceChildren(...nodes);
}

export function renderEditableContent(editor: HTMLElement, value: string, references: CanvasResourceReference[]) {
    renderEditableParts(editor, splitMentionText(value, references));
}

/** 序列化文本不变时重画胶囊：选区按序列化偏移原样放回，滚动位置不跳。 */
export function redrawEditableParts(editor: HTMLElement, parts: MentionTextPart[], selection: EditableSelection | null) {
    const scrollTop = editor.scrollTop;
    renderEditableParts(editor, parts);
    if (selection) setEditableSelection(editor, selection.start, selection.end);
    editor.scrollTop = scrollTop;
}

type EditableLeaf = { node: Node; text: string; offset: number; token?: string };

/** 按文档顺序列出胶囊、文本和换行，并记下各自在序列化文本里的起点。 */
function editableLeaves(root: Node) {
    const leaves: EditableLeaf[] = [];
    let offset = 0;
    const visit = (node: Node) => {
        if (isMentionElement(node)) {
            const token = node.dataset.mentionToken || "";
            leaves.push({ node, text: token, offset, token });
            offset += token.length;
            return;
        }
        if (node.nodeType === Node.TEXT_NODE) {
            const text = editableText(node.textContent || "");
            leaves.push({ node, text, offset });
            offset += text.length;
            return;
        }
        if (node instanceof HTMLElement && node.tagName === "BR") {
            leaves.push({ node, text: "\n", offset });
            offset += 1;
            return;
        }
        node.childNodes.forEach(visit);
    };
    root.childNodes.forEach(visit);
    return leaves;
}

function mentionLayoutEntry(offset: number, referenceId: string, token: string) {
    return `${offset}\u0000${referenceId}\u0000${token}`;
}

/**
 * 文本没变、胶囊却与当前引用不符时返回应重画的片段，否则返回 null。
 * 引用晚到或被替换、手动输完 @图片1 后接着输入，都要把文字换成胶囊（或反过来）。
 * 光标处刚输完、DOM 里还是文字的令牌先保持文字，免得 @图片1 被提前锁成胶囊、输不出 @图片12。
 * 重画会改写序列化文本时（@素材名 这类别名要换成 @[asset:ID]）不在这里处理，留给下一次输入。
 */
export function staleEditableMentionParts(editor: HTMLElement, value: string, references: CanvasResourceReference[], caret: number | null = null) {
    const parts = splitMentionText(value, references);
    if (parts.map((part) => (part.type === "mention" ? part.token : part.text)).join("") !== value) return null;
    const current = editableLeaves(editor).flatMap((leaf) => (leaf.token === undefined ? [] : [mentionLayoutEntry(leaf.offset, (leaf.node as HTMLElement).dataset.mentionReferenceId || "", leaf.token)]));
    const existing = new Set(current);
    const expected: string[] = [];
    const next: MentionTextPart[] = [];
    let offset = 0;
    for (const part of parts) {
        const text = part.type === "mention" ? part.token : part.text;
        const entry = part.type === "mention" ? mentionLayoutEntry(offset, part.reference.id, part.token) : "";
        offset += text.length;
        if (part.type === "mention" && (caret !== offset || existing.has(entry))) {
            expected.push(entry);
            next.push(part);
            continue;
        }
        const previous = next[next.length - 1];
        if (previous?.type === "text") next[next.length - 1] = { type: "text", text: previous.text + text };
        else next.push({ type: "text", text });
    }
    if (expected.length === current.length && expected.every((entry, index) => entry === current[index])) return null;
    return next;
}

/**
 * 胶囊后紧贴的字会让令牌读成别的内容（@图片1 接“2”成了 @图片12，@技能名 接中文就不再是技能引用），
 * 这时在胶囊后补一个空格。光标正好停在胶囊右侧时留在空格前，继续退格仍能删掉胶囊。
 * 返回是否改动了 DOM。
 */
export function repairEditableMentionBoundaries(root: HTMLElement) {
    const leaves = editableLeaves(root);
    const glued = leaves.filter((leaf, index) => {
        if (leaf.token === undefined) return false;
        const following = leaves.slice(index + 1).find((item) => item.text.length > 0);
        return Boolean(following && !hasMentionTokenBoundary(leaf.token, following.text, 0));
    });
    if (!glued.length) return false;
    // 选区按补空格之前的偏移读取再统一平移；浏览器对活动选区的自动调整随插入位置而不同。
    const selection = getEditableSelection(root);
    const insertions = glued.map((leaf) => leaf.offset + leaf.text.length);
    glued.forEach((leaf) => (leaf.node as ChildNode).after(document.createTextNode(" ")));
    if (selection) {
        const shift = (offset: number) => offset + insertions.filter((position) => position < offset).length;
        setEditableSelection(root, shift(selection.start), shift(selection.end));
    }
    return true;
}

/** offset 正好落在某个胶囊右侧时返回该胶囊的令牌。 */
export function editableMentionTokenEndingAt(root: HTMLElement, offset: number) {
    return editableLeaves(root).find((leaf) => leaf.token !== undefined && leaf.offset + leaf.token.length === offset)?.token ?? null;
}

export function serializeEditableValue(root: HTMLElement) {
    return editableText(serializeNodeList(root.childNodes)).replace(/\u00a0/g, " ");
}

export function serializeNodeList(nodes: NodeListOf<ChildNode> | ChildNode[]) {
    let text = "";
    nodes.forEach((node) => {
        text += serializeNode(node);
    });
    return text;
}

export function serializeNode(node: ChildNode): string {
    if (node.nodeType === Node.TEXT_NODE) return editableText(node.textContent || "");
    if (!(node instanceof HTMLElement)) return "";
    const token = node.dataset.mentionToken;
    if (token) return token;
    if (node.tagName === "BR") return "\n";
    return serializeNodeList(node.childNodes);
}

/**
 * 选区对应的提示词原文：引用块输出它的 token（如“参考图6”“@[asset:id]”），只选中一部分的引用块也输出完整 token。
 * 浏览器原生复制会跳过 user-select:none 的引用文字并在块级子元素处插入换行，所以复制与剪切都要用它写剪贴板。
 * 选区为空或不在 root 内时返回 null，由浏览器按原生行为处理。
 */
export function serializeEditableSelection(root: HTMLElement | null): string | null {
    if (!root) return null;
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    if (range.collapsed || !root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
    const ancestor = range.commonAncestorContainer;
    const mention = (ancestor instanceof Element ? ancestor : ancestor.parentElement)?.closest<HTMLElement>("[data-mention-token]");
    if (mention && root.contains(mention)) return mention.dataset.mentionToken || "";
    // cloneContents 会带上被部分选中的引用块外壳（含 data-mention-token），serializeNode 按 token 输出。
    return serializeNodeList(Array.from(range.cloneContents().childNodes)).replace(/\u00a0/g, " ");
}

export function getEditableSelection(root: HTMLElement | null): EditableSelection | null {
    if (!root) return null;
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
    const start = offsetForPoint(root, range.startContainer, range.startOffset);
    const end = offsetForPoint(root, range.endContainer, range.endOffset);
    return start <= end ? { start, end } : { start: end, end: start };
}

export function offsetForPoint(root: Node, target: Node, targetOffset: number): number {
    if (root === target) {
        if (root.nodeType === Node.TEXT_NODE) return editableText((root.textContent || "").slice(0, targetOffset)).length;
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

export function setEditableSelection(root: HTMLElement, offset: number, endOffset = offset) {
    const range = document.createRange();
    const start = pointForOffset(root, Math.max(0, offset));
    range.setStart(start.node, start.offset);
    if (endOffset > offset) {
        const end = pointForOffset(root, endOffset);
        range.setEnd(end.node, end.offset);
    } else {
        range.collapse(true);
    }
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
}

export function pointForOffset(root: Node, offset: number): { node: Node; offset: number } {
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
        if (child.nodeType === Node.TEXT_NODE && editableText(child.textContent || "").length === 0 && child.textContent?.includes(CARET_ANCHOR)) return { node: child, offset: child.textContent.length };
        if (isMentionElement(child)) return { node: root, offset: remaining <= length / 2 ? index : index + 1 };
        return pointForOffset(child, remaining);
    }
    return { node: root, offset: children.length };
}

export function plainTextLength(node: Node): number {
    if (node.nodeType === Node.TEXT_NODE) return editableText(node.textContent || "").length;
    if (node instanceof HTMLElement) {
        const token = node.dataset.mentionToken;
        if (token) return token.length;
        if (node.tagName === "BR") return 1;
    }
    return Array.from(node.childNodes).reduce((total, child) => total + plainTextLength(child), 0);
}

export function isMentionElement(node: Node): node is HTMLElement {
    return node instanceof HTMLElement && Boolean(node.dataset.mentionToken);
}
