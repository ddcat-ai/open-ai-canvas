/**
 * 灵感目录导入：把外部提示词源同步成本地目录。
 *
 * 无新增依赖：只用 Bun/Node 内置 fetch / fs / path，缩略图用 Bun 自带的 Bun.Image。
 * 产物分两层：
 *   - public/inspirations/*.json          全量目录（每个来源一个文件，按需拉取）
 *   - public/inspiration-thumbs/<来源>/*.webp  本地压缩缩略图，只给每个来源排在前面的若干条
 *   - src/lib/inspirations/highlights.ts  打进包里的精选，供首页纵深画廊即时渲染
 *
 * 用法：
 *   bun scripts/import-inspirations.mjs [--only seedance|haohaoxue|youmind] [--thumbs 120] [--force]
 *   bun scripts/import-inspirations.mjs --seedance-input <cases.json> --haohaoxue-input <prompts.html>
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const WEB_DIR = resolve(import.meta.dir, "..");
const PUBLIC_DIR = join(WEB_DIR, "public", "inspirations");
const SHOT_DIR = join(WEB_DIR, "public");
/** 首页画廊的池子。放 public 而不是打进包：正文很长，进包会让首屏 JS 白背几百 KB。 */
const GALLERY_POOL_FILE = join(PUBLIC_DIR, "gallery-pool.json");
/** 只留各来源的上游版本号，几行字，进包无所谓。 */
const REVISIONS_FILE = join(WEB_DIR, "src", "lib", "inspirations", "source-revisions.ts");
const UA = "Mozilla/5.0 (compatible; yingce-inspiration-import/1.0; +https://github.com/ddcat-ai/open-ai-canvas)";

const SEEDANCE_REPO = "LearnPrompt/awesome-seedance";
const HAOHAOXUE_PAGE = "https://www.haohaoxue.com/prompts/";
/** YouMind 的提示词库，README 里已经是中文，且带分类、配图与作者。 */
const YOUMIND_REPOS = [
    { repo: "YouMind-OpenLab/awesome-nano-banana-pro-prompts", slug: "nano-banana" },
    { repo: "YouMind-OpenLab/awesome-gpt-image-2", slug: "gpt-image-2" },
];

/** 卡片描述最多两行，完整正文仍在 prompt 里。 */
const DESCRIPTION_LIMIT = 44;

/**
 * 本地缩略图规格。上游封面动辄几百 KB 到几 MB（好好学平均 727KB、YouMind 最大 7.6MB），
 * 直接引用的话首页一次要拉 5MB 以上，低带宽服务器上要等很久。
 * 统一压到 560px webp，实测 2MB 的原图能压到 55KB，约 37 倍。
 */
const THUMB_WIDTH = 560;
const THUMB_QUALITY = 72;
/** 压完还不到这个大小，基本就是纯色或影片片头白板，放进画廊就是一块空白。 */
const MIN_THUMB_BYTES = 4000;
const THUMB_DIR = "inspiration-thumbs";

/**
 * 上游封面不可用的条目：封面本身是影片片头白板，画面上只有一个白底和 "MUDA / FILM 01"，
 * 放在画廊里就是一块空白。清单按 slug 写死，重新同步不会把它带回来。
 */
const EXCLUDED_SEEDANCE_SLUGS = new Set(["seedance-make-a-modern-slick-and-punchy-video-for-a-modern-startup-that-works-on-infere-07ba4673539c"]);

/**
 * 上游模板分类的中文标签。id 来自 awesome-seedance 的 data/case-taxonomy.json，
 * 它只给 id 不给名字，所以译名维护在这里；出现新 id 时会告警并在页面上回落成 id 本身。
 */
