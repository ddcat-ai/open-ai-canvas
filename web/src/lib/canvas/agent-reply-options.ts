/**
 * Agent 回复末尾的“编号选项”识别。
 *
 * 模型常在回复最后列出 1./2./3. 让用户回复编号。这里把这种“可选的下一步”识别出来，
 * 由界面渲染成可点击卡片；识别不出时保持原文，不改变消息内容。
 *
 * 规则刻意保守，避免把普通的事实列表变成按钮：
 * - 列表必须在回复最末尾（之后最多一行“回复数字即可”或“你想先做哪个？”）；
 * - 编号从 1（或 A、①）连续，2-6 项，每项一行且较短，项之间没有说明段落；
 * - 列表前一句是问句，或带“选择 / 你想 / 要不要 / 你可以”等提示；
 *   “如下 / 我已 / 完成了”这类陈述引出的列表、“为什么”这类设问后的列表都不算选项。
 */

export type AgentReplyOption = {
    /** 卡片上显示的序号（1、2… 或 A、B…）。 */
    marker: string;
    /** 卡片主标题；选项写成“标题：说明”时拆开显示。 */
    title: string;
    detail?: string;
    /** 点击后发给 Agent 的文本：去掉 Markdown 标记的整条选项。 */
    text: string;
};

export type AgentReplyOptions = {
    /** 去掉末尾选项列表与“回复编号”提示后的正文。 */
    body: string;
    options: AgentReplyOption[];
};

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;
const MAX_OPTION_CHARS = 90;
const MAX_INLINE_OPTION_CHARS = 40;
const MAX_TAIL_CHARS = 80;
const MAX_SOURCE_CHARS = 20_000;

// 明确在让用户挑：出现即可。
const EXPLICIT_CHOICE = /(选择|选一|选哪|挑一|哪一|哪个|哪种|哪条|哪版|要不要|需不需要|是否需要|是否要|需要我|你想|您想|想先|你希望|您希望|希望我|可选|任选|回复|告诉我)/u;
// 在给下一步建议；陈述语气（如“我已经…如下”）时不算。
const SOFT_CHOICE = /(你可以|您可以|可以帮你|可以为你|我可以|下一步(?:可以|建议|你|您)|接下来(?:可以|你|您|建议)|后续可以|(?:建议|推荐)(?:你|您|下一步|接下来|先)|(?:几|两|三|四|五|[2-6])\s*(?:个|种|条|套)\s*(?:方向|方案|选项|思路|版本|做法))/u;
const STATEMENT = /(我会|我将|我已|已经|已完成|完成了|如下|以下是|做了|修改了|调整了|包括|分别是|原因|步骤)/u;
// 设问后面跟的是解释，不是选项。
const RHETORICAL = /(为什么|为何|原因|怎么回事|是什么|什么是|有哪些|区别)/u;
const TAIL_CHOICE = /((?:回复|输入|发送)[^。！？!?]{0,6}(?:数字|编号|序号|字母|对应)|选哪|选一|选择哪|哪一个|哪个|哪种|哪条|哪一项|哪一版)/u;
const REPLY_INSTRUCTION_PARENS = /[（(][^（）()]*(?:回复|输入|发送)[^（）()]*[）)]/gu;

type ParsedItem = { kind: "number" | "letter" | "circled"; value: number; raw: string };

