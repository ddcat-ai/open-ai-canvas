'use strict';
/* accounts.js —— 多账号注册表 + 额度感知任务路由
 * 一个豆包账号 = 一个独立 Chromium session partition = 一个 driver 实例。
 * 注册表持久化在 data/accounts.json；任务派发规则：
 *   跳过 禁用 / 今日额度耗尽 / 待扫码登录 / 忙碌 的账号，按派发数最少轮转。
 * 任务因「额度已用完」失败时自动标记账号并换号重试（每任务最多换一次）。
 * 所有账号额度耗尽 → 任务立即失败并提示扫码加号。 */
const fs = require('fs');
const path = require('path');
const log = require('./log')('accounts');
const browserHost = require('./browser-host');
const config = require('./config');
const tasks = require('./tasks');
const cleanup = require('./conversation-cleanup');
const { createDriver } = require('./driver');
const { retryDecision } = require('./retry-policy');
const { dataDir: DATA_DIR, profileDir } = require('./runtime-paths');
const { readJSON, writeJSON } = require('./json-store');

const STORE = path.join(DATA_DIR, 'accounts.json');
const registry = new Map(); // id -> { id, label, userDataDir, disabled, pendingLogin, quotaExhausted(按能力), successToday, dispatchToday, dispatchedCount, createdAt, driver }

/* ---------------- 额度：只认"豆包明确报过用完" + 次日刷新 ----------------
 * 需求（2026-11-11 定）：不统计次数、不推断上限。规则只有三条：
 *
 *  1) 豆包回复「额度已用完」→ 该账号该能力进入冷却，后续不再派给它；
 *  2) 手上还有别的可用账号 → 当前任务自动换号重试（每任务最多换一次）；
 *  3) 冷却到**本地次日 0 点**自动解除（豆包免费额度按日重置）。
 *
 * 为什么不数次数：豆包不暴露剩余额度（页面/响应体/账号菜单都实测无此字段），
 * 靠"成功次数"反推上限会在额度还够时提前拒派，属于拿功能正确性换一点延迟优化，
 * 不划算。降级为纯记录（successToday/dispatched），不参与路由判定。
 *
 * 按能力分开仍然保留：视频额度用完不该把同账号的生图一起停掉（实测 acct4 视频
 * 耗尽时生图仍可出图）。
 */
const KINDS = ['video', 'image', 'text'];
function taskKind(task) {
  const k = String((task && task.input && task.input.kind) || 'video').toLowerCase();
  return KINDS.indexOf(k) >= 0 ? k : 'video';
}

/** 按日重置冷却标记；successToday/dispatchToday 仅作当日记录（不参与路由）。 */
function ensureDay(a) {
  const today = localDateStr();
  if (!a.quotaExhausted || typeof a.quotaExhausted !== 'object') a.quotaExhausted = {};
  if (!a.successToday || typeof a.successToday !== 'object') a.successToday = {};
  if (!a.dispatchToday || typeof a.dispatchToday !== 'object') a.dispatchToday = {};
  if (a.quotaDay !== today) {
    a.quotaDay = today;
    a.quotaExhausted = {};
    a.successToday = {};
    a.dispatchToday = {};
    a.quotaExhaustedDate = null; // 旧字段随日作废
  }
  return a;
}

function localDateStr() {
  return new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD（服务器本地时区，额度按本地日重置）
}

let nextId = 1; // 账号 id 单调递增（随存档持久化）：桌面端 Cookie 罐按 id 命名，复用 id 会继承旧会话

function maxStoredId(rows) {
  return rows.reduce((m, r) => Math.max(m, Number(String(r.id || '').replace(/^acct/, '')) || 0), 0);
}