const SEEDANCE_CATEGORY_LABELS = {
    "handheld-ugc-vlog": "手持 UGC Vlog",
    "anime-style-lock": "动漫风格锁定",
    "meme-comedy": "梗图喜剧",
    "combat-choreography": "打斗编排",
    "storyboard-grid-to-video": "分镜表转视频",
    "character-reference-lock": "角色一致性",
    "time-freeze-rewind": "时间冻结与倒放",
    "cinematic-narrative-short": "电影感叙事短片",
    "car-vehicle": "汽车与载具",
    "sports-extreme": "运动极限",
    "travel-city-walk": "旅行城市漫步",
    "process-transformation-montage": "过程变身蒙太奇",
    "ugc-creator-review": "达人测评",
    "fashion-lookbook": "时尚造型册",
    "pet-animal": "宠物与动物",
    "3d-cartoon": "3D 卡通",
    "timeline-shot-script": "时间轴分镜脚本",
    "product-commercial-shotlist": "产品广告分镜",
    "stop-motion-cadence": "定格动画节奏",
    "epic-fantasy-scifi": "史诗奇幻科幻",
    "dialogue-performance-beats": "对白表演节拍",
    "music-beat-sync-mv": "音乐卡点 MV",
    "horror-suspense": "恐怖悬疑",
    "pov-continuous-take": "POV 长镜头",
    "game-ui-livestream": "游戏 UI 直播",
    "food-asmr": "美食 ASMR",
    "retro-found-footage": "复古伪纪录",
};

/** 好好学 AI 的分类码译名，取自站点「分类」筛选器上的中文标签。 */
const HAOHAOXUE_CATEGORY_LABELS = {
    poster: "海报设计",
    portrait: "人像摄影",
    illustration: "插画创作",
    product: "产品拍摄",
    anime: "动漫风格",
    "3d": "3D 渲染",
    japan: "日式美学",
    brand: "品牌设计",
    fashion: "时尚编辑",
    social: "社交媒体",
    other: "其他",
};

function parseArgs(argv) {
    const options = { only: "", thumbs: 120, force: false, seedanceInput: "", haohaoxueInput: "" };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === "--only") options.only = argv[++index];
        else if (arg === "--thumbs") options.thumbs = Number(argv[++index]);
        else if (arg === "--seedance-input") options.seedanceInput = argv[++index];
        else if (arg === "--haohaoxue-input") options.haohaoxueInput = argv[++index];
        else if (arg === "--force") options.force = true;
        else throw new Error(`未知参数: ${arg}`);
    }
    const sourceNames = SOURCE_PIPELINES.map((pipeline) => pipeline.name);
    if (options.only && !sourceNames.includes(options.only)) throw new Error(`--only 只支持 ${sourceNames.join(" / ")}，收到: ${options.only}`);
    if (!Number.isInteger(options.thumbs) || options.thumbs <= 0) throw new Error(`--thumbs 必须是正整数，收到: ${options.thumbs}`);
    return options;
}

const CJK = /[㐀-䶿一-鿿]/;

function hasCjk(value) {
    return CJK.test(value ?? "");
}

