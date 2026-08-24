/**
 * i18n codemod：把指定目录里的中文字面量改写为 t() 调用，并维护 catalog。
 *
 * 两个阶段：
 *   extract：扫描目录，产出 pending 文件（去重后的 zh 文案清单 + 待人工处理的 JSX 文本/错误消息/比较表达式）
 *   apply  ：读取 pending（要求每条都有 key 和 en），用 offset-splice 重写源码 + 更新 zh/en catalog
 *
 * 用法：
 *   bun scripts/i18n-codemod.ts extract --dir src/pages/projects --ns project
 *   bun scripts/i18n-codemod.ts apply   --dir src/pages/projects --ns project
 *
 * 设计约束（来自盘点结论）：
 * - 只做 offset-splice，不整文件重打印；改完由外部跑 prettier 归一。
 * - 比较运算符（=== / !==）/ switch case 里的中文一律跳过——那是协议匹配数据，翻译掉会静默失效。
 * - new Error(...) 参数跳过单独报告——错误消息可能被上游按文本匹配。
 * - JSX 文本节点跳过单独报告——跨表达式合并成整句需要 <Trans>，人工判断。
 * - apply 复刻 extract 的全部上下文排除：同一文案若同时出现在 UI 和比较位置，
 *   只有 UI 位置改写（按节点上下文判断，不按文本全局替换）。
 */
import { parse } from "@babel/parser";
import MagicString from "magic-string";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES_DIR = join(WEB_ROOT, "src", "locales");
const PENDING_DIR = join(WEB_ROOT, "scripts", "i18n-pending");

/** 红线：中文是协议数据或送模型词汇的文件/目录，永远不迁移 */
const SKIP_FILE_RE: RegExp[] = [
    /generation-error\.ts$/,
    /lib[\\/]canvas[\\/]director[\\/]/,
    /create-ai-prompt\.ts$/,
    // prompt 组装层：promptTemplateVariables 中文键值进模型，characterSections 按中文标题匹配后端风格模板
    /project-chapter-ai\.ts$/,
    /project-character-media\.ts$/,
    /canvas-prompts\.ts$/,
    /canvas-style-presets\.ts$/,
    /canvas-node-generation\.ts$/,
    /canvas-online-agent-protocol\.ts$/,
    /create[\/]creation-(references|assets)\.ts$/,
];

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/;
const COMPARISON_OPS = new Set(["==", "===", "!=", "!=="]);
const ERROR_CTORS = new Set(["Error", "TypeError", "RangeError", "ApiError", "DOMException"]);

type EntryType = "ui" | "template" | "jsxtext" | "error" | "comparison" | "skipped";

type PendingEntry = {
    type: EntryType;
    zh: string;
    /** 模板串参数：占位名 → 表达式原文 */
    params?: Record<string, string>;
    locations: Array<{ file: string; line: number }>;
    /** ui/template 条目 apply 前必须填 */
    key?: string;
    en?: string;
};

type PendingFile = { ns: string; entries: Record<string, PendingEntry> };

let currentSource = "";

function sourceOf(node: any): string {
    return currentSource.slice(node.start, node.end);
}

function walk(dir: string): string[] {
    const result: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (/node_modules/.test(full)) continue;
            result.push(...walk(full));
        } else if (/\.(ts|tsx)$/.test(entry)) result.push(full);
    }
    return result;
}

function isTypePosition(ancestors: any[]): boolean {
    return ancestors.some((a) => a && typeof a.type === "string" && /^TS(TypeReference|LiteralType|UnionType|IntersectionType|ParenthesizedType)$/.test(a.type));
}

/**
 * 字符串节点的上下文分类。返回值决定处理方式：
 *   ui       → 可安全迁移
 *   attr     → JSX 属性（同样可迁移）
 *   其他     → 跳过并归类
 */
