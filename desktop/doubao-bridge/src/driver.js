'use strict';
/* doubao-driver —— Electron Chromium/CDP 生命周期 + 豆包网页自动化 + 产物捕获
 * 逻辑移植自 WOOL（inject/doubao.jsc + adapters/core + doubao-intl manifest 真机取证）：
 *   - fillPrompt: ProseMirror execCommand insertText（真机已验证）
 *   - clickGenerate: chat_input_send_button（懒渲染，有输入才出现——真机已验证）
 *   - 捕获主链路: /im/chain/single 响应 → aHR0 Base64URL 正则直提 → 解码 → 视频直链过滤
 *               → TOS 路径去重 → lr=unwatermarked 优先（intl manifest 定案链路）
 *   - DOM 兜底: [class*="block-video"] video（lr=cici_ai 为水印预览，主链路有交付时跳过）
 *   - 30s 补丁: 拦截 /samantha/chat/completion 请求体改写（src/patch30.js）
 */
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const log = require('./log')('driver');
const patch30 = require('./patch30');
const browserHost = require('./browser-host');
const captureGuard = require('./capture-guard');
const tasks = require('./tasks');
const cleanup = require('./conversation-cleanup');
const conversationChain = require('./conversation-chain');
const crypto = require('node:crypto');
const { dataDir: DATA_DIR, templateFile } = require('./runtime-paths');

const config = require('./config');
const D = config.doubao;
const S = D.selectors;
const C = D.capture;
/* 任务模型 id → 豆包页面 completion 请求体的 model 值（2026-11-08 页面取证）：
 * mini = seedance_v2.0_mini（completion 回读实证）；fast = seedance_v2.0_fast（同构
 * 推断，首个 fast 任务跑通时看 [patch30] 日志回读校准）。页面键族还有 seedance_2_0_mini
 * （选择器键，下划线），与请求体键（点分）不同族，勿混用。 */
const MODEL_KEY_MAP = {
  'seedance_2.0_mini': 'seedance_v2.0_mini',
  'seedance_2.0_fast': 'seedance_v2.0_fast',
};

/* 额度耗尽判定统一口径（细节见 src/quota.js）：轮询内命中即快速失败，
 * 错误文案含「额度已用完」以触发 accounts 的换号口径。 */
const { QUOTA_TEXT_RE, isQuotaText } = require('./quota');
/* 水印规则单一来源（见 src/watermark.js 的证据表 R1~R7 / N1~N5）：
 * 之前这里的判定只认 lr=unwatermarked 一个值，而国内豆包链路根本不下发 lr
 * → 交付清白的文件也被标成「带水印」。改由 watermark.classifyAsset 做平台分流判定。 */
const wm = require('./watermark');
/* fplay 无水印档解析（见 src/fplay.js，逆向自 WOOL fplay.jsc） */
const fplay = require('./fplay');
/* chain 载荷元数据（宽高/时长/封面）：纯函数模块，见 src/chain-meta.js */
const { findChainVideoMeta, findChainCover } = require('./chain-meta');

// data/skill-pack.json：patch30.skillPackFake 的伪造 /samantha/chat/skill_pack 响应体
// （实验功能；生产配置 patch30.enabled=false 不消费）。容错读取：缺失只降级该实验功能，
// 不再让桥启动崩溃（2026-11-09 事故：清理误删 data/，模块级同步读 ENOENT 直接炸桥）。
// 当前内容为按豆包 samantha API 惯例的重建占位；启用 patch30 前需真机抓包校准。
let SKILL_PACK_TEXT = '';
try {
  SKILL_PACK_TEXT = fs.readFileSync(templateFile, 'utf8');
} catch (error) {
  log.warn('data/skill-pack.json 缺失，patch30.skillPackFake 降级不可用：', error.message);
}

/* ---------------- 多账号工厂 ----------------
 * 每个豆包账号 = 一个独立 Electron session partition = 一个 createDriver 实例（state/runnerBusy 全闭包隔离）。
 * accounts.js 持有注册表并做额度感知任务路由；本文件不再导出全局单例。
 * hooks.onTaskDone(task)：任务终态回调（成功/失败均触发）——账号管理器据此标记额度、换号重试、泵全局队列。 */
