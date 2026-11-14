'use strict';
/* doubao-bridge HTTP API —— dola-pool 协议形态（yingce.plugin/v2 可直接对接）
 *   GET  /healthz
 *   GET  /v1/models
 *   GET  /session                      桥扩展：登录态查询
 *   POST /v1/videos/generations        {model, prompt, duration, ratio|size, reference_images}
 *   GET  /v1/videos/{task_id}          查询（dola-pool 轮询路径）
 *   GET  /v1/videos/{task_id}/content  视频内容（代理直链）
 *   POST /v1/images/generations        {model, prompt, reference_images} → {data:[{url}]}（同步 ≤180s）
 *   POST /v1/chat/completions          {model, messages, instructions} → {choices:[...]}（同步 ≤180s）
 */
const http = require('http');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const log = require('./log')('server');
const tasks = require('./tasks');
const accounts = require('./accounts');
const conversationCleanup = require('./conversation-cleanup');
const patch30 = require('./patch30');
const { conversationTarget } = require('./conversation-target');
const { dataDir: DATA_DIR } = require('./runtime-paths');

/* ---------------- CORS 收紧（2026-11-10 审计） ----------------
 * 旧实现无条件写 Access-Control-Allow-Origin: *。本桥监听 127.0.0.1 且接口免凭据
 * （/conversation、/session 曾完全裸奔），任意网站在用户浏览器里 fetch 本机端口即可
 * 跨源读走豆包会话全文。loopback + ACAO * 是同源策略的空门，浏览器不设防。
 * 现改为 Origin 白名单：只放行本机回环页面（应用内置 web-dist 的 127.0.0.1:<随机端口>）。
 * 非浏览器客户端（curl / 后端 Go / Electron 主进程）不带 Origin → 不发 CORS 头，
 * 不受影响（CORS 只约束浏览器跨源读）。 */
/** 生成张数：默认 1、上限 5（豆包单次最多稳定给 5 张）。 */
const IMAGE_COUNT_MAX = 5;
function clampCount(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, IMAGE_COUNT_MAX);
}

/**
 * 把张数要求写进提示词（用户口径：一句话就够 —— 「请生成N张」）。
 *
 * 为什么只能走提示词：豆包网页「图像生成」没有张数控件（只有模型/比例），
 * 唯一能影响张数的是那句话。张数为 1 时不改提示词，不打扰默认路径。
 */
function withCountInstruction(prompt, count) {
  const text = String(prompt || '').trim();
  if (count <= 1) return text;
  return text + '，请生成' + count + '张';
}