function classifyString(node: any, ancestors: any[]): EntryType {
    if (isTypePosition(ancestors)) return "skipped";
    const parent = ancestors[ancestors.length - 1];
    if (!parent) return "ui";
    if (["ImportDeclaration", "ExportNamedDeclaration", "ImportSpecifier", "ExportSpecifier"].includes(parent.type)) return "skipped";
    if (parent.type === "ObjectProperty" && parent.key === node && !parent.computed) return "skipped";
    if (parent.type === "MemberExpression" && parent.property === node && !parent.computed) return "skipped";
    if ((parent.type === "BinaryExpression" && COMPARISON_OPS.has(parent.operator)) || parent.type === "SwitchCase") return "comparison";
    if (parent.type === "NewExpression" && ERROR_CTORS.has(parent.callee?.name ?? "")) return "error";
    if (parent.type === "CallExpression" && parent.callee?.type === "Identifier" && ["require"].includes(parent.callee.name)) return "skipped";
    // JSX 属性值（直接字面量或包在表达式容器里）
    if (parent.type === "JSXAttribute") return "attr";
    if (parent.type === "JSXExpressionContainer" && ancestors[ancestors.length - 2]?.type === "JSXAttribute") return "attr";
    return "ui";
}

/** 模板插值表达式是否可提取为命名参数（只收标识符与成员访问，方法调用一律放弃） */
function simpleExprParam(node: any): { name: string; source: string } | null {
    if (node.type === "Identifier") return { name: node.name, source: sourceOf(node) };
    if (node.type === "MemberExpression" && !node.computed && node.property.type === "Identifier") {
        return { name: node.property.name, source: sourceOf(node) };
    }
    return null;
}

function templateParts(node: any): { zh: string; params: Record<string, string> } | null {
    const quasis = node.quasis as any[];
    const params: Record<string, string> = {};
    const parts: string[] = [quasis[0]!.value.cooked ?? ""];
    let ok = true;
    node.expressions.forEach((expr: any, i: number) => {
        const simple = simpleExprParam(expr);
        if (!simple) {
            ok = false;
            return;
        }
        let name = simple.name;
        while (name in params) name = `${name}_${i}`;
        params[name] = simple.source;
        parts.push(`{{${name}}}`, quasis[i + 1]!.value.cooked ?? "");
    });
    return ok ? { zh: parts.join(""), params } : null;
}

function parseArgs() {
    const mode = process.argv[2];
    const get = (flag: string) => {
        const i = process.argv.indexOf(flag);
        return i >= 0 ? process.argv[i + 1]! : undefined;
    };
    const dirArg = get("--dir");
    const ns = get("--ns");
    if (!mode || !["extract", "apply"].includes(mode) || !dirArg || !ns) {
        console.error("用法: bun scripts/i18n-codemod.ts <extract|apply> --dir <src子目录> --ns <namespace>");
        process.exit(1);
    }
    return { mode, dir: join(WEB_ROOT, dirArg), ns };
}

