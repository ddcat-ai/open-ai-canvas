'use strict';
/* 任务存储：内存 + 磁盘持久化（重启后存活任务标记失败，避免后端轮询 404 变僵尸）
 * queued → processing → completed / failed
 *
 * 生图结果外置（2026-11-10 审计）：此前 result.images 直接存 data URL，4 张图约
 * 14~23MB，而 saveStore() 在每次 transition()/note() 都全表 JSON.stringify + 写盘。
 * MAX_TASKS=200 下这是数 GB 级的写放大，tasks.json 实测已涨到 35.5MB 且随使用线性增长。
 * 现在二进制落 data/images/<taskId>-<i>.<ext>，任务记录只留文件名；API 出参时再
 * 按需读回并转 data URL（一次请求一次转换，不在内存里常驻）。
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const log = require('./log')('tasks');
const { dataDir: DATA_DIR } = require('./runtime-paths');
const { readRecoverableJSON, writeJSON } = require('./json-store');

const tasks = new Map(); // id -> task
const STORE = path.join(DATA_DIR, 'tasks.json');
const IMAGE_DIR = path.join(DATA_DIR, 'images');
const FAILED_TASK_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const FAILED_TASK_MIN_KEEP = 200;
const validRows = (rows) => Array.isArray(rows) && rows.every((t) => t &&
  /^task_[a-zA-Z0-9_]+$/.test(t.id) && ['queued', 'processing', 'completed', 'failed'].includes(t.status) &&
  t.input && typeof t.input === 'object' && Array.isArray(t.progress)) &&
  new Set(rows.map((t) => t.id)).size === rows.length;

const MIME_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/* ---------------- 图片落盘 / 读取 / 回收 ---------------- */

/** 写入一组 {buf, mime} → 返回 [{name, mime, bytes}]（name 相对 data/images） */
function saveImages(taskId, items) {
  if (!/^task_[a-zA-Z0-9_]+$/.test(taskId)) throw new Error('Invalid image task id');
  fs.mkdirSync(IMAGE_DIR, { recursive: true });
  const files = [];
  items.forEach((item, i) => {
    if (!item || !item.buf || !item.buf.length) throw new Error('Empty generated image');
    const mime = item.mime || 'image/png';
    const ext = MIME_EXT[mime.toLowerCase()] || 'png';
    const name = `${taskId}-${i}.${ext}`;
    fs.writeFileSync(path.join(IMAGE_DIR, name), item.buf);
    files.push({ name, mime, bytes: item.buf.length });
  });
  return files;
}

/** 读回一个任务的图片并转 data URL（供同步端点 / 轮询端点出参） */
async function imageDataUrls(task) {
  const files = (task && task.result && Array.isArray(task.result.imageFiles)) ? task.result.imageFiles : [];
  const out = [];
  for (const f of files) {
    if (path.basename(f.name) !== f.name) throw new Error('Invalid image file name');
      const buf = await fs.promises.readFile(path.join(IMAGE_DIR, f.name));
      out.push(`data:${f.mime || 'image/png'};base64,${buf.toString('base64')}`);
  }
  return out;
}

/* ---------------- 持久化 ---------------- */

function saveStore() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    // 持久化瘦身（2026-11-08 审计）：reference_images 是 data URL（每张 ~1MB+），整段落盘
    // 把 tasks.json 撑到 17MB/22 任务。素材已落地 data/refs/<taskId>.*，且重启后未完成
    // 任务直接标记失败（不需要原图）→ 落盘时以占位符替代，内存里保留真实值供运行使用。
    const rows = [...tasks.values()].map((t) => {
      const row = {
        ...t,
        progress: t.progress.slice(-5),
        input: t.input && Array.isArray(t.input.reference_images) && t.input.reference_images.length
          ? { ...t.input, reference_images: ['<refs-materialized>'] }
          : t.input,
      };
      // 防御：任何路径若仍把 base64 塞进 result.images，落盘前丢弃并告警（旧版行为回归时能立刻发现）
      const images = row.result && row.result.images;
      if (Array.isArray(images) && images.some((u) => typeof u === 'string' && u.startsWith('data:'))) {
        log.warn('任务结果仍含内联 data URL，落盘时丢弃（应改走 imageFiles）:', t.id);
        row.result = { ...row.result, images: [] };
      }
      return row;
    });
    writeJSON(STORE, rows, validRows);
}

