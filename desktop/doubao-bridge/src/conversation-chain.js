'use strict';

const crypto = require('node:crypto');

function sentText(task) {
  const input = task.input || {};
  if (task.result?.kind === 'image') return '生成图片：' + String(input.prompt || '');
  if (task.result?.kind !== 'text') return '';
  const messages = Array.isArray(input.messages) ? input.messages : [];
  const last = [...messages].reverse().find((m) => m && m.role === 'user');
  const text = String((last && (last.content != null ? last.content : last.text)) || input.prompt || '');
  const system = String(input.instructions || input.system || '').trim();
  return system ? system + '\n\n' + text : text;
}

function fingerprint(body, conversationId, task) {
  const chain = body?.downlink_body?.pull_singe_chain_downlink_body;
  if (body?.status_code !== 0 || !chain || chain.has_more !== false || !Array.isArray(chain.messages)) return '';
  const messages = chain.messages;
  if (messages.length < 2 || messages.some((m) => !m || m.conversation_id !== conversationId ||
      typeof m.message_id !== 'string' || !/^\d+$/.test(m.message_id) ||
      ![1, 2].includes(m.user_type) || !Array.isArray(m.content_block))) return '';
  if (new Set(messages.map((m) => m.message_id)).size !== messages.length) return '';
  const users = messages.filter((m) => m.user_type === 1);
  if (users.length !== 1 || !messages.some((m) => m.user_type === 2)) return '';
  const text = users[0].content_block.map((b) => b?.content?.text_block?.text).filter((s) => typeof s === 'string').join('');
  if (!text || text !== sentText(task)) return '';
  const stable = messages.map((m) => ({ id: m.message_id, type: m.user_type, index: m.index_in_conv,
    version: m.message_body_version, status: m.status, blocks: m.content_block }));
  return 'chain-v1:' + crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

async function load(page, conversationId, task) {
  const response = page.waitForResponse((r) => {
    try {
      const url = new URL(r.url());
      const request = r.request();
      return url.origin === 'https://www.doubao.com' && url.pathname === '/im/chain/single' &&
        request.method() === 'POST' && JSON.parse(request.postData() || '{}').uplink_body?.pull_singe_chain_uplink_body?.conversation_id === conversationId;
    } catch { return false; }
  }, { timeout: 20000 });
  // Consume a timeout even if navigation fails first.
  response.catch(() => {});
  await page.goto('https://www.doubao.com/chat/' + conversationId, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const result = await response;
  if (!result.ok() || new URL(page.url()).pathname !== '/chat/' + conversationId) return '';
  return fingerprint(await result.json(), conversationId, task);
}

module.exports = { fingerprint, load };
