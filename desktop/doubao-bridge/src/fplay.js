'use strict';
/* fplay.js —— 豆包视频「无水印档」解析（纯 Node，无浏览器依赖）
 *
 * ============================ 结论与证据 ============================
 * 豆包视频其实**有**无水印档，只是不在 chain 载荷的默认 gear 里。
 * 必须向字节 fplay 接口要 `codec_type=8`，才会返回 `lr=unwatermarked` 的原始档。
 *
 * 证据链（全部真机实测，2026-11-10）：
 *  · chain 载荷 `video.video_model.fallback_api` 指向
 *    https://vas-lf-x.snssdk.com/video/fplay/1/<token>/<vid>?…
 *    默认 gear_des_key 带 `3:video_gen_watermark_dyn`，size≈2.5MB（水印版）
 *  · 同一接口加 `codec_type=8` → gear 变成 `0:MP4|1:default|2:h264|4:unknown|…`，
 *    `logo_type` 为空，size≈28MB（21Mbps 原始档）
 *  · 该 gear 的 `main_url` 是**加密的**（base64，前置 4 字节头 + AES-128-CBC）
 *  · 解密得到的地址带 `lr=unwatermarked`，下载后 720x1280 / 10.04s / 26.85MB，
 *    抽帧**无「豆包AI生成」水印**（对照水印版同帧右下角有明显水印）
 *
 * 解密算法（逆向自 WOOL `fplay.jsc` 的 deriveKeyIv/decryptUrl，已逐字节比对一致）：
 *    seed = base64decode(key_seed)                       // 32B
 *    h1   = sha512(seed)                                 // 64B
 *    h2   = sha512(h1 || SALT)                           // 64B
 *    key  = h2[0..16]   iv = h2[16..32]                  // AES-128-CBC
 *    plain = AES128CBC_Decrypt( base64decode(main_url)[4..], key, iv )   // 跳过 4B 头
 *
 * WOOL 的 fplay.jsc 还导出 COMBOS（{no_watermark, unwatermarked, default} ×
 * codecType=8），说明它也是走同一套；实测 logoType 取值对结果无影响，
 * 真正起作用的是 codec_type=8。
 *
 * 失败策略：任何一步失败都返回 null，调用方回落到原 chain 直链（带水印但可用）。
 */
const crypto = require('crypto');

/** WOOL fplay.jsc 导出的 SALT_HEX（32 字节，参与 sha512 key 派生） */
const SALT_HEX =
  '4dd4c2e6b83162090e52b3c7a6733ba41cb2462b829ab58a196b39db57177524f49baf7f08e8d68d26a72e37c1a95a2f1f05a51892aef2949732b62a38aadd58';
const SALT = Buffer.from(SALT_HEX, 'hex');

/** 无水印 gear 的请求参数（WOOL COMBOS 实测：起决定作用的是 codecType=8） */
const CLEAN_CODEC_TYPE = '8';
const CLEAN_LOGO_TYPE = 'unwatermarked';

/** key_seed(base64) → { key: 16B, iv: 16B } */
function deriveKeyIv(keySeed) {
  const seed = Buffer.from(String(keySeed || '').trim(), 'base64');
  if (!seed.length) throw new Error('key_seed 为空');
  const h1 = crypto.createHash('sha512').update(seed).digest();
  const h2 = crypto.createHash('sha512').update(Buffer.concat([h1, SALT])).digest();
  return { key: h2.subarray(0, 16), iv: h2.subarray(16, 32) };
}