function createDriver(opts) {
  const o = opts || {};
  const accountId = o.accountId || 'default';
  const hooks = o.hooks || {};
  const log = require('./log')('driver:' + accountId); // 遮蔽模块级 log，日志带账号前缀

  const state = {
  browser: null,
  page: null,
  launching: null,
  activeTask: null,      // 当前正在生成的任务（捕获结果归属）
  chainDeliverTs: 0,     // 主链路最近一次交付时间（DOM 兜底抑制窗）
  seenIdentities: new Set(), // TOS 路径身份去重
  deliveredIdentities: new Set(), // 已交付过的视频身份（跨任务累计，永不重置）：同一资产被第二个任务再次"捕获"就是串片
  videoBaseline: new Set(), // 发送前页面上已存在的视频身份（串片防线）
  captureTaskId: null, // 当前捕获归属的任务 id
  lastCapture: null,
  delivering: false,     // chain 交付探测并发闸（异步探测期间不重复处理）
  timings: {},           // 阶段耗时（结构化可观测性）
  watchConvUrl: '',      // 守望会话地址（会话扫描按此过滤，防串会话）
  lastCompletionBody: '',// 最近一次真实 completion 请求体（取证用，落盘 data/last-completion-body.txt）
  oriRaw: new Map(),     // image_ori_raw（无水印原图）：rc_gen_image id -> {url, at}
  fplayTried: new Set(), // 已向 fplay 求过无水印档的 videoId（避免每条 chain 重打）
  oriRawAt: 0,           // 最近一次采集到 image_ori_raw 的时间
};

/* ---------------- 宿主 Chromium 附加 ----------------
 * 桌面主进程托管每账号一个持久化隐藏 BrowserWindow。桥只认 window.name
 * 中本账号的 marker；共享 CDP 上的主窗口和其他账号页都不可导航或关闭。 */
async function launch(opts) {
  // waitMs：等待浏览器就绪的时长。任务路径放宽（可能要冷启动浏览器），
  // 登录态轮询快速失败（避免每轮空等拖垮 /admin/api/accounts）。
  const waitMs = Number(opts && opts.waitMs) > 0 ? Number(opts.waitMs) : 45000;
  // 页面/浏览器被回收后的重连（闲置回收会 kill 浏览器进程）
  if (state.page && state.page.isClosed()) {
    log.info('豆包页面已失效（浏览器被回收），重新拉起');
    state.page = null;
    state.browser = null;
  }
  if (state.browser && state.browser.connected && state.page) return state;
  if (state.launching) return state.launching;
  state.launching = (async () => {
    const hosted = await browserHost.ensure(accountId);
    log.info('connecting client Chromium CDP:', hosted.port);
    const browser = await puppeteer.connect({
      browserURL: `http://127.0.0.1:${hosted.port}`,
      defaultViewport: null,
      protocolTimeout: 180000,
    });
    state.browser = browser;
    browser.on('disconnected', () => {
      log.warn('浏览器连接断开');
      state.browser = null; state.page = null;
    });
    // CDP 属于整个 Electron 应用，绝不把首个可用页面当成豆包页：只按
    // 桌面端注入的账号 marker 精确认领。宿主负责导航和窗口生命周期。
    const deadline = Date.now() + waitMs;
    let page = null;
    while (Date.now() < deadline) {
      const candidates = await browser.pages().catch(() => []);
      for (const candidate of candidates) {
        const marker = await candidate.evaluate(() => window.name).catch(() => '');
        if (marker === hosted.pageMarker && /(?:^|\.)doubao\.com$/.test(new URL(candidate.url()).hostname)) {
          page = candidate;
          break;
        }
      }
      if (page) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    if (!page) {
      const err = new Error(`账号 ${accountId} 的隐藏豆包页面未就绪（未找到匹配的客户端窗口标记）`);
      err.browserUnavailable = true;
      throw err;
    }
    // 客户端宿主在首次导航前已设置真实 Chromium UA；这里补齐语言偏好，
    // 兼容桥接到已存在的页面。
    if (hosted.userAgent) {
      await page.setUserAgent(hosted.userAgent).catch((e) => log.warn('设置 UA 失败:', e.message));
      await page.setExtraHTTPHeaders({ 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' }).catch(() => {});
      log.info('已应用真实 UA:', hosted.userAgent.slice(0, 80));
    }
    await wirePage(page);
    state.page = page;
    log.info('doubao page ready');
    return state;
  })();
  try { return await state.launching; } finally { state.launching = null; }
}

async function getPage(opts) {
  await launch(opts);
  if (!state.page) throw new Error('宿主豆包窗口未就绪（launch 后仍无 doubao.com 页面目标）');
  return state.page;
}

async function touchBrowser() {
  try {
    await browserHost.touch(accountId);
  } catch (e) {
    log.warn('续租客户端 Chromium 窗口失败:', e.message);
  }
}

/* ---------------- 请求拦截 + 响应监听 ---------------- */
async function wirePage(page) {
  // 隐藏窗口 document.hasFocus() 恒 false，execCommand('insertText')
  // （ProseMirror 填词）会直接失败。通过 CDP 焦点仿真，不抢用户真实焦点。
  try {
    const client = await page.createCDPSession();
    await client.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  } catch (e) { log.warn('焦点仿真启用失败（忽略）:', e.message); }
  // 拦截：completion 请求体改写（30s 解锁） + skillpack 伪造响应
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    try {
      const url = req.url();
      if (patch30.isCompletionUrl(url) && req.method() === 'POST') {
        const body = req.postData();
        if (body && body.includes('"client_meta"')) {
          state.lastCompletionBody = body; // 仅真实页面请求（带 client_meta），排除桥自身的诊断请求
          // 落盘取证（跨重启留存）：消息文本/时长/比例字段定位的权威依据
          if (process.env.BRIDGE_CAPTURE_RAW === '1') {
            try { fs.writeFileSync(path.join(DATA_DIR, 'last-completion-body.txt'), body); } catch (e) {}
          }
        }
        log.debug('[net] completion POST');
        // 时长/模型精确控制（doubao2api 同源能力）：任务带 duration → 请求体改写为任务时长；
        // 任务模型与页面当前模型不一致 → 改写 model（此前只改时长：画布选 fast 页面却用
        // 页面选中的 mini 静默错档——2026-11-08 审计补上）。
        const at = state.activeTask;
        // 只在视频任务上改写（2026-11-11 审计）：生图/文本任务同样带 input.ratio、
        // 且 completion 请求体形状与视频一致，会被 looksLikeVideoGenerationBody 命中，
        // 导致生图时日志出现「改写 → duration=30 model=seedance_v2.5」的误触。豆包侧虽忽略
        // 这些字段（出图正常），但请求体被无谓篡改，属越权改写，必须按任务类型收窄。
        const atKind = String((at && at.input && at.input.kind) || 'video').toLowerCase();
        const atVideo = Boolean(at) && at.status === 'processing' && atKind === 'video';
        const taskDuration = atVideo && Number(at.input.duration) > 0 ? Number(at.input.duration) : null;
        const taskModelKey = atVideo && at.input.model ? MODEL_KEY_MAP[String(at.input.model)] || null : null;
        // 比例（2026-11-10 补）：画布选 9:16 时 DOM 路径此前完全不体现——只改已存在的比例键
        const taskRatio = atVideo && /^(16:9|9:16|1:1|4:3|3:4|21:9)$/.test(String(at.input.ratio || '')) ? String(at.input.ratio) : null;
        if (body && patch30.looksLikeVideoGenerationBody(body) && (taskDuration != null || taskModelKey || taskRatio || (atVideo && config.patch30.enabled))) {
          const opts = {};
          if (taskDuration != null) opts.duration = taskDuration;
          if (taskModelKey) opts.model = taskModelKey;
          if (taskRatio) opts.ratio = taskRatio;
          const r = patch30.patchCompletionBody(body, Object.keys(opts).length ? opts : undefined);
          if (r && r.changed) {
            log.info('[patch30] 改写 completion 请求体 → duration=' + r.duration + (r.model ? ' model=' + r.model : '') + (r.ratio ? ' ratio=' + r.ratio : '') + (r.textChanges ? '，文本时长信号 ' + r.textChanges.join(' ') : '') + '（任务驱动）');
            return req.continue({ method: req.method(), headers: req.headers(), postData: r.body })
              .catch((e) => log.warn('patch continue fail', e.message));
          }
        }
      }
      // 取回链路取证：页面在视频生成等待期的轮询 API（task/poll/message/conversation 等）
      if (req.method() === 'GET' && /doubao\.com\/(alice|samantha|im)\//.test(url) && /task|poll|message|conversation|video|async|event|history/i.test(url)) {
        log.info('[api] GET ' + url.slice(0, 170));
      }
      if (config.patch30.enabled && config.patch30.skillPackFake && SKILL_PACK_TEXT && patch30.isSkillPackUrl(url)) {
        log.info('[patch30] 伪造 skillpack 响应');
        return req.respond({ status: 200, contentType: 'application/json', body: SKILL_PACK_TEXT })
          .catch((e) => log.warn('skillpack respond fail', e.message));
      }
      return req.continue().catch(() => {});
    } catch (e) {
      log.warn('intercept err', e.message);
      try { req.continue(); } catch (_) {}
    }
  });

  // 响应监听：chain/single 主链路捕获
  page.on('response', async (res) => {
    const owner = state.activeTask;
    try {
      const url = res.url();
      if (!patch30.isChainSingleUrl(url)) return;
      const text = await res.text().catch(() => null);
      if (!owner || tasks.get(owner.id) !== owner || state.activeTask !== owner) return;
      if (text) {
        state.lastChainUrl = url; // 去水印调研取证：最近一次 chain/single 原文
        state.lastChainText = text;
        state.lastChainAt = Date.now();
        // 原始 chain 载荷落盘：分析国内视频推送的完整字段（无水印变体/no_watermark_url）
        if (process.env.BRIDGE_CAPTURE_RAW === '1') {
          try { fs.writeFileSync(path.join(DATA_DIR, 'last-chain.txt'), text); } catch (e) {}
        }
        if (state.activeTask && state.activeTask.status === 'processing') {
          // 探测是异步的（要发 Range 请求），必须 catch，否则未处理的 rejection 会打断监听器
          deliverChainEntries(state.activeTask, text).catch((e) => log.warn('deliverChainEntries err:', e.message));
        }
      }
    } catch (e) { log.debug('response listener err', e.message); }
  });

  /* 取证监听：completion 的**响应体**（2026-11-10 补）。
   * chain/single 只覆盖视频推送；生图的 creations[] / image_ori_raw 只出现在 completion
   * 的响应流里。此前只落了请求体（last-completion-body.txt），响应体一直是盲区，
   * 导致「图片有没有无水印原图字段」这类问题只能靠猜。这里按需落盘（仅当命中关键字），
   * 失败静默——纯取证，不参与任何交付判定。 */
  page.on('response', async (res) => {
    const owner = state.activeTask;
    try {
      const url = res.url();
      if (!/\/chat\/completion/.test(url)) return;
      const ct = String(res.headers()['content-type'] || '');
      if (!/event-stream|application\/json/.test(ct)) return;
      const text = await res.text().catch(() => null);
      if (!owner || tasks.get(owner.id) !== owner || state.activeTask !== owner) return;
      if (!text || text.length < 200 || text.length > 8 * 1024 * 1024) return;
      if (!/creation|image_ori_raw|rc_gen_image|video_model|creation_block/.test(text)) return;
      state.lastCompletionResponse = text;
      if (process.env.BRIDGE_CAPTURE_RAW === '1') {
        try { fs.writeFileSync(path.join(DATA_DIR, 'last-completion-response.txt'), text); } catch (e) {}
      }
      // 图片无水印原图：载荷 image_ori_raw 给的是 ~tplv-…-image_raw 版本（实测无水印）
      const ori = harvestImageOriRaw(text);
      if (ori.length) {
        const now = Date.now();
        state.oriRaw = state.oriRaw || new Map();
        for (const o of ori) state.oriRaw.set(o.id, { url: o.url, at: now });
        state.oriRawAt = now;
        log.info('[capture] image_ori_raw × ' + ori.length + '（无水印原图，生图任务优先采用）');
      }
    } catch (e) { log.debug('completion listener err', e.message); }
  });
}

/** 从 completion 响应体里抽 image_ori_raw（无水印原始图）。
 *  载荷形如 `"image_ori_raw":{"url":"https://…/rc_gen_image/<id>.jpeg~tplv-…-image_raw.png?…"}`
 *  实测：同一 id 下 cgen_dwm3 带「豆包AI生成」，image_raw 干净（水印区亮度 254.9 vs 232.9）。
 *  解析失败返回空数组——它只是"更好的一档"，拿不到就走原来的 DOM 兜底。 */
function harvestImageOriRaw(text) {
  const out = [];
  if (typeof text !== 'string' || !text) return out;
  const re = /"image_ori_raw"\s*:\s*\{\s*"url"\s*:\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const url = m[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
    if (!/^https?:\/\//.test(url)) continue;
    const id = (url.match(/rc_gen_image\/([^?~.]+)/) || [null, url])[1];
    if (!out.some((x) => x.id === id)) out.push({ id, url });
  }
  return out;
}

/* ---------------- 捕获链（intl manifest 定案链路移植） ---------------- */
function extractBase64Urls(text) {
  // aHR0 = base64("http")；穿透多层转义的 JSON 字符串直提
  const out = [];
  const re = /aHR0[A-Za-z0-9_-]{8,}/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    try {
      let b = m[0].replace(/-/g, '+').replace(/_/g, '/');
      while (b.length % 4) b += '=';
      const decoded = Buffer.from(b, 'base64').toString('utf8');
      if (/^https?:\/\//.test(decoded)) out.push(decoded);
    } catch (e) { /* skip */ }
  }
  return out;
}

function videoIdentity(url) {
  // TOS 路径整段身份去重：v16/v19 CDN 镜像仅签名目录不同、TOS 路径全同
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    const i = parts.findIndex((p) => p === 'video' || p === 'tos');
    const tail = i >= 0 ? parts.slice(i).join('/') : u.pathname;
    return u.hostname.includes('doubao') || u.hostname.includes('byte') ? tail : u.hostname + tail;
  } catch (e) { return url; }
}

/* 国内视频「无 URL 信号」的处置（2026-11-10 真机复核，推翻了 10-24 的旧结论）：
 * 交付的 chain 直链（无 lr/logo_type/watermark）下载后是 720x720 HEVC，
 * **左上角烧着「豆包AI生成」**——文件本体带水印，不是预览叠层。
 * 也就是说：国内免费档根本没有无水印变体（老代码等 lr=unwatermarked 永远等不到，
 * 每次都要耗满 20 分钟超时再交付同一份带水印文件）。
 *
 * 于是把「交付策略」与「水印真相」彻底分开：
 *   watermarkGuess → 还等不等：国内无信号时**不再等**（等不到，空转 20 分钟纯损失）
 *   fileWatermark  → 文件到底干不干净：国内无信号时按**实测带水印**（保守且正确）
 */
function isDomesticVideo(url, c) {
  return c.platform === 'doubao-cn' && /\/video\/tos\//.test(String(url || ''));
}

/** 交付策略判定：true = 还该等更好的变体（走 early-deliver / 超时兜底），false = 立即交付
 *  有 URL 信号时按信号；无信号时一律不等——反正等到的还是同一份带水印文件。 */
function watermarkGuess(url) {
  const c = wm.classifyAsset(url);
  if (c.known) return c.watermarked;
  return false;
}

/** 交付结果里的 watermark 字段（对调用方承诺的「文件真相」） */
function fileWatermark(url) {
  const c = wm.classifyAsset(url);
  if (c.known) return c.watermarked;
  return true; // 无信号 → 保守 true；国内免费档已实测带「豆包AI生成」
}

/** 取证说明，写进任务结果便于日后回溯「为什么这么判」 */
function watermarkReason(url) {
  const c = wm.classifyAsset(url);
  if (!c.known && isDomesticVideo(url, c)) {
    return '国内 chain 直链无水印参数，但 2026-11-10 实测交付文件左上角带「豆包AI生成」（免费档无无水印变体）';
  }
  return c.reason;
}

function isVideoUrl(url) {
  return /\/video\/tos\//.test(url) || /\.mp4(\?|$)/.test(url);
}

/** 交付前视频探测（2026-11-10 引入）
 *  立即交付策略下，必须区分「成品直链」与「还在生成/占位」：只看头部 1KB，
 *  不下载整片。判据：HTTP 200/206 + video/* content-type + 头部含 ftyp box + 总长 ≥100KB。
 *  探测失败不抛异常（返回 ok:false），调用方继续等下一轮。 */
async function probeVideoAsset(url) {
  try {
    const res = await fetch(url, {
      headers: { Referer: 'https://www.doubao.com/', Range: 'bytes=0-1023' },
    });
    const type = String(res.headers.get('content-type') || '');
    const contentRange = String(res.headers.get('content-range') || '');
    const total = Number((/\/(\d+)\s*$/.exec(contentRange) || [])[1] || res.headers.get('content-length') || 0);
    const buf = Buffer.from(await res.arrayBuffer());
    if (!res.ok && res.status !== 206) return { ok: false, reason: 'HTTP ' + res.status, bytes: total, type };
    if (!/^video\/|^application\/octet-stream/i.test(type)) return { ok: false, reason: 'content-type=' + (type || 'none'), bytes: total, type };
    // mp4 结构：4 字节长度 + 'ftyp'（常见 ftyp/moov/mdat/styp）
    const head = buf.slice(0, 128).toString('latin1');
    if (!/ftyp|moov|mdat/.test(head)) return { ok: false, reason: 'mp4 头缺失（可能仍是占位/未产出）', bytes: total, type };
    if (total && total < 100 * 1024) return { ok: false, reason: '体积异常 ' + total + 'B', bytes: total, type };
    return { ok: true, bytes: total, type };
  } catch (e) {
    return { ok: false, reason: e.message, bytes: 0, type: '' };
  }
}

async function deliverChainEntries(task, chainText) {
  const urls = extractBase64Urls(chainText).filter(isVideoUrl);
  if (!urls.length) return;
  // 并发去重：chain 会连续推多条，探测是异步的，别让同一批候选被打两遍
  if (state.delivering) return;
  state.delivering = true;
  try {
    // 先试 fplay 无水印档（见 src/fplay.js）：chain 默认 gear 一律带水印，
    // 只有向 fplay 要 codec_type=8 才拿得到 lr=unwatermarked 的原始档。
    const clean = await tryFplayClean(task).catch(() => null);
    if (clean) return;
    await deliverChainEntriesInner(task, urls, chainText);
  } finally {
    state.delivering = false;
  }
}

/** 向 fplay 要无水印原始档；拿到并通过探测就直接交付。
 *  @returns {Promise<boolean>} 是否已交付 */
async function tryFplayClean(task) {
  const chainText = state.lastChainText;
  if (!chainText || typeof fplay === 'undefined') return false;
  const src = fplay.findFplaySource(chainText);
  if (!src || !src.videoId) return false;
  // 同一视频只解析一次，避免每条 chain 推送都打一次 fplay
  if (state.fplayTried && state.fplayTried.has(src.videoId)) return false;
  state.fplayTried = state.fplayTried || new Set();
  state.fplayTried.add(src.videoId);

  const clean = await fplay.resolveNoWatermark(src.fallbackApi, src.keySeed);
  if (!clean || !clean.url) {
    log.info('[fplay] 未取到无水印档，回落 chain 直链');
    return false;
  }
  const probe = await probeVideoAsset(clean.url);
  if (!probe.ok) {
    tasks.note(task, 'fplay 无水印档探测未通过（' + probe.reason + '），回落 chain 直链');
    log.warn('[fplay] 无水印档探测未通过:', probe.reason);
    return false;
  }
  state.timings = state.timings || {};
  state.timings.capturedAt = Date.now();
  state.chainDeliverTs = Date.now();
  const reason = 'fplay codec_type=8 无水印原始档（lr=unwatermarked，' + Math.round((clean.size || probe.bytes) / 1024) + 'KB）';
  state.lastCapture = { url: clean.url, watermark: false, via: 'fplay:unwatermarked', watermarkReason: reason, bytes: clean.size || probe.bytes, taskId: task.id };
  tasks.note(task, '取得无水印原始档（' + (clean.definition || '?') + ' ' + (clean.width || '?') + 'x' + (clean.height || '?') + '，' + Math.round((clean.size || 0) / 1048576) + 'MB）');
  log.info('[fplay] ★ 无水印档交付:', clean.url.slice(0, 100), Math.round((clean.size || 0) / 1048576) + 'MB');
  finishTask(task, {
    video_url: clean.url, videos: [clean.url], watermark: false, via: 'fplay:unwatermarked',
    watermarkReason: reason,
    bytes: clean.size || probe.bytes,
    width: clean.width || undefined, height: clean.height || undefined,
    duration_s: clean.duration || undefined,
  });
  return true;
}

/** 从页面里的 <video> 元素读真实元数据（时长/分辨率/封面色）。
 *  chain 直链本身不带这些字段（payload 里有 width/height/duration，但被 base64 包在
 *  aHR0 串里，解出来再回填成本高且易随结构变）。页面元素是现成的权威来源，
 *  拿不到就返回 null，绝不阻塞交付。 */
async function readDomVideoMeta() {
  const page = state.page;
  if (!page) return null;
  return page.evaluate(() => {
    const v = [...document.querySelectorAll('video')].find((x) => {
      const s = x.currentSrc || x.src || '';
      return s && !/^blob:/.test(s);
    });
    if (!v) return null;
    return {
      width: v.videoWidth || null,
      height: v.videoHeight || null,
      duration_s: Number.isFinite(v.duration) ? Math.round(v.duration * 100) / 100 : null,
      poster: v.poster || null,
    };
  }).catch(() => null);
}

async function deliverChainEntriesInner(task, urls, chainText) {
  // 干净的变体优先（国内链路通常无信号 → watermarkGuess 判为可立即交付）
  const ranked = urls
    .map((u) => ({ u, needsWait: watermarkGuess(u) }))
    .sort((a, b) => Number(a.needsWait) - Number(b.needsWait));
  for (const { u, needsWait } of ranked) {
    const id = videoIdentity(u);
    if (state.videoBaseline && state.videoBaseline.has(id)) {
      log.info('[capture] 跳过基线视频（串片防线，chain）:', String(u).slice(-60));
      continue;
    }
    if (state.seenIdentities.has(id)) continue;
    state.seenIdentities.add(id);
    const url2 = u.replace(/^http:\/\//, 'https://'); // toHttps 归一
    // 成品校验：没通过就不算捕获（避免把半成品/占位直链交出去）
    const probe = await probeVideoAsset(url2);
    if (!probe.ok) {
      tasks.note(task, 'chain 直链暂不可交付（' + probe.reason + '），继续等待下一轮推送');
      log.warn('[capture] chain 探测未通过:', probe.reason, url2.slice(0, 90));
      continue;
    }
    state.chainDeliverTs = Date.now();
    (state.timings = state.timings || {}).capturedAt = Date.now();
    const wmFlag = fileWatermark(url2);
    const reason = watermarkReason(url2);
    state.lastCapture = { url: url2, watermark: wmFlag, via: 'chain', watermarkReason: reason, bytes: probe.bytes, taskId: task.id };
    tasks.note(task, 'chain 捕获视频直链（探测通过 ' + Math.round(probe.bytes / 1024) + 'KB）' + (wmFlag ? '（带水印）' : '（无水印）'));
    log.info('[capture] chain →', url2.slice(0, 110), Math.round(probe.bytes / 1024) + 'KB', wmFlag ? '(wm)' : '(no-wm)');
    if (!needsWait) {
      // 元数据：先读 chain 载荷（video_model 里有真实 vwidth/vheight/video_duration），
      // 再用页面 <video> 补封面；两者都没有就留空，绝不阻塞交付
      const chainMeta = findChainVideoMeta(chainText);
      const domMeta = await readDomVideoMeta().catch(() => null);
      const metaW = (chainMeta && chainMeta.width) || (domMeta && domMeta.width) || null;
      const metaH = (chainMeta && chainMeta.height) || (domMeta && domMeta.height) || null;
      const metaD = (chainMeta && chainMeta.duration_s) || (domMeta && domMeta.duration_s) || null;
      finishTask(task, {
        video_url: url2, videos: [url2], watermark: wmFlag, via: 'chain',
        watermarkReason: reason, bytes: probe.bytes,
        width: metaW || undefined,
        height: metaH || undefined,
        duration_s: metaD || undefined,
        cover_url: (domMeta && domMeta.poster) || findChainCover(chainText) || undefined,
      });
      return;
    }
  }
}

/** 串片防线：把页面上当前已存在的视频身份记成基线快照。
 *  为什么需要：豆包同一会话里，上一支生成完成的片子会一直渲染在消息流里；
 *  DOM 扫描只要看到 <video> 就当作「本次出片」，于是 5~7 秒就"完成"，甚至把
 *  上一个提示词的成品交付给当前任务（2026-11-11 实测：雪山日出的片子被交付给
 *  「一杯咖啡」任务）。基线快照让"新增视频"成为可判定的事实，而不是猜测。 */
async function snapshotVideoBaseline() {
  const page = state.page;
  const set = new Set();
  if (!page) {
    state.videoBaseline = set;
    return set;
  }
  try {
    const srcs = await page.evaluate((sel) => {
      const out = [];
      for (const v of document.querySelectorAll('video')) {
        const s = v.currentSrc || v.src || '';
        if (s) out.push(s);
        const source = v.querySelector('source');
        if (source && source.src) out.push(source.src);
      }
      for (const v of document.querySelectorAll(sel)) {
        if (v && v.src) out.push(v.src);
      }
      return out;
    }, S.productVideo);
    for (const s of srcs) {
      if (s && !s.startsWith('blob:')) set.add(videoIdentity(s));
    }
  } catch (e) {
    log.debug('baseline snapshot err', e.message);
  }
  state.videoBaseline = set;
  log.info('串片防线：发送前基线视频数 =', set.size);
  return set;
}

/** 交付前统一校验（串片防线第二道）：新视频 + 不是已交付过的资产 + 不早于最小生成时间。
 *  返回 null 表示可以交付；返回字符串表示拒绝原因（调用方记录下来继续等待）。 */
function captureRejection(task, url) {
  return captureGuard.rejectionReason({
    url,
    baseline: state.videoBaseline,
    delivered: state.deliveredIdentities,
    sentAt: (state.timings && state.timings.sentAt) || 0,
    minMs: Number(C.videoMinCaptureMs) || 0,
  });
}

/** 交付成功时登记身份，防止同一资产被后续任务重复认领。 */
function markDelivered(url) {
  if (!url) return;
  state.deliveredIdentities = state.deliveredIdentities || new Set();
  state.deliveredIdentities.add(videoIdentity(url));
}

/** 只认本任务自己的捕获。state.lastCapture 属账号级、跨任务复用：
 *  上一任务残留的捕获若被新任务当成本次结果，就是串片。 */
function currentCapture(task) {
  const c = state.lastCapture;
  if (!c || !c.url) return null;
  if (c.taskId && task && c.taskId !== task.id) return null;
  return c;
}

async function domFallbackScan(task) {
  const page = state.page;
  if (!page) return false;
  try {
    const found = await page.evaluate((sel) => {
      const vids = [...document.querySelectorAll(sel)];
      return vids.map((v) => v.src || (v.querySelector('source') && v.querySelector('source').src)).filter(Boolean);
    }, S.productVideo);
    for (const src of found) {
      if (!src || src.startsWith('blob:')) continue;
      // 串片防线：基线里已有的视频属于之前的任务，绝不当作本次结果
      if (state.videoBaseline && state.videoBaseline.has(videoIdentity(src))) {
        log.info('[capture] 跳过基线视频（串片防线）:', String(src).slice(-60));
        continue;
      }
      if (/lr=cici_ai/.test(src)) {
        // 水印预览确定性标记：主链路同窗有交付则跳过
        if (Date.now() - state.chainDeliverTs < C.chainSuppressMs) {
          tasks.note(task, '跳过 DOM 水印预览（chain 已交付）');
          continue;
        }
      }
      const id = videoIdentity(src);
      if (state.seenIdentities.has(id)) continue;
      state.seenIdentities.add(id);
      const needsWait = watermarkGuess(src);
      const fw = fileWatermark(src);
      state.lastCapture = { url: src, watermark: fw, via: 'dom', watermarkReason: watermarkReason(src), taskId: task.id };
      tasks.note(task, 'DOM 兜底捕获' + (needsWait ? '（水印预览）' : ''));
      log.info('[capture] dom →', src.slice(0, 120));
      const domMeta = await readDomVideoMeta().catch(() => null);
      // DOM 兜底也能借最近一次 chain 载荷补元数据（视频元素此时往往已渲染，两者互补）
      const chainFallback = findChainVideoMeta(state.lastChainText);
      finishTask(task, {
        video_url: src, videos: [src], watermark: fw, via: 'dom', watermarkReason: watermarkReason(src),
        width: (domMeta && domMeta.width) || (chainFallback && chainFallback.width) || undefined,
        height: (domMeta && domMeta.height) || (chainFallback && chainFallback.height) || undefined,
        duration_s: (domMeta && domMeta.duration_s) || (chainFallback && chainFallback.duration_s) || undefined,
        cover_url: (domMeta && domMeta.poster) || findChainCover(state.lastChainText) || undefined,
      });
      return true;
    }
  } catch (e) { log.debug('dom scan err', e.message); }
  return false;
}

function finishTask(task, result) {
  if (tasks.get(task.id) !== task || task.status !== 'processing') return;
  // 串片防线第三道（唯一交付闸口）：所有视频交付都必须过这里。
  // 拒绝的三种情况各有实证来源：
  //   baseline         —— 页面上一任务残留的片子（DOM 扫描撞上，5~7 秒"出片"）
  //   already-delivered —— 同一资产已被之前的任务交付过（雪山日出的片子被交付给咖啡任务）
  //   too-fast          —— 距发送不足最小生成时间，物理上不可能已经出片
  // 拒绝后保持 processing，继续等真正的新视频；不静默交付错误内容。
  if (result && result.video_url) {
    const reject = captureRejection(task, result.video_url);
    if (reject) {
      tasks.note(task, '丢弃疑似串片结果：' + captureGuard.rejectionMessage(reject) + '，继续等待本次生成');
      log.warn('[capture] 拒绝交付', reject, String(result.video_url).slice(-70));
      return;
    }
  }
  // 结构化耗时（可观测性）：哪一段慢，事后直接从任务记录读，不用翻日志
  try {
    const t = state.timings || {};
    task.meta = task.meta || {};
    task.meta.timings = {
      startAt: t.start || null,
      sentAt: t.sentAt || null,
      capturedAt: t.capturedAt || null,
      finishedAt: Date.now(),
      toSentMs: t.sentAt && t.start ? t.sentAt - t.start : null,
      toCaptureMs: t.capturedAt && t.start ? t.capturedAt - t.start : null,
      totalMs: t.start ? Date.now() - t.start : null,
    };
  } catch (e) { /* 计时失败不影响交付 */ }
  tasks.transition(task, 'completed', { result: Object.assign({}, task.result || {}, result),
    phase: 'completed', reason: null, error: null });
  if (result && result.video_url) markDelivered(result.video_url);
  if (state.activeTask === task) state.activeTask = null;
  // 参考图清理（2026-11-08 审计）：任务完成即删本地落地素材（豆包侧发送后也已删除），
  // 否则 data/refs/ 按任务无限累积；失败任务保留原图便于排查。
  if (task.status === 'completed') {
    try {
      const dir = path.join(DATA_DIR, 'refs');
      for (const f of fs.readdirSync(dir)) {
        if (f.startsWith(task.id)) fs.unlinkSync(path.join(dir, f));
      }
    } catch (e) {}
  }
}

/* ---------------- 页面操作（真机取证已验证的选择器） ---------------- */
async function ensureChatPage(opts) {
  const page = await getPage(opts);
  const url = page.url();
  if (!url.startsWith('https://www.doubao.com')) {
    log.info('navigating to', D.entryUrl);
    await page.goto(D.entryUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  }
  try {
    await page.waitForSelector(S.composerHost, { timeout: 30000 });
  } catch (e) {
    if (await looksLikeBotWall(page)) throw createBotWallError('页面加载');
    throw new Error('composer 未出现（页面加载失败或结构变更）');
  }
  return page;
}

/**
 * 发送后的风控探测（2026-11-12 实测事故）。
 *
 * 事故现象：自动化页面可能被豆包风控判定为机器人 →
 * 发送后弹出「常见的家养宠物 / 请选择所有符合上文描述的图片，并拖拽到下方」的
 * 人机验证，消息行出现红叹号（发送失败），驱动却继续空等 157 秒才超时报
 * 「生图超时：未捕获到生成图片」——用户只看到一句无用的失败提示。
 *
 * 这里把「被挡住」变成一次立即、可读的失败；豆包页始终在隐藏窗口中运行。
 */
function createBotWallError(where) {
  const err = new Error('豆包触发人机验证（' + where + '）。客户端浏览器保持隐藏，请在豆包账号恢复可用后重试。');
  err.botWall = true;
  err.reason = 'bot_wall';
  return err;
}

async function botWallReason(page) {
  const target = page || state.page;
  if (!target) return null;
  return target.evaluate(() => {
    const text = document.body ? (document.body.innerText || '') : '';
    if (/请选择所有符合|拖拽到下方|拖动滑块|完成安全验证|人机验证|访问异常/.test(text)) return '人机验证弹窗';
    // 验证文字可能只存在于跨域 iframe，主页面无法读取其内容。
    // 仅检查可见的验证 iframe，避免预加载的隐藏控件造成误报。
    const captchaFrame = [...document.querySelectorAll('iframe[src*="captcha"], iframe[src*="verifycenter"]')]
      .find((frame) => {
        const rect = frame.getBoundingClientRect();
        const style = window.getComputedStyle(frame);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      });
    if (captchaFrame) return '验证码控件';
    if (/安全验证|captcha/i.test(text) && document.querySelector('[class*="captcha"], [id*="captcha"]')) return '验证码控件';
    // 消息发送失败标记：消息行内的重发按钮 / 失败状态
    const retry = [...document.querySelectorAll('button, [role="button"]')]
      .find((b) => /重新发送|重试发送|发送失败/.test((b.innerText || '') + (b.getAttribute('aria-label') || '')));
    if (retry) return '消息发送失败';
    return null;
  }).catch(() => null);
}

/** 命中风控就抛一个可识别错误（err.botWall=true），上层据此降级重试。 */
async function assertNotBlocked(page, where) {
  const reason = await botWallReason(page);
  if (!reason) return;
  const err = createBotWallError(reason);
  log.warn('[风控] ' + where + ' 检测到 ' + reason + '，保持隐藏并停止本次任务');
  throw err;
}

/** 是否被风控/登录墙挡住：验证码控件、人机验证文案，或「要登录但没有输入框」。 */
async function looksLikeBotWall(page) {
  return page.evaluate(() => {
    const text = document.body ? (document.body.innerText || '') : '';
    const hasCaptcha = Boolean(document.querySelector('[class*="captcha"], [id*="captcha"], iframe[src*="captcha"]'));
    const hasVerify = /安全验证|人机验证|拖动滑块|请完成验证|访问异常/.test(text);
    const composer = document.querySelector('[data-testid="chat_input_input"], textarea, [contenteditable="true"]');
    const hasLoginWall = !composer && /扫码登录|请先登录|登录后即可/.test(text);
    return hasCaptcha || hasVerify || hasLoginWall;
  }).catch(() => false);
}

async function getLoginState(opts) {
  const page = await ensureChatPage(opts);
  const cookies = await page.cookies();
  const hasSession = cookies.some((c) => c.name === 'sessionid' || c.name === 'sessionid_ss');
  const hasLoginMarker = await page.$(S.loginButtonMarker).then((el) => !!el).catch(() => false);
  return { loggedIn: hasSession && !hasLoginMarker, hasSessionCookie: hasSession, hasLoginButton: hasLoginMarker };
}

/* ---------------- 扫码中继登录 ----------------
 * 原理：豆包登录弹窗的二维码由页面渲染，桥截图后经 HTTP 透出给用户，
 * 用户手机豆包 App 扫码 → 会话保存在客户端管理的 Chromium session partition。
 * 二维码约 1-2 分钟过期，页面会自动轮换；每次请求重新截图即总是新鲜的。 */

async function findQrRect(page) {
  return page.evaluate(() => {
    // 豆包登录二维码实证（2026-10 真机取证）：SVG 渲染，
    // 容器 [data-testid="qrcode_image"]（class qrcode-XXX），内含 162x162 <svg>
    const qrHost = document.querySelector('[data-testid="qrcode_image"]');
    if (qrHost) {
      qrHost.scrollIntoView({ block: 'center' });
      const r = qrHost.getBoundingClientRect();
      if (r.width > 40 && r.height > 40) return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: r.height };
    }
    // 兜底：近方形的大 SVG / base64 img / canvas（防结构变化）
    const visible = (el) => el.offsetParent !== null || el.getClientRects().length > 0;
    const cands = [...document.querySelectorAll('svg, img, canvas')].filter((el) => {
      if (!visible(el)) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 100 || r.height < 100) return false;
      const ratio = r.width / r.height;
      if (ratio < 0.5 || ratio > 2) return false;
      if (el.tagName === 'IMG') return /^data:image/.test(el.src || '');
      return true;
    });
    const score = (el) =>
      (el.closest('[role="dialog"], [class*="modal"], [class*="dialog"], [class*="login"]') ? 2 : 0) +
      (/qr/i.test(String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '')) ? 2 : 0);
    cands.sort((a, b) => score(b) - score(a));
    if (!cands.length) return null;
    cands[0].scrollIntoView({ block: 'center' });
    const r = cands[0].getBoundingClientRect();
    return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: r.height };
  });
}

async function captureLoginQr() {
  const page = await ensureChatPage();
  // 用户正通过客户端二维码登录时续租隐藏窗口，避免闲置回收打断扫码。
  await touchBrowser();
  const login = await getLoginState();
  if (login.loggedIn) return { loggedIn: true };
  // 登录弹窗已开则直接截图；否则点登录按钮后轮候二维码出现
  let rect = await findQrRect(page);
  if (!rect) {
    const btn = await page.$(S.loginButtonMarker);
    if (btn) await btn.click().catch(() => {});
    for (let i = 0; i < 12 && !rect; i++) {
      await new Promise((r) => setTimeout(r, 500));
      rect = await findQrRect(page);
    }
  }
  if (!rect) throw new Error('未找到登录二维码（页面结构可能变化）。客户端浏览器页面始终保持隐藏，请稍后重试或更新客户端。');
  // captureBeyondViewport：登录弹窗可能贴近/超出视口右缘，视口内截图必然缺角
  // 豆包会在过期的码上盖「二维码失效 点击刷新」层（外层 img-* 容器），点击即换新码
  const expired = await page.evaluate(() => {
    const q = document.querySelector('[data-testid="qrcode_image"]');
    if (!q) return false;
    const host = q.closest('[class*="img-"]') || q.parentElement;
    return /二维码失效|点击刷新/.test((host && host.innerText) || '');
  });
  if (expired) {
    // 必须用 CDP 真实鼠标事件：豆包的 React 指针处理器不响应合成 .click()
    const center = await page.evaluate(() => {
      const q = document.querySelector('[data-testid="qrcode_image"]');
      const host = q && (q.closest('[class*="img-"]') || q.parentElement);
      if (!host) return null;
      const r = host.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (center) await page.mouse.click(center.x, center.y, { delay: 40 }).catch(() => {});
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const fresh = await page.evaluate(() => {
        const q = document.querySelector('[data-testid="qrcode_image"]');
        if (!q) return false;
        const host = q.closest('[class*="img-"]') || q.parentElement;
        return !/二维码失效|点击刷新/.test((host && host.innerText) || '');
      });
      if (fresh) break;
    }
    rect = (await findQrRect(page)) || rect;
  }
  const clip = {
    x: Math.max(0, rect.x - 12),
    y: Math.max(0, rect.y - 12),
    width: rect.width + 24,
    height: rect.height + 24,
  };
  const png = await page.screenshot({ clip, captureBeyondViewport: true });
  log.info('登录二维码已截图（扫码中继）');
  return { loggedIn: false, png };
}

/* 侧栏进入会话（旧兜底，已无调用方；保留会误导维护者，2026-11-10 随 protocol 路径一并删除）。
 * 真机取证（run27/28）：会话项 = [data-testid="conversation-list-v2-item"]（非锚链接）；
 * 条目文本是自动生成标题（"问候"），不能当匹配依据。 */

async function newConversation() {
  const page = state.page;
  if (!page) return;
  state.cleanupProof = null;
  // 新对话：键盘快捷键 Ctrl+Shift+K（页面 UI 文案标注），失败不阻断
  try {
    await page.keyboard.down('Control'); await page.keyboard.down('Shift');
    await page.keyboard.press('KeyK');
    await page.keyboard.up('Shift'); await page.keyboard.up('Control');
    await new Promise((r) => setTimeout(r, 800));
    const proof = await page.evaluate(() => ({
      path: location.pathname,
      messages: document.querySelectorAll('[data-message-id], [data-testid="send_message"], [data-testid="receive_message"]').length,
      ids: [...document.querySelectorAll('[data-testid="conversation-list-v2-item"][data-conversation-id]')].map((n) => n.getAttribute('data-conversation-id')),
    }));
    if (cleanup.isNewConversationPath(proof.path) && proof.messages === 0 && state.activeTask) {
      state.cleanupProof = { task: state.activeTask, path: proof.path, oldIds: proof.ids };
    }
    log.info('新对话（Ctrl+Shift+K）');
  } catch (e) { log.warn('新对话失败（忽略）', e.message); }
}

async function switchToVideoMode() {
  const page = state.page;
  if (!(await hasVideoMode())) await exitActiveSkill();
  // 冷启动时序抖动：skill bar 可能晚于 composer 渲染，重试 3 轮
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await hasVideoMode()) {
      log.info('视频模式已就绪');
      return true;
    }
    // 等 skill bar 渲染（最多 5s）
    await page.waitForSelector('[data-testid^="skill_bar_button"]', { timeout: 5000 }).catch(() => {});
    if (await hasVideoMode()) {
      log.info('视频模式已就绪');
      return true;
    }
    // 策略1（2026-11 现行 UI）：「视频生成」已收进「技能」菜单——聚焦 composer → 点「技能」→ 点弹层「视频生成」
    await switchViaSkillMenu(page);
    if (await hasVideoMode()) {
      log.info('视频模式已切换（技能菜单）');
      return true;
    }
    // 策略2（旧 UI 兜底）: skill bar 上直接的「视频生成」按钮
    const videoSkill = await page.evaluateHandle(() => {
      const btns = [...document.querySelectorAll('[data-testid^="skill_bar_button"]')];
      return btns.find((b) => /视频/.test(b.innerText || '')) || null;
    }).then((h) => (h && h.asElement() ? h.asElement() : null)).catch(() => null);
    if (videoSkill) {
      await videoSkill.click({ delay: 40 + Math.random() * 60 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 1200));
      if (await hasVideoMode()) { log.info('视频模式已切换（skill bar）'); return true; }
    }
    // 策略2: 模式按钮（chat_input_action_mode）→ 菜单中找「视频」
    try {
      const modeBtn = await page.$('[data-testid="chat_input_action_mode"]');
      if (modeBtn) {
        await modeBtn.click({ delay: 40 + Math.random() * 60 });
        await new Promise((r) => setTimeout(r, 700));
        const menuItem = await page.evaluateHandle(() => {
          const items = [...document.querySelectorAll('[role="menuitem"], [role="option"], li, [class*="modal"] [class*="item"]')];
          return items.find((el) => /视频/.test((el.innerText || '').trim()) && (el.innerText || '').length < 20) || null;
        }).then((h) => (h && h.asElement() ? h.asElement() : null)).catch(() => null);
        if (menuItem) {
          await menuItem.click({ delay: 40 + Math.random() * 60 }).catch(() => {});
          await new Promise((r) => setTimeout(r, 1200));
          if (await hasVideoMode()) { log.info('视频模式已切换（mode 菜单）'); return true; }
        }
      }
    } catch (e) { log.debug('mode menu err', e.message); }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return hasVideoMode();
}

/* 现行 UI 的视频模式入口：「技能」菜单 → 「视频生成」（真机 2026-11 取证）。
 * 豆包的 React 指针处理器不响应合成 .click()，全部用 CDP 真实鼠标事件。 */
async function switchViaSkillMenu(page) {
  try {
    await page.click(S.promptEditor, { delay: 30 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 600));
    const skillBtn = await page.evaluate(() => {
      const b = [...document.querySelectorAll('[data-testid^="skill_bar_button"]')].find((x) => /技能/.test(x.innerText || ''));
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (!skillBtn) return false;
    await page.mouse.click(skillBtn.x, skillBtn.y, { delay: 40 });
    await new Promise((r) => setTimeout(r, 1200));
    const entry = await page.evaluate(() => {
      const e = [...document.querySelectorAll('span')]
        .find((x) => (x.innerText || '').trim() === '视频生成' && (x.offsetParent !== null || x.getClientRects().length > 0));
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (!entry) return false;
    await page.mouse.click(entry.x, entry.y, { delay: 40 });
    await new Promise((r) => setTimeout(r, 1200));
    return true;
  } catch (e) {
    log.debug('技能菜单切换失败:', e.message);
    return false;
  }
}

/* ---------------- 生图 / 文本模式（2026-11-09 真机取证，WOOL 同途径移植） ----------------
 * 技能弹层项为 span、innerText 精确匹配（与视频生成同构）；底栏「对话」切回纯文本。
 * 弹层项（截图取证）：常用(视频生成) / 快捷功能(视频生成·PPT 生成·图像生成·帮我写作·录音转写) / 办公。 */

/** 技能菜单通用入口：聚焦 composer → 点「技能」→ 点弹层 entryText 项（真实鼠标事件） */
/* ---------------- 失败取证（P0-3）----------------
 * 页面改版导致的失败最难查：日志只有一句「找不到入口」，没有任何可复现证据。
 * 统一在失败点落一张截图 + 菜单元文本清单，改版后打开就能看出是新文案还是新结构。 */

/** 当前可见的短文本清单（技能菜单弹层用），用于「入口改了什么名字」的可读诊断。 */
async function visibleShortTexts(limit = 40) {
  const page = state.page;
  if (!page) return [];
  return page.evaluate((max) => {
    const out = [];
    for (const el of document.querySelectorAll('span, div, button, [role="menuitem"], li')) {
      const t = (el.innerText || '').trim();
      if (!t || t.length > 12) continue;
      if (el.children.length && (el.innerText || '').trim().length > 12) continue;
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      if (rect.top < 0 || rect.left < 0) continue;
      if (!out.includes(t)) out.push(t);
      if (out.length >= max) break;
    }
    return out;
  }, limit).catch(() => []);
}

/** 失败现场截图落盘（data/shots/），路径写进任务进度，用户可复查。 */
async function captureFailureShot(task, tag) {
  const page = state.page;
  if (!page || !task) return null;
  try {
    const dir = path.join(DATA_DIR, 'shots');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, String(task.id) + '-' + tag + '.png');
    await page.screenshot({ path: file, fullPage: false });
    tasks.note(task, '失败现场截图已保存：' + path.basename(file));
    log.warn('失败截图:', file);
    return file;
  } catch (e) {
    log.debug('失败截图失败:', e.message);
    return null;
  }
}

async function switchViaSkillEntry(page, entryText) {
  try {
    await page.click(S.promptEditor, { delay: 30 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 600));
    const skillBtn = await page.evaluate(() => {
      const b = [...document.querySelectorAll('[data-testid^="skill_bar_button"]')].find((x) => /技能/.test(x.innerText || ''));
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (!skillBtn) return false;
    await page.mouse.click(skillBtn.x, skillBtn.y, { delay: 40 });
    await new Promise((r) => setTimeout(r, 1200));
    // 入口匹配放宽（P0-3）：豆包改版会改文案（「图像生成」→「图片生成」/「AI 画图」），
    // 也会把 span 换成 div/button。原来只认「单个 span 且文本全等」，一次改版就整链失效
    // （今天实测 2 次「未能切换到生图模式」）。这里改为：多候选文案 + 包含匹配 + 任意元素。
    const candidates = Array.isArray(entryText) ? entryText : [entryText];
    const entry = await page.evaluate((labels) => {
      const visible = (el) => el && (el.offsetParent !== null || el.getClientRects().length > 0);
      const nodes = [...document.querySelectorAll('span, div, button, [role="menuitem"], li')].filter(visible);
      for (const label of labels) {
        const hit = nodes.find((el) => {
          const t = (el.innerText || '').trim();
          if (!t || t.length > 16) return false;
          return t === label || t.includes(label);
        });
        if (hit) {
          const r = hit.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          return { x: r.x + r.width / 2, y: r.y + r.height / 2, label, text: (hit.innerText || '').trim() };
        }
      }
      return null;
    }, candidates);
    if (!entry) return false;
    log.info('技能入口命中：「' + entry.text + '」（候选 ' + candidates.join('/') + '）');
    await page.mouse.click(entry.x, entry.y, { delay: 40 });
    await new Promise((r) => setTimeout(r, 1200));
    return true;
  } catch (e) {
    log.debug('技能菜单切换失败(' + entryText + '):', e.message);
    return false;
  }
}

/** 生图模式：技能菜单 → 「图像生成」（快捷功能组第 3 项，2026-11-09 截图取证）
 *  2026-11-11：文案可能改版，给一组候选；全失败时把菜单可见文本 + 截图都留下来。 */
const IMAGE_MODE_LABELS = ['图像生成', '图片生成', 'AI 画图', 'AI生成图片', '生成图片', '绘图', '生图'];
async function activeSkillLabel() {
  return state.page.evaluate(() => {
    const button = document.querySelector('[data-testid="skill_input_exit_button"]');
    if (!button || !button.getBoundingClientRect().width) return '';
    return (button.innerText || '').trim();
  }).catch(() => '');
}

async function exitActiveSkill() {
  const page = state.page;
  const close = await page.evaluate(() => {
    const button = document.querySelector('[data-testid="skill_input_exit_button"]');
    const icon = button && button.querySelector('svg');
    if (!icon) return null;
    const r = icon.getBoundingClientRect();
    return r.width && r.height ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  }).catch(() => null);
  if (!close) return;
  await page.mouse.click(close.x, close.y, { delay: 40 });
  await new Promise((r) => setTimeout(r, 800));
}

async function switchToImageMode(task) {
  const page = state.page;
  if (!page) return false;
  if (IMAGE_MODE_LABELS.includes(await activeSkillLabel())) return true;
  await exitActiveSkill();
  for (let attempt = 0; attempt < 3; attempt++) {
    if (IMAGE_MODE_LABELS.includes(await activeSkillLabel())) return true;
    if (await switchViaSkillEntry(page, IMAGE_MODE_LABELS)) {
      await new Promise((r) => setTimeout(r, 800));
      if (IMAGE_MODE_LABELS.includes(await activeSkillLabel())) {
        log.info('生图模式已切换（技能菜单）');
        return true;
      }
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  // 失败取证：把菜单里到底有什么留下来（改版后一眼能看出是文案变了还是结构变了）
  try {
    const texts = await visibleShortTexts();
    log.warn('技能菜单未命中图像入口，可见文本:', texts.join(' | ').slice(0, 400));
    if (task) {
      tasks.note(task, '技能菜单里没找到图像入口，当前可见项: ' + texts.slice(0, 12).join('/'));
      await captureFailureShot(task, 'image-mode-missing');
    }
  } catch (e) { log.debug('生图模式取证失败', e.message); }
  return false;
}

/** 纯文本模式：底栏「对话」切回。技能模式会跨会话残留（上一任务生图/视频后 composer
 * 仍带技能 actionbar），文本任务发送前显式点击，幂等安全。 */
async function ensureTextMode() {
  const page = state.page;
  if (!page) return;
  await exitActiveSkill();
  const chatBtn = await page.evaluate(() => {
    const hit = [...document.querySelectorAll('span')].find((x) => {
      const t = (x.innerText || '').trim();
      return (t === '对话' || /^对话\s*[›»>]?$/.test(t)) && (x.offsetParent !== null || x.getClientRects().length > 0);
    });
    if (!hit) return null;
    const r = hit.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (!chatBtn) { log.warn('底栏「对话」按钮未找到（可能已是文本模式，继续）'); return; }
  await page.mouse.click(chatBtn.x, chatBtn.y, { delay: 40 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1000));
  log.info('已确保文本模式（底栏「对话」）');
}

/** 豆包 CDN 图片下载为原始字节（直链需带 Referer，否则 403）。
 *  2026-11-10：改为返回 {buf, mime} 而非 data URL——结果由 tasks.saveImages 落盘，
 *  API 出参时再转 data URL，避免几十 MB base64 常驻内存 + 全量写进 tasks.json。 */
async function fetchImageBytes(url) {
  const res = await fetch(url, { headers: { Referer: 'https://www.doubao.com/' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const mime = (res.headers.get('content-type') || 'image/png').split(';')[0].trim();
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 20 * 1024 * 1024) throw new Error('图片超过 20MB');
  return { buf, mime };
}

/** 末条 bot 消息全文（runChat 专用：scanConversation 的 600 字截断不够对话回复） */
async function lastBotText() {
  const page = state.page;
  if (!page) return '';
  return page.evaluate(() => {
    const msgs = [...document.querySelectorAll('[data-message-id]')];
    // receive_message 已不在消息容器内（2026-11 结构变更）：末条消息兜底（新会话末条即 bot 回复）
    const bot =
      [...msgs].reverse().find((m) => m.querySelector('[data-testid="receive_message"]')) || msgs[msgs.length - 1];
    return bot ? (bot.innerText || '').trim() : '';
  }).catch(() => '');
}

/** 生图任务：新会话 → 技能「图像生成」→ 填词（+可选参考图=图生图）→ 发送 →
 * 轮询整页 rc_gen_image 标记图（渐进渲染，URL 签名连续稳定即完成）→ 下载转 data URL。 */
async function runImageTask(task) {
  // image_ori_raw 采集窗：completion 载荷给的原始图（image_raw 模板）只对本次任务有效
  state.oriRaw = new Map();
  state.oriRawAt = 0;
  const taskStartedAt = Date.now();
  await ensureChatPage();
  if (!(await pageAlive(state.page, 5000))) {
    await revivePage(task, '生图任务开始');
  }
  await newConversation();
  await dismissPromoOverlay();
  if (!(await switchToImageMode(task))) {
    // 有些情况下弹窗在模式切换后才渲染，清一次再重试
    await dismissPromoOverlay();
    if (!(await switchToImageMode(task))) {
      throw taskError('mode_unconfirmed', '未能确认图像生成模式，本次未发送。');
    }
  }
  await fillPrompt(String(task.input.prompt || ''));
  // 把任务里的生图模型 / 比例真正落到页面上（此前完全不设）
  await applyImageControls(task);
  const refs = Array.isArray(task.input.reference_images) ? task.input.reference_images : [];
  // 生图参考图：豆包「图像生成」可挂多张（实测 4 张稳定），上限 10 张；
  // 视频侧同样支持多图（实测 10 张，见 runVideoTask），两处上限在 config.json 分别声明。
  let uploadedRefs = 0;
  let failedRefs = 0;
  const referenceRoot = String(((task.input && task.input.metadata) || {}).referenceRoot || '');
  for (const ref of refs.slice(0, 10)) {
    const local = await materializeRef(ref, task.id, referenceRoot);
    if (!local) { failedRefs++; continue; }
    // 逐张容错：单张失败不该让整条生图任务失败
    try {
      await uploadRef(local);
      uploadedRefs++;
    } catch (e) {
      failedRefs++;
      log.warn('参考图上传失败（生图），跳过：', path.basename(local), e.message);
    }
  }
  if (refs.length) {
    tasks.note(task, uploadedRefs
      ? '已上传 ' + uploadedRefs + ' 张参考图' + (failedRefs ? '（' + failedRefs + ' 张失败已跳过）' : '')
      : '参考图全部失败，未上传（退化为纯文生图）');
  }
  await clickGenerate();

  // 轮询捕获 150s（同步等待 180s 内，给建会话/切模式/下载留余量）
  const deadline = Date.now() + 150000;
  const pollStart = Date.now();
  let lastSig = '';
  let stableSince = 0;
  let srcs = [];
  let fromOriRaw = false; // 本次是否用了 completion 载荷的无水印原图（写进 result.via 便于回溯）
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    // 风控会让人机验证弹窗盖住页面、消息发送失败——不查就会白等到超时
    await assertNotBlocked(state.page, '生图轮询');
    const snap = await state.page.evaluate(() => {
      const found = [];
      const push = (u) => {
        if (!u || /^(blob:|data:)/i.test(u) || found.includes(u)) return;
        found.push(u);
      };
      // 生成图 URL 正标记（WOOL 取证：rc_gen_image/<id>，参考图/头像/图标都不带）。
      // 全局扫描常开：豆包已把 receive_message 移出 [data-message-id] 容器（2026-11 实测），
      // 消息级定位不可靠；每次生图都新建会话，页内不会有别的生成图。
      const GEN = /rc_gen_image\//;
      for (const im of document.querySelectorAll('img')) {
        if (GEN.test(im.currentSrc || im.src || '')) push(im.currentSrc || im.src);
      }
      // 生成图卡片常以 CSS background-image 渲染而非 <img>（WOOL 同款取证），扫内联样式
      for (const el of document.querySelectorAll('[style*="background-image"]')) {
        const m = /url\((['"]?)([^)'"]+)\1\)/.exec(el.style.backgroundImage || '');
        if (m && GEN.test(m[2])) push(m[2]);
      }
      // 同图多 CDN 变体：候选全部带回 Node 侧，用 watermark.js 统一排序（浏览器上下文拿不到模块）
      return {
        urls: found,
        generating: /生成中|正在生成|努力生成/.test(document.body.innerText || ''),
      };
    }).catch(() => ({ urls: [], generating: true }));
    // 排序（无水印 > 缩略 > 带水印）+ 按 rc_gen_image 身份去重取最优
    const seen = new Set();
    srcs = [];
    for (const u of wm.rankVariants(snap.urls)) {
      const id = wm.assetId(u);
      if (seen.has(id)) continue;
      seen.add(id);
      srcs.push(u);
    }
    log.debug('生图轮询:', srcs.length, '张候选 generating=' + snap.generating);
    // 额度耗尽即时判定：一次出图都没见到、且已过 8s（让 bot 文本先落定）就查一次回复文本。
    // 命中立刻失败并释放账号串行队列 → accounts 标记额度 + 换号，不再白等 150s。
    if (!srcs.length && Date.now() - pollStart >= 8000) {
      const botText = await lastBotText().catch(() => '');
      if (isQuotaText(botText)) {
        tasks.note(task, '生图额度耗尽（文本命中），快速失败并交账号池换号');
        log.warn('生图额度耗尽，快速失败:', task.id, String(botText).slice(0, 60));
        throw taskError('quota_exhausted', '生图额度已用完（豆包文本回复），请等待额度重置。');
      }
    }
    // 无水印原图优先：completion 载荷给的 image_ori_raw 比 DOM 里的 cgen_dwm3 干净
    if (state.oriRawAt > taskStartedAt && state.oriRaw && state.oriRaw.size) {
      const clean = [...state.oriRaw.values()].filter((v) => v.at > taskStartedAt).map((v) => v.url);
      if (clean.length) {
        srcs = clean;
        fromOriRaw = true;
        tasks.note(task, '采用 completion 载荷 image_ori_raw（无水印原图）× ' + clean.length);
        log.info('[capture] 生图改用 image_ori_raw:', clean.length, '张');
        break;
      }
    }
    // 稳定窗按 URL 签名：同数量换 URL（cthumb→cgen 清晰度升级）不算稳定
    const sig = srcs.join('|');
    if (sig && sig === lastSig && !snap.generating) {
      if (!stableSince) stableSince = Date.now();
      if (Date.now() - stableSince >= 3000) break;
    } else {
      stableSince = 0;
      lastSig = sig;
    }
  }
  if (!srcs.length) {
    // 兜底复核（轮询内已即时判过，这里覆盖「恰好卡在超时前才出现额度文本」）
    const botText = await lastBotText();
    if (isQuotaText(botText)) {
      throw taskError('quota_exhausted', '生图额度已用完（豆包文本回复），请等待额度重置');
    }
    throw new Error('生图超时：未捕获到生成图片（页面结构变更或生成失败，见桥日志）');
  }
  const items = [];
  const picked = []; // 与 items 一一对应的源 URL（用于记录水印判定，索引不能错位）
  // 张数（2026-11-12 用户实测）：豆包一次可回 5 张（「已为你生成 5 张…图片」），
  // 原实现硬编码 slice(0, 4)，第 5 张被静默丢弃——用户看到「5 张」却只能拿到 4 张。
  // 改为按实际返回张数全取，只用 MAX_IMAGES 兜底防异常页面刷出几十张把内存打爆。
  const MAX_IMAGES = 8;
  const wantCount = Math.max(1, Math.min(Number(task.input && task.input.count) || 1, MAX_IMAGES));
  const observedImageCount = srcs.length;
  if (srcs.length > wantCount) {
    log.info('生图返回 ' + srcs.length + ' 张，按请求张数保留前 ' + wantCount + ' 张');
    tasks.note(task, '豆包返回 ' + srcs.length + ' 张，按请求保留 ' + wantCount + ' 张');
    srcs = srcs.slice(0, wantCount);
  } else if (srcs.length < wantCount) {
    log.warn('请求 ' + wantCount + ' 张，豆包只返回 ' + srcs.length + ' 张');
    tasks.note(task, '请求 ' + wantCount + ' 张，豆包实际返回 ' + srcs.length + ' 张');
  }
  for (const src of srcs.slice(0, MAX_IMAGES)) {
    try {
      items.push(await fetchImageBytes(src));
      picked.push(src);
    } catch (e) {
      log.warn('生图下载失败:', src.slice(0, 80), e.message);
    }
  }
  if (!items.length) throw new Error('生成图片下载失败（CDN 直链拉取被拒，见桥日志）');
  const files = tasks.saveImages(task.id, items);
  if (!files.length) throw new Error('生成图片落盘失败（检查 data/images 权限与磁盘空间）');
  // 水印判定随结果一起落档：交付了什么、按哪条规则判的，事后可回溯（见 watermark.js 的 R/N 表）
  const classified = picked.map((u) => {
    const c = wm.classifyAsset(u);
    return { watermarked: c.watermarked, known: c.known, kind: c.kind, rule: c.rule, reason: c.reason };
  });
  const anyWatermarked = classified.some((c) => c.known && c.watermarked);
  finishTask(task, {
    kind: 'image', imageFiles: files, image_count: files.length, images: [],
    cleanupComplete: items.length === observedImageCount && observedImageCount >= wantCount,
    via: fromOriRaw ? 'completion:image_raw' : 'dom',
    watermark: anyWatermarked,
    watermarkReason: anyWatermarked
      ? '存在被判定为水印的变体：' + (classified.find((c) => c.known && c.watermarked) || {}).reason
      : (classified[0] && classified[0].reason) || '所选变体均未命中水印参数',
    watermarkDetail: classified,
  });
  log.info('生图任务完成:', task.id, files.length + ' 张（已外置落盘）', fromOriRaw ? '[image_ori_raw 无水印原图]' : (anyWatermarked ? '[含水印变体]' : '[无水印参数]'));
}

/** 文本任务：新会话 → 底栏「对话」确保纯文本 → 填词（系统指令前置 + 末条用户消息；
 * 网页会话每次新建、历史不回放）→ 发送 → 等末条 bot 回复流式稳定 → 全文捕获。 */
async function runChatTask(task) {
  await ensureChatPage();
  if (!(await pageAlive(state.page, 5000))) {
    await revivePage(task, '文本任务开始');
  }
  await newConversation();
  await ensureTextMode();
  const input = task.input || {};
  const msgs = Array.isArray(input.messages) ? input.messages : [];
  const lastUser = [...msgs].reverse().find((m) => m && m.role === 'user');
  const userText = String((lastUser && (lastUser.content != null ? lastUser.content : lastUser.text)) || input.prompt || '');
  if (!userText.trim()) throw new Error('文本任务缺少用户消息（messages 末条需为 user 角色）');
  const sys = String(input.instructions || input.system || '');
  await fillPrompt(sys.trim() ? sys.trim() + '\n\n' + userText : userText);

  // 参考图字段名兼容：插件协议（server.js / 视频任务）用下划线 reference_images，
// 而电商策划这条链路后端实际发的是驼峰 referenceImages（实测任务 input_json：
// {capabilityOptions, config, metadata, mode, prompt, referenceAudios,
//  referenceImages, referenceVideos, textOptions}）。两者都收，避免"图明明带了、
// 桥却当没带"的静默丢图。
  //
  // 注意：电商链路里的 referenceImages 元素是 {name, storageKey} 对象（不是 data URL），
  // materializeRef 对对象会返回 null。这一层需要后端在投递前把 storageKey 换成
  // 可访问的 data URL / https URL，否则仍然传不上去——已单独记录。
  const refs = Array.isArray(input.reference_images)
    ? input.reference_images
    : Array.isArray(input.referenceImages)
      ? input.referenceImages
      : [];
  if (refs.length) {
    const uploadedRefs = [];
    let uploaded = 0;
    for (const ref of refs.slice(0, 4)) {
      const local = await materializeRef(ref, task.id, String(((task.input && task.input.metadata) || {}).referenceRoot || ''));
      if (!local) {
        log.warn('文本任务参考图落地失败，未上传:', String(ref).slice(0, 60));
        continue;
      }
      await uploadRef(local);
      uploaded += 1;
      uploadedRefs.push(local);
    }
    if (!uploaded) throw new Error('文本任务携带参考图但全部上传失败（豆包侧无图，拒绝以纯文本继续）');
    tasks.note(task, `已上传 ${uploaded} 张参考图（多模态对话）`);
  }

  // ---- P0-2：文本对话三段诊断（2026-11-11）----
  // 原来只有一句「文本回复超时」，把三种完全不同的故障混在一起：消息没发出去、
  // 发出去了豆包不回复（风控/审核）、回复到了但被判成别的。今天这一句占了 4 次失败，
  // 却无法告诉用户该做什么。现在分段取证：
  //   阶段1 发送是否落地（composer 清空 + 消息节点增长）
  //   阶段2 是否出现了「本任务之后」的 bot 消息（基线计数，避免拿到上一轮旧回复）
  //   阶段3 超时时按阶段给出不同原因 + 现场截图
  // 注意：runChatTask 没有 page 局部变量（全用 state.page），这里显式取一次。
  const chatPage = state.page;
  const beforeSend = await chatPage.evaluate(() => ({
    url: location.href,
    messageCount: document.querySelectorAll('[data-message-id]').length,
    composerText: (() => {
      const el = document.querySelector('[data-testid="chat_input_input"], textarea, [contenteditable="true"]');
      return el ? String(el.innerText || el.value || '').trim().slice(0, 60) : '';
    })(),
  })).catch(() => ({ url: '', messageCount: 0, composerText: '' }));

  await clickGenerate();

  // 阶段1：发送落地验证；未知提交不能再次发送相同提示词。
  const clickAt = Date.now();
  let sentAt = 0;
  let sendAttempts = 0;
  for (; sendAttempts < 1; sendAttempts++) {
    let landed = false;
    for (let wait = 0; wait < 5 && !landed; wait++) {
      await new Promise((r) => setTimeout(r, 2000));
      const now = await chatPage.evaluate(() => ({
        url: location.href,
        messageCount: document.querySelectorAll('[data-message-id]').length,
        composerText: (() => {
          const el = document.querySelector('[data-testid="chat_input_input"], textarea, [contenteditable="true"]');
          return el ? String(el.innerText || el.value || '').trim() : '';
        })(),
      })).catch(() => null);
      if (!now) continue;
      const grew = now.messageCount > beforeSend.messageCount;
      const composerCleared = beforeSend.composerText !== '' && now.composerText === '';
      landed = grew || composerCleared || /\/chat\/\d+/.test(now.url) !== /\/chat\/\d+/.test(beforeSend.url);
    }
    if (landed) {
      sentAt = Date.now();
      tasks.transition(task, 'processing', { phase: 'accepted', submissionState: 'accepted' });
      break;
    }
  }
  if (!sentAt) {
    // 阶段1 失败：输入根本没发出去
    const stage = await chatPage.evaluate(() => (() => {
      const el = document.querySelector('[data-testid="chat_input_input"], textarea, [contenteditable="true"]');
      return { composer: el ? String(el.innerText || el.value || '').trim().slice(0, 120) : '(输入框未找到)' };
    })()).catch(() => ({ composer: '' }));
    await captureFailureShot(task, 'text-not-sent');
    throw taskError('submission_unknown', '文本消息提交结果未知：未收到发送回执，请先检查原会话，避免重复生成。');
  }
  tasks.note(task, '文本消息已发送（' + Math.round((sentAt - clickAt) / 1000) + 's 内落地）');
  await assertNotBlocked(chatPage, '文本发送后');

  const deadline = Date.now() + 120000;
  let lastLen = -1;
  let stableSince = 0;
  let reply = '';
  let sawNewBotMessage = false;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2500));
    // 阶段2：只取「发送前基线之后」的 bot 消息。原来取末条消息，若新会话没建成功，
    // 末条就是上一轮的旧回复 → 会把旧答案当成本次回答交付（与视频串片同一类错误）。
    const conv = await chatPage.evaluate((base) => {
      const msgs = [...document.querySelectorAll('[data-message-id]')];
      const tail = msgs.slice(base);
      // 跳过我们自己发出的消息（有 send_message testid 或落在右侧）
      const bots = tail.filter((m) => !m.querySelector('[data-testid="send_message"]'));
      const last = bots[bots.length - 1];
      return { total: msgs.length, newBots: bots.length, text: last ? (last.innerText || '').trim() : '' };
    }, beforeSend.messageCount).catch(() => null);
    if (conv && conv.newBots > 0) {
      sawNewBotMessage = true;
      reply = conv.text || '';
    } else {
      reply = '';
    }
    if (reply) lastLen = reply.length;
    // 额度耗尽即时判定：文本任务与生图同源，额度用完时 bot 直接回一句短通知，
    // 不进入流式生成。只在「回复很短且命中额度口径」时才判死——用户自己问
    // 「我的额度怎么用完了」时 bot 会给长解释，不能因此误杀。
    if (reply.length && reply.length <= 100 && isQuotaText(reply)) {
      tasks.note(task, '文本额度耗尽（短回复命中），快速失败并交账号池换号');
      log.warn('文本额度耗尽，快速失败:', task.id, reply.slice(0, 60));
      throw taskError('quota_exhausted', '文本额度已用完（豆包文本回复），请等待额度重置。');
    }
    if (reply.length && reply.length === lastLen) {
      if (!stableSince) stableSince = Date.now();
      if (Date.now() - stableSince >= 5000) break;
    } else {
      stableSince = 0;
      lastLen = reply.length;
    }
  }
  if (!reply.trim()) {
    // 阶段3：超时按实际情况给不同原因，而不是一句笼统的「页面结构变更」
    const diag = await chatPage.evaluate((base) => {
      const msgs = [...document.querySelectorAll('[data-message-id]')];
      const tail = msgs.slice(base);
      const bots = tail.filter((m) => !m.querySelector('[data-testid="send_message"]'));
      const last = bots[bots.length - 1];
      return {
        url: location.href,
        total: msgs.length,
        newBots: bots.length,
        lastText: last ? (last.innerText || '').trim().slice(0, 120) : '',
      };
    }, beforeSend.messageCount).catch(() => null);
    const botText = await lastBotText();
    if (isQuotaText(botText)) {
      throw taskError('quota_exhausted', '文本额度已用完（豆包文本回复），请等待额度重置');
    }
    await captureFailureShot(task, 'text-timeout');
    const where = '（会话 ' + String((diag && diag.url) || '').replace('https://www.doubao.com', '') + '，消息 ' + ((diag && diag.total) || 0) + ' 条，其中本任务新增 0 条 bot 消息）';
    if (!sawNewBotMessage) {
      throw new Error(
        '文本消息已发出，但豆包 120 秒内没有回任何消息' + where +
          '。通常是触发风控/内容审核，或页面卡在生成中未推送。已保存现场截图；稍后重试或换个说法再试。'
      );
    }
    throw new Error(
      '豆包回了消息但内容为空' + where +
        '。可能是回复被折叠/被审核拦截（原消息存在但无正文）。已保存现场截图，可重试或换账号。'
    );
  }
  finishTask(task, { kind: 'text', text: reply });
  log.info('文本任务完成:', task.id, '回复 ' + reply.length + ' 字');
}

/* 会话扫描（WOOL _scanChat 同构）：data-message-id 消息按 send/receive 分角色回流，
 * 供影策 UI 以聊天气泡实时呈现自动化进度。 */
/* 会话扫描（实时对话面板数据源）。语义（2026-11-08 用户定版）：面板 = 自动化窗口
 * 当前页面的实况——页面停在哪条会话就整段回传那条会话（含 conversationId 身份），
 * 页面切换后下一次轮询自然重识别；不在会话页（新对话根 /chat/、设置页等）返回
 * conversationId=null（面板据此隐藏）。账号归属由 server 层解析（执行任务的账号）。 */
async function scanConversation() {
  const page = state.page;
  if (!page) return { messages: [], url: null, conversationId: null };
  let url = null;
  try { url = page.url(); } catch (e) {}
  const convMatch = url && url.match(/\/chat\/(\d+)/);
  if (!convMatch) return { messages: [], url, conversationId: null };
  const r = await page.evaluate(() => ({
    url: location.href,
    messages: [...document.querySelectorAll('[data-message-id]')].slice(-30).map((m) => {
      const send = m.querySelector('[data-testid="send_message"]');
      const first = m.querySelector(':scope > div');
      const cls = first ? String(first.className) : '';
      const isUser = !!send || /sendMessage/i.test(cls);
      const recv = m.querySelector('[data-testid="receive_message"]');
      const body = (isUser ? send : recv) || m;
      return {
        id: m.getAttribute('data-message-id'),
        role: isUser ? 'user' : 'bot',
        text: (body.innerText || '').trim().slice(0, 600),
        hasVideo: !!m.querySelector('video'),
      };
    }),
  })).catch((e) => ({ error: e.message, messages: [], conversationId: convMatch[1] }));
  return Object.assign({}, r, { conversationId: convMatch[1] });
}

/*
 * 关掉豆包的「下载电脑版」营销弹窗（2026-11-11）。
 *
 * 这个弹窗是 fixed inset-0 + backdrop-blur 的全屏遮罩，正文是
 *   "下载电脑版 / 使用完整功能 / 随时帮忙的 AI 桌面助手…"，按钮「下载电脑版」「下次提醒我」。
 *
 * 它一出现就把整个页面盖住，composer 的按钮 elementFromPoint 全部命中遮罩，
 * 于是 switchToImageMode / switchToVideoMode 全部失败，报
 *   "未能切换到生图模式（技能菜单无「图像生成」入口）"
 * ——实际不是没入口，是点不到。
 *
 * 每个任务开始前清一次；关不掉也不阻塞（继续尝试，失败会有明确错误）。
 */
async function dismissPromoOverlay() {
  const page = state.page;
  if (!page) return false;
  const hit = await page.evaluate(() => {
    const masks = [...document.querySelectorAll('div')].filter(
      (e) => /backdrop-blur/.test(String(e.className)) && /fixed inset-0/.test(String(e.className)),
    );
    if (!masks.length) return null;
    const texts = ['下次提醒我', '暂不', '以后再说', '稍后', '关闭'];
    for (const e of document.querySelectorAll('button, [role=button], span, div')) {
      const t = (e.innerText || '').trim();
      if (!t || t.length > 12) continue;
      if (!texts.includes(t)) continue;
      const r = e.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: t };
    }
    return null;
  }).catch(() => null);
  if (!hit) return false;
  await page.mouse.click(hit.x, hit.y, { delay: 50 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 900));
  log.info('已关闭豆包营销弹窗（' + hit.text + '）');
  return true;
}

async function hasVideoMode() {
  const page = state.page;
  if (!page) return false;
  return page.evaluate(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };
    const editor = document.querySelector('[data-testid="chat_input_input"]');
    if (!editor || !visible(editor)) return false;
    const skill = document.querySelector('[data-testid="skill_input_exit_button"]');
    if (skill && visible(skill) && (skill.innerText || '').trim() === '视频生成') return true;
    const controls = [...document.querySelectorAll('[data-input-engine-actionbar-control-key]')].filter(visible);
    return controls.some((el) => /^video[-_]/.test(el.getAttribute('data-input-engine-actionbar-control-key') || '')) ||
      (controls.some((el) => /Seedance|视频模型/i.test(el.innerText || '')) &&
       controls.some((el) => /时长|\d+\s*(秒|s)/.test(el.innerText || '')));
  }).catch(() => false);
}

/*
 * 按 actionbar 控件文本点选选项（2026-11-11）。
 *
 * 背景：此前桥完全不设置模型 / 比例，一切依赖豆包页面的默认值。
 * 于是用户在客户端选了 Seedance 2.0 Fast，实际可能出 Mini；选了 9:16，实际出 16:9。
 * 用户看到的"比例生效"其实是他在页面里手动选过的那一次。
 *
 * 不依赖固定 data-* key：视频模式是 video-model，生图模式 key 不同，
 * 按控件文本（"模型""比例"）匹配更稳。已经是目标值时不点击。
 */
async function selectActionbarOption(controlKeyword, optionText) {
  const page = state.page;
  if (!page || !optionText) return false;
  const findControl = async () => page.evaluate((kw) => {
    const measure = (e) => {
      const r = e.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0 || r.width > 420) return null;
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (e.innerText || '').replace(/\s+/g, ' ').trim() };
    };
    // 优先：带 actionbar control key 的控件（视频模式 video-model、生图模式 model）
    const nodes = [...document.querySelectorAll('[data-input-engine-actionbar-control-key], [role="menuitem"][data-slot="dropdown-menu-sub-trigger"]')];
    const hit = nodes.find((e) => !e.closest('[role="menu"][data-state="closed"]') && measure(e) && (e.innerText || '').includes(kw));
    if (hit) {
      const out = measure(hit);
      if (out) return out;
    }
    // 兜底：按可见文本找。生图的「比例」控件没有 action key（实测只有 model / style）。
    const input = document.querySelector('[data-testid="chat_input_input"]');
    const ir = input ? input.getBoundingClientRect() : null;
    if (!ir) return null;
    let best = null;
    for (const e of document.querySelectorAll('button, [role=button], div, span')) {
      if (e.offsetParent === null || e.closest('[role="menu"][data-state="closed"]')) continue;
      const t = (e.innerText || '').trim();
      if (!t || t.length > 24 || !t.startsWith(kw)) continue;
      const r = e.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0 || r.width > 420) continue;
      // 必须在 composer 附近（输入框上下 160px），排除正文/侧栏里的同名文字
      if (r.y < ir.y - 160 || r.y > ir.bottom + 60) continue;
      const cand = { x: r.x + r.width / 2, y: r.y + r.height / 2, text: t.replace(/\s+/g, ' ') };
      if (!best || cand.y < best.y) best = cand;
    }
    return best;
  }, controlKeyword).catch(() => null);
  const openControl = async () => {
    let box = await findControl();
    if (box) return box;
    // 窄窗口中 actionbar 的模型和比例折叠在输入框的更多菜单里。
    const trigger = await page.$('[data-testid="chat_input"] [data-slot="dropdown-menu-trigger"][aria-haspopup="menu"]');
    if (!trigger) return null;
    for (let attempt = 0; attempt < 3 && !box; attempt++) {
      const expanded = await trigger.evaluate((e) => e.getAttribute('aria-expanded') === 'true').catch(() => false);
      if (!expanded) {
        await trigger.focus();
        await page.keyboard.press('Enter');
      }
      await new Promise((r) => setTimeout(r, 1000));
      box = await findControl();
    }
    return box;
  };
  const closeMenus = async () => {
    for (let i = 0; i < 3; i++) {
      const open = await page.evaluate(() => !!document.querySelector('[role="menu"][data-state="open"], [role="listbox"][data-state="open"]')).catch(() => false);
      if (!open) break;
      await page.keyboard.press('Escape').catch(() => {});
      await new Promise((r) => setTimeout(r, 350));
    }
    // Radix retains closed menu nodes during its exit animation.
    await new Promise((r) => setTimeout(r, 350));
  };
  await closeMenus();
  let box = await openControl();
  if (!box) return false;
  if ((box.text || '').includes(optionText)) {
    await closeMenus();
    return true;
  }

  // Radix 子菜单通过 hover 展开；普通 actionbar 控件仍使用点击。
  await page.mouse.move(box.x, box.y).catch(() => {});
  await new Promise((r) => setTimeout(r, 1200));
  const hasMenu = await page.evaluate(() => !!document.querySelector('[data-slot="dropdown-menu-sub-content"][data-state="open"]')).catch(() => false);
  if (!hasMenu) {
    await page.mouse.click(box.x, box.y, { delay: 50 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 700));
  }
  const opt = await page.evaluateHandle((text) => {
    const menus = [...document.querySelectorAll('[role="menu"][data-state="open"], [role="listbox"], [role="dialog"]')];
    for (const e of menus.flatMap((menu) => [...menu.querySelectorAll('button, [role="menuitem"], [role="option"]')])) {
      if (e.offsetParent === null || e.closest('[role="menu"][data-state="closed"]')) continue;
      const t = (e.innerText || '').replace(/\s+/g, ' ').trim();
      if (!t || t.length > 100) continue;
      if (t === text || t.startsWith(text + ' ')) {
        const r = e.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.width < 600) {
          return e;
        }
      }
    }
    return null;
  }, optionText).catch(() => null);
  const option = opt && opt.asElement();
  if (!option) {
    await closeMenus();
    return false;
  }
  await option.click({ delay: 60 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 700));
  await closeMenus();
  box = await openControl();
  const selected = !!box && (box.text || '').includes(optionText);
  await closeMenus();
  return selected;
}

/** 豆包视频模型的页面显示名（任务 input.model 是 modelKey）。 */
const DOUBAO_VIDEO_MODEL_LABELS = {
  'seedance_2.0_mini': 'Seedance 2.0 Mini',
  'seedance_2.0_fast': 'Seedance 2.0 Fast',
};

/** 豆包生图模型的页面显示名（实测下拉里的写法，免费 4 档）。 */
const DOUBAO_IMAGE_MODEL_LABELS = {
  'doubao_image_1.0': 'Seedream 5.0 Flash',
  'doubao_image_5.5': 'Seedream 5.5',
  'doubao_image_4.5': 'Seedream 4.5',
  'doubao_image_4.0': 'Seedream 4.0',
};

/** 生图任务：把模型与比例落到页面上。 */
async function applyImageControls(task) {
  const modelKey = String((task.input && task.input.model) || '');
  const label = DOUBAO_IMAGE_MODEL_LABELS[modelKey];
  if (label) {
    const ok = await selectActionbarOption('模型', label);
    if (!ok) throw taskError('parameter_unconfirmed', '无法确认生图模型「' + label + '」，本次未发送。');
    tasks.note(task, '已选择生图模型「' + label + '」');
  }
  const ratio = String((task.input && (task.input.ratio || task.input.size || task.input.aspect_ratio)) || '');
  if (ratio && /^\d+:\d+$/.test(ratio)) {
    const ok = await selectActionbarOption('比例', ratio);
    if (!ok) throw taskError('parameter_unconfirmed', '无法确认生图比例 ' + ratio + '，本次未发送。');
    tasks.note(task, '已选择比例 ' + ratio);
  }
}

/** 生成前把任务里的模型落到豆包页面上，无法确认时不发送任务。
 *
 * 比例 / 时长为什么不点页面（2026-11-11 六档比例矩阵实测）：
 *   走页面点选时，页面的选择会盖掉 completion 请求体里的 ability_param.ratio ——
 *   实测 3:4 点选后出片 960×960（方图），4:3 出片 720×1280（竖屏），整体错档。
 *   而只改请求体（不动页面）时，21:9 → 1470×630、1:1 → 960×960 全部正确。
 *   因此视频侧比例/时长只走请求体改写（patch30）+ 提示词时长提示，
 *   页面只负责模型（模型下拉与算力档位绑定，必须可见一致）。
 */
async function applyVideoControls(task) {
  const modelKey = String((task.input && task.input.model) || '');
  const label = DOUBAO_VIDEO_MODEL_LABELS[modelKey];
  if (label) {
    const ok = await selectActionbarOption('模型', label);
    if (!ok) throw taskError('parameter_unconfirmed', '无法确认视频模型「' + label + '」，本次未发送。');
    tasks.note(task, '已选择模型「' + label + '」');
  }
  const ratio = String((task.input && (task.input.ratio || task.input.size)) || '');
  if (/^\d+:\d+$/.test(ratio)) {
    // 不点页面：由请求体改写生效（见上方注释）。这里只记录通道，方便回溯。
    tasks.note(task, '比例 ' + ratio + ' 由请求体写入（不点页面，避免错档）');
  }
  const duration = parseInt((task.input && task.input.duration) || 0, 10);
  if (Number.isFinite(duration) && duration > 0) {
    tasks.note(task, '时长 ' + duration + 's 由请求体 + 提示词写入');
  }
}

/* 页面僵死检测：渲染进程被 Chromium 后台冻结（内存节省/定时器节流/遮挡节流）或崩溃时，
 * CDP Runtime 调用会挂满 protocolTimeout（180s）——evaluate 在 ms 内不返回即判死 */
function pageAlive(page, ms) {
  ms = ms || 8000;
  return Promise.race([
    page.evaluate(() => 1).then(() => true, () => false),
    new Promise((r) => setTimeout(() => r(false), ms)),
  ]);
}

/* 僵死恢复：强制导航拉起新渲染进程（request/response 监听器挂在 page 对象上，导航后依然有效）。
 * 已在豆包页时原地 reload 保留任务会话（豆包服务端继续生成，重载后消息渲染可被 DOM 扫描捕获）；
 * 仅当不在豆包域时才 goto 入口——reload 后再 goto 会把页面带离任务会话（run 实证丢上下文） */
async function revivePage(task, where) {
  const page = state.page;
  if (!page) return false;
  log.warn('页面无响应（' + where + '），强制重载恢复渲染进程');
  if (task) tasks.note(task, '页面无响应（' + where + '），已强制重载恢复');
  try {
    const url = page.url();
    if (url && url.startsWith('https://www.doubao.com')) {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    } else {
      await page.goto(D.entryUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }
    await page.waitForSelector(S.composerHost, { timeout: 30000 });
    return true;
  } catch (e) {
    log.error('页面重载失败:', e.message);
    return false;
  }
}

async function fillPrompt(text) {
  const page = state.page;
  let inserted = false;
  for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
    await page.waitForSelector(S.promptEditor, { visible: true, timeout: 15000 });
    inserted = await page.evaluate((sel, t) => {
      const pm = document.querySelector(sel);
      if (!pm || !pm.isContentEditable) return false;
      pm.focus();
      // 选中整个编辑器以替换旧内容，同时为空编辑器建立明确的输入选区。
      const range = document.createRange();
      range.selectNodeContents(pm);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return document.execCommand('insertText', false, t);
    }, S.promptEditor, text);
    if (!inserted && attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!inserted) throw new Error('填词失败（无法向编辑器输入提示词）');
  // 等发送按钮懒渲染
  await page.waitForSelector(S.generateSubmit, { timeout: 8000 })
    .catch(() => { throw new Error('发送按钮未出现（填词可能未生效）'); });
}

async function uploadRef(imagePath) {
  const page = state.page;
  const abs = path.resolve(imagePath);
  if (!fs.existsSync(abs)) throw new Error('参考图不存在: ' + imagePath);
  // 现行 UI（2026-11 取证）：视频模式 composer 左侧「+」按钮 = 附件入口；
  // 点击后弹出菜单（或直接开文件选择器）。upload_file_button testid 在视频模式已消失，
  // 按「输入框左侧最近的小圆按钮」位置定位（含无标签 SVG 图标按钮）。
  const locatePlus = () => page.evaluate(() => {
    const input = document.querySelector('[data-testid="chat_input_input"]');
    if (!input) return null;
    const ir = input.getBoundingClientRect();
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.width < 80 && r.height < 80; };
    let best = null, bestDx = 1e9;
    for (const b of document.querySelectorAll('button, [role="button"], [class*="icon"]')) {
      if (!vis(b)) continue;
      const r = b.getBoundingClientRect();
      if (r.x < ir.x && ir.x - r.x < 150 && Math.abs(r.y + r.height / 2 - (ir.y + ir.height / 2)) < 60) {
        const dx = ir.x - r.x;
        if (dx < bestDx) { bestDx = dx; best = b; }
      }
    }
    if (!best) return null;
    const r = best.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  const chooserPromise = page.waitForFileChooser({ timeout: 15000 }).catch(() => null);
  const plus = await locatePlus();
  if (!plus) throw new Error('未定位到上传入口（+ 按钮）');
  await page.mouse.click(plus.x, plus.y, { delay: 50 });
  // 两种形态：直接开文件选择器，或先弹菜单（点「图片/上传」项后才开）
  let chooser = await Promise.race([
    chooserPromise,
    new Promise((r) => setTimeout(() => r(null), 1600)),
  ]);
  if (!chooser) {
    const entry = await page.evaluate(() => {
      const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const cand = [...document.querySelectorAll('[role="menuitem"], [class*="item"], li, div')]
        .filter(vis)
        .filter((e) => e.children.length <= 3)
        .filter((e) => /图片|上传|本地/.test(e.innerText || '') && (e.innerText || '').trim().length < 30);
      if (!cand.length) return null;
      const r = cand[0].getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (!entry) throw new Error('上传菜单未出现且无文件选择器');
    const chooser2 = page.waitForFileChooser({ timeout: 10000 }).catch(() => null);
    await page.mouse.click(entry.x, entry.y, { delay: 50 });
    chooser = await Promise.race([chooser2, new Promise((r) => setTimeout(() => r(null), 9000))]);
    if (!chooser) throw new Error('点击图片入口后文件选择器未出现');
  }
  await chooser.accept([abs]);
  // 等豆包完成附件上传（发送按钮可用即附件就绪）
  await page.waitForFunction(() => {
    const b = document.querySelector('[data-testid="chat_input_send_button"]');
    return b && !b.disabled && b.getAttribute('aria-disabled') !== 'true';
  }, { timeout: 30000 }).catch(() => {});
  // 就绪判定（2026-11-08 协议实证）：豆包上传链 = TOS 直传 → CommitImageUpload →
  // pre_handle_v2_without_conv（返回 pre_generate_id = 附件已在会话注册完毕）。
  // 发送按钮恒可用（空 composer 也不禁用），不能作就绪信号；pre_handle 未回执就点
  // 发送会发出纯文本消息 → bot 回「请上传图片」死局（服务器 run 序列的失败根因）。
  // 45s 无回执快速失败，绝不发无图消息。
  await new Promise((resolve, reject) => {
    const onPageResponse = (resp) => {
      if (!/pre_handle_v2_without_conv/.test(resp.url())) return;
      resp.json().then((b) => {
        if (b && b.code === 0) { cleanup(); resolve(); }
      }).catch(() => {});
    };
    const cleanup = () => { clearTimeout(timer); try { page.off('response', onPageResponse); } catch (e) {} };
    const timer = setTimeout(() => { cleanup(); reject(new Error('参考图上传未完成（45s 无 pre_handle 回执，附件未注册，不发送）')); }, 45000);
    page.on('response', onPageResponse);
  });
  log.info('参考图已上传（+ 入口，pre_handle 回执确认）', path.basename(abs));
}

async function clickGenerate() {
  const page = state.page;
  const btn = await page.waitForSelector(S.generateSubmit, { timeout: 10000 });
  if (!btn) throw new Error('发送按钮不存在');
  const owner = state.activeTask;
  if (state.cleanupProof && (state.cleanupProof.task !== owner || new URL(page.url()).pathname !== state.cleanupProof.path)) state.cleanupProof = null;
  if (state.cleanupProof) state.cleanupProof.submitted = true;
  if (owner && tasks.get(owner.id) === owner && owner.status === 'processing') {
    tasks.transition(owner, 'processing', { phase: 'submitting', submissionState: 'unknown' });
  }
  // 拟真化点击：随机微延迟（WOOL v19 拟真化 CDP 点击思路）
  await btn.click({ delay: 50 + Math.random() * 80 });
  log.info('已点击发送');
  await dismissSafetyConfirm(page);
}

/* ---------------- 「安全确认」合规弹窗（2026-11-08 图生视频实测） ----------------
 * 带参考图发送后，豆包弹出素材授权确认对话框（正文含「安全确认」，按钮 取消/确认）。
 * 不点「确认」消息不落地，任务会永远等不到生成——这是图生视频此前一直失败的缺口。
 * 弹窗同步出现（发送后数秒内），限定 dialog/modal 容器内同名按钮，避免误点聊天区。
 */
async function dismissSafetyConfirm(page, maxWaitMs = 4000) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const clicked = await page.evaluate(() => {
      for (const b of document.querySelectorAll('button, [role="button"]')) {
        const t = (b.innerText || '').trim();
        const r = b.getBoundingClientRect();
        if (t === '确认' && r.width > 0 && r.height > 0 && b.closest('[role="dialog"], [class*="modal"], [class*="dialog"]')) {
          b.click();
          return true;
        }
      }
      return false;
    }).catch(() => false);
    if (clicked) {
      log.info('已点击「安全确认」弹窗（素材授权）');
      await new Promise((r) => setTimeout(r, 800));
      return true;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

/* ---------------- 确认卡片自动点击（WOOL 自动发送模块功能移植） ----------------
 * 豆包视频生成发送后，bot 会回复「视频生成参数确认」卡片，需点「确认」才开始生成。
 * WOOL 检测正则（doubao.jsc 常量池明文取证）：(是否|请确认|请选择|确认|开始生成|需要我|选择|？|\?)
 * 消息分类（doubao.jsc 常量池）：send|user|ask|mine|self vs receive|assistant|bot（data-testid）
 */
// 「确认生成」= 图生视频的素材合规确认按钮（bot 素材授权声明后的唯一推进按钮，实测漏点会导致 20 分钟空等）
const CONFIRM_BTN_RE = /^(确认|确定|开始生成|继续|生成|开始|确认生成|立即生成)$/;

async function findConfirmCard() {
  const page = state.page;
  return page.evaluate(() => {
    const CONFIRM_RE = /(是否|请确认|请选择|确认|开始生成|需要我|选择|？|\?)/;
    const msgs = [...document.querySelectorAll('[data-message-id]')];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      // 只认豆包（bot）消息（2026-11-11 实测修正）：`receive_message` testid 已不在
      // 消息容器内，旧实现退化成扫全部消息，把**我们自己发的**「确认」当成豆包在提问，
      // 于是每轮都误记「豆包在等你回复」（真机取证：任务记录里「豆包原话: 确认」）。
      // 真实可用的角色标记是 `data-send-message-boundary`：仅用户消息带此属性。
      if (m.hasAttribute('data-send-message-boundary')) continue;
      if (!/grid-cols-\[minmax/.test(String(m.className || '')) && m.getAttribute('data-testid') !== 'message_content') continue;
      const inner = m.querySelector('[data-testid="receive_message"]') || m;
      const text = (inner.innerText || inner.textContent || '').trim();
      if (!text || !CONFIRM_RE.test(text)) continue;
      const btns = [...m.querySelectorAll('button, [role="button"]')].map((b) => {
        const r = b.getBoundingClientRect();
        return {
          text: (b.innerText || b.textContent || '').trim().slice(0, 40),
          testid: b.getAttribute('data-testid'),
          cls: String(b.className || '').slice(0, 100),
          tag: b.tagName,
          disabled: b.disabled === true,
          rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        };
      });
      return { messageId: m.getAttribute('data-message-id'), text: text.slice(0, 400), buttons: btns };
    }
    return null;
  });
}

/* ---------------- 缺素材死局快速失败（服务器 run35 实证） ----------------
 * 提示词语义依赖参考画面（如影策画布「基于当前画面推演下一个连续镜头」）但任务未带图时，
 * 豆包 bot 回复「请先上传画面」后无限等待——视频永远不会来，空等只会耗满 20 分钟超时。
 * 检测最新一条 bot 回复是否索要上传素材，命中即快速失败并给出可操作的原因。
 */
async function findMissingInputReply() {
  const page = state.page;
  if (!page) return null;
  return page.evaluate(() => {
    const RE = /(请先上传|请上传|先上传.{0,8}(画面|图片|图像)|上传.{0,8}(画面|图片|图像)(后|之后)|没有检测到.{0,12}(素材|原图|图片|画面)|请重新上传|重新上传.{0,10}(图片|画面|素材))/;
    const msgs = [...document.querySelectorAll('[data-message-id]')];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      // 豆包现行 DOM 无 receive_message testid（a10838/ceaf7e 会话实证全 False）——与 findConfirmCard 同用 || m 兜底
      const inner = m.querySelector('[data-testid="receive_message"]') || m;
      const text = (inner.innerText || inner.textContent || '').trim();
      if (!text) continue;
      // 桥自己发送的用户消息形态（视频模式「生成视频：」前缀 / 补发「确认」）——跳过，防提示词含上传措辞时误判
      if (/^生成视频：/.test(text) || text === '确认') continue;
      return RE.test(text) ? { messageId: m.getAttribute('data-message-id'), text: text.slice(0, 300) } : null;
    }
    return null;
  });
}

/* bot 宣布视频生成完成的最新回复（提前交付信号）。
 * 只认严格完成句式（「视频生成好了/视频已生成/已生成完毕」）——受理回执「视频生成好后，我会主动发送给你」
 * 是「好后」不是「好了」，不会误触发。倒序扫最近 3 条非空消息（视频推送型消息可能无 receive_message
 * testid，与 findConfirmCard 同用 || m 兜底；视频元数据消息可能夹在完成宣布之后）。 */async function findVideoDoneReply() {
  const page = state.page;
  if (!page) return null;
  return page.evaluate(() => {
    const RE = /(视频生成好了|视频已生成|已生成完毕)/;
    const msgs = [...document.querySelectorAll('[data-message-id]')];
    let checked = 0;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      const inner = m.querySelector('[data-testid="receive_message"]') || m;
      const text = (inner.innerText || inner.textContent || '').trim();
      if (!text) continue; // 视频消息可能无文本，往前继续找完成宣布
      if (RE.test(text)) return { messageId: m.getAttribute('data-message-id'), text: text.slice(0, 120) };
      if (++checked >= 3) return null; // 只看最近 3 条非空消息
    }
    return null;
  });
}

/* 额度耗尽快速失败：bot 回「今日视频生成免费额度已用完/开通订阅」类回复时视频永不来——
 * 空等只会耗满 20 分钟超时（run37 实证：确认受理后 bot 直接回额度用完，无视频推送）。
 * 受理回执「本次生成将消耗每日免费额度」不含「用完/开通订阅」，不会误判。 */
async function findQuotaExhaustedReply() {
  const page = state.page;
  if (!page) return null;
  // 正则源码从主进程传入：page.evaluate 的闭包不跨进程，避免二次硬编码漂移
  return page.evaluate((reSource) => {
    const RE = new RegExp(reSource);
    const msgs = [...document.querySelectorAll('[data-message-id]')];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      const inner = m.querySelector('[data-testid="receive_message"]') || m;
      const text = (inner.innerText || inner.textContent || '').trim();
      if (!text) continue;
      if (/^生成视频：/.test(text) || text === '确认') continue; // 桥发送的用户消息形态，跳过
      return RE.test(text) ? { messageId: m.getAttribute('data-message-id'), text: text.slice(0, 200) } : null;
    }
    return null;
  }, QUOTA_TEXT_RE.source);
}

/* 限流快速失败（2026-11-10 补）：run22 实证豆包会回
 * `生成错误: {"code":710022004,"message":"rate limited"...}` 这类结构，
 * 此时视频不会产出，空等只会耗满超时并占住账号串行队列。
 * 这里只负责「快速失败并打上可重试标记」，重试由 accounts.onTaskDone 在队列层做
 * （那里能换号、能退避，也不会在同一个页面状态上重复点击导致双倍扣额度）。 */
const RATE_LIMIT_TEXT_RE = /rate\s*limit|710022004|访问过于频繁|请求过于频繁|操作过于频繁|系统繁忙/;

async function findRateLimitReply() {
  const page = state.page;
  if (!page) return null;
  return page.evaluate((reSource) => {
    const RE = new RegExp(reSource, 'i');
    const msgs = [...document.querySelectorAll('[data-message-id]')];
    let checked = 0;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      const inner = m.querySelector('[data-testid="receive_message"]') || m;
      const text = (inner.innerText || inner.textContent || '').trim();
      if (!text) continue;
      if (/^生成视频：/.test(text) || text === '确认') continue;
      if (RE.test(text)) return { messageId: m.getAttribute('data-message-id'), text: text.slice(0, 200) };
      if (++checked >= 2) return null; // 只看最近 2 条，避免历史消息误判
    }
    return null;
  }, RATE_LIMIT_TEXT_RE.source);
}

async function confirmGeneration({ dryRun = false, timeoutMs = 0, clickedIds = null } = {}) {
  const page = state.page;
  const deadline = Date.now() + (timeoutMs || C.confirmTimeoutMs);
  while (Date.now() < deadline) {
    const card = await findConfirmCard();
    if (card) {
      if (dryRun) return { found: true, dryRun: true, card };
      if (clickedIds && clickedIds.has(card.messageId)) {
        // 已点过这张卡（等待其消失/生成开始），不重复点
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      const btn = card.buttons.find((b) => !b.disabled && CONFIRM_BTN_RE.test(b.text) && b.rect.w > 0 && b.rect.h > 0);
      if (btn) {
        await page.mouse.click(btn.rect.x + btn.rect.w / 2, btn.rect.y + btn.rect.h / 2, { delay: 40 + Math.random() * 60 });
        if (clickedIds) clickedIds.add(card.messageId);
        log.info('已点击确认卡片:', JSON.stringify({ messageId: card.messageId, btn: btn.text, testid: btn.testid || null }));
        return { found: true, clicked: true, messageId: card.messageId, button: btn };
      }
      // 匹配到确认语义但无按钮（纯文本回复）：交回调用方决策
      return { found: true, clicked: false, card };
    }
    await new Promise((r) => setTimeout(r, C.confirmPollMs));
  }
  return { found: false };
}

/* ---------------- 任务执行器（单会话串行） ---------------- */
function taskError(reason, message) {
  return Object.assign(new Error(message), { reason });
}

let runnerBusy = false;
async function runTask(task) {
  if (runnerBusy) return;
  runnerBusy = true;
  let failure = null;
  let browserBusy = false;
  try {
    // Register before launch so eviction cannot close the window during a task.
    await browserHost.setBusy(accountId, true);
    browserBusy = true;
    task = tasks.beginAttempt(task, accountId);
    const t0 = Date.now();
    state.timings = { start: t0 };
    state.fplayTried = new Set(); // 新任务重新向 fplay 求无水印档
    // 捕获状态按任务隔离：state 属账号级、跨任务复用，上一任务的 lastCapture 若不清，
    // 新任务首轮就会把它当成本次结果交付（串片的另一半来源）
    state.lastCapture = null;
    state.captureTaskId = null;
    state.videoBaseline = new Set();
    state.activeTask = task;
    state.seenIdentities = new Set();
    state.chainDeliverTs = 0;

    const login = await getLoginState();
    if (!login.loggedIn) {
      log.warn('任务秒败：豆包未登录（partition 无会话，需扫码）');
      throw taskError('login_required', '豆包未登录：请在「豆包账号管理」页对该账号扫码登录后重试');
    }

    // 任务类型路由（2026-11-09 生图/文本接入，WOOL 同途径移植）：image → 技能菜单「图像生成」；
    // text → 底栏「对话」纯文本模式；缺省 video → 原视频全流程。三类共用登录态检查、
    // 额度错误口径（/额度已用完/ 触发换号）与单账号串行队列。
    const taskKind = String((task.input && task.input.kind) || 'video').toLowerCase();
    if (taskKind === 'image') {
      await runImageTask(task);
      return;
    }
    if (taskKind === 'text') {
      await runChatTask(task);
      return;
    }

    await ensureChatPage();

    // 僵死检测：闲置页面可能被 Chromium 后台冻结，任务一开始就判死并重载（否则每步 evaluate 挂满 180s）
    // 二次确认防误杀（页面可能只是瞬时忙）
    if (!(await pageAlive(state.page))) {
      await new Promise((r) => setTimeout(r, 8000));
      if (!(await pageAlive(state.page))) {
        const revived = await revivePage(task, '任务开始');
        if (!revived && !(await pageAlive(state.page, 5000))) {
          throw taskError('page_unresponsive', '页面僵死（渲染进程无响应，重载未恢复）。请重启桥服务或检查该账号 Chromium 状态。');
        }
      }
    }

    /* ---- 生成路径：DOM（唯一路径，2026-11-10 收敛） ----
     * 曾有的 protocol 路径（页内 fetch 直提 content_type=2020，零 DOM 交互）经 25 次
     * 真机尝试全部失败（签名/会话路由对不上），已彻底移除——留着只会让维护者误以为
     * 还有第二条路可走。现在的链路：切视频模式 → 填词（必要时补「确认」）→ 发送
     * → chain 主链路捕获 + 探测校验 → DOM 兜底。 */
    let watchConvUrl = ''; // 发送后的会话地址（守望重载时显式导航回该会话）
    state.watchConvUrl = ''; // 镜像到 state：会话扫描按此过滤，防串会话（面板只看任务自己的会话）
    const clickedIds = new Set(); // 已处理过的确认消息
    let confirmSends = 0; // 输入框补发确认的总次数上限（防死循环，2026-11-11 由 2 提到 3）
    const MAX_CONFIRM_SENDS = 3;
    // 2026-11-11 实测：豆包对「带参考图的视频」做**两轮**确认，且第二轮措辞每次不同、
    // 消息里没有任何可点按钮，只能靠输入框回文字：
    //   第 1 轮：「…视频生成参数确认…确认后我再开始生成视频。」→ 回「确认」
    //   第 2 轮：「收到✅，已确认！你接下来是要继续推进视频生成吗？」（另一个会话里是
    //           「…今天日期…还有别的要确认的吗？」）→ 回「确认，开始生成视频」
    // 因此不能靠枚举句式（永远追不上），改为结构化判据：
    //   ① 参数确认句式 → 第 1 轮；② 任意以问号/「吗」结尾的 bot 消息且尚未开始生成 →
    //   第 2 轮候选。两者都由 confirmSends 上限与「未开始生成」双重约束防死循环。
    const STRICT_CONFIRM_RE = /(参数确认|确认后|请确认|是否.*(生成|开始|继续))/;
    // 等用户在面板里手动回复的起点（0 = 未在等）。等人工期间给一次 10 分钟顺延，
    // 否则用户看到提示、想半分钟再打字，任务已经被判 600s 超时。只顺延一次，避免
    // 用户放着不管时任务永不结束。
    let awaitingManualSince = 0;
    let deadlineExtended = false;
    /** 尚未开始生成的判定（用于决定要不要继续催确认）。 */
    const generationStarted = () => state.page.evaluate(() => {
      const txt = (document.body && document.body.innerText) || '';
      if (/正在生成视频|视频生成中|生成中\.\.\.|排队中/.test(txt)) return true;
      if (document.querySelector('video')) return true;
      // 进度条 / 百分比
      if (/进度|%/.test(txt) && /生成/.test(txt)) return true;
      return false;
    }).catch(() => false);

    // DOM 路径（唯一路径）
    {
      // 页面健康时沿用已加载的隐藏窗口；无响应由上方检测与 revivePage 恢复。
      await newConversation();

      // 视频模式（30s 补丁只改写已是视频生成的请求体，模式必须先切对）
      watchConvUrl = '';
      await dismissPromoOverlay();
      const modeOk = await switchToVideoMode();
      if (!modeOk) {
        throw taskError('mode_unconfirmed', '未能确认视频生成模式，本次未发送。请检查豆包页面是否已就绪。');
      }
      tasks.transition(task, 'processing', { phase: 'mode_confirmed' });

      // 把任务里的模型 / 比例真正落到豆包页面上（此前完全不设，全靠默认值）
      await applyVideoControls(task);
      tasks.transition(task, 'processing', { phase: 'parameters_applied' });

      // 时长精确控制（run36 实证）：Seedance bot 从提示词文本解析时长——ability_param.duration 只是
      // 元数据（改写后确认卡仍显示 actionbar 默认值），确认卡与实际生成以文本为准。
      // 任务带 duration 且提示词未显式提及时长时追加「，N秒」。
      let promptText = String(task.input.prompt || '');
      const durHint = Number(task.input.duration) > 0 ? Number(task.input.duration) : 0;
      if (durHint && !/(\d+)\s*秒/.test(promptText)) {
        promptText = promptText + '，' + durHint + '秒';
        tasks.note(task, '提示词追加时长提示「，' + durHint + '秒」（豆包以文本解析时长）');
      }
      // 填词（先填文本——拖图放在填词后，fillPrompt 的清空会移除已拖入附件）
      await fillPrompt(promptText);

      // 参考图（可选）：WOOL 同款拖注入。
      // 2026-11-11 更正：此前认定「视频页只吃首帧 1 张」是错的——实测豆包「视频生成」
      // 支持多图参考（最多 10 张），多的图作为风格/构图参考一并参与。这里恢复逐张上传，
      // 上限与 config.json 的 max_reference_images 对齐。
      const videoRefs = Array.isArray(task.input.reference_images) ? task.input.reference_images : [];
      if (videoRefs.length) {
        let uploadedRefs = 0;
        const failedRefs = [];
        const referenceRoot = String(((task.input && task.input.metadata) || {}).referenceRoot || '');
        for (const ref of videoRefs.slice(0, 10)) {
          const local = await materializeRef(ref, task.id, referenceRoot);
          if (!local) {
            log.warn('参考图落地失败（视频），跳过：', String(ref).slice(0, 60));
            failedRefs.push('landing');
            continue;
          }
          // 逐张容错：单张上传失败（超时/格式）不该让整条视频任务失败，
          // 能传上去几张就用几张。
          try {
            await uploadRef(local);
            uploadedRefs++;
          } catch (e) {
            log.warn('参考图上传失败（视频），跳过：', path.basename(local), e.message);
            failedRefs.push('upload');
          }
        }
        if (uploadedRefs) {
          tasks.note(task, '已上传 ' + uploadedRefs + ' 张参考图' + (failedRefs.length ? '（' + failedRefs.length + ' 张失败已跳过）' : ''));
        } else {
          tasks.note(task, '参考图全部失败，未上传（退化为纯文生视频）');
        }
      } else {
        tasks.note(task, '任务未携带参考图（提示词若依赖参考画面请以图生视频提交）');
      }

      // 串片防线（2026-11-11）：发送前先给页面上「已经存在」的视频拍基线快照。
      // 豆包会话里上一支片子会一直渲染在消息流里，DOM 扫描一撞上就当场判定「捕获完成」——
      // 今天实测出现 5~7 秒"出片"，以及「雪山日出」的片子被交付给「一杯咖啡」任务。
      // 基线里的身份一律不认，之后只接受新增视频。
      const baselineBeforeSend = await snapshotVideoBaseline();
      const beforeSend = await state.page.evaluate(() => ({
        url: location.href,
        n: document.querySelectorAll('[data-message-id]').length,
        text: (() => {
          const el = document.querySelector('[data-testid="chat_input_input"] .ProseMirror, [data-testid="chat_input_input"] [contenteditable="true"], textarea');
          return el ? String(el.innerText || el.value || '').trim() : '';
        })(),
      })).catch(() => null);
      tasks.transition(task, 'processing', { phase: 'references_ready' });

      await clickGenerate();
      state.timings.sentAt = Date.now();
      state.captureTaskId = task.id;
      state.videoBaseline = baselineBeforeSend; // 串片防线生效范围：本任务
      // 缺少回执表示提交未知，禁止再次点击同一提示词。
      for (let attempt = 0; attempt < 1; attempt++) {
        let sentOk = false;
        for (let wait = 0; wait < 4 && !sentOk; wait++) {
          await new Promise((r) => setTimeout(r, 2000));
          try {
            const st = await state.page.evaluate(() => ({
              url: location.href,
              n: document.querySelectorAll('[data-message-id]').length,
              text: (() => {
                const el = document.querySelector('[data-testid="chat_input_input"] .ProseMirror, [data-testid="chat_input_input"] [contenteditable="true"], textarea');
                return el ? String(el.innerText || el.value || '').trim() : null;
              })(),
            }));
            sentOk = Boolean(beforeSend && (st.n > beforeSend.n ||
              (beforeSend.text && st.text === '') ||
              (!/\/chat\/\d+/.test(beforeSend.url) && /\/chat\/\d+/.test(st.url))));
          } catch (e) {}
        }
        if (sentOk) {
          tasks.transition(task, 'processing', { phase: 'accepted', submissionState: 'accepted' });
          log.info('消息已发出（第 ' + (attempt + 1) + ' 次点击）');
          break;
        }
        tasks.note(task, '尚未确认发送回执，保留当前会话继续观察');
      }
      // 记录会话地址：守望重载必须显式导航回会话（豆包对重载中的新会话会重定向回根路径）
      try { watchConvUrl = state.page.url().startsWith('https://www.doubao.com/chat/') ? state.page.url() : watchConvUrl; } catch (e) {}
      state.watchConvUrl = watchConvUrl;

      // 确认推进：豆包 bot 会回「参数确认」文本（WOOL 时代为卡片，现为纯文本消息）。
      // WOOL 原版行为 = 自动发送模块经输入框补发「确认」；卡片按钮点击仅作兼容保留。
      // 防死循环（run24 实证 24 连发）：仅严格确认句式触发 + 全任务上限 3 次——
      // 广谱 WOOL 正则（含 ？/选择）会把 bot 的普通回复误判成确认问题
      const conf = await confirmGeneration({ clickedIds });
      if (conf.found && conf.clicked) {
        tasks.note(task, '已自动点击确认卡片（' + conf.button.text + '）');
      } else if (conf.found && !conf.clicked && conf.card) {
        clickedIds.add(conf.card.messageId);
        if (confirmSends < MAX_CONFIRM_SENDS && STRICT_CONFIRM_RE.test(String(conf.card.text || ''))) {
          confirmSends++;
          tasks.note(task, '参数确认，自动补发「确认」（第 ' + confirmSends + ' 次）: ' + String(conf.card.text).slice(0, 60));
          await fillPrompt('确认');
          await clickGenerate();
        } else {
          // 非参数确认类问句：措辞不可枚举，交给用户（见 sendUserMessage）
          awaitingManualSince = Date.now();
          tasks.note(task, '豆包在等你回复，请在上方「豆包实时对话」面板里直接打字发送。豆包原话: ' + String(conf.card.text).slice(0, 80));
        }
      } else {
        tasks.note(task, '未出现确认卡片（直接生成或纯文本回复）');
      }
    }

    // 捕获窗口：chain 主链路（response 监听器已挂）+ DOM 兜底轮询 + 确认复查（防二次确认）。
    // 视频推送不实时渲染（run30 实证 17 分钟无渲染），靠周期重载拉服务端消息兜底。
    // deadline 可变：等人工确认时顺延一次（见下面的 deadlineExtended）。
    let deadline = Date.now() + C.taskTimeoutMs;
    await new Promise((r) => setTimeout(r, C.baselineDelayMs));
    const loopStart = Date.now();
    let lastReloadAt = Date.now();
    while (Date.now() < deadline) {
      if (task.status === 'completed' || task.status === 'failed') break;
      // 惰性捕获会话地址：发送后豆包异步跳转，此刻 URL 一旦形如 /chat/<id> 就锁定，
      // 之后每次守望重载都显式导航回该会话（根路径拉不到会话的 chain 推送）。
      if (!watchConvUrl) {
        try {
          const m = String(state.page.url()).match(/\/chat\/(\d+)/);
          if (m) { watchConvUrl = 'https://www.doubao.com/chat/' + m[1]; state.watchConvUrl = watchConvUrl; log.info('守望会话地址已锁定:', watchConvUrl); }
        } catch (e) {}
      }
      // 僵死检测：生成期间页面无响应 → 二次确认（视频消息渲染会占主线程 >8s，单次探测会误杀忙页）
      // 确认僵死后：已有捕获立即兜底交付；无捕获重载后继续守望（豆包服务端继续生成，重载后消息渲染可被捕获）
      if (!(await pageAlive(state.page))) {
        await new Promise((r) => setTimeout(r, 10000));
        if (task.status === 'completed' || task.status === 'failed') break;
        if (await pageAlive(state.page)) continue; // 假警报：页面只是忙，已恢复
        if (currentCapture(task)) {
          tasks.note(task, '页面僵死，交付已有捕获（免等恢复）');
          finishTask(task, { video_url: state.lastCapture.url, videos: [state.lastCapture.url], watermark: state.lastCapture.watermark, watermarkReason: state.lastCapture.watermarkReason, via: state.lastCapture.via + ':zombie-fallback' });
          break;
        }
        const revived = await revivePage(task, '捕获循环');
        if (!revived) {
          throw taskError('submission_unknown', '页面僵死（生成期间渲染进程无响应，重载未恢复）。豆包侧可能仍在生成，请先检查原任务。');
        }
        await new Promise((r) => setTimeout(r, 4000));
        continue; // 重载后立即扫描一轮
      }
      await domFallbackScan(task);
      if (task.status !== 'processing') break;
      {
        // 复查新出现的确认（不同 messageId 才处理；严格句式 + 上限防死循环）。
        // timeoutMs 必须 ≥1 个轮询周期：传 1 时 while 条件首轮即过期，循环体一次都不执行（run36 实证卡死）
        const again = await confirmGeneration({ timeoutMs: 2000, clickedIds });
        if (again.found && again.clicked) {
          tasks.note(task, '已自动点击二次确认卡片');
        } else if (again.found && !again.clicked && again.card && !clickedIds.has(again.card.messageId)) {
          clickedIds.add(again.card.messageId);
          if (confirmSends < MAX_CONFIRM_SENDS && STRICT_CONFIRM_RE.test(String(again.card.text || ''))) {
            confirmSends++;
            tasks.note(task, '参数确认，自动补发「确认」（第 ' + confirmSends + ' 次）: ' + String(again.card.text).slice(0, 60));
            await fillPrompt('确认');
            await clickGenerate();
          } else {
            // 非参数确认类问句（豆包多轮确认措辞每次不同）：交给用户手动回复，
            // 并顺延一次超时，给用户输入的时间。
            awaitingManualSince = awaitingManualSince || Date.now();
            tasks.note(task, '豆包在等你回复，请在上方「豆包实时对话」面板里直接打字发送。豆包原话: ' + String(again.card.text).slice(0, 80));
            if (!deadlineExtended) {
              deadlineExtended = true;
              deadline += 10 * 60 * 1000;
              tasks.note(task, '已把本次等待延长 10 分钟（等你手动确认）');
            }
          }
        } else if (awaitingManualSince && (await generationStarted())) {
          // 用户已回复且豆包开始生成：结束等待态，继续正常捕获
          awaitingManualSince = 0;
          tasks.note(task, '已开始生成（人工确认生效）');
        }
      }
      // 缺素材：bot 索要参考图。任务带参考图（注入被豆包编辑器拒绝）→ 转人工协作：
      //   实时小窗已在屏幕上，用户直接拖图进 composer（真实手势豆包必收），bot 随即开始生成；
      //   只提示一次，之后保持守望。任务未带参考图（提示词措辞暗示有图）→ 快速失败给可操作原因。
      {
        const miss = await findMissingInputReply().catch(() => null);
        if (miss) {
          const hasRef = !!(task.input.reference_images && task.input.reference_images.length);
          if (hasRef && !(task.meta && task.meta.humanUploadNoted)) {
            task.meta = task.meta || {};
            task.meta.humanUploadNoted = true;
            tasks.note(task, '豆包未收到自动注入的参考图——请在豆包窗口中手动拖入参考图，拖入后自动继续生成');
            log.warn('图生视频转人工：等待用户在豆包窗口拖入参考图', task.id);
          } else if (!hasRef) {
            throw taskError('missing_reference', '豆包要求先上传画面，但任务未携带参考图。请选中源图以图生视频提交，或使用自包含的文生视频提示词。');
          }
        }
      }
      // 额度耗尽：bot 回「今日视频生成免费额度已用完」→ 视频永不来，快速失败（免空等 20 分钟超时）
      {
        const quota = await findQuotaExhaustedReply().catch(() => null);
        if (quota) {
          throw taskError('quota_exhausted', '豆包视频生成免费额度已用完（每日重置）。请等待额度重置或更换豆包账号。');
        }
        // 限流：快速失败并带「限流」标记，由账号层做一次退避重试（不在同页面重复点击，免双扣额度）
        const rate = await findRateLimitReply().catch(() => null);
        if (rate) {
          throw taskError('rate_limited', '豆包限流（rate limited），请稍后检查原任务。');
        }
      }
      // 提前交付：bot 已宣布「视频生成好了」且 chain 已捕获直链 → 立即交付最优捕获。
      // DOM 模式 chain 只推水印直链（run36/a10838 两任务实证，无水印链永不来），
      // 空等 20 分钟超时纯延迟——生成实际 ~3 分钟完成，宣布完成即交付。
      if (currentCapture(task)) {
        const done = await findVideoDoneReply().catch(() => null);
        if (done) {
          tasks.note(task, 'bot 已宣布生成完成，提前交付捕获（免等无水印链超时）: ' + String(done.text).slice(0, 40));
          finishTask(task, { video_url: state.lastCapture.url, videos: [state.lastCapture.url], watermark: state.lastCapture.watermark, watermarkReason: state.lastCapture.watermarkReason, via: state.lastCapture.via + ':early-deliver' });
          break;
        }
      }
      // DOM 路径存在「视频消息不实时渲染」（run36 服务器实证：生成完毕 30+ 分钟页面无 video 元素，
      // chain 仅推直链）。无捕获且距上次重载超 3 分钟 → 周期重载拉取最终消息，DOM 扫描才能接住成品。
      if (!state.lastCapture && Date.now() - lastReloadAt > 180000) {
        lastReloadAt = Date.now();
        if (watchConvUrl) {
          log.info('DOM 路径周期重载：拉取会话最新消息（视频成品不实时渲染）');
          await state.page.goto(watchConvUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
          await new Promise((r) => setTimeout(r, 4000));
          continue;
        }
        // 会话地址未知：不导航（防清空待发送内容），也不 reload（同因）
        log.info('DOM 守望跳过重载（会话未建立）');
        await new Promise((r) => setTimeout(r, 4000));
        continue;
      }
      // 风控检查：人机验证弹窗盖住页面时永远等不到出片，快速失败交给上层降级重试
      await assertNotBlocked(state.page, '视频轮询');
      // 自适应轮询（P2）：前 3 分钟密集探测（出片通常在 2~4 分钟），之后降频，
      // 20 分钟窗口内从 600 次 evaluate 降到 ~400 次，减少对页面的干扰
      await new Promise((r) => setTimeout(r, Date.now() - loopStart < 180000 ? 2000 : 5000));
    }
    if (task.status === 'processing') {
      // 超时：有带水印捕获则兜底交付，否则失败
      if (currentCapture(task)) {
        tasks.note(task, '超时，交付兜底捕获（可能带水印）');
        finishTask(task, { video_url: state.lastCapture.url, videos: [state.lastCapture.url], watermark: state.lastCapture.watermark, watermarkReason: state.lastCapture.watermarkReason, via: state.lastCapture.via + ':timeout-fallback' });
      } else {
        throw taskError('capture_timeout', '生成超时（' + Math.round(C.taskTimeoutMs / 1000) + 's 内未捕获到视频），请先检查原会话再决定是否重试');
      }
    }
    log.info('task 结束', task.id, task.status, Math.round((Date.now() - t0) / 1000) + 's');
  } catch (e) {
    log.error('task error', e.message);
    if (task.status === 'processing' || task.status === 'queued') {
      if (e.reason === 'quota_exhausted' || e.reason === 'rate_limited') {
        // Explicit upstream rejection is the only post-click evidence permitting another attempt.
        tasks.transition(task, 'processing', { submissionState: 'not_sent' });
      }
      failure = { reason: e.reason || (e.botWall ? 'bot_wall' : 'driver_error'), error: e.message };
    }
  } finally {
    try {
      const proof = state.cleanupProof;
      const match = state.page && /^https:\/\/www\.doubao\.com\/chat\/(\d+)(?:[/?#]|$)/.exec(state.page.url());
      if (proof && proof.submitted && proof.task === task && match && !proof.oldIds.includes(match[1]) &&
          cleanup.settings().enabled && cleanup.resultSaved(task, accountId)) {
        const fingerprint = await conversationChain.load(state.page, match[1], task);
        cleanup.register(task, accountId, match[1], fingerprint);
      }
    } catch (e) { log.warn('会话清理登记失败，保留对话:', e.message); }
    state.cleanupProof = null;
    if (browserBusy) {
      await browserHost.setBusy(accountId, false).catch((e) => log.warn('释放浏览器任务保护失败:', e.message));
    }
    if (state.activeTask === task) state.activeTask = null;
    runnerBusy = false;
    // 任务终态：通知账号管理器（额度标记 + 换号重试 + 全局排队调度）；无 hook 时退回本驱动自泵
    setImmediate(() => {
      try {
        if (hooks.onTaskDone) hooks.onTaskDone(task, failure);
        else {
          if (failure) tasks.transition(task, 'failed', { ...failure, phase: 'failed' });
          pumpQueue();
        }
      } catch (e) { log.error('任务存储或调度失败，停止自动派发:', e.message); }
    });
  }
}

function pumpQueue() {
  if (runnerBusy) return;
  const next = [...tasks._all().values()].find((t) => t.status === 'queued' && (!t.retryAt || t.retryAt <= Date.now()));
  if (next) runTask(next);
}

async function conversationFingerprint(page) {
  const messages = await page.evaluate(() => [...document.querySelectorAll('[data-message-id]')].map((el) => ({
    id: el.getAttribute('data-message-id'), text: (el.innerText || '').trim(),
  })));
  if (!messages.length || messages.some((m) => !m.id)) return '';
  return crypto.createHash('sha256').update(JSON.stringify(messages)).digest('hex');
}

async function cleanConversation(entry) {
  if (runnerBusy || !entry || entry.accountId !== accountId || !cleanup.settings().enabled) return false;
  runnerBusy = true;
  let protectedWindow = false;
  try {
    const task = tasks.get(entry.taskId);
    if (!cleanup.resultSaved(task, accountId) || task.attempt !== entry.attempt) return false;
    await browserHost.setBusy(accountId, true);
    protectedWindow = true;
    const page = await getPage();
    if (!entry.fingerprint.startsWith('chain-v1:')) return false;
    const fingerprint = await conversationChain.load(page, entry.conversationId, task);
    if (!fingerprint || fingerprint !== entry.fingerprint || !cleanup.settings().enabled) return false;
    await page.waitForSelector('[data-message-id]', { timeout: 20000 });
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const renderedFingerprint = await conversationFingerprint(page);
    if (!cleanup.settings().enabled || !renderedFingerprint) return false;
    const row = await page.$(`[data-testid="conversation-list-v2-item"][data-conversation-id="${entry.conversationId}"]`);
    if (!row) return false;
    await row.hover();
    const more = await row.$('[data-testid="chat_list_item_more_button"]');
    if (!more) return false;
    await more.click();
    await new Promise((resolve) => setTimeout(resolve, 500));
    const choices = await page.$$('[role="menuitem"]');
    const deletes = [];
    for (const choice of choices) {
      if (await choice.evaluate((el) => (el.innerText || '').trim().split('\n')[0] === '删除' && !!el.getClientRects().length)) deletes.push(choice);
    }
    if (deletes.length !== 1 || !cleanup.settings().enabled) return false;
    await deletes[0].click();
    await new Promise((resolve) => setTimeout(resolve, 700));
    const confirmations = await page.$$('[role="dialog"] button');
    const matches = [];
    for (const button of confirmations) {
      if (await button.evaluate((el) => /^(删除|确认删除)$/.test((el.innerText || '').trim()) && !!el.getClientRects().length && /确定删除对话/.test(el.closest('[role="dialog"]')?.innerText || ''))) matches.push(button);
    }
    if (matches.length !== 1 || !cleanup.settings().enabled || !cleanup.resultSaved(tasks.get(entry.taskId), accountId)) return false;
    if ((await conversationFingerprint(page)) !== renderedFingerprint || !cleanup.settings().enabled) return false;
    const responsePromise = page.waitForResponse((response) => {
      try {
        const url = new URL(response.url());
        if (url.origin !== 'https://www.doubao.com' || url.pathname !== '/im/conversation/batch_del_user_conv' || response.request().method() !== 'POST') return false;
        const containsId = (value) => value === entry.conversationId || (Array.isArray(value) ? value.some(containsId) : value && typeof value === 'object' && Object.values(value).some(containsId));
        return containsId(JSON.parse(response.request().postData() || '{}'));
      } catch { return false; }
    }, { timeout: 15000 }).catch(() => null);
    await matches[0].click();
    const response = await responsePromise;
    if (!response || !response.ok()) return false;
    const body = await response.json().catch(() => null);
    return !!body && body.status_code === 0;
  } finally {
    if (protectedWindow) await browserHost.setBusy(accountId, false).catch(() => {});
    runnerBusy = false;
  }
}

/** 参考图落地：支持本地路径 / http(s) URL / data URL */
async function materializeRef(ref, taskId, root) {
  const dir = path.join(DATA_DIR, 'refs');
  fs.mkdirSync(dir, { recursive: true });
  // 对象形态（电商策划链路）：{storageKey, name, objectKey}。
  //
  // 桥与客户端同机，凭 objectKey + 后端下发的 referenceRoot 能直接读本地文件，
  // 既不依赖后端端口也不依赖 HTTP。任务 API 明确禁止把图片内嵌进 input
  //（POST /api/tasks → 400 "任务输入不能包含内嵌媒体"），所以这是唯一可行路径。
  if (ref && typeof ref === 'object') {
    const objectKey = String(ref.objectKey || '');
    if (!objectKey || !root) {
      log.warn('参考图对象缺少 objectKey 或 referenceRoot，无法取图:', objectKey ? 'no-root' : 'no-key');
      return null;
    }
    const relative = path.normalize(objectKey).replace(/^([/\\])+/, '');
    const source = path.join(root, relative);
    if (!source.startsWith(path.resolve(root))) {
      log.warn('参考图 objectKey 越界，已拒绝:', objectKey);
      return null;
    }
    if (!fs.existsSync(source)) {
      log.warn('参考图本地文件不存在:', source);
      return null;
    }
    const ext = path.extname(source) || '.png';
    const saved = path.join(dir, taskId + '_ref' + ext);
    fs.copyFileSync(source, saved);
    return saved;
  }
  if (typeof ref === 'string' && ref.startsWith('data:')) {
    const m = ref.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!m) return null;
    const p = path.join(dir, taskId + '.' + m[1]);
    fs.writeFileSync(p, Buffer.from(m[2], 'base64'));
    return p;
  }
  if (typeof ref === 'string' && /^https?:\/\//.test(ref)) {
    const p = path.join(dir, taskId + '_ref');
    const res = await fetch(ref);
    if (!res.ok) { log.warn('参考图下载失败', ref, res.status); return null; }
    fs.writeFileSync(p, Buffer.from(await res.arrayBuffer()));
    return p;
  }
  return typeof ref === 'string' ? ref : null;
}

  /* 只断开 CDP 附加，绝不 browser.close()——宿主 Chromium 就是桌面客户端本体
   * （embed 迁移后桥挂的是应用内置浏览器），close 会发 Browser.close 让整个客户端
   * 崩溃退出（2026-11-09 事故：移除账号即杀宿主）。账号窗口由桌面端轮询注册表后
   * 自行销毁（main.js doubaoWindowPoll），桥侧无需代劳。 */
  function detach() {
    try {
      if (state.browser && state.browser.connected) state.browser.disconnect();
    } catch (e) {
      log.warn('detach fail:', e.message);
    }
    state.browser = null;
    state.page = null;
  }

  /**
 * 人工接手：把用户输入的文字发进豆包会话（不动任务状态机，也不改模式）。
 * 场景：豆包多轮确认的措辞不可枚举、且消息里没有可点按钮，第二轮回复权交给用户
 * ——面板给输入框，用户自己打字，这里只负责填词 + 点发送。任务捕获循环照常接管。
 */
async function sendUserMessage(text, expectedTask) {
  const ensureCurrent = () => {
    if (!expectedTask || state.activeTask !== expectedTask || expectedTask.status !== 'processing' || tasks.get(expectedTask.id) !== expectedTask) {
      throw Object.assign(new Error('任务已切换，未发送回复'), { status: 409 });
    }
  };
  ensureCurrent();
  const t = String(text || '').trim();
  if (!t) throw new Error('内容为空');
  const page = state.page;
  if (!page) throw new Error('豆包页面未就绪（可能尚未拉起浏览器）');
  if (!(await pageAlive(page, 5000))) {
    throw Object.assign(new Error('豆包页面暂时不可用，请稍后重试'), { status: 503 });
  }
  ensureCurrent();
  await fillPrompt(t);
  ensureCurrent();
  await clickGenerate();
  log.info('[manual] 已发送用户回复');
  if (state.activeTask) tasks.note(state.activeTask, '你在实时对话里发了「' + t.slice(0, 40) + '」');
  return { sent: true, text: t, at: Date.now() };
}

return {
    accountId,
    launch,
    detach,
    touchBrowser,
    getPage,
    ensureChatPage,
    getLoginState,
    captureLoginQr,
    runTask,
    cleanConversation,
    pumpQueue,
    switchToVideoMode,
    scanConversation,
    confirmGeneration,
    findConfirmCard,
    sendUserMessage,
    state,
    isBusy: () => runnerBusy,
  };
}

module.exports = { createDriver };
