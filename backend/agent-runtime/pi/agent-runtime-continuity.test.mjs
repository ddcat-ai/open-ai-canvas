import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

const usage = { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 120 };
const tools = ['plan_update', 'ask_user'].map(name => ({
  name,
  description: name,
  executionMode: 'sequential',
  parameters: { type: 'object', properties: {}, additionalProperties: true },
}));

async function mockBridge(t, modelReply, toolReply) {
  const modelCalls = [];
  const toolCalls = [];
  const events = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    response.setHeader('content-type', 'application/json');
    if (request.url === '/event') {
      events.push(body);
      response.end('{}');
    } else if (request.url === '/model') {
      modelCalls.push(body);
      response.end(JSON.stringify(modelReply(body, modelCalls.length)));
    } else if (request.url === '/tool') {
      toolCalls.push(body);
      response.end(JSON.stringify(toolReply(body, toolCalls.length)));
    } else {
      response.statusCode = 404;
      response.end('{}');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  async function run(overrides = {}) {
    const body = {
      bridgeURL: `http://127.0.0.1:${server.address().port}`,
      bridgeToken: 'test-only',
      runId: 'test-run',
      turnId: 'test-run',
      prompt: '帮我生成亚马逊日本站套图，不含白底图。',
      systemPrompt: '按最新用户目标执行。',
      model: { id: 'fixture-text', contextWindow: 32000, maxTokens: 4096 },
      tools,
      compaction: { enabled: false },
      ...overrides,
    };
    const child = spawn(process.execPath, ['agent-runtime.mjs'], { cwd: import.meta.dirname, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    let error = '';
    child.stdout.on('data', chunk => output += chunk);
    child.stderr.on('data', chunk => error += chunk);
    child.stdin.end(JSON.stringify(body));
    const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
    const code = await new Promise(resolve => child.on('close', resolve));
    clearTimeout(timer);
    assert.equal(code, 0, `${output}\n${error}`);
    return events.filter(event => event.type === 'session_snapshot').at(-1)?.sessionJSONL;
  }
  return { modelCalls, toolCalls, events, run };
}

test('a terminating question remains in native history for the next Japanese-site answer', async t => {
  const bridge = await mockBridge(t, (_body, step) => step === 1
    ? { text: '日本站套图需要确认商品用途。', toolCalls: [{ id: 'ask-1', name: 'ask_user', arguments: { question: '这款产品用于什么场景？' } }], usage }
    : { text: '继续按日本站制作。', usage },
  () => ({ content: '{"phase":"question"}', terminate: true }));
  const snapshot = await bridge.run();
  assert.ok(snapshot);
  const entries = snapshot.trim().split('\n').map(JSON.parse);
  assert.ok(entries.some(entry => entry.type === 'message' && entry.message?.role === 'assistant' && entry.message.content?.some(part => part.type === 'text' && part.text.includes('日本站'))));
  assert.ok(entries.some(entry => entry.type === 'message' && entry.message?.role === 'toolResult' && entry.message.toolCallId === 'ask-1'));

  await bridge.run({ runId: 'answer-run', turnId: 'answer-run', sessionJSONL: snapshot, prompt: '园艺滴灌使用。' });
  const next = bridge.modelCalls.at(-1);
  assert.ok(next.messages.some(message => message.role === 'assistant' && JSON.stringify(message.content).includes('日本站')));
  assert.ok(next.messages.some(message => message.role === 'toolResult' && message.toolCallId === 'ask-1'));
});

test('native upstream history orders old US, explicit JP, gardening answer, then JP with English copy', async t => {
  const bridge = await mockBridge(t, (_body, step) => step === 2
    ? { text: '已按日本站且不含白底图规划，请确认用途。', toolCalls: [{ id: 'jp-question', name: 'ask_user', arguments: { question: '产品用途？' } }], usage }
    : { text: step === 1 ? '旧美国站方案。' : '继续日本站方案。', usage },
  () => ({ content: '{"phase":"question"}', terminate: true }));
  let snapshot = await bridge.run({ runId: 'us-run', turnId: 'us-run', prompt: '做适用于亚马逊美国站的套图。' });
  snapshot = await bridge.run({ runId: 'jp-run', turnId: 'jp-run', sessionJSONL: snapshot, prompt: '改成亚马逊日本站套图，不要白底图。' });
  snapshot = await bridge.run({ runId: 'purpose-run', turnId: 'purpose-run', sessionJSONL: snapshot, prompt: '用于园艺滴灌与喷淋。' });
  await bridge.run({ runId: 'copy-run', turnId: 'copy-run', sessionJSONL: snapshot, prompt: '英文文案由我撰写，画幅 1:1。' });
  const messages = bridge.modelCalls.at(-1).messages;
  const sequence = messages.filter(message => ['user', 'assistant', 'toolResult'].includes(message.role)).map(message =>
    message.role === 'toolResult' ? `tool:${message.toolCallId}` : `${message.role}:${JSON.stringify(message.content)}`);
  for (const [left, right] of [
    ['美国站', '日本站'], ['日本站', 'tool:jp-question'], ['tool:jp-question', '园艺滴灌'], ['园艺滴灌', '英文文案'],
  ]) {
    const from = sequence.findIndex(item => item.includes(left));
    const to = sequence.findIndex((item, index) => index > from && item.includes(right));
    assert.ok(from >= 0 && to > from, `history order ${left} -> ${right}: ${sequence.join(' | ')}`);
  }
  assert.ok(sequence.some(item => item.includes('已按日本站且不含白底图规划')));
  assert.ok(bridge.modelCalls.at(-1).messages.some(message => message.role === 'user' && JSON.stringify(message.content).includes('英文文案')));
});

test('approval resume completes every pending tool call before another text-model request', async t => {
  let approved = false;
  const bridge = await mockBridge(t, (_body, step) => step === 1
    ? { text: '先确认计划，再询问文案语言。', toolCalls: [
      { id: 'plan-1', name: 'plan_update', arguments: { items: [] } },
      { id: 'ask-2', name: 'ask_user', arguments: { question: '日本站需要哪种文案语言？' } },
    ], usage }
    : { text: '继续执行。', usage },
  body => body.name === 'plan_update' && !approved
    ? { pause: true, approvalId: 'approval-1', content: '等待审批' }
    : body.name === 'plan_update'
      ? { content: '{"ok":true}' }
      : { content: '{"phase":"question"}', terminate: true });
  const paused = await bridge.run();
  assert.ok(paused);
  const pausedEntries = paused.trim().split('\n').map(JSON.parse);
  assert.ok(pausedEntries.some(entry => entry.type === 'message' && entry.message?.role === 'assistant' && entry.message.content?.some(part => part.type === 'toolCall' && part.id === 'ask-2')), 'approval snapshot must retain the pending second tool call');
  approved = true;
  await bridge.run({ sessionJSONL: paused, prompt: '已批准计划，请继续完成上一轮工具调用。' });
  assert.equal(bridge.toolCalls.findLast(call => call.callId === 'plan-1')?.replayOnly, true, 'approved tool result must be read from its committed record');
  assert.equal(bridge.toolCalls.findLast(call => call.callId === 'ask-2')?.replayOnly, undefined, 'the next tool must really execute');
  assert.ok(bridge.toolCalls.some(call => call.callId === 'ask-2'), 'the second tool in the approved group must execute');
  for (const call of bridge.modelCalls.slice(1)) {
    const messages = call.messages || [];
    const pending = new Set();
    for (const message of messages) {
      if (message.role === 'assistant') for (const part of message.content || []) if (part.type === 'toolCall') pending.add(part.id);
      if (message.role === 'toolResult') pending.delete(message.toolCallId);
    }
    assert.deepEqual([...pending], [], 'no model request may contain an orphaned tool call');
  }
});

test('a new revision closes a rejected parent plan without replaying any of its tools', async t => {
  const bridge = await mockBridge(t, (_body, step) => step === 1
    ? { text: '旧方案等待审批。', toolCalls: [
      { id: 'old-plan', name: 'plan_update', arguments: { items: [] } },
      { id: 'old-question', name: 'ask_user', arguments: { question: '旧问题' } },
    ], usage }
    : { text: '按备注重新规划法国站五图，1K。', usage },
  () => ({ pause: true, approvalId: 'old-approval', content: '等待审批' }));
  const paused = await bridge.run();
  assert.equal(bridge.toolCalls.length, 1);
  await bridge.run({ runId: 'new-revision', turnId: 'new-revision', rejectedParentRunId: 'test-run', sessionJSONL: paused, prompt: '请按备注改成法国站五图 1K。' });
  assert.equal(bridge.toolCalls.length, 1, 'rejected tools must not be executed or charged by the child');
  const messages = bridge.modelCalls.at(-1).messages;
  const results = messages.filter(message => message.role === 'toolResult');
  for (const id of ['old-plan', 'old-question']) {
    assert.ok(results.some(result => result.toolCallId === id && JSON.stringify(result.content).includes('user_rejected')), 'every rejected/aborted call must have a truthful control result');
  }
  assert.ok(messages.some(message => message.role === 'user' && JSON.stringify(message.content).includes('法国站五图')));
});