function loadStore() {
    let parsed;
    try { parsed = readJSON(STORE, validStore); }
    catch (error) {
      if (error instanceof SyntaxError || error.code === 'INVALID_STORE') {
        const failure = new Error('账号存档损坏，已保留原文件；请检查存档和备份');
        failure.code = 'ACCOUNT_STORE_INVALID';
        throw failure;
      }
      throw error;
    }
    if (parsed === null && fs.existsSync(STORE + '.backup')) {
      const failure = new Error('账号存档缺失，已保留备份并停止启动；请先核对备份中的账号，再恢复存档');
      failure.code = 'ACCOUNT_STORE_MISSING';
      throw failure;
    }
    // v2 形状 { nextId, accounts }；v1（裸数组）就地迁移：nextId = 现有最大 id + 1
    if (Array.isArray(parsed)) return { nextId: maxStoredId(parsed) + 1, accounts: parsed };
    return parsed && Array.isArray(parsed.accounts) ? parsed : null;
}

const validStore = (value) => {
  const rows = Array.isArray(value) ? value : value && value.accounts;
  return Array.isArray(rows) && rows.every((a) => a && /^acct\d+$/.test(a.id) &&
    typeof a.userDataDir === 'string' && path.isAbsolute(a.userDataDir)) &&
    new Set(rows.map((a) => a.id)).size === rows.length;
};

function saveStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // 额度冷却标记必须落盘（2026-11-11）：旧实现只存 id/label/目录，重启桥即丢失
  // 「今天该账号视频额度已耗尽」，重启后又会把任务派过去白白浪费一轮。
  const rows = [...registry.values()].map((a) => ({
    id: a.id,
    label: a.label,
    userDataDir: a.userDataDir,
    disabled: a.disabled,
    createdAt: a.createdAt,
    lastActiveAt: a.lastActiveAt || null,
    quotaDay: a.quotaDay || null,
    quotaExhausted: a.quotaExhausted || {},
    successToday: a.successToday || {},
    dispatchToday: a.dispatchToday || {},
  }));
  writeJSON(STORE, { nextId, accounts: rows }, validStore);
}

function ensureAccount(rec) {
  if (registry.has(rec.id)) return registry.get(rec.id);
  const full = {
    id: rec.id,
    label: rec.label || rec.id,
    userDataDir: rec.userDataDir,
    disabled: !!rec.disabled,
    pendingLogin: !!rec.pendingLogin,
    quotaExhaustedDate: null,
    // 从存档恢复当日冷却标记（跨日由 ensureDay 自动清零）
    quotaDay: rec.quotaDay || null,
    quotaExhausted: rec.quotaExhausted && typeof rec.quotaExhausted === 'object' ? rec.quotaExhausted : {},
    successToday: rec.successToday && typeof rec.successToday === 'object' ? rec.successToday : {},
    dispatchToday: rec.dispatchToday && typeof rec.dispatchToday === 'object' ? rec.dispatchToday : {},
    dispatchedCount: 0,
    // 最近一次「真的干活」的时刻。桌面端据此决定要不要保留这个账号的豆包窗口
    // （每个窗口常驻约 390 MB renderer，闲置账号没必要一直占着）。
    lastActiveAt: rec.lastActiveAt || Date.now(),
    createdAt: rec.createdAt || Date.now(),
    driver: createDriver({
      accountId: rec.id,
      userDataDir: rec.userDataDir,
      hooks: { onTaskDone: (task, failure) => onTaskDone(rec.id, task, failure) },
    }),
  };
  ensureDay(full); // 存档若是昨天的账本，这里就地清零
  registry.set(rec.id, full);
  return full;
}

