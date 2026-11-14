'use strict';
/* 30s 请求体补丁 —— 移植自 WOOL lib/doubao30-patch.jsc（探针实测还原）
 *
 * 黄金用例（WOOL 原函数实测输出，见 work/wool/probe_doubao3.js 运行记录）：
 *  A) ability_param 为字符串化 JSON → 只改写内部：duration→30、model→target、补 camera_movement；顶层不加字段
 *  B) 顶层 duration+model → 顶层改写：duration→"30"（保留字符串类型）、model→target、补 camera_movement
 *  C) 嵌套 completion.ability_param 对象 → 就地改写该对象
 */
const config = require('./config');

const P = config.patch30;
const TARGET_DURATION = P.targetDuration;
const TARGET_MODEL = P.targetModel;
const CAMERA = P.cameraMovement;

const RE_ABILITY_PARAM = /ability[_-]?param/i;
const RE_ABILITY_TYPE_17 = /ability[_-]?type["\s:]*17/;
const RE_SEEDANCE = /seedance/i;

function looksLikeVideoGenerationBody(body) {
  if (!body || typeof body !== 'string') return false;
  if (RE_ABILITY_TYPE_17.test(body)) return true;
  if (RE_ABILITY_PARAM.test(body)) return true;
  if (RE_SEEDANCE.test(body)) return true;
  return false;
}

/** 就地改写一个"预设字段组"（ability_param 内部 / 顶层）
 *  opts（任务驱动模式）：{ duration, model, ratio } —— duration 必给；model/ratio 省略则不动
 *  （豆包网页当前所选即任务模型，改 duration 即可精确控时长；camera_movement 仅旧 30s 解锁补丁需要）
 *  ratio：2026-11-10 补——此前只在 protocol 路径传比例，DOM 路径完全忽略，画布选 9:16 会出 16:9。
 *  这里只改「已存在的」比例字段（不新增未知键，避免把请求体结构改坏）。 */
const RATIO_KEYS = ['ratio', 'aspect_ratio', 'aspectRatio', 'wh_ratio'];

function patchFields(target, stats, opts) {
  const taskMode = !!(opts && opts.duration != null);
  const targetDuration = taskMode ? opts.duration : TARGET_DURATION;
  const targetModel = taskMode ? (opts.model || null) : TARGET_MODEL;
  const targetRatio = taskMode ? (opts.ratio || null) : null;
  let touched = false;
  // 同值不同类型（"10" vs 10）不算变更，避免无谓改写
  if (String(target.duration) !== String(targetDuration)) {
    // 保留原值类型（WOOL 实测：字符串 "10" → "30"，数字 5 → 30）
    target.duration = typeof target.duration === 'string' ? String(targetDuration) : targetDuration;
    touched = true;
  }
  stats.duration = targetDuration;
  if (targetModel) {
    // 插入顺序对齐 WOOL 实测：先补 camera_movement 再写 model
    if (target.camera_movement == null) { target.camera_movement = CAMERA; touched = true; }
    if (target.model !== targetModel) { target.model = targetModel; touched = true; }
    stats.model = targetModel;
  } else {
    stats.model = target.model != null ? String(target.model) : null;
  }
  // 比例：只改已存在的键，保留原值形态（"16:9" 字符串 / {"w":16,"h":9} 对象都可能）
  if (targetRatio) {
    for (const key of RATIO_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(target, key)) continue;
      const cur = target[key];
      if (typeof cur === 'object' && cur) {
        // {width,height} 形态：按比例换算，保持原有字段名
        const m = /^(\d+)\s*[:x/]\s*(\d+)$/.exec(String(targetRatio));
        if (m) {
          if ('width' in cur) cur.width = Number(m[1]);
          if ('height' in cur) cur.height = Number(m[2]);
          if ('w' in cur) cur.w = Number(m[1]);
          if ('h' in cur) cur.h = Number(m[2]);
          touched = true;
        }
      } else if (String(cur) !== String(targetRatio)) {
        target[key] = targetRatio;
        touched = true;
      }
      stats.ratio = targetRatio;
      stats.ratioKey = key;
      break;
    }
  }
  return touched;
}

/** 在一个容器对象上定位预设字段组并改写 */
function patchPreset(obj, stats, opts) {
  if (!obj || typeof obj !== 'object') return false;
  // 1) ability_param 为字符串化 JSON（形态A：只改内部，顶层不动）
  if (typeof obj.ability_param === 'string') {
    try {
      const inner = JSON.parse(obj.ability_param);
      if (patchFields(inner, stats, opts)) { obj.ability_param = JSON.stringify(inner); return true; }
      return false;
    } catch (e) { /* 非合法 JSON，继续找别处 */ }
  }
  // 2) ability_param 为对象（形态C：就地改写）
  if (obj.ability_param && typeof obj.ability_param === 'object') {
    return patchFields(obj.ability_param, stats, opts);
  }
  // 3) 顶层字段组（形态B：duration/model 就在当前层）
  if (obj.duration != null || (obj.model && RE_SEEDANCE.test(String(obj.model)))) {
    return patchFields(obj, stats, opts);
  }
  return false;
}

/** 深度遍历找预设容器 */
function patchPayloadDeep(obj, stats, opts) {
  if (!obj || typeof obj !== 'object') return false;
  let touched = false;
  if (patchPreset(obj, stats, opts)) touched = true;
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v && typeof v === 'object') {
      if (patchPayloadDeep(v, stats, opts)) touched = true;
    }
  }
  return touched;
}

