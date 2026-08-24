/**
 * 把 gloss 表（zh → en）合并进 pending：key 由 en 自动 slug 化生成，同 en 去重加后缀。
 * 用法：bun scripts/i18n-gloss.ts --ns project
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PENDING_DIR = join(WEB_ROOT, "scripts", "i18n-pending");

function slugify(text: string): string {
    return (
        text
            .toLowerCase()
            .replace(/{{\w+}}/g, " param")
            .replace(/&/g, " and ")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 72)
            .replace(/-+$/g, "") || "item"
    );
}

const ns = process.argv[process.argv.indexOf("--ns") + 1];
if (!ns) {
    console.error("用法: bun scripts/i18n-gloss.ts --ns <namespace>");
    process.exit(1);
}

const pendingPath = join(PENDING_DIR, `${ns}.json`);
if (!existsSync(pendingPath)) {
    console.error(`找不到 ${pendingPath}`);
    process.exit(1);
}
const pending = JSON.parse(readFileSync(pendingPath, "utf8")) as { ns: string; entries: Record<string, any> };

// 合并所有 gloss 分片
const glossFiles = readdirSyncSafe();
const gloss = new Map<string, string>();
for (const file of glossFiles) {
    const data = JSON.parse(readFileSync(join(PENDING_DIR, file), "utf8")) as Record<string, string>;
    for (const [zh, en] of Object.entries(data)) {
        if (gloss.has(zh)) console.warn(`[warn] gloss 重复: ${JSON.stringify(zh.slice(0, 30))}（后者覆盖）`);
        gloss.set(zh, en);
    }
}

function readdirSyncSafe(): string[] {
    const results = [];
    for (const entry of readdirSync(PENDING_DIR, { withFileTypes: true })) {
        if (entry.isFile() && /^gloss-.*\.json$/.test(entry.name)) results.push(entry.name);
        if (entry.isDirectory() && entry.name === "tasks") {
            for (const sub of readdirSync(join(PENDING_DIR, "tasks"))) {
                if (/^gloss-.*\.json$/.test(sub)) results.push(`tasks/${sub}`);
            }
        }
    }
    return results;
}

// slug 去重：同一 en 出现第二次起追加 -2/-3…
const usedKeys = new Map<string, number>();
// catalog 里已有的 key 不允许冲突
for (const entry of Object.values(pending.entries)) {
    if (entry.key) usedKeys.set(entry.key, (usedKeys.get(entry.key) ?? 0) + 1);
}

let filled = 0;
let unfilled = 0;
for (const entry of Object.values(pending.entries)) {
    if (entry.key) continue;
    if (!["ui", "template", "jsxtext", "error"].includes(entry.type)) continue;
    const en = gloss.get(entry.zh);
    if (en === undefined) {
        unfilled += 1;
        continue;
    }
    const base = slugify(en);
    const n = usedKeys.get(base) ?? 0;
    usedKeys.set(base, n + 1);
    entry.key = n === 0 ? base : `${base}-${n + 1}`;
    entry.en = en.replace(/{{(\w+)}}/g, "{{{{$1}}}}").replace(/\{\{\{(\w+)\}\}\}/g, "{{$1}}");
    filled += 1;
}

writeFileSync(pendingPath, JSON.stringify(pending, null, 4));
console.log(`已回填 ${filled} 条；剩余未填 ${unfilled} 条`);
if (unfilled > 0) {
    for (const entry of Object.values(pending.entries)) {
        if (!entry.key && ["ui", "template", "jsxtext", "error"].includes(entry.type)) {
            console.log(`  [${entry.type}] ${JSON.stringify(entry.zh.slice(0, 70))}`);
        }
    }
}