/** 启动：载入注册表（无存档时把单账号时代的会话目录迁移为账号 1），预热首个可用账号 */
// 登录态轮询：豆包会话可能被挤下线/过期（同账号异地登录、服务端清理）。
// 周期实测每个空闲账号的登录态并同步路由：失效 → 退出路由（待扫码），恢复 → 重新入池。
// 忙碌账号跳过（生成中不打扰）；单轮串行防重叠。
let loginPollInFlight = false;
function startLoginPoll() {
  setInterval(async () => {
    if (loginPollInFlight) return;
    loginPollInFlight = true;
    try {
      for (const a of list()) {
        if (a.disabled || a.driver.isBusy()) continue;
        // 窗口已被闲置回收：没有页面可实测，直接跳过。否则每 30 秒一次 CDP attach +
        // 3 秒空等，既刷日志又白白占用主线程（2026-11-11 实测日志每 30 秒一条 attach）。
        if (!a.driver.state || !a.driver.state.page) continue;
        try {
          // 快速探测：窗口被闲置回收时不要空等 45 秒（否则 30 秒一轮的登录轮询会把
        // /admin/api/accounts 拖到桌面端读不到 busy，形成互相等死）
        const login = await a.driver.getLoginState({ waitMs: 3000 });
          if (login.loggedIn && a.pendingLogin) {
            markLoggedIn(a.id);
            log.info('账号会话有效，加入路由:', a.id);
          } else if (!login.loggedIn && !a.pendingLogin) {
            a.pendingLogin = true;
            log.warn('账号会话失效，退出派发路由（待扫码）:', a.id);
          }
        } catch (e) {
          // 窗口未开是桌面端闲置回收的结果，不是故障：静默跳过，不刷错误日志。
          // 账号保持上次已知登录态，真正派发任务时桌面端会重建窗口。
          if (e && (e.windowAbsent || e.browserUnavailable)) continue;
          /* 其它查询失败忽略 */
        }
      }
    } finally {
      loginPollInFlight = false;
    }
  }, 30000);
}

function boot() {
  const store = loadStore();
  let rows;
  if (!store) {
    rows = [{ id: 'acct1', label: '账号 1', userDataDir: path.join(profileDir, 'acct1'), disabled: false, createdAt: Date.now() }];
    nextId = 2;
    log.info('无账号存档：单账号 profile 迁移为 acct1');
  } else {
    rows = store.accounts;
    nextId = Math.max(store.nextId || 1, maxStoredId(rows) + 1);
  }
  for (const rec of rows) {
    const a = ensureAccount(rec);
    // partition 隔离后旧记录的登录标记不可信：先全部标记待扫码，
    // 预热驱动的实测登录态再恢复已登录者（路由与管理页状态从此与事实一致）。
    a.pendingLogin = true;
  }
  saveStore();
  log.info('账号注册表就绪:', [...registry.keys()].join(', '));
  // 预热（2026-11-11 改）：只拉起一个账号的隐藏 Chromium 页面。
  // 每个浏览器实例实测约 545 MB（browser 163 + 豆包 renderer 285 + 两个内部页 97），
  // 开机就把所有账号都拉起等于白占——用户绝大多数时候只用其中一个。
  // 其余账号在真正派发任务时由 launch() 按需拉起（冷启动约 2~3 秒）。
  const prewarm = list().filter((x) => !x.disabled)[0];
  if (prewarm) {
    prewarm.driver.launch()
      .then(async () => {
        const login = await prewarm.driver.getLoginState({ waitMs: 8000 }).catch(() => ({ loggedIn: false }));
        if (login.loggedIn) markLoggedIn(prewarm.id);
        else log.info(prewarm.id + ' 未登录（待扫码），已退出派发路由');
      })
      .catch((e) => log.error('预热失败(' + prewarm.id + ')', e.message));
  }
  startLoginPoll();
  let cleanupRunning = false;
  setInterval(async () => {
    if (cleanupRunning || !cleanup.settings().enabled || [...tasks._all().values()].some((t) => t.status === 'queued')) return;
    cleanupRunning = true;
    try {
      for (const a of list()) {
        if (a.disabled || a.pendingLogin || a.driver.isBusy() || [...tasks._all().values()].some((t) => t.status === 'queued')) continue;
        const entry = cleanup.due(a.id);
        if (!entry) continue;
        try {
          if (await a.driver.cleanConversation(entry)) cleanup.remove(entry);
          else cleanup.defer(entry);
        } catch (e) {
          log.warn('自动清理对话失败，将保留并稍后重试:', e.message);
          cleanup.defer(entry);
        } finally { pumpQueued(); }
      }
    } catch (e) { log.warn('会话清理调度失败:', e.message); }
    finally { cleanupRunning = false; }
  }, 60000).unref();
  // 宿主保留最近使用的空闲窗口，其余空闲窗口按配置回收；忙碌状态由宿主原子保护。
  const idleEvictMs = Number((config.doubao && config.doubao.idleEvictMs) || 10 * 60 * 1000);
  setInterval(async () => {
    try { await evictIdleBrowsers(idleEvictMs); } catch (e) { log.warn('闲置回收失败:', e.message); }
  }, 60000);
}

