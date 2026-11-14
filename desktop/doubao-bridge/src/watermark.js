'use strict';
/* watermark.js —— 豆包生成物「去水印」规则还原（纯函数，不依赖浏览器 / 无网络 IO）
 *
 * ============================ 证据来源与置信度 ============================
 * 置信度三档：
 *   【实测】      真机抓包 / 帧级像素取证 / 项目内定案文档，可当事实用
 *   【字符串推断】 从 .jsc 常量表（V8 字节码，不可反编译）读到正则/字段名，语义由字面
 *               形态推断，未见可执行源码
 *   【保守】      无信号时的兜底口径，不代表事实
 *
 * 引用约定：`strings:116` = `D:\yingce\tmp-wool-doubao-strings.txt` 第 116 行
 * （该文件是从 `inject/doubao.jsc` 抽出的可打印字符串表，逐行可 grep 复现）。
 * 注意：字符串表**不带地址**，所以这里一律引用行号，不编造 @0x 偏移。
 *
 * -- 规则表（全部可复核） --
 * R1  /lr=[^&]+/                  strings:116
 * R2  /logo_type=[^&]+/           strings:118
 * R3  /watermark=1/               strings:120
 * R4  [&?]logo=[^&]*             strings:123（正则体；末尾星号后紧跟斜杠会截断注释，故省去包裹斜杠）
 *     四条相邻（116~123），即 intl manifest 所称「四行参数改写」。四条各自被赋给一个混淆
 *     变量，表里**没有可打印的替换字面量** → 本条模块按「整段删除」实现，绝不构造新值。
 * R5  /rc_gen_image\/([^?~]+)/    strings:126 —— 生成图身份 id；`~` 是 CDN 模板分隔符，
 *     出现在正则字符类里，说明生成图 URL 可能带 `~tplv…` 模板段。
 * R6  no_watermark_url            strings:168 —— 载荷里的「干净版」字段（仅有名字，无样例）
 * R7  /\.[^.]+$/                  strings:165 —— 取扩展名
 *
 * -- 关键否定性证据（决定「不要做什么」，比规则本身更重要） --
 * N1 【实测】`inject/adapters/doubao-intl/manifest.json` `_note` 原文：
 *     「四行参数改写方案作废（探针实证 lr/logo_type 不在 TOS 签名内，改写不破坏直链但
 *      watermark_dyn 文件本体即带水印，改参数无效）」。
 *     → **改参数拿不到无水印文件**。视频侧必须交付原始直链，不做 URL 改写。
 * N2 【实测】strings 里 grep `unwatermarked` / `cici_ai` / `watermark_dyn` / `tplv` 均为 0 命中；
 *     只有 `watermark=1`(120) 与 `no_watermark_url`(168)。
 *     → 国内豆包代码里根本没有 lr 的取值分支；lr 语义来自国际版 manifest，不是国内实现。
 * N3 【实测】2026-11-10 真机 chain 载荷（cmd=3100）解出 4 条 v11/v26-vdl.doubao.com 直链，
 *     均无 lr / logo_type / watermark，也无 no_watermark_url 字段。
 * N4 【实测·已被 N7 推翻，保留作历史】帧级取证 `work\wool\doubao-bridge\data\wm\` 当时判定
 *     国内视频交付文件本体无水印；2026-11-10 复核发现同一路径下交付的文件确实带水印
 *     （见 N7）。结论：那次取样的样本或判定方法有问题，不要再引用。
 * N5 【实测·跨平台】`dreamina/nowatermark.jsc` 与 `jimeng/nowatermark.jsc` 都有同一正则：
 *     /^https?:\/\/[^/]+(\/[^?]*?)(?:~tplv[^?]*)?(\?.*)?$/  以及 verifyImageLoads；
 *     dreamina 另有 RESIGN_PATH / resignCleanUrl（从历史接口取原始地址后重新签名）。
 *     → 跨平台方案是「剥 CDN 模板段 + 换源 + 交付前验证能否加载」，不是 query 净化。
 *
 * N6 【实测·2026-11-10 真机 A/B，结论：豆包图片水印**无法**用 URL 手段去除】
 *     一次真实生图抓到的同图两变体（同一 rc_gen_image id）：
 *       …/rc_gen_image/07feb04d….jpeg~tplv-a9rns2rl98-cthumb_lwm3.png?<签名>
 *       …/rc_gen_image/07feb04d….jpeg~tplv-a9rns2rl98-cgen_lwm3.png?<签名>
 *     `lwm3` = logo watermark，水印是**模板名的一部分**，不是 query 参数。
 *     A/B 结果（同一签名逐条改）：
 *       · 改模板段 cgen_lwm3→cgen / →cthumb / 去掉 _lwm3 / 整段 ~tplv 剥掉 → 全部 **403**
 *         （签名覆盖完整 path，含模板段 —— 与 N1 里「视频 lr 不在签名内」正好相反）
 *       · 追加 query：&watermark=0 / &lwm=0 / &logo=0 / &logo_type=0 / &no_watermark=1
 *         → 全部 **200 且字节完全相同**（sha 一致），说明 query 根本不参与内容选择
 *     → 图片侧**没有任何可操作的 URL 开关**。可做的只有「在服务端给出的变体里挑」，
 *       真正去水印只能靠后处理（重绘/修复），或换用不烧水印的通道。
 *       （注意：N4 已被 N7 推翻——**视频也带水印**，图片/视频两端都逃不掉。）
 *
 * N7 【实测·2026-11-10 复核，**推翻 N4**】国内视频交付文件其实是带水印的。
 *     任务 task_3ead308db7990231d4：chain 直链（无任何水印参数）下载后 720x720 HEVC、
 *     10.04s、663KB，抽帧后**左上角清晰烧着「豆包AI生成」**。
 *     → 免费档没有无水印变体：老代码等 `lr=unwatermarked` 永远等不到，只能耗满 20 分钟
 *       超时再交付同一份带水印文件（run34 的 1216s 就是这么来的）。
 *     → 处置：**交付策略与水印真相分离**。策略上立即交付（等不到就不等），
 *       真相上如实标 `watermark=true`。别再拿「更早的帧级取证」当免死金牌。
 *
 * ======================================================================
 *
 * 设计纪律（对应任务硬约束）：
 *   1. 只做**删除式**净化（删水印相关 query 段），绝不构造新的参数值——N1/N2 已否定
 *      「改参数能拿干净文件」，凭空写 lr=unwatermarked 属于伪造证据。
 *   2. 视频 URL 直接交给用户、桥没有「下载验证」环节 → 净化结果默认不用于视频交付
 *      （见 SANITIZE_VIDEO_URLS=false）。图片侧由 driver 下载验证 + 失败回退，才允许先试。
 *   3. 任何异常（null / 空串 / 非 URL / 无 query）一律原样返回，绝不抛异常、绝不产 404。
 *   4. 幂等：sanitizeAssetUrl(sanitizeAssetUrl(u)) === sanitizeAssetUrl(u)。
 */