function extract(dir: string, ns: string) {
    // 合并语义：pending 已有条目保留（含已填的 key/en），新条目追加
    const outPath = join(PENDING_DIR, `${ns}.json`);
    const pending: PendingFile = existsSync(outPath) ? (JSON.parse(readFileSync(outPath, "utf8")) as PendingFile) : { ns, entries: {} };
    const addLocation = (id: string, entry: Omit<PendingEntry, "locations">, file: string, line: number) => {
        const existing = pending.entries[id];
        if (existing) {
            existing.locations.push({ file, line });
            return;
        }
        pending.entries[id] = { ...entry, locations: [{ file, line }] };
    };

    for (const file of walk(dir)) {
        const rel = relative(WEB_ROOT, file).replaceAll("\\", "/");
        if (SKIP_FILE_RE.some((re) => re.test(rel))) continue;
        const source = readFileSync(file, "utf8");
        currentSource = source;
        let ast;
        try {
            ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
        } catch (error) {
            console.error(`[skip] 解析失败 ${rel}: ${error}`);
            continue;
        }

        const visit = (node: any, ancestors: any[]) => {
            if (!node || typeof node.type !== "string") return;

            if (node.type === "StringLiteral" && CJK_RE.test(node.value)) {
                const kind = classifyString(node, ancestors);
                if (kind === "ui" || kind === "attr") {
                    addLocation(`t:${node.value}`, { type: "ui", zh: node.value }, rel, node.loc.start.line);
                } else if (kind === "comparison") {
                    addLocation(`cmp:${rel}:${node.value}:${node.start}`, { type: "comparison", zh: node.value }, rel, node.loc.start.line);
                } else if (kind === "error") {
                    addLocation(`err:${rel}:${node.value}:${node.start}`, { type: "error", zh: node.value }, rel, node.loc.start.line);
                }
            } else if (node.type === "TemplateLiteral" && (node.quasis as any[]).length > 1 && !isTypePosition(ancestors)) {
                if ((node.quasis as any[]).some((q) => CJK_RE.test(q.value.cooked ?? ""))) {
                    const parent = ancestors[ancestors.length - 1];
                    if (parent?.type === "TaggedTemplateExpression") {
                        addLocation(`cx:${rel}:${node.start}`, { type: "skipped", zh: sourceOf(node).slice(0, 120) }, rel, node.loc.start.line);
                    } else {
                        const parts = templateParts(node);
                        if (parts && CJK_RE.test(parts.zh.replace(/\{\{\w+\}\}/g, ""))) {
                            addLocation(`tpl:${parts.zh}`, { type: "template", zh: parts.zh, params: parts.params }, rel, node.loc.start.line);
                        } else if (!parts) {
                            addLocation(`cx:${rel}:${node.start}`, { type: "skipped", zh: sourceOf(node).slice(0, 120) }, rel, node.loc.start.line);
                        }
                    }
                }
            } else if (node.type === "JSXText" && CJK_RE.test(node.value)) {
                const trimmed = node.value.trim();
                addLocation(`jsx:${rel}:${trimmed}:${node.start}`, { type: "jsxtext", zh: trimmed }, rel, node.loc.start.line);
            }

            for (const key of Object.keys(node)) {
                if (["loc", "start", "end", "leadingComments", "trailingComments", "innerComments", "regex"].includes(key)) continue;
                const child = node[key];
                if (Array.isArray(child)) {
                    for (const c of child) if (c && typeof c.type === "string") visit(c, [...ancestors, node]);
                } else if (child && typeof child.type === "string") {
                    visit(child, [...ancestors, node]);
                }
            }
        };
        visit(ast.program, []);
    }

    mkdirSync(PENDING_DIR, { recursive: true });
    writeFileSync(outPath, JSON.stringify(pending, null, 4));
    const counts = Object.values(pending.entries).reduce<Record<string, number>>((acc, e) => {
        acc[e.type] = (acc[e.type] ?? 0) + 1;
        return acc;
    }, {});
    console.log(`pending 写入 ${outPath}`);
    console.log(`条目分类:`, counts);
}

function buildCall(ns: string, key: string, params?: Record<string, string>): string {
    const keyArg = `"${ns}:${key}"`;
    if (!params || !Object.keys(params).length) return `t(${keyArg})`;
    const args = Object.entries(params).map(([name, expr]) => `${isValidIdent(name) ? name : JSON.stringify(name)}: ${expr}`);
    return `t(${keyArg}, { ${args.join(", ")} })`;
}

function isValidIdent(name: string): boolean {
    return /^[A-Za-z_$][\w$]*$/.test(name);
}