async function evictIdleBrowsers(idleMs) {
  const closed = await browserHost.stopIdle(idleMs);
  // launch() checks whether its page was closed. Do not detach here: a new
  // task may already have reconnected after the host completed eviction.
  return closed;
}

/** 新增账号：独立会话目录 + 待扫码标记（扫码完成前不参与任务路由） */
function addAccount(label) {
  // id 单调递增、永不复用（nextId 随存档持久化）：桌面端 Cookie 罐按 id 命名
  // （partition persist:<id>），复用 id 会继承旧 partition 里的豆包会话——
  // 移除再加直接"已登录"、免扫码顶号（2026-11-09 事故；acct2 撞上更早测试的旧罐同理）。
  const n = nextId++;
  const rec = ensureAccount({ id: 'acct' + n, label: label || ('账号 ' + n), userDataDir: path.join(profileDir, 'acct' + n), disabled: false, pendingLogin: true, createdAt: Date.now() });
  try { saveStore(); }
  catch (error) { registry.delete(rec.id); throw error; }
  log.info('新增账号（待扫码）:', rec.id, rec.label);
  return rec;
}

/** 移除账号（忙碌中拒绝，防任务悬空） */
function removeAccount(id) {
  const a = registry.get(id);
  if (!a) return { ok: false, error: '账号不存在' };
  if (a.driver.isBusy()) return { ok: false, error: '账号有任务运行中，稍后再删' };
  // 先断开 CDP 并提交注册表，再请求桌面主进程只销毁该账号的隐藏窗口。
  a.driver.detach();
  registry.delete(id);
  try { saveStore(); }
  catch (error) { registry.set(id, a); throw error; }
  void browserHost.stop(id).catch((error) => log.warn('关闭账号隐藏窗口失败:', id, error.message));
  log.info('账号已移除:', id);
  return { ok: true };
}

function get(id) { return id ? registry.get(id) || null : null; }
function list() { return [...registry.values()]; }
function first() { return list().find((a) => !a.disabled) || list()[0] || null; }

/** 扫码完成：清除待登录标记（/login/status 轮询到 loggedIn 时调用） */
function markLoggedIn(id) {
  const a = registry.get(id);
  if (a && a.pendingLogin) {
    a.pendingLogin = false;
    log.info('账号扫码登录完成，加入路由:', id);
  }
}

/** 该账号在该能力上今日是否已冷却（只认豆包明确报过「额度已用完」）。 */
function isQuotaExhausted(a, kind) {
  ensureDay(a);
  const k = KINDS.indexOf(kind) >= 0 ? kind : 'video';
  if (a.quotaExhausted[k]) return true;
  // 旧存档迁移：老字段只表示"今天某能力耗尽"，保守起见按全能力处理一天
  if (a.quotaExhaustedDate && a.quotaExhaustedDate === localDateStr()) return true;
  return false;
}

function routable(a, kind) {
  if (a.disabled) return false;
  if (isQuotaExhausted(a, kind)) return false;
  // 浏览器未拉起 = 还没验证过登录态：允许派发（runTask 会先 launch 再验证）。
  // 已验证未登录（pendingLogin 且页面在）才会退出派发路由。
  const browserUp = Boolean(a.driver && a.driver.state && a.driver.state.page);
  if (a.pendingLogin && (browserUp || a.loginVerified)) return false;
  return true;
}