function stripInlineMarkdown(text: string) {
    return text
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/\*\*|__|`/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function parseListItem(line: string): ParsedItem | null {
    // 缩进行是上一项的续行或子列表，不是选项。
    if (/^(?:\s{4,}|\t)/.test(line)) return null;
    let rest = line.replace(/^\s{0,3}(?:[-*+]\s+)?/, "");
    let leadingBold = "";
    if (rest.startsWith("**") || rest.startsWith("__")) {
        leadingBold = rest.slice(0, 2);
        rest = rest.slice(2);
    }
    let kind: ParsedItem["kind"];
    let value: number;
    let text: string;
    const numbered = /^(\d{1,2})\s*[.、．)）]\s*(.*)$/u.exec(rest);
    const lettered = numbered ? null : /^([A-F])\s*[.、．)）]\s*(.*)$/u.exec(rest);
    const circled = numbered || lettered ? null : /^([①-⑨])\s*(.*)$/u.exec(rest);
    const keycap = numbered || lettered || circled ? null : /^([1-9])\uFE0F?\u20E3\s*(.*)$/u.exec(rest);
    if (numbered) {
        kind = "number";
        value = Number(numbered[1]);
        text = numbered[2];
    } else if (lettered) {
        kind = "letter";
        value = lettered[1].charCodeAt(0) - 64;
        text = lettered[2];
    } else if (circled) {
        kind = "circled";
        value = circled[1].codePointAt(0)! - 0x245f;
        text = circled[2];
    } else if (keycap) {
        kind = "number";
        value = Number(keycap[1]);
        text = keycap[2];
    } else {
        return null;
    }
    text = text.trim();
    if (leadingBold) {
        // “**1.** 文本”只加粗了序号；“**1. 标题**：说明”加粗了序号和标题。
        text = text.startsWith(leadingBold) ? text.slice(2).trim() : `${leadingBold}${text}`;
    }
    if (!stripInlineMarkdown(text)) return null;
    return { kind, value, raw: text };
}

function markerLabel(kind: ParsedItem["kind"], index: number) {
    return kind === "letter" ? String.fromCharCode(64 + index) : String(index);
}

function splitTitle(raw: string): { title: string; detail?: string } {
    const bold = /^(?:\*\*|__)(.+?)(?:\*\*|__)\s*[：:—–\-，,]*\s*(.*)$/u.exec(raw);
    if (bold && stripInlineMarkdown(bold[1])) {
        const detail = stripInlineMarkdown(bold[2]);
        return { title: stripInlineMarkdown(bold[1]), detail: detail || undefined };
    }
    const plain = stripInlineMarkdown(raw);
    const separator = /[：:]|——|\s[—–-]\s/u.exec(plain);
    if (separator && separator.index > 0 && separator.index <= 30) {
        const title = plain.slice(0, separator.index).trim();
        const detail = plain.slice(separator.index + separator[0].length).trim();
        if (title && detail) return { title, detail };
    }
    return { title: plain };
}

function toOptions(items: readonly ParsedItem[], maxChars: number): AgentReplyOption[] | null {
    if (items.length < MIN_OPTIONS || items.length > MAX_OPTIONS) return null;
    const kind = items[0].kind;
    // 允许 Markdown 的“全部写 1.”懒编号；其余必须从 1 连续。
    const lazy = kind === "number" && items.every((item) => item.value === 1);
    const options: AgentReplyOption[] = [];
    for (const [index, item] of items.entries()) {
        if (item.kind !== kind || (!lazy && item.value !== index + 1)) return null;
        const text = stripInlineMarkdown(item.raw);
        if (!text || Array.from(text).length > maxChars) return null;
        options.push({ marker: markerLabel(kind, index + 1), ...splitTitle(item.raw), text });
    }
    return options;
}

function cleanLeadIn(line: string) {
    return line.replace(REPLY_INSTRUCTION_PARENS, "").trimEnd();
}

function plainLeadIn(line: string | undefined) {
    return stripInlineMarkdown(cleanLeadIn(line || "").replace(/^\s*#{1,6}\s+/, ""));
}

function leadInSignalsChoice(line: string | undefined) {
    const raw = cleanLeadIn(line || "").trim();
    const text = plainLeadIn(line);
    if (!text) return false;
    if (/[？?]$/u.test(text)) return EXPLICIT_CHOICE.test(text) || !RHETORICAL.test(text);
    // 标题或整行加粗的引导语常不带冒号，如“**下一步你可以**”。
    const heading = /^#{1,6}\s/.test(raw) || /^(?:\*\*|__).+(?:\*\*|__)[：:]?$/u.test(raw);
    if (!/[：:]$/u.test(text) && !heading) return false;
    if (EXPLICIT_CHOICE.test(text)) return true;
    return SOFT_CHOICE.test(text) && !STATEMENT.test(text);
}

function tailSignalsChoice(line: string | undefined) {
    return Boolean(line) && TAIL_CHOICE.test(stripInlineMarkdown(line || ""));
}

/** 列表前一句是提问/邀请，或列表后一句明确在问“选哪个”（且前一句不是陈述）。 */
function signalsChoice(leadIn: string | undefined, tail: string | undefined) {
    if (leadInSignalsChoice(leadIn)) return true;
    return tailSignalsChoice(tail) && !STATEMENT.test(plainLeadIn(leadIn));
}

/** “回复数字即可”这类说明在卡片出现后就多余了。 */
function isReplyInstruction(line: string) {
    const text = stripInlineMarkdown(line);
    return Array.from(text).length <= 40 && /(回复|输入|发送|直接说)/u.test(text) && /(数字|编号|序号|字母|选项|[1１一]\s*[/、,，]\s*[2２二])/u.test(text);
}

function insideCodeFence(lines: readonly string[]) {
    return lines.filter((line) => /^\s*(```|~~~)/.test(line)).length % 2 === 1;
}