function clip(value, limit) {
    const text = (value ?? "").replace(/\s+/g, " ").trim();
    return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

function sanitizeFileName(value) {
    return String(value)
        .replace(/[^a-zA-Z0-9._-]/g, "-")
        .slice(0, 90);
}

async function fetchText(url, { accept } = {}) {
    const response = await fetch(url, { headers: { "User-Agent": UA, ...(accept ? { Accept: accept } : {}) } });
    if (!response.ok) throw new Error(`请求失败 ${url}: HTTP ${response.status}`);
    return response.text();
}

async function downloadImage(url, target) {
    const response = await fetch(url, { headers: { "User-Agent": UA, Referer: new URL(url).origin } });
    if (!response.ok) throw new Error(`下载封面失败 ${url}: HTTP ${response.status}`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, Buffer.from(await response.arrayBuffer()));
}

// ── awesome-seedance ────────────────────────────────────────────────────────

async function resolveSeedanceRevision() {
    const response = await fetch(`https://api.github.com/repos/${SEEDANCE_REPO}/commits/main`, {
        headers: { Accept: "application/vnd.github.sha", "User-Agent": UA },
    });
    if (!response.ok) throw new Error(`取 seedance revision 失败: HTTP ${response.status}`);
    return (await response.text()).trim();
}

async function loadSeedance(options) {
    if (options.seedanceInput) {
        const text = readFileSync(resolve(options.seedanceInput), "utf8");
        const parsed = JSON.parse(text);
        return { revision: "local", raw: Array.isArray(parsed) ? parsed : parsed.cases };
    }
    const revision = await resolveSeedanceRevision();
    const text = await fetchText(`https://raw.githubusercontent.com/${SEEDANCE_REPO}/${revision}/data/cases.json`);
    const parsed = JSON.parse(text);
    const taxonomy = JSON.parse(await fetchText(`https://raw.githubusercontent.com/${SEEDANCE_REPO}/${revision}/data/case-taxonomy.json`));
    const raw = Array.isArray(parsed) ? parsed : parsed.cases;
    if (!Array.isArray(raw)) throw new Error("seedance cases.json 结构不符合预期");
    for (const item of raw) {
        const template = taxonomy?.assignments?.[item.slug];
        if (template) item.templateId = template;
    }
    return { revision, raw };
}

/**
 * 只收中文标题的条目；中文界面下英文标题读起来是噪音。
 */
/**
 * 卡片的描述行。上游只有约四分之一条目的 summary 是中文，其余是英文原文，
 * 而且不少英文摘要里混着 "Created on Seedance 2.5 Prompt: …" 这类样板文字，
 * 塞进中文卡片是噪音；不拿标题顶上是因为标题和描述重复看着像渲染出错。
 * 所以退一步用上游分类的译名——同样是中文，同样说得清这条是什么，
 * 只是讲的是"哪一类"而不是"这一条讲了什么"。连分类都没有的少数条目留空。
 */
function seedanceDescription(item, category) {
    if (hasCjk(item.summary)) return clip(item.summary, DESCRIPTION_LIMIT);
    return SEEDANCE_CATEGORY_LABELS[category] ?? "";
}

function buildSeedanceEntries(raw) {
    const unknown = new Set();
    const entries = raw
        .filter((item) => item.slug && item.posterUrl && item.promptFull && hasCjk(item.title) && !EXCLUDED_SEEDANCE_SLUGS.has(item.slug))
        .sort((left, right) => (right.heatScore ?? 0) - (left.heatScore ?? 0))
        .map((item) => {
            const category = item.templateId || "";
            if (category && !SEEDANCE_CATEGORY_LABELS[category]) unknown.add(category);
            return {
                id: `seedance:${item.slug}`,
                title: item.title,
                description: seedanceDescription(item, category),
                image: item.posterUrl,
                mode: "video",
                prompt: item.promptFull,
                ...(category ? { category } : {}),
                ...(Array.isArray(item.tags) && item.tags.length ? { tags: item.tags.slice(0, 6) } : {}),
                sourceId: "seedance",
                ...(item.creator ? { credit: item.creator } : {}),
                ...(item.sourceUrl ? { sourceUrl: item.sourceUrl } : {}),
                heat: item.heatScore ?? 0,
            };
        });
    if (unknown.size) console.warn(`⚠ seedance 出现未译分类 id（页面会回落显示 id）: ${[...unknown].join(", ")}`);
    return entries;
}

// ── 好好学 AI 提示词库 ──────────────────────────────────────────────────────

/** 站点是 SSR 的，提示词正文就内嵌在页面的 JSON 块里，不用跑浏览器。 */
function parseHaohaoxueHtml(html) {
    for (const block of html.matchAll(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)) {
        let parsed;
        try {
            parsed = JSON.parse(block[1]);
        } catch {
            continue;
        }
        const found = [];
        const walk = (node) => {
            if (Array.isArray(node)) return node.forEach(walk);
            if (node && typeof node === "object") {
                if (typeof node.prompt === "string" && node.prompt.length > 60) found.push(node);
                Object.values(node).forEach(walk);
            }
        };
        walk(parsed);
        if (found.length) return found;
    }
    return [];
}

async function loadHaohaoxue(options) {
    const html = options.haohaoxueInput ? readFileSync(resolve(options.haohaoxueInput), "utf8") : await fetchText(HAOHAOXUE_PAGE);
    const raw = parseHaohaoxueHtml(html);
    if (!raw.length) throw new Error("没有在页面里找到内嵌提示词数据，站点结构可能已变化");
    return { revision: new Date().toISOString().slice(0, 10), raw };
}

function buildHaohaoxueEntries(raw) {
    const unknown = new Set();
    const entries = raw
        .filter((item) => item.id && typeof item.prompt === "string" && item.prompt.length > 60)
        .map((item) => {
            if (item.category && !HAOHAOXUE_CATEGORY_LABELS[item.category]) unknown.add(item.category);
            return {
                id: `haohaoxue:${item.id}`,
                title: (item.title_zh || item.title || item.id).trim(),
                description: clip(item.description_zh || item.title || item.id, DESCRIPTION_LIMIT),
                image: `https://www.haohaoxue.com/images/prompts/${item.id}.webp`,
                // 这个源全是图片生成提示词，模型字段也都是图片模型。
                mode: "image",
                prompt: item.prompt,
                ...(item.prompt_zh ? { promptZh: item.prompt_zh } : {}),
                ...(item.category ? { category: item.category } : {}),
                ...(Array.isArray(item.tags) && item.tags.length ? { tags: item.tags.slice(0, 6) } : {}),
                ...(item.ratio ? { ratio: item.ratio } : {}),
                sourceId: "haohaoxue",
                ...(item.author ? { credit: item.author } : {}),
                sourceUrl: HAOHAOXUE_PAGE,
                featured: item.featured === true,
                updated: typeof item.v === "number" ? item.v : 0,
            };
        })
        .sort((left, right) => Number(right.featured) - Number(left.featured) || right.updated - left.updated)
        .map(({ featured, updated, ...entry }) => ({ ...entry, ...(featured ? { featured: true } : {}) }));
    if (unknown.size) console.warn(`⚠ 好好学出现未译分类码（页面会回落显示原码）: ${[...unknown].join(", ")}`);
    return entries;
}

// ── YouMind 提示词库（nano-banana-pro / gpt-image-2） ──────────────────────

async function resolveRepoRevision(repo) {
    const response = await fetch(`https://api.github.com/repos/${repo}/commits/main`, {
        headers: { Accept: "application/vnd.github.sha", "User-Agent": UA },
    });
    if (!response.ok) throw new Error(`取 ${repo} revision 失败: HTTP ${response.status}`);
    return (await response.text()).trim();
}

/**
 * README 是脚本生成的，结构稳定：
 *   ### No. N: <分类标签> - <标题>
 *   #### 📖 描述 / #### 📝 提示词（代码块）/ #### 🖼️ 生成图片（img src）/ #### 📌 详情（作者、来源）
 * 分类标签先按同一文件里「按分类浏览」的链接表换成稳定的英文 code，
 * 这样分类 id 不会随中文译名调整而漂移。
 */
function parseYoumindReadme(markdown, sourceSlug) {
    const taxonomy = new Map();
    for (const match of markdown.matchAll(/\[([^\]]+)\]\(https:\/\/youmind\.com\/[^)]*\?categories=([a-z0-9-]+)\)/g)) {
        taxonomy.set(match[1].trim(), match[2]);
    }

    const entries = [];
    for (const block of markdown.split(/\n### No\. \d+:/).slice(1)) {
        const heading = (block.split("\n")[0] ?? "").trim();
        const prompt = block.match(/#### 📝 提示词\s*\n+```[a-z]*\s*\n([\s\S]*?)\n```/)?.[1]?.trim();
        const image = block.match(/<img src="(https?:[^"]+)"/)?.[1];
        if (!heading || !prompt || !image) continue;

        // 标题本身可能带 " - "，只有前缀命中已知分类时才按它切开。
        const separator = heading.indexOf(" - ");
        const prefix = separator > 0 ? heading.slice(0, separator).trim() : "";
        const category = taxonomy.get(prefix);
        const title = category ? heading.slice(separator + 3).trim() : heading;
        if (!title) continue;

        const description = block.match(/#### 📖 描述\s*\n+([\s\S]*?)\n+#### 📝 提示词/)?.[1]?.trim() ?? "";
        const id = block.match(/youmind\.com\/[^)]*\?id=(\d+)/)?.[1] ?? `${sourceSlug}-${entries.length + 1}`;
        const author = block.match(/- \*\*作者:\*\*\s*\[([^\]]+)\]/)?.[1]?.trim();
        const sourceUrl = block.match(/- \*\*来源:\*\*\s*\[[^\]]+\]\((https?:[^)]+)\)/)?.[1];

        entries.push({
            id: `youmind:${id}`,
            title,
            description: clip(description, DESCRIPTION_LIMIT),
            image,
            // 两个上游库都是图片模型（Nano Banana Pro / GPT Image 2），所以整源都是图片提示词。
            mode: "image",
            prompt,
            ...(category ? { category } : {}),
            sourceId: "youmind",
            ...(author ? { credit: author } : {}),
            ...(sourceUrl ? { sourceUrl } : {}),
        });
    }
    return { entries, categories: Object.fromEntries([...taxonomy].map(([label, code]) => [code, label])) };
}

