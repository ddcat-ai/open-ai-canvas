// SKILL.md 头部 YAML frontmatter 的拆分与最小解析。
// 不直接交给 ReactMarkdown：结尾的 --- 会把元数据段落渲染成 setext 二级标题。
// 只支持技能入口常见写法（key: value、引号、| / > 多行块、缩进子项）；遇到无法识别的行返回 entries=null，由调用方展示原文。

export type SkillFrontmatterEntry = { key: string; value: string };

export type SkillFrontmatter = {
    /** frontmatter 原文（不含首尾 ---） */
    raw: string;
    /** 解析结果；无法按简单 key: value 解析时为 null */
    entries: SkillFrontmatterEntry[] | null;
};

const FRONTMATTER_PATTERN = /^\uFEFF?---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;
const KEY_LINE = /^([A-Za-z0-9_][\w.-]*)[ \t]*:(?:[ \t]+(.*)|[ \t]*)$/;

export function splitSkillFrontmatter(source: string): { frontmatter: SkillFrontmatter | null; body: string } {
    const match = FRONTMATTER_PATTERN.exec(source);
    if (!match) return { frontmatter: null, body: source };
    const raw = match[1] || "";
    return { frontmatter: { raw, entries: parseSkillFrontmatter(raw) }, body: source.slice(match[0].length) };
}

function unquote(value: string): string {
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
        return value.slice(1, -1).replace(/\\(["\\nt])/g, (_, char: string) => (char === "n" ? "\n" : char === "t" ? "\t" : char));
    }
    if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
    return value;
}

function dedent(lines: string[]): string[] {
    const indents = lines.filter((line) => line.trim()).map((line) => line.length - line.trimStart().length);
    const minIndent = indents.length ? Math.min(...indents) : 0;
    return lines.map((line) => line.slice(minIndent));
}

export function parseSkillFrontmatter(raw: string): SkillFrontmatterEntry[] | null {
    const lines = raw.split(/\r?\n/);
    const entries: SkillFrontmatterEntry[] = [];
    let index = 0;
    while (index < lines.length) {
        const line = lines[index];
        if (!line.trim() || line.trimStart().startsWith("#")) {
            index += 1;
            continue;
        }
        if (/^\s/.test(line)) return null;
        const match = KEY_LINE.exec(line);
        if (!match) return null;
        const key = match[1];
        const rawInline = (match[2] || "").trim();
        const inline = /^["']/.test(rawInline) ? rawInline : rawInline.replace(/\s+#.*$/, "").trim();
        // 收集后续缩进行：多行块（| / >）或嵌套子项。
        const nested: string[] = [];
        let next = index + 1;
        while (next < lines.length && (!lines[next].trim() || /^\s/.test(lines[next]))) {
            nested.push(lines[next]);
            next += 1;
        }
        while (nested.length && !nested[nested.length - 1].trim()) nested.pop();
        const block = dedent(nested);
        let value: string;
        if (/^[|>][+-]?$/.test(inline)) {
            value = inline.startsWith("|")
                ? block.join("\n")
                : block
                      .map((item) => item.trim())
                      .join(" ")
                      .replace(/\s+/g, " ");
        } else if (/^\[.*\]$/.test(inline) && !block.length) {
            value = inline
                .slice(1, -1)
                .split(",")
                .map((item) => unquote(item.trim()))
                .filter(Boolean)
                .join("、");
        } else if (inline) {
            // 普通标量可以折行续写到缩进行，按 YAML 规则用空格拼接。
            value = unquote([inline, ...block.map((item) => item.trim()).filter(Boolean)].join(" "));
        } else if (block.length && block.every((item) => !item.trim() || item.startsWith("- "))) {
            value = block
                .filter((item) => item.trim())
                .map((item) => unquote(item.slice(2).trim()))
                .join("、");
        } else {
            value = block.join("\n");
        }
        entries.push({ key, value: value.trim() });
        index = next;
    }
    return entries;
}
