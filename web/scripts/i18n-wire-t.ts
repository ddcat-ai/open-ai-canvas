/**
 * 一次性接线脚本：给 codemod 改过的文件补 t 的来源。
 * - React 组件 / hooks 文件（use-*.ts）：在包含 t() 调用的顶层函数体开头插 useTranslation
 * - 纯 .ts 模块：import 单例 t from "@/i18n"
 * 用法：bun scripts/i18n-wire-t.ts <file...>
 */
import { parse } from "@babel/parser";
import MagicString from "magic-string";
import { readFileSync, writeFileSync } from "node:fs";

const HOOK = 'const { t } = useTranslation("canvas");';

for (const file of process.argv.slice(2)) {
    const source = readFileSync(file, "utf8");
    let ast;
    try {
        ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
    } catch (error) {
        console.error(`[skip] ${file}: ${error}`);
        continue;
    }
    const magic = new MagicString(source);
    const isHookFile = /\/use-[a-z-]+\.ts$/.test(file);
    const isPlainTs = file.endsWith(".ts") && !isHookFile;

    let changed = false;

    if (isPlainTs) {
        if (!source.includes('from "@/i18n"')) {
            // 插到最后一条完整的 import 语句后（顶层，不在多行 import 中间）
            const lines = source.split("\n");
            let lastEnd = -1;
            let depth = 0;
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i]!;
                depth += (line.match(/[({[]/g) ?? []).length - (line.match(/[)}\]]/g) ?? []).length;
                if (/^import .*from\s+["']/.test(line) && depth <= 0) lastEnd = i;
                if (lastEnd >= 0 && depth !== 0) lastEnd = -1;
                if (i > 60) break;
            }
            const insertAt = lastEnd >= 0 ? lines.slice(0, lastEnd + 1).join("\n").length + 1 : 0;
            magic.appendRight(insertAt, 'import { t } from "@/i18n";\n');
            changed = true;
        }
    } else {
        // 顶层函数声明：子树含 t(" 才插 hook；嵌套函数继承外层 t 不重复插
        for (const statement of ast.program.body) {
            let fn = null;
            if (statement.type === "FunctionDeclaration") fn = statement;
            else if (statement.type === "ExportNamedDeclaration" || statement.type === "ExportDefaultDeclaration") {
                fn = statement.declaration && statement.declaration.type === "FunctionDeclaration" ? statement.declaration : null;
            }
            if (!fn || !fn.body) continue;
            const bodyText = source.slice(fn.body.start, fn.end);
            if (!/\bt\(/.test(bodyText)) continue;
            if (bodyText.includes("useTranslation(")) continue;
            // 插到 body 开括号后第一个换行之后
            const openBrace = fn.body.start; // 指向 "{"
            const firstNewline = source.indexOf("\n", openBrace);
            const nl = source[firstNewline - 1] === "\r" ? "\r\n" : "\n";
            magic.appendRight(firstNewline + 1, `    ${HOOK}${nl}`);
            changed = true;
        }
        // 确保 import 存在
        if (changed && !source.includes('useTranslation } from "react-i18next"')) {
            const importLine = 'import { useTranslation } from "react-i18next";';
            const lines = source.split("\n");
            let lastImport = -1;
            let depth = 0;
            for (let i = 0; i < Math.min(lines.length, 80); i++) {
                const line = lines[i]!;
                depth += (line.match(/[({[]/g) ?? []).length - (line.match(/[)}\]]/g) ?? []).length;
                if (/^import /.test(line) && depth === 0) lastImport = i;
            }
            const insertAt = lastImport >= 0 ? lines.slice(0, lastImport + 1).join("\n").length + 1 : 0;
            magic.appendRight(insertAt, importLine + "\n");
        }
    }

    if (changed) {
        writeFileSync(file, magic.toString());
        console.log("wired", file);
    }
}