/** 旧存档迁移：result.images 里的 data URL → 落盘 + 换成 imageFiles */
function migrateInlineImages(t) {
  const r = t.result;
  if (!r || !Array.isArray(r.images) || !r.images.length) return 0;
  const inline = r.images.filter((u) => typeof u === 'string' && u.startsWith('data:'));
  if (!inline.length) return 0;
  const items = [];
  for (const u of inline) {
    const m = /^data:([^;,]+);base64,(.+)$/is.exec(u);
    if (!m) continue;
    items.push({ mime: m[1], buf: Buffer.from(m[2], 'base64') });
  }
  const files = saveImages(t.id, items);
  r.imageFiles = files;
  r.images = [];
  r.image_count = files.length;
  return files.length;
}

function loadStore() {
  let migrated = 0;
    const rows = readRecoverableJSON(STORE, validRows, (backup) => backup.map((task) => {
      if (task.status !== 'queued' && task.status !== 'processing') return task;
      return { ...task, status: 'failed', submissionState: 'unknown',
        error: '任务存档从旧备份恢复，提交结果无法确认，请检查豆包后再手动发起', updated_at: Date.now() };
    })) || [];
    for (const t of rows) {
      migrated += migrateInlineImages(t);
      if (t.status === 'queued' || t.status === 'processing') {
        // 重启时未完成的任务：驱动上下文已丢失，明确标记失败（后端轮询拿到真实 failed 结束僵尸态）
        t.status = 'failed';
        t.error = '桥重启导致任务中断（任务不跨重启），请重新发起';
        t.updated_at = Date.now();
      }
      tasks.set(t.id, t);
    }
    if (rows.length) log.info(`已恢复 ${rows.length} 条历史任务记录（未完成的已标记失败）`);
  if (rows.length) {
    log.info(`任务存档迁移：${migrated} 张内联生成图已外置到 data/images/`);
    saveStore();
  }
}
loadStore();

// Only failed tasks with no result can be discarded without proving that media
// has been adopted elsewhere. Keep both a time window and a minimum history.
function pruneFailedTasks(now = Date.now()) {
  const candidates = [...tasks.values()].filter((t) => t.status === 'failed' && t.result == null && t.submissionState === 'not_sent' &&
    Number.isFinite(t.updated_at) && t.updated_at > 0 && t.updated_at <= now)
    .sort((a, b) => b.updated_at - a.updated_at);
  const expired = candidates.slice(FAILED_TASK_MIN_KEEP).filter((t) => now - t.updated_at >= FAILED_TASK_RETENTION_MS);
  if (!expired.length) return 0;
  for (const t of expired) tasks.delete(t.id);
  try { saveStore(); }
  catch (error) {
    for (const t of expired) tasks.set(t.id, t);
    throw error;
  }
  log.info(`已清理 ${expired.length} 条超过 30 天且不含结果的失败任务记录`);
  return expired.length;
}
pruneFailedTasks();

/* ---------------- CRUD ---------------- */

function create(input) {
  const id = 'task_' + crypto.randomBytes(9).toString('hex');
  const now = Date.now();
  const t = {
    id,
    status: 'queued',
    created_at: now,
    updated_at: now,
    input, // { model, prompt, duration, ratio, size, reference_images, providerOptions, kind }
    result: null, // { video_url, videos: [], width, height, ... } / { kind:'image', imageFiles:[] } / { kind:'text', text }
    error: null,
    progress: [],
    meta: {},
    attempt: 0,
    phase: 'queued',
    reason: null,
    retryAt: null,
    submissionState: 'not_sent',
  };
  tasks.set(id, t);
  log.info('task created', id, { prompt: (input.prompt || '').slice(0, 40) });
  try { saveStore(); }
  catch (error) { tasks.delete(id); throw error; }
  return t;
}

function get(id) { return tasks.get(id) || null; }

/* ---------------- 事件总线（2026-11-11）----------------
 * 原来客户端靠轮询（任务 3 秒 / 会话 2 秒 / 窗口 1 秒）感知状态，空转与延迟都不理想。
 * 这里给任务生命周期加一个极轻的订阅点：状态变更、进度追加时同步通知。
 * 桥的 SSE 端点订阅它做真推送；未订阅时行为与之前完全一致（无副作用）。
 * 不用 EventEmitter 是为了保持零依赖 + 可预测的同步调用顺序。 */
const listeners = new Set();
function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(event) {
  for (const fn of listeners) {
    try { fn(event); } catch (e) { /* 单个订阅者异常不影响任务流转 */ }
  }
}

