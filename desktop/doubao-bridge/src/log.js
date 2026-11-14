'use strict';
/* 时间戳本地化（2026-11-10 审计）
 * 旧实现 new Date().toISOString().slice(11,23) 输出 UTC 的 HH:mm:ss.SSS，
 * 而同一目录下的 backend.log 是 Go 的本地时间（time=2026-11-10T09:00:55.603+08:00）。
 * 两本日志混着排障时差 8 小时，且跨日任务对不上号。
 * 现输出本地时间完整日期（可排序、无歧义），与 backend.log 时间线可直接并排比对。 */
const pad = (n, w = 2) => String(n).padStart(w, '0');
const ts = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
};
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
let threshold = LEVELS[process.env.BRIDGE_LOG || 'info'] || 20;
function emit(level, tag, args) {
  if (LEVELS[level] < threshold) return;
  const line = args.map((a) => {
    if (typeof a === 'string') return a;
    try { return JSON.stringify(a); } catch (e) { return String(a); }
  }).join(' ');
  console.log(`${ts()} [${level.toUpperCase()}] [${tag}] ${line}`);
}
module.exports = (tag) => ({
  debug: (...a) => emit('debug', tag, a),
  info: (...a) => emit('info', tag, a),
  warn: (...a) => emit('warn', tag, a),
  error: (...a) => emit('error', tag, a),
});