function originAllowed(origin) {
  if (!origin) return false;
  if (process.env.BRIDGE_ALLOWED_ORIGIN) return origin === process.env.BRIDGE_ALLOWED_ORIGIN;
  try {
    const u = new URL(origin);
    // 只认回环地址的 http(s) 页面：应用 UI、本地调试页
    const host = u.hostname;
    return (host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1') &&
      (u.protocol === 'http:' || u.protocol === 'https:');
  } catch (e) { return false; }
}

/** 统一在入口挂 CORS 头：res.setHeader 不影响后续各 handler 的 writeHead 合并 */
function applyCors(req, res) {
  const origin = req.headers.origin;
  res.setHeader('Vary', 'Origin');
  if (originAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Range');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
  }
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (e) { throw new Error('请求体不是合法 JSON'); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 视频时长档位（2026-11-11 修正）：豆包「视频生成」页的 actionbar 只摆 4s/10s/15s
 * 三个按钮，但实际生成时长由**提示词文本 + ability_param.duration** 决定，4~15 秒
 * 连续可取。所以配置里用 duration_range 表达真实能力，durations 仅作兼容输出
 * （由 range 展开，老调用方仍然能拿到数组）。 */
function durationRange(m) {
  const r = m && m.duration_range;
  if (!r) return null;
  const min = Number(r.min), max = Number(r.max), step = Number(r.step) || 1;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return null;
  return { min, max, step };
}
function modelDurations(m) {
  const r = durationRange(m);
  if (r) {
    const out = [];
    for (let d = r.min; d <= r.max; d += r.step) out.push(d);
    return out;
  }
  return Array.isArray(m && m.durations) ? m.durations : undefined;
}

/** 同步端点共用：内部建任务 → 额度路由派发 → 挂住 HTTP 等终态（网页自动化慢于直连
 * API，上限 180s）。超时不改任务状态——驱动可能仍在跑，结束后任务记录自然落终态，
 * 调用方拿 504 即可（OpenAI 网关超时同语义）。 */
async function runSyncTask(input, timeoutMs = 180000) {
  let task = tasks.create(input);
  accounts.dispatch(task);
  const deadline = Date.now() + timeoutMs;
  while ((task.status === 'queued' || task.status === 'processing') && Date.now() < deadline) {
    await sleep(800);
    task = tasks.get(task.id);
  }
  return task;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  applyCors(req, res);
  // 账号定位：?account= 指定，缺省取首个可用账号（/debug、/login、/session 等运维端点共用）
  const acct = accounts.get(url.searchParams.get('account')) || accounts.first();
  const drv = acct ? acct.driver : null;
  try {
    // 无账号兜底：仅放行不依赖驱动的端点，其余 503（账号全删/注册表异常时不至于裸崩）
    if (!drv && !['/healthz', '/', '/v1/models'].includes(p) && !p.startsWith('/admin') && !p.startsWith('/v1/videos') && !p.startsWith('/v1/images') && !p.startsWith('/v1/chat')) {
      return json(res, 503, { detail: '无可用豆包账号：请在 /admin 扫码添加' });
    }
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

    // API 鉴权：/v1/* 需要 Bearer token（8781 对公网开放后防陌生人烧额度/刷任务）
    // 2026-11-10 审计：/conversation 与 /session 曾是鉴权空洞——前者返回豆包会话全文
    // （用户 prompt + bot 回复 + conversationId），后者泄露登录态；loopback + ACAO:* 下
    // 任意网站可跨源读取。两个端点已有全部调用方带 Bearer（web 面板 / 桌面端），直接并入。
    const needsAuth = p.startsWith('/v1/') || p === '/conversation' || p === '/conversation/send' || p === '/session';
    if (needsAuth) {
      const bearer = String(req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
      // EventSource 无法带自定义 header，只有 /v1/events 额外接受 ?token=。
      // 仅这一个端点放开：它只读、且订阅者能收到的就是任务状态（不外泄 prompt 全文之外的
      // 东西），与 /admin 现有的 ?token= 口径一致。其余 /v1/* 仍强制 Bearer。
      const queryToken = p === '/v1/events' ? String((url.searchParams.get('token') || '')) : '';
      const presented = bearer || queryToken;
      if (!config.adminToken || presented !== config.adminToken) {
        // 审计：此日志过去打印 token 前 24 字符，而桥 token 恰好 24 字符（randomBytes(12).hex）
        // → 一次带错 token 的请求就把完整凭据写进日志。改为只记长度与是否存在。
        log.warn('[auth] 401:', p, 'tokenLen=', presented ? presented.length : 0,
          'hasAuth=', Boolean(req.headers['authorization']), 'hasQuery=', Boolean(queryToken), 'hasApiKey=', Boolean(req.headers['x-api-key']));
        return json(res, 401, { detail: '需要 API token（Authorization: Bearer <token>，/v1/events 亦可用 ?token=）' });
      }
    }

    if (req.method === 'GET' && (p === '/healthz' || p === '/')) {
      return json(res, 200, { ok: true, service: 'doubao-bridge', instanceId: process.env.BRIDGE_INSTANCE_ID || null,
        loginNeeded: !accounts.list().some((a) => !a.disabled && !a.pendingLogin),
        version: '1.0.0', patch30: config.patch30.enabled, target: patch30.TARGET_MODEL + '@' + patch30.TARGET_DURATION + 's' });
    }

    if (req.method === 'GET' && p === '/v1/models') {
      // durations 依旧输出（老调用方按数组取档位）；另给 duration_range 说明它其实是
      // 4~15 秒连续区间（2026-11-11 实测：豆包按时长文本解析，非固定档位）。
      return json(res, 200, {
        object: 'list',
        data: config.models.map((m) => ({
          id: m.id, label: m.label, capabilities: m.capabilities,
          durations: modelDurations(m), default_duration: m.default_duration,
          duration_range: m.duration_range || null,
          ratios: m.ratios, supports_reference_images: m.supports_reference_images,
        })),
      });
    }

    // 事件推送（SSE）：替代前端轮询的架构改善第一步。
    // 之前客户端靠定时轮询（任务 3 秒 / 会话 2 秒 / 窗口 1 秒）感知状态：
    // 空闲时空转，任务期间有最多 3 秒延迟。这里把任务生命周期事件直接推给订阅者，
    // 轮询路径保留（向后兼容），订阅方可以逐步切换。
    if (req.method === 'GET' && p === '/v1/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      const send = (payload) => {
        try { res.write('data: ' + JSON.stringify(payload) + '\n\n'); } catch (e) { /* 客户端已断开 */ }
      };
      // 首帧快照：让订阅方不用先查一次再订阅
      send({ type: 'snapshot', tasks: [...tasks._all().values()].sort((a, b) => b.created_at - a.created_at).slice(0, 20).map(tasks.toRow) });
      const off = tasks.subscribe((event) => send(event));
      // 心跳：代理/系统可能静默断开长连接，15 秒一次注释行保活
      const beat = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, 15000);
      const cleanup = () => { clearInterval(beat); off(); };
      req.on('close', cleanup);
      req.on('error', cleanup);
      return; // SSE 长连接：不结束响应
    }

    if (req.method === 'GET' && p === '/v1/tasks') {
      const rows = [...tasks._all().values()]
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, 20)
        // note：最后一条进度，面板用它显示「正在上传参考图 / 参数确认中 / 丢弃串片…」
        .map(tasks.toRow);
      return json(res, 200, { object: 'list', data: rows });
    }

    // 一键重试（P1）：失败后不用重新填参数。克隆失败任务的 input 重新入队，
    // 参考图等输入原样带走；只允许终态任务重试，防重复派发白白消耗额度。
    if (req.method === 'POST' && /^\/v1\/tasks\/[^/]+\/retry$/.test(p)) {
      const srcId = p.split('/')[3];
      const src = tasks._all().get(srcId);
      if (!src) return json(res, 404, { detail: '任务不存在: ' + srcId });
      if (src.status === 'queued' || src.status === 'processing') {
        return json(res, 409, { detail: '任务仍在进行中（' + src.status + '），无需重试' });
      }
      const t = tasks.create({ ...JSON.parse(JSON.stringify(src.input || {})), retryOf: srcId });
      tasks.note(t, '由失败任务 ' + srcId + ' 重试创建');
      log.info('任务重试:', srcId, '→', t.id);
      const kind = String((t.input && t.input.kind) || 'video').toLowerCase();
      if (kind === 'video' || kind === 'image' || kind === 'text') accounts.dispatch(t); // 额度感知路由：无可派账号时自动留队
      return json(res, 200, { id: t.id, status: t.status });
    }

    if (req.method === 'GET' && p === '/conversation') {
      try {
        const args = [tasks, accounts, url.searchParams.get('taskId'), url.searchParams.get('account'), Number(url.searchParams.get('attempt'))];
        const { task, driver } = conversationTarget(...args);
        const st = await driver.scanConversation();
        conversationTarget(...args);
        return json(res, 200, { ...st, taskId: task.id, accountId: task.accountId, attempt: task.attempt });
      } catch (e) { return json(res, e.status || 502, { detail: e.message }); }
    }

    // 选择器健康自检（P3）：豆包改版是这套自动化最大的外部风险，而失败时日志里
    // 只有一句「找不到入口」。这里把页面关键锚点一次性体检出来，改版后先看这张表：
    //   缺 composer  → 输入引擎结构变了（填词/发送全废）
    //   缺 actionbar → 技能模式没切上（视频/生图参数栏不存在）
    //   技能按钮为 0 → skill bar 改版（切模式全废）
    // 顺带把最近的失败截图列出来，方便对照。
    if (req.method === 'GET' && p === '/admin/api/selectors/health') {
      // 注意：本分支位于 /admin/api 统一闸门之前，必须自己鉴权，
      // 否则会把当前页面 URL / 消息数裸奔给任意跨源请求。
      if (!adminAuthed()) return json(res, 401, { detail: '需要 admin token（config.adminToken，?token= 或 Bearer）' });
      let target = drv;
      let activeId = null;
      try {
        for (const a of accounts.list()) {
          const at = a.driver && a.driver.state ? a.driver.state.activeTask : null;
          if (at && (at.status === 'processing' || at.status === 'queued')) { target = a.driver; activeId = a.id; break; }
        }
      } catch (e) {}
      // getPage() 是 async（内部会 await launch），必须 await，否则拿到 Promise
      let page = null;
      try {
        page = target && target.getPage ? await target.getPage() : null;
      } catch (e) {
        return json(res, 503, { ok: false, detail: '豆包页面尚未就绪：' + e.message });
      }
      if (!page) return json(res, 503, { ok: false, detail: '豆包页面尚未打开（先发起一个任务或访问桥管理页预热）' });
      const checks = await page.evaluate(() => {
        const visible = (el) => el && (el.offsetParent !== null || el.getClientRects().length > 0);
        const q = (sel) => document.querySelectorAll(sel).length;
        return {
          url: location.href,
          composer: q('[data-testid="chat_input_input"], textarea, [contenteditable="true"]'),
          skillBarButtons: q('[data-testid^="skill_bar_button"]'),
          actionbarControls: q('[data-input-engine-actionbar-control-key]'),
          actionbarKeys: [...document.querySelectorAll('[data-input-engine-actionbar-control-key]')]
            .map((x) => x.getAttribute('data-input-engine-actionbar-control-key')).filter(Boolean),
          messages: q('[data-message-id]'),
          videos: q('video'),
          sendButtons: [...document.querySelectorAll('button, [role="button"]')].filter((b) => visible(b) && /发送|生成/.test(b.innerText || '')).length,
        };
      }).catch((e) => ({ error: e.message }));
      const verdict = [];
      if (!checks || checks.error) verdict.push({ level: 'error', text: '页面无法读取：' + String(checks && checks.error) });
      else {
        if (!checks.composer) verdict.push({ level: 'error', text: '输入框锚点丢失（data-testid=chat_input_input / textarea / contenteditable 全部未命中）——填词与发送会全废' });
        if (!checks.skillBarButtons) verdict.push({ level: 'error', text: 'skill bar 按钮为 0（data-testid^=skill_bar_button）——技能模式切换会全废' });
        if (!checks.actionbarControls) verdict.push({ level: 'warn', text: 'actionbar 控件为 0——当前不在视频/生图模式（空闲时正常，任务中则是切换失败）' });
        if (!verdict.length) verdict.push({ level: 'ok', text: '关键锚点齐全' });
      }
      let shots = [];
      try {
        const dir = path.join(DATA_DIR, 'shots');
        if (fs.existsSync(dir)) shots = fs.readdirSync(dir).sort().slice(-10);
      } catch (e) {}
      return json(res, 200, { ok: true, account: activeId, checks, verdict, shots });
    }

    // 人工接手：把用户在「豆包实时对话」面板里输入的文字发进豆包会话。
    // 存在的理由（2026-11-11 实测）：豆包对带参考图的视频请求做多轮确认，第二轮措辞
    // 每次不同（「你接下来是要继续推进视频生成吗？」/「还有别的要确认的吗？」…）且消息里
    // 没有任何可点按钮。枚举句式永远追不上，因此第二轮的回复权交给用户：面板给输入框，
    // 用户看到豆包在等确认时自己打字发进去，自动化继续接管捕获。
    if (req.method === 'POST' && p === '/conversation/send') {
      const body = await readBody(req);
      const text = String((body && body.text) || '').trim();
      if (!text) return json(res, 400, { detail: 'text 不能为空' });
      if (text.length > 2000) return json(res, 400, { detail: 'text 过长（上限 2000 字）' });
      try {
        const { task, driver } = conversationTarget(tasks, accounts, body.taskId, body.account, body.attempt);
        const r = await driver.sendUserMessage(text, task);
        log.info('[manual] 用户手动发送成功');
        return json(res, 200, r);
      } catch (e) {
        log.warn('[manual] 用户手动发送失败:', e.message);
        return json(res, e.status || 502, { detail: e.message });
      }
    }

    if (req.method === 'GET' && p === '/session') {
      const s = await drv.getLoginState().catch((e) => ({ loggedIn: false, error: e.message }));
      return json(res, 200, Object.assign({ hint: '未登录时请在本页扫描客户端显示的豆包二维码；浏览器页面始终隐藏。' }, s));
    }

    // ---- 扫码中继登录（页面始终由客户端隐藏 Chromium 承载）----
    if (req.method === 'GET' && p === '/login/qr.png') {
      // 二维码一律要求 admin token（2026-11-08 审计）：响应带 ACAO *，免 token 时任意
      // 网页可 <img>/fetch 取二维码展示给受害者扫码 → 桥窗口被登进受害者账号（钓鱼面）。
      const tok = url.searchParams.get('token') || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!config.adminToken || tok !== config.adminToken) return json(res, 401, { detail: '需要 admin token' });
      const r = await drv.captureLoginQr().catch((e) => ({ error: e.message }));
      if (r.error) return json(res, 502, { detail: r.error });
      if (r.loggedIn) return json(res, 409, { detail: '已登录，无需扫码', loggedIn: true });
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
      return res.end(r.png);
    }

    if (req.method === 'GET' && p === '/login/status') {
      // 登录态查询与 markLoggedIn 副作用同样要求 token（审计同上；管理页/插件页均带 token 轮询）
      const tok = url.searchParams.get('token') || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!config.adminToken || tok !== config.adminToken) return json(res, 401, { detail: '需要 admin token' });
      const s = await drv.getLoginState().catch((e) => ({ loggedIn: false, error: e.message }));
      if (s.loggedIn) accounts.markLoggedIn(drv.accountId); // 新账号扫码完成 → 加入任务路由
      return json(res, 200, s);
    }

    /* ---- /admin 多账号管理页（token 鉴权：8781 公网开放，防陌生人扫码/删号） ---- */
    function adminAuthed() {
      const tok = url.searchParams.get('token') || (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
      return config.adminToken && tok === config.adminToken;
    }

    if (p === '/admin' || p.startsWith('/admin/api/')) {
      if (!adminAuthed()) return json(res, 401, { detail: '需要 admin token（config.adminToken，?token= 或 Bearer）' });
      if (req.method === 'GET' && p === '/admin') {
        const html = '<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
          + '<title>豆包账号池 · doubao-bridge</title><style>'
          + 'body{font-family:system-ui,sans-serif;background:#0f1117;color:#e8eaf0;margin:0;padding:32px}'
          + 'h1{font-size:20px;margin:0 0 4px}p.sub{color:#9aa0b0;font-size:13px;margin:0 0 24px}'
          + '.acc{background:#1a1d27;border-radius:12px;padding:16px 20px;margin-bottom:12px;display:flex;align-items:center;gap:14px;flex-wrap:wrap}'
          + '.lb{font-size:15px;font-weight:600;min-width:90px}.id{color:#9aa0b0;font-size:12px;font-family:monospace}'
          + '.tag{font-size:12px;padding:4px 10px;border-radius:999px}'
          + '.ok{background:#0e3b2e;color:#4ade80}.off{background:#232838;color:#9aa0b0}.warn{background:#3b2e0e;color:#fbbf24}.busy{background:#0e2b3b;color:#38bdf8}'
          + 'button{background:#2563eb;color:#fff;border:0;border-radius:8px;padding:8px 16px;font-size:13px;cursor:pointer;margin-left:auto}'
          + 'button.del{background:#3b0e0e;color:#f87171}button:disabled{opacity:.4;cursor:not-allowed}'
          + '#addbar{margin:24px 0}#qrbox{margin-top:20px;text-align:center;display:none}'
          + '#qr{width:240px;height:240px;border-radius:12px;background:#fff;object-fit:contain}'
          + '#qrstate{margin-top:10px;font-size:13px;color:#9aa0b0}'
          + '</style></head><body><h1>豆包账号池</h1><p class="sub">添加账号后客户端在隐藏 Chromium 页面中生成二维码；手机豆包 App 扫码即入池，浏览器页面不会显示。</p>'
          + '<div id="list"></div>'
          + '<div id="addbar"><button id="add">＋ 添加账号（扫码）</button></div>'
          + '<div id="qrbox"><img id="qr" alt="登录二维码"><div id="qrstate">等待扫码…</div></div><script>'
          + 'const T=new URLSearchParams(location.search).get("token")||"";'
          + 'const api=(p,o)=>fetch(p+(p.includes("?")?"&":"?")+"token="+T,o).then(r=>r.json());'
          + 'function tag(cls,txt){return \'<span class="tag \'+cls+\'">\'+txt+\'</span>\'}'
          + 'async function refresh(){const list=await api("/admin/api/accounts");'
          + 'document.getElementById("list").innerHTML=(list.accounts||[]).map(a=>{'
          + 'let st=a.loggedIn?(a.busy?tag("busy","生成中"):tag("ok","已登录")):tag("warn",a.pendingLogin?"待扫码":"未登录");'
          + 'if(a.quotaExhausted)st+=tag("off","今日额度耗尽");'
          + 'return \'<div class="acc"><span class="lb">\'+a.label+\'</span><span class="id">\'+a.id+\'</span>\'+st'
          + '+\'<button class="del" onclick="del(\\\'\'+a.id+\'\\\')" \'+(a.busy?"disabled":"")+\'>移除</button></div>\'}).join("");}'
          + 'window.del=async(id)=>{if(!confirm("移除该账号？（账号会话数据保留，可重新添加）"))return;await api("/admin/api/accounts/"+id,{method:"DELETE"});refresh();};'
          + 'document.getElementById("add").onclick=async()=>{'
          + 'const r=await api("/admin/api/accounts",{method:"POST"});'
          + 'if(r.error){alert("添加失败: "+r.error);return;}'
          + 'const box=document.getElementById("qrbox");box.style.display="block";'
          + 'const qr=document.getElementById("qr"),st=document.getElementById("qrstate");'
          + 'const reload=()=>{qr.src="/login/qr.png?account="+r.id+"&token="+T+"&t="+Date.now();};'
          + 'qr.onerror=()=>{st.textContent="二维码获取失败，5 秒后重试…";setTimeout(reload,5000);};reload();'
          + 'const iv=setInterval(reload,90000);' // 二维码过期前轮换
          + 'const poll=setInterval(async()=>{try{'
          + 'const s=await(await fetch("/login/status?account="+r.id+"&token="+T)).json();'
          + 'if(s.loggedIn){clearInterval(poll);clearInterval(iv);st.textContent="✓ 登录成功，已加入额度池";refresh();}'
          + '}catch(e){}},3000);};'
          + 'refresh();setInterval(refresh,15000);'
          + '</script></body></html>';
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(html);
      }
      // 账号列表（含登录态，按需创建隐藏 Chromium 页面）
      if (req.method === 'GET' && p === '/admin/api/conversation-cleanup') {
        return json(res, 200, conversationCleanup.settings());
      }
      if (req.method === 'PUT' && p === '/admin/api/conversation-cleanup') {
        const body = await readBody(req);
        if (typeof body.enabled !== 'boolean') return json(res, 400, { detail: 'enabled 必须是布尔值' });
        return json(res, 200, conversationCleanup.configure(body.enabled));
      }
      if (req.method === 'GET' && p === '/admin/api/accounts') {
        const rows = [];
        for (const a of accounts.list()) rows.push(await accounts.accountState(a.id).catch(() => null));
        return json(res, 200, { accounts: rows.filter(Boolean) });
      }
      // 新增账号（待扫码）
      if (req.method === 'POST' && p === '/admin/api/accounts') {
        const rec = accounts.addAccount();
        return json(res, 200, { id: rec.id, label: rec.label, pendingLogin: true });
      }
      const mDel = p.match(/^\/admin\/api\/accounts\/(acct\d+)$/);
      if (req.method === 'DELETE' && mDel) {
        return json(res, 200, accounts.removeAccount(mDel[1]));
      }
      return json(res, 404, { detail: '未知 /admin 路径' });
    }

    if (req.method === 'POST' && p === '/v1/videos/generations') {
      const body = await readBody(req);
      const errors = [];
      if (!body.model) errors.push('model 必填（见 GET /v1/models）');
      if (!body.prompt || !String(body.prompt).trim()) errors.push('prompt 必填');
      const dur = parseInt(body.duration, 10);
      if (!Number.isFinite(dur) || dur <= 0) errors.push('duration 必须为大于 0 的整数');
      if (errors.length) return json(res, 400, { detail: errors.join('; ') });
      const model = config.models.find((m) => m.id === body.model);
      if (!model) return json(res, 400, { detail: '未知模型: ' + body.model });
      if (config.patch30.enabled) {
        // patch30 开启时 duration 由请求体补丁强制，接受任意正整数
      } else {
        const r = durationRange(model);
        const allowed = r
          ? (dur >= r.min && dur <= r.max && (dur - r.min) % r.step === 0)
          : (Array.isArray(model.durations) && model.durations.includes(dur));
        if (!allowed) {
          const hint = r ? `${r.min}~${r.max} 秒（步长 ${r.step}）` : (model.durations || []).join('/') + ' 秒';
          return json(res, 400, { detail: `duration ${dur} 超出 ${model.id} 的可用范围：${hint}` });
        }
      }
      // 参考图仅接受 data URL（审计：materializeRef 的 http 分支会让 token 持有者把桥
      // 当 SSRF 跳板探测内网；声明式插件 requirePublicMediaUrls=false 本就内联 data URL）
      const rawRefs = Array.isArray(body.reference_images) ? body.reference_images : [];
      if (rawRefs.some((r) => typeof r !== 'string' || !/^data:image\//i.test(r))) {
        return json(res, 400, { detail: 'reference_images 必须是 data:image/...;base64 内联数据（不接受远程地址）' });
      }
      const refs = rawRefs.slice(0, model.max_reference_images);
      const task = tasks.create({
        model: body.model, prompt: String(body.prompt), duration: dur,
        ratio: body.ratio || body.size || null,
        reference_images: refs,
        metadata: { nodeId: typeof body.metadata?.nodeId === 'string' ? body.metadata.nodeId : null },
        providerOptions: body.providerOptions || null,
      });
      accounts.dispatch(task); // 额度感知路由：挑可用账号派发（全忙留队自动泵）
      return json(res, 200, { id: task.id, status: task.status, created_at: task.created_at, detail: '' });
    }

    // ---- 同步端点（OpenAI 形态）：生图 / 文本对话，内部走同一任务池与额度路由 ----
    if (req.method === 'POST' && p === '/v1/images/generations') {
      const body = await readBody(req);
      const errors = [];
      if (!body.model) errors.push('model 必填（见 GET /v1/models）');
      if (!body.prompt || !String(body.prompt).trim()) errors.push('prompt 必填');
      if (errors.length) return json(res, 400, { detail: errors.join('; ') });
      const model = config.models.find((m) => m.id === body.model);
      if (!model || !(model.capabilities || []).includes('image')) {
        return json(res, 400, { detail: '模型不支持图像生成: ' + body.model });
      }
      // 参考图口径与视频一致：仅 data URL（防把桥当 SSRF 跳板探测内网）
      const rawRefs = Array.isArray(body.reference_images) ? body.reference_images : [];
      if (rawRefs.some((r) => typeof r !== 'string' || !/^data:image\//i.test(r))) {
        return json(res, 400, { detail: 'reference_images 必须是 data:image/...;base64 内联数据（不接受远程地址）' });
      }
      const refs = rawRefs.slice(0, model.max_reference_images || 0);
      // 生成张数（2026-11-12）：OpenAI 兼容调用方用 n；画布侧走 config.count 由后端转成 n。
      // 默认 1、上限 5。豆包网页没有"张数"控件，只能靠提示词要求——所以把数量写成
      // 一句强制指令拼在提示词末尾（用户可见于豆包会话，失败时也好排查）。
      const count = clampCount(body.n ?? body.count);
      const task = await runSyncTask({
        kind: 'image', model: body.model, prompt: withCountInstruction(String(body.prompt), count),
        ratio: body.ratio || body.size || null,
        reference_images: refs,
        count,
        metadata: { nodeId: typeof body.metadata?.nodeId === 'string' ? body.metadata.nodeId : null },
        providerOptions: body.providerOptions || null,
      });
      if (task.status === 'queued' || task.status === 'processing') {
        return json(res, 504, { reason: 'sync_wait_timeout', task_id: task.id, status: task.status,
          detail: '同步等待超时：任务仍在执行，请查询原任务，避免重复提交' });
      }
      if (task.status !== 'completed' || !task.result || !(task.result.imageFiles || []).length) {
        return json(res, 502, { detail: task.error || '生图失败：页面未返回图片' });
      }
      // 落盘字节按需读回并转 data URL（2026-11-10：结果已外置，不再常驻内存/任务存档）
      const urls = await tasks.imageDataUrls(task);
      if (!urls.length) return json(res, 502, { detail: '生成图片读取失败（data/images 缺失或被清理）' });
      return json(res, 200, {
        created: Math.floor(task.updated_at / 1000),
        data: urls.map((u) => ({ url: u })), // data URL（桥侧已带 Referer 下载转内联）
      });
    }

    if (req.method === 'POST' && p === '/v1/chat/completions') {
      const body = await readBody(req);
      if (!body.model) return json(res, 400, { detail: 'model 必填（见 GET /v1/models）' });
      const model = config.models.find((m) => m.id === body.model);
      if (!model || !(model.capabilities || []).includes('text')) {
        return json(res, 400, { detail: '模型不支持文本对话: ' + body.model });
      }
      const msgs = Array.isArray(body.messages) ? body.messages : [];
      const sys = msgs.filter((m) => m && m.role === 'system').map((m) => String(m.content || '')).filter(Boolean);
      const lastUser = [...msgs].reverse().find((m) => m && m.role === 'user');
      const userText = lastUser && typeof lastUser.content === 'string' ? lastUser.content
        : lastUser && Array.isArray(lastUser.content)
          ? lastUser.content.filter((c) => c && c.type === 'text').map((c) => c.text || '').join('\n')
          : '';
      if (!userText.trim()) return json(res, 400, { detail: 'messages 需包含至少一条非空 user 消息' });
      const task = await runSyncTask({
        kind: 'text', model: body.model, prompt: userText,
        messages: msgs, instructions: sys.join('\n') || null,
        providerOptions: body.providerOptions || null,
      });
      if (task.status === 'queued' || task.status === 'processing') {
        return json(res, 504, { reason: 'sync_wait_timeout', task_id: task.id, status: task.status,
          detail: '同步等待超时：任务仍在执行，请查询原任务，避免重复提交' });
      }
      if (task.status !== 'completed' || !task.result || !String(task.result.text || '').trim()) {
        return json(res, 502, { detail: task.error || '对话失败：页面未返回文本' });
      }
      const text = task.result.text;
      return json(res, 200, {
        id: 'chatcmpl-' + task.id,
        object: 'chat.completion',
        created: Math.floor(task.updated_at / 1000),
        model: body.model,
        choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
        usage: { // 网页驱动拿不到真实 token 数，按中英混合粗估（~2 字符/token）
          prompt_tokens: Math.ceil(userText.length / 2),
          completion_tokens: Math.ceil(text.length / 2),
          total_tokens: Math.ceil((userText.length + text.length) / 2),
        },
      });
    }

    const mPoll = p.match(/^\/v1\/videos\/([^/]+)$/);
    if (req.method === 'GET' && mPoll) {
      const t = tasks.get(mPoll[1]);
      if (!t) return json(res, 404, { detail: '任务不存在或已过期（按 API Key/会话隔离，请确认 task id）' });
      const j = tasks.toPollJson(t);
      // 生图结果外置后，轮询端点按需读回（视频/文本不受影响）
      if (j.kind === 'image' && j.images && !j.images.length) j.images = await tasks.imageDataUrls(t);
      return json(res, 200, j);
    }

    // 桥扩展：取消/失败一个任务（解锁串行队列）
    const mCancel = p.match(/^\/v1\/videos\/([^/]+)\/cancel$/);
    if (req.method === 'POST' && mCancel) {
      const t = tasks.get(mCancel[1]);
      if (!t) return json(res, 404, { detail: '任务不存在' });
      if (t.status === 'completed') return json(res, 409, { detail: '任务已完成，无需取消' });
      tasks.transition(t, 'failed', { error: '被调用方取消' });
      return json(res, 200, { id: t.id, status: t.status });
    }

    const mContent = p.match(/^\/v1\/videos\/([^/]+)\/content$/);
    if (req.method === 'GET' && mContent) {
      const t = tasks.get(mContent[1]);
      if (!t) return json(res, 404, { detail: '任务不存在' });
      if (t.status !== 'completed' || !t.result || !t.result.video_url) {
        return json(res, 409, { detail: '任务未完成，无内容可下载' });
      }
      // 代理直链（避免暴露带签名的 CDN URL 给调用方网络环境差异问题）。
      // Range 透传（2026-11-08 审计）：不带 Range 时 <video> 拖动进度条要等全量下载完。
      const range = String(req.headers.range || '');
      const upstream = await fetch(t.result.video_url, {
        headers: Object.assign({ 'Referer': 'https://www.doubao.com/' }, range ? { Range: range } : {}),
      });
      if (!upstream.ok || !upstream.body) return json(res, 502, { detail: '上游直链获取失败: ' + upstream.status });
      const headers = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes' };
      const cr = upstream.headers.get('content-range');
      if (cr) headers['Content-Range'] = cr;
      const cl = upstream.headers.get('content-length');
      if (cl) headers['Content-Length'] = cl;
      res.writeHead(upstream.status === 206 ? 206 : 200, headers);
      for await (const chunk of upstream.body) res.write(chunk);
      return res.end();
    }

    return json(res, 404, { detail: 'Not Found: ' + p });
  } catch (e) {
    log.error('http err', e.message);
    return json(res, 500, { detail: e.message });
  }
});

if (require.main === module) {
  try { accounts.boot(); }
  catch (error) {
    console.error(`[bridge-startup] ${error.code || 'STARTUP_FAILED'}`);
    console.error(error);
    process.exit(1);
  }
  server.on('error', (error) => {
    console.error(`[bridge-startup] ${error.code === 'EADDRINUSE' ? 'PORT_IN_USE' : 'STARTUP_FAILED'}`);
    console.error(error);
    process.exit(1);
  });
  server.listen(config.port, config.host, () => {
    log.info(`doubao-bridge listening http://${config.host}:${config.port}`);
    log.info(`patch30 = ${config.patch30.enabled ? 'ON → ' + patch30.TARGET_MODEL + '@' + patch30.TARGET_DURATION + 's' : 'OFF'}`);
  });
}
module.exports = { server };

// 测试钩子：仅暴露纯函数，供 test/image-count.test.js 校验提示词注入规则。
if (typeof module !== 'undefined' && module.exports) {
  module.exports.__test = { clampCount, withCountInstruction };
}
