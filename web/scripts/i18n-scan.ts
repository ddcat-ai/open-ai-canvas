/**
 * i18n 盘点扫描器：统计 src 下含中文字符串字面量的分布，输出按目录聚合的报告。
 * 用 @babel/parser 的精确 offset 定位，不做正则匹配（密集单行会让正则配对错引号）。
 *
 * 用法：bun web/scripts/i18n-scan.ts [--json <输出路径>]
 */
import { parse } from "@babel/parser";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const WEB_ROOT = join(import.meta.dir, "..");
const SRC_DIR = join(WEB_ROOT, "src");

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/;

type Counts = { files: Set<string>; literals: number; jsxText: number; templates: number };

function walk(dir: string): string[] {
    const result: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) result.push(...walk(full));
        else if (/\.(ts|tsx)$/.test(entry)) result.push(full);
    }
    return result;
}

function hasCjkInFile(source: string): boolean {
    return CJK_RE.test(source);
}

function scanFile(path: string): Counts | null {
    const source = readFileSync(path, "utf8");
    let ast;
    try {
        ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
    } catch {
        return null;
    }
    const counts: Counts = { files: new Set([path]), literals: 0, jsxText: 0, templates: 0 };
    const stack: Array<{ node: any; parent: any }> = [];
    const visit = (node: any, parent: any) => {
        if (!node || typeof node.type !== "string") return;
        if (node.type === "StringLiteral" && typeof node.value === "string" && CJK_RE.test(node.value)) {
            counts.literals += 1;
        } else if (node.type === "TemplateLiteral" && node.quasis.some((q: any) => CJK_RE.test(q.value.cooked ?? ""))) {
            counts.templates += 1;
        } else if (node.type === "JSXText" && CJK_RE.test(node.value)) {
            counts.jsxText += 1;
        }
        for (const key of Object.keys(node)) {
            if (key === "loc" || key === "start" || key === "end" || key === "leadingComments" || key === "trailingComments" || key === "innerComments") continue;
            const child = node[key];
            if (Array.isArray(child)) {
                for (const c of child) {
                    if (c && typeof c.type === "string") visit(c, node);
                }
            } else if (child && typeof child.type === "string") {
                visit(child, node);
            }
        }
    };
    visit(ast.program, null);
    return counts;
}

const files = walk(SRC_DIR);
const byArea = new Map<string, { files: number; total: number }>();
let grandTotal = 0;
let grandFiles = 0;

for (const file of files) {
    if (!hasCjkInFile(readFileSync(file, "utf8"))) continue;
    const counts = scanFile(file);
    if (!counts || counts.literals + counts.templates + counts.jsxText === 0) continue;
    const area = relative(SRC_DIR, file).split(/[\\/]/).slice(0, 2).join("/");
    const total = counts.literals + counts.templates + counts.jsxText;
    const bucket = byArea.get(area) ?? { files: 0, total: 0 };
    bucket.files += 1;
    bucket.total += total;
    byArea.set(area, bucket);
    grandTotal += total;
    grandFiles += 1;
}

const rows = [...byArea.entries()].sort((a, b) => b[1].total - a[1].total);
console.log(`区域`.padEnd(40) + `文件`.padStart(6) + `条目`.padStart(8));
for (const [area, { files, total }] of rows) {
    console.log(area.padEnd(40) + String(files).padStart(6) + String(total).padStart(8));
}
console.log("-".repeat(54));
console.log(`合计`.padEnd(38) + String(grandFiles).padStart(6) + String(grandTotal).padStart(8));

if (process.argv.includes("--json")) {
    const outIdx = process.argv.indexOf("--json");
    const outPath = process.argv[outIdx + 1]!;
    writeFileSync(outPath, JSON.stringify(Object.fromEntries(rows.map(([area, v]) => [area, v])), null, 2));
    console.log(`\n报告已写入 ${outPath}`);
}