async function loadYoumind() {
    const revisions = [];
    const entries = [];
    const categories = {};
    for (const { repo, slug } of YOUMIND_REPOS) {
        const revision = await resolveRepoRevision(repo);
        revisions.push(`${slug}@${revision.slice(0, 8)}`);
        const markdown = await fetchText(`https://raw.githubusercontent.com/${repo}/${revision}/README_zh.md`);
        const parsed = parseYoumindReadme(markdown, slug);
        entries.push(...parsed.entries);
        Object.assign(categories, parsed.categories);
        console.log(`  youmind/${slug.padEnd(12)}: ${parsed.entries.length} 条`);
    }
    if (!entries.length) throw new Error("YouMind 没有解析出任何条目，README 结构可能已变化");
    // 两个库是同一位发布方维护的姊妹库，偶尔会互相转载同一条，按标题去重。
    const seen = new Set();
    const unique = entries.filter((entry) => (seen.has(entry.title) ? false : (seen.add(entry.title), true)));
    return { revision: revisions.join(" + "), entries: unique, categories };
}

// ── 产物 ────────────────────────────────────────────────────────────────────

/** 目录里只留跨源共用的字段，heat/updated 这类排序辅助不落库。 */
function toCatalogEntry({ heat, updated, featured, ...entry }) {
    return { ...entry, ...(featured ? { featured: true } : {}) };
}

