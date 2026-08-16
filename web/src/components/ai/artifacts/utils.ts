// Artifact 子系统内部共享的纯函数与协议：
// 只放无副作用、可单测的转换/解析/校验逻辑，不依赖 React、AntD 或其他 UI。

export type MarkdownTable = { text: string; rows: number; cols: number; nextLine: number; title?: string };

export function describeLanguage(lang: string): string {
    const map: Record<string, string> = {
        js: "JavaScript", ts: "TypeScript", jsx: "React JSX", tsx: "React TSX",
        py: "Python", python: "Python", html: "HTML", css: "CSS", sh: "Shell", bash: "Bash",
        json: "JSON", yaml: "YAML", yml: "YAML", md: "Markdown", sql: "SQL", go: "Go",
    };
    return map[lang.toLowerCase()] || (lang ? `${lang.toUpperCase()} 代码` : "代码片段");
}

export function countLines(s: string): number {
    if (!s) return 0;
    let n = 1;
    for (const ch of s) if (ch === "\n") n += 1;
    return n;
}

// 安全的资源 URL 过滤：只允许 http/https/data/blob/file，拒绝 javascript/vbscript 等协议。
export function sanitizeResourceUrl(input: string): string {
    const raw = (input || "").trim();
    if (!raw) return "";
    // data URL 放行 media resources（base64 或图片等）
    if (raw.startsWith("data:") || raw.startsWith("blob:") || raw.startsWith("file:")) return raw;
    try {
        const u = new URL(raw);
        if (u.protocol === "http:" || u.protocol === "https:") return raw;
        // eslint-disable-next-line no-console
        if (typeof console !== "undefined") console.warn("[artifact] unsafe URL protocol blocked:", u.protocol);
        return "";
    } catch {
        // 非绝对 URL，按相对路径/锚点放行（本站资源）
        return raw;
    }
}

export function markdownTableToCsv(raw: string): string {
    const rows = raw
        .split(/\r?\n/)
        .filter((ln) => ln.trim().startsWith("|"))
        .filter((ln) => !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(ln));
    return rows
        .map((ln) => {
            const cells = ln.split("|");
            const stripped = cells[0].trim() === "" ? cells.slice(1, -1) : cells;
            return stripped
                .map((c) => c.trim())
                .map((c) => {
                    if (c.includes(",") || c.includes('"') || c.includes("\n")) {
                        return `"${c.replace(/"/g, '""')}"`;
                    }
                    return c;
                })
                .join(",");
        })
        .join("\n");
}

// 从 lines 数组 start 位置尝试抓取一张 Markdown 管道表（含分隔线行）。
export function tryExtractMarkdownTable(lines: string[], start: number): MarkdownTable | null {
    const firstLine = lines[start];
    if (!firstLine?.trim().startsWith("|")) return null;

    const separator = lines[start + 1] || "";
    if (!/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(separator)) return null;

    const rowLines: string[] = [];
    let j = start;
    while (j < lines.length) {
        const ln = lines[j];
        if (!ln.trim().startsWith("|")) break;
        rowLines.push(ln);
        j += 1;
    }
    if (rowLines.length < 2) return null;

    const possibleTitleLine = start > 0 ? lines[start - 1] : "";
    const titleMatch = possibleTitleLine.match(/^(#{1,4})\s+(.+?)\s*#*\s*$/);
    const headerCells = rowLines[0].split("|").filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
    const cols = headerCells.length;
    return {
        text: rowLines.join("\n"),
        rows: rowLines.length,
        cols,
        nextLine: j,
        title: titleMatch?.[2]?.trim(),
    };
}

export function parseMarkdownPipeTable(raw: string): string[][] {
    const lines = raw.split(/\r?\n/).filter((ln) => ln.trim());
    const rows: string[][] = [];
    for (const ln of lines) {
        if (/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(ln)) continue;
        const cells = ln.split("|");
        const stripped = cells[0].trim() === "" ? cells.slice(1, -1) : cells;
        rows.push(stripped.map((c) => c.trim()));
    }
    return rows;
}

export function parseCsv(raw: string): string[][] {
    const lines = raw.split(/\r?\n/).filter((ln) => ln.trim().length);
    return lines.map((ln) => {
        const out: string[] = [];
        let cur = "";
        let inQ = false;
        for (let i = 0; i < ln.length; i += 1) {
            const ch = ln[i];
            if (inQ) {
                if (ch === '"') {
                    if (ln[i + 1] === '"') { cur += '"'; i += 1; }
                    else inQ = false;
                } else cur += ch;
            } else {
                if (ch === '"') inQ = true;
                else if (ch === ",") { out.push(cur.trim()); cur = ""; }
                else cur += ch;
            }
        }
        out.push(cur.trim());
        return out;
    });
}