function transition(t, status, extra) {
  if (tasks.get(t.id) !== t || t.status === 'completed' || t.status === 'failed') return false;
  if (!['queued', 'processing', 'completed', 'failed'].includes(status) ||
      (t.status === 'queued' && status === 'completed')) throw new Error('Invalid task transition');
  const previous = { ...t };
  t.status = status;
  t.updated_at = Date.now();
  if ((status === 'queued' || status === 'processing') && !(extra && 'error' in extra)) {
    t.error = null;
  }
  if (extra) Object.assign(t, extra);
  try { saveStore(); }
  catch (error) { Object.assign(t, previous); throw error; }
  log.debug('task ->', status, t.id);
  emit({ type: 'task', action: 'transition', task: toRow(t) });
  return true;
}

function note(t, msg) {
  if (tasks.get(t.id) !== t || t.status === 'completed' || t.status === 'failed') return;
  t.progress.push({ at: Date.now(), msg: String(msg).slice(0, 200) });
  if (t.progress.length > 50) t.progress.shift();
  emit({ type: 'task', action: 'note', task: toRow(t) });
}

function beginAttempt(t, accountId) {
  if (tasks.get(t.id) !== t || t.status !== 'queued') throw new Error('Task is not queued');
  // A new object per attempt makes callbacks from an earlier attempt harmless.
  const next = { ...t, meta: { ...t.meta }, progress: [...t.progress], attempt: (t.attempt || 0) + 1 };
  tasks.set(t.id, next);
  try {
    transition(next, 'processing', { accountId, phase: 'page_ready', retryAt: null, reason: null,
      submissionState: 'not_sent', result: null });
  } catch (error) { tasks.set(t.id, t); throw error; }
  return next;
}

/** dola-pool 风格的查询响应（2026-11-09 起 kind 感知：video/image/text 三类结果形状）
 *  生图的 images 为 data URL，体积大——这里不返回，由调用方用 imageDataUrls() 补齐。 */
function toPollJson(t) {
  const kind = (t.input && t.input.kind) || 'video';
  const j = {
    id: t.id,
    status: t.status,
    created_at: t.created_at,
    model: t.input.model,
    prompt: t.input.prompt,
    kind,
    reason: t.reason || null,
    phase: t.phase || null,
    attempt: t.attempt || 0,
    retryAt: t.retryAt || null,
  };
  if (t.error) j.detail = t.error;
  if (t.input && t.input.duration != null) j.duration = t.input.duration;
  if (t.result) {
    if (t.result.kind === 'image') {
      j.image_count = t.result.image_count || (t.result.imageFiles || []).length;
      j.images = []; // 内联体积大，轮询端点由 server 按需读回填充
    } else if (t.result.kind === 'text') {
      j.text = t.result.text || '';
    } else {
      j.video_url = t.result.video_url || (t.result.videos && t.result.videos[0]) || null;
      j.videos = t.result.videos || [];
      j.watermark = t.result.watermark || false;
      if (t.result.width) j.width = t.result.width;
      if (t.result.height) j.height = t.result.height;
      if (t.result.duration_s) j.duration_s = t.result.duration_s;
    }
  }
  return j;
}

/**
 * 客户端行形状（/v1/tasks 与 /v1/events 必须完全一致）。
 *
 * 2026-11-12 事故：SSE 推送直接发 toPollJson 的产物，失败原因放在 detail 字段；
 * 而客户端读的是 error —— 于是面板把「生图超时：未捕获到生成图片」显示成「未知原因」。
 * 两个通道各写一份形状就会这样漂移，这里收敛成唯一来源。
 */
function toRow(t) {
  return {
    id: t.id,
    kind: (t.input && t.input.kind) || 'video',
    nodeId: typeof t.input?.metadata?.nodeId === 'string' ? t.input.metadata.nodeId : null,
    status: t.status,
    created_at: t.created_at,
    attempt: t.attempt || 0,
    phase: t.phase || 'queued',
    reason: t.reason || null,
    retryAt: t.retryAt || null,
    accountId: t.accountId || null,
    model: t.input.model,
    prompt: String(t.input.prompt || '').slice(0, 80),
    // 已完成的任务不该带失败原因（历史数据里存在「先失败→换号重试→成功」留下的
    // 残留 error，会让客户端把成功任务显示成失败，见 2026-11-12 事故）
    error: t.status === 'completed' ? null : (t.error || null),
    // note：最后一条进度，面板用它显示「正在上传参考图 / 参数确认中 / 丢弃串片…」
    note: Array.isArray(t.progress) && t.progress.length ? String(t.progress[t.progress.length - 1].msg || '') : null,
  };
}

module.exports = {
  create, get, transition, note, toPollJson, toRow, beginAttempt,
  subscribe, pruneFailedTasks,
  saveImages, imageDataUrls,
  _all: () => tasks,
};