/** 只留各来源的上游版本号：几行字，跟着包走，供署名与合规展示。 */
function renderSourceRevisions(revisions) {
    return `// 由 scripts/import-inspirations.mjs 生成，勿手工编辑。
// 各来源同步时的上游版本号，供灵感页与画廊署名展示。

export const HIGHLIGHT_REVISIONS = {
${Object.entries(revisions)
    .map(([name, value]) => `    ${name}: ${JSON.stringify(value)},`)
    .join("\n")}
};
`;
}

/**
 * 首页画廊的池子，落成静态 JSON 由页面启动时拉取。
 * 连正文一起打进包的话，几百条提示词正文就压在首屏 JS 上，
 * 而这份数据只服务画廊一处，不值当。
 *
 * 只收描述非空的条目：画廊卡片是"行动点 / 标题 / 描述"三行固定版式，
 * 描述空着的卡片第三行会缺一块。这些条目仍留在全量目录里，灵感页照常展示。
 */
function renderGalleryPool(revisions, highlights) {
    const entries = Object.values(highlights)
        .flat()
        .filter((entry) => entry.description)
        .map((entry) => ({ ...toCatalogEntry(entry), featured: true }));
    return JSON.stringify({ generatedAt: new Date().toISOString(), revisions, entries });
}
/**
 * 下载上游封面并压成本地缩略图，返回可写进目录的相对路径。
 * 返回 skipped 表示这张封面不可用（下载失败除外——那是抛错），调用方应把该条移出画廊池。
 */
