'use strict';
/* 任务行形状一致性（2026-11-12 事故回归）
 *
 * 事故：客户端面板把「生图超时：未捕获到生成图片」显示成「未知原因」。
 * 原因是 SSE 推送发的是 toPollJson 形状（失败原因在 detail），
 * 而客户端读的是 error —— 两个通道各写一份形状就会这样漂移。
 * 这里锁死：/v1/tasks 与 /v1/events 必须走同一个 toRow。
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'peekreel-bridge-task-row-'));
process.env.BRIDGE_DATA_DIR = path.join(testRoot, 'data');
process.on('exit', () => fs.rmSync(testRoot, { recursive: true, force: true }));

const ROOT = path.join(__dirname, '..');
const tasks = require(path.join(ROOT, 'src', 'tasks.js'));
const { dataDir } = require('../src/runtime-paths');

let passed = 0;
let failed = 0;
function ok(name, fn) {
  try { fn(); passed += 1; console.log('  ✓ ' + name); }
  catch (e) { failed += 1; console.log('  ✗ ' + name + ' → ' + e.message); }
}

// 造一个最小任务对象（不落盘：直接调 toRow）
function mkTask(over) {
  return Object.assign({
    id: 'task_x', status: 'processing', created_at: 1,
    input: { kind: 'image', model: 'doubao_image_1.0', prompt: '一个玻璃杯' },
    progress: [],
  }, over || {});
}

console.log('\n[toRow 字段]');

ok('任务行只暴露所属节点 ID', () => {
  const row = tasks.toRow(mkTask({ input: { kind: 'image', model: 'x', metadata: { nodeId: 'node-a', secret: 'private' } } }));
  assert.strictEqual(row.nodeId, 'node-a');
  assert.strictEqual(row.metadata, undefined);
  assert.strictEqual(tasks.toRow(mkTask()).nodeId, null);
});

ok('失败原因走 error 字段（不是 detail）', () => {
  const row = tasks.toRow(mkTask({ status: 'failed', error: '生图超时：未捕获到生成图片' }));
  assert.strictEqual(row.error, '生图超时：未捕获到生成图片');
  assert.strictEqual(row.detail, undefined, '不应再暴露 detail（客户端只读 error）');
});

ok('成功任务的 error 为 null（而不是 undefined）', () => {
  const row = tasks.toRow(mkTask({ status: 'completed' }));
  assert.strictEqual(row.error, null);
});

ok('note 取最后一条进度', () => {
  const row = tasks.toRow(mkTask({ progress: [{ at: 1, msg: '旧' }, { at: 2, msg: '采用无水印原图' }] }));
  assert.strictEqual(row.note, '采用无水印原图');
});

ok('kind 缺省为 video；prompt 截断到 80', () => {
  const row = tasks.toRow(mkTask({ input: { model: 'x', prompt: 'a'.repeat(200) } }));
  assert.strictEqual(row.kind, 'video');
  assert.strictEqual(row.prompt.length, 80);
});

console.log('\n[通道一致性（静态）]');

ok('/v1/tasks 与 /v1/events 都使用 tasks.toRow，不再各自拼装字段', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'server.js'), 'utf8');
  assert.ok(/\.map\(tasks\.toRow\)/.test(src), '/v1/tasks 应走 toRow');
  assert.ok(/slice\(0, 20\)\.map\(tasks\.toRow\)/.test(src), 'SSE 快照应走 toRow');
  // /v1/videos/:id 是 OpenAI 兼容端点，仍用 toPollJson 形状（detail + result），
  // 但 SSE 通道内不允许再出现 toPollJson —— 那是面板数据源，必须与轮询行同形。
  const sseStart = src.indexOf("p === '/v1/events'");
  assert.ok(sseStart > 0, '找不到 SSE 端点');
  const sseBlock = src.slice(sseStart, sseStart + 1500);
  assert.ok(!/toPollJson/.test(sseBlock), 'SSE 通道内不应再发 toPollJson（形状会漂移）');
});

ok('tasks 事件也发 toRow（订阅方无需二次解析）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'tasks.js'), 'utf8');
  assert.ok(/action: 'transition', task: toRow\(t\)/.test(src));
  assert.ok(/action: 'note', task: toRow\(t\)/.test(src));
});

console.log('\n[重试后清残留 error]');

// 2026-11-12 用户实测：图片生成成功，但对话面板底部仍红字「豆包未登录：请…扫码登录后重试」。
// 原因：任务先派给未登录账号 → 失败 → 自动换号重试（status 回到 queued），
// 上一次的 error 没清，toRow 把它一路带到面板。
ok('重试重新入队会清掉上一次尝试的失败原因', () => {
  const store = path.join(dataDir, 'tasks.json');
  const backup = fs.existsSync(store) ? fs.readFileSync(store) : null;
  try {
    const t = tasks.create({ kind: 'image', model: 'doubao_image_1.0', prompt: '小猫' });
    tasks.transition(t, 'processing', { error: '豆包未登录：请在「豆包账号管理」页对该账号扫码登录后重试' });
    assert.ok(/豆包未登录/.test(tasks.toRow(t).error), '本次尝试应暴露原因');
    tasks.transition(t, 'queued');
    assert.strictEqual(t.error, null, '重新入队必须清掉上一次的失败原因');
    assert.strictEqual(tasks.toRow(t).error, null, '面板不应再读到残留原因');
    tasks.transition(t, 'processing');
    assert.strictEqual(t.error, null, '进入处理态仍应为空');
  } finally {
    if (backup) fs.writeFileSync(store, backup); else fs.rmSync(store, { force: true });
  }
});

ok('显式传入 error 时以调用方为准（不被自动清空覆盖）', () => {
  const store = path.join(dataDir, 'tasks.json');
  const backup = fs.existsSync(store) ? fs.readFileSync(store) : null;
  try {
    const t = tasks.create({ kind: 'text', model: 'doubao_text_1.0', prompt: 'hi' });
    tasks.transition(t, 'queued', { error: '保留我' });
    assert.strictEqual(t.error, '保留我');
  } finally {
    if (backup) fs.writeFileSync(store, backup); else fs.rmSync(store, { force: true });
  }
});

ok('派发优先挑「浏览器已活着」的账号（避免先吃一次未登录失败）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'accounts.js'), 'utf8');
  assert.ok(/const warm = \(a\) =>/.test(src), '应有热账号判定');
  assert.ok(/warm\(a\) - warm\(b\)/.test(src), '热账号应排在冷账号之前');
});

console.log('\n[生图张数]');

// 2026-11-12 用户实测：豆包一次回 5 张（「已为你生成 5 张…图片」），
// 原实现硬编码 slice(0, 4)，第 5 张被静默丢弃 —— 用户看到 5 张却只能拿到 4 张。
ok('生图不再硬编码 4 张上限（按实际返回，兜底 8）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'driver.js'), 'utf8');
  assert.ok(!/srcs\.slice\(0, 4\)/.test(src), '不应再有 slice(0, 4) 硬编码');
  const m = src.match(/const MAX_IMAGES = (\d+);/);
  assert.ok(m, '应有 MAX_IMAGES 常量');
  assert.ok(Number(m[1]) >= 5, '上限至少 5（豆包常见一次 5 张）');
  assert.ok(/srcs\.slice\(0, MAX_IMAGES\)/.test(src), '应按 MAX_IMAGES 截断');
});

ok('桥把返回的全部图片原样交给客户端（不按 n=1 截断）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'server.js'), 'utf8');
  assert.ok(/data: urls\.map\(\(u\) => \(\{ url: u \}\)\)/.test(src), '应按 imageDataUrls 的全量返回');
});

console.log('\nPASS: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