/* ---- 消息文本时长信号对齐（run36/task_ff3dab 实证） ----
 * 豆包 actionbar 会把当前时长档（默认「，10s」）拼进发送的消息文本；Seedance bot 从文本解析时长。
 * ability_param.duration 只是元数据（任务驱动改写生效后确认卡仍报 actionbar 值）——文本才是权威通道。
 * 文本出现两个不同时长（提示词「，5秒」+ actionbar「，10s」）时 bot 会生成两条独立视频（双倍额度）。
 * 任务驱动模式下把文本中所有「，Ns」时长 token 统一对齐为任务时长，消除双信号。
 * （协议层方案：不改 actionbar UI——滑杆控件结构易变，DOM 拖拽脆弱，改写请求体最稳。） */
const RE_TEXT_DURATION = /([，,]\s*)(\d{1,2})(\s*s\b)/g;

function alignTextDuration(text, targetDuration, stats) {
  if (typeof text !== 'string' || !text) return null;
  let changed = false;
  const out = text.replace(RE_TEXT_DURATION, (m, pre, d, post) => {
    if (Number(d) === Number(targetDuration)) return m;
    changed = true;
    (stats.textChanges = stats.textChanges || []).push(d + 's→' + targetDuration + 's');
    return pre + String(targetDuration) + post;
  });
  return changed ? out : null;
}

/** 深度遍历改写消息文本（content/text 字段；content 可能为字符串化 JSON——content_type 2020 形态） */
function patchTextDeep(obj, targetDuration, stats) {
  if (!obj || typeof obj !== 'object') return false;
  let touched = false;
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (typeof v === 'string' && (k === 'content' || k === 'text')) {
      const aligned = alignTextDuration(v, targetDuration, stats);
      if (aligned != null) {
        obj[k] = aligned;
        touched = true;
      } else if (v.trim().charAt(0) === '{') {
        try {
          const inner = JSON.parse(v);
          if (patchTextDeep(inner, targetDuration, stats)) {
            obj[k] = JSON.stringify(inner);
            touched = true;
          }
        } catch (e) { /* 非合法 JSON，跳过 */ }
      }
    } else if (v && typeof v === 'object') {
      if (patchTextDeep(v, targetDuration, stats)) touched = true;
    }
  }
  return touched;
}

/** 主入口：与 WOOL patchDoubaoVideoPresetBody(body) 语义一致
 *  opts（任务驱动）：{ duration, model, ratio } —— 传入时按任务精确改写 duration（doubao2api 同源能力），
 *  model/ratio 省略则保持页面当前所选；不传 opts 走旧固定目标（config.patch30）。
 *  任务驱动同时改写消息文本中的「，Ns」时长 token（对齐任务时长，消除 actionbar 双信号）。
 *  返回 { body, changed, duration, model, ratio, textChanges }；非视频体返回 null */
function patchCompletionBody(bodyStr, opts) {
  if (!looksLikeVideoGenerationBody(bodyStr)) return null;
  const taskMode = !!(opts && opts.duration != null);
  const stats = { duration: taskMode ? opts.duration : TARGET_DURATION, model: taskMode ? (opts.model || null) : TARGET_MODEL };
  let out = bodyStr;
  let changed = false;
  try {
    const obj = JSON.parse(bodyStr);
    let touched = false;
    if (patchPayloadDeep(obj, stats, opts)) touched = true;
    if (taskMode && patchTextDeep(obj, opts.duration, stats)) touched = true;
    if (touched) {
      out = JSON.stringify(obj);
      changed = true;
    }
  } catch (e) {
    // 非 JSON 序列化变体 —— 正则兜底
    if (/"duration"\s*:\s*"?(\d+)/.test(bodyStr)) {
      out = out.replace(/("duration"\s*:\s*"?)(\d+)/, `$1${stats.duration}`);
      changed = true;
    }
    if (taskMode && opts.ratio) {
      const ra = /("(?:ratio|aspect_ratio|aspectRatio)"\s*:\s*")([^"]+)(")/;
      if (ra.test(out)) {
        out = out.replace(ra, `$1${opts.ratio}$3`);
        stats.ratio = opts.ratio;
        changed = true;
      }
    }
    if (taskMode) {
      const aligned = alignTextDuration(out, opts.duration, stats);
      if (aligned != null) {
        out = aligned;
        changed = true;
      }
    }
  }
  return { body: out, changed, duration: stats.duration, model: stats.model, ratio: stats.ratio || null, textChanges: stats.textChanges || null };
}

/** URL 判定（与 WOOL isCompletionUrl/isSkillPackUrl 对应） */
function isCompletionUrl(url) {
  if (!url) return false;
  const u = String(url);
  return config.doubao.endpoints.completion.some((p) => u.includes(p));
}
function isChainSingleUrl(url) {
  return typeof url === 'string' && url.includes(config.doubao.endpoints.chainSingle);
}
function isSkillPackUrl(url) {
  if (!url) return false;
  const u = String(url).toLowerCase();
  return /skill[_-]?pack/.test(u) && config.doubao.hostnames.some((h) => u.includes(h));
}

module.exports = {
  TARGET_DURATION,
  TARGET_MODEL,
  looksLikeVideoGenerationBody,
  patchCompletionBody,
  isCompletionUrl,
  isChainSingleUrl,
  isSkillPackUrl,
};