/* ---------------- 常量与证据锚点 ---------------- */

/** 规则表（供取证/日志/测试引用；id 与文件头注释一一对应）
 *  evidence 一律是可复核的位置：`strings:N` = tmp-wool-doubao-strings.txt 第 N 行。 */
const RULE_TABLE = Object.freeze({
  'R1:lr': { pattern: 'lr=[^&]+', evidence: 'strings:116', confidence: '字符串推断' },
  'R2:logo_type': { pattern: 'logo_type=[^&]+', evidence: 'strings:118', confidence: '字符串推断' },
  'R3:watermark=1': { pattern: 'watermark=1', evidence: 'strings:120', confidence: '字符串推断' },
  'R4:logo': { pattern: '[&?]logo=[^&]*', evidence: 'strings:123', confidence: '字符串推断' },
  'R5:rc_gen_image': { pattern: 'rc_gen_image\\/([^?~]+)', evidence: 'strings:126', confidence: '字符串推断' },
  'R6:no_watermark_url': { pattern: 'no_watermark_url', evidence: 'strings:168', confidence: '字符串推断' },
  'N1:四行参数改写作废': { pattern: '-', evidence: 'doubao-intl/manifest.json _note', confidence: '实测' },
});

/** 水印相关 query key（R1~R4 的 key 面） */
const WATERMARK_KEYS = Object.freeze(['lr', 'logo_type', 'watermark', 'logo']);

