'use strict';
/* chain-meta.js —— 从 chain 载荷里读视频元数据（宽高/时长/封面）
 *
 * 为什么要独立成模块：
 *  · fplay 交付路径能直接拿到 clean.width/height/duration，但 **chain 兜底交付**
 *    那三个字段一直是空的——readDomVideoMeta 在 chain 到达时页面还没渲染 <video>，
 *    必然返回 null（真机实测确认）。
 *  · 而载荷里其实就有：video_model.video_list[*].vwidth/vheight 是真实分辨率，
 *    video_model.video_duration 是真实时长。
 *  · 纯函数、无浏览器依赖 → 单独成模块才能被单测覆盖（driver.js 整体无法在 CI 加载）。
 *
 * 载荷结构（2026-11-10 真机）：
 *   downlink_body.pull_singe_chain_downlink_body.messages[0]
 *     .content_block[1].content.creation_block.creations[0].video
 *       = { vid, cover, width, height, duration, download_url, video_model: "<JSON 字符串>" }
 *   注意 video_model 是**字符串化的 JSON**，要二次 parse。
 */
function findChainVideoMeta(chainText) {
  if (typeof chainText !== 'string' || !chainText) return null;
  let root;
  try { root = JSON.parse(chainText); } catch (e) { return null; }
  const queue = [root];
  let guard = 0;
  while (queue.length && guard++ < 5000) {
    const node = queue.shift();
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node)) { for (const v of node) queue.push(v); continue; }
    if (typeof node.video_model === 'string' && node.video_model.includes('video_list')) {
      try {
        const vm = JSON.parse(node.video_model);
        const out = { duration_s: vm.video_duration || null, width: null, height: null };
        let bestArea = -1;
        for (const key of Object.keys(vm.video_list || {})) {
          const e = vm.video_list[key] || {};
          if (!e.vwidth || !e.vheight) continue;
          const area = e.vwidth * e.vheight;
          if (area > bestArea) { bestArea = area; out.width = e.vwidth; out.height = e.vheight; }
        }
        // 兜底：video 对象自身的 duration/width/height
        if (!out.duration_s && Number(node.duration) > 0) out.duration_s = Number(node.duration);
        if ((!out.width || !out.height) && node.width && node.height) { out.width = node.width; out.height = node.height; }
        if (out.width || out.height || out.duration_s) return out;
      } catch (e) { /* 不是 JSON，继续找下一个节点 */ }
    }
    for (const v of Object.values(node)) if (v && typeof v === 'object') queue.push(v);
  }
  return null;
}

/** 从 chain 载荷里读封面图（cover.image_preview.url 优先，退回 image_thumb）。
 *  同样是纯函数；拿不到返回 null。 */
function findChainCover(chainText) {
  if (typeof chainText !== 'string' || !chainText) return null;
  let root;
  try { root = JSON.parse(chainText); } catch (e) { return null; }
  const queue = [root];
  let guard = 0;
  while (queue.length && guard++ < 5000) {
    const node = queue.shift();
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node)) { for (const v of node) queue.push(v); continue; }
    const cover = node.cover;
    if (cover && typeof cover === 'object') {
      const preview = cover.image_preview && cover.image_preview.url;
      const thumb = cover.image_thumb && cover.image_thumb.url;
      const url = preview || thumb;
      if (typeof url === 'string' && /^https?:\/\//.test(url)) return url;
    }
    for (const v of Object.values(node)) if (v && typeof v === 'object') queue.push(v);
  }
  return null;
}

module.exports = { findChainVideoMeta, findChainCover };