function pickAccount(kind, preferredId) {
  const k = KINDS.indexOf(kind) >= 0 ? kind : 'video';
  const cands = list().filter((a) => routable(a, k) && !a.driver.isBusy());
  if (!cands.length) return null;
  if (preferredId) return cands.find((a) => a.id === preferredId) || null;
  // 排序（2026-11-12 实测补充）：优先挑「浏览器已经活着」的账号。
  // 只预热第一个账号，其余账号是冷启动且登录态未验证——
  // 直接派过去必然先吃一次「豆包未登录」再换号，白白多一次失败记录
  // （用户看到面板上冒出「豆包未登录」红字，其实任务已经换号成功了）。
  // 冷账号仍可作为兜底（热账号忙时），只是排在后面。
  // 其次：今日用得少的优先，再按累计派发次数均衡（不推断上限，纯负载均衡）。
  const warm = (a) => (a.driver && a.driver.state && a.driver.state.page ? 0 : 1);
  return cands.sort((a, b) => (warm(a) - warm(b))
    || ((a.successToday[k] || 0) - (b.successToday[k] || 0))
    || ((a.dispatchedCount || 0) - (b.dispatchedCount || 0)))[0];
}

/** 派发一个任务（须处于 queued 态；runTask 首拍同步置 processing，天然防双派发） */
function dispatch(task) {
  if (task.status !== 'queued' || (task.retryAt && task.retryAt > Date.now())) return false;
  const kind = taskKind(task);
  const label = kind === 'image' ? '生图' : kind === 'text' ? '对话' : '视频生成';
  const anyRoutable = list().some((a) => routable(a, kind));
  if (!anyRoutable) {
    tasks.transition(task, 'failed', {
      reason: 'no_available_account', phase: 'failed',
      error: '没有可用的豆包账号：请检查登录、启用状态及今日' + label + '额度。',
    });
    log.warn('无可用账号（该能力今日已冷却）:', task.id, kind);
    return false;
  }
  const a = pickAccount(kind, task.retryAccountId);
  if (!a) return false; // 全忙：留队，onTaskDone 时再泵
  a.dispatchedCount = (a.dispatchedCount || 0) + 1;
  a.lastActiveAt = Date.now();
  ensureDay(a);
  a.dispatchToday[kind] = (a.dispatchToday[kind] || 0) + 1;
  log.info('任务派发:', task.id, '→', a.id, '(' + kind + ')');
  a.driver.runTask(task);
  return true;
}

function pumpQueued() {
  // 优先级（2026-11-10）：单账号串行时，视频这种长任务会把短请求堵在后面。
  // 先跑图/文（通常几十秒），视频按到达顺序排队。
  const kindRank = (t) => ((t.input && t.input.kind) === 'video' ? 1 : 0);
  const queued = [...tasks._all().values()]
    .filter((t) => t.status === 'queued')
    .sort((x, y) => kindRank(x) - kindRank(y) || (x.created_at || 0) - (y.created_at || 0));
  for (const t of queued) {
    dispatch(t);
  }
}

/** 单次尝试结束；重试决策必须早于公开 failed 终态。 */
function onTaskDone(accountId, task, failure) {
  const a = registry.get(accountId);
  const kind = taskKind(task);
  if (tasks.get(task.id) !== task) return;
  if (a && task.status === 'completed') {
    ensureDay(a);
    a.successToday[kind] = (a.successToday[kind] || 0) + 1;
    saveStore();
  }
  if (!failure) { pumpQueued(); return; }
  // Host registration can fail before beginAttempt changes queued to processing.
  // Such a task has never been submitted and must not be immediately dispatched forever.
  if (task.status === 'queued') {
    tasks.transition(task, 'failed', { error: failure.error, reason: failure.reason,
      phase: 'failed', retryAt: null });
    pumpQueued();
    return;
  }
  if (task.status !== 'processing') { pumpQueued(); return; }
  if (a && failure.reason === 'login_required') {
    a.pendingLogin = true;
    a.loginVerified = true;
  }
  if (a && failure.reason === 'quota_exhausted') {
    ensureDay(a);
    a.quotaExhausted[kind] = true;
    saveStore();
  }
  const others = list().filter((x) => x.id !== accountId && routable(x, kind));
  const retry = retryDecision(task, failure, others.length > 0);
  if (retry && a) {
    const meta = { ...task.meta, retries: (task.meta.retries || 0) + 1 };
    tasks.transition(task, 'queued', { meta, reason: failure.reason, phase: 'retry_wait',
      retryAt: Date.now() + retry.delayMs, retryAccountId: retry.switchAccount ? null : accountId });
    tasks.note(task, '本次未被接受，等待自动重试');
    const timer = setTimeout(() => {
      if (tasks.get(task.id) === task && task.status === 'queued') pumpQueued();
    }, retry.delayMs);
    timer.unref();
  } else {
    tasks.transition(task, 'failed', { error: failure.error, reason: failure.reason,
      phase: 'failed', retryAt: null });
  }
  pumpQueued();
}