async function buildThumb(source, entry, name, force) {
    const relative = `/${THUMB_DIR}/${source}/${name}.webp`;
    const target = join(SHOT_DIR, THUMB_DIR, source, `${name}.webp`);
    if (existsSync(target) && !force) {
        return statSync(target).size < MIN_THUMB_BYTES ? { skipped: true } : { relative, downloaded: false };
    }
    const response = await fetch(entry.image, { headers: { "User-Agent": UA, Referer: new URL(entry.image).origin } });
    if (!response.ok) throw new Error(`下载封面失败 ${entry.image}: HTTP ${response.status}`);
    const resized = await new Bun.Image(Buffer.from(await response.arrayBuffer())).resize(THUMB_WIDTH).webp({ quality: THUMB_QUALITY }).bytes();
    if (resized.length < MIN_THUMB_BYTES) {
        console.warn(`  ⚠ 封面像纯色/白板，跳过: ${entry.id}（压后 ${resized.length}B）`);
        return { skipped: true };
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, resized);
    return { relative, downloaded: true };
}

/** 删掉不再被引用的缩略图，避免换了一批之后旧文件永远留在仓库里。 */
function pruneOrphanThumbs(source, keepNames) {
    const target = join(SHOT_DIR, THUMB_DIR, source);
    if (!existsSync(target)) return 0;
    let removed = 0;
    for (const file of readdirSync(target)) {
        if (keepNames.has(file.replace(/\.webp$/, ""))) continue;
        unlinkSync(join(target, file));
        removed += 1;
    }
    return removed;
}

/**
 * 各来源的加载与条目构造。加新来源时在这里加一项，main 只负责编排与落盘。
 */
const SOURCE_PIPELINES = [
    {
        name: "seedance",
        file: "seedance.json",
        coverName: (entry) => sanitizeFileName(entry.id.replace(/^seedance:/, "")),
        load: async (options) => {
            const { revision, raw } = await loadSeedance(options);
            return { revision, note: `上游 ${raw.length} 条`, entries: buildSeedanceEntries(raw), categories: SEEDANCE_CATEGORY_LABELS };
        },
    },
    {
        name: "haohaoxue",
        file: "haohaoxue.json",
        coverName: (entry) => sanitizeFileName(entry.id.replace(/^haohaoxue:/, "")),
        load: async (options) => {
            const { revision, raw } = await loadHaohaoxue(options);
            return { revision, note: `页面内嵌 ${raw.length} 条`, entries: buildHaohaoxueEntries(raw), categories: HAOHAOXUE_CATEGORY_LABELS };
        },
    },
    {
        name: "youmind",
        file: "youmind.json",
        coverName: (entry) => sanitizeFileName(entry.id.replace(/^youmind:/, "")),
        load: async () => {
            const { revision, entries, categories } = await loadYoumind();
            return { revision, note: "两个姊妹库", entries, categories };
        },
    },
];

/**
 * 等距抽 count 条，而不是取前 count 条。
 * 上游 README 是按分类成段排的，取前 N 条会让画廊池子全是开头那几个分类；
 * 等距铺开才能横跨全部分类，抽出来的图才不重样。
 */