function apply(dir: string, ns: string) {
    const outPath = join(PENDING_DIR, `${ns}.json`);
    if (!existsSync(outPath)) {
        console.error(`找不到 ${outPath}，先跑 extract`);
        process.exit(1);
    }
    const pending = JSON.parse(readFileSync(outPath, "utf8")) as PendingFile;
    // 不再强制全量填写：填了 key/en 的条目才参与改写，其余留在报告里供下批处理
    const missing = Object.values(pending.entries)
        .filter((e) => !e.key && ["ui", "template", "jsxtext"].includes(e.type))
        .map((e) => `  ${JSON.stringify(e.zh.slice(0, 60))} @ ${e.locations[0]!.file}:${e.locations[0]!.line}`);

    // 同一文案复用同一 key
    const byZh = new Map<string, { key: string; en: string }>();
    for (const entry of Object.values(pending.entries)) {
        if (!entry.key) continue;
        if (["ui", "template", "jsxtext", "error"].includes(entry.type)) byZh.set(entry.zh, { key: entry.key!, en: entry.en! });
    }

    const catalogZhPath = join(LOCALES_DIR, "zh-CN", `${ns}.json`);
    const catalogEnPath = join(LOCALES_DIR, "en", `${ns}.json`);
    const catalogZh: Record<string, string> = existsSync(catalogZhPath) ? JSON.parse(readFileSync(catalogZhPath, "utf8")) : {};
    const catalogEn: Record<string, string> = existsSync(catalogEnPath) ? JSON.parse(readFileSync(catalogEnPath, "utf8")) : {};

    const changedFiles = new Set<string>();
    for (const file of walk(dir)) {
        const rel = relative(WEB_ROOT, file).replaceAll("\\", "/");
        if (SKIP_FILE_RE.some((re) => re.test(rel))) continue;
        const source = readFileSync(file, "utf8");
        currentSource = source;
        let ast;
        try {
            ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
        } catch {
            continue;
        }
        const magic = new MagicString(source);

        const visit = (node: any, ancestors: any[]) => {
            if (!node || typeof node.type !== "string") return;

            if (node.type === "StringLiteral" && CJK_RE.test(node.value)) {
                const kind = classifyString(node, ancestors);
                if (kind === "ui" || kind === "attr") {
                    const mapped = byZh.get(node.value);
                    if (mapped) {
                        // JSX 属性值必须包花括号：label="x" → label={t("...")}；普通表达式位置直接换
                        const call = buildCall(ns, mapped.key);
                        magic.overwrite(node.start, node.end, kind === "attr" ? `{${call}}` : call);
                        changedFiles.add(rel);
                        catalogZh[mapped.key] = node.value;
                        catalogEn[mapped.key] = mapped.en;
                    }
                }
            } else if (node.type === "TemplateLiteral" && (node.quasis as any[]).length > 1 && !isTypePosition(ancestors) && ancestors[ancestors.length - 1]?.type !== "TaggedTemplateExpression") {
                if ((node.quasis as any[]).some((q) => CJK_RE.test(q.value.cooked ?? ""))) {
                    const parts = templateParts(node);
                    const mapped = parts ? byZh.get(parts.zh) : undefined;
                    if (parts && mapped) {
                        magic.overwrite(node.start, node.end, buildCall(ns, mapped.key, parts.params));
                        changedFiles.add(rel);
                        catalogZh[mapped.key] = parts.zh;
                        catalogEn[mapped.key] = mapped.en;
                    }
                }
            } else if (node.type === "JSXText" && CJK_RE.test(node.value)) {
                // 简单文本段：整段替换为 {t(...)}，保留前后空白；跨表达式的整句由人工用 <Trans> 处理
                const trimmed = node.value.trim();
                const mapped = trimmed ? byZh.get(trimmed) : undefined;
                if (mapped) {
                    const leading = node.value.slice(0, node.value.indexOf(trimmed));
                    const trailing = node.value.slice(node.value.indexOf(trimmed) + trimmed.length);
                    magic.overwrite(node.start, node.end, `${leading}{t("${ns}:${mapped.key}")}${trailing}`);
                    changedFiles.add(rel);
                    catalogZh[mapped.key] = trimmed;
                    catalogEn[mapped.key] = mapped.en;
                }
            } else if (node.type === "NewExpression" && ERROR_CTORS.has(node.callee?.name ?? "")) {
                // 本地 UI 反馈类错误消息：pending 里填了 key 的才改写（可能被上游按文本匹配的错误保持原样）
                for (const arg of node.arguments as any[]) {
                    if (arg?.type !== "StringLiteral" || !CJK_RE.test(arg.value)) continue;
                    const mapped = byZh.get(arg.value);
                    if (mapped) {
                        magic.overwrite(arg.start, arg.end, buildCall(ns, mapped.key));
                        changedFiles.add(rel);
                        catalogZh[mapped.key] = arg.value;
                        catalogEn[mapped.key] = mapped.en;
                    }
                }
            }

            for (const key of Object.keys(node)) {
                if (["loc", "start", "end", "leadingComments", "trailingComments", "innerComments", "regex"].includes(key)) continue;
                const child = node[key];
                if (Array.isArray(child)) {
                    for (const c of child) if (c && typeof c.type === "string") visit(c, [...ancestors, node]);
                } else if (child && typeof child.type === "string") {
                    visit(child, [...ancestors, node]);
                }
            }
        };
        visit(ast.program, []);

        if (changedFiles.has(rel)) writeFileSync(file, magic.toString());
    }

    const sortKeys = (obj: Record<string, string>) => Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(catalogZhPath, JSON.stringify(sortKeys(catalogZh), null, 4) + "\n");
    writeFileSync(catalogEnPath, JSON.stringify(sortKeys(catalogEn), null, 4) + "\n");
    console.log(`已重写 ${changedFiles.size} 个文件；catalog ${ns}: zh=${Object.keys(catalogZh).length} en=${Object.keys(catalogEn).length}`);
    if (missing.length) console.log(`待下批处理 ${missing.length} 条（见上方列表）`);
}

const { mode, dir, ns } = parseArgs();
if (mode === "extract") extract(dir, ns);
else apply(dir, ns);