/** 冷却到期时刻：豆包按本地日重置，所以"冷却池"的到期就是次日 0 点。
 *  返回毫秒时间戳，供管理页/客户端显示「冷却至 …」并做倒计时。 */
function cooldownUntil() {
  const d = new Date();
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

/** 账号运行态（管理页展示；会按需创建隐藏 Chromium 页面） */
async function accountState(id) {
  const a = registry.get(id);
  if (!a) return null;
  // 窗口已被桌面端回收时不要再去实测登录态：getLoginState → ensureChatPage → launch
  // 会空等一轮超时（8s），把 /admin/api/accounts 拖慢到桌面端无法及时读到 busy，
  // 而桌面端恰恰要靠 busy 来决定给谁开窗——于是互相等死（2026-11-11 实测：
  // 任务派到已回收的账号，桥 8s 超时失败，主进程永远不开窗）。
  // 无窗口时直接返回已知登录态（上次实测结果），窗口需要的信号由 hasTask 提供。
  const windowReady = Boolean(a.driver.state && a.driver.state.page);
  const login = windowReady
    ? await a.driver.getLoginState({ waitMs: 5000 }).catch((e) => ({ loggedIn: !a.pendingLogin, error: e.message }))
    : { loggedIn: !a.pendingLogin, error: null };
  if (login.loggedIn && a.pendingLogin && windowReady) markLoggedIn(id);
  ensureDay(a);
  const until = cooldownUntil();
  // 按能力分开报：调用方（管理页/客户端）据此知道"视频没了但生图还能用"，
  // 以及"什么时候回来"（coolingUntil）
  const quota = {};
  for (const k of KINDS) {
    const exhausted = isQuotaExhausted(a, k);
    quota[k] = {
      exhausted,
      coolingUntil: exhausted ? until : null,
      success: a.successToday[k] || 0,
      dispatched: a.dispatchToday[k] || 0,
    };
  }
  const activeTask = a.driver.state ? a.driver.state.activeTask : null;
  return {
    id: a.id,
    label: a.label,
    loggedIn: !!login.loggedIn,
    loginError: login.error || null,
    pendingLogin: !!a.pendingLogin,
    busy: a.driver.isBusy(),
    // 浏览器由桌面宿主管理，下面两个字段只用于观测。
    lastActiveAt: a.lastActiveAt || null,
    browserReady: windowReady,
    windowReady, // 兼容旧字段名（管理页仍在读）
    // 兼容旧字段语义（任一能力耗尽即 true），新调用方请用 quota[kind]
    quotaExhausted: KINDS.some((k) => quota[k].exhausted),
    quota,
    disabled: a.disabled,
    dispatchedCount: a.dispatchedCount || 0,
  };
}

module.exports = {
  boot, addAccount, removeAccount, get, list, first, markLoggedIn, dispatch, pumpQueued, accountState,
  _registry: registry,
  // 纯函数导出（单测用）：额度冷却的按能力隔离与次日刷新是本模块最容易出错的部分，
  // 对着 mock 账号断言比真机烧额度便宜得多。
  _test: { isQuotaExhausted, routable, ensureDay, taskKind, pickAccount, cooldownUntil, onTaskDone, evictIdleBrowsers, KINDS },
};