function joinBody(lines: readonly string[], tail: string | undefined) {
    const parts = [lines.join("\n").trimEnd()];
    if (tail && !isReplyInstruction(tail)) parts.push(tail.trim());
    return parts.filter(Boolean).join("\n\n");
}

function extractBlockOptions(lines: readonly string[], last: number): AgentReplyOptions | null {
    let cursor = last;
    let tail: string | undefined;
    if (!parseListItem(lines[cursor])) {
        // 列表后只允许一句“回复数字即可”或追问；其他补充说明意味着列表不是回复的收尾。
        const candidate = lines[cursor];
        const plain = stripInlineMarkdown(candidate);
        if (/^\s/.test(candidate) || Array.from(plain).length > MAX_TAIL_CHARS) return null;
        if (!isReplyInstruction(candidate) && !tailSignalsChoice(candidate) && !/[？?]$/u.test(plain)) return null;
        tail = candidate.trim();
        cursor -= 1;
        while (cursor >= 0 && !lines[cursor].trim()) cursor -= 1;
    }
    const items: ParsedItem[] = [];
    while (cursor >= 0) {
        const line = lines[cursor];
        if (!line.trim()) {
            cursor -= 1;
            continue;
        }
        const item = parseListItem(line);
        if (!item) break;
        items.unshift(item);
        cursor -= 1;
    }
    const options = toOptions(items, MAX_OPTION_CHARS);
    if (!options) return null;
    const leadIn = cursor >= 0 ? lines[cursor] : undefined;
    const before = lines.slice(0, cursor + 1);
    if (insideCodeFence(before) || !signalsChoice(leadIn, tail)) return null;
    if (leadIn !== undefined) before[before.length - 1] = cleanLeadIn(leadIn);
    return { body: joinBody(before, tail), options };
}

/** 同一行里的“你可以：1. A；2. B；3. C”。 */
function extractInlineOptions(lines: readonly string[], last: number): AgentReplyOptions | null {
    let cursor = last;
    let tail: string | undefined;
    if (cursor > 0 && isReplyInstruction(lines[cursor])) {
        tail = lines[cursor].trim();
        cursor -= 1;
        while (cursor >= 0 && !lines[cursor].trim()) cursor -= 1;
        if (cursor < 0) return null;
    }
    const line = lines[cursor];
    const markers = [...line.matchAll(/(^|[\s：:；;，,。？?！!])(\d)\s*[.、．)）]\s*/gu)];
    const first = markers.findIndex((match) => match[2] === "1");
    if (first < 0) return null;
    const sequence = markers.slice(first);
    if (sequence.some((match, index) => Number(match[2]) !== index + 1)) return null;
    const starts = sequence.map((match) => match.index! + match[1].length);
    const items: ParsedItem[] = sequence.map((match, index) => {
        const contentStart = match.index! + match[0].length;
        const contentEnd = index + 1 < sequence.length ? starts[index + 1] : line.length;
        return { kind: "number", value: index + 1, raw: line.slice(contentStart, contentEnd).replace(/[；;，,。、\s]+$/u, "") };
    });
    const options = toOptions(items, MAX_INLINE_OPTION_CHARS);
    if (!options) return null;
    const sameLineLead = line.slice(0, starts[0]).trim();
    let leadIndex = cursor;
    if (!sameLineLead) {
        leadIndex = cursor - 1;
        while (leadIndex >= 0 && !lines[leadIndex].trim()) leadIndex -= 1;
    }
    const leadIn = sameLineLead || (leadIndex >= 0 ? lines[leadIndex] : undefined);
    const before = sameLineLead ? [...lines.slice(0, cursor), sameLineLead] : lines.slice(0, leadIndex + 1);
    if (insideCodeFence(before) || !signalsChoice(leadIn, tail)) return null;
    if (before.length) before[before.length - 1] = cleanLeadIn(before[before.length - 1]);
    return { body: joinBody(before, tail), options };
}

export function extractAgentReplyOptions(markdown: string): AgentReplyOptions | null {
    const source = markdown.replace(/\r\n?/g, "\n").trimEnd();
    if (!source || source.length > MAX_SOURCE_CHARS) return null;
    const lines = source.split("\n");
    const last = lines.length - 1;
    return extractBlockOptions(lines, last) || extractInlineOptions(lines, last);
}