/** 解密 fplay 的 main_url（base64 密文，前 4 字节是头） */
function decryptUrl(mainUrl, keySeed) {
  if (typeof mainUrl !== 'string' || !mainUrl) throw new Error('main_url 为空');
  const blob = Buffer.from(mainUrl, 'base64');
  if (blob.length <= 4 || (blob.length - 4) % 16 !== 0) throw new Error('main_url 结构异常（len=' + blob.length + '）');
  const { key, iv } = deriveKeyIv(keySeed);
  const d = crypto.createDecipheriv('aes-128-cbc', key, iv);
  const plain = Buffer.concat([d.update(blob.subarray(4)), d.final()]).toString('utf8');
  if (!/^https?:\/\//.test(plain)) throw new Error('解密结果不是 URL');
  return plain;
}

/** 在 fallback_api 上加上无水印 gear 参数 */
function buildCleanUrl(fallbackApi) {
  const u = new URL(fallbackApi);
  u.searchParams.set('codec_type', CLEAN_CODEC_TYPE);
  u.searchParams.set('logo_type', CLEAN_LOGO_TYPE);
  return u.toString();
}

/** 从 chain 载荷里找 fallback_api + key_seed。
 *  video_model 是**字符串化 JSON**（`video.video_model` = "{...}"），要二次 parse。
 *  找不到返回 null；找到多个取第一个可用的。 */
function findFplaySource(chainText) {
  if (typeof chainText !== 'string' || !chainText) return null;
  let root;
  try { root = JSON.parse(chainText); } catch (e) { return null; }
  const queue = [root];
  let guard = 0;
  while (queue.length && guard++ < 5000) {
    const node = queue.shift();
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node)) { for (const v of node) queue.push(v); continue; }
    // 命中：video_model 字符串里带 fallback_api + key_seed
    if (typeof node.video_model === 'string' && node.video_model.includes('fallback_api')) {
      try {
        const vm = JSON.parse(node.video_model);
        if (vm.fallback_api && vm.key_seed) {
          return { fallbackApi: vm.fallback_api, keySeed: vm.key_seed, videoId: vm.video_id || null, duration: vm.video_duration || null };
        }
      } catch (e) { /* 继续找 */ }
    }
    // 也支持已经是对象的形态
    if (node.video_model && typeof node.video_model === 'object' && node.video_model.fallback_api && node.video_model.key_seed) {
      return { fallbackApi: node.video_model.fallback_api, keySeed: node.video_model.key_seed, videoId: node.video_model.video_id || null, duration: node.video_model.video_duration || null };
    }
    for (const v of Object.values(node)) if (v && typeof v === 'object') queue.push(v);
  }
  return null;
}

/** 解析 fplay 响应，挑出无水印 gear 并解密出 URL。
 *  @returns {Promise<{url,size,definition,width,height,duration,gear}|null>} */
async function resolveNoWatermark(fallbackApi, keySeed) {
  const res = await fetch(buildCleanUrl(fallbackApi), {
    headers: { Referer: 'https://www.doubao.com/', 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) return null;
  const j = await res.json().catch(() => null);
  const data = j && j.video_info && j.video_info.data;
  if (!data || !data.video_list) return null;
  const list = data.video_list;
  let best = null;
  for (const key of Object.keys(list)) {
    const e = list[key];
    if (!e || !e.main_url) continue;
    let url;
    try { url = decryptUrl(e.main_url, keySeed); } catch (err) { continue; }
    const lr = (new URL(url).searchParams.get('lr') || '');
    if (lr !== 'unwatermarked') continue; // 只要确证无水印的档
    const item = {
      url, size: e.size || null, definition: e.definition || null,
      width: e.vwidth || null, height: e.vheight || null,
      duration: e.video_duration || (data.video_duration || null),
      gear: e.gear_des_key || null, lr,
    };
    if (!best || (item.size || 0) > (best.size || 0)) best = item;
  }
  return best;
}

/** 一步到位：从 chain 载荷文本直接拿无水印视频 URL。
 *  @returns {Promise<{url,size,definition,width,height,duration,gear,videoId}|null>} */
async function resolveFromChain(chainText) {
  const src = findFplaySource(chainText);
  if (!src) return null;
  let clean;
  try { clean = await resolveNoWatermark(src.fallbackApi, src.keySeed); } catch (e) { return null; }
  if (!clean) return null;
  return Object.assign({}, clean, { videoId: src.videoId });
}

module.exports = {
  SALT_HEX,
  CLEAN_CODEC_TYPE,
  CLEAN_LOGO_TYPE,
  deriveKeyIv,
  decryptUrl,
  buildCleanUrl,
  findFplaySource,
  resolveNoWatermark,
  resolveFromChain,
};