/** 生成图身份正则（R5）。URL 里的身份段到 `~`（CDN 模板分隔符）或 `?` 为止 */
const RC_GEN_IMAGE_RE = /rc_gen_image\/([^?~]+)/;

/** 平台 host 归类：
 *  doubao-cn  = www.doubao.com 及其 CDN（doubao.jsc @0x2308 有 /(^|\.)doubao\.com$/ 做同域校验）
 *  dola-intl  = 豆包国际版 dola.com（doubao-intl/manifest.json hostnames）
 *  bytedance  = 字节系其它 CDN（imagex/byteimg/tos 同族，dreamina/jimeng 实测同源）
 *  other      = 一律不碰 */
const HOST_RULES = Object.freeze([
  { platform: 'doubao-cn', test: /(^|\.)doubao\.com$/i },
  { platform: 'dola-intl', test: /(^|\.)dola\.com$/i },
  {
    platform: 'bytedance',
    test: /(^|\.)(byteimg\.com|ibyteimg\.com|bytecdn\.com|pstatp\.com|snssdk\.com|bytedance\.com|capcut\.com|capcutcdn\.com|jianying\.com)$/i,
  },
]);

/** lr 的语义只在豆包两版上实证（N2 / R1），故 lr 净化只对这两个平台生效 */
const LR_PLATFORMS = Object.freeze(['doubao-cn', 'dola-intl']);

/** 视频交付是否允许用净化后的 URL。
 *  默认 false：N1 实测「改参数无效」，且视频 URL 直接交给用户、桥没有下载验证机会，
 *  一旦构造错就是交付 404。保留此开关仅为将来真机验证留接入点。 */
const SANITIZE_VIDEO_URLS = false;

/* ---------------- 基础工具 ---------------- */

function platformOf(hostname) {
  const h = String(hostname || '');
  if (!h) return 'other';
  for (const r of HOST_RULES) if (r.test.test(h)) return r.platform;
  return 'other';
}

function parse(url) {
  if (typeof url !== 'string') return null;
  const raw = url.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u;
  } catch (e) {
    return null;
  }
}

/** 取 query 里的 key/value 列表（只读；不做任何重编码，专供分类与判定） */
function queryEntries(u) {
  if (!u || typeof u.search !== 'string' || u.search.length <= 1) return [];
  const out = [];
  for (const seg of u.search.slice(1).split('&')) {
    if (!seg) continue;
    const i = seg.indexOf('=');
    const key = i < 0 ? seg : seg.slice(0, i);
    const val = i < 0 ? '' : seg.slice(i + 1);
    out.push({ key, value: val });
  }
  return out;
}