function strideSample(list, count) {
    if (list.length <= count) return [...list];
    if (count === 1) return [list[0]];
    const picked = [];
    const seen = new Set();
    for (let index = 0; index < count; index += 1) {
        const at = Math.round((index * (list.length - 1)) / (count - 1));
        if (seen.has(at)) continue;
        seen.add(at);
        picked.push(list[at]);
    }
    return picked;
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const selected = SOURCE_PIPELINES.filter((pipeline) => !options.only || options.only === pipeline.name);
    if (!selected.length) throw new Error(`--only 不认识的来源: ${options.only}`);

    mkdirSync(PUBLIC_DIR, { recursive: true });
    const revisions = {};
    const counts = {};
    const categoriesBySource = {};
    const highlights = {};
    let downloaded = 0;
    let skippedThumbs = 0;
    let pruned = 0;

    for (const pipeline of SOURCE_PIPELINES) {
        if (!selected.includes(pipeline)) {
            // 只同步其中一部分来源时，其余来源沿用上次落盘的 revision 与条目数，
            // 免得 manifest 把没动过的来源写成空值。
            const existing = JSON.parse(readFileSync(join(PUBLIC_DIR, pipeline.file), "utf8"));
            revisions[pipeline.name] = existing.revision;
            counts[pipeline.name] = existing.count;
            categoriesBySource[pipeline.name] = existing.categories ?? {};
            highlights[pipeline.name] = [];
            continue;
        }

        const loaded = await pipeline.load(options);
        const { entries } = loaded;
        if (!entries.length) throw new Error(`${pipeline.name} 没有解析出任何条目`);
        revisions[pipeline.name] = loaded.revision;
        counts[pipeline.name] = entries.length;
        categoriesBySource[pipeline.name] = loaded.categories ?? {};

        // 只给一部分条目生成本地缩略图：全量一千多条都压一遍会让仓库和同步时间都失控，
        // 其余继续引用上游 CDN，由灵感页按需拉取。
        const thumbed = [];
        const thumbNames = new Set();
        for (const entry of strideSample(entries, options.thumbs)) {
            const name = pipeline.coverName(entry);
            const result = await buildThumb(pipeline.name, entry, name, options.force);
            if (result.skipped) {
                skippedThumbs += 1;
                continue;
            }
            // 直接把 image 指向本地缩略图：目录 JSON 和精选模块都从这里取值。
            entry.image = result.relative;
            thumbNames.add(name);
            thumbed.push(entry);
            if (result.downloaded) downloaded += 1;
        }
        pruned += pruneOrphanThumbs(pipeline.name, thumbNames);
        highlights[pipeline.name] = thumbed;

        writeFileSync(join(PUBLIC_DIR, pipeline.file), JSON.stringify({ source: pipeline.name, revision: loaded.revision, count: entries.length, categories: loaded.categories ?? {}, entries: entries.map(toCatalogEntry) }), "utf8");

        console.log(`${pipeline.name.padEnd(12)}: ${loaded.note} → 入库 ${entries.length} 条，本地缩略图 ${thumbed.length} 张`);
    }

    writeFileSync(REVISIONS_FILE, renderSourceRevisions(revisions), "utf8");
    writeFileSync(GALLERY_POOL_FILE, renderGalleryPool(revisions, highlights), "utf8");

    const manifest = {
        generatedAt: new Date().toISOString(),
        sources: Object.fromEntries(Object.entries(revisions).map(([name, revision]) => [name, { revision, count: counts[name], categories: categoriesBySource[name] ?? {} }])),
    };
    writeFileSync(join(PUBLIC_DIR, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

    console.log(`新下载缩略图: ${downloaded}${skippedThumbs ? `，跳过不可用封面 ${skippedThumbs} 张` : ""}`);
    console.log(`清理孤儿文件: ${pruned}`);
    console.log(`画廊池      : ${GALLERY_POOL_FILE}`);
    console.log(`版本号模块  : ${REVISIONS_FILE}`);
    console.log(`全量目录    : ${PUBLIC_DIR}`);
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