function queryGet(u, key) {
  const hit = queryEntries(u).find((e) => e.key === key);
  return hit ? hit.value : null;
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/* ---------------- 规则 1：URL 净化（删除式） ---------------- */

/** 该 key 在该平台下是否属于「水印参数」且应删除（严格对齐 R1~R4 的字面形态） */
function shouldStrip(key, value, platform) {
  switch (key) {
    case 'lr':
      // R1：/lr=[^&]+/ 要求值非空 → lr=（空值）不在 WOOL 正则覆盖面内，保持不动
      return LR_PLATFORMS.indexOf(platform) >= 0 && value !== '';
    case 'logo_type':
      // R2：/logo_type=[^&]+/ 同样要求值非空
      return platform !== 'other' && value !== '';
    case 'watermark':
      // R3：/watermark=1/ 只命中字面值 1（watermark=0 / watermark=10 一律不动）
      return platform !== 'other' && value === '1';
    case 'logo':
      // R4：/[&?]logo=[^&]*/ 允许空值（logo= 也删）
      return platform !== 'other';
    default:
      return false;
  }
}

/**
 * 净化生成物 URL 的水印相关 query（R1~R4）。
 * 只做删除、只动 query 段，path / host / 其余参数与顺序原样保留（TOS 签名不重排）。
 * @param {string} url
 * @returns {string} 净化后的 URL；非法输入或无需净化时原样返回
 */
function sanitizeAssetUrl(url) {
  const u = parse(url);
  if (!u) return url; // 非法 / 非 http(s) / null / 空串 → 原样返回（纪律 3）
  const platform = platformOf(u.hostname);
  if (platform === 'other') return url; // 非字节系域一律不碰（按域名生效，父级要求）

  const raw = url.trim();
  const hashAt = raw.indexOf('#');
  const hash = hashAt >= 0 ? raw.slice(hashAt) : '';
  const beforeHash = hashAt >= 0 ? raw.slice(0, hashAt) : raw;
  const qAt = beforeHash.indexOf('?');
  if (qAt < 0) return url; // 无 query → 原样返回

  const head = beforeHash.slice(0, qAt);
  const segs = beforeHash.slice(qAt + 1).split('&');
  const kept = [];
  let changed = false;
  for (const seg of segs) {
    if (!seg) continue;
    const i = seg.indexOf('=');
    const key = i < 0 ? seg : seg.slice(0, i);
    const val = i < 0 ? '' : seg.slice(i + 1);
    if (shouldStrip(key, val, platform)) {
      changed = true;
      continue;
    }
    kept.push(seg);
  }
  if (!changed) return url; // 幂等：没有可删的就原样返回
  // 删干净末尾的 ?，避免产出 `...?` 这种怪 URL
  return head + (kept.length ? '?' + kept.join('&') : '') + hash;
}

/* ---------------- 规则 2：分类 ---------------- */

const THUMB_PATTERNS = [
  /thumb/i,                     // 本桥真机取证：豆包生成图有 cthumb 缩略变体（§N3 同批截图）
  /[?&~/,]w_[1-9][0-9]{1,3}\b/, // imagex/CDN 缩放模板形态（跨平台通用，非豆包实证）
  /resize,[wh]_[1-9][0-9]{1,3}\b/i,
];

function kindOf(url, u) {
  if (!u) return 'unknown';
  if (THUMB_PATTERNS.some((re) => re.test(url))) return 'thumb';
  if (RC_GEN_IMAGE_RE.test(url)) return 'full'; // R5：生成图正标记
  if (/\/video\/tos\//.test(url)) return 'full';
  return 'unknown';
}

/**
 * 判定一个生成物 URL 的水印状态（只读、不改 URL）。
 *
 * 两个字段各管一件事，别混：
 *   watermarked —— URL 上**已证/已推断**带水印吗（证据意义上的真相，不猜）
 *   known       —— 这条 URL 到底有没有给出可判定的信号
 * → 「无水印参数、但也没有 lr」的国内直链属于 known=false（不误判成水印），
 *   是否按「带水印」保守处理由调用方决定（driver 的 fileWatermark 就取 known?watermarked:true）。
 *
 * @param {string} url
 * @returns {{watermarked: boolean, known: boolean, kind: 'full'|'thumb'|'unknown',
 *            platform: string, confidence: '实测'|'字符串推断'|'保守', reason: string,
 *            rule: string|null}}
 */
function classifyAsset(url) {
  const u = parse(url);
  if (!u) {
    return {
      watermarked: true, // 与旧 fileWatermark 的 try/catch 兜底同口径：无法判定即保守
      known: false,
      kind: 'unknown',
      platform: 'invalid',
      confidence: '保守',
      reason: '非法/非 http URL：无法判定，按带水印保守处理（原样返回）',
      rule: null,
    };
  }
  const platform = platformOf(u.hostname);
  const kind = kindOf(url, u);

  /* R8 模板段判定（2026-11-10 真机定案，优先级最高）：豆包生成图的"水印与否"直接
   * 写在 CDN 模板名里，比任何 query 参数都可靠。
   *   ~tplv-xxx-image_raw.png    → 原始图，**无水印**（实测：水印区亮度 254.9 近纯白）
   *   ~tplv-xxx-cgen_dwm3.png    → 全图 + 动态水印（实测水印区 232.9，肉眼可见「豆包AI生成」）
   *   ~tplv-xxx-cthumb_dwm3.*    → 缩略 + 水印
   * 载荷里 image_ori_raw 字段给的就是 image_raw 那一版 —— 图片去水印的真正入口在这里。 */
  const tpl = (url.match(/~tplv-[a-z0-9]+-([a-z0-9_]+)\.(?:png|heic|jpe?g)/i) || [])[1] || '';
  if (/image_raw$/i.test(tpl)) {
    return {
      watermarked: false, known: true, kind, platform, confidence: '实测',
      reason: '模板 ' + tpl + '：image_ori_raw 原始图，实测无水印', rule: 'R8:image_raw',
    };
  }
  if (/_?(dwm|lwm)\d*$/i.test(tpl)) {
    return {
      watermarked: true, known: true, kind, platform, confidence: '实测',
      reason: '模板 ' + tpl + '：带烧录水印（dwm/lwm = 动态/静态 logo 水印）', rule: 'R8:dwm',
    };
  }

  const lr = queryGet(u, 'lr');
  const logoType = queryGet(u, 'logo_type');
  const watermark = queryGet(u, 'watermark');
  const logo = queryGet(u, 'logo');

  // R1 优先：lr 是三档语义里最硬的信号（intl manifest 实测）
  if (lr === 'unwatermarked') {
    return {
      watermarked: false,
      known: true,
      kind,
      platform,
      confidence: '实测',
      reason: 'lr=unwatermarked：WOOL intl manifest 定案的「无水印文件本体」标记',
      rule: 'R1:lr',
    };
  }
  if (lr === 'cici_ai') {
    return {
      watermarked: true,
      known: true,
      kind,
      platform,
      confidence: '实测',
      reason: 'lr=cici_ai：页面预览变体，水印烧录在文件上（intl manifest 实测）',
      rule: 'R1:lr',
    };
  }
  if (lr === 'video_gen_watermark_dyn') {
    // 两平台结论相反，按平台分流（N3 帧级取证 vs manifest 用户播放实证）
    if (platform === 'doubao-cn') {
      return {
        watermarked: false,
        known: true,
        kind,
        platform,
        confidence: '实测',
        reason: 'lr=video_gen_watermark_dyn（国内）：watermark_dyn 只是 CDN 模板标签，2026-10-24 帧级取证文件本体干净',
        rule: 'R1:lr',
      };
    }
    return {
      watermarked: true,
      known: true,
      kind,
      platform,
      confidence: '实测',
      reason: 'lr=video_gen_watermark_dyn（国际版）：动态烧录水印，文件本体带水印（intl manifest 实测）',
      rule: 'R1:lr',
    };
  }
  if (lr !== null && lr !== '') {
    return {
      watermarked: true,
      known: true,
      kind,
      platform,
      confidence: '保守',
      reason: 'lr=' + lr + '：未实证的 lr 值，按带水印保守处理',
      rule: 'R1:lr',
    };
  }

  // R2/R3/R4：这三条正是 WOOL 要剥掉的水印参数，出现即视为水印变体（字符串推断）
  if (watermark === '1') {
    return { watermarked: true, known: true, kind, platform, confidence: '字符串推断', reason: '命中 R3 watermark=1（WOOL 四行净化之一）', rule: 'R3:watermark=1' };
  }
  if (logoType !== null && logoType !== '') {
    return { watermarked: true, known: true, kind, platform, confidence: '字符串推断', reason: '命中 R2 logo_type=（WOOL 四行净化之一）', rule: 'R2:logo_type' };
  }
  if (logo !== null) {
    return { watermarked: true, known: true, kind, platform, confidence: '字符串推断', reason: '命中 R4 logo=（WOOL 四行净化之一）', rule: 'R4:logo' };
  }

  // 无水印参数、也没有 lr —— 国内视频链路就是这个形态（N2 真机 chain 载荷实证）。
  // URL 层没有任何信号：不冒充「带水印」（known=false、watermarked=false，避免误判），
  // 是否保守处理交给调用方；文件真相另见 N3 帧级取证结论。
  return {
    watermarked: false,
    known: false,
    kind,
    platform,
    confidence: '保守',
    reason:
      platform === 'doubao-cn'
        ? '无 lr/水印参数（国内链路常态）：URL 层无可判定信号；文件本体依 2026-10-24 帧级取证为干净'
        : '无 lr/水印参数：URL 层无可判定信号',
    rule: null,
  };
}

/* ---------------- 规则 3：变体排序 ---------------- */

/** 生成图/视频的身份标识（去重用）：优先 R5 的 rc_gen_image id，其次 TOS 路径整段 */
function assetId(url) {
  if (typeof url !== 'string' || !url) return '';
  const m = RC_GEN_IMAGE_RE.exec(url);
  if (m) return 'rc:' + m[1];
  const u = parse(url);
  if (!u) return url;
  const parts = u.pathname.split('/').filter(Boolean);
  const i = parts.findIndex((p) => p === 'video' || p === 'tos');
  return (i >= 0 ? parts.slice(i).join('/') : u.pathname) || url;
}

/**
 * 对一组候选变体排序：同一身份下「无水印 → 非缩略图」优先，组间按首次出现顺序。
 * @param {string[]} urls
 * @param {{cleanUrls?: string[]}} [opts] cleanUrls：外部已知干净（如 R6 no_watermark_url 字段值）
 * @returns {string[]} 排序后的新数组（不修改入参；非数组返回 []）
 */
function rankVariants(urls, opts) {
  if (!Array.isArray(urls)) return [];
  const clean = new Set((opts && Array.isArray(opts.cleanUrls) ? opts.cleanUrls : []).filter((s) => typeof s === 'string'));
  const items = [];
  const groupOrder = new Map();
  urls.forEach((url, i) => {
    if (typeof url !== 'string' || !url) return;
    const id = assetId(url);
    if (!groupOrder.has(id)) groupOrder.set(id, groupOrder.size);
    const c = classifyAsset(url);
    const wmScore = clean.has(url) || c.watermarked === false ? 0 : 2;
    const thumbScore = c.kind === 'thumb' ? 1 : 0;
    items.push({ url, i, id, group: groupOrder.get(id), score: wmScore + thumbScore });
  });
  items.sort((a, b) => (a.group - b.group) || (a.score - b.score) || (a.i - b.i)); // 稳定：末位用原序
  return items.map((it) => it.url);
}

/* ---------------- 规则 4：载荷里的干净字段（R6） ---------------- */

const AHR0_RE = /aHR0[A-Za-z0-9+/=_-]{8,}/g;

/** aHR0 = base64("http")；穿透多层转义 JSON 直提后解码（WOOL doubao-intl/capture.jsc 同款思路） */
function decodeAhr0(token) {
  try {
    let b = String(token).replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) b += '=';
    const s = Buffer.from(b, 'base64').toString('utf8');
    return /^https?:\/\//.test(s) ? s : '';
  } catch (e) {
    return '';
  }
}

/**
 * 从 chain 载荷里提取 no_watermark_url 字段指向的直链（R6）。
 * 【字符串推断】该字段名只在 doubao.jsc 常量表里出现（main.jsc 有同名标识符 noWatermarkUrl），
 * 未见真实载荷样例 → 这里只做「存在才取」的加法，取不到就返回空数组，绝不影响现有链路。
 * @param {string} text
 * @returns {string[]}
 */
function extractNoWatermarkUrls(text) {
  if (typeof text !== 'string' || !text) return [];
  const out = [];
  const keyRe = /"?no[_-]?watermark[_-]?url"?/gi;
  let m;
  while ((m = keyRe.exec(text)) !== null) {
    const window = text.slice(m.index, m.index + 800); // 值可能被多层转义，给一个窗口
    const ahr0 = AHR0_RE.exec(window);
    AHR0_RE.lastIndex = 0;
    const http = /https?:\\?\/\\?\/[^"'\s\\]+/.exec(window);
    const cand = ahr0 ? decodeAhr0(ahr0[0]) : http ? http[0].replace(/\\\//g, '/') : '';
    if (cand && out.indexOf(cand) < 0) out.push(cand);
  }
  return out;
}

/* ---------------- 规则 5：跨平台模板段剥离（对豆包已证伪，仅供对照） ---------------- */

/**
 * 剥掉 ByteDance CDN 的模板段 `~tplv-…`（水印/缩放/AI 徽标都叠在模板上）。
 *
 * 【已证伪·豆包，见 N6】2026-11-10 真机：把 `cgen_lwm3` 改成 `cgen`、去掉 `_lwm3`、
 *   或整段剥掉 `~tplv`，**全部 403**——签名覆盖完整 path 含模板段。追加 query 开关
 *   （watermark=0 等）则字节完全不变。**豆包图片没有任何 URL 开关可操作。**
 * 【仅存参考·dreamina/jimeng】那两个平台的 nowatermark.jsc 才用这套：
 *   /^https?:\/\/[^/]+(\/[^?]*?)(?:~tplv[^?]*)?(\?.*)?$/  + verifyImageLoads，
 *   dreamina 另有 RESIGN_PATH / resignCleanUrl（历史的重新签名才是关键，单靠剥段不够）。
 *
 * 因此：`TEMPLATE_STRIP_USABLE_FOR_DOUBAO = false`，本函数**不接入任何豆包链路**，
 * 保留只为跨平台对照与将来换平台时的复用。
 * @param {string} url
 * @returns {string} 剥离后的 URL；无可剥离段或非法输入时原样返回
 */
const TEMPLATE_STRIP_USABLE_FOR_DOUBAO = false;

function stripTemplateSuffix(url) {
  const u = parse(url);
  if (!u) return url;
  if (platformOf(u.hostname) === 'other') return url;
  const raw = url.trim();
  const hashAt = raw.indexOf('#');
  const hash = hashAt >= 0 ? raw.slice(hashAt) : '';
  const beforeHash = hashAt >= 0 ? raw.slice(0, hashAt) : raw;
  const qAt = beforeHash.indexOf('?');
  const path = qAt >= 0 ? beforeHash.slice(0, qAt) : beforeHash;
  const query = qAt >= 0 ? beforeHash.slice(qAt) : '';
  const idx = path.indexOf('~tplv');
  if (idx < 0) return url;
  return path.slice(0, idx) + query + hash;
}

/* ---------------- 对外 ---------------- */

module.exports = {
  // 主 API
  sanitizeAssetUrl,
  classifyAsset,
  rankVariants,
  // 辅助
  assetId,
  platformOf,
  extractNoWatermarkUrls,
  stripTemplateSuffix, // 对豆包已证伪（N6：403），仅供跨平台对照，不接入主路径
  // 常量 / 证据
  RULE_TABLE,
  WATERMARK_KEYS,
  SANITIZE_VIDEO_URLS,
  TEMPLATE_STRIP_USABLE_FOR_DOUBAO,
